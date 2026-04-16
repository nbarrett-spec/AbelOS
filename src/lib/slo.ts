import { prisma } from '@/lib/prisma'

// ──────────────────────────────────────────────────────────────────────────
// SLO computation library.
//
// Defines service-level objectives as code constants and computes current
// status by querying the observability tables we already have:
//
//   - Availability   → UptimeProbe   (successful probes / total probes)
//   - Error budget   → ClientError + ServerError (errors per day, 30d avg)
//   - DB latency p95 → UptimeProbe   (p95 of dbMs over the SLO window)
//
// Each SLO carries a target, a rolling window, and thresholds for warning
// and critical states mapped to budget consumption:
//   - budget >= 50% remaining → healthy
//   - budget >= 20% remaining → warning (burning faster than sustainable)
//   - budget < 20% remaining  → critical (on track to blow the SLO)
//
// The public entry point is computeAllSlos() which returns a typed array
// ready for the API route and the admin page. Every query swallows errors
// and returns a "no data" result rather than throwing — same pattern as
// the rest of the observability stack.
// ──────────────────────────────────────────────────────────────────────────

export type SloStatus = 'healthy' | 'warning' | 'critical' | 'no_data'

export interface SloDefinition {
  id: string
  name: string
  description: string
  target: number // e.g., 0.999 for 99.9%
  unit: string // e.g., '%', 'ms', 'errors/day'
  windowDays: number
}

export interface SloResult extends SloDefinition {
  status: SloStatus
  currentValue: number | null // measured value in the same unit as target
  budgetTotal: number // total error budget in natural units
  budgetUsed: number // how much budget has been consumed
  budgetRemainingPct: number // 0–100
  burnRate: number | null // budget consumption rate per day (>1 = burning faster than sustainable)
  dataPoints: number // how many data points backed the computation
  computedAt: string // ISO timestamp
}

// ──────────────────────────────────────────────────────────────────────────
// SLO definitions. These are the contracts we hold ourselves to.
// ──────────────────────────────────────────────────────────────────────────

export const SLO_DEFINITIONS: SloDefinition[] = [
  {
    id: 'availability',
    name: 'Availability',
    description:
      'Percentage of uptime probe checks that return "ready" over a rolling 30-day window.',
    target: 0.999, // 99.9%
    unit: '%',
    windowDays: 30,
  },
  {
    id: 'error-rate',
    name: 'Error Rate',
    description:
      'Average combined client + server errors per day over a rolling 30-day window. Target: fewer than 50 errors/day.',
    target: 50, // ≤50 errors per day
    unit: 'errors/day',
    windowDays: 30,
  },
  {
    id: 'db-latency-p95',
    name: 'DB Latency (p95)',
    description:
      'p95 database round-trip time measured by uptime probes over a rolling 30-day window.',
    target: 200, // ≤200ms
    unit: 'ms',
    windowDays: 30,
  },
]

// ──────────────────────────────────────────────────────────────────────────
// Computation helpers — one per SLO type.
// ──────────────────────────────────────────────────────────────────────────

async function computeAvailability(
  def: SloDefinition
): Promise<SloResult> {
  const base = makeBaseResult(def)
  try {
    const rows: any[] = await prisma.$queryRawUnsafe(
      `SELECT
         COUNT(*)::int AS total,
         SUM(CASE WHEN "status" = 'ready' THEN 1 ELSE 0 END)::int AS good
       FROM "UptimeProbe"
       WHERE "createdAt" > NOW() - INTERVAL '${def.windowDays} days'`
    )
    const row = rows[0]
    const total = Number(row?.total) || 0
    const good = Number(row?.good) || 0
    if (total === 0) return { ...base, status: 'no_data', dataPoints: 0 }

    const currentPct = good / total // 0.0–1.0
    const badAllowed = Math.floor(total * (1 - def.target)) // total error budget in probes
    const badActual = total - good
    const budgetRemainingPct =
      badAllowed > 0
        ? Math.max(0, ((badAllowed - badActual) / badAllowed) * 100)
        : badActual === 0
          ? 100
          : 0
    // Burn rate: if we're consuming 1 day's worth of budget per day, rate=1.
    // rate>1 means we'll blow the budget before the window closes.
    const daysElapsed = Math.min(def.windowDays, total / (288)) // 288 = 12 probes/hr * 24h
    const sustainableRate = daysElapsed > 0 ? badActual / daysElapsed : 0
    const dailyBudget = badAllowed / def.windowDays
    const burnRate = dailyBudget > 0 ? sustainableRate / dailyBudget : null

    return {
      ...base,
      status: classifyBudget(budgetRemainingPct),
      currentValue: Math.round(currentPct * 10000) / 100, // e.g., 99.93
      budgetTotal: badAllowed,
      budgetUsed: badActual,
      budgetRemainingPct: Math.round(budgetRemainingPct * 100) / 100,
      burnRate: burnRate != null ? Math.round(burnRate * 100) / 100 : null,
      dataPoints: total,
    }
  } catch {
    return base
  }
}

