// ──────────────────────────────────────────────────────────────────────────
// Hyphen SPConnect — OAuth 2.0 client_credentials provider
//
// Hyphen acts as the builder; Abel acts as the supplier. Hyphen will POST
// orders/change orders to our endpoints. They authenticate with a Bearer
// token issued by THIS module:
//
//   1. Hyphen POSTs to /api/hyphen/oauth/token with
//        Authorization: Basic base64(client_id:client_secret)
//        body: { "grant_type": "client_credentials" }
//   2. We validate against HyphenCredential, mint an access_token, and
//      return { token_type: "Bearer", access_token, expires_in }
//   3. Hyphen sends "Authorization: Bearer <token>" on every subsequent
//      call to /api/hyphen/orders, /api/hyphen/changeOrders, etc.
//
// All tables are auto-created (CREATE TABLE IF NOT EXISTS pattern, same as
// src/lib/audit.ts and src/lib/webhook.ts).
// ──────────────────────────────────────────────────────────────────────────

import crypto from 'crypto'
import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'
import type { NextRequest } from 'next/server'

// Default token TTL: 1 hour (matches what most OAuth providers issue).
export const HYPHEN_TOKEN_TTL_SECONDS = 3600

let tablesEnsured = false

async function ensureTables() {
  if (tablesEnsured) return
  try {
    // Issued client credentials. One row per Hyphen tenant / environment.
    // secretHash stores a sha256 of the secret; the plaintext is shown
    // exactly once when minted and never persisted in the clear.
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "HyphenCredential" (
        "id" TEXT PRIMARY KEY,
        "clientId" TEXT UNIQUE NOT NULL,
        "secretHash" TEXT NOT NULL,
        "label" TEXT NOT NULL,
        "scope" TEXT,
        "status" TEXT NOT NULL DEFAULT 'ACTIVE',
        "createdById" TEXT,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "lastUsedAt" TIMESTAMPTZ,
        "revokedAt" TIMESTAMPTZ
      )
    `)
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "idx_hyphencred_status" ON "HyphenCredential" ("status")
    `)

    // Issued access tokens. Validated on every request to /api/hyphen/*.
    // tokenHash stores sha256(token); plaintext is only returned to Hyphen
    // in the token response and never persisted.
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "HyphenAccessToken" (
        "id" TEXT PRIMARY KEY,
        "credentialId" TEXT NOT NULL,
        "tokenHash" TEXT UNIQUE NOT NULL,
        "scope" TEXT,
        "issuedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "expiresAt" TIMESTAMPTZ NOT NULL,
        "lastUsedAt" TIMESTAMPTZ,
        "revokedAt" TIMESTAMPTZ
      )
    `)
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "idx_hyphentoken_cred" ON "HyphenAccessToken" ("credentialId")
    `)
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "idx_hyphentoken_expires" ON "HyphenAccessToken" ("expiresAt")
    `)

    // Inbound order/changeOrder/etc. envelope log. Stores the raw payload
    // for replay/debug, the credential that delivered it, and the result.
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "HyphenOrderEvent" (
        "id" TEXT PRIMARY KEY,
        "credentialId" TEXT,
        "kind" TEXT NOT NULL,
        "externalId" TEXT,
        "builderOrderNumber" TEXT,
        "status" TEXT NOT NULL DEFAULT 'RECEIVED',
        "error" TEXT,
        "rawPayload" JSONB NOT NULL DEFAULT '{}',
        "mappedOrderId" TEXT,
        "receivedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "processedAt" TIMESTAMPTZ
      )
    `)
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "idx_hyphenevent_kind" ON "HyphenOrderEvent" ("kind")
    `)
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "idx_hyphenevent_status" ON "HyphenOrderEvent" ("status")
    `)
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "idx_hyphenevent_received" ON "HyphenOrderEvent" ("receivedAt" DESC)
    `)
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "idx_hyphenevent_external" ON "HyphenOrderEvent" ("externalId")
    `)
    tablesEnsured = true
  } catch (e) {
    // Fail open — first call to a real endpoint will surface the error.
    tablesEnsured = true
    logger.error('hyphen_table_ensure_failed', e)
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Credential management
// ──────────────────────────────────────────────────────────────────────────

export interface MintedCredential {
  id: string
  clientId: string
  clientSecret: string // shown ONCE; never stored in the clear
  label: string
  scope: string | null
}

/**
 * Mint a new Hyphen client credential. Returns the full plaintext secret
 * exactly once — the caller is responsible for showing it to the operator
 * and warning them that it cannot be retrieved later.
 */
export async function mintHyphenCredential(opts: {
  label: string
  scope?: string
  createdById?: string
}): Promise<MintedCredential> {
  await ensureTables()

  const id = 'hcred_' + Date.now().toString(36) + crypto.randomBytes(4).toString('hex')
  const clientId = 'hyphen_' + crypto.randomBytes(12).toString('hex')
  // 32 raw bytes → 64 char hex → sufficient entropy for a long-lived secret.
  const clientSecret = crypto.randomBytes(32).toString('hex')
  const secretHash = sha256(clientSecret)

  await prisma.$executeRawUnsafe(
    `INSERT INTO "HyphenCredential" ("id", "clientId", "secretHash", "label", "scope", "status", "createdById", "createdAt")
     VALUES ($1, $2, $3, $4, $5, 'ACTIVE', $6, NOW())`,
    id,
    clientId,
    secretHash,
    opts.label,
    opts.scope || null,
    opts.createdById || null
  )

  return {
    id,
    clientId,
    clientSecret,
    label: opts.label,
    scope: opts.scope || null,
  }
}

export async function listHyphenCredentials(): Promise<Array<{
  id: string
  clientId: string
  label: string
  scope: string | null
  status: string
  createdAt: string
  lastUsedAt: string | null
  revokedAt: string | null
}>> {
  await ensureTables()
  const rows: any[] = await prisma.$queryRawUnsafe(
    `SELECT "id", "clientId", "label", "scope", "status", "createdAt", "lastUsedAt", "revokedAt"
     FROM "HyphenCredential"
     ORDER BY "createdAt" DESC`
  )
  return rows.map((r) => ({
    id: r.id,
    clientId: r.clientId,
    label: r.label,
    scope: r.scope,
    status: r.status,
    createdAt: r.createdAt?.toISOString?.() || r.createdAt,
    lastUsedAt: r.lastUsedAt?.toISOString?.() || r.lastUsedAt,
    revokedAt: r.revokedAt?.toISOString?.() || r.revokedAt,
  }))
}

export async function revokeHyphenCredential(id: string): Promise<void> {
  await ensureTables()
  await prisma.$executeRawUnsafe(
    `UPDATE "HyphenCredential" SET "status" = 'REVOKED', "revokedAt" = NOW() WHERE "id" = $1`,
    id
  )
  // Also kill all outstanding tokens for this credential.
  await prisma.$executeRawUnsafe(
    `UPDATE "HyphenAccessToken" SET "revokedAt" = NOW() WHERE "credentialId" = $1 AND "revokedAt" IS NULL`,
    id
  )
}

// ──────────────────────────────────────────────────────────────────────────
// Token issuance + validation
// ──────────────────────────────────────────────────────────────────────────

interface TokenContext {
  credentialId: string
  scope: string | null
}

/**
 * Validate Hyphen-supplied client_id + client_secret against HyphenCredential
 * with timing-safe comparison. Returns the credential row on success.
 */
async function authenticateClient(
  clientId: string,
  clientSecret: string
): Promise<{ id: string; scope: string | null } | null> {
  await ensureTables()
  const rows: any[] = await prisma.$queryRawUnsafe(
    `SELECT "id", "secretHash", "scope" FROM "HyphenCredential"
     WHERE "clientId" = $1 AND "status" = 'ACTIVE' LIMIT 1`,
    clientId
  )
  if (!rows.length) return null

  const expected = rows[0].secretHash as string
  const actual = sha256(clientSecret)
  if (!timingSafeStringEquals(expected, actual)) return null

  // Touch lastUsedAt for visibility in the admin UI.
  prisma
    .$executeRawUnsafe(
      `UPDATE "HyphenCredential" SET "lastUsedAt" = NOW() WHERE "id" = $1`,
      rows[0].id
    )
    .catch(() => {})

  return { id: rows[0].id, scope: rows[0].scope }
}

/**
 * Issue a Bearer access token for an authenticated client. Stores the sha256
 * hash, returns the plaintext exactly once.
 */
export async function issueHyphenAccessToken(opts: {
  clientId: string
  clientSecret: string
  scope?: string
}): Promise<
  | { ok: true; accessToken: string; expiresInSeconds: number; scope: string | null }
  | { ok: false; error: 'invalid_client' | 'invalid_request' | 'server_error'; description: string }
> {
  if (!opts.clientId || !opts.clientSecret) {
    return { ok: false, error: 'invalid_request', description: 'client_id and client_secret are required' }
  }

  const cred = await authenticateClient(opts.clientId, opts.clientSecret)
  if (!cred) {
    return { ok: false, error: 'invalid_client', description: 'Unknown or revoked client credentials' }
  }

  try {
    const token = crypto.randomBytes(32).toString('hex')
    const tokenHash = sha256(token)
    const id = 'htok_' + Date.now().toString(36) + crypto.randomBytes(4).toString('hex')
    const expiresAt = new Date(Date.now() + HYPHEN_TOKEN_TTL_SECONDS * 1000)

    await prisma.$executeRawUnsafe(
      `INSERT INTO "HyphenAccessToken" ("id", "credentialId", "tokenHash", "scope", "issuedAt", "expiresAt")
       VALUES ($1, $2, $3, $4, NOW(), $5::timestamptz)`,
      id,
      cred.id,
      tokenHash,
      opts.scope || cred.scope || null,
      expiresAt.toISOString()
    )

    return {
      ok: true,
      accessToken: token,
      expiresInSeconds: HYPHEN_TOKEN_TTL_SECONDS,
      scope: opts.scope || cred.scope || null,
    }
  } catch (e: any) {
    logger.error('hyphen_token_issue_failed', e, { clientId: opts.clientId })
    return { ok: false, error: 'server_error', description: 'Failed to issue token' }
  }
}

/**
 * Validate a Bearer token from an inbound Hyphen request. Looks up by
 * sha256(token), checks expiry/revocation, and returns the owning
 * credential context. On success, lastUsedAt is touched.
 */
export async function verifyHyphenBearer(
  authHeader: string | null | undefined
): Promise<TokenContext | null> {
  if (!authHeader) return null
  const token = authHeader.replace(/^Bearer\s+/i, '').trim()
  if (!token) return null

  await ensureTables()
  const tokenHash = sha256(token)

  try {
    const rows: any[] = await prisma.$queryRawUnsafe(
      `SELECT t."id" as "tokenId", t."credentialId", t."scope", t."expiresAt", t."revokedAt", c."status" as "credStatus"
       FROM "HyphenAccessToken" t
       LEFT JOIN "HyphenCredential" c ON c."id" = t."credentialId"
       WHERE t."tokenHash" = $1 LIMIT 1`,
      tokenHash
    )
    if (!rows.length) return null
    const row = rows[0]

    if (row.revokedAt) return null
    if (row.credStatus !== 'ACTIVE') return null
    if (new Date(row.expiresAt).getTime() < Date.now()) return null

    // Best-effort touch — don't await, don't fail the request on it.
    prisma
      .$executeRawUnsafe(
        `UPDATE "HyphenAccessToken" SET "lastUsedAt" = NOW() WHERE "id" = $1`,
        row.tokenId
      )
      .catch(() => {})
    prisma
      .$executeRawUnsafe(
        `UPDATE "HyphenCredential" SET "lastUsedAt" = NOW() WHERE "id" = $1`,
        row.credentialId
      )
      .catch(() => {})

    return {
      credentialId: row.credentialId,
      scope: row.scope,
    }
  } catch (e: any) {
    logger.error('hyphen_token_verify_failed', e)
    return null
  }
}

/**
 * Convenience helper for route handlers: extracts the Bearer header from
 * a NextRequest and validates it. Returns null on failure.
 */
export async function authenticateHyphenRequest(
  request: NextRequest
): Promise<TokenContext | null> {
  return verifyHyphenBearer(request.headers.get('authorization'))
}

// ──────────────────────────────────────────────────────────────────────────
// Inbound event logging
// ──────────────────────────────────────────────────────────────────────────

export type HyphenEventKind =
  | 'order'
  | 'changeOrder'
  | 'orderResponse.outbound'
  | 'asn.outbound'
  | 'messageAck.outbound'

export async function recordHyphenEvent(opts: {
  credentialId: string | null
  kind: HyphenEventKind
  externalId?: string | null
  builderOrderNumber?: string | null
  status?: 'RECEIVED' | 'PROCESSED' | 'FAILED'
  error?: string | null
  rawPayload: any
  mappedOrderId?: string | null
}): Promise<string> {
  await ensureTables()
  const id = 'hevt_' + Date.now().toString(36) + crypto.randomBytes(4).toString('hex')
  try {
    await prisma.$executeRawUnsafe(
      `INSERT INTO "HyphenOrderEvent"
        ("id", "credentialId", "kind", "externalId", "builderOrderNumber", "status", "error", "rawPayload", "mappedOrderId", "receivedAt", "processedAt")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, NOW(), $10)`,
      id,
      opts.credentialId,
      opts.kind,
      opts.externalId || null,
      opts.builderOrderNumber || null,
      opts.status || 'RECEIVED',
      opts.error || null,
      JSON.stringify(opts.rawPayload || {}),
      opts.mappedOrderId || null,
      opts.status === 'PROCESSED' || opts.status === 'FAILED' ? new Date().toISOString() : null
    )
  } catch (e: any) {
    logger.error('hyphen_event_record_failed', e, { kind: opts.kind })
  }
  return id
}

export async function listHyphenEvents(opts: {
  kind?: string
  status?: string
  limit?: number
}): Promise<any[]> {
  await ensureTables()
  const conditions: string[] = []
  const params: any[] = []
  let idx = 1
  if (opts.kind) {
    conditions.push(`"kind" = $${idx++}`)
    params.push(opts.kind)
  }
  if (opts.status) {
    conditions.push(`"status" = $${idx++}`)
    params.push(opts.status)
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
  const limit = Math.min(opts.limit || 50, 200)
  try {
    const rows: any[] = await prisma.$queryRawUnsafe(
      `SELECT "id", "credentialId", "kind", "externalId", "builderOrderNumber",
              "status", "error", "mappedOrderId", "receivedAt", "processedAt"
       FROM "HyphenOrderEvent" ${where}
       ORDER BY "receivedAt" DESC
       LIMIT ${limit}`,
      ...params
    )
    return rows.map((r) => ({
      ...r,
      receivedAt: r.receivedAt?.toISOString?.() || r.receivedAt,
      processedAt: r.processedAt?.toISOString?.() || r.processedAt,
    }))
  } catch (e: any) {
    logger.error('hyphen_event_list_failed', e)
    return []
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────

function sha256(s: string): string {
  return crypto.createHash('sha256').update(s, 'utf8').digest('hex')
}

function timingSafeStringEquals(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8')
  const bb = Buffer.from(b, 'utf8')
  if (ab.length !== bb.length) return false
  try {
    return crypto.timingSafeEqual(ab, bb)
  } catch {
    return false
  }
}

/**
 * Parse an HTTP Basic Authorization header (RFC 7617). Hyphen sends:
 *   Authorization: Basic base64(client_id:client_secret)
 */
export function parseBasicAuth(
  authHeader: string | null | undefined
): { clientId: string; clientSecret: string } | null {
  if (!authHeader) return null
  const match = /^Basic\s+(.+)$/i.exec(authHeader.trim())
  if (!match) return null
  try {
    const decoded = Buffer.from(match[1], 'base64').toString('utf8')
    const colon = decoded.indexOf(':')
    if (colon < 0) return null
    return {
      clientId: decoded.slice(0, colon),
      clientSecret: decoded.slice(colon + 1),
    }
  } catch {
    return null
  }
}
