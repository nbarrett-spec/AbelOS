/**
 * Cron failure alerting.
 *
 * Emails Nate + Clint whenever a cron run transitions to FAILURE, rate-limited
 * to one email per (cronName, 1-hour window) so a failing-in-a-loop cron
 * doesn't turn into an inbox flood.
 *
 * Wired from src/lib/cron.ts::finishCronRun() — catches every cron whether it
 * uses the withCronRun() wrapper or calls startCronRun/finishCronRun directly.
 *
 * ─── Rationale ─────────────────────────────────────────────────────────────
 * Hyphen and Gmail crons failed every 15 minutes from 2026-04-21 until
 * triage on 2026-04-23. Nobody noticed because failures only existed as rows
 * in the CronRun table. This module fixes the "silent failure" gap.
 *
 * ─── Rate-limit strategy ───────────────────────────────────────────────────
 * Upstash Redis with SETNX-style ttl=3600. Key: `cron-alert:{cronName}`.
 * If Redis is unreachable we fall back to a process-local Map so at least
 * a single Lambda warm-instance won't double-fire. Can still spam across
 * cold starts in that degraded state — acceptable tradeoff since the base
 * case (Redis up) is the one that holds at scale.
 *
 * ─── Recipients ────────────────────────────────────────────────────────────
 * Env override: CRON_FAILURE_NOTIFY_EMAILS (comma-separated). Default:
 * n.barrett + c.vinson — matches Nate's expectation in the task brief and
 * ensures the alert goes out even before the Vercel env var is set.
 *
 * ─── Sentry ────────────────────────────────────────────────────────────────
 * If @sentry/nextjs is configured (SENTRY_DSN set), we also captureException()
 * so the same failure shows up in Sentry's issue feed. Best-effort; never
 * blocks the email path.
 *
 * ─── Fault isolation ──────────────────────────────────────────────────────
 * Every branch swallows its own errors. finishCronRun must not break because
 * alerting is sick — the cron's actual business work has already completed
 * (or failed and is about to be re-thrown) by the time we're called.
 */

import { sendEmail } from '@/lib/email'
import { logger } from '@/lib/logger'
import { prisma } from '@/lib/prisma'
import { getRedis } from '@/lib/redis'

const DEFAULT_RECIPIENTS = [
  'n.barrett@abellumber.com',
  'c.vinson@abellumber.com',
]

const RATE_LIMIT_SECONDS = 3600 // 1 hour

// Process-local fallback when Redis is down. Map<cronName, expiresAtMs>.
// Leaks memory only in pathological cases (hundreds of distinct cron names
// per instance) which isn't our shape — REGISTERED_CRONS has ~25 entries.
const localRateLimit = new Map<string, number>()

function parseRecipients(): string[] {
  const raw = process.env.CRON_FAILURE_NOTIFY_EMAILS
  if (!raw || !raw.trim()) return DEFAULT_RECIPIENTS
  const parsed = raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s.includes('@'))
  return parsed.length > 0 ? parsed : DEFAULT_RECIPIENTS
}

/**
 * Check-and-claim a rate limit slot. Returns true if this caller should send,
 * false if a recent alert already went out.
 *
 * Redis path uses SET NX with EX=3600 so claim-and-set is atomic across
 * concurrent Lambdas. Fallback path uses an in-process Map with a compare-
 * and-swap that's only correct within a single instance.
 */
