export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

// ──────────────────────────────────────────────────────────────────────────
// GET /api/health/crons — Cron health snapshot.
//
// Aegis runs ~39 crons (see REGISTERED_CRONS + vercel.json). There's no
// one-stop view of their health today — ops digs through CronRun rows by
// hand. This endpoint aggregates per-cron health in one JSON payload so
// Monday's admin integrations dashboard (Wave 3) can consume it, and so
// ops has a curl-friendly URL.
//
// Per cron we return:
//   - last run timestamp + status + duration + error
//   - success/failure counts in the last 24h
//   - consecutiveFailures (failures since last success)
//   - 7-day avg duration
//   - health classification (GREEN/YELLOW/RED)
//
// Auth:
//   - Mirrors /api/health and /api/health/ready: no staff session required
//     (monitors curl this). If HEALTH_TOKEN is set in the environment,
//     requests must present it as `Authorization: Bearer <token>` or
//     `?token=<token>`. Otherwise open (matching liveness/readiness).
//
// Performance:
//   - One SQL round-trip via CTEs. For 39 names this returns in well
//     under 500ms against Neon given the existing
//     @@index([name, startedAt(sort: Desc)]) on CronRun.
// ──────────────────────────────────────────────────────────────────────────

const ZOMBIE_THRESHOLD_MS = 15 * 60 * 1000 // 15 minutes

type HealthColor = 'GREEN' | 'YELLOW' | 'RED'
type CronStatus = 'SUCCESS' | 'FAILURE' | 'RUNNING' | null

interface CronHealth {
  name: string
  lastRunAt: string | null
  lastStatus: CronStatus
  lastDurationMs: number | null
  lastError: string | null
  successCount24h: number
  failureCount24h: number
  consecutiveFailures: number
  avgDurationMs7d: number | null
  health: HealthColor
}

interface CronHealthResponse {
  generatedAt: string
  cronCount: number
  healthy: number
  degraded: number
  zombies: number
  crons: CronHealth[]
  note?: string
}

// Raw row shape returned by the aggregation query. Postgres numerics come
// through as strings, so coerce defensively.
interface CronAggRow {
  name: string
  last_run_at: Date | null
  last_status: string | null
  last_duration_ms: number | string | null
  last_error: string | null
  last_started_at: Date | null
  success_24h: number | string | null
  failure_24h: number | string | null
  consecutive_failures: number | string | null
  avg_duration_ms_7d: number | string | null
  is_zombie: boolean | null
  previous_status: string | null
}

function toInt(v: number | string | null | undefined): number {
  if (v === null || v === undefined) return 0
  const n = typeof v === 'string' ? parseInt(v, 10) : v
  return Number.isFinite(n) ? n : 0
}

function toNullableInt(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined) return null
  const n = typeof v === 'string' ? parseFloat(v) : v
  return Number.isFinite(n) ? Math.round(n) : null
}

function isMissingTableError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err)
  return (
    /CronRun/i.test(msg) &&
    (/does not exist/i.test(msg) || /no such table/i.test(msg) || /relation/i.test(msg))
  ) || /P2021/.test(msg)
}

function authGuard(request: NextRequest): NextResponse | null {
  const required = process.env.HEALTH_TOKEN
  if (!required) return null // no token configured → open, matches /api/health
  const header = request.headers.get('authorization') || ''
  const bearer = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : ''
  const queryToken = new URL(request.url).searchParams.get('token') || ''
  if (bearer === required || queryToken === required) return null
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
}

function classify(row: {
  lastStatus: CronStatus
  consecutiveFailures: number
  isZombie: boolean
  previousStatus: string | null
}): HealthColor {
  // RED: zombie, or 3+ consecutive failures, or last two runs both failed
  if (row.isZombie) return 'RED'
  if (row.consecutiveFailures >= 3) return 'RED'
  if (row.lastStatus === 'FAILURE' && row.previousStatus === 'FAILURE') return 'RED'

  // YELLOW: currently running (but not zombie), or 1-2 consecutive failures
  if (row.lastStatus === 'RUNNING') return 'YELLOW'
  if (row.consecutiveFailures >= 1 && row.consecutiveFailures <= 2) return 'YELLOW'

  // GREEN: last SUCCESS and no consecutive failures
  if (row.lastStatus === 'SUCCESS' && row.consecutiveFailures === 0) return 'GREEN'

  // Fallback: no runs at all, or ambiguous. Treat as YELLOW so it surfaces.
  return 'YELLOW'
}

