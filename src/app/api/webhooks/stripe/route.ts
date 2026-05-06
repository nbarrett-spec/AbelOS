// Stripe signature verification requires Node crypto — force Node runtime,
// never Edge. `force-dynamic` keeps Vercel from attempting to cache the POST.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import * as Sentry from '@sentry/nextjs'
import { NextRequest, NextResponse } from 'next/server'
import { verifyWebhookSignature } from '@/lib/stripe'
import { ensureIdempotent, markWebhookProcessed, markWebhookFailed } from '@/lib/webhook'
import { processStripeEvent } from '@/lib/webhooks/stripe-processor'
import { logAudit } from '@/lib/audit'
import { prisma } from '@/lib/prisma'

// Safety-net DDL for the money-path dead-letter table. Idempotent — runs at
// most once per cold start. Separate from WebhookEvent so the forensic trail
// for Stripe failures is isolated from the general retry queue (A5 Critical
// Gap #1: money path needs its own audit surface).
let deadLetterTableEnsured = false
async function ensureDeadLetterTable() {
  if (deadLetterTableEnsured) return
  try {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "WebhookDeadLetter" (
        "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
        "source" TEXT NOT NULL,
        "eventId" TEXT,
        "eventType" TEXT,
        "payload" JSONB,
        "error" TEXT,
        "attempts" INT DEFAULT 0,
        "nextRetryAt" TIMESTAMPTZ,
        "createdAt" TIMESTAMPTZ DEFAULT NOW(),
        "resolvedAt" TIMESTAMPTZ,
        UNIQUE ("source", "eventId")
      )
    `)
    deadLetterTableEnsured = true
  } catch {
    deadLetterTableEnsured = true
  }
}

// Short payload excerpt for audit details — the full payload lives on the
// WebhookEvent row. We only keep a few fields so the AuditLog stays scannable.
function snippetFor(event: any): Record<string, any> {
  const obj = event?.data?.object || {}
  return {
    amount: obj.amount ?? obj.amount_total ?? obj.amount_paid ?? null,
    currency: obj.currency ?? null,
    status: obj.status ?? obj.payment_status ?? null,
    invoiceId: obj.metadata?.invoiceId ?? null,
    invoiceNumber: obj.metadata?.invoiceNumber ?? null,
    builderId: obj.metadata?.builderId ?? null,
    objectId: obj.id ?? null,
  }
}

// ──────────────────────────────────────────────────────────────────────────
// POST /api/webhooks/stripe — Verify signature, deduplicate, store payload,
// and dispatch to the reusable processor. The processor is shared with the
// DLQ retry worker so a failed webhook can be replayed from the stored
// payload without re-verifying.
//
// Response contract: ALWAYS 200 once the signature is valid, even when our
// internal processing fails. Stripe retries on non-200, and we do NOT want
// Stripe retrying internal bugs — our own DLQ cron (WebhookEvent +
// WebhookDeadLetter tables) is the authoritative retry path.
// ──────────────────────────────────────────────────────────────────────────
export async function POST(request: NextRequest) {
  const body = await request.text()
  const sig = request.headers.get('stripe-signature')

  if (!sig) {
    return NextResponse.json({ error: 'Missing stripe-signature header' }, { status: 400 })
  }

  // Verify webhook signature. verifyWebhookSignature now uses
  // crypto.timingSafeEqual (see src/lib/stripe.ts). Missing STRIPE_WEBHOOK_SECRET
  // is treated as a hard failure everywhere — silently "processing in dev"
  // was an audit-log gap.
  try {
    const valid = await verifyWebhookSignature(body, sig)
    if (!valid) {
      console.error('Stripe webhook signature verification failed')
      return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
    }
  } catch (e: any) {
    console.warn('Stripe webhook verification error:', e.message)
    return NextResponse.json({ error: 'Webhook verification failed' }, { status: 400 })
  }

  const event = JSON.parse(body)

  // ── Idempotency: Stripe guarantees event.id is unique per event ────
  // The WebhookEvent table (see src/lib/webhook.ts) is the source of truth
  // for "have we processed this before?". A duplicate returns 200 without
  // mutating — Stripe occasionally retries even on prior success.
  const idem = await ensureIdempotent('stripe', event.id, event.type, event)
  if (idem.status === 'duplicate') {
    return NextResponse.json({ received: true, processed: false, duplicate: true })
  }

  try {
    await processStripeEvent(event)
    await markWebhookProcessed(idem.id)

    // Route-level audit on success. The processor writes per-entity audit
    // rows (Invoice, Payment) already; this row records the RECEIPT of the
    // Stripe event itself, which was A5's Critical Gap #1 — money path with
    // no forensic record of inbound delivery. logAudit() swallows its own
    // errors, so never wrap it in a throw path.
    await logAudit({
      staffId: 'system:stripe-webhook',
      action: event.type,
      entity: 'stripe_event',
      entityId: event.id,
      details: {
        eventId: event.id,
        eventType: event.type,
        livemode: event.livemode ?? null,
        payload_snippet: snippetFor(event),
        mutated: true,
      },
      severity: 'INFO',
    })

    return NextResponse.json({ received: true, processed: true, deadLettered: false })
  } catch (error: any) {
    const errMsg = error?.message || String(error)
    console.error('Webhook processing error:', error)
    Sentry.captureException(error, {
      tags: { route: '/api/webhooks/stripe', method: 'POST', eventType: event?.type },
      extra: { eventId: event?.id, idemId: idem.id },
    })

    // Flip the WebhookEvent row to FAILED/DEAD_LETTER with backoff metadata
    // so the retry cron picks it up. This is the primary retry surface.
    await markWebhookFailed(idem.id, errMsg)

    // Mirror into the dedicated Stripe DLQ. Wrapped in its own try so a DLQ
    // insert failure can't flip the response to 500 and make Stripe retry.
    let deadLettered = false
    try {
      await ensureDeadLetterTable()
      await prisma.$executeRawUnsafe(
        `INSERT INTO "WebhookDeadLetter"
           ("source", "eventId", "eventType", "payload", "error", "attempts", "nextRetryAt", "createdAt")
         VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, NOW())
         ON CONFLICT ("source", "eventId") DO UPDATE SET
           "error" = EXCLUDED."error",
           "attempts" = "WebhookDeadLetter"."attempts" + 1,
           "nextRetryAt" = EXCLUDED."nextRetryAt"`,
        'stripe',
        event.id,
        event.type,
        JSON.stringify(event),
        errMsg.slice(0, 2000),
        1,
        new Date(Date.now() + 60_000) // first retry in 1m; cron owns the ladder
      )
      deadLettered = true
    } catch (dlqErr: any) {
      console.error('WebhookDeadLetter insert failed:', dlqErr?.message || dlqErr)
    }

    // Audit the failure at the route level so operators can see the receipt
    // even when processing blew up.
    try {
      await logAudit({
        staffId: 'system:stripe-webhook',
        action: `${event.type}:FAILED`,
        entity: 'stripe_event',
        entityId: event.id,
        details: {
          eventId: event.id,
          eventType: event.type,
          error: errMsg.slice(0, 500),
          payload_snippet: snippetFor(event),
          mutated: false,
          deadLettered,
        },
        severity: 'CRITICAL',
      })
    } catch { /* logAudit already swallows; outer catch is belt-and-suspenders */ }

    // Always 200 — see response-contract note at the top of the handler.
    return NextResponse.json({ received: true, processed: false, deadLettered })
  }
}
