import { prisma } from '@/lib/prisma'
import { notifyPaymentReceived } from '@/lib/notifications'

// ──────────────────────────────────────────────────────────────────────────
// Pure business-logic processor for Stripe webhook events. Extracted from
// the route handler so the DLQ retry worker can replay stored payloads
// without re-verifying a signature (the signature was already verified
// at original receipt).
//
// All DB writes that could fail belong here. Anything that's "best effort"
// (audit rows, follow-up notifications) is wrapped in its own try/catch so
// a flaky side-channel doesn't flip a successful payment to FAILED and
// trigger a false-positive retry.
// ──────────────────────────────────────────────────────────────────────────
export async function processStripeEvent(event: any): Promise<void> {
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

      // console.log(`Payment received: Invoice ${invoiceNumber}, Amount: $${amountPaid}`)

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

      // INSERT a Payment row so the AR ledger stays truthful. Idempotent on
      // the Stripe session id — replay-safe if a webhook retries.
      try {
        await prisma.$queryRawUnsafe(`
          INSERT INTO "Payment" (
            id, "invoiceId", amount, method, reference, "referenceNumber",
            "receivedAt", "builderId", status, notes, "createdAt"
          )
          SELECT
            gen_random_uuid()::text,
            $1,
            $2,
            'CREDIT_CARD'::"PaymentMethod",
            $3,
            $3,
            NOW(),
            $4,
            'RECEIVED',
            $5,
            NOW()
          WHERE NOT EXISTS (
            SELECT 1 FROM "Payment"
            WHERE reference = $3 OR "referenceNumber" = $3
          )
        `,
          invoiceId,
          amountPaid,
          session.payment_intent || session.id,
          builderId || null,
          `Stripe checkout.session.completed — ${invoiceNumber || invoiceId}`
        )
      } catch { /* Payment INSERT is best-effort; invoice cache is source of truth */ }

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
        const bId = invData[0]?.builderId
        if (bId) {
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
          INSERT INTO "AuditLog" (id, "staffId", action, entity, "entityId", details, severity, "createdAt")
          VALUES (
            gen_random_uuid()::text,
            NULL,
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
        // console.log(`Checkout session expired for invoice ${invoiceId}`)
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

      try {
        await prisma.$queryRawUnsafe(`
          INSERT INTO "AuditLog" (id, "staffId", action, entity, "entityId", details, severity, "createdAt")
          VALUES (
            gen_random_uuid()::text,
            NULL,
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
      // console.log(`Unhandled Stripe event type: ${event.type}`)
  }
}
