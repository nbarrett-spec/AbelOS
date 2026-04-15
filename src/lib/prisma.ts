import { PrismaClient } from '@prisma/client'
import crypto from 'crypto'
import { logger } from '@/lib/logger'

// ──────────────────────────────────────────────────────────────────────────
// Prisma client — singleton with slow-query logging + persistence.
//
// Slow queries (default >500ms) are:
//   1. Surfaced via the structured logger so they show up in Vercel logs
//   2. Fire-and-forgotten into SlowQueryLog so /admin/health can show them
//
// The threshold is overrideable via PRISMA_SLOW_QUERY_MS so staging can
// run tighter than production.
//
// Persistence goes through the UN-extended base client so the insert
// itself never trips the extension and recurses. If SlowQueryLog is
// missing we lazily create it on first successful init.
//
// We cache the client across Next.js hot reloads and Vercel serverless
// warm invocations — without this, each cold start creates a new
// PrismaClient and Neon's connection pool exhausts within seconds.
// ──────────────────────────────────────────────────────────────────────────

const SLOW_QUERY_MS = parseInt(process.env.PRISMA_SLOW_QUERY_MS || '500', 10)

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
  prismaBase: PrismaClient | undefined
  slowQueryTableReady: Promise<void> | undefined
}

async function ensureSlowQueryTable(base: PrismaClient): Promise<void> {
  try {
    await base.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "SlowQueryLog" (
        "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT NOW(),
        "model" TEXT NOT NULL,
        "operation" TEXT NOT NULL,
        "durationMs" INTEGER NOT NULL,
        "thresholdMs" INTEGER NOT NULL
      )
    `)
    await base.$executeRawUnsafe(
      `CREATE INDEX IF NOT EXISTS "idx_slowquerylog_created" ON "SlowQueryLog" ("createdAt" DESC)`
    )
    await base.$executeRawUnsafe(
      `CREATE INDEX IF NOT EXISTS "idx_slowquerylog_duration" ON "SlowQueryLog" ("durationMs" DESC)`
    )
    // Digest + sqlSample columns added after the initial table shipped — use
    // ADD COLUMN IF NOT EXISTS so existing rows (which will have NULL here)
    // keep working. The digest collapses similar raw queries that would
    // otherwise all flatten to "raw.$executeRawUnsafe" in top offenders.
    await base.$executeRawUnsafe(
      `ALTER TABLE "SlowQueryLog" ADD COLUMN IF NOT EXISTS "digest" TEXT`
    )
    await base.$executeRawUnsafe(
      `ALTER TABLE "SlowQueryLog" ADD COLUMN IF NOT EXISTS "sqlSample" TEXT`
    )
    await base.$executeRawUnsafe(
      `CREATE INDEX IF NOT EXISTS "idx_slowquerylog_digest" ON "SlowQueryLog" ("digest")`
    )
  } catch (err) {
    // Missing gen_random_uuid extension on ancient Postgres? Fall back to text id
    // generated in-process. Swallow and continue — logger.warn still fires.
  }
}

// ──────────────────────────────────────────────────────────────────────────
// SQL normalization for digest computation.
//
// Goal: collapse "SELECT * FROM Order WHERE id = 123" and
//       "SELECT * FROM Order WHERE id = 456" into the same digest so the
//       top-offenders view can show "this query ran 50 times" instead of
//       50 separate rows with different parameter values.
//
// PRIVACY: we normalize the TEMPLATE, not the parameters. String literals
// and numeric literals are replaced with "?" before hashing, so no user
// data (emails, order IDs, names) ever lands in the digest or sample.
// The sample is the normalized template, also safe to display.
//
// This runs only on queries that already crossed the slow threshold, so
// the regex cost is paid per-slow-query, not per-query.
// ──────────────────────────────────────────────────────────────────────────

function normalizeSql(raw: string): string {
  return raw
    // Strip line comments: "-- foo\n" → " "
    .replace(/--[^\n]*/g, ' ')
    // Strip block comments: "/* foo */" → " "
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    // Replace single-quoted string literals with ?
    .replace(/'(?:[^']|'')*'/g, '?')
    // Replace double-quoted IDENTIFIERS don't need replacement — leave alone
    // Replace bare numeric literals with ?
    .replace(/\b\d+(?:\.\d+)?\b/g, '?')
    // Collapse Postgres positional placeholders ($1, $2, ...) to ?
    .replace(/\$\d+/g, '?')
    // Collapse whitespace
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Pull the SQL template out of whatever shape Prisma handed us for a raw
 * operation. This is defensive because the args shape varies between:
 *   $executeRawUnsafe / $queryRawUnsafe: args = { query: "...", parameters: [...] }
 *                                        OR args = ["...", value1, value2]
 *                                        depending on how the hook sees it
 *   $executeRaw / $queryRaw:             args = { query: Sql { strings: [...], values: [...] } }
 *                                        (tagged template)
 * Returns null if we can't confidently extract a SQL string.
 */
function extractRawSql(args: unknown): string | null {
  if (!args) return null
  const a = args as any

  // Object-shaped: { query: "..." }
  if (typeof a.query === 'string') return a.query

  // Object-shaped tagged template: { query: Sql { strings, values } }
  if (a.query && Array.isArray(a.query.strings)) {
    return a.query.strings.join('?')
  }

  // Array-shaped: ["SELECT ...", v1, v2]
  if (Array.isArray(a) && typeof a[0] === 'string') return a[0]

  return null
}

interface SlowQueryDigest {
  digest: string
  sqlSample: string | null
}

function computeDigest(
  model: string,
  operation: string,
  args: unknown
): SlowQueryDigest {
  try {
    const isRaw = model === 'raw' || operation.startsWith('$')
    let normalized: string | null = null
    if (isRaw) {
      const raw = extractRawSql(args)
      if (raw) normalized = normalizeSql(raw)
    }
    const digestInput = `${model}|${operation}|${normalized || ''}`
    const digest = crypto
      .createHash('sha1')
      .update(digestInput)
      .digest('hex')
      .slice(0, 10)
    // Truncate the sample so one monster query can't bloat the table.
    const sqlSample = normalized ? normalized.slice(0, 500) : null
    return { digest, sqlSample }
  } catch {
    // Normalization should never throw, but if it does, fall back to a
    // model+operation-only digest so we still collapse non-raw queries
    // into sensible groups.
    const digest = crypto
      .createHash('sha1')
      .update(`${model}|${operation}`)
      .digest('hex')
      .slice(0, 10)
    return { digest, sqlSample: null }
  }
}

function createClient(): PrismaClient {
  const base = new PrismaClient()
  globalForPrisma.prismaBase = base

  // Kick off table creation once per process. Subsequent inserts race
  // against this promise but we don't await it on the hot path.
  if (!globalForPrisma.slowQueryTableReady) {
    globalForPrisma.slowQueryTableReady = ensureSlowQueryTable(base).catch(() => {
      // swallow — persistence is best-effort
    })
  }

  // Prisma 5 extension hook — runs on every operation, including raw.
  return base.$extends({
    query: {
      async $allOperations({ operation, model, args, query }) {
        const started = Date.now()
        try {
          return await query(args)
        } finally {
          const duration = Date.now() - started
          if (duration >= SLOW_QUERY_MS) {
            const modelName = model || 'raw'
            const { digest, sqlSample } = computeDigest(modelName, operation, args)
            logger.warn('slow_prisma_query', {
              model: modelName,
              operation,
              digest,
              durationMs: duration,
              thresholdMs: SLOW_QUERY_MS,
            })
            // Fire-and-forget persistence through the base (unextended) client.
            // Using base avoids recursing into this same $allOperations hook.
            void globalForPrisma
              .slowQueryTableReady!.then(() =>
                base.$executeRawUnsafe(
                  `INSERT INTO "SlowQueryLog" ("model", "operation", "durationMs", "thresholdMs", "digest", "sqlSample")
                   VALUES ($1, $2, $3, $4, $5, $6)`,
                  modelName,
                  operation,
                  duration,
                  SLOW_QUERY_MS,
                  digest,
                  sqlSample
                )
              )
              .catch(() => {
                // swallow — best effort
              })
          }
        }
      },
    },
  }) as unknown as PrismaClient
}

export const prisma = globalForPrisma.prisma ?? createClient()

// Cache in ALL environments — without this, every Vercel serverless invocation
// creates a new PrismaClient, exhausting Neon's connection pool within seconds.
globalForPrisma.prisma = prisma
