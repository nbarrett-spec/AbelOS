import { prisma } from '@/lib/prisma'

/**
 * reserveForOrder — write order-level rows on the InventoryAllocation ledger
 * the moment an Order is created (at OrderItem grain, not BoM-leaf grain).
 *
 * The bug this closes (A-BIZ-3): until now, two simultaneous orders could each
 * see `InventoryItem.available = 10`, both claim 8 units, and both succeed —
 * because nothing wrote to the ledger until much later, when `allocateForJob`
 * fired during the CONFIRMED cascade. This function fixes that by writing
 * RESERVED rows tied to the orderId at POST time, BEFORE the order returns to
 * the caller. Concurrent orders serialize on the per-product `SELECT FOR
 * UPDATE` and one of them ends up BACKORDERED instead of double-claiming.
 *
 * Idempotent: calling twice for the same (orderId, productId) is a no-op via
 * the WHERE NOT EXISTS guard. We intentionally do NOT collide with the
 * `idx_alloc_active_job_product` partial unique index — that index covers
 * `(jobId, productId)` and order-level rows have `jobId = NULL`, so they sit
 * outside it.
 *
 * Handoff to allocateForJob: when a Job is later created from this Order and
 * `allocateForJob` runs, it should migrate these orderId-linked rows to
 * jobId-linked instead of inserting new ones. See `migrateOrderAllocationsToJob`
 * in this same module.
 *
 * MUST run inside the same prisma.$transaction as the Order/OrderItem inserts
 * so that an order-creation rollback also rolls back the reservation.
 */
export interface ReserveResult {
  orderId: string
  reserved: Array<{ productId: string; quantity: number; allocationId: string }>
  backordered: Array<{
    productId: string
    quantity: number
    allocationId: string
    /** OrderItems that absorbed the shortfall, with the per-line backorder split. */
    orderItems: Array<{ orderItemId: string; backorderedQty: number; fulfillingPoId: string | null; expectedDate: Date | null }>
  }>
  shortfall: Array<{ productId: string; shortBy: number }>
  touchedProductIds: string[]
}

/**
 * Optional `id` on each item. When supplied, reserveForOrder will stamp
 * the OrderItem row with backorderedQty / backorderedAt / fulfillingPoId /
 * expectedDate so the line carries its own backorder state (A-BIZ-6) — no
 * need for callers to read InventoryAllocation just to render a backorder
 * badge or ETA. When `id` is omitted (legacy callers) the function still
 * works, just without the per-line stamping.
 */
