'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import PageHeader from '@/components/ui/PageHeader'
import KPICard from '@/components/ui/KPICard'
import { Badge, StatusBadge } from '@/components/ui/Badge'
import { Sheet } from '@/components/ui/Sheet'
import { cn } from '@/lib/utils'
import {
  ClipboardCheck,
  Package,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  RefreshCw,
  MapPin,
} from 'lucide-react'

// ── Types ────────────────────────────────────────────────────────────────

interface Allocation {
  allocationId: string
  productId: string
  sku: string
  productName: string
  qty: number
  binLocation: string | null
  warehouseZone: string | null
  status: 'RESERVED' | 'PICKED'
  onHand: number
  shortage: boolean
}

interface PickJob {
  jobId: string
  jobNumber: string
  jobAddress: string | null
  builderName: string
  scheduledDate: string | null
  pmName: string | null
  status: string
  pickListGenerated: boolean
  pickStatus: 'NONE' | 'PARTIAL' | 'FULL' | 'BLOCKED'
  counts: { total: number; reserved: number; picked: number; shortage: number }
  allocations: Allocation[]
}

// ── Helpers ──────────────────────────────────────────────────────────────

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function pickStatusBadge(s: PickJob['pickStatus']) {
  switch (s) {
    case 'FULL':
      return <Badge variant="success" size="sm" dot>All Picked</Badge>
    case 'PARTIAL':
      return <Badge variant="warning" size="sm" dot>Partial</Badge>
    case 'BLOCKED':
      return <Badge variant="danger" size="sm" dot>Shortage</Badge>
    default:
      return <Badge variant="neutral" size="sm" dot>Pending</Badge>
  }
}

// ── Page ─────────────────────────────────────────────────────────────────

