'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import PageHeader from '@/components/ui/PageHeader'
import EmptyState from '@/components/ui/EmptyState'
import { Badge, getStatusBadgeVariant } from '@/components/ui/Badge'
import { ArrowLeftRight } from 'lucide-react'

interface SubRequest {
  id: string
  jobId: string
  jobNumber: string | null
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
}

type StatusFilter = 'PENDING' | 'APPROVED' | 'REJECTED' | 'APPLIED' | 'ALL'

function StatusBadge({ status }: { status: string }) {
  // APPLIED is a success/done state in this domain; the canonical helper
  // doesn't know it, so map it explicitly. Other statuses go through the helper.
  const variant = status === 'APPLIED' ? 'success' : getStatusBadgeVariant(status)
  return (
    <Badge variant={variant} size="sm">
      {status}
    </Badge>
  )
}

export default function SubstitutionRequestsPage() {
  const [rows, setRows] = useState<SubRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<StatusFilter>('PENDING')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [toast, setToast] = useState<string>('')
  const [rejectTarget, setRejectTarget] = useState<SubRequest | null>(null)
  const [rejectNote, setRejectNote] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(
        `/api/ops/substitutions/requests?status=${filter}`,
        { cache: 'no-store' }
      )
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`)
      setRows(json.requests ?? [])
    } catch (e: any) {
      setToast(e?.message ?? 'Failed to load requests')
    } finally {
      setLoading(false)
    }
  }, [filter])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(''), 4000)
    return () => clearTimeout(t)
  }, [toast])

  const approve = useCallback(
    async (row: SubRequest) => {
      setBusyId(row.id)
      try {
        const res = await fetch(
          `/api/ops/substitutions/requests/${row.id}/approve`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({}),
          }
        )
        const json = await res.json()
        if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`)
        setToast(`Approved · allocation ${json.newAllocation?.id ?? ''}`)
        await load()
      } catch (e: any) {
        setToast(e?.message ?? 'Failed to approve')
      } finally {
        setBusyId(null)
      }
    },
    [load]
  )

  const reject = useCallback(async () => {
    if (!rejectTarget) return
    const note = rejectNote.trim()
    if (!note) {
      setToast('Rejection note is required')
      return
    }
    setBusyId(rejectTarget.id)
    try {
      const res = await fetch(
        `/api/ops/substitutions/requests/${rejectTarget.id}/reject`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ note }),
        }
      )
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`)
      setToast('Rejected — requester notified')
      setRejectTarget(null)
      setRejectNote('')
      await load()
    } catch (e: any) {
      setToast(e?.message ?? 'Failed to reject')
    } finally {
      setBusyId(null)
    }
  }, [rejectTarget, rejectNote, load])

  const counts = useMemo(() => {
    const c = { PENDING: 0, APPROVED: 0, REJECTED: 0, APPLIED: 0 }
    for (const r of rows) {
      if ((c as any)[r.status] != null) (c as any)[r.status]++
    }
    return c
  }, [rows])

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      <PageHeader
        title="Substitution Approval Queue"
        description="CONDITIONAL substitutes wait here for PM approval before inventory is re-allocated."
        crumbs={[
          { label: 'Ops', href: '/ops' },
          { label: 'Substitutions', href: '/ops/substitutions' },
          { label: 'Requests' },
        ]}
        actions={
          <button
            onClick={load}
            className="px-3 py-1.5 text-[12px] border border-border rounded hover:bg-surface-muted/40"
          >
            Refresh
          </button>
        }
      />

      <div className="flex gap-2 mb-3">
        {(
          ['PENDING', 'APPROVED', 'APPLIED', 'REJECTED', 'ALL'] as StatusFilter[]
        ).map((s) => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className={`px-3 py-1.5 text-[12px] rounded border transition ${
              filter === s
                ? 'border-fg bg-fg text-fg-inverse'
                : 'border-border hover:border-fg-muted hover:bg-surface-muted/40'
            }`}
          >
            {s}
            {filter === s && s !== 'ALL' && (
              <span className="ml-1.5 text-[10.5px] opacity-80">
                ({counts[s as keyof typeof counts] ?? 0})
              </span>
            )}
          </button>
        ))}
      </div>

      {toast && (
        <div className="mb-3 px-3 py-2 text-[12px] bg-surface-muted/40 border border-border rounded">
          {toast}
        </div>
      )}

      <div className="border border-border rounded-lg overflow-hidden">
        <table className="w-full text-[12px]">
          <thead className="bg-surface-muted/40">
            <tr className="text-left text-fg-muted">
              <th className="px-3 py-2 font-medium">Job</th>
              <th className="px-3 py-2 font-medium">Original SKU</th>
              <th className="px-3 py-2 font-medium">→ Substitute</th>
              <th className="px-3 py-2 font-medium text-right">Qty</th>
              <th className="px-3 py-2 font-medium text-right">Δ cost</th>
              <th className="px-3 py-2 font-medium">Conditions</th>
              <th className="px-3 py-2 font-medium">Requester</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={9} className="px-3 py-6 text-center text-fg-muted">
                  Loading…
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-3 py-6">
                  <EmptyState
                    size="compact"
                    icon={<ArrowLeftRight className="w-6 h-6 text-fg-subtle" />}
                    title="No requests"
                    description={`No ${filter.toLowerCase()} substitution requests.`}
                  />
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr
                  key={r.id}
                  className="border-t border-border hover:bg-row-hover transition-colors"
                >
                  <td className="px-3 py-2">
                    <a
                      href={`/ops/jobs/${r.jobId}`}
                      className="text-fg hover:underline font-mono"
                    >
                      {r.jobNumber ?? r.jobId.slice(0, 8)}
                    </a>
                    {r.builderName && (
                      <div className="text-fg-subtle text-[10.5px]">
                        {r.builderName}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2 font-mono">
                    {r.originalSku ?? '—'}
                    {r.originalName && (
                      <div
                        className="text-fg-subtle text-[10.5px] truncate max-w-[200px]"
                        title={r.originalName}
                      >
                        {r.originalName}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2 font-mono">
                    {r.substituteSku ?? '—'}
                    {r.substituteName && (
                      <div
                        className="text-fg-subtle text-[10.5px] truncate max-w-[200px]"
                        title={r.substituteName}
                      >
                        {r.substituteName}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right font-mono">
                    {r.quantity}
                  </td>
                  <td className="px-3 py-2 text-right font-mono">
                    {r.priceDelta == null
                      ? '—'
                      : `${r.priceDelta >= 0 ? '+' : ''}${r.priceDelta.toFixed(
                          2
                        )}`}
                  </td>
                  <td
                    className="px-3 py-2 text-fg-muted italic truncate max-w-[240px]"
                    title={r.conditions ?? undefined}
                  >
                    {r.conditions ?? '—'}
                  </td>
                  <td className="px-3 py-2">
                    <div>{r.requesterName ?? '—'}</div>
                    {r.reason && (
                      <div
                        className="text-fg-subtle text-[10.5px] truncate max-w-[200px]"
                        title={r.reason}
                      >
                        {r.reason}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <StatusBadge status={r.status} />
                    {r.status === 'REJECTED' && r.rejectionNote && (
                      <div
                        className="text-fg-subtle text-[10.5px] mt-0.5 truncate max-w-[180px]"
                        title={r.rejectionNote}
                      >
                        {r.rejectionNote}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {r.status === 'PENDING' ? (
                      <div className="flex gap-1">
                        <button
                          className="px-2 py-1 text-[11px] rounded border border-data-positive/40 text-data-positive-fg hover:bg-data-positive-bg disabled:opacity-50"
                          disabled={busyId === r.id}
                          onClick={() => approve(r)}
                        >
                          {busyId === r.id ? '…' : 'Approve'}
                        </button>
                        <button
                          className="px-2 py-1 text-[11px] rounded border border-data-negative/40 text-data-negative-fg hover:bg-data-negative-bg disabled:opacity-50"
                          disabled={busyId === r.id}
                          onClick={() => {
                            setRejectTarget(r)
                            setRejectNote('')
                          }}
                        >
                          Reject
                        </button>
                      </div>
                    ) : (
                      <span className="text-fg-subtle text-[10.5px]">—</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Rejection modal */}
      {rejectTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
          onClick={() => {
            if (!busyId) setRejectTarget(null)
          }}
        >
          <div
            className="bg-surface border border-border rounded-lg shadow-xl w-[480px] max-w-[92vw]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-4 py-3 border-b border-border">
              <div className="text-[14px] font-medium text-fg">
                Reject substitution request
              </div>
              <div className="text-[11.5px] text-fg-muted">
                {rejectTarget.originalSku} → {rejectTarget.substituteSku} on
                Job {rejectTarget.jobNumber}
              </div>
            </div>
            <div className="p-4">
              <label className="text-[11.5px] text-fg-muted">
                Reason (sent to requester)
              </label>
              <textarea
                className="w-full mt-1 border border-border rounded px-2 py-1.5 text-[12.5px] bg-surface"
                rows={4}
                value={rejectNote}
                onChange={(e) => setRejectNote(e.target.value)}
                placeholder="e.g. Hinge handing mismatch, won't work on this plan"
              />
            </div>
            <div className="flex justify-end gap-2 px-4 py-3 border-t border-border">
              <button
                className="px-3 py-1.5 text-[12px] rounded border border-border hover:bg-surface-muted/40"
                disabled={!!busyId}
                onClick={() => setRejectTarget(null)}
              >
                Cancel
              </button>
              <button
                className="px-3 py-1.5 text-[12px] rounded border border-data-negative/50 text-data-negative-fg hover:bg-data-negative-bg disabled:opacity-50"
                disabled={!!busyId || !rejectNote.trim()}
                onClick={reject}
              >
                {busyId ? 'Rejecting…' : 'Reject request'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
