export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuthWithFallback } from '@/lib/api-auth'

// GET /api/ops/sales/analytics
// Sales analytics API powering /ops/sales/analytics page
// Query param: report=dashboard|forecast|win-loss|velocity|rep-performance (default: dashboard)
export async function GET(request: NextRequest) {
  const authError = await checkStaffAuthWithFallback(request)
  if (authError) return authError

  const url = new URL(request.url)
  const report = url.searchParams.get('report') || 'dashboard'

  try {
    switch (report) {
      case 'forecast':
        return await handleForecast()
      case 'win-loss':
        return await handleWinLoss()
      case 'velocity':
        return await handleVelocity()
      case 'rep-performance':
        return await handleRepPerformance()
      case 'dashboard':
      default:
        return await handleDashboard()
    }
  } catch (error: any) {
    console.error(`Error in sales analytics (${report}):`, error)
    return NextResponse.json(
      { error: `Failed to load ${report} analytics` },
      { status: 500 }
    )
  }
}

// ─── DASHBOARD: Overview metrics ──────────────────────────────────
async function handleDashboard() {
  // Total revenue (30d, 90d, YTD) — combines Invoice revenue + uninvoiced Order revenue
  const revenueMetrics: any[] = await prisma.$queryRawUnsafe(`
    WITH combined_revenue AS (
      SELECT i."total" AS amount, i."issuedAt" AS rev_date
      FROM "Invoice" i
      WHERE i."status"::text IN ('PAID', 'ISSUED', 'SENT', 'PARTIALLY_PAID')
      UNION ALL
      SELECT o."total" AS amount, o."orderDate" AS rev_date
      FROM "Order" o
      WHERE o."status"::text IN ('DELIVERED', 'COMPLETE', 'SHIPPED')
        AND o."id" NOT IN (SELECT "orderId" FROM "Invoice" WHERE "orderId" IS NOT NULL)
        AND o."isForecast" = false
    )
    SELECT
      COALESCE(SUM(CASE WHEN rev_date >= NOW() - INTERVAL '30 days' THEN amount ELSE 0 END), 0)::float AS "revenue30d",
      COALESCE(SUM(CASE WHEN rev_date >= NOW() - INTERVAL '90 days' THEN amount ELSE 0 END), 0)::float AS "revenue90d",
      COALESCE(SUM(CASE WHEN EXTRACT(YEAR FROM rev_date) = EXTRACT(YEAR FROM NOW()) THEN amount ELSE 0 END), 0)::float AS "revenueYTD"
    FROM combined_revenue
  `)

  // Deal count by status
  const dealCounts: any[] = await prisma.$queryRawUnsafe(`
    SELECT
      COUNT(CASE WHEN d."stage"::text = 'WON' THEN 1 END)::int AS "won",
      COUNT(CASE WHEN d."stage"::text = 'LOST' THEN 1 END)::int AS "lost",
      COUNT(CASE WHEN d."stage"::text NOT IN ('WON', 'LOST', 'ONBOARDED') THEN 1 END)::int AS "open",
      COUNT(CASE WHEN d."stage"::text IN ('PROSPECT', 'DISCOVERY') AND d."createdAt" < NOW() - INTERVAL '90 days' THEN 1 END)::int AS "stale"
    FROM "Deal" d
  `)

  // Quote conversion rate
  const quoteMetrics: any[] = await prisma.$queryRawUnsafe(`
    SELECT
      COUNT(*)::int AS "totalQuotes",
      COUNT(CASE WHEN q."status"::text = 'APPROVED' THEN 1 END)::int AS "acceptedQuotes"
    FROM "Quote" q
  `)

  // Average deal size
  const avgDealSize: any[] = await prisma.$queryRawUnsafe(`
    SELECT
      COALESCE(AVG(d."dealValue"), 0)::float AS "avgDealSize"
    FROM "Deal" d
    WHERE d."stage"::text = 'WON'
  `)

  // Top 5 reps by revenue
  const topReps: any[] = await prisma.$queryRawUnsafe(`
    SELECT
      s."firstName" || ' ' || s."lastName" AS "name",
      s."id",
      COUNT(d."id")::int AS "dealCount",
      COALESCE(SUM(CASE WHEN d."stage"::text = 'WON' THEN i."total" ELSE 0 END), 0)::float AS "revenue"
    FROM "Deal" d
    LEFT JOIN "Staff" s ON s."id" = d."ownerId"
    LEFT JOIN "Invoice" i ON i."builderId" = d."builderId" AND i."status"::text = 'PAID'
    WHERE s."active" = true AND s."role"::text = 'SALES'
    GROUP BY s."id", s."firstName", s."lastName"
    ORDER BY "revenue" DESC
    LIMIT 5
  `)

  const rev = revenueMetrics[0] || {}
  const deals = dealCounts[0] || {}
  const quotes = quoteMetrics[0] || {}
  const avgSize = avgDealSize[0] || {}

  return NextResponse.json({
    revenue: {
      last30Days: Number(rev.revenue30d) || 0,
      last90Days: Number(rev.revenue90d) || 0,
      yearToDate: Number(rev.revenueYTD) || 0,
    },
    dealCounts: {
      won: deals.won || 0,
      lost: deals.lost || 0,
      open: deals.open || 0,
      stale: deals.stale || 0,
    },
    quoteConversion: {
      total: quotes.totalQuotes || 0,
      accepted: quotes.acceptedQuotes || 0,
      conversionRate: quotes.totalQuotes
        ? ((quotes.acceptedQuotes / quotes.totalQuotes) * 100).toFixed(1)
        : '0.0',
    },
    avgDealSize: Number(avgSize.avgDealSize) || 0,
    topReps: topReps.map(r => ({
      repId: r.id,
      name: r.name,
      dealCount: r.dealCount || 0,
      revenue: Number(r.revenue) || 0,
    })),
  })
}