async function computeErrorRate(
  def: SloDefinition
): Promise<SloResult> {
  const base = makeBaseResult(def)
  try {
    // Count errors from both tables, grouped by day, then average.
    const rows: any[] = await prisma.$queryRawUnsafe(
      `WITH daily AS (
         SELECT d::date AS day,
           (SELECT COUNT(*)::int FROM "ClientError" WHERE "createdAt"::date = d::date) +
           (SELECT COUNT(*)::int FROM "ServerError" WHERE "createdAt"::date = d::date) AS errors
         FROM generate_series(
           NOW() - INTERVAL '${def.windowDays} days',
           NOW(),
           '1 day'
         ) AS d
       )
       SELECT
         COUNT(*)::int AS days,
         COALESCE(SUM(errors), 0)::int AS total_errors,
         COALESCE(AVG(errors), 0)::float AS avg_errors_per_day,
         COALESCE(MAX(errors), 0)::int AS worst_day
       FROM daily`
    )
    const row = rows[0]
    const days = Number(row?.days) || 0
    const totalErrors = Number(row?.total_errors) || 0
    const avgPerDay = Number(row?.avg_errors_per_day) || 0
    if (days === 0) return { ...base, status: 'no_data', dataPoints: 0 }

    // Budget: target is max errors/day. Over the window, total budget =
    // target * windowDays. Used = actual total errors.
    const budgetTotal = def.target * def.windowDays
    const budgetUsed = totalErrors
    const budgetRemainingPct =
      budgetTotal > 0
        ? Math.max(0, ((budgetTotal - budgetUsed) / budgetTotal) * 100)
        : budgetUsed === 0
          ? 100
          : 0

    const dailyBudget = def.target // errors/day
    const burnRate = dailyBudget > 0 ? avgPerDay / dailyBudget : null

    return {
      ...base,
      status: classifyBudget(budgetRemainingPct),
      currentValue: Math.round(avgPerDay * 10) / 10,
      budgetTotal: Math.round(budgetTotal),
      budgetUsed,
      budgetRemainingPct: Math.round(budgetRemainingPct * 100) / 100,
      burnRate: burnRate != null ? Math.round(burnRate * 100) / 100 : null,
      dataPoints: days,
    }
  } catch {
    return base
  }
}

