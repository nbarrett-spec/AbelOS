export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { checkStaffAuth } from '@/lib/api-auth';
import { safeJson } from '@/lib/safe-json';
import { audit } from '@/lib/audit'

// Dynamic Pricing Engine
// Manages pricing rules, optimization stats, and margin analysis
// Tables created by migration in /api/ops/revenue-intelligence/setup

async function seedDefaultRules() {
  const rules: any[] = await prisma.$queryRawUnsafe(
    `SELECT COUNT(*)::int as count FROM "DynamicPriceRule"`
  );

  if (rules[0].count > 0) return;

  const defaultRules = [
    {
      id: 'dpr_margin_floor',
      name: 'Margin Floor',
      description: 'Ensure minimum 22% margin on all products',
      ruleType: 'MARGIN_MINIMUM',
      condition: JSON.stringify({ type: 'ALL_PRODUCTS' }),
      adjustment: JSON.stringify({ minMarginPercent: 22 }),
      priority: 100,
    },
    {
      id: 'dpr_platinum_discount',
      name: 'Platinum Builder Discount',
      description: '5% discount for PLATINUM segment builders',
      ruleType: 'SEGMENT_DISCOUNT',
      condition: JSON.stringify({ segment: 'PLATINUM' }),
      adjustment: JSON.stringify({ discountPercent: 5 }),
      builderSegment: 'PLATINUM',
      priority: 80,
    },
    {
      id: 'dpr_volume_discount',
      name: 'Volume Discount',
      description: '3% off orders over $10,000',
      ruleType: 'VOLUME_DISCOUNT',
      condition: JSON.stringify({ minOrderTotal: 10000 }),
      adjustment: JSON.stringify({ discountPercent: 3 }),
      priority: 70,
    },
    {
      id: 'dpr_slow_mover_markup',
      name: 'Slow Mover Markup',
      description: 'Add 5% to products with low turnover',
      ruleType: 'PRODUCT_MARKUP',
      condition: JSON.stringify({ turnover: 'LOW' }),
      adjustment: JSON.stringify({ markupPercent: 5 }),
      priority: 50,
    },
    {
      id: 'dpr_new_builder_premium',
      name: 'New Builder Premium',
      description: 'Standard pricing for builders with < 3 orders',
      ruleType: 'NEW_BUILDER',
      condition: JSON.stringify({ maxOrderCount: 3 }),
      adjustment: JSON.stringify({ discountPercent: 0 }),
      priority: 40,
    },
  ];

  for (const rule of defaultRules) {
    await prisma.$executeRawUnsafe(
      `
      INSERT INTO "DynamicPriceRule" (id, name, description, "ruleType", "condition", adjustment, "builderSegment", priority, "isActive")
      VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8, TRUE)
      ON CONFLICT (id) DO NOTHING
      `,
      rule.id,
      rule.name,
      rule.description,
      rule.ruleType,
      rule.condition,
      rule.adjustment,
      rule.builderSegment || null,
      rule.priority
    );
  }
}

