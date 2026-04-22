export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'

// GET /api/ops/kpis — All operational KPIs
export async function GET(request: NextRequest) {
  const authResult = checkStaffAuth(request)
  if (authResult) return authResult

  try {
    // 1. Deliveries this month
    const deliveriesThisMonth: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        COUNT(*)::int as total,
        COUNT(*) FILTER (WHERE status::text = 'COMPLETE')::int as completed,
        COUNT(*) FILTER (WHERE "completedAt" < NOW() AND status::text NOT IN ('COMPLETE', 'ARRIVED'))::int as late
      FROM "Delivery"
      WHERE "createdAt" >= date_trunc('month', NOW())
    `)

    const deliveriesData = deliveriesThisMonth[0] || { total: 0, completed: 0, late: 0 }

    // 2. On-time delivery rate (last 30 days)
    const onTimeDeliveries: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        COUNT(*)::int as total_delivered,
        COUNT(*) FILTER (WHERE "completedAt" IS NOT NULL AND "completedAt" <= "updatedAt" + interval '1 day')::int as on_time
      FROM "Delivery"
      WHERE status::text = 'COMPLETE'
        AND "completedAt" >= NOW() - interval '30 days'
    `)

    const onTimeData = onTimeDeliveries[0] || { total_delivered: 0, on_time: 0 }
    const onTimeRate = onTimeData.total_delivered > 0 ? Math.round((onTimeData.on_time / onTimeData.total_delivered) * 100) : 0

    // 3. Revenue this month vs last month
    const revenue: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        COALESCE(SUM(CASE WHEN "createdAt" >= date_trunc('month', NOW()) THEN total ELSE 0 END), 0)::float as this_month,
        COALESCE(SUM(CASE WHEN "createdAt" >= date_trunc('month', NOW() - interval '1 month')
          AND "createdAt" < date_trunc('month', NOW()) THEN total ELSE 0 END), 0)::float as last_month
      FROM "Order"
      WHERE status::text NOT IN ('CANCELLED')
    `)

    const revenueData = revenue[0] || { this_month: 0, last_month: 0 }
    const revenueChange = revenueData.last_month > 0
      ? Math.round(((revenueData.this_month - revenueData.last_month) / revenueData.last_month) * 100)
      : 0

    // 4. Open orders
    const openOrders: any[] = await prisma.$queryRawUnsafe(`
      SELECT COUNT(*)::int as open_orders
      FROM "Order"
      WHERE status::text IN ('RECEIVED', 'CONFIRMED', 'IN_PRODUCTION', 'READY_TO_SHIP')
    `)

    const openOrdersCount = openOrders[0]?.open_orders || 0

    // 5. Jobs in pipeline by stage
    const jobsPipeline: any[] = await prisma.$queryRawUnsafe(`
      SELECT status::text as stage, COUNT(*)::int as count
      FROM "Job"
      GROUP BY status::text
      ORDER BY
        CASE status::text
          WHEN 'CREATED' THEN 1
          WHEN 'READINESS_CHECK' THEN 2
          WHEN 'MATERIALS_LOCKED' THEN 3
          WHEN 'IN_PRODUCTION' THEN 4
          WHEN 'STAGED' THEN 5
          WHEN 'LOADED' THEN 6
          WHEN 'IN_TRANSIT' THEN 7
          WHEN 'DELIVERED' THEN 8
          WHEN 'COMPLETE' THEN 9
          ELSE 99
        END
    `)

    // 6. Outstanding AR
    const ar: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        COUNT(*)::int as unpaid_invoices,
        COALESCE(SUM(total), 0)::float as outstanding_amount,
        COUNT(*) FILTER (WHERE "dueDate" < NOW())::int as overdue_count,
        COALESCE(SUM(CASE WHEN "dueDate" < NOW() THEN total ELSE 0 END), 0)::float as overdue_amount
      FROM "Invoice"
      WHERE status::text NOT IN ('PAID', 'VOID', 'WRITE_OFF')
    `)

    const arData = ar[0] || { unpaid_invoices: 0, outstanding_amount: 0, overdue_count: 0, overdue_amount: 0 }

    // 7. Quote conversion (last 30 days)
    const quotes: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        COUNT(*)::int as total_quotes,
        COUNT(*) FILTER (WHERE status::text = 'APPROVED')::int as converted
      FROM "Quote"
      WHERE "createdAt" >= NOW() - interval '30 days'
    `)

    const quotesData = quotes[0] || { total_quotes: 0, converted: 0 }
    const quoteConversion = quotesData.total_quotes > 0 ? Math.round((quotesData.converted / quotesData.total_quotes) * 100) : 0

    // 8. Active crews today
    let activeCrewsCount = 0
    try {
      const activeCrew: any[] = await prisma.$queryRawUnsafe(`
        SELECT COUNT(DISTINCT "crewId")::int as active_crews
        FROM "ScheduleEntry"
        WHERE "scheduledDate" = CURRENT_DATE
          AND status::text IN ('FIRM', 'IN_PROGRESS')
      `)
      activeCrewsCount = activeCrew[0]?.active_crews || 0
    } catch {
      // ScheduleEntry table may not exist yet
    }

    // 9. Inventory alerts
    let lowStockCount = 0
    try {
      const inventory: any[] = await prisma.$queryRawUnsafe(`
        SELECT COUNT(*)::int as low_stock_items
        FROM "InventoryItem"
        WHERE "onHand" <= "reorderPoint" AND "reorderPoint" > 0
      `)
      lowStockCount = inventory[0]?.low_stock_items || 0
    } catch {
      // InventoryItem table may not exist yet
    }

    // 10. Deliveries today
    const deliveariesToday: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        COUNT(*)::int as total,
        COUNT(*) FILTER (WHERE status::text = 'COMPLETE')::int as completed
      FROM "Delivery"
      WHERE DATE("createdAt") = CURRENT_DATE
    `)

    const deliveriesTodayData = deliveariesToday[0] || { total: 0, completed: 0 }

    // 11. AR Aging
    const arAging: any[] = await prisma.$queryRawUnsafe(`
      SELECT bucket, invoice_count, amount FROM (
        SELECT
          1 as sort_order,
          'Current' as bucket,
          COUNT(*)::int as invoice_count,
          COALESCE(SUM(total), 0)::float as amount
        FROM "Invoice"
        WHERE status::text NOT IN ('PAID', 'VOID', 'WRITE_OFF')
          AND ("dueDate" IS NULL OR "dueDate" >= CURRENT_DATE)

        UNION ALL

        SELECT
          2 as sort_order,
          '1-30 Days' as bucket,
          COUNT(*)::int as invoice_count,
          COALESCE(SUM(total), 0)::float as amount
        FROM "Invoice"
        WHERE status::text NOT IN ('PAID', 'VOID', 'WRITE_OFF')
          AND "dueDate" < CURRENT_DATE
          AND "dueDate" >= CURRENT_DATE - interval '30 days'

        UNION ALL

        SELECT
          3 as sort_order,
          '31-60 Days' as bucket,
          COUNT(*)::int as invoice_count,
          COALESCE(SUM(total), 0)::float as amount
        FROM "Invoice"
        WHERE status::text NOT IN ('PAID', 'VOID', 'WRITE_OFF')
          AND "dueDate" < CURRENT_DATE - interval '30 days'
          AND "dueDate" >= CURRENT_DATE - interval '60 days'

        UNION ALL

        SELECT
          4 as sort_order,
          '60+ Days' as bucket,
          COUNT(*)::int as invoice_count,
          COALESCE(SUM(total), 0)::float as amount
        FROM "Invoice"
        WHERE status::text NOT IN ('PAID', 'VOID', 'WRITE_OFF')
          AND "dueDate" < CURRENT_DATE - interval '60 days'
      ) aging
      ORDER BY sort_order
    `)

    return NextResponse.json({
      deliveries: {
        thisMonth: deliveriesData.total,
        completed: deliveriesData.completed,
        late: deliveriesData.late,
        today: deliveriesTodayData,
      },
      onTimeDeliveryRate: onTimeRate,
      revenue: {
        thisMonth: Math.round(revenueData.this_month),
        lastMonth: Math.round(revenueData.last_month),
        changePercent: revenueChange,
      },
      openOrders: openOrdersCount,
      jobsPipeline: jobsPipeline.map((j: any) => ({ stage: j.stage, count: j.count })),
      ar: {
        unpaidInvoices: arData.unpaid_invoices,
        outstandingAmount: Math.round(arData.outstanding_amount),
        overdueCount: arData.overdue_count,
        overdueAmount: Math.round(arData.overdue_amount),
      },
      quoteConversion: quoteConversion,
      activeCrews: activeCrewsCount,
      lowStockItems: lowStockCount,
      arAging: arAging.map((a: any) => ({
        bucket: a.bucket,
        invoiceCount: a.invoice_count,
        amount: Math.round(a.amount),
      })),
    })
  } catch (error: any) {
    console.error('KPIs error:', error)
    return NextResponse.json(
      { error: 'Failed to load KPIs'},
      { status: 500 }
    )
  }
}

function fmtUSD(n: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n)
}
