'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  Check,
  ChevronRight,
  FileQuestion,
  Filter,
  RefreshCw,
  X,
} from 'lucide-react'

// ──────────────────────────────────────────────────────────────────────────
// SubstitutionQueue — client-side queue UI.
//
// Owned by /ops/substitutions (Wave-D Agent D6). Renders:
//   - Header + scope toggle + refresh.
//   - Filter bar (status chips, builder multi-select, urgency cutoff).
//   - Table ordered by days-pending DESC (PENDING/CONDITIONAL first).
//   - Side-drawer detail view with [Approve] / [Reject] / [Request info].
//
// All mutations go through the existing approve/reject API routes:
//   POST /api/ops/substitutions/requests/:id/approve   body: { note? }
//   POST /api/ops/substitutions/requests/:id/reject    body: { note }
//
// "Request more info" is surfaced as an inline note on the requester's
// email — there's no dedicated "needs-info" status in the schema, so we
// send it by rejecting with a "INFO REQUESTED: …" prefixed note. (The
// requester sees it in the decision email and can file a fresh request.)
// If a proper status is added later, the handler is the single place to
// update. Keeps the UI forward-compat.
// ──────────────────────────────────────────────────────────────────────────

export interface QueueRequest {
  id: string
  jobId: string
  jobNumber: string | null
  builderId: string | null
  builderName: string | null
  assignedPMId: string | null
  originalAllocationId: string | null
  originalProductId: string
  originalSku: string | null
  originalName: string | null
  substituteProductId: string
  substituteSku: string | null
  substituteName: string | null
  compatibility: string | null
  conditions: string | null
  priceDelta: number | null
  quantity: number
  requestedById: string
  requesterName: string | null
  requesterEmail: string | null
  reason: string | null
  status: string
  approvedById: string | null
  approvedAt: string | null
  rejectionNote: string | null
  createdAt: string
  appliedAt: string | null
  daysPending: number
}

export interface QueueCounts {
  pending: number
  conditional: number
  approved30d: number
  rejected30d: number
}

interface ApiResponse {
  scope: 'mine' | 'all'
  status: string
  count: number
  requests: QueueRequest[]
  counts: QueueCounts
  initialized?: boolean
  error?: string
}

type StatusFilter = 'QUEUE' | 'PENDING' | 'CONDITIONAL' | 'APPROVED' | 'REJECTED' | 'ALL'

interface Props {
  initial: ApiResponse | null
  initialError: string | null
  staffRole: string
  staffId: string
}

const STATUS_CHIPS: { id: StatusFilter; label: string }[] = [
  { id: 'QUEUE', label: 'Queue' },
  { id: 'PENDING', label: 'Pending' },
  { id: 'CONDITIONAL', label: 'Conditional' },
  { id: 'APPROVED', label: 'Approved' },
  { id: 'REJECTED', label: 'Rejected' },
  { id: 'ALL', label: 'All' },
]

const URGENCY_OPTIONS = [
  { value: 0, label: 'Any age' },
  { value: 1, label: '1+ day' },
  { value: 3, label: '3+ days' },
  { value: 7, label: '7+ days' },
  { value: 14, label: '14+ days' },
]

function fmtPriceDelta(pd: number | null): string {
  if (pd == null) return '—'
  const sign = pd > 0 ? '+' : ''
  return `${sign}$${pd.toFixed(2)}`
}

function priceDeltaTone(pd: number | null): string {
  if (pd == null) return 'text-fg-subtle'
  if (pd > 0) return 'text-red-700'
  if (pd < 0) return 'text-emerald-700'
  return 'text-fg-muted'
}

function statusTone(status: string): { bg: string; fg: string; label: string } {
  switch (status) {
    case 'PENDING':
      return { bg: 'bg-amber-50', fg: 'text-amber-800', label: 'PENDING' }
    case 'CONDITIONAL':
      return { bg: 'bg-orange-50', fg: 'text-orange-800', label: 'CONDITIONAL' }
    case 'APPROVED':
      return { bg: 'bg-emerald-50', fg: 'text-emerald-800', label: 'APPROVED' }
    case 'APPLIED':
      return { bg: 'bg-emerald-50', fg: 'text-emerald-800', label: 'APPLIED' }
    case 'REJECTED':
      return { bg: 'bg-red-50', fg: 'text-red-800', label: 'REJECTED' }
    default:
      return { bg: 'bg-gray-100', fg: 'text-gray-700', label: status }
  }
}

