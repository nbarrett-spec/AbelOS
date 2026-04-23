'use client'

// ═══════════════════════════════════════════════════════════════════════════
// /ops/receiving — Receive-against-PO workflow
//
// Top: "Expected Today" list (open POs with expectedDate within next 48h,
// plus any overdue/backlog).  Click a PO → receive form with editable
// receivedQty + condition (OK / DAMAGED / SHORT) per line.  "Confirm Receipt"
// POSTs to /api/ops/receiving/[poId]/receive which:
//   - bumps onHand
//   - releases matching BACKORDERED allocations in Job.scheduledDate order
//   - recomputes committed / available
//   - emails PMs whose jobs just flipped RED → GREEN
// ═══════════════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useState } from 'react'
import PageHeader from '@/components/ui/PageHeader'

// ── Types ─────────────────────────────────────────────────────────────────

interface QueuePO {
  id: string
  poNumber: string
  vendorId: string
  vendorName: string
  status: string
  expectedDate: string | null
  totalAmount: number
  createdAt: string
  items: {
    total: number
    started: number
    totalReceivedQty: number
    totalOrderedQty: number
  }
  progress: {
    fullyReceived: boolean
    percentComplete: number
  }
}

interface POLine {
  id: string
  productId: string | null
  vendorSku: string
  description: string
  quantity: number
  unitCost: number
  lineTotal: number
  receivedQty: number
  damagedQty: number
  remaining: number
  receiveStatus: 'PENDING' | 'PARTIAL' | 'COMPLETE'
}

interface PODetail {
  id: string
  poNumber: string
  vendor?: { id: string; name: string } | null
  vendorName?: string
  status: string
  expectedDate: string | null
  total: number
  items: POLine[]
}

type LineCondition = 'OK' | 'DAMAGED' | 'SHORT'

interface ReceiveLineState {
  purchaseOrderItemId: string
  productId: string | null
  receivedQty: number
  condition: LineCondition
}

interface ReceiveResult {
  success: boolean
  poNumber: string
  poStatus: string
  fullyReceived: boolean
  received: Array<{ productId: string | null; receivedQty: number; condition: string }>
  backordersCleared: Array<{
    jobId: string
    jobNumber: string
    productId: string
    quantity: number
    allocationId: string
  }>
  stillShort: Array<{ productId: string; shortBy: number }>
  greenedJobs: string[]
  emailedPMs: Array<{ jobId: string; jobNumber: string; to: string }>
}

// ── Component ─────────────────────────────────────────────────────────────

