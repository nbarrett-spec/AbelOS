export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verifyToken } from '@/lib/auth'

// GET /api/account/statement — Builder account statement with full transaction history
export async function GET(request: NextRequest) {
  const token = request.cookies.get('abel_session')?.value
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let session: any
  try { session = await verifyToken(token) } catch {
    return NextResponse.json({ error: 'Invalid session' }, { status: 401 })
  }

  const builderId = session.builderId
  const { searchParams } = new URL(request.url)
  const months = parseInt(searchParams.get('months') || '6')
  const cutoff = new Date()
  cutoff.setMonth(cutoff.getMonth() - months)

  try {
    // Account summary
    const summaryRows: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        b."companyName", b."contactName", b.email, b."accountBalance",
        b."creditLimit", b."paymentTerm",
        (SELECT COALESCE(SUM(total)::numeric, 0) FROM "Order" WHERE "builderId" = $1) as "totalOrdered",
        (SELECT COALESCE(SUM(total)::numeric, 0) FROM "Invoice" WHERE "builderId" = $1 AND "status"::text NOT IN ('VOID', 'WRITE_OFF', 'DRAFT')) as "totalInvoiced",
        (SELECT COALESCE(SUM("amountPaid")::numeric, 0) FROM "Invoice" WHERE "builderId" = $1) as "totalPaid",
        (SELECT COALESCE(SUM("balanceDue")::numeric, 0) FROM "Invoice" WHERE "builderId" = $1 AND "status"::text IN ('ISSUED', 'SENT', 'PARTIALLY_PAID', 'OVERDUE')) as "outstandingBalance",
        (SELECT COUNT(*)::int FROM "Order" WHERE "builderId" = $1) as "orderCount",
        (SELECT COUNT(*)::int FROM "Invoice" WHERE "builderId" = $1 AND "status"::text = 'OVERDUE') as "overdueCount"
      FROM "Builder" b WHERE b.id = $1
    `, builderId)

    // Transaction history: orders, invoices, payments combined
    const orders: any[] = await prisma.$queryRawUnsafe(`
      SELECT 'order' as "txType", id, "orderNumber" as reference,
             status::text as status, total as amount,
             "createdAt" as date, "poNumber" as detail
      FROM "Order"
      WHERE "builderId" = $1 AND "createdAt" >= $2
      ORDER BY "createdAt" DESC
    `, builderId, cutoff)

    const invoices: any[] = await prisma.$queryRawUnsafe(`
      SELECT 'invoice' as "txType", id, "invoiceNumber" as reference,
             status::text as status, total as amount,
             "issuedAt" as date, "paymentTerm" as detail,
             "balanceDue", "amountPaid", "dueDate"
      FROM "Invoice"
      WHERE "builderId" = $1 AND "createdAt" >= $2
        AND "status"::text NOT IN ('DRAFT', 'VOID', 'WRITE_OFF')
      ORDER BY "createdAt" DESC
    `, builderId, cutoff)

    // Payments from InvoicePayment table if it exists
    let payments: any[] = []
    try {
      payments = await prisma.$queryRawUnsafe(`
        SELECT 'payment' as "txType", ip.id, ip.reference,
               'PAYMENT' as status, ip.amount,
               ip."paymentDate" as date, ip.method as detail
        FROM "InvoicePayment" ip
        JOIN "Invoice" i ON ip."invoiceId" = i.id
        WHERE i."builderId" = $1 AND ip."paymentDate" >= $2
        ORDER BY ip."paymentDate" DESC
      `, builderId, cutoff)
    } catch {
      // Table may not exist
    }

    // Combine and sort by date desc
    const transactions = [...orders, ...invoices, ...payments]
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())

    // Monthly totals for chart
    const monthlyRows: any[] = await prisma.$queryRawUnsafe(`
      SELECT to_char(date_trunc('month', "createdAt"), 'YYYY-MM') as month,
             COALESCE(SUM(total)::numeric, 0) as total,
             COUNT(*)::int as count
      FROM "Order"
      WHERE "builderId" = $1 AND "createdAt" >= $2
      GROUP BY date_trunc('month', "createdAt")
      ORDER BY month
    `, builderId, cutoff)

    return NextResponse.json({
      summary: summaryRows[0] || {},
      transactions,
      monthlyTotals: monthlyRows,
    })
  } catch (error: any) {
    console.error('Statement error:', error)
    return NextResponse.json({ error: 'Failed to load statement' }, { status: 500 })
  }
}