// ─── FORECAST: Revenue forecast ──────────────────────────────────
async function handleForecast() {
  // Monthly revenue actual (last 12 months) — invoices + uninvoiced orders
  const monthlyRevenue: any[] = await prisma.$queryRawUnsafe(`
    WITH combined AS (
      SELECT i."total" AS amount, i."issuedAt" AS rev_date
      FROM "Invoice" i
      WHERE i."status"::text IN ('PAID', 'ISSUED', 'SENT', 'PARTIALLY_PAID')
        AND i."issuedAt" >= NOW() - INTERVAL '12 months'
      UNION ALL
      SELECT o."total" AS amount, o."orderDate" AS rev_date
      FROM "Order" o
      WHERE o."status"::text IN ('DELIVERED', 'COMPLETE', 'SHIPPED')
        AND o."id" NOT IN (SELECT "orderId" FROM "Invoice" WHERE "orderId" IS NOT NULL)
        AND o."isForecast" = false
        AND o."orderDate" >= NOW() - INTERVAL '12 months'
    )
    SELECT
      TO_CHAR(rev_date::date, 'YYYY-MM') AS "month",
      COALESCE(SUM(amount), 0)::float AS "revenue"
    FROM combined
    GROUP BY TO_CHAR(rev_date::date, 'YYYY-MM')
    ORDER BY "month" ASC
  `)

  // Open pipeline value
  const openPipeline: any[] = await prisma.$queryRawUnsafe(`
    SELECT
      COALESCE(SUM(d."dealValue"), 0)::float AS "value"
    FROM "Deal" d
    WHERE d."stage"::text NOT IN ('WON', 'LOST')
  `)

  // Weighted pipeline (probability-adjusted)
  const weightedPipeline: any[] = await prisma.$queryRawUnsafe(`
    SELECT
      COALESCE(SUM(d."dealValue" * d."probability" / 100.0), 0)::float AS "value"
    FROM "Deal" d
    WHERE d."stage"::text NOT IN ('WON', 'LOST')
  `)

  // Monthly pipeline aging (deals created by month, still open)
  const pipelineAging: any[] = await prisma.$queryRawUnsafe(`
    SELECT
      TO_CHAR(d."createdAt"::date, 'YYYY-MM') AS "createdMonth",
      COUNT(*)::int AS "count",
      COALESCE(AVG(EXTRACT(DAY FROM (NOW() - d."createdAt"))::int), 0)::float AS "avgAgeDays"
    FROM "Deal" d
    WHERE d."stage"::text NOT IN ('WON', 'LOST')
    GROUP BY TO_CHAR(d."createdAt"::date, 'YYYY-MM')
    ORDER BY "createdMonth" DESC
    LIMIT 12
  `)

  const open = openPipeline[0] || {}
  const weighted = weightedPipeline[0] || {}

  return NextResponse.json({
    monthlyRevenue: monthlyRevenue.map(m => ({
      month: m.month,
      revenue: Number(m.revenue) || 0,
    })),
    openPipeline: {
      value: Number(open.value) || 0,
    },
    weightedPipeline: {
      value: Number(weighted.value) || 0,
    },
    pipelineAging: pipelineAging.map(p => ({
      createdMonth: p.createdMonth,
      dealCount: p.count || 0,
      avgAgeDays: Number(p.avgAgeDays) || 0,
    })),
  })
}

