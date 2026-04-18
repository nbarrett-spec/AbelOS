export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'
import { safeJson } from '@/lib/safe-json'
import { audit } from '@/lib/audit'

// ──────────────────────────────────────────────────────────────────────────
// Material Watch API
//
// Tracks items that orders are waiting on. When material arrives at the
// warehouse (via PO receiving), watchers are notified and order status
// auto-updates from AWAITING_MATERIAL → READY_TO_SHIP.
//
// GET  — List active material watches (filter by orderId, status, productId)
// POST — Create a material watch for an order item
// PATCH — Update a watch (mark arrived, cancel, etc.)
// ──────────────────────────────────────────────────────────────────────────

let tableEnsured = false
async function ensureTable() {
  if (tableEnsured) return
  try {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "MaterialWatch" (
        "id" TEXT PRIMARY KEY,
        "orderId" TEXT NOT NULL,
        "orderItemId" TEXT,
        "productId" TEXT NOT NULL,
        "jobId" TEXT,
        "sku" TEXT NOT NULL,
        "productName" TEXT NOT NULL,
        "qtyNeeded" INT NOT NULL,
        "qtyAvailable" INT NOT NULL DEFAULT 0,
        "status" TEXT NOT NULL DEFAULT 'AWAITING',
        "notifiedSalesRep" BOOLEAN NOT NULL DEFAULT FALSE,
        "notifiedOps" BOOLEAN NOT NULL DEFAULT FALSE,
        "arrivedAt" TIMESTAMPTZ,
        "salesRepId" TEXT,
        "createdById" TEXT,
        "purchaseOrderId" TEXT,
        "notes" TEXT,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `)
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "MaterialWatch_orderId_idx" ON "MaterialWatch" ("orderId")`)
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "MaterialWatch_productId_idx" ON "MaterialWatch" ("productId")`)
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "MaterialWatch_status_idx" ON "MaterialWatch" ("status")`)
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "MaterialWatch_salesRepId_idx" ON "MaterialWatch" ("salesRepId")`)
    tableEnsured = true
  } catch {
    tableEnsured = true
  }
}

/**
 * GET /api/ops/material-watch
 * List watches. Filters: ?orderId=, ?status=AWAITING, ?productId=, ?salesRepId=
 */
export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    await ensureTable()

    const { searchParams } = new URL(request.url)
    const orderId = searchParams.get('orderId')
    const status = searchParams.get('status')
    const productId = searchParams.get('productId')
    const salesRepId = searchParams.get('salesRepId')

    let query = `
      SELECT mw.*,
             o."orderNumber", o."status"::text AS "orderStatus",
             b."companyName" AS "builderName",
             s."firstName" || ' ' || s."lastName" AS "salesRepName"
      FROM "MaterialWatch" mw
      LEFT JOIN "Order" o ON mw."orderId" = o."id"
      LEFT JOIN "Builder" b ON o."builderId" = b."id"
      LEFT JOIN "Staff" s ON mw."salesRepId" = s."id"
      WHERE 1=1
    `
    const params: any[] = []
    let idx = 1

    if (orderId) {
      query += ` AND mw."orderId" = $${idx}`
      params.push(orderId)
      idx++
    }
    if (status) {
      query += ` AND mw."status" = $${idx}`
      params.push(status)
      idx++
    }
    if (productId) {
      query += ` AND mw."productId" = $${idx}`
      params.push(productId)
      idx++
    }
    if (salesRepId) {
      query += ` AND mw."salesRepId" = $${idx}`
      params.push(salesRepId)
      idx++
    }

    query += ` ORDER BY mw."createdAt" DESC LIMIT 200`

    const watches: any[] = await prisma.$queryRawUnsafe(query, ...params)

    // Summary stats
    const summary: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        COUNT(*)::int AS "total",
        COUNT(*) FILTER (WHERE "status" = 'AWAITING')::int AS "awaiting",
        COUNT(*) FILTER (WHERE "status" = 'PARTIAL')::int AS "partial",
        COUNT(*) FILTER (WHERE "status" = 'ARRIVED')::int AS "arrived",
        COUNT(*) FILTER (WHERE "status" = 'CANCELLED')::int AS "cancelled"
      FROM "MaterialWatch"
    `)

    return safeJson({
      watches,
      count: watches.length,
      summary: summary[0] || {},
    })
  } catch (error: any) {
    return safeJson({ error: error.message }, { status: 500 })
  }
}

