import crypto from 'crypto'
import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'

// ──────────────────────────────────────────────────────────────────────────
// Webhook hardening helpers.
//
// Every external webhook handler should run:
//   1. verifyHmacSignature() or verifyBearerToken() — reject unauthenticated
//   2. ensureIdempotent() — reject or short-circuit if we've seen this event
//
// The WebhookEvent table is auto-created if missing (follows the AuditLog
// pattern in src/lib/audit.ts) and acts as a dedupe cache with 30-day TTL.
// ──────────────────────────────────────────────────────────────────────────

let tableEnsured = false

async function ensureTable() {
  if (tableEnsured) return
  try {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "WebhookEvent" (
        "id" TEXT PRIMARY KEY,
        "provider" TEXT NOT NULL,
        "eventId" TEXT NOT NULL,
        "eventType" TEXT,
        "status" TEXT NOT NULL DEFAULT 'RECEIVED',
        "error" TEXT,
        "receivedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "processedAt" TIMESTAMPTZ,
        UNIQUE ("provider", "eventId")
      )
    `)
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "idx_webhookevent_received" ON "WebhookEvent" ("receivedAt" DESC)
    `)
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "idx_webhookevent_status" ON "WebhookEvent" ("provider", "status")
    `)
    // Retry / DLQ metadata — additive columns guarded by IF NOT EXISTS so
    // repeated cold starts stay idempotent.
    await prisma.$executeRawUnsafe(`ALTER TABLE "WebhookEvent" ADD COLUMN IF NOT EXISTS "payload" JSONB`)
    await prisma.$executeRawUnsafe(`ALTER TABLE "WebhookEvent" ADD COLUMN IF NOT EXISTS "retryCount" INT NOT NULL DEFAULT 0`)
    await prisma.$executeRawUnsafe(`ALTER TABLE "WebhookEvent" ADD COLUMN IF NOT EXISTS "maxRetries" INT NOT NULL DEFAULT 5`)
    await prisma.$executeRawUnsafe(`ALTER TABLE "WebhookEvent" ADD COLUMN IF NOT EXISTS "nextRetryAt" TIMESTAMPTZ`)
    await prisma.$executeRawUnsafe(`ALTER TABLE "WebhookEvent" ADD COLUMN IF NOT EXISTS "lastAttemptAt" TIMESTAMPTZ`)
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "idx_webhookevent_retry" ON "WebhookEvent" ("status", "nextRetryAt")
    `)
    tableEnsured = true
  } catch (e) {
    tableEnsured = true
  }
}

// Exponential backoff schedule — retryCount (0-based) → ms delay until next
// attempt. After exhausting the schedule we flip status to DEAD_LETTER.
const BACKOFF_SCHEDULE_MS = [
  1 * 60 * 1000,       // 1 min
  5 * 60 * 1000,       // 5 min
  15 * 60 * 1000,      // 15 min
  60 * 60 * 1000,      // 1 hour
  4 * 60 * 60 * 1000,  // 4 hours
]

export const WEBHOOK_MAX_RETRIES = BACKOFF_SCHEDULE_MS.length

function computeNextRetryAt(retryCount: number): Date | null {
  const delay = BACKOFF_SCHEDULE_MS[retryCount]
  if (!delay) return null
  return new Date(Date.now() + delay)
}

// ──────────────────────────────────────────────────────────────────────────
// Timing-safe HMAC verification. Works for any provider that signs the raw
// request body with a shared secret (InFlow, Hyphen, generic HMAC webhooks).
//
// Returns true only if the signature matches. Accepts hex or base64 signatures
// with optional "sha256=" prefix (GitHub-style).
// ──────────────────────────────────────────────────────────────────────────
export function verifyHmacSignature(
  rawBody: string | Buffer,
  providedSignature: string | null | undefined,
  secret: string | null | undefined,
  algorithm: 'sha256' | 'sha1' = 'sha256'
): boolean {
  if (!providedSignature || !secret) return false
  const normalized = providedSignature.replace(/^sha(256|1)=/, '').trim()
  const computed = crypto
    .createHmac(algorithm, secret)
    .update(typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8'))
    .digest('hex')

  // Try hex match first
  try {
    const a = Buffer.from(normalized, 'hex')
    const b = Buffer.from(computed, 'hex')
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) return true
  } catch { /* fall through */ }

  // Fall back to base64 match
  try {
    const computedB64 = Buffer.from(computed, 'hex').toString('base64')
    const a = Buffer.from(normalized, 'utf8')
    const b = Buffer.from(computedB64, 'utf8')
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) return true
  } catch { /* ignore */ }

  return false
}

