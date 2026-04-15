import { prisma } from '@/lib/prisma'

// ──────────────────────────────────────────────────────────────────────────
// Alert muting — suppress specific alertIds for a bounded window.
//
// Motivation: during a known-bad period (third-party vendor outage, scheduled
// maintenance, flaky cron we've already investigated), an alert will keep
// firing and spam the banner, the incident timeline, and the email
// dispatcher. Rather than redeploying to disable the alert entirely, we
// let staff mute it for a defined window. When the mute expires, the alert
// naturally resumes without any operator action.
//
// Storage model: one row per alertId, upsert-replace. The row carries
// mutedUntil (when the mute auto-expires), reason (why), mutedBy (who).
// A mute is "active" when `mutedUntil > NOW()`. Expired rows are left in
// place until the observability-gc sweep prunes them — keeping them around
// for a window lets us audit "what did we mute last week?".
//
// Lifecycle and integration points:
//   - alert-history.snapshotAlerts() calls getActiveMuteIds() before the
//     upsert loop. Muted alerts never open a new incident and never bump
//     an existing one. Already-open incidents for an alertId that gets
//     muted mid-flight are left alone — muting is forward-looking only.
//     This matches operator intuition: "stop the noise from here on."
//   - system-alerts GET handler attaches `muted: true` (and mutedUntil)
//     to any currently-firing alert that's muted, so the UI can render
//     a "muted" section separately from the live count.
//   - The admin shell banner checks `alert.muted` and skips it from the
//     banner critical/warning tallies.
//
// Everything in this module is best-effort and swallows errors — the
// hot path of system-alerts must not break because the mutes table is
// sick. A failed getActiveMuteIds() call returns an empty set, which
// means no alerts are muted, which is the safe default.
// ──────────────────────────────────────────────────────────────────────────

export interface AlertMute {
  alertId: string
  mutedUntil: string
  reason: string | null
  mutedBy: string | null
  createdAt: string
}

let tableReady: Promise<void> | null = null

