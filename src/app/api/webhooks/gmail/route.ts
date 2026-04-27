export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { handlePushNotification } from '@/lib/integrations/gmail'
import {
  verifyGooglePubSubToken,
  verifyBearerToken,
  ensureIdempotent,
  markWebhookProcessed,
  markWebhookFailed,
} from '@/lib/webhook'
import { logAudit } from '@/lib/audit'

// POST /api/webhooks/gmail — Handle Gmail Pub/Sub push notifications
//
// Authentication (in order of preference):
//   1. Google OIDC token (JWT) signed by Google and delivered in the
//      "Authorization: Bearer <JWT>" header. Verified against
//      GMAIL_PUBSUB_AUDIENCE / GMAIL_PUBSUB_SERVICE_ACCOUNT env vars.
//   2. Fallback shared secret in "x-webhook-token" header, compared
//      timing-safely against GMAIL_WEBHOOK_TOKEN env var.
//
// Idempotency: historyId + emailAddress is used as the event key so a retry
// of the same Pub/Sub message does not re-process history.
export async function POST(request: NextRequest) {
  // ── Auth ────────────────────────────────────────────────────────────
  const authHeader = request.headers.get('authorization')
  const fallbackToken = request.headers.get('x-webhook-token')
  const expectedAudience = process.env.GMAIL_PUBSUB_AUDIENCE
  const expectedEmail = process.env.GMAIL_PUBSUB_SERVICE_ACCOUNT
  const fallbackSecret = process.env.GMAIL_WEBHOOK_TOKEN

  let authenticated = false
  if (authHeader) {
    const result = verifyGooglePubSubToken(authHeader, { expectedAudience, expectedEmail })
    authenticated = result.ok
    if (!authenticated && fallbackSecret) {
      authenticated = verifyBearerToken(authHeader, fallbackSecret)
    }
  }
  if (!authenticated && fallbackSecret && fallbackToken) {
    authenticated = verifyBearerToken(fallbackToken, fallbackSecret)
  }

  // If no auth configured at all, allow in dev but block in prod
  const anyAuthConfigured = Boolean(expectedAudience || expectedEmail || fallbackSecret)
  if (!anyAuthConfigured) {
    if (process.env.NODE_ENV === 'production') {
      console.warn('[gmail webhook] No auth configured in production — rejecting')
      return NextResponse.json({ error: 'Webhook auth not configured' }, { status: 401 })
    }
    authenticated = true // dev mode
  }
  if (!authenticated) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await request.json()

    // Gmail Pub/Sub sends base64 encoded data
    const message = body.message
    if (!message?.data) {
      return NextResponse.json({ error: 'No message data' }, { status: 400 })
    }

    const decoded = JSON.parse(Buffer.from(message.data, 'base64').toString())
    const { emailAddress, historyId } = decoded

    // Verify it's for our domain
    if (!emailAddress?.endsWith('@abellumber.com')) {
      return NextResponse.json({ received: true }) // Ignore non-domain emails
    }

    // ── Idempotency ──────────────────────────────────────────────────
    // historyId can repeat across retries. Combine with messageId if present.
    const eventId = message.messageId || `${emailAddress}:${historyId}`
    const idem = await ensureIdempotent('gmail', eventId, 'push_notification', {
      emailAddress,
      historyId,
      messageId: message.messageId,
    })
    if (idem.status === 'duplicate') {
      return NextResponse.json({ received: true, duplicate: true })
    }

    // Forensic trail — record the inbound push before async processing kicks off.
    await logAudit({
      staffId: 'webhook:gmail',
      action: 'GMAIL_PUSH_NOTIFICATION',
      entity: 'Webhook',
      entityId: eventId,
      details: {
        provider: 'gmail',
        eventType: 'push_notification',
        emailAddress,
        historyId,
        messageId: message.messageId ?? null,
        webhookEventDbId: idem.id,
      },
      ipAddress:
        request.headers.get('x-forwarded-for') ||
        request.headers.get('x-real-ip') ||
        undefined,
      userAgent: request.headers.get('user-agent') || undefined,
      severity: 'INFO',
    }).catch(() => {})

    // Process the notification asynchronously
    handlePushNotification(historyId)
      .then(() => markWebhookProcessed(idem.id))
      .catch(err => {
        console.error('Gmail push notification processing error:', err)
        markWebhookFailed(idem.id, err?.message || String(err))
      })

    // Must return 200 quickly to acknowledge Pub/Sub
    return NextResponse.json({ received: true })
  } catch (error: any) {
    console.error('Gmail webhook error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
