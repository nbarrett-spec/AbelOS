import { prisma } from '@/lib/prisma'
import type { AllocateResult, AllocatedRow, BackorderedRow, ShortfallRow } from './types'

/**
 * allocateForJob — turn a Job into rows on the InventoryAllocation ledger.
 *
 * Idempotent. Any (jobId, productId) that already has an active row
 * (RESERVED | PICKED | BACKORDERED) is left alone — we don't try to reconcile
 * against a new BoM expansion. If the Order changes, call releaseForJob first.
 *
 * Shortage policy: we respect the current InventoryItem.available balance
 * (which is already net of everyone else's reservations). If there isn't
 * enough, the leftover quantity becomes a separate BACKORDERED row on the
 * same job so downstream readers (PM dashboard, ATP forecast) can see both.
 *
 * Returns a structured report — callers decide whether shortfall triggers an
 * InboxItem / Slack ping. This module deliberately does NOT create inbox rows.
 */
export async function allocateForJob(jobId: string): Promise<AllocateResult> {
  const base: AllocateResult = {
    jobId,
    allocated: [],
    backordered: [],
    shortfall: [],
    skipped: false,
  }

  if (!jobId) {
    return { ...base, skipped: true, reason: 'missing_jobId' }
  }

  // Check the job exists and has an order
  const jobRows: any[] = await prisma.$queryRawUnsafe(
    `SELECT "id", "orderId", "status"::text AS status,
            "communityId"
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
  // Hard-stop terminal statuses — don't create ledger rows for jobs that are
  // closed. Cron sweeps these as a belt-and-suspenders.
  if (['CLOSED', 'COMPLETE', 'INVOICED', 'DELIVERED'].includes(String(job.status))) {
    return { ...base, skipped: true, reason: `terminal_status:${job.status}` }
  }

  // ── Gold Stock fast path ──
  // If this Job's plan has an ACTIVE GoldStockKit with ON_HAND instances, try
  // to consume a single pre-built kit instead of bill-of-material allocating.
  // We match by (builder, planId) derived from the Order → Quote → FloorPlan
  // chain since Job itself doesn't carry planId.
  try {
    const kitMatch: any[] = await prisma.$queryRawUnsafe(
      `SELECT k."id" AS "kitId"
         FROM "Job" j
         JOIN "Order" o ON o."id" = j."orderId"
         LEFT JOIN "Quote" q ON q."id" = o."quoteId"
         JOIN "GoldStockKit" k
              ON k."status" = 'ACTIVE'
             AND k."builderId" = o."builderId"
             AND (k."planId" = q."floorPlanId" OR q."floorPlanId" IS NULL)
         WHERE j."id" = $1
         ORDER BY (k."planId" = q."floorPlanId") DESC NULLS LAST
         LIMIT 1`,
      jobId
    )
    if (kitMatch.length > 0) {
      const kitId = kitMatch[0].kitId
      const free: any[] = await prisma.$queryRawUnsafe(
        `SELECT "id" FROM "GoldStockInstance"
          WHERE "kitId" = $1 AND "status" = 'ON_HAND'
          ORDER BY "builtAt" ASC LIMIT 1`,
        kitId
      )
      if (free.length > 0) {
        const instanceId = free[0].id
        await prisma.$executeRawUnsafe(
          `UPDATE "GoldStockInstance"
             SET "status" = 'ALLOCATED', "allocatedToJobId" = $1
             WHERE "id" = $2 AND "status" = 'ON_HAND'`,
          jobId,
          instanceId
        )
        await prisma.$executeRawUnsafe(
          `UPDATE "GoldStockKit"
             SET "currentQty" = GREATEST(0, "currentQty" - 1)
             WHERE "id" = $1`,
          kitId
        )
        // Denormalize the flag so the UI renders ready-to-go.
        await prisma.$executeRawUnsafe(
          `UPDATE "Job"
             SET "allMaterialsAllocated" = true, "updatedAt" = NOW()
             WHERE "id" = $1`,
          jobId
        )
        return {
          ...base,
          skipped: true,
          reason: `gold_stock:${kitId}:${instanceId}`,
        }
      }
    }
  } catch {
    // Fall through to normal allocation if the fast-path probe errors.
  }

  // BoM-expand demand (same recursive walk as src/lib/mrp.ts)
  const lines: Array<{ productId: string; quantity: number }> =
    await prisma.$queryRawUnsafe(
      `
      WITH RECURSIVE
      job_demand AS (
        SELECT oi."productId" AS product_id, oi."quantity"::float AS qty, 0 AS depth
        FROM "Job" j
        JOIN "OrderItem" oi ON oi."orderId" = j."orderId"
        WHERE j."id" = $1

        UNION ALL

        SELECT b."componentId", jd.qty * b."quantity", jd.depth + 1
        FROM job_demand jd
        JOIN "BomEntry" b ON b."parentId" = jd.product_id
        WHERE jd.depth < 4
      ),
      has_children AS (
        SELECT DISTINCT "parentId" AS product_id FROM "BomEntry"
      )
      SELECT
        jd.product_id AS "productId",
        SUM(jd.qty)::int AS quantity
      FROM job_demand jd
      LEFT JOIN has_children hc ON hc.product_id = jd.product_id
      WHERE (hc.product_id IS NULL OR jd.depth > 0)
        AND jd.product_id IS NOT NULL
      GROUP BY jd.product_id
      HAVING SUM(jd.qty)::int > 0
      `,
      jobId
    )

  if (lines.length === 0) {
    return { ...base, skipped: true, reason: 'no_demand' }
  }

  // Load current avail per productId so we can split RESERVED vs BACKORDERED.
  // InventoryItem.available is already net of every other active allocation
  // (after recompute runs), which is what we want.
  const productIds = lines.map((l) => l.productId)
  const invRows: any[] = await prisma.$queryRawUnsafe(
    `SELECT "productId",
            COALESCE("onHand", 0)::int AS on_hand,
            COALESCE("committed", 0)::int AS committed,
            COALESCE("available", 0)::int AS available
       FROM "InventoryItem"
       WHERE "productId" = ANY($1::text[])`,
    productIds
  )
  const invByProd = new Map<string, { onHand: number; committed: number; available: number }>()
  for (const r of invRows) {
    invByProd.set(r.productId, {
      onHand: Number(r.on_hand),
      committed: Number(r.committed),
      available: Number(r.available),
    })
  }

  const allocated: AllocatedRow[] = []
  const backordered: BackorderedRow[] = []
  const shortfall: ShortfallRow[] = []
  const touchedProducts = new Set<string>()

  for (const line of lines) {
    const pid = line.productId
    const need = Number(line.quantity) || 0
    if (need <= 0) continue

    const inv = invByProd.get(pid) ?? { onHand: 0, committed: 0, available: 0 }
    const canReserve = Math.min(need, Math.max(0, inv.available))
    const short = Math.max(0, need - canReserve)

    if (canReserve > 0) {
      const rowId = `ia_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
      try {
        const ins: any[] = await prisma.$queryRawUnsafe(
          `INSERT INTO "InventoryAllocation"
             ("id", "productId", "orderId", "jobId", "quantity",
              "allocationType", "status", "allocatedBy",
              "allocatedAt", "createdAt", "updatedAt")
           VALUES ($1, $2, $3, $4, $5,
                   'JOB', 'RESERVED', 'system-auto',
                   NOW(), NOW(), NOW())
           ON CONFLICT ("jobId", "productId")
             WHERE "status" IN ('RESERVED', 'PICKED', 'BACKORDERED')
           DO NOTHING
           RETURNING "id", "quantity", "status"`,
          rowId, pid, job.orderId, jobId, canReserve
        )
        if (ins.length > 0) {
          touchedProducts.add(pid)
          allocated.push({
            productId: pid,
            quantity: canReserve,
            status: 'RESERVED',
            allocationId: ins[0].id,
          })
        }
      } catch (e: any) {
        // Ignore duplicate-constraint collisions; they mean another caller
        // raced us. Treat as already-allocated.
      }
    }

    if (short > 0) {
      shortfall.push({ productId: pid, shortBy: short })
      const rowId = `ia_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
      try {
        const ins: any[] = await prisma.$queryRawUnsafe(
          `INSERT INTO "InventoryAllocation"
             ("id", "productId", "orderId", "jobId", "quantity",
              "allocationType", "status", "allocatedBy",
              "notes",
              "allocatedAt", "createdAt", "updatedAt")
           VALUES ($1, $2, $3, $4, $5,
                   'JOB', 'BACKORDERED', 'system-auto',
                   'short by ' || $5 || ' at allocation time',
                   NOW(), NOW(), NOW())
           ON CONFLICT ("jobId", "productId")
             WHERE "status" IN ('RESERVED', 'PICKED', 'BACKORDERED')
           DO NOTHING
           RETURNING "id", "quantity"`,
          rowId, pid, job.orderId, jobId, short
        )
        if (ins.length > 0) {
          touchedProducts.add(pid)
          backordered.push({
            productId: pid,
            quantity: short,
            allocationId: ins[0].id,
          })
        }
      } catch {}
    }
  }

  // Roll the ledger deltas into InventoryItem.committed / .available
  if (touchedProducts.size > 0) {
    for (const pid of touchedProducts) {
      try {
        await prisma.$executeRawUnsafe(
          `SELECT recompute_inventory_committed($1)`,
          pid
        )
      } catch {
        // SQL function might not exist in dev / brand-new envs — fall back
        // to a direct recompute for just this productId.
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
      }
    }
  }

  // Flip the denormalized flag on Job so the UI can pre-render the badge
  // without round-tripping to the ledger.
  if (allocated.length > 0 || backordered.length > 0) {
    try {
      await prisma.$executeRawUnsafe(
        `UPDATE "Job"
           SET "allMaterialsAllocated" = $1,
               "updatedAt" = NOW()
           WHERE "id" = $2`,
        shortfall.length === 0, jobId
      )
    } catch {}
  }

  return {
    jobId,
    allocated,
    backordered,
    shortfall,
    skipped: false,
  }
}
