'use client'

// ─────────────────────────────────────────────────────────────────────────────
// <PmActivityFeed/> — reusable client-side timeline for a PM's "what changed"
// feed.
//
// Props:
//   • staffId   — required; who the feed is for (x-staff-id comes from cookie
//                 auth, this is just for display + URL construction).
//   • since     — optional ISO string; defaults to NOW - 24h at the API.
//   • compact   — optional; renders a tight inline variant for embedding on
//                 other pages. Smaller rows, no day grouping, max 8 items.
//
// Behavior:
//   • Fetches /api/ops/pm/activity on mount.
//   • Auto-refreshes every 60s (setInterval, cleared on unmount).
//   • Renders loading skeleton, error with retry, and empty state.
//   • Full mode: groups by Today / Yesterday / Older with relative timestamps.
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import {
  FileText,
  AlertTriangle,
  Mail,
  Truck,
  CheckCircle,
  PackageCheck,
  PackageX,
  PackageOpen,
  CalendarClock,
  ClipboardList,
  ClipboardCheck,
  PenTool,
  FileBadge,
  Bell,
  Hammer,
  HardHat,
  Activity,
  RefreshCw,
  ArrowRight,
} from 'lucide-react'

// ── Types mirror the API route ───────────────────────────────────────────────
type ActivityKind =
  | 'CO_RECEIVED'
  | 'CO_UPDATED'
  | 'MATERIAL_RED'
  | 'MATERIAL_GREEN'
  | 'MATERIAL_AMBER'
  | 'EMAIL_IN'
  | 'TASK_ASSIGNED'
  | 'TASK_COMPLETED'
  | 'DELIVERY_STARTED'
  | 'DELIVERY_DONE'
  | 'INSTALL_STARTED'
  | 'INSTALL_COMPLETED'
  | 'PO_RECEIVED'
  | 'RED_LINE'
  | 'PLAN_DOCUMENT'
  | 'CLOSING_DATE_CHANGED'
  | 'SCHEDULE_CHANGE'
  | 'INBOX_ALERT'
  | 'JOB_STATUS_CHANGE'

type ActivitySeverity = 'info' | 'warn' | 'alert'

interface ActivityEvent {
  id: string
  kind: ActivityKind
  at: string
  jobId: string | null
  jobNumber: string | null
  builderName: string | null
  community: string | null
  title: string
  summary: string | null
  href: string | null
  severity: ActivitySeverity
}

interface ActivityResponse {
  staffId: string
  sinceIso: string
  total: number
  events: ActivityEvent[]
  sources: {
    audit: number
    email: number
    hyphen: number
    inbox: number
    truncated: Record<string, number>
  }
}

export interface PmActivityFeedProps {
  staffId: string
  since?: string
  compact?: boolean
}

// ── Icon resolver ────────────────────────────────────────────────────────────
function kindIcon(kind: ActivityKind, className = 'w-4 h-4') {
  switch (kind) {
    case 'CO_RECEIVED':
    case 'CO_UPDATED':
      return <FileText className={className} />
    case 'MATERIAL_RED':
      return <PackageX className={className} />
    case 'MATERIAL_GREEN':
      return <PackageCheck className={className} />
    case 'MATERIAL_AMBER':
      return <PackageOpen className={className} />
    case 'EMAIL_IN':
      return <Mail className={className} />
    case 'TASK_ASSIGNED':
      return <ClipboardList className={className} />
    case 'TASK_COMPLETED':
      return <ClipboardCheck className={className} />
    case 'DELIVERY_STARTED':
    case 'DELIVERY_DONE':
      return <Truck className={className} />
    case 'INSTALL_STARTED':
      return <Hammer className={className} />
    case 'INSTALL_COMPLETED':
      return <HardHat className={className} />
    case 'PO_RECEIVED':
      return <FileBadge className={className} />
    case 'RED_LINE':
      return <PenTool className={className} />
    case 'PLAN_DOCUMENT':
      return <FileText className={className} />
    case 'CLOSING_DATE_CHANGED':
      return <CalendarClock className={className} />
    case 'SCHEDULE_CHANGE':
      return <CalendarClock className={className} />
    case 'INBOX_ALERT':
      return <Bell className={className} />
    case 'JOB_STATUS_CHANGE':
      return <Activity className={className} />
    default:
      return <CheckCircle className={className} />
  }
}