async function claimRateLimit(cronName: string): Promise<boolean> {
  const key = `cron-alert:${cronName}`
  const redis = getRedis()
  if (redis) {
    try {
      // Upstash typing: set with `nx: true` returns 'OK' on claim, null if exists.
      const res = await redis.set(key, Date.now().toString(), {
        nx: true,
        ex: RATE_LIMIT_SECONDS,
      })
      return res === 'OK'
    } catch (e: any) {
      // Redis hiccup — fall through to local fallback.
      logger.warn('cron_alert_redis_failed', { cronName, error: e?.message })
    }
  }
  // Local fallback: only blocks duplicates within a single warm Lambda.
  const now = Date.now()
  const existing = localRateLimit.get(cronName) ?? 0
  if (existing > now) return false
  localRateLimit.set(cronName, now + RATE_LIMIT_SECONDS * 1000)
  // Garbage-collect expired entries opportunistically.
  if (localRateLimit.size > 100) {
    for (const [k, exp] of localRateLimit.entries()) {
      if (exp <= now) localRateLimit.delete(k)
    }
  }
  return true
}

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function renderFailureEmail(params: {
  cronName: string
  error: string
  durationMs: number
  runId: string
  timestamp: Date
}): string {
  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL ||
    (process.env.NODE_ENV === 'production'
      ? 'https://app.abellumber.com'
      : 'http://localhost:3000')
  const safeName = escapeHtml(params.cronName)
  const safeErr = escapeHtml(params.error.slice(0, 2000))
  const safeRunId = escapeHtml(params.runId)
  const ts = params.timestamp.toISOString()
  const durSec = Math.round(params.durationMs / 1000)
  return `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:640px;margin:0 auto;padding:24px;background:#fff;">
      <div style="background:#991b1b;color:#fff;padding:16px 20px;border-radius:8px 8px 0 0;">
        <div style="font-size:12px;letter-spacing:0.08em;text-transform:uppercase;opacity:0.85;">Cron failure</div>
        <div style="font-size:20px;font-weight:700;margin-top:4px;font-family:ui-monospace,monospace;">${safeName}</div>
      </div>
      <div style="border:1px solid #fecaca;border-top:none;border-radius:0 0 8px 8px;padding:20px;">
        <table style="font-size:13px;width:100%;border-collapse:collapse;color:#374151;">
          <tr><td style="padding:4px 0;color:#6b7280;width:130px;">Cron</td><td style="font-family:ui-monospace,monospace;">${safeName}</td></tr>
          <tr><td style="padding:4px 0;color:#6b7280;">Failed at</td><td>${ts}</td></tr>
          <tr><td style="padding:4px 0;color:#6b7280;">Run duration</td><td>${durSec}s</td></tr>
          <tr><td style="padding:4px 0;color:#6b7280;">Run ID</td><td style="font-family:ui-monospace,monospace;">${safeRunId}</td></tr>
        </table>
        <div style="margin-top:16px;padding:12px;background:#fef2f2;border-left:3px solid #dc2626;font-size:12px;font-family:ui-monospace,monospace;color:#7f1d1d;white-space:pre-wrap;word-break:break-word;">${safeErr}</div>
        <div style="margin-top:20px;">
          <a href="${appUrl}/admin/crons" style="display:inline-block;padding:10px 18px;background:#dc2626;color:#fff;text-decoration:none;border-radius:6px;font-weight:600;font-size:14px;">View cron observability</a>
        </div>
        <div style="margin-top:16px;font-size:11px;color:#9ca3af;line-height:1.5;">
          You're receiving this because cron-alerting is enabled (CRON_FAILURE_NOTIFY_EMAILS or default recipients).
          Rate-limited to one email per cron per hour — if this job is failing in a loop, you won't hear about it again until ${new Date(Date.now() + RATE_LIMIT_SECONDS * 1000).toISOString()}.
        </div>
      </div>
    </div>
  `.trim()
}

/**
 * Best-effort Sentry capture. Imports the SDK dynamically so this module
 * stays useful in environments without @sentry/nextjs wired up.
 */
async function tryCaptureSentry(cronName: string, error: string, runId: string): Promise<void> {
  if (!process.env.SENTRY_DSN && !process.env.NEXT_PUBLIC_SENTRY_DSN) return
  try {
    const Sentry = await import('@sentry/nextjs')
    Sentry.captureException(new Error(`Cron ${cronName} failed: ${error.slice(0, 500)}`), {
      tags: { cron: cronName, runId },
      level: 'error',
    })
  } catch {
    // swallow — Sentry capture is strictly supplemental
  }
}

