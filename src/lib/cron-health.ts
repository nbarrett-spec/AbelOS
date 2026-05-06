import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'
import {
  expectedMaxGapMinutes,
  REGISTERED_CRONS,
  type CronSummary,
  type CronStatus,
} from '@/lib/cron'
import { logAudit } from '@/lib/audit'

// ──────────────────────────────────────────────────────────────────────────
// Cron health classification.
//
// The base cron observability surface (CronSummary, drift detector) tells you
// "did the job fire and not error". That isn't the same as healthy — we've
// caught silent-failure crons in the past month (InFlow, Hyphen, QBWC,
// BuilderTrend) where status='SUCCESS' but the work moved zero rows. This
// module layers a richer health badge that combines:
//
//   - Schedule cadence (how late is the last run?)
//   - Recent failure clustering (is this a flake or a trend?)
//   - Stuck RUNNING rows (Vercel hard-kill orphans)
//
// Five buckets. The badge is what Nate scans at a glance:
//
//   HEALTHY   — last SUCCESS within 2× cadence AND no failures in last 5 runs
//   DEGRADED  — last SUCCESS within 5× cadence, OR 1–2 failures in last 5 runs
//   DEAD      — no SUCCESS within 5× cadence, OR 3+ failures in last 5 runs
//   STUCK     — current RUNNING row > 1h old (Vercel timeout / lost finally)
//   NEVER_RAN — no CronRun rows for this name at all
//
// STUCK takes priority over the time-based buckets because a stuck row hides
// real progress signal. NEVER_RAN means the cron is registered but vercel.json
// hasn't fired it (or never will — wrong path / stale registration).
// ──────────────────────────────────────────────────────────────────────────

export type CronHealth = 'HEALTHY' | 'DEGRADED' | 'DEAD' | 'STUCK' | 'NEVER_RAN'

export interface RecentRunSnapshot {
  status: CronStatus
  startedAt: Date
  durationMs: number | null
}

export interface ComputeHealthInput {
  schedule: string
  lastRunAt: Date | null
  lastStatus: CronStatus | null
  recent: RecentRunSnapshot[] // up to last 5 runs, newest first
}

const STUCK_RUNNING_MINUTES = 60

/**
 * Pure function — given the recent-runs snapshot for a cron and its schedule,
 * return one of the five health buckets. No DB calls; testable in isolation.
 */
export function computeHealth(input: ComputeHealthInput): CronHealth {
  const { schedule, lastRunAt, lastStatus, recent } = input

  // No runs ever → NEVER_RAN takes priority.
  if (!lastRunAt || !lastStatus) {
    return 'NEVER_RAN'
  }

  // Stuck RUNNING — a row sitting in RUNNING for more than an hour is almost
  // always a Vercel hard-kill orphan (finishCronRun never ran). The watchdog
  // in startCronRun sweeps these every cron tick, but anything still RUNNING
  // longer than an hour is genuinely stuck and demands attention.
  const minutesSinceLastStart = Math.round((Date.now() - lastRunAt.getTime()) / 60_000)
  if (lastStatus === 'RUNNING' && minutesSinceLastStart > STUCK_RUNNING_MINUTES) {
    return 'STUCK'
  }

  const cadenceMin = expectedMaxGapMinutes(schedule) // already 3× cadence; "DEGRADED" stretches further
  const failuresInLastFive = recent.filter((r) => r.status === 'FAILURE').length

  // Find most recent SUCCESS in the snapshot, plus minutes since.
  const lastSuccess = recent.find((r) => r.status === 'SUCCESS')
  const minutesSinceLastSuccess = lastSuccess
    ? Math.round((Date.now() - lastSuccess.startedAt.getTime()) / 60_000)
    : null

  // DEAD: 3+ failures in last 5 runs OR no successful run within ~5× cadence
  // (expectedMaxGapMinutes is already 3× cadence; multiply by 1.7 ≈ 5×).
  const deadThresholdMin = cadenceMin * 1.7
  if (failuresInLastFive >= 3) return 'DEAD'
  if (minutesSinceLastSuccess === null) return 'DEAD' // ran 5+ times, never succeeded
  if (minutesSinceLastSuccess > deadThresholdMin) return 'DEAD'

  // DEGRADED: 1–2 failures in last 5 runs OR last success > cadence threshold
  // (cadenceMin == 3× cadence, the "stale" line)
  if (failuresInLastFive >= 1) return 'DEGRADED'
  if (minutesSinceLastSuccess > cadenceMin) return 'DEGRADED'
  if (lastStatus === 'FAILURE') return 'DEGRADED'

  return 'HEALTHY'
}

