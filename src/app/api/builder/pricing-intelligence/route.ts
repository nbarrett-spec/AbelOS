import { getSession } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// Response type exports
export interface TierStatus {
  currentTier: string;
  totalSpend: number;
  tierBenefits: Record<string, { minDiscount: number; maxDiscount: number }>;
  nextTier: string | null;
  spendNeededForNextTier: number;
}

export interface SavingsBreakdownItem {
  month: string;
  totalSpend: number;
  basePriceTotal: number;
  actualPaid: number;
  savings: number;
  savingsPercent: number;
}

export interface CategoryPricingItem {
  category: string;
  baseAvgPrice: number;
  actualAvgPrice: number;
  discountPercent: number;
  totalSpent: number;
  itemsOrdered: number;
}

export interface CustomDealItem {
  productName: string;
  sku: string;
  basePrice: number;
  customPrice: number;
  savingsPerUnit: number;
  unitsOrdered: number;
  totalUnitSavings: number;
}

export interface TierComparisonItem {
  tier: string;
  estimatedCost: number;
  actualCost: number;
  estimatedSavings: number;
  savingsPercent: number;
}

export interface PricingIntelligenceResponse {
  tierStatus: TierStatus;
  savingsBreakdown: SavingsBreakdownItem[];
  categoryPricing: CategoryPricingItem[];
  customDeals: CustomDealItem[];
  tierComparison: TierComparisonItem[];
}

// Tier thresholds in dollars
const TIER_THRESHOLDS = {
  STANDARD: 0,
  SILVER: 50000,
  GOLD: 150000,
  PLATINUM: 500000,
};

const TIER_ORDER = ['STANDARD', 'SILVER', 'GOLD', 'PLATINUM'] as const;

