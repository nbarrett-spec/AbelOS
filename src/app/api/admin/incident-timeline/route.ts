export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'
import { prisma } from '@/lib/prisma'

// ──────────────────────────────────────────────────────────────────────────
// GET /api/admin/incident-timeline  → unified chronological feed of every
// "bad thing" across the observability surfaces.
//
// Why this exists:
//   /admin/health already surfaces each source in its own card (errors,
//   slow queries, crons, webhooks, security events, uptime). But when you're
//   debugging a live incident you want a single stream sorted by time, so
//   you can see "uptime failed at 14:02 → 3 server errors at 14:03 → cron
//   missed its window at 14:05" in one glance. Grepping six tabs is the
//   problem this solves.
//
// Sources merged (each is independently fault-tolerant — a missing table
// or query error in one source never breaks the others):
//   1. ServerError          kind=server_error    severity=error
//   2. ClientError          kind=client_error    severity=warning
//   3. SlowQueryLog         kind=slow_query      severity=warning
//   4. CronRun (FAILURE)    kind=cron_failure    severity=error
//   5. SecurityEvent        kind=security_event  severity=warning
//   6. UptimeProbe (!=ok)   kind=uptime_failure  severity=error
//   7. WebhookEvent (DLQ)   kind=webhook_dead    severity=error
//   8. AlertIncident        kind=alert_fire      severity=peak (critical
//                                                 → error, warning →
//                                                 warning, info → info)
//
// The alert_fire source is meta-observability: a single event for each
// time an alert transitioned from cleared to firing, positioned on the
// timeline at startedAt. This gives you the "system interpretation" of
// the raw events alongside the raw events themselves, so an incident
// investigation doesn't have to cross-reference /admin/alert-history in
// a separate tab.
//
// Query filters:
//   ?since=24     hours back, 1..720 (default 24)
//   ?limit=200    row cap after merge, 1..500 (default 200)
//   ?kinds=a,b,c  comma-separated allowlist; default = all
// ──────────────────────────────────────────────────────────────────────────

type IncidentKind =
  | 'server_error'
  | 'client_error'
  | 'slow_query'
  | 'cron_failure'
  | 'security_event'
  | 'uptime_failure'
  | 'webhook_dead'
  | 'alert_fire'

type IncidentSeverity = 'error' | 'warning' | 'info'

interface IncidentEvent {
  id: string
  timestamp: string
  kind: IncidentKind
  severity: IncidentSeverity
  title: string
  detail: string | null
  href: string | null
  source: { table: string; id: string }
  // Optional per-source metadata for filtering/badging in the UI.
  meta?: Record<string, unknown>
}

const ALL_KINDS: IncidentKind[] = [
  'server_error',
  'client_error',
  'slow_query',
  'cron_failure',
  'security_event',
  'uptime_failure',
  'webhook_dead',
  'alert_fire',
]

function clampStr(s: unknown, max: number): string | null {
  if (typeof s !== 'string') return null
  return s.length > max ? s.slice(0, max) + '…' : s
}

function toIso(v: unknown): string {
  if (v instanceof Date) return v.toISOString()
  if (typeof v === 'string') return v
  return new Date().toISOString()
}

// ──────────────────────────────────────────────────────────────────────────
// Per-source query helpers. Each catches its own errors and returns [] on
// failure so one bad source never starves the feed. Each source is LIMITed
// independently so a runaway table can't dominate — the merge step trims
// to the global limit after sorting.
// ──────────────────────────────────────────────────────────────────────────

async function fetchServerErrors(
  sinceHours: number,
  limit: number
): Promise<IncidentEvent[]> {
  try {
    const rows: any[] = await prisma.$queryRawUnsafe(
      `SELECT "id", "createdAt", "digest", "msg", "errName", "errMessage", "requestId"
       FROM "ServerError"
       WHERE "createdAt" > NOW() - INTERVAL '${sinceHours} hours'
       ORDER BY "createdAt" DESC
       LIMIT $1`,
      limit
    )
    return rows.map((r) => ({
      id: `se:${r.id}`,
      timestamp: toIso(r.createdAt),
      kind: 'server_error' as const,
      severity: 'error' as const,
      title: clampStr(r.errName || r.msg, 120) || 'Server error',
      detail: clampStr(r.errMessage || r.msg, 300),
      href: `/admin/errors?source=server&digest=${encodeURIComponent(r.digest || '')}`,
      source: { table: 'ServerError', id: String(r.id) },
      meta: { digest: r.digest, requestId: r.requestId },
    }))
  } catch {
    return []
  }
}

