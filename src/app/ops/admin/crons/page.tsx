'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import Link from 'next/link'
import PageHeader from '@/components/ui/PageHeader'
import EmptyState from '@/components/ui/EmptyState'
import { Settings, ExternalLink } from 'lucide-react'

// ─── Types ──────────────────────────────────────────────────────────────────
type CronStatus = 'RUNNING' | 'SUCCESS' | 'FAILURE' | 'PARTIAL' | null
type CronHealth = 'HEALTHY' | 'DEGRADED' | 'DEAD' | 'STUCK' | 'NEVER_RAN'

interface CronSummary {
  name: string
  schedule: string
  lastRunAt: string | null
  lastStatus: Exclude<CronStatus, null> | null
  lastDurationMs: number | null
  lastError: string | null
  successCount24h: number
  failureCount24h: number
  // Enriched fields from /lib/cron-health
  health: CronHealth
  itemsProcessed24h: number | null
  itemsProcessedSource: 'sync_log' | 'cron_result' | null
  integrationProvider: string | null
}

interface CronRun {
  id: string
  name: string
  status: 'RUNNING' | 'SUCCESS' | 'FAILURE' | 'PARTIAL'
  startedAt: string
  finishedAt: string | null
  durationMs: number | null
  error: string | null
  triggeredBy: string | null
}

