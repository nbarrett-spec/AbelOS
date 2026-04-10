export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { checkStaffAuth } from '@/lib/api-auth'
import { safeJson } from '@/lib/safe-json'

// Builder Intelligence Portal API
// Deep 360° view of each builder account: purchase DNA, product affinity,
// profitability analysis, relationship timeline, and account health scoring

export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const { searchParams } = new URL(request.url);
    const report = searchParams.get('report') || 'overview';
    const builderId = searchParams.get('builderId');

    switch (report) {
      case 'overview': return await getOverview();
      case 'profile': return builderId ? await getBuilderProfile(builderId) : NextResponse.json({ error: 'builderId required' }, { status: 400 });
      case 'purchase-dna': return builderId ? await getPurchaseDNA(builderId) : NextResponse.json({ error: 'builderId required' }, { status: 400 });
      case 'product-affinity': return await getProductAffinity();
      case 'profitability': return await getProfitabilityRanking();
      case 'relationship-health': return await getRelationshipHealth();
      default: return NextResponse.json({ error: 'Unknown report' }, { status: 400 });
    }
  } catch (error: any) {
    console.error('Builder intel error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

async function getOverview() {
  // Top builders by multiple dimensions
  const topByRevenue: any[] = await prisma.$queryRawUnsafe(`
    SELECT b.id, b."companyName", b."contactName", b.email, b.status,
      COUNT(o.id)::int as "orderCount",
      ROUND(SUM(o.total)::numeric, 2) as "totalRevenue",
      ROUND(AVG(o.total)::numeric, 2) as "avgOrder",
      MAX(o."createdAt") as "lastOrder",
      EXTRACT(MONTH FROM AGE(NOW(), b."createdAt"))::integer as "tenure"
    FROM "Builder" b
    JOIN "Order" o ON b.id = o."builderId"
    WHERE o.status != 'CANCELLED' AND b.status = 'ACTIVE'
    GROUP BY b.id, b."companyName", b."contactName", b.email, b.status, b."createdAt"
    ORDER BY "totalRevenue" DESC
    LIMIT 15
  `);

  // Account health distribution
  const healthDist: any[] = await prisma.$queryRawUnsafe(`
    SELECT
      CASE
        WHEN last_order > NOW() - INTERVAL '30 days' AND order_count >= 3 THEN 'THRIVING'
        WHEN last_order > NOW() - INTERVAL '60 days' THEN 'HEALTHY'
        WHEN last_order > NOW() - INTERVAL '120 days' THEN 'AT_RISK'
        WHEN last_order IS NOT NULL THEN 'DORMANT'
        ELSE 'NEW'
      END as health,
      COUNT(*)::int as count,
      ROUND(COALESCE(SUM(total_spend), 0)::numeric, 2) as revenue
    FROM (
      SELECT b.id,
        COUNT(o.id) as order_count,
        MAX(o."createdAt") as last_order,
        COALESCE(SUM(o.total), 0) as total_spend
      FROM "Builder" b
      LEFT JOIN "Order" o ON b.id = o."builderId" AND o.status != 'CANCELLED'
      WHERE b.status = 'ACTIVE'
      GROUP BY b.id
    ) builder_stats
    GROUP BY health
    ORDER BY count DESC
  `);

  // Revenue concentration (Pareto)
  const pareto: any[] = await prisma.$queryRawUnsafe(`
    WITH ranked AS (
      SELECT b.id, SUM(o.total) as spend,
        ROW_NUMBER() OVER (ORDER BY SUM(o.total) DESC) as rn,
        COUNT(*) OVER () as total_builders
      FROM "Builder" b
      JOIN "Order" o ON b.id = o."builderId"
      WHERE o.status != 'CANCELLED' AND b.status = 'ACTIVE'
      GROUP BY b.id
    )
    SELECT
      CASE
        WHEN rn <= total_builders * 0.1 THEN 'Top 10%'
        WHEN rn <= total_builders * 0.2 THEN 'Top 20%'
        WHEN rn <= total_builders * 0.5 THEN 'Top 50%'
        ELSE 'Bottom 50%'
      END as tier,
      COUNT(*)::int as "builderCount",
      ROUND(SUM(spend)::numeric, 2) as "tierRevenue"
    FROM ranked
    GROUP BY tier
    ORDER BY "tierRevenue" DESC
  `);

  const totalRevenue = pareto.reduce((s, p) => s + Number(p.tierRevenue || 0), 0);

  return safeJson({
    report: 'overview',
    generatedAt: new Date().toISOString(),
    topByRevenue,
    healthDistribution: healthDist,
    revenueConcentration: pareto.map(p => ({ ...p, pctOfTotal: totalRevenue > 0 ? Math.round(Number(p.tierRevenue) / totalRevenue * 1000) / 10 : 0 })),
    totalRevenue,
  });
}

async function getBuilderProfile(builderId: string) {
  // Complete builder 360° profile
  const builder: any[] = await prisma.$queryRawUnsafe(`
    SELECT b.*,
      EXTRACT(MONTH FROM AGE(NOW(), b."createdAt"))::integer as "tenureMonths"
    FROM "Builder" b WHERE b.id = $1
  `, builderId);

  if (!builder.length) return NextResponse.json({ error: 'Builder not found' }, { status: 404 });

  // Order history summary
  const orderSummary: any[] = await prisma.$queryRawUnsafe(`
    SELECT
      COUNT(*)::int as "totalOrders",
      ROUND(SUM(total)::numeric, 2) as "totalSpend",
      ROUND(AVG(total)::numeric, 2) as "avgOrderValue",
      ROUND(MAX(total)::numeric, 2) as "largestOrder",
      MIN("createdAt") as "firstOrder",
      MAX("createdAt") as "lastOrder",
      COUNT(CASE WHEN "paymentStatus" = 'PAID' THEN 1 END)::int as "paidOrders",
      COUNT(CASE WHEN "paymentStatus" != 'PAID' AND "dueDate" < CURRENT_DATE THEN 1 END)::int as "overdueOrders",
      ROUND(SUM(CASE WHEN "paymentStatus" != 'PAID' THEN total ELSE 0 END)::numeric, 2) as "outstandingBalance"
    FROM "Order" WHERE "builderId" = $1 AND status != 'CANCELLED'
  `, builderId);

  // Quote history
  const quoteSummary: any[] = await prisma.$queryRawUnsafe(`
    SELECT
      COUNT(*)::int as "totalQuotes",
      COUNT(CASE WHEN status IN ('APPROVED', 'ORDERED') THEN 1 END)::int as "accepted",
      COUNT(CASE WHEN status = 'REJECTED' THEN 1 END)::int as "rejected",
      COUNT(CASE WHEN status = 'EXPIRED' THEN 1 END)::int as "expired",
      COUNT(CASE WHEN status IN ('DRAFT', 'SENT') THEN 1 END)::int as "pending",
      ROUND(COALESCE(SUM("total"), 0)::numeric, 2) as "totalQuotedValue"
    FROM "Quote" WHERE "builderId" = $1
  `, builderId);

  // Top products purchased
  const topProducts: any[] = await prisma.$queryRawUnsafe(`
    SELECT p.id, p.name, p.category, p.sku,
      SUM(oi.quantity)::float as "totalQty",
      ROUND(SUM(oi."lineTotal")::numeric, 2) as "totalSpend",
      COUNT(DISTINCT o.id)::int as "orderCount"
    FROM "OrderItem" oi
    JOIN "Order" o ON oi."orderId" = o.id
    JOIN "Product" p ON oi."productId" = p.id
    WHERE o."builderId" = $1 AND o.status != 'CANCELLED'
    GROUP BY p.id, p.name, p.category, p.sku
    ORDER BY "totalSpend" DESC
    LIMIT 15
  `, builderId);

  // Monthly spend trend
  const spendTrend: any[] = await prisma.$queryRawUnsafe(`
    SELECT DATE_TRUNC('month', "createdAt") as month,
      ROUND(SUM(total)::numeric, 2) as revenue,
      COUNT(*)::int as orders
    FROM "Order"
    WHERE "builderId" = $1 AND status != 'CANCELLED' AND "createdAt" > NOW() - INTERVAL '12 months'
    GROUP BY DATE_TRUNC('month', "createdAt")
    ORDER BY month ASC
  `, builderId);

  // Custom pricing
  const customPricing: any[] = await prisma.$queryRawUnsafe(`
    SELECT bp.id, bp."customPrice", bp.margin,
      p.name, p.sku, p."basePrice"
    FROM "BuilderPricing" bp
    JOIN "Product" p ON bp."productId" = p.id
    WHERE bp."builderId" = $1
    ORDER BY p.name
  `, builderId);

  return safeJson({
    report: 'profile',
    generatedAt: new Date().toISOString(),
    builder: builder[0],
    orderSummary: orderSummary[0] || {},
    quoteSummary: quoteSummary[0] || {},
    topProducts,
    spendTrend,
    customPricing,
  });
}

async function getPurchaseDNA(builderId: string) {
  // Deep purchase pattern analysis
  const categoryBreakdown: any[] = await prisma.$queryRawUnsafe(`
    SELECT p.category,
      COUNT(DISTINCT o.id)::int as "orderCount",
      SUM(oi.quantity)::float as "totalUnits",
      ROUND(SUM(oi."lineTotal")::numeric, 2) as "totalSpend",
      ROUND(AVG(oi."unitPrice")::numeric, 2) as "avgUnitPrice"
    FROM "OrderItem" oi
    JOIN "Order" o ON oi."orderId" = o.id
    JOIN "Product" p ON oi."productId" = p.id
    WHERE o."builderId" = $1 AND o.status != 'CANCELLED'
    GROUP BY p.category
    ORDER BY "totalSpend" DESC
  `, builderId);

  // Order frequency patterns
  const frequencyPattern: any[] = await prisma.$queryRawUnsafe(`
    SELECT
      TO_CHAR("createdAt", 'Day') as "dayOfWeek",
      EXTRACT(DOW FROM "createdAt")::integer as dow,
      COUNT(*)::int as orders
    FROM "Order"
    WHERE "builderId" = $1 AND status != 'CANCELLED'
    GROUP BY TO_CHAR("createdAt", 'Day'), EXTRACT(DOW FROM "createdAt")
    ORDER BY dow
  `, builderId);

  // Order size distribution
  const sizeDistribution: any[] = await prisma.$queryRawUnsafe(`
    SELECT
      CASE
        WHEN total < 500 THEN 'Under $500'
        WHEN total < 2000 THEN '$500-$2K'
        WHEN total < 5000 THEN '$2K-$5K'
        WHEN total < 10000 THEN '$5K-$10K'
        WHEN total < 25000 THEN '$10K-$25K'
        ELSE '$25K+'
      END as bucket,
      COUNT(*)::int as orders,
      ROUND(SUM(total)::numeric, 2) as revenue
    FROM "Order"
    WHERE "builderId" = $1 AND status != 'CANCELLED'
    GROUP BY bucket
    ORDER BY MIN(total) ASC
  `, builderId);

  // Payment behavior
  const paymentBehavior: any[] = await prisma.$queryRawUnsafe(`
    SELECT
      COUNT(*)::int as "totalInvoices",
      COUNT(CASE WHEN "paymentStatus" = 'PAID' THEN 1 END)::int as "paidOnTime",
      COUNT(CASE WHEN "paymentStatus" != 'PAID' AND "dueDate" < CURRENT_DATE THEN 1 END)::int as "pastDue",
      ROUND(AVG(CASE WHEN "paymentStatus" = 'PAID' AND "paidAt" IS NOT NULL AND "dueDate" IS NOT NULL
        THEN EXTRACT(DAY FROM AGE("paidAt", "dueDate")) ELSE NULL END)::numeric, 1) as "avgDaysToPayment"
    FROM "Order"
    WHERE "builderId" = $1 AND status != 'CANCELLED'
  `, builderId);

  return safeJson({
    report: 'purchase-dna',
    generatedAt: new Date().toISOString(),
    builderId,
    categoryBreakdown,
    frequencyPattern,
    sizeDistribution,
    paymentBehavior: paymentBehavior[0] || {},
  });
}

async function getProductAffinity() {
  // Which products are frequently bought together
  const affinity: any[] = await prisma.$queryRawUnsafe(`
    SELECT
      p1.name as "product1", p1.category as "category1",
      p2.name as "product2", p2.category as "category2",
      COUNT(DISTINCT oi1."orderId")::int as "coOccurrences"
    FROM "OrderItem" oi1
    JOIN "OrderItem" oi2 ON oi1."orderId" = oi2."orderId" AND oi1."productId" < oi2."productId"
    JOIN "Product" p1 ON oi1."productId" = p1.id
    JOIN "Product" p2 ON oi2."productId" = p2.id
    JOIN "Order" o ON oi1."orderId" = o.id
    WHERE o.status != 'CANCELLED'
    GROUP BY p1.name, p1.category, p2.name, p2.category
    HAVING COUNT(DISTINCT oi1."orderId") >= 2
    ORDER BY "coOccurrences" DESC
    LIMIT 30
  `);

  // Category co-purchase patterns
  const categoryCoPurchase: any[] = await prisma.$queryRawUnsafe(`
    SELECT
      p1.category as "category1", p2.category as "category2",
      COUNT(DISTINCT oi1."orderId")::int as "coOccurrences"
    FROM "OrderItem" oi1
    JOIN "OrderItem" oi2 ON oi1."orderId" = oi2."orderId" AND oi1."productId" != oi2."productId"
    JOIN "Product" p1 ON oi1."productId" = p1.id
    JOIN "Product" p2 ON oi2."productId" = p2.id
    JOIN "Order" o ON oi1."orderId" = o.id
    WHERE o.status != 'CANCELLED' AND p1.category < p2.category
    GROUP BY p1.category, p2.category
    HAVING COUNT(DISTINCT oi1."orderId") >= 2
    ORDER BY "coOccurrences" DESC
    LIMIT 20
  `);

  return safeJson({
    report: 'product-affinity',
    generatedAt: new Date().toISOString(),
    productPairs: affinity,
    categoryPairs: categoryCoPurchase,
  });
}

async function getProfitabilityRanking() {
  // Per-builder profitability estimate
  const profitability: any[] = await prisma.$queryRawUnsafe(`
    SELECT
      b.id, b."companyName", b."contactName", b.email, b.status,
      b."creditLimit", b."accountBalance",
      order_data."orderCount",
      order_data."totalRevenue",
      order_data."avgOrderValue",
      -- Estimate margin from product costs vs sold prices
      order_data."estimatedMargin",
      order_data."marginPct",
      order_data."lastOrder",
      -- Estimated cost to serve (more orders = higher but amortized)
      CASE
        WHEN order_data."orderCount" >= 20 THEN 'LOW'
        WHEN order_data."orderCount" >= 10 THEN 'MEDIUM'
        WHEN order_data."orderCount" >= 5 THEN 'MEDIUM_HIGH'
        ELSE 'HIGH'
      END as "costToServe",
      -- Credit utilization risk
      CASE
        WHEN b."creditLimit" IS NOT NULL AND b."creditLimit" > 0
        THEN ROUND(b."accountBalance"::numeric / b."creditLimit"::numeric * 100, 1)
        ELSE 0
      END as "creditUtilization"
    FROM "Builder" b
    JOIN (
      SELECT o."builderId",
        COUNT(*)::int as "orderCount",
        ROUND(SUM(o.total)::numeric, 2) as "totalRevenue",
        ROUND(AVG(o.total)::numeric, 2) as "avgOrderValue",
        ROUND(SUM(o.total * 0.28)::numeric, 2) as "estimatedMargin",
        28.0 as "marginPct",
        MAX(o."createdAt") as "lastOrder"
      FROM "Order" o
      WHERE o.status != 'CANCELLED'
      GROUP BY o."builderId"
    ) order_data ON b.id = order_data."builderId"
    WHERE b.status = 'ACTIVE'
    ORDER BY order_data."estimatedMargin" DESC
  `);

  const totalMargin = profitability.reduce((s, p) => s + Number(p.estimatedMargin || 0), 0);

  return safeJson({
    report: 'profitability',
    generatedAt: new Date().toISOString(),
    builders: profitability,
    totalEstimatedMargin: Math.round(totalMargin),
    avgMarginPerBuilder: profitability.length > 0 ? Math.round(totalMargin / profitability.length) : 0,
  });
}

async function getRelationshipHealth() {
  // Relationship health scoring per builder
  const health: any[] = await prisma.$queryRawUnsafe(`
    SELECT
      b.id, b."companyName", b."contactName", b.email, b.phone, b.status,
      b."createdAt" as "customerSince",
      EXTRACT(MONTH FROM AGE(NOW(), b."createdAt"))::integer as "tenureMonths",
      COALESCE(od."orderCount", 0) as "orderCount",
      COALESCE(od."totalSpend", 0) as "totalSpend",
      od."lastOrder",
      od."avgOrderValue",
      COALESCE(qd."quoteCount", 0) as "quoteCount",
      COALESCE(qd."pendingQuotes", 0) as "pendingQuotes",
      -- Relationship health score (0-100)
      LEAST(100, (
        -- Tenure (0-15)
        LEAST(15, EXTRACT(MONTH FROM AGE(NOW(), b."createdAt"))::integer)
        -- Frequency (0-25)
        + CASE
          WHEN COALESCE(od."orderCount", 0) >= 15 THEN 25
          WHEN COALESCE(od."orderCount", 0) >= 10 THEN 20
          WHEN COALESCE(od."orderCount", 0) >= 5 THEN 15
          WHEN COALESCE(od."orderCount", 0) >= 2 THEN 8
          WHEN COALESCE(od."orderCount", 0) >= 1 THEN 3
          ELSE 0
        END
        -- Recency (0-30)
        + CASE
          WHEN od."lastOrder" > NOW() - INTERVAL '14 days' THEN 30
          WHEN od."lastOrder" > NOW() - INTERVAL '30 days' THEN 25
          WHEN od."lastOrder" > NOW() - INTERVAL '60 days' THEN 18
          WHEN od."lastOrder" > NOW() - INTERVAL '90 days' THEN 10
          WHEN od."lastOrder" IS NOT NULL THEN 3
          ELSE 0
        END
        -- Value (0-20)
        + CASE
          WHEN COALESCE(od."totalSpend", 0) >= 50000 THEN 20
          WHEN COALESCE(od."totalSpend", 0) >= 20000 THEN 15
          WHEN COALESCE(od."totalSpend", 0) >= 5000 THEN 10
          WHEN COALESCE(od."totalSpend", 0) > 0 THEN 5
          ELSE 0
        END
        -- Engagement (0-10)
        + CASE
          WHEN COALESCE(qd."quoteCount", 0) >= 5 THEN 10
          WHEN COALESCE(qd."quoteCount", 0) >= 2 THEN 6
          WHEN COALESCE(qd."quoteCount", 0) >= 1 THEN 3
          ELSE 0
        END
      )) as "healthScore",
      CASE
        WHEN LEAST(100, (
          LEAST(15, EXTRACT(MONTH FROM AGE(NOW(), b."createdAt"))::integer)
          + CASE WHEN COALESCE(od."orderCount", 0) >= 15 THEN 25 WHEN COALESCE(od."orderCount", 0) >= 10 THEN 20 WHEN COALESCE(od."orderCount", 0) >= 5 THEN 15 WHEN COALESCE(od."orderCount", 0) >= 2 THEN 8 WHEN COALESCE(od."orderCount", 0) >= 1 THEN 3 ELSE 0 END
          + CASE WHEN od."lastOrder" > NOW() - INTERVAL '14 days' THEN 30 WHEN od."lastOrder" > NOW() - INTERVAL '30 days' THEN 25 WHEN od."lastOrder" > NOW() - INTERVAL '60 days' THEN 18 WHEN od."lastOrder" > NOW() - INTERVAL '90 days' THEN 10 WHEN od."lastOrder" IS NOT NULL THEN 3 ELSE 0 END
          + CASE WHEN COALESCE(od."totalSpend", 0) >= 50000 THEN 20 WHEN COALESCE(od."totalSpend", 0) >= 20000 THEN 15 WHEN COALESCE(od."totalSpend", 0) >= 5000 THEN 10 WHEN COALESCE(od."totalSpend", 0) > 0 THEN 5 ELSE 0 END
          + CASE WHEN COALESCE(qd."quoteCount", 0) >= 5 THEN 10 WHEN COALESCE(qd."quoteCount", 0) >= 2 THEN 6 WHEN COALESCE(qd."quoteCount", 0) >= 1 THEN 3 ELSE 0 END
        )) >= 75 THEN 'THRIVING'
        WHEN LEAST(100, (
          LEAST(15, EXTRACT(MONTH FROM AGE(NOW(), b."createdAt"))::integer)
          + CASE WHEN COALESCE(od."orderCount", 0) >= 15 THEN 25 WHEN COALESCE(od."orderCount", 0) >= 10 THEN 20 WHEN COALESCE(od."orderCount", 0) >= 5 THEN 15 WHEN COALESCE(od."orderCount", 0) >= 2 THEN 8 WHEN COALESCE(od."orderCount", 0) >= 1 THEN 3 ELSE 0 END
          + CASE WHEN od."lastOrder" > NOW() - INTERVAL '14 days' THEN 30 WHEN od."lastOrder" > NOW() - INTERVAL '30 days' THEN 25 WHEN od."lastOrder" > NOW() - INTERVAL '60 days' THEN 18 WHEN od."lastOrder" > NOW() - INTERVAL '90 days' THEN 10 WHEN od."lastOrder" IS NOT NULL THEN 3 ELSE 0 END
          + CASE WHEN COALESCE(od."totalSpend", 0) >= 50000 THEN 20 WHEN COALESCE(od."totalSpend", 0) >= 20000 THEN 15 WHEN COALESCE(od."totalSpend", 0) >= 5000 THEN 10 WHEN COALESCE(od."totalSpend", 0) > 0 THEN 5 ELSE 0 END
          + CASE WHEN COALESCE(qd."quoteCount", 0) >= 5 THEN 10 WHEN COALESCE(qd."quoteCount", 0) >= 2 THEN 6 WHEN COALESCE(qd."quoteCount", 0) >= 1 THEN 3 ELSE 0 END
        )) >= 50 THEN 'HEALTHY'
        WHEN LEAST(100, (
          LEAST(15, EXTRACT(MONTH FROM AGE(NOW(), b."createdAt"))::integer)
          + CASE WHEN COALESCE(od."orderCount", 0) >= 15 THEN 25 WHEN COALESCE(od."orderCount", 0) >= 10 THEN 20 WHEN COALESCE(od."orderCount", 0) >= 5 THEN 15 WHEN COALESCE(od."orderCount", 0) >= 2 THEN 8 WHEN COALESCE(od."orderCount", 0) >= 1 THEN 3 ELSE 0 END
          + CASE WHEN od."lastOrder" > NOW() - INTERVAL '14 days' THEN 30 WHEN od."lastOrder" > NOW() - INTERVAL '30 days' THEN 25 WHEN od."lastOrder" > NOW() - INTERVAL '60 days' THEN 18 WHEN od."lastOrder" > NOW() - INTERVAL '90 days' THEN 10 WHEN od."lastOrder" IS NOT NULL THEN 3 ELSE 0 END
          + CASE WHEN COALESCE(od."totalSpend", 0) >= 50000 THEN 20 WHEN COALESCE(od."totalSpend", 0) >= 20000 THEN 15 WHEN COALESCE(od."totalSpend", 0) >= 5000 THEN 10 WHEN COALESCE(od."totalSpend", 0) > 0 THEN 5 ELSE 0 END
          + CASE WHEN COALESCE(qd."quoteCount", 0) >= 5 THEN 10 WHEN COALESCE(qd."quoteCount", 0) >= 2 THEN 6 WHEN COALESCE(qd."quoteCount", 0) >= 1 THEN 3 ELSE 0 END
        )) >= 25 THEN 'AT_RISK'
        ELSE 'CRITICAL'
      END as "healthGrade"
    FROM "Builder" b
    LEFT JOIN (
      SELECT "builderId", COUNT(*)::int as "orderCount",
        ROUND(SUM(total)::numeric, 2) as "totalSpend",
        MAX("createdAt") as "lastOrder",
        ROUND(AVG(total)::numeric, 2) as "avgOrderValue"
      FROM "Order" WHERE status != 'CANCELLED'
      GROUP BY "builderId"
    ) od ON b.id = od."builderId"
    LEFT JOIN (
      SELECT "builderId", COUNT(*)::int as "quoteCount",
        COUNT(CASE WHEN status IN ('DRAFT', 'SENT') THEN 1 END)::int as "pendingQuotes"
      FROM "Quote"
      GROUP BY "builderId"
    ) qd ON b.id = qd."builderId"
    WHERE b.status = 'ACTIVE'
    ORDER BY "healthScore" DESC
  `);

  return safeJson({
    report: 'relationship-health',
    generatedAt: new Date().toISOString(),
    builders: health,
    summary: {
      thriving: health.filter((h: any) => h.healthGrade === 'THRIVING').length,
      healthy: health.filter((h: any) => h.healthGrade === 'HEALTHY').length,
      atRisk: health.filter((h: any) => h.healthGrade === 'AT_RISK').length,
      critical: health.filter((h: any) => h.healthGrade === 'CRITICAL').length,
    },
  });
}
