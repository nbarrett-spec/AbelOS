'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import Link from 'next/link'

// ──────────────────────────────────────────────────────────────────────────
// /admin/timeline — unified chronological incident feed.
//
// Pulls from /api/admin/incident-timeline, which merges every observability
// surface into a single wire shape. This page's job is presentation:
//   - time-range selector (1h / 6h / 24h / 72h / 7d)
//   - kind chips (toggle each source on/off)
//   - grouping by hour bucket with a visual lane for severity
//   - deep-links back to the per-source admin page
//
// The request only includes ?kinds= when the user deselected at least one
// kind — that way hitting the page fresh loads everything and the URL
// stays clean for sharing.
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
  meta?: Record<string, unknown>
}

interface TimelinePayload {
  sinceHours: number
  limit: number
  totalBeforeTrim: number
  counts: Record<IncidentKind, number>
  events: IncidentEvent[]
}

const KIND_META: Record<
  IncidentKind,
  { label: string; chipClass: string; dotClass: string; icon: string }
> = {
  server_error: {
    label: 'Server Error',
    chipClass: 'bg-rose-100 text-rose-800 border-rose-300',
    dotClass: 'bg-rose-500',
    icon: '⚠',
  },
  client_error: {
    label: 'Client Error',
    chipClass: 'bg-blue-100 text-blue-800 border-blue-300',
    dotClass: 'bg-blue-500',
    icon: '◈',
  },
  slow_query: {
    label: 'Slow Query',
    chipClass: 'bg-amber-100 text-amber-800 border-amber-300',
    dotClass: 'bg-amber-500',
    icon: '⏱',
  },
  cron_failure: {
    label: 'Cron Failure',
    chipClass: 'bg-purple-100 text-purple-800 border-purple-300',
    dotClass: 'bg-purple-500',
    icon: '⟳',
  },
  security_event: {
    label: 'Security',
    chipClass: 'bg-orange-100 text-orange-800 border-orange-300',
    dotClass: 'bg-orange-500',
    icon: '⛨',
  },
  uptime_failure: {
    label: 'Uptime',
    chipClass: 'bg-red-100 text-red-800 border-red-300',
    dotClass: 'bg-red-600',
    icon: '●',
  },
  webhook_dead: {
    label: 'Webhook DLQ',
    chipClass: 'bg-pink-100 text-pink-800 border-pink-300',
    dotClass: 'bg-pink-500',
    icon: '✉',
  },
  alert_fire: {
    label: 'Alert Fire',
    chipClass: 'bg-indigo-100 text-indigo-800 border-indigo-300',
    dotClass: 'bg-indigo-500',
    icon: '🔔',
  },
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

const TIME_RANGES: Array<{ label: string; hours: number }> = [
  { label: '1h', hours: 1 },
  { label: '6h', hours: 6 },
  { label: '24h', hours: 24 },
  { label: '72h', hours: 72 },
  { label: '7d', hours: 168 },
]

function fmtRel(iso: string): string {
  try {
    const d = new Date(iso)
    const diffSec = Math.floor((Date.now() - d.getTime()) / 1000)
    if (diffSec < 60) return `${diffSec}s ago`
    if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`
    if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`
    return `${Math.floor(diffSec / 86400)}d ago`
  } catch {
    return iso
  }
}

function fmtAbsTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
  } catch {
    return iso
  }
}

