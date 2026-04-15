export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { handleWebhook } from '@/lib/integrations/hyphen'
import {
  verifyHmacSignature,
  verifyBearerToken,
  ensureIdempotent,
  markWebhookProcessed,
  markWebhookFailed,
} from '@/lib/webhook'

// POST /api/webhooks/hyphen — Handle Hyphen BuildPro/SupplyPro events
//
// Authentication: prefers HMAC signature in "x-hyphen-signature" header,
// falls back to shared-secret "x-webhook-secret" comparison.
//
// Idempotency: keyed off body.eventId / body.id / x-event-id header.
export async function POST(request: NextRequest) {
  const rawBody = await request.text()

  // ── Auth ────────────────────────────────────────────────────────────
  let config: any = null
  try {
    config = await (prisma as any).integrationConfig.findUnique({
      where: { provider: 'HYPHEN' },
    })
  } catch { /* table may not exist yet */ }

  const hmacHeader = request.headers.get('x-hyphen-signature')
  const sharedSecretHeader = request.headers.get('x-webhook-secret')
  const webhookSecret = config?.webhookSecret || process.env.HYPHEN_WEBHOOK_SECRET

  let authenticated = false
  if (hmacHeader && webhookSecret) {
    authenticated = verifyHmacSignature(rawBody, hmacHeader, webhookSecret)
  }
  if (!authenticated && sharedSecretHeader && webhookSecret) {
    authenticated = verifyBearerToken(sharedSecretHeader, webhookSecret)
  }
  if (!authenticated) {
    if (!webhookSecret && process.env.NODE_ENV !== 'production') {
      authenticated = true
    }
  }
  if (!authenticated) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = rawBody ? JSON.parse(rawBody) : {}
    const eventType = body.eventType || body.event || request.headers.get('x-event-type')

    if (!eventType) {
      return NextResponse.json({ error: 'Missing event type' }, { status: 400 })
    }

    // ── Idempotency ──────────────────────────────────────────────────
    const eventId =
      body.eventId ||
      body.id ||
      request.headers.get('x-event-id') ||
      `${eventType}:${JSON.stringify(body.data || body).length}:${Date.now()}`
    const idem = await ensureIdempotent('hyphen', eventId, eventType, body)
    if (idem.status === 'duplicate') {
      return NextResponse.json({ received: true, duplicate: true })
    }

    try {
      await handleWebhook(eventType, body.data || body)
      await markWebhookProcessed(idem.id)
    } catch (err: any) {
      await markWebhookFailed(idem.id, err?.message || String(err))
      throw err
    }

    return NextResponse.json({ received: true })
  } catch (error: any) {
    console.error('Hyphen webhook error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
