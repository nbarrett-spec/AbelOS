'use client'

import { useEffect, useState, useCallback } from 'react'
import PageHeader from '@/components/ui/PageHeader'
import EmptyState from '@/components/ui/EmptyState'
import { Settings } from 'lucide-react'

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

type StatusFilter = 'all' | 'failed' | 'success' | 'never' | 'running'

export default function CronsPage() {
  const [crons, setCrons] = useState<CronSummary[]>([])
  const [drift, setDrift] = useState<CronDrift | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [runs, setRuns] = useState<CronRun[]>([])
  const [loading, setLoading] = useState(true)
  const [runsLoading, setRunsLoading] = useState(false)
  const [error, setError] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [nameQuery, setNameQuery] = useState('')
  const [triggering, setTriggering] = useState<string | null>(null)
  const [triggerMsg, setTriggerMsg] = useState<{ name: string; ok: boolean; text: string } | null>(null)

  const loadSummary = useCallback(async () => {
    try {
      setLoading(true)
      const res = await fetch('/api/ops/admin/crons', { cache: 'no-store' })
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
      const res = await fetch(`/api/ops/admin/crons?name=${encodeURIComponent(name)}&limit=25`, { cache: 'no-store' })
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

  // Derived: filtered list. Status filter narrows by lastStatus; nameQuery
  // is a case-insensitive substring on name + schedule. Both compose; "all"
  // status + empty query = full list.
  const filteredCrons = crons.filter((c) => {
    if (statusFilter === 'failed' && c.lastStatus !== 'FAILURE') return false
    if (statusFilter === 'success' && c.lastStatus !== 'SUCCESS') return false
    if (statusFilter === 'running' && c.lastStatus !== 'RUNNING') return false
    if (statusFilter === 'never' && c.lastStatus) return false
    if (nameQuery.trim()) {
      const q = nameQuery.trim().toLowerCase()
      if (!c.name.toLowerCase().includes(q) && !c.schedule.toLowerCase().includes(q)) {
        return false
      }
    }
    return true
  })

  const triggerCron = useCallback(async (name: string) => {
    if (triggering) return // single-flight per click
    if (!confirm(`Run "${name}" now? This executes the same handler as the scheduler — money-touching crons (collections, auto-reorder, financial-snapshot) will write real rows.`)) {
      return
    }
    setTriggering(name)
    setTriggerMsg(null)
    try {
      const res = await fetch('/api/ops/admin/crons', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok && data.ok) {
        setTriggerMsg({ name, ok: true, text: `Triggered "${name}" — upstream ${data.status}` })
        // Refresh both summary and (if open) the run drawer for this cron.
        loadSummary()
        if (selected === name) loadRuns(name)
      } else {
        setTriggerMsg({
          name,
          ok: false,
          text: data?.error || data?.result?.error || `Trigger failed (HTTP ${res.status})`,
        })
      }
    } catch (e: any) {
      setTriggerMsg({ name, ok: false, text: e?.message || 'Trigger request failed' })
    } finally {
      setTriggering(null)
    }
  }, [triggering, selected, loadSummary, loadRuns])

  return (
    <div className="max-w-7xl mx-auto">
      <PageHeader
        title="Cron Jobs"
        description="Scheduled jobs observability. Auto-refreshes every 30s."
        crumbs={[
          { label: 'Ops', href: '/ops' },
          { label: 'Admin', href: '/ops/admin' },
          { label: 'Crons' },
        ]}
        actions={
          <button
            onClick={loadSummary}
            className="px-4 py-2 bg-brand text-fg-on-accent rounded hover:bg-brand/90 text-sm font-medium"
          >
            Refresh
          </button>
        }
      />

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
        <div className="bg-surface border border-border rounded-lg p-4">
          <div className="text-xs uppercase text-fg-muted font-semibold">Registered</div>
          <div className="text-3xl font-semibold text-fg mt-1">{crons.length}</div>
        </div>
        <div className="bg-surface border border-border rounded-lg p-4">
          <div className="text-xs uppercase text-fg-muted font-semibold">Success 24h</div>
          <div className="text-3xl font-semibold text-green-700 mt-1">{totalSuccess24h}</div>
        </div>
        <div className="bg-surface border border-border rounded-lg p-4">
          <div className="text-xs uppercase text-fg-muted font-semibold">Failures 24h</div>
          <div className={`text-3xl font-semibold mt-1 ${totalFailures24h > 0 ? 'text-red-700' : 'text-fg-subtle'}`}>
            {totalFailures24h}
          </div>
        </div>
        <div className="bg-surface border border-border rounded-lg p-4">
          <div className="text-xs uppercase text-fg-muted font-semibold">Never Run</div>
          <div className={`text-3xl font-semibold mt-1 ${neverRan > 0 ? 'text-signal' : 'text-fg-subtle'}`}>
            {neverRan}
          </div>
        </div>
      </div>

      {/* Filter row */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input
          type="text"
          placeholder="Search by name or schedule..."
          value={nameQuery}
          onChange={(e) => setNameQuery(e.target.value)}
          className="px-3 py-2 text-sm border border-border rounded bg-surface text-fg w-64 focus:outline-none focus:ring-2 focus:ring-brand"
        />
        <div className="flex items-center gap-1 text-sm">
          <span className="text-fg-muted mr-1">Status:</span>
          {(['all', 'failed', 'success', 'running', 'never'] as StatusFilter[]).map((f) => (
            <button
              key={f}
              onClick={() => setStatusFilter(f)}
              className={`px-2.5 py-1 text-xs rounded font-medium transition-colors ${
                statusFilter === f
                  ? 'bg-brand text-fg-on-accent'
                  : 'bg-surface-muted text-fg-muted hover:bg-row-hover'
              }`}
            >
              {f === 'all' ? `All (${crons.length})`
               : f === 'failed' ? `Failed (${crons.filter(c => c.lastStatus === 'FAILURE').length})`
               : f === 'success' ? `Success (${crons.filter(c => c.lastStatus === 'SUCCESS').length})`
               : f === 'running' ? `Running (${crons.filter(c => c.lastStatus === 'RUNNING').length})`
               : `Never (${neverRan})`}
            </button>
          ))}
        </div>
        <div className="ml-auto text-xs text-fg-muted">
          Showing {filteredCrons.length} of {crons.length}
        </div>
      </div>

      {/* Trigger result toast */}
      {triggerMsg && (
        <div
          className={`mb-4 p-3 rounded text-sm border ${
            triggerMsg.ok
              ? 'bg-green-50 border-green-200 text-green-800'
              : 'bg-red-50 border-red-200 text-red-800'
          }`}
        >
          <span className="font-medium">{triggerMsg.name}:</span> {triggerMsg.text}
          <button
            onClick={() => setTriggerMsg(null)}
            className="ml-3 underline hover:no-underline text-xs"
          >
            dismiss
          </button>
        </div>
      )}

      {/* Main table */}
      <div className="bg-surface border border-border rounded-lg overflow-hidden">
        {!loading && crons.length === 0 ? (
          <EmptyState
            icon={<Settings className="w-8 h-8 text-fg-subtle" />}
            title="No cron jobs registered"
            description="Scheduled jobs will appear here once they're registered."
          />
        ) : (
        <table className="min-w-full divide-y divide-border">
          <thead className="bg-surface-muted">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-semibold text-fg-muted uppercase">Name</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-fg-muted uppercase">Schedule</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-fg-muted uppercase">Last Status</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-fg-muted uppercase">Last Run</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-fg-muted uppercase">Duration</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-fg-muted uppercase">24h S/F</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-fg-muted uppercase">Error</th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-fg-muted uppercase">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {loading && crons.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-fg-muted">Loading...</td>
              </tr>
            )}
            {!loading && filteredCrons.length === 0 && crons.length > 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-fg-muted text-sm">
                  No crons match the current filter.
                </td>
              </tr>
            )}
            {filteredCrons.map((c) => (
              <tr
                key={c.name}
                className={`cursor-pointer hover:bg-row-hover ${selected === c.name ? 'bg-signal-subtle' : ''} ${c.lastStatus === 'FAILURE' ? 'bg-red-50/40' : ''}`}
                onClick={() => setSelected(c.name)}
              >
                <td className="px-4 py-3 text-sm font-medium text-fg">{c.name}</td>
                <td className="px-4 py-3 text-sm text-fg-muted font-mono">{c.schedule}</td>
                <td className="px-4 py-3">{statusBadge(c.lastStatus)}</td>
                <td className="px-4 py-3 text-sm text-fg-muted">{fmtDate(c.lastRunAt)}</td>
                <td className="px-4 py-3 text-sm text-fg-muted">{fmtDuration(c.lastDurationMs)}</td>
                <td className="px-4 py-3 text-sm">
                  <span className="text-green-700">{c.successCount24h}</span>
                  {' / '}
                  <span className={c.failureCount24h > 0 ? 'text-red-700 font-semibold' : 'text-fg-muted'}>
                    {c.failureCount24h}
                  </span>
                </td>
                <td className="px-4 py-3 text-xs text-red-700 max-w-xs truncate" title={c.lastError || ''}>
                  {c.lastError || ''}
                </td>
                <td className="px-4 py-3 text-right">
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      triggerCron(c.name)
                    }}
                    disabled={triggering === c.name}
                    className="px-2.5 py-1 text-xs font-medium rounded bg-brand text-fg-on-accent hover:bg-brand/90 disabled:opacity-50 disabled:cursor-not-allowed"
                    title={`Manually trigger ${c.name} (ADMIN only)`}
                  >
                    {triggering === c.name ? 'Running...' : 'Run now'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        )}
      </div>

      {/* Run history drawer */}
      {selected && (
        <div className="mt-6 bg-surface border border-border rounded-lg overflow-hidden">
          <div className="px-4 py-3 bg-surface-muted border-b border-border flex items-center justify-between">
            <h2 className="text-sm font-semibold text-fg">
              Recent runs: <span className="font-mono">{selected}</span>
            </h2>
            <button
              onClick={() => setSelected(null)}
              className="text-fg-subtle hover:text-fg-muted text-sm"
            >
              Close
            </button>
          </div>
          <table className="min-w-full divide-y divide-border">
            <thead className="bg-surface-muted">
              <tr>
                <th className="px-4 py-2 text-left text-xs font-semibold text-fg-muted uppercase">Started</th>
                <th className="px-4 py-2 text-left text-xs font-semibold text-fg-muted uppercase">Status</th>
                <th className="px-4 py-2 text-left text-xs font-semibold text-fg-muted uppercase">Duration</th>
                <th className="px-4 py-2 text-left text-xs font-semibold text-fg-muted uppercase">Triggered By</th>
                <th className="px-4 py-2 text-left text-xs font-semibold text-fg-muted uppercase">Error</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {runsLoading && (
                <tr><td colSpan={5} className="px-4 py-4 text-center text-fg-muted text-sm">Loading runs...</td></tr>
              )}
              {!runsLoading && runs.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-4 text-center text-fg-muted text-sm">No runs recorded yet.</td></tr>
              )}
              {runs.map((r) => (
                <tr key={r.id} className="hover:bg-row-hover">
                  <td className="px-4 py-2 text-sm text-fg-muted">{fmtDate(r.startedAt)}</td>
                  <td className="px-4 py-2">{statusBadge(r.status)}</td>
                  <td className="px-4 py-2 text-sm text-fg-muted">{fmtDuration(r.durationMs)}</td>
                  <td className="px-4 py-2 text-sm text-fg-muted">{r.triggeredBy || 'schedule'}</td>
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
