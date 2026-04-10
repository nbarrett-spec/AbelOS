export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { checkStaffAuth } from '@/lib/api-auth'
import { safeJson } from '@/lib/safe-json'

// Smart Pricing Engine API
// Analyzes margins across all products and builders, flags issues, suggests optimizations

export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const { searchParams } = new URL(request.url);
    const report = searchParams.get('report') || 'overview';

    switch (report) {
      case 'overview':
        return await getMarginOverview();
      case 'alerts':
        return await getMarginAlerts();
      case 'builder-margins':
        return await getBuilderMargins();
      case 'category-margins':
        return await getCategoryMargins();
      case 'opportunities':
        return await getOptimizationOpportunities();
      case 'revenue-leaks':
        return await getRevenueLeaks();
      default:
        return safeJson({ error: 'Unknown report type' }, { status: 400 });
    }
  } catch (error) {
    console.error('Pricing engine error:', error);
    return safeJson({ error: 'Internal server error' }, { status: 500 });
  }
}

// =====================================================
// OVERVIEW: High-level margin health across the business
// =====================================================
async function getMarginOverview() {
  // Product-level margin stats (BOM-aware: uses bom_cost() for assembled products)
  const productStats: any[] = await prisma.$queryRawUnsafe(`
    SELECT
      COUNT(*)::int as "totalProducts",
      COUNT(CASE WHEN active = true THEN 1 END)::int as "activeProducts",
      ROUND(AVG(CASE WHEN COALESCE(bom_cost(p.id), p.cost) > 0 AND p."basePrice" > 0 THEN ((p."basePrice" - COALESCE(bom_cost(p.id), p.cost)) / p."basePrice") * 100 END)::numeric, 1) as "avgMarginPct",
      ROUND(MIN(CASE WHEN COALESCE(bom_cost(p.id), p.cost) > 0 AND p."basePrice" > 0 AND p.active = true THEN ((p."basePrice" - COALESCE(bom_cost(p.id), p.cost)) / p."basePrice") * 100 END)::numeric, 1) as "minMarginPct",
      ROUND(MAX(CASE WHEN COALESCE(bom_cost(p.id), p.cost) > 0 AND p."basePrice" > 0 THEN ((p."basePrice" - COALESCE(bom_cost(p.id), p.cost)) / p."basePrice") * 100 END)::numeric, 1) as "maxMarginPct",
      COUNT(CASE WHEN COALESCE(bom_cost(p.id), p.cost) > 0 AND p."basePrice" > 0 AND ((p."basePrice" - COALESCE(bom_cost(p.id), p.cost)) / p."basePrice") < p."minMargin" THEN 1 END)::int as "belowMinMargin",
      COUNT(CASE WHEN COALESCE(bom_cost(p.id), p.cost) = 0 OR p.cost IS NULL THEN 1 END)::int as "missingCost",
      COUNT(CASE WHEN p."basePrice" = 0 OR p."basePrice" IS NULL THEN 1 END)::int as "missingPrice",
      ROUND(SUM(CASE WHEN COALESCE(bom_cost(p.id), p.cost) > 0 AND p."basePrice" > 0 THEN p."basePrice" - COALESCE(bom_cost(p.id), p.cost) ELSE 0 END)::numeric, 2) as "totalMarginDollars"
    FROM "Product" p
  `);

  // Custom pricing stats
  const customPricingStats: any[] = await prisma.$queryRawUnsafe(`
    SELECT
      COUNT(*)::int as "totalCustomPrices",
      COUNT(DISTINCT bp."builderId")::int as "buildersWithCustomPricing",
      ROUND(AVG(CASE WHEN COALESCE(bom_cost(p.id), p.cost) > 0 AND bp."customPrice" > 0
        THEN ((bp."customPrice" - COALESCE(bom_cost(p.id), p.cost)) / bp."customPrice") * 100 END)::numeric, 1) as "avgCustomMarginPct",
      COUNT(CASE WHEN COALESCE(bom_cost(p.id), p.cost) > 0 AND bp."customPrice" > 0
        AND ((bp."customPrice" - COALESCE(bom_cost(p.id), p.cost)) / bp."customPrice") < p."minMargin" THEN 1 END)::int as "customBelowMinMargin"
    FROM "BuilderPricing" bp
    JOIN "Product" p ON bp."productId" = p.id
  `);

  // Revenue from recent orders (last 90 days)
  const revenueStats: any[] = await prisma.$queryRawUnsafe(`
    SELECT
      COUNT(DISTINCT o.id)::int as "recentOrders",
      ROUND(COALESCE(SUM(oi."lineTotal"), 0)::numeric, 2) as "recentRevenue",
      ROUND(COALESCE(SUM(oi."lineTotal" - (oi.quantity * COALESCE(bom_cost(p.id), p.cost, 0))), 0)::numeric, 2) as "recentGrossProfit",
      ROUND(
        CASE WHEN SUM(oi."lineTotal") > 0
          THEN (SUM(oi."lineTotal" - (oi.quantity * COALESCE(bom_cost(p.id), p.cost, 0))) / SUM(oi."lineTotal")) * 100
          ELSE 0
        END::numeric, 1
      ) as "recentMarginPct"
    FROM "Order" o
    JOIN "OrderItem" oi ON o.id = oi."orderId"
    LEFT JOIN "Product" p ON oi."productId" = p.id
    WHERE o."createdAt" > NOW() - INTERVAL '90 days'
  `);

  return safeJson({
    report: 'overview',
    generatedAt: new Date().toISOString(),
    productHealth: productStats[0] || {},
    customPricing: customPricingStats[0] || {},
    recentPerformance: revenueStats[0] || {},
  });
}

