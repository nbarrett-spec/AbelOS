export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

interface CostByScopeTypeData {
  scopeType: string;
  avgTotalPerProject: number;
  minTotal: number;
  maxTotal: number;
  medianTotal: number;
  orderCount: number;
  avgItemsPerOrder: number;
}

interface CostByCategoryData {
  category: string;
  avgSpend: number;
  percentOfTotal: number;
  orderCount: number;
}

interface PriceChangeTrendData {
  category: string;
  priceChangePercent: number;
  flagged: boolean;
  avgPrice3MonthsAgo: number;
  avgPriceRecent: number;
}

interface ProjectedCostData {
  scopeType: string;
  estimatedCost: number;
  confidenceIntervalLower: number;
  confidenceIntervalUpper: number;
  standardDeviation: number;
  sampleSize: number;
}

interface CostPredictorResponse {
  costByScopeType: CostByScopeTypeData[];
  costByCategory: CostByCategoryData[];
  priceChangeTrends: PriceChangeTrendData[];
  projectedCost: ProjectedCostData | null;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    // Authentication
    const session = await getSession();
    if (!session || !session.builderId) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const builderId = session.builderId;
    const scopeTypeParam = request.nextUrl.searchParams.get('scopeType');

    // Query 1: Cost by Scope Type
    const costByScopeTypeQuery = `
      SELECT
        p."scopeType",
        AVG(o."total") as "avgTotalPerProject",
        MIN(o."total") as "minTotal",
        MAX(o."total") as "maxTotal",
        COUNT(DISTINCT o.id)::int as "orderCount",
        ROUND(COUNT(oi.id)::numeric / COUNT(DISTINCT o.id), 2) as "avgItemsPerOrder"
      FROM "Project" p
      INNER JOIN "Quote" q ON p.id = q."projectId"
      INNER JOIN "Order" o ON q.id = o."quoteId"
      LEFT JOIN "OrderItem" oi ON o.id = oi."orderId"
      WHERE p."builderId" = $1
      GROUP BY p."scopeType"
      ORDER BY "avgTotalPerProject" DESC
    `;

    const costByScopeType = await prisma.$queryRawUnsafe<any[]>(
      costByScopeTypeQuery,
      builderId
    );

    // Calculate median for each scope type
    const costByScopeTypeWithMedian = await Promise.all(
      costByScopeType.map(async (scopeData) => {
        const medianQuery = `
          SELECT PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY o."total") as "medianTotal"
          FROM "Project" p
          INNER JOIN "Quote" q ON p.id = q."projectId"
          INNER JOIN "Order" o ON q.id = o."quoteId"
          WHERE p."builderId" = $1 AND p."scopeType" = $2
        `;
        const medianResult = await prisma.$queryRawUnsafe<any[]>(
          medianQuery,
          builderId,
          scopeData.scopeType
        );

        return {
          scopeType: scopeData.scopeType,
          avgTotalPerProject: parseFloat(scopeData.avgTotalPerProject || 0),
          minTotal: parseFloat(scopeData.minTotal || 0),
          maxTotal: parseFloat(scopeData.maxTotal || 0),
          medianTotal: parseFloat(
            medianResult[0]?.medianTotal || scopeData.avgTotalPerProject || 0
          ),
          orderCount: parseInt(scopeData.orderCount || 0),
          avgItemsPerOrder: parseFloat(scopeData.avgItemsPerOrder || 0),
        };
      })
    );

    // Query 2: Cost by Category
    const costByCategoryQuery = `
      SELECT
        pr."category",
        ROUND(AVG(oi."lineTotal")::numeric, 2) as "avgSpend",
        COUNT(oi.id) as "orderCount"
      FROM "OrderItem" oi
      INNER JOIN "Product" pr ON oi."productId" = pr.id
      INNER JOIN "Order" o ON oi."orderId" = o.id
      INNER JOIN "Quote" q ON o."quoteId" = q.id
      INNER JOIN "Project" p ON q."projectId" = p.id
      WHERE p."builderId" = $1
      GROUP BY pr."category"
      ORDER BY "avgSpend" DESC
    `;

    const costByCategory = await prisma.$queryRawUnsafe<any[]>(
      costByCategoryQuery,
      builderId
    );

    // Calculate total spend and percentages
    const totalSpend = costByCategory.reduce(
      (sum, cat) => sum + parseFloat(cat.avgSpend || 0),
      0
    );

    const costByCategoryWithPercent = costByCategory.map((cat) => ({
      category: cat.category || 'Unknown',
      avgSpend: parseFloat(cat.avgSpend || 0),
      percentOfTotal: totalSpend > 0 ?
        parseFloat(((parseFloat(cat.avgSpend || 0) / totalSpend) * 100).toFixed(2)) :
        0,
      orderCount: parseInt(cat.orderCount || 0),
    }));

