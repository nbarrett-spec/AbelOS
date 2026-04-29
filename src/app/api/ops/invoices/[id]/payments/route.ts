export const dynamic = 'force-dynamic'
import { prisma } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'
import { audit } from '@/lib/audit'
import { requireValidTransition, transitionErrorResponse } from '@/lib/status-guard'

interface RouteParams {
  params: { id: string }
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const { id } = params
    const body = await request.json()
    const { amount, method, reference, notes, receivedAt } = body

    if (!amount || !method) {
      return NextResponse.json(
        { error: 'Missing required fields: amount, method' },
        { status: 400 }
      )
    }

    // Optional client-supplied receivedAt — backwards compatible: if absent
    // or empty, the SQL COALESCE falls back to NOW() so existing callers
    // (and any non-modal path) continue to work unchanged. Validate that
    // anything we DO accept is a parseable timestamp; reject garbage rather
    // than silently storing it.
    let receivedAtParam: string | null = null
    if (receivedAt !== undefined && receivedAt !== null && receivedAt !== '') {
      const d = new Date(receivedAt)
      if (Number.isNaN(d.getTime())) {
        return NextResponse.json(
          { error: 'Invalid receivedAt timestamp' },
          { status: 400 }
        )
      }
      receivedAtParam = d.toISOString()
    }

    // Get the invoice
    const invRows: any[] = await prisma.$queryRawUnsafe(`
      SELECT "id", "total", "amountPaid", ("total" - COALESCE("amountPaid",0))::float AS "balanceDue", "status"::text AS "status"
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

    // Guard: if we're changing status, enforce the InvoiceStatus state machine.
    if (newStatus !== invoice.status) {
      try {
        requireValidTransition('invoice', invoice.status, newStatus)
      } catch (e) {
        const res = transitionErrorResponse(e)
        if (res) return res
        throw e
      }
    }

    const paidAtClause = newStatus === 'PAID' ? ', "paidAt" = NOW()' : ''

    await prisma.$transaction(async (tx) => {
      // Create the payment. receivedAt: if the client supplied one, use it;
      // otherwise COALESCE falls back to NOW() preserving prior behavior.
      await tx.$executeRawUnsafe(`
        INSERT INTO "Payment" ("id", "invoiceId", "amount", "method", "reference", "notes", "receivedAt")
        VALUES ($1, $2, $3, '${method}'::"PaymentMethod", $4, $5, COALESCE($6::timestamp, NOW()))
      `, payId, id, amount, reference || null, notes || null, receivedAtParam)

      // Update invoice. Backfill issuedAt when the invoice first becomes
      // billable — a payment against a DRAFT implicitly issues it. Audit
      // 2026-04-24: many invoices reached PARTIALLY_PAID/PAID directly
      // without going through the ISSUED PATCH, leaving issuedAt NULL.
      await tx.$executeRawUnsafe(`
        UPDATE "Invoice"
        SET "amountPaid" = $1, "balanceDue" = $2,
            "status" = '${newStatus}'::"InvoiceStatus",
            "issuedAt" = COALESCE("issuedAt", NOW()),
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