// =====================================================
// ALERTS: Products and pricing that need immediate attention
// =====================================================
async function getMarginAlerts() {
  // Products selling below minimum margin
  const belowMinMargin: any[] = await prisma.$queryRawUnsafe(`
    SELECT
      p.id, p.sku, p.name, p.category,
      COALESCE(bom_cost(p.id), p.cost) as cost,
      p.cost as "storedCost",
      p."basePrice", p."minMargin",
      ROUND((("basePrice" - COALESCE(bom_cost(p.id), p.cost)) / "basePrice" * 100)::numeric, 1) as "currentMarginPct",
      ROUND(("minMargin" * 100)::numeric, 1) as "targetMarginPct",
      ROUND(("basePrice" - (COALESCE(bom_cost(p.id), p.cost) / (1 - "minMargin")))::numeric, 2) as "marginGapDollars"
    FROM "Product" p
    WHERE p.active = true
      AND COALESCE(bom_cost(p.id), p.cost) > 0
      AND p."basePrice" > 0
      AND (("basePrice" - COALESCE(bom_cost(p.id), p.cost)) / "basePrice") < "minMargin"
    ORDER BY (("basePrice" - COALESCE(bom_cost(p.id), p.cost)) / "basePrice") ASC
    LIMIT 50
  `);

  // Custom prices below cost (losing money!) — BOM-aware
  const belowCost: any[] = await prisma.$queryRawUnsafe(`
    SELECT
      bp.id as "pricingId", bp."customPrice", bp.margin,
      p.id as "productId", p.sku, p.name, p.category,
      COALESCE(bom_cost(p.id), p.cost) as cost,
      p.cost as "storedCost", p."basePrice",
      b.id as "builderId", b."companyName",
      ROUND((bp."customPrice" - COALESCE(bom_cost(p.id), p.cost))::numeric, 2) as "lossPerUnit"
    FROM "BuilderPricing" bp
    JOIN "Product" p ON bp."productId" = p.id
    JOIN "Builder" b ON bp."builderId" = b.id
    WHERE COALESCE(bom_cost(p.id), p.cost) > 0 AND bp."customPrice" < COALESCE(bom_cost(p.id), p.cost)
    ORDER BY (bp."customPrice" - COALESCE(bom_cost(p.id), p.cost)) ASC
    LIMIT 50
  `);

  // Products with missing cost data (can't calculate margin) — BOM-aware
  const missingCost: any[] = await prisma.$queryRawUnsafe(`
    SELECT p.id, p.sku, p.name, p.category, p."basePrice",
      CASE WHEN bom_cost(p.id) IS NOT NULL THEN true ELSE false END as "hasBOM"
    FROM "Product" p
    WHERE p.active = true AND COALESCE(bom_cost(p.id), p.cost, 0) = 0
    ORDER BY p."basePrice" DESC
    LIMIT 50
  `);

  // Stale pricing (base price hasn't changed in 6+ months) — BOM-aware
  const stalePricing: any[] = await prisma.$queryRawUnsafe(`
    SELECT
      p.id, p.sku, p.name, p.category,
      COALESCE(bom_cost(p.id), p.cost) as cost,
      p.cost as "storedCost", p."basePrice",
      ROUND(((p."basePrice" - COALESCE(bom_cost(p.id), p.cost)) / p."basePrice" * 100)::numeric, 1) as "marginPct",
      p."updatedAt"
    FROM "Product" p
    WHERE p.active = true
      AND COALESCE(bom_cost(p.id), p.cost) > 0
      AND p."basePrice" > 0
      AND p."updatedAt" < NOW() - INTERVAL '180 days'
    ORDER BY p."updatedAt" ASC
    LIMIT 50
  `);

  return safeJson({
    report: 'alerts',
    generatedAt: new Date().toISOString(),
    belowMinMargin: { count: belowMinMargin.length, items: belowMinMargin },
    belowCost: { count: belowCost.length, items: belowCost },
    missingCost: { count: missingCost.length, items: missingCost },
    stalePricing: { count: stalePricing.length, items: stalePricing },
    totalAlerts: belowMinMargin.length + belowCost.length + missingCost.length + stalePricing.length,
  });
}

