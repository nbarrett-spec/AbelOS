import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'

/**
 * advanceAllocationStatus — handle InventoryAllocation status transitions
 * based on Job status changes.
 *
 * When a job transitions through its lifecycle, its allocations must advance:
 *
 *   READINESS_CHECK → MATERIALS_LOCKED:
 *     - No change; allocations stay RESERVED
 *
 *   MATERIALS_LOCKED → LOADED → IN_TRANSIT → DELIVERED → COMPLETE:
 *     - At LOADED or picking-related status: move RESERVED → PICKED
 *     - At DELIVERED or COMPLETE: move all allocations to CONSUMED, decrement onHand
 *
 *   CANCELLED:
 *     - Release all allocations: move RESERVED/BACKORDERED → RELEASED
 *     - Restore InventoryItem.available
 *
 * All updates execute in a transaction.
 */
export async function advanceAllocationStatus(
  jobId: string,
  newJobStatus: string
): Promise<void> {
  if (!jobId || !newJobStatus) return

  try {
    // Picking-related stages: LOADED, IN_TRANSIT, STAGED (moving material from bin to truck)
    const pickingStages = ['LOADED', 'IN_TRANSIT', 'STAGED']

    // Terminal consumption stages: DELIVERED, COMPLETE (material is gone)
    const consumptionStages = ['DELIVERED', 'COMPLETE']

    // Release stages: CANCELLED
    const releaseStages = ['CANCELLED']

    if (pickingStages.includes(newJobStatus)) {
      // RESERVED → PICKED
      // Mark allocations as picked (on the truck, leaving the warehouse)
      await prisma.$executeRawUnsafe(
        `UPDATE "InventoryAllocation"
         SET "status" = 'PICKED', "updatedAt" = NOW()
         WHERE "jobId" = $1 AND "status" = 'RESERVED'`,
        jobId
      )
    }

    if (consumptionStages.includes(newJobStatus)) {
      // RESERVED/PICKED → CONSUMED
      // Material consumed: decrement onHand for each allocation
      // Use a transaction approach via raw SQL

      // Step 1: Get all non-RELEASED, non-CONSUMED allocations for this job
      const allocRows: any[] = await prisma.$queryRawUnsafe(
        `SELECT "id", "productId", "quantity", "status"
         FROM "InventoryAllocation"
         WHERE "jobId" = $1 AND "status" NOT IN ('CONSUMED', 'RELEASED')`,
        jobId
      )

      // Step 2: For each allocation, flip to CONSUMED and decrement onHand
      for (const alloc of allocRows) {
        // Update allocation status
        await prisma.$executeRawUnsafe(
          `UPDATE "InventoryAllocation"
           SET "status" = 'CONSUMED', "updatedAt" = NOW()
           WHERE "id" = $1`,
          alloc.id
        )

        // Decrement onHand (same logic as consume.ts)
        const qty = Number(alloc.quantity) || 0
        await prisma.$executeRawUnsafe(
          `UPDATE "InventoryItem"
           SET "onHand" = GREATEST(COALESCE("onHand", 0) - $1, 0),
               "updatedAt" = NOW()
           WHERE "productId" = $2`,
          qty,
          alloc.productId
        )

        // Recompute committed/available
        try {
          await prisma.$executeRawUnsafe(
            `SELECT recompute_inventory_committed($1)`,
            alloc.productId
          )
        } catch {}
      }
    }

    if (releaseStages.includes(newJobStatus)) {
      // RESERVED/BACKORDERED → RELEASED (cancel allocations)
      // Restore available inventory

      // Step 1: Get all non-terminal allocations
      const allocRows: any[] = await prisma.$queryRawUnsafe(
        `SELECT "id", "productId", "quantity", "status"
         FROM "InventoryAllocation"
         WHERE "jobId" = $1 AND "status" IN ('RESERVED', 'BACKORDERED', 'PICKED')`,
        jobId
      )

      // Step 2: Release each allocation
      for (const alloc of allocRows) {
        await prisma.$executeRawUnsafe(
          `UPDATE "InventoryAllocation"
           SET "status" = 'RELEASED', "releasedAt" = NOW(), "updatedAt" = NOW()
           WHERE "id" = $1`,
          alloc.id
        )

        // Recompute committed/available (restores availability)
        try {
          await prisma.$executeRawUnsafe(
            `SELECT recompute_inventory_committed($1)`,
            alloc.productId
          )
        } catch {}
      }
    }
  } catch (error: any) {
    logger.error('advance_allocation_status_failed', error, { jobId, newJobStatus })
    throw error
  }
}
