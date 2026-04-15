import { prisma } from '@/lib/prisma'

// ──────────────────────────────────────────────────────────────────────────
// Alert history — persist fire / clear transitions of the live alerts that
// /api/ops/system-alerts computes statelessly each request.
//
// The GET handler in system-alerts computes a fresh list of alerts every
// poll. That's great for real-time display but loses the question we most
// want to answer during a postmortem: "when did this start, and how long
// did it fire for?" This module records each alert as an AlertIncident
// row with startedAt / endedAt bookends, peak count, and peak severity.
//
// ─── Lifecycle ────────────────────────────────────────────────────────────
//   1. system-alerts finishes computing its `alerts` array.
//   2. Fires (not awaits) snapshotAlerts(alerts).
//   3. snapshotAlerts:
//        a. Opens any currently-open incidents from DB (keyed by alertId)
//        b. For each current alert: upserts — if no open incident exists,
//           insert a new one; otherwise bump peakCount, peakSeverity,
//           lastSeenAt, and tickCount.
//        c. For each open incident whose alertId is NOT in the current
//           alerts: mark endedAt=NOW() → incident closed.
//
// ─── Flap tolerance ──────────────────────────────────────────────────────
// system-alerts has a 10-second cache, so this function runs at most once
// per 10s per Lambda. A transient alert that flips on/off faster than that
// never records an incident — which is correct; we don't want a flapping
// signal to spam the timeline with 50 zero-second incidents. If you want
// flap detection you increment AlertIncident.tickCount on every snapshot
// and watch for rows that never closed but had very low peakCount.
//
// ─── Fault isolation ─────────────────────────────────────────────────────
// All writes are best-effort. Any failure swallows silently — the hot path
// of system-alerts must not break because history persistence is sick.
// ──────────────────────────────────────────────────────────────────────────

export interface CurrentAlert {
  id: string
  type: 'critical' | 'warning' | 'info' | 'success'
  title: string
  count: number
  href?: string
  description?: string
}

type Severity = 'critical' | 'warning' | 'info' | 'success'

// Numeric severity for MAX(...) logic. Higher = worse.
const SEVERITY_RANK: Record<Severity, number> = {
  success: 0,
  info: 1,
  warning: 2,
  critical: 3,
}

function worseSeverity(a: Severity, b: Severity): Severity {
  return SEVERITY_RANK[a] >= SEVERITY_RANK[b] ? a : b
}

let tableReady: Promise<void> | null = null

