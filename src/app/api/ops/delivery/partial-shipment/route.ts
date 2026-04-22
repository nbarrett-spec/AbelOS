export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'
import { safeJson } from '@/lib/safe-json'
import { audit } from '@/lib/audit'

// ──────────────────────────────────────────────────────────────────────────
// Partial Shipment & Backorder Tracking API
//
// When an order ships with missing items, operators can:
//   1. Mark specific line items as backordered (POST)
//   2. View backorder status for an order/delivery (GET)
//   3. Mark material as arrived → auto-schedule follow-up delivery (PATCH)
//
// Flow:
//   Order ships partial → BackorderItem created per missing line →
//   Material Watch auto-created → Cron detects arrival →
//   BackorderItem updated → Follow-up delivery auto-scheduled →
//   Builder notified via portal
// ──────────────────────────────────────────────────────────────────────────

let tableEnsured = false
async function ensureTable() {
  if (tableEnsured) return
  try {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "BackorderItem" (
        "id" TEXT PRIMARY KEY,
        "orderId" TEXT NOT NULL,
        "orderItemId" TEXT,
        "deliveryId" TEXT,
        "productId" TEXT NOT NULL,
        "sku" TEXT NOT NULL,
        "productName" TEXT NOT NULL,
        "qtyOrdered" INT NOT NULL,
        "qtyShipped" INT NOT NULL DEFAULT 0,
        "qtyBackordered" INT NOT NULL DEFAULT 0,
        "status" TEXT NOT NULL DEFAULT 'BACKORDERED',
        "followUpDeliveryId" TEXT,
        "scheduledDeliveryDate" TIMESTAMPTZ,
        "materialArrivedAt" TIMESTAMPTZ,
        "purchaseOrderId" TEXT,
        "builderNotified" BOOLEAN NOT NULL DEFAULT FALSE,
        "builderNotifiedAt" TIMESTAMPTZ,
        "notes" TEXT,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `)
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "BackorderItem_orderId_idx" ON "BackorderItem" ("orderId")`)
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "BackorderItem_deliveryId_idx" ON "BackorderItem" ("deliveryId")`)
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "BackorderItem_status_idx" ON "BackorderItem" ("status")`)
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "BackorderItem_productId_idx" ON "BackorderItem" ("productId")`)
    tableEnsured = true
  } catch {
    tableEnsured = true
  }
}

/**
 * GET /api/ops/delivery/partial-shipment
 * List backorder items. Filters: ?orderId=, ?deliveryId=, ?status=
 */
export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    await ensureTable()

    const { searchParams } = new URL(request.url)
    const orderId = searchParams.get('orderId')
    const deliveryId = searchParams.get('deliveryId')
    const status = searchParams.get('status')
    const activeOnly = searchParams.get('active') === 'true'

    let query = `
      SELECT bi.*,
             o."orderNumber",
             b."companyName" AS "builderName",
             d."deliveryNumber" AS "originalDeliveryNumber",
             fd."deliveryNumber" AS "followUpDeliveryNumber"
      FROM "BackorderItem" bi
      LEFT JOIN "Order" o ON bi."orderId" = o."id"
      LEFT JOIN "Builder" b ON o."builderId" = b."id"
      LEFT JOIN "Delivery" d ON bi."deliveryId" = d."id"
      LEFT JOIN "Delivery" fd ON bi."followUpDeliveryId" = fd."id"
      WHERE 1=1
    `
    const params: any[] = []
    let idx = 1

    if (orderId) {
      query += ` AND bi."orderId" = $${idx}`
      params.push(orderId)
      idx++
    }
    if (deliveryId) {
      query += ` AND bi."deliveryId" = $${idx}`
      params.push(deliveryId)
      idx++
    }
    if (status) {
      query += ` AND bi."status" = $${idx}`
      params.push(status)
      idx++
    }
    if (activeOnly) {
      query += ` AND bi."status" IN ('BACKORDERED', 'MATERIAL_ARRIVED', 'SCHEDULED')`
    }

    query += ` ORDER BY bi."createdAt" DESC LIMIT 200`

    const items: any[] = await prisma.$queryRawUnsafe(query, ...params)

    // Summary
    const summary: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        COUNT(*)::int AS "total",
        COUNT(*) FILTER (WHERE "status" = 'BACKORDERED')::int AS "awaiting",
        COUNT(*) FILTER (WHERE "status" = 'MATERIAL_ARRIVED')::int AS "materialReady",
        COUNT(*) FILTER (WHERE "status" = 'SCHEDULED')::int AS "scheduled",
        COUNT(*) FILTER (WHERE "status" = 'DELIVERED')::int AS "delivered",
        COUNT(DISTINCT "orderId")::int AS "affectedOrders"
      FROM "BackorderItem"
      WHERE "status" NOT IN ('CANCELLED')
    `)

    return safeJson({
      backorders: items,
      count: items.length,
      summary: summary[0] || {},
    })
  } catch (error: any) {
    return safeJson({ error: 'Internal server error'}, { status: 500 })
  }
}

