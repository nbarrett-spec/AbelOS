'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

// ──────────────────────────────────────────────────────────────────────────
// CriticalAlertBanner — thin sticky strip at the top of the admin shell
// that lights up when /api/ops/system-alerts reports critical or warning
// alerts.
//
// Deliberately lightweight:
//   - Polls once at mount and then every 30s.
//   - Renders nothing at all if there are no critical/warning alerts (no
//     layout shift for the common case).
//   - Honours a localStorage "dismissed until" timestamp so an operator
//     who already knows about an incident can mute for 10 minutes while
//     they work the fix, without the banner breathing down their neck.
//   - Only shows critical + warning. Info alerts are visible on /ops and
//     /admin/health but don't deserve the whole shell's attention.
//
// Re-polling is intentionally non-blocking: failures swallow silently and
// keep the previous state. A transient 500 from /api/ops/system-alerts
// should not make the banner disappear and reappear.
// ──────────────────────────────────────────────────────────────────────────

interface SystemAlert {
  id: string
  type: 'critical' | 'warning' | 'info' | 'success'
  title: string
  count: number
  href: string
  description?: string
  muted?: boolean
  mutedUntil?: string
}

interface AlertPayload {
  alerts: SystemAlert[]
}

const POLL_INTERVAL_MS = 30_000
const DISMISS_STORAGE_KEY = 'cowork:critical-alert-banner-dismissed-until'
const DISMISS_DURATION_MS = 10 * 60 * 1000 // 10 minutes

function loadDismissedUntil(): number {
  if (typeof window === 'undefined') return 0
  try {
    const raw = window.localStorage.getItem(DISMISS_STORAGE_KEY)
    if (!raw) return 0
    const n = parseInt(raw, 10)
    return Number.isFinite(n) ? n : 0
  } catch {
    return 0
  }
}

function saveDismissedUntil(ts: number): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(DISMISS_STORAGE_KEY, String(ts))
  } catch {
    // ignore — private mode may block localStorage
  }
}

export default function CriticalAlertBanner() {
  const [alerts, setAlerts] = useState<SystemAlert[]>([])
  const [dismissedUntil, setDismissedUntil] = useState<number>(0)
  const [now, setNow] = useState<number>(Date.now())

  // Rehydrate dismissed-until from localStorage on mount. The initial state
  // is 0 to keep SSR/client output aligned — we correct it inside the
  // effect so React doesn't warn about hydration mismatches.
  useEffect(() => {
    setDismissedUntil(loadDismissedUntil())
  }, [])

  // Tick every 10s to re-evaluate whether dismissedUntil has expired. We
  // don't need sub-second precision — a 10s tick is fine for showing the
  // banner 10 seconds after the mute clears.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 10_000)
    return () => clearInterval(id)
  }, [])

  // Poll the alert endpoint. Same cadence as SystemPulse so we're not
  // adding any meaningful load — the endpoint caches server-side for 10s
  // anyway.
  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        const res = await fetch('/api/ops/system-alerts', {
          credentials: 'same-origin',
        })
        if (!res.ok) return
        const payload = (await res.json()) as AlertPayload
        if (cancelled) return
        setAlerts(payload.alerts || [])
      } catch {
        // keep previous state on failure
      }
    }

    void load()
    const id = setInterval(load, POLL_INTERVAL_MS)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [])

  // Filter to critical + warning only. Info is too chatty for a shell banner.
  // Muted alerts are also skipped — the whole point of the mute is to stop
  // the banner from crying wolf about a known issue.
  const loud = alerts.filter(
    (a) => (a.type === 'critical' || a.type === 'warning') && !a.muted
  )
  const criticalCount = loud.filter((a) => a.type === 'critical').length
  const isDismissed = dismissedUntil > now

  if (loud.length === 0 || isDismissed) return null

  function dismiss() {
    const until = Date.now() + DISMISS_DURATION_MS
    saveDismissedUntil(until)
    setDismissedUntil(until)
  }

  // Pick banner colour by the worst severity present.
  const hasCritical = criticalCount > 0
  const bannerCls = hasCritical
    ? 'bg-rose-600 text-white border-rose-700'
    : 'bg-signal text-white border-amber-600'

  return (
    <div
      className={`sticky top-0 z-40 border-b-2 ${bannerCls} shadow-sm`}
      role="alert"
      aria-live="polite"
    >
      <div className="max-w-[1800px] mx-auto px-4 py-2 flex items-center gap-3 flex-wrap">
        <span className="inline-flex items-center gap-2 font-semibold text-sm">
          <span className="inline-block w-2 h-2 rounded-full bg-white animate-pulse" />
          {hasCritical ? 'CRITICAL' : 'WARNING'}
        </span>
        <span className="text-sm opacity-90">
          {loud.length} active alert{loud.length === 1 ? '' : 's'}
          {hasCritical && criticalCount < loud.length && ` (${criticalCount} critical)`}
        </span>
        <div className="flex items-center gap-2 flex-wrap min-w-0 flex-1">
          {loud.slice(0, 3).map((alert) => (
            <Link
              key={alert.id}
              href={alert.href}
              className="text-xs bg-white/15 hover:bg-white/25 px-2 py-1 rounded font-medium truncate transition-colors"
              title={alert.description}
            >
              {alert.title}
              <span className="ml-1 opacity-80">({alert.count})</span>
            </Link>
          ))}
          {loud.length > 3 && (
            <Link
              href="/admin/health"
              className="text-xs font-medium underline hover:no-underline"
            >
              +{loud.length - 3} more
            </Link>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Link
            href="/admin/timeline"
            className="text-xs font-semibold bg-white/15 hover:bg-white/25 px-3 py-1 rounded transition-colors"
          >
            Timeline
          </Link>
          <button
            onClick={dismiss}
            className="text-xs font-medium opacity-80 hover:opacity-100 underline"
            title="Hide for 10 minutes"
          >
            Mute 10m
          </button>
        </div>
      </div>
    </div>
  )
}
