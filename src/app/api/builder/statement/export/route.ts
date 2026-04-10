export const dynamic = 'force-dynamic'
import { prisma } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'

interface LedgerEntry {
  date: string
  type: 'INVOICE' | 'PAYMENT'
  reference: string
  description: string
  charges: number
  payments: number
  balance: number
}

// GET /api/builder/statement/export
export async function GET(request: NextRequest) {
  try {
    const session = await getSession()
    if (!session || !session.builderId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const url = new URL(request.url)
    const startDate = url.searchParams.get('startDate')
    const endDate = url.searchParams.get('endDate')
    const format = (url.searchParams.get('format') || 'json') as 'json' | 'csv'

    if (!startDate || !endDate) {
      return NextResponse.json(
        { error: 'startDate and endDate are required' },
        { status: 400 }
      )
    }

    const builderId = session.builderId

    // Get all invoices for builder in date range
    const invoices = await prisma.$queryRawUnsafe<
      Array<{
        id: string
        invoiceNumber: string
        total: number
        issuedAt: string
        description: string
      }>
    >(
      `SELECT i.id, i."invoiceNumber", i.total, i."issuedAt",
              CONCAT('Invoice ', i."invoiceNumber") as description
       FROM "Invoice" i
       WHERE i."builderId" = $1
       AND DATE(i."issuedAt") >= $2
       AND DATE(i."issuedAt") <= $3
       ORDER BY i."issuedAt" ASC`,
      builderId,
      startDate,
      endDate
    )

    // Get all payments for builder in date range
    const payments = await prisma.$queryRawUnsafe<
      Array<{
        id: string
        amount: number
        receivedAt: string
        reference: string | null
        invoiceNumber: string
      }>
    >(
      `SELECT p.id, p.amount, p."receivedAt", p.reference,
              CONCAT('Payment - ', i."invoiceNumber") as "invoiceNumber"
       FROM "Payment" p
       JOIN "Invoice" i ON p."invoiceId" = i.id
       WHERE i."builderId" = $1
       AND DATE(p."receivedAt") >= $2
       AND DATE(p."receivedAt") <= $3
       ORDER BY p."receivedAt" ASC`,
      builderId,
      startDate,
      endDate
    )

    // Build ledger
    const ledger: LedgerEntry[] = []
    let runningBalance = 0

    // Get opening balance (sum of all invoices before startDate minus all payments before startDate)
    const openingData = await prisma.$queryRawUnsafe<
      Array<{
        invoiceTotal: string
        paymentTotal: string
      }>
    >(
      `SELECT
         COALESCE(SUM(i.total), 0)::text as "invoiceTotal",
         COALESCE(SUM(p.amount), 0)::text as "paymentTotal"
       FROM "Invoice" i
       LEFT JOIN "Payment" p ON i.id = p."invoiceId"
       WHERE i."builderId" = $1
       AND DATE(i."issuedAt") < $2`,
      builderId,
      startDate
    )

    if (openingData && openingData.length > 0) {
      const invoiceSum = parseFloat(openingData[0].invoiceTotal || '0')
      const paymentSum = parseFloat(openingData[0].paymentTotal || '0')
      runningBalance = invoiceSum - paymentSum
    }

    // Combine and sort all transactions
    const allTransactions = [
      ...invoices.map((inv) => ({
        date: new Date(inv.issuedAt).toISOString().split('T')[0],
        type: 'INVOICE' as const,
        id: inv.id,
        invoiceNumber: inv.invoiceNumber,
        description: inv.description,
        amount: inv.total,
      })),
      ...payments.map((pmt) => ({
        date: new Date(pmt.receivedAt).toISOString().split('T')[0],
        type: 'PAYMENT' as const,
        id: pmt.id,
        reference: pmt.reference,
        invoiceNumber: pmt.invoiceNumber,
        description: pmt.invoiceNumber,
        amount: pmt.amount,
      })),
    ].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())

    // Build ledger with running balance
    allTransactions.forEach((txn) => {
      if (txn.type === 'INVOICE') {
        runningBalance += txn.amount
        ledger.push({
          date: txn.date,
          type: 'INVOICE',
          reference: txn.invoiceNumber,
          description: txn.description,
          charges: txn.amount,
          payments: 0,
          balance: runningBalance,
        })
      } else {
        runningBalance -= txn.amount
        ledger.push({
          date: txn.date,
          type: 'PAYMENT',
          reference: txn.reference || txn.invoiceNumber,
          description: txn.description,
          charges: 0,
          payments: txn.amount,
          balance: runningBalance,
        })
      }
    })

    // Get builder info for header
    const builderInfo = await prisma.$queryRawUnsafe<
      Array<{
        companyName: string
        contactName: string
        email: string
        phone: string | null
        address: string | null
        city: string | null
        state: string | null
      }>
    >(
      `SELECT "companyName", "contactName", email, phone, address, city, state
       FROM "Builder"
       WHERE id = $1`,
      builderId
    )

    const builder = builderInfo && builderInfo.length > 0 ? builderInfo[0] : null

    if (format === 'csv') {
      // Generate CSV
      const headers = [
        'Date',
        'Type',
        'Reference',
        'Description',
        'Charges',
        'Payments',
        'Balance',
      ]
      const rows = ledger.map((entry) => [
        entry.date,
        entry.type,
        entry.reference,
        entry.description,
        entry.charges.toFixed(2),
        entry.payments.toFixed(2),
        entry.balance.toFixed(2),
      ])

      const totalCharges = ledger.reduce((sum, e) => sum + e.charges, 0)
      const totalPayments = ledger.reduce((sum, e) => sum + e.payments, 0)

      rows.push(['', '', '', 'TOTALS', totalCharges.toFixed(2), totalPayments.toFixed(2), runningBalance.toFixed(2)])

      const csvContent = [headers, ...rows]
        .map((row) =>
          row
            .map((cell) =>
              typeof cell === 'string' && cell.includes(',')
                ? `"${cell.replace(/"/g, '""')}"`
                : cell
            )
            .join(',')
        )
        .join('\n')

      return new NextResponse(csvContent, {
        headers: {
          'Content-Type': 'text/csv',
          'Content-Disposition': `attachment; filename="statement-${startDate}-to-${endDate}.csv"`,
        },
      })
    }

    // Return JSON
    const totalCharges = ledger.reduce((sum, e) => sum + e.charges, 0)
    const totalPayments = ledger.reduce((sum, e) => sum + e.payments, 0)

    return NextResponse.json({
      success: true,
      builder,
      dateRange: { startDate, endDate },
      ledger,
      summary: {
        totalCharges,
        totalPayments,
        balanceDue: runningBalance,
      },
    })
  } catch (error) {
    console.error('Error exporting statement:', error)
    return NextResponse.json(
      { error: 'Failed to export statement' },
      { status: 500 }
    )
  }
}
