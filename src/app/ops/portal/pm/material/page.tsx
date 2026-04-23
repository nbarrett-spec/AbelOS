'use client'

import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import Link from 'next/link'
import KPICard from '@/components/ui/KPICard'

// ── Types ──────────────────────────────────────────────────────────────────

type MaterialStatus = 'GREEN' | 'AMBER' | 'RED' | 'NO_BOM'

interface BomLine {
  productId: string
  sku: string
  name: string
  required: number
  allocated: number
  onHand: number
  available: number
  inboundQty: number
  inboundDate: string | null
  shortfall: number
  status: MaterialStatus
  critical: boolean
}

interface JobRow {
  id: string
  jobNumber: string
  jobAddress: string | null
  community: string | null
  builderName: string
  status: string
  scheduledDate: string | null
  daysToDelivery: number | null
  orderId: string | null
  assignedPMId: string | null
  materialStatus: MaterialStatus
  totalSkus: number
  shortSkus: number
  criticalSkus: number
  summary: string
  bom: BomLine[]
}

interface Pm {
  id: string
  firstName: string
  lastName: string
  email: string
}

interface ApiResponse {
  pmId: string
  sessionStaffId: string
  isPrivileged: boolean
  counts: { active: number; green: number; amber: number; red: number; noBom: number }
  builders: string[]
  jobs: JobRow[]
  pmRoster: Pm[]
  filters: { dateRange: string; status: string }
  asOf: string
}

// ── Helpers ────────────────────────────────────────────────────────────────

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })
}

function daysPill(days: number | null): { text: string; cls: string } {
  if (days === null) return { text: 'unscheduled', cls: 'bg-surface-muted text-fg-muted' }
  if (days < 0) return { text: `${Math.abs(days)}d overdue`, cls: 'bg-data-negative-bg text-data-negative-fg' }
  if (days === 0) return { text: 'today', cls: 'bg-data-negative-bg text-data-negative-fg' }
  if (days <= 3) return { text: `in ${days}d`, cls: 'bg-data-negative-bg text-data-negative-fg' }
  if (days <= 7) return { text: `in ${days}d`, cls: 'bg-accent-subtle text-accent-fg' }
  return { text: `in ${days}d`, cls: 'bg-data-positive-bg text-data-positive-fg' }
}

function statusDot(status: MaterialStatus): string {
  switch (status) {
    case 'RED':
      return 'bg-data-negative'
    case 'AMBER':
      return 'bg-accent'
    case 'GREEN':
      return 'bg-data-positive'
    default:
      return 'bg-border-strong'
  }
}

// ── Page ───────────────────────────────────────────────────────────────────

