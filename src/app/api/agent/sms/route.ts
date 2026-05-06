export const dynamic = 'force-dynamic'
import * as Sentry from '@sentry/nextjs'
import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { prisma } from '@/lib/prisma'
import { createNotification } from '@/lib/notifications'
import { logger } from '@/lib/logger'

// ──────────────────────────────────────────────────────────────────────────
// POST /api/agent/sms — Inbound Twilio SMS webhook (A-API-2)
// ──────────────────────────────────────────────────────────────────────────
// Twilio posts application/x-www-form-urlencoded with fields including
// MessageSid, From, To, Body. We:
//   1. Verify X-Twilio-Signature against TWILIO_AUTH_TOKEN (HMAC-SHA1).
//   2. Persist InboundSms (twilioSid unique → idempotent).
//   3. Resolve sender to Builder by phone.
//   4. Flag urgent keywords and notify ADMIN/MANAGER staff.
//   5. Return TwiML XML (empty <Response/>) — Twilio expects XML.
//
// Twilio SDK is intentionally NOT a dep — we implement the signature
// algorithm directly per https://www.twilio.com/docs/usage/webhooks/webhooks-security
// ──────────────────────────────────────────────────────────────────────────

const TWIML_EMPTY =
  '<?xml version="1.0" encoding="UTF-8"?><Response/>'

const URGENT_KEYWORDS = ['urgent', 'asap', 'stop', 'emergency', 'help']

function twimlResponse(xml: string = TWIML_EMPTY, status = 200) {
  return new NextResponse(xml, {
    status,
    headers: { 'Content-Type': 'text/xml; charset=utf-8' },
  })
}

function errorResponse(status: number, message: string) {
  // Even on auth failure Twilio just needs a non-2xx — return XML for consistency.
  const xml = `<?xml version="1.0" encoding="UTF-8"?><Response><!-- ${message} --></Response>`
  return new NextResponse(xml, {
    status,
    headers: { 'Content-Type': 'text/xml; charset=utf-8' },
  })
}

/**
 * Twilio request signature verification.
 * Algorithm:
 *   1. Take the full URL the request was POSTed to (including any query string).
 *   2. Sort all POST params alphabetically by key.
 *   3. Concatenate URL + (key + value) for each sorted param.
 *   4. HMAC-SHA1 the concatenation with the auth token.
 *   5. Base64 the digest and compare (constant-time) to X-Twilio-Signature.
 */
function verifyTwilioSignature(
  authToken: string,
  signatureHeader: string,
  url: string,
  params: Record<string, string>
): boolean {
  const sortedKeys = Object.keys(params).sort()
  let data = url
  for (const k of sortedKeys) {
    data += k + params[k]
  }
  const expected = crypto
    .createHmac('sha1', authToken)
    .update(Buffer.from(data, 'utf-8'))
    .digest('base64')
  try {
    const a = Buffer.from(expected)
    const b = Buffer.from(signatureHeader)
    if (a.length !== b.length) return false
    return crypto.timingSafeEqual(a, b)
  } catch {
    return false
  }
}