async function fetchClientErrors(
  sinceHours: number,
  limit: number
): Promise<IncidentEvent[]> {
  try {
    const rows: any[] = await prisma.$queryRawUnsafe(
      `SELECT "id", "createdAt", "digest", "scope", "path", "message"
       FROM "ClientError"
       WHERE "createdAt" > NOW() - INTERVAL '${sinceHours} hours'
       ORDER BY "createdAt" DESC
       LIMIT $1`,
      limit
    )
    return rows.map((r) => ({
      id: `ce:${r.id}`,
      timestamp: toIso(r.createdAt),
      kind: 'client_error' as const,
      severity: 'warning' as const,
      title: clampStr(r.message, 120) || 'Client error',
      detail: clampStr(r.path, 300),
      href: `/admin/errors?source=client&digest=${encodeURIComponent(r.digest || '')}`,
      source: { table: 'ClientError', id: String(r.id) },
      meta: { digest: r.digest, scope: r.scope },
    }))
  } catch {
    return []
  }
}

async function fetchSlowQueries(
  sinceHours: number,
  limit: number
): Promise<IncidentEvent[]> {
  try {
    // Hardcoded duration floor above the normal slow threshold — the full
    // slow-query list belongs on /admin/health. Here we only bubble up
    // queries that were meaningfully slow (>= 1500ms) so the timeline
    // shows "hot" offenders instead of drowning in 500ms noise.
    const rows: any[] = await prisma.$queryRawUnsafe(
      `SELECT "id", "createdAt", "model", "operation", "durationMs", "digest", "sqlSample"
       FROM "SlowQueryLog"
       WHERE "createdAt" > NOW() - INTERVAL '${sinceHours} hours'
         AND "durationMs" >= 1500
       ORDER BY "createdAt" DESC
       LIMIT $1`,
      limit
    )
    return rows.map((r) => ({
      id: `sq:${r.id}`,
      timestamp: toIso(r.createdAt),
      kind: 'slow_query' as const,
      severity: 'warning' as const,
      title: `Slow ${r.model}.${r.operation} (${r.durationMs}ms)`,
      detail: clampStr(r.sqlSample, 300),
      href: `/admin/health#slow-queries`,
      source: { table: 'SlowQueryLog', id: String(r.id) },
      meta: { digest: r.digest, durationMs: r.durationMs },
    }))
  } catch {
    return []
  }
}

async function fetchCronFailures(
  sinceHours: number,
  limit: number
): Promise<IncidentEvent[]> {
  try {
    const rows: any[] = await prisma.$queryRawUnsafe(
      `SELECT "id", "startedAt", "name", "status", "durationMs", "error"
       FROM "CronRun"
       WHERE "startedAt" > NOW() - INTERVAL '${sinceHours} hours'
         AND "status" = 'FAILURE'
       ORDER BY "startedAt" DESC
       LIMIT $1`,
      limit
    )
    return rows.map((r) => ({
      id: `cr:${r.id}`,
      timestamp: toIso(r.startedAt),
      kind: 'cron_failure' as const,
      severity: 'error' as const,
      title: `Cron failed: ${r.name}`,
      detail: clampStr(r.error, 300),
      href: `/admin/crons#${encodeURIComponent(r.name)}`,
      source: { table: 'CronRun', id: String(r.id) },
      meta: { name: r.name, durationMs: r.durationMs },
    }))
  } catch {
    return []
  }
}

async function fetchSecurityEvents(
  sinceHours: number,
  limit: number
): Promise<IncidentEvent[]> {
  try {
    const rows: any[] = await prisma.$queryRawUnsafe(
      `SELECT "id", "createdAt", "kind", "path", "method", "ip"
       FROM "SecurityEvent"
       WHERE "createdAt" > NOW() - INTERVAL '${sinceHours} hours'
       ORDER BY "createdAt" DESC
       LIMIT $1`,
      limit
    )
    return rows.map((r) => ({
      id: `sec:${r.id}`,
      timestamp: toIso(r.createdAt),
      kind: 'security_event' as const,
      severity: 'warning' as const,
      title: `${r.kind} ${r.method || ''} ${clampStr(r.path, 80) || ''}`.trim(),
      detail: r.ip ? `from ${r.ip}` : null,
      href: `/admin/health#security-events`,
      source: { table: 'SecurityEvent', id: String(r.id) },
      meta: { secKind: r.kind, ip: r.ip },
    }))
  } catch {
    return []
  }
}

