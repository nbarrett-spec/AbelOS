export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verifyWebhookSignature } from '@/lib/stripe'
import { notifyPaymentReceived } from '@/lib/notifications'

// ──────────────────────────────────────────────────────────────────────────
// POST /api/webhooks/stripe — Handle Stripe webhook events
// ──────────────────────────────────────────────────────────────────────────
export async function POST(request: NextRequest) {
  const body = await request.text()
  const sig = request.headers.get('stripe-signature')

  if (!sig) {
    return NextResponse.json({ error: 'Missing stripe-signature header' }, { status: 400 })
  }

  // Verify webhook signature
  try {
    const valid = await verifyWebhookSignature(body, sig)
    if (!valid) {
      console.error('Stripe webhook signature verification failed')
      return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
    }
  } catch (e: any) {
    // If webhook secret isn't configured, log but still process in dev
    console.warn('Webhook verification error:', e.message)
    if (process.env.NODE_ENV === 'production') {
      return NextResponse.json({ error: 'Webhook verification failed' }, { status: 400 })
    }
  }

  const event = JSON.parse(body)

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object
        const invoiceId = session.metadata?.invoiceId
        const invoiceNumber = session.metadata?.invoiceNumber
        const builderId = session.metadata?.builderId
        const amountPaid = session.amount_total ? session.amount_total / 100 : 0

        if (!invoiceId) {
          console.warn('Stripe checkout completed but no invoiceId in metadata')
          break
        }

        console.log(`Payment received: Invoice ${invoiceNumber}, Amount: $${amountPaid}`)

        // Update invoice: add payment amount, update status
        await prisma.$queryRawUnsafe(`
          UPDATE "Invoice"
          SET "amountPaid" = LEAST("amountPaid" + $1, total),
              "balanceDue" = GREATEST("balanceDue" - $1, 0),
              status = CASE
                WHEN "balanceDue" - $1 <= 0 THEN 'PAID'::"InvoiceStatus"
                ELSE 'PARTIALLY_PAID'::"InvoiceStatus"
              END,
              "paidAt" = CASE
                WHEN "balanceDue" - $1 <= 0 THEN NOW()
                ELSE "paidAt"
              END,
              "updatedAt" = NOW()
          WHERE id = $2
        `, amountPaid, invoiceId)

        // Update the related order payment status if exists
        try {
          await prisma.$queryRawUnsafe(`
            UPDATE "Order"
            SET "paymentStatus" = CASE
                  WHEN (SELECT "balanceDue" FROM "Invoice" WHERE id = $1) <= 0 THEN 'PAID'::"PaymentStatus"
                  ELSE 'INVOICED'::"PaymentStatus"
                END,
                "paidAt" = CASE
                  WHEN (SELECT "balanceDue" FROM "Invoice" WHERE id = $1) <= 0 THEN NOW()
                  ELSE "paidAt"
                END,
                "updatedAt" = NOW()
            WHERE id = (SELECT "orderId" FROM "Invoice" WHERE id = $1)
              AND (SELECT "orderId" FROM "Invoice" WHERE id = $1) IS NOT NULL
          `, invoiceId)
        } catch { /* Order update is best-effort */ }

        // Send payment confirmation notification to builder
        try {
          const invData: any[] = await prisma.$queryRawUnsafe(
            `SELECT "balanceDue", "builderId" FROM "Invoice" WHERE id = $1`, invoiceId
          )
          const remaining = Number(invData[0]?.balanceDue || 0)
          const bId = invData[0]?.builderId
          if (bId) {
            // Look up builder email for the notification
            const bRows: any[] = await prisma.$queryRawUnsafe(
              `SELECT email FROM "Builder" WHERE id = $1`, bId
            )
            if (bRows.length > 0) {
              notifyPaymentReceived(bId, bRows[0].email, amountPaid, 'Credit Card', invoiceNumber).catch(() => {})
            }
          }
        } catch { /* Notification is best-effort */ }

        // Log the payment in audit trail
        try {
          await prisma.$queryRawUnsafe(`
            INSERT INTO "AuditLog" (id, "staffName", action, entity, "entityId", details, severity, "createdAt")
            VALUES (
              gen_random_uuid()::text,
              'Stripe Webhook',
              'PAYMENT_RECEIVED',
              'Invoice',
              $1,
              $2::jsonb,
              'INFO',
              NOW()
            )
          `, invoiceId, JSON.stringify({
            invoiceNumber,
            builderId,
            amount: amountPaid,
            stripeSessionId: session.id,
            paymentStatus: session.payment_status,
          }))
        } catch { /* Audit logging is best-effort */ }

        break
      }

      case 'checkout.session.expired': {
        const session = event.data.object
        const invoiceId = session.metadata?.invoiceId
        if (invoiceId) {
          console.log(`Checkout session expired for invoice ${invoiceId}`)
          // Clear the stripe session reference so builder can try again
          try {
            await prisma.$queryRawUnsafe(`
              UPDATE "Invoice"
              SET "stripeSessionId" = NULL, "stripePaymentUrl" = NULL, "updatedAt" = NOW()
              WHERE id = $1
            `, invoiceId)
          } catch { /* Column may not exist */ }
        }
        break
      }

      case 'payment_intent.payment_failed': {
        const pi = event.data.object
        const invoiceId = pi.metadata?.invoiceId
        console.warn(`Payment failed for invoice ${invoiceId}:`, pi.last_payment_error?.message)

        // Log the failure
        try {
          await prisma.$queryRawUnsafe(`
            INSERT INTO "AuditLog" (id, "staffName", action, entity, "entityId", details, severity, "createdAt")
            VALUES (
              gen_random_uuid()::text,
              'Stripe Webhook',
              'PAYMENT_FAILED',
              'Invoice',
              $1,
              $2::jsonb,
              'WARN',
              NOW()
            )
          `, invoiceId || 'unknown', JSON.stringify({
            error: pi.last_payment_error?.message,
            stripePaymentIntentId: pi.id,
          }))
        } catch { /* Best-effort */ }
        break
      }

      default:
        console.log(`Unhandled Stripe event type: ${event.type}`)
    }

    return NextResponse.json({ received: true })
  } catch (error: any) {
    console.error('Webhook processing error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
