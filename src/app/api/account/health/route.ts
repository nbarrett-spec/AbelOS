export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/auth'

// GET /api/account/health — Builder account health dashboard data
export async function GET(request: NextRequest) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  try {
    const builderId = session.builderId

    // Get builder account info
    const builderRows: any[] = await prisma.$queryRawUnsafe(`
      SELECT "id", "companyName", "contactName", "email", "phone",
             "paymentTerm", "creditLimit", "accountBalance", "status",
             "taxExempt", "address", "city", "state", "zip"
      FROM "Builder" WHERE "id" = $1
    `, builderId)

    if (builderRows.length === 0) {
      return NextResponse.json({ error: 'Account not found' }, { status: 404 })
    }

    const builder = builderRows[0]

    // Get invoice summary
    const invoiceSummary: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        COUNT(*)::int AS "totalInvoices",
        COALESCE(SUM(CASE WHEN "status"::text NOT IN ('PAID', 'VOID', 'WRITE_OFF') THEN "total" - COALESCE("amountPaid",0) ELSE 0 END), 0)::float AS "totalOutstanding",
        COALESCE(SUM(CASE WHEN "status"::text = 'OVERDUE' THEN "total" - COALESCE("amountPaid",0) ELSE 0 END), 0)::float AS "overdueAmount",
        COUNT(CASE WHEN "status"::text = 'OVERDUE' THEN 1 END)::int AS "overdueCount",
        COALESCE(SUM(CASE WHEN "status"::text = 'PAID' AND "paidAt" >= NOW() - INTERVAL '30 days' THEN "total" ELSE 0 END), 0)::float AS "paidLast30Days",
        COUNT(CASE WHEN "status"::text IN ('DRAFT', 'ISSUED', 'SENT', 'PARTIALLY_PAID') THEN 1 END)::int AS "openInvoiceCount"
      FROM "Invoice"
      WHERE "builderId" = $1
    `, builderId)

    // Get order summary
    const orderSummary: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        COUNT(*)::int AS "totalOrders",
        COUNT(CASE WHEN "status"::text NOT IN ('COMPLETE', 'CANCELLED', 'DELIVERED') THEN 1 END)::int AS "activeOrders",
        COALESCE(SUM("total"), 0)::float AS "lifetimeValue",
        COALESCE(SUM(CASE WHEN "createdAt" >= NOW() - INTERVAL '30 days' THEN "total" ELSE 0 END), 0)::float AS "last30DaysValue"
      FROM "Order"
      WHERE "builderId" = $1
    `, builderId)

    // Get upcoming deliveries (next 14 days) — using JOIN instead of correlated subquery
    const upcomingDeliveries: any[] = await prisma.$queryRawUnsafe(`
      SELECT o."id", o."orderNumber", o."total", o."status"::text AS "status",
             o."deliveryDate", o."deliveryNotes",
             COUNT(oi.id)::int AS "itemCount"
      FROM "Order" o
      LEFT JOIN "OrderItem" oi ON oi."orderId" = o."id"
      WHERE o."builderId" = $1
        AND o."deliveryDate" IS NOT NULL
        AND o."deliveryDate" >= NOW()
        AND o."deliveryDate" <= NOW() + INTERVAL '14 days'
        AND o."status"::text NOT IN ('COMPLETE', 'CANCELLED', 'DELIVERED')
      GROUP BY o."id", o."orderNumber", o."total", o."status", o."deliveryDate", o."deliveryNotes"
      ORDER BY o."deliveryDate" ASC
      LIMIT 5
    `, builderId)

    // Get recent orders for quick reorder — using JOIN instead of correlated subquery
    const recentOrders: any[] = await prisma.$queryRawUnsafe(`
      SELECT o."id", o."orderNumber", o."total", o."status"::text AS "status",
             o."createdAt",
             COUNT(oi.id)::int AS "itemCount"
      FROM "Order" o
      LEFT JOIN "OrderItem" oi ON oi."orderId" = o."id"
      WHERE o."builderId" = $1
        AND o."status"::text IN ('DELIVERED', 'COMPLETE')
      GROUP BY o."id", o."orderNumber", o."total", o."status", o."createdAt"
      ORDER BY o."createdAt" DESC
      LIMIT 5
    `, builderId)

    // Get assigned sales rep / account manager
    // SECURITY: Only return minimal staff info to builders (name + title only)
    const accountRep: any[] = await prisma.$queryRawUnsafe(`
      SELECT s."firstName", s."lastName", s."title"
      FROM "Staff" s
      WHERE s."role"::text = 'SALES_REP' AND s."active" = true
      ORDER BY s."firstName" ASC
      LIMIT 1
    `)

    // Recent payments
    const recentPayments: any[] = await prisma.$queryRawUnsafe(`
      SELECT p."id", p."amount", p."method"::text AS "method", p."reference",
             p."receivedAt", p."notes",
             i."invoiceNumber"
      FROM "Payment" p
      JOIN "Invoice" i ON i."id" = p."invoiceId"
      WHERE i."builderId" = $1
      ORDER BY p."receivedAt" DESC
      LIMIT 5
    `, builderId)

    const inv = invoiceSummary[0] || {}
    const ord = orderSummary[0] || {}

    return NextResponse.json({
      account: {
        companyName: builder.companyName,
        contactName: builder.contactName,
        status: builder.status,
        paymentTerm: builder.paymentTerm,
        creditLimit: Number(builder.creditLimit) || 0,
        accountBalance: Number(builder.accountBalance) || 0,
        creditAvailable: (Number(builder.creditLimit) || 0) - (Number(builder.accountBalance) || 0),
      },
      invoices: {
        totalOutstanding: Number(inv.totalOutstanding) || 0,
        overdueAmount: Number(inv.overdueAmount) || 0,
        overdueCount: inv.overdueCount || 0,
        openInvoiceCount: inv.openInvoiceCount || 0,
        paidLast30Days: Number(inv.paidLast30Days) || 0,
      },
      orders: {
        totalOrders: ord.totalOrders || 0,
        activeOrders: ord.activeOrders || 0,
        lifetimeValue: Number(ord.lifetimeValue) || 0,
        last30DaysValue: Number(ord.last30DaysValue) || 0,
      },
      upcomingDeliveries: upcomingDeliveries.map(d => ({
        ...d,
        total: Number(d.total),
      })),
      recentCompletedOrders: recentOrders.map(o => ({
        ...o,
        total: Number(o.total),
      })),
      accountRep: accountRep[0] || null,
      recentPayments: recentPayments.map(p => ({
        ...p,
        amount: Number(p.amount),
      })),
    })
  } catch (error: any) {
    console.error('Error fetching account health:', error)
    return NextResponse.json({ error: 'Failed to load account data' }, { status: 500 })
  }
}
