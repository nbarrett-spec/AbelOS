import { prisma } from '@/lib/prisma'
import { sendEmail } from '@/lib/email'
import { logger } from '@/lib/logger'
import { getActiveMuteIds } from '@/lib/alert-mutes'

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
          "notifiedAt" TIMESTAMPTZ,
          "escalationCount" INTEGER NOT NULL DEFAULT 0
        )
      `)
      // Backfill the notifiedAt column for existing tables created before
      // the notification feature. IF NOT EXISTS makes this a no-op on new
      // installs but adds the column on any deployment that pre-dates this.
      await prisma.$executeRawUnsafe(
        `ALTER TABLE "AlertIncident" ADD COLUMN IF NOT EXISTS "notifiedAt" TIMESTAMPTZ`
      )
      // Backfill escalationCount for tables that pre-date the escalation
      // feature. Defaults to 0 for all existing rows, which means the next
      // eligible tick treats already-notified incidents as having had
      // "zero prior escalations" and starts the 1h clock from their
      // existing notifiedAt — correct behavior.
      await prisma.$executeRawUnsafe(
        `ALTER TABLE "AlertIncident" ADD COLUMN IF NOT EXISTS "escalationCount" INTEGER NOT NULL DEFAULT 0`
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
    const mutedIds = await getActiveMuteIds()
    // Treat muted alerts as "not currently firing" for the purpose of the
    // close loop — but we also skip them in the upsert loop below so
    // existing open incidents for newly-muted alerts naturally close on
    // this tick. That matches operator intuition: muting an alert should
    // visually quiet the banner on the next refresh.
    const currentIds = new Set(
      current.filter((a) => !mutedIds.has(a.id)).map((a) => a.id)
    )

    // 1. Upsert current alerts.
    for (const alert of current) {
      // success alerts never fire history — they're the absence of a problem.
      if (alert.type === 'success') continue
      // Muted alerts never get persisted. Any already-open incident with
      // this alertId will fall through to the close loop below because
      // currentIds doesn't contain it.
      if (mutedIds.has(alert.id)) continue

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

// ──────────────────────────────────────────────────────────────────────────
// Escalation dispatch.
//
// Once an incident is opened and the initial notification has been sent
// (notifiedAt stamped), dispatchCriticalNotifications runs a second pass
// looking for open criticals where notifiedAt is older than 1 hour. For
// each it atomically claims an escalation slot, sends a "[STILL FIRING]"
// email, and bumps escalationCount + notifiedAt=NOW(). Capped at
// ESCALATION_MAX_COUNT so a week-long incident doesn't turn into 168
// emails.
//
// The claim is a single UPDATE ... RETURNING so concurrent Lambdas can't
// double-send — only one wins the atomic increment. Lost racers get null
// back from claimEscalation and skip the row.
//
// On total send failure we roll back escalationCount (but NOT notifiedAt)
// so the row becomes eligible again in an hour, not immediately — one
// missed escalation during a transient Resend outage is better than a
// tight retry loop against a broken sender.
// ──────────────────────────────────────────────────────────────────────────

const ESCALATION_INTERVAL_HOURS = 1
const ESCALATION_MAX_COUNT = 4

interface EscalationClaim extends PendingIncident {
  escalationCount: number
}

async function loadEscalationCandidateIds(): Promise<string[]> {
  try {
    const rows: any[] = await prisma.$queryRawUnsafe(
      `SELECT "id"
       FROM "AlertIncident"
       WHERE "endedAt" IS NULL
         AND "peakSeverity" = 'critical'
         AND "notifiedAt" IS NOT NULL
         AND "notifiedAt" < NOW() - INTERVAL '${ESCALATION_INTERVAL_HOURS} hours'
         AND "escalationCount" < ${ESCALATION_MAX_COUNT}
       ORDER BY "startedAt" ASC
       LIMIT 20`
    )
    return rows.map((r) => String(r.id))
  } catch {
    return []
  }
}

async function claimEscalation(
  incidentId: string
): Promise<EscalationClaim | null> {
  try {
    const rows: any[] = await prisma.$queryRawUnsafe(
      `UPDATE "AlertIncident"
       SET "escalationCount" = "escalationCount" + 1,
           "notifiedAt" = NOW()
       WHERE "id" = $1
         AND "endedAt" IS NULL
         AND "peakSeverity" = 'critical'
         AND "notifiedAt" IS NOT NULL
         AND "notifiedAt" < NOW() - INTERVAL '${ESCALATION_INTERVAL_HOURS} hours'
         AND "escalationCount" < ${ESCALATION_MAX_COUNT}
       RETURNING "id", "alertId", "title", "href", "description",
                 "peakCount", "startedAt", "tickCount", "escalationCount"`,
      incidentId
    )
    if (!rows.length) return null
    const r = rows[0]
    return {
      id: String(r.id),
      alertId: String(r.alertId),
      title: String(r.title),
      href: r.href ?? null,
      description: r.description ?? null,
      peakCount: Number(r.peakCount) || 0,
      startedAt:
        r.startedAt instanceof Date ? r.startedAt : new Date(String(r.startedAt)),
      tickCount: Number(r.tickCount) || 1,
      escalationCount: Number(r.escalationCount) || 1,
    }
  } catch {
    return null
  }
}

async function rollbackEscalation(incidentId: string): Promise<void> {
  try {
    await prisma.$executeRawUnsafe(
      `UPDATE "AlertIncident"
       SET "escalationCount" = GREATEST("escalationCount" - 1, 0)
       WHERE "id" = $1`,
      incidentId
    )
  } catch {
    // swallow — we'll just skip this escalation cycle
  }
}

function formatDuration(ms: number): string {
  if (ms < 0) ms = 0
  const totalMinutes = Math.floor(ms / 60000)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (hours >= 1) {
    return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`
  }
  return `${minutes}m`
}

