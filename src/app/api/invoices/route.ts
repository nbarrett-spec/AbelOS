export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { logger, getRequestId } from '@/lib/logger'

/**
 * GET /api/invoices — List invoices for the current builder with payment history
 */
export async function GET(request: NextRequest) {
  const requestId = getRequestId(request)
  try {
    const session = await getSession()

    if (!session || !session.builderId) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const builderId = session.builderId

    // Get all invoices for this builder
    const invoices: any[] = await prisma.$queryRawUnsafe(
      `SELECT
        i."id",
        i."invoiceNumber",
        i."status"::text AS "status",
        i."total",
        i."amountPaid",
        (i."total" - COALESCE(i."amountPaid",0))::float AS "balanceDue",
        i."subtotal",
        i."taxAmount",
        i."paymentTerm"::text AS "paymentTerm",
        i."dueDate",
        i."issuedAt",
        i."paidAt",
        i."createdAt",
        o."orderNumber",
        o."id" AS "orderId"
      FROM "Invoice" i
      LEFT JOIN "Order" o ON o."id" = i."orderId"
      WHERE i."builderId" = $1
      ORDER BY i."createdAt" DESC`,
      builderId
    )

    // For each invoice, get payment records
    const invoicesWithPayments = await Promise.all(
      invoices.map(async (invoice) => {
        try {
          const payments: any[] = await prisma.$queryRawUnsafe(
            `SELECT "id", "amount", "method"::text AS "method", "reference", "receivedAt", "notes"
             FROM "Payment"
             WHERE "invoiceId" = $1
             ORDER BY "receivedAt" DESC`,
            invoice.id
          )

          return {
            id: invoice.id,
            invoiceNumber: invoice.invoiceNumber,
            status: invoice.status,
            total: Number(invoice.total) || 0,
            amountPaid: Number(invoice.amountPaid) || 0,
            balanceDue: Number(invoice.balanceDue) || 0,
            subtotal: Number(invoice.subtotal) || 0,
            taxAmount: Number(invoice.taxAmount) || 0,
            paymentTerm: invoice.paymentTerm,
            dueDate: invoice.dueDate,
            issuedAt: invoice.issuedAt,
            paidAt: invoice.paidAt,
            createdAt: invoice.createdAt,
            orderNumber: invoice.orderNumber,
            orderId: invoice.orderId,
            payments: payments.map(p => ({
              id: p.id,
              amount: Number(p.amount) || 0,
              paymentMethod: p.method,
              paymentDate: p.receivedAt,
              reference: p.reference,
              notes: p.notes,
            })),
          }
        } catch {
          return {
            id: invoice.id,
            invoiceNumber: invoice.invoiceNumber,
            status: invoice.status,
            total: Number(invoice.total) || 0,
            amountPaid: Number(invoice.amountPaid) || 0,
            balanceDue: Number(invoice.balanceDue) || 0,
            subtotal: Number(invoice.subtotal) || 0,
            taxAmount: Number(invoice.taxAmount) || 0,
            paymentTerm: invoice.paymentTerm,
            dueDate: invoice.dueDate,
            issuedAt: invoice.issuedAt,
            paidAt: invoice.paidAt,
            createdAt: invoice.createdAt,
            orderNumber: invoice.orderNumber,
            orderId: invoice.orderId,
            payments: [],
          }
        }
      })
    )

    // Compute summary stats
    let totalOutstanding = 0
    let overdueAmount = 0
    let overdueCount = 0
    let openCount = 0
    let paidThisMonth = 0
    const now = new Date()
    const currentMonth = now.getMonth()
    const currentYear = now.getFullYear()

    invoicesWithPayments.forEach(inv => {
      const balance = inv.balanceDue > 0 ? inv.balanceDue : (inv.total - inv.amountPaid)
      if (balance > 0 && !['PAID', 'VOID', 'WRITE_OFF'].includes(inv.status)) {
        totalOutstanding += balance
        openCount++
      }
      if (inv.status === 'OVERDUE') {
        overdueAmount += balance > 0 ? balance : 0
        overdueCount++
      }
      if (inv.paidAt) {
        const paidDate = new Date(inv.paidAt)
        if (paidDate.getMonth() === currentMonth && paidDate.getFullYear() === currentYear) {
          paidThisMonth += inv.amountPaid
        }
      }
    })

    return NextResponse.json({
      success: true,
      invoices: invoicesWithPayments,
      summary: {
        totalOutstanding,
        overdueAmount,
        overdueCount,
        openCount,
        paidThisMonth,
        totalInvoices: invoicesWithPayments.length,
      },
    })
  } catch (error) {
    logger.error('invoices_fetch_error', error, { requestId })
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