function daysPendingTone(days: number): string {
  if (days >= 7) return 'text-red-700 font-semibold'
  if (days >= 3) return 'text-amber-700 font-medium'
  return 'text-fg-muted'
}

export default function SubstitutionQueue({
  initial,
  initialError,
  staffRole,
  staffId,
}: Props) {
  const isAdmin = staffRole.split(',').map((r) => r.trim()).includes('ADMIN')

  const [data, setData] = useState<ApiResponse | null>(initial)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(initialError)
  const [toast, setToast] = useState<
    { text: string; tone: 'success' | 'error' | 'info' } | null
  >(null)

  const [scope, setScope] = useState<'mine' | 'all'>('mine')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('QUEUE')
  const [selectedBuilders, setSelectedBuilders] = useState<string[]>([])
  const [urgency, setUrgency] = useState<number>(0)

  const [drawerReq, setDrawerReq] = useState<QueueRequest | null>(null)
  const [decisionNote, setDecisionNote] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [builderPickerOpen, setBuilderPickerOpen] = useState(false)

  // Derive builder list from currently loaded rows (no extra fetch needed
  // for now — the queue rarely holds more than a handful of distinct
  // builders per PM).
  const builderOptions = useMemo(() => {
    const map = new Map<string, string>()
    for (const r of data?.requests ?? []) {
      if (r.builderId) {
        map.set(r.builderId, r.builderName ?? r.builderId.slice(0, 8))
      }
    }
    return Array.from(map.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [data?.requests])

  const load = useCallback(
    async (opts?: {
      scope?: 'mine' | 'all'
      statusFilter?: StatusFilter
      builderIds?: string[]
    }) => {
      setLoading(true)
      setError(null)
      try {
        const s = opts?.scope ?? scope
        const st = opts?.statusFilter ?? statusFilter
        const b = opts?.builderIds ?? selectedBuilders
        const qs = new URLSearchParams({
          scope: s,
          status: st,
        })
        if (b.length > 0) qs.set('builderId', b.join(','))
        const res = await fetch(`/api/ops/substitutions?${qs.toString()}`, {
          cache: 'no-store',
        })
        const json = await res.json()
        if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`)
        setData(json)
      } catch (e: any) {
        setError(e?.message ?? 'Failed to load queue')
      } finally {
        setLoading(false)
      }
    },
    [scope, statusFilter, selectedBuilders]
  )

  // Re-fetch whenever primary filters change (except urgency which is
  // client-only filter on already-loaded rows).
  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, statusFilter, selectedBuilders])

  // Auto-dismiss toast
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 4000)
    return () => clearTimeout(t)
  }, [toast])

  const filteredRows = useMemo(() => {
    const rows = data?.requests ?? []
    if (urgency <= 0) return rows
    return rows.filter((r) => {
      // urgency only applies to unresolved rows
      const isQueue = r.status === 'PENDING' || r.status === 'CONDITIONAL'
      if (!isQueue) return true
      return r.daysPending >= urgency
    })
  }, [data?.requests, urgency])

  const queueRowsCount = useMemo(
    () =>
      (data?.requests ?? []).filter(
        (r) => r.status === 'PENDING' || r.status === 'CONDITIONAL'
      ).length,
    [data?.requests]
  )

  const counts = data?.counts ?? {
    pending: 0,
    conditional: 0,
    approved30d: 0,
    rejected30d: 0,
  }

  const closeDrawer = useCallback(() => {
    if (submitting) return
    setDrawerReq(null)
    setDecisionNote('')
  }, [submitting])

  const refresh = useCallback(async () => {
    await load()
  }, [load])

  const approve = useCallback(
    async (row: QueueRequest, note: string) => {
      setSubmitting(true)
      try {
        const res = await fetch(
          `/api/ops/substitutions/requests/${row.id}/approve`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ note: note || undefined }),
          }
        )
        const json = await res.json()
        if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`)
        setToast({
          text: `Approved — ${row.originalSku ?? 'item'} → ${
            row.substituteSku ?? 'sub'
          } on Job ${row.jobNumber ?? row.jobId.slice(0, 8)}`,
          tone: 'success',
        })
        setDrawerReq(null)
        setDecisionNote('')
        await load()
      } catch (e: any) {
        setToast({
          text: e?.message ?? 'Failed to approve',
          tone: 'error',
        })
      } finally {
        setSubmitting(false)
      }
    },
    [load]
  )

  const reject = useCallback(
    async (row: QueueRequest, note: string, reason: 'REJECT' | 'INFO') => {
      const cleanNote = note.trim()
      if (!cleanNote) {
        setToast({ text: 'A note is required.', tone: 'error' })
        return
      }
      const finalNote =
        reason === 'INFO' ? `INFO REQUESTED: ${cleanNote}` : cleanNote
      setSubmitting(true)
      try {
        const res = await fetch(
          `/api/ops/substitutions/requests/${row.id}/reject`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ note: finalNote }),
          }
        )
        const json = await res.json()
        if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`)
        setToast({
          text:
            reason === 'INFO'
              ? 'Info request sent to requester.'
              : 'Rejected — requester notified.',
          tone: 'success',
        })
        setDrawerReq(null)
        setDecisionNote('')
        await load()
      } catch (e: any) {
        setToast({
          text: e?.message ?? 'Failed to submit decision',
          tone: 'error',
        })
      } finally {
        setSubmitting(false)
      }
    },
    [load]
  )

  // Empty state: table uninitialized or no requests at all.
  const tableUninitialized = data?.initialized === false

  return (
    <div>
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-fg">
            Substitution Requests — Your Jobs
          </h1>
          <p className="mt-0.5 text-[12px] text-fg-muted">
            PM approval queue for substitute products on jobs you own.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center rounded border border-border">
            <button
              onClick={() => setScope('mine')}
              className={`px-3 py-1.5 text-[12px] transition ${
                scope === 'mine'
                  ? 'bg-fg text-bg'
                  : 'hover:bg-surface-muted/40 text-fg'
              }`}
              aria-pressed={scope === 'mine'}
            >
              Mine only
            </button>
            <button
              onClick={() => {
                if (!isAdmin) {
                  setToast({
                    text: 'All-scope requires ADMIN role.',
                    tone: 'info',
                  })
                  return
                }
                setScope('all')
              }}
              className={`px-3 py-1.5 text-[12px] transition ${
                scope === 'all'
                  ? 'bg-fg text-bg'
                  : isAdmin
                  ? 'hover:bg-surface-muted/40 text-fg'
                  : 'cursor-not-allowed opacity-50 text-fg-muted'
              }`}
              aria-pressed={scope === 'all'}
              aria-disabled={!isAdmin}
              title={isAdmin ? 'Show all PM queues' : 'ADMIN only'}
            >
              All
            </button>
          </div>
          <button
            onClick={refresh}
            disabled={loading}
            className="flex items-center gap-1.5 rounded border border-border px-3 py-1.5 text-[12px] hover:bg-surface-muted/40 disabled:opacity-50"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`}
            />
            Refresh
          </button>
        </div>
      </div>

      {/* ── KPI pills ──────────────────────────────────────────────────── */}
      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <KpiPill
          label="Pending"
          value={counts.pending}
          tone={counts.pending > 0 ? 'warn' : 'idle'}
        />
        <KpiPill
          label="Conditional"
          value={counts.conditional}
          tone={counts.conditional > 0 ? 'warn' : 'idle'}
        />
        <KpiPill label="Approved (30d)" value={counts.approved30d} tone="ok" />
        <KpiPill label="Rejected (30d)" value={counts.rejected30d} tone="neutral" />
      </div>

      {/* ── Filter bar ─────────────────────────────────────────────────── */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1 text-[11.5px] text-fg-muted">
          <Filter className="h-3.5 w-3.5" />
          Status:
        </div>
        {STATUS_CHIPS.map((chip) => (
          <button
            key={chip.id}
            onClick={() => setStatusFilter(chip.id)}
            className={`rounded border px-2.5 py-1 text-[11.5px] transition ${
              statusFilter === chip.id
                ? 'border-fg bg-fg text-bg'
                : 'border-border hover:border-fg-muted hover:bg-surface-muted/40'
            }`}
          >
            {chip.label}
          </button>
        ))}

        <div className="mx-2 h-5 w-px bg-border" aria-hidden />

        <div className="relative">
          <button
            onClick={() => setBuilderPickerOpen((v) => !v)}
            className="flex items-center gap-1.5 rounded border border-border px-2.5 py-1 text-[11.5px] hover:bg-surface-muted/40"
          >
            Builder
            {selectedBuilders.length > 0 && (
              <span className="rounded-full bg-fg px-1.5 text-[10px] text-bg">
                {selectedBuilders.length}
              </span>
            )}
            <ChevronRight
              className={`h-3 w-3 transition ${
                builderPickerOpen ? 'rotate-90' : ''
              }`}
            />
          </button>
          {builderPickerOpen && (
            <div className="absolute left-0 top-full z-20 mt-1 w-60 rounded-lg border border-border bg-bg p-2 shadow-lg">
              {builderOptions.length === 0 ? (
                <div className="px-2 py-1.5 text-[11.5px] italic text-fg-muted">
                  No builders in current results.
                </div>
              ) : (
                <>
                  <div className="mb-1 flex items-center justify-between px-1">
                    <span className="text-[10.5px] text-fg-muted">
                      Filter by builder
                    </span>
                    {selectedBuilders.length > 0 && (
                      <button
                        onClick={() => setSelectedBuilders([])}
                        className="text-[10.5px] text-fg-muted hover:text-fg"
                      >
                        Clear
                      </button>
                    )}
                  </div>
                  <div className="max-h-56 overflow-y-auto">
                    {builderOptions.map((b) => {
                      const checked = selectedBuilders.includes(b.id)
                      return (
                        <label
                          key={b.id}
                          className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-[12px] hover:bg-surface-muted/40"
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => {
                              setSelectedBuilders((prev) =>
                                checked
                                  ? prev.filter((x) => x !== b.id)
                                  : [...prev, b.id]
                              )
                            }}
                          />
                          <span className="truncate">{b.name}</span>
                        </label>
                      )
                    })}
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        <select
          value={urgency}
          onChange={(e) => setUrgency(Number(e.target.value))}
          className="rounded border border-border bg-bg px-2 py-1 text-[11.5px]"
          aria-label="Days pending"
        >
          {URGENCY_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>

        <div className="ml-auto text-[11.5px] text-fg-muted">
          {filteredRows.length} shown ·{' '}
          <span className={queueRowsCount > 0 ? 'font-medium text-fg' : ''}>
            {queueRowsCount} awaiting decision
          </span>
        </div>
      </div>

      {/* ── Error / toast ──────────────────────────────────────────────── */}
      {error && (
        <div className="mb-3 flex items-center gap-2 rounded border border-red-300 bg-red-50 px-3 py-2 text-[12px] text-red-800">
          <AlertTriangle className="h-3.5 w-3.5" />
          <span>{error}</span>
          <button
            onClick={() => setError(null)}
            className="ml-auto text-red-700 hover:text-red-900"
            aria-label="Dismiss"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {toast && (
        <div
          className={`mb-3 flex items-center gap-2 rounded border px-3 py-2 text-[12px] ${
            toast.tone === 'success'
              ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
              : toast.tone === 'error'
              ? 'border-red-300 bg-red-50 text-red-800'
              : 'border-border bg-surface-muted/40 text-fg'
          }`}
        >
          {toast.tone === 'success' ? (
            <Check className="h-3.5 w-3.5" />
          ) : toast.tone === 'error' ? (
            <AlertTriangle className="h-3.5 w-3.5" />
          ) : (
            <Filter className="h-3.5 w-3.5" />
          )}
          <span>{toast.text}</span>
          <button
            onClick={() => setToast(null)}
            className="ml-auto opacity-70 hover:opacity-100"
            aria-label="Dismiss"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* ── Table ──────────────────────────────────────────────────────── */}
      <div className="overflow-hidden rounded-lg border border-border">
        <table className="w-full text-[12px]">
          <thead className="bg-surface-muted/40">
            <tr className="text-left text-fg-muted">
              <th className="px-3 py-2 font-medium">Request #</th>
              <th className="px-3 py-2 font-medium">Job #</th>
              <th className="px-3 py-2 font-medium">Builder</th>
              <th className="px-3 py-2 font-medium">Original → Replacement</th>
              <th className="px-3 py-2 text-right font-medium">$ Δ</th>
              <th className="px-3 py-2 font-medium">Reason</th>
              <th className="px-3 py-2 text-right font-medium">Days pending</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {loading && (data?.requests ?? []).length === 0 ? (
              <tr>
                <td
                  colSpan={9}
                  className="px-3 py-8 text-center text-fg-muted"
                >
                  Loading queue…
                </td>
              </tr>
            ) : tableUninitialized ? (
              <tr>
                <td colSpan={9} className="px-3 py-12 text-center">
                  <div className="mx-auto flex max-w-md flex-col items-center gap-2 text-fg-muted">
                    <FileQuestion className="h-6 w-6" />
                    <div className="text-[13px] font-medium text-fg">
                      Substitution workflow not yet initialized.
                    </div>
                    <div className="text-[12px]">
                      No SubstitutionRequest records exist in the database yet.
                      The queue will populate once the first substitution is
                      requested.
                    </div>
                  </div>
                </td>
              </tr>
            ) : filteredRows.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-3 py-12 text-center">
                  <div className="mx-auto flex max-w-md flex-col items-center gap-2 text-fg-muted">
                    <Check className="h-6 w-6 text-emerald-600" />
                    <div className="text-[13px] font-medium text-fg">
                      No substitution requests pending your review.
                    </div>
                    <div className="text-[12px]">All caught up.</div>
                  </div>
                </td>
              </tr>
            ) : (
              filteredRows.map((r) => {
                const tone = statusTone(r.status)
                return (
                  <tr
                    key={r.id}
                    className="cursor-pointer border-t border-border transition hover:bg-surface-muted/20"
                    onClick={() => {
                      setDrawerReq(r)
                      setDecisionNote('')
                    }}
                  >
                    <td className="px-3 py-2 font-mono text-[11px] text-fg-muted">
                      {r.id.slice(0, 8)}
                    </td>
                    <td className="px-3 py-2 font-mono">
                      {r.jobNumber ?? r.jobId.slice(0, 8)}
                    </td>
                    <td className="px-3 py-2">
                      {r.builderName ?? (
                        <span className="text-fg-subtle">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1.5 font-mono text-[11.5px]">
                        <span>{r.originalSku ?? '—'}</span>
                        <ChevronRight className="h-3 w-3 text-fg-subtle" />
                        <span>{r.substituteSku ?? '—'}</span>
                      </div>
                      {r.substituteName && (
                        <div
                          className="truncate text-[10.5px] text-fg-subtle"
                          title={r.substituteName}
                        >
                          {r.substituteName}
                        </div>
                      )}
                    </td>
                    <td
                      className={`px-3 py-2 text-right font-mono ${priceDeltaTone(
                        r.priceDelta
                      )}`}
                    >
                      {fmtPriceDelta(r.priceDelta)}
                    </td>
                    <td
                      className="max-w-[220px] truncate px-3 py-2 italic text-fg-muted"
                      title={r.reason ?? ''}
                    >
                      {r.reason ?? '—'}
                    </td>
                    <td
                      className={`px-3 py-2 text-right font-mono ${daysPendingTone(
                        r.daysPending
                      )}`}
                    >
                      {r.daysPending.toFixed(1)}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10.5px] font-medium ${tone.bg} ${tone.fg}`}
                      >
                        {tone.label}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          setDrawerReq(r)
                          setDecisionNote('')
                        }}
                        className="rounded border border-border px-2 py-1 text-[11px] hover:bg-surface-muted/40"
                      >
                        Review
                      </button>
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>

      {/* ── Side drawer ─────────────────────────────────────────────────── */}
      {drawerReq && (
        <ReviewDrawer
          req={drawerReq}
          note={decisionNote}
          onNoteChange={setDecisionNote}
          onClose={closeDrawer}
          onApprove={() => approve(drawerReq, decisionNote)}
          onReject={() => reject(drawerReq, decisionNote, 'REJECT')}
          onRequestInfo={() => reject(drawerReq, decisionNote, 'INFO')}
          submitting={submitting}
        />
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Subcomponents
// ─────────────────────────────────────────────────────────────────────────

function KpiPill({
  label,
  value,
  tone,
}: {
  label: string
  value: number
  tone: 'ok' | 'warn' | 'neutral' | 'idle'
}) {
  const toneClasses = {
    ok: 'border-emerald-200 bg-emerald-50 text-emerald-800',
    warn: 'border-amber-200 bg-amber-50 text-amber-800',
    neutral: 'border-border bg-surface-muted/40 text-fg',
    idle: 'border-border bg-bg text-fg-muted',
  }[tone]
  return (
    <div className={`flex items-center justify-between rounded border px-3 py-2 ${toneClasses}`}>
      <span className="text-[11px] uppercase tracking-wide opacity-70">
        {label}
      </span>
      <span className="text-[18px] font-semibold tabular-nums">{value}</span>
    </div>
  )
}

function ReviewDrawer({
  req,
  note,
  onNoteChange,
  onClose,
  onApprove,
  onReject,
  onRequestInfo,
  submitting,
}: {
  req: QueueRequest
  note: string
  onNoteChange: (v: string) => void
  onClose: () => void
  onApprove: () => void
  onReject: () => void
  onRequestInfo: () => void
  submitting: boolean
}) {
  const tone = statusTone(req.status)
  const canAct = req.status === 'PENDING' || req.status === 'CONDITIONAL'

  return (
    <div
      className="fixed inset-0 z-40 flex justify-end bg-black/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="h-full w-full max-w-md overflow-y-auto border-l border-border bg-bg shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-bg px-4 py-3">
          <div>
            <div className="text-[13px] font-semibold text-fg">
              Substitution request
            </div>
            <div className="font-mono text-[10.5px] text-fg-muted">
              {req.id}
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={submitting}
            className="rounded p-1 hover:bg-surface-muted/40 disabled:opacity-50"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 p-4">
          <DrawerRow label="Status">
            <span
              className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${tone.bg} ${tone.fg}`}
            >
              {tone.label}
            </span>
          </DrawerRow>

          <DrawerRow label="Job">
            <span className="font-mono text-[12px]">
              {req.jobNumber ?? req.jobId.slice(0, 8)}
            </span>
            {req.builderName && (
              <span className="ml-2 text-[11.5px] text-fg-muted">
                · {req.builderName}
              </span>
            )}
          </DrawerRow>

          <DrawerRow label="Original">
            <div className="font-mono text-[12px]">
              {req.originalSku ?? '—'}
            </div>
            {req.originalName && (
              <div className="text-[11px] text-fg-muted">
                {req.originalName}
              </div>
            )}
          </DrawerRow>

          <DrawerRow label="Replacement">
            <div className="font-mono text-[12px]">
              {req.substituteSku ?? '—'}
            </div>
            {req.substituteName && (
              <div className="text-[11px] text-fg-muted">
                {req.substituteName}
              </div>
            )}
          </DrawerRow>

          <div className="grid grid-cols-3 gap-2">
            <DrawerStat label="Qty" value={String(req.quantity)} />
            <DrawerStat
              label="$ delta"
              value={fmtPriceDelta(req.priceDelta)}
              tone={priceDeltaTone(req.priceDelta)}
            />
            <DrawerStat
              label="Days pending"
              value={req.daysPending.toFixed(1)}
              tone={daysPendingTone(req.daysPending)}
            />
          </div>

          {req.compatibility && (
            <DrawerRow label="Compatibility">
              <span className="text-[12px] text-fg-muted">
                {req.compatibility}
              </span>
            </DrawerRow>
          )}

          {req.conditions && (
            <DrawerRow label="Conditions">
              <span className="text-[12px] italic text-fg-muted">
                {req.conditions}
              </span>
            </DrawerRow>
          )}

          <DrawerRow label="Requester">
            <div className="text-[12px]">{req.requesterName ?? '—'}</div>
            {req.requesterEmail && (
              <div className="text-[11px] text-fg-muted">
                {req.requesterEmail}
              </div>
            )}
          </DrawerRow>

          {req.reason && (
            <DrawerRow label="Reason">
              <div className="rounded border border-border bg-surface-muted/20 p-2 text-[12px] leading-relaxed text-fg">
                {req.reason}
              </div>
            </DrawerRow>
          )}

          {req.rejectionNote && (
            <DrawerRow label="Rejection note">
              <div className="rounded border border-red-200 bg-red-50 p-2 text-[12px] leading-relaxed text-red-800">
                {req.rejectionNote}
              </div>
            </DrawerRow>
          )}

          <DrawerRow label="Created">
            <span className="text-[11.5px] text-fg-muted">
              {new Date(req.createdAt).toLocaleString()}
            </span>
          </DrawerRow>

          {req.approvedAt && (
            <DrawerRow label="Decided">
              <span className="text-[11.5px] text-fg-muted">
                {new Date(req.approvedAt).toLocaleString()}
              </span>
            </DrawerRow>
          )}

          {canAct && (
            <div className="space-y-2 border-t border-border pt-3">
              <label className="text-[11.5px] text-fg-muted">
                Decision note
                <span className="text-fg-subtle">
                  {' '}
                  (required for reject or info request)
                </span>
              </label>
              <textarea
                className="w-full rounded border border-border bg-bg px-2 py-1.5 text-[12.5px]"
                rows={3}
                placeholder="e.g. Hinge handing mismatch, or 'Confirm finish code before we apply'"
                value={note}
                onChange={(e) => onNoteChange(e.target.value)}
                disabled={submitting}
              />
            </div>
          )}
        </div>

        {canAct && (
          <div className="sticky bottom-0 flex items-center gap-2 border-t border-border bg-bg px-4 py-3">
            <button
              onClick={onApprove}
              disabled={submitting}
              className="flex-1 rounded border border-emerald-400 bg-emerald-50 px-3 py-1.5 text-[12px] font-medium text-emerald-800 hover:bg-emerald-100 disabled:opacity-50"
            >
              {submitting ? 'Working…' : 'Approve'}
            </button>
            <button
              onClick={onRequestInfo}
              disabled={submitting || !note.trim()}
              className="flex-1 rounded border border-border px-3 py-1.5 text-[12px] font-medium text-fg hover:bg-surface-muted/40 disabled:opacity-50"
              title={!note.trim() ? 'Add a note first' : 'Send info request'}
            >
              Request info
            </button>
            <button
              onClick={onReject}
              disabled={submitting || !note.trim()}
              className="flex-1 rounded border border-red-400 bg-red-50 px-3 py-1.5 text-[12px] font-medium text-red-800 hover:bg-red-100 disabled:opacity-50"
              title={!note.trim() ? 'Add a note first' : 'Reject request'}
            >
              Reject
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function DrawerRow({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div>
      <div className="text-[10.5px] uppercase tracking-wide text-fg-subtle">
        {label}
      </div>
      <div className="mt-0.5">{children}</div>
    </div>
  )
}

function DrawerStat({
  label,
  value,
  tone,
}: {
  label: string
  value: string
  tone?: string
}) {
  return (
    <div className="rounded border border-border bg-surface-muted/20 p-2">
      <div className="text-[10px] uppercase tracking-wide text-fg-subtle">
        {label}
      </div>
      <div
        className={`mt-0.5 font-mono text-[13px] ${
          tone ?? 'text-fg'
        }`}
      >
        {value}
      </div>
    </div>
  )
}
