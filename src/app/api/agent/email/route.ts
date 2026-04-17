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

// POST: Inbound email webhook (SendGrid/Mailgun/generic compatible)
//
// Authentication: HMAC signature in "x-sendgrid-signature" / "x-mailgun-signature"
// header, or shared secret in "x-webhook-secret" header. Falls back to
// EMAIL_WEBHOOK_SECRET env var.
//
// Idempotency: keyed off messageId from the email provider.
export async function POST(request: NextRequest) {
  // ── Auth ──────────────────────────────────────────────────────────────
  const rawBody = await request.text()
  const hmacHeader =
    request.headers.get('x-sendgrid-signature') ||
    request.headers.get('x-mailgun-signature')
  const sharedSecretHeader = request.headers.get('x-webhook-secret')
  const webhookSecret = process.env.EMAIL_WEBHOOK_SECRET

  let authenticated = false
  if (hmacHeader && webhookSecret) {
    authenticated = verifyHmacSignature(rawBody, hmacHeader, webhookSecret)
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

  try {
    const body = JSON.parse(rawBody)
    const { from, to, subject, text, messageId } = body

    if (!from || !text) {
      return NextResponse.json({ error: 'from and text required' }, { status: 400 })
    }

    // ── Idempotency ────────────────────────────────────────────────────
    const eventId = messageId || `email:${from}:${Date.now()}`
    const idem = await ensureIdempotent('email-agent', eventId, 'inbound_email', body)
    if (idem.status === 'duplicate') {
      return NextResponse.json({ received: true, duplicate: true })
    }

    // Extract email address from "Name <email>" format
    const emailMatch = from.match(/<([^>]+)>/) || [null, from]
    const fromEmail = (emailMatch[1] || from).toLowerCase().trim()

    // Look up builder by email
    const builders: any[] = await prisma.$queryRawUnsafe(
      `SELECT id, "contactName", "companyName" FROM "Builder" WHERE LOWER(email) = $1 AND status = 'ACTIVE' LIMIT 1`,
      fromEmail
    )

    if (builders.length === 0) {
      // Log unknown email
      await prisma.$queryRawUnsafe(`
        INSERT INTO "AgentEmailLog" (id, "fromEmail", "toEmail", subject, body, direction, "externalId", status)
        VALUES (gen_random_uuid()::text, $1, $2, $3, $4, 'INBOUND', $5, 'UNKNOWN_SENDER')
      `, fromEmail, to || 'support@abellumber.com', subject || '', text, messageId || null)

      return NextResponse.json({
        reply: 'Email received but sender is not associated with an active builder account.',
        action: 'FORWARD_TO_SUPPORT',
      })
    }

    const builder = builders[0]
    const builderId = builder.id

    // Find existing active email conversation
    const convRows: any[] = await prisma.$queryRawUnsafe(`
      SELECT id FROM "AgentConversation"
      WHERE "builderId" = $1 AND channel = 'EMAIL' AND status = 'ACTIVE'
      ORDER BY "lastMessageAt" DESC LIMIT 1
    `, builderId)

    const existingConvId = convRows.length > 0 ? convRows[0].id : null

    // Log inbound email
    await prisma.$queryRawUnsafe(`
      INSERT INTO "AgentEmailLog" (id, "conversationId", "builderId", "fromEmail", "toEmail", subject, body, direction, "externalId", status)
      VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, 'INBOUND', $7, 'RECEIVED')
    `, existingConvId, builderId, fromEmail, to || 'support@abellumber.com', subject || '', text, messageId || null)

    // Process through shared agent pipeline (channel=EMAIL gives professional plain text)
    const result = await processMessage({
      message: text.trim(),
      builderId,
      conversationId: existingConvId,
      channel: 'EMAIL',
    })

    // Wrap agent response in professional email format
    const builderName = builder.contactName?.split(' ')[0] || 'there'
    const replySubject = `Re: ${subject || 'Your Abel Lumber Inquiry'}`
    const replyBody = `Hi ${builderName},\n\n${result.response.text}\n\nFor real-time tracking and instant answers, log into your Builder Portal.\n\nBest regards,\nAbel Lumber Support Team\n\n---\nThis is an automated response from Abel Lumber's support system.`

    // Log outbound email
    await prisma.$queryRawUnsafe(`
      INSERT INTO "AgentEmailLog" (id, "conversationId", "builderId", "fromEmail", "toEmail", subject, body, direction, status)
      VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, 'OUTBOUND', 'QUEUED')
    `, result.conversationId, builderId, 'support@abellumber.com', fromEmail, replySubject, replyBody)

    await markWebhookProcessed(idem.id)

    return NextResponse.json({
      success: true,
      conversationId: result.conversationId,
      reply: { to: fromEmail, subject: replySubject, body: replyBody },
      intent: result.intent,
    })
  } catch (error: any) {
    console.error('Email webhook error:', error)
    await markWebhookFailed(idem?.id, error?.message || String(error))
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