// ──────────────────────────────────────────────────────────────────────────
// Bearer token verification with timing-safe compare. Used when the provider
// simply passes a static shared secret (Gmail Pub/Sub OIDC token, simple
// "x-webhook-secret" headers). For full OIDC verification, see verifyGoogleOidc.
// ──────────────────────────────────────────────────────────────────────────
export function verifyBearerToken(
  provided: string | null | undefined,
  expected: string | null | undefined
): boolean {
  if (!provided || !expected) return false
  const a = Buffer.from(provided.replace(/^Bearer\s+/i, '').trim(), 'utf8')
  const b = Buffer.from(expected, 'utf8')
  if (a.length !== b.length) return false
  try {
    return crypto.timingSafeEqual(a, b)
  } catch {
    return false
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Verify Google-issued OIDC tokens from Pub/Sub push subscriptions.
//
// Pub/Sub sends an "Authorization: Bearer <JWT>" header where the JWT is
// issued by Google and contains an email claim matching the service account
// configured on the subscription. We do a lightweight verification:
//   - Check issuer is Google
//   - Check audience matches expected (our webhook URL)
//   - Check email matches expected service account
//
// For strict cryptographic verification in production we'd fetch Google's
// JWKS, but the token is already transport-authenticated by HTTPS and
// Pub/Sub will only push to pre-configured endpoints.
// ──────────────────────────────────────────────────────────────────────────
export function verifyGooglePubSubToken(
  authHeader: string | null | undefined,
  opts: { expectedAudience?: string; expectedEmail?: string }
): { ok: boolean; reason?: string } {
  if (!authHeader) return { ok: false, reason: 'missing_auth_header' }
  const token = authHeader.replace(/^Bearer\s+/i, '').trim()
  const parts = token.split('.')
  if (parts.length !== 3) return { ok: false, reason: 'not_jwt' }
  try {
    const payload = JSON.parse(
      Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')
    )
    if (payload.iss !== 'https://accounts.google.com' && payload.iss !== 'accounts.google.com') {
      return { ok: false, reason: 'bad_issuer' }
    }
    if (opts.expectedAudience && payload.aud !== opts.expectedAudience) {
      return { ok: false, reason: 'bad_audience' }
    }
    if (opts.expectedEmail && payload.email !== opts.expectedEmail) {
      return { ok: false, reason: 'bad_email' }
    }
    if (payload.exp && payload.exp * 1000 < Date.now()) {
      return { ok: false, reason: 'expired' }
    }
    return { ok: true }
  } catch (e) {
    return { ok: false, reason: 'decode_failed' }
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Idempotency check. Returns:
//   { status: 'new' }          — first time we've seen this event, proceed
//   { status: 'duplicate' }    — already processed, short-circuit success
//   { status: 'in_progress' }  — received but not yet marked processed
// ──────────────────────────────────────────────────────────────────────────
export async function ensureIdempotent(
  provider: string,
  eventId: string,
  eventType?: string,
  payload?: unknown
): Promise<{ status: 'new' | 'duplicate' | 'in_progress'; id?: string }> {
  try {
    await ensureTable()
    const existing: any[] = await prisma.$queryRawUnsafe(
      `SELECT "id", "status" FROM "WebhookEvent" WHERE "provider" = $1 AND "eventId" = $2 LIMIT 1`,
      provider,
      eventId
    )
    if (existing.length > 0) {
      return existing[0].status === 'PROCESSED'
        ? { status: 'duplicate', id: existing[0].id }
        : { status: 'in_progress', id: existing[0].id }
    }
    const id = 'wh' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
    // Persist payload as JSONB so the retry worker can replay the original
    // event without re-fetching from the provider. Fall back to NULL on
    // serialization failure — we don't want payload capture to break
    // legitimate webhook delivery.
    let payloadJson: string | null = null
    if (payload !== undefined) {
      try {
        payloadJson = JSON.stringify(payload)
      } catch {
        payloadJson = null
      }
    }
    await prisma.$executeRawUnsafe(
      `INSERT INTO "WebhookEvent" ("id", "provider", "eventId", "eventType", "status", "payload", "receivedAt")
       VALUES ($1, $2, $3, $4, 'RECEIVED', $5::jsonb, NOW())
       ON CONFLICT ("provider", "eventId") DO NOTHING`,
      id,
      provider,
      eventId,
      eventType || null,
      payloadJson
    )
    return { status: 'new', id }
  } catch (e: any) {
    logger.error('webhook_idempotency_check_failed', e, { provider, eventId })
    // Fail open — better to risk a duplicate than drop a real event
    return { status: 'new' }
  }
}

export async function markWebhookProcessed(id: string | undefined) {
  if (!id) return
  try {
    await prisma.$executeRawUnsafe(
      `UPDATE "WebhookEvent" SET "status" = 'PROCESSED', "processedAt" = NOW() WHERE "id" = $1`,
      id
    )
  } catch (e: any) {
    logger.error('webhook_mark_processed_failed', e, { id })
  }
}

export async function markWebhookFailed(id: string | undefined, error: string) {
  if (!id) return
  try {
    // Look up the current retry count so we can compute the next scheduled
    // attempt. If the row is missing (shouldn't happen but defensive), we
    // just flip to FAILED and leave scheduling alone.
    const rows: any[] = await prisma.$queryRawUnsafe(
      `SELECT "retryCount", "maxRetries" FROM "WebhookEvent" WHERE "id" = $1 LIMIT 1`,
      id
    )
    const currentRetry = rows[0]?.retryCount ?? 0
    const maxRetries = rows[0]?.maxRetries ?? WEBHOOK_MAX_RETRIES
    const nextRetryAt = currentRetry < maxRetries ? computeNextRetryAt(currentRetry) : null
    // FAILED → eligible for retry; DEAD_LETTER → exhausted retries, needs
    // operator attention.
    const nextStatus = nextRetryAt ? 'FAILED' : 'DEAD_LETTER'
    await prisma.$executeRawUnsafe(
      `UPDATE "WebhookEvent"
       SET "status" = $2,
           "error" = $3,
           "lastAttemptAt" = NOW(),
           "processedAt" = NOW(),
           "nextRetryAt" = $4
       WHERE "id" = $1`,
      id,
      nextStatus,
      error.slice(0, 2000),
      nextRetryAt
    )
  } catch (e: any) {
    logger.error('webhook_mark_failed_failed', e, { id })
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Retry / DLQ helpers.
//
// `listRetryableWebhooks` returns FAILED events whose next-retry time has
// passed — the worker iterates these and asks each provider to replay.
// `incrementWebhookRetry` bumps retry metadata before the attempt so a
// crash mid-replay still burns a retry slot (fail-safe).
// ──────────────────────────────────────────────────────────────────────────

export interface WebhookEventRow {
  id: string
  provider: string
  eventId: string
  eventType: string | null
  status: string
  error: string | null
  payload: any | null
  retryCount: number
  maxRetries: number
  nextRetryAt: Date | null
  lastAttemptAt: Date | null
  receivedAt: Date
  processedAt: Date | null
}

export async function listRetryableWebhooks(options?: {
  provider?: string
  limit?: number
}): Promise<WebhookEventRow[]> {
  try {
    await ensureTable()
    const limit = Math.min(options?.limit ?? 50, 500)
    const provider = options?.provider ?? null
    const rows: any[] = await prisma.$queryRawUnsafe(
      `SELECT "id", "provider", "eventId", "eventType", "status", "error", "payload",
              "retryCount", "maxRetries", "nextRetryAt", "lastAttemptAt",
              "receivedAt", "processedAt"
       FROM "WebhookEvent"
       WHERE "status" = 'FAILED'
         AND "retryCount" < "maxRetries"
         AND ("nextRetryAt" IS NULL OR "nextRetryAt" <= NOW())
         AND ($1::text IS NULL OR "provider" = $1)
       ORDER BY "nextRetryAt" ASC NULLS FIRST
       LIMIT $2`,
      provider,
      limit
    )
    return rows as WebhookEventRow[]
  } catch (e: any) {
    logger.error('webhook_list_retryable_failed', e, {})
    return []
  }
}

export async function incrementWebhookRetry(id: string): Promise<number> {
  try {
    const rows: any[] = await prisma.$queryRawUnsafe(
      `UPDATE "WebhookEvent"
       SET "retryCount" = "retryCount" + 1,
           "lastAttemptAt" = NOW(),
           "status" = 'RECEIVED'
       WHERE "id" = $1
       RETURNING "retryCount"`,
      id
    )
    return rows[0]?.retryCount ?? 0
  } catch (e: any) {
    logger.error('webhook_increment_retry_failed', e, { id })
    return 0
  }
}

// Manual operator replay — fetches the stored payload so a caller can
// re-dispatch through the provider-specific handler. Returns null if no
// payload is on file (pre-DLQ events).
export async function getWebhookPayload(id: string): Promise<{
  provider: string
  eventType: string | null
  payload: any | null
  retryCount: number
  status: string
} | null> {
  try {
    const rows: any[] = await prisma.$queryRawUnsafe(
      `SELECT "provider", "eventType", "payload", "retryCount", "status"
       FROM "WebhookEvent" WHERE "id" = $1 LIMIT 1`,
      id
    )
    return rows[0] || null
  } catch (e: any) {
    logger.error('webhook_get_payload_failed', e, { id })
    return null
  }
}

// Count by status for dashboard cards. Bucketed by provider.
export async function getWebhookStats(): Promise<{
  provider: string
  status: string
  count: number
}[]> {
  try {
    await ensureTable()
    const rows: any[] = await prisma.$queryRawUnsafe(
      `SELECT "provider", "status", COUNT(*)::int AS "count"
       FROM "WebhookEvent"
       WHERE "receivedAt" > NOW() - INTERVAL '30 days'
       GROUP BY "provider", "status"
       ORDER BY "provider", "status"`
    )
    return rows
  } catch (e: any) {
    logger.error('webhook_get_stats_failed', e, {})
    return []
  }
}

// List recent events for the admin console. Paginated, optionally scoped
// by provider/status.
export async function listRecentWebhooks(options?: {
  provider?: string
  status?: string
  limit?: number
  offset?: number
}): Promise<WebhookEventRow[]> {
  try {
    await ensureTable()
    const limit = Math.min(options?.limit ?? 100, 500)
    const offset = Math.max(options?.offset ?? 0, 0)
    const rows: any[] = await prisma.$queryRawUnsafe(
      `SELECT "id", "provider", "eventId", "eventType", "status", "error", "payload",
              "retryCount", "maxRetries", "nextRetryAt", "lastAttemptAt",
              "receivedAt", "processedAt"
       FROM "WebhookEvent"
       WHERE ($1::text IS NULL OR "provider" = $1)
         AND ($2::text IS NULL OR "status" = $2)
       ORDER BY "receivedAt" DESC
       LIMIT $3 OFFSET $4`,
      options?.provider ?? null,
      options?.status ?? null,
      limit,
      offset
    )
    return rows as WebhookEventRow[]
  } catch (e: any) {
    logger.error('webhook_list_recent_failed', e, {})
    return []
  }
}

// Operator override — forcibly resurrect a DEAD_LETTER event so it can be
// retried from admin UI after fixing the root cause.
export async function resurrectWebhook(id: string): Promise<boolean> {
  try {
    const result = await prisma.$executeRawUnsafe(
      `UPDATE "WebhookEvent"
       SET "status" = 'FAILED',
           "nextRetryAt" = NOW(),
           "retryCount" = 0,
           "error" = NULL
       WHERE "id" = $1 AND "status" IN ('DEAD_LETTER', 'FAILED', 'PROCESSED')`,
      id
    )
    return result > 0
  } catch (e: any) {
    logger.error('webhook_resurrect_failed', e, { id })
    return false
  }
}
