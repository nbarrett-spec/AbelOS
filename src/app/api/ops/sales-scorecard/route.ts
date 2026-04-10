export const dynamic = 'force-dynamic'
import { prisma } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'
import { safeJson } from '@/lib/safe-json'

// ──────────────────────────────────────────────────────────────────
// SALES PERFORMANCE SCORECARD
// ──────────────────────────────────────────────────────────────────
// GET ?staffId=xxx  — individual sales rep scorecard
// GET               — all sales reps benchmarked
// ──────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  const targetStaffId = request.nextUrl.searchParams.get('staffId')
  const period = parseInt(request.nextUrl.searchParams.get('period') || '30')

  try {
    // ── Per-rep metrics ──
    let repFilter = ''
    const params: any[] = [period]
    let idx = 2

    if (targetStaffId) {
      repFilter = `AND d."ownerId" = $${idx}`
      params.push(targetStaffId)
      idx++
    }

    const repMetrics: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        s."id" AS "staffId",
        s."firstName" || ' ' || s."lastName" AS "repName",
        s."email",
        COUNT(DISTINCT d."id")::int AS "activeDeals",
        COALESCE(SUM(d."dealValue"), 0)::float AS "pipelineValue",
        COUNT(DISTINCT CASE WHEN d."stage"::text = 'WON' AND d."actualCloseDate" > NOW() - ($1 || ' days')::interval THEN d."id" END)::int AS "wonDeals30d",
        COALESCE(SUM(CASE WHEN d."stage"::text = 'WON' AND d."actualCloseDate" > NOW() - ($1 || ' days')::interval THEN d."dealValue" END), 0)::float AS "wonValue30d",
        COUNT(DISTINCT da."id")::int AS "activitiesThisWeek"
      FROM "Staff" s
      LEFT JOIN "Deal" d ON d."ownerId" = s."id" AND d."stage"::text NOT IN ('LOST')
      LEFT JOIN "DealActivity" da ON d."id" = da."dealId" AND da."createdAt" > NOW() - INTERVAL '7 days'
      WHERE s."role"::text IN ('SALES_REP', 'MANAGER', 'ADMIN')
        ${repFilter}
      GROUP BY s."id", s."firstName", s."lastName", s."email"
      ORDER BY "wonValue30d" DESC
    `, ...params)

    // ── Win rates (last N days) ──
    const winRates: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        d."ownerId" AS "staffId",
        COUNT(*)::int AS "totalDeals",
        COUNT(CASE WHEN d."stage"::text = 'WON' THEN 1 END)::int AS "wonDeals",
        CASE
          WHEN COUNT(*) = 0 THEN 0
          ELSE ROUND(100.0 * COUNT(CASE WHEN d."stage"::text = 'WON' THEN 1 END) / COUNT(*))::int
        END AS "winRate"
      FROM "Deal" d
      WHERE d."createdAt" > NOW() - ($1 || ' days')::interval
        ${targetStaffId ? `AND d."ownerId" = $${idx}` : ''}
      GROUP BY d."ownerId"
    `, ...params)

    const winRateMap: Record<string, any> = {}
    winRates.forEach(wr => { winRateMap[wr.staffId] = wr })

    // ── Average cycle time (days from creation to WON) ──
    const cycleTimes: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        d."ownerId" AS "staffId",
        ROUND(AVG(EXTRACT(DAY FROM d."actualCloseDate" - d."createdAt")))::int AS "avgCycleTime"
      FROM "Deal" d
      WHERE d."stage"::text = 'WON'
        AND d."actualCloseDate" > NOW() - ($1 || ' days')::interval
        ${targetStaffId ? `AND d."ownerId" = $${idx}` : ''}
      GROUP BY d."ownerId"
    `, ...params)

    const cycleTimeMap: Record<string, any> = {}
    cycleTimes.forEach(ct => { cycleTimeMap[ct.staffId] = ct })

    // ── Company averages ──
    const companyAverages: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        ROUND(AVG(CASE
          WHEN total_deals = 0 THEN 0
          ELSE ROUND(100.0 * won_deals / total_deals)
        END))::int AS "avgWinRate",
        ROUND(AVG("avgCycleTime"))::int AS "avgCycleTime",
        ROUND(AVG("pipelineValue"))::float AS "avgPipelineValue",
        ROUND(AVG("activitiesPerWeek"))::int AS "avgActivitiesPerWeek"
      FROM (
        SELECT
          s."id" AS "staffId",
          COUNT(DISTINCT d."id")::int AS total_deals,
          COUNT(DISTINCT CASE WHEN d."stage"::text = 'WON' THEN d."id" END)::int AS won_deals,
          EXTRACT(DAY FROM MAX(d."actualCloseDate") - MIN(d."createdAt"))::int / NULLIF(COUNT(DISTINCT CASE WHEN d."stage"::text = 'WON' THEN d."id" END), 0)::int AS "avgCycleTime",
          COALESCE(SUM(d."dealValue"), 0)::float AS "pipelineValue",
          COUNT(DISTINCT da."id")::int / (EXTRACT(DAY FROM NOW() - MIN(d."createdAt")) / 7 + 1)::int AS "activitiesPerWeek"
        FROM "Staff" s
        LEFT JOIN "Deal" d ON d."ownerId" = s."id" AND d."createdAt" > NOW() - ($1 || ' days')::interval
        LEFT JOIN "DealActivity" da ON d."id" = da."dealId" AND da."createdAt" > NOW() - ($1 || ' days')::interval
        WHERE s."role"::text IN ('SALES_REP', 'MANAGER', 'ADMIN')
        GROUP BY s."id"
      ) sub
    `, ...params)

    const companyAvg = companyAverages[0] || {
      avgWinRate: 0,
      avgCycleTime: 0,
      avgPipelineValue: 0,
      avgActivitiesPerWeek: 0,
    }

    // ── Calculate scores and grades ──
    const scorecards = repMetrics.map(rep => {
      const winRate = (winRateMap[rep.staffId]?.winRate || 0) as number
      const cycleTime = cycleTimeMap[rep.staffId]?.avgCycleTime || 0
      const pipelineValueScore = Math.min(100, (rep.pipelineValue / (companyAvg.avgPipelineValue + 1)) * 100)
      const activityScore = Math.min(100, (rep.activitiesThisWeek / 5) * 100)
      const cycleTimeScore = cycleTime === 0 ? 100 : Math.max(0, 100 - (cycleTime / 60) * 100)

      // Weighted score: 30% win rate, 25% pipeline value, 20% activity, 15% cycle time, 10% quote conversion
      const score = Math.round(
        winRate * 0.3 +
        pipelineValueScore * 0.25 +
        activityScore * 0.2 +
        cycleTimeScore * 0.15 +
        50 * 0.1 // Base quote conversion
      )

      // Grade: A=90+, B=80-89, C=70-79, D=60-69, F=<60
      const grade = score >= 90 ? 'A' : score >= 80 ? 'B' : score >= 70 ? 'C' : score >= 60 ? 'D' : 'F'

      return {
        ...rep,
        winRate,
        avgCycleTime: cycleTime || 0,
        activeDeals: rep.activeDeals || 0,
        pipelineValue: rep.pipelineValue || 0,
        wonDeals30d: rep.wonDeals30d || 0,
        wonValue30d: rep.wonValue30d || 0,
        activitiesThisWeek: rep.activitiesThisWeek || 0,
        score,
        grade,
        trend: 'stable', // Could calculate vs previous period
      }
    })

    return safeJson({
      period,
      reps: scorecards,
      companyAverages: companyAvg,
    })
  } catch (error: any) {
    console.error('[Sales Scorecard] Error:', error)
    return NextResponse.json({ error: error.message || 'Scorecard failed' }, { status: 500 })
  }
}
