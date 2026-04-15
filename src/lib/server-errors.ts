import { prisma } from '@/lib/prisma'
import crypto from 'crypto'

// ──────────────────────────────────────────────────────────────────────────
// Server-side error persistence.
//
// Mirrors the ClientError table pattern: every logger.error() call fires
// a best-effort INSERT into ServerError so /admin/errors can show both
// sides of the stack, grouped by digest for recurring failures.
//
// Why a parallel table instead of reusing ClientError?
//   - Different shape — server errors have structured ctx (requestId, user,
//     route params) but no userAgent or IP; client errors are the reverse.
//   - Different retention (server 30d, client 30d — matches today but may
//     diverge).
//   - Keeps the client beacon endpoint read-only with respect to server data.
//
// Called via dynamic import from logger.error to sidestep the prisma→logger
// circular dependency. Prisma imports logger for slow-query warnings; if
// logger imported this module statically, prisma's module init would try
// to resolve prisma from this file before prisma itself had finished
// loading. The dynamic import defers that resolution until first real
// logger.error call, by which point prisma is fully initialized.
// ──────────────────────────────────────────────────────────────────────────

let tableEnsured = false

async function ensureServerErrorTable(): Promise<void> {
  if (tableEnsured) return
  try {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "ServerError" (
        "id" TEXT PRIMARY KEY,
        "digest" TEXT,
        "level" TEXT NOT NULL DEFAULT 'error',
        "msg" TEXT NOT NULL,
        "errName" TEXT,
        "errMessage" TEXT,
        "errStack" TEXT,
        "requestId" TEXT,
        "ctx" JSONB,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `)
    await prisma.$executeRawUnsafe(
      `CREATE INDEX IF NOT EXISTS "idx_servererror_created" ON "ServerError" ("createdAt" DESC)`
    )
    await prisma.$executeRawUnsafe(
      `CREATE INDEX IF NOT EXISTS "idx_servererror_digest" ON "ServerError" ("digest")`
    )
    await prisma.$executeRawUnsafe(
      `CREATE INDEX IF NOT EXISTS "idx_servererror_request" ON "ServerError" ("requestId")`
    )
    tableEnsured = true
  } catch {
    // Best-effort — if we can't create the table we also can't insert. Set
    // the flag anyway so we don't retry on every error.
    tableEnsured = true
  }
}

function clamp(s: unknown, max: number): string | null {
  if (typeof s !== 'string') return null
  return s.length > max ? s.slice(0, max) : s
}

/**
 * Mirror the ClientError digest strategy: SHA1 of (name|message|first stack
 * frame) collapsed to 10 chars. Recurring failures at the same call site
 * collapse into a single digest so /admin/errors can group them.
 */
function computeDigest(
  errName: string | null,
  errMessage: string | null,
  errStack: string | null
): string {
  const firstStackLine =
    (errStack || '').split('\n').find((line) => line.trim().startsWith('at ')) ||
    ''
  const input = `${errName || ''}|${errMessage || ''}|${firstStackLine.trim()}`
  return crypto.createHash('sha1').update(input).digest('hex').slice(0, 10)
}

export async function recordServerError(
  msg: string,
  err: unknown,
  ctx?: Record<string, unknown>
): Promise<void> {
  try {
    await ensureServerErrorTable()

    const errObj = err instanceof Error ? err : null
    const errName = errObj?.name ?? (err !== undefined ? 'UnknownError' : null)
    const errMessage =
      errObj?.message ?? (err !== undefined ? String(err) : null)
    const errStack = errObj?.stack ?? null
    const digest =
      errName || errMessage ? computeDigest(errName, errMessage, errStack) : null

    const id =
      'ser' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)

    // Pull requestId out of ctx if present — it gets its own indexed column
    // so we can join back to middleware traces. Everything else in ctx
    // lands as JSONB.
    const requestId =
      ctx && typeof ctx.requestId === 'string' ? ctx.requestId : null
    const restCtx: Record<string, unknown> = {}
    if (ctx) {
      for (const [k, v] of Object.entries(ctx)) {
        if (k === 'requestId') continue
        restCtx[k] = v
      }
    }
    const ctxJson =
      Object.keys(restCtx).length > 0
        ? JSON.stringify(restCtx).slice(0, 4000)
        : null

    await prisma.$executeRawUnsafe(
      `INSERT INTO "ServerError" ("id", "digest", "level", "msg", "errName", "errMessage", "errStack", "requestId", "ctx", "createdAt")
       VALUES ($1, $2, 'error', $3, $4, $5, $6, $7, $8::jsonb, NOW())`,
      id,
      digest,
      clamp(msg, 500),
      clamp(errName, 200),
      clamp(errMessage, 2000),
      clamp(errStack, 4000),
      clamp(requestId, 100),
      ctxJson
    )
  } catch {
    // Swallow — persistence is best-effort and must NEVER break the caller.
    // Any real problem will still show up in Vercel runtime logs via the
    // original logger.error stdout write.
  }
}
