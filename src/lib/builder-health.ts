/**
 * A-BIZ-10: Aegis-native builder health score
 *
 * Pure, reproducible: same inputs → same score. No randomness, no clock
 * dependency beyond the snapshot timestamp. Lives entirely on Aegis data
 * (Order, Invoice, Payment, Activity, Quote, Builder), independent of NUC.
 *
 * Why this exists: when the NUC engine is down (which is the current state —
 * coordinator up, workers not yet provisioned), Abel ops has zero visibility
 * into account posture. This library is the fallback signal.
 */

import { prisma } from '@/lib/prisma'

export const HEALTH_WEIGHTS = {
  orderFrequency: 0.30,
  paymentBehavior: 0.30,
  arBalance: 0.20,
  activityRecency: 0.20,
} as const

export interface HealthFactors {
  orderFrequency: number // 0-100
  paymentBehavior: number // 0-100
  arBalance: number // 0-100
  activityRecency: number // 0-100
  raw: {
    ordersPerMonth: number
    avgDaysLatePayment: number | null
    arUtilization: number | null
    daysSinceLastActivity: number | null
    orderCount6mo: number
    paidInvoices90d: number
    creditLimit: number | null
    accountBalance: number
  }
}

export interface ComputedHealth {
  builderId: string
  score: number
  factors: HealthFactors
}

const PAYMENT_TERM_DAYS: Record<string, number> = {
  PAY_AT_ORDER: 0,
  PAY_ON_DELIVERY: 0,
  NET_15: 15,
  NET_30: 30,
}

// ── Component scorers (each returns 0-100) ────────────────────────────────

export function scoreOrderFrequency(ordersPerMonth: number): number {
  // < 0.5 = 30, 0.5-1 = 60, 1-2 = 80, > 2 = 100
  if (ordersPerMonth < 0.5) return 30
  if (ordersPerMonth < 1) return 60
  if (ordersPerMonth < 2) return 80
  return 100
}

export function scorePaymentBehavior(avgDaysLate: number | null): number {
  // null = no paid invoices in window — neutral 50
  if (avgDaysLate == null) return 50
  if (avgDaysLate <= 0) return 100 // on-time
  if (avgDaysLate <= 7) return 70
  if (avgDaysLate <= 30) return 40
  return 10
}

export function scoreArBalance(arUtilization: number | null): number {
  // null = no creditLimit set — neutral 50 (can't measure)
  if (arUtilization == null) return 50
  if (arUtilization < 0.5) return 100
  if (arUtilization < 0.75) return 70
  if (arUtilization <= 1.0) return 40
  return 0
}

export function scoreActivityRecency(daysSince: number | null): number {
  // null = never any activity — 20 (worst case but clamped)
  if (daysSince == null) return 20
  if (daysSince < 7) return 100
  if (daysSince < 30) return 80
  if (daysSince < 60) return 50
  return 20
}

export function composeScore(f: HealthFactors): number {
  const raw =
    f.orderFrequency * HEALTH_WEIGHTS.orderFrequency +
    f.paymentBehavior * HEALTH_WEIGHTS.paymentBehavior +
    f.arBalance * HEALTH_WEIGHTS.arBalance +
    f.activityRecency * HEALTH_WEIGHTS.activityRecency
  return Math.max(0, Math.min(100, Math.round(raw)))
}

// ── Trend ─────────────────────────────────────────────────────────────────

export function deriveTrend(currentScore: number, priorScore: number | null): string {
  if (priorScore == null) return 'stable'
  const delta = currentScore - priorScore
  if (delta > 5) return 'improving'
  if (delta < -5) return 'declining'
  return 'stable'
}

// ── Letter grade for UI ───────────────────────────────────────────────────

export function scoreToGrade(score: number): 'A' | 'B' | 'C' | 'D' | 'F' {
  if (score >= 90) return 'A'
  if (score >= 80) return 'B'
  if (score >= 70) return 'C'
  if (score >= 60) return 'D'
  return 'F'
}

export function scoreToTrafficLight(score: number): 'green' | 'yellow' | 'red' {
  if (score >= 75) return 'green'
  if (score >= 50) return 'yellow'
  return 'red'
}

// ── Computation ───────────────────────────────────────────────────────────
// All queries use raw SQL because we read across loose-FK tables (Invoice's
// builderId is not a Prisma relation) and the cron iterates per-builder so
// each query is small.

export interface BuilderHealthInput {
  builderId: string
  paymentTerm: string
  creditLimit: number | null
  accountBalance: number
  /** "now" anchor for reproducibility — defaults to new Date() */
  now?: Date
}

