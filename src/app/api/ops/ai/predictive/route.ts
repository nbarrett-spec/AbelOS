export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { checkStaffAuth } from '@/lib/api-auth'
import { safeJson } from '@/lib/safe-json'

// AI Predictive Analytics Engine
// Revenue forecasting, demand prediction, seasonal patterns,
// builder behavior prediction, cash flow projection

export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const { searchParams } = new URL(request.url);
    const report = searchParams.get('report') || 'dashboard';

    switch (report) {
      case 'dashboard': return await getDashboard();
      case 'revenue-forecast': return await getRevenueForecast();
      case 'demand-prediction': return await getDemandPrediction();
      case 'seasonal-patterns': return await getSeasonalPatterns();
      case 'builder-predictions': return await getBuilderPredictions();
      case 'cash-flow': return await getCashFlowProjection();
      default: return NextResponse.json({ error: 'Unknown report' }, { status: 400 });
    }
  } catch (error: any) {
    console.error('Predictive analytics error:', error);
    return safeJson({ error: 'Internal server error' }, { status: 500 });
  }
}

async function getDashboard() {
  // Current period vs previous period comparison
  const periodComparison: any[] = await prisma.$queryRawUnsafe(`
    SELECT
      -- This month
      COALESCE(SUM(CASE WHEN "createdAt" >= DATE_TRUNC('month', NOW()) THEN total ELSE 0 END), 0) as "thisMonthRevenue",
      COUNT(CASE WHEN "createdAt" >= DATE_TRUNC('month', NOW()) THEN 1 END) as "thisMonthOrders",
      -- Last month
      COALESCE(SUM(CASE WHEN "createdAt" >= DATE_TRUNC('month', NOW() - INTERVAL '1 month')
        AND "createdAt" < DATE_TRUNC('month', NOW()) THEN total ELSE 0 END), 0) as "lastMonthRevenue",
      COUNT(CASE WHEN "createdAt" >= DATE_TRUNC('month', NOW() - INTERVAL '1 month')
        AND "createdAt" < DATE_TRUNC('month', NOW()) THEN 1 END) as "lastMonthOrders",
      -- This quarter
      COALESCE(SUM(CASE WHEN "createdAt" >= DATE_TRUNC('quarter', NOW()) THEN total ELSE 0 END), 0) as "thisQuarterRevenue",
      -- Last quarter
      COALESCE(SUM(CASE WHEN "createdAt" >= DATE_TRUNC('quarter', NOW() - INTERVAL '3 months')
        AND "createdAt" < DATE_TRUNC('quarter', NOW()) THEN total ELSE 0 END), 0) as "lastQuarterRevenue",
      -- YTD
      COALESCE(SUM(CASE WHEN "createdAt" >= DATE_TRUNC('year', NOW()) THEN total ELSE 0 END), 0) as "ytdRevenue",
      -- Last year same period
      COALESCE(SUM(CASE WHEN "createdAt" >= DATE_TRUNC('year', NOW() - INTERVAL '1 year')
        AND "createdAt" < NOW() - INTERVAL '1 year' THEN total ELSE 0 END), 0) as "lastYearSamePeriod"
    FROM "Order"
    WHERE status::text != 'CANCELLED'
  `);

  // Pipeline confidence
  const pipeline: any[] = await prisma.$queryRawUnsafe(`
    SELECT
      COUNT(*)::int as "activeQuotes",
      ROUND(COALESCE(SUM("total"), 0)::numeric, 2) as "pipelineValue",
      -- Historical conversion rate as confidence
      ROUND(
        (SELECT COUNT(*)::numeric FROM "Quote" WHERE status IN ('APPROVED', 'ORDERED')) /
        NULLIF((SELECT COUNT(*)::numeric FROM "Quote" WHERE status IN ('APPROVED', 'ORDERED', 'REJECTED', 'EXPIRED')), 0) * 100
      , 1) as "conversionRate",
      -- Weighted pipeline = value * conversion rate
      ROUND(
        (COALESCE(SUM("total"), 0) *
        COALESCE(
          (SELECT COUNT(*)::numeric FROM "Quote" WHERE status IN ('APPROVED', 'ORDERED')) /
          NULLIF((SELECT COUNT(*)::numeric FROM "Quote" WHERE status IN ('APPROVED', 'ORDERED', 'REJECTED', 'EXPIRED')), 0)
        , 0))::numeric, 2) as "weightedPipeline"
    FROM "Quote"
    WHERE status IN ('DRAFT', 'SENT')
  `);

  // Growth trajectory (month over month)
  const trajectory: any[] = await prisma.$queryRawUnsafe(`
    SELECT
      DATE_TRUNC('month', "createdAt") as month,
      ROUND(SUM(total)::numeric, 2) as revenue,
      COUNT(*)::int as orders
    FROM "Order"
    WHERE status != 'CANCELLED' AND "createdAt" > NOW() - INTERVAL '6 months'
    GROUP BY DATE_TRUNC('month', "createdAt")
    ORDER BY month ASC
  `);

  // Calculate growth rate
  let growthRate = 0;
  if (trajectory.length >= 2) {
    const recent = Number(trajectory[trajectory.length - 1]?.revenue || 0);
    const previous = Number(trajectory[trajectory.length - 2]?.revenue || 0);
    if (previous > 0) growthRate = Math.round(((recent - previous) / previous) * 10000) / 100;
  }

  const pc = periodComparison[0] || {};
  const pl = pipeline[0] || {};

  return safeJson({
    report: 'dashboard',
    generatedAt: new Date().toISOString(),
    currentPeriod: pc,
    pipeline: pl,
    trajectory,
    growthRate,
    // Simple linear forecast: project current month based on daily rate
    projectedMonthEnd: (() => {
      const dayOfMonth = new Date().getDate();
      const daysInMonth = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate();
      const dailyRate = Number(pc.thisMonthRevenue || 0) / Math.max(1, dayOfMonth);
      return Math.round(dailyRate * daysInMonth * 100) / 100;
    })(),
  });
}

