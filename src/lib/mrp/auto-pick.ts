/**
 * Auto-pick generation — fires when a Job transitions to READINESS_CHECK or MATERIALS_LOCKED.
 *
 * This is GAP-3: once allocations are RESERVED, we need to create MaterialPick records
 * so warehouse staff can stage the goods.
 *
 * Flow:
 *  1. Check all InventoryAllocation rows for the job with status=RESERVED
 *  2. For each allocation:
 *     - Create a MaterialPick record with status=PENDING
 *     - Update the InventoryAllocation status to PICKED
 *  3. Return count of picks generated
 *
 * Idempotent: calling twice produces the same result (second call finds no RESERVED allocations).
 */

import { prisma } from '@/lib/prisma'

export interface GeneratePicksResult {
  jobId: string
  picksGenerated: number
  skipped: boolean
  reason?: string
}

/**
 * Generate MaterialPick records from RESERVED InventoryAllocations for a job.
 * Called when job status transitions to READINESS_CHECK or MATERIALS_LOCKED.
 */
export async function generatePicksForJob(jobId: string): Promise<GeneratePicksResult> {
  const base: GeneratePicksResult = {
    jobId,
    picksGenerated: 0,
    skipped: false,
  }

  if (!jobId) {
    return { ...base, skipped: true, reason: 'missing_jobId' }
  }

  // Verify job exists
  const jobRows: any[] = await prisma.$queryRawUnsafe(
    `SELECT "id", "status"::text AS status FROM "Job" WHERE "id" = $1 LIMIT 1`,
    jobId
  )
  if (jobRows.length === 0) {
    return { ...base, skipped: true, reason: 'job_not_found' }
  }

  // Fetch all RESERVED allocations for this job
  const allocations: any[] = await prisma.$queryRawUnsafe(
    `SELECT "id", "productId", "quantity"
       FROM "InventoryAllocation"
      WHERE "jobId" = $1 AND "status" = 'RESERVED'
      ORDER BY "createdAt" ASC`,
    jobId
  )

  if (allocations.length === 0) {
    return { ...base, skipped: true, reason: 'no_reserved_allocations' }
  }

  // For each allocation, create a MaterialPick and transition allocation to PICKED
  const picks: any[] = []
  const allocationUpdates: any[] = []

  for (const alloc of allocations) {
    // Fetch product details (SKU, name)
    const productRows: any[] = await prisma.$queryRawUnsafe(
      `SELECT "id", "sku", "name" FROM "Product" WHERE "id" = $1 LIMIT 1`,
      alloc.productId
    )

    if (productRows.length === 0) continue // skip orphaned allocation

    const product = productRows[0]
    const pickId = `pick_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`

    // Generate a pick record
    picks.push({
      id: pickId,
      jobId,
      productId: alloc.productId,
      sku: product.sku || '',
      description: product.name || '',
      quantity: alloc.quantity,
    })

    allocationUpdates.push({
      allocationId: alloc.id,
      pickId,
    })
  }

  // Batch insert picks + update allocations in a transaction
  try {
    await prisma.$transaction(async (tx) => {
      // Insert all picks
      for (const pick of picks) {
        await tx.$executeRawUnsafe(
          `INSERT INTO "MaterialPick" ("id", "jobId", "productId", "sku", "description", "quantity", "status", "createdAt", "updatedAt")
             VALUES ($1, $2, $3, $4, $5, $6, 'PENDING', NOW(), NOW())`,
          pick.id,
          pick.jobId,
          pick.productId,
          pick.sku,
          pick.description,
          pick.quantity
        )
      }

      // Transition all allocations to PICKED
      for (const update of allocationUpdates) {
        await tx.$executeRawUnsafe(
          `UPDATE "InventoryAllocation" SET "status" = 'PICKED', "updatedAt" = NOW() WHERE "id" = $1`,
          update.allocationId
        )
      }
    })

    return {
      ...base,
      picksGenerated: picks.length,
    }
  } catch (err: any) {
    console.error(`[auto-pick] Failed to generate picks for job ${jobId}:`, err?.message)
    throw err
  }
}