export default function TodaysPicksPage() {
  const [jobs, setJobs] = useState<PickJob[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [lineQtys, setLineQtys] = useState<Record<string, number>>({}) // allocationId -> qty
  const [selectedLines, setSelectedLines] = useState<Set<string>>(new Set())
  const [savingJobIds, setSavingJobIds] = useState<Set<string>>(new Set())
  const [activeJob, setActiveJob] = useState<PickJob | null>(null)
  const [focusIdx, setFocusIdx] = useState(0)
  const [toast, setToast] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const cardRefs = useRef<Array<HTMLDivElement | null>>([])

  const loadPicks = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoading(true)
    try {
      const res = await fetch('/api/ops/warehouse/picks/today', { credentials: 'include' })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j?.error || `HTTP ${res.status}`)
      }
      const data = await res.json()
      const list: PickJob[] = Array.isArray(data?.jobs) ? data.jobs : []
      setJobs(list)
      // Seed default qty inputs = reserved qty for each allocation
      setLineQtys((prev) => {
        const next = { ...prev }
        for (const j of list) {
          for (const a of j.allocations) {
            if (a.status === 'RESERVED' && next[a.allocationId] == null) {
              next[a.allocationId] = a.qty
            }
          }
        }
        return next
      })
      setError(null)
    } catch (e: any) {
      setError(e?.message || 'Failed to load pick queue')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadPicks()
  }, [loadPicks])

  // Auto-refresh every 30s (silent — no spinner)
  useEffect(() => {
    const t = setInterval(() => loadPicks({ silent: true }), 30_000)
    return () => clearInterval(t)
  }, [loadPicks])

  // Toast auto-dismiss
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 3500)
    return () => clearTimeout(t)
  }, [toast])

  // ── KPI counts ───────────────────────────────────────────────────────
  const kpis = useMemo(() => {
    const total = jobs.length
    const full = jobs.filter((j) => j.pickStatus === 'FULL').length
    const partial = jobs.filter((j) => j.pickStatus === 'PARTIAL').length
    const blocked = jobs.filter((j) => j.pickStatus === 'BLOCKED').length
    return { total, full, partial, blocked }
  }, [jobs])

  // ── Keyboard shortcuts: j/k navigate, Enter expand ───────────────────
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!jobs.length) return
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase()
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return

      if (e.key === 'j') {
        e.preventDefault()
        setFocusIdx((i) => Math.min(i + 1, jobs.length - 1))
      } else if (e.key === 'k') {
        e.preventDefault()
        setFocusIdx((i) => Math.max(i - 1, 0))
      } else if (e.key === 'Enter') {
        e.preventDefault()
        const j = jobs[focusIdx]
        if (j) toggleExpand(j.jobId)
      } else if (e.key === 'r' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        loadPicks()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [jobs, focusIdx, loadPicks])

  // Scroll focused card into view
  useEffect(() => {
    const el = cardRefs.current[focusIdx]
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [focusIdx])

  const toggleExpand = (jobId: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(jobId)) next.delete(jobId)
      else next.add(jobId)
      return next
    })
  }

  const toggleLine = (allocId: string) => {
    setSelectedLines((prev) => {
      const next = new Set(prev)
      if (next.has(allocId)) next.delete(allocId)
      else next.add(allocId)
      return next
    })
  }

  const markPicked = useCallback(
    async (job: PickJob, allocations: Allocation[]) => {
      if (!allocations.length) return
      setSavingJobIds((prev) => new Set(prev).add(job.jobId))
      try {
        const lines = allocations.map((a) => ({
          productId: a.productId,
          qty: lineQtys[a.allocationId] ?? a.qty,
        }))
        const res = await fetch(`/api/ops/warehouse/picks/${encodeURIComponent(job.jobId)}/mark-picked`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ lines }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`)

        const ok = data.pickedCount ?? 0
        const fail = data.failedCount ?? 0
        setToast({
          type: fail > 0 ? 'err' : 'ok',
          text: data.allPicked
            ? `${job.jobNumber}: all lines picked — job ready for delivery`
            : `${job.jobNumber}: ${ok} picked${fail > 0 ? `, ${fail} failed` : ''}`,
        })
        // Clear the selection for lines we just marked
        setSelectedLines((prev) => {
          const next = new Set(prev)
          for (const a of allocations) next.delete(a.allocationId)
          return next
        })
        await loadPicks({ silent: true })
      } catch (e: any) {
        setToast({ type: 'err', text: e?.message || 'Pick failed' })
      } finally {
        setSavingJobIds((prev) => {
          const next = new Set(prev)
          next.delete(job.jobId)
          return next
        })
      }
    },
    [lineQtys, loadPicks]
  )

  return (
    <div ref={containerRef} className="space-y-6">
      <PageHeader
        eyebrow="Warehouse"
        title="Today's Picks"
        description="Pull material for every job delivering in the next 48 hours. Each card expands to its pick ticket."
        crumbs={[
          { label: 'Ops', href: '/ops' },
          { label: 'Warehouse Portal', href: '/ops/portal/warehouse' },
          { label: 'Today\'s Picks' },
        ]}
        actions={
          <button
            onClick={() => loadPicks()}
            className="inline-flex items-center gap-1.5 h-8 px-3 text-[12px] font-medium rounded-md border border-border hover:border-border-strong bg-surface-muted text-fg-muted hover:text-fg transition-colors"
          >
            <RefreshCw className={cn('w-3.5 h-3.5', loading && 'animate-spin')} />
            Refresh
          </button>
        }
      >
        <div className="flex items-center gap-3 text-[11px] text-fg-subtle font-mono">
          <span>Shortcuts:</span>
          <span className="kbd">J</span><span>/</span><span className="kbd">K</span><span>navigate</span>
          <span className="kbd">Enter</span><span>expand</span>
          <span className="kbd">⌘R</span><span>refresh</span>
          <span className="ml-auto">Auto-refresh 30s</span>
        </div>
      </PageHeader>

      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KPICard
          title="Jobs to Pick"
          value={kpis.total}
          subtitle="next 48 hours"
          accent="brand"
          icon={<ClipboardCheck className="w-4 h-4" />}
        />
        <KPICard
          title="Fully Picked"
          value={kpis.full}
          subtitle="material pulled"
          accent="positive"
          icon={<CheckCircle2 className="w-4 h-4" />}
        />
        <KPICard
          title="Partial"
          value={kpis.partial}
          subtitle="some pulled"
          accent="accent"
          icon={<Package className="w-4 h-4" />}
        />
        <KPICard
          title="Blocked"
          value={kpis.blocked}
          subtitle="shortage — needs PO"
          accent={kpis.blocked > 0 ? 'negative' : 'neutral'}
          icon={<AlertTriangle className="w-4 h-4" />}
        />
      </div>

      {/* Toast */}
      {toast && (
        <div
          className={cn(
            'fixed bottom-6 right-6 z-[90] px-4 py-3 rounded-lg shadow-elevation-3 text-[13px] font-medium',
            toast.type === 'ok'
              ? 'bg-data-positive-bg text-data-positive-fg border border-data-positive'
              : 'bg-data-negative-bg text-data-negative-fg border border-data-negative'
          )}
          role="status"
        >
          {toast.text}
        </div>
      )}

      {error && (
        <div className="glass-card px-4 py-3 border border-data-negative text-[13px] text-data-negative-fg">
          <strong>Error:</strong> {error}
        </div>
      )}

      {/* Job cards */}
      <div className="space-y-3">
        {loading && jobs.length === 0 ? (
          <div className="glass-card p-8 text-center text-[13px] text-fg-muted">Loading pick queue…</div>
        ) : jobs.length === 0 ? (
          <div className="glass-card p-10 text-center">
            <CheckCircle2 className="w-10 h-10 text-data-positive mx-auto mb-3" />
            <p className="text-[14px] font-semibold text-fg">All caught up.</p>
            <p className="text-[12px] text-fg-muted mt-1">
              No jobs scheduled to deliver in the next 48 hours have outstanding picks.
            </p>
          </div>
        ) : (
          jobs.map((job, i) => {
            const isOpen = expanded.has(job.jobId)
            const isFocused = i === focusIdx
            const isSaving = savingJobIds.has(job.jobId)
            const reservedAllocs = job.allocations.filter((a) => a.status === 'RESERVED')
            const selectedForJob = reservedAllocs.filter((a) => selectedLines.has(a.allocationId))

            return (
              <div
                key={job.jobId}
                ref={(el) => {
                  cardRefs.current[i] = el
                }}
                className={cn(
                  'glass-card overflow-hidden transition-[border-color,box-shadow] duration-fast',
                  isFocused ? 'border-signal shadow-elevation-2' : 'border-glass-border'
                )}
              >
                {/* Card header */}
                <button
                  onClick={() => {
                    setFocusIdx(i)
                    toggleExpand(job.jobId)
                  }}
                  className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-surface-muted/40 transition-colors"
                  aria-expanded={isOpen}
                >
                  <div className="shrink-0 text-fg-subtle">
                    {isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                  </div>

                  <div className="flex-1 min-w-0 flex items-center gap-4 flex-wrap">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-[13px] font-semibold text-fg">{job.jobNumber}</span>
                        <StatusBadge status={job.status} size="xs" />
                      </div>
                      <div className="text-[12px] text-fg-muted truncate mt-0.5">
                        {job.builderName}
                        {job.jobAddress ? ` · ${job.jobAddress}` : ''}
                      </div>
                    </div>

                    <div className="ml-auto flex items-center gap-4 text-[11px] font-mono tabular-nums text-fg-muted">
                      <span>{fmtDate(job.scheduledDate)}</span>
                      {job.pmName && (
                        <span className="hidden md:inline text-fg-subtle">PM: {job.pmName}</span>
                      )}
                      <span>
                        {job.counts.picked}/{job.counts.total} lines
                      </span>
                      {pickStatusBadge(job.pickStatus)}
                    </div>
                  </div>
                </button>

                {/* Allocation rows */}
                {isOpen && (
                  <div className="border-t border-border">
                    <div className="px-4 py-2 flex items-center justify-between gap-3 bg-surface-muted/40">
                      <div className="text-[11px] text-fg-subtle font-mono uppercase tracking-wider">
                        Pick Ticket · {reservedAllocs.length} open line{reservedAllocs.length === 1 ? '' : 's'}
                      </div>
                      <div className="flex items-center gap-2">
                        {selectedForJob.length > 0 && (
                          <button
                            onClick={() => markPicked(job, selectedForJob)}
                            disabled={isSaving}
                            className="h-7 px-3 text-[11px] font-semibold rounded-md border border-border bg-surface-elevated hover:border-border-strong text-fg disabled:opacity-50 transition-colors"
                          >
                            Pick selected ({selectedForJob.length})
                          </button>
                        )}
                        {reservedAllocs.length > 0 && (
                          <button
                            onClick={() => markPicked(job, reservedAllocs)}
                            disabled={isSaving}
                            className="h-7 px-3 text-[11px] font-semibold rounded-md bg-brand text-fg-on-accent hover:bg-brand/90 disabled:opacity-50 transition-colors"
                          >
                            {isSaving ? 'Picking…' : 'Mark all picked'}
                          </button>
                        )}
                      </div>
                    </div>

                    <table className="w-full text-[12px]">
                      <thead className="text-[10px] uppercase tracking-wider text-fg-subtle font-mono">
                        <tr className="border-b border-border">
                          <th className="px-4 py-2 text-left w-10"></th>
                          <th className="px-2 py-2 text-left">SKU</th>
                          <th className="px-2 py-2 text-left">Product</th>
                          <th className="px-2 py-2 text-left">Location</th>
                          <th className="px-2 py-2 text-right">Qty Req</th>
                          <th className="px-2 py-2 text-right">On Hand</th>
                          <th className="px-2 py-2 text-right">Pick Qty</th>
                          <th className="px-2 py-2 text-center">Status</th>
                          <th className="px-4 py-2 text-right"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {job.allocations.map((a) => {
                          const isSelected = selectedLines.has(a.allocationId)
                          const isReserved = a.status === 'RESERVED'
                          return (
                            <tr
                              key={a.allocationId}
                              className={cn(
                                'border-b border-border last:border-0 hover:bg-surface-muted/30 transition-colors',
                                a.shortage && 'bg-data-negative-bg/20',
                                !isReserved && 'opacity-60'
                              )}
                            >
                              <td className="px-4 py-2">
                                {isReserved && (
                                  <input
                                    type="checkbox"
                                    checked={isSelected}
                                    onChange={() => toggleLine(a.allocationId)}
                                    className="w-3.5 h-3.5 rounded border-border accent-brand"
                                    aria-label={`Select ${a.sku}`}
                                  />
                                )}
                              </td>
                              <td className="px-2 py-2 font-mono text-[11px] text-fg">{a.sku}</td>
                              <td className="px-2 py-2 text-fg truncate max-w-[260px]">{a.productName}</td>
                              <td className="px-2 py-2 font-mono text-[11px]">
                                <span className="inline-flex items-center gap-1 text-fg-muted">
                                  <MapPin className="w-3 h-3 shrink-0" />
                                  {a.warehouseZone || '—'}
                                  {a.binLocation ? (
                                    <span className="text-fg-subtle"> · {a.binLocation}</span>
                                  ) : null}
                                </span>
                              </td>
                              <td className="px-2 py-2 text-right font-mono tabular-nums text-fg">{a.qty}</td>
                              <td
                                className={cn(
                                  'px-2 py-2 text-right font-mono tabular-nums',
                                  a.shortage ? 'text-data-negative-fg font-semibold' : 'text-fg-muted'
                                )}
                              >
                                {a.onHand}
                              </td>
                              <td className="px-2 py-2 text-right">
                                {isReserved ? (
                                  <input
                                    type="number"
                                    min={0}
                                    max={a.qty}
                                    value={lineQtys[a.allocationId] ?? a.qty}
                                    onChange={(e) => {
                                      const v = Math.max(0, Math.min(a.qty, Number(e.target.value) || 0))
                                      setLineQtys((prev) => ({ ...prev, [a.allocationId]: v }))
                                    }}
                                    className="w-16 h-7 px-2 rounded border border-border bg-surface-elevated font-mono text-right text-[11px] text-fg focus:outline-none focus:border-signal"
                                  />
                                ) : (
                                  <span className="font-mono text-[11px] text-fg-subtle">—</span>
                                )}
                              </td>
                              <td className="px-2 py-2 text-center">
                                {a.shortage ? (
                                  <Badge variant="danger" size="xs" dot>SHORT</Badge>
                                ) : a.status === 'PICKED' ? (
                                  <Badge variant="success" size="xs" dot>PICKED</Badge>
                                ) : (
                                  <Badge variant="neutral" size="xs" dot>RES</Badge>
                                )}
                              </td>
                              <td className="px-4 py-2 text-right">
                                {isReserved && (
                                  <button
                                    onClick={() => markPicked(job, [a])}
                                    disabled={isSaving || a.shortage}
                                    className="h-6 px-2 text-[10px] font-semibold rounded border border-border hover:border-signal text-fg disabled:opacity-40 transition-colors"
                                    title={a.shortage ? 'Cannot pick — insufficient on-hand' : 'Mark this line picked'}
                                  >
                                    Pick
                                  </button>
                                )}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>

      {/* Optional detail Sheet — kept for future expansion */}
      <Sheet
        open={!!activeJob}
        onClose={() => setActiveJob(null)}
        title={activeJob?.jobNumber}
        subtitle={activeJob?.builderName}
        tabs={['details']}
      >
        {activeJob && (
          <div className="space-y-2 text-[12.5px]">
            <div>{activeJob.jobAddress}</div>
            <div>Scheduled: {fmtDate(activeJob.scheduledDate)}</div>
            <div>PM: {activeJob.pmName ?? '—'}</div>
          </div>
        )}
      </Sheet>
    </div>
  )
}
