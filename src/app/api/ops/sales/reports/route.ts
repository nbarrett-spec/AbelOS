export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'

// GET /api/ops/sales/reports — Comprehensive sales analytics with filtering
export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const searchParams = request.nextUrl.searchParams
    const period = searchParams.get('period') || 'this_month'
    const ownerId = searchParams.get('ownerId')

    // Compute start date based on period
    const now = new Date()
    let startDate = new Date()

    if (period === 'this_month') {
      startDate = new Date(now.getFullYear(), now.getMonth(), 1)
    } else if (period === 'this_quarter') {
      const quarter = Math.floor(now.getMonth() / 3)
      startDate = new Date(now.getFullYear(), quarter * 3, 1)
    } else if (period === 'this_year') {
      startDate = new Date(now.getFullYear(), 0, 1)
    } else if (period === 'all_time') {
      startDate = new Date('2000-01-01')
    }

    // Build parameterized filters
    const conditions: string[] = ['1=1']
    const params: any[] = []
    let pi = 1

    // Period filter
    conditions.push(`d."createdAt" >= $${pi}`)
    params.push(startDate)
    pi++

    // Owner filter
    if (ownerId) {
      conditions.push(`d."ownerId" = $${pi}`)
      params.push(ownerId)
      pi++
    }

    const whereClause = conditions.join(' AND ')

    // 1. Summary metrics
    const summaryResult: any[] = await prisma.$queryRawUnsafe(
      `SELECT
        COUNT(*)::int AS "totalDeals",
        COALESCE(SUM(d."dealValue"), 0) AS "totalPipelineValue",
        COUNT(*) FILTER (WHERE d."stage"::text = 'WON')::int AS "wonDeals",
        COALESCE(SUM(d."dealValue") FILTER (WHERE d."stage"::text = 'WON'), 0) AS "wonValue",
        COUNT(*) FILTER (WHERE d."stage"::text = 'LOST')::int AS "lostDeals",
        COUNT(*) FILTER (WHERE d."stage"::text IN ('WON', 'LOST'))::int AS "closedDeals"
       FROM "Deal" d
       WHERE ${whereClause}`,
      ...params
    )

    const summary = summaryResult[0] || {
      totalDeals: 0,
      totalPipelineValue: 0,
      wonDeals: 0,
      wonValue: 0,
      lostDeals: 0,
      closedDeals: 0,
    }

    const avgDealSize =
      summary.totalDeals > 0 ? summary.totalPipelineValue / summary.totalDeals : 0

    const winRate =
      summary.closedDeals > 0
        ? Math.round((summary.wonDeals / summary.closedDeals) * 100)
        : 0

    // Average days to close
    const daysToCloseResult: any[] = await prisma.$queryRawUnsafe(
      `SELECT
        COALESCE(AVG(EXTRACT(DAY FROM (d."actualCloseDate" - d."createdAt"))), 0) AS "avgDaysToClose"
       FROM "Deal" d
       WHERE d."stage"::text = 'WON' AND d."actualCloseDate" IS NOT NULL
       AND ${whereClause}`,
      ...params
    )

    const avgDaysToClose = Math.round(daysToCloseResult[0]?.avgDaysToClose || 0)

    // 2. Pipeline by stage
    const pipelineByStage: any[] = await prisma.$queryRawUnsafe(
      `SELECT
        d."stage",
        COUNT(*)::int AS count,
        COALESCE(SUM(d."dealValue"), 0) AS value
       FROM "Deal" d
       WHERE ${whereClause}
       GROUP BY d."stage"
       ORDER BY d."stage"`,
      ...params
    )

    const pipeline = pipelineByStage.map((row) => ({
      stage: row.stage,
      count: row.count,
      value: parseFloat(row.value),
    }))

    // 3. Deals by source
    const dealsBySource: any[] = await prisma.$queryRawUnsafe(
      `SELECT
        d."source",
        COUNT(*)::int AS count,
        COALESCE(SUM(d."dealValue"), 0) AS value,
        COUNT(*) FILTER (WHERE d."stage"::text = 'WON')::int AS "wonCount"
       FROM "Deal" d
       WHERE ${whereClause}
       GROUP BY d."source"
       ORDER BY count DESC`,
      ...params
    )

    const bySource = dealsBySource.map((row) => ({
      source: row.source,
      count: row.count,
      value: parseFloat(row.value),
      wonCount: row.wonCount,
    }))

    // 4. Performance by rep (only uses periodFilter, not ownerFilter)
    const repConditions = [`d."ownerId" IS NOT NULL`, `d."createdAt" >= $1`]
    const repParams = [startDate]

    const repPerformance: any[] = await prisma.$queryRawUnsafe(
      `SELECT
        d."ownerId",
        s."firstName",
        s."lastName",
        COUNT(*)::int AS "totalDeals",
        COUNT(*) FILTER (WHERE d."stage"::text = 'WON')::int AS "wonDeals",
        COALESCE(SUM(d."dealValue") FILTER (WHERE d."stage"::text NOT IN ('WON', 'LOST', 'ONBOARDED')), 0) AS "pipelineValue",
        COALESCE(SUM(d."dealValue") FILTER (WHERE d."stage"::text = 'WON'), 0) AS "wonValue"
       FROM "Deal" d
       LEFT JOIN "Staff" s ON s."id" = d."ownerId"
       WHERE ${repConditions.join(' AND ')}
       GROUP BY d."ownerId", s."firstName", s."lastName"
       ORDER BY "wonValue" DESC`,
      ...repParams
    )

    const byRep = repPerformance.map((row) => {
      const repWinRate =
        row.totalDeals > 0
          ? Math.round((row.wonDeals / row.totalDeals) * 100)
          : 0
      return {
        repId: row.ownerId,
        repName: `${row.firstName || ''} ${row.lastName || ''}`.trim(),
        totalDeals: row.totalDeals,
        wonDeals: row.wonDeals,
        pipelineValue: parseFloat(row.pipelineValue),
        wonValue: parseFloat(row.wonValue),
        winRate: repWinRate,
      }
    })

    // 5. Monthly trend
    const monthlyTrendResult: any[] = await prisma.$queryRawUnsafe(
      `SELECT
        DATE_TRUNC('month', d."createdAt")::date AS month,
        COUNT(*) FILTER (WHERE d."stage"::text NOT IN ('WON', 'LOST'))::int AS "newDeals",
        COUNT(*) FILTER (WHERE d."stage"::text = 'WON' AND d."actualCloseDate" >= DATE_TRUNC('month', d."createdAt"))::int AS "wonDeals",
        COUNT(*) FILTER (WHERE d."stage"::text = 'LOST' AND d."lostDate" >= DATE_TRUNC('month', d."createdAt"))::int AS "lostDeals",
        COALESCE(SUM(d."dealValue") FILTER (WHERE d."stage"::text = 'WON' AND d."actualCloseDate" >= DATE_TRUNC('month', d."createdAt")), 0) AS "wonValue"
       FROM "Deal" d
       WHERE ${whereClause}
       GROUP BY DATE_TRUNC('month', d."createdAt")
       ORDER BY month DESC
       LIMIT 12`,
      ...params
    )

    const monthlyTrend = monthlyTrendResult.map((row) => ({
      month: row.month ? new Date(row.month).toISOString().split('T')[0] : '',
      newDeals: row.newDeals,
      wonDeals: row.wonDeals,
      lostDeals: row.lostDeals,
      wonValue: parseFloat(row.wonValue),
    }))

    // 6. Recent wins (only period filter, no owner filter)
    const recentWins: any[] = await prisma.$queryRawUnsafe(
      `SELECT
        d."id",
        d."companyName",
        d."dealValue",
        d."actualCloseDate"
       FROM "Deal" d
       WHERE d."stage"::text = 'WON' AND d."createdAt" >= $1
       ORDER BY d."actualCloseDate" DESC
       LIMIT 10`,
      startDate
    )

    const recentWinsData = recentWins.map((row) => ({
      id: row.id,
      companyName: row.companyName,
      dealValue: parseFloat(row.dealValue),
      actualCloseDate: row.actualCloseDate ? new Date(row.actualCloseDate).toISOString().split('T')[0] : '',
    }))

    return NextResponse.json({
      summary: {
        totalDeals: summary.totalDeals,
        totalPipelineValue: parseFloat(summary.totalPipelineValue),
        wonDeals: summary.wonDeals,
        wonValue: parseFloat(summary.wonValue),
        lostDeals: summary.lostDeals,
        avgDealSize: parseFloat(String(avgDealSize)),
        winRate,
        avgDaysToClose,
      },
      pipeline,
      bySource,
      byRep,
      monthlyTrend,
      recentWins: recentWinsData,
    })
  } catch (error: any) {
    console.error('Sales reports error:', error)
    return NextResponse.json(
      { error: 'Failed to generate reports' },
      { status: 500 }
    )
  }
}
