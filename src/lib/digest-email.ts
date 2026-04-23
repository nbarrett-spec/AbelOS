/**
 * Daily Digest Sender
 *
 * Responsible for turning a composed digest into a Resend send + an
 * EmailSendLog row. Handles all the guardrails the composer shouldn't
 * care about:
 *   - RESEND_API_KEY missing → skip, return status instead of throwing
 *   - staff email is null / invalid → skip
 *   - staff.preferences.digestOptOut === true → skip
 *   - digest has zero meaningful items → skip (don't spam)
 *   - already sent today (EmailSendLog idempotency) → skip
 *   - dryRun → compose + log "would send", but don't hit Resend
 *
 * EmailSendLog is lazily created on first use (same pattern as CronRun)
 * so this works without a migration.
 */

import { composeDigestForStaff, isDigestEmpty } from '@/lib/digest-composer'
import { sendEmail } from '@/lib/email'
import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'

// ──────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────

export type DigestSendStatus =
  | 'SENT'
  | 'SKIPPED_OPTOUT'
  | 'SKIPPED_EMPTY'
  | 'SKIPPED_DUPLICATE'
  | 'SKIPPED_NO_EMAIL'
  | 'SKIPPED_NO_API_KEY'
  | 'SKIPPED_DRY_RUN'
  | 'FAILED'

export interface DigestSendResult {
  staffId: string
  staffEmail: string | null
  status: DigestSendStatus
  totalItems: number
  messageId?: string
  error?: string
  digestDate: string
}

// ──────────────────────────────────────────────────────────────────────────
// EmailSendLog — lazy-created table
//
// We keep this minimal and not in the Prisma schema (avoids churning
// migrations while the feature settles). If it grows into a primary audit
// surface we can promote it to a proper model later.
// ──────────────────────────────────────────────────────────────────────────

let sendLogTableReady = false