export default function ReceivingPage() {
  const [view, setView] = useState<'queue' | 'receive' | 'success'>('queue')

  // Queue
  const [queue, setQueue] = useState<QueuePO[]>([])
  const [queueLoading, setQueueLoading] = useState(true)
  const [queueError, setQueueError] = useState('')
  const [search, setSearch] = useState('')

  // Receive form
  const [detail, setDetail] = useState<PODetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState('')
  const [formState, setFormState] = useState<Record<string, ReceiveLineState>>({})
  const [submitting, setSubmitting] = useState(false)

  // Success
  const [result, setResult] = useState<ReceiveResult | null>(null)

  // ── Load queue ──────────────────────────────────────────────────────────
  async function loadQueue() {
    setQueueLoading(true)
    setQueueError('')
    try {
      const params = new URLSearchParams()
      if (search.trim()) params.append('search', search.trim())
      const res = await fetch(`/api/ops/receiving?${params.toString()}`)
      if (!res.ok) throw new Error('Failed to load receiving queue')
      const data = await res.json()
      setQueue(data.pos || [])
    } catch (e: any) {
      setQueueError(e?.message || 'Failed to load queue')
    } finally {
      setQueueLoading(false)
    }
  }

  useEffect(() => {
    const t = setTimeout(() => loadQueue(), 300)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search])

  // ── Derived: Expected Today + rest ──────────────────────────────────────
  const { expectedBucket, upcomingBucket } = useMemo(() => {
    const now = Date.now()
    const twoDays = 48 * 60 * 60 * 1000
    const expected: QueuePO[] = []
    const upcoming: QueuePO[] = []
    for (const po of queue) {
      if (!po.expectedDate) {
        upcoming.push(po)
        continue
      }
      const t = new Date(po.expectedDate).getTime()
      if (t <= now + twoDays) expected.push(po)
      else upcoming.push(po)
    }
    return { expectedBucket: expected, upcomingBucket: upcoming }
  }, [queue])

  // ── Load PO detail ──────────────────────────────────────────────────────
  async function openPO(poId: string) {
    setDetailLoading(true)
    setDetailError('')
    setFormState({})
    setDetail(null)
    try {
      const res = await fetch(`/api/ops/receiving/${poId}`)
      if (!res.ok) throw new Error('Failed to load PO')
      const data = (await res.json()) as PODetail
      setDetail(data)
      const init: Record<string, ReceiveLineState> = {}
      for (const line of data.items) {
        init[line.id] = {
          purchaseOrderItemId: line.id,
          productId: line.productId,
          receivedQty: Math.max(0, line.remaining),
          condition: 'OK',
        }
      }
      setFormState(init)
      setView('receive')
    } catch (e: any) {
      setDetailError(e?.message || 'Failed to load PO')
    } finally {
      setDetailLoading(false)
    }
  }

  function updateLine(id: string, patch: Partial<ReceiveLineState>) {
    setFormState((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }))
  }

  // ── Confirm receipt ─────────────────────────────────────────────────────
  async function confirmReceipt() {
    if (!detail) return

    const lines = Object.values(formState)
      .filter((l) => l.receivedQty > 0)
      .map((l) => ({
        productId: l.productId,
        purchaseOrderItemId: l.purchaseOrderItemId,
        receivedQty: Math.floor(l.receivedQty),
        condition: l.condition,
      }))

    if (lines.length === 0) {
      alert('Enter a quantity on at least one line before confirming.')
      return
    }

    setSubmitting(true)
    try {
      const res = await fetch(`/api/ops/receiving/${detail.id}/receive`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lines }),
      })
      const data = await res.json()
      if (!res.ok || !data.success) {
        throw new Error(data?.error || 'Receipt failed')
      }
      setResult(data as ReceiveResult)
      setView('success')
    } catch (e: any) {
      alert(e?.message || 'Failed to record receipt')
    } finally {
      setSubmitting(false)
    }
  }

  // ── Helpers ─────────────────────────────────────────────────────────────
  function formatDate(iso: string | null | undefined): string {
    if (!iso) return '—'
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return '—'
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  }

  function formatCurrency(n: number): string {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n || 0)
  }

  function tone(po: QueuePO): { label: string; cls: string } {
    if (!po.expectedDate) return { label: 'NO ETA', cls: 'bg-surface-muted text-fg-muted border-border' }
    const now = Date.now()
    const t = new Date(po.expectedDate).getTime()
    const dayMs = 24 * 60 * 60 * 1000
    if (t < now - dayMs) return { label: 'OVERDUE', cls: 'bg-red-500/10 text-red-600 border-red-500/30' }
    if (t <= now + dayMs) return { label: 'DUE TODAY', cls: 'bg-amber-500/10 text-amber-700 border-amber-500/30' }
    if (t <= now + 2 * dayMs) return { label: 'DUE ≤48H', cls: 'bg-amber-500/10 text-amber-700 border-amber-500/30' }
    return { label: 'UPCOMING', cls: 'bg-surface-muted text-fg-muted border-border' }
  }

  // ═════════════════════════════════════════════════════════════════════════
  // SUCCESS VIEW
  // ═════════════════════════════════════════════════════════════════════════
  if (view === 'success' && result) {
    const cleared = result.backordersCleared.length
    const greened = result.greenedJobs.length
    // Group cleared by job for the UI.
    const byJob = new Map<string, { jobNumber: string; items: typeof result.backordersCleared }>()
    for (const c of result.backordersCleared) {
      if (!byJob.has(c.jobId))
        byJob.set(c.jobId, { jobNumber: c.jobNumber || c.jobId, items: [] })
      byJob.get(c.jobId)!.items.push(c)
    }

    return (
      <div className="p-6 max-w-5xl mx-auto">
        <PageHeader
          eyebrow="Receiving"
          title={`Receipt complete — ${result.poNumber}`}
          description={
            result.fullyReceived
              ? 'PO fully received. All lines marked RECEIVED.'
              : 'Partial receipt recorded. PO marked PARTIALLY_RECEIVED; the remainder can be received on the next delivery.'
          }
          crumbs={[
            { label: 'Ops', href: '/ops' },
            { label: 'Receiving', href: '/ops/receiving' },
            { label: result.poNumber },
          ]}
          actions={
            <button
              onClick={() => {
                setResult(null)
                setDetail(null)
                setView('queue')
                loadQueue()
              }}
              className="px-4 py-2 rounded-md bg-signal text-white font-semibold text-sm hover:bg-signal-hover"
            >
              Back to Queue
            </button>
          }
        />

        {/* Summary KPIs */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
          <div className="rounded-lg border border-border bg-surface p-4">
            <div className="text-xs text-fg-muted uppercase tracking-wide">Lines received</div>
            <div className="text-3xl font-semibold text-fg mt-1">{result.received.length}</div>
          </div>
          <div className="rounded-lg border border-border bg-surface p-4">
            <div className="text-xs text-fg-muted uppercase tracking-wide">Backorders cleared</div>
            <div className="text-3xl font-semibold text-emerald-600 mt-1">{cleared}</div>
          </div>
          <div className="rounded-lg border border-border bg-surface p-4">
            <div className="text-xs text-fg-muted uppercase tracking-wide">Jobs now GREEN</div>
            <div className="text-3xl font-semibold text-emerald-600 mt-1">{greened}</div>
          </div>
        </div>

        {/* Jobs flipped RED → GREEN */}
        {greened > 0 ? (
          <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-5 mb-6">
            <h2 className="text-sm font-bold text-emerald-700 uppercase tracking-wide mb-3">
              Jobs flipped RED → GREEN ({greened})
            </h2>
            <ul className="space-y-2">
              {result.emailedPMs.map((j) => (
                <li key={j.jobId} className="flex items-center justify-between text-sm">
                  <a
                    href={`/ops/jobs/${j.jobId}`}
                    className="font-semibold text-fg hover:text-signal underline-offset-2 hover:underline"
                  >
                    {j.jobNumber}
                  </a>
                  <span className="text-fg-muted">notified {j.to}</span>
                </li>
              ))}
              {/* Jobs that went green but PM had no email */}
              {result.greenedJobs
                .filter((jid) => !result.emailedPMs.some((e) => e.jobId === jid))
                .map((jid) => {
                  const entry = byJob.get(jid)
                  return (
                    <li key={jid} className="flex items-center justify-between text-sm">
                      <a
                        href={`/ops/jobs/${jid}`}
                        className="font-semibold text-fg hover:text-signal underline-offset-2 hover:underline"
                      >
                        {entry?.jobNumber || jid}
                      </a>
                      <span className="text-fg-muted italic">in-app notification only</span>
                    </li>
                  )
                })}
            </ul>
          </div>
        ) : cleared > 0 ? (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 mb-6 text-sm text-fg">
            Cleared {cleared} backorder row{cleared === 1 ? '' : 's'}, but no job went fully green yet —
            other material is still outstanding on those jobs.
          </div>
        ) : (
          <div className="rounded-lg border border-border bg-surface-muted p-4 mb-6 text-sm text-fg-muted">
            No backorders were waiting on this material. Surplus quantity added to available stock.
          </div>
        )}

        {/* Per-job breakdown */}
        {byJob.size > 0 && (
          <div className="rounded-lg border border-border bg-surface mb-6">
            <div className="px-5 py-3 border-b border-border text-xs font-bold uppercase tracking-wide text-fg-muted">
              Allocations released
            </div>
            <div className="divide-y divide-border">
              {Array.from(byJob.entries()).map(([jobId, info]) => (
                <div key={jobId} className="px-5 py-3">
                  <div className="flex items-center justify-between mb-2">
                    <a href={`/ops/jobs/${jobId}`} className="text-sm font-semibold text-fg hover:text-signal">
                      {info.jobNumber}
                    </a>
                    <span className="text-xs text-fg-muted">
                      {info.items.length} line{info.items.length === 1 ? '' : 's'}
                    </span>
                  </div>
                  <ul className="text-xs text-fg-muted space-y-1">
                    {info.items.map((c, idx) => (
                      <li key={idx} className="flex justify-between">
                        <span>product {c.productId.slice(0, 10)}…</span>
                        <span className="font-mono text-fg">{c.quantity}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        )}

        {result.stillShort.length > 0 && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-4 mb-6">
            <h3 className="text-sm font-bold text-red-700 mb-2">Still short</h3>
            <ul className="text-xs text-fg space-y-1">
              {result.stillShort.map((s) => (
                <li key={s.productId}>
                  <span className="font-mono">{s.productId.slice(0, 10)}…</span>
                  <span className="ml-2 text-red-700 font-semibold">short by {s.shortBy}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    )
  }

  // ═════════════════════════════════════════════════════════════════════════
  // RECEIVE VIEW
  // ═════════════════════════════════════════════════════════════════════════
  if (view === 'receive' && detail) {
    return (
      <div className="p-6 max-w-6xl mx-auto">
        <PageHeader
          eyebrow="Receiving"
          title={`Receive PO ${detail.poNumber}`}
          description={`From ${detail.vendor?.name || detail.vendorName || 'vendor'} · expected ${formatDate(detail.expectedDate)}`}
          crumbs={[
            { label: 'Ops', href: '/ops' },
            { label: 'Receiving', href: '/ops/receiving' },
            { label: detail.poNumber },
          ]}
          actions={
            <button
              onClick={() => {
                setView('queue')
                setDetail(null)
                setFormState({})
              }}
              className="px-3 py-2 rounded-md border border-border text-fg text-sm hover:bg-surface-muted"
            >
              ← Back
            </button>
          }
        />

        {/* Lines */}
        <div className="rounded-lg border border-border bg-surface overflow-hidden mb-6">
          <div className="grid grid-cols-[3fr_1fr_1fr_1fr_1.2fr_1.2fr] gap-3 px-4 py-3 text-xs font-bold uppercase tracking-wide text-fg-muted bg-surface-muted border-b border-border">
            <div>Description</div>
            <div className="text-right">Ordered</div>
            <div className="text-right">Prev rec'd</div>
            <div className="text-right">Remaining</div>
            <div className="text-center">Receiving now</div>
            <div className="text-center">Condition</div>
          </div>
          {detail.items.map((line) => {
            const st = formState[line.id]
            return (
              <div
                key={line.id}
                className="grid grid-cols-[3fr_1fr_1fr_1fr_1.2fr_1.2fr] gap-3 px-4 py-3 items-center border-b border-border last:border-b-0 text-sm"
              >
                <div>
                  <div className="font-medium text-fg">{line.description}</div>
                  <div className="text-xs text-fg-muted font-mono">{line.vendorSku || '—'}</div>
                </div>
                <div className="text-right font-mono">{line.quantity}</div>
                <div className="text-right font-mono text-fg-muted">{line.receivedQty}</div>
                <div className={`text-right font-mono font-semibold ${line.remaining > 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                  {line.remaining}
                </div>
                <div className="flex justify-center">
                  <input
                    type="number"
                    min={0}
                    max={line.remaining}
                    value={st?.receivedQty ?? 0}
                    onChange={(e) =>
                      updateLine(line.id, {
                        receivedQty: Math.max(0, Math.min(line.remaining, Number(e.target.value) || 0)),
                      })
                    }
                    className="w-24 px-2 py-1.5 rounded-md border border-border bg-surface text-fg text-center font-mono font-semibold focus:outline-none focus:ring-2 focus:ring-signal"
                  />
                </div>
                <div className="flex justify-center">
                  <select
                    value={st?.condition ?? 'OK'}
                    onChange={(e) =>
                      updateLine(line.id, { condition: e.target.value as LineCondition })
                    }
                    className="px-2 py-1.5 rounded-md border border-border bg-surface text-fg text-xs focus:outline-none focus:ring-2 focus:ring-signal"
                  >
                    <option value="OK">OK</option>
                    <option value="DAMAGED">DAMAGED</option>
                    <option value="SHORT">SHORT (vendor missed)</option>
                  </select>
                </div>
              </div>
            )
          })}
        </div>

        {/* Action bar */}
        <div className="flex items-center justify-between gap-3">
          <div className="text-xs text-fg-muted">
            DAMAGED and SHORT lines count toward the PO receipt but do NOT feed stock or clear backorders.
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => {
                setView('queue')
                setDetail(null)
                setFormState({})
              }}
              className="px-4 py-2 rounded-md border border-border text-fg text-sm hover:bg-surface-muted"
            >
              Cancel
            </button>
            <button
              onClick={confirmReceipt}
              disabled={submitting}
              className="px-6 py-2 rounded-md bg-signal text-white font-semibold text-sm hover:bg-signal-hover disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {submitting ? 'Submitting…' : 'Confirm Receipt'}
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ═════════════════════════════════════════════════════════════════════════
  // QUEUE VIEW (default)
  // ═════════════════════════════════════════════════════════════════════════
  return (
    <div className="p-6 max-w-6xl mx-auto">
      <PageHeader
        eyebrow="Supply Chain"
        title="Receiving"
        description="Check in vendor deliveries, release backorders, notify PMs."
        crumbs={[{ label: 'Ops', href: '/ops' }, { label: 'Receiving' }]}
      />

      {/* Search */}
      <div className="mb-6">
        <input
          type="search"
          placeholder="Search by PO number or vendor…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full px-3 py-2 rounded-md border border-border bg-surface text-fg text-sm placeholder:text-fg-subtle focus:outline-none focus:ring-2 focus:ring-signal"
        />
      </div>

      {queueError && (
        <div className="rounded-md border border-red-500/30 bg-red-500/5 px-4 py-3 mb-4 text-sm text-red-700 flex items-center justify-between">
          <span>{queueError}</span>
          <button
            onClick={loadQueue}
            className="px-3 py-1 rounded bg-red-600 text-white text-xs font-semibold"
          >
            Retry
          </button>
        </div>
      )}

      {/* Expected Today / Next 48h */}
      <section className="mb-8">
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="text-sm font-bold uppercase tracking-wide text-fg">
            Expected Today / Next 48h
          </h2>
          <span className="text-xs text-fg-muted">{expectedBucket.length} PO{expectedBucket.length === 1 ? '' : 's'}</span>
        </div>
        {queueLoading ? (
          <SkeletonRows />
        ) : expectedBucket.length === 0 ? (
          <EmptyBucket label="Nothing expected in the next 48 hours." />
        ) : (
          <div className="grid gap-2">
            {expectedBucket.map((po) => (
              <POCard key={po.id} po={po} onClick={() => openPO(po.id)} tone={tone(po)} formatDate={formatDate} formatCurrency={formatCurrency} />
            ))}
          </div>
        )}
      </section>

      {/* Upcoming */}
      <section>
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="text-sm font-bold uppercase tracking-wide text-fg">Upcoming &amp; open</h2>
          <span className="text-xs text-fg-muted">{upcomingBucket.length} PO{upcomingBucket.length === 1 ? '' : 's'}</span>
        </div>
        {queueLoading ? (
          <SkeletonRows />
        ) : upcomingBucket.length === 0 ? (
          <EmptyBucket label="No additional open POs." />
        ) : (
          <div className="grid gap-2">
            {upcomingBucket.map((po) => (
              <POCard key={po.id} po={po} onClick={() => openPO(po.id)} tone={tone(po)} formatDate={formatDate} formatCurrency={formatCurrency} />
            ))}
          </div>
        )}
      </section>

      {detailError && (
        <div className="fixed bottom-6 right-6 rounded-md border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-700 shadow-lg">
          {detailError}
        </div>
      )}
      {detailLoading && (
        <div className="fixed bottom-6 right-6 rounded-md bg-fg text-canvas px-4 py-3 text-sm shadow-lg">
          Loading PO…
        </div>
      )}
    </div>
  )
}

// ── Presentational helpers ────────────────────────────────────────────────

function POCard({
  po,
  onClick,
  tone,
  formatDate,
  formatCurrency,
}: {
  po: QueuePO
  onClick: () => void
  tone: { label: string; cls: string }
  formatDate: (iso: string | null | undefined) => string
  formatCurrency: (n: number) => string
}) {
  return (
    <button
      onClick={onClick}
      className="w-full text-left rounded-lg border border-border bg-surface hover:bg-surface-muted hover:border-signal/40 transition-colors p-4 grid grid-cols-[1fr_auto] gap-4 items-center"
    >
      <div className="min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="font-semibold text-fg">{po.poNumber}</span>
          <span
            className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded border ${tone.cls}`}
          >
            {tone.label}
          </span>
          <span className="text-[10px] font-bold uppercase tracking-wider text-fg-muted">
            {po.status.replace(/_/g, ' ')}
          </span>
        </div>
        <div className="text-sm text-fg-muted truncate">{po.vendorName}</div>
        <div className="text-xs text-fg-muted mt-1">
          Expected {formatDate(po.expectedDate)} · {po.items.total} line{po.items.total === 1 ? '' : 's'} ·{' '}
          {formatCurrency(po.totalAmount)} · {po.progress.percentComplete}% received
        </div>
      </div>
      <div className="text-signal text-sm font-semibold shrink-0">Receive →</div>
    </button>
  )
}

function SkeletonRows() {
  return (
    <div className="grid gap-2">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="h-20 rounded-lg border border-border bg-surface-muted animate-pulse" />
      ))}
    </div>
  )
}

function EmptyBucket({ label }: { label: string }) {
  return (
    <div className="rounded-lg border border-dashed border-border bg-surface-muted/40 px-4 py-6 text-center text-sm text-fg-muted">
      {label}
    </div>
  )
}
