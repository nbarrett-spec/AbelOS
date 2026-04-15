import { PrismaClient } from '@prisma/client'
import { logger } from '@/lib/logger'

// ──────────────────────────────────────────────────────────────────────────
// Prisma client — singleton with slow-query logging.
//
// Slow queries (default >500ms) are surfaced via the structured logger so
// ops can catch N+1 patterns, missing indexes, and creeping regressions
// before they become incidents. The threshold is overrideable via
// PRISMA_SLOW_QUERY_MS so we can tighten it on staging without changing
// production behavior.
//
// We cache the client across Next.js hot reloads and Vercel serverless
// warm invocations — without this, each cold start creates a new
// PrismaClient and Neon's connection pool exhausts within seconds.
// ──────────────────────────────────────────────────────────────────────────

const SLOW_QUERY_MS = parseInt(process.env.PRISMA_SLOW_QUERY_MS || '500', 10)

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

function createClient(): PrismaClient {
  const client = new PrismaClient()

  // Prisma 5 extension hook — runs on every operation, including raw.
  // $allOperations preserves the return type so no call site breaks.
  return client.$extends({
    query: {
      async $allOperations({ operation, model, args, query }) {
        const started = Date.now()
        try {
          return await query(args)
        } finally {
          const duration = Date.now() - started
          if (duration >= SLOW_QUERY_MS) {
            logger.warn('slow_prisma_query', {
              model: model || 'raw',
              operation,
              durationMs: duration,
              thresholdMs: SLOW_QUERY_MS,
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