async function computeDbLatencyP95(
  def: SloDefinition
): Promise<SloResult> {
  const base = makeBaseResult(def)
  try {
    const rows: any[] = await prisma.$queryRawUnsafe(
      `SELECT
         COUNT(*)::int AS total,
         PERCENTILE_DISC(0.95) WITHIN GROUP (ORDER BY "dbMs") AS p95
       FROM "UptimeProbe"
       WHERE "createdAt" > NOW() - INTERVAL '${def.windowDays} days'
         AND "dbMs" IS NOT NULL`
    )
    const row = rows[0]
    const total = Number(row?.total) || 0
    const p95 = row?.p95 != null ? Number(row.p95) : null
    if (total === 0 || p95 == null)
      return { ...base, status: 'no_data', dataPoints: 0 }

    // For latency SLOs, "budget" is how far we are from the target.
    // We express it as: if target is 200ms and current p95 is 150ms,
    // we've used 75% of the budget (150/200). Remaining = 25%.
    // If p95 > target we've blown the budget.
    const budgetUsedPct = (p95 / def.target) * 100
    const budgetRemainingPct = Math.max(0, 100 - budgetUsedPct)

    // Burn rate: compute a trailing 1-day p95 and compare to the window p95.
    // If the trailing p95 is higher, the burn rate is accelerating.
    let burnRate: number | null = null
    try {
      const recent: any[] = await prisma.$queryRawUnsafe(
        `SELECT PERCENTILE_DISC(0.95) WITHIN GROUP (ORDER BY "dbMs") AS p95_1d
         FROM "UptimeProbe"
         WHERE "createdAt" > NOW() - INTERVAL '1 day'
           AND "dbMs" IS NOT NULL`
      )
      const p95_1d = recent[0]?.p95_1d != null ? Number(recent[0].p95_1d) : null
      if (p95_1d != null) {
        // burn rate = trailing 1d p95 / target. >1 = burning faster than budget allows.
        burnRate = Math.round((p95_1d / def.target) * 100) / 100
      }
    } catch {
      // leave burnRate null
    }

    return {
      ...base,
      status: classifyBudget(budgetRemainingPct),
      currentValue: Math.round(p95),
      budgetTotal: Math.round(def.target),
      budgetUsed: Math.round(p95),
      budgetRemainingPct: Math.round(budgetRemainingPct * 100) / 100,
      burnRate,
      dataPoints: total,
    }
  } catch {
    return base
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Shared helpers.
// ──────────────────────────────────────────────────────────────────────────

function classifyBudget(remainingPct: number): SloStatus {
  if (remainingPct >= 50) return 'healthy'
  if (remainingPct >= 20) return 'warning'
  return 'critical'
}

function makeBaseResult(def: SloDefinition): SloResult {
  return {
    ...def,
    status: 'no_data',
    currentValue: null,
    budgetTotal: 0,
    budgetUsed: 0,
    budgetRemainingPct: 100,
    burnRate: null,
    dataPoints: 0,
    computedAt: new Date().toISOString(),
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Public API.
// ──────────────────────────────────────────────────────────────────────────

const COMPUTE_MAP: Record<string, (def: SloDefinition) => Promise<SloResult>> =
  {
    availability: computeAvailability,
    'error-rate': computeErrorRate,
    'db-latency-p95': computeDbLatencyP95,
  }

/**
 * Compute all SLOs. Each one runs independently — a failure in one doesn't
 * block the others. Returns the full array; callers can filter by status.
 */
export async function computeAllSlos(): Promise<SloResult[]> {
  const results = await Promise.all(
    SLO_DEFINITIONS.map(async (def) => {
      const fn = COMPUTE_MAP[def.id]
      if (!fn) return makeBaseResult(def)
      try {
        return await fn(def)
      } catch {
        return makeBaseResult(def)
      }
    })
  )
  return results
}

/**
 * Returns only the SLOs that are in warning or critical state —
 * ready to be injected into the system-alerts pipeline.
 */
export async function getSloAlerts(): Promise<
  Array<{
    id: string
    type: 'critical' | 'warning'
    title: string
    count: number
    href: string
    description: string
  }>
> {
  const slos = await computeAllSlos()
  const alerts: Array<{
    id: string
    type: 'critical' | 'warning'
    title: string
    count: number
    href: string
    description: string
  }> = []

  for (const slo of slos) {
    if (slo.status !== 'warning' && slo.status !== 'critical') continue
    alerts.push({
      id: `slo-${slo.id}`,
      type: slo.status,
      title: `SLO: ${slo.name} budget ${slo.status === 'critical' ? 'critical' : 'burning'}`,
      count: Math.round(slo.budgetRemainingPct),
      href: '/admin/slo',
      description: `${slo.name} has ${slo.budgetRemainingPct.toFixed(1)}% error budget remaining (burn rate: ${slo.burnRate ?? '?'}x). Target: ${formatTarget(slo)}.`,
    })
  }

  return alerts
}

function formatTarget(slo: SloDefinition): string {
  if (slo.unit === '%') return `${(slo.target * 100).toFixed(1)}%`
  return `≤${slo.target} ${slo.unit}`
}