// ─── WIN/LOSS: Win/Loss analysis ────────────────────────────────
async function handleWinLoss() {
  // Win rate by month (last 6 months)
  const winRateByMonth: any[] = await prisma.$queryRawUnsafe(`
    SELECT
      TO_CHAR(d."actualCloseDate"::date, 'YYYY-MM') AS "month",
      COUNT(*)::int AS "total",
      COUNT(CASE WHEN d."stage"::text = 'WON' THEN 1 END)::int AS "won",
      CASE WHEN COUNT(*) > 0 THEN
        ROUND((COUNT(CASE WHEN d."stage"::text = 'WON' THEN 1 END)::float / COUNT(*)) * 100, 1)::float
      ELSE 0 END AS "winRate"
    FROM "Deal" d
    WHERE d."actualCloseDate" IS NOT NULL
      AND d."actualCloseDate" >= NOW() - INTERVAL '6 months'
    GROUP BY TO_CHAR(d."actualCloseDate"::date, 'YYYY-MM')
    ORDER BY "month" DESC
  `)

  // Loss reasons breakdown
  const lossReasons: any[] = await prisma.$queryRawUnsafe(`
    SELECT
      COALESCE(d."lostReason", 'Unknown') AS "reason",
      COUNT(*)::int AS "count"
    FROM "Deal" d
    WHERE d."stage"::text = 'LOST'
      AND d."lostDate" >= NOW() - INTERVAL '6 months'
    GROUP BY COALESCE(d."lostReason", 'Unknown')
    ORDER BY "count" DESC
  `)

  // Average sales cycle
  const avgCycle: any[] = await prisma.$queryRawUnsafe(`
    SELECT
      ROUND(AVG(EXTRACT(DAY FROM (d."actualCloseDate" - d."createdAt"))::int), 1)::float AS "avgDays"
    FROM "Deal" d
    WHERE d."stage"::text = 'WON' AND d."actualCloseDate" IS NOT NULL
  `)

  // Win rate by deal size bucket
  const winRateBySize: any[] = await prisma.$queryRawUnsafe(`
    SELECT
      CASE
        WHEN d."dealValue" < 10000 THEN '0-10K'
        WHEN d."dealValue" < 50000 THEN '10-50K'
        WHEN d."dealValue" < 100000 THEN '50-100K'
        ELSE '100K+'
      END AS "bucket",
      COUNT(*)::int AS "total",
      COUNT(CASE WHEN d."stage"::text = 'WON' THEN 1 END)::int AS "won",
      CASE WHEN COUNT(*) > 0 THEN
        ROUND((COUNT(CASE WHEN d."stage"::text = 'WON' THEN 1 END)::float / COUNT(*)) * 100, 1)::float
      ELSE 0 END AS "winRate"
    FROM "Deal" d
    WHERE d."createdAt" >= NOW() - INTERVAL '12 months'
    GROUP BY "bucket"
    ORDER BY
      CASE "bucket"
        WHEN '0-10K' THEN 1
        WHEN '10-50K' THEN 2
        WHEN '50-100K' THEN 3
        WHEN '100K+' THEN 4
      END
  `)

  const cycle = avgCycle[0] || {}

  return NextResponse.json({
    winRateByMonth: winRateByMonth.map(m => ({
      month: m.month,
      total: m.total || 0,
      won: m.won || 0,
      winRate: Number(m.winRate) || 0,
    })),
    lossReasons: lossReasons.map(l => ({
      reason: l.reason,
      count: l.count || 0,
    })),
    avgSalesCycleDays: Number(cycle.avgDays) || 0,
    winRateByDealSize: winRateBySize.map(w => ({
      bucket: w.bucket,
      total: w.total || 0,
      won: w.won || 0,
      winRate: Number(w.winRate) || 0,
    })),
  })
}