function renderEscalationEmailHtml(
  incident: PendingIncident,
  escalationCount: number
): string {
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
  const durationMs = Date.now() - incident.startedAt.getTime()
  const duration = formatDuration(durationMs)
  const started = incident.startedAt.toISOString()
  const safeTitle = escapeHtml(incident.title)
  const safeDesc = incident.description
    ? escapeHtml(incident.description)
    : '(no description)'
  const safeAlertId = escapeHtml(incident.alertId)
  const remaining = ESCALATION_MAX_COUNT - escalationCount
  return `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:620px;margin:0 auto;padding:24px;background:#fff;">
      <div style="background:#7c2d12;color:#fff;padding:16px 20px;border-radius:8px 8px 0 0;">
        <div style="font-size:12px;letter-spacing:0.08em;text-transform:uppercase;opacity:0.85;">Escalation #${escalationCount} — still firing after ${duration}</div>
        <div style="font-size:18px;font-weight:700;margin-top:4px;">${safeTitle}</div>
      </div>
      <div style="border:1px solid #fed7aa;border-top:none;border-radius:0 0 8px 8px;padding:20px;">
        <table style="font-size:13px;width:100%;border-collapse:collapse;color:#374151;">
          <tr><td style="padding:4px 0;color:#6b7280;width:130px;">Alert ID</td><td style="font-family:ui-monospace,monospace;">${safeAlertId}</td></tr>
          <tr><td style="padding:4px 0;color:#6b7280;">Started</td><td>${started}</td></tr>
          <tr><td style="padding:4px 0;color:#6b7280;">Open for</td><td><strong>${duration}</strong></td></tr>
          <tr><td style="padding:4px 0;color:#6b7280;">Peak count</td><td>${incident.peakCount}</td></tr>
          <tr><td style="padding:4px 0;color:#6b7280;">Escalations sent</td><td>${escalationCount} of ${ESCALATION_MAX_COUNT} max</td></tr>
        </table>
        <div style="margin-top:16px;padding:12px;background:#fff7ed;border-left:3px solid #ea580c;font-size:13px;color:#7c2d12;white-space:pre-wrap;">${safeDesc}</div>
        <div style="margin-top:20px;">
          <a href="${href}" style="display:inline-block;padding:10px 18px;background:#ea580c;color:#fff;text-decoration:none;border-radius:6px;font-weight:600;font-size:14px;">Open in Admin</a>
        </div>
        <div style="margin-top:16px;font-size:11px;color:#9ca3af;">
          This is an escalation reminder because the incident has been open for more than ${escalationCount} hour${escalationCount === 1 ? '' : 's'} without closing.
          ${remaining > 0
            ? `You will receive up to ${remaining} more escalation${remaining === 1 ? '' : 's'} at 1h intervals until the incident closes or the cap is reached.`
            : 'This was the final escalation — no further emails will be sent for this incident until it closes and re-opens.'}
        </div>
      </div>
    </div>
  `.trim()
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
      // about every pre-existing open incident. Escalations are skipped
      // entirely in this branch — no point auto-escalating into the void.
      const pending = await loadPendingCriticalNotifications()
      for (const inc of pending) {
        await stampNotified(inc.id)
      }
      return
    }

    // ── Pass 1: brand-new incidents (notifiedAt IS NULL) ─────────────────
    const pending = await loadPendingCriticalNotifications()
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

    // ── Pass 2: escalations for stuck open incidents ─────────────────────
    // Separate pass so a failure in the initial-send loop doesn't starve
    // escalations, and vice versa. Candidates are selected with the same
    // filter the atomic claim uses; the claim itself re-checks everything
    // to win the race against concurrent Lambdas.
    const candidateIds = await loadEscalationCandidateIds()
    for (const id of candidateIds) {
      const claim = await claimEscalation(id)
      if (!claim) {
        // Lost the race, or the row became ineligible (closed, muted into
        // oblivion, etc.) between SELECT and UPDATE. Skip silently.
        continue
      }
      const html = renderEscalationEmailHtml(claim, claim.escalationCount)
      const durationMs = Date.now() - claim.startedAt.getTime()
      const subject = `[STILL FIRING — ${formatDuration(durationMs)}] ${claim.title}`
      let successCount = 0
      for (const to of recipients) {
        const result = await sendEmail({ to, subject, html })
        if (result.success) {
          successCount += 1
        } else {
          logger.warn('alert_escalation_send_failed', {
            incidentId: claim.id,
            alertId: claim.alertId,
            escalationCount: claim.escalationCount,
            to,
            error: result.error,
          })
        }
      }
      if (successCount === 0) {
        // Total failure — roll back the escalationCount so the row becomes
        // eligible for retry in one hour (notifiedAt was bumped to NOW and
        // we leave it there, so the hour cooldown still applies).
        await rollbackEscalation(claim.id)
      } else {
        logger.info('alert_escalation_sent', {
          incidentId: claim.id,
          alertId: claim.alertId,
          escalationCount: claim.escalationCount,
          durationMs,
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
  escalationCount: number
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
         "notifiedAt", "escalationCount"
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
      escalationCount: Number(r.escalationCount) || 0,
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