export async function GET(request: NextRequest) {
  const unauthorized = authGuard(request)
  if (unauthorized) return unauthorized

  const generatedAt = new Date().toISOString()

  try {
    // One round-trip. The CTEs:
    //   names:         distinct cron names that have ever run
    //   latest:        one row per name, the most recent CronRun
    //   prior:         the run immediately before the latest (for "FAILURE then FAILURE")
    //   windowed_24h:  counts by status over the last 24h
    //   last_success:  per-name timestamp of the most recent SUCCESS
    //   avg_7d:        per-name avg durationMs for SUCCESS runs in last 7d
    //   consec_fails:  count of FAILURE runs newer than the last SUCCESS
    //
    // The DISTINCT ON relies on the existing (name, startedAt DESC) index
    // so it's an index scan, not a sort. For ~39 names this comes in well
    // under 100ms on Neon in steady state.
    const rows = await prisma.$queryRawUnsafe<CronAggRow[]>(`
      WITH names AS (
        SELECT DISTINCT "name" FROM "CronRun"
      ),
      latest AS (
        SELECT DISTINCT ON ("name")
          "name",
          "status"      AS last_status,
          "startedAt"   AS last_started_at,
          "finishedAt"  AS last_finished_at,
          "durationMs"  AS last_duration_ms,
          "error"       AS last_error
        FROM "CronRun"
        ORDER BY "name", "startedAt" DESC
      ),
      prior AS (
        SELECT "name", "status" AS previous_status
        FROM (
          SELECT
            "name",
            "status",
            ROW_NUMBER() OVER (PARTITION BY "name" ORDER BY "startedAt" DESC) AS rn
          FROM "CronRun"
        ) r
        WHERE r.rn = 2
      ),
      last_success AS (
        SELECT DISTINCT ON ("name")
          "name",
          "startedAt" AS success_at
        FROM "CronRun"
        WHERE "status" = 'SUCCESS'
        ORDER BY "name", "startedAt" DESC
      ),
      consec_fails AS (
        SELECT
          n."name",
          COALESCE((
            SELECT COUNT(*)
            FROM "CronRun" c
            WHERE c."name" = n."name"
              AND c."status" = 'FAILURE'
              AND c."startedAt" > COALESCE(ls.success_at, 'epoch'::timestamp)
          ), 0)::int AS consecutive_failures
        FROM names n
        LEFT JOIN last_success ls USING ("name")
      ),
      windowed_24h AS (
        SELECT
          "name",
          SUM(CASE WHEN "status" = 'SUCCESS' THEN 1 ELSE 0 END)::int AS success_24h,
          SUM(CASE WHEN "status" = 'FAILURE'  THEN 1 ELSE 0 END)::int AS failure_24h
        FROM "CronRun"
        WHERE "startedAt" >= NOW() - INTERVAL '24 hours'
        GROUP BY "name"
      ),
      avg_7d AS (
        SELECT
          "name",
          AVG("durationMs")::float AS avg_duration_ms_7d
        FROM "CronRun"
        WHERE "status" = 'SUCCESS'
          AND "durationMs" IS NOT NULL
          AND "startedAt" >= NOW() - INTERVAL '7 days'
        GROUP BY "name"
      )
      SELECT
        n."name"                                AS name,
        l.last_started_at                       AS last_run_at,
        l.last_status                           AS last_status,
        l.last_duration_ms                      AS last_duration_ms,
        l.last_error                            AS last_error,
        l.last_started_at                       AS last_started_at,
        COALESCE(w.success_24h, 0)              AS success_24h,
        COALESCE(w.failure_24h, 0)              AS failure_24h,
        COALESCE(cf.consecutive_failures, 0)    AS consecutive_failures,
        a.avg_duration_ms_7d                    AS avg_duration_ms_7d,
        (
          l.last_status = 'RUNNING'
          AND l.last_started_at < NOW() - INTERVAL '15 minutes'
        )                                       AS is_zombie,
        p.previous_status                       AS previous_status
      FROM names n
      LEFT JOIN latest       l  ON l."name"  = n."name"
      LEFT JOIN prior        p  ON p."name"  = n."name"
      LEFT JOIN consec_fails cf ON cf."name" = n."name"
      LEFT JOIN windowed_24h w  ON w."name"  = n."name"
      LEFT JOIN avg_7d       a  ON a."name"  = n."name"
      ORDER BY n."name" ASC
    `)

    const crons: CronHealth[] = rows.map((r) => {
      const lastStatus = (r.last_status as CronStatus) ?? null
      const consecutiveFailures = toInt(r.consecutive_failures)
      const isZombie = Boolean(r.is_zombie)
      const health = classify({
        lastStatus,
        consecutiveFailures,
        isZombie,
        previousStatus: r.previous_status,
      })
      return {
        name: r.name,
        lastRunAt: r.last_run_at ? new Date(r.last_run_at).toISOString() : null,
        lastStatus,
        lastDurationMs: toNullableInt(r.last_duration_ms),
        lastError: r.last_error,
        successCount24h: toInt(r.success_24h),
        failureCount24h: toInt(r.failure_24h),
        consecutiveFailures,
        avgDurationMs7d: toNullableInt(r.avg_duration_ms_7d),
        health,
      }
    })

    const zombies = crons.filter((c) => {
      // Re-derive zombie count from the raw rows rather than re-querying
      // so the summary matches the per-cron health classifications.
      return c.lastStatus === 'RUNNING' && c.lastRunAt
        ? Date.now() - new Date(c.lastRunAt).getTime() > ZOMBIE_THRESHOLD_MS
        : false
    }).length

    const healthy = crons.filter((c) => c.health === 'GREEN').length
    const degraded = crons.filter((c) => c.health !== 'GREEN').length

    const payload: CronHealthResponse = {
      generatedAt,
      cronCount: crons.length,
      healthy,
      degraded,
      zombies,
      crons,
    }

    return NextResponse.json(payload)
  } catch (err: unknown) {
    // Graceful degradation: if CronRun table is missing (fresh env, pre-migration,
    // local dev without seed) return 200 with an empty payload + note so the
    // downstream dashboard doesn't crash.
    if (isMissingTableError(err)) {
      const payload: CronHealthResponse = {
        generatedAt,
        cronCount: 0,
        healthy: 0,
        degraded: 0,
        zombies: 0,
        crons: [],
        note: 'CronRun table not found',
      }
      return NextResponse.json(payload)
    }

    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json(
      { error: message, generatedAt },
      { status: 500 }
    )
  }
}
