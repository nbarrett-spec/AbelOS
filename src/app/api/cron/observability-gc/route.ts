export const maxDuration = 60
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { startCronRun, finishCronRun } from '@/lib/cron'

// ──────────────────────────────────────────────────────────────────────────
// Observability GC.
//
// Trims the observability tables so they don't grow unbounded and become
// a performance problem of their own. Retention windows are tuned for
// "useful diagnostic window without drowning us in rows":
//
//   ClientError   — 30 days   (enough to triage regression trends)
//   ServerError   — 30 days   (matches ClientError window)
//   SlowQueryLog  — 14 days   (N+1 hunts are short-lived)
//   SecurityEvent — 60 days   (longer window for security forensics)
//   CronRun       — 90 days   (one full quarter of scheduled-job history)
//   AlertIncident — 90 days   (matches CronRun; flap history for a quarter)
//   UptimeProbe   — pruned by the uptime-probe cron itself (30d)
//
// AuditLog is intentionally NOT pruned here — it's compliance data and
// retention requires explicit business approval; growing it forever is
// the safer default.
//
// All deletes are indexed on "createdAt" DESC so even a million-row table
// prunes in milliseconds per table. Missing tables are swallowed so a
// fresh DB doesn't fail the cron. Note that CronRun uses "startedAt" for
// its time column, not "createdAt", so we use a timeCol field.
//
// AlertIncident carries an extraCondition so open incidents (endedAt IS
// NULL) are never pruned — an incident that's been firing for 100 days
// still deserves a row in the timeline, otherwise the "how long has this
// been broken" view loses its answer the moment the cron runs.
//
// Runs once daily at 03:00 UTC — low-traffic window.
// ──────────────────────────────────────────────────────────────────────────

const RETENTION: Array<{
  table: string
  days: number
  timeCol?: string
  extraCondition?: string
}> = [
  { table: 'ClientError', days: 30 },
  { table: 'ServerError', days: 30 },
  { table: 'SlowQueryLog', days: 14 },
  { table: 'SecurityEvent', days: 60 },
  { table: 'CronRun', days: 90, timeCol: 'startedAt' },
  {
    table: 'AlertIncident',
    days: 90,
    timeCol: 'startedAt',
    // Never prune an incident that is still firing — an alert that has
    // been open for 100+ days absolutely needs to stay visible.
    extraCondition: '"endedAt" IS NOT NULL',
  },
]

async function pruneTable(
  table: string,
  days: number,
  timeCol: string = 'createdAt',
  extraCondition?: string
): Promise<{ table: string; deleted: number | null; error?: string }> {
  try {
    // Raw SQL with identifier interpolation — table names, timeCol, and
    // extraCondition are hard-coded constants above, never user input, so
    // no injection risk.
    const extra = extraCondition ? ` AND ${extraCondition}` : ''
    const result = await prisma.$executeRawUnsafe(
      `DELETE FROM "${table}" WHERE "${timeCol}" < NOW() - INTERVAL '${days} days'${extra}`
    )
    return { table, deleted: typeof result === 'number' ? result : null }
  } catch (err: any) {
    // Missing table (42P01) is expected on a fresh DB — don't fail the cron.
    if (err?.code === '42P01' || err?.message?.includes(`"${table}"`)) {
      return { table, deleted: 0, error: 'table_missing' }
    }
    return { table, deleted: null, error: err?.message || String(err) }
  }
}

async function handle(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 })
  }
  if (!authHeader || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const runId = await startCronRun('observability-gc', 'schedule')
  const started = Date.now()

  try {
    const results = await Promise.all(
      RETENTION.map(({ table, days, timeCol, extraCondition }) =>
        pruneTable(table, days, timeCol, extraCondition)
      )
    )

    const totalDeleted = results.reduce(
      (s, r) => s + (typeof r.deleted === 'number' ? r.deleted : 0),
      0
    )
    const anyFailed = results.some((r) => r.error && r.error !== 'table_missing')

    const result = {
      success: !anyFailed,
      timestamp: new Date().toISOString(),
      totalDeleted,
      retention: RETENTION,
      results,
    }
    await finishCronRun(
      runId,
      anyFailed ? 'FAILURE' : 'SUCCESS',
      Date.now() - started,
      { result }
    )
    return NextResponse.json(result)
  } catch (error: any) {
    await finishCronRun(runId, 'FAILURE', Date.now() - started, {
      error: error?.message || String(error),
    })
    return NextResponse.json(
      { success: false, error: error?.message || String(error) },
      { status: 500 }
    )
  }
}

export async function GET(request: NextRequest) {
  return handle(request)
}
export async function POST(request: NextRequest) {
  return handle(request)
}
