export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'
import { prisma } from '@/lib/prisma'
import { detectCronDrift } from '@/lib/cron'

// ──────────────────────────────────────────────────────────────────────────
// GET /api/ops/system-alerts — real-time platform health indicators.
//
// Aggregates live signals from the tables shipped by recent P1 work:
//   - ClientError   (last hour): crashes in the browser
//   - ServerError   (last hour): server-side failures from logger.error
//   - CronRun       (last 24h): failed scheduled jobs
//   - CronRun drift            : stale crons that stopped firing
//   - WebhookEvent             : dead-lettered inbound webhooks
//   - WebhookEvent             : FAILED retry backlog (leading indicator)
//   - Order AR                 : overdue invoices
//   - Inventory                : items below reorder point (approximation)
//   - SecurityEvent (last 24h): rate-limit rejections + auth failures
//
// Each alert is classified as 'critical', 'warning', or 'info' based on
// count thresholds. The /ops AlertRail consumes this directly. Queries
// are defensive — if any source table is missing, that alert is skipped.
// ──────────────────────────────────────────────────────────────────────────

interface SystemAlert {
  id: string
  type: 'critical' | 'warning' | 'info' | 'success'
  title: string
  count: number
  href: string
  description?: string
}

async function countClientErrorsLastHour(): Promise<number> {
  try {
    const rows: any[] = await prisma.$queryRawUnsafe(
      `SELECT COUNT(*)::int AS count
       FROM "ClientError"
       WHERE "createdAt" > NOW() - INTERVAL '1 hour'`
    )
    return rows[0]?.count || 0
  } catch {
    return 0
  }
}

async function countServerErrorsLastHour(): Promise<number> {
  try {
    const rows: any[] = await prisma.$queryRawUnsafe(
      `SELECT COUNT(*)::int AS count
       FROM "ServerError"
       WHERE "createdAt" > NOW() - INTERVAL '1 hour'`
    )
    return rows[0]?.count || 0
  } catch {
    return 0
  }
}

async function countFailedCronsLast24h(): Promise<number> {
  try {
    const rows: any[] = await prisma.$queryRawUnsafe(
      `SELECT COUNT(*)::int AS count
       FROM "CronRun"
       WHERE "status" = 'FAILURE' AND "startedAt" > NOW() - INTERVAL '24 hours'`
    )
    return rows[0]?.count || 0
  } catch {
    return 0
  }
}

async function countDeadLetterWebhooks(): Promise<number> {
  try {
    const rows: any[] = await prisma.$queryRawUnsafe(
      `SELECT COUNT(*)::int AS count
       FROM "WebhookEvent"
       WHERE "status" = 'DEAD_LETTER'`
    )
    return rows[0]?.count || 0
  } catch {
    return 0
  }
}

/**
 * Count FAILED webhooks that are piling up waiting for retry. This is the
 * leading indicator — if it climbs while DEAD_LETTER stays flat, the retry
 * worker is keeping up. If it climbs AND DEAD_LETTER climbs, something
 * downstream is truly broken and needs eyeballs.
 */
async function countRetryBacklogWebhooks(): Promise<number> {
  try {
    const rows: any[] = await prisma.$queryRawUnsafe(
      `SELECT COUNT(*)::int AS count
       FROM "WebhookEvent"
       WHERE "status" = 'FAILED'`
    )
    return rows[0]?.count || 0
  } catch {
    return 0
  }
}

async function countOverdueAR(): Promise<number> {
  // Orders flagged OVERDUE directly, plus orders still INVOICED whose
  // dueDate has passed. Matches the PaymentStatus enum in schema.prisma.
  try {
    const rows: any[] = await prisma.$queryRawUnsafe(
      `SELECT COUNT(*)::int AS count
       FROM "Order"
       WHERE "paymentStatus" = 'OVERDUE'
          OR ("paymentStatus" = 'INVOICED' AND "dueDate" IS NOT NULL AND "dueDate" < NOW())`
    )
    return rows[0]?.count || 0
  } catch {
    return 0
  }
}

async function countLowStock(): Promise<number> {
  // Product.inStock is a boolean flag, not a quantity — count products
  // that are active but flagged out of stock.
  try {
    const rows: any[] = await prisma.$queryRawUnsafe(
      `SELECT COUNT(*)::int AS count
       FROM "Product"
       WHERE "active" = true AND "inStock" = false`
    )
    return rows[0]?.count || 0
  } catch {
    return 0
  }
}

async function countRateLimitRejectionsLast24h(): Promise<number> {
  try {
    const rows: any[] = await prisma.$queryRawUnsafe(
      `SELECT COUNT(*)::int AS count
       FROM "SecurityEvent"
       WHERE "kind" = 'RATE_LIMIT'
         AND "createdAt" > NOW() - INTERVAL '24 hours'`
    )
    return rows[0]?.count || 0
  } catch {
    return 0
  }
}

