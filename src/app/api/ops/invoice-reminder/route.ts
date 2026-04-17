export const dynamic = 'force-dynamic'
import { prisma } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'
import { safeJson } from '@/lib/safe-json'
import { sendBuilderNotification } from '@/lib/notifications'
import { audit } from '@/lib/audit'

// ──────────────────────────────────────────────────────────────────
// SEND INVOICE PAYMENT REMINDER TO BUILDER
// ──────────────────────────────────────────────────────────────────
// POST { invoiceId, builderName }
// Sends email reminder to builder for payment on overdue/upcoming invoice
// ──────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    // Audit log
    audit(request, 'CREATE', 'InvoiceReminder', undefined, { method: 'POST' }).catch(() => {})

    const body = await request.json()
    const { invoiceId, builderName } = body

    if (!invoiceId || !builderName) {
      return NextResponse.json(
        { error: 'invoiceId and builderName are required' },
        { status: 400 }
      )
    }

    // Fetch invoice details
    const invoice: any = await prisma.$queryRawUnsafe(`
      SELECT
        i."id",
        i."invoiceNumber",
        i."builderId",
        i."total",
        i."balanceDue",
        i."dueDate",
        i."status"::text AS "status",
        b."email" AS "builderEmail"
      FROM "Invoice" i
      LEFT JOIN "Builder" b ON i."builderId" = b."id"
      WHERE i."id" = $1
    `, invoiceId)

    if (!invoice || invoice.length === 0) {
      return NextResponse.json(
        { error: 'Invoice not found' },
        { status: 404 }
      )
    }

    const inv = invoice[0]
    const dueDate = new Date(inv.dueDate).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    })

    // Prepare notification event
    const notificationEvent = {
      type: 'INVOICE_REMINDER',
      builderId: inv.builderId,
      title: `Payment Reminder: Invoice ${inv.invoiceNumber}`,
      message: `This is a friendly reminder that invoice ${inv.invoiceNumber} for $${inv.balanceDue.toFixed(2)} is due on ${dueDate}.`,
      email: inv.builderEmail ? {
        to: inv.builderEmail,
        subject: `Payment Reminder: Invoice ${inv.invoiceNumber} Due ${dueDate}`,
        html: `
          <h2>Payment Reminder</h2>
          <p>Hi ${builderName},</p>
          <p>This is a friendly reminder that invoice <strong>${inv.invoiceNumber}</strong> is due on <strong>${dueDate}</strong>.</p>
          <p style="margin: 20px 0;">
            <strong>Amount Due:</strong> $${inv.balanceDue.toFixed(2)}<br>
            <strong>Invoice Number:</strong> ${inv.invoiceNumber}<br>
            <strong>Status:</strong> ${inv.status}
          </p>
          <p>Please submit payment at your earliest convenience. If you have any questions, please contact us.</p>
          <p>Thank you for your business!</p>
        `,
      } : undefined,
      link: `/ops/invoices/${invoiceId}`,
    }

    // Send notification
    await sendBuilderNotification(notificationEvent as any)

    return safeJson({
      success: true,
      message: `Reminder sent to ${builderName}`,
      invoiceNumber: inv.invoiceNumber,
      builderName,
    })
  } catch (error: any) {
    console.error('[Invoice Reminder] Error:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to send reminder' },
      { status: 500 }
    )
  }
}