export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request);
  if (authError) return authError;

  try {
    await seedDefaultRules();

    // Get active pricing rules
    const rules: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        id, name, description, "ruleType", "condition",
        adjustment, "productCategory", "builderSegment",
        priority, "isActive", "appliedCount", "totalRevenueImpact", "createdAt"
      FROM "DynamicPriceRule"
      WHERE "isActive" = TRUE
      ORDER BY priority DESC
    `);

    // Recent optimization stats (last 30 days)
    const stats: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        COUNT(*)::int as "quotesOptimized",
        COALESCE(AVG("marginAfter" - "marginBefore"), 0)::numeric as "avgMarginImprovement",
        COALESCE(SUM("revenueImpact"), 0)::numeric as "totalRevenueImpact",
        COALESCE(AVG("aiConfidence"), 0)::numeric as "avgAIConfidence"
      FROM "QuoteOptimizationLog"
      WHERE "createdAt" > NOW() - INTERVAL '30 days'
    `);

    const recentStats = stats[0] || {
      quotesOptimized: 0,
      avgMarginImprovement: 0,
      totalRevenueImpact: 0,
      avgAIConfidence: 0,
    };

    // Product margin analysis by category — BOM-aware
    const margins: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        p.category,
        COUNT(*)::int as "productCount",
        ROUND(AVG(p."basePrice" - COALESCE(bom_cost(p.id), p.cost))::numeric, 2) as "avgMargin",
        ROUND(AVG(CASE
          WHEN p."basePrice" > 0 THEN (p."basePrice" - COALESCE(bom_cost(p.id), p.cost)) / p."basePrice" * 100
          ELSE 0
        END)::numeric, 1) as "marginPercent"
      FROM "Product" p
      WHERE p.active = TRUE AND p.category IS NOT NULL
      GROUP BY p.category
      ORDER BY "avgMargin" DESC
    `);

    // Generate recommendations based on margin analysis
    const recommendations = [];
    for (const margin of margins) {
      const marginPercent = Number(margin.marginPercent || 0);
      if (marginPercent < 25) {
        recommendations.push({
          type: 'MARGIN_FLOOR',
          description: `Set 25% min margin on ${margin.category} category (currently ${marginPercent.toFixed(1)}%)`,
          estimatedImpact: Math.round(Number(margin.avgMargin || 0) * Number(margin.productCount || 0) * 0.03),
        });
      }
    }

    // Add volume discount recommendation if not already present
    const hasVolumeRule = rules.some(r => r.ruleType === 'VOLUME_DISCOUNT');
    if (!hasVolumeRule) {
      recommendations.push({
        type: 'VOLUME_DISCOUNT',
        description: 'Enable volume discounts to incentivize larger orders',
        estimatedImpact: 5000,
      });
    }

    return safeJson({
      rules: rules.map(r => ({
        ...r,
        condition: typeof r.condition === 'string' ? JSON.parse(r.condition) : r.condition,
        adjustment: typeof r.adjustment === 'string' ? JSON.parse(r.adjustment) : r.adjustment,
      })),
      recentStats: {
        quotesOptimized: recentStats.quotesOptimized || 0,
        avgMarginImprovement: Number(recentStats.avgMarginImprovement || 0),
        totalRevenueImpact: Number(recentStats.totalRevenueImpact || 0),
        avgAIConfidence: Number(recentStats.avgAIConfidence || 0),
      },
      marginAnalysis: margins.map(m => ({
        category: m.category,
        avgMargin: Number(m.avgMargin || 0),
        marginPercent: Number(m.marginPercent || 0),
        productCount: m.productCount || 0,
      })),
      recommendations,
    });
  } catch (error: any) {
    console.error('Pricing engine GET error:', error);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request);
  if (authError) return authError;

  try {
    // Audit log
    audit(request, 'CREATE', 'RevenueIntelligence', undefined, { method: 'POST' }).catch(() => {})

    await seedDefaultRules();

    let body: any = {};
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Request body required' }, { status: 400 });
    }
    const { action } = body;

    switch (action) {
      case 'create_rule':
        return await createRule(body);
      case 'optimize_quote':
        return await optimizeQuote(body);
      default:
        return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
    }
  } catch (error: any) {
    console.error('Pricing engine POST error:', error);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}

async function createRule(body: any) {
  const { name, ruleType, condition, adjustment, productCategory, builderSegment } = body;

  if (!name || !ruleType || !adjustment) {
    return NextResponse.json(
      { error: 'name, ruleType, and adjustment required' },
      { status: 400 }
    );
  }

  const id = 'dpr_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

  await prisma.$executeRawUnsafe(
    `
    INSERT INTO "DynamicPriceRule" (id, name, "ruleType", "condition", adjustment, "productCategory", "builderSegment", "isActive")
    VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7, TRUE)
    `,
    id,
    name,
    ruleType,
    typeof condition === 'string' ? condition : JSON.stringify(condition || {}),
    typeof adjustment === 'string' ? adjustment : JSON.stringify(adjustment),
    productCategory || null,
    builderSegment || null
  );

  return safeJson({ success: true, ruleId: id });
}

async function optimizeQuote(body: any) {
  const { quoteId, builderId, items } = body;

  if (!quoteId && !builderId) {
    return NextResponse.json(
      { error: 'quoteId or (builderId + items) required' },
      { status: 400 }
    );
  }

  // Get builder segment for personalization
  let builderSegment = 'STANDARD';
  let builderOrderCount = 0;

  if (builderId) {
    const builderStats: any[] = await prisma.$queryRawUnsafe(
      `
      SELECT COUNT(*)::int as "orderCount"
      FROM "Order"
      WHERE "builderId" = $1 AND status != 'CANCELLED'::"OrderStatus"
      `,
      builderId
    );

    if (builderStats[0]) {
      builderOrderCount = builderStats[0].orderCount || 0;
    }

    // Determine segment based on lifetime value
    const segmentData: any[] = await prisma.$queryRawUnsafe(
      `
      SELECT COALESCE(SUM(o.total), 0)::numeric as "lifetimeRevenue"
      FROM "Order" o
      WHERE o."builderId" = $1 AND o.status != 'CANCELLED'::"OrderStatus"
      `,
      builderId
    );

    const lifetime = Number(segmentData[0]?.lifetimeRevenue || 0);
    if (lifetime >= 500000) builderSegment = 'PLATINUM';
    else if (lifetime >= 250000) builderSegment = 'GOLD';
    else if (lifetime >= 100000) builderSegment = 'SILVER';
  }

  // Get active rules ordered by priority
  const rules: any[] = await prisma.$queryRawUnsafe(`
    SELECT id, name, "ruleType", adjustment, "condition"
    FROM "DynamicPriceRule"
    WHERE "isActive" = TRUE
    ORDER BY priority DESC
  `);

  // Get products for optimization
  let products: any[] = [];
  if (items && Array.isArray(items)) {
    for (const item of items) {
      const product: any[] = await prisma.$queryRawUnsafe(
        `
        SELECT id, "basePrice", COALESCE(bom_cost(id), cost) as cost, category
        FROM "Product"
        WHERE id = $1 AND active = TRUE
        `,
        item.productId
      );
      if (product[0]) {
        products.push({
          ...product[0],
          quantity: item.quantity || 1,
          originalPrice: product[0].basePrice,
        });
      }
    }
  }

  // Calculate optimized prices
  const optimizedItems = [];
  let totalDiscount = 0;
  const appliedRules: string[] = [];

  for (const product of products) {
    let finalPrice = product.originalPrice;
    const baseCost = product.cost;
    const baseMargin = product.originalPrice > 0 ? (product.originalPrice - baseCost) / product.originalPrice : 0;

    // Apply each rule in priority order
    for (const rule of rules) {
      const adjustment = typeof rule.adjustment === 'string' ? JSON.parse(rule.adjustment) : rule.adjustment;

      switch (rule.ruleType) {
        case 'MARGIN_MINIMUM':
          if (baseMargin < (adjustment.minMarginPercent || 22) / 100) {
            finalPrice = baseCost / (1 - (adjustment.minMarginPercent || 22) / 100);
            if (!appliedRules.includes(rule.name)) appliedRules.push(rule.name);
          }
          break;

        case 'SEGMENT_DISCOUNT':
          if (builderSegment === 'PLATINUM' && (adjustment.discountPercent || 0) > 0) {
            const discount = finalPrice * ((adjustment.discountPercent || 0) / 100);
            finalPrice -= discount;
            totalDiscount += discount * product.quantity;
            if (!appliedRules.includes(rule.name)) appliedRules.push(rule.name);
          }
          break;

        case 'VOLUME_DISCOUNT':
          if ((adjustment.discountPercent || 0) > 0) {
            const discount = finalPrice * ((adjustment.discountPercent || 0) / 100);
            finalPrice -= discount;
            totalDiscount += discount * product.quantity;
          }
          break;

        case 'PRODUCT_MARKUP':
          if ((adjustment.markupPercent || 0) > 0) {
            finalPrice *= (1 + (adjustment.markupPercent || 0) / 100);
            if (!appliedRules.includes(rule.name)) appliedRules.push(rule.name);
          }
          break;

        case 'NEW_BUILDER':
          if (builderOrderCount < 3 && (adjustment.discountPercent || 0) === 0) {
            if (!appliedRules.includes(rule.name)) appliedRules.push(rule.name);
          }
          break;
      }
    }

    optimizedItems.push({
      productId: product.id,
      originalPrice: Number(product.originalPrice),
      optimizedPrice: Number(finalPrice.toFixed(2)),
      quantity: product.quantity,
      lineTotal: Number((finalPrice * product.quantity).toFixed(2)),
    });
  }

  const originalTotal = optimizedItems.reduce((sum, i) => sum + i.originalPrice * i.quantity, 0);
  const optimizedTotal = optimizedItems.reduce((sum, i) => sum + i.lineTotal, 0);
  const marginBefore = originalTotal > 0 ? (originalTotal - products.reduce((s, p) => s + p.cost * p.quantity, 0)) / originalTotal * 100 : 0;
  const marginAfter = optimizedTotal > 0 ? (optimizedTotal - products.reduce((s, p) => s + p.cost * p.quantity, 0)) / optimizedTotal * 100 : 0;

  // Log optimization (using actual migration column names)
  if (quoteId || builderId) {
    const logId = 'qol_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    await prisma.$executeRawUnsafe(
      `
      INSERT INTO "QuoteOptimizationLog" (
        id, "quoteId", "builderId", "originalTotal", "optimizedTotal",
        "marginBefore", "marginAfter", "rulesApplied", "revenueImpact",
        "builderSegment", "aiConfidence", "aiReasoning"
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11, $12)
      `,
      logId,
      quoteId || 'unspecified',
      builderId || 'unspecified',
      originalTotal,
      optimizedTotal,
      marginBefore,
      marginAfter,
      JSON.stringify(appliedRules),
      optimizedTotal - originalTotal,
      builderSegment,
      0.82,
      `Applied ${appliedRules.length} rules for ${builderSegment} builder segment`
    );
  }

  return safeJson({
    success: true,
    optimized: {
      items: optimizedItems,
      originalTotal: Number(originalTotal.toFixed(2)),
      optimizedTotal: Number(optimizedTotal.toFixed(2)),
      totalDiscount: Number(totalDiscount.toFixed(2)),
      marginBefore: Number(marginBefore.toFixed(2)),
      marginAfter: Number(marginAfter.toFixed(2)),
      appliedRules,
      reasoning: `Optimized pricing for ${builderSegment} segment builder. Applied ${appliedRules.length} active rules.`,
    },
  });
}
