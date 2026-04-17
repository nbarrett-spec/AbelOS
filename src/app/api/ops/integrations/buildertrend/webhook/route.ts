export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { safeJson } from '@/lib/safe-json'
import { audit } from '@/lib/audit'
import {
  verifyWebhookSignature,
  processWebhookPayload,
  type BTWebhookPayload,
} from '@/lib/integrations/buildertrend'
import {
  ensureIdempotent,
  markWebhookProcessed,
  markWebhookFailed,
} from '@/lib/webhook'

// ──────────────────────────────────────────────────────────────────────────
// POST /api/ops/integrations/buildertrend/webhook
// Receive BuilderTrend webhook notifications (NO staff auth on this endpoint)
// BuilderTrend sends webhooks when:
// - Schedule changes (schedule.created, schedule.updated, schedule.deleted)
// - Selections change (selection.created, selection.updated, selection.deleted)
// - Project status changes (project.created, project.updated)
// ──────────────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  // Read raw body once for both signature check and JSON parse
  const body = await request.text()

  // Extract signature from headers
  const signature = request.headers.get('x-buildertrend-signature') || ''

  // Verify webhook signature
  try {
    const isValid = await verifyWebhookSignature(body, signature)
    if (!isValid) {
      console.warn('Invalid BuilderTrend webhook signature')
      return safeJson({ error: 'Invalid signature' }, { status: 401 })
    }
  } catch (e: any) {
    console.warn('BuilderTrend webhook verification error:', e.message)
    if (process.env.NODE_ENV === 'production') {
      return safeJson({ error: 'Webhook verification failed' }, { status: 401 })
    }
  }

  // Parse payload
  let payload: BTWebhookPayload
  try {
    payload = JSON.parse(body)
  } catch (err) {
    return safeJson({ error: 'Invalid JSON payload' }, { status: 400 })
  }

  // Audit log
  audit(request, 'CREATE', 'Integration', undefined, { method: 'POST', event: payload.event }).catch(() => {})

  // ── Idempotency ────────────────────────────────────────────────────
  const eventId =
    payload.eventId ||
    payload.id ||
    request.headers.get('x-event-id') ||
    `${payload.event}:${payload.projectId}:${Date.now()}`
  const idem = await ensureIdempotent('buildertrend', eventId, payload.event, payload)
  if (idem.status === 'duplicate') {
    return NextResponse.json({ received: true, duplicate: true })
  }

  try {
    await processWebhookPayload(payload)
    await markWebhookProcessed(idem.id)

    return NextResponse.json(
      { acknowledged: true, event: payload.event },
      { status: 202 }
    )
  } catch (error: any) {
    console.error('Error processing BuilderTrend webhook:', error)
    await markWebhookFailed(idem.id, error?.message || String(error))
    return safeJson({ error: 'Internal server error' }, { status: 500 })
  }
}

// Optional: GET for webhook health check / test
export async function GET(request: NextRequest) {
  return safeJson({
    message: 'BuilderTrend webhook endpoint is ready',
    endpoint: '/api/ops/integrations/buildertrend/webhook',
  })
}
