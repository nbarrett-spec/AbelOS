export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'
import { safeJson } from '@/lib/safe-json'

/**
 * GET /api/ops/warehouse/picks/today
 *
 * Returns jobs scheduled for delivery/install in the next 48h that still have
 * RESERVED inventory allocations waiting to be pulled from stock. This is the
 * live work queue for Gunner's warehouse floor.
 *
 * Each job carries its rolled-up allocation lines (product, SKU, bin location,
 * zone, qty). The UI groups by Job card → allocation rows.
 *
 * Response: [{ jobId, jobNumber, jobAddress, builderName, scheduledDate,
 *              pmName, status, allocations: [...] }]
 */
export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    // Active statuses = jobs actively moving through the pipeline and
    // reasonable to pick materials for. CREATED is included because some jobs
    // go straight to delivery without a full production cycle.
    const jobRows: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        j.id                            AS "jobId",
        j."jobNumber"                   AS "jobNumber",
        j."jobAddress"                  AS "jobAddress",
        j."builderName"                 AS "builderName",
        j."scheduledDate"               AS "scheduledDate",
        j.status::text                  AS "status",
        j."pickListGenerated"           AS "pickListGenerated",
        j."assignedPMId"                AS "assignedPMId",
        COALESCE(NULLIF(TRIM(pm."firstName" || ' ' || pm."lastName"), ''), NULL) AS "pmName"
      FROM "Job" j
      LEFT JOIN "Staff" pm ON pm.id = j."assignedPMId"
      WHERE
        j."scheduledDate" IS NOT NULL
        AND j."scheduledDate" BETWEEN NOW() AND NOW() + INTERVAL '48 hours'
        AND j.status IN (
          'CREATED'::"JobStatus",
          'READINESS_CHECK'::"JobStatus",
          'MATERIALS_LOCKED'::"JobStatus",
          'IN_PRODUCTION'::"JobStatus",
          'STAGED'::"JobStatus"
        )
        AND EXISTS (
          SELECT 1 FROM "InventoryAllocation" ia
          WHERE ia."jobId" = j.id
            AND ia.status = 'RESERVED'
        )
      ORDER BY j."scheduledDate" ASC, j."jobNumber" ASC
    `)

    if (jobRows.length === 0) {
      return safeJson({ jobs: [], total: 0 })
    }

    const jobIds = jobRows.map((j: any) => j.jobId)

    // Pull every allocation line for these jobs. We surface RESERVED (work to
    // do) AND PICKED (already done today) so the UI can show per-job progress.
    // CONSUMED rows are excluded — the pick lifecycle has moved past this stage.
    const allocRows: any[] = await prisma.$queryRawUnsafe(
      `
      SELECT
        ia.id                           AS "allocationId",
        ia."jobId"                      AS "jobId",
        ia."productId"                  AS "productId",
        ia.quantity                     AS "qty",
        ia.status                       AS "status",
        ia."allocatedAt"                AS "allocatedAt",
        p.sku                           AS "sku",
        p.name                          AS "productName",
        ii."binLocation"                AS "binLocation",
        ii."warehouseZone"              AS "warehouseZone",
        ii."onHand"                     AS "onHand"
      FROM "InventoryAllocation" ia
      LEFT JOIN "Product" p       ON p.id  = ia."productId"
      LEFT JOIN "InventoryItem" ii ON ii."productId" = ia."productId"
      WHERE ia."jobId" = ANY($1::text[])
        AND ia.status IN ('RESERVED', 'PICKED')
      ORDER BY ii."warehouseZone" NULLS LAST, ii."binLocation" NULLS LAST, p.sku
      `,
      jobIds
    )

    // Bucket allocations by jobId
    const allocsByJob = new Map<string, any[]>()
    for (const a of allocRows) {
      const bucket = allocsByJob.get(a.jobId) ?? []
      bucket.push({
        allocationId: a.allocationId,
        productId: a.productId,
        sku: a.sku || '—',
        productName: a.productName || '(unknown product)',
        qty: Number(a.qty || 0),
        binLocation: a.binLocation || null,
        warehouseZone: a.warehouseZone || null,
        status: a.status,
        onHand: Number(a.onHand || 0),
        shortage: Number(a.qty || 0) > Number(a.onHand || 0),
      })
      allocsByJob.set(a.jobId, bucket)
    }

    const jobs = jobRows.map((j: any) => {
      const allocations = allocsByJob.get(j.jobId) ?? []
      const reserved = allocations.filter((a) => a.status === 'RESERVED').length
      const picked = allocations.filter((a) => a.status === 'PICKED').length
      const total = reserved + picked
      const hasShortage = allocations.some((a) => a.status === 'RESERVED' && a.shortage)

      let pickStatus: 'NONE' | 'PARTIAL' | 'FULL' | 'BLOCKED' = 'NONE'
      if (hasShortage) pickStatus = 'BLOCKED'
      else if (total > 0 && reserved === 0) pickStatus = 'FULL'
      else if (picked > 0) pickStatus = 'PARTIAL'

      return {
        jobId: j.jobId,
        jobNumber: j.jobNumber,
        jobAddress: j.jobAddress,
        builderName: j.builderName,
        scheduledDate: j.scheduledDate,
        pmName: j.pmName,
        status: j.status,
        pickListGenerated: !!j.pickListGenerated,
        pickStatus,
        counts: {
          total,
          reserved,
          picked,
          shortage: allocations.filter((a) => a.shortage).length,
        },
        allocations,
      }
    })

    return safeJson({ jobs, total: jobs.length })
  } catch (error: any) {
    console.error('[picks/today] error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch today\'s pick queue' },
      { status: 500 }
    )
  }
}
