/**
 * Resend client — consolidated email sender for Aegis.
 *
 * This is the NEW scaffold intended for future email callsites. Existing
 * callsites in `src/lib/email.ts`, `src/lib/email/*`, `src/lib/digest-email.ts`,
 * etc. continue to work unchanged. See `docs/EMAIL-INVENTORY.md` for the
 * migration map.
 *
 * Design notes
 * ────────────
 * • The `resend` npm package is NOT installed in this repo (see package.json);
 *   the existing `src/lib/email.ts` uses the raw Resend REST API via fetch
 *   and it works fine. We follow the same approach so we add zero new
 *   dependencies. If/when the package lands, the shape of sendEmail here
 *   (returning { ok, id, error }) will survive a drop-in swap.
 * • `getResend()` is exported as a singleton accessor for call-sites that
 *   want to reach for the package directly once it's installed. Until then
 *   it returns a lightweight adapter that exposes `.emails.send(...)` with
 *   the same surface the real SDK uses, so downstream code can be written
 *   against the final shape today.
 * • All sends go through `logAudit()` — success and failure — against
 *   the `email_send` entity. This mirrors Wave-1 audit conventions
 *   (entity column, not entityType; see `@/lib/audit`).
 */

import { logAudit } from '@/lib/audit'
import { logger } from '@/lib/logger'

// ─── Config ────────────────────────────────────────────────────────────────

const RESEND_API_URL = 'https://api.resend.com/emails'

function getApiKey(): string | null {
  const key = process.env.RESEND_API_KEY
  return key && key.length > 0 ? key : null
}

function getDefaultFrom(): string {
  return process.env.DEFAULT_FROM_EMAIL || 'noreply@abellumber.com'
}

// ─── Singleton client adapter ──────────────────────────────────────────────
//
// Shape intentionally mirrors the real `resend` SDK:
//   const r = new Resend(apiKey); await r.emails.send({...})
// so any future migration to the installed package is a one-line swap.

export interface ResendSendArgs {
  from: string
  to: string | string[]
  subject: string
  html?: string
  text?: string
  react?: unknown
  headers?: Record<string, string>
  tags?: Array<{ name: string; value: string }>
  reply_to?: string | string[]
}

export interface ResendSendResponse {
  data: { id: string } | null
  error: { name?: string; message: string } | null
}

export interface ResendLikeClient {
  emails: {
    send(args: ResendSendArgs): Promise<ResendSendResponse>
  }
}

let clientSingleton: ResendLikeClient | null = null

/**
 * Get (or lazily create) the Resend client singleton.
 *
 * Returns a client whose `.emails.send()` calls the Resend REST API directly.
 * If `RESEND_API_KEY` is missing the call still resolves — with an error
 * payload — so callers never have to catch.
 */
export function getResend(): ResendLikeClient {
  if (clientSingleton) return clientSingleton

  clientSingleton = {
    emails: {
      async send(args: ResendSendArgs): Promise<ResendSendResponse> {
        const apiKey = getApiKey()
        if (!apiKey) {
          return {
            data: null,
            error: { name: 'config_error', message: 'RESEND_API_KEY not set' },
          }
        }

        // The raw REST API uses `reply_to` (snake_case) not `replyTo`.
        const payload: Record<string, unknown> = {
          from: args.from,
          to: args.to,
          subject: args.subject,
        }
        if (args.html !== undefined) payload.html = args.html
        if (args.text !== undefined) payload.text = args.text
        if (args.headers) payload.headers = args.headers
        if (args.tags) payload.tags = args.tags
        if (args.reply_to) payload.reply_to = args.reply_to

        try {
          const res = await fetch(RESEND_API_URL, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${apiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload),
          })
          const body: any = await res.json().catch(() => ({}))
          if (!res.ok) {
            return {
              data: null,
              error: {
                name: body?.name || 'send_error',
                message: body?.message || `Resend API ${res.status}`,
              },
            }
          }
          return { data: { id: String(body?.id ?? '') }, error: null }
        } catch (e: any) {
          return {
            data: null,
            error: { name: 'network_error', message: e?.message || String(e) },
          }
        }
      },
    },
  }
  return clientSingleton
}

// ─── sendEmail — thin wrapper with audit + tag plumbing ────────────────────

export interface SendEmailArgs {
  to: string | string[]
  subject: string
  from?: string
  react?: unknown
  html?: string
  text?: string
  headers?: Record<string, string>
  tags?: Array<{ name: string; value: string }>
  replyTo?: string | string[]
  /**
   * Optional staff ID to attribute the send to in the audit log. Defaults
   * to 'system' for cron/webhook contexts.
   */
  staffId?: string
  /**
   * Optional entityId to correlate the email with a business record
   * (invoice ID, delivery ID, PO ID, etc.).
   */
  entityId?: string
}

