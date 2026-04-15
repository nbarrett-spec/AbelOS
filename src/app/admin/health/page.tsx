'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { SystemPulse } from '@/components/SystemPulse'

// ──────────────────────────────────────────────────────────────────────────
// /admin/health — dedicated platform health dashboard.
//
// Composes:
//   - SystemPulse widget (readiness + alerts)
//   - Slow Prisma query log (from /api/admin/slow-queries)
//   - Top offenders aggregate so ops can prioritize index work
//
// Refreshes every 30s. Threshold is set in prisma.ts via PRISMA_SLOW_QUERY_MS.
// ──────────────────────────────────────────────────────────────────────────

interface SlowQueryRow {
  id: string
  createdAt: string
  model: string
  operation: string
  durationMs: number
  thresholdMs: number
}

interface TopOffender {
  model: string
  operation: string
  count: number
  maxMs: number
  avgMs: number
  totalMs: number
}

interface SlowQueriesPayload {
  rows: SlowQueryRow[]
  topOffenders: TopOffender[]
  sinceHours: number
  thresholdMs: number
  note?: string
}

interface UptimeBucket {
  bucketStart: number
  total: number
  ready: number
  avgDbMs: number | null
}

interface UptimeSummary {
  total: number
  ready: number
  notReady: number
  uptimePct: number
  avgDbMs: number | null
  p95DbMs: number | null
  latestStatus: string | null
}

interface UptimePayload {
  summary: UptimeSummary
  rows: Array<{
    id: string
    createdAt: string
    status: string
    totalMs: number
    dbMs: number | null
    dbOk: boolean
    envOk: boolean
    error: string | null
  }>
  buckets: UptimeBucket[]
  sinceHours: number
  bucketHours: number
  note?: string
}

interface SecurityEventRow {
  id: string
  createdAt: string
  kind: string
  path: string | null
  method: string | null
  ip: string | null
  userAgent: string | null
  requestId: string | null
  details: unknown
}

interface SecurityBucket {
  bucketStart: string
  RATE_LIMIT: number
  CSRF: number
  AUTH_FAIL: number
  SUSPICIOUS: number
  total: number
}

interface SecurityEventsPayload {
  rows: SecurityEventRow[]
  kindCounts: Array<{ kind: string; count: number }>
  topIps: Array<{ ip: string; count: number; lastSeen: string }>
  topPaths: Array<{ path: string; count: number }>
  total: number
  sinceHours: number
  bucketMinutes?: number
  buckets?: SecurityBucket[]
  note?: string
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString()
  } catch {
    return iso
  }
}

function durationClass(ms: number): string {
  if (ms >= 5000) return 'text-red-700 font-bold'
  if (ms >= 2000) return 'text-red-600 font-semibold'
  if (ms >= 1000) return 'text-amber-600 font-semibold'
  return 'text-gray-700'
}