function reconstructUrl(request: NextRequest): string {
  // Twilio signs the exact URL it posts to (incl. proto + host + path + query).
  // Behind Vercel, request.url is already absolute, but honor X-Forwarded-* if set.
  const fwdProto = request.headers.get('x-forwarded-proto')
  const fwdHost = request.headers.get('x-forwarded-host') || request.headers.get('host')
  if (fwdHost) {
    const u = new URL(request.url)
    return `${fwdProto || u.protocol.replace(':', '')}://${fwdHost}${u.pathname}${u.search}`
  }
  return request.url
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text()
  const params = Object.fromEntries(new URLSearchParams(rawBody))

  // ── Auth ──────────────────────────────────────────────────────────────
  const authToken = process.env.TWILIO_AUTH_TOKEN
  const signature = request.headers.get('x-twilio-signature')

  if (!authToken) {
    if (process.env.NODE_ENV === 'production') {
      logger.warn('twilio_sms_no_auth_token_configured', {})
      return errorResponse(503, 'TWILIO_AUTH_TOKEN not configured')
    }
    // Dev mode: allow unsigned requests through for local testing.
  } else {
    if (!signature) {
      return errorResponse(401, 'Missing X-Twilio-Signature')
    }
    const url = reconstructUrl(request)
    const ok = verifyTwilioSignature(authToken, signature, url, params)
    if (!ok) {
      logger.warn('twilio_sms_signature_invalid', {
        url,
        from: params.From,
      })
      return errorResponse(403, 'Invalid signature')
    }
  }

  // ── Required fields ───────────────────────────────────────────────────
  const messageSid = params.MessageSid || params.SmsSid
  const fromNumber = params.From
  const toNumber = params.To
  const body = params.Body || ''

  if (!messageSid || !fromNumber || !toNumber) {
    return errorResponse(400, 'Missing MessageSid/From/To')
  }

  // ── Idempotency: twilioSid is unique. If we've seen it, just ack. ─────
  const existing = await prisma.inboundSms.findUnique({
    where: { twilioSid: messageSid },
    select: { id: true },
  })
  if (existing) {
    return twimlResponse()
  }

  // ── Lookup builder by phone ───────────────────────────────────────────
  // Phone format from Twilio is E.164 (e.g. +18175551234). Builder.phone
  // is free-text. Compare on digits-only for resilience.
  const fromDigits = fromNumber.replace(/\D/g, '')
  let builderId: string | null = null
  if (fromDigits.length >= 10) {
    const last10 = fromDigits.slice(-10)
    // Use raw for digit-only fuzzy match; index on Builder.phone isn't critical
    // here (low call rate), and we want resilience to formatting.
    const matches = (await prisma.$queryRawUnsafe(
      `SELECT "id" FROM "Builder" WHERE regexp_replace(COALESCE("phone", ''), '[^0-9]', '', 'g') LIKE $1 LIMIT 1`,
      `%${last10}`
    )) as Array<{ id: string }>
    if (matches.length > 0) {
      builderId = matches[0].id
    }
  }

  // ── Urgency detection ─────────────────────────────────────────────────
  const lowerBody = body.toLowerCase()
  const urgent = URGENT_KEYWORDS.some((k) => lowerBody.includes(k))

  // ── Persist ───────────────────────────────────────────────────────────
  try {
    await prisma.inboundSms.create({
      data: {
        twilioSid: messageSid,
        fromNumber,
        toNumber,
        body,
        builderId,
        urgent,
        processed: false,
      },
    })
  } catch (err: any) {
    // Race on twilioSid unique → treat as duplicate.
    if (err?.code === 'P2002') {
      return twimlResponse()
    }
    logger.error('twilio_sms_persist_failed', { err: err?.message, messageSid })
    Sentry.captureException(err, {
      tags: { route: '/api/agent/sms', method: 'POST', stage: 'persist' },
      extra: { messageSid },
    })
    return errorResponse(500, 'Persist failed')
  }

  // ── Staff notification ────────────────────────────────────────────────
  // Only ping staff for urgent messages or known builders. Random spam
  // numbers shouldn't notify the team.
  if (urgent || builderId) {
    try {
      const staff = (await prisma.$queryRawUnsafe(
        `SELECT "id" FROM "Staff" WHERE "role"::text IN ('ADMIN', 'MANAGER') AND "active" = true`
      )) as Array<{ id: string }>

      const title = urgent
        ? `URGENT SMS from ${fromNumber}`
        : `SMS from ${fromNumber}`
      const preview = body.length > 140 ? body.slice(0, 137) + '...' : body

      for (const s of staff) {
        createNotification({
          staffId: s.id,
          type: 'MESSAGE',
          title,
          message: preview,
          link: '/ops/messages/sms',
        }).catch(() => {})
      }
    } catch (err: any) {
      // Notification failure shouldn't block ack to Twilio.
      logger.warn('twilio_sms_notify_failed', { err: err?.message })
    }
  }

  return twimlResponse()
}
