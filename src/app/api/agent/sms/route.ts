export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { processMessage } from '@/lib/agent'
import {
  verifyHmacSignature,
  verifyBearerToken,
  ensureIdempotent,
  markWebhookProcessed,
  markWebhookFailed,
} from '@/lib/webhook'

// POST: Inbound SMS webhook (Twilio-compatible)
//
// Authentication: Twilio sends x-twilio-signature (HMAC-SHA1 of URL + params
// using your auth token). Falls back to shared-secret in "x-webhook-secret"
// header, compared against TWILIO_WEBHOOK_SECRET env var.
//
// Idempotency: keyed off Twilio's MessageSid (unique per message).
export async function POST(request: NextRequest) {
  // ── Auth ──────────────────────────────────────────────────────────────
  const rawBody = await request.text()
  const twilioSig = request.headers.get('x-twilio-signature')
  const sharedSecretHeader = request.headers.get('x-webhook-secret')
  const webhookSecret = process.env.TWILIO_WEBHOOK_SECRET || process.env.TWILIO_AUTH_TOKEN

  let authenticated = false
  if (twilioSig && webhookSecret) {
    // Twilio uses HMAC-SHA1 over URL+params — use sha1 mode
    authenticated = verifyHmacSignature(rawBody, twilioSig, webhookSecret, 'sha1')
  }
  if (!authenticated && sharedSecretHeader && webhookSecret) {
    authenticated = verifyBearerToken(sharedSecretHeader, webhookSecret)
  }
  if (!authenticated && !webhookSecret && process.env.NODE_ENV !== 'production') {
    authenticated = true // dev mode — no secret configured
  }
  if (!authenticated) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let idem: { status: string; id?: string } | undefined
  try {
    const body = JSON.parse(rawBody)
    const { From, Body, MessageSid } = body

    if (!From || !Body) {
      return NextResponse.json({ error: 'From and Body required' }, { status: 400 })
    }

    // ── Idempotency ────────────────────────────────────────────────────
    const eventId = MessageSid || `sms:${From}:${Date.now()}`
    idem = await ensureIdempotent('sms-agent', eventId, 'inbound_sms', body)
    if (idem.status === 'duplicate') {
      return NextResponse.json({ received: true, duplicate: true })
    }

    // Normalize phone number
    const phone = From.replace(/[^\d+]/g, '')

    // Look up builder by phone
    const builders: any[] = await prisma.$queryRawUnsafe(
      `SELECT id, "contactName", "companyName" FROM "Builder" WHERE phone = $1 AND status = 'ACTIVE' LIMIT 1`,
      phone
    )

    if (builders.length === 0) {
      // Log the unknown SMS
      await prisma.$queryRawUnsafe(`
        INSERT INTO "AgentSmsLog" (id, "phoneNumber", direction, body, "externalId", status)
        VALUES (gen_random_uuid()::text, $1, 'INBOUND', $2, $3, 'UNKNOWN_SENDER')
      `, phone, Body, MessageSid || null)

      return NextResponse.json({
        reply: 'This number is not associated with an Abel Lumber account. Please contact us at (817) 555-ABEL or register at our builder portal.',
      })
    }

    const builder = builders[0]
    const builderId = builder.id

    // Find existing active SMS conversation or let processMessage create one
    const convRows: any[] = await prisma.$queryRawUnsafe(`
      SELECT id FROM "AgentConversation"
      WHERE "builderId" = $1 AND channel = 'SMS' AND status = 'ACTIVE'
      ORDER BY "lastMessageAt" DESC LIMIT 1
    `, builderId)

    const existingConvId = convRows.length > 0 ? convRows[0].id : null

    // Log inbound SMS
    await prisma.$queryRawUnsafe(`
      INSERT INTO "AgentSmsLog" (id, "conversationId", "builderId", "phoneNumber", direction, body, "externalId", status)
      VALUES (gen_random_uuid()::text, $1, $2, $3, 'INBOUND', $4, $5, 'RECEIVED')
    `, existingConvId, builderId, phone, Body, MessageSid || null)

    // Process through shared agent pipeline (channel=SMS gives plain text output)
    const result = await processMessage({
      message: Body.trim(),
      builderId,
      conversationId: existingConvId,
      channel: 'SMS',
    })

    // Log outbound SMS
    await prisma.$queryRawUnsafe(`
      INSERT INTO "AgentSmsLog" (id, "conversationId", "builderId", "phoneNumber", direction, body, status)
      VALUES (gen_random_uuid()::text, $1, $2, $3, 'OUTBOUND', $4, 'SENT')
    `, result.conversationId, builderId, phone, result.response.text)

    await markWebhookProcessed(idem?.id)

    return NextResponse.json({ reply: result.response.text })
  } catch (error: any) {
    console.error('SMS webhook error:', error)
    await markWebhookFailed(idem?.id, error?.message || String(error))
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