async function ensureEmailSendLogTable(): Promise<void> {
  if (sendLogTableReady) return
  try {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "EmailSendLog" (
        "id" TEXT PRIMARY KEY,
        "kind" TEXT NOT NULL,
        "staffId" TEXT,
        "toEmail" TEXT,
        "subject" TEXT,
        "status" TEXT NOT NULL,
        "messageId" TEXT,
        "error" TEXT,
        "metadata" JSONB,
        "digestDate" TEXT,
        "sentAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `)
    await prisma.$executeRawUnsafe(
      `CREATE INDEX IF NOT EXISTS "idx_emailsendlog_staff_kind_date" ON "EmailSendLog" ("staffId", "kind", "digestDate")`,
    )
    await prisma.$executeRawUnsafe(
      `CREATE INDEX IF NOT EXISTS "idx_emailsendlog_sent" ON "EmailSendLog" ("sentAt" DESC)`,
    )
    sendLogTableReady = true
  } catch (e) {
    // Swallow and continue — we'd rather send the email than crash the cron
    // because a DDL blip kept us from creating an audit table.
    sendLogTableReady = true
    logger.warn('emailsendlog_table_ensure_failed', { err: (e as Error).message })
  }
}

async function hasBeenSentToday(
  staffId: string,
  digestDate: string,
): Promise<boolean> {
  await ensureEmailSendLogTable()
  try {
    const rows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT id FROM "EmailSendLog"
        WHERE "staffId" = $1
          AND "kind" = 'daily_digest'
          AND "digestDate" = $2
          AND status IN ('SENT','SKIPPED_DRY_RUN')
        LIMIT 1`,
      staffId,
      digestDate,
    )
    return rows.length > 0
  } catch {
    // If the idempotency check itself fails, bias toward NOT sending a
    // duplicate: treat the read failure as "already sent". Better to miss
    // one day than pound someone's inbox on a retry loop.
    return true
  }
}

async function writeSendLog(result: DigestSendResult, subject: string | null): Promise<void> {
  await ensureEmailSendLogTable()
  try {
    const id =
      'esl' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
    await prisma.$executeRawUnsafe(
      `INSERT INTO "EmailSendLog"
         ("id","kind","staffId","toEmail","subject","status","messageId","error","digestDate","metadata")
       VALUES ($1,'daily_digest',$2,$3,$4,$5,$6,$7,$8,$9::jsonb)`,
      id,
      result.staffId,
      result.staffEmail,
      subject,
      result.status,
      result.messageId || null,
      result.error || null,
      result.digestDate,
      JSON.stringify({ totalItems: result.totalItems }),
    )
  } catch (e) {
    logger.warn('emailsendlog_write_failed', {
      staffId: result.staffId,
      status: result.status,
      err: (e as Error).message,
    })
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Email validation — basic RFC-ish. The production `email.ts` already
// fails gracefully on Resend-side validation errors, but we short-circuit
// obviously bad addresses so we don't burn API credits on noise.
// ──────────────────────────────────────────────────────────────────────────

function isEmailValid(e: string | null | undefined): boolean {
  if (!e) return false
  if (e.length > 254) return false
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)
}

// ──────────────────────────────────────────────────────────────────────────
// Opt-out check — pulls directly from Staff.preferences (the same JSON
// column the /api/ops/staff/preferences endpoint writes to).
// ──────────────────────────────────────────────────────────────────────────

function isOptedOut(preferences: unknown): boolean {
  if (!preferences || typeof preferences !== 'object') return false
  const p = preferences as Record<string, unknown>
  return p.digestOptOut === true
}

// ──────────────────────────────────────────────────────────────────────────
// Main entry point
//
// Idempotent: same staffId + same CT date won't double-send. `dryRun` logs
// the intent but never calls Resend — used by the admin preview flow.
// ──────────────────────────────────────────────────────────────────────────

export async function sendDigest(
  staffId: string,
  opts: { dryRun?: boolean; allowDuplicate?: boolean } = {},
): Promise<DigestSendResult> {
  const { dryRun = false, allowDuplicate = false } = opts

  // Load just the fields we need for the pre-compose guards. The composer
  // will do its own load too — cheap, and keeps both call sites standalone.
  const staffModel = (prisma as unknown as {
    staff: {
      findUnique: (args: unknown) => Promise<any>
    }
  }).staff
  const staff: {
    id: string
    email: string | null
    active: boolean
    preferences: unknown
  } | null = await staffModel.findUnique({
    where: { id: staffId },
    select: { id: true, email: true, active: true, preferences: true },
  })

  if (!staff || !staff.active) {
    const result: DigestSendResult = {
      staffId,
      staffEmail: staff?.email ?? null,
      status: 'SKIPPED_NO_EMAIL',
      totalItems: 0,
      digestDate: new Date().toISOString().slice(0, 10),
    }
    return result
  }

  if (!isEmailValid(staff.email)) {
    const result: DigestSendResult = {
      staffId,
      staffEmail: staff.email ?? null,
      status: 'SKIPPED_NO_EMAIL',
      totalItems: 0,
      digestDate: new Date().toISOString().slice(0, 10),
    }
    await writeSendLog(result, null)
    return result
  }

  if (isOptedOut(staff.preferences)) {
    const result: DigestSendResult = {
      staffId,
      staffEmail: staff.email,
      status: 'SKIPPED_OPTOUT',
      totalItems: 0,
      digestDate: new Date().toISOString().slice(0, 10),
    }
    await writeSendLog(result, null)
    return result
  }

  // Compose — can be null if staff vanished between the two loads.
  const digest = await composeDigestForStaff(staffId)
  if (!digest) {
    const result: DigestSendResult = {
      staffId,
      staffEmail: staff.email,
      status: 'SKIPPED_NO_EMAIL',
      totalItems: 0,
      digestDate: new Date().toISOString().slice(0, 10),
    }
    await writeSendLog(result, null)
    return result
  }

  if (isDigestEmpty(digest)) {
    const result: DigestSendResult = {
      staffId,
      staffEmail: digest.staffEmail,
      status: 'SKIPPED_EMPTY',
      totalItems: 0,
      digestDate: digest.digestDate,
    }
    await writeSendLog(result, digest.subject)
    return result
  }

  // Idempotency — don't fire twice on the same day. The "Send test" button
  // on the admin preview page bypasses this via allowDuplicate.
  if (!allowDuplicate && (await hasBeenSentToday(staffId, digest.digestDate))) {
    const result: DigestSendResult = {
      staffId,
      staffEmail: digest.staffEmail,
      status: 'SKIPPED_DUPLICATE',
      totalItems: digest.totalItems,
      digestDate: digest.digestDate,
    }
    // No log write — we already have one from the original send. Logging
    // the duplicate check would inflate the table with empty rows.
    return result
  }

  // Dry run path — used by preview/test. Still logs so the admin UI can
  // see that "nothing was actually sent but this is what would have gone".
  if (dryRun) {
    const result: DigestSendResult = {
      staffId,
      staffEmail: digest.staffEmail,
      status: 'SKIPPED_DRY_RUN',
      totalItems: digest.totalItems,
      digestDate: digest.digestDate,
    }
    await writeSendLog(result, digest.subject)
    return result
  }

  // Graceful skip if API key is missing — cron should still return 200
  // instead of 500 so Vercel doesn't retry in a loop.
  if (!process.env.RESEND_API_KEY) {
    const result: DigestSendResult = {
      staffId,
      staffEmail: digest.staffEmail,
      status: 'SKIPPED_NO_API_KEY',
      totalItems: digest.totalItems,
      digestDate: digest.digestDate,
    }
    await writeSendLog(result, digest.subject)
    return result
  }

  const send = await sendEmail({
    to: digest.staffEmail,
    subject: digest.subject,
    html: digest.htmlBody,
  })

  const result: DigestSendResult = {
    staffId,
    staffEmail: digest.staffEmail,
    status: send.success ? 'SENT' : 'FAILED',
    totalItems: digest.totalItems,
    messageId: send.id,
    error: send.error,
    digestDate: digest.digestDate,
  }
  await writeSendLog(result, digest.subject)
  return result
}

// ──────────────────────────────────────────────────────────────────────────
// Throttle helper for the cron — Resend free-tier allows 10 emails/second;
// we cap at 5/sec to leave headroom for other transactional mail (quote
// ready, collections, etc.) that might fire concurrently.
// ──────────────────────────────────────────────────────────────────────────

export async function throttle(
  fn: () => Promise<unknown>,
  perSecond: number,
): Promise<void> {
  const intervalMs = Math.ceil(1000 / perSecond)
  await fn()
  await new Promise((r) => setTimeout(r, intervalMs))
}