async function countAuthFailuresLast24h(): Promise<number> {
  try {
    const rows: any[] = await prisma.$queryRawUnsafe(
      `SELECT COUNT(*)::int AS count
       FROM "SecurityEvent"
       WHERE "kind" = 'AUTH_FAIL'
         AND "createdAt" > NOW() - INTERVAL '24 hours'`
    )
    return rows[0]?.count || 0
  } catch {
    return 0
  }
}

/**
 * Count slow queries in the last hour. Short window on purpose — slow
 * queries tend to hit in bursts when a hot query drifts, and a 24h window
 * would hide a fresh regression under yesterday's baseline noise.
 */
async function countSlowQueriesLastHour(): Promise<number> {
  try {
    const rows: any[] = await prisma.$queryRawUnsafe(
      `SELECT COUNT(*)::int AS count
       FROM "SlowQueryLog"
       WHERE "createdAt" > NOW() - INTERVAL '1 hour'`
    )
    return rows[0]?.count || 0
  } catch {
    return 0
  }
}

/**
 * Classify client-error severity by raw count in the last hour.
 * These thresholds are deliberately loud — a handful of errors is
 * noise; dozens of errors is a fire.
 */
function classifyErrorRate(count: number): 'critical' | 'warning' | 'info' | null {
  if (count >= 20) return 'critical'
  if (count >= 5) return 'warning'
  if (count >= 1) return 'info'
  return null
}

/**
 * Rate-limit abuse severity. Healthy baseline is a handful per day from
 * aggressive browsers; dozens means someone is hammering us.
 */
function classifyRateLimit(count: number): 'critical' | 'warning' | 'info' | null {
  if (count >= 50) return 'critical'
  if (count >= 10) return 'warning'
  if (count >= 1) return 'info'
  return null
}

/**
 * AUTH_FAIL severity. A few failures a day is normal (typos, stale cookies);
 * a sustained spike means credential stuffing or a broken deploy.
 */
function classifyAuthFailures(count: number): 'critical' | 'warning' | 'info' | null {
  if (count >= 20) return 'critical'
  if (count >= 5) return 'warning'
  if (count >= 1) return 'info'
  return null
}

/**
 * Slow-query severity. A single slow query is noise; a burst in one hour
 * means a hot query regressed or the DB is under pressure.
 */
function classifySlowQueries(count: number): 'critical' | 'warning' | 'info' | null {
  if (count >= 100) return 'critical'
  if (count >= 25) return 'warning'
  if (count >= 5) return 'info'
  return null
}

// ──────────────────────────────────────────────────────────────────────────
// In-memory cache — 10-second TTL.
//
// SystemPulse polls every 30s and /ops page-loads hit this endpoint too,
// so with two admin tabs open we'd run 10 queries every 15s. A 10-second
// TTL cuts that in half without making the ops feed feel stale (humans
// aren't refreshing fast enough to care).
//
// The cache is a module-level variable so it lives as long as the Lambda
// warm-start. On a cold boot it rebuilds from scratch — correct behaviour.
// ──────────────────────────────────────────────────────────────────────────

const CACHE_TTL_MS = 10_000
let cachedPayload: { body: any; expires: number } | null = null

