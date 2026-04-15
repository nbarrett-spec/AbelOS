import { PrismaClient } from '@prisma/client'
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
  } catch (err) {
    // Missing gen_random_uuid extension on ancient Postgres? Fall back to text id
    // generated in-process. Swallow and continue — logger.warn still fires.
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
            logger.warn('slow_prisma_query', {
              model: modelName,
              operation,
              durationMs: duration,
              thresholdMs: SLOW_QUERY_MS,
            })
            // Fire-and-forget persistence through the base (unextended) client.
            // Using base avoids recursing into this same $allOperations hook.
            void globalForPrisma
              .slowQueryTableReady!.then(() =>
                base.$executeRawUnsafe(
                  `INSERT INTO "SlowQueryLog" ("model", "operation", "durationMs", "thresholdMs")
                   VALUES ($1, $2, $3, $4)`,
                  modelName,
                  operation,
                  duration,
                  SLOW_QUERY_MS
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