async function getRevenueForecast() {
  // Historical monthly revenue for trend line
  const monthly: any[] = await prisma.$queryRawUnsafe(`
    SELECT
      DATE_TRUNC('month', "createdAt") as month,
      ROUND(SUM(total)::numeric, 2) as revenue,
      COUNT(*)::int as orders,
      COUNT(DISTINCT "builderId")::int as "uniqueBuilders",
      ROUND(AVG(total)::numeric, 2) as "avgOrderValue"
    FROM "Order"
    WHERE status::text != 'CANCELLED' AND "createdAt" > NOW() - INTERVAL '24 months'
    GROUP BY DATE_TRUNC('month', "createdAt")
    ORDER BY month ASC
  `);

  // Calculate simple moving average and project forward
  const values = monthly.map(m => Number(m.revenue));
  const forecast: any[] = [];

  if (values.length >= 3) {
    // 3-month moving average
    const lastThree = values.slice(-3);
    const movingAvg = lastThree.reduce((a, b) => a + b, 0) / 3;

    // Simple linear trend from last 6 months
    const recentValues = values.slice(-6);
    let trend = 0;
    if (recentValues.length >= 2) {
      const firstHalf = recentValues.slice(0, Math.floor(recentValues.length / 2));
      const secondHalf = recentValues.slice(Math.floor(recentValues.length / 2));
      const firstAvg = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
      const secondAvg = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;
      trend = (secondAvg - firstAvg) / firstHalf.length;
    }

    // Project 6 months forward
    const lastMonth = new Date(monthly[monthly.length - 1]?.month || new Date());
    for (let i = 1; i <= 6; i++) {
      const futureMonth = new Date(lastMonth);
      futureMonth.setMonth(futureMonth.getMonth() + i);

      const projected = movingAvg + trend * i;
      const optimistic = projected * 1.15;
      const pessimistic = projected * 0.85;

      forecast.push({
        month: futureMonth.toISOString(),
        projected: Math.round(Math.max(0, projected) * 100) / 100,
        optimistic: Math.round(Math.max(0, optimistic) * 100) / 100,
        pessimistic: Math.round(Math.max(0, pessimistic) * 100) / 100,
        type: 'forecast',
      });
    }
  }

  return safeJson({
    report: 'revenue-forecast',
    generatedAt: new Date().toISOString(),
    historical: monthly.map(m => ({ ...m, type: 'actual' })),
    forecast,
    model: {
      type: 'Moving Average + Linear Trend',
      confidence: 'Medium',
      basedOn: `${monthly.length} months of data`,
    },
  });
}

