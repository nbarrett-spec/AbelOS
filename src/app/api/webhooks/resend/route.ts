/**
 * Resend email webhook receiver — handles bounces and complaints so the
 * enrichment agent doesn't keep emailing dead addresses.
 *
 *   POST /api/webhooks/resend
 *
 * Auth:
 *   Resend signs webhooks via Svix. Each delivery includes:
 *     - svix-id          (unique per delivery; used for idempotency)
 *     - svix-timestamp   (unix seconds; replay-protection window: 5 min)
 *     - svix-signature   (one or more signatures, format "v1,<base64>")
 *
 *   Signature is HMAC-SHA256 over `${svix-id}.${svix-timestamp}.${rawBody}`,
 *   base64-encoded, using the secret in `RESEND_WEBHOOK_SECRET`. Resend
 *   delivers the secret prefixed with "whsec_" — strip the prefix before
 *   HMAC. Multiple signatures may be present (rotation); accept if any match.
 *
 *   Docs: https://docs.svix.com/receiving/verifying-payloads/how-manual
 *         https://resend.com/docs/dashboard/webhooks/introduction
 *
 * Idempotency:
 *   `svix-id` keys the WebhookEvent table (same dedupe layer used by the
 *   Stripe webhook — see src/lib/webhook.ts for shared helpers).
 *
 * Handled events:
 *   - email.bounced     → null out Prospect.email, set bouncedAt, queue review
 *   - email.complained  → same null/timestamp, queue review with WARN severity
 *   - email.delivered / email.opened / others → 200 no-op
 *
 * Always responds 200 once signature verifies, even on internal failure, to
 * avoid a Resend retry storm masking a downstream bug. The WebhookEvent +
 * AuditLog rows are the forensic trail.
 */

// Force Node runtime — manual HMAC verification needs `crypto` and we read
// the raw request body via .text() (Edge would also work but keeping Node
// matches the rest of the webhook handlers in this app).
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { logAudit } from '@/lib/audit'
import {
  ensureIdempotent,
  markWebhookProcessed,
  markWebhookFailed,
} from '@/lib/webhook'

// Svix replay-protection window. Resend uses Svix defaults (5 minutes).
const SVIX_TOLERANCE_MS = 5 * 60 * 1000

// ──────────────────────────────────────────────────────────────────────────
// Manual Svix signature verification.
//
// The secret arrives as `whsec_<base64-string>`. Strip the prefix, base64-
// decode the remainder to get the raw HMAC key, then compute
// HMAC-SHA256(rawKey, `${id}.${ts}.${body}`) and base64-encode.
//
// The signature header may contain multiple space-separated values, each
// shaped like `v1,<base64sig>`. We accept the request if ANY match — Svix
// rotates signatures during secret rolls.
// ──────────────────────────────────────────────────────────────────────────
function verifySvixSignature(opts: {
  id: string | null
  timestamp: string | null
  signatureHeader: string | null
  rawBody: string
  secret: string
}): { ok: true } | { ok: false; reason: string } {
  const { id, timestamp, signatureHeader, rawBody, secret } = opts
  if (!id || !timestamp || !signatureHeader) {
    return { ok: false, reason: 'missing_svix_headers' }
  }

  // Replay protection
  const tsMs = Number(timestamp) * 1000
  if (!Number.isFinite(tsMs)) return { ok: false, reason: 'bad_timestamp' }
  if (Math.abs(Date.now() - tsMs) > SVIX_TOLERANCE_MS) {
    return { ok: false, reason: 'timestamp_outside_tolerance' }
  }

  // Strip Resend/Svix `whsec_` prefix and base64-decode to raw key bytes.
  const cleaned = secret.replace(/^whsec_/, '')
  let keyBytes: Buffer
  try {
    keyBytes = Buffer.from(cleaned, 'base64')
  } catch {
    return { ok: false, reason: 'bad_secret_encoding' }
  }

  const signedPayload = `${id}.${timestamp}.${rawBody}`
  const expectedSig = crypto
    .createHmac('sha256', keyBytes)
    .update(signedPayload)
    .digest('base64')

  // Header is space-separated list of `v1,<sig>` entries — try each.
  const candidates = signatureHeader
    .split(/\s+/)
    .map((s) => s.trim())
    .filter(Boolean)

  for (const cand of candidates) {
    const [version, sig] = cand.split(',')
    if (version !== 'v1' || !sig) continue
    try {
      const a = Buffer.from(sig, 'utf8')
      const b = Buffer.from(expectedSig, 'utf8')
      if (a.length === b.length && crypto.timingSafeEqual(a, b)) {
        return { ok: true }
      }
    } catch {
      // Try the next candidate
    }
  }

  return { ok: false, reason: 'no_signature_match' }
}