function fmtBucketLabel(bucketStart: Date, now: Date): string {
  const sameDay =
    bucketStart.getFullYear() === now.getFullYear() &&
    bucketStart.getMonth() === now.getMonth() &&
    bucketStart.getDate() === now.getDate()
  if (sameDay) {
    return bucketStart.toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    })
  }
  return bucketStart.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default function AdminTimelinePage() {
  const [data, setData] = useState<TimelinePayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [sinceHours, setSinceHours] = useState<number>(24)
  const [activeKinds, setActiveKinds] = useState<Set<IncidentKind>>(
    new Set(ALL_KINDS)
  )
  const [autoRefresh, setAutoRefresh] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      params.set('since', String(sinceHours))
      params.set('limit', '200')
      // Only send ?kinds when the user has deselected at least one —
      // keeps the default case's URL clean and shareable.
      if (activeKinds.size > 0 && activeKinds.size < ALL_KINDS.length) {
        params.set('kinds', Array.from(activeKinds).join(','))
      }
      const res = await fetch(`/api/admin/incident-timeline?${params.toString()}`)
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`)
      }
      const payload = (await res.json()) as TimelinePayload
      setData(payload)
    } catch (e: any) {
      setError(e?.message || 'Failed to load timeline')
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [sinceHours, activeKinds])

  useEffect(() => {
    load()
  }, [load])

  // Auto-refresh every 15s when toggled on. Using a cleanup closure so a
  // rapid setting flip doesn't stack intervals.
  useEffect(() => {
    if (!autoRefresh) return
    const id = setInterval(load, 15000)
    return () => clearInterval(id)
  }, [autoRefresh, load])

  function toggleKind(kind: IncidentKind) {
    setActiveKinds((prev) => {
      const next = new Set(prev)
      if (next.has(kind)) {
        next.delete(kind)
      } else {
        next.add(kind)
      }
      // Don't allow zero selections — silently restore the kind so the
      // user doesn't land on an empty page.
      if (next.size === 0) next.add(kind)
      return next
    })
  }

  function selectAll() {
    setActiveKinds(new Set(ALL_KINDS))
  }

  function selectOnly(kind: IncidentKind) {
    setActiveKinds(new Set([kind]))
  }

  // Bucket events by hour for visual grouping. A map from ISO-hour →
  // events preserves insertion order (which, because the payload is
  // already sorted desc, gives us newest-first bucket order).
  const buckets = useMemo(() => {
    if (!data) return []
    const m = new Map<string, IncidentEvent[]>()
    for (const e of data.events) {
      const d = new Date(e.timestamp)
      const bucketKey = new Date(
        d.getFullYear(),
        d.getMonth(),
        d.getDate(),
        d.getHours()
      ).toISOString()
      if (!m.has(bucketKey)) m.set(bucketKey, [])
      m.get(bucketKey)!.push(e)
    }
    return Array.from(m.entries()).map(([iso, events]) => ({
      bucketStart: new Date(iso),
      events,
    }))
  }, [data])

  const now = new Date()

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      <div className="flex items-start justify-between mb-6 gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Incident Timeline</h1>
          <p className="text-sm text-gray-600 mt-1">
            Unified reverse-chronological feed of every observability source.
            Use the chips below to filter by source.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <label className="inline-flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
              className="rounded border-gray-300"
            />
            Auto-refresh (15s)
          </label>
          <button
            onClick={load}
            disabled={loading}
            className="px-3 py-2 text-sm font-medium border border-gray-300 rounded bg-white hover:bg-gray-50 disabled:opacity-50"
          >
            {loading ? 'Loading…' : 'Refresh'}
          </button>
        </div>
      </div>

      {/* Time-range selector */}
      <div className="mb-4 flex items-center gap-2 flex-wrap">
        <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
          Window:
        </span>
        {TIME_RANGES.map((r) => (
          <button
            key={r.hours}
            onClick={() => setSinceHours(r.hours)}
            className={`px-3 py-1.5 text-sm font-medium rounded border transition-colors ${
              sinceHours === r.hours
                ? 'bg-gray-900 text-white border-gray-900'
                : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
            }`}
          >
            {r.label}
          </button>
        ))}
      </div>

      {/* Kind filter chips */}
      <div className="mb-6 flex items-center gap-2 flex-wrap">
        <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
          Sources:
        </span>
        {ALL_KINDS.map((kind) => {
          const meta = KIND_META[kind]
          const count = data?.counts[kind] ?? 0
          const active = activeKinds.has(kind)
          return (
            <button
              key={kind}
              onClick={() => toggleKind(kind)}
              onDoubleClick={() => selectOnly(kind)}
              title="Click to toggle, double-click to solo"
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-full border transition-all ${
                active
                  ? meta.chipClass
                  : 'bg-gray-50 text-gray-400 border-gray-200 line-through'
              }`}
            >
              <span className={`inline-block w-2 h-2 rounded-full ${meta.dotClass}`} />
              {meta.label}
              <span className="ml-1 opacity-70">{count}</span>
            </button>
          )
        })}
        {activeKinds.size < ALL_KINDS.length && (
          <button
            onClick={selectAll}
            className="px-3 py-1.5 text-xs font-semibold text-gray-600 hover:text-gray-900 underline"
          >
            Show all
          </button>
        )}
      </div>

      {error && (
        <div className="mb-4 p-3 bg-rose-50 border border-rose-200 rounded text-sm text-rose-800">
          {error}
        </div>
      )}

      {loading && !data && (
        <div className="py-12 text-center text-gray-500">Loading timeline…</div>
      )}

      {!loading && data && data.events.length === 0 && (
        <div className="py-16 text-center">
          <div className="inline-block text-5xl mb-3">✓</div>
          <div className="text-lg font-semibold text-gray-900">All clear</div>
          <div className="text-sm text-gray-600 mt-1">
            No incidents in the selected window{' '}
            {activeKinds.size < ALL_KINDS.length && 'for the active sources'}.
          </div>
        </div>
      )}

      {data && data.events.length > 0 && (
        <>
          {/* Summary strip */}
          <div className="mb-4 text-xs text-gray-500">
            Showing {data.events.length} of {data.totalBeforeTrim} events in the
            last {sinceHours}h
            {data.totalBeforeTrim > data.events.length &&
              ' — older events trimmed, narrow the window to see more'}
          </div>

          <div className="space-y-5">
            {buckets.map(({ bucketStart, events }) => (
              <div key={bucketStart.toISOString()} className="relative">
                <div className="sticky top-0 z-10 mb-2 -mx-6 px-6 py-1 bg-gray-50/80 backdrop-blur border-b border-gray-200">
                  <div className="text-xs font-semibold text-gray-700 uppercase tracking-wide">
                    {fmtBucketLabel(bucketStart, now)}
                    <span className="ml-2 font-normal text-gray-500">
                      — {events.length} event{events.length === 1 ? '' : 's'}
                    </span>
                  </div>
                </div>
                <ol className="relative border-l-2 border-gray-200 ml-2">
                  {events.map((event) => {
                    const meta = KIND_META[event.kind]
                    const isError = event.severity === 'error'
                    return (
                      <li
                        key={event.id}
                        className="ml-4 mb-2 relative"
                      >
                        <span
                          className={`absolute -left-[22px] top-2 w-3 h-3 rounded-full ${meta.dotClass} ring-4 ring-white`}
                        />
                        <div
                          className={`p-3 rounded-lg border ${
                            isError
                              ? 'bg-white border-rose-200'
                              : 'bg-white border-gray-200'
                          } hover:border-gray-400 transition-colors`}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span
                                  className={`inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-semibold rounded border ${meta.chipClass}`}
                                >
                                  {meta.label}
                                </span>
                                <span className="font-mono text-xs text-gray-500">
                                  {fmtAbsTime(event.timestamp)}
                                </span>
                                <span className="text-xs text-gray-400">
                                  · {fmtRel(event.timestamp)}
                                </span>
                              </div>
                              <div className="mt-1.5 text-sm font-medium text-gray-900 truncate">
                                {event.title}
                              </div>
                              {event.detail && (
                                <div className="mt-0.5 text-xs text-gray-600 font-mono truncate">
                                  {event.detail}
                                </div>
                              )}
                            </div>
                            {event.href && (
                              <Link
                                href={event.href}
                                className="shrink-0 text-xs text-blue-600 hover:text-blue-800 font-medium whitespace-nowrap"
                              >
                                Open →
                              </Link>
                            )}
                          </div>
                        </div>
                      </li>
                    )
                  })}
                </ol>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
