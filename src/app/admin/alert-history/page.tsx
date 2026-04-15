'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'

// ──────────────────────────────────────────────────────────────────────────
// /admin/alert-history — "when did each alert fire and how long for?"
//
// The live SystemPulse shows current alerts but can't answer "client-errors
// fired THREE times last week — what's going on?" This page reads the
// AlertIncident table via /api/admin/alert-history and surfaces two views:
//
//   1. Per-alert rollup (7-day default): totals, open vs. closed, worst
//      severity, most recent fire. Sort key: how often the alert fired.
//
//   2. Timeline (24h default): reverse-chronological fire→clear incidents
//      with duration, peak count, and severity ribbon.
//
// Open incidents are rendered with a pulsing indicator so they stand out
// from historical rows.
// ──────────────────────────────────────────────────────────────────────────

type Severity = 'critical' | 'warning' | 'info' | 'success'

interface AlertIncidentRow {
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

interface AlertRollupRow {
  alertId: string
  title: string
  incidents: number
  openIncidents: number
  totalSeconds: number
  maxPeakCount: number
  worstSeverity: Severity
  mostRecent: string
}

interface Payload {
  sinceHours: number
  rollupHours: number
  limit: number
  openCount: number
  incidents: AlertIncidentRow[]
  rollups: AlertRollupRow[]
}

const SEVERITY_CLASSES: Record<Severity, { bar: string; chip: string }> = {
  critical: {
    bar: 'bg-rose-500',
    chip: 'bg-rose-100 text-rose-800 border-rose-300',
  },
  warning: {
    bar: 'bg-amber-500',
    chip: 'bg-amber-100 text-amber-800 border-amber-300',
  },
  info: {
    bar: 'bg-blue-500',
    chip: 'bg-blue-100 text-blue-800 border-blue-300',
  },
  success: {
    bar: 'bg-green-500',
    chip: 'bg-green-100 text-green-800 border-green-300',
  },
}

function fmtDuration(seconds: number | null): string {
  if (seconds == null) return '—'
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`
  if (seconds < 86400) {
    const h = Math.floor(seconds / 3600)
    const m = Math.floor((seconds % 3600) / 60)
    return `${h}h ${m}m`
  }
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  return `${d}d ${h}h`
}

function fmtRelTime(iso: string): string {
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

function fmtAbsDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString([], {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return iso
  }
}

export default function AlertHistoryPage() {
  const [data, setData] = useState<Payload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [sinceHours, setSinceHours] = useState(24)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      params.set('since', String(sinceHours))
      const res = await fetch(`/api/admin/alert-history?${params.toString()}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const payload = (await res.json()) as Payload
      setData(payload)
    } catch (e: any) {
      setError(e?.message || 'Failed to load')
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [sinceHours])

  useEffect(() => {
    load()
  }, [load])