// Severity → Tailwind color tokens. Leans on Aegis' semantic palette when
// present (data-negative / signal), falls back to stock tokens otherwise.
function severityClasses(s: ActivitySeverity): {
  iconWrap: string
  badge: string
} {
  switch (s) {
    case 'alert':
      return {
        iconWrap:
          'bg-red-500/10 text-red-600 dark:text-red-400 ring-1 ring-red-500/30',
        badge:
          'text-[10px] uppercase tracking-wider font-semibold text-red-600 dark:text-red-400',
      }
    case 'warn':
      return {
        iconWrap:
          'bg-amber-500/10 text-amber-600 dark:text-amber-400 ring-1 ring-amber-500/30',
        badge:
          'text-[10px] uppercase tracking-wider font-semibold text-amber-600 dark:text-amber-400',
      }
    default:
      return {
        iconWrap:
          'bg-sky-500/10 text-sky-600 dark:text-sky-400 ring-1 ring-sky-500/30',
        badge:
          'text-[10px] uppercase tracking-wider font-semibold text-sky-600 dark:text-sky-400',
      }
  }
}

// ── Time helpers ─────────────────────────────────────────────────────────────
function fmtRelative(iso: string, now: number): string {
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return '—'
  const ms = now - t
  if (ms < 0) return 'just now'
  const mins = Math.round(ms / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.round(hrs / 24)
  if (days < 30) return `${days}d ago`
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

type DayBucket = 'today' | 'yesterday' | 'older'
function bucketFor(iso: string, now: number): DayBucket {
  const t = new Date(iso)
  const today = new Date(now)
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  if (sameDay(t, today)) return 'today'
  const yest = new Date(today)
  yest.setDate(today.getDate() - 1)
  if (sameDay(t, yest)) return 'yesterday'
  return 'older'
}

function bucketLabel(b: DayBucket): string {
  return b === 'today' ? 'Today' : b === 'yesterday' ? 'Yesterday' : 'Older'
}

// Humanise the "since" ISO for the empty state.
function fmtSinceLabel(since: string | undefined): string {
  if (!since) return 'the last 24h'
  const t = Date.parse(since)
  if (!Number.isFinite(t)) return 'the last 24h'
  const now = Date.now()
  const diffH = Math.round((now - t) / 3600000)
  if (diffH < 24) return `the last ${diffH}h`
  const diffD = Math.round(diffH / 24)
  return `the last ${diffD}d`
}

// ── Main component ───────────────────────────────────────────────────────────
const REFRESH_MS = 60_000

export default function PmActivityFeed(props: PmActivityFeedProps) {
  const { staffId, since, compact } = props

  const [data, setData] = useState<ActivityResponse | null>(null)
  const [loading, setLoading] = useState<boolean>(true)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState<boolean>(false)
  const [nowTs, setNowTs] = useState<number>(() => Date.now())
  const abortRef = useRef<AbortController | null>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const url = useMemo(() => {
    const params = new URLSearchParams()
    if (since) params.set('since', since)
    // Cap client side too so we don't pull a thousand rows on a slow network.
    params.set('limit', compact ? '20' : '200')
    return `/api/ops/pm/activity?${params.toString()}`
  }, [since, compact])

  const fetchFeed = useCallback(
    async (silent = false) => {
      // Cancel any in-flight request
      if (abortRef.current) abortRef.current.abort()
      const ctrl = new AbortController()
      abortRef.current = ctrl
      if (!silent) setLoading(true)
      else setRefreshing(true)
      try {
        const res = await fetch(url, {
          signal: ctrl.signal,
          cache: 'no-store',
          credentials: 'include',
        })
        if (!res.ok) {
          const msg =
            res.status === 401
              ? 'Please sign in to view your activity feed.'
              : `Feed unavailable (${res.status}).`
          throw new Error(msg)
        }
        const json: ActivityResponse = await res.json()
        setData(json)
        setError(null)
      } catch (e: any) {
        if (e?.name === 'AbortError') return
        setError(e?.message || 'Failed to load activity.')
      } finally {
        setLoading(false)
        setRefreshing(false)
      }
    },
    [url],
  )

  // Initial fetch + 60s polling
  useEffect(() => {
    void fetchFeed(false)
    intervalRef.current = setInterval(() => {
      void fetchFeed(true)
    }, REFRESH_MS)
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
      if (abortRef.current) abortRef.current.abort()
    }
  }, [fetchFeed])

  // Tick the "now" every 30s so relative timestamps stay fresh without
  // re-fetching everything.
  useEffect(() => {
    tickRef.current = setInterval(() => setNowTs(Date.now()), 30_000)
    return () => {
      if (tickRef.current) clearInterval(tickRef.current)
    }
  }, [])

  // ── Render: loading skeleton ──────────────────────────────────────────────
  if (loading && !data) {
    return (
      <div className={compact ? 'space-y-2' : 'space-y-4'}>
        {Array.from({ length: compact ? 3 : 6 }).map((_, i) => (
          <div
            key={i}
            className="flex items-start gap-3 animate-pulse"
            aria-hidden="true"
          >
            <div className="w-8 h-8 rounded-full bg-fg-subtle/20 shrink-0" />
            <div className="flex-1 space-y-1.5">
              <div className="h-3 bg-fg-subtle/20 rounded w-3/5" />
              <div className="h-2.5 bg-fg-subtle/10 rounded w-4/5" />
            </div>
            <div className="h-3 w-10 bg-fg-subtle/10 rounded" />
          </div>
        ))}
      </div>
    )
  }

  // ── Render: error with retry ──────────────────────────────────────────────
  if (error && !data) {
    return (
      <div className="border border-red-500/30 bg-red-500/5 rounded-md p-4 flex items-start gap-3">
        <AlertTriangle className="w-4 h-4 text-red-500 mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm text-fg font-medium">
            Couldn't load activity feed
          </p>
          <p className="text-xs text-fg-muted mt-0.5">{error}</p>
        </div>
        <button
          type="button"
          onClick={() => void fetchFeed(false)}
          className="text-xs px-2.5 py-1 rounded border border-border hover:border-border-strong bg-surface text-fg flex items-center gap-1.5 shrink-0"
        >
          <RefreshCw className="w-3 h-3" /> Retry
        </button>
      </div>
    )
  }

  const events = data?.events ?? []
  const sinceIso = data?.sinceIso ?? since

  // ── Render: empty ─────────────────────────────────────────────────────────
  if (events.length === 0) {
    return (
      <div className="text-center py-8 px-4 border border-dashed border-border rounded-md bg-surface/50">
        <CheckCircle className="w-5 h-5 text-fg-subtle mx-auto mb-2" />
        <p className="text-sm text-fg-muted">
          No activity since {fmtSinceLabel(sinceIso)}. All quiet.
        </p>
      </div>
    )
  }

  // ── Compact mode: flat list, no day grouping ──────────────────────────────
  if (compact) {
    const top = events.slice(0, 8)
    return (
      <ul className="space-y-2">
        {top.map((ev) => (
          <ActivityRow key={ev.id} ev={ev} nowTs={nowTs} compact />
        ))}
        {events.length > top.length && (
          <li className="pt-1">
            <Link
              href={`/ops/pm/activity`}
              className="text-xs text-fg-muted hover:text-fg inline-flex items-center gap-1"
            >
              View all {events.length} events
              <ArrowRight className="w-3 h-3" />
            </Link>
          </li>
        )}
      </ul>
    )
  }

  // ── Full mode: grouped by day ─────────────────────────────────────────────
  const grouped = {
    today: [] as ActivityEvent[],
    yesterday: [] as ActivityEvent[],
    older: [] as ActivityEvent[],
  }
  for (const ev of events) {
    grouped[bucketFor(ev.at, nowTs)].push(ev)
  }

  const order: DayBucket[] = ['today', 'yesterday', 'older']
  const truncatedEntries = Object.entries(data?.sources.truncated ?? {}).filter(
    ([, n]) => n > 0,
  )

  return (
    <div className="space-y-6">
      {refreshing && (
        <div className="text-[11px] text-fg-subtle flex items-center gap-1">
          <RefreshCw className="w-3 h-3 animate-spin" /> Refreshing…
        </div>
      )}

      {order.map((bucket) => {
        const rows = grouped[bucket]
        if (rows.length === 0) return null
        return (
          <section key={bucket}>
            <h3 className="text-[11px] uppercase tracking-wider text-fg-subtle font-semibold mb-2">
              {bucketLabel(bucket)} · {rows.length}
            </h3>
            <ul className="space-y-3">
              {rows.map((ev) => (
                <ActivityRow key={ev.id} ev={ev} nowTs={nowTs} />
              ))}
            </ul>
          </section>
        )
      })}

      {truncatedEntries.length > 0 && (
        <p className="text-[11px] text-fg-subtle pt-1 border-t border-border/50">
          {truncatedEntries
            .map(([src, n]) => `… and ${n} more ${src} events`)
            .join(' · ')}
        </p>
      )}
    </div>
  )
}

// ── Row component ────────────────────────────────────────────────────────────
function ActivityRow({
  ev,
  nowTs,
  compact,
}: {
  ev: ActivityEvent
  nowTs: number
  compact?: boolean
}) {
  const sev = severityClasses(ev.severity)
  const rel = fmtRelative(ev.at, nowTs)

  const content = (
    <div
      className={
        compact
          ? 'flex items-start gap-2.5 min-w-0'
          : 'flex items-start gap-3 min-w-0'
      }
    >
      <div
        className={`shrink-0 flex items-center justify-center rounded-full ${
          compact ? 'w-7 h-7' : 'w-8 h-8'
        } ${sev.iconWrap}`}
        aria-hidden="true"
      >
        {kindIcon(ev.kind, compact ? 'w-3.5 h-3.5' : 'w-4 h-4')}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2 min-w-0">
          <p
            className={`${compact ? 'text-[13px]' : 'text-sm'} font-medium text-fg truncate`}
          >
            {ev.title}
          </p>
          {ev.jobNumber && (
            <span
              className={`shrink-0 font-mono text-fg-muted ${compact ? 'text-[10px]' : 'text-[11px]'}`}
            >
              {ev.jobNumber}
            </span>
          )}
        </div>
        {!compact && (ev.summary || ev.community || ev.builderName) && (
          <p className="text-xs text-fg-muted mt-0.5 line-clamp-2">
            {ev.summary ? `${ev.summary}` : ''}
            {ev.summary && (ev.community || ev.builderName) ? ' · ' : ''}
            {[ev.community, ev.builderName].filter(Boolean).join(' · ')}
          </p>
        )}
        {compact && ev.summary && (
          <p className="text-[11px] text-fg-muted truncate">{ev.summary}</p>
        )}
      </div>
      <span
        className={`shrink-0 font-mono text-fg-subtle ${compact ? 'text-[10px]' : 'text-[11px]'}`}
        title={new Date(ev.at).toLocaleString()}
      >
        {rel}
      </span>
    </div>
  )

  const wrapperBase =
    'block rounded-md transition-colors -mx-2 px-2 py-1.5 hover:bg-surface'

  if (ev.href) {
    return (
      <li>
        <Link href={ev.href} className={wrapperBase}>
          {content}
        </Link>
      </li>
    )
  }
  return (
    <li>
      <div className={wrapperBase}>{content}</div>
    </li>
  )
}