async function getDemandPrediction() {
  // Category demand trends
  const categoryDemand: any[] = await prisma.$queryRawUnsafe(`
    SELECT
      p.category,
      DATE_TRUNC('month', o."createdAt") as month,
      SUM(oi.quantity)::float as "unitsSold",
      ROUND(SUM(oi."lineTotal")::numeric, 2) as revenue,
      COUNT(DISTINCT o."builderId")::int as "uniqueBuyers"
    FROM "OrderItem" oi
    JOIN "Order" o ON oi."orderId" = o.id
    JOIN "Product" p ON oi."productId" = p.id
    WHERE o.status::text != 'CANCELLED' AND o."createdAt" > NOW() - INTERVAL '12 months'
    GROUP BY p.category, DATE_TRUNC('month', o."createdAt")
    ORDER BY p.category, month ASC
  `);

  // Group by category with trends
  const categoryMap: Record<string, any[]> = {};
  for (const row of categoryDemand) {
    const cat = row.category || 'Uncategorized';
    if (!categoryMap[cat]) categoryMap[cat] = [];
    categoryMap[cat].push(row);
  }

  const categoryForecasts = Object.entries(categoryMap).map(([category, months]) => {
    const recentUnits = months.slice(-3).reduce((s, m) => s + Number(m.unitsSold || 0), 0);
    const olderUnits = months.slice(-6, -3).reduce((s, m) => s + Number(m.unitsSold || 0), 0);
    const trend = olderUnits > 0 ? ((recentUnits - olderUnits) / olderUnits * 100) : 0;

    return {
      category,
      monthlyData: months,
      avgMonthlyUnits: Math.round(months.reduce((s, m) => s + Number(m.unitsSold || 0), 0) / months.length),
      avgMonthlyRevenue: Math.round(months.reduce((s, m) => s + Number(m.revenue || 0), 0) / months.length),
      trend: Math.round(trend * 10) / 10,
      direction: trend > 5 ? 'GROWING' : trend < -5 ? 'DECLINING' : 'STABLE',
    };
  }).sort((a, b) => b.avgMonthlyRevenue - a.avgMonthlyRevenue);

  // Top products by velocity
  const topProducts: any[] = await prisma.$queryRawUnsafe(`
    SELECT
      p.id, p.name, p.category, p.sku,
      SUM(oi.quantity)::float as "totalSold",
      ROUND(SUM(oi."lineTotal")::numeric, 2) as "totalRevenue",
      COUNT(DISTINCT o."builderId")::int as "uniqueBuyers",
      ROUND(SUM(oi.quantity)::numeric / 12, 1) as "avgMonthlyUnits",
      SUM(CASE WHEN o."createdAt" > NOW() - INTERVAL '3 months' THEN oi.quantity ELSE 0 END)::float as "recent3mUnits",
      SUM(CASE WHEN o."createdAt" > NOW() - INTERVAL '3 months' AND o."createdAt" <= NOW() - INTERVAL '6 months' THEN oi.quantity ELSE 0 END)::float as "prior3mUnits"
    FROM "OrderItem" oi
    JOIN "Order" o ON oi."orderId" = o.id
    JOIN "Product" p ON oi."productId" = p.id
    WHERE o.status::text != 'CANCELLED' AND o."createdAt" > NOW() - INTERVAL '12 months'
    GROUP BY p.id, p.name, p.category, p.sku
    ORDER BY "totalSold" DESC
    LIMIT 30
  `);

  return safeJson({
    report: 'demand-prediction',
    generatedAt: new Date().toISOString(),
    categoryForecasts,
    topProducts,
  });
}