// =====================================================
// BUILDER MARGINS: Profitability by builder account
// =====================================================
async function getBuilderMargins() {
  // Margin analysis per builder based on their actual orders — BOM-aware
  const builderMargins: any[] = await prisma.$queryRawUnsafe(`
    SELECT
      b.id, b."companyName",
      COUNT(DISTINCT o.id)::int as "orderCount",
      ROUND(COALESCE(SUM(oi."lineTotal"), 0)::numeric, 2) as "totalRevenue",
      ROUND(COALESCE(SUM(oi."lineTotal" - (oi.quantity * COALESCE(bom_cost(p.id), p.cost, 0))), 0)::numeric, 2) as "totalGrossProfit",
      ROUND(
        CASE WHEN SUM(oi."lineTotal") > 0
          THEN (SUM(oi."lineTotal" - (oi.quantity * COALESCE(bom_cost(p.id), p.cost, 0))) / SUM(oi."lineTotal")) * 100
          ELSE 0
        END::numeric, 1
      ) as "avgMarginPct",
      COUNT(DISTINCT oi."productId")::int as "uniqueProducts",
      MAX(o."createdAt") as "lastOrderDate"
    FROM "Builder" b
    LEFT JOIN "Order" o ON b.id = o."builderId"
    LEFT JOIN "OrderItem" oi ON o.id = oi."orderId"
    LEFT JOIN "Product" p ON oi."productId" = p.id
    GROUP BY b.id, b."companyName"
    ORDER BY "totalRevenue" DESC NULLS LAST
  `);

  // Custom pricing discount analysis per builder
  const discountAnalysis: any[] = await prisma.$queryRawUnsafe(`
    SELECT
      b.id as "builderId", b."companyName",
      COUNT(bp.id)::int as "customPriceCount",
      ROUND(AVG(CASE WHEN p."basePrice" > 0
        THEN ((p."basePrice" - bp."customPrice") / p."basePrice") * 100
        END)::numeric, 1) as "avgDiscountPct",
      ROUND(SUM(p."basePrice" - bp."customPrice")::numeric, 2) as "totalDiscountDollars",
      ROUND(AVG(CASE WHEN COALESCE(bom_cost(p.id), p.cost) > 0 AND bp."customPrice" > 0
        THEN ((bp."customPrice" - COALESCE(bom_cost(p.id), p.cost)) / bp."customPrice") * 100
        END)::numeric, 1) as "avgCustomMarginPct"
    FROM "Builder" b
    JOIN "BuilderPricing" bp ON b.id = bp."builderId"
    JOIN "Product" p ON bp."productId" = p.id
    GROUP BY b.id, b."companyName"
    HAVING COUNT(bp.id) > 0
    ORDER BY "avgDiscountPct" DESC NULLS LAST
  `);

  return safeJson({
    report: 'builder-margins',
    generatedAt: new Date().toISOString(),
    builders: builderMargins,
    discountAnalysis,
  });
}

