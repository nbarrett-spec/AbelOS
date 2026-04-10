export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'

// GET /api/ops/sales/analytics?report=<type>
export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const { searchParams } = new URL(request.url)
    const report = searchParams.get('report') || 'forecast'

    if (report === 'forecast') {
      return await handleForecast()
    } else if (report === 'win_loss') {
      return await handleWinLoss()
    } else if (report === 'rep_scorecard') {
      return await handleRepScorecard()
    } else if (report === 'velocity') {
      return await handleVelocity()
    } else {
      return NextResponse.json({ error: 'Invalid report type' }, { status: 400 })
    }
  } catch (error: any) {
    console.error('Analytics error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// ─── FORECAST ───────────────────────────────────────────────────────────

async function handleForecast() {
  try {
    // Weighted pipeline: sum of dealValue * (probability / 100) for active deals
    const activeStages = ["PROSPECT", "DISCOVERY", "WALKTHROUGH", "BID_SUBMITTED", "BID_REVIEW", "NEGOTIATION"]
    const activeStagesStr = activeStages.map(s => `'${s}'`).join(',')

    const pipelineResult: any[] = await prisma.$queryRawUnsafe(
      `SELECT COALESCE(SUM(d."dealValue" * (d."probability" / 100.0)), 0) AS "weightedPipeline"
       FROM "Deal" d
       WHERE d."stage"::text IN (${activeStagesStr})`
    )
    const weightedPipeline = parseFloat(pipelineResult[0]?.weightedPipeline || 0)

    // Project monthly closes based on expectedCloseDate
    const now = new Date()
    const month1Start = new Date(now.getFullYear(), now.getMonth(), 1)
    const month1End = new Date(now.getFullYear(), now.getMonth() + 1, 0)
    const month2Start = new Date(now.getFullYear(), now.getMonth() + 1, 1)
    const month2End = new Date(now.getFullYear(), now.getMonth() + 2, 0)
    const month3Start = new Date(now.getFullYear(), now.getMonth() + 2, 1)
    const month3End = new Date(now.getFullYear(), now.getMonth() + 3, 0)

    const projectionResult: any[] = await prisma.$queryRawUnsafe(
      `SELECT
        COALESCE(SUM(CASE WHEN d."expectedCloseDate" >= $1 AND d."expectedCloseDate" <= $2 AND d."stage"::text IN (${activeStagesStr}) THEN d."dealValue" * (d."probability" / 100.0) ELSE 0 END), 0) AS "month1",
        COALESCE(SUM(CASE WHEN d."expectedCloseDate" >= $3 AND d."expectedCloseDate" <= $4 AND d."stage"::text IN (${activeStagesStr}) THEN d."dealValue" * (d."probability" / 100.0) ELSE 0 END), 0) AS "month2",
        COALESCE(SUM(CASE WHEN d."expectedCloseDate" >= $5 AND d."expectedCloseDate" <= $6 AND d."stage"::text IN (${activeStagesStr}) THEN d."dealValue" * (d."probability" / 100.0) ELSE 0 END), 0) AS "month3"
       FROM "Deal" d`,
      month1Start,
      month1End,
      month2Start,
      month2End,
      month3Start,
      month3End
    )
    const projectedRevenue = {
      month1: parseFloat(projectionResult[0]?.month1 || 0),
      month2: parseFloat(projectionResult[0]?.month2 || 0),
      month3: parseFloat(projectionResult[0]?.month3 || 0),
    }

    // Average deal size and days to close
    const statsResult: any[] = await prisma.$queryRawUnsafe(
      `SELECT
        COALESCE(AVG(d."dealValue"), 0) AS "avgDealSize",
        COALESCE(AVG(EXTRACT(DAY FROM (d."actualCloseDate" - d."createdAt"))), 0) AS "avgDaysToClose"
       FROM "Deal" d
       WHERE d."stage"::text IN ('WON', 'LOST', 'ONBOARDED')`
    )
    const avgDealSize = parseFloat(statsResult[0]?.avgDealSize || 0)
    const avgDaysToClose = Math.round(parseFloat(statsResult[0]?.avgDaysToClose || 0))

    return NextResponse.json({
      report: 'forecast',
      weightedPipeline: Math.round(weightedPipeline * 100) / 100,
      projectedRevenue,
      avgDealSize: Math.round(avgDealSize * 100) / 100,
      avgDaysToClose,
    })
  } catch (error: any) {
    console.error('Forecast error:', error)
    throw error
  }
}

// ─── WIN/LOSS ───────────────────────────────────────────────────────────

async function handleWinLoss() {
  try {
    // Overall win rate
    const winLossResult: any[] = await prisma.$queryRawUnsafe(
      `SELECT
        COUNT(*) FILTER (WHERE "stage"::text = 'WON')::int AS "won",
        COUNT(*) FILTER (WHERE "stage"::text = 'LOST')::int AS "lost"
       FROM "Deal"`
    )
    const won = winLossResult[0]?.won || 0
    const lost = winLossResult[0]?.lost || 0
    const winRate = won + lost > 0 ? Math.round((won / (won + lost)) * 100) : 0

    // Average deal size for wins vs losses
    const avgValuesResult: any[] = await prisma.$queryRawUnsafe(
      `SELECT
        COALESCE(AVG(d."dealValue") FILTER (WHERE d."stage"::text = 'WON'), 0) AS "avgWinValue",
        COALESCE(AVG(d."dealValue") FILTER (WHERE d."stage"::text = 'LOST'), 0) AS "avgLossValue"
       FROM "Deal" d`
    )
    const avgWinValue = parseFloat(avgValuesResult[0]?.avgWinValue || 0)
    const avgLossValue = parseFloat(avgValuesResult[0]?.avgLossValue || 0)

    // By source
    const bySourceResult: any[] = await prisma.$queryRawUnsafe(
      `SELECT
        d."source"::text AS "source",
        COUNT(*) FILTER (WHERE d."stage"::text = 'WON')::int AS "won",
        COUNT(*) FILTER (WHERE d."stage"::text = 'LOST')::int AS "lost",
        COUNT(*)::int AS "total"
       FROM "Deal" d
       WHERE d."stage"::text IN ('WON', 'LOST')
       GROUP BY d."source"::text
       ORDER BY "total" DESC`
    )

    const bySource = bySourceResult.map(row => ({
      source: row.source,
      won: row.won,
      lost: row.lost,
      total: row.total,
      winRate: row.total > 0 ? Math.round((row.won / row.total) * 100) : 0,
    }))

    // By rep
    const byRepResult: any[] = await prisma.$queryRawUnsafe(
      `SELECT
        d."ownerId",
        s."firstName",
        s."lastName",
        COUNT(*) FILTER (WHERE d."stage"::text = 'WON')::int AS "won",
        COUNT(*) FILTER (WHERE d."stage"::text = 'LOST')::int AS "lost",
        COUNT(*)::int AS "total"
       FROM "Deal" d
       LEFT JOIN "Staff" s ON s."id" = d."ownerId"
       WHERE d."stage"::text IN ('WON', 'LOST')
       GROUP BY d."ownerId", s."firstName", s."lastName"
       ORDER BY "won" DESC`
    )

    const byRep = byRepResult.map(row => ({
      repId: row.ownerId,
      repName: `${row.firstName} ${row.lastName}`,
      won: row.won,
      lost: row.lost,
      total: row.total,
      winRate: row.total > 0 ? Math.round((row.won / row.total) * 100) : 0,
    }))

    // By quarter
    const byQuarterResult: any[] = await prisma.$queryRawUnsafe(
      `SELECT
        CONCAT('Q', CEIL(EXTRACT(MONTH FROM d."updatedAt") / 3.0)::int, ' ', EXTRACT(YEAR FROM d."updatedAt")::int) AS "quarter",
        COUNT(*) FILTER (WHERE d."stage"::text = 'WON')::int AS "won",
        COUNT(*) FILTER (WHERE d."stage"::text = 'LOST')::int AS "lost",
        COUNT(*)::int AS "total"
       FROM "Deal" d
       WHERE d."stage"::text IN ('WON', 'LOST')
       GROUP BY CEIL(EXTRACT(MONTH FROM d."updatedAt") / 3.0), EXTRACT(YEAR FROM d."updatedAt")
       ORDER BY EXTRACT(YEAR FROM d."updatedAt") DESC, CEIL(EXTRACT(MONTH FROM d."updatedAt") / 3.0) DESC`
    )

    const byQuarter = byQuarterResult.map(row => ({
      quarter: row.quarter,
      won: row.won,
      lost: row.lost,
      total: row.total,
      winRate: row.total > 0 ? Math.round((row.won / row.total) * 100) : 0,
    }))

    // Top loss reasons
    const lossReasonsResult: any[] = await prisma.$queryRawUnsafe(
      `SELECT
        d."lostReason",
        COUNT(*)::int AS "count"
       FROM "Deal" d
       WHERE d."stage"::text = 'LOST' AND d."lostReason" IS NOT NULL
       GROUP BY d."lostReason"
       ORDER BY "count" DESC
       LIMIT 5`
    )

    const topLossReasons = lossReasonsResult.map(row => ({
      reason: row.lostReason,
      count: row.count,
    }))

    return NextResponse.json({
      report: 'win_loss',
      winRate,
      avgWinValue: Math.round(avgWinValue * 100) / 100,
      avgLossValue: Math.round(avgLossValue * 100) / 100,
      totalWon: won,
      totalLost: lost,
      bySource,
      byRep,
      byQuarter,
      topLossReasons,
    })
  } catch (error: any) {
    console.error('Win/Loss error:', error)
    throw error
  }
}

// ─── REP SCORECARD ──────────────────────────────────────────────────────

async function handleRepScorecard() {
  try {
    const repsResult: any[] = await prisma.$queryRawUnsafe(
      `SELECT
        d."ownerId",
        s."firstName",
        s."lastName",
        COUNT(*)::int AS "totalDeals",
        COUNT(*) FILTER (WHERE d."stage"::text NOT IN ('WON', 'LOST', 'ONBOARDED'))::int AS "activeDeals",
        COUNT(*) FILTER (WHERE d."stage"::text = 'WON')::int AS "wonDeals",
        COUNT(*) FILTER (WHERE d."stage"::text = 'LOST')::int AS "lostDeals",
        COALESCE(SUM(CASE WHEN d."stage"::text NOT IN ('WON', 'LOST', 'ONBOARDED') THEN d."dealValue" * (d."probability" / 100.0) ELSE 0 END), 0) AS "pipelineValue",
        COALESCE(SUM(CASE WHEN d."stage"::text = 'WON' THEN d."dealValue" ELSE 0 END), 0) AS "wonValue",
        COALESCE(AVG(EXTRACT(DAY FROM (d."actualCloseDate" - d."createdAt"))), 0) AS "avgDaysToClose"
       FROM "Deal" d
       LEFT JOIN "Staff" s ON s."id" = d."ownerId"
       WHERE d."ownerId" IS NOT NULL
       GROUP BY d."ownerId", s."firstName", s."lastName"
       ORDER BY "wonValue" DESC`
    )

    const scorecardsPromises = repsResult.map(async (rep) => {
      const winRate = rep.totalDeals > 0 ? Math.round((rep.wonDeals / rep.totalDeals) * 100) : 0

      // Activity count in last 30 days
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
      const activitiesResult: any[] = await prisma.$queryRawUnsafe(
        `SELECT COUNT(*)::int AS "count" FROM "DealActivity"
         WHERE "staffId" = $1 AND "createdAt" >= $2`,
        rep.ownerId,
        thirtyDaysAgo
      )
      const activityCount = activitiesResult[0]?.count || 0

      // Deals by stage
      const stagesResult: any[] = await prisma.$queryRawUnsafe(
        `SELECT
          d."stage"::text AS "stage",
          COUNT(*)::int AS "count"
         FROM "Deal" d
         WHERE d."ownerId" = $1
         GROUP BY d."stage"::text
         ORDER BY "count" DESC`,
        rep.ownerId
      )

      const dealsByStage = stagesResult.reduce((acc: any, row: any) => {
        acc[row.stage] = row.count
        return acc
      }, {})

      return {
        repId: rep.ownerId,
        repName: `${rep.firstName} ${rep.lastName}`,
        totalDeals: rep.totalDeals,
        activeDeals: rep.activeDeals,
        wonDeals: rep.wonDeals,
        lostDeals: rep.lostDeals,
        winRate,
        pipelineValue: Math.round(parseFloat(rep.pipelineValue) * 100) / 100,
        wonValue: Math.round(parseFloat(rep.wonValue) * 100) / 100,
        avgDaysToClose: Math.round(parseFloat(rep.avgDaysToClose)),
        activityCountLast30: activityCount,
        dealsByStage,
      }
    })

    const scorecards = await Promise.all(scorecardsPromises)

    return NextResponse.json({
      report: 'rep_scorecard',
      scorecards,
    })
  } catch (error: any) {
    console.error('Rep Scorecard error:', error)
    throw error
  }
}

// ─── VELOCITY ───────────────────────────────────────────────────────────

async function handleVelocity() {
  try {
    // Monthly velocity metrics
    const monthlyResult: any[] = await prisma.$queryRawUnsafe(
      `SELECT
        CONCAT(TO_CHAR(d."createdAt", 'YYYY-MM')) AS "month",
        COUNT(*)::int AS "opportunities",
        COALESCE(AVG(d."dealValue"), 0) AS "avgDealValue",
        COALESCE(AVG(CASE WHEN d."stage"::text = 'WON' THEN 1 WHEN d."stage"::text = 'LOST' THEN 0 ELSE NULL END), 0) AS "winRate",
        COALESCE(AVG(EXTRACT(DAY FROM (d."actualCloseDate" - d."createdAt"))), 30) AS "avgCycleLength"
       FROM "Deal" d
       GROUP BY TO_CHAR(d."createdAt", 'YYYY-MM')
       ORDER BY "month" DESC
       LIMIT 12`
    )

    const velocity = monthlyResult.map(row => {
      const opportunities = row.opportunities
      const avgDealValue = parseFloat(row.avgDealValue || 0)
      const winRate = parseFloat(row.winRate || 0)
      const avgCycleLength = Math.max(1, parseFloat(row.avgCycleLength || 30))

      const salesVelocity =
        opportunities > 0 && avgDealValue > 0 && avgCycleLength > 0
          ? Math.round((opportunities * avgDealValue * winRate) / avgCycleLength * 100) / 100
          : 0

      return {
        month: row.month,
        opportunities,
        avgDealValue: Math.round(avgDealValue * 100) / 100,
        winRate: Math.round(winRate * 10000) / 100, // Convert to percentage
        avgCycleLength: Math.round(avgCycleLength),
        salesVelocity,
      }
    })

    // Current month overall
    const now = new Date()
    const monthStr = now.toISOString().slice(0, 7)
    const currentMonth = velocity.find(v => v.month === monthStr) || {
      month: monthStr,
      opportunities: 0,
      avgDealValue: 0,
      winRate: 0,
      avgCycleLength: 0,
      salesVelocity: 0,
    }

    return NextResponse.json({
      report: 'velocity',
      currentMonth,
      monthlyTrend: velocity,
    })
  } catch (error: any) {
    console.error('Velocity error:', error)
    throw error
  }
}