// ─── VELOCITY: Sales velocity ───────────────────────────────────
async function handleVelocity() {
  // Avg days in each deal stage
  const stageMetrics: any[] = await prisma.$queryRawUnsafe(`
    SELECT
      d."stage"::text AS "stage",
      COUNT(*)::int AS "dealCount",
      ROUND(AVG(EXTRACT(DAY FROM (NOW() - d."createdAt"))::int), 1)::float AS "avgDaysInStage"
    FROM "Deal" d
    WHERE d."stage"::text NOT IN ('WON', 'LOST')
    GROUP BY d."stage"::text
  `)

  // Conversion rate between stages (simple: stage progression)
  const stageProgression: any[] = await prisma.$queryRawUnsafe(`
    SELECT
      d."stage"::text AS "currentStage",
      COUNT(*)::int AS "dealCount"
    FROM "Deal" d
    GROUP BY d."stage"::text
    ORDER BY
      CASE d."stage"::text
        WHEN 'PROSPECT' THEN 1
        WHEN 'DISCOVERY' THEN 2
        WHEN 'WALKTHROUGH' THEN 3
        WHEN 'BID_SUBMITTED' THEN 4
        WHEN 'BID_REVIEW' THEN 5
        WHEN 'NEGOTIATION' THEN 6
        WHEN 'WON' THEN 7
        WHEN 'LOST' THEN 8
        WHEN 'ONBOARDED' THEN 9
        ELSE 0
      END
  `)

  return NextResponse.json({
    stageMetrics: stageMetrics.map(s => ({
      stage: s.stage,
      dealCount: s.dealCount || 0,
      avgDaysInStage: Number(s.avgDaysInStage) || 0,
    })),
    stageProgression: stageProgression.map(s => ({
      stage: s.currentStage,
      dealCount: s.dealCount || 0,
    })),
  })
}

// ─── REP PERFORMANCE: Per-rep metrics ───────────────────────────
async function handleRepPerformance() {
  const repMetrics: any[] = await prisma.$queryRawUnsafe(`
    SELECT
      s."id",
      s."firstName" || ' ' || s."lastName" AS "name",
      s."email",
      COUNT(d."id")::int AS "dealCount",
      COUNT(CASE WHEN d."stage"::text = 'WON' THEN 1 END)::int AS "wonCount",
      CASE WHEN COUNT(d."id") > 0 THEN
        ROUND((COUNT(CASE WHEN d."stage"::text = 'WON' THEN 1 END)::float / COUNT(d."id")) * 100, 1)::float
      ELSE 0 END AS "winRate",
      COALESCE(AVG(CASE WHEN d."stage"::text = 'WON' THEN d."dealValue" ELSE NULL END), 0)::float AS "avgDealSize",
      ROUND(AVG(CASE WHEN d."stage"::text = 'WON' AND d."actualCloseDate" IS NOT NULL
        THEN EXTRACT(DAY FROM (d."actualCloseDate" - d."createdAt"))::int
        ELSE NULL
      END), 1)::float AS "avgCycleDays",
      COALESCE(SUM(CASE WHEN d."stage"::text = 'WON' THEN i."total" ELSE 0 END), 0)::float AS "revenue"
    FROM "Staff" s
    LEFT JOIN "Deal" d ON d."ownerId" = s."id"
    LEFT JOIN "Invoice" i ON i."builderId" = d."builderId" AND i."status"::text = 'PAID'
    WHERE s."role"::text LIKE '%SALES%'
      AND s."active" = true
    GROUP BY s."id", s."firstName", s."lastName", s."email"
    ORDER BY "revenue" DESC
  `)

  return NextResponse.json({
    repMetrics: repMetrics.map(r => ({
      repId: r.id,
      name: r.name,
      email: r.email,
      dealCount: r.dealCount || 0,
      wonCount: r.wonCount || 0,
      winRate: Number(r.winRate) || 0,
      avgDealSize: Number(r.avgDealSize) || 0,
      avgCycleDays: Number(r.avgCycleDays) || 0,
      revenue: Number(r.revenue) || 0,
    })),
  })
}
