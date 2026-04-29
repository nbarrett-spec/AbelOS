/**
 * Auto-allocation system — fires when a Job is linked to an Order.
 *
 * This is the #1 supply chain gap: jobs get created but inventory is never reserved.
 *
 * Flow:
 *  1. Job is linked to an Order (orderId set)
 *  2. auto-allocate function runs:
 *     - BOM-explodes OrderItems into leaf components
 *     - For each leaf component:
 *       - If available >= required: CREATE InventoryAllocation (RESERVED), UPDATE InventoryItem
 *       - If available < required but > 0: allocate what's available (RESERVED), create remainder (BACKORDERED)
 *       - If available = 0: create allocation (BACKORDERED)
 *  3. For all BACKORDERED items: create SmartPORecommendation with urgency=CRITICAL, triggerReason=JOB_AUTO_ALLOCATE
 *  4. Return summary: { allocated: number, backordered: number, recommendations: number }
 */

import { prisma } from '@/lib/prisma'

export interface AutoAllocateResult {
  jobId: string
  allocated: number
  backordered: number
  recommendations: number
  skipped: boolean
  reason?: string
}

/**
 * Execute auto-allocation for a job. Idempotent — if allocations already exist
 * for this job, they are left alone.
 */
export async function autoAllocateJob(jobId: string): Promise<AutoAllocateResult> {
  const base: AutoAllocateResult = {
    jobId,
    allocated: 0,
    backordered: 0,
    recommendations: 0,
    skipped: false,
  }

  if (!jobId) {
    return { ...base, skipped: true, reason: 'missing_jobId' }
  }

  // Check job exists and has an order
  const jobRows: any[] = await prisma.$queryRawUnsafe(
    `SELECT "id", "orderId", "status"::text AS status
       FROM "Job" WHERE "id" = $1 LIMIT 1`,
    jobId
  )
  if (jobRows.length === 0) {
    return { ...base, skipped: true, reason: 'job_not_found' }
  }

  const job = jobRows[0]
  if (!job.orderId) {
    return { ...base, skipped: true, reason: 'no_order_linked' }
  }

  // Don't allocate for terminal jobs
  if (['CLOSED', 'COMPLETE', 'INVOICED', 'DELIVERED'].includes(String(job.status))) {
    return { ...base, skipped: true, reason: `terminal_status:${job.status}` }
  }

  // ─── BOM expansion ───
  // Recursively walk OrderItems and their BoM dependencies to find all leaf components
  const demandLines: Array<{ productId: string; quantity: number }> = await prisma.$queryRawUnsafe(
    `
    WITH RECURSIVE
    order_demand AS (
      SELECT oi."productId" AS product_id, oi."quantity"::float AS qty, 0 AS depth
      FROM "OrderItem" oi
      WHERE oi."orderId" = $1

      UNION ALL

      SELECT b."componentId", od.qty * b."quantity", od.depth + 1
      FROM order_demand od
      JOIN "BomEntry" b ON b."parentId" = od.product_id
      WHERE od.depth < 4
    ),
    has_children AS (
      SELECT DISTINCT "parentId" AS product_id FROM "BomEntry"
    )
    SELECT
      od.product_id AS "productId",
      SUM(od.qty)::int AS quantity
    FROM order_demand od
    LEFT JOIN has_children hc ON hc.product_id = od.product_id
    WHERE (hc.product_id IS NULL OR od.depth > 0)
      AND od.product_id IS NOT NULL
    GROUP BY od.product_id
    HAVING SUM(od.qty)::int > 0
    `,
    job.orderId
  )

  if (demandLines.length === 0) {
    return { ...base, skipped: true, reason: 'no_demand' }
  }

  // ─── Load inventory for all demanded products ───
  const productIds = demandLines.map((l) => l.productId)
  const invRows: any[] = await prisma.$queryRawUnsafe(
    `SELECT "productId",
            COALESCE("onHand", 0)::int AS on_hand,
            COALESCE("committed", 0)::int AS committed,
            COALESCE("available", 0)::int AS available
       FROM "InventoryItem"
       WHERE "productId" = ANY($1::text[])`,
    productIds
  )

  const invByProd = new Map<
    string,
    { onHand: number; committed: number; available: number }
  >()
  for (const r of invRows) {
    invByProd.set(r.productId, {
      onHand: Number(r.on_hand),
      committed: Number(r.committed),
      available: Number(r.available),
    })
  }

  // ─── Allocate each line item ───
  let allocCount = 0
  let backorderCount = 0
  const backorderedProducts: Array<{ productId: string; shortage: number; vendorId?: string }> = []
  const touchedProducts = new Set<string>()

  for (const line of demandLines) {
    const pid = line.productId
    const need = Number(line.quantity) || 0
    if (need <= 0) continue

    const inv = invByProd.get(pid) ?? { onHand: 0, committed: 0, available: 0 }
    const canReserve = Math.min(need, Math.max(0, inv.available))
    const short = Math.max(0, need - canReserve)

    // ─── RESERVED allocation (only if we have something available) ───
    if (canReserve > 0) {
      const allocId = `alloc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
      try {
        const result: any[] = await prisma.$queryRawUnsafe(
          `INSERT INTO "InventoryAllocation"
             ("id", "productId", "orderId", "jobId", "quantity",
              "allocationType", "status", "allocatedBy",
              "allocatedAt", "createdAt", "updatedAt")
           VALUES ($1, $2, $3, $4, $5,
                   'JOB', 'RESERVED', 'system-auto-allocate',
                   NOW(), NOW(), NOW())
           ON CONFLICT DO NOTHING
           RETURNING "id"`,
          allocId,
          pid,
          job.orderId,
          jobId,
          canReserve
        )
        if (result.length > 0) {
          touchedProducts.add(pid)
          allocCount++
        }
      } catch (e) {
        console.warn(`[auto-allocate] Failed to create RESERVED allocation for ${pid}:`, e)
      }
    }

    // ─── BACKORDERED allocation (only if there's a shortfall) ───
    if (short > 0) {
      const allocId = `alloc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
      try {
        const result: any[] = await prisma.$queryRawUnsafe(
          `INSERT INTO "InventoryAllocation"
             ("id", "productId", "orderId", "jobId", "quantity",
              "allocationType", "status", "allocatedBy",
              "notes",
              "allocatedAt", "createdAt", "updatedAt")
           VALUES ($1, $2, $3, $4, $5,
                   'JOB', 'BACKORDERED', 'system-auto-allocate',
                   'short by ' || $5 || ' at auto-allocation',
                   NOW(), NOW(), NOW())
           ON CONFLICT DO NOTHING
           RETURNING "id"`,
          allocId,
          pid,
          job.orderId,
          jobId,
          short
        )
        if (result.length > 0) {
          touchedProducts.add(pid)
          backorderCount++
          backorderedProducts.push({ productId: pid, shortage: short })
        }
      } catch (e) {
        console.warn(`[auto-allocate] Failed to create BACKORDERED allocation for ${pid}:`, e)
      }
    }
  }

  // ─── Recompute inventory balances for touched products ───
  if (touchedProducts.size > 0) {
    for (const pid of touchedProducts) {
      try {
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
          pid
        )
      } catch (e) {
        console.warn(`[auto-allocate] Failed to recompute inventory for ${pid}:`, e)
      }
    }
  }

  // ─── Create SmartPORecommendation for each backordered item ───
  let recommendationCount = 0
  for (const backorder of backorderedProducts) {
    try {
      // Fetch product and preferred vendor info
      const productRows: any[] = await prisma.$queryRawUnsafe(
        `SELECT p."id", p."unitCost", p."reorderQty",
                vp."vendorId", v."name" AS "vendorName", vp."vendorCost", vp."leadTimeDays"
            FROM "Product" p
            LEFT JOIN "VendorProduct" vp ON vp."productId" = p."id" AND vp."preferred" = true
            LEFT JOIN "Vendor" v ON v."id" = vp."vendorId"
            WHERE p."id" = $1
            LIMIT 1`,
        backorder.productId
      )

      if (productRows.length > 0) {
        const product = productRows[0]
        const vendorId = product.vendorId || 'unknown'
        const recommendedQty = Math.max(backorder.shortage, Number(product.reorderQty) || 0)
        const estimatedCost = (recommendedQty * (Number(product.vendorCost) || Number(product.unitCost) || 0))

        const recId = `rec_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`

        await prisma.$executeRawUnsafe(
          `INSERT INTO "SmartPORecommendation"
             ("id", "vendorId", "productId", "productCategory",
              "recommendationType", "urgency", "triggerReason",
              "recommendedQty", "estimatedCost", "targetDeliveryDate",
              "relatedJobIds", "status", "createdAt", "updatedAt")
           VALUES ($1, $2, $3, $4, 'REORDER', 'CRITICAL', 'JOB_AUTO_ALLOCATE',
                   $5, $6, $7, $8, 'PENDING', NOW(), NOW())`,
          recId,
          vendorId,
          backorder.productId,
          null,
          recommendedQty,
          estimatedCost,
          new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days from now
          JSON.stringify([jobId])
        )
        recommendationCount++
      }
    } catch (e) {
      console.warn(
        `[auto-allocate] Failed to create SmartPORecommendation for ${backorder.productId}:`,
        e
      )
    }
  }

  // Update job's allMaterialsAllocated flag
  try {
    const hasBackorder = backorderCount > 0
    await prisma.$executeRawUnsafe(
      `UPDATE "Job"
         SET "allMaterialsAllocated" = $1, "updatedAt" = NOW()
         WHERE "id" = $2`,
      !hasBackorder,
      jobId
    )
  } catch (e) {
    console.warn(`[auto-allocate] Failed to update Job.allMaterialsAllocated:`, e)
  }

  return {
    jobId,
    allocated: allocCount,
    backordered: backorderCount,
    recommendations: recommendationCount,
    skipped: false,
  }
}
