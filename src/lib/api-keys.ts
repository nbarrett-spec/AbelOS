/**
 * API key generation + verification helpers.
 *
 * Keys are 64-char hex strings. We store sha256(key) hex (never the
 * raw key) plus an 8-char prefix that's safe to display in the UI for
 * "which key is this" identification.
 *
 * Verification flow (used by `lib/mcp/auth.ts` and any other route
 * that wants to accept DB-backed keys):
 *   1. Caller hashes the incoming bearer token.
 *   2. We look up an ApiKey row by hashedKey + revokedAt IS NULL.
 *   3. If matched, we update lastUsedAt fire-and-forget and return
 *      the row (with scope) so the caller can decide what to allow.
 *
 * Constant-time comparison isn't needed here — the lookup is by
 * primary index (hashedKey is UNIQUE), not a string compare.
 */
import crypto from 'crypto'
import { prisma } from '@/lib/prisma'

export interface GeneratedApiKey {
  rawKey: string
  prefix: string
  hashedKey: string
}

/**
 * Generate a fresh 64-char hex key + its prefix + sha256 hash.
 * Caller stores prefix + hashedKey in DB and shows rawKey to the
 * user once — it can never be recovered.
 */
export function generateApiKey(): GeneratedApiKey {
  const rawKey = crypto.randomBytes(32).toString('hex') // 64 hex chars
  return {
    rawKey,
    prefix: rawKey.slice(0, 8),
    hashedKey: crypto.createHash('sha256').update(rawKey).digest('hex'),
  }
}

/**
 * Hash an incoming bearer token so we can look it up by hashedKey.
 */
export function hashApiKey(rawKey: string): string {
  return crypto.createHash('sha256').update(rawKey).digest('hex')
}

export interface VerifiedApiKey {
  id: string
  name: string
  scope: string
  prefix: string
  createdAt: Date
}

/**
 * Verify a bearer token against the ApiKey table. Returns the matched
 * row (without the hashed key) on success, or null. Updates lastUsedAt
 * fire-and-forget so the caller doesn't pay the latency.
 */
export async function verifyApiKey(rawKey: string): Promise<VerifiedApiKey | null> {
  if (!rawKey || typeof rawKey !== 'string') return null
  const hashedKey = hashApiKey(rawKey)
  try {
    const row = await prisma.apiKey.findFirst({
      where: { hashedKey, revokedAt: null },
      select: { id: true, name: true, scope: true, prefix: true, createdAt: true },
    })
    if (!row) return null
    // Fire-and-forget — never block auth on this update
    prisma.apiKey
      .update({ where: { id: row.id }, data: { lastUsedAt: new Date() } })
      .catch(() => {})
    return row
  } catch {
    return null
  }
}
