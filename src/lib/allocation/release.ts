import { prisma } from '@/lib/prisma'

export interface ReleaseResult {
  jobId: string
  released: number
  productIds: string[]
  reason: string
}

/**
 * releaseForJob — mark every active allocation (RESERVED/PICKED/BACKORDERED)
 * on a job as RELEASED. Used when a Job is canceled or marked COMPLETE; the
 * material either never got installed (cancel) or is already physically off
 * the shelf (complete, picked+consumed via consume.ts).
 *
 * Does NOT touch onHand — that's consume.ts's job.
 *
 * Idempotent: calling twice is a no-op on the second run.
 */
export async function releaseForJob(
  jobId: string,
  reason: string = 'job_lifecycle_release'
): Promise<ReleaseResult> {
  if (!jobId) return { jobId, released: 0, productIds: [], reason: 'missing_jobId' }

  const released: any[] = await prisma.$queryRawUnsafe(
    `UPDATE "InventoryAllocation"
       SET "status" = 'RELEASED',
           "releasedAt" = NOW(),
           "notes" = COALESCE("notes", '') || ' | released: ' || $2,
           "updatedAt" = NOW()
     WHERE "jobId" = $1
       AND "status" IN ('RESERVED', 'PICKED', 'BACKORDERED')
     RETURNING "id", "productId"`,
    jobId, reason
  )

  const productIds = Array.from(new Set(released.map((r) => r.productId)))

  // Recompute committed/available for each touched product
  for (const pid of productIds) {
    try {
      await prisma.$executeRawUnsafe(
        `SELECT recompute_inventory_committed($1)`, pid
      )
    } catch {
      // Fallback inline recompute
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

  return { jobId, released: released.length, productIds, reason }
}