/**
 * POST /api/ops/delivery/partial-shipment
 * Mark items as backordered when shipping a partial order.
 *
 * Body: {
 *   orderId: string,
 *   deliveryId: string,
 *   items: Array<{
 *     productId, sku, productName, qtyOrdered, qtyShipped,
 *     orderItemId?, purchaseOrderId?, notes?
 *   }>
 * }
 *
 * Side effects:
 *   - Creates BackorderItem per missing line
 *   - Creates MaterialWatch per missing product (auto-notification)
 *   - Updates delivery status → PARTIAL_DELIVERY
 *   - Updates order status → PARTIAL_SHIPPED
 */
export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    await ensureTable()

    // Ensure MaterialWatch table exists too
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "MaterialWatch" (
        "id" TEXT PRIMARY KEY, "orderId" TEXT NOT NULL, "orderItemId" TEXT,
        "productId" TEXT NOT NULL, "jobId" TEXT, "sku" TEXT NOT NULL,
        "productName" TEXT NOT NULL, "qtyNeeded" INT NOT NULL,
        "qtyAvailable" INT NOT NULL DEFAULT 0, "status" TEXT NOT NULL DEFAULT 'AWAITING',
        "notifiedSalesRep" BOOLEAN NOT NULL DEFAULT FALSE,
        "notifiedOps" BOOLEAN NOT NULL DEFAULT FALSE,
        "arrivedAt" TIMESTAMPTZ, "salesRepId" TEXT, "createdById" TEXT,
        "purchaseOrderId" TEXT, "notes" TEXT,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `).catch(() => {})

    const body = await request.json()
    const { orderId, deliveryId, items } = body

    if (!orderId || !deliveryId || !items || !Array.isArray(items) || items.length === 0) {
      return NextResponse.json(
        { error: 'orderId, deliveryId, and items array required' },
        { status: 400 }
      )
    }

    const staffId = request.headers.get('x-staff-id') || 'system'
    const now = new Date().toISOString()
    const created: any[] = []

    // Look up the order's sales rep for notifications
    let salesRepId: string | null = null
    try {
      const orderInfo: any[] = await prisma.$queryRawUnsafe(`
        SELECT j."assignedPMId"
        FROM "Order" o
        LEFT JOIN "Job" j ON o."id" = j."orderId"
        WHERE o."id" = $1
        LIMIT 1
      `, orderId)
      salesRepId = orderInfo[0]?.assignedPMId || null
    } catch { /* no-op */ }

    // Get jobId from delivery
    let jobId: string | null = null
    try {
      const delInfo: any[] = await prisma.$queryRawUnsafe(
        `SELECT "jobId" FROM "Delivery" WHERE "id" = $1 LIMIT 1`,
        deliveryId
      )
      jobId = delInfo[0]?.jobId || null
    } catch { /* no-op */ }

    for (const item of items) {
      const { productId, sku, productName, qtyOrdered, qtyShipped, orderItemId, purchaseOrderId, notes } = item
      const qtyBackordered = qtyOrdered - (qtyShipped || 0)

      if (qtyBackordered <= 0) continue

      const backorderId = crypto.randomUUID()

      // Create BackorderItem
      await prisma.$executeRawUnsafe(`
        INSERT INTO "BackorderItem" (
          "id", "orderId", "orderItemId", "deliveryId", "productId",
          "sku", "productName", "qtyOrdered", "qtyShipped", "qtyBackordered",
          "status", "purchaseOrderId", "notes", "createdAt", "updatedAt"
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'BACKORDERED', $11, $12, $13::timestamptz, $13::timestamptz)
      `,
        backorderId, orderId, orderItemId || null, deliveryId, productId,
        sku, productName, qtyOrdered, qtyShipped || 0, qtyBackordered,
        purchaseOrderId || null, notes || null, now
      )

      // Auto-create MaterialWatch
      const watchId = crypto.randomUUID()
      await prisma.$executeRawUnsafe(`
        INSERT INTO "MaterialWatch" (
          "id", "orderId", "orderItemId", "productId", "jobId",
          "sku", "productName", "qtyNeeded", "qtyAvailable",
          "status", "salesRepId", "createdById", "purchaseOrderId",
          "notes", "createdAt", "updatedAt"
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 0, 'AWAITING', $9, $10, $11, $12, $13::timestamptz, $13::timestamptz)
      `,
        watchId, orderId, orderItemId || null, productId, jobId,
        sku, productName, qtyBackordered,
        salesRepId, staffId, purchaseOrderId || null,
        `Auto-created from partial shipment. Backorder ID: ${backorderId}`,
        now
      ).catch(() => {})

      created.push({
        backorderId,
        materialWatchId: watchId,
        productId, sku, productName,
        qtyOrdered, qtyShipped: qtyShipped || 0, qtyBackordered,
      })
    }

    // Mark delivery as PARTIAL_DELIVERY
    await prisma.$executeRawUnsafe(`
      UPDATE "Delivery"
      SET "status" = 'PARTIAL_DELIVERY', "updatedAt" = NOW()
      WHERE "id" = $1
    `, deliveryId).catch(() => {})

    // Mark order as PARTIAL_SHIPPED
    await prisma.$executeRawUnsafe(`
      UPDATE "Order"
      SET "status" = 'PARTIAL_SHIPPED', "updatedAt" = NOW()
      WHERE "id" = $1
        AND "status"::text NOT IN ('DELIVERED', 'COMPLETE', 'CANCELLED')
    `, orderId).catch(() => {})

    await audit(request, 'CREATE', 'PartialShipment', deliveryId, {
      orderId, itemCount: created.length,
      totalBackordered: created.reduce((sum, c) => sum + c.qtyBackordered, 0),
    })

    return safeJson({
      success: true,
      deliveryId,
      orderId,
      backorders: created,
      totalItems: created.length,
      message: `${created.length} item(s) marked as backordered. Material watches created.`,
    }, { status: 201 })
  } catch (error: any) {
    return safeJson({ error: 'Internal server error'}, { status: 500 })
  }
}

/**
 * PATCH /api/ops/delivery/partial-shipment
 * Update a backorder — material arrived, schedule follow-up, mark delivered.
 *
 * Body: {
 *   backorderId: string,
 *   status?: 'MATERIAL_ARRIVED' | 'SCHEDULED' | 'DELIVERED' | 'CANCELLED',
 *   scheduledDeliveryDate?: string,
 *   followUpDeliveryId?: string,
 *   notes?: string,
 * }
 *
 * When status → MATERIAL_ARRIVED and no followUpDeliveryId:
 *   Auto-creates a new Delivery for the backordered items
 */
export async function PATCH(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    await ensureTable()

    const body = await request.json()
    const { backorderId, status, scheduledDeliveryDate, followUpDeliveryId, notes } = body

    if (!backorderId) {
      return NextResponse.json({ error: 'backorderId required' }, { status: 400 })
    }

    const items: any[] = await prisma.$queryRawUnsafe(
      `SELECT * FROM "BackorderItem" WHERE "id" = $1 LIMIT 1`,
      backorderId
    )
    if (items.length === 0) {
      return NextResponse.json({ error: 'Backorder not found' }, { status: 404 })
    }

    const item = items[0]
    const now = new Date().toISOString()
    let newFollowUpDeliveryId = followUpDeliveryId || item.followUpDeliveryId

    // Auto-create follow-up delivery when material arrives
    if (status === 'MATERIAL_ARRIVED' && !newFollowUpDeliveryId && item.deliveryId) {
      try {
        // Get original delivery info for address
        const origDel: any[] = await prisma.$queryRawUnsafe(
          `SELECT "jobId", "address", "crewId" FROM "Delivery" WHERE "id" = $1 LIMIT 1`,
          item.deliveryId
        )

        if (origDel.length > 0) {
          // Generate delivery number
          const countResult: any[] = await prisma.$queryRawUnsafe(
            `SELECT COUNT(*)::int AS "c" FROM "Delivery"`
          )
          const nextNum = (countResult[0]?.c || 0) + 1
          const deliveryNumber = `DEL-${new Date().getFullYear()}-${String(nextNum).padStart(4, '0')}`

          newFollowUpDeliveryId = crypto.randomUUID()

          await prisma.$executeRawUnsafe(`
            INSERT INTO "Delivery" (
              "id", "jobId", "crewId", "deliveryNumber", "address",
              "status", "notes", "createdAt", "updatedAt"
            ) VALUES ($1, $2, $3, $4, $5, 'SCHEDULED'::text, $6, $7::timestamptz, $7::timestamptz)
          `,
            newFollowUpDeliveryId,
            origDel[0].jobId,
            origDel[0].crewId,
            deliveryNumber,
            origDel[0].address,
            `Follow-up delivery for backordered items: ${item.sku} x${item.qtyBackordered}`,
            now
          )
        }
      } catch {
        // Delivery creation failed — operator can create manually
      }
    }

    // Update the backorder item
    await prisma.$executeRawUnsafe(`
      UPDATE "BackorderItem"
      SET "status" = COALESCE($2, "status"),
          "materialArrivedAt" = CASE WHEN $2 = 'MATERIAL_ARRIVED' AND "materialArrivedAt" IS NULL THEN $3::timestamptz ELSE "materialArrivedAt" END,
          "scheduledDeliveryDate" = COALESCE($4::timestamptz, "scheduledDeliveryDate"),
          "followUpDeliveryId" = COALESCE($5, "followUpDeliveryId"),
          "notes" = COALESCE($6, "notes"),
          "updatedAt" = $3::timestamptz
      WHERE "id" = $1
    `,
      backorderId,
      status || null,
      now,
      scheduledDeliveryDate || null,
      newFollowUpDeliveryId || null,
      notes || null
    )

    // If delivered, notify builder
    if (status === 'DELIVERED') {
      await prisma.$executeRawUnsafe(`
        UPDATE "BackorderItem"
        SET "builderNotified" = true, "builderNotifiedAt" = $2::timestamptz
        WHERE "id" = $1
      `, backorderId, now).catch(() => {})

      // Check if all backorders for this order are delivered
      const remaining: any[] = await prisma.$queryRawUnsafe(`
        SELECT COUNT(*)::int AS "pending"
        FROM "BackorderItem"
        WHERE "orderId" = $1 AND "status" IN ('BACKORDERED', 'MATERIAL_ARRIVED', 'SCHEDULED')
      `, item.orderId)

      if ((remaining[0]?.pending || 0) === 0) {
        // All backorders fulfilled — move order to DELIVERED/COMPLETE
        await prisma.$executeRawUnsafe(`
          UPDATE "Order"
          SET "status" = 'DELIVERED', "updatedAt" = NOW()
          WHERE "id" = $1 AND "status"::text = 'PARTIAL_SHIPPED'
        `, item.orderId).catch(() => {})
      }
    }

    await audit(request, 'UPDATE', 'BackorderItem', backorderId, {
      previousStatus: item.status, newStatus: status, followUpDeliveryId: newFollowUpDeliveryId,
    })

    return safeJson({
      success: true,
      backorderId,
      previousStatus: item.status,
      newStatus: status || item.status,
      followUpDeliveryId: newFollowUpDeliveryId,
    })
  } catch (error: any) {
    return safeJson({ error: 'Internal server error'}, { status: 500 })
  }
}