async function ensureAlertIncidentTable(): Promise<void> {
  if (tableReady) return tableReady
  tableReady = (async () => {
    try {
      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "AlertIncident" (
          "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
          "alertId" TEXT NOT NULL,
          "title" TEXT NOT NULL,
          "href" TEXT,
          "description" TEXT,
          "startedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          "endedAt" TIMESTAMPTZ,
          "peakCount" INTEGER NOT NULL DEFAULT 0,
          "peakSeverity" TEXT NOT NULL,
          "lastSeverity" TEXT NOT NULL,
          "lastCount" INTEGER NOT NULL DEFAULT 0,
          "lastSeenAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          "tickCount" INTEGER NOT NULL DEFAULT 1
        )
      `)
      await prisma.$executeRawUnsafe(
        `CREATE INDEX IF NOT EXISTS "idx_alertincident_started" ON "AlertIncident" ("startedAt" DESC)`
      )
      await prisma.$executeRawUnsafe(
        `CREATE INDEX IF NOT EXISTS "idx_alertincident_alertid" ON "AlertIncident" ("alertId", "startedAt" DESC)`
      )
      // Partial unique index: at most one open incident per alertId.
      // Postgres-specific but matches our hosting (Neon). Protects against
      // concurrent snapshot calls double-inserting if two Lambdas run the
      // hook at the same instant.
      await prisma.$executeRawUnsafe(
        `CREATE UNIQUE INDEX IF NOT EXISTS "uq_alertincident_open"
         ON "AlertIncident" ("alertId")
         WHERE "endedAt" IS NULL`
      )
    } catch {
      // swallow — best-effort
    }
  })()
  return tableReady
}

interface OpenIncidentRow {
  id: string
  alertId: string
  peakCount: number
  peakSeverity: Severity
}

async function loadOpenIncidents(): Promise<Map<string, OpenIncidentRow>> {
  try {
    const rows: any[] = await prisma.$queryRawUnsafe(
      `SELECT "id", "alertId", "peakCount", "peakSeverity"
       FROM "AlertIncident"
       WHERE "endedAt" IS NULL`
    )
    const m = new Map<string, OpenIncidentRow>()
    for (const r of rows) {
      m.set(r.alertId, {
        id: r.id,
        alertId: r.alertId,
        peakCount: r.peakCount,
        peakSeverity: r.peakSeverity as Severity,
      })
    }
    return m
  } catch {
    return new Map()
  }
}

/**
 * Persist the fire/clear transitions implied by `current`. Called
 * fire-and-forget from /api/ops/system-alerts. Never throws.
 *
 * Idempotent: calling twice with the same `current` only bumps
 * lastSeenAt/tickCount on the existing open incidents.
 */
export async function snapshotAlerts(current: CurrentAlert[]): Promise<void> {
  try {
    await ensureAlertIncidentTable()

    const openByAlertId = await loadOpenIncidents()
    const currentIds = new Set(current.map((a) => a.id))

    // 1. Upsert current alerts.
    for (const alert of current) {
      // success alerts never fire history — they're the absence of a problem.
      if (alert.type === 'success') continue

      const existing = openByAlertId.get(alert.id)
      if (!existing) {
        // New incident. Insert — ON CONFLICT DO NOTHING guards against the
        // partial unique index fighting a concurrent insert in another Lambda.
        try {
          await prisma.$executeRawUnsafe(
            `INSERT INTO "AlertIncident"
               ("alertId", "title", "href", "description",
                "peakCount", "peakSeverity", "lastSeverity", "lastCount")
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             ON CONFLICT DO NOTHING`,
            alert.id,
            alert.title.slice(0, 500),
            alert.href?.slice(0, 500) ?? null,
            alert.description?.slice(0, 1000) ?? null,
            alert.count,
            alert.type,
            alert.type,
            alert.count
          )
        } catch {
          // swallow — history is best-effort
        }
      } else {
        // Existing open incident. Bump metrics.
        const newPeakCount = Math.max(existing.peakCount, alert.count)
        const newPeakSeverity = worseSeverity(
          existing.peakSeverity,
          alert.type as Severity
        )
        try {
          await prisma.$executeRawUnsafe(
            `UPDATE "AlertIncident"
             SET "peakCount" = $2,
                 "peakSeverity" = $3,
                 "lastSeverity" = $4,
                 "lastCount" = $5,
                 "lastSeenAt" = NOW(),
                 "tickCount" = "tickCount" + 1
             WHERE "id" = $1`,
            existing.id,
            newPeakCount,
            newPeakSeverity,
            alert.type,
            alert.count
          )
        } catch {
          // swallow
        }
      }
    }

    // 2. Close any open incidents whose alertId is no longer firing.
    for (const [alertId, row] of openByAlertId.entries()) {
      if (currentIds.has(alertId)) continue
      try {
        await prisma.$executeRawUnsafe(
          `UPDATE "AlertIncident"
           SET "endedAt" = NOW()
           WHERE "id" = $1 AND "endedAt" IS NULL`,
          row.id
        )
      } catch {
        // swallow
      }
    }
  } catch {
    // top-level guard — snapshotAlerts is fire-and-forget, never let
    // anything bubble up to the caller.
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Read helpers for /api/admin/alert-history and dashboard widgets.
// ──────────────────────────────────────────────────────────────────────────

export interface AlertIncidentRow {
  id: string
  alertId: string
  title: string
  href: string | null
  description: string | null
  startedAt: string
  endedAt: string | null
  durationSeconds: number | null
  peakCount: number
  peakSeverity: Severity
  lastSeverity: Severity
  lastCount: number
  lastSeenAt: string
  tickCount: number
}

/**
 * Recent incidents (open or closed) within a window. Default: 24h.
 *
 * Computes durationSeconds in SQL rather than JS so open incidents get the
 * live-elapsed duration (NOW() - startedAt) and closed ones get the fixed
 * gap (endedAt - startedAt). Saves the UI from re-doing the arithmetic.
 */
export async function listRecentIncidents(
  sinceHours: number = 24,
  limit: number = 200
): Promise<AlertIncidentRow[]> {
  try {
    await ensureAlertIncidentTable()
    const hours = Math.min(Math.max(sinceHours, 1), 720)
    const lim = Math.min(Math.max(limit, 1), 1000)
    const rows: any[] = await prisma.$queryRawUnsafe(
      `SELECT
         "id", "alertId", "title", "href", "description",
         "startedAt", "endedAt",
         CASE
           WHEN "endedAt" IS NOT NULL THEN
             EXTRACT(EPOCH FROM ("endedAt" - "startedAt"))::int
           ELSE
             EXTRACT(EPOCH FROM (NOW() - "startedAt"))::int
         END AS "durationSeconds",
         "peakCount", "peakSeverity",
         "lastSeverity", "lastCount",
         "lastSeenAt", "tickCount"
       FROM "AlertIncident"
       WHERE "startedAt" > NOW() - INTERVAL '${hours} hours'
          OR "endedAt" IS NULL
       ORDER BY "startedAt" DESC
       LIMIT $1`,
      lim
    )
    return rows.map((r) => ({
      id: r.id,
      alertId: r.alertId,
      title: r.title,
      href: r.href,
      description: r.description,
      startedAt:
        r.startedAt instanceof Date
          ? r.startedAt.toISOString()
          : String(r.startedAt),
      endedAt:
        r.endedAt == null
          ? null
          : r.endedAt instanceof Date
            ? r.endedAt.toISOString()
            : String(r.endedAt),
      durationSeconds: r.durationSeconds ?? null,
      peakCount: r.peakCount,
      peakSeverity: r.peakSeverity as Severity,
      lastSeverity: r.lastSeverity as Severity,
      lastCount: r.lastCount,
      lastSeenAt:
        r.lastSeenAt instanceof Date
          ? r.lastSeenAt.toISOString()
          : String(r.lastSeenAt),
      tickCount: r.tickCount,
    }))
  } catch {
    return []
  }
}

/**
 * Per-alertId rollup: "how many times has client-errors fired this week?"
 * Used by the dashboard widget that wants to show recurring offenders.
 */
export interface AlertRollupRow {
  alertId: string
  title: string
  incidents: number
  openIncidents: number
  totalSeconds: number
  maxPeakCount: number
  worstSeverity: Severity
  mostRecent: string
}

export async function listAlertRollups(
  sinceHours: number = 168
): Promise<AlertRollupRow[]> {
  try {
    await ensureAlertIncidentTable()
    const hours = Math.min(Math.max(sinceHours, 1), 720)
    const rows: any[] = await prisma.$queryRawUnsafe(
      `SELECT
         "alertId",
         MIN("title") AS "title",
         COUNT(*)::int AS "incidents",
         COUNT(*) FILTER (WHERE "endedAt" IS NULL)::int AS "openIncidents",
         SUM(
           CASE
             WHEN "endedAt" IS NOT NULL THEN EXTRACT(EPOCH FROM ("endedAt" - "startedAt"))
             ELSE EXTRACT(EPOCH FROM (NOW() - "startedAt"))
           END
         )::int AS "totalSeconds",
         MAX("peakCount")::int AS "maxPeakCount",
         MAX(
           CASE "peakSeverity"
             WHEN 'critical' THEN 3
             WHEN 'warning'  THEN 2
             WHEN 'info'     THEN 1
             ELSE 0
           END
         ) AS "worstSeverityRank",
         MAX("startedAt") AS "mostRecent"
       FROM "AlertIncident"
       WHERE "startedAt" > NOW() - INTERVAL '${hours} hours'
          OR "endedAt" IS NULL
       GROUP BY "alertId"
       ORDER BY "incidents" DESC, "mostRecent" DESC
       LIMIT 50`
    )
    const rankToSev: Record<number, Severity> = {
      3: 'critical',
      2: 'warning',
      1: 'info',
      0: 'success',
    }
    return rows.map((r) => ({
      alertId: r.alertId,
      title: r.title,
      incidents: r.incidents,
      openIncidents: r.openIncidents,
      totalSeconds: r.totalSeconds ?? 0,
      maxPeakCount: r.maxPeakCount ?? 0,
      worstSeverity: rankToSev[r.worstSeverityRank] || 'info',
      mostRecent:
        r.mostRecent instanceof Date
          ? r.mostRecent.toISOString()
          : String(r.mostRecent),
    }))
  } catch {
    return []
  }
}
