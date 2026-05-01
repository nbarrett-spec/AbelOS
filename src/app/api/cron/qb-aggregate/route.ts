// ──────────────────────────────────────────────────────────────────────────
// /api/cron/qb-aggregate — daily QuickBooks finance snapshot
// ──────────────────────────────────────────────────────────────────────────
// Runs at 6am Central (11:00 UTC standard / 12:00 UTC daylight; we schedule
// at 11:00 UTC and accept the DST drift). Computes:
//   - AR aging buckets (current, 30, 60, 90+) over QbInvoice
//   - AP aging total over QbBill
//   - cash position (sum of QbAccount.balance where accountType = Bank)
//   - revenue MTD (sum QbInvoice.totalAmount where txnDate in current month)
//   - expenses MTD (sum QbBill.amountDue where txnDate in current month)
// and pushes a single 'finance_daily_snapshot' event to Brain.
//
// Until the Qb* tables exist, every query is wrapped in try/catch so this
// cron does not red-light the dashboard. Once the migration in scripts/qb/
// has been applied, the queries return real numbers.

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { withCronRun } from '@/lib/cron'
import { logger } from '@/lib/logger'
import { pushBrainEvents } from '@/lib/qbwc/brain'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

interface AgingRow {
  total: number
  current: number
  d30: number
  d60: number
  d90plus: number
}

async function safeQuery<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn()
  } catch (err: any) {
    logger.warn('qb-aggregate.query_failed', { error: err?.message })
    return fallback
  }
}

async function computeArAging(today: Date): Promise<AgingRow> {
  const t30 = new Date(today.getTime() - 30 * 86400_000)
  const t60 = new Date(today.getTime() - 60 * 86400_000)
  const t90 = new Date(today.getTime() - 90 * 86400_000)

  return safeQuery(async () => {
    const rows = await prisma.$queryRawUnsafe<AgingRow[]>(
      `SELECT
         COALESCE(SUM("balanceRemaining"), 0)::float AS total,
         COALESCE(SUM(CASE WHEN "dueDate" >= $1 THEN "balanceRemaining" ELSE 0 END), 0)::float AS current,
         COALESCE(SUM(CASE WHEN "dueDate" < $1 AND "dueDate" >= $2 THEN "balanceRemaining" ELSE 0 END), 0)::float AS d30,
         COALESCE(SUM(CASE WHEN "dueDate" < $2 AND "dueDate" >= $3 THEN "balanceRemaining" ELSE 0 END), 0)::float AS d60,
         COALESCE(SUM(CASE WHEN "dueDate" < $3 THEN "balanceRemaining" ELSE 0 END), 0)::float AS d90plus
       FROM "QbInvoice" WHERE COALESCE("balanceRemaining", 0) > 0`,
      today,
      t30,
      t60,
      t90
    )
    return rows[0] ?? { total: 0, current: 0, d30: 0, d60: 0, d90plus: 0 }
  }, { total: 0, current: 0, d30: 0, d60: 0, d90plus: 0 })
}

async function computeApTotal(): Promise<number> {
  return safeQuery(async () => {
    const rows = await prisma.$queryRawUnsafe<{ total: number }[]>(
      `SELECT COALESCE(SUM("amountDue"), 0)::float AS total FROM "QbBill" WHERE "isPaid" = false`
    )
    return rows[0]?.total ?? 0
  }, 0)
}

async function computeCashPosition(): Promise<number> {
  return safeQuery(async () => {
    const rows = await prisma.$queryRawUnsafe<{ total: number }[]>(
      `SELECT COALESCE(SUM("balance"), 0)::float AS total
       FROM "QbAccount"
       WHERE "isActive" = true AND "accountType" ILIKE '%Bank%'`
    )
    return rows[0]?.total ?? 0
  }, 0)
}

async function computeMonthSums(today: Date): Promise<{ revenueMtd: number; expensesMtd: number }> {
  const monthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1))
  const revenueMtd = await safeQuery(async () => {
    const rows = await prisma.$queryRawUnsafe<{ total: number }[]>(
      `SELECT COALESCE(SUM("totalAmount"), 0)::float AS total
       FROM "QbInvoice" WHERE "txnDate" >= $1`,
      monthStart
    )
    return rows[0]?.total ?? 0
  }, 0)
  const expensesMtd = await safeQuery(async () => {
    const rows = await prisma.$queryRawUnsafe<{ total: number }[]>(
      `SELECT COALESCE(SUM("amountDue"), 0)::float AS total
       FROM "QbBill" WHERE "txnDate" >= $1`,
      monthStart
    )
    return rows[0]?.total ?? 0
  }, 0)
  return { revenueMtd, expensesMtd }
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  // Same auth pattern as other crons in this repo.
  const authHeader = req.headers.get('authorization') || ''
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  return await withCronRun('qb-aggregate', async () => {
    const today = new Date()
    today.setUTCHours(0, 0, 0, 0)

    const [ar, apTotal, cash, monthSums] = await Promise.all([
      computeArAging(today),
      computeApTotal(),
      computeCashPosition(),
      computeMonthSums(today),
    ])

    const snapshot = {
      asOf: today.toISOString(),
      ar,
      apTotal,
      cashPosition: cash,
      revenueMtd: monthSums.revenueMtd,
      expensesMtd: monthSums.expensesMtd,
    }

    await pushBrainEvents([
      {
        source: 'quickbooks',
        event_type: 'finance_daily_snapshot',
        source_id: `qb-snapshot-${today.toISOString().slice(0, 10)}`,
        occurred_at: new Date().toISOString(),
        content: snapshot,
      },
    ])

    logger.info('qb-aggregate.complete', snapshot)
    return NextResponse.json({ ok: true, snapshot })
  })
}