async function ensureAlertMuteTable(): Promise<void> {
  if (tableReady) return tableReady
  tableReady = (async () => {
    try {
      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "AlertMute" (
          "alertId" TEXT PRIMARY KEY,
          "mutedUntil" TIMESTAMPTZ NOT NULL,
          "reason" TEXT,
          "mutedBy" TEXT,
          "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `)
      await prisma.$executeRawUnsafe(
        `CREATE INDEX IF NOT EXISTS "idx_alertmute_until" ON "AlertMute" ("mutedUntil" DESC)`
      )
    } catch {
      // swallow — best-effort
    }
  })()
  return tableReady
}

/**
 * Fast path used by system-alerts and snapshot-alerts: which alertIds are
 * currently silenced? Returns the set of active mute rows keyed by alertId.
 * Swallows errors to an empty map so the hot path always has a usable
 * answer even if the table is missing or the query blows up.
 */
export async function getActiveMutes(): Promise<Map<string, AlertMute>> {
  try {
    await ensureAlertMuteTable()
    const rows: any[] = await prisma.$queryRawUnsafe(
      `SELECT "alertId", "mutedUntil", "reason", "mutedBy", "createdAt"
       FROM "AlertMute"
       WHERE "mutedUntil" > NOW()`
    )
    const m = new Map<string, AlertMute>()
    for (const r of rows) {
      m.set(String(r.alertId), {
        alertId: String(r.alertId),
        mutedUntil:
          r.mutedUntil instanceof Date
            ? r.mutedUntil.toISOString()
            : String(r.mutedUntil),
        reason: r.reason ?? null,
        mutedBy: r.mutedBy ?? null,
        createdAt:
          r.createdAt instanceof Date
            ? r.createdAt.toISOString()
            : String(r.createdAt),
      })
    }
    return m
  } catch {
    return new Map()
  }
}

/**
 * Convenience helper that only needs the set of IDs (not the metadata).
 * snapshotAlerts uses this form.
 */
export async function getActiveMuteIds(): Promise<Set<string>> {
  const mutes = await getActiveMutes()
  return new Set(mutes.keys())
}

/**
 * Upsert a mute. Idempotent — calling twice with the same alertId replaces
 * the previous mute's mutedUntil/reason. Clamps durationHours to a sane
 * range so a typo can't accidentally silence an alert forever.
 */
export async function muteAlert(params: {
  alertId: string
  durationHours: number
  reason?: string
  mutedBy?: string
}): Promise<{ ok: true; mutedUntil: string } | { ok: false; error: string }> {
  const { alertId } = params
  if (!alertId || alertId.length > 200) {
    return { ok: false, error: 'alertId must be 1..200 chars' }
  }
  // 5 minutes .. 7 days. Anything outside that is almost certainly a
  // mistake — if you want a persistent mute, disable the alert in code.
  const hours = Math.min(Math.max(params.durationHours, 5 / 60), 24 * 7)
  const reason = (params.reason ?? '').slice(0, 500) || null
  const mutedBy = (params.mutedBy ?? '').slice(0, 200) || null

  try {
    await ensureAlertMuteTable()
    await prisma.$executeRawUnsafe(
      `INSERT INTO "AlertMute" ("alertId", "mutedUntil", "reason", "mutedBy", "createdAt")
       VALUES ($1, NOW() + make_interval(secs => $2), $3, $4, NOW())
       ON CONFLICT ("alertId") DO UPDATE SET
         "mutedUntil" = EXCLUDED."mutedUntil",
         "reason" = EXCLUDED."reason",
         "mutedBy" = EXCLUDED."mutedBy",
         "createdAt" = NOW()`,
      alertId,
      Math.round(hours * 3600),
      reason,
      mutedBy
    )
    // Read back mutedUntil for the response so the caller can show an
    // accurate expiry time in the UI without doing clock math.
    const rows: any[] = await prisma.$queryRawUnsafe(
      `SELECT "mutedUntil" FROM "AlertMute" WHERE "alertId" = $1`,
      alertId
    )
    const mu = rows[0]?.mutedUntil
    return {
      ok: true,
      mutedUntil:
        mu instanceof Date ? mu.toISOString() : String(mu ?? new Date().toISOString()),
    }
  } catch (e: any) {
    return { ok: false, error: e?.message || 'mute failed' }
  }
}

/**
 * Clear a mute immediately. Deleting the row rather than setting
 * mutedUntil to NOW() keeps the table free of dead rows when an operator
 * changes their mind — which is the common case.
 */
export async function unmuteAlert(
  alertId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!alertId || alertId.length > 200) {
    return { ok: false, error: 'alertId must be 1..200 chars' }
  }
  try {
    await ensureAlertMuteTable()
    await prisma.$executeRawUnsafe(
      `DELETE FROM "AlertMute" WHERE "alertId" = $1`,
      alertId
    )
    return { ok: true }
  } catch (e: any) {
    return { ok: false, error: e?.message || 'unmute failed' }
  }
}

/**
 * List every mute including expired rows newer than `sinceHours`.
 * Used by /api/admin/alert-mutes for the management UI.
 */
export async function listMutes(sinceHours: number = 168): Promise<AlertMute[]> {
  try {
    await ensureAlertMuteTable()
    const hours = Math.min(Math.max(sinceHours, 1), 720)
    const rows: any[] = await prisma.$queryRawUnsafe(
      `SELECT "alertId", "mutedUntil", "reason", "mutedBy", "createdAt"
       FROM "AlertMute"
       WHERE "createdAt" > NOW() - INTERVAL '${hours} hours'
          OR "mutedUntil" > NOW()
       ORDER BY "mutedUntil" DESC`
    )
    return rows.map((r) => ({
      alertId: String(r.alertId),
      mutedUntil:
        r.mutedUntil instanceof Date
          ? r.mutedUntil.toISOString()
          : String(r.mutedUntil),
      reason: r.reason ?? null,
      mutedBy: r.mutedBy ?? null,
      createdAt:
        r.createdAt instanceof Date
          ? r.createdAt.toISOString()
          : String(r.createdAt),
    }))
  } catch {
    return []
  }
}
