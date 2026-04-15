import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'

// ──────────────────────────────────────────────────────────────────────────
// Security event logger — unified table for rate-limit and CSRF rejections
// (and room to grow: auth failures, suspicious payloads, etc.).
//
// Writes are fire-and-forget: observability must never block a request or
// break the hot path. If the SecurityEvent table doesn't exist yet we
// silently swallow — the admin endpoint will create it on first read.
//
// Kinds:
//   RATE_LIMIT  — a limiter returned success=false
//   CSRF        — middleware rejected a mutating request with no/bad token
//   AUTH_FAIL   — (reserved) login or JWT verification failure
//   SUSPICIOUS  — (reserved) payload heuristics flagged a request
// ──────────────────────────────────────────────────────────────────────────

export type SecurityEventKind = 'RATE_LIMIT' | 'CSRF' | 'AUTH_FAIL' | 'SUSPICIOUS'

export interface SecurityEventInput {
  kind: SecurityEventKind
  path?: string | null
  method?: string | null
  ip?: string | null
  userAgent?: string | null
  requestId?: string | null
  details?: Record<string, unknown> | null
}

let tableReady: Promise<void> | null = null

export async function ensureSecurityEventTable(): Promise<void> {
  if (tableReady) return tableReady
  tableReady = (async () => {
    try {
      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "SecurityEvent" (
          "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
          "createdAt" TIMESTAMP(3) NOT NULL DEFAULT NOW(),
          "kind" TEXT NOT NULL,
          "path" TEXT,
          "method" TEXT,
          "ip" TEXT,
          "userAgent" TEXT,
          "requestId" TEXT,
          "details" JSONB
        )
      `)
      await prisma.$executeRawUnsafe(
        `CREATE INDEX IF NOT EXISTS "idx_securityevent_created" ON "SecurityEvent" ("createdAt" DESC)`
      )
      await prisma.$executeRawUnsafe(
        `CREATE INDEX IF NOT EXISTS "idx_securityevent_kind_created" ON "SecurityEvent" ("kind", "createdAt" DESC)`
      )
      await prisma.$executeRawUnsafe(
        `CREATE INDEX IF NOT EXISTS "idx_securityevent_ip" ON "SecurityEvent" ("ip")`
      )
    } catch {
      // swallow — best-effort
    }
  })()
  return tableReady
}

function clamp(s: string | null | undefined, max: number): string | null {
  if (s == null) return null
  return s.length > max ? s.slice(0, max) : s
}

/**
 * Fire-and-forget security event write. Never throws, never blocks.
 *
 * Usage:
 *   logSecurityEvent({ kind: 'RATE_LIMIT', path: '/api/x', ip, ... })
 *   // no await — intentional
 */
export function logSecurityEvent(input: SecurityEventInput): void {
  void ensureSecurityEventTable()
    .then(() =>
      prisma.$executeRawUnsafe(
        `INSERT INTO "SecurityEvent" ("kind", "path", "method", "ip", "userAgent", "requestId", "details")
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
        input.kind,
        clamp(input.path, 500),
        clamp(input.method, 20),
        clamp(input.ip, 100),
        clamp(input.userAgent, 500),
        clamp(input.requestId, 100),
        input.details ? JSON.stringify(input.details) : null
      )
    )
    .catch(() => {
      // swallow — never break the request on audit write failure
    })

  // Also emit to the structured logger so ops can see it in real-time
  // via Vercel logs without waiting for the admin UI to refresh.
  logger.warn('security_event', {
    kind: input.kind,
    path: input.path,
    method: input.method,
    ip: input.ip,
    requestId: input.requestId,
    ...(input.details || {}),
  })
}