// =====================================================
// CATEGORY MARGINS: Profitability by product category
// =====================================================
async function getCategoryMargins() {
  // Margin by category from catalog — BOM-aware
  const categoryMargins: any[] = await prisma.$queryRawUnsafe(`
    SELECT
      p.category,
      COUNT(*)::int as "productCount",
      ROUND(AVG(CASE WHEN COALESCE(bom_cost(p.id), p.cost) > 0 AND p."basePrice" > 0
        THEN ((p."basePrice" - COALESCE(bom_cost(p.id), p.cost)) / p."basePrice") * 100 END)::numeric, 1) as "avgMarginPct",
      ROUND(MIN(CASE WHEN COALESCE(bom_cost(p.id), p.cost) > 0 AND p."basePrice" > 0
        THEN ((p."basePrice" - COALESCE(bom_cost(p.id), p.cost)) / p."basePrice") * 100 END)::numeric, 1) as "minMarginPct",
      ROUND(MAX(CASE WHEN COALESCE(bom_cost(p.id), p.cost) > 0 AND p."basePrice" > 0
        THEN ((p."basePrice" - COALESCE(bom_cost(p.id), p.cost)) / p."basePrice") * 100 END)::numeric, 1) as "maxMarginPct",
      ROUND(AVG(COALESCE(bom_cost(p.id), p.cost))::numeric, 2) as "avgCost",
      ROUND(AVG(p."basePrice")::numeric, 2) as "avgPrice",
      COUNT(CASE WHEN COALESCE(bom_cost(p.id), p.cost) > 0 AND p."basePrice" > 0
        AND ((p."basePrice" - COALESCE(bom_cost(p.id), p.cost)) / p."basePrice") < p."minMargin" THEN 1 END)::int as "belowTarget"
    FROM "Product" p
    WHERE p.active = true
    GROUP BY p.category
    ORDER BY "avgMarginPct" ASC NULLS LAST
  `);

  // Actual sold margin by category (from orders) — BOM-aware
  const soldMargins: any[] = await prisma.$queryRawUnsafe(`
    SELECT
      COALESCE(p.category, 'Unknown') as category,
      COUNT(*)::int as "lineItems",
      ROUND(SUM(oi."lineTotal")::numeric, 2) as "revenue",
      ROUND(SUM(oi."lineTotal" - (oi.quantity * COALESCE(bom_cost(p.id), p.cost, 0)))::numeric, 2) as "grossProfit",
      ROUND(
        CASE WHEN SUM(oi."lineTotal") > 0
          THEN (SUM(oi."lineTotal" - (oi.quantity * COALESCE(bom_cost(p.id), p.cost, 0))) / SUM(oi."lineTotal")) * 100
          ELSE 0
        END::numeric, 1
      ) as "realizedMarginPct"
    FROM "OrderItem" oi
    LEFT JOIN "Product" p ON oi."productId" = p.id
    GROUP BY p.category
    ORDER BY "revenue" DESC NULLS LAST
  `);

  return safeJson({
    report: 'category-margins',
    generatedAt: new Date().toISOString(),
    catalogMargins: categoryMargins,
    soldMargins,
  });
}