interface SyncLog {
  id: string
  startedAt: string
  completedAt: string | null
  status: string
  syncType: string
  recordsProcessed: number
  recordsCreated: number
  recordsUpdated: number
  recordsSkipped: number
  recordsFailed: number
  errorMessage: string | null
  durationMs: number | null
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

// ─── Formatting helpers ────────────────────────────────────────────────────
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

function fmtCount(n: number | null): string {
  if (n == null) return '—'
  if (n === 0) return '0'
  if (n < 1000) return String(n)
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`
  return `${(n / 1_000_000).toFixed(1)}M`
}

// ─── Badges ────────────────────────────────────────────────────────────────
function statusBadge(status: string | null): JSX.Element {
  if (status === 'SUCCESS')
    return <span className="inline-flex px-2 py-0.5 text-xs font-medium rounded bg-green-100 text-green-800">SUCCESS</span>
  if (status === 'FAILURE')
    return <span className="inline-flex px-2 py-0.5 text-xs font-medium rounded bg-red-100 text-red-800">FAILURE</span>
  if (status === 'PARTIAL')
    return <span className="inline-flex px-2 py-0.5 text-xs font-medium rounded bg-amber-100 text-amber-800">PARTIAL</span>
  if (status === 'RUNNING')
    return <span className="inline-flex px-2 py-0.5 text-xs font-medium rounded bg-blue-100 text-blue-800">RUNNING</span>
  return <span className="inline-flex px-2 py-0.5 text-xs font-medium rounded bg-gray-100 text-gray-600">NEVER RUN</span>
}

function healthBadge(health: CronHealth): JSX.Element {
  switch (health) {
    case 'HEALTHY':
      return <span className="inline-flex px-2 py-0.5 text-xs font-medium rounded bg-green-100 text-green-800">HEALTHY</span>
    case 'DEGRADED':
      return <span className="inline-flex px-2 py-0.5 text-xs font-medium rounded bg-amber-100 text-amber-800">DEGRADED</span>
    case 'DEAD':
      return <span className="inline-flex px-2 py-0.5 text-xs font-medium rounded bg-red-100 text-red-800">DEAD</span>
    case 'STUCK':
      return <span className="inline-flex px-2 py-0.5 text-xs font-medium rounded bg-purple-100 text-purple-800">STUCK</span>
    case 'NEVER_RAN':
      return <span className="inline-flex px-2 py-0.5 text-xs font-medium rounded bg-gray-100 text-gray-600">NEVER RAN</span>
  }
}

function syncStatusBadge(status: string): JSX.Element {
  const s = status.toUpperCase()
  if (s === 'SUCCESS')
    return <span className="inline-flex px-2 py-0.5 text-xs font-medium rounded bg-green-100 text-green-800">{s}</span>
  if (s === 'PARTIAL')
    return <span className="inline-flex px-2 py-0.5 text-xs font-medium rounded bg-amber-100 text-amber-800">{s}</span>
  return <span className="inline-flex px-2 py-0.5 text-xs font-medium rounded bg-red-100 text-red-800">{s}</span>
}

type StatusFilter = 'all' | 'failed' | 'success' | 'never' | 'running'
type HealthFilter = 'all' | 'HEALTHY' | 'DEGRADED' | 'DEAD' | 'STUCK' | 'NEVER_RAN'

export default function CronsPage() {
  const [crons, setCrons] = useState<CronSummary[]>([])
  const [drift, setDrift] = useState<CronDrift | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [runs, setRuns] = useState<CronRun[]>([])
  const [syncLogs, setSyncLogs] = useState<SyncLog[]>([])
  const [detailIntegrationProvider, setDetailIntegrationProvider] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [runsLoading, setRunsLoading] = useState(false)
  const [error, setError] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [healthFilter, setHealthFilter] = useState<HealthFilter>('all')
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
      const res = await fetch(`/api/ops/admin/crons?name=${encodeURIComponent(name)}&limit=50`, { cache: 'no-store' })
      if (!res.ok) throw new Error(`Failed: ${res.status}`)
      const data = await res.json()
      setRuns(data.runs || [])
      setSyncLogs(data.syncLogs || [])
      setDetailIntegrationProvider(data.integrationProvider || null)
    } catch (e: any) {
      setRuns([])
      setSyncLogs([])
      setDetailIntegrationProvider(null)
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

  // Aggregate counters for the summary cards.
  const totalFailures24h = crons.reduce((s, c) => s + (c.failureCount24h || 0), 0)
  const totalSuccess24h = crons.reduce((s, c) => s + (c.successCount24h || 0), 0)
  const neverRan = crons.filter(c => !c.lastStatus).length
  const healthCounts = useMemo(() => {
    const out: Record<CronHealth, number> = { HEALTHY: 0, DEGRADED: 0, DEAD: 0, STUCK: 0, NEVER_RAN: 0 }
    for (const c of crons) out[c.health] = (out[c.health] || 0) + 1
    return out
  }, [crons])

  // Avg duration over the last 50 runs in the drawer — useful to spot drift.
  const avgRunDurationMs = useMemo(() => {
    const finished = runs.filter((r) => r.durationMs != null && r.durationMs > 0)
    if (finished.length === 0) return null
    return finished.reduce((s, r) => s + (r.durationMs || 0), 0) / finished.length
  }, [runs])

  // Compose status + health filters with the substring name query. Each
  // filter is applied independently; "all/all" + empty query = full list.
  const filteredCrons = crons.filter((c) => {
    if (statusFilter === 'failed' && c.lastStatus !== 'FAILURE') return false
    if (statusFilter === 'success' && c.lastStatus !== 'SUCCESS') return false
    if (statusFilter === 'running' && c.lastStatus !== 'RUNNING') return false
    if (statusFilter === 'never' && c.lastStatus) return false
    if (healthFilter !== 'all' && c.health !== healthFilter) return false
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
      // Use the dedicated path-based trigger route. Falls back to the body-
      // based POST on the index route if the path-based one is missing
      // (e.g. mid-deploy with stale routing manifest).
      const res = await fetch(`/api/ops/admin/crons/${encodeURIComponent(name)}/trigger`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok && data.ok) {
        setTriggerMsg({ name, ok: true, text: `Triggered "${name}" — upstream ${data.status}` })
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
        description="Scheduled job health surface. Catches silent-failure crons (e.g. ran SUCCESS but moved zero rows). Auto-refreshes every 30s."
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
          <div className="font-semibold mb-2">Cron registration drift detected</div>
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
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
        <div className="bg-surface border border-border rounded-lg p-3">
          <div className="text-[10px] uppercase text-fg-muted font-semibold">Registered</div>
          <div className="text-2xl font-semibold text-fg mt-1">{crons.length}</div>
        </div>
        <div className="bg-surface border border-border rounded-lg p-3">
          <div className="text-[10px] uppercase text-fg-muted font-semibold">Healthy</div>
          <div className="text-2xl font-semibold text-green-700 mt-1">{healthCounts.HEALTHY}</div>
        </div>
        <div className="bg-surface border border-border rounded-lg p-3">
          <div className="text-[10px] uppercase text-fg-muted font-semibold">Degraded</div>
          <div className={`text-2xl font-semibold mt-1 ${healthCounts.DEGRADED > 0 ? 'text-amber-700' : 'text-fg-subtle'}`}>
            {healthCounts.DEGRADED}
          </div>
        </div>
        <div className="bg-surface border border-border rounded-lg p-3">
          <div className="text-[10px] uppercase text-fg-muted font-semibold">Dead</div>
          <div className={`text-2xl font-semibold mt-1 ${healthCounts.DEAD > 0 ? 'text-red-700' : 'text-fg-subtle'}`}>
            {healthCounts.DEAD}
          </div>
        </div>
        <div className="bg-surface border border-border rounded-lg p-3">
          <div className="text-[10px] uppercase text-fg-muted font-semibold">Stuck</div>
          <div className={`text-2xl font-semibold mt-1 ${healthCounts.STUCK > 0 ? 'text-purple-700' : 'text-fg-subtle'}`}>
            {healthCounts.STUCK}
          </div>
        </div>
        <div className="bg-surface border border-border rounded-lg p-3">
          <div className="text-[10px] uppercase text-fg-muted font-semibold">Never ran</div>
          <div className={`text-2xl font-semibold mt-1 ${healthCounts.NEVER_RAN > 0 ? 'text-fg' : 'text-fg-subtle'}`}>
            {healthCounts.NEVER_RAN}
          </div>
        </div>
      </div>

      {/* 24h success / failure totals — keep these so the prior dashboard's
          mental model (volume) still works alongside the health bucket. */}
      <div className="grid grid-cols-2 gap-3 mb-4 text-sm">
        <div className="bg-surface border border-border rounded p-2 flex items-center gap-3">
          <span className="text-fg-muted text-xs uppercase font-semibold">Success 24h</span>
          <span className="text-green-700 font-semibold">{totalSuccess24h}</span>
        </div>
        <div className="bg-surface border border-border rounded p-2 flex items-center gap-3">
          <span className="text-fg-muted text-xs uppercase font-semibold">Failures 24h</span>
          <span className={totalFailures24h > 0 ? 'text-red-700 font-semibold' : 'text-fg-subtle font-semibold'}>{totalFailures24h}</span>
        </div>
      </div>

      {/* Filter row */}
      <div className="mb-4 space-y-2">
        <div className="flex flex-wrap items-center gap-3">
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
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1 text-sm">
            <span className="text-fg-muted mr-1">Health:</span>
            {(['all', 'HEALTHY', 'DEGRADED', 'DEAD', 'STUCK', 'NEVER_RAN'] as HealthFilter[]).map((f) => (
              <button
                key={f}
                onClick={() => setHealthFilter(f)}
                className={`px-2.5 py-1 text-xs rounded font-medium transition-colors ${
                  healthFilter === f
                    ? 'bg-brand text-fg-on-accent'
                    : 'bg-surface-muted text-fg-muted hover:bg-row-hover'
                }`}
              >
                {f === 'all'
                  ? `All (${crons.length})`
                  : `${f.replace('_', ' ')} (${healthCounts[f]})`}
              </button>
            ))}
          </div>
          <div className="ml-auto text-xs text-fg-muted">
            Showing {filteredCrons.length} of {crons.length}
          </div>
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
      <div className="bg-surface border border-border rounded-lg overflow-hidden overflow-x-auto">
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
              <th className="px-3 py-3 text-left text-xs font-semibold text-fg-muted uppercase">Name</th>
              <th className="px-3 py-3 text-left text-xs font-semibold text-fg-muted uppercase">Schedule</th>
              <th className="px-3 py-3 text-left text-xs font-semibold text-fg-muted uppercase">Health</th>
              <th className="px-3 py-3 text-left text-xs font-semibold text-fg-muted uppercase">Last Status</th>
              <th className="px-3 py-3 text-left text-xs font-semibold text-fg-muted uppercase">Last Run</th>
              <th className="px-3 py-3 text-left text-xs font-semibold text-fg-muted uppercase">Duration</th>
              <th className="px-3 py-3 text-right text-xs font-semibold text-fg-muted uppercase">Items 24h</th>
              <th className="px-3 py-3 text-left text-xs font-semibold text-fg-muted uppercase">24h S/F</th>
              <th className="px-3 py-3 text-right text-xs font-semibold text-fg-muted uppercase">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {loading && crons.length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-8 text-center text-fg-muted">Loading...</td>
              </tr>
            )}
            {!loading && filteredCrons.length === 0 && crons.length > 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-8 text-center text-fg-muted text-sm">
                  No crons match the current filter.
                </td>
              </tr>
            )}
            {filteredCrons.map((c) => (
              <tr
                key={c.name}
                className={`cursor-pointer hover:bg-row-hover ${selected === c.name ? 'bg-signal-subtle' : ''} ${
                  c.health === 'DEAD' ? 'bg-red-50/40' :
                  c.health === 'STUCK' ? 'bg-purple-50/40' :
                  c.health === 'DEGRADED' ? 'bg-amber-50/30' :
                  ''
                }`}
                onClick={() => setSelected(c.name)}
              >
                <td className="px-3 py-3 text-sm font-medium text-fg">{c.name}</td>
                <td className="px-3 py-3 text-xs text-fg-muted font-mono">{c.schedule}</td>
                <td className="px-3 py-3">{healthBadge(c.health)}</td>
                <td className="px-3 py-3">{statusBadge(c.lastStatus)}</td>
                <td className="px-3 py-3 text-sm text-fg-muted">{fmtDate(c.lastRunAt)}</td>
                <td className="px-3 py-3 text-sm text-fg-muted">{fmtDuration(c.lastDurationMs)}</td>
                <td
                  className="px-3 py-3 text-sm text-right tabular-nums"
                  title={c.itemsProcessedSource === 'sync_log' ? 'Sum of SyncLog.recordsProcessed (last 24h)' : c.itemsProcessed24h == null ? 'No item count available' : ''}
                >
                  {c.itemsProcessed24h == null ? (
                    <span className="text-fg-subtle">—</span>
                  ) : c.itemsProcessed24h === 0 ? (
                    <span className="text-amber-700 font-semibold" title="Ran but moved zero rows — silent-failure risk">0</span>
                  ) : (
                    <span className="text-fg">{fmtCount(c.itemsProcessed24h)}</span>
                  )}
                </td>
                <td className="px-3 py-3 text-sm">
                  <span className="text-green-700">{c.successCount24h}</span>
                  {' / '}
                  <span className={c.failureCount24h > 0 ? 'text-red-700 font-semibold' : 'text-fg-muted'}>
                    {c.failureCount24h}
                  </span>
                </td>
                <td className="px-3 py-3 text-right">
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
          <div className="px-4 py-3 bg-surface-muted border-b border-border flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-3 flex-wrap">
              <h2 className="text-sm font-semibold text-fg">
                Recent runs: <span className="font-mono">{selected}</span>
              </h2>
              {avgRunDurationMs != null && (
                <span className="text-xs text-fg-muted">
                  avg duration: <span className="font-mono text-fg">{fmtDuration(avgRunDurationMs)}</span>
                </span>
              )}
              {detailIntegrationProvider && (
                <Link
                  href="/ops/admin/integrations-freshness"
                  className="inline-flex items-center gap-1 text-xs text-signal hover:underline"
                  title={`This cron drives the ${detailIntegrationProvider} integration`}
                >
                  Integration freshness <ExternalLink className="w-3 h-3" />
                </Link>
              )}
            </div>
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

          {/* SyncLog rows — only present for crons with a mapped provider
              (inflow-sync, hyphen-sync, buildertrend-sync, gmail-sync,
              boise-*). For those, the SyncLog row counts are the canonical
              "did the work move rows?" signal — exactly the surface the silent-
              failure crons hid behind. */}
          {syncLogs.length > 0 && (
            <div className="border-t border-border">
              <div className="px-4 py-3 bg-surface-muted border-b border-border">
                <h3 className="text-sm font-semibold text-fg">
                  Sync log <span className="text-fg-muted text-xs font-normal">(last {syncLogs.length} runs)</span>
                </h3>
                <p className="text-xs text-fg-muted mt-0.5">
                  Row-count signal from <span className="font-mono">SyncLog</span>. Zero processed = silent-failure suspect.
                </p>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-border">
                  <thead className="bg-surface-muted">
                    <tr>
                      <th className="px-4 py-2 text-left text-xs font-semibold text-fg-muted uppercase">Started</th>
                      <th className="px-4 py-2 text-left text-xs font-semibold text-fg-muted uppercase">Type</th>
                      <th className="px-4 py-2 text-left text-xs font-semibold text-fg-muted uppercase">Status</th>
                      <th className="px-4 py-2 text-right text-xs font-semibold text-fg-muted uppercase">Processed</th>
                      <th className="px-4 py-2 text-right text-xs font-semibold text-fg-muted uppercase">Created</th>
                      <th className="px-4 py-2 text-right text-xs font-semibold text-fg-muted uppercase">Updated</th>
                      <th className="px-4 py-2 text-right text-xs font-semibold text-fg-muted uppercase">Skipped</th>
                      <th className="px-4 py-2 text-right text-xs font-semibold text-fg-muted uppercase">Failed</th>
                      <th className="px-4 py-2 text-left text-xs font-semibold text-fg-muted uppercase">Error</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {syncLogs.map((s) => (
                      <tr key={s.id} className={`hover:bg-row-hover ${s.recordsProcessed === 0 && s.status.toUpperCase() === 'SUCCESS' ? 'bg-amber-50/30' : ''}`}>
                        <td className="px-4 py-2 text-sm text-fg-muted">{fmtDate(s.startedAt)}</td>
                        <td className="px-4 py-2 text-xs text-fg-muted font-mono">{s.syncType}</td>
                        <td className="px-4 py-2">{syncStatusBadge(s.status)}</td>
                        <td
                          className="px-4 py-2 text-sm text-right tabular-nums"
                          title={s.recordsProcessed === 0 && s.status.toUpperCase() === 'SUCCESS' ? 'SUCCESS but zero processed — silent-failure suspect' : ''}
                        >
                          {s.recordsProcessed === 0 && s.status.toUpperCase() === 'SUCCESS' ? (
                            <span className="text-amber-700 font-semibold">0</span>
                          ) : (
                            s.recordsProcessed
                          )}
                        </td>
                        <td className="px-4 py-2 text-sm text-right tabular-nums text-fg-muted">{s.recordsCreated}</td>
                        <td className="px-4 py-2 text-sm text-right tabular-nums text-fg-muted">{s.recordsUpdated}</td>
                        <td className="px-4 py-2 text-sm text-right tabular-nums text-fg-muted">{s.recordsSkipped}</td>
                        <td className={`px-4 py-2 text-sm text-right tabular-nums ${s.recordsFailed > 0 ? 'text-red-700 font-semibold' : 'text-fg-muted'}`}>{s.recordsFailed}</td>
                        <td className="px-4 py-2 text-xs text-red-700 max-w-md truncate" title={s.errorMessage || ''}>
                          {s.errorMessage || ''}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
