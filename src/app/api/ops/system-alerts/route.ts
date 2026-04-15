export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'
import { prisma } from '@/lib/prisma'
import { detectCronDrift } from '@/lib/cron'
import { snapshotAlerts } from '@/lib/alert-history'

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
//   - UptimeProbe   (last hour): failed probes and elevated DB p95
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
 * Uptime probe health for the last hour. Combines two signals in one
 * query to keep the round-trips low:
 *   - failed:   probes where status <> 'ready' (the "are we up at all?"
 *               signal — uptime-probe hits /api/health every 5 min).
 *   - total:    total probes in window, lets us compute a failure ratio
 *               rather than a raw count — if the cron ran 12 times and 4
 *               failed, that's a different fire than 4 failures across
 *               100 probes.
 *   - p95DbMs:  95th percentile of dbMs over the last hour. If the DB
 *               is slow but not broken, the probe still reports 'ready',
 *               so this is the leading indicator that uptime pct doesn't
 *               catch. PERCENTILE_DISC returns the nearest actual value.
 *
 * All three come from one scan so we don't double-hit the table.
 */
async function getUptimeProbeHealthLastHour(): Promise<{
  failed: number
  total: number
  p95DbMs: number | null
}> {
  try {
    const rows: any[] = await prisma.$queryRawUnsafe(
      `SELECT
         COUNT(*)::int AS total,
         SUM(CASE WHEN "status" <> 'ready' THEN 1 ELSE 0 END)::int AS failed,
         PERCENTILE_DISC(0.95) WITHIN GROUP (ORDER BY "dbMs") AS p95_db_ms
       FROM "UptimeProbe"
       WHERE "createdAt" > NOW() - INTERVAL '1 hour'`
    )
    const row = rows[0] || {}
    return {
      failed: row.failed || 0,
      total: row.total || 0,
      p95DbMs: row.p95_db_ms != null ? Number(row.p95_db_ms) : null,
    }
  } catch {
    return { failed: 0, total: 0, p95DbMs: null }
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

/**
 * Uptime-probe failure severity. The probe runs every 5 minutes, so the
 * expected count per hour is ~12. We classify on raw failures rather than
 * ratio because even a single failure in a 5-probe window means we were
 * actually down, which matters more than the denominator. Thresholds:
 *   1      → info  (single blip, likely a transient provider glitch)
 *   2      → warning (10+ minutes of not-ready, worth eyeballs)
 *   3+     → critical (15+ minutes of not-ready, something is broken)
 * Total<1 is also returned as null — if the probe itself stopped running,
 * the stale-cron alert is the right signal, not this one.
 */
function classifyUptimeFailures(
  failed: number,
  total: number
): 'critical' | 'warning' | 'info' | null {
  if (total === 0) return null
  if (failed >= 3) return 'critical'
  if (failed >= 2) return 'warning'
  if (failed >= 1) return 'info'
  return null
}

/**
 * DB p95 latency severity. The uptime probe records dbMs for each probe;
 * over a healthy hour it should stay under 100ms on Neon. When it climbs
 * above 500ms p95 we're trending into "users will notice", above 1500ms
 * the DB is effectively unresponsive even though the probes still count
 * as 'ready'. This catches slowdowns that the failure classifier misses.
 */
function classifyDbLatency(
  p95Ms: number | null
): 'critical' | 'warning' | 'info' | null {
  if (p95Ms == null) return null
  if (p95Ms >= 1500) return 'critical'
  if (p95Ms >= 500) return 'warning'
  if (p95Ms >= 200) return 'info'
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
    uptimeHealth,
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
    getUptimeProbeHealthLastHour(),
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

  // 9. Uptime probe failures — /api/health said not_ready. This is the
  // "are we actually online?" signal. The classifier returns null when
  // the probe itself hasn't run, so a broken probe cron surfaces via the
  // stale-cron alert above instead of masking itself as "no failures".
  const uptimeFailSeverity = classifyUptimeFailures(
    uptimeHealth.failed,
    uptimeHealth.total
  )
  if (uptimeFailSeverity) {
    alerts.push({
      id: 'uptime-failures',
      type: uptimeFailSeverity,
      title: 'Uptime Probe Failures (1h)',
      count: uptimeHealth.failed,
      href: '/admin/health',
      description: `${uptimeHealth.failed}/${uptimeHealth.total} probes reported not_ready`,
    })
  }

  // 10. DB latency p95 — uptime probe measured the round-trip time and
  // the 95th percentile has climbed. This catches slowdowns that don't
  // break the probe outright but will definitely be felt by users. Uses
  // rounded milliseconds as the "count" so the alert row reads naturally.
  const dbLatencySeverity = classifyDbLatency(uptimeHealth.p95DbMs)
  if (dbLatencySeverity && uptimeHealth.p95DbMs != null) {
    alerts.push({
      id: 'db-latency',
      type: dbLatencySeverity,
      title: 'DB Latency p95 (1h)',
      count: Math.round(uptimeHealth.p95DbMs),
      href: '/admin/health',
      description: 'Database round-trip p95 measured by the uptime probe (ms)',
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
        uptimeFailures: uptimeHealth.failed,
        uptimeProbes: uptimeHealth.total,
        dbP95Ms: uptimeHealth.p95DbMs,
      },
    },
  }

  cachedPayload = { body: payload, expires: Date.now() + CACHE_TTL_MS }

  // Fire-and-forget: persist fire/clear transitions into AlertIncident so
  // /admin/alert-history can show "when did this start and how long did it
  // fire for?" Intentionally NOT awaited — the hot path doesn't wait on
  // history writes, and errors inside snapshotAlerts are swallowed.
  void snapshotAlerts(alerts)

  return NextResponse.json(payload)
}