// ──────────────────────────────────────────────────────────────────────────
// SyncLog correlation. Several crons (inflow-sync, hyphen-sync, buildertrend-
// sync, gmail-sync) emit a SyncLog row with row counts even when CronRun
// just says "SUCCESS". Pulling the counts onto the dashboard catches the
// "ran but moved zero rows" silent-failure pattern.
// ──────────────────────────────────────────────────────────────────────────

// Map cron name → SyncLog provider value. Keep aligned with the providers
// each cron actually writes; missing entries just mean "no SyncLog signal,
// fall through to result.itemsProcessed".
export const CRON_TO_SYNC_PROVIDER: Record<string, string> = {
  'inflow-sync': 'INFLOW',
  'hyphen-sync': 'HYPHEN',
  'buildertrend-sync': 'BUILDERTREND',
  'gmail-sync': 'GMAIL',
  'boise-pricing-sync': 'BOISE_CASCADE',
  'boise-spend-snapshot': 'BOISE_CASCADE',
}

// IntegrationConfig provider enum for click-through to /ops/admin/integrations-freshness
export const CRON_TO_INTEGRATION_PROVIDER: Record<string, string> = {
  'inflow-sync': 'INFLOW',
  'hyphen-sync': 'HYPHEN',
  'buildertrend-sync': 'BUILDERTREND',
  'gmail-sync': 'GMAIL',
}

export interface SyncLogSnapshot {
  id: string
  startedAt: Date
  completedAt: Date | null
  status: string // 'SUCCESS' | 'PARTIAL' | 'FAILED'
  syncType: string
  recordsProcessed: number
  recordsCreated: number
  recordsUpdated: number
  recordsSkipped: number
  recordsFailed: number
  errorMessage: string | null
  durationMs: number | null
}

/**
 * Recent SyncLog rows for a cron's provider. Empty array if there's no
 * mapped provider or the table query errors.
 */
export async function getRecentSyncLogs(cronName: string, limit = 25): Promise<SyncLogSnapshot[]> {
  const provider = CRON_TO_SYNC_PROVIDER[cronName]
  if (!provider) return []
  try {
    const rows = await prisma.syncLog.findMany({
      where: { provider },
      orderBy: { startedAt: 'desc' },
      take: limit,
    })
    return rows.map((r) => ({
      id: r.id,
      startedAt: r.startedAt,
      completedAt: r.completedAt,
      status: r.status,
      syncType: r.syncType,
      recordsProcessed: r.recordsProcessed,
      recordsCreated: r.recordsCreated,
      recordsUpdated: r.recordsUpdated,
      recordsSkipped: r.recordsSkipped,
      recordsFailed: r.recordsFailed,
      errorMessage: r.errorMessage,
      durationMs: r.durationMs,
    }))
  } catch (e: any) {
    logger.error('cron_health_sync_logs_failed', e, { cronName, provider })
    return []
  }
}

/**
 * Items processed in the last 24h for a cron, summed across SyncLog rows for
 * its mapped provider. Returns null if there's no provider mapping (caller
 * should fall back to CronRun.result.itemsProcessed for those crons).
 */