  return (
    <div className="p-6 max-w-[1400px] mx-auto space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Alert History</h1>
          <p className="text-sm text-gray-600 mt-1">
            Fire / clear log for every alert computed by{' '}
            <span className="font-mono">/api/ops/system-alerts</span>.
            {data && (
              <span className="ml-2 text-gray-500">
                {data.openCount} currently firing
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
            <option value={720}>Last 30 days</option>
          </select>
          <Link
            href="/admin/timeline"
            className="text-sm text-abel-navy hover:text-abel-navy/80 font-medium px-3 py-1.5 border border-abel-navy/30 rounded hover:bg-abel-navy/5"
          >
            Timeline →
          </Link>
          <button
            onClick={load}
            disabled={loading}
            className="px-3 py-1.5 text-sm text-white bg-abel-navy rounded hover:bg-abel-navy/90 disabled:opacity-50"
          >
            {loading ? 'Loading…' : 'Refresh'}
          </button>
        </div>
      </div>

      {error && (
        <div className="p-3 bg-rose-50 border border-rose-200 rounded text-sm text-rose-800">
          {error}
        </div>
      )}

      {/* Rollup table — the "recurring offenders" view */}
      <div className="card p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-xl font-bold text-gray-900">Top Offenders</h2>
            <p className="text-sm text-gray-500 mt-1">
              Grouped by alert type over the last{' '}
              {data ? data.rollupHours / 24 : 7} days — sorted by fire count.
              Use this to spot alerts that flap repeatedly.
            </p>
          </div>
        </div>
        {data && data.rollups.length === 0 ? (
          <div className="py-8 text-center text-gray-500 text-sm">
            No alert incidents recorded in the rollup window.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-gray-200">
                <tr className="text-gray-600 font-semibold text-left">
                  <th className="py-2 pr-3">Alert</th>
                  <th className="py-2 pr-3">Fires</th>
                  <th className="py-2 pr-3">Open</th>
                  <th className="py-2 pr-3">Worst</th>
                  <th className="py-2 pr-3">Max count</th>
                  <th className="py-2 pr-3">Total time firing</th>
                  <th className="py-2 pr-3">Most recent</th>
                </tr>
              </thead>
              <tbody>
                {data?.rollups.map((r) => {
                  const sev = SEVERITY_CLASSES[r.worstSeverity]
                  return (
                    <tr
                      key={r.alertId}
                      className="border-b border-gray-100 hover:bg-gray-50"
                    >
                      <td className="py-2 pr-3">
                        <div className="font-medium text-gray-900">{r.title}</div>
                        <div className="text-xs text-gray-400 font-mono">
                          {r.alertId}
                        </div>
                      </td>
                      <td className="py-2 pr-3 font-semibold text-gray-900">
                        {r.incidents}
                      </td>
                      <td className="py-2 pr-3">
                        {r.openIncidents > 0 ? (
                          <span className="inline-flex items-center gap-1 text-rose-700 font-semibold">
                            <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse" />
                            {r.openIncidents}
                          </span>
                        ) : (
                          <span className="text-gray-400">—</span>
                        )}
                      </td>
                      <td className="py-2 pr-3">
                        <span
                          className={`inline-block px-2 py-0.5 text-[10px] font-semibold rounded border ${sev.chip}`}
                        >
                          {r.worstSeverity}
                        </span>
                      </td>
                      <td className="py-2 pr-3 text-gray-700">
                        {r.maxPeakCount}
                      </td>
                      <td className="py-2 pr-3 text-gray-700">
                        {fmtDuration(r.totalSeconds)}
                      </td>
                      <td className="py-2 pr-3 text-gray-500 text-xs">
                        {fmtRelTime(r.mostRecent)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Incident timeline — one row per fire→clear window */}
      <div className="card p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-xl font-bold text-gray-900">
              Incident Timeline
            </h2>
            <p className="text-sm text-gray-500 mt-1">
              Every fire/clear cycle in the last {sinceHours}h, newest first.
              Open incidents are still firing right now.
            </p>
          </div>
        </div>
        {data && data.incidents.length === 0 ? (
          <div className="py-12 text-center">
            <div className="text-3xl mb-2">✓</div>
            <div className="text-gray-900 font-semibold">No incidents</div>
            <div className="text-sm text-gray-500 mt-1">
              Nothing fired in the selected window.
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            {data?.incidents.map((inc) => {
              const sev = SEVERITY_CLASSES[inc.peakSeverity]
              const isOpen = inc.endedAt === null
              return (
                <div
                  key={inc.id}
                  className={`flex items-stretch rounded-lg border overflow-hidden ${
                    isOpen
                      ? 'border-rose-300 bg-rose-50/40'
                      : 'border-gray-200 bg-white'
                  }`}
                >
                  <div className={`w-1 ${sev.bar}`} />
                  <div className="flex-1 p-3">
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span
                            className={`inline-block px-2 py-0.5 text-[10px] font-semibold rounded border ${sev.chip}`}
                          >
                            {inc.peakSeverity}
                          </span>
                          {isOpen && (
                            <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-rose-700">
                              <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse" />
                              FIRING
                            </span>
                          )}
                          <span className="font-semibold text-gray-900">
                            {inc.title}
                          </span>
                        </div>
                        {inc.description && (
                          <div className="mt-1 text-xs text-gray-600">
                            {inc.description}
                          </div>
                        )}
                        <div className="mt-1 text-xs text-gray-500">
                          Started {fmtAbsDate(inc.startedAt)} ·{' '}
                          {isOpen
                            ? `firing for ${fmtDuration(inc.durationSeconds)}`
                            : `ran ${fmtDuration(inc.durationSeconds)} and cleared`}
                          {' · '}
                          {inc.tickCount} tick{inc.tickCount === 1 ? '' : 's'}
                        </div>
                      </div>
                      <div className="shrink-0 flex items-center gap-4">
                        <div className="text-right">
                          <div className="text-[10px] text-gray-500 uppercase tracking-wide">
                            Peak
                          </div>
                          <div className="font-mono font-bold text-gray-900">
                            {inc.peakCount}
                          </div>
                        </div>
                        {inc.href && (
                          <Link
                            href={inc.href}
                            className="text-xs text-blue-600 hover:text-blue-800 font-medium"
                          >
                            Open →
                          </Link>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
