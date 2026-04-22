export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { fireAutomationEvent } from '@/lib/automation-executor'
import { audit } from '@/lib/audit'

export async function POST(request: NextRequest) {
  try {
    const session = await getSession()

    if (!session || !session.builderId) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    audit(request, 'CREATE', 'BatchPayment', undefined, {}, 'WARN').catch(() => {});

    const builderId = session.builderId
    const body = await request.json()

    const { invoiceIds, paymentMethod, reference } = body

    if (!Array.isArray(invoiceIds) || invoiceIds.length === 0) {
      return NextResponse.json(
        { error: 'Invalid invoiceIds' },
        { status: 400 }
      )
    }

    if (!paymentMethod || !['ACH', 'CHECK', 'CREDIT_CARD', 'WIRE'].includes(paymentMethod)) {
      return NextResponse.json(
        { error: 'Invalid payment method' },
        { status: 400 }
      )
    }

    // Verify all invoices belong to this builder
    const invoices: any[] = await prisma.$queryRawUnsafe(
      `SELECT "id", ("total" - COALESCE("amountPaid",0))::float AS "balanceDue", "total", "amountPaid", "status"::text FROM "Invoice" WHERE "id" = ANY($1::text[]) AND "builderId" = $2`,
      invoiceIds,
      builderId
    )

    if (invoices.length !== invoiceIds.length) {
      return NextResponse.json(
        { error: 'Some invoices not found or do not belong to your account' },
        { status: 403 }
      )
    }

    // Verify all invoices are not already paid
    const unpaidInvoices = invoices.filter(inv => inv.status !== 'PAID')
    if (unpaidInvoices.length === 0) {
      return NextResponse.json(
        { error: 'All selected invoices are already paid' },
        { status: 400 }
      )
    }

    let totalAmount = 0
    let paidCount = 0

    // Create payment records and update invoice status for each invoice
    for (const invoice of unpaidInvoices) {
      const amount = invoice.balanceDue > 0 ? invoice.balanceDue : invoice.total - invoice.amountPaid

      // Create Payment record
      await prisma.$executeRawUnsafe(
        `INSERT INTO "Payment" ("id", "invoiceId", "amount", "method", "reference", "receivedAt", "createdAt")
         VALUES ($1, $2, $3, $4, $5, NOW(), NOW())`,
        `pay_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`,
        invoice.id,
        amount,
        paymentMethod,
        reference || null
      )

      // Update Invoice status to PAID and set paidAt
      await prisma.$executeRawUnsafe(
        `UPDATE "Invoice" SET "status" = 'PAID', "paidAt" = NOW(), "amountPaid" = $1, "balanceDue" = 0, "updatedAt" = NOW() WHERE "id" = $2`,
        invoice.total,
        invoice.id
      )

      // Fire automation event (non-blocking)
      fireAutomationEvent('INVOICE_PAID', invoice.id).catch(e => console.warn('[Automation] event fire failed:', e))

      totalAmount += amount
      paidCount++
    }

    return NextResponse.json({
      success: true,
      paid: paidCount,
      totalAmount,
    })
  } catch (error) {
    console.error('Failed to process batch payment:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