export async function reserveForOrder(
  tx: any,
  orderId: string,
  items: Array<{ id?: string; productId: string | null; quantity: number }>,
): Promise<ReserveResult> {
  const result: ReserveResult = {
    orderId,
    reserved: [],
    backordered: [],
    shortfall: [],
    touchedProductIds: [],
  }

  // Aggregate by productId — multiple OrderItems for the same product collapse
  // into one ledger row. We keep the per-OrderItem split (productLines) so we
  // can spread a productId's shortage back across the contributing rows when
  // we stamp backorderedQty.
  const demand = new Map<string, number>()
  const productLines = new Map<string, Array<{ id?: string; quantity: number }>>()
  for (const it of items) {
    if (!it.productId) continue
    const q = Number(it.quantity || 0)
    if (q <= 0) continue
    demand.set(it.productId, (demand.get(it.productId) || 0) + q)
    const arr = productLines.get(it.productId) || []
    arr.push({ id: it.id, quantity: q })
    productLines.set(it.productId, arr)
  }
  if (demand.size === 0) return result

  const touched = new Set<string>()

  for (const [productId, need] of demand.entries()) {
    // Idempotency — skip if there's already an active order-level allocation
    // for this (orderId, productId). Lets retried POSTs replay safely.
    const existing: any[] = await tx.$queryRawUnsafe(
      `SELECT "id" FROM "InventoryAllocation"
       WHERE "orderId" = $1 AND "productId" = $2 AND "jobId" IS NULL
         AND "status" IN ('RESERVED', 'BACKORDERED', 'PICKED')
       LIMIT 1`,
      orderId, productId,
    )
    if (existing.length > 0) continue

    // Lock the InventoryItem row for the product so concurrent reservations
    // serialize on it. If no InventoryItem row exists, treat as zero
    // available (everything goes BACKORDERED).
    const invRows: any[] = await tx.$queryRawUnsafe(
      `SELECT "productId",
              COALESCE("onHand", 0)::int AS on_hand,
              COALESCE("available", 0)::int AS available
       FROM "InventoryItem"
       WHERE "productId" = $1
       FOR UPDATE`,
      productId,
    )
    const available = invRows[0] ? Number(invRows[0].available) : 0
    const canReserve = Math.min(need, Math.max(0, available))
    const short = Math.max(0, need - canReserve)

    if (canReserve > 0) {
      const rowId = `ia_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
      const ins: any[] = await tx.$queryRawUnsafe(
        `INSERT INTO "InventoryAllocation"
           ("id", "productId", "orderId", "jobId", "quantity",
            "allocationType", "status", "allocatedBy",
            "allocatedAt", "createdAt", "updatedAt")
         VALUES ($1, $2, $3, NULL, $4,
                 'SALES_ORDER', 'RESERVED', 'system-order-create',
                 NOW(), NOW(), NOW())
         RETURNING "id"`,
        rowId, productId, orderId, canReserve,
      )
      if (ins.length > 0) {
        touched.add(productId)
        result.reserved.push({ productId, quantity: canReserve, allocationId: ins[0].id })
      }
    }

    if (short > 0) {
      result.shortfall.push({ productId, shortBy: short })
      const rowId = `ia_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
      const ins: any[] = await tx.$queryRawUnsafe(
        `INSERT INTO "InventoryAllocation"
           ("id", "productId", "orderId", "jobId", "quantity",
            "allocationType", "status", "allocatedBy",
            "notes",
            "allocatedAt", "createdAt", "updatedAt")
         VALUES ($1, $2, $3, NULL, $4,
                 'SALES_ORDER', 'BACKORDERED', 'system-order-create',
                 'short by ' || $4 || ' at order create',
                 NOW(), NOW(), NOW())
         RETURNING "id"`,
        rowId, productId, orderId, short,
      )
      if (ins.length > 0) {
        touched.add(productId)

        // ── A-BIZ-6: stamp the OrderItem(s) with backorder state ──
        // Find the next incoming PO that can fulfill this product so the
        // line carries an ETA. Statuses APPROVED → SENT_TO_VENDOR →
        // PARTIALLY_RECEIVED are all "in flight" — still expected to land.
        // We pick the soonest non-null expectedDate; ties broken by PO
        // createdAt for stability. NULL expectedDate (vendor hasn't ack'd)
        // ranks last so a confirmed PO always wins over a pending one.
        let fulfillingPoId: string | null = null
        let expectedDate: Date | null = null
        try {
          const poRows: any[] = await tx.$queryRawUnsafe(
            `SELECT po."id", po."expectedDate"
               FROM "PurchaseOrderItem" poi
               JOIN "PurchaseOrder" po ON po."id" = poi."purchaseOrderId"
              WHERE poi."productId" = $1
                AND po."status"::text IN ('APPROVED', 'SENT_TO_VENDOR', 'PARTIALLY_RECEIVED')
                AND COALESCE(poi."quantity", 0) - COALESCE(poi."receivedQty", 0) > 0
              ORDER BY (po."expectedDate" IS NULL) ASC, po."expectedDate" ASC, po."createdAt" ASC
              LIMIT 1`,
            productId,
          )
          if (poRows.length > 0) {
            fulfillingPoId = poRows[0].id || null
            expectedDate = poRows[0].expectedDate ? new Date(poRows[0].expectedDate) : null
          }
        } catch {
          // PO lookup is best-effort; backorder still gets created without ETA
        }

        // Spread `short` units across the contributing OrderItem rows.
        // Multiple OrderItems for the same productId on one order are rare
        // but possible (separate locations, separate notes). We assign
        // stamped backorder qty in input order until `short` is exhausted.
        const lineSplits: Array<{ orderItemId: string; backorderedQty: number; fulfillingPoId: string | null; expectedDate: Date | null }> = []
        let remaining = short
        const lines = productLines.get(productId) || []
        for (const line of lines) {
          if (remaining <= 0) break
          if (!line.id) continue
          const take = Math.min(remaining, line.quantity)
          if (take <= 0) continue
          try {
            await tx.$executeRawUnsafe(
              `UPDATE "OrderItem"
                  SET "backorderedQty" = $2,
                      "backorderedAt"  = NOW(),
                      "fulfillingPoId" = $3,
                      "expectedDate"   = $4
                WHERE "id" = $1`,
              line.id, take, fulfillingPoId, expectedDate,
            )
            lineSplits.push({
              orderItemId: line.id,
              backorderedQty: take,
              fulfillingPoId,
              expectedDate,
            })
          } catch {
            // OrderItem stamping is best-effort — schema cols may not exist
            // in a dev branch that hasn't run the migration yet. Allocation
            // ledger row above is the source of truth either way.
          }
          remaining -= take
        }

        result.backordered.push({
          productId,
          quantity: short,
          allocationId: ins[0].id,
          orderItems: lineSplits,
        })
      }
    }
  }

  // Roll the new ledger rows into InventoryItem.committed / .available so
  // downstream readers see the new reservation immediately. Inside the same
  // transaction so failure rolls everything back atomically.
  for (const pid of touched) {
    try {
      await tx.$executeRawUnsafe(`SELECT recompute_inventory_committed($1)`, pid)
    } catch {
      // SQL function might not exist in dev — fall back to inline recompute.
      await tx.$executeRawUnsafe(
        `UPDATE "InventoryItem" ii
           SET "committed" = COALESCE((
                 SELECT SUM(ia."quantity")
                 FROM "InventoryAllocation" ia
                 WHERE ia."productId" = ii."productId"
                   AND ia."status" IN ('RESERVED', 'PICKED')
               ), 0),
               "available" = GREATEST(COALESCE(ii."onHand", 0) - COALESCE((
                 SELECT SUM(ia."quantity")
                 FROM "InventoryAllocation" ia
                 WHERE ia."productId" = ii."productId"
                   AND ia."status" IN ('RESERVED', 'PICKED')
               ), 0), 0),
               "updatedAt" = NOW()
           WHERE ii."productId" = $1`,
        pid,
      )
    }
  }

  result.touchedProductIds = Array.from(touched)
  return result
}

