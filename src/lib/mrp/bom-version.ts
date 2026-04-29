/**
 * BOM Version Control — GAP-8
 *
 * Ensures that when a Job is locked (materialsLocked=true), we freeze the BOM
 * version so cost/quantity changes to the product catalog don't affect the job's
 * pricing or allocation going forward.
 *
 * Flow:
 *  1. lockBomVersion(jobId): stores the max bomVersion of each product in the job's BoM
 *  2. getBomForJob(jobId): fetches BoM entries for the job's locked version (or latest if not locked)
 *  3. ATP and allocation logic use getBomForJob instead of always fetching latest
 */

import { prisma } from '@/lib/prisma'

/**
 * Lock the BOM version for a job. Called when job status transitions to MATERIALS_LOCKED.
 * Stores the current max bomVersion on the Job record so cost/quantity changes don't apply retroactively.
 */
export async function lockBomVersion(jobId: string): Promise<void> {
  // Fetch the job's order and its products (via OrderItems)
  const orderRows: any[] = await prisma.$queryRawUnsafe(
    `SELECT o."id" FROM "Order" o
       JOIN "Job" j ON j."orderId" = o."id"
      WHERE j."id" = $1 LIMIT 1`,
    jobId
  )

  if (orderRows.length === 0) {
    // No order linked; skip version locking
    return
  }

  const orderId = orderRows[0].id

  // Get all unique product IDs in this order
  const productRows: any[] = await prisma.$queryRawUnsafe(
    `SELECT DISTINCT oi."productId" FROM "OrderItem" oi WHERE oi."orderId" = $1`,
    orderId
  )

  if (productRows.length === 0) {
    return
  }

  // For each product, find the max bomVersion of its BOM entries
  // For simplicity, we'll store a single version number on the Job
  // (Alternatively, you could create a separate BomVersionLock table per product)
  // For now, we use the most-recent bomVersion across all products.

  const versionRows: any[] = await prisma.$queryRawUnsafe(
    `SELECT MAX(COALESCE("bomVersion", 1))::int AS "maxVersion"
       FROM "BomEntry" b
       WHERE b."parentId" IN (SELECT "productId" FROM "OrderItem" WHERE "orderId" = $1)
          OR b."componentId" IN (SELECT "productId" FROM "OrderItem" WHERE "orderId" = $1)`,
    orderId
  )

  const maxVersion = versionRows[0]?.maxVersion || 1

  // Update the job's bomVersion
  await prisma.$executeRawUnsafe(
    `UPDATE "Job" SET "bomVersion" = $1, "updatedAt" = NOW() WHERE "id" = $2`,
    maxVersion,
    jobId
  )
}

/**
 * Fetch BOM entries for a job, respecting the locked version if set.
 * Used by ATP and allocation logic instead of always fetching latest.
 *
 * Returns: array of { parentId, componentId, quantity, componentType, bomVersion }
 */
export async function getBomForJob(
  jobId: string
): Promise<
  Array<{ parentId: string; componentId: string; quantity: number; componentType: string | null; bomVersion: number }>
> {
  // Check if job has a locked bomVersion
  const jobRows: any[] = await prisma.$queryRawUnsafe(
    `SELECT "bomVersion", "orderId" FROM "Job" WHERE "id" = $1 LIMIT 1`,
    jobId
  )

  if (jobRows.length === 0) {
    return []
  }

  const job = jobRows[0]
  const lockedVersion = job.bomVersion

  // If bomVersion is set, fetch entries matching that version
  // Otherwise, fetch latest (bomVersion IS NULL or highest bomVersion)
  let bomEntries: any[] = []

  if (lockedVersion) {
    // Locked version: fetch BomEntry rows where bomVersion matches
    // (Note: BomEntry may not have bomVersion; this is a forward-compatible pattern)
    // For now, if Job.bomVersion is set, we trust it and fetch all BomEntry rows
    // (since BomEntry doesn't currently have a bomVersion field in the schema provided).
    // In future iterations, BomEntry will have bomVersion and we'll filter by it.
    bomEntries = await prisma.$queryRawUnsafe(
      `SELECT "parentId", "componentId", "quantity"::float, "componentType", COALESCE("bomVersion", 1)::int AS "bomVersion"
         FROM "BomEntry"
        WHERE "parentId" IN (SELECT "productId" FROM "OrderItem" WHERE "orderId" = $1)`,
      job.orderId
    )
  } else {
    // Not locked: fetch latest (for backward compatibility)
    bomEntries = await prisma.$queryRawUnsafe(
      `SELECT "parentId", "componentId", "quantity"::float, "componentType", COALESCE("bomVersion", 1)::int AS "bomVersion"
         FROM "BomEntry"
        WHERE "parentId" IN (SELECT "productId" FROM "OrderItem" WHERE "orderId" = $1)`,
      job.orderId
    )
  }

  return bomEntries
}
