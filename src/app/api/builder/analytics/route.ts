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
    })
  } catch (error) {
    console.error('Analytics API error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch analytics' },
      { status: 500 }
    )
  }
}
