/**
 * Backorder notification fan-out (A-BIZ-6).
 *
 * When `reserveForOrder` lands at least one OrderItem on backorder, this
 * helper:
 *   1. Creates an InboxItem for the assigned PM / sales rep so it shows up
 *      in /ops/inbox alongside other action items.
 *   2. Optionally sends an email to the builder with the ETA. Gated behind
 *      `BACKORDER_BUILDER_EMAIL_ENABLED=true` so we can flip the channel
 *      on after we're sure the InboxItem path is clean.
 *
 * Never throws — every failure path is swallow-and-log because the order
 * has already committed by the time this runs. The InboxItem is a soft
 * signal, not a constraint on order acceptance.
 *
 * Lookup strategy for "who gets the InboxItem":
 *   - PM assigned to the Job (if a Job exists for the order) — most direct
 *     owner of fulfillment
 *   - Otherwise, leave assignedTo NULL so it lands in the unassigned
 *     queue (the existing inbox UX handles routing from there)
 *
 * The Builder relationship table doesn't carry a fixed sales rep on its
 * own — we don't fabricate one here. If/when a builder.salesRepId column
 * lands, plug it in below.
 */

import { prisma } from '@/lib/prisma'
import { sendEmail } from '@/lib/email'
import { logger } from '@/lib/logger'
import type { ReserveResult } from './reserve'

interface BackorderNotifyArgs {
  orderId: string
  orderNumber: string
  builderId: string
  builderEmail?: string | null
  builderName?: string | null
  reserveResult: ReserveResult
}

export async function notifyBackorder(args: BackorderNotifyArgs): Promise<void> {
  const { orderId, orderNumber, builderId, builderEmail, builderName, reserveResult } = args
  if (!reserveResult || reserveResult.backordered.length === 0) return

  // Aggregate the per-product shortfall + best-effort earliest ETA across all
  // backordered lines.
  const totalUnits = reserveResult.backordered.reduce((sum, b) => sum + (b.quantity || 0), 0)
  let earliestEta: Date | null = null
  let anyHasPo = false
  for (const b of reserveResult.backordered) {
    for (const oi of b.orderItems || []) {
      if (oi.fulfillingPoId) anyHasPo = true
      if (oi.expectedDate) {
        if (!earliestEta || oi.expectedDate < earliestEta) earliestEta = oi.expectedDate
      }
    }
  }

  const productLabel = reserveResult.backordered.length === 1
    ? '1 product'
    : `${reserveResult.backordered.length} products`
  const etaLabel = earliestEta
    ? `ETA ${earliestEta.toISOString().slice(0, 10)}`
    : (anyHasPo ? 'ETA pending vendor confirm' : 'no incoming PO yet')

  // ── Resolve assignee — PM on the Job for this order, if any ───────
  let assignedTo: string | null = null
  try {
    const rows: any[] = await prisma.$queryRawUnsafe(
      `SELECT j."assignedPmId" AS pm
         FROM "Job" j
        WHERE j."orderId" = $1 AND j."assignedPmId" IS NOT NULL
        LIMIT 1`,
      orderId,
    )
    if (rows.length > 0 && rows[0].pm) assignedTo = rows[0].pm
  } catch {
    // Job table may be missing assignedPmId on a stale schema; non-fatal
  }

  // ── 1. InboxItem ─────────────────────────────────────────────────
  try {
    const id = `inb_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
    await prisma.$executeRawUnsafe(
      `INSERT INTO "InboxItem" (
         "id", "type", "source", "title", "description",
         "priority", "status", "entityType", "entityId",
         "assignedTo", "actionData",
         "createdAt", "updatedAt"
       ) VALUES (
         $1, 'BACKORDER_CREATED', 'allocation', $2, $3,
         $4, 'PENDING', 'Order', $5,
         $6, $7::jsonb,
         NOW(), NOW()
       )`,
      id,
      `Backorder on ${orderNumber} (${totalUnits} units short)`,
      `${productLabel} short on ${builderName || 'builder'} order ${orderNumber}. ${etaLabel}.`,
      anyHasPo ? 'MEDIUM' : 'HIGH', // no incoming PO is a higher-urgency signal
      orderId,
      assignedTo,
      JSON.stringify({
        orderId,
        orderNumber,
        builderId,
        backordered: reserveResult.backordered.map((b) => ({
          productId: b.productId,
          quantity: b.quantity,
          allocationId: b.allocationId,
          orderItems: b.orderItems,
        })),
        earliestEta: earliestEta?.toISOString() || null,
        anyHasPo,
      }),
    )
  } catch (e: any) {
    logger.warn('backorder_inbox_failed', { msg: e?.message, orderId })
  }

  // ── 2. Optional builder email ────────────────────────────────────
  // Gated behind an env flag so we can validate the InboxItem path
  // before turning on a builder-facing channel.
  if (
    process.env.BACKORDER_BUILDER_EMAIL_ENABLED === 'true' &&
    builderEmail
  ) {
    try {
      const etaCopy = earliestEta
        ? `Expected to arrive on or around <strong>${earliestEta.toLocaleDateString('en-US')}</strong>.`
        : (anyHasPo
            ? 'Expected delivery date pending vendor confirmation — your account team will follow up.'
            : 'We are placing a purchase order with our supplier and will follow up with the ETA shortly.')

      const subject = `Order ${orderNumber} — ${totalUnits} ${totalUnits === 1 ? 'unit' : 'units'} on backorder`
      const html = `
        <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#1f2937;line-height:1.55;max-width:560px;margin:0 auto;padding:24px;">
          <h2 style="color:#0f2a3e;margin:0 0 12px 0;">Update on order ${orderNumber}</h2>
          <p>Hi ${builderName || 'there'},</p>
          <p>Your order has been received and confirmed. ${productLabel === '1 product' ? 'One item is' : 'A few items are'} currently short on stock — total of <strong>${totalUnits} ${totalUnits === 1 ? 'unit' : 'units'}</strong>.</p>
          <p>${etaCopy}</p>
          <p>The rest of your order is reserved and on track. We will reach out if anything changes.</p>
          <p style="margin-top:20px;color:#6b7280;font-size:13px;">— Abel Lumber</p>
        </div>
      `
      await sendEmail({ to: builderEmail, subject, html })
    } catch (e: any) {
      logger.warn('backorder_email_failed', { msg: e?.message, orderId })
    }
  }
}
