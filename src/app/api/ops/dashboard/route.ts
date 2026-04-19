export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'

interface CountResult {
  count: number
}

interface RevenueResult {
  total: string | number | null
}

interface StatusResult {
  status: string
  count: number
  revenue: string | number | null
}

interface PaymentStatusResult {
  paymentStatus: string
  count: number
  revenue: string | number | null
}

interface TopBuilderResult {
  builderId: string
  orderCount: number
  totalValue: string | number | null
  companyName: string
}

interface RecentOrderResult {
  id: string
  orderNumber: string
  builderName: string
  total: string | number
  status: string
  paymentStatus: string
  createdAt: Date
}

interface MonthlyTrendResult {
  month: string
  count: number
  revenue: string | number
}

interface POStatusResult {
  status: string
  count: number
  total: string | number | null
}

export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    // Run all queries in parallel for performance
    const [
      builderCountResult,
      productCountResult,
      orderCountResult,
      orderRevenueResult,
      ordersByStatusResult,
      ordersByPaymentResult,
      purchaseOrderCountResult,
      poTotalResult,
      topBuildersResult,
      recentOrdersResult,
      ordersByMonthResult,
      posByStatusResult,
    ] = await Promise.all([
      // Builder count
      prisma.$queryRawUnsafe<CountResult[]>(
        'SELECT COUNT(*)::int as count FROM "Builder"'
      ),

      // Active products
      prisma.$queryRawUnsafe<CountResult[]>(
        'SELECT COUNT(*)::int as count FROM "Product" WHERE active = true'
      ),

      // Total orders
      prisma.$queryRawUnsafe<CountResult[]>(
        'SELECT COUNT(*)::int as count FROM "Order"'
      ),

      // Total order revenue: delivered/complete revenue (not pipeline)
      prisma.$queryRawUnsafe<RevenueResult[]>(
        'SELECT COALESCE(SUM(total)::float8, 0) as total FROM "Order" WHERE status::text IN (\'DELIVERED\', \'COMPLETE\')'
      ),

      // Orders grouped by status
      prisma.$queryRawUnsafe<StatusResult[]>(
        'SELECT status::text as status, COUNT(*)::int as count, COALESCE(SUM(total)::float8, 0) as revenue FROM "Order" GROUP BY status'
      ),

      // Orders grouped by payment status (COALESCE handles NULL values from raw SQL inserts)
      prisma.$queryRawUnsafe<PaymentStatusResult[]>(
        'SELECT COALESCE("paymentStatus"::text, \'PENDING\') as "paymentStatus", COUNT(*)::int as count, COALESCE(SUM(total)::float8, 0) as revenue FROM "Order" GROUP BY COALESCE("paymentStatus"::text, \'PENDING\')'
      ),

      // Purchase order count
      prisma.$queryRawUnsafe<CountResult[]>(
        'SELECT COUNT(*)::int as count FROM "PurchaseOrder"'
      ),

      // Purchase order total spend
      prisma.$queryRawUnsafe<RevenueResult[]>(
        'SELECT COALESCE(SUM(total)::float8, 0) as total FROM "PurchaseOrder"'
      ),

      // Top 5 builders by order value
      prisma.$queryRawUnsafe<TopBuilderResult[]>(
        `SELECT "builderId", COUNT(*)::int as "orderCount", COALESCE(SUM("Order".total)::float8, 0) as "totalValue", "Builder"."companyName" FROM "Order" JOIN "Builder" ON "Order"."builderId" = "Builder".id WHERE "Builder"."companyName" != 'Unmatched InFlow Customers' GROUP BY "builderId", "Builder"."companyName" ORDER BY COALESCE(SUM("Order".total), 0) DESC LIMIT 5`
      ),

      // 5 most recent orders with builder name
      prisma.$queryRawUnsafe<RecentOrderResult[]>(
        'SELECT "Order".id, "Order"."orderNumber", "Builder"."companyName" as builderName, "Order".total::float8 as total, "Order".status::text as status, "Order"."paymentStatus"::text as paymentStatus, "Order"."createdAt" FROM "Order" JOIN "Builder" ON "Order"."builderId" = "Builder".id ORDER BY "Order"."createdAt" DESC LIMIT 5'
      ),

      // Orders by month (last 6 months)
      prisma.$queryRawUnsafe<MonthlyTrendResult[]>(
        'SELECT TO_CHAR("createdAt", \'YYYY-MM\') as month, COUNT(*)::int as count, COALESCE(SUM(total)::float8, 0) as revenue FROM "Order" WHERE "createdAt" >= NOW() - INTERVAL \'6 months\' GROUP BY TO_CHAR("createdAt", \'YYYY-MM\') ORDER BY month ASC'
      ),

      // POs by status
      prisma.$queryRawUnsafe<POStatusResult[]>(
        'SELECT status::text as status, COUNT(*)::int as count, COALESCE(SUM(total)::float8, 0) as total FROM "PurchaseOrder" GROUP BY status'
      ),
    ])

    const builderCount = builderCountResult[0]?.count || 0
    const productCount = productCountResult[0]?.count || 0
    const orderCount = orderCountResult[0]?.count || 0
    const totalRevenueRaw = orderRevenueResult[0]?.total || 0
    const totalRevenue = Number(totalRevenueRaw)

    // Build status maps
    const statusMap: Record<string, { count: number; revenue: number }> = {}
    for (const s of ordersByStatusResult) {
      statusMap[s.status] = { count: s.count, revenue: Number(s.revenue || 0) }
    }

    const paymentMap: Record<string, { count: number; revenue: number }> = {}
    for (const p of ordersByPaymentResult) {
      paymentMap[p.paymentStatus] = { count: p.count, revenue: Number(p.revenue || 0) }
    }

    const poStatusMap: Record<string, { count: number; total: number }> = {}
    for (const po of posByStatusResult) {
      poStatusMap[po.status] = { count: po.count, total: Number(po.total || 0) }
    }

    // Calculate key metrics
    const paidRevenue = paymentMap['PAID']?.revenue || 0
    const invoicedRevenue = paymentMap['INVOICED']?.revenue || 0
    const pendingRevenue = paymentMap['PENDING']?.revenue || 0

    const activeOrderStatuses = ['RECEIVED', 'CONFIRMED', 'IN_PRODUCTION', 'READY_TO_SHIP', 'SHIPPED']
    const activeOrders = activeOrderStatuses.reduce((sum, s) => sum + (statusMap[s]?.count || 0), 0)
    const completedOrders = (statusMap['DELIVERED']?.count || 0) + (statusMap['COMPLETE']?.count || 0)

    const poTotalRaw = poTotalResult[0]?.total || 0
    const poTotal = Number(poTotalRaw)

    const monthlyTrend = ordersByMonthResult.map(m => ({
      month: m.month,
      count: m.count,
      revenue: Number(m.revenue),
    }))

    // Phase 2 data sources - query with try-catch for runtime tables
    let dataSources = {
      hyphenOrders: 0,
      boltWorkOrders: 0,
      bwpFieldPOs: 0,
    }

    try {
      const [hyphenResult, boltResult, bwpResult] = await Promise.all([
        prisma.$queryRawUnsafe<CountResult[]>(
          'SELECT COUNT(*)::int as count FROM "HyphenOrder"'
        ).catch(() => [{ count: 0 }]),
        prisma.$queryRawUnsafe<CountResult[]>(
          'SELECT COUNT(*)::int as count FROM "BoltWorkOrder"'
        ).catch(() => [{ count: 0 }]),
        prisma.$queryRawUnsafe<CountResult[]>(
          'SELECT COUNT(*)::int as count FROM "BwpFieldPO"'
        ).catch(() => [{ count: 0 }]),
      ])

      dataSources = {
        hyphenOrders: hyphenResult?.[0]?.count || 0,
        boltWorkOrders: boltResult?.[0]?.count || 0,
        bwpFieldPOs: bwpResult?.[0]?.count || 0,
      }
    } catch (e) {
      console.warn('Phase 2 data sources unavailable:', e)
    }

    return NextResponse.json({
      builders: {
        total: builderCount,
      },
      products: {
        total: productCount,
      },
      orders: {
        total: orderCount,
        active: activeOrders,
        completed: completedOrders,
        totalRevenue,
        paidRevenue,
        invoicedRevenue,
        pendingRevenue,
        byStatus: statusMap,
        byPayment: paymentMap,
        monthlyTrend,
      },
      purchaseOrders: {
        total: purchaseOrderCountResult[0]?.count || 0,
        totalSpend: poTotal,
        byStatus: poStatusMap,
      },
      topBuilders: topBuildersResult.map(b => ({
        name: b.companyName,
        orderCount: b.orderCount,
        totalValue: Number(b.totalValue || 0),
      })),
      recentOrders: recentOrdersResult.map(o => ({
        id: o.id,
        orderNumber: o.orderNumber,
        builderName: o.builderName,
        total: Number(o.total),
        status: o.status,
        paymentStatus: o.paymentStatus,
        createdAt: o.createdAt,
      })),
      dataSources,
    })
  } catch (error) {
    console.error('Dashboard stats error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