async function getSeasonalPatterns() {
  // Day of week patterns
  const dayOfWeek: any[] = await prisma.$queryRawUnsafe(`
    SELECT
      EXTRACT(DOW FROM "createdAt")::integer as "dayOfWeek",
      TO_CHAR("createdAt", 'Day') as "dayName",
      COUNT(*)::int as orders,
      ROUND(SUM(total)::numeric, 2) as revenue,
      ROUND(AVG(total)::numeric, 2) as "avgOrderValue"
    FROM "Order"
    WHERE status::text != 'CANCELLED'
    GROUP BY EXTRACT(DOW FROM "createdAt"), TO_CHAR("createdAt", 'Day')
    ORDER BY "dayOfWeek"
  `);

  // Monthly seasonality (aggregate across years)
  const monthlyPattern: any[] = await prisma.$queryRawUnsafe(`
    SELECT
      EXTRACT(MONTH FROM "createdAt")::integer as "monthNumber",
      TO_CHAR("createdAt", 'Month') as "monthName",
      COUNT(*)::int as orders,
      ROUND(SUM(total)::numeric, 2) as revenue,
      ROUND(AVG(total)::numeric, 2) as "avgOrderValue",
      COUNT(DISTINCT "builderId")::int as "uniqueBuilders"
    FROM "Order"
    WHERE status::text != 'CANCELLED'
    GROUP BY EXTRACT(MONTH FROM "createdAt"), TO_CHAR("createdAt", 'Month')
    ORDER BY "monthNumber"
  `);

  // Hour of day patterns
  const hourOfDay: any[] = await prisma.$queryRawUnsafe(`
    SELECT
      EXTRACT(HOUR FROM "createdAt")::integer as hour,
      COUNT(*)::int as orders,
      ROUND(SUM(total)::numeric, 2) as revenue
    FROM "Order"
    WHERE status::text != 'CANCELLED'
    GROUP BY EXTRACT(HOUR FROM "createdAt")
    ORDER BY hour
  `);

  // Quote-to-order timing
  const quoteTimingAvg: any[] = await prisma.$queryRawUnsafe(`
    SELECT
      ROUND(AVG(EXTRACT(DAY FROM AGE(o."createdAt", q."createdAt")))::numeric, 1) as "avgDaysQuoteToOrder",
      ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY EXTRACT(DAY FROM AGE(o."createdAt", q."createdAt"))))::numeric as "medianDays",
      ROUND(MIN(EXTRACT(DAY FROM AGE(o."createdAt", q."createdAt")))::numeric, 1) as "minDays",
      ROUND(MAX(EXTRACT(DAY FROM AGE(o."createdAt", q."createdAt")))::numeric, 1) as "maxDays"
    FROM "Order" o
    JOIN "Quote" q ON o."quoteId" = q.id
    WHERE o.status::text != 'CANCELLED'
  `);

  return safeJson({
    report: 'seasonal-patterns',
    generatedAt: new Date().toISOString(),
    dayOfWeek,
    monthlyPattern,
    hourOfDay,
    quoteTiming: quoteTimingAvg[0] || {},
  });
}