// =====================================================
// OPPORTUNITIES: Where Abel can make more money
// =====================================================
async function getOptimizationOpportunities() {
  // Products with high volume but below-average margin (price increase candidates) — BOM-aware
  const priceIncreaseTargets: any[] = await prisma.$queryRawUnsafe(`
    SELECT
      p.id, p.sku, p.name, p.category,
      COALESCE(bom_cost(p.id), p.cost) as cost,
      p.cost as "storedCost", p."basePrice",
      ROUND(((p."basePrice" - COALESCE(bom_cost(p.id), p.cost)) / p."basePrice" * 100)::numeric, 1) as "marginPct",
      COALESCE(sales."totalQty", 0) as "totalQtySold",
      COALESCE(sales."totalRevenue", 0) as "totalRevenue",
      ROUND((avg_margin."avgCategoryMargin")::numeric, 1) as "categoryAvgMargin",
      ROUND((avg_margin."avgCategoryMargin" - ((p."basePrice" - COALESCE(bom_cost(p.id), p.cost)) / p."basePrice" * 100))::numeric, 1) as "marginGapVsCategory"
    FROM "Product" p
    LEFT JOIN (
      SELECT oi."productId", SUM(oi.quantity) as "totalQty", SUM(oi."lineTotal") as "totalRevenue"
      FROM "OrderItem" oi GROUP BY oi."productId"
    ) sales ON p.id = sales."productId"
    LEFT JOIN (
      SELECT category, AVG(CASE WHEN COALESCE(bom_cost(pp.id), pp.cost) > 0 AND pp."basePrice" > 0
        THEN ((pp."basePrice" - COALESCE(bom_cost(pp.id), pp.cost)) / pp."basePrice") * 100 END) as "avgCategoryMargin"
      FROM "Product" pp WHERE pp.active = true GROUP BY pp.category
    ) avg_margin ON p.category = avg_margin.category
    WHERE p.active = true
      AND COALESCE(bom_cost(p.id), p.cost) > 0
      AND p."basePrice" > 0
      AND ((p."basePrice" - COALESCE(bom_cost(p.id), p.cost)) / p."basePrice" * 100) < avg_margin."avgCategoryMargin" - 5
    ORDER BY COALESCE(sales."totalRevenue", 0) DESC
    LIMIT 30
  `);

  // Builders getting steep discounts but with low order volume
  const overDiscounted: any[] = await prisma.$queryRawUnsafe(`
    SELECT
      b.id as "builderId", b."companyName",
      COUNT(bp.id) as "customPriceCount",
      ROUND(AVG(CASE WHEN p."basePrice" > 0
        THEN ((p."basePrice" - bp."customPrice") / p."basePrice") * 100 END)::numeric, 1) as "avgDiscountPct",
      COALESCE(orders."orderCount", 0) as "orderCount",
      COALESCE(ROUND(orders."totalSpend"::numeric, 2), 0) as "totalSpend"
    FROM "Builder" b
    JOIN "BuilderPricing" bp ON b.id = bp."builderId"
    JOIN "Product" p ON bp."productId" = p.id
    LEFT JOIN (
      SELECT o."builderId", COUNT(o.id) as "orderCount", SUM(oi."lineTotal") as "totalSpend"
      FROM "Order" o JOIN "OrderItem" oi ON o.id = oi."orderId"
      GROUP BY o."builderId"
    ) orders ON b.id = orders."builderId"
    GROUP BY b.id, b."companyName", orders."orderCount", orders."totalSpend"
    HAVING AVG(CASE WHEN p."basePrice" > 0
      THEN ((p."basePrice" - bp."customPrice") / p."basePrice") * 100 END) > 15
    ORDER BY "avgDiscountPct" DESC
    LIMIT 20
  `);

  // Products builders buy elsewhere (they order some categories but not others)
  const crossSellGaps: any[] = await prisma.$queryRawUnsafe(`
    SELECT
      b.id as "builderId", b."companyName",
      buyer_cats.categories as "purchasedCategories",
      all_cats."allCategories",
      all_cats."totalCategories" - COALESCE(array_length(buyer_cats.categories, 1), 0) as "missingCategoryCount"
    FROM "Builder" b
    JOIN (
      SELECT o."builderId", ARRAY_AGG(DISTINCT p.category) as categories
      FROM "Order" o
      JOIN "OrderItem" oi ON o.id = oi."orderId"
      JOIN "Product" p ON oi."productId" = p.id
      GROUP BY o."builderId"
    ) buyer_cats ON b.id = buyer_cats."builderId"
    CROSS JOIN (
      SELECT ARRAY_AGG(DISTINCT category) as "allCategories", COUNT(DISTINCT category) as "totalCategories"
      FROM "Product" WHERE active = true
    ) all_cats
    WHERE all_cats."totalCategories" - COALESCE(array_length(buyer_cats.categories, 1), 0) > 0
    ORDER BY "missingCategoryCount" DESC
    LIMIT 20
  `);

  return safeJson({
    report: 'opportunities',
    generatedAt: new Date().toISOString(),
    priceIncreaseTargets: { count: priceIncreaseTargets.length, items: priceIncreaseTargets },
    overDiscounted: { count: overDiscounted.length, items: overDiscounted },
    crossSellGaps: { count: crossSellGaps.length, items: crossSellGaps },
  });
}

