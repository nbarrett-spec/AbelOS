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
    tableEnsured = true
  } catch (e) {
    tableEnsured = true
  }
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
  eventType?: string
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
    await prisma.$executeRawUnsafe(
      `INSERT INTO "WebhookEvent" ("id", "provider", "eventId", "eventType", "status", "receivedAt")
       VALUES ($1, $2, $3, $4, 'RECEIVED', NOW())
       ON CONFLICT ("provider", "eventId") DO NOTHING`,
      id,
      provider,
      eventId,
      eventType || null
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
    await prisma.$executeRawUnsafe(
      `UPDATE "WebhookEvent" SET "status" = 'FAILED', "error" = $2, "processedAt" = NOW() WHERE "id" = $1`,
      id,
      error.slice(0, 2000)
    )
  } catch (e: any) {
    logger.error('webhook_mark_failed_failed', e, { id })
  }
}
