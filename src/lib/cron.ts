import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'

// ──────────────────────────────────────────────────────────────────────────
// Cron run tracking.
//
// Every cron handler should wrap its work in withCronRun() so the /ops/crons
// observability page can show last-run, last-result, and last-error for every
// scheduled job. Pattern:
//
//   export async function GET(request: NextRequest) {
//     // ... auth check ...
//     return withCronRun('mrp-nightly', async () => {
//       const result = await runMrpProjection(...)
//       return NextResponse.json(result)
//     })
//   }
//
// The CronRun table is auto-created on first call (AuditLog pattern).
// ──────────────────────────────────────────────────────────────────────────

let tableEnsured = false

async function ensureTable() {
  if (tableEnsured) return
  try {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "CronRun" (
        "id" TEXT PRIMARY KEY,
        "name" TEXT NOT NULL,
        "status" TEXT NOT NULL DEFAULT 'RUNNING',
        "startedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "finishedAt" TIMESTAMPTZ,
        "durationMs" INTEGER,
        "result" JSONB,
        "error" TEXT,
        "triggeredBy" TEXT DEFAULT 'schedule'
      )
    `)
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "idx_cronrun_name_started" ON "CronRun" ("name", "startedAt" DESC)
    `)
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "idx_cronrun_status" ON "CronRun" ("status")
    `)
    tableEnsured = true
  } catch (e) {
    tableEnsured = true
  }
}

export type CronStatus = 'RUNNING' | 'SUCCESS' | 'FAILURE'

export async function startCronRun(
  name: string,
  triggeredBy: 'schedule' | 'manual' = 'schedule'
): Promise<string> {
  try {
    await ensureTable()
    const id = 'cr' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
    await prisma.$executeRawUnsafe(
      `INSERT INTO "CronRun" ("id", "name", "status", "startedAt", "triggeredBy")
       VALUES ($1, $2, 'RUNNING', NOW(), $3)`,
      id,
      name,
      triggeredBy
    )
    return id
  } catch (e: any) {
    logger.error('cron_run_start_failed', e, { name })
    return ''
  }
}

export async function finishCronRun(
  id: string,
  status: 'SUCCESS' | 'FAILURE',
  durationMs: number,
  payload: { result?: any; error?: string }
) {
  if (!id) return
  try {
    const resultJson = payload.result ? JSON.stringify(payload.result).slice(0, 20000) : null
    await prisma.$executeRawUnsafe(
      `UPDATE "CronRun"
       SET "status" = $2,
           "finishedAt" = NOW(),
           "durationMs" = $3,
           "result" = $4::jsonb,
           "error" = $5
       WHERE "id" = $1`,
      id,
      status,
      Math.round(durationMs),
      resultJson,
      (payload.error || null)?.toString().slice(0, 4000) ?? null
    )
  } catch (e: any) {
    logger.error('cron_run_finish_failed', e, { id, status })
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Higher-order wrapper: runs a cron handler function inside a tracked run.
// The handler may return either a Response (NextResponse) or a plain object.
//
// On success: marks the run SUCCESS and records the JSON-serializable result.
// On failure: marks the run FAILURE with the error message, then re-throws.
// ──────────────────────────────────────────────────────────────────────────
export async function withCronRun<T>(
  name: string,
  fn: () => Promise<T>,
  opts: { triggeredBy?: 'schedule' | 'manual' } = {}
): Promise<T> {
  const runId = await startCronRun(name, opts.triggeredBy || 'schedule')
  const started = Date.now()
  try {
    const result = await fn()

    // If the result is a Response, we can't easily inspect its body without
    // consuming it. Just mark success with a minimal snapshot.
    if (result && typeof (result as any).json === 'function' && typeof (result as any).status === 'number') {
      await finishCronRun(runId, 'SUCCESS', Date.now() - started, {
        result: { status: (result as any).status },
      })
    } else {
      await finishCronRun(runId, 'SUCCESS', Date.now() - started, { result })
    }
    return result
  } catch (err: any) {
    await finishCronRun(runId, 'FAILURE', Date.now() - started, {
      error: err?.message || String(err),
    })
    throw err
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Query helpers for the observability page.
// ──────────────────────────────────────────────────────────────────────────

export interface CronSummary {
  name: string
  schedule: string
  lastRunAt: Date | null
  lastStatus: CronStatus | null
  lastDurationMs: number | null
  lastError: string | null
  successCount24h: number
  failureCount24h: number
}

// Declared crons from vercel.json, kept in sync manually.
// IMPORTANT: keep this list aligned with vercel.json "crons" — the /admin/crons
// page shows "missing" for any cron that fires but isn't listed here, and
// "stale" for any listed cron that hasn't run.
export const REGISTERED_CRONS: Array<{ name: string; schedule: string; description: string }> = [
  { name: 'quote-followups', schedule: '0 9 * * 1-5', description: 'Send follow-up emails on stale quotes' },
  { name: 'agent-opportunities', schedule: '0 14 * * 1-5', description: 'AI agent opportunity scoring' },
  { name: 'inflow-sync', schedule: '0 * * * *', description: 'Hourly InFlow inventory sync' },
  { name: 'bolt-sync', schedule: '30 * * * *', description: 'Hourly Bolt inventory sync' },
  { name: 'hyphen-sync', schedule: '15 * * * *', description: 'Hourly Hyphen BuildPro/SupplyPro sync' },
  { name: 'bpw-sync', schedule: '45 * * * *', description: 'Hourly BPW sync' },
  { name: 'run-automations', schedule: '0 8,13,17 * * 1-5', description: 'Run scheduled business automations' },
  { name: 'mrp-nightly', schedule: '0 4 * * *', description: 'Nightly MRP projection + PO recommendations' },
  { name: 'webhook-retry', schedule: '*/5 * * * *', description: 'Retry dead-lettered outbound webhooks' },
  { name: 'uptime-probe', schedule: '*/5 * * * *', description: 'Self-probe /api/health/ready and record uptime history' },
  { name: 'observability-gc', schedule: '0 3 * * *', description: 'Prune ClientError / SlowQueryLog / SecurityEvent retention' },
  { name: 'process-outreach', schedule: '*/10 * * * *', description: 'Process due outreach enrollment steps (auto-send + semi-auto review)' },
]

export async function getCronSummaries(): Promise<CronSummary[]> {
  try {
    await ensureTable()
    const rows = await prisma.$queryRawUnsafe<any[]>(`
      WITH latest AS (
        SELECT DISTINCT ON ("name")
          "name", "status", "startedAt", "finishedAt", "durationMs", "error"
        FROM "CronRun"
        ORDER BY "name", "startedAt" DESC
      ),
      counts AS (
        SELECT
          "name",
          COUNT(*) FILTER (WHERE "status" = 'SUCCESS' AND "startedAt" >= NOW() - INTERVAL '24 hours')::int AS "success24h",
          COUNT(*) FILTER (WHERE "status" = 'FAILURE' AND "startedAt" >= NOW() - INTERVAL '24 hours')::int AS "failure24h"
        FROM "CronRun"
        GROUP BY "name"
      )
      SELECT
        l.*,
        COALESCE(c."success24h", 0) AS "success24h",
        COALESCE(c."failure24h", 0) AS "failure24h"
      FROM latest l
      LEFT JOIN counts c USING ("name")
    `)
    const byName = new Map<string, any>(rows.map((r: any) => [r.name, r]))
    return REGISTERED_CRONS.map((c) => {
      const row = byName.get(c.name)
      return {
        name: c.name,
        schedule: c.schedule,
        lastRunAt: row?.startedAt || null,
        lastStatus: (row?.status as CronStatus) || null,
        lastDurationMs: row?.durationMs ?? null,
        lastError: row?.error ?? null,
        successCount24h: row?.success24h ?? 0,
        failureCount24h: row?.failure24h ?? 0,
      }
    })
  } catch (e: any) {
    logger.error('cron_summary_read_failed', e)
    return REGISTERED_CRONS.map((c) => ({
      name: c.name,
      schedule: c.schedule,
      lastRunAt: null,
      lastStatus: null,
      lastDurationMs: null,
      lastError: null,
      successCount24h: 0,
      failureCount24h: 0,
    }))
  }
}

export async function getCronRuns(name: string, limit = 20): Promise<any[]> {
  try {
    await ensureTable()
    const rows = await prisma.$queryRawUnsafe<any[]>(
      `SELECT "id", "name", "status", "startedAt", "finishedAt", "durationMs", "error", "triggeredBy"
       FROM "CronRun"
       WHERE "name" = $1
       ORDER BY "startedAt" DESC
       LIMIT $2`,
      name,
      limit
    )
    return rows
  } catch (e: any) {
    logger.error('cron_runs_read_failed', e, { name })
    return []
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Cron drift detector.
//
// Catches three classes of drift:
//   1. Orphaned — a cron name appears in CronRun but isn't in REGISTERED_CRONS
//      (usually: added to vercel.json, forgot to register here → no row on
//      /admin/crons).
//   2. Never-run — a cron IS in REGISTERED_CRONS but has never run
//      (usually: registered here but forgot to add to vercel.json).
//   3. Stale — a cron that HAS run before but hasn't fired in well past its
//      expected cadence (usually: vercel.json got mangled, cron secret rotated,
//      or handler is hard-erroring before startCronRun). The really dangerous
//      class — job looked healthy yesterday, silently stopped today.
//
// Returns only drift; an empty result means everything lines up.
// ──────────────────────────────────────────────────────────────────────────

export interface CronDriftReport {
  orphaned: Array<{ name: string; lastRunAt: Date | null; runs24h: number }>
  neverRun: Array<{ name: string; schedule: string }>
  stale: Array<{ name: string; schedule: string; lastRunAt: Date; minutesSinceLastRun: number; expectedMaxGapMinutes: number }>
}

/**
 * Translate a cron expression into a "worry threshold" — the number of minutes
 * past which we should consider the job stale. 3× the cadence so a single
 * skipped run isn't enough to alert (networks are flaky).
 *
 * Only handles the schedule shapes we actually use in vercel.json. Unknown
 * shapes fall back to 48h so we never false-alarm on novel patterns.
 */
export function expectedMaxGapMinutes(schedule: string): number {
  const parts = schedule.trim().split(/\s+/)
  if (parts.length !== 5) return 60 * 48
  const [minute, hour, _dom, _month, dow] = parts

  // "*/N * * * *" — every N minutes
  const everyN = /^\*\/(\d+)$/.exec(minute)
  if (everyN && hour === '*') {
    const n = parseInt(everyN[1], 10)
    return Math.max(n * 3, 15)
  }

  // Weekday business-hours schedules (dow = 1-5) can sleep through the weekend.
  // Give them a 3-day window so Monday-morning pages don't false-alarm.
  if (dow.includes('1-5') || /MON|TUE|WED|THU|FRI/i.test(dow)) {
    return 60 * 24 * 3
  }

  // Fixed-minute hourly: "N * * * *"
  if (/^\d+$/.test(minute) && hour === '*') {
    return 180
  }

  // Daily (numeric hour, dow=*): "N H * * *"
  if (/^\d+$/.test(minute) && /^\d/.test(hour) && dow === '*') {
    return 60 * 30
  }

  return 60 * 48
}

export async function detectCronDrift(): Promise<CronDriftReport> {
  try {
    await ensureTable()
    const rows = await prisma.$queryRawUnsafe<any[]>(`
      SELECT
        "name",
        MAX("startedAt") AS "lastRunAt",
        COUNT(*) FILTER (WHERE "startedAt" >= NOW() - INTERVAL '24 hours')::int AS "runs24h"
      FROM "CronRun"
      GROUP BY "name"
    `)

    const registered = new Set(REGISTERED_CRONS.map((c) => c.name))
    const seen = new Map<string, { lastRunAt: Date | null; runs24h: number }>()
    for (const r of rows) {
      seen.set(r.name, { lastRunAt: r.lastRunAt, runs24h: r.runs24h })
    }

    const orphaned: CronDriftReport['orphaned'] = []
    for (const [name, stats] of seen.entries()) {
      if (!registered.has(name)) {
        orphaned.push({ name, lastRunAt: stats.lastRunAt, runs24h: stats.runs24h })
      }
    }

    const neverRun: CronDriftReport['neverRun'] = []
    const stale: CronDriftReport['stale'] = []
    const now = Date.now()
    for (const c of REGISTERED_CRONS) {
      const row = seen.get(c.name)
      if (!row) {
        neverRun.push({ name: c.name, schedule: c.schedule })
        continue
      }
      if (!row.lastRunAt) continue
      const lastRunAt = new Date(row.lastRunAt)
      const minutesSinceLastRun = Math.round((now - lastRunAt.getTime()) / 60000)
      const maxGap = expectedMaxGapMinutes(c.schedule)
      if (minutesSinceLastRun > maxGap) {
        stale.push({
          name: c.name,
          schedule: c.schedule,
          lastRunAt,
          minutesSinceLastRun,
          expectedMaxGapMinutes: maxGap,
        })
      }
    }

    return { orphaned, neverRun, stale }
  } catch (e: any) {
    logger.error('cron_drift_detect_failed', e)
    return { orphaned: [], neverRun: [], stale: [] }
  }
}