export interface SendEmailOk {
  ok: true
  id: string
}
export interface SendEmailFail {
  ok: false
  error: string
}
export type SendEmailResult = SendEmailOk | SendEmailFail

/**
 * Send an email via Resend. Never throws — always returns a result object.
 *
 * Always:
 *   • sets `from` to DEFAULT_FROM_EMAIL (or 'noreply@abellumber.com') unless
 *     explicitly provided.
 *   • merges caller-supplied tags with a leading `source=aegis` tag, so
 *     Resend's dashboard can filter for our traffic.
 *   • writes an AuditLog row under entity:'email_send', action:'SEND' on
 *     success or 'FAIL' on failure. Audit failure is swallowed — email
 *     sending is the user-visible behavior and must not be blocked by an
 *     audit hiccup.
 */
export async function sendEmail(args: SendEmailArgs): Promise<SendEmailResult> {
  // ── EMAILS_GLOBAL_KILL — launch-day insurance switch ──────────────────────
  // Mirrors the gate in src/lib/email.ts. Set EMAILS_GLOBAL_KILL=true in
  // Vercel to silence every outbound email regardless of per-feature gates.
  if (process.env.EMAILS_GLOBAL_KILL === 'true') {
    logger.warn('email_global_kill_active', { subject: args.subject, to: args.to })
    return {
      ok: false,
      error: 'EMAILS_GLOBAL_KILL=true — outbound email suppressed',
    }
  }

  const from = args.from || getDefaultFrom()
  const baseTags: Array<{ name: string; value: string }> = [
    { name: 'source', value: 'aegis' },
  ]
  const tags = [...baseTags, ...(args.tags || [])]

  // At least one body channel must be present. We don't throw — we surface
  // the misuse as a structured error so callers can log + move on.
  if (!args.html && !args.text && !args.react) {
    const err = 'sendEmail called with no html/text/react body'
    logger.warn('resend_send_no_body', { subject: args.subject, to: args.to })
    await auditSafe({
      staffId: args.staffId,
      action: 'FAIL',
      entityId: args.entityId,
      details: { to: args.to, subject: args.subject, error: err },
    })
    return { ok: false, error: err }
  }

  const client = getResend()

  const sendArgs: ResendSendArgs = {
    from,
    to: args.to,
    subject: args.subject,
    html: args.html,
    text: args.text,
    react: args.react,
    headers: args.headers,
    tags,
  }
  if (args.replyTo) sendArgs.reply_to = args.replyTo

  let response: ResendSendResponse
  try {
    response = await client.emails.send(sendArgs)
  } catch (e: any) {
    // The adapter above never throws, but a future real-SDK swap might.
    // Defensive catch so the contract ("never throws") holds.
    const msg = e?.message || String(e)
    // eslint-disable-next-line no-console
    console.error('[resend] unexpected throw from client.emails.send', msg)
    logger.error('resend_unexpected_throw', e, { subject: args.subject })
    await auditSafe({
      staffId: args.staffId,
      action: 'FAIL',
      entityId: args.entityId,
      details: { to: args.to, subject: args.subject, error: msg },
    })
    return { ok: false, error: msg }
  }

  if (response.error || !response.data) {
    const msg = response.error?.message || 'unknown error'
    // eslint-disable-next-line no-console
    console.error('[resend] send failed', msg, { to: args.to, subject: args.subject })
    // Wrap in a real Error so logger.error's stack-extraction path works.
    logger.error('resend_send_failed', new Error(msg), {
      to: args.to,
      subject: args.subject,
      name: response.error?.name,
    })
    await auditSafe({
      staffId: args.staffId,
      action: 'FAIL',
      entityId: args.entityId,
      details: { to: args.to, subject: args.subject, error: msg },
    })
    return { ok: false, error: msg }
  }

  await auditSafe({
    staffId: args.staffId,
    action: 'SEND',
    entityId: args.entityId,
    details: {
      to: args.to,
      subject: args.subject,
      messageId: response.data.id,
      tags: tags.map((t) => `${t.name}:${t.value}`),
    },
  })
  return { ok: true, id: response.data.id }
}

// ─── Helpers ───────────────────────────────────────────────────────────────

async function auditSafe(params: {
  staffId?: string
  action: 'SEND' | 'FAIL'
  entityId?: string
  details: Record<string, any>
}): Promise<void> {
  try {
    await logAudit({
      staffId: params.staffId || 'system',
      action: params.action,
      entity: 'email_send',
      entityId: params.entityId,
      details: params.details,
      severity: params.action === 'FAIL' ? 'WARN' : 'INFO',
    })
  } catch {
    // logAudit already swallows + logs internally; this is a second belt
    // in case the import shape ever drifts.
  }
}