/**
 * POST /api/ops/material-watch
 * Create a watch for missing material on an order.
 *
 * Body: {
 *   orderId, productId, sku, productName, qtyNeeded,
 *   orderItemId?, jobId?, salesRepId?, purchaseOrderId?, notes?
 * }
 *
 * Side effects:
 *   - Sets order status to AWAITING_MATERIAL
 *   - Creates notification for sales rep
 */
export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    await ensureTable()

    const body = await request.json()
    const {
      orderId, productId, sku, productName, qtyNeeded,
      orderItemId, jobId, salesRepId, purchaseOrderId, notes
    } = body

    if (!orderId || !productId || !sku || !productName || !qtyNeeded) {
      return NextResponse.json(
        { error: 'orderId, productId, sku, productName, and qtyNeeded are required' },
        { status: 400 }
      )
    }

    const staffId = request.headers.get('x-staff-id') || 'system'
    const id = crypto.randomUUID()
    const now = new Date().toISOString()

    // Check current inventory availability
    let qtyAvailable = 0
    try {
      const inv: any[] = await prisma.$queryRawUnsafe(
        `SELECT "available" FROM "InventoryItem" WHERE "productId" = $1 LIMIT 1`,
        productId
      )
      qtyAvailable = inv[0]?.available || 0
    } catch {
      // InventoryItem may not have data yet
    }

    const watchStatus = qtyAvailable >= qtyNeeded ? 'ARRIVED' : (qtyAvailable > 0 ? 'PARTIAL' : 'AWAITING')

    await prisma.$executeRawUnsafe(`
      INSERT INTO "MaterialWatch" (
        "id", "orderId", "orderItemId", "productId", "jobId",
        "sku", "productName", "qtyNeeded", "qtyAvailable",
        "status", "salesRepId", "createdById", "purchaseOrderId", "notes",
        "arrivedAt", "createdAt", "updatedAt"
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16::timestamptz, $16::timestamptz)
    `,
      id, orderId, orderItemId || null, productId, jobId || null,
      sku, productName, qtyNeeded, qtyAvailable,
      watchStatus, salesRepId || null, staffId, purchaseOrderId || null, notes || null,
      watchStatus === 'ARRIVED' ? now : null,
      now
    )

    // Update order status to AWAITING_MATERIAL if not already shipped
    if (watchStatus !== 'ARRIVED') {
      await prisma.$executeRawUnsafe(`
        UPDATE "Order"
        SET "status" = 'AWAITING_MATERIAL', "updatedAt" = NOW()
        WHERE "id" = $1
          AND "status"::text IN ('RECEIVED', 'CONFIRMED', 'IN_PRODUCTION')
      `, orderId).catch(() => {})

      // Notify sales rep if assigned
      if (salesRepId) {
        await prisma.$executeRawUnsafe(`
          INSERT INTO "Notification" ("id", "staffId", "type", "title", "body", "link", "createdAt")
          VALUES ($1, $2, 'MATERIAL_ARRIVAL'::text, $3, $4, $5, $6::timestamptz)
        `,
          crypto.randomUUID(),
          salesRepId,
          `Material watch created: ${productName}`,
          `Order is awaiting ${qtyNeeded} units of ${sku} (${productName}). Current stock: ${qtyAvailable}.`,
          `/ops/orders/${orderId}`,
          now
        ).catch(() => {
          // MATERIAL_ARRIVAL may not be in NotificationType enum yet — use SYSTEM fallback
          prisma.$executeRawUnsafe(`
            INSERT INTO "Notification" ("id", "staffId", "type", "title", "body", "link", "createdAt")
            VALUES ($1, $2, 'SYSTEM'::text, $3, $4, $5, $6::timestamptz)
          `,
            crypto.randomUUID(), salesRepId,
            `Material watch created: ${productName}`,
            `Order is awaiting ${qtyNeeded} units of ${sku} (${productName}). Current stock: ${qtyAvailable}.`,
            `/ops/orders/${orderId}`, now
          ).catch(() => {})
        })
      }
    }

    await audit(request, 'CREATE', 'MaterialWatch', id, {
      orderId, productId, sku, qtyNeeded, qtyAvailable, watchStatus,
    })

    return safeJson({
      success: true,
      watch: {
        id, orderId, productId, sku, productName,
        qtyNeeded, qtyAvailable, status: watchStatus,
      },
    }, { status: 201 })
  } catch (error: any) {
    return safeJson({ error: error.message }, { status: 500 })
  }
}

/**
 * PATCH /api/ops/material-watch
 * Update a watch — typically called when material is received.
 *
 * Body: { watchId, qtyAvailable?, status?, notes? }
 *
 * When status → ARRIVED:
 *   - Notify sales rep + ops
 *   - Check if all watches for the order are fulfilled
 *   - If yes, auto-update order → READY_TO_SHIP
 */