// =====================================================
// REVENUE LEAKS: Money Abel is losing right now
// =====================================================
async function getRevenueLeaks() {
  // Quotes that expired without converting to orders
  const expiredQuotes: any[] = await prisma.$queryRawUnsafe(`
    SELECT
      COUNT(*)::int as "expiredCount",
      ROUND(COALESCE(SUM(q."total"), 0)::numeric, 2) as "lostRevenue"
    FROM "Quote" q
    WHERE q.status = 'EXPIRED'
      AND q."createdAt" > NOW() - INTERVAL '180 days'
  `);

  // Quote-to-order conversion rate
  const conversionRate: any[] = await prisma.$queryRawUnsafe(`
    SELECT
      COUNT(*)::int as "totalQuotes",
      COUNT(CASE WHEN status = 'ORDERED' THEN 1 END)::int as "convertedToOrder",
      COUNT(CASE WHEN status = 'EXPIRED' THEN 1 END)::int as "expired",
      COUNT(CASE WHEN status = 'DRAFT' THEN 1 END)::int as "stillDraft",
      ROUND(
        CASE WHEN COUNT(*) > 0
          THEN COUNT(CASE WHEN status = 'ORDERED' THEN 1 END)::numeric / COUNT(*)::numeric * 100
          ELSE 0
        END, 1
      ) as "conversionPct"
    FROM "Quote"
    WHERE "createdAt" > NOW() - INTERVAL '180 days'
  `);

  // Orders with payment issues
  const paymentIssues: any[] = await prisma.$queryRawUnsafe(`
    SELECT
      COUNT(CASE WHEN "paymentStatus" = 'PENDING' AND "createdAt" < NOW() - INTERVAL '30 days' THEN 1 END)::int as "overdue30",
      COUNT(CASE WHEN "paymentStatus" = 'PENDING' AND "createdAt" < NOW() - INTERVAL '60 days' THEN 1 END)::int as "overdue60",
      COUNT(CASE WHEN "paymentStatus" = 'PENDING' AND "createdAt" < NOW() - INTERVAL '90 days' THEN 1 END)::int as "overdue90",
      ROUND(COALESCE(SUM(CASE WHEN "paymentStatus" = 'PENDING' AND "createdAt" < NOW() - INTERVAL '30 days'
        THEN total ELSE 0 END), 0)::numeric, 2) as "overdueAmount"
    FROM "Order"
  `);

  return safeJson({
    report: 'revenue-leaks',
    generatedAt: new Date().toISOString(),
    expiredQuotes: expiredQuotes[0] || {},
    conversionRate: conversionRate[0] || {},
    paymentIssues: paymentIssues[0] || {},
  });
}