async function getBuilderPredictions() {
  // Predict next order date and value per builder
  const predictions: any[] = await prisma.$queryRawUnsafe(`
    SELECT
      b.id, b."companyName", b.email, b.status,
      order_stats."orderCount",
      order_stats."totalSpend",
      order_stats."avgOrderValue",
      order_stats."lastOrderDate",
      order_stats."avgDaysBetweenOrders",
      -- Predicted next order date
      CASE
        WHEN order_stats."avgDaysBetweenOrders" > 0 AND order_stats."lastOrderDate" IS NOT NULL
        THEN (order_stats."lastOrderDate" + (order_stats."avgDaysBetweenOrders" || ' days')::interval)
        ELSE NULL
      END as "predictedNextOrder",
      -- Is the predicted date past? (overdue for an order)
      CASE
        WHEN order_stats."avgDaysBetweenOrders" > 0 AND order_stats."lastOrderDate" IS NOT NULL
          AND (order_stats."lastOrderDate" + (order_stats."avgDaysBetweenOrders" || ' days')::interval) < NOW()
        THEN true
        ELSE false
      END as "orderOverdue",
      -- Predicted next order value (rolling avg of last 3)
      order_stats."recentAvgValue" as "predictedOrderValue",
      -- Spend trend
      CASE
        WHEN order_stats."recentAvgValue" > order_stats."avgOrderValue" * 1.1 THEN 'INCREASING'
        WHEN order_stats."recentAvgValue" < order_stats."avgOrderValue" * 0.9 THEN 'DECREASING'
        ELSE 'STABLE'
      END as "spendTrend"
    FROM "Builder" b
    JOIN (
      SELECT
        "builderId",
        COUNT(*)::int as "orderCount",
        ROUND(SUM(total)::numeric, 2) as "totalSpend",
        ROUND(AVG(total)::numeric, 2) as "avgOrderValue",
        MAX("createdAt") as "lastOrderDate",
        -- Average days between orders
        CASE WHEN COUNT(*) > 1
          THEN ROUND(EXTRACT(DAY FROM (MAX("createdAt") - MIN("createdAt")))::numeric / (COUNT(*) - 1), 0)::float
          ELSE 0
        END as "avgDaysBetweenOrders",
        -- Recent average (last 3 orders)
        (SELECT ROUND(AVG(sub.total)::numeric, 2)
         FROM (
           SELECT total FROM "Order" o2
           WHERE o2."builderId" = "Order"."builderId" AND o2.status::text != 'CANCELLED'
           ORDER BY o2."createdAt" DESC LIMIT 3
         ) sub
        ) as "recentAvgValue"
      FROM "Order"
      WHERE status::text != 'CANCELLED'
      GROUP BY "builderId"
      HAVING COUNT(*) >= 2
    ) order_stats ON b.id = order_stats."builderId"
    WHERE b.status::text = 'ACTIVE'
    ORDER BY
      CASE WHEN (order_stats."lastOrderDate" + (order_stats."avgDaysBetweenOrders" || ' days')::interval) < NOW() THEN 0 ELSE 1 END,
      "predictedNextOrder" ASC NULLS LAST
  `);

  return safeJson({
    report: 'builder-predictions',
    generatedAt: new Date().toISOString(),
    predictions,
    summary: {
      total: predictions.length,
      overdue: predictions.filter((p: any) => p.orderOverdue).length,
      increasing: predictions.filter((p: any) => p.spendTrend === 'INCREASING').length,
      decreasing: predictions.filter((p: any) => p.spendTrend === 'DECREASING').length,
      stable: predictions.filter((p: any) => p.spendTrend === 'STABLE').length,
    },
  });
}

