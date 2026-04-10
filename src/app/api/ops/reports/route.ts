export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'

// Safe query helper — wraps a query promise and returns empty array on failure
async function safeQuery(queryPromise: Promise<any>): Promise<any[]> {
  try {
    return await queryPromise
  } catch (e: any) {
    console.error('Report query failed:', e.message?.substring(0, 200))
    return []
  }
}

// GET /api/ops/reports — Revenue analytics, builder metrics, product mix
export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  const searchParams = request.nextUrl.searchParams
  const period = searchParams.get('period') || '30' // days
  const daysAgo = Math.max(1, Math.min(365, parseInt(period, 10) || 30)) // clamp 1-365

  try {
    // Revenue summary
    const revenue = await safeQuery(prisma.$queryRaw`
      SELECT
        COUNT(*)::integer as "orderCount",
        COALESCE(SUM("total"), 0)::float as "totalRevenue",
        COALESCE(AVG("total"), 0)::float as "avgOrderValue",
        COUNT(CASE WHEN "status" = 'DELIVERED' OR "status" = 'COMPLETE' THEN 1 END)::integer as "completedOrders"
      FROM "Order"
      WHERE "createdAt" >= NOW() - (${daysAgo} * INTERVAL '1 day')
    `)

    // Revenue by month (last 6 months) — no user input, safe as-is
    const monthlyRevenue = await safeQuery(prisma.$queryRaw`
      SELECT
        TO_CHAR("createdAt", 'YYYY-MM') as "month",
        TO_CHAR("createdAt", 'Mon') as "monthLabel",
        COUNT(*)::integer as "orders",
        COALESCE(SUM("total"), 0)::float as "revenue"
      FROM "Order"
      WHERE "createdAt" >= NOW() - INTERVAL '6 months'
      GROUP BY TO_CHAR("createdAt", 'YYYY-MM'), TO_CHAR("createdAt", 'Mon')
      ORDER BY "month" ASC
    `)

    // Top builders by revenue
    const topBuilders = await safeQuery(prisma.$queryRaw`
      SELECT
        b."companyName",
        COUNT(o."id")::integer as "orderCount",
        COALESCE(SUM(o."total"), 0)::float as "totalRevenue",
        COALESCE(AVG(o."total"), 0)::float as "avgOrder"
      FROM "Order" o
      JOIN "Builder" b ON b."id" = o."builderId"
      WHERE o."createdAt" >= NOW() - (${daysAgo} * INTERVAL '1 day')
      GROUP BY b."id", b."companyName"
      ORDER BY "totalRevenue" DESC
      LIMIT 10
    `)

    // Product category mix
    const categoryMix = await safeQuery(prisma.$queryRaw`
      SELECT
        COALESCE(pr."category", 'Uncategorized') as "category",
        COUNT(oi."id")::integer as "itemCount",
        COALESCE(SUM(oi."lineTotal"), 0)::float as "revenue"
      FROM "OrderItem" oi
      LEFT JOIN "Product" pr ON pr."id" = oi."productId"
      JOIN "Order" o ON o."id" = oi."orderId"
      WHERE o."createdAt" >= NOW() - (${daysAgo} * INTERVAL '1 day')
      GROUP BY pr."category"
      ORDER BY "revenue" DESC
      LIMIT 10
    `)

    // Quote conversion metrics
    const quoteMetrics = await safeQuery(prisma.$queryRaw`
      SELECT
        COUNT(*)::integer as "totalQuotes",
        COUNT(CASE WHEN "status" = 'APPROVED' THEN 1 END)::integer as "approved",
        COUNT(CASE WHEN "status" = 'REJECTED' THEN 1 END)::integer as "rejected",
        COUNT(CASE WHEN "status" = 'SENT' OR "status" = 'DRAFT' THEN 1 END)::integer as "pending",
        COALESCE(SUM("total"), 0)::float as "totalQuoteValue",
        COALESCE(SUM(CASE WHEN "status" = 'APPROVED' THEN "total" ELSE 0 END), 0)::float as "approvedValue"
      FROM "Quote"
      WHERE "createdAt" >= NOW() - (${daysAgo} * INTERVAL '1 day')
    `)

    // Order status pipeline
    const pipeline = await safeQuery(prisma.$queryRaw`
      SELECT
        "status",
        COUNT(*)::integer as "count",
        COALESCE(SUM("total"), 0)::float as "value"
      FROM "Order"
      WHERE "createdAt" >= NOW() - (${daysAgo} * INTERVAL '1 day')
      GROUP BY "status"
      ORDER BY "count" DESC
    `)

    // Inventory alerts (low stock) — no user input
    const lowStock = await safeQuery(prisma.$queryRaw`
      SELECT p."sku", p."name", p."category",
             i."onHand", i."committed", i."available"
      FROM "InventoryItem" i
      JOIN "Product" p ON p."id" = i."productId"
      WHERE i."available" <= 5 AND p."active" = true
      ORDER BY i."available" ASC
      LIMIT 15
    `)

    return NextResponse.json({
      period: daysAgo,
      revenue: revenue[0] || { orderCount: 0, totalRevenue: 0, avgOrderValue: 0, completedOrders: 0 },
      monthlyRevenue,
      topBuilders,
      categoryMix,
      quoteMetrics: quoteMetrics[0] || { totalQuotes: 0, approved: 0, rejected: 0, pending: 0, totalQuoteValue: 0, approvedValue: 0 },
      pipeline,
      lowStock,
    })
  } catch (error: any) {
    console.error('Reports error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