// ──────────────────────────────────────────────────────────────────────────
// Resend payload shapes (loose — cast at the boundary).
//   See https://resend.com/docs/dashboard/webhooks/event-types
// We only act on bounce / complaint events, so a permissive shape is fine.
// ──────────────────────────────────────────────────────────────────────────
interface ResendEvent {
  type?: string
  created_at?: string
  data?: {
    email_id?: string
    to?: string[] | string
    from?: string
    subject?: string
    [k: string]: unknown
  }
}

function extractRecipients(evt: ResendEvent): string[] {
  const to = evt?.data?.to
  if (!to) return []
  if (Array.isArray(to)) return to.filter((s): s is string => typeof s === 'string')
  if (typeof to === 'string') return [to]
  return []
}

// ──────────────────────────────────────────────────────────────────────────
// Bounce handler — null out the email so we stop sending, stamp bouncedAt,
// and drop a ReviewQueue row so the enrichment agent re-researches the
// founder on its next pass.
// ──────────────────────────────────────────────────────────────────────────
async function handleBounce(opts: {
  recipient: string
  eventType: string // 'email.bounced' | 'email.complained'
  rawEvent: ResendEvent
  severity: 'INFO' | 'WARN' | 'CRITICAL'
}): Promise<{ updated: number }> {
  const { recipient, eventType, rawEvent, severity } = opts

  // Prospect lookup is by exact email match — case-insensitive to be safe,
  // since email casing isn't normalized on insert.
  const prospects: Array<{ id: string; companyName: string }> =
    await prisma.$queryRawUnsafe(
      `SELECT "id", "companyName" FROM "Prospect" WHERE LOWER("email") = LOWER($1) LIMIT 25`,
      recipient
    )

  if (prospects.length === 0) {
    // Still audit — operators should see bounces for unknown recipients
    // (could be a Builder-side address, a stale lead from another source, etc.)
    await logAudit({
      staffId: 'system',
      action: 'BOUNCE_RECEIVED',
      entity: 'Prospect',
      entityId: undefined,
      details: {
        recipient,
        eventType,
        match: 'no_prospect_found',
        emailId: rawEvent?.data?.email_id ?? null,
      },
      severity,
    })
    return { updated: 0 }
  }

  let updated = 0
  for (const p of prospects) {
    try {
      await prisma.$executeRawUnsafe(
        `UPDATE "Prospect"
         SET "bouncedAt" = NOW(), "email" = NULL, "updatedAt" = NOW()
         WHERE "id" = $1`,
        p.id
      )

      // Drop into ReviewQueue so a human (or the enrichment cron) re-researches.
      // ReviewQueue.id is a cuid() default in the schema, but $executeRawUnsafe
      // bypasses Prisma defaults — generate one inline.
      const reviewId =
        'rq' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
      await prisma.$executeRawUnsafe(
        `INSERT INTO "ReviewQueue"
           ("id", "entityType", "entityId", "reason", "summary", "status", "createdAt")
         VALUES ($1, $2, $3, $4, $5, 'PENDING', NOW())`,
        reviewId,
        'BOUNCE_RECHECK',
        p.id,
        eventType === 'email.complained' ? 'email_complained' : 'email_bounced',
        `${eventType} for ${p.companyName}: ${recipient}`
      )

      await logAudit({
        staffId: 'system',
        action: 'BOUNCE_RECEIVED',
        entity: 'Prospect',
        entityId: p.id,
        details: {
          recipient,
          eventType,
          companyName: p.companyName,
          emailId: rawEvent?.data?.email_id ?? null,
          reviewQueueId: reviewId,
        },
        severity,
      })

      updated++
    } catch (e) {
      logger.error('resend_bounce_apply_failed', e, {
        prospectId: p.id,
        recipient,
      })
    }
  }

  return { updated }
}

