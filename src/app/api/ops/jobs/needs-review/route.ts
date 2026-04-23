export const dynamic = 'force-dynamic'
import { prisma } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'

// ── GET /api/ops/jobs/needs-review ───────────────────────────────────────
// Surfaces Jobs whose scheduledDate was auto-defaulted to
// createdAt + 14 days by scripts/backfill-scheduled-dates.mjs.
// Those rows carry [NEEDS_REVIEW | DEFAULT_LEAD_TIME] in buildSheetNotes.
// PMs need a queue to confirm or correct these dates before the
// defaulted values get treated as source-of-truth.
// Returns { data: Job[], count: number }.
// ──────────────────────────────────────────────────────────────────────────

const REVIEW_MARKER = '[NEEDS_REVIEW | DEFAULT_LEAD_TIME]'

export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const searchParams = request.nextUrl.searchParams
    const countOnly = searchParams.get('countOnly') === '1'

    if (countOnly) {
      const countRows: any = await prisma.$queryRawUnsafe(
        `SELECT COUNT(*)::int AS total
         FROM "Job"
         WHERE "buildSheetNotes" LIKE '%NEEDS_REVIEW%'
           AND "status"::text NOT IN ('CLOSED', 'INVOICED')`
      )
      const total = countRows[0]?.total || 0
      return NextResponse.json({ count: total }, { status: 200 })
    }

    // Full list — active jobs only (exclude CLOSED/INVOICED since they're done)
    const rows: any = await prisma.$queryRawUnsafe(`
      SELECT
        j."id",
        j."jobNumber",
        j."builderName",
        j."community",
        j."lotBlock",
        j."jobAddress",
        j."status"::text AS "status",
        j."scopeType"::text AS "scopeType",
        j."scheduledDate",
        j."createdAt",
        j."buildSheetNotes",
        j."assignedPMId",
        pm."firstName" AS "pm_firstName",
        pm."lastName" AS "pm_lastName"
      FROM "Job" j
      LEFT JOIN "Staff" pm ON pm."id" = j."assignedPMId"
      WHERE j."buildSheetNotes" LIKE '%NEEDS_REVIEW%'
        AND j."status"::text NOT IN ('CLOSED', 'INVOICED')
      ORDER BY j."scheduledDate" ASC NULLS LAST, j."createdAt" DESC
    `)

    const data = rows.map((row: any) => ({
      id: row.id,
      jobNumber: row.jobNumber,
      builderName: row.builderName,
      community: row.community,
      lotBlock: row.lotBlock,
      jobAddress: row.jobAddress,
      status: row.status,
      scopeType: row.scopeType,
      scheduledDate: row.scheduledDate,
      createdAt: row.createdAt,
      buildSheetNotes: row.buildSheetNotes,
      assignedPM: row.pm_firstName || row.pm_lastName
        ? { firstName: row.pm_firstName, lastName: row.pm_lastName }
        : null,
    }))

    return NextResponse.json(
      { data, count: data.length, marker: REVIEW_MARKER },
      { status: 200 }
    )
  } catch (error) {
    console.error('Error fetching needs-review jobs:', error)
    return NextResponse.json(
      { error: 'Failed to fetch needs-review jobs' },
      { status: 500 }
    )
  }
}
