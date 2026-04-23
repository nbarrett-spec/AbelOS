export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'
import { safeJson } from '@/lib/safe-json'

/**
 * GET /api/ops/warehouse/ready-to-pick
 *
 * Returns Jobs ready for the warehouse pick-scanner:
 *   - status = 'IN_PRODUCTION'   OR
 *   - status = 'MATERIALS_LOCKED' AND pickListGenerated = true
 *
 * Each row includes job number, builder, scheduled date, pick item count,
 * and verified count so the UI can render progress on the job card.
 */
export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const rows: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        j.id,
        j."jobNumber",
        j."builderName",
        j."scheduledDate",
        j.status::text as status,
        j."pickListGenerated",
        j."allMaterialsAllocated",
        o."orderNumber",
        o.id as "orderId",
        COUNT(mp.id)::int as "totalPicks",
        COUNT(CASE WHEN mp.status = 'VERIFIED' THEN 1 END)::int as "verifiedPicks",
        COUNT(CASE WHEN mp.status = 'PICKED'   THEN 1 END)::int as "pickedPicks",
        COUNT(CASE WHEN mp.status = 'SHORT'    THEN 1 END)::int as "shortPicks",
        COUNT(CASE WHEN mp.status = 'PENDING'  THEN 1 END)::int as "pendingPicks"
      FROM "Job" j
      LEFT JOIN "Order" o ON o.id = j."orderId"
      LEFT JOIN "MaterialPick" mp ON mp."jobId" = j.id
      WHERE
        (j.status = 'IN_PRODUCTION')
        OR (j.status = 'MATERIALS_LOCKED' AND j."pickListGenerated" = true)
      GROUP BY j.id, o.id
      ORDER BY j."scheduledDate" ASC NULLS LAST, j."jobNumber" ASC
    `)

    const jobs = rows
      // Only surface jobs that actually have picks to do
      .filter((r: any) => (r.totalPicks ?? 0) > 0)
      .map((r: any) => ({
        id: r.id,
        jobNumber: r.jobNumber,
        builderName: r.builderName,
        scheduledDate: r.scheduledDate,
        status: r.status,
        orderNumber: r.orderNumber,
        orderId: r.orderId,
        totalPicks: r.totalPicks,
        verifiedPicks: r.verifiedPicks,
        pickedPicks: r.pickedPicks,
        shortPicks: r.shortPicks,
        pendingPicks: r.pendingPicks,
        allComplete:
          r.totalPicks > 0 && r.totalPicks === r.verifiedPicks,
      }))

    return safeJson({ jobs, total: jobs.length })
  } catch (error: any) {
    console.error('[ready-to-pick] error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch ready-to-pick jobs' },
      { status: 500 }
    )
  }
}