export default function PMMaterialDashboard() {
  const [data, setData] = useState<ApiResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Filters
  const [dateRange, setDateRange] = useState<'7' | '30' | 'all'>('all')
  const [statusFilter, setStatusFilter] = useState<'all' | 'red' | 'amber' | 'green'>('all')
  const [builderFilter, setBuilderFilter] = useState<Set<string>>(new Set())
  const [sortBy, setSortBy] = useState<'date' | 'severity'>('date')
  const [selectedPmId, setSelectedPmId] = useState<string>('')

  // Navigation + expand state
  const [activeIdx, setActiveIdx] = useState<number>(0)
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())

  // Per-job action feedback
  const [actionBusy, setActionBusy] = useState<Record<string, string>>({})
  const [actionMsg, setActionMsg] = useState<Record<string, string>>({})

  const listRef = useRef<HTMLDivElement>(null)
  const activeRef = useRef<HTMLDivElement>(null)

  // Build query string
  const qs = useMemo(() => {
    const p = new URLSearchParams()
    if (selectedPmId) p.set('pmId', selectedPmId)
    p.set('dateRange', dateRange)
    p.set('status', statusFilter)
    return p.toString()
  }, [selectedPmId, dateRange, statusFilter])

  const load = useCallback(async () => {
    try {
      setError(null)
      const res = await fetch(`/api/ops/portal/pm/material?${qs}`, { cache: 'no-store' })
      if (!res.ok) {
        if (res.status === 403) {
          const body = await res.json().catch(() => ({}))
          throw new Error(body.error || 'Access denied')
        }
        throw new Error(`HTTP ${res.status}`)
      }
      const json: ApiResponse = await res.json()
      setData(json)
      // Keep selectedPmId synced with server (in case of default)
      if (!selectedPmId && json.pmId) setSelectedPmId(json.pmId)
    } catch (e: any) {
      setError(e?.message || 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [qs, selectedPmId])

  // Initial + reactive fetch
  useEffect(() => {
    setLoading(true)
    load()
  }, [load])

  // Auto-refresh every 60s
  useEffect(() => {
    const t = setInterval(() => {
      load()
    }, 60_000)
    return () => clearInterval(t)
  }, [load])

  // ── Client-side filtering (builder + sort) ──────────────────────────────
  const filteredJobs = useMemo(() => {
    if (!data) return []
    let jobs = data.jobs.slice()
    if (builderFilter.size > 0) {
      jobs = jobs.filter(j => builderFilter.has(j.builderName))
    }
    if (sortBy === 'severity') {
      const rank: Record<MaterialStatus, number> = { RED: 0, AMBER: 1, NO_BOM: 2, GREEN: 3 }
      jobs.sort((a, b) => {
        const diff = rank[a.materialStatus] - rank[b.materialStatus]
        if (diff !== 0) return diff
        return (a.daysToDelivery ?? 9999) - (b.daysToDelivery ?? 9999)
      })
    }
    // else already sorted by scheduledDate ASC server-side
    return jobs
  }, [data, builderFilter, sortBy])

  // Clamp activeIdx when the list shrinks
  useEffect(() => {
    if (activeIdx >= filteredJobs.length) {
      setActiveIdx(Math.max(0, filteredJobs.length - 1))
    }
  }, [filteredJobs.length, activeIdx])

  // ── Keyboard shortcuts ──────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Ignore if typing in an input/select/textarea
      const target = e.target as HTMLElement | null
      if (target && ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName)) return
      if (target?.isContentEditable) return

      if (e.key === 'j') {
        e.preventDefault()
        setActiveIdx(i => Math.min(filteredJobs.length - 1, i + 1))
      } else if (e.key === 'k') {
        e.preventDefault()
        setActiveIdx(i => Math.max(0, i - 1))
      } else if (e.key === 'Enter') {
        const job = filteredJobs[activeIdx]
        if (job) toggleExpand(job.id)
      } else if (e.key === 'r') {
        setStatusFilter(s => (s === 'red' ? 'all' : 'red'))
      } else if (e.key === 't') {
        setActiveIdx(0)
        window.scrollTo({ top: 0, behavior: 'smooth' })
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredJobs, activeIdx])

  // Scroll active row into view when it changes
  useEffect(() => {
    activeRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [activeIdx])

  const toggleExpand = (id: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleBuilder = (b: string) => {
    setBuilderFilter(prev => {
      const next = new Set(prev)
      if (next.has(b)) next.delete(b)
      else next.add(b)
      return next
    })
  }

  // ── Quick actions ───────────────────────────────────────────────────────
  const postInboxItem = async (
    jobId: string,
    action: 'EXPEDITE' | 'ESCALATE' | 'SUBSTITUTE',
    body: Record<string, unknown>
  ) => {
    setActionBusy(b => ({ ...b, [jobId + action]: 'busy' }))
    setActionMsg(m => ({ ...m, [jobId]: '' }))
    try {
      const res = await fetch('/api/ops/inbox', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error || `HTTP ${res.status}`)
      }
      const labels: Record<string, string> = {
        EXPEDITE: 'Expedite request sent',
        ESCALATE: 'Escalated to Clint',
        SUBSTITUTE: 'Substitute request logged',
      }
      setActionMsg(m => ({ ...m, [jobId]: labels[action] }))
    } catch (e: any) {
      setActionMsg(m => ({ ...m, [jobId]: `Error: ${e?.message || 'failed'}` }))
    } finally {
      setActionBusy(b => {
        const next = { ...b }
        delete next[jobId + action]
        return next
      })
    }
  }

  const requestExpedite = (job: JobRow) => {
    const shortLines = job.bom.filter(b => b.status !== 'GREEN')
    postInboxItem(job.id, 'EXPEDITE', {
      type: 'EXPEDITE_REQUEST',
      source: 'pm-material',
      title: `Expedite materials for ${job.jobNumber}`,
      description: `${job.summary}. Address: ${job.jobAddress || 'n/a'}. Builder: ${job.builderName}.`,
      priority: job.materialStatus === 'RED' ? 'HIGH' : 'MEDIUM',
      entityType: 'Job',
      entityId: job.id,
      actionData: {
        jobId: job.id,
        jobNumber: job.jobNumber,
        scheduledDate: job.scheduledDate,
        shortLines: shortLines.map(l => ({
          productId: l.productId,
          sku: l.sku,
          shortfall: l.shortfall,
        })),
      },
    })
  }

  const escalateToClint = (job: JobRow) => {
    postInboxItem(job.id, 'ESCALATE', {
      type: 'AGENT_TASK',
      source: 'pm-material',
      title: `Escalation: ${job.jobNumber} material shortage`,
      description: `PM escalation. ${job.summary}. Delivery ${formatDate(job.scheduledDate)}.`,
      priority: 'HIGH',
      entityType: 'Job',
      entityId: job.id,
      assignedTo: 'clint', // Resolved by the inbox API to Clint Vinson's staffId
      actionData: {
        jobId: job.id,
        jobNumber: job.jobNumber,
        daysToDelivery: job.daysToDelivery,
        materialStatus: job.materialStatus,
      },
    })
  }

  const requestSubstitute = (job: JobRow, line?: BomLine) => {
    // Stub modal: record an inbox item for now; full substitute picker to come.
    postInboxItem(job.id, 'SUBSTITUTE', {
      type: 'AGENT_TASK',
      source: 'pm-material',
      title: `Substitute request: ${job.jobNumber}${line ? ` / ${line.sku}` : ''}`,
      description: line
        ? `PM requested substitute for ${line.sku} (${line.name}) — short ${line.shortfall}`
        : 'PM requested substitute review for job BoM',
      priority: 'MEDIUM',
      entityType: 'Job',
      entityId: job.id,
      actionData: {
        jobId: job.id,
        productId: line?.productId,
        sku: line?.sku,
        shortfall: line?.shortfall,
      },
    })
  }

  // ── Render ──────────────────────────────────────────────────────────────

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 border-4 border-brand border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="space-y-4">
        <div className="bg-data-negative-bg border border-data-negative text-data-negative-fg px-4 py-3 rounded-lg">
          <p>{error}</p>
          <button
            onClick={() => { setError(null); setLoading(true); load() }}
            className="text-data-negative-fg underline text-sm mt-1"
          >
            Try again
          </button>
        </div>
      </div>
    )
  }

  const counts = data?.counts || { active: 0, green: 0, amber: 0, red: 0, noBom: 0 }
  const isPrivileged = !!data?.isPrivileged
  const selectedPm = data?.pmRoster.find(p => p.id === (selectedPmId || data?.pmId))
  const pmDisplay = selectedPm
    ? `${selectedPm.firstName} ${selectedPm.lastName}`
    : isPrivileged
      ? 'Select a PM'
      : 'Me'

  return (
    <div className="space-y-6">
      {/* ── Header ───────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-fg">My Jobs — Material Status</h1>
          <p className="text-sm text-fg-muted mt-1">
            Daily material health for the jobs you own. Refreshes every 60s.
          </p>
        </div>

        {isPrivileged && data && (
          <div className="flex items-center gap-2 bg-surface rounded-lg border border-border px-3 py-2">
            <span className="text-xs text-fg-muted">Viewing:</span>
            <select
              value={selectedPmId || data.pmId}
              onChange={(e) => setSelectedPmId(e.target.value)}
              className="text-sm font-medium bg-transparent focus:outline-none text-fg"
            >
              {data.pmRoster.length === 0 && (
                <option value={data.sessionStaffId}>Me</option>
              )}
              {data.pmRoster.map(p => (
                <option key={p.id} value={p.id}>{p.firstName} {p.lastName}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* ── KPI row ─────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KPICard title="My Active Jobs" value={counts.active} accent="brand" />
        <KPICard title="Green" value={counts.green} accent="positive" subtitle="Fully allocated" />
        <KPICard title="Amber" value={counts.amber} accent="accent" subtitle="Covered by incoming PO" />
        <KPICard
          title="Red"
          value={counts.red}
          accent={counts.red > 0 ? 'negative' : 'neutral'}
          subtitle={counts.red > 0 ? 'True shortage' : 'None'}
        />
      </div>

      {/* ── Filter bar ──────────────────────────────────────────────────── */}
      <div className="bg-surface rounded-xl border border-border p-4 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1 bg-surface-muted rounded-lg p-1">
          {(['7', '30', 'all'] as const).map(d => (
            <button
              key={d}
              onClick={() => setDateRange(d)}
              className={`px-3 py-1.5 text-xs rounded-md font-medium transition ${
                dateRange === d ? 'bg-surface shadow text-brand' : 'text-fg-muted hover:text-fg'
              }`}
            >
              {d === 'all' ? 'All active' : `Next ${d}d`}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1 bg-surface-muted rounded-lg p-1">
          {(['all', 'red', 'amber', 'green'] as const).map(s => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`px-3 py-1.5 text-xs rounded-md font-medium capitalize transition ${
                statusFilter === s ? 'bg-surface shadow text-brand' : 'text-fg-muted hover:text-fg'
              }`}
            >
              {s === 'all' ? 'All' : `${s} only`}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1 bg-surface-muted rounded-lg p-1">
          <button
            onClick={() => setSortBy('date')}
            className={`px-3 py-1.5 text-xs rounded-md font-medium transition ${
              sortBy === 'date' ? 'bg-surface shadow text-brand' : 'text-fg-muted hover:text-fg'
            }`}
          >
            By date
          </button>
          <button
            onClick={() => setSortBy('severity')}
            className={`px-3 py-1.5 text-xs rounded-md font-medium transition ${
              sortBy === 'severity' ? 'bg-surface shadow text-brand' : 'text-fg-muted hover:text-fg'
            }`}
          >
            By severity
          </button>
        </div>

        {data && data.builders.length > 0 && (
          <div className="flex items-center gap-1.5 flex-wrap ml-auto">
            <span className="text-xs text-fg-muted mr-1">Builder:</span>
            {data.builders.map(b => (
              <button
                key={b}
                onClick={() => toggleBuilder(b)}
                className={`px-2 py-1 text-xs rounded border transition ${
                  builderFilter.has(b)
                    ? 'border-brand bg-brand-subtle text-accent-fg'
                    : 'border-border bg-surface text-fg-muted hover:border-border-strong'
                }`}
              >
                {b}
              </button>
            ))}
            {builderFilter.size > 0 && (
              <button
                onClick={() => setBuilderFilter(new Set())}
                className="px-2 py-1 text-xs rounded text-fg-muted hover:text-fg"
              >
                clear
              </button>
            )}
          </div>
        )}
      </div>

      {/* ── Keyboard hint ────────────────────────────────────────────────── */}
      <div className="text-xs text-fg-subtle flex items-center gap-3 flex-wrap">
        <span><kbd className="px-1.5 py-0.5 rounded border border-border bg-surface-muted font-mono">j</kbd>/<kbd className="px-1.5 py-0.5 rounded border border-border bg-surface-muted font-mono">k</kbd> navigate</span>
        <span><kbd className="px-1.5 py-0.5 rounded border border-border bg-surface-muted font-mono">Enter</kbd> expand</span>
        <span><kbd className="px-1.5 py-0.5 rounded border border-border bg-surface-muted font-mono">r</kbd> red only</span>
        <span><kbd className="px-1.5 py-0.5 rounded border border-border bg-surface-muted font-mono">t</kbd> top</span>
      </div>

      {/* ── Job list ────────────────────────────────────────────────────── */}
      <div ref={listRef} className="space-y-2">
        {filteredJobs.length === 0 ? (
          <div className="bg-surface rounded-xl border border-border p-12 text-center">
            <p className="text-fg-muted">
              {data && data.jobs.length === 0
                ? `No active jobs assigned to ${pmDisplay === 'Me' ? 'you' : pmDisplay}. Check with Clint for pipeline.`
                : 'No jobs match current filters.'}
            </p>
          </div>
        ) : (
          filteredJobs.map((job, idx) => {
            const isActive = idx === activeIdx
            const isExpanded = expandedIds.has(job.id)
            const pill = daysPill(job.daysToDelivery)
            return (
              <div
                key={job.id}
                ref={isActive ? activeRef : null}
                className={`bg-surface rounded-xl border transition-all ${
                  isActive ? 'border-brand shadow-elevation-2' : 'border-border'
                }`}
              >
                {/* Row header (click to expand) */}
                <button
                  type="button"
                  onClick={() => { setActiveIdx(idx); toggleExpand(job.id) }}
                  className="w-full text-left p-4 flex items-center gap-3 flex-wrap"
                >
                  <span className={`w-2.5 h-2.5 rounded-full ${statusDot(job.materialStatus)} shrink-0`} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-sm font-semibold text-fg">{job.jobNumber}</span>
                      <span className={`px-2 py-0.5 rounded text-[11px] font-medium ${pill.cls}`}>{pill.text}</span>
                      <span className="text-xs font-medium text-fg-muted">
                        {job.builderName}{job.community ? ` · ${job.community}` : ''}
                      </span>
                    </div>
                    <p className="text-xs text-fg-subtle mt-0.5 truncate">
                      {job.jobAddress || 'Address TBD'}
                    </p>
                    <p className="text-sm mt-1 text-fg">{job.summary}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="font-mono text-xs text-fg-subtle uppercase tracking-wide">
                      Scheduled
                    </p>
                    <p className="font-mono text-sm text-fg">
                      {formatDate(job.scheduledDate)}
                    </p>
                  </div>
                  <span className="text-fg-subtle text-xs ml-2">{isExpanded ? '▾' : '▸'}</span>
                </button>

                {/* Expanded detail */}
                {isExpanded && (
                  <div className="border-t border-border px-4 pt-4 pb-4">
                    {job.bom.length === 0 ? (
                      <p className="text-sm text-fg-muted py-2">
                        No BoM entries found. Check that the job has an Order linked.
                      </p>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="text-xs text-fg-subtle uppercase tracking-wide border-b border-border">
                              <th className="text-left py-2 pr-3 font-medium">SKU</th>
                              <th className="text-left py-2 pr-3 font-medium">Product</th>
                              <th className="text-right py-2 px-3 font-medium font-mono">Req</th>
                              <th className="text-right py-2 px-3 font-medium font-mono">Alloc</th>
                              <th className="text-right py-2 px-3 font-medium font-mono">On Hand</th>
                              <th className="text-right py-2 px-3 font-medium font-mono">Inbound</th>
                              <th className="text-right py-2 px-3 font-medium font-mono">Short</th>
                              <th className="text-right py-2 pl-3 font-medium">Status</th>
                            </tr>
                          </thead>
                          <tbody>
                            {job.bom.map(line => (
                              <tr key={line.productId} className="border-b border-border last:border-0">
                                <td className="py-2 pr-3 font-mono text-xs">{line.sku}</td>
                                <td className="py-2 pr-3 text-fg">{line.name}</td>
                                <td className="py-2 px-3 text-right font-mono">{line.required}</td>
                                <td className="py-2 px-3 text-right font-mono">{line.allocated}</td>
                                <td className="py-2 px-3 text-right font-mono">{line.onHand}</td>
                                <td className="py-2 px-3 text-right font-mono">
                                  {line.inboundQty > 0 ? (
                                    <span title={line.inboundDate ? `ETA ${formatDate(line.inboundDate)}` : ''}>
                                      {line.inboundQty}
                                    </span>
                                  ) : '—'}
                                </td>
                                <td className={`py-2 px-3 text-right font-mono font-semibold ${
                                  line.shortfall > 0 ? 'text-data-negative-fg' : 'text-fg-subtle'
                                }`}>
                                  {line.shortfall > 0 ? line.shortfall : '—'}
                                </td>
                                <td className="py-2 pl-3 text-right">
                                  <span className={`inline-flex items-center gap-1 text-xs`}>
                                    <span className={`w-2 h-2 rounded-full ${statusDot(line.status)}`} />
                                    {line.status}
                                    {line.critical && (
                                      <span className="ml-1 px-1 rounded bg-data-negative-bg text-data-negative-fg text-[10px] font-semibold">
                                        CRIT
                                      </span>
                                    )}
                                  </span>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}

                    {/* Quick actions */}
                    <div className="mt-4 flex items-center gap-2 flex-wrap">
                      <button
                        onClick={(e) => { e.stopPropagation(); requestExpedite(job) }}
                        disabled={!!actionBusy[job.id + 'EXPEDITE']}
                        className="px-3 py-1.5 text-xs font-medium rounded border border-border bg-surface hover:border-brand hover:text-brand transition disabled:opacity-50"
                      >
                        {actionBusy[job.id + 'EXPEDITE'] ? 'Sending…' : 'Request expedite'}
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); requestSubstitute(job) }}
                        disabled={!!actionBusy[job.id + 'SUBSTITUTE']}
                        className="px-3 py-1.5 text-xs font-medium rounded border border-border bg-surface hover:border-brand hover:text-brand transition disabled:opacity-50"
                      >
                        {actionBusy[job.id + 'SUBSTITUTE'] ? 'Sending…' : 'Substitute'}
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); escalateToClint(job) }}
                        disabled={!!actionBusy[job.id + 'ESCALATE']}
                        className="px-3 py-1.5 text-xs font-medium rounded border border-data-negative bg-data-negative-bg text-data-negative-fg hover:brightness-95 transition disabled:opacity-50"
                      >
                        {actionBusy[job.id + 'ESCALATE'] ? 'Sending…' : 'Escalate to Clint'}
                      </button>
                      <Link
                        href={`/ops/jobs/${job.id}`}
                        className="px-3 py-1.5 text-xs font-medium rounded border border-border bg-surface hover:border-brand hover:text-brand transition"
                        onClick={(e) => e.stopPropagation()}
                      >
                        Open job →
                      </Link>
                      {actionMsg[job.id] && (
                        <span className="text-xs text-fg-muted ml-2">{actionMsg[job.id]}</span>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>

      {/* ── Footer ──────────────────────────────────────────────────────── */}
      <div className="pt-4 border-t border-border">
        <Link
          href="/ops/material-calendar"
          className="text-sm text-brand hover:text-accent-fg font-medium"
        >
          Open Material Calendar →
        </Link>
      </div>
    </div>
  )
}