async function fetchUptimeFailures(
  sinceHours: number,
  limit: number
): Promise<IncidentEvent[]> {
  try {
    const rows: any[] = await prisma.$queryRawUnsafe(
      `SELECT "id", "createdAt", "status", "totalMs", "dbOk", "envOk", "error"
       FROM "UptimeProbe"
       WHERE "createdAt" > NOW() - INTERVAL '${sinceHours} hours'
         AND "status" <> 'ok'
       ORDER BY "createdAt" DESC
       LIMIT $1`,
      limit
    )
    return rows.map((r) => ({
      id: `up:${r.id}`,
      timestamp: toIso(r.createdAt),
      kind: 'uptime_failure' as const,
      severity: 'error' as const,
      title: `Uptime probe: ${r.status}`,
      detail:
        clampStr(r.error, 300) ||
        `db=${r.dbOk ? 'ok' : 'fail'} env=${r.envOk ? 'ok' : 'fail'} total=${r.totalMs}ms`,
      href: `/admin/health#uptime`,
      source: { table: 'UptimeProbe', id: String(r.id) },
      meta: { status: r.status, dbOk: r.dbOk, envOk: r.envOk },
    }))
  } catch {
    return []
  }
}

async function fetchWebhookDeadLetters(
  sinceHours: number,
  limit: number
): Promise<IncidentEvent[]> {
  try {
    // Use lastAttemptAt when present (that's when the terminal failure
    // happened); fall back to receivedAt for pre-retry-metadata rows.
    const rows: any[] = await prisma.$queryRawUnsafe(
      `SELECT "id", COALESCE("lastAttemptAt", "receivedAt") AS "failedAt",
              "provider", "eventType", "error", "retryCount"
       FROM "WebhookEvent"
       WHERE COALESCE("lastAttemptAt", "receivedAt") > NOW() - INTERVAL '${sinceHours} hours'
         AND "status" = 'DEAD_LETTER'
       ORDER BY "failedAt" DESC
       LIMIT $1`,
      limit
    )
    return rows.map((r) => ({
      id: `wh:${r.id}`,
      timestamp: toIso(r.failedAt),
      kind: 'webhook_dead' as const,
      severity: 'error' as const,
      title: `Webhook DLQ: ${r.provider} ${r.eventType || ''}`.trim(),
      detail: clampStr(r.error, 300) || `after ${r.retryCount} retries`,
      href: `/admin/webhooks`,
      source: { table: 'WebhookEvent', id: String(r.id) },
      meta: { provider: r.provider, retryCount: r.retryCount },
    }))
  } catch {
    return []
  }
}

async function fetchAlertFires(
  sinceHours: number,
  limit: number
): Promise<IncidentEvent[]> {
  try {
    // Anchor on startedAt so each incident contributes a single event at
    // the moment it first started firing. durationSeconds is computed in
    // SQL the same way /api/admin/alert-history computes it, so a row
    // that's still firing shows "firing for Xs" rather than a null.
    const rows: any[] = await prisma.$queryRawUnsafe(
      `SELECT "id", "alertId", "title", "description", "href",
              "startedAt", "endedAt", "peakSeverity", "peakCount", "tickCount",
              CASE
                WHEN "endedAt" IS NOT NULL
                  THEN EXTRACT(EPOCH FROM ("endedAt" - "startedAt"))
                ELSE EXTRACT(EPOCH FROM (NOW() - "startedAt"))
              END AS "durationSeconds"
       FROM "AlertIncident"
       WHERE "startedAt" > NOW() - INTERVAL '${sinceHours} hours'
       ORDER BY "startedAt" DESC
       LIMIT $1`,
      limit
    )
    return rows.map((r) => {
      // Map alert peakSeverity onto timeline severity. critical is the
      // only one that earns 'error'; warning stays warning; info/success
      // degrade to info so a transient info-level alert doesn't scream.
      const sev: IncidentSeverity =
        r.peakSeverity === 'critical'
          ? 'error'
          : r.peakSeverity === 'warning'
            ? 'warning'
            : 'info'
      const isOpen = r.endedAt == null
      const durSec =
        r.durationSeconds != null ? Math.round(Number(r.durationSeconds)) : null
      const durStr =
        durSec == null
          ? ''
          : durSec < 60
            ? ` (${durSec}s)`
            : durSec < 3600
              ? ` (${Math.floor(durSec / 60)}m)`
              : ` (${Math.floor(durSec / 3600)}h${
                  Math.floor((durSec % 3600) / 60)
                    ? ` ${Math.floor((durSec % 3600) / 60)}m`
                    : ''
                })`
      return {
        id: `ai:${r.id}`,
        timestamp: toIso(r.startedAt),
        kind: 'alert_fire' as const,
        severity: sev,
        title: `Alert fired: ${r.title}${isOpen ? ' (firing)' : durStr}`,
        detail:
          clampStr(r.description, 300) ||
          `peak ${r.peakCount} over ${r.tickCount} tick${r.tickCount === 1 ? '' : 's'}`,
        href: r.href || '/admin/alert-history',
        source: { table: 'AlertIncident', id: String(r.id) },
        meta: {
          alertId: r.alertId,
          peakSeverity: r.peakSeverity,
          peakCount: r.peakCount,
          isOpen,
          durationSeconds: durSec,
        },
      }
    })
  } catch {
    return []
  }
}

