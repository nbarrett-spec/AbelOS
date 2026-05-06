import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  try {
    const session = await getSession()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const builderId = session.builderId

    // Monthly spend (last 12 months)
    const monthlyData = await prisma.$queryRawUnsafe<
      Array<{ month: string; order_count: number; spend: number }>
    >(`
      SELECT
        date_trunc('month', "createdAt") as month,
        COUNT(*)::int as order_count,
        COALESCE(SUM("total"), 0)::float as spend
      FROM "Order"
      WHERE "builderId" = $1 AND "status"::text != 'CANCELLED'
        AND "createdAt" >= NOW() - interval '12 months'
      GROUP BY date_trunc('month', "createdAt")
      ORDER BY month ASC
    `, builderId)

    // Top products ordered (by quantity)
    const topProducts = await prisma.$queryRawUnsafe<
      Array<{
        name: string
        sku: string
        category: string
        total_qty: number
        total_spend: number
      }>
    >(`
      SELECT p.name, p.sku, p.category,
        SUM(oi.quantity)::int as total_qty,
        COALESCE(SUM(oi."lineTotal"), 0)::float as total_spend
      FROM "OrderItem" oi
      JOIN "Order" o ON oi."orderId" = o.id
      JOIN "Product" p ON oi."productId" = p.id
      WHERE o."builderId" = $1 AND o."status"::text != 'CANCELLED'
      GROUP BY p.name, p.sku, p.category
      ORDER BY total_spend DESC
      LIMIT 10
    `, builderId)

    // Spend by category
    const spendByCategory = await prisma.$queryRawUnsafe<
      Array<{
        category: string
        order_count: number
        total_spend: number
      }>
    >(`
      SELECT p.category,
        COUNT(DISTINCT o.id)::int as order_count,
        COALESCE(SUM(oi."lineTotal"), 0)::float as total_spend
      FROM "OrderItem" oi
      JOIN "Order" o ON oi."orderId" = o.id
      JOIN "Product" p ON oi."productId" = p.id
      WHERE o."builderId" = $1 AND o."status"::text != 'CANCELLED'
      GROUP BY p.category
      ORDER BY total_spend DESC
    `, builderId)

    // YTD totals
    const ytdStats = await prisma.$queryRawUnsafe<
      Array<{ ytd_orders: number; ytd_spend: number }>
    >(`
      SELECT
        COUNT(*)::int as ytd_orders,
        COALESCE(SUM("total"), 0)::float as ytd_spend
      FROM "Order"
      WHERE "builderId" = $1 AND "status"::text != 'CANCELLED'
        AND "createdAt" >= date_trunc('year', NOW())
    `, builderId)

    // Quote-to-order stats
    const quoteStats = await prisma.$queryRawUnsafe<
      Array<{
        total_quotes: number
        approved: number
        avg_days_to_approve: number
      }>
    >(`
      SELECT
        COUNT(*)::int as total_quotes,
        COUNT(*) FILTER (WHERE "status"::text = 'APPROVED')::int as approved,
        COALESCE(AVG(EXTRACT(EPOCH FROM ("updatedAt" - "createdAt"))/86400), 0) as avg_days_to_approve
      FROM "Quote"
      WHERE "builderId" = $1
        AND "createdAt" >= date_trunc('year', NOW())
    `, builderId)

    // Payment history summary
    const paymentStats = await prisma.$queryRawUnsafe<
      Array<{
        total_invoices: number
        paid: number
        overdue: number
      }>
    >(`
      SELECT
        COUNT(*)::int as total_invoices,
        COUNT(*) FILTER (WHERE "status"::text = 'PAID')::int as paid,
        COUNT(*) FILTER (WHERE "dueDate" < NOW() AND "status"::text NOT IN ('PAID','VOID','WRITE_OFF'))::int as overdue
      FROM "Invoice"
      WHERE "builderId" = $1
    `, builderId)

    // AR balance + avg days to pay
    const arStats = await prisma.$queryRawUnsafe<
      Array<{
        ar_balance: number
        avg_days_to_pay: number | null
      }>
    >(`
      SELECT
        COALESCE(SUM(CASE WHEN "status"::text NOT IN ('PAID','VOID','WRITE_OFF')
                          THEN "balanceDue" ELSE 0 END), 0)::float as ar_balance,
        AVG(EXTRACT(EPOCH FROM ("paidAt" - "issuedAt"))/86400)
          FILTER (WHERE "status"::text = 'PAID' AND "paidAt" IS NOT NULL AND "issuedAt" IS NOT NULL) as avg_days_to_pay
      FROM "Invoice"
      WHERE "builderId" = $1
    `, builderId)

    // Active orders + open quotes (in-flight pipeline)
    const pipelineStats = await prisma.$queryRawUnsafe<
      Array<{
        active_orders: number
        open_quotes: number
      }>
    >(`
      SELECT
        (SELECT COUNT(*)::int FROM "Order"
          WHERE "builderId" = $1
            AND "status"::text NOT IN ('DELIVERED','COMPLETE','CANCELLED')) as active_orders,
        (SELECT COUNT(*)::int FROM "Quote"
          WHERE "builderId" = $1
            AND "status"::text IN ('DRAFT','SENT')) as open_quotes
    `, builderId)

    // Monthly payment history (12 months) — sums Payment.amount through Invoice.builderId
    const paymentHistory = await prisma.$queryRawUnsafe<
      Array<{ month: string; payments_count: number; payments_total: number }>
    >(`
      SELECT
        date_trunc('month', p."receivedAt") as month,
        COUNT(*)::int as payments_count,
        COALESCE(SUM(p."amount"), 0)::float as payments_total
      FROM "Payment" p
      JOIN "Invoice" i ON p."invoiceId" = i.id
      WHERE i."builderId" = $1
        AND p."receivedAt" >= NOW() - interval '12 months'
      GROUP BY date_trunc('month', p."receivedAt")
      ORDER BY month ASC
    `, builderId)

    // Delivery on-time performance (last 90 days). On-time = completedAt
    // exists AND completedAt::date <= scheduledDate (Job.scheduledDate).
    const deliveryPerf = await prisma.$queryRawUnsafe<
      Array<{ total: number; on_time: number; late: number; pending: number }>
    >(`
      SELECT
        COUNT(*)::int as total,
        COUNT(*) FILTER (
          WHERE d."completedAt" IS NOT NULL
            AND j."scheduledDate" IS NOT NULL
            AND d."completedAt"::date <= j."scheduledDate"::date
        )::int as on_time,
        COUNT(*) FILTER (
          WHERE d."completedAt" IS NOT NULL
            AND j."scheduledDate" IS NOT NULL
            AND d."completedAt"::date > j."scheduledDate"::date
        )::int as late,
        COUNT(*) FILTER (WHERE d."completedAt" IS NULL)::int as pending
      FROM "Delivery" d
      JOIN "Job" j ON d."jobId" = j.id
      JOIN "Order" o ON j."orderId" = o.id
      WHERE o."builderId" = $1
        AND d."createdAt" >= NOW() - interval '90 days'
    `, builderId)

    // Recent activity feed (last 30 days) — orders, quotes, invoices unioned
    const activity = await prisma.$queryRawUnsafe<
      Array<{
        kind: string
        ref_id: string
        ref_number: string
        amount: number | null
        status: string
        ts: string
      }>
    >(`
      (
        SELECT 'order'::text as kind, id as ref_id, "orderNumber" as ref_number,
               "total"::float as amount, "status"::text as status, "createdAt" as ts
        FROM "Order"
        WHERE "builderId" = $1 AND "createdAt" >= NOW() - interval '30 days'
      )
      UNION ALL
      (
        SELECT 'quote'::text as kind, id as ref_id, "quoteNumber" as ref_number,
               "total"::float as amount, "status"::text as status, "createdAt" as ts
        FROM "Quote"
        WHERE "builderId" = $1 AND "createdAt" >= NOW() - interval '30 days'
      )
      UNION ALL
      (
        SELECT 'invoice'::text as kind, id as ref_id, "invoiceNumber" as ref_number,
               "total"::float as amount, "status"::text as status,
               COALESCE("issuedAt", "createdAt") as ts
        FROM "Invoice"
        WHERE "builderId" = $1
          AND COALESCE("issuedAt", "createdAt") >= NOW() - interval '30 days'
      )
      ORDER BY ts DESC
      LIMIT 25
    `, builderId)

    // Format response
    const ytd = ytdStats[0] || { ytd_orders: 0, ytd_spend: 0 }
    const avgOrderValue =
      ytd.ytd_orders > 0 ? ytd.ytd_spend / ytd.ytd_orders : 0

    const quotes = quoteStats[0] || {
      total_quotes: 0,
      approved: 0,
      avg_days_to_approve: 0,
    }
    const approvalRate =
      quotes.total_quotes > 0
        ? (quotes.approved / quotes.total_quotes) * 100
        : 0

    const payments = paymentStats[0] || {
      total_invoices: 0,
      paid: 0,
      overdue: 0,
    }

    const ar = arStats[0] || { ar_balance: 0, avg_days_to_pay: null }
    const pipeline = pipelineStats[0] || { active_orders: 0, open_quotes: 0 }
    const delivery = deliveryPerf[0] || {
      total: 0,
      on_time: 0,
      late: 0,
      pending: 0,
    }
    const completedDeliveries = (delivery.on_time ?? 0) + (delivery.late ?? 0)
    const onTimePercent =
      completedDeliveries > 0
        ? ((delivery.on_time ?? 0) / completedDeliveries) * 100
        : 0

    return NextResponse.json({
      monthly: monthlyData.map((m) => ({
        month: new Date(m.month).toISOString().substring(0, 7),
        orders: m.order_count,
        spend: m.spend,
      })),
      topProducts: topProducts.map((p) => ({
        name: p.name,
        sku: p.sku,
        category: p.category,
        quantity: p.total_qty,
        spend: p.total_spend,
      })),
      spendByCategory: spendByCategory.map((c) => ({
        category: c.category,
        orders: c.order_count,
        spend: c.total_spend,
      })),
      keyMetrics: {
        ytdSpend: ytd.ytd_spend,
        ytdOrders: ytd.ytd_orders,
        avgOrderValue,
        approvalRate,
      },
      quoteStats: {
        total: quotes.total_quotes,
        approved: quotes.approved,
        avgDaysToApprove: quotes.avg_days_to_approve,
      },
      paymentStats: {
        totalInvoices: payments.total_invoices,
        paid: payments.paid,
        overdue: payments.overdue,
      },
      ar: {
        balance: ar.ar_balance,
        avgDaysToPay:
          ar.avg_days_to_pay !== null ? Number(ar.avg_days_to_pay) : null,
      },
      pipeline: {
        activeOrders: pipeline.active_orders,
        openQuotes: pipeline.open_quotes,
      },
      paymentHistory: paymentHistory.map((p) => ({
        month: new Date(p.month).toISOString().substring(0, 7),
        count: p.payments_count,
        total: p.payments_total,
      })),
      deliveryPerformance: {
        windowDays: 90,
        total: delivery.total,
        onTime: delivery.on_time,
        late: delivery.late,
        pending: delivery.pending,
        onTimePercent,
      },
      activity: activity.map((a) => ({
        kind: a.kind as 'order' | 'quote' | 'invoice',
        id: a.ref_id,
        number: a.ref_number,
        amount: a.amount,
        status: a.status,
        timestamp: new Date(a.ts).toISOString(),
      })),
    })
  } catch (error) {
    console.error('Analytics API error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch analytics' },
      { status: 500 }
    )
  }
}