export async function computeBuilderHealth(input: BuilderHealthInput): Promise<ComputedHealth> {
  const now = input.now || new Date()
  const sixMonthsAgo = new Date(now.getTime() - 180 * 86_400_000)
  const ninetyDaysAgo = new Date(now.getTime() - 90 * 86_400_000)

  // 1. Order frequency over last 6 months
  const orderRows: Array<{ cnt: bigint }> = await prisma.$queryRawUnsafe(
    `SELECT COUNT(*)::bigint AS cnt
       FROM "Order"
      WHERE "builderId" = $1
        AND "createdAt" >= $2
        AND "status" <> 'CANCELLED'`,
    input.builderId,
    sixMonthsAgo,
  )
  const orderCount6mo = Number(orderRows[0]?.cnt ?? 0)
  // Six months = 6.0 months exactly (the time window). Don't need partial-month math.
  const ordersPerMonth = orderCount6mo / 6
  const orderFrequency = scoreOrderFrequency(ordersPerMonth)

  // 2. Payment behavior over last 90 days. Avg days late = paidAt − dueDate
  // for PAID invoices closed in the window. Only count if we have both stamps.
  const payRows: Array<{ avg_days_late: number | null; paid_count: bigint }> =
    await prisma.$queryRawUnsafe(
      `SELECT AVG(EXTRACT(EPOCH FROM (i."paidAt" - i."dueDate")) / 86400)::float AS avg_days_late,
              COUNT(*)::bigint AS paid_count
         FROM "Invoice" i
        WHERE i."builderId" = $1
          AND i."paidAt" IS NOT NULL
          AND i."dueDate" IS NOT NULL
          AND i."paidAt" >= $2`,
      input.builderId,
      ninetyDaysAgo,
    )
  const paidInvoices90d = Number(payRows[0]?.paid_count ?? 0)
  const avgDaysLatePayment =
    paidInvoices90d > 0 ? Number(payRows[0]?.avg_days_late ?? 0) : null
  const paymentBehavior = scorePaymentBehavior(avgDaysLatePayment)

  // 3. AR balance vs. credit limit. Use the live outstanding AR (sum of open
  // invoice balances) over creditLimit. accountBalance is a Builder-level
  // field; we prefer the invoice-derived figure because it's reproducible
  // from primary records.
  const arRows: Array<{ outstanding: number }> = await prisma.$queryRawUnsafe(
    `SELECT COALESCE(SUM(i."total" - COALESCE(i."amountPaid", 0)), 0)::float AS outstanding
       FROM "Invoice" i
      WHERE i."builderId" = $1
        AND i."status"::text IN ('ISSUED', 'SENT', 'PARTIALLY_PAID', 'OVERDUE')
        AND (i."total" - COALESCE(i."amountPaid", 0)) > 0`,
    input.builderId,
  )
  const outstanding = Number(arRows[0]?.outstanding ?? 0)
  const arUtilization =
    input.creditLimit && input.creditLimit > 0 ? outstanding / input.creditLimit : null
  const arBalance = scoreArBalance(arUtilization)

  // 4. Activity recency — most recent of: Order.createdAt, Quote.createdAt
  // (joined via Project.builderId), Payment.receivedAt (via Invoice.builderId),
  // Activity.createdAt. One MAX query per source then take the freshest.
  const recencyRows: Array<{ last_at: Date | null }> = await prisma.$queryRawUnsafe(
    `SELECT MAX(t)::timestamptz AS last_at FROM (
        SELECT MAX(o."createdAt") AS t FROM "Order" o WHERE o."builderId" = $1
        UNION ALL
        SELECT MAX(q."createdAt") FROM "Quote" q
          JOIN "Project" p ON p."id" = q."projectId"
         WHERE p."builderId" = $1
        UNION ALL
        SELECT MAX(p."receivedAt") FROM "Payment" p
          JOIN "Invoice" i ON i."id" = p."invoiceId"
         WHERE i."builderId" = $1
        UNION ALL
        SELECT MAX(a."createdAt") FROM "Activity" a WHERE a."builderId" = $1
      ) sub`,
    input.builderId,
  )
  const lastAt = recencyRows[0]?.last_at ? new Date(recencyRows[0].last_at) : null
  const daysSinceLastActivity = lastAt
    ? Math.max(0, Math.floor((now.getTime() - lastAt.getTime()) / 86_400_000))
    : null
  const activityRecency = scoreActivityRecency(daysSinceLastActivity)

  const factors: HealthFactors = {
    orderFrequency,
    paymentBehavior,
    arBalance,
    activityRecency,
    raw: {
      ordersPerMonth: Math.round(ordersPerMonth * 100) / 100,
      avgDaysLatePayment:
        avgDaysLatePayment == null ? null : Math.round(avgDaysLatePayment * 10) / 10,
      arUtilization: arUtilization == null ? null : Math.round(arUtilization * 1000) / 1000,
      daysSinceLastActivity,
      orderCount6mo,
      paidInvoices90d,
      creditLimit: input.creditLimit,
      accountBalance: input.accountBalance,
    },
  }

  return {
    builderId: input.builderId,
    score: composeScore(factors),
    factors,
  }
}

/**
 * Persist a snapshot for a single builder. Computes trend by reading the
 * most-recent snapshot from ≥30 days ago. Returns the row that was inserted.
 */
export async function snapshotBuilderHealth(
  input: BuilderHealthInput,
): Promise<{ id: string; score: number; trend: string; factors: HealthFactors }> {
  const computed = await computeBuilderHealth(input)
  const now = input.now || new Date()
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 86_400_000)

  const priorRows: Array<{ score: number }> = await prisma.$queryRawUnsafe(
    `SELECT "score"::int AS score
       FROM "BuilderHealthSnapshot"
      WHERE "builderId" = $1 AND "computedAt" <= $2
      ORDER BY "computedAt" DESC
      LIMIT 1`,
    input.builderId,
    thirtyDaysAgo,
  )
  const priorScore = priorRows.length > 0 ? Number(priorRows[0].score) : null
  const trend = deriveTrend(computed.score, priorScore)

  const id = 'bhs' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
  await prisma.$executeRawUnsafe(
    `INSERT INTO "BuilderHealthSnapshot" ("id", "builderId", "score", "trend", "factors", "computedAt")
     VALUES ($1, $2, $3, $4, $5::jsonb, $6)`,
    id,
    input.builderId,
    computed.score,
    trend,
    JSON.stringify(computed.factors),
    now,
  )

  return { id, score: computed.score, trend, factors: computed.factors }
}