export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  const { searchParams } = new URL(request.url)
  const sinceHours = Math.min(
    Math.max(parseInt(searchParams.get('since') || '24'), 1),
    720
  )
  const limit = Math.min(
    Math.max(parseInt(searchParams.get('limit') || '200'), 1),
    500
  )

  // Parse ?kinds=a,b,c — if any requested kind is unknown we drop it silently
  // so a typo doesn't return 400 mid-incident.
  const requested = (searchParams.get('kinds') || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean) as IncidentKind[]
  const allowed: Set<IncidentKind> = new Set(
    requested.length > 0
      ? requested.filter((k) => ALL_KINDS.includes(k))
      : ALL_KINDS
  )

  // Each source fetches `limit` rows of its own; after merging we keep the
  // top `limit` by timestamp. Running in parallel — one slow source only
  // stalls the response by its own query latency, not the sum.
  const perSourceLimit = limit
  const [
    serverErrors,
    clientErrors,
    slowQueries,
    cronFailures,
    securityEvents,
    uptimeFailures,
    webhookDeadLetters,
    alertFires,
  ] = await Promise.all([
    allowed.has('server_error')
      ? fetchServerErrors(sinceHours, perSourceLimit)
      : Promise.resolve([] as IncidentEvent[]),
    allowed.has('client_error')
      ? fetchClientErrors(sinceHours, perSourceLimit)
      : Promise.resolve([] as IncidentEvent[]),
    allowed.has('slow_query')
      ? fetchSlowQueries(sinceHours, perSourceLimit)
      : Promise.resolve([] as IncidentEvent[]),
    allowed.has('cron_failure')
      ? fetchCronFailures(sinceHours, perSourceLimit)
      : Promise.resolve([] as IncidentEvent[]),
    allowed.has('security_event')
      ? fetchSecurityEvents(sinceHours, perSourceLimit)
      : Promise.resolve([] as IncidentEvent[]),
    allowed.has('uptime_failure')
      ? fetchUptimeFailures(sinceHours, perSourceLimit)
      : Promise.resolve([] as IncidentEvent[]),
    allowed.has('webhook_dead')
      ? fetchWebhookDeadLetters(sinceHours, perSourceLimit)
      : Promise.resolve([] as IncidentEvent[]),
    allowed.has('alert_fire')
      ? fetchAlertFires(sinceHours, perSourceLimit)
      : Promise.resolve([] as IncidentEvent[]),
  ])

  const merged: IncidentEvent[] = [
    ...serverErrors,
    ...clientErrors,
    ...slowQueries,
    ...cronFailures,
    ...securityEvents,
    ...uptimeFailures,
    ...webhookDeadLetters,
    ...alertFires,
  ]

  // Reverse chronological — newest incidents bubble to the top.
  merged.sort((a, b) => {
    const ta = new Date(a.timestamp).getTime()
    const tb = new Date(b.timestamp).getTime()
    return tb - ta
  })

  const trimmed = merged.slice(0, limit)

  // Per-kind counts across the FULL merged set (pre-trim) so the UI can
  // show "23 server errors / 2 cron failures" even when the feed scrolls
  // past the limit.
  const counts: Record<IncidentKind, number> = {
    server_error: 0,
    client_error: 0,
    slow_query: 0,
    cron_failure: 0,
    security_event: 0,
    uptime_failure: 0,
    webhook_dead: 0,
    alert_fire: 0,
  }
  for (const e of merged) counts[e.kind] += 1

  return NextResponse.json({
    sinceHours,
    limit,
    totalBeforeTrim: merged.length,
    counts,
    events: trimmed,
  })
}
