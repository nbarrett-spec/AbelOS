export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { handleInflowWebhook } from '@/lib/integrations/inflow'
import {
  verifyHmacSignature,
  verifyBearerToken,
  ensureIdempotent,
  markWebhookProcessed,
  markWebhookFailed,
} from '@/lib/webhook'
import { logAudit } from '@/lib/audit'

// POST /api/webhooks/inflow — Handle InFlow webhook events
//
// Authentication: prefers HMAC signature in "x-inflow-signature" header,
// falls back to shared-secret "x-webhook-secret" comparison.
//
// Idempotency: keyed off body.eventId / body.id / x-event-id header.
export async function POST(request: NextRequest) {
  // ── Read raw body once for both signature check and JSON parse ─────
  const rawBody = await request.text()

  // ── Auth ────────────────────────────────────────────────────────────
  let config: any = null
  try {
    config = await (prisma as any).integrationConfig.findUnique({
      where: { provider: 'INFLOW' },
    })
  } catch { /* table may not exist yet */ }

  const hmacHeader = request.headers.get('x-inflow-signature')
  const sharedSecretHeader = request.headers.get('x-webhook-secret')
  const webhookSecret = config?.webhookSecret || process.env.INFLOW_WEBHOOK_SECRET

  let authenticated = false
  if (hmacHeader && webhookSecret) {
    authenticated = verifyHmacSignature(rawBody, hmacHeader, webhookSecret)
  }
  if (!authenticated && sharedSecretHeader && webhookSecret) {
    authenticated = verifyBearerToken(sharedSecretHeader, webhookSecret)
  }
  if (!authenticated) {
    // Dev fallback: only when NODE_ENV is explicitly 'development' AND no secret configured.
    // Tightened from `!== 'production'` so Vercel preview deployments cannot leak open access.
    if (!webhookSecret && process.env.NODE_ENV === 'development') {
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
    const idem = await ensureIdempotent('inflow', eventId, eventType, body)
    if (idem.status === 'duplicate') {
      return NextResponse.json({ received: true, duplicate: true })
    }

    // Forensic trail — record the inbound event before handing off to the
    // processor so we can correlate audit ↔ webhook event even if processing fails.
    await logAudit({
      staffId: 'webhook:inflow',
      action: 'INFLOW_EVENT',
      entity: 'Webhook',
      entityId: eventId,
      details: {
        provider: 'inflow',
        eventType,
        eventId,
        webhookEventDbId: idem.id,
      },
      ipAddress:
        request.headers.get('x-forwarded-for') ||
        request.headers.get('x-real-ip') ||
        undefined,
      userAgent: request.headers.get('user-agent') || undefined,
      severity: 'INFO',
    }).catch(() => {})

    try {
      await handleInflowWebhook(eventType, body.data || body)
      await markWebhookProcessed(idem.id)
    } catch (err: any) {
      await markWebhookFailed(idem.id, err?.message || String(err))
      throw err
    }

    return NextResponse.json({ received: true })
  } catch (error: any) {
    console.error('InFlow webhook error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