/**
 * Best-effort InboxItem write so the failure also surfaces in /ops/inbox
 * and the admin dashboard, not just an email. Type=SYSTEM matches the
 * existing convention used by data-quality, cron-history-audit, and
 * workflows.ts. Severity HIGH because a daily-cash-position cron going
 * silent is the exact "looked healthy yesterday, silently stopped today"
 * shape from the cron.ts module header.
 *
 * Not rate-limited at this layer because the email-side rate limit has
 * already gated us. If we got here, this is the first failure of the hour.
 */
async function writeInboxItem(params: {
  cronName: string
  error: string
  durationMs: number
  runId: string
}): Promise<void> {
  try {
    const appUrl =
      process.env.NEXT_PUBLIC_APP_URL ||
      (process.env.NODE_ENV === 'production'
        ? 'https://app.abellumber.com'
        : 'http://localhost:3000')
    await prisma.inboxItem.create({
      data: {
        type: 'SYSTEM',
        source: 'cron-alerting',
        title: `[Cron Failed] ${params.cronName}`,
        description:
          `${params.cronName} failed after ${Math.round(params.durationMs / 1000)}s.\n\n` +
          `Error: ${params.error.slice(0, 1000)}\n\n` +
          `Run ID: ${params.runId}\n` +
          `Logs: ${appUrl}/admin/crons`,
        priority: 'HIGH',
        entityType: 'CronRun',
        entityId: params.runId,
        actionData: {
          cronName: params.cronName,
          runId: params.runId,
          durationMs: params.durationMs,
          error: params.error.slice(0, 2000),
        } as any,
      },
    })
  } catch (e: any) {
    logger.error('cron_alert_inbox_failed', e, {
      cronName: params.cronName,
      runId: params.runId,
    })
  }
}

/**
 * Fire alerts for a failed cron run. Called from finishCronRun() when
 * status transitions to FAILURE. Never throws.
 */
export async function notifyCronFailure(params: {
  cronName: string
  error: string
  durationMs: number
  runId: string
}): Promise<void> {
  const { cronName, error, durationMs, runId } = params
  try {
    // Kick off Sentry capture in parallel — it doesn't gate on the rate limit
    // because Sentry has its own dedup/grouping and we want every failure
    // represented there even if the email was suppressed.
    tryCaptureSentry(cronName, error, runId).catch(() => {})

    const shouldSend = await claimRateLimit(cronName)
    if (!shouldSend) {
      logger.info('cron_alert_rate_limited', { cronName, runId })
      return
    }

    // InboxItem write also gated by rate limit so a failing-in-a-loop cron
    // doesn't fill /ops/inbox with hundreds of duplicates. One inbox row +
    // one email per (cron, hour) is the right shape — matches operator
    // expectation that the inbox is a curated worklist, not a firehose.
    writeInboxItem({ cronName, error, durationMs, runId }).catch(() => {})

    const recipients = parseRecipients()
    if (recipients.length === 0) {
      logger.warn('cron_alert_no_recipients', { cronName, runId })
      return
    }

    const html = renderFailureEmail({
      cronName,
      error,
      durationMs,
      runId,
      timestamp: new Date(),
    })
    const subject = `[CRON FAILED] ${cronName}`

    let successCount = 0
    const failures: Array<{ to: string; error?: string }> = []
    for (const to of recipients) {
      const result = await sendEmail({ to, subject, html })
      if (result.success) {
        successCount += 1
      } else {
        failures.push({ to, error: result.error })
      }
    }

    if (successCount === 0) {
      // Every recipient failed — log loudly. Next failure in the same hour
      // will re-fire because the rate-limit claim is already spent; this is
      // the lesser evil vs. retrying and potentially spamming.
      logger.error('cron_alert_send_failed', new Error('all recipients failed'), {
        cronName,
        runId,
        failures,
      })
    } else {
      logger.info('cron_alert_sent', {
        cronName,
        runId,
        recipients: successCount,
        total: recipients.length,
      })
    }
  } catch (e: any) {
    // Absolute last-resort guard. Never propagate — the caller already has
    // a failure to re-throw; we must not double-fault on top of that.
    logger.error('cron_alert_dispatch_failed', e, { cronName, runId })
  }
}
