export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { verifyWebhookSignature } from '@/lib/stripe'
import { ensureIdempotent, markWebhookProcessed, markWebhookFailed } from '@/lib/webhook'
import { processStripeEvent } from '@/lib/webhooks/stripe-processor'

// ──────────────────────────────────────────────────────────────────────────
// POST /api/webhooks/stripe — Verify signature, deduplicate, store payload,
// and dispatch to the reusable processor. The processor is shared with the
// DLQ retry worker so a failed webhook can be replayed from the stored
// payload without re-verifying.
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

  // ── Idempotency: Stripe guarantees event.id is unique per event ────
  const idem = await ensureIdempotent('stripe', event.id, event.type, event)
  if (idem.status === 'duplicate') {
    return NextResponse.json({ received: true, duplicate: true })
  }

  try {
    await processStripeEvent(event)
    await markWebhookProcessed(idem.id)
    return NextResponse.json({ received: true })
  } catch (error: any) {
    console.error('Webhook processing error:', error)
    await markWebhookFailed(idem.id, error?.message || String(error))
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