export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  if (cachedPayload && cachedPayload.expires > Date.now()) {
    return NextResponse.json(cachedPayload.body)
  }

  const [
    clientErrorCount,
    serverErrorCount,
    failedCronCount,
    deadLetterCount,
    retryBacklogCount,
    overdueARCount,
    lowStockCount,
    rateLimitCount,
    authFailCount,
    slowQueryCount,
    cronDrift,
  ] = await Promise.all([
    countClientErrorsLastHour(),
    countServerErrorsLastHour(),
    countFailedCronsLast24h(),
    countDeadLetterWebhooks(),
    countRetryBacklogWebhooks(),
    countOverdueAR(),
    countLowStock(),
    countRateLimitRejectionsLast24h(),
    countAuthFailuresLast24h(),
    countSlowQueriesLastHour(),
    detectCronDrift().catch(() => ({ orphaned: [], neverRun: [], stale: [] })),
  ])

  const staleCronCount = cronDrift.stale.length

  const alerts: SystemAlert[] = []

  // 1. Client-side error rate (from /admin/errors data)
  const errorSeverity = classifyErrorRate(clientErrorCount)
  if (errorSeverity) {
    alerts.push({
      id: 'client-errors',
      type: errorSeverity,
      title: 'Browser Errors (1h)',
      count: clientErrorCount,
      href: '/admin/errors?source=client',
      description: 'Unhandled React errors reported by the browser',
    })
  }

  // 1b. Server-side error rate (logger.error writes → ServerError table).
  // Reuses the client classifier — a 20/hour burst on the server is the
  // same "something is obviously broken" signal as on the client.
  const serverErrorSeverity = classifyErrorRate(serverErrorCount)
  if (serverErrorSeverity) {
    alerts.push({
      id: 'server-errors',
      type: serverErrorSeverity,
      title: 'Server Errors (1h)',
      count: serverErrorCount,
      href: '/admin/errors?source=server',
      description: 'API route, cron, and background job failures from logger.error',
    })
  }

  // 2. Failed crons (the MRP nightly or sync jobs exploding is always critical)
  if (failedCronCount > 0) {
    alerts.push({
      id: 'cron-failures',
      type: failedCronCount >= 3 ? 'critical' : 'warning',
      title: 'Cron Failures (24h)',
      count: failedCronCount,
      href: '/admin/crons',
      description: 'Scheduled jobs that errored out',
    })
  }

  // 2b. Stale crons — registered job stopped firing well past its cadence.
  // This is a silent killer: the UI looks normal (no failures) but the job
  // simply isn't running. Always at least 'warning', critical if multiple.
  if (staleCronCount > 0) {
    alerts.push({
      id: 'stale-crons',
      type: staleCronCount >= 2 ? 'critical' : 'warning',
      title: 'Stale Crons',
      count: staleCronCount,
      href: '/admin/crons',
      description: 'Scheduled jobs that stopped firing past their expected cadence',
    })
  }

  // 3. Dead-letter webhooks — these need operator resurrection
  if (deadLetterCount > 0) {
    alerts.push({
      id: 'dead-letter',
      type: deadLetterCount >= 5 ? 'critical' : 'warning',
      title: 'Dead-Letter Webhooks',
      count: deadLetterCount,
      href: '/admin/webhooks',
      description: 'Failed inbound webhooks awaiting manual replay',
    })
  }

  // 3b. Retry backlog — FAILED webhooks waiting on the next retry window.
  // Healthy state is a handful (transient provider blips); a growing pile
  // means the retry worker isn't keeping up or a downstream is hard down.
  if (retryBacklogCount >= 10) {
    alerts.push({
      id: 'retry-backlog',
      type: retryBacklogCount >= 50 ? 'critical' : 'warning',
      title: 'Webhook Retry Backlog',
      count: retryBacklogCount,
      href: '/admin/webhooks',
      description: 'FAILED webhooks queued for retry — leading indicator before dead-letter',
    })
  }

  // 4. Overdue AR — money the company is owed
  if (overdueARCount > 0) {
    alerts.push({
      id: 'overdue-ar',
      type: overdueARCount >= 10 ? 'critical' : 'warning',
      title: 'Overdue AR',
      count: overdueARCount,
      href: '/ops/finance/ar',
      description: 'Invoiced orders past due',
    })
  }

  // 5. Low stock (only surface if data is reliable)
  if (lowStockCount > 0) {
    alerts.push({
      id: 'low-stock',
      type: 'info',
      title: 'Low Inventory',
      count: lowStockCount,
      href: '/ops/inventory',
      description: 'Products at or below reorder point',
    })
  }

  // 6. Rate-limit rejections — someone hammering our APIs
  const rateLimitSeverity = classifyRateLimit(rateLimitCount)
  if (rateLimitSeverity) {
    alerts.push({
      id: 'rate-limit',
      type: rateLimitSeverity,
      title: 'Rate-Limit Rejections (24h)',
      count: rateLimitCount,
      href: '/admin/health',
      description: 'Requests blocked by the rate limiter',
    })
  }

  // 7. Auth failures — credential stuffing, typos, or stale sessions
  const authFailSeverity = classifyAuthFailures(authFailCount)
  if (authFailSeverity) {
    alerts.push({
      id: 'auth-failures',
      type: authFailSeverity,
      title: 'Auth Failures (24h)',
      count: authFailCount,
      href: '/admin/health',
      description: 'Unauthenticated or unauthorized API access attempts',
    })
  }

  // 8. Slow-query burst — something is dragging the DB
  const slowQuerySeverity = classifySlowQueries(slowQueryCount)
  if (slowQuerySeverity) {
    alerts.push({
      id: 'slow-queries',
      type: slowQuerySeverity,
      title: 'Slow Queries (1h)',
      count: slowQueryCount,
      href: '/admin/health',
      description: 'Prisma queries exceeding the slow-query threshold',
    })
  }

  const payload = {
    alerts,
    meta: {
      generatedAt: new Date().toISOString(),
      cacheTtlSeconds: CACHE_TTL_MS / 1000,
      sources: {
        clientErrors: clientErrorCount,
        serverErrors: serverErrorCount,
        failedCrons: failedCronCount,
        staleCrons: staleCronCount,
        deadLetterWebhooks: deadLetterCount,
        retryBacklogWebhooks: retryBacklogCount,
        overdueAR: overdueARCount,
        lowStock: lowStockCount,
        rateLimitRejections: rateLimitCount,
        authFailures: authFailCount,
        slowQueries: slowQueryCount,
      },
    },
  }

  cachedPayload = { body: payload, expires: Date.now() + CACHE_TTL_MS }
  return NextResponse.json(payload)
}
