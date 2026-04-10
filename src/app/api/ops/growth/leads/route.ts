export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { checkStaffAuth } from '@/lib/api-auth'
import { safeJson } from '@/lib/safe-json'

// Lead Scoring & Customer Lifetime Value API
// Builder scoring, CLV analysis, churn prediction, growth opportunities

export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const { searchParams } = new URL(request.url);
    const report = searchParams.get('report') || 'dashboard';

    switch (report) {
      case 'dashboard': return await getDashboard();
      case 'lead-scores': return await getLeadScores();
      case 'clv-analysis': return await getCLVAnalysis();
      case 'churn-risk': return await getChurnRisk();
      case 'growth-opportunities': return await getGrowthOpportunities();
      case 'engagement-timeline': return await getEngagementTimeline();
      default: return NextResponse.json({ error: 'Unknown report' }, { status: 400 });
    }
  } catch (error: any) {
    console.error('Growth leads error:', error);
    return safeJson({ error: 'Internal server error' }, { status: 500 });
  }
}

async function getDashboard() {
  // Builder engagement summary
  const engagement: any[] = await prisma.$queryRawUnsafe(`
    SELECT
      COUNT(*)::int as "totalBuilders",
      COUNT(CASE WHEN status::text = 'ACTIVE' THEN 1 END)::int as "activeBuilders",
      COUNT(CASE WHEN status::text = 'PENDING' THEN 1 END)::int as "pendingBuilders",
      COUNT(CASE WHEN status::text = 'SUSPENDED' THEN 1 END)::int as "suspendedBuilders"
    FROM "Builder"
  `);

  // Revenue segmentation
  const segments: any[] = await prisma.$queryRawUnsafe(`
    SELECT
      CASE
        WHEN total_spend >= 100000 THEN 'PLATINUM'
        WHEN total_spend >= 50000 THEN 'GOLD'
        WHEN total_spend >= 10000 THEN 'SILVER'
        WHEN total_spend > 0 THEN 'BRONZE'
        ELSE 'PROSPECT'
      END as segment,
      COUNT(*)::int as "builderCount",
      ROUND(COALESCE(SUM(total_spend), 0)::numeric, 2) as "segmentRevenue",
      ROUND(COALESCE(AVG(total_spend), 0)::numeric, 2) as "avgSpend"
    FROM (
      SELECT b.id,
        COALESCE(SUM(CASE WHEN o.status::text != 'CANCELLED' THEN o.total ELSE 0 END), 0) as total_spend
      FROM "Builder" b
      LEFT JOIN "Order" o ON b.id = o."builderId"
      GROUP BY b.id
    ) builder_spend
    GROUP BY segment
    ORDER BY "segmentRevenue" DESC
  `);

  // Pipeline health
  // Pipeline health - query Deal table separately in case it doesn't exist yet
  let pipelineData: any = { activeQuotes: 0, pipelineValue: 0, sentQuotes: 0, draftQuotes: 0, activeDeals: 0, dealPipelineValue: 0 };
  try {
    const pipeline: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        COUNT(DISTINCT q.id)::int as "activeQuotes",
        ROUND(COALESCE(SUM(q."total"), 0)::numeric, 2) as "pipelineValue",
        COUNT(DISTINCT CASE WHEN q.status::text = 'SENT' THEN q.id END)::int as "sentQuotes",
        COUNT(DISTINCT CASE WHEN q.status::text = 'DRAFT' THEN q.id END)::int as "draftQuotes",
        COUNT(DISTINCT d.id)::int as "activeDeals",
        ROUND(COALESCE(SUM(CASE WHEN d.stage::text NOT IN ('WON', 'LOST') THEN d."dealValue" ELSE 0 END), 0)::numeric, 2) as "dealPipelineValue"
      FROM "Quote" q
      FULL OUTER JOIN "Deal" d ON true
      WHERE (q.status::text IN ('DRAFT', 'SENT') OR d.stage::text NOT IN ('WON', 'LOST'))
    `);
    pipelineData = pipeline[0] || pipelineData;
  } catch {
    // Fallback: query just quotes if Deal table doesn't exist yet
    try {
      const quotesOnly: any[] = await prisma.$queryRawUnsafe(`
        SELECT
          COUNT(*)::int as "activeQuotes",
          ROUND(COALESCE(SUM("total"), 0)::numeric, 2) as "pipelineValue",
          COUNT(CASE WHEN status::text = 'SENT' THEN 1 END)::int as "sentQuotes",
          COUNT(CASE WHEN status::text = 'DRAFT' THEN 1 END)::int as "draftQuotes"
        FROM "Quote"
        WHERE status::text IN ('DRAFT', 'SENT')
      `);
      pipelineData = { ...pipelineData, ...(quotesOnly[0] || {}) };
    } catch { /* quotes table also missing */ }
  }
  const pipeline = [pipelineData];

  // Recent growth metrics
  const growth: any[] = await prisma.$queryRawUnsafe(`
    SELECT
      COUNT(CASE WHEN "createdAt" > NOW() - INTERVAL '30 days' THEN 1 END)::int as "newBuilders30d",
      COUNT(CASE WHEN "createdAt" > NOW() - INTERVAL '90 days' THEN 1 END)::int as "newBuilders90d",
      COUNT(CASE WHEN "createdAt" > NOW() - INTERVAL '7 days' THEN 1 END)::int as "newBuilders7d"
    FROM "Builder"
  `);

  return safeJson({
    report: 'dashboard',
    generatedAt: new Date().toISOString(),
    engagement: engagement[0] || {},
    segments,
    pipeline: pipeline[0] || {},
    growth: growth[0] || {},
  });
}

async function getLeadScores() {
  // Score each builder on: order frequency, recency, value, quote engagement, payment reliability
  const scores: any[] = await prisma.$queryRawUnsafe(`
    SELECT
      b.id, b."companyName", b.email, b.phone, b.status,
      b."creditLimit", b."accountBalance", b."paymentTerm",
      COALESCE(order_data."orderCount", 0) as "orderCount",
      COALESCE(order_data."totalSpend", 0) as "totalSpend",
      order_data."lastOrderDate",
      order_data."avgOrderValue",
      COALESCE(quote_data."quoteCount", 0) as "quoteCount",
      quote_data."lastQuoteDate",
      COALESCE(quote_data."conversionRate", 0) as "quoteConversionRate",
      -- Lead Score (0-100)
      LEAST(100, (
        -- Recency score (0-25): How recently they ordered
        CASE
          WHEN order_data."lastOrderDate" > NOW() - INTERVAL '30 days' THEN 25
          WHEN order_data."lastOrderDate" > NOW() - INTERVAL '90 days' THEN 18
          WHEN order_data."lastOrderDate" > NOW() - INTERVAL '180 days' THEN 10
          WHEN order_data."lastOrderDate" IS NOT NULL THEN 3
          ELSE 0
        END
        -- Frequency score (0-25): How often they order
        + CASE
          WHEN COALESCE(order_data."orderCount", 0) >= 20 THEN 25
          WHEN COALESCE(order_data."orderCount", 0) >= 10 THEN 20
          WHEN COALESCE(order_data."orderCount", 0) >= 5 THEN 15
          WHEN COALESCE(order_data."orderCount", 0) >= 2 THEN 8
          WHEN COALESCE(order_data."orderCount", 0) >= 1 THEN 3
          ELSE 0
        END
        -- Monetary score (0-25): How much they spend
        + CASE
          WHEN COALESCE(order_data."totalSpend", 0) >= 100000 THEN 25
          WHEN COALESCE(order_data."totalSpend", 0) >= 50000 THEN 20
          WHEN COALESCE(order_data."totalSpend", 0) >= 20000 THEN 15
          WHEN COALESCE(order_data."totalSpend", 0) >= 5000 THEN 8
          WHEN COALESCE(order_data."totalSpend", 0) > 0 THEN 3
          ELSE 0
        END
        -- Engagement score (0-25): Quote activity + payment behavior
        + CASE
          WHEN COALESCE(quote_data."quoteCount", 0) >= 10 THEN 12
          WHEN COALESCE(quote_data."quoteCount", 0) >= 5 THEN 8
          WHEN COALESCE(quote_data."quoteCount", 0) >= 1 THEN 4
          ELSE 0
        END
        + CASE
          WHEN b."paymentTerm"::text IN ('NET_10', 'COD', 'CREDIT_CARD') THEN 13
          WHEN b."paymentTerm"::text = 'NET_30' THEN 10
          WHEN b."paymentTerm"::text = 'NET_60' THEN 5
          ELSE 3
        END
      )) as "leadScore",
      CASE
        WHEN LEAST(100, (
          CASE WHEN order_data."lastOrderDate" > NOW() - INTERVAL '30 days' THEN 25
               WHEN order_data."lastOrderDate" > NOW() - INTERVAL '90 days' THEN 18
               WHEN order_data."lastOrderDate" > NOW() - INTERVAL '180 days' THEN 10
               WHEN order_data."lastOrderDate" IS NOT NULL THEN 3 ELSE 0 END
          + CASE WHEN COALESCE(order_data."orderCount", 0) >= 20 THEN 25
                 WHEN COALESCE(order_data."orderCount", 0) >= 10 THEN 20
                 WHEN COALESCE(order_data."orderCount", 0) >= 5 THEN 15
                 WHEN COALESCE(order_data."orderCount", 0) >= 2 THEN 8
                 WHEN COALESCE(order_data."orderCount", 0) >= 1 THEN 3 ELSE 0 END
          + CASE WHEN COALESCE(order_data."totalSpend", 0) >= 100000 THEN 25
                 WHEN COALESCE(order_data."totalSpend", 0) >= 50000 THEN 20
                 WHEN COALESCE(order_data."totalSpend", 0) >= 20000 THEN 15
                 WHEN COALESCE(order_data."totalSpend", 0) >= 5000 THEN 8
                 WHEN COALESCE(order_data."totalSpend", 0) > 0 THEN 3 ELSE 0 END
          + CASE WHEN COALESCE(quote_data."quoteCount", 0) >= 10 THEN 12
                 WHEN COALESCE(quote_data."quoteCount", 0) >= 5 THEN 8
                 WHEN COALESCE(quote_data."quoteCount", 0) >= 1 THEN 4 ELSE 0 END
          + CASE WHEN b."paymentTerm"::text IN ('NET_10', 'COD', 'CREDIT_CARD') THEN 13
                 WHEN b."paymentTerm"::text = 'NET_30' THEN 10
                 WHEN b."paymentTerm"::text = 'NET_60' THEN 5 ELSE 3 END
        )) >= 75 THEN 'HOT'
        WHEN LEAST(100, (
          CASE WHEN order_data."lastOrderDate" > NOW() - INTERVAL '30 days' THEN 25
               WHEN order_data."lastOrderDate" > NOW() - INTERVAL '90 days' THEN 18
               WHEN order_data."lastOrderDate" > NOW() - INTERVAL '180 days' THEN 10
               WHEN order_data."lastOrderDate" IS NOT NULL THEN 3 ELSE 0 END
          + CASE WHEN COALESCE(order_data."orderCount", 0) >= 20 THEN 25
                 WHEN COALESCE(order_data."orderCount", 0) >= 10 THEN 20
                 WHEN COALESCE(order_data."orderCount", 0) >= 5 THEN 15
                 WHEN COALESCE(order_data."orderCount", 0) >= 2 THEN 8
                 WHEN COALESCE(order_data."orderCount", 0) >= 1 THEN 3 ELSE 0 END
          + CASE WHEN COALESCE(order_data."totalSpend", 0) >= 100000 THEN 25
                 WHEN COALESCE(order_data."totalSpend", 0) >= 50000 THEN 20
                 WHEN COALESCE(order_data."totalSpend", 0) >= 20000 THEN 15
                 WHEN COALESCE(order_data."totalSpend", 0) >= 5000 THEN 8
                 WHEN COALESCE(order_data."totalSpend", 0) > 0 THEN 3 ELSE 0 END
          + CASE WHEN COALESCE(quote_data."quoteCount", 0) >= 10 THEN 12
                 WHEN COALESCE(quote_data."quoteCount", 0) >= 5 THEN 8
                 WHEN COALESCE(quote_data."quoteCount", 0) >= 1 THEN 4 ELSE 0 END
          + CASE WHEN b."paymentTerm"::text IN ('NET_10', 'COD', 'CREDIT_CARD') THEN 13
                 WHEN b."paymentTerm"::text = 'NET_30' THEN 10
                 WHEN b."paymentTerm"::text = 'NET_60' THEN 5 ELSE 3 END
        )) >= 50 THEN 'WARM'
        WHEN LEAST(100, (
          CASE WHEN order_data."lastOrderDate" > NOW() - INTERVAL '30 days' THEN 25
               WHEN order_data."lastOrderDate" > NOW() - INTERVAL '90 days' THEN 18
               WHEN order_data."lastOrderDate" > NOW() - INTERVAL '180 days' THEN 10
               WHEN order_data."lastOrderDate" IS NOT NULL THEN 3 ELSE 0 END
          + CASE WHEN COALESCE(order_data."orderCount", 0) >= 20 THEN 25
                 WHEN COALESCE(order_data."orderCount", 0) >= 10 THEN 20
                 WHEN COALESCE(order_data."orderCount", 0) >= 5 THEN 15
                 WHEN COALESCE(order_data."orderCount", 0) >= 2 THEN 8
                 WHEN COALESCE(order_data."orderCount", 0) >= 1 THEN 3 ELSE 0 END
          + CASE WHEN COALESCE(order_data."totalSpend", 0) >= 100000 THEN 25
                 WHEN COALESCE(order_data."totalSpend", 0) >= 50000 THEN 20
                 WHEN COALESCE(order_data."totalSpend", 0) >= 20000 THEN 15
                 WHEN COALESCE(order_data."totalSpend", 0) >= 5000 THEN 8
                 WHEN COALESCE(order_data."totalSpend", 0) > 0 THEN 3 ELSE 0 END
          + CASE WHEN COALESCE(quote_data."quoteCount", 0) >= 10 THEN 12
                 WHEN COALESCE(quote_data."quoteCount", 0) >= 5 THEN 8
                 WHEN COALESCE(quote_data."quoteCount", 0) >= 1 THEN 4 ELSE 0 END
          + CASE WHEN b."paymentTerm"::text IN ('NET_10', 'COD', 'CREDIT_CARD') THEN 13
                 WHEN b."paymentTerm"::text = 'NET_30' THEN 10
                 WHEN b."paymentTerm"::text = 'NET_60' THEN 5 ELSE 3 END
        )) >= 25 THEN 'COOL'
        ELSE 'COLD'
      END as "leadTier"
    FROM "Builder" b
    LEFT JOIN (
      SELECT "builderId",
        COUNT(*) as "orderCount",
        ROUND(SUM(total)::numeric, 2) as "totalSpend",
        MAX("createdAt") as "lastOrderDate",
        ROUND(AVG(total)::numeric, 2) as "avgOrderValue"
      FROM "Order"
      WHERE status != 'CANCELLED'
      GROUP BY "builderId"
    ) order_data ON b.id = order_data."builderId"
    LEFT JOIN (
      SELECT "builderId",
        COUNT(*) as "quoteCount",
        MAX("createdAt") as "lastQuoteDate",
        ROUND(
          COUNT(CASE WHEN status::text IN ('APPROVED', 'ORDERED') THEN 1 END)::numeric /
          NULLIF(COUNT(*)::numeric, 0) * 100, 1
        ) as "conversionRate"
      FROM "Quote"
      GROUP BY "builderId"
    ) quote_data ON b.id = quote_data."builderId"
    ORDER BY "leadScore" DESC
  `);

  return safeJson({
    report: 'lead-scores',
    generatedAt: new Date().toISOString(),
    builders: scores,
    summary: {
      hot: scores.filter((s: any) => s.leadTier === 'HOT').length,
      warm: scores.filter((s: any) => s.leadTier === 'WARM').length,
      cool: scores.filter((s: any) => s.leadTier === 'COOL').length,
      cold: scores.filter((s: any) => s.leadTier === 'COLD').length,
    },
  });
}

async function getCLVAnalysis() {
  // Customer Lifetime Value calculation per builder
  const clv: any[] = await prisma.$queryRawUnsafe(`
    SELECT
      b.id, b."companyName", b.email, b.status,
      b."createdAt" as "customerSince",
      EXTRACT(MONTH FROM AGE(NOW(), b."createdAt"))::integer as "monthsAsCustomer",
      COALESCE(od."orderCount", 0) as "orderCount",
      COALESCE(od."totalRevenue", 0) as "totalRevenue",
      COALESCE(od."totalMargin", 0) as "totalMargin",
      COALESCE(od."avgOrderValue", 0) as "avgOrderValue",
      COALESCE(od."avgMargin", 0) as "avgMarginPct",
      -- Monthly revenue rate
      CASE WHEN EXTRACT(MONTH FROM AGE(NOW(), b."createdAt")) > 0
        THEN ROUND((COALESCE(od."totalRevenue", 0) / EXTRACT(MONTH FROM AGE(NOW(), b."createdAt")))::numeric, 2)
        ELSE COALESCE(od."totalRevenue", 0)
      END as "monthlyRevenueRate",
      -- Projected annual value
      CASE WHEN EXTRACT(MONTH FROM AGE(NOW(), b."createdAt")) > 0
        THEN ROUND((COALESCE(od."totalRevenue", 0) / EXTRACT(MONTH FROM AGE(NOW(), b."createdAt")) * 12)::numeric, 2)
        ELSE ROUND((COALESCE(od."totalRevenue", 0) * 12)::numeric, 2)
      END as "projectedAnnualValue",
      -- 3-year CLV estimate (monthly rate * 36)
      CASE WHEN EXTRACT(MONTH FROM AGE(NOW(), b."createdAt")) > 0
        THEN ROUND((COALESCE(od."totalRevenue", 0) / EXTRACT(MONTH FROM AGE(NOW(), b."createdAt")) * 36)::numeric, 2)
        ELSE ROUND((COALESCE(od."totalRevenue", 0) * 36)::numeric, 2)
      END as "clv3Year",
      od."lastOrderDate",
      od."firstOrderDate"
    FROM "Builder" b
    LEFT JOIN (
      SELECT "builderId",
        COUNT(*) as "orderCount",
        ROUND(SUM(total)::numeric, 2) as "totalRevenue",
        ROUND(SUM(total * 0.28)::numeric, 2) as "totalMargin",
        ROUND(AVG(total)::numeric, 2) as "avgOrderValue",
        ROUND(AVG(0.28 * 100)::numeric, 1) as "avgMargin",
        MAX("createdAt") as "lastOrderDate",
        MIN("createdAt") as "firstOrderDate"
      FROM "Order"
      WHERE status::text != 'CANCELLED'
      GROUP BY "builderId"
    ) od ON b.id = od."builderId"
    WHERE b.status::text = 'ACTIVE'
    ORDER BY "clv3Year" DESC NULLS LAST
  `);

  // CLV distribution
  const distribution = {
    over100k: clv.filter((c: any) => Number(c.clv3Year) >= 100000).length,
    '50k_100k': clv.filter((c: any) => Number(c.clv3Year) >= 50000 && Number(c.clv3Year) < 100000).length,
    '20k_50k': clv.filter((c: any) => Number(c.clv3Year) >= 20000 && Number(c.clv3Year) < 50000).length,
    '5k_20k': clv.filter((c: any) => Number(c.clv3Year) >= 5000 && Number(c.clv3Year) < 20000).length,
    under5k: clv.filter((c: any) => Number(c.clv3Year) < 5000).length,
  };

  const totalCLV = clv.reduce((sum: number, c: any) => sum + Number(c.clv3Year || 0), 0);

  return safeJson({
    report: 'clv-analysis',
    generatedAt: new Date().toISOString(),
    builders: clv,
    distribution,
    totalCLV: Math.round(totalCLV * 100) / 100,
    avgCLV: clv.length > 0 ? Math.round(totalCLV / clv.length * 100) / 100 : 0,
  });
}

async function getChurnRisk() {
  // Identify builders at risk of churning
  const churnRisk: any[] = await prisma.$queryRawUnsafe(`
    SELECT
      b.id, b."companyName", b.email, b.phone, b.status,
      b."creditLimit", b."accountBalance",
      od."orderCount", od."totalSpend", od."lastOrderDate", od."avgOrderValue",
      EXTRACT(DAY FROM AGE(NOW(), od."lastOrderDate"))::integer as "daysSinceLastOrder",
      qd."lastQuoteDate",
      EXTRACT(DAY FROM AGE(NOW(), qd."lastQuoteDate"))::integer as "daysSinceLastQuote",
      CASE
        WHEN od."lastOrderDate" IS NULL AND qd."lastQuoteDate" IS NULL THEN 'NEVER_ORDERED'
        WHEN od."lastOrderDate" < NOW() - INTERVAL '180 days' THEN 'HIGH_RISK'
        WHEN od."lastOrderDate" < NOW() - INTERVAL '90 days' THEN 'MEDIUM_RISK'
        WHEN od."lastOrderDate" < NOW() - INTERVAL '60 days'
          AND od."orderCount" <= 2 THEN 'MEDIUM_RISK'
        WHEN od."lastOrderDate" < NOW() - INTERVAL '45 days' THEN 'LOW_RISK'
        ELSE 'HEALTHY'
      END as "churnRisk",
      -- Risk score 0-100 (higher = more likely to churn)
      LEAST(100, GREATEST(0,
        CASE
          WHEN od."lastOrderDate" IS NULL THEN 60
          ELSE LEAST(50, EXTRACT(DAY FROM AGE(NOW(), od."lastOrderDate"))::integer / 4)
        END
        + CASE
          WHEN COALESCE(od."orderCount", 0) <= 1 THEN 25
          WHEN COALESCE(od."orderCount", 0) <= 3 THEN 15
          WHEN COALESCE(od."orderCount", 0) <= 5 THEN 5
          ELSE 0
        END
        + CASE
          WHEN b."accountBalance" > COALESCE(b."creditLimit", 999999) * 0.9 THEN 15
          WHEN b."accountBalance" > COALESCE(b."creditLimit", 999999) * 0.7 THEN 8
          ELSE 0
        END
      )) as "riskScore"
    FROM "Builder" b
    LEFT JOIN (
      SELECT "builderId",
        COUNT(*) as "orderCount",
        ROUND(SUM(total)::numeric, 2) as "totalSpend",
        MAX("createdAt") as "lastOrderDate",
        ROUND(AVG(total)::numeric, 2) as "avgOrderValue"
      FROM "Order" WHERE status::text != 'CANCELLED'
      GROUP BY "builderId"
    ) od ON b.id = od."builderId"
    LEFT JOIN (
      SELECT "builderId", MAX("createdAt") as "lastQuoteDate"
      FROM "Quote"
      GROUP BY "builderId"
    ) qd ON b.id = qd."builderId"
    WHERE b.status::text = 'ACTIVE'
    ORDER BY "riskScore" DESC
  `);

  return safeJson({
    report: 'churn-risk',
    generatedAt: new Date().toISOString(),
    builders: churnRisk,
    summary: {
      highRisk: churnRisk.filter((c: any) => c.churnRisk === 'HIGH_RISK').length,
      mediumRisk: churnRisk.filter((c: any) => c.churnRisk === 'MEDIUM_RISK').length,
      lowRisk: churnRisk.filter((c: any) => c.churnRisk === 'LOW_RISK').length,
      healthy: churnRisk.filter((c: any) => c.churnRisk === 'HEALTHY').length,
      neverOrdered: churnRisk.filter((c: any) => c.churnRisk === 'NEVER_ORDERED').length,
    },
    atRiskRevenue: churnRisk
      .filter((c: any) => ['HIGH_RISK', 'MEDIUM_RISK'].includes(c.churnRisk))
      .reduce((sum: number, c: any) => sum + Number(c.totalSpend || 0), 0),
  });
}

async function getGrowthOpportunities() {
  // Cross-sell: builders who buy from some categories but not others
  const crossSell: any[] = await prisma.$queryRawUnsafe(`
    SELECT
      b.id, b."companyName",
      ARRAY_AGG(DISTINCT p.category) as "purchasedCategories",
      COUNT(DISTINCT p.category) as "categoryCount",
      ROUND(SUM(oi."lineTotal")::numeric, 2) as "totalSpend"
    FROM "Builder" b
    JOIN "Order" o ON b.id = o."builderId"
    JOIN "OrderItem" oi ON o.id = oi."orderId"
    JOIN "Product" p ON oi."productId" = p.id
    WHERE o.status::text != 'CANCELLED' AND b.status::text = 'ACTIVE'
    GROUP BY b.id, b."companyName"
    HAVING COUNT(DISTINCT p.category) BETWEEN 1 AND 3
    ORDER BY "totalSpend" DESC
    LIMIT 30
  `);

  // Upsell: builders whose avg order is below segment avg
  const upsell: any[] = await prisma.$queryRawUnsafe(`
    WITH segment_avg AS (
      SELECT ROUND(AVG(total)::numeric, 2) as "segmentAvg"
      FROM "Order" WHERE status::text != 'CANCELLED'
    )
    SELECT
      b.id, b."companyName", b.email,
      COUNT(o.id) as "orderCount",
      ROUND(AVG(o.total)::numeric, 2) as "avgOrderValue",
      sa."segmentAvg",
      ROUND((sa."segmentAvg" - AVG(o.total))::numeric, 2) as "upsellGap",
      ROUND(((sa."segmentAvg" - AVG(o.total)) * COUNT(o.id))::numeric, 2) as "potentialRevenue"
    FROM "Builder" b
    JOIN "Order" o ON b.id = o."builderId"
    CROSS JOIN segment_avg sa
    WHERE o.status::text != 'CANCELLED' AND b.status::text = 'ACTIVE'
    GROUP BY b.id, b."companyName", b.email, sa."segmentAvg"
    HAVING AVG(o.total) < sa."segmentAvg" AND COUNT(o.id) >= 2
    ORDER BY "potentialRevenue" DESC
    LIMIT 30
  `);

  // Win-back: inactive builders with significant history
  const winBack: any[] = await prisma.$queryRawUnsafe(`
    SELECT
      b.id, b."companyName", b.email, b.phone,
      COUNT(o.id) as "pastOrders",
      ROUND(SUM(o.total)::numeric, 2) as "pastSpend",
      MAX(o."createdAt") as "lastOrderDate",
      EXTRACT(DAY FROM AGE(NOW(), MAX(o."createdAt")))::integer as "daysSinceLastOrder"
    FROM "Builder" b
    JOIN "Order" o ON b.id = o."builderId"
    WHERE o.status::text != 'CANCELLED' AND b.status::text = 'ACTIVE'
    GROUP BY b.id, b."companyName", b.email, b.phone
    HAVING MAX(o."createdAt") < NOW() - INTERVAL '90 days'
      AND SUM(o.total) >= 5000
    ORDER BY "pastSpend" DESC
    LIMIT 20
  `);

  return safeJson({
    report: 'growth-opportunities',
    generatedAt: new Date().toISOString(),
    crossSell,
    upsell,
    winBack,
    totalPotentialRevenue:
      upsell.reduce((s: number, u: any) => s + Number(u.potentialRevenue || 0), 0),
  });
}

async function getEngagementTimeline() {
  // Monthly builder engagement: new signups, first orders, repeat orders
  const timeline: any[] = await prisma.$queryRawUnsafe(`
    SELECT
      months.month,
      COALESCE(new_builders.count, 0) as "newBuilders",
      COALESCE(first_orders.count, 0) as "firstOrders",
      COALESCE(all_orders.count, 0) as "totalOrders",
      COALESCE(all_orders.revenue, 0) as "revenue"
    FROM (
      SELECT generate_series(
        DATE_TRUNC('month', NOW() - INTERVAL '11 months'),
        DATE_TRUNC('month', NOW()),
        '1 month'::interval
      ) as month
    ) months
    LEFT JOIN (
      SELECT DATE_TRUNC('month', "createdAt") as month, COUNT(*) as count
      FROM "Builder"
      WHERE "createdAt" > NOW() - INTERVAL '12 months'
      GROUP BY DATE_TRUNC('month', "createdAt")
    ) new_builders ON months.month = new_builders.month
    LEFT JOIN (
      SELECT DATE_TRUNC('month', first_order) as month, COUNT(*) as count
      FROM (
        SELECT "builderId", MIN("createdAt") as first_order
        FROM "Order" WHERE status::text != 'CANCELLED'
        GROUP BY "builderId"
      ) fo
      WHERE first_order > NOW() - INTERVAL '12 months'
      GROUP BY DATE_TRUNC('month', first_order)
    ) first_orders ON months.month = first_orders.month
    LEFT JOIN (
      SELECT DATE_TRUNC('month', "createdAt") as month,
        COUNT(*) as count,
        ROUND(SUM(total)::numeric, 2) as revenue
      FROM "Order" WHERE status::text != 'CANCELLED' AND "createdAt" > NOW() - INTERVAL '12 months'
      GROUP BY DATE_TRUNC('month', "createdAt")
    ) all_orders ON months.month = all_orders.month
    ORDER BY months.month ASC
  `);

  return safeJson({
    report: 'engagement-timeline',
    generatedAt: new Date().toISOString(),
    timeline,
  });
}