    // Query 3: Price Change Trends (last 3 months vs prior 3 months)
    const now = new Date();
    const threeMonthsAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
    const sixMonthsAgo = new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000);

    const priceChangeTrendsQuery = `
      SELECT
        pr."category",
        AVG(CASE
          WHEN o."createdAt" >= $2 THEN oi."unitPrice"
          ELSE NULL
        END) as "avgPriceRecent",
        AVG(CASE
          WHEN o."createdAt" < $2 AND o."createdAt" >= $3 THEN oi."unitPrice"
          ELSE NULL
        END) as "avgPrice3MonthsAgo"
      FROM "OrderItem" oi
      INNER JOIN "Product" pr ON oi."productId" = pr.id
      INNER JOIN "Order" o ON oi."orderId" = o.id
      INNER JOIN "Quote" q ON o."quoteId" = q.id
      INNER JOIN "Project" p ON q."projectId" = p.id
      WHERE p."builderId" = $1 AND o."createdAt" >= $3
      GROUP BY pr."category"
      HAVING AVG(CASE WHEN o."createdAt" >= $2 THEN oi."unitPrice" ELSE NULL END) IS NOT NULL
        AND AVG(CASE WHEN o."createdAt" < $2 AND o."createdAt" >= $3 THEN oi."unitPrice" ELSE NULL END) IS NOT NULL
      ORDER BY pr."category"
    `;

    const priceChangeTrends = await prisma.$queryRawUnsafe<any[]>(
      priceChangeTrendsQuery,
      builderId,
      threeMonthsAgo,
      sixMonthsAgo
    );

    const priceChangeTrendsFormatted = priceChangeTrends
      .map((trend) => {
        const avgPrice3MonthsAgo = parseFloat(trend.avgPrice3MonthsAgo || 0);
        const avgPriceRecent = parseFloat(trend.avgPriceRecent || 0);

        let priceChangePercent = 0;
        if (avgPrice3MonthsAgo > 0) {
          priceChangePercent = parseFloat(
            (((avgPriceRecent - avgPrice3MonthsAgo) / avgPrice3MonthsAgo) * 100).toFixed(2)
          );
        }

        return {
          category: trend.category || 'Unknown',
          priceChangePercent,
          flagged: priceChangePercent > 5,
          avgPrice3MonthsAgo,
          avgPriceRecent,
        };
      })
      .filter((trend) => trend.avgPrice3MonthsAgo > 0);

    // Query 4: Projected Cost (if scopeType provided)
    let projectedCost: ProjectedCostData | null = null;

    if (scopeTypeParam) {
      const projectedCostQuery = `
        SELECT
          AVG(o."total") as "avgTotal",
          STDDEV_POP(o."total") as "stdDev",
          COUNT(o.id) as "sampleSize"
        FROM "Project" p
        INNER JOIN "Quote" q ON p.id = q."projectId"
        INNER JOIN "Order" o ON q.id = o."quoteId"
        WHERE p."builderId" = $1 AND p."scopeType" = $2
      `;

      const projectedCostResult = await prisma.$queryRawUnsafe<any[]>(
        projectedCostQuery,
        builderId,
        scopeTypeParam
      );

      if (
        projectedCostResult &&
        projectedCostResult.length > 0 &&
        projectedCostResult[0].avgTotal
      ) {
        const avgTotal = parseFloat(projectedCostResult[0].avgTotal || 0);
        const stdDev = parseFloat(projectedCostResult[0].stdDev || 0);
        const sampleSize = parseInt(projectedCostResult[0].sampleSize || 0);

        // 95% confidence interval (1.96 * standard error)
        const standardError = sampleSize > 0 ? stdDev / Math.sqrt(sampleSize) : stdDev;
        const marginOfError = 1.96 * standardError;

        projectedCost = {
          scopeType: scopeTypeParam,
          estimatedCost: parseFloat(avgTotal.toFixed(2)),
          confidenceIntervalLower: parseFloat(
            (avgTotal - marginOfError).toFixed(2)
          ),
          confidenceIntervalUpper: parseFloat(
            (avgTotal + marginOfError).toFixed(2)
          ),
          standardDeviation: parseFloat(stdDev.toFixed(2)),
          sampleSize,
        };
      }
    }

    const response: CostPredictorResponse = {
      costByScopeType: costByScopeTypeWithMedian,
      costByCategory: costByCategoryWithPercent,
      priceChangeTrends: priceChangeTrendsFormatted,
      projectedCost,
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error('Cost predictor error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