// ──────────────────────────────────────────────────────────────────────────
// POST handler
// ──────────────────────────────────────────────────────────────────────────
export async function POST(request: NextRequest) {
  const rawBody = await request.text()
  const svixId = request.headers.get('svix-id')
  const svixTimestamp = request.headers.get('svix-timestamp')
  const svixSignature = request.headers.get('svix-signature')

  const secret = process.env.RESEND_WEBHOOK_SECRET
  if (!secret) {
    // Configuration error, not a payload error. 401 (not 500) so the
    // provider's dashboard makes the cause obvious.
    logger.error(
      'resend_webhook_secret_missing',
      new Error('RESEND_WEBHOOK_SECRET not set'),
      {}
    )
    return NextResponse.json(
      { error: 'webhook_secret_not_configured' },
      { status: 401 }
    )
  }

  const verify = verifySvixSignature({
    id: svixId,
    timestamp: svixTimestamp,
    signatureHeader: svixSignature,
    rawBody,
    secret,
  })

  if (!verify.ok) {
    // Security event — log every rejection so brute-force attempts surface.
    logger.warn('resend_webhook_signature_invalid', {
      reason: verify.reason,
      svixId,
      hasSignatureHeader: Boolean(svixSignature),
    })
    return NextResponse.json(
      { error: 'invalid_signature', reason: verify.reason },
      { status: 401 }
    )
  }

  // Parse after verification — never trust pre-verified bytes.
  let event: ResendEvent
  try {
    event = JSON.parse(rawBody) as ResendEvent
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }

  const eventType = event.type ?? 'unknown'

  // Idempotency — svix-id is guaranteed unique per delivery.
  // Casting is safe because verify.ok already checked svixId is non-null.
  const idem = await ensureIdempotent('resend', svixId as string, eventType, event)
  if (idem.status === 'duplicate') {
    return NextResponse.json({ received: true, processed: false, duplicate: true })
  }

  try {
    if (eventType === 'email.bounced' || eventType === 'email.complained') {
      const recipients = extractRecipients(event)
      if (recipients.length === 0) {
        // Malformed but valid signature — record and 200 to stop retries.
        await logAudit({
          staffId: 'system',
          action: 'BOUNCE_RECEIVED',
          entity: 'Prospect',
          entityId: undefined,
          details: {
            eventType,
            error: 'no_recipient_in_payload',
            emailId: event?.data?.email_id ?? null,
          },
          severity: 'WARN',
        })
      } else {
        const severity: 'WARN' = 'WARN'
        for (const recipient of recipients) {
          await handleBounce({
            recipient,
            eventType,
            rawEvent: event,
            severity,
          })
        }
      }
    }
    // Other event types (delivered, opened, clicked, etc.) — no-op success.
    // We still record receipt via the WebhookEvent dedupe row above.

    await markWebhookProcessed(idem.id)
    return NextResponse.json({ received: true, processed: true })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    logger.error('resend_webhook_processing_failed', err, {
      eventType,
      svixId,
    })
    await markWebhookFailed(idem.id, msg)
    // Still 200 — see file-level note. Resend's retries shouldn't paper over
    // our own bugs; the WebhookEvent row drives our retry cron instead.
    return NextResponse.json({
      received: true,
      processed: false,
      error: msg.slice(0, 200),
    })
  }
}