async function getCashFlowProjection() {
  // AR aging into future collections
  const arProjection: any[] = await prisma.$queryRawUnsafe(`
    SELECT
      CASE
        WHEN "dueDate" < CURRENT_DATE THEN 'OVERDUE'
        WHEN "dueDate" <= CURRENT_DATE + INTERVAL '7 days' THEN 'DUE_THIS_WEEK'
        WHEN "dueDate" <= CURRENT_DATE + INTERVAL '14 days' THEN 'DUE_2_WEEKS'
        WHEN "dueDate" <= CURRENT_DATE + INTERVAL '30 days' THEN 'DUE_30_DAYS'
        WHEN "dueDate" <= CURRENT_DATE + INTERVAL '60 days' THEN 'DUE_60_DAYS'
        ELSE 'DUE_60_PLUS'
      END as bucket,
      COUNT(*)::int as "invoiceCount",
      ROUND(SUM(total)::numeric, 2) as "totalAmount"
    FROM "Order"
    WHERE "paymentStatus" != 'PAID' AND status != 'CANCELLED' AND "dueDate" IS NOT NULL
    GROUP BY bucket
    ORDER BY
      CASE bucket
        WHEN 'OVERDUE' THEN 1
        WHEN 'DUE_THIS_WEEK' THEN 2
        WHEN 'DUE_2_WEEKS' THEN 3
        WHEN 'DUE_30_DAYS' THEN 4
        WHEN 'DUE_60_DAYS' THEN 5
        ELSE 6
      END
  `);

  // Outgoing: Pending POs
  const apProjection: any[] = await prisma.$queryRawUnsafe(`
    SELECT
      CASE
        WHEN "expectedDate" < CURRENT_DATE THEN 'OVERDUE'
        WHEN "expectedDate" <= CURRENT_DATE + INTERVAL '7 days' THEN 'DUE_THIS_WEEK'
        WHEN "expectedDate" <= CURRENT_DATE + INTERVAL '14 days' THEN 'DUE_2_WEEKS'
        WHEN "expectedDate" <= CURRENT_DATE + INTERVAL '30 days' THEN 'DUE_30_DAYS'
        ELSE 'DUE_30_PLUS'
      END as bucket,
      COUNT(*)::int as "poCount",
      ROUND(SUM(total)::numeric, 2) as "totalAmount"
    FROM "PurchaseOrder"
    WHERE status IN ('SUBMITTED', 'APPROVED', 'ORDERED')
    GROUP BY bucket
    ORDER BY
      CASE bucket
        WHEN 'OVERDUE' THEN 1
        WHEN 'DUE_THIS_WEEK' THEN 2
        WHEN 'DUE_2_WEEKS' THEN 3
        WHEN 'DUE_30_DAYS' THEN 4
        ELSE 5
      END
  `);

  // Weekly cash flow projection (next 8 weeks)
  const weeklyProjection: any[] = await prisma.$queryRawUnsafe(`
    SELECT
      week_start,
      COALESCE(ar.incoming, 0) as "projectedIncoming",
      COALESCE(ap.outgoing, 0) as "projectedOutgoing",
      COALESCE(ar.incoming, 0) - COALESCE(ap.outgoing, 0) as "netCashFlow"
    FROM (
      SELECT generate_series(
        DATE_TRUNC('week', CURRENT_DATE),
        DATE_TRUNC('week', CURRENT_DATE + INTERVAL '8 weeks'),
        '1 week'::interval
      ) as week_start
    ) weeks
    LEFT JOIN (
      SELECT
        DATE_TRUNC('week', "dueDate") as week,
        ROUND(SUM(total)::numeric, 2) as incoming
      FROM "Order"
      WHERE "paymentStatus" != 'PAID' AND status != 'CANCELLED'
        AND "dueDate" >= CURRENT_DATE AND "dueDate" <= CURRENT_DATE + INTERVAL '8 weeks'
      GROUP BY DATE_TRUNC('week', "dueDate")
    ) ar ON weeks.week_start = ar.week
    LEFT JOIN (
      SELECT
        DATE_TRUNC('week', "expectedDate") as week,
        ROUND(SUM(total)::numeric, 2) as outgoing
      FROM "PurchaseOrder"
      WHERE status IN ('SUBMITTED', 'APPROVED', 'ORDERED')
        AND "expectedDate" >= CURRENT_DATE AND "expectedDate" <= CURRENT_DATE + INTERVAL '8 weeks'
      GROUP BY DATE_TRUNC('week', "expectedDate")
    ) ap ON weeks.week_start = ap.week
    ORDER BY week_start ASC
  `);

  return safeJson({
    report: 'cash-flow',
    generatedAt: new Date().toISOString(),
    arProjection,
    apProjection,
    weeklyProjection,
    totalAR: arProjection.reduce((s, r) => s + Number(r.totalAmount || 0), 0),
    totalAP: apProjection.reduce((s, r) => s + Number(r.totalAmount || 0), 0),
  });
}
