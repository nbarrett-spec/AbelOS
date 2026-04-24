export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireStaffAuth } from '@/lib/api-auth'

const WAREHOUSE_ROLES = [
  'ADMIN',
  'MANAGER',
  'WAREHOUSE_LEAD',
  'WAREHOUSE_TECH',
] as any

/**
 * POST /api/ops/gold-stock/[kitId]/build
 * Body: { count: number, location?: string }
 *
 * Creates `count` GoldStockInstance rows (status ON_HAND) and reserves their
 * components against InventoryItem via the same InventoryAllocation ledger
 * used by allocateForJob.
 *
 * Validates: each component has (available >= quantity * count). If the
 * shortfall check fails, the whole build is rejected — no partial kits.
 */
export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ kitId: string }> }
) {
  const auth = await requireStaffAuth(request, { allowedRoles: WAREHOUSE_ROLES })
  if (auth.error) return auth.error
  const staffId = auth.session.staffId

  const { kitId } = await ctx.params
  if (!kitId) return NextResponse.json({ error: 'Missing kitId' }, { status: 400 })

  const body = await request.json().catch(() => ({}))
  const count = Math.max(1, Math.floor(Number(body.count) || 1))
  const location = typeof body.location === 'string' ? body.location : null

  // Pull kit + components + inventory
  const kitRows: any[] = await prisma.$queryRawUnsafe(
    `SELECT "id", "kitCode" FROM "GoldStockKit" WHERE "id" = $1 LIMIT 1`,
    kitId
  )
  if (kitRows.length === 0) {
    return NextResponse.json({ error: 'Kit not found' }, { status: 404 })
  }
  const comps: Array<{
    productId: string
    quantity: number
    available: number
    sku: string
  }> = await prisma.$queryRawUnsafe(
    `SELECT c."productId", c."quantity"::int AS quantity,
            COALESCE(ii."available", 0)::int AS available,
            p."sku"
       FROM "GoldStockKitComponent" c
       JOIN "Product" p ON p."id" = c."productId"
       LEFT JOIN "InventoryItem" ii ON ii."productId" = c."productId"
       WHERE c."kitId" = $1`,
    kitId
  )

  const shortages = comps
    .filter((c) => c.available < c.quantity * count)
    .map((c) => ({
      sku: c.sku,
      need: c.quantity * count,
      have: c.available,
      short: c.quantity * count - c.available,
    }))

  if (shortages.length > 0) {
    return NextResponse.json(
      {
        error: 'Insufficient components',
        shortages,
      },
      { status: 409 }
    )
  }

  // Write instances + reservation ledger in a transaction.
  const createdIds: string[] = []
  const touched = new Set<string>()

  await prisma.$transaction(async (tx) => {
    for (let n = 0; n < count; n++) {
      const id = `gsi_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}_${n}`
      await tx.$executeRawUnsafe(
        `INSERT INTO "GoldStockInstance"
          ("id", "kitId", "builtAt", "builtById", "status", "location")
         VALUES ($1, $2, NOW(), $3, 'ON_HAND', $4)`,
        id,
        kitId,
        staffId,
        location
      )
      createdIds.push(id)
    }

    // Reserve all components — one InventoryAllocation row per component,
    // GOLD_STOCK type, without a jobId (kit-level reservation).
    for (const c of comps) {
      const rowId = `ia_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
      const total = c.quantity * count
      await tx.$executeRawUnsafe(
        `INSERT INTO "InventoryAllocation"
          ("id", "productId", "quantity", "allocationType", "status",
           "allocatedBy", "notes", "allocatedAt", "createdAt", "updatedAt")
         VALUES ($1, $2, $3, 'GOLD_STOCK', 'RESERVED', $4,
                 $5, NOW(), NOW(), NOW())`,
        rowId,
        c.productId,
        total,
        staffId,
        `gold-stock build ${kitId} x${count}`
      )
      touched.add(c.productId)
    }

    // Bump kit currentQty + lastBuiltAt
    await tx.$executeRawUnsafe(
      `UPDATE "GoldStockKit"
         SET "currentQty" = "currentQty" + $1, "lastBuiltAt" = NOW()
         WHERE "id" = $2`,
      count,
      kitId
    )

    // Resolve the related InboxItem if any
    await tx.$executeRawUnsafe(
      `UPDATE "InboxItem"
         SET "status" = 'COMPLETED', "resolvedAt" = NOW(), "resolvedBy" = $1
         WHERE "entityType" = 'GoldStockKit' AND "entityId" = $2
           AND "status" = 'PENDING' AND "type" = 'GOLD_STOCK_BUILD_READY'`,
      staffId,
      kitId
    )
  })

  // Recompute committed/available for every touched product
  for (const pid of touched) {
    try {
      await prisma.$executeRawUnsafe(`SELECT recompute_inventory_committed($1)`, pid)
    } catch {
      await prisma.$executeRawUnsafe(
        `UPDATE "InventoryItem" ii
           SET "committed" = COALESCE((
                 SELECT SUM(ia."quantity") FROM "InventoryAllocation" ia
                 WHERE ia."productId" = ii."productId"
                   AND ia."status" IN ('RESERVED', 'PICKED')
               ), 0),
               "available" = GREATEST(COALESCE(ii."onHand", 0) - COALESCE((
                 SELECT SUM(ia."quantity") FROM "InventoryAllocation" ia
                 WHERE ia."productId" = ii."productId"
                   AND ia."status" IN ('RESERVED', 'PICKED')
               ), 0), 0),
               "updatedAt" = NOW()
           WHERE ii."productId" = $1`,
        pid
      )
    }
  }

  return NextResponse.json({
    ok: true,
    count,
    instanceIds: createdIds,
    kitId,
  })
}
