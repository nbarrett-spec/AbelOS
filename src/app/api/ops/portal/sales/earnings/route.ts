export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'

/**
 * GET /api/ops/portal/sales/earnings?staffId=...
 *
 * Sales rep revenue-originated view:
 *  - YTD revenue (orders on deals owned by rep)
 *  - Prior YTD revenue (same window prior year)
 *  - Team-wide per-rep avg YTD (for peer comparison)
 *  - Monthly sparkline of last 12 months
 *
 * No commission schedule in the data model yet — this endpoint returns
 * `commission = null` until one is added. UI hides the block when null.
 */
export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const { searchParams } = new URL(request.url)
    const override = searchParams.get('staffId')
    const headerStaffId = request.headers.get('x-staff-id')
    const staffId = override || headerStaffId
    if (!staffId) return NextResponse.json({ error: 'staffId unavailable' }, { status: 400 })

    const now = new Date()
    const yearStart = new Date(Date.UTC(now.getUTCFullYear(), 0, 1))
    const priorYearStart = new Date(Date.UTC(now.getUTCFullYear() - 1, 0, 1))
    const priorYearMatch = new Date(Date.UTC(now.getUTCFullYear() - 1, now.getUTCMonth(), now.getUTCDate()))

    // Rev-originated = sum of Orders whose builderId matches any Deal owned by this rep
    // (the cleanest heuristic available given the current schema: Deal.ownerId ties to rep).
    // Fallback: zero when rep has no Deal ownership.

    const [ytdRow, priorRow, sparkRows, teamRow]: any[] = await Promise.all([
      prisma.$queryRawUnsafe(
        `SELECT COALESCE(SUM(o."total"),0)::float AS rev, COUNT(*)::int AS n
         FROM "Order" o
         WHERE o."builderId" IN (SELECT DISTINCT "builderId" FROM "Deal" WHERE "ownerId"=$1 AND "builderId" IS NOT NULL)
           AND o."createdAt" >= $2`,
        staffId,
        yearStart.toISOString(),
      ),
      prisma.$queryRawUnsafe(
        `SELECT COALESCE(SUM(o."total"),0)::float AS rev, COUNT(*)::int AS n
         FROM "Order" o
         WHERE o."builderId" IN (SELECT DISTINCT "builderId" FROM "Deal" WHERE "ownerId"=$1 AND "builderId" IS NOT NULL)
           AND o."createdAt" >= $2
           AND o."createdAt" <  $3`,
        staffId,
        priorYearStart.toISOString(),
        priorYearMatch.toISOString(),
      ),
      prisma.$queryRawUnsafe(
        `SELECT date_trunc('month', o."createdAt") AS month,
                COALESCE(SUM(o."total"),0)::float  AS rev
         FROM "Order" o
         WHERE o."builderId" IN (SELECT DISTINCT "builderId" FROM "Deal" WHERE "ownerId"=$1 AND "builderId" IS NOT NULL)
           AND o."createdAt" >= NOW() - INTERVAL '12 months'
         GROUP BY 1 ORDER BY 1 ASC`,
        staffId,
      ),
      prisma.$queryRawUnsafe(
        `WITH per_rep AS (
           SELECT d."ownerId" AS rep,
                  COALESCE(SUM(o."total"),0)::float AS rev
           FROM "Order" o
           JOIN "Deal" d ON d."builderId" = o."builderId"
           WHERE o."createdAt" >= $1 AND d."ownerId" IS NOT NULL
           GROUP BY d."ownerId"
         )
         SELECT COALESCE(AVG(rev),0)::float AS "teamAvg",
                COALESCE(MAX(rev),0)::float AS "teamMax",
                COUNT(*)::int               AS "repCount"
         FROM per_rep`,
        yearStart.toISOString(),
      ),
    ])

    const ytd = Number(ytdRow?.[0]?.rev || 0)
    const ytdOrders = Number(ytdRow?.[0]?.n || 0)
    const prior = Number(priorRow?.[0]?.rev || 0)
    const yoyDeltaPct = prior > 0 ? ((ytd - prior) / prior) * 100 : null
    const sparkline = (sparkRows || []).map((r: any) => Number(r.rev))
    const teamAvg = Number(teamRow?.[0]?.teamAvg || 0)
    const teamMax = Number(teamRow?.[0]?.teamMax || 0)
    const repCount = Number(teamRow?.[0]?.repCount || 0)

    return NextResponse.json({
      ok: true,
      staffId,
      ytdRevenue: ytd,
      ytdOrders,
      priorYtdRevenue: prior,
      yoyDeltaPct,
      sparkline,
      teamAvg,
      teamMax,
      repCount,
      // Commission block — null until a CommissionSchedule model ships
      commission: null as null | { earned: number; pending: number; paid: number },
    })
  } catch (err: any) {
    console.error('[earnings]', err)
    return NextResponse.json({ error: err?.message || 'internal' }, { status: 500 })
  }
}
