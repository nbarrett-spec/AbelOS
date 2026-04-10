export const dynamic = 'force-dynamic'
import { prisma } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'
import { safeJson } from '@/lib/safe-json'
import { parseRoles, type StaffRole } from '@/lib/permissions'

const SENSITIVE_FINANCE_ROLES: StaffRole[] = ['ADMIN', 'MANAGER', 'ACCOUNTING']

export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  const staffRolesStr = request.headers.get('x-staff-roles') || request.headers.get('x-staff-role') || ''
  const userRoles = parseRoles(staffRolesStr) as StaffRole[]
  const canSeeSensitiveFinance = userRoles.some(r => SENSITIVE_FINANCE_ROLES.includes(r))

  try {
    // Revenue KPIs from ORDERS (primary revenue source)
    const orderRevenue: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        ROUND(COALESCE(SUM(total), 0)::numeric, 2) as "totalRevenue",
        COUNT(*)::int as "totalOrders",
        ROUND(COALESCE(SUM(CASE WHEN "createdAt" >= DATE_TRUNC('month', NOW()) THEN total ELSE 0 END), 0)::numeric, 2) as "currentMonth",
        ROUND(COALESCE(SUM(CASE WHEN "createdAt" >= DATE_TRUNC('month', NOW() - INTERVAL '1 month')
          AND "createdAt" < DATE_TRUNC('month', NOW()) THEN total ELSE 0 END), 0)::numeric, 2) as "lastMonth",
        ROUND(COALESCE(SUM(CASE WHEN "createdAt" >= DATE_TRUNC('year', NOW()) THEN total ELSE 0 END), 0)::numeric, 2) as "ytd",
        COUNT(CASE WHEN "createdAt" >= DATE_TRUNC('month', NOW()) THEN 1 END)::int as "ordersThisMonth"
      FROM "Order"
      WHERE status != 'CANCELLED'::"OrderStatus"
    `)
    const oRev = orderRevenue[0] || {}

    // Invoice & Collection metrics
    const invoiceMetrics: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        ROUND(COALESCE(SUM(total), 0)::numeric, 2) as "totalInvoiced",
        ROUND(COALESCE(SUM("amountPaid"), 0)::numeric, 2) as "totalCollected",
        ROUND(COALESCE(SUM("balanceDue"), 0)::numeric, 2) as "outstandingAR",
        COUNT(*)::int as "invoiceCount",
        COUNT(CASE WHEN status = 'OVERDUE'::"InvoiceStatus" THEN 1 END)::int as "overdueCount"
      FROM "Invoice"
    `)
    const inv = invoiceMetrics[0] || {}

    const momGrowth = Number(oRev.lastMonth) > 0
      ? ((Number(oRev.currentMonth) - Number(oRev.lastMonth)) / Number(oRev.lastMonth)) * 100
      : Number(oRev.currentMonth) > 0 ? 100 : 0

    // Monthly revenue trend (last 6 months from Orders)
    const monthlyRevenue: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        TO_CHAR(DATE_TRUNC('month', "createdAt"), 'Mon YYYY') as month,
        DATE_TRUNC('month', "createdAt") as "sortDate",
        ROUND(COALESCE(SUM(total), 0)::numeric, 2) as revenue,
        COUNT(*)::int as "orderCount"
      FROM "Order"
      WHERE "createdAt" >= DATE_TRUNC('month', NOW() - INTERVAL '5 months')
        AND status != 'CANCELLED'::"OrderStatus"
      GROUP BY DATE_TRUNC('month', "createdAt"), TO_CHAR(DATE_TRUNC('month', "createdAt"), 'Mon YYYY')
      ORDER BY "sortDate" ASC
    `)

    // Order status distribution (pipeline health)
    const ordersByStatus: any[] = await prisma.$queryRawUnsafe(`
      SELECT status::text, COUNT(*)::int as count,
        ROUND(COALESCE(SUM(total), 0)::numeric, 2) as value
      FROM "Order"
      GROUP BY status
      ORDER BY count DESC
    `)

    // Builder metrics
    const builderMetrics: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        COUNT(*)::int as "totalBuilders",
        COUNT(CASE WHEN status = 'ACTIVE'::"AccountStatus" THEN 1 END)::int as "activeBuilders",
        COUNT(CASE WHEN "createdAt" >= DATE_TRUNC('month', NOW()) THEN 1 END)::int as "newThisMonth"
      FROM "Builder"
    `)

    // Top builders by ORDER revenue
    const topBuilders: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        o."builderId",
        b."companyName",
        ROUND(COALESCE(SUM(o.total), 0)::numeric, 2) as revenue,
        COUNT(*)::int as "orderCount"
      FROM "Order" o
      JOIN "Builder" b ON o."builderId" = b.id
      WHERE o.status != 'CANCELLED'::"OrderStatus"
        AND b."companyName" != 'Unmatched InFlow Customers'
      GROUP BY o."builderId", b."companyName"
      ORDER BY revenue DESC
      LIMIT 10
    `)

    // Operations snapshot from Orders
    const opsSnapshot: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        COUNT(CASE WHEN status IN ('COMPLETE'::"OrderStatus", 'DELIVERED'::"OrderStatus") THEN 1 END)::int as "completedAll",
        COUNT(CASE WHEN status IN ('COMPLETE'::"OrderStatus", 'DELIVERED'::"OrderStatus")
          AND "updatedAt" >= DATE_TRUNC('month', NOW()) THEN 1 END)::int as "completedThisMonth",
        COUNT(CASE WHEN status IN ('SHIPPED'::"OrderStatus", 'IN_PRODUCTION'::"OrderStatus", 'READY_TO_SHIP'::"OrderStatus") THEN 1 END)::int as "inProgress",
        COUNT(CASE WHEN status IN ('RECEIVED'::"OrderStatus", 'CONFIRMED'::"OrderStatus") THEN 1 END)::int as "pending",
        ROUND(COALESCE(AVG(CASE WHEN status IN ('COMPLETE'::"OrderStatus", 'DELIVERED'::"OrderStatus")
          THEN EXTRACT(EPOCH FROM ("updatedAt" - "createdAt")) / 86400.0 END), 0)::numeric, 1) as "avgCycleDays"
      FROM "Order"
    `)
    const ops = opsSnapshot[0] || {}

    // Delivery stats
    const deliveryStats: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        COUNT(*)::int as "totalDeliveries",
        COUNT(CASE WHEN status = 'COMPLETE'::"DeliveryStatus" THEN 1 END)::int as "completed",
        COUNT(CASE WHEN status IN ('SCHEDULED'::"DeliveryStatus", 'LOADING'::"DeliveryStatus", 'IN_TRANSIT'::"DeliveryStatus") THEN 1 END)::int as "active"
      FROM "Delivery"
    `)
    const delStats = deliveryStats[0] || {}

    // PO spending summary
    const poSpending: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        ROUND(COALESCE(SUM(total), 0)::numeric, 2) as "totalSpend",
        COUNT(*)::int as "totalPOs",
        COUNT(CASE WHEN status NOT IN ('RECEIVED'::"POStatus", 'CANCELLED'::"POStatus") THEN 1 END)::int as "openPOs",
        ROUND(COALESCE(SUM(CASE WHEN status NOT IN ('RECEIVED'::"POStatus", 'CANCELLED'::"POStatus") THEN total ELSE 0 END), 0)::numeric, 2) as "openValue"
      FROM "PurchaseOrder"
    `)
    const po = poSpending[0] || {}

    // Gross margin from actual COGS (OrderItem cost via Product.cost)
    const cogsData: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        ROUND(COALESCE(SUM(oi.quantity * COALESCE(bom_cost(p.id), p.cost)), 0)::numeric, 2) as "totalCOGS"
      FROM "OrderItem" oi
      JOIN "Product" p ON oi."productId" = p.id
      JOIN "Order" o ON oi."orderId" = o.id
      WHERE o.status != 'CANCELLED'::"OrderStatus"
    `)
    const totalCOGS = Number(cogsData[0]?.totalCOGS || 0)
    const grossMargin = Number(oRev.totalRevenue) > 0
      ? ((Number(oRev.totalRevenue) - totalCOGS) / Number(oRev.totalRevenue) * 100)
      : 0

    // Alerts
    const stalledOrders: any[] = await prisma.$queryRawUnsafe(`
      SELECT COUNT(*)::int as c FROM "Order"
      WHERE status IN ('RECEIVED'::"OrderStatus", 'CONFIRMED'::"OrderStatus")
        AND "updatedAt" < NOW() - INTERVAL '7 days'
    `)

    return safeJson({
      revenueKpis: {
        totalRevenue: Number(oRev.totalRevenue),
        totalOrders: Number(oRev.totalOrders),
        currentMonth: Number(oRev.currentMonth),
        lastMonth: Number(oRev.lastMonth),
        ytd: Number(oRev.ytd),
        momGrowth: Math.round(momGrowth * 100) / 100,
        totalInvoiced: canSeeSensitiveFinance ? Number(inv.totalInvoiced) : undefined,
        totalCollected: canSeeSensitiveFinance ? Number(inv.totalCollected) : undefined,
        outstandingAR: canSeeSensitiveFinance ? Number(inv.outstandingAR) : undefined,
        grossMargin: canSeeSensitiveFinance ? Math.round(grossMargin * 100) / 100 : undefined,
      },
      monthlyRevenue: monthlyRevenue.map((m: any) => ({
        month: m.month,
        revenue: Number(m.revenue),
        orderCount: Number(m.orderCount),
      })),
      pipelineHealth: {
        ordersByStatus: ordersByStatus.map((item: any) => ({
          status: item.status,
          count: Number(item.count),
          value: Number(item.value),
        })),
        totalOrders: Number(oRev.totalOrders),
        inProgress: Number(ops.inProgress),
        pending: Number(ops.pending),
      },
      builderMetrics: {
        totalBuilders: Number(builderMetrics[0]?.totalBuilders || 0),
        activeBuilders: Number(builderMetrics[0]?.activeBuilders || 0),
        newThisMonth: Number(builderMetrics[0]?.newThisMonth || 0),
        topBuilders: topBuilders.map((b: any) => ({
          builderId: b.builderId,
          companyName: b.companyName,
          revenue: Number(b.revenue),
          orderCount: Number(b.orderCount),
        })),
      },
      operationsSnapshot: {
        completedAll: Number(ops.completedAll),
        completedThisMonth: Number(ops.completedThisMonth),
        inProgress: Number(ops.inProgress),
        avgCycleTimeDays: Number(ops.avgCycleDays || 0),
        totalDeliveries: Number(delStats.totalDeliveries),
        activeDeliveries: Number(delStats.active),
      },
      financials: canSeeSensitiveFinance ? {
        totalPOSpend: Number(po.totalSpend),
        openPOs: Number(po.openPOs),
        openPOValue: Number(po.openValue),
        grossMargin: Math.round(grossMargin * 100) / 100,
      } : {
        openPOs: Number(po.openPOs),
      },
      alerts: {
        overdueInvoices: Number(inv.overdueCount),
        stalledOrders: Number(stalledOrders[0]?.c || 0),
      },
    })
  } catch (error: any) {
    console.error('Dashboard API error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch dashboard data', details: error.message },
      { status: 500 }
    )
  }
}
