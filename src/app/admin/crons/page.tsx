'use client'

import { useEffect, useState, useCallback } from 'react'

interface CronSummary {
  name: string
  schedule: string
  lastRunAt: string | null
  lastStatus: 'RUNNING' | 'SUCCESS' | 'FAILURE' | null
  lastDurationMs: number | null
  lastError: string | null
  successCount24h: number
  failureCount24h: number
}

interface CronRun {
  id: string
  name: string
  status: 'RUNNING' | 'SUCCESS' | 'FAILURE'
  startedAt: string
  finishedAt: string | null
  durationMs: number | null
  error: string | null
  triggeredBy: string | null
}

interface CronDrift {
  orphaned: Array<{ name: string; lastRunAt: string | null; runs24h: number }>
  neverRun: Array<{ name: string; schedule: string }>
  stale: Array<{
    name: string
    schedule: string
    lastRunAt: string
    minutesSinceLastRun: number
    expectedMaxGapMinutes: number
  }>
}

function fmtMinutes(mins: number): string {
  if (mins < 60) return `${mins}m`
  if (mins < 1440) return `${Math.round(mins / 60)}h`
  return `${Math.round(mins / 1440)}d`
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  try {
    const d = new Date(iso)
    const now = Date.now()
    const diffMs = now - d.getTime()
    const diffMin = Math.floor(diffMs / 60000)
    if (diffMin < 1) return 'just now'
    if (diffMin < 60) return `${diffMin}m ago`
    if (diffMin < 1440) return `${Math.floor(diffMin / 60)}h ago`
    return d.toLocaleString()
  } catch {
    return iso
  }
}

function fmtDuration(ms: number | null): string {
  if (ms == null) return '—'
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  return `${(ms / 60_000).toFixed(1)}m`
}

function statusBadge(status: string | null): JSX.Element {
  if (status === 'SUCCESS')
    return <span className="inline-flex px-2 py-0.5 text-xs font-medium rounded bg-green-100 text-green-800">SUCCESS</span>
  if (status === 'FAILURE')
    return <span className="inline-flex px-2 py-0.5 text-xs font-medium rounded bg-red-100 text-red-800">FAILURE</span>
  if (status === 'RUNNING')
    return <span className="inline-flex px-2 py-0.5 text-xs font-medium rounded bg-blue-100 text-blue-800">RUNNING</span>
  return <span className="inline-flex px-2 py-0.5 text-xs font-medium rounded bg-gray-100 text-gray-600">NEVER RUN</span>
}

