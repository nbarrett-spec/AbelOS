export const dynamic = 'force-dynamic'
import * as Sentry from '@sentry/nextjs'
import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { prisma } from '@/lib/prisma'
import { handleWebhook } from '@/lib/integrations/hyphen'
import {
  verifyHmacSignature,
  verifyBearerToken,
  ensureIdempotent,
  markWebhookProcessed,
  markWebhookFailed,
} from '@/lib/webhook'
import { logAudit } from '@/lib/audit'

// POST /api/webhooks/hyphen — Handle Hyphen BuildPro/SupplyPro events
//
// Authentication: prefers HMAC signature in "x-hyphen-signature" header,
// falls back to shared-secret "x-webhook-secret" comparison.
//
// Idempotency: keyed off body.eventId / body.id / x-event-id header.
//
// Audit: every mutation-bearing branch (RECEIVE, PROCESS, FAIL) records an
// AuditLog entry via logAudit() so /admin/audit has full visibility into
// external webhook activity. Uses `entity: 'hyphen_webhook'` per the
// Wave-2 sprint contract — do not rename without a coordinated migration.
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
    // Dev fallback: only when NODE_ENV is explicitly 'development' AND no secret configured.
    // Tightened from `!== 'production'` so Vercel preview deployments cannot leak open access.
    if (!webhookSecret && process.env.NODE_ENV === 'development') {
      authenticated = true
    }
  }
  if (!authenticated) {
    // Record the reject — this IS a mutation of the audit trail and helps
    // detect probing of the webhook surface.
    await logAudit({
      staffId: '',
      action: 'FAIL',
      entity: 'hyphen_webhook',
      details: {
        reason: 'auth_rejected',
        hasHmac: !!hmacHeader,
        hasSharedSecret: !!sharedSecretHeader,
        hasConfiguredSecret: !!webhookSecret,
        bodyLength: rawBody?.length || 0,
      },
      ipAddress: request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || undefined,
      userAgent: request.headers.get('user-agent') || undefined,
      severity: 'WARN',
    }).catch(() => {})
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = rawBody ? JSON.parse(rawBody) : {}
    const eventType = body.eventType || body.event || request.headers.get('x-event-type')

    if (!eventType) {
      await logAudit({
        staffId: '',
        action: 'FAIL',
        entity: 'hyphen_webhook',
        details: { reason: 'missing_event_type', bodyKeys: Object.keys(body || {}) },
        ipAddress: request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || undefined,
        userAgent: request.headers.get('user-agent') || undefined,
        severity: 'WARN',
      }).catch(() => {})
      return NextResponse.json({ error: 'Missing event type' }, { status: 400 })
    }

    // ── Idempotency ──────────────────────────────────────────────────
    // Fallback synth ID is a sha256 of the raw body (32 hex chars). This is
    // stable across retries — duplicate deliveries hit the same key. Only
    // collides if Hyphen sends two distinct events with byte-identical
    // bodies (rare; Hyphen events embed timestamps and order IDs).
    const stableId = crypto
      .createHash('sha256')
      .update(rawBody)
      .digest('hex')
      .slice(0, 32)
    const eventId =
      body.eventId ||
      body.id ||
      request.headers.get('x-event-id') ||
      `${eventType}:${stableId}`
    const idem = await ensureIdempotent('hyphen', eventId, eventType, body)
    if (idem.status === 'duplicate') {
      // Audit the dup receive so replay visibility is complete.
      await logAudit({
        staffId: '',
        action: 'RECEIVE',
        entity: 'hyphen_webhook',
        entityId: eventId,
        details: { eventType, duplicate: true, idempotencyId: idem.id },
        ipAddress: request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || undefined,
        userAgent: request.headers.get('user-agent') || undefined,
      }).catch(() => {})
      return NextResponse.json({ received: true, duplicate: true })
    }

    // First-time receipt — record before dispatching to the handler so we
    // still have a trail if handleWebhook crashes hard.
    await logAudit({
      staffId: '',
      action: 'RECEIVE',
      entity: 'hyphen_webhook',
      entityId: eventId,
      details: {
        eventType,
        idempotencyId: idem.id,
        // Truncate the payload echo to keep AuditLog rows small — the full
        // body already lives in the WebhookIngest / HyphenOrderEvent row.
        payloadPreview: truncatePayload(body),
      },
      ipAddress: request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || undefined,
      userAgent: request.headers.get('user-agent') || undefined,
    }).catch(() => {})

    try {
      await handleWebhook(eventType, body.data || body)
      await markWebhookProcessed(idem.id)
      await logAudit({
        staffId: '',
        action: 'PROCESS',
        entity: 'hyphen_webhook',
        entityId: eventId,
        details: { eventType, idempotencyId: idem.id },
        ipAddress: request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || undefined,
        userAgent: request.headers.get('user-agent') || undefined,
      }).catch(() => {})
    } catch (err: any) {
      await markWebhookFailed(idem.id, err?.message || String(err))
      await logAudit({
        staffId: '',
        action: 'FAIL',
        entity: 'hyphen_webhook',
        entityId: eventId,
        details: {
          eventType,
          idempotencyId: idem.id,
          error: err?.message || String(err),
        },
        ipAddress: request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || undefined,
        userAgent: request.headers.get('user-agent') || undefined,
        severity: 'WARN',
      }).catch(() => {})
      throw err
    }

    return NextResponse.json({ received: true })
  } catch (error: any) {
    console.error('Hyphen webhook error:', error)
    Sentry.captureException(error, { tags: { route: '/api/webhooks/hyphen', method: 'POST' } })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * Shrink payload to a form safe to keep inside AuditLog.details. The full
 * body is persisted elsewhere (WebhookIngest / HyphenOrderEvent) — this
 * is only a breadcrumb so admins can see "what came in" at a glance.
 */
function truncatePayload(body: any): any {
  try {
    const json = JSON.stringify(body || {})
    if (json.length <= 2000) return body
    return {
      _truncated: true,
      _originalBytes: json.length,
      preview: json.slice(0, 2000),
    }
  } catch {
    return { _truncated: true, _error: 'unserializable' }
  }
}