export async function getItemsProcessed24h(cronName: string): Promise<number | null> {
  const provider = CRON_TO_SYNC_PROVIDER[cronName]
  if (!provider) return null
  try {
    const rows: any[] = await prisma.$queryRawUnsafe(
      `SELECT COALESCE(SUM("recordsProcessed"), 0)::int AS total
         FROM "SyncLog"
        WHERE "provider" = $1
          AND "startedAt" >= NOW() - INTERVAL '24 hours'`,
      provider
    )
    return rows[0]?.total ?? 0
  } catch (e: any) {
    logger.error('cron_health_items_24h_failed', e, { cronName, provider })
    return null
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Enrich a CronSummary array with health + items-processed in one DB pass.
//
// Strategy: bulk-load the last 5 runs per registered cron (one query, ROW_NUMBER
// trick) plus a bulk SyncLog 24h sum for crons that have a provider mapping.
// The CronSummary itself is already computed by getCronSummaries() in cron.ts.
// ──────────────────────────────────────────────────────────────────────────

export interface EnrichedCronSummary extends CronSummary {
  health: CronHealth
  itemsProcessed24h: number | null
  itemsProcessedSource: 'sync_log' | 'cron_result' | null
  // For sync-related crons, link out to the integration freshness row.
  integrationProvider: string | null
}

export async function enrichSummariesWithHealth(
  summaries: CronSummary[]
): Promise<EnrichedCronSummary[]> {
  if (summaries.length === 0) return []

  const names = summaries.map((s) => s.name)

  // 1. Pull last 5 runs per cron in a single query.
  let recentByName = new Map<string, RecentRunSnapshot[]>()
  try {
    const rows: any[] = await prisma.$queryRawUnsafe(
      `WITH ranked AS (
         SELECT
           "name",
           "status",
           "startedAt",
           "durationMs",
           ROW_NUMBER() OVER (PARTITION BY "name" ORDER BY "startedAt" DESC) AS rn
         FROM "CronRun"
         WHERE "name" = ANY($1::text[])
       )
       SELECT "name", "status", "startedAt", "durationMs"
         FROM ranked
        WHERE rn <= 5`,
      names
    )
    for (const r of rows) {
      const arr = recentByName.get(r.name) ?? []
      arr.push({
        status: r.status as CronStatus,
        startedAt: new Date(r.startedAt),
        durationMs: r.durationMs ?? null,
      })
      recentByName.set(r.name, arr)
    }
  } catch (e: any) {
    logger.error('cron_health_enrich_recent_failed', e)
  }

  // 2. Pull SyncLog totals 24h for the providers we care about, in one shot.
  const providerSet = Array.from(
    new Set(
      summaries
        .map((s) => CRON_TO_SYNC_PROVIDER[s.name])
        .filter((p): p is string => Boolean(p))
    )
  )
  const itemsByProvider = new Map<string, number>()
  if (providerSet.length > 0) {
    try {
      const rows: any[] = await prisma.$queryRawUnsafe(
        `SELECT "provider", COALESCE(SUM("recordsProcessed"), 0)::int AS total
           FROM "SyncLog"
          WHERE "provider" = ANY($1::text[])
            AND "startedAt" >= NOW() - INTERVAL '24 hours'
          GROUP BY "provider"`,
        providerSet
      )
      for (const r of rows) {
        itemsByProvider.set(String(r.provider), Number(r.total) || 0)
      }
    } catch (e: any) {
      logger.error('cron_health_enrich_synclog_failed', e)
    }
  }

  // 3. Stitch.
  return summaries.map((s) => {
    const recent = recentByName.get(s.name) ?? []
    const health = computeHealth({
      schedule: s.schedule,
      lastRunAt: s.lastRunAt,
      lastStatus: s.lastStatus,
      recent,
    })

    const provider = CRON_TO_SYNC_PROVIDER[s.name]
    let itemsProcessed24h: number | null = null
    let itemsProcessedSource: 'sync_log' | 'cron_result' | null = null
    if (provider && itemsByProvider.has(provider)) {
      itemsProcessed24h = itemsByProvider.get(provider) ?? 0
      itemsProcessedSource = 'sync_log'
    }
    // (cron_result-derived itemsProcessed is opt-in per route — handlers that
    // emit { itemsProcessed: N } in their JSON response will appear in the
    // detail drawer's `result` payload, but bulk listing leaves it null to
    // keep this query cheap. The detail view re-reads CronRun.result anyway.)

    return {
      ...s,
      health,
      itemsProcessed24h,
      itemsProcessedSource,
      integrationProvider: CRON_TO_INTEGRATION_PROVIDER[s.name] ?? null,
    }
  })
}

// ──────────────────────────────────────────────────────────────────────────
// Manual cron trigger (proxy to /api/cron/<name> with CRON_SECRET).
//
// Lives here (not in either route file) because it's shared between two
// route shapes:
//   - POST /api/ops/admin/crons              { name }   (legacy body-based)
//   - POST /api/ops/admin/crons/[name]/trigger          (path-based)
//
// Next.js 14 app router only permits HTTP-method exports from route files,
// so a shared helper has to live in /lib. Both routes import from here.
//
// Auth contract: the calling route is responsible for running checkStaff-
// AuthWithFallback() before this. Inside, we re-check the ADMIN role from
// the request headers — defensive, since this is the most privileged proxy
// in the app (it dials any registered cron handler with CRON_SECRET).
// ──────────────────────────────────────────────────────────────────────────
export async function triggerCronByName(
  request: NextRequest,
  name: string
): Promise<NextResponse> {
  const rolesHeader =
    request.headers.get('x-staff-roles') || request.headers.get('x-staff-role') || ''
  const roles = rolesHeader.split(',').map((r) => r.trim()).filter(Boolean)
  if (!roles.includes('ADMIN')) {
    return NextResponse.json({ error: 'ADMIN role required' }, { status: 403 })
  }

  if (!name) {
    return NextResponse.json({ error: 'name required' }, { status: 400 })
  }

  // Allow-list — stops a logged-in ADMIN from poking arbitrary /api/cron/*
  // through this proxy.
  const known = REGISTERED_CRONS.find((c) => c.name === name)
  if (!known) {
    return NextResponse.json({ error: `Unknown cron: ${name}` }, { status: 404 })
  }

  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 })
  }

  // Origin reconstruction. Vercel sets x-forwarded-*; localhost dev falls back.
  const proto = request.headers.get('x-forwarded-proto') || 'https'
  const host =
    request.headers.get('x-forwarded-host') || request.headers.get('host') || 'localhost:3000'
  const origin = `${proto}://${host}`
  const targetUrl = `${origin}/api/cron/${encodeURIComponent(name)}`

  const staffId = request.headers.get('x-staff-id') || 'unknown'
  // Audit log first so we have a record even if the trigger blows up.
  logAudit({
    staffId,
    action: 'CRON_MANUAL_TRIGGER',
    entity: 'CronRun',
    entityId: name,
    details: { name, schedule: known.schedule, source: '/ops/admin/crons' },
    severity: 'INFO',
  }).catch(() => {})

  try {
    const upstream = await fetch(targetUrl, {
      method: 'GET',
      headers: { Authorization: `Bearer ${cronSecret}` },
      cache: 'no-store',
    })
    const text = await upstream.text()
    let parsed: any = null
    try {
      parsed = JSON.parse(text)
    } catch {
      parsed = { raw: text.slice(0, 500) }
    }
    return NextResponse.json(
      {
        ok: upstream.ok,
        status: upstream.status,
        name,
        result: parsed,
      },
      { status: upstream.ok ? 200 : 502 }
    )
  } catch (error: any) {
    logger.error('cron_manual_trigger_failed', error, { name })
    return NextResponse.json(
      { error: error?.message || 'Failed to trigger cron', name },
      { status: 500 }
    )
  }
}