export default function CronsPage() {
  const [crons, setCrons] = useState<CronSummary[]>([])
  const [drift, setDrift] = useState<CronDrift | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [runs, setRuns] = useState<CronRun[]>([])
  const [loading, setLoading] = useState(true)
  const [runsLoading, setRunsLoading] = useState(false)
  const [error, setError] = useState('')

  const loadSummary = useCallback(async () => {
    try {
      setLoading(true)
      const res = await fetch('/api/admin/crons', { cache: 'no-store' })
      if (!res.ok) throw new Error(`Failed: ${res.status}`)
      const data = await res.json()
      setCrons(data.crons || [])
      setDrift(data.drift || null)
      setError('')
    } catch (e: any) {
      setError(e?.message || 'Failed to load crons')
    } finally {
      setLoading(false)
    }
  }, [])

  const loadRuns = useCallback(async (name: string) => {
    try {
      setRunsLoading(true)
      const res = await fetch(`/api/admin/crons?name=${encodeURIComponent(name)}&limit=25`, { cache: 'no-store' })
      if (!res.ok) throw new Error(`Failed: ${res.status}`)
      const data = await res.json()
      setRuns(data.runs || [])
    } catch (e: any) {
      setRuns([])
    } finally {
      setRunsLoading(false)
    }
  }, [])

  useEffect(() => {
    loadSummary()
    const t = setInterval(loadSummary, 30_000)
    return () => clearInterval(t)
  }, [loadSummary])

  useEffect(() => {
    if (selected) loadRuns(selected)
  }, [selected, loadRuns])

  const totalFailures24h = crons.reduce((s, c) => s + (c.failureCount24h || 0), 0)
  const totalSuccess24h = crons.reduce((s, c) => s + (c.successCount24h || 0), 0)
  const neverRan = crons.filter(c => !c.lastStatus).length

  return (
    <div className="max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Cron Jobs</h1>
          <p className="text-sm text-gray-500 mt-1">
            Scheduled jobs observability. Auto-refreshes every 30s.
          </p>
        </div>
        <button
          onClick={loadSummary}
          className="px-4 py-2 bg-abel-navy text-white rounded hover:bg-abel-navy/90 text-sm font-medium"
        >
          Refresh
        </button>
      </div>

      {error && (
        <div className="mb-4 p-3 rounded bg-red-50 border border-red-200 text-red-700 text-sm">
          {error}
        </div>
      )}

      {/* Drift banner — only shows when REGISTERED_CRONS disagrees with reality */}
      {drift && (drift.orphaned.length > 0 || drift.neverRun.length > 0 || drift.stale.length > 0) && (
        <div className="mb-4 p-4 rounded-lg bg-amber-50 border border-amber-300 text-amber-900 text-sm">
          <div className="font-semibold mb-2">⚠️ Cron registration drift detected</div>
          {drift.stale.length > 0 && (
            <div className="mb-2">
              <div className="font-medium text-red-800">
                Stopped firing (stale past expected cadence):
              </div>
              <ul className="mt-1 ml-4 list-disc">
                {drift.stale.map((s) => (
                  <li key={s.name}>
                    <code className="font-mono text-xs bg-red-100 px-1 py-0.5 rounded">
                      {s.name}
                    </code>{' '}
                    <span className="text-red-700">
                      — last ran {fmtMinutes(s.minutesSinceLastRun)} ago (expected every ≤
                      {fmtMinutes(s.expectedMaxGapMinutes)})
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {drift.orphaned.length > 0 && (
            <div className="mb-2">
              <div className="font-medium">
                Firing but not registered in src/lib/cron.ts:
              </div>
              <ul className="mt-1 ml-4 list-disc">
                {drift.orphaned.map((o) => (
                  <li key={o.name}>
                    <code className="font-mono text-xs bg-amber-100 px-1 py-0.5 rounded">
                      {o.name}
                    </code>{' '}
                    <span className="text-amber-700">
                      — {o.runs24h} run{o.runs24h === 1 ? '' : 's'} in 24h, last{' '}
                      {fmtDate(o.lastRunAt)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {drift.neverRun.length > 0 && (
            <div>
              <div className="font-medium">
                Registered but never executed (check vercel.json):
              </div>
              <ul className="mt-1 ml-4 list-disc">
                {drift.neverRun.map((n) => (
                  <li key={n.name}>
                    <code className="font-mono text-xs bg-amber-100 px-1 py-0.5 rounded">
                      {n.name}
                    </code>{' '}
                    <span className="text-amber-700 font-mono text-xs">
                      {n.schedule}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <div className="text-xs uppercase text-gray-500 font-semibold">Registered</div>
          <div className="text-3xl font-bold text-gray-900 mt-1">{crons.length}</div>
        </div>
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <div className="text-xs uppercase text-gray-500 font-semibold">Success 24h</div>
          <div className="text-3xl font-bold text-green-700 mt-1">{totalSuccess24h}</div>
        </div>
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <div className="text-xs uppercase text-gray-500 font-semibold">Failures 24h</div>
          <div className={`text-3xl font-bold mt-1 ${totalFailures24h > 0 ? 'text-red-700' : 'text-gray-400'}`}>
            {totalFailures24h}
          </div>
        </div>
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <div className="text-xs uppercase text-gray-500 font-semibold">Never Run</div>
          <div className={`text-3xl font-bold mt-1 ${neverRan > 0 ? 'text-amber-600' : 'text-gray-400'}`}>
            {neverRan}
          </div>
        </div>
      </div>

      {/* Main table */}
      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Name</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Schedule</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Last Status</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Last Run</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Duration</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">24h S/F</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Error</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {loading && crons.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-gray-500">Loading...</td>
              </tr>
            )}
            {crons.map((c) => (
              <tr
                key={c.name}
                className={`cursor-pointer hover:bg-gray-50 ${selected === c.name ? 'bg-blue-50' : ''}`}
                onClick={() => setSelected(c.name)}
              >
                <td className="px-4 py-3 text-sm font-medium text-gray-900">{c.name}</td>
                <td className="px-4 py-3 text-sm text-gray-600 font-mono">{c.schedule}</td>
                <td className="px-4 py-3">{statusBadge(c.lastStatus)}</td>
                <td className="px-4 py-3 text-sm text-gray-600">{fmtDate(c.lastRunAt)}</td>
                <td className="px-4 py-3 text-sm text-gray-600">{fmtDuration(c.lastDurationMs)}</td>
                <td className="px-4 py-3 text-sm">
                  <span className="text-green-700">{c.successCount24h}</span>
                  {' / '}
                  <span className={c.failureCount24h > 0 ? 'text-red-700 font-semibold' : 'text-gray-500'}>
                    {c.failureCount24h}
                  </span>
                </td>
                <td className="px-4 py-3 text-xs text-red-700 max-w-xs truncate" title={c.lastError || ''}>
                  {c.lastError || ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Run history drawer */}
      {selected && (
        <div className="mt-6 bg-white border border-gray-200 rounded-lg overflow-hidden">
          <div className="px-4 py-3 bg-gray-50 border-b border-gray-200 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-900">
              Recent runs: <span className="font-mono">{selected}</span>
            </h2>
            <button
              onClick={() => setSelected(null)}
              className="text-gray-400 hover:text-gray-600 text-sm"
            >
              Close
            </button>
          </div>
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600 uppercase">Started</th>
                <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600 uppercase">Status</th>
                <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600 uppercase">Duration</th>
                <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600 uppercase">Triggered By</th>
                <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600 uppercase">Error</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {runsLoading && (
                <tr><td colSpan={5} className="px-4 py-4 text-center text-gray-500 text-sm">Loading runs...</td></tr>
              )}
              {!runsLoading && runs.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-4 text-center text-gray-500 text-sm">No runs recorded yet.</td></tr>
              )}
              {runs.map((r) => (
                <tr key={r.id}>
                  <td className="px-4 py-2 text-sm text-gray-600">{fmtDate(r.startedAt)}</td>
                  <td className="px-4 py-2">{statusBadge(r.status)}</td>
                  <td className="px-4 py-2 text-sm text-gray-600">{fmtDuration(r.durationMs)}</td>
                  <td className="px-4 py-2 text-sm text-gray-600">{r.triggeredBy || 'schedule'}</td>
                  <td className="px-4 py-2 text-xs text-red-700 max-w-md truncate" title={r.error || ''}>
                    {r.error || ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
