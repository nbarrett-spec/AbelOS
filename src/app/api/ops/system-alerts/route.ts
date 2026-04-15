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
//   - CronRun       (last 24h): failed scheduled jobs
//   - WebhookEvent             : dead-lettered inbound webhooks
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

export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  const [
    clientErrorCount,
    failedCronCount,
    deadLetterCount,
    overdueARCount,
    lowStockCount,
    rateLimitCount,
    authFailCount,
    cronDrift,
  ] = await Promise.all([
    countClientErrorsLastHour(),
    countFailedCronsLast24h(),
    countDeadLetterWebhooks(),
    countOverdueAR(),
    countLowStock(),
    countRateLimitRejectionsLast24h(),
    countAuthFailuresLast24h(),
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
      href: '/admin/errors',
      description: 'Unhandled React errors reported by the browser',
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

  return NextResponse.json({
    alerts,
    meta: {
      generatedAt: new Date().toISOString(),
      sources: {
        clientErrors: clientErrorCount,
        failedCrons: failedCronCount,
        staleCrons: staleCronCount,
        deadLetterWebhooks: deadLetterCount,
        overdueAR: overdueARCount,
        lowStock: lowStockCount,
        rateLimitRejections: rateLimitCount,
        authFailures: authFailCount,
      },
    },
  })
}
