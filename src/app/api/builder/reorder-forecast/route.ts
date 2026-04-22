import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

// Response type exports
export interface UpcomingReorder {
  productId: string;
  sku: string;
  name: string;
  category: string;
  avgIntervalDays: number;
  lastOrderDate: Date;
  predictedNextDate: Date;
  daysUntilReorder: number;
  avgQuantity: number;
  avgSpend: number;
  urgency: 'OVERDUE' | 'DUE_SOON' | 'UPCOMING' | 'LATER';
}

export interface SeasonalPattern {
  month: number;
  totalSpend: number;
  orderCount: number;
  topCategory: string;
}

export interface ReorderSummary {
  productsTracked: number;
  overdueCount: number;
  dueSoonCount: number;
  estimatedMonthlySpend: number;
  estimatedNextMonthSpend: number;
}

export interface ReorderForecastResponse {
  upcomingReorders: UpcomingReorder[];
  seasonalPatterns: SeasonalPattern[];
  reorderSummary: ReorderSummary;
}

export async function GET(request: NextRequest) {
  try {
    // Get authenticated session
    const session = await getSession()

    if (!session || !session.builderId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { builderId } = session

    // Fetch upcoming reorders
    const upcomingReorders = await getUpcomingReorders(builderId)

    // Fetch seasonal patterns
    const seasonalPatterns = await getSeasonalPatterns(builderId)

    // Fetch reorder summary stats
    const reorderSummary = await getReorderSummary(builderId, upcomingReorders)

    const response: ReorderForecastResponse = {
      upcomingReorders,
      seasonalPatterns,
      reorderSummary,
    }

    return NextResponse.json(response, {
      status: 200,
      headers: {
        'Cache-Control': 'private, max-age=300', // Cache for 5 minutes
      },
    })
  } catch (error) {
    console.error('Reorder forecast error:', error)
    return NextResponse.json(
      {
        upcomingReorders: [],
        seasonalPatterns: [],
        reorderSummary: {
          productsTracked: 0,
          overdueCount: 0,
          dueSoonCount: 0,
          estimatedMonthlySpend: 0,
          estimatedNextMonthSpend: 0,
        },
      } as ReorderForecastResponse,
      { status: 200 } // Return 200 with empty data rather than 500
    )
  }
}

async function getUpcomingReorders(builderId: string) {
  const query = `
    WITH product_order_history AS (
      -- Get all products ordered by this builder with order count
      SELECT
        p.id,
        p.sku,
        p.name,
        p.category,
        COUNT(DISTINCT o.id) as order_count,
        AVG(oi.quantity) as avg_quantity,
        AVG(oi.quantity * oi."unitPrice") as avg_spend,
        MAX(o."createdAt") as last_order_date,
        MIN(o."createdAt") as first_order_date
      FROM "Product" p
      INNER JOIN "OrderItem" oi ON p.id = oi."productId"
      INNER JOIN "Order" o ON oi."orderId" = o.id
      WHERE o."builderId" = $1
      GROUP BY p.id, p.sku, p.name, p.category
      HAVING COUNT(DISTINCT o.id) >= 3
    ),
    order_intervals AS (
      -- Calculate intervals between consecutive orders for each product
      SELECT
        p.id,
        EXTRACT(DAY FROM (MAX(o."createdAt") - MIN(o."createdAt"))) /
          (COUNT(DISTINCT o.id) - 1) as avg_interval_days
      FROM "Product" p
      INNER JOIN "OrderItem" oi ON p.id = oi."productId"
      INNER JOIN "Order" o ON oi."orderId" = o.id
      WHERE o."builderId" = $1
      GROUP BY p.id
      HAVING COUNT(DISTINCT o.id) >= 3
    ),
    reorder_predictions AS (
      -- Combine history with predictions
      SELECT
        poh.id,
        poh.sku,
        poh.name,
        poh.category,
        poh.avg_quantity,
        poh.avg_spend,
        poh.last_order_date,
        COALESCE(oi.avg_interval_days, 30) as avg_interval_days,
        (poh.last_order_date +
         MAKE_INTERVAL(days => COALESCE(oi.avg_interval_days, 30)::int)) as predicted_next_date,
        EXTRACT(DAY FROM
          (poh.last_order_date +
           MAKE_INTERVAL(days => COALESCE(oi.avg_interval_days, 30)::int)) -
          CURRENT_DATE
        )::int as days_until_reorder
      FROM product_order_history poh
      LEFT JOIN order_intervals oi ON poh.id = oi.id
    )
    SELECT
      id as "productId",
      sku,
      name,
      category,
      ROUND(avg_interval_days::numeric, 1)::float as "avgIntervalDays",
      last_order_date as "lastOrderDate",
      predicted_next_date as "predictedNextDate",
      days_until_reorder as "daysUntilReorder",
      ROUND(avg_quantity::numeric, 1)::float as "avgQuantity",
      ROUND(avg_spend::numeric, 2)::float as "avgSpend",
      CASE
        WHEN days_until_reorder < 0 THEN 'OVERDUE'
        WHEN days_until_reorder <= 7 THEN 'DUE_SOON'
        WHEN days_until_reorder <= 30 THEN 'UPCOMING'
        ELSE 'LATER'
      END as urgency
    FROM reorder_predictions
    ORDER BY days_until_reorder ASC, predicted_next_date ASC
    LIMIT 20
  `

  const result = await prisma.$queryRawUnsafe<any[]>(query, builderId)
  return result
}

async function getSeasonalPatterns(builderId: string) {
  const query = `
    WITH monthly_orders AS (
      -- Group orders by month
      SELECT
        EXTRACT(MONTH FROM o."createdAt")::int as month,
        EXTRACT(YEAR FROM o."createdAt")::int as year,
        o.total,
        p.category,
        COUNT(DISTINCT o.id) as order_count
      FROM "Order" o
      LEFT JOIN "OrderItem" oi ON o.id = oi."orderId"
      LEFT JOIN "Product" p ON oi."productId" = p.id
      WHERE o."builderId" = $1
      GROUP BY month, year, o.id, o.total, p.category
    ),
    monthly_aggregates AS (
      -- Aggregate by month across all years
      SELECT
        month,
        SUM(CAST(total AS NUMERIC))::float as total_spend,
        COUNT(DISTINCT CONCAT(year, '-', order_count))::int as order_count
      FROM monthly_orders
      GROUP BY month
    ),
    top_categories AS (
      -- Find top category per month
      SELECT DISTINCT ON (mo.month)
        mo.month,
        p.category,
        SUM(oi2."unitPrice" * oi2."quantity") as category_spend
      FROM monthly_orders mo
      INNER JOIN "Order" o2 ON o2."builderId" = $1
        AND EXTRACT(MONTH FROM o2."createdAt")::int = mo.month
      INNER JOIN "OrderItem" oi2 ON o2.id = oi2."orderId"
      INNER JOIN "Product" p ON oi2."productId" = p.id
      GROUP BY mo.month, p.category
      ORDER BY mo.month, category_spend DESC
    )
    SELECT
      ma.month,
      ROUND(ma.total_spend::numeric, 2)::float as "totalSpend",
      ma.order_count as "orderCount",
      COALESCE(tc.category, 'Unknown') as "topCategory"
    FROM monthly_aggregates ma
    LEFT JOIN top_categories tc ON ma.month = tc.month
    ORDER BY ma.month ASC
  `

  const result = await prisma.$queryRawUnsafe<any[]>(query, builderId)
  return result
}

async function getReorderSummary(
  builderId: string,
  upcomingReorders: any[]
) {
  const query = `
    WITH product_counts AS (
      -- Count products with 3+ orders
      SELECT COUNT(DISTINCT p.id) as products_tracked
      FROM "Product" p
      INNER JOIN "OrderItem" oi ON p.id = oi."productId"
      INNER JOIN "Order" o ON oi."orderId" = o.id
      WHERE o."builderId" = $1
      GROUP BY o."builderId"
      HAVING COUNT(DISTINCT o.id) >= 3
    ),
    last_six_months AS (
      -- Calculate average monthly spend from last 6 months
      SELECT
        AVG(monthly_totals.month_total) as avg_monthly_spend
      FROM (
        SELECT
          DATE_TRUNC('month', o."createdAt") as month,
          SUM(CAST(o.total AS NUMERIC)) as month_total
        FROM "Order" o
        WHERE o."builderId" = $1
          AND o."createdAt" >= CURRENT_DATE - INTERVAL '6 months'
        GROUP BY DATE_TRUNC('month', o."createdAt")
      ) monthly_totals
    )
    SELECT
      COALESCE(pc.products_tracked, 0)::int as "productsTracked",
      COALESCE(lsm.avg_monthly_spend, 0)::float as "estimatedMonthlySpend"
    FROM product_counts pc, last_six_months lsm
  `

  const summaryResult = await prisma.$queryRawUnsafe<any[]>(query, builderId)
  const summary = summaryResult[0] || {
    productsTracked: 0,
    estimatedMonthlySpend: 0,
  }

  // Count overdue and due soon from the upcomingReorders
  const overdueCount = upcomingReorders.filter(
    (r) => r.urgency === 'OVERDUE'
  ).length
  const dueSoonCount = upcomingReorders.filter(
    (r) => r.urgency === 'DUE_SOON'
  ).length

  // Calculate estimated next month spend based on predicted reorders
  const estimatedNextMonthSpend = upcomingReorders
    .filter((r) => {
      const daysUntil = r.daysUntilReorder
      return daysUntil >= 0 && daysUntil <= 30
    })
    .reduce((sum, r) => sum + (r.avgSpend || 0), 0)

  return {
    productsTracked: summary.productsTracked,
    overdueCount,
    dueSoonCount,
    estimatedMonthlySpend: Math.round(summary.estimatedMonthlySpend * 100) / 100,
    estimatedNextMonthSpend:
      Math.round(estimatedNextMonthSpend * 100) / 100,
  }
}