export default function AdminHealthPage() {
  const [data, setData] = useState<SlowQueriesPayload | null>(null)
  const [uptime, setUptime] = useState<UptimePayload | null>(null)
  const [security, setSecurity] = useState<SecurityEventsPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [sinceHours, setSinceHours] = useState(24)
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null)

  const load = useCallback(async () => {
    try {
      const [slowRes, upRes, secRes] = await Promise.all([
        fetch(`/api/admin/slow-queries?since=${sinceHours}`),
        fetch(`/api/admin/uptime?since=${sinceHours}`),
        fetch(`/api/admin/security-events?since=${sinceHours}`),
      ])
      if (!slowRes.ok) throw new Error(`slow-queries HTTP ${slowRes.status}`)
      if (!upRes.ok) throw new Error(`uptime HTTP ${upRes.status}`)
      if (!secRes.ok) throw new Error(`security-events HTTP ${secRes.status}`)
      const slowJson: SlowQueriesPayload = await slowRes.json()
      const upJson: UptimePayload = await upRes.json()
      const secJson: SecurityEventsPayload = await secRes.json()
      setData(slowJson)
      setUptime(upJson)
      setSecurity(secJson)
      setError('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load health data')
    } finally {
      setLoading(false)
      setLastRefresh(new Date())
    }
  }, [sinceHours])

  useEffect(() => {
    load()
    const interval = setInterval(load, 30_000)
    return () => clearInterval(interval)
  }, [load])

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Platform Health</h1>
          <p className="text-gray-600 mt-2">
            Readiness, alerts, and slow-query diagnostics
            {lastRefresh && (
              <span className="text-gray-400 text-sm ml-2">
                · refreshed {lastRefresh.toLocaleTimeString()}
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <label className="text-sm text-gray-600">Window</label>
          <select
            value={sinceHours}
            onChange={(e) => setSinceHours(parseInt(e.target.value, 10))}
            className="border border-gray-300 rounded px-3 py-1.5 text-sm"
          >
            <option value={1}>Last 1 hour</option>
            <option value={6}>Last 6 hours</option>
            <option value={24}>Last 24 hours</option>
            <option value={72}>Last 3 days</option>
            <option value={168}>Last 7 days</option>
          </select>
          <button
            onClick={load}
            className="text-sm text-white bg-abel-navy hover:bg-abel-navy/90 px-3 py-1.5 rounded"
          >
            Refresh
          </button>
        </div>
      </div>

      {/* Uptime summary row */}
      <div className="card p-6">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h2 className="text-xl font-bold text-gray-900">Uptime</h2>
            <p className="text-sm text-gray-500 mt-1">
              Probed every 5 minutes by <span className="font-mono">/api/cron/uptime-probe</span>.
              {uptime?.note && <span className="text-amber-600"> {uptime.note}</span>}
            </p>
          </div>
          <div
            className={`text-xs font-semibold px-3 py-1 rounded-full ${
              uptime?.summary.latestStatus === 'ready'
                ? 'bg-green-100 text-green-800'
                : uptime?.summary.latestStatus === 'not_ready'
                ? 'bg-red-100 text-red-800'
                : 'bg-gray-100 text-gray-600'
            }`}
          >
            {uptime?.summary.latestStatus ?? 'unknown'}
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-gray-50 rounded p-4">
            <div className="text-xs text-gray-500 uppercase tracking-wider">Uptime</div>
            <div
              className={`text-3xl font-bold mt-1 ${
                (uptime?.summary.uptimePct ?? 0) >= 99.9
                  ? 'text-green-600'
                  : (uptime?.summary.uptimePct ?? 0) >= 99
                  ? 'text-amber-600'
                  : 'text-red-600'
              }`}
            >
              {uptime?.summary.uptimePct != null
                ? `${uptime.summary.uptimePct.toFixed(2)}%`
                : '—'}
            </div>
            <div className="text-xs text-gray-400 mt-1">
              {uptime?.summary.total ?? 0} probes
            </div>
          </div>
          <div className="bg-gray-50 rounded p-4">
            <div className="text-xs text-gray-500 uppercase tracking-wider">
              Failed probes
            </div>
            <div
              className={`text-3xl font-bold mt-1 ${
                (uptime?.summary.notReady ?? 0) === 0
                  ? 'text-green-600'
                  : 'text-red-600'
              }`}
            >
              {uptime?.summary.notReady ?? 0}
            </div>
            <div className="text-xs text-gray-400 mt-1">in window</div>
          </div>
          <div className="bg-gray-50 rounded p-4">
            <div className="text-xs text-gray-500 uppercase tracking-wider">
              Avg DB latency
            </div>
            <div className="text-3xl font-bold mt-1 text-gray-900">
              {uptime?.summary.avgDbMs != null ? `${uptime.summary.avgDbMs}ms` : '—'}
            </div>
            <div className="text-xs text-gray-400 mt-1">SELECT 1 round-trip</div>
          </div>
          <div className="bg-gray-50 rounded p-4">
            <div className="text-xs text-gray-500 uppercase tracking-wider">
              p95 DB latency
            </div>
            <div
              className={`text-3xl font-bold mt-1 ${
                (uptime?.summary.p95DbMs ?? 0) >= 500
                  ? 'text-red-600'
                  : (uptime?.summary.p95DbMs ?? 0) >= 200
                  ? 'text-amber-600'
                  : 'text-gray-900'
              }`}
            >
              {uptime?.summary.p95DbMs != null ? `${uptime.summary.p95DbMs}ms` : '—'}
            </div>
            <div className="text-xs text-gray-400 mt-1">95th percentile</div>
          </div>
        </div>

        {/* Bucket sparkline */}
        {uptime && uptime.buckets.length > 0 && (
          <div className="mt-6">
            <div className="text-xs text-gray-500 uppercase tracking-wider mb-2">
              Per-bucket uptime ({uptime.bucketHours}h buckets)
            </div>
            <div className="flex items-end gap-0.5 h-16">
              {uptime.buckets.map((b) => {
                const pct = b.total > 0 ? (b.ready / b.total) * 100 : 0
                const color =
                  pct >= 99.9
                    ? 'bg-green-500'
                    : pct >= 99
                    ? 'bg-amber-500'
                    : pct > 0
                    ? 'bg-red-500'
                    : 'bg-gray-300'
                return (
                  <div
                    key={b.bucketStart}
                    className={`flex-1 ${color} rounded-sm`}
                    style={{ height: `${Math.max(pct, 5)}%` }}
                    title={`${new Date(b.bucketStart).toLocaleString()} — ${pct.toFixed(1)}% (${b.ready}/${b.total})${b.avgDbMs != null ? ` · ${b.avgDbMs}ms avg` : ''}`}
                  />
                )
              })}
            </div>
          </div>
        )}
      </div>

      {/* Top row: SystemPulse + threshold banner */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1">
          <SystemPulse />
        </div>
        <div className="lg:col-span-2 card p-6 border border-gray-200 bg-white">
          <h2 className="text-base font-semibold text-gray-900">Slow query threshold</h2>
          <p className="text-xs text-gray-500 mt-1">
            Queries exceeding this duration are logged and persisted to{' '}
            <span className="font-mono">SlowQueryLog</span>.
          </p>
          <div className="mt-4 flex items-baseline gap-3">
            <span className="text-4xl font-bold text-abel-navy">
              {data?.thresholdMs ?? 500}
              <span className="text-xl font-normal text-gray-500 ml-1">ms</span>
            </span>
            <span className="text-sm text-gray-500">
              Override via <span className="font-mono">PRISMA_SLOW_QUERY_MS</span>
            </span>
          </div>
          <div className="mt-4 grid grid-cols-3 gap-3">
            <div className="bg-gray-50 rounded p-3">
              <div className="text-xs text-gray-500 uppercase tracking-wider">
                Events
              </div>
              <div className="text-2xl font-bold text-gray-900 mt-1">
                {data?.rows.length ?? 0}
              </div>
            </div>
            <div className="bg-gray-50 rounded p-3">
              <div className="text-xs text-gray-500 uppercase tracking-wider">
                Unique ops
              </div>
              <div className="text-2xl font-bold text-gray-900 mt-1">
                {data?.topOffenders.length ?? 0}
              </div>
            </div>
            <div className="bg-gray-50 rounded p-3">
              <div className="text-xs text-gray-500 uppercase tracking-wider">
                Window
              </div>
              <div className="text-2xl font-bold text-gray-900 mt-1">
                {sinceHours}h
              </div>
            </div>
          </div>
        </div>
      </div>

      {error && (
        <div className="card p-4 border border-red-200 bg-red-50 text-red-800 text-sm">
          {error}
        </div>
      )}

      {data?.note && (
        <div className="card p-4 border border-amber-200 bg-amber-50 text-amber-800 text-sm">
          {data.note}
        </div>
      )}

      {/* Top offenders */}
      <div className="card p-6">
        <h2 className="text-xl font-bold text-gray-900 mb-4">Top Offenders</h2>
        <p className="text-sm text-gray-500 mb-4">
          Grouped by model + operation, sorted by count. Start here when hunting
          N+1 patterns or missing indexes.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-gray-200">
              <tr className="text-gray-600 font-semibold">
                <th className="text-left py-3 px-4">Model</th>
                <th className="text-left py-3 px-4">Operation</th>
                <th className="text-right py-3 px-4">Count</th>
                <th className="text-right py-3 px-4">Avg</th>
                <th className="text-right py-3 px-4">Max</th>
              </tr>
            </thead>
            <tbody>
              {loading && !data ? (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-gray-400">
                    Loading…
                  </td>
                </tr>
              ) : !data || data.topOffenders.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-gray-500">
                    No slow queries in the selected window — 💨 flying.
                  </td>
                </tr>
              ) : (
                data.topOffenders.map((o, idx) => (
                  <tr
                    key={`${o.model}.${o.operation}`}
                    className={`border-b border-gray-100 hover:bg-gray-50 transition ${
                      idx === 0 ? 'bg-amber-50/40' : ''
                    }`}
                  >
                    <td className="py-3 px-4 font-mono text-xs">{o.model}</td>
                    <td className="py-3 px-4 font-mono text-xs text-gray-600">
                      {o.operation}
                    </td>
                    <td className="py-3 px-4 text-right font-semibold">
                      {o.count}
                    </td>
                    <td className={`py-3 px-4 text-right ${durationClass(o.avgMs)}`}>
                      {o.avgMs}ms
                    </td>
                    <td className={`py-3 px-4 text-right ${durationClass(o.maxMs)}`}>
                      {o.maxMs}ms
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Recent events */}
      <div className="card p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold text-gray-900">Recent Slow Queries</h2>
          <Link
            href="/admin/errors"
            className="text-sm text-abel-navy underline hover:no-underline"
          >
            View client errors →
          </Link>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-gray-200">
              <tr className="text-gray-600 font-semibold">
                <th className="text-left py-3 px-4">Time</th>
                <th className="text-left py-3 px-4">Model</th>
                <th className="text-left py-3 px-4">Operation</th>
                <th className="text-right py-3 px-4">Duration</th>
              </tr>
            </thead>
            <tbody>
              {loading && !data ? (
                <tr>
                  <td colSpan={4} className="py-8 text-center text-gray-400">
                    Loading…
                  </td>
                </tr>
              ) : !data || data.rows.length === 0 ? (
                <tr>
                  <td colSpan={4} className="py-8 text-center text-gray-500">
                    No events.
                  </td>
                </tr>
              ) : (
                data.rows.slice(0, 100).map((r) => (
                  <tr
                    key={r.id}
                    className="border-b border-gray-100 hover:bg-gray-50 transition"
                  >
                    <td className="py-3 px-4 text-gray-600 text-xs font-mono">
                      {formatTime(r.createdAt)}
                    </td>
                    <td className="py-3 px-4 font-mono text-xs">{r.model}</td>
                    <td className="py-3 px-4 font-mono text-xs text-gray-600">
                      {r.operation}
                    </td>
                    <td className={`py-3 px-4 text-right ${durationClass(r.durationMs)}`}>
                      {r.durationMs}ms
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Security events */}
      <div className="card p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold text-gray-900">Security Events</h2>
          <span className="text-xs text-gray-500">
            {security?.total ?? 0} events in window
          </span>
        </div>
        <p className="text-sm text-gray-500 mb-4">
          Rate-limit rejections and security-relevant events. Fire-and-forget
          writes from route handlers — expect some undercount during traffic spikes.
          {security?.note && (
            <span className="text-amber-600 block mt-1">{security.note}</span>
          )}
        </p>

        {security && security.kindCounts.length > 0 && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
            {security.kindCounts.map((k) => (
              <div key={k.kind} className="bg-gray-50 rounded p-3">
                <div className="text-xs text-gray-500 uppercase tracking-wider">
                  {k.kind.replace('_', ' ')}
                </div>
                <div
                  className={`text-2xl font-bold mt-1 ${
                    k.kind === 'RATE_LIMIT'
                      ? 'text-amber-600'
                      : k.kind === 'CSRF'
                      ? 'text-red-600'
                      : k.kind === 'AUTH_FAIL'
                      ? 'text-rose-600'
                      : 'text-gray-900'
                  }`}
                >
                  {k.count}
                </div>
              </div>
            ))}
          </div>
        )}

        {security && security.buckets && security.buckets.length > 0 && (
          <div className="mb-6">
            <div className="flex items-center justify-between mb-2">
              <div className="text-xs text-gray-500 uppercase tracking-wider font-semibold">
                Events over time
                {security.bucketMinutes
                  ? ` (${security.bucketMinutes}m buckets)`
                  : ''}
              </div>
              <div className="flex items-center gap-3 text-[11px] text-gray-500">
                <span className="flex items-center gap-1">
                  <span className="inline-block w-2 h-2 bg-amber-500 rounded-sm" />
                  rate limit
                </span>
                <span className="flex items-center gap-1">
                  <span className="inline-block w-2 h-2 bg-rose-500 rounded-sm" />
                  auth fail
                </span>
                <span className="flex items-center gap-1">
                  <span className="inline-block w-2 h-2 bg-red-600 rounded-sm" />
                  csrf
                </span>
              </div>
            </div>
            {(() => {
              const maxCount = Math.max(
                1,
                ...security.buckets.map((b) => b.total)
              )
              return (
                <div className="flex items-end gap-[2px] h-20 bg-gray-50 rounded p-2">
                  {security.buckets.map((b) => {
                    const totalHeight = (b.total / maxCount) * 100
                    const rateH = b.total > 0 ? (b.RATE_LIMIT / b.total) * totalHeight : 0
                    const authH = b.total > 0 ? (b.AUTH_FAIL / b.total) * totalHeight : 0
                    const csrfH = b.total > 0 ? (b.CSRF / b.total) * totalHeight : 0
                    const susH = b.total > 0 ? (b.SUSPICIOUS / b.total) * totalHeight : 0
                    return (
                      <div
                        key={b.bucketStart}
                        className="flex-1 flex flex-col-reverse justify-start min-w-0"
                        title={`${new Date(b.bucketStart).toLocaleString()}\nrate limit: ${b.RATE_LIMIT}\nauth fail: ${b.AUTH_FAIL}\ncsrf: ${b.CSRF}\nsuspicious: ${b.SUSPICIOUS}`}
                      >
                        {rateH > 0 && (
                          <div
                            className="bg-amber-500 w-full"
                            style={{ height: `${rateH}%` }}
                          />
                        )}
                        {authH > 0 && (
                          <div
                            className="bg-rose-500 w-full"
                            style={{ height: `${authH}%` }}
                          />
                        )}
                        {csrfH > 0 && (
                          <div
                            className="bg-red-600 w-full"
                            style={{ height: `${csrfH}%` }}
                          />
                        )}
                        {susH > 0 && (
                          <div
                            className="bg-gray-500 w-full"
                            style={{ height: `${susH}%` }}
                          />
                        )}
                      </div>
                    )
                  })}
                </div>
              )
            })()}
          </div>
        )}

        {security && (security.topIps.length > 0 || security.topPaths.length > 0) && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
            <div>
              <div className="text-xs text-gray-500 uppercase tracking-wider font-semibold mb-2">
                Top offending IPs
              </div>
              <div className="space-y-1">
                {security.topIps.length === 0 ? (
                  <div className="text-xs text-gray-400">None</div>
                ) : (
                  security.topIps.map((i) => (
                    <div
                      key={i.ip}
                      className="flex items-center justify-between text-xs border-b border-gray-100 py-1.5"
                    >
                      <span className="font-mono text-gray-700">{i.ip}</span>
                      <span className="font-semibold text-gray-900">{i.count}</span>
                    </div>
                  ))
                )}
              </div>
            </div>
            <div>
              <div className="text-xs text-gray-500 uppercase tracking-wider font-semibold mb-2">
                Top offending paths
              </div>
              <div className="space-y-1">
                {security.topPaths.length === 0 ? (
                  <div className="text-xs text-gray-400">None</div>
                ) : (
                  security.topPaths.map((p) => (
                    <div
                      key={p.path}
                      className="flex items-center justify-between text-xs border-b border-gray-100 py-1.5"
                    >
                      <span className="font-mono text-gray-700 truncate pr-2">
                        {p.path}
                      </span>
                      <span className="font-semibold text-gray-900">{p.count}</span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-gray-200">
              <tr className="text-gray-600 font-semibold">
                <th className="text-left py-3 px-4">Time</th>
                <th className="text-left py-3 px-4">Kind</th>
                <th className="text-left py-3 px-4">Method</th>
                <th className="text-left py-3 px-4">Path</th>
                <th className="text-left py-3 px-4">IP</th>
              </tr>
            </thead>
            <tbody>
              {loading && !security ? (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-gray-400">
                    Loading…
                  </td>
                </tr>
              ) : !security || security.rows.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-gray-500">
                    No security events — all quiet.
                  </td>
                </tr>
              ) : (
                security.rows.slice(0, 50).map((r) => (
                  <tr
                    key={r.id}
                    className="border-b border-gray-100 hover:bg-gray-50 transition"
                  >
                    <td className="py-3 px-4 text-gray-600 text-xs font-mono">
                      {formatTime(r.createdAt)}
                    </td>
                    <td className="py-3 px-4">
                      <span
                        className={`inline-block px-2 py-0.5 rounded text-xs font-semibold ${
                          r.kind === 'RATE_LIMIT'
                            ? 'bg-amber-100 text-amber-800'
                            : r.kind === 'CSRF'
                            ? 'bg-red-100 text-red-800'
                            : 'bg-gray-100 text-gray-700'
                        }`}
                      >
                        {r.kind}
                      </span>
                    </td>
                    <td className="py-3 px-4 font-mono text-xs">
                      {r.method || '—'}
                    </td>
                    <td className="py-3 px-4 font-mono text-xs text-gray-600 truncate max-w-xs">
                      {r.path || '—'}
                    </td>
                    <td className="py-3 px-4 font-mono text-xs text-gray-600">
                      {r.ip || '—'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