/**
 * releaseForOrder — release every active order-level allocation for an Order.
 *
 * Called when an Order moves to CANCELLED. Pairs with reserveForOrder.
 * Idempotent. Recomputes committed/available for every touched product.
 *
 * Does NOT touch jobId-linked rows — those are the responsibility of
 * `releaseForJob` via the Job lifecycle. If both order-level and job-level
 * rows exist (transient state during migration), this only releases the
 * order-level ones; the job-level cascade handles its own.
 */
export interface ReleaseOrderResult {
  orderId: string
  released: number
  productIds: string[]
}

export async function releaseForOrder(
  orderId: string,
  reason: string = 'order_cancelled',
): Promise<ReleaseOrderResult> {
  if (!orderId) return { orderId, released: 0, productIds: [] }

  const released: any[] = await prisma.$queryRawUnsafe(
    `UPDATE "InventoryAllocation"
       SET "status" = 'RELEASED',
           "releasedAt" = NOW(),
           "notes" = COALESCE("notes", '') || ' | released: ' || $2,
           "updatedAt" = NOW()
     WHERE "orderId" = $1
       AND "jobId" IS NULL
       AND "status" IN ('RESERVED', 'PICKED', 'BACKORDERED')
     RETURNING "id", "productId"`,
    orderId, reason,
  )
  const productIds = Array.from(new Set(released.map((r: any) => r.productId)))

  for (const pid of productIds) {
    try {
      await prisma.$executeRawUnsafe(`SELECT recompute_inventory_committed($1)`, pid)
    } catch {
      await prisma.$executeRawUnsafe(
        `UPDATE "InventoryItem" ii
           SET "committed" = COALESCE((
                 SELECT SUM(ia."quantity")
                 FROM "InventoryAllocation" ia
                 WHERE ia."productId" = ii."productId"
                   AND ia."status" IN ('RESERVED', 'PICKED')
               ), 0),
               "available" = GREATEST(COALESCE(ii."onHand", 0) - COALESCE((
                 SELECT SUM(ia."quantity")
                 FROM "InventoryAllocation" ia
                 WHERE ia."productId" = ii."productId"
                   AND ia."status" IN ('RESERVED', 'PICKED')
               ), 0), 0),
               "updatedAt" = NOW()
           WHERE ii."productId" = $1`,
        pid,
      )
    }
  }

  return { orderId, released: released.length, productIds }
}

/**
 * migrateOrderAllocationsToJob — rebrand order-level allocations as job-level
 * once a Job is created from the Order. Lets `allocateForJob` skip rows that
 * are already covered by the order-level reservation, so we don't double-count
 * the same OrderItem demand on the ledger.
 *
 * Returns the productIds that got migrated so the caller can decide whether
 * additional BoM-leaf demand still needs allocation.
 */
export async function migrateOrderAllocationsToJob(
  orderId: string,
  jobId: string,
): Promise<{ migrated: number; productIds: string[] }> {
  if (!orderId || !jobId) return { migrated: 0, productIds: [] }

  const migrated: any[] = await prisma.$queryRawUnsafe(
    `UPDATE "InventoryAllocation"
       SET "jobId" = $2,
           "allocationType" = 'JOB',
           "updatedAt" = NOW()
     WHERE "orderId" = $1
       AND "jobId" IS NULL
       AND "status" IN ('RESERVED', 'BACKORDERED', 'PICKED')
     RETURNING "id", "productId"`,
    orderId, jobId,
  )
  const productIds = Array.from(new Set(migrated.map((r: any) => r.productId)))
  return { migrated: migrated.length, productIds }
}