export async function GET(request: NextRequest) {
  try {
    // Auth check
    const session = await getSession();
    if (!session?.builderId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const builderId = session.builderId;

    // Fetch builder info and tier details
    const [builderRows, tierRuleRows, last12Months] = await Promise.all([
      prisma.$queryRawUnsafe(
        `SELECT id, "companyName", "pricingTier", "creditLimit" FROM "Builder" WHERE id = $1`,
        builderId
      ) as Promise<any[]>,
      prisma.$queryRawUnsafe(
        `SELECT "tierName", category, "marginPercent", "minMargin", active FROM "PricingTierRule" WHERE active = true`
      ) as Promise<any[]>,
      getLastTwelveMonths(),
    ]);

    if (!builderRows || builderRows.length === 0) {
      return NextResponse.json({ error: 'Builder not found' }, { status: 404 });
    }

    const builderData = builderRows[0] as any;
    const currentTier = builderData.pricingTier;

    // Get last 12 months of orders
    const orders = await prisma.$queryRaw`
      SELECT
        o.id,
        o."builderId",
        o.status,
        o.total,
        o."createdAt",
        oi."productId",
        oi.quantity,
        oi."unitPrice",
        oi."lineTotal",
        p.category,
        p."basePrice",
        p.cost
      FROM "Order" o
      LEFT JOIN "OrderItem" oi ON o.id = oi."orderId"
      LEFT JOIN "Product" p ON oi."productId" = p.id
      WHERE o."builderId" = ${builderId}
        AND o."createdAt" >= NOW() - INTERVAL '12 months'
        AND o.status != 'CANCELLED'
      ORDER BY o."createdAt" DESC
    `;

    // Get custom pricing for this builder
    const customPricing = await prisma.$queryRaw`
      SELECT
        bp."builderId",
        bp."productId",
        bp."customPrice",
        p.sku,
        p.name,
        p."basePrice",
        p.category
      FROM "BuilderPricing" bp
      LEFT JOIN "Product" p ON bp."productId" = p.id
      WHERE bp."builderId" = ${builderId}
    `;

    // Calculate tier status
    const tierStatus = calculateTierStatus(currentTier, orders as any[]);

    // Calculate savings breakdown by month
    const savingsBreakdown = calculateSavingsBreakdown(orders as any[], last12Months);

    // Calculate category pricing
    const categoryPricing = calculateCategoryPricing(orders as any[]);

    // Calculate custom deals
    const customDeals = calculateCustomDeals(customPricing as any[], orders as any[]);

    // Calculate tier comparison
    const tierComparison = calculateTierComparison(orders as any[], tierRuleRows as any[]);

    const response: PricingIntelligenceResponse = {
      tierStatus,
      savingsBreakdown,
      categoryPricing,
      customDeals,
      tierComparison,
    };

    return NextResponse.json(response, {
      headers: {
        'Cache-Control': 'private, max-age=300', // Cache for 5 minutes
      },
    });
  } catch (error) {
    console.error('Pricing intelligence error:', error);
    return NextResponse.json(
      {
        error: 'Failed to calculate pricing intelligence',
        tierStatus: {
          currentTier: 'UNKNOWN',
          totalSpend: 0,
          tierBenefits: {},
          nextTier: null,
          spendNeededForNextTier: 0,
        },
        savingsBreakdown: [],
        categoryPricing: [],
        customDeals: [],
        tierComparison: [],
      } as PricingIntelligenceResponse,
      { status: 200 } // Return 200 with empty data rather than 500
    );
  }
}

function getLastTwelveMonths(): string[] {
  const months = [];
  const now = new Date();
  for (let i = 11; i >= 0; i--) {
    const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push(date.toISOString().slice(0, 7)); // YYYY-MM
  }
  return months;
}

function calculateTierStatus(currentTier: string, orders: any[]) {
  // Group orders by month for total spend
  const monthlySpend = new Map<string, number>();
  orders.forEach((order) => {
    const month = new Date(order.createdAt).toISOString().slice(0, 7);
    monthlySpend.set(month, (monthlySpend.get(month) || 0) + (order.total || 0));
  });

  const totalSpend = Array.from(monthlySpend.values()).reduce((a, b) => a + b, 0);

  // Find next tier
  let nextTier: string | null = null;
  let nextTierThreshold = 0;
  for (const tier of TIER_ORDER) {
    if (TIER_THRESHOLDS[tier as keyof typeof TIER_THRESHOLDS] > TIER_THRESHOLDS[currentTier as keyof typeof TIER_THRESHOLDS]) {
      nextTier = tier;
      nextTierThreshold = TIER_THRESHOLDS[tier as keyof typeof TIER_THRESHOLDS];
      break;
    }
  }

  const spendNeededForNextTier = nextTier ? Math.max(0, nextTierThreshold - totalSpend) : 0;

  // Build tier benefits from margin rules
  const tierBenefits: Record<string, { minDiscount: number; maxDiscount: number }> = {};

  return {
    currentTier,
    totalSpend: Math.round(totalSpend * 100) / 100,
    tierBenefits,
    nextTier,
    spendNeededForNextTier: Math.round(spendNeededForNextTier * 100) / 100,
  };
}

function calculateSavingsBreakdown(orders: any[], months: string[]) {
  const breakdown: Array<{
    month: string;
    totalSpend: number;
    basePriceTotal: number;
    actualPaid: number;
    savings: number;
    savingsPercent: number;
  }> = [];

  months.forEach((month) => {
    const monthOrders = orders.filter(
      (o) => o.createdAt && new Date(o.createdAt).toISOString().slice(0, 7) === month
    );

    if (monthOrders.length === 0) {
      breakdown.push({
        month,
        totalSpend: 0,
        basePriceTotal: 0,
        actualPaid: 0,
        savings: 0,
        savingsPercent: 0,
      });
      return;
    }

    let basePriceTotal = 0;
    let actualPaid = 0;

    monthOrders.forEach((item) => {
      if (item.quantity && item.basePrice) {
        basePriceTotal += item.quantity * item.basePrice;
      }
      if (item.lineTotal) {
        actualPaid += item.lineTotal;
      }
    });

    const savings = basePriceTotal - actualPaid;
    const savingsPercent = basePriceTotal > 0 ? (savings / basePriceTotal) * 100 : 0;

    breakdown.push({
      month,
      totalSpend: Math.round(actualPaid * 100) / 100,
      basePriceTotal: Math.round(basePriceTotal * 100) / 100,
      actualPaid: Math.round(actualPaid * 100) / 100,
      savings: Math.round(savings * 100) / 100,
      savingsPercent: Math.round(savingsPercent * 100) / 100,
    });
  });

  return breakdown;
}

function calculateCategoryPricing(orders: any[]) {
  const categoryMap = new Map<
    string,
    {
      basePrice: number[];
      actualPrice: number[];
      totalSpent: number;
      itemsOrdered: number;
    }
  >();

  orders.forEach((order) => {
    if (!order.category) return;

    const entry = categoryMap.get(order.category) || {
      basePrice: [],
      actualPrice: [],
      totalSpent: 0,
      itemsOrdered: 0,
    };

    if (order.quantity && order.basePrice) {
      for (let i = 0; i < order.quantity; i++) {
        entry.basePrice.push(order.basePrice);
      }
    }

    if (order.quantity && order.unitPrice) {
      for (let i = 0; i < order.quantity; i++) {
        entry.actualPrice.push(order.unitPrice);
      }
    }

    entry.totalSpent += order.lineTotal || 0;
    entry.itemsOrdered += order.quantity || 0;

    categoryMap.set(order.category, entry);
  });

  const categories = Array.from(categoryMap.entries()).map(([category, data]) => {
    const baseAvg = data.basePrice.length > 0 ? data.basePrice.reduce((a, b) => a + b, 0) / data.basePrice.length : 0;
    const actualAvg = data.actualPrice.length > 0 ? data.actualPrice.reduce((a, b) => a + b, 0) / data.actualPrice.length : 0;
    const discountPercent = baseAvg > 0 ? ((baseAvg - actualAvg) / baseAvg) * 100 : 0;

    return {
      category,
      baseAvgPrice: Math.round(baseAvg * 100) / 100,
      actualAvgPrice: Math.round(actualAvg * 100) / 100,
      discountPercent: Math.round(discountPercent * 100) / 100,
      totalSpent: Math.round(data.totalSpent * 100) / 100,
      itemsOrdered: data.itemsOrdered,
    };
  });

  // Sort by biggest savings (in absolute dollars)
  return categories.sort((a, b) => {
    const savingsA = (a.baseAvgPrice - a.actualAvgPrice) * a.itemsOrdered;
    const savingsB = (b.baseAvgPrice - b.actualAvgPrice) * b.itemsOrdered;
    return savingsB - savingsA;
  });
}

function calculateCustomDeals(customPricing: any[], orders: any[]) {
  // Map product IDs to quantities ordered
  const productQuantities = new Map<string, number>();
  orders.forEach((order) => {
    if (order.productId) {
      productQuantities.set(
        order.productId,
        (productQuantities.get(order.productId) || 0) + (order.quantity || 0)
      );
    }
  });

  return customPricing
    .map((custom) => {
      const basePrice = custom.basePrice || 0;
      const customPrice = custom.customPrice || 0;
      const savingsPerUnit = basePrice - customPrice;
      const unitsOrdered = productQuantities.get(custom.productId) || 0;
      const totalUnitSavings = savingsPerUnit * unitsOrdered;

      return {
        productName: custom.name,
        sku: custom.sku,
        basePrice: Math.round(basePrice * 100) / 100,
        customPrice: Math.round(customPrice * 100) / 100,
        savingsPerUnit: Math.round(savingsPerUnit * 100) / 100,
        unitsOrdered,
        totalUnitSavings: Math.round(totalUnitSavings * 100) / 100,
      };
    })
    .filter((deal) => deal.unitsOrdered > 0)
    .sort((a, b) => b.totalUnitSavings - a.totalUnitSavings);
}

function calculateTierComparison(orders: any[], tierRuleRows: any[]) {
  // Calculate what the last 12 months of spend would cost at each tier
  const tierComparison: Record<
    string,
    {
      tier: string;
      estimatedCost: number;
      actualCost: number;
      estimatedSavings: number;
      savingsPercent: number;
    }
  > = {};

  // Get actual total spend
  const actualCost = orders.reduce((sum, order) => sum + (order.lineTotal || 0), 0);

  // For each tier, calculate what the cost would be
  TIER_ORDER.forEach((tier) => {
    let estimatedCost = 0;

    orders.forEach((order) => {
      if (!order.category || !order.quantity || !order.basePrice) return;

      // Find the margin rule for this tier and category
      const rule = tierRuleRows.find(
        (r: any) => r.tierName === tier && r.category === order.category
      );

      if (rule) {
        const margin = Math.max(rule.marginPercent, rule.minMargin);
        const cost = order.cost || 0;
        const estimatedUnitPrice = cost * (1 + margin / 100);
        estimatedCost += estimatedUnitPrice * order.quantity;
      } else {
        // Fallback to base price if no rule found
        estimatedCost += order.basePrice * order.quantity;
      }
    });

    const savings = estimatedCost - actualCost;
    const savingsPercent = estimatedCost > 0 ? (savings / estimatedCost) * 100 : 0;

    tierComparison[tier] = {
      tier,
      estimatedCost: Math.round(estimatedCost * 100) / 100,
      actualCost: Math.round(actualCost * 100) / 100,
      estimatedSavings: Math.round(Math.max(0, savings) * 100) / 100,
      savingsPercent: Math.round(Math.max(0, savingsPercent) * 100) / 100,
    };
  });

  return Object.values(tierComparison);
}
