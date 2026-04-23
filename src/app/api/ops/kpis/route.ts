export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'

// GET /api/ops/kpis — All operational KPIs
//
// Query params:
//   ?at=YYYY-MM-DD   — compute KPIs as of a historical date. If a
//                      FinancialSnapshot exists for that date we prefer it for
//                      the AR/revenue numbers, otherwise we recompute from the
//                      live tables.
//   ?from=...&to=... — date range window (falls back to current month).
export async function GET(request: NextRequest) {
  const authResult = checkStaffAuth(request)
  if (authResult) return authResult

  const sp = request.nextUrl.searchParams
  const atParam = sp.get('at')
  const isSnapshot = !!atParam
  const asOf = atParam ? new Date(atParam) : new Date()
  if (isNaN(asOf.getTime())) {
    return NextResponse.json({ error: 'Invalid ?at date' }, { status: 400 })
  }
  const asOfIso = asOf.toISOString()

  try {
    // ── Prefer a FinancialSnapshot row when ?at= is provided ──
    let snapshotRow: any = null
    if (isSnapshot) {
      try {
        const rows: any[] = await prisma.$queryRawUnsafe(
          `SELECT * FROM "FinancialSnapshot"
           WHERE DATE("snapshotDate") = DATE($1::timestamp)
           ORDER BY "snapshotDate" DESC LIMIT 1`,
          asOfIso,
        )
        snapshotRow = rows[0] || null
      } catch {
        snapshotRow = null
      }
    }

    // 1. Deliveries (as-of window, current month)
    const deliveriesThisMonth: any[] = await prisma.$queryRawUnsafe(
      `
      SELECT
        COUNT(*)::int as total,
        COUNT(*) FILTER (WHERE status::text = 'COMPLETE')::int as completed,
        COUNT(*) FILTER (WHERE "completedAt" < $1::timestamp AND status::text NOT IN ('COMPLETE', 'ARRIVED'))::int as late
      FROM "Delivery"
      WHERE "createdAt" >= date_trunc('month', $1::timestamp)
        AND "createdAt" <= $1::timestamp
      `,
      asOfIso,
    )
    const deliveriesData = deliveriesThisMonth[0] || { total: 0, completed: 0, late: 0 }

    // 2. On-time delivery rate (trailing 30 days from as-of)
    const onTimeDeliveries: any[] = await prisma.$queryRawUnsafe(
      `
      SELECT
        COUNT(*)::int as total_delivered,
        COUNT(*) FILTER (WHERE "completedAt" IS NOT NULL AND "completedAt" <= "updatedAt" + interval '1 day')::int as on_time
      FROM "Delivery"
      WHERE status::text = 'COMPLETE'
        AND "completedAt" >= $1::timestamp - interval '30 days'
        AND "completedAt" <= $1::timestamp
      `,
      asOfIso,
    )
    const onTimeData = onTimeDeliveries[0] || { total_delivered: 0, on_time: 0 }
    const onTimeRate = onTimeData.total_delivered > 0 ? Math.round((onTimeData.on_time / onTimeData.total_delivered) * 100) : 0

    // 3. Revenue — prefer snapshot values if we have them
    const revenue: any[] = await prisma.$queryRawUnsafe(
      `
      SELECT
        COALESCE(SUM(CASE WHEN "createdAt" >= date_trunc('month', $1::timestamp)
                           AND "createdAt" <= $1::timestamp THEN total ELSE 0 END), 0)::float as this_month,
        COALESCE(SUM(CASE WHEN "createdAt" >= date_trunc('month', $1::timestamp - interval '1 month')
                           AND "createdAt" < date_trunc('month', $1::timestamp) THEN total ELSE 0 END), 0)::float as last_month
      FROM "Order"
      WHERE status::text NOT IN ('CANCELLED')
      `,
      asOfIso,
    )
    const revenueData = revenue[0] || { this_month: 0, last_month: 0 }
    const thisMonthRev = snapshotRow?.revenueMonth ?? revenueData.this_month
    const lastMonthRev = snapshotRow?.revenuePrior ?? revenueData.last_month
    const revenueChange = lastMonthRev > 0
      ? Math.round(((thisMonthRev - lastMonthRev) / lastMonthRev) * 100)
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

    // 6. Outstanding AR — prefer snapshot totals when present
    const ar: any[] = await prisma.$queryRawUnsafe(
      `
      SELECT
        COUNT(*)::int as unpaid_invoices,
        COALESCE(SUM(total), 0)::float as outstanding_amount,
        COUNT(*) FILTER (WHERE "dueDate" < $1::timestamp)::int as overdue_count,
        COALESCE(SUM(CASE WHEN "dueDate" < $1::timestamp THEN total ELSE 0 END), 0)::float as overdue_amount
      FROM "Invoice"
      WHERE status::text NOT IN ('PAID', 'VOID', 'WRITE_OFF')
      `,
      asOfIso,
    )
    const arData = ar[0] || { unpaid_invoices: 0, outstanding_amount: 0, overdue_count: 0, overdue_amount: 0 }

    // 7. Quote conversion (trailing 30 days)
    const quotes: any[] = await prisma.$queryRawUnsafe(
      `
      SELECT
        COUNT(*)::int as total_quotes,
        COUNT(*) FILTER (WHERE status::text = 'APPROVED')::int as converted
      FROM "Quote"
      WHERE "createdAt" >= $1::timestamp - interval '30 days'
        AND "createdAt" <= $1::timestamp
      `,
      asOfIso,
    )
    const quotesData = quotes[0] || { total_quotes: 0, converted: 0 }
    const quoteConversion = quotesData.total_quotes > 0 ? Math.round((quotesData.converted / quotesData.total_quotes) * 100) : 0

    // 8. Active crews (today only — not snapshot-aware, by design)
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

    // 10. Deliveries today (always "today" — not snapshot-aware)
    const deliveariesToday: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        COUNT(*)::int as total,
        COUNT(*) FILTER (WHERE status::text = 'COMPLETE')::int as completed
      FROM "Delivery"
      WHERE DATE("createdAt") = CURRENT_DATE
    `)
    const deliveriesTodayData = deliveariesToday[0] || { total: 0, completed: 0 }

    // 11. AR Aging — prefer snapshot's aging buckets if present
    let arAging: Array<{ bucket: string; invoiceCount: number; amount: number }>
    if (snapshotRow) {
      arAging = [
        { bucket: 'Current', invoiceCount: 0, amount: Math.round(snapshotRow.arCurrent || 0) },
        { bucket: '1-30 Days', invoiceCount: 0, amount: Math.round(snapshotRow.ar30 || 0) },
        { bucket: '31-60 Days', invoiceCount: 0, amount: Math.round(snapshotRow.ar60 || 0) },
        { bucket: '60+ Days', invoiceCount: 0, amount: Math.round(snapshotRow.ar90Plus || 0) },
      ]
    } else {
      const arAgingRows: any[] = await prisma.$queryRawUnsafe(
        `
        SELECT bucket, invoice_count, amount FROM (
          SELECT 1 as sort_order, 'Current' as bucket,
            COUNT(*)::int as invoice_count,
            COALESCE(SUM(total), 0)::float as amount
          FROM "Invoice"
          WHERE status::text NOT IN ('PAID', 'VOID', 'WRITE_OFF')
            AND ("dueDate" IS NULL OR "dueDate" >= $1::timestamp)
          UNION ALL
          SELECT 2, '1-30 Days',
            COUNT(*)::int,
            COALESCE(SUM(total), 0)::float
          FROM "Invoice"
          WHERE status::text NOT IN ('PAID', 'VOID', 'WRITE_OFF')
            AND "dueDate" < $1::timestamp
            AND "dueDate" >= $1::timestamp - interval '30 days'
          UNION ALL
          SELECT 3, '31-60 Days',
            COUNT(*)::int,
            COALESCE(SUM(total), 0)::float
          FROM "Invoice"
          WHERE status::text NOT IN ('PAID', 'VOID', 'WRITE_OFF')
            AND "dueDate" < $1::timestamp - interval '30 days'
            AND "dueDate" >= $1::timestamp - interval '60 days'
          UNION ALL
          SELECT 4, '60+ Days',
            COUNT(*)::int,
            COALESCE(SUM(total), 0)::float
          FROM "Invoice"
          WHERE status::text NOT IN ('PAID', 'VOID', 'WRITE_OFF')
            AND "dueDate" < $1::timestamp - interval '60 days'
        ) aging
        ORDER BY sort_order
        `,
        asOfIso,
      )
      arAging = arAgingRows.map((a: any) => ({
        bucket: a.bucket,
        invoiceCount: a.invoice_count,
        amount: Math.round(a.amount),
      }))
    }

    return NextResponse.json({
      asOf: asOf.toISOString(),
      isSnapshot,
      snapshotSource: snapshotRow ? 'FinancialSnapshot' : 'live',
      deliveries: {
        thisMonth: deliveriesData.total,
        completed: deliveriesData.completed,
        late: deliveriesData.late,
        today: deliveriesTodayData,
      },
      onTimeDeliveryRate: onTimeRate,
      revenue: {
        thisMonth: Math.round(thisMonthRev),
        lastMonth: Math.round(lastMonthRev),
        changePercent: revenueChange,
      },
      openOrders: openOrdersCount,
      jobsPipeline: jobsPipeline.map((j: any) => ({ stage: j.stage, count: j.count })),
      ar: {
        unpaidInvoices: snapshotRow?.pendingInvoices
          ? Math.round(snapshotRow.pendingInvoices)
          : arData.unpaid_invoices,
        outstandingAmount: snapshotRow?.arTotal
          ? Math.round(snapshotRow.arTotal)
          : Math.round(arData.outstanding_amount),
        overdueCount: arData.overdue_count,
        overdueAmount: Math.round(arData.overdue_amount),
      },
      quoteConversion: quoteConversion,
      activeCrews: activeCrewsCount,
      lowStockItems: lowStockCount,
      arAging,
    })
  } catch (error: any) {
    console.error('KPIs error:', error)
    return NextResponse.json(
      { error: 'Failed to load KPIs' },
      { status: 500 }
    )
  }
}
