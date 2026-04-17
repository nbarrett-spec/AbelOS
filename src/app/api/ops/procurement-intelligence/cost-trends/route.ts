export const dynamic = 'force-dynamic'
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { checkStaffAuth } from '@/lib/api-auth';
import { safeJson } from '@/lib/safe-json';
import { audit } from '@/lib/audit'

// Material Cost Intelligence & Trend Analysis
// Analyzes product costs over time, identifies trends, forecasts future costs, and surfaces savings opportunities

export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request);
  if (authError) return authError;

  try {
    const { searchParams } = new URL(request.url);
    const categoryFilter = searchParams.get('category');
    const months = parseInt(searchParams.get('months') || '12');

    // Get historical cost data grouped by month and category
    const costDataResult: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        DATE_TRUNC('month', po."orderedAt")::DATE as month,
        COALESCE(p."category", 'Uncategorized') as category,
        p."sku",
        p."name",
        COALESCE(AVG(poi."unitCost")::float, 0) as avgCost,
        COALESCE(SUM(poi."quantity")::int, 0) as totalUnits,
        COALESCE(SUM((poi."unitCost" * poi."quantity")::float), 0) as totalSpend,
        COUNT(DISTINCT po."id")::int as poCount
      FROM "PurchaseOrder" po
      JOIN "PurchaseOrderItem" poi ON poi."purchaseOrderId" = po."id"
      LEFT JOIN "Product" p ON p."id" = poi."productId"
      WHERE po."status" IN ($1::"POStatus", $2::"POStatus")
      AND po."orderedAt" >= NOW() - INTERVAL '${months} months'
      AND po."orderedAt" IS NOT NULL
      GROUP BY DATE_TRUNC('month', po."orderedAt"), COALESCE(p."category", 'Uncategorized'), p."sku", p."name"
      ORDER BY DATE_TRUNC('month', po."orderedAt") DESC, category, p."name"
    `, 'RECEIVED', 'PARTIALLY_RECEIVED');

    // Group by category and calculate trends
    const categoryMap: Record<string, any> = {};
    const productMap: Record<string, any> = {};

    costDataResult.forEach((row: any) => {
      const category = row.category;
      const productKey = `${category}|${row.sku}`;

      if (!categoryMap[category]) {
        categoryMap[category] = {
          category,
          monthlyData: [],
          topProducts: [],
          currentAvgCost: 0,
          previousAvgCost: 0,
          changePercent: 0,
          trend: 'STABLE',
          forecast: { nextMonth: 0, confidence: 0 },
        };
      }

      if (!productMap[productKey]) {
        productMap[productKey] = {
          sku: row.sku,
          name: row.name,
          costs: [],
        };
      }

      categoryMap[category].monthlyData.push({
        month: row.month,
        avgCost: Math.round(row.avgCost * 100) / 100,
        totalUnits: row.totalUnits,
        totalSpend: Math.round(row.totalSpend * 100) / 100,
      });

      productMap[productKey].costs.push({
        month: row.month,
        avgCost: row.avgCost,
      });
    });

    // Calculate trend metrics per category
    const categoryTrends: any[] = [];

    Object.keys(categoryMap).forEach((category) => {
      const catData = categoryMap[category];
      const monthlyData = catData.monthlyData.sort((a: any, b: any) => {
        return new Date(b.month).getTime() - new Date(a.month).getTime();
      });

      if (monthlyData.length === 0) return;

      const currentMonth = monthlyData[0];
      const previousMonth = monthlyData[1];
      const currentAvgCost = currentMonth.avgCost;
      const previousAvgCost = previousMonth?.avgCost || currentMonth.avgCost;

      // Calculate cost change percentage
      const changePercent =
        previousAvgCost > 0
          ? Math.round(((currentAvgCost - previousAvgCost) / previousAvgCost) * 10000) / 100
          : 0;

      // Calculate 3-month moving average
      let movingAvg = 0;
      let movingCount = 0;
      for (let i = 0; i < Math.min(3, monthlyData.length); i++) {
        movingAvg += monthlyData[i].avgCost;
        movingCount++;
      }
      movingAvg = movingCount > 0 ? movingAvg / movingCount : currentAvgCost;

      // Determine trend direction
      let trend = 'STABLE';
      const trendThreshold = 0.02; // 2%
      if (changePercent > trendThreshold) {
        trend = 'RISING';
      } else if (changePercent < -trendThreshold) {
        trend = 'FALLING';
      }

      // Calculate volatility
      const costValues = monthlyData.slice(0, 3).map((m: any) => m.avgCost);
      if (costValues.length > 1) {
        const mean = costValues.reduce((a: number, b: number) => a + b) / costValues.length;
        const variance = costValues.reduce((a: number, b: number) => a + Math.pow(b - mean, 2)) / costValues.length;
        const stdDev = Math.sqrt(variance);
        const coeffVar = mean > 0 ? stdDev / mean : 0;
        if (coeffVar > 0.1) {
          trend = 'VOLATILE';
        }
      }

      // Simple forecast: use moving average with trend adjustment
      const trendFactor = 1 + changePercent / 100;
      const forecastCost = Math.round(movingAvg * trendFactor * 100) / 100;
      const confidence = Math.min(0.5 + monthlyData.length * 0.1, 0.95);

      // Find top products in this category by current cost vs historical average
      const topProductsForCategory: any[] = [];
      Object.keys(productMap).forEach((key) => {
        if (!key.startsWith(category + '|')) return;
        const prod = productMap[key];
        if (prod.costs.length === 0) return;

        const currentCost = prod.costs[0].avgCost;
        const histAvg = prod.costs.reduce((sum: number, c: any) => sum + c.avgCost, 0) / prod.costs.length;
        const aboveAvgPercent = histAvg > 0 ? Math.round(((currentCost - histAvg) / histAvg) * 10000) / 100 : 0;

        topProductsForCategory.push({
          sku: prod.sku,
          name: prod.name,
          currentCost: Math.round(currentCost * 100) / 100,
          avgCost: Math.round(histAvg * 100) / 100,
          aboveAvgPercent,
        });
      });

      // Sort and keep top 3
      topProductsForCategory.sort((a: any, b: any) => b.aboveAvgPercent - a.aboveAvgPercent);

      if (categoryFilter && category !== categoryFilter) return;

      categoryTrends.push({
        category,
        currentAvgCost: Math.round(currentAvgCost * 100) / 100,
        previousAvgCost: Math.round(previousAvgCost * 100) / 100,
        changePercent,
        trend,
        forecast: {
          nextMonth: forecastCost,
          confidence: Math.round(confidence * 100) / 100,
        },
        monthlyData,
        topProducts: topProductsForCategory.slice(0, 3),
      });
    });

    // Identify savings opportunities
    const savingsOpportunities: any[] = [];

    // Opportunity 1: Vendor switching (find price anomalies)
    const vendorAnomaliesResult: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        p."sku",
        p."name",
        p."category",
        vp."vendorId",
        v."name" as vendorName,
        vp."vendorCost",
        COALESCE(MIN(vp2."vendorCost")::float, vp."vendorCost") as minCost,
        COUNT(DISTINCT po."id")::int as recentPOs
      FROM "VendorProduct" vp
      JOIN "Vendor" v ON v."id" = vp."vendorId"
      JOIN "Product" p ON p."id" = vp."productId"
      LEFT JOIN "VendorProduct" vp2 ON vp2."productId" = vp."productId" AND vp2."vendorCost" < vp."vendorCost"
      LEFT JOIN "PurchaseOrder" po ON po."vendorId" = vp."vendorId" AND po."orderedAt" >= NOW() - INTERVAL '90 days'
      WHERE v."active" = true
      AND vp."vendorCost" IS NOT NULL
      GROUP BY p."sku", p."name", p."category", vp."vendorId", v."name", vp."vendorCost"
      HAVING COUNT(DISTINCT po."id") >= 1
      AND COALESCE(MIN(vp2."vendorCost"), vp."vendorCost") < vp."vendorCost"
    `);

    vendorAnomaliesResult.forEach((anomaly: any) => {
      const savingsPerUnit = anomaly.vendorCost - anomaly.minCost;
      const savingsPercent = Math.round((savingsPerUnit / anomaly.vendorCost) * 10000) / 100;

      if (savingsPercent >= 5 && anomaly.recentPOs > 0) {
        // Estimate annual savings based on recent PO frequency
        const estimatedAnnualQty = anomaly.recentPOs * 50; // Estimate
        const estimatedAnnualSavings = Math.round(savingsPerUnit * estimatedAnnualQty * 100) / 100;

        savingsOpportunities.push({
          type: 'VENDOR_SWITCH',
          description: `Switch ${anomaly.name} from ${anomaly.vendorName} to lower-cost vendor for ${savingsPercent}% savings`,
          estimatedAnnualSavings,
          confidence: 0.8,
          currentVendor: anomaly.vendorName,
          alternateCost: Math.round(anomaly.minCost * 100) / 100,
          currentCost: Math.round(anomaly.vendorCost * 100) / 100,
        });
      }
    });

    // Opportunity 2: Bulk consolidation (multiple small POs to one vendor)
    const consolidationResult: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        po."vendorId",
        v."name" as vendorName,
        COUNT(DISTINCT po."id")::int as poCount,
        COALESCE(SUM(po."total")::float, 0) as totalSpend,
        DATE_TRUNC('month', po."orderedAt")::DATE as month
      FROM "PurchaseOrder" po
      JOIN "Vendor" v ON v."id" = po."vendorId"
      WHERE po."status" IN ($1::"POStatus", $2::"POStatus")
      AND po."orderedAt" >= NOW() - INTERVAL '3 months'
      GROUP BY po."vendorId", v."name", DATE_TRUNC('month', po."orderedAt")
      HAVING COUNT(DISTINCT po."id") >= 3
    `, 'RECEIVED', 'PARTIALLY_RECEIVED');

    consolidationResult.forEach((consol: any) => {
      const estimatedDiscount = Math.round((consol.totalSpend * 0.05) * 100) / 100;
      if (estimatedDiscount >= 500) {
        savingsOpportunities.push({
          type: 'BULK_CONSOLIDATION',
          description: `Consolidate monthly orders from ${consol.vendorName} to bi-weekly for volume discount`,
          estimatedAnnualSavings: estimatedDiscount * 4,
          confidence: 0.65,
        });
      }
    });

    // Opportunity 3: Timing optimization (seasonal patterns)
    const seasonalResult: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        EXTRACT(MONTH FROM po."orderedAt")::int as month,
        COALESCE(p."category", 'General') as category,
        AVG(poi."unitCost")::float as avgCost,
        COUNT(*)::int as records
      FROM "PurchaseOrder" po
      JOIN "PurchaseOrderItem" poi ON poi."purchaseOrderId" = po."id"
      LEFT JOIN "Product" p ON p."id" = poi."productId"
      WHERE po."status" IN ($1::"POStatus", $2::"POStatus")
      AND po."orderedAt" >= NOW() - INTERVAL '24 months'
      GROUP BY EXTRACT(MONTH FROM po."orderedAt"), COALESCE(p."category", 'General')
      ORDER BY avgCost ASC
    `, 'RECEIVED', 'PARTIALLY_RECEIVED');

    // Find seasonal opportunities (months with lowest prices)
    const monthlyPrices: Record<number, number[]> = {};
    seasonalResult.forEach((row: any) => {
      if (!monthlyPrices[row.month]) {
        monthlyPrices[row.month] = [];
      }
      monthlyPrices[row.month].push(row.avgCost);
    });

    const currentMonth = new Date().getMonth() + 1;
    let lowestMonth = currentMonth;
    let lowestAvgPrice = Infinity;

    Object.keys(monthlyPrices).forEach((m: any) => {
      const month = parseInt(m);
      if (month === currentMonth || month === currentMonth - 1) return; // Skip current/previous
      const avg = monthlyPrices[month].reduce((a: number, b: number) => a + b) / monthlyPrices[month].length;
      if (avg < lowestAvgPrice) {
        lowestAvgPrice = avg;
        lowestMonth = month;
      }
    });

    if (lowestMonth !== currentMonth && lowestAvgPrice < Infinity) {
      const monthName = new Date(2026, lowestMonth - 1).toLocaleString('default', { month: 'long' });
      const estimatedSavings = Math.round((lowestAvgPrice * 100000) * 100) / 100; // Placeholder estimate
      savingsOpportunities.push({
        type: 'TIMING_OPTIMIZATION',
        description: `Seasonal price dip expected in ${monthName} for most material categories`,
        estimatedAnnualSavings: Math.min(estimatedSavings, 5000),
        confidence: 0.55,
      });
    }

    // Calculate summary
    const totalCategories = categoryTrends.length;
    const avgCostChange = categoryTrends.length > 0
      ? Math.round((categoryTrends.reduce((sum: number, ct: any) => sum + ct.changePercent, 0) / categoryTrends.length) * 100) / 100
      : 0;
    const totalSavingsIdentified = Math.round(savingsOpportunities.reduce((sum: number, opp: any) => sum + (opp.estimatedAnnualSavings || 0), 0) * 100) / 100;

    const highestRiskCategory = categoryTrends.length > 0
      ? categoryTrends.sort((a: any, b: any) => b.changePercent - a.changePercent)[0]?.category || 'N/A'
      : 'N/A';
    const bestPerformingCategory = categoryTrends.length > 0
      ? categoryTrends.sort((a: any, b: any) => a.changePercent - b.changePercent)[0]?.category || 'N/A'
      : 'N/A';

    return safeJson({
      categoryTrends,
      savingsOpportunities: savingsOpportunities.slice(0, 10),
      summary: {
        totalProductCategories: totalCategories,
        avgCostChangeYTD: avgCostChange,
        totalSavingsIdentified,
        highestRiskCategory,
        bestPerformingCategory,
      },
    });
  } catch (error: any) {
    console.error('Cost trends GET error:', error);
    return safeJson(
      {
        error: 'Failed to fetch cost trends',
        details: error?.message || 'Unknown error',
      },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request);
  if (authError) return authError;

  try {
    // Audit log
    audit(request, 'CREATE', 'ProcurementIntelligence', undefined, { method: 'POST' }).catch(() => {})

    const body = await request.json();
    const { action } = body;

    if (action !== 'run-analysis') {
      return safeJson(
        { error: 'Invalid action. Use action: "run-analysis"' },
        { status: 400 }
      );
    }

    // Get all historical cost data
    const analysisDataResult: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        DATE_TRUNC('month', po."orderedAt")::DATE as month,
        COALESCE(p."category", 'Uncategorized') as category,
        COALESCE(AVG(poi."unitCost")::float, 0) as avgCost,
        COALESCE(SUM(poi."quantity")::int, 0) as totalUnits,
        COALESCE(SUM((poi."unitCost" * poi."quantity")::float), 0) as totalSpend
      FROM "PurchaseOrder" po
      JOIN "PurchaseOrderItem" poi ON poi."purchaseOrderId" = po."id"
      LEFT JOIN "Product" p ON p."id" = poi."productId"
      WHERE po."status" IN ($1::"POStatus", $2::"POStatus")
      AND po."orderedAt" IS NOT NULL
      GROUP BY DATE_TRUNC('month', po."orderedAt"), COALESCE(p."category", 'Uncategorized')
      ORDER BY DATE_TRUNC('month', po."orderedAt") DESC, category
    `, 'RECEIVED', 'PARTIALLY_RECEIVED');

    let recordsProcessed = analysisDataResult.length;
    let opportunitiesIdentified = 0;

    // Store analysis results (for now just count; in production would save to a CostTrendAnalysis table)
    const opportunitiesResult: any[] = await prisma.$queryRawUnsafe(`
      SELECT COUNT(DISTINCT p."id" || v."id")::int as count
      FROM "VendorProduct" vp
      JOIN "Vendor" v ON v."id" = vp."vendorId"
      JOIN "Product" p ON p."id" = vp."productId"
      LEFT JOIN "VendorProduct" vp2 ON vp2."productId" = vp."productId" AND vp2."vendorCost" < vp."vendorCost"
      WHERE v."active" = true
      AND vp."vendorCost" IS NOT NULL
      AND COALESCE(MIN(vp2."vendorCost"), vp."vendorCost") < vp."vendorCost"
    `);

    opportunitiesIdentified = Number(opportunitiesResult[0]?.count || 0);

    return safeJson({
      success: true,
      recordsProcessed,
      opportunitiesIdentified,
      message: `Analyzed ${recordsProcessed} cost data records and identified ${opportunitiesIdentified} optimization opportunities`,
      nextRunRecommended: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    });
  } catch (error: any) {
    console.error('Cost trends POST error:', error);
    return safeJson(
      {
        error: 'Failed to run cost analysis',
        details: error?.message || 'Unknown error',
      },
      { status: 500 }
    );
  }
}
