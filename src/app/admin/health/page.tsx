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
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [sinceHours, setSinceHours] = useState(24)
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/slow-queries?since=${sinceHours}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json: SlowQueriesPayload = await res.json()
      setData(json)
      setError('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load slow queries')
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
    </div>
  )
}
