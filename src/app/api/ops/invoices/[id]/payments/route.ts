export const dynamic = 'force-dynamic'
import { prisma } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'
import { audit } from '@/lib/audit'

interface RouteParams {
  params: { id: string }
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const { id } = params
    const body = await request.json()
    const { amount, method, reference, notes } = body

    if (!amount || !method) {
      return NextResponse.json(
        { error: 'Missing required fields: amount, method' },
        { status: 400 }
      )
    }

    // Get the invoice
    const invRows: any[] = await prisma.$queryRawUnsafe(`
      SELECT "id", "total", "amountPaid", "balanceDue", "status"::text AS "status"
      FROM "Invoice" WHERE "id" = $1
    `, id)

    if (invRows.length === 0) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })
    }

    const invoice = invRows[0]

    // Create payment + update invoice atomically
    const payId = `pay_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`

    // Calculate new amounts
    const newAmountPaid = Number(invoice.amountPaid || 0) + Number(amount)
    const newBalanceDue = Number(invoice.total) - newAmountPaid

    // Determine new status
    let newStatus = invoice.status
    if (newBalanceDue <= 0) {
      newStatus = 'PAID'
    } else if (newAmountPaid > 0) {
      newStatus = 'PARTIALLY_PAID'
    }

    const paidAtClause = newStatus === 'PAID' ? ', "paidAt" = NOW()' : ''

    await prisma.$transaction(async (tx) => {
      // Create the payment
      await tx.$executeRawUnsafe(`
        INSERT INTO "Payment" ("id", "invoiceId", "amount", "method", "reference", "notes", "receivedAt")
        VALUES ($1, $2, $3, '${method}'::"PaymentMethod", $4, $5, NOW())
      `, payId, id, amount, reference || null, notes || null)

      // Update invoice
      await tx.$executeRawUnsafe(`
        UPDATE "Invoice"
        SET "amountPaid" = $1, "balanceDue" = $2,
            "status" = '${newStatus}'::"InvoiceStatus",
            "updatedAt" = NOW() ${paidAtClause}
        WHERE "id" = $3
      `, newAmountPaid, Math.max(0, newBalanceDue), id)
    })

    // Fetch updated invoice with items and payments
    const updatedRows: any[] = await prisma.$queryRawUnsafe(`
      SELECT i.*, b."companyName" AS "builderName"
      FROM "Invoice" i
      LEFT JOIN "Builder" b ON b."id" = i."builderId"
      WHERE i."id" = $1
    `, id)

    const items: any[] = await prisma.$queryRawUnsafe(`
      SELECT * FROM "InvoiceItem" WHERE "invoiceId" = $1
    `, id)

    const payments: any[] = await prisma.$queryRawUnsafe(`
      SELECT "id", "invoiceId", "amount", "method"::text AS "method", "reference", "receivedAt", "notes"
      FROM "Payment" WHERE "invoiceId" = $1 ORDER BY "receivedAt" DESC
    `, id)

    const payment = payments.find(p => p.id === payId)

    await audit(request, 'RECORD_PAYMENT', 'Invoice', id, { amount, method })

    return NextResponse.json({
      payment,
      invoice: {
        ...updatedRows[0],
        builderName: updatedRows[0]?.builderName || 'Unknown Builder',
        items,
        payments,
      },
    }, { status: 201 })
  } catch (error) {
    console.error('POST /api/ops/invoices/[id]/payments error:', error)
    return NextResponse.json({ error: 'Failed to record payment' }, { status: 500 })
  }
}
