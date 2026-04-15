import { prisma } from '@/lib/prisma'
import { sendEmail } from '@/lib/email'
import { logger } from '@/lib/logger'

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
          "tickCount" INTEGER NOT NULL DEFAULT 1,
          "notifiedAt" TIMESTAMPTZ
        )
      `)
      // Backfill the notifiedAt column for existing tables created before
      // the notification feature. IF NOT EXISTS makes this a no-op on new
      // installs but adds the column on any deployment that pre-dates this.
      await prisma.$executeRawUnsafe(
        `ALTER TABLE "AlertIncident" ADD COLUMN IF NOT EXISTS "notifiedAt" TIMESTAMPTZ`
      )
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

    // 3. Notify recipients about open critical incidents that haven't been
    //    notified yet. Runs after the upsert loop so any freshly-inserted or
    //    freshly-escalated-to-critical row is visible. Best-effort — if the
    //    email send fails, notifiedAt stays NULL and we'll retry next tick.
    await dispatchCriticalNotifications()
  } catch {
    // top-level guard — snapshotAlerts is fire-and-forget, never let
    // anything bubble up to the caller.
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Critical alert notification dispatch.
//
// Invariants:
//   - We only email when peakSeverity='critical' on an OPEN incident.
//   - notifiedAt is stamped BEFORE attempting to send so a transient Resend
//     failure doesn't turn into an email storm. If send fails we CLEAR
//     notifiedAt back to NULL so the next tick retries. This trades a
//     possible duplicate email (if the clear succeeds but a later tick
//     tries again) for zero risk of spamming an outage — the cure is
//     worse than the disease on the other side.
//   - Warning/info incidents never email. The dashboard banner is enough.
//   - Configured via ALERT_NOTIFY_EMAILS (comma-separated). If unset,
//     dispatch is a no-op. Rows still get stamped as "notified" so that
//     flipping the env var on later doesn't immediately fire emails for
//     every already-open incident.
// ──────────────────────────────────────────────────────────────────────────

function parseRecipients(): string[] {
  const raw = process.env.ALERT_NOTIFY_EMAILS || ''
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s.includes('@'))
}

interface PendingIncident {
  id: string
  alertId: string
  title: string
  href: string | null
  description: string | null
  peakCount: number
  startedAt: Date
  tickCount: number
}

async function loadPendingCriticalNotifications(): Promise<PendingIncident[]> {
  try {
    const rows: any[] = await prisma.$queryRawUnsafe(
      `SELECT "id", "alertId", "title", "href", "description",
              "peakCount", "startedAt", "tickCount"
       FROM "AlertIncident"
       WHERE "endedAt" IS NULL
         AND "peakSeverity" = 'critical'
         AND "notifiedAt" IS NULL
       ORDER BY "startedAt" ASC
       LIMIT 20`
    )
    return rows.map((r) => ({
      id: String(r.id),
      alertId: String(r.alertId),
      title: String(r.title),
      href: r.href ?? null,
      description: r.description ?? null,
      peakCount: Number(r.peakCount) || 0,
      startedAt:
        r.startedAt instanceof Date ? r.startedAt : new Date(String(r.startedAt)),
      tickCount: Number(r.tickCount) || 1,
    }))
  } catch {
    return []
  }
}

async function stampNotified(incidentId: string): Promise<void> {
  try {
    await prisma.$executeRawUnsafe(
      `UPDATE "AlertIncident"
       SET "notifiedAt" = NOW()
       WHERE "id" = $1 AND "notifiedAt" IS NULL`,
      incidentId
    )
  } catch {
    // swallow — next tick will try again
  }
}

async function clearNotified(incidentId: string): Promise<void> {
  try {
    await prisma.$executeRawUnsafe(
      `UPDATE "AlertIncident"
       SET "notifiedAt" = NULL
       WHERE "id" = $1`,
      incidentId
    )
  } catch {
    // swallow
  }
}

function renderIncidentEmailHtml(incident: PendingIncident): string {
  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL ||
    (process.env.NODE_ENV === 'production'
      ? 'https://app.abellumber.com'
      : 'http://localhost:3000')
  const href = incident.href
    ? incident.href.startsWith('http')
      ? incident.href
      : `${appUrl}${incident.href}`
    : `${appUrl}/admin/alert-history`
  const started = incident.startedAt.toISOString()
  const safeTitle = escapeHtml(incident.title)
  const safeDesc = incident.description
    ? escapeHtml(incident.description)
    : '(no description)'
  const safeAlertId = escapeHtml(incident.alertId)
  return `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:620px;margin:0 auto;padding:24px;background:#fff;">
      <div style="background:#991b1b;color:#fff;padding:16px 20px;border-radius:8px 8px 0 0;">
        <div style="font-size:12px;letter-spacing:0.08em;text-transform:uppercase;opacity:0.85;">Critical incident opened</div>
        <div style="font-size:18px;font-weight:700;margin-top:4px;">${safeTitle}</div>
      </div>
      <div style="border:1px solid #fecaca;border-top:none;border-radius:0 0 8px 8px;padding:20px;">
        <table style="font-size:13px;width:100%;border-collapse:collapse;color:#374151;">
          <tr><td style="padding:4px 0;color:#6b7280;width:130px;">Alert ID</td><td style="font-family:ui-monospace,monospace;">${safeAlertId}</td></tr>
          <tr><td style="padding:4px 0;color:#6b7280;">Started</td><td>${started}</td></tr>
          <tr><td style="padding:4px 0;color:#6b7280;">Peak count</td><td>${incident.peakCount}</td></tr>
          <tr><td style="padding:4px 0;color:#6b7280;">Ticks so far</td><td>${incident.tickCount}</td></tr>
        </table>
        <div style="margin-top:16px;padding:12px;background:#fef2f2;border-left:3px solid #dc2626;font-size:13px;color:#7f1d1d;white-space:pre-wrap;">${safeDesc}</div>
        <div style="margin-top:20px;">
          <a href="${href}" style="display:inline-block;padding:10px 18px;background:#dc2626;color:#fff;text-decoration:none;border-radius:6px;font-weight:600;font-size:14px;">Open in Admin</a>
        </div>
        <div style="margin-top:16px;font-size:11px;color:#9ca3af;">
          You're receiving this because your email is on ALERT_NOTIFY_EMAILS.
          This notification fires once per incident — you will not receive
          further emails until the incident closes and re-opens.
        </div>
      </div>
    </div>
  `.trim()
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export async function dispatchCriticalNotifications(): Promise<void> {
  try {
    const recipients = parseRecipients()
    if (recipients.length === 0) {
      // No opt-in recipients. Still stamp any pending rows as "notified"
      // so that flipping the env var on later doesn't immediately email
      // about every pre-existing open incident.
      const pending = await loadPendingCriticalNotifications()
      for (const inc of pending) {
        await stampNotified(inc.id)
      }
      return
    }

    const pending = await loadPendingCriticalNotifications()
    if (pending.length === 0) return

    for (const inc of pending) {
      // Stamp BEFORE sending so a Resend stall doesn't cause this loop to
      // send the same email twice from two concurrent Lambdas. If every
      // recipient fails we roll back the stamp so the next tick retries;
      // partial failure (some OK, some not) is left stamped — we'd rather
      // miss one address than duplicate-notify the ones who did get through.
      await stampNotified(inc.id)
      const html = renderIncidentEmailHtml(inc)
      const subject = `[CRITICAL] ${inc.title}`
      let successCount = 0
      for (const to of recipients) {
        const result = await sendEmail({ to, subject, html })
        if (result.success) {
          successCount += 1
        } else {
          logger.warn('alert_notify_send_failed', {
            incidentId: inc.id,
            alertId: inc.alertId,
            to,
            error: result.error,
          })
        }
      }
      if (successCount === 0) {
        await clearNotified(inc.id)
      } else {
        logger.info('alert_notify_sent', {
          incidentId: inc.id,
          alertId: inc.alertId,
          recipients: successCount,
          total: recipients.length,
        })
      }
    }
  } catch {
    // top-level guard — notification dispatch is best-effort
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
  notifiedAt: string | null
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
         "lastSeenAt", "tickCount",
         "notifiedAt"
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
      notifiedAt:
        r.notifiedAt == null
          ? null
          : r.notifiedAt instanceof Date
            ? r.notifiedAt.toISOString()
            : String(r.notifiedAt),
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