export async function PATCH(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    await ensureTable()

    const body = await request.json()
    const { watchId, qtyAvailable, status, notes } = body

    if (!watchId) {
      return NextResponse.json({ error: 'watchId required' }, { status: 400 })
    }

    // Get current watch
    const watches: any[] = await prisma.$queryRawUnsafe(
      `SELECT * FROM "MaterialWatch" WHERE "id" = $1`,
      watchId
    )
    if (watches.length === 0) {
      return NextResponse.json({ error: 'Watch not found' }, { status: 404 })
    }
    const watch = watches[0]

    const newQty = qtyAvailable ?? watch.qtyAvailable
    let newStatus = status || watch.status

    // Auto-determine status based on quantity
    if (!status && qtyAvailable != null) {
      if (newQty >= watch.qtyNeeded) {
        newStatus = 'ARRIVED'
      } else if (newQty > 0) {
        newStatus = 'PARTIAL'
      }
    }

    const now = new Date().toISOString()

    await prisma.$executeRawUnsafe(`
      UPDATE "MaterialWatch"
      SET "qtyAvailable" = $2, "status" = $3,
          "arrivedAt" = CASE WHEN $3 = 'ARRIVED' AND "arrivedAt" IS NULL THEN $4::timestamptz ELSE "arrivedAt" END,
          "notes" = COALESCE($5, "notes"),
          "updatedAt" = $4::timestamptz
      WHERE "id" = $1
    `, watchId, newQty, newStatus, now, notes || null)

    // If material arrived, send notifications
    if (newStatus === 'ARRIVED' && watch.status !== 'ARRIVED') {
      // Notify sales rep
      if (watch.salesRepId) {
        await prisma.$executeRawUnsafe(`
          INSERT INTO "Notification" ("id", "staffId", "type", "title", "body", "link", "createdAt")
          VALUES ($1, $2, 'SYSTEM'::text, $3, $4, $5, $6::timestamptz)
        `,
          crypto.randomUUID(),
          watch.salesRepId,
          `Material arrived: ${watch.productName}`,
          `${watch.qtyNeeded} units of ${watch.sku} are now in stock for order. Ready to ship!`,
          `/ops/orders/${watch.orderId}`,
          now
        ).catch(() => {})

        await prisma.$executeRawUnsafe(
          `UPDATE "MaterialWatch" SET "notifiedSalesRep" = true WHERE "id" = $1`,
          watchId
        ).catch(() => {})
      }

      // Check if ALL watches for this order are now fulfilled
      const remaining: any[] = await prisma.$queryRawUnsafe(`
        SELECT COUNT(*)::int AS "pending"
        FROM "MaterialWatch"
        WHERE "orderId" = $1 AND "status" IN ('AWAITING', 'PARTIAL')
      `, watch.orderId)

      if ((remaining[0]?.pending || 0) === 0) {
        // All material arrived — move order to READY_TO_SHIP
        await prisma.$executeRawUnsafe(`
          UPDATE "Order"
          SET "status" = 'READY_TO_SHIP', "updatedAt" = NOW()
          WHERE "id" = $1 AND "status"::text = 'AWAITING_MATERIAL'
        `, watch.orderId)

        // Notify ops team (look up warehouse/ops staff)
        const opsStaff: any[] = await prisma.$queryRawUnsafe(`
          SELECT "id" FROM "Staff"
          WHERE "department" IN ('OPERATIONS', 'WAREHOUSE')
            AND "active" = true
          LIMIT 5
        `)

        for (const s of opsStaff) {
          await prisma.$executeRawUnsafe(`
            INSERT INTO "Notification" ("id", "staffId", "type", "title", "body", "link", "createdAt")
            VALUES ($1, $2, 'SYSTEM'::text, $3, $4, $5, $6::timestamptz)
          `,
            crypto.randomUUID(), s.id,
            'Order ready to ship — all material arrived',
            `All watched materials for the order have arrived. Order moved to READY_TO_SHIP.`,
            `/ops/orders/${watch.orderId}`,
            now
          ).catch(() => {})
        }
      }
    }

    await audit(request, 'UPDATE', 'MaterialWatch', watchId, {
      previousStatus: watch.status, newStatus, qtyAvailable: newQty,
    })

    return safeJson({
      success: true,
      watchId,
      previousStatus: watch.status,
      newStatus,
      qtyAvailable: newQty,
      allMaterialReady: newStatus === 'ARRIVED',
    })
  } catch (error: any) {
    return safeJson({ error: error.message }, { status: 500 })
  }
}
