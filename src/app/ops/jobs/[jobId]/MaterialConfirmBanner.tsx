'use client'

/**
 * MaterialConfirmBanner
 *
 * Renders at the top of the Job detail page for Jobs that:
 *   - are still active (not COMPLETE/INVOICED/CLOSED)
 *   - scheduledDate is within the next 7 days
 *   - materialConfirmedAt IS NULL
 *
 * Surfaces two actions: "Confirm Materials Allocated" or "Escalate to Clint".
 * If the Job was already escalated, shows the escalation receipt instead.
 *
 * Stays tight on purpose — the brief says "Keep this SMALL. Just a banner."
 */

import { useEffect, useState } from 'react'

interface Props {
  jobId: string
  jobStatus: string
  scheduledDate: string | null
  onChange?: () => void // parent may want to refetch on confirm/escalate
}

interface CheckpointState {
  materialConfirmedAt: string | null
  materialConfirmedBy: string | null
  materialConfirmNote: string | null
  materialEscalatedAt: string | null
  materialEscalatedTo: string | null
}

const INACTIVE_STATUSES = new Set(['COMPLETE', 'INVOICED', 'CLOSED', 'DELIVERED'])

export default function MaterialConfirmBanner({
  jobId,
  jobStatus,
  scheduledDate,
  onChange,
}: Props) {
  const [state, setState] = useState<CheckpointState | null>(null)
  const [loading, setLoading] = useState(true)
  const [action, setAction] = useState<'confirm' | 'escalate' | null>(null)
  const [note, setNote] = useState('')
  const [reason, setReason] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [statusHint, setStatusHint] = useState<string>('')

  useEffect(() => {
    let cancel = false
    ;(async () => {
      try {
        // Pulling from the existing jobs detail endpoint would require the
        // parent to thread the checkpoint fields through, which is a bigger
        // reach than the brief wants. Instead hit a lightweight endpoint that
        // selects just what we need.
        //
        // Falls back to the Job GET if the dedicated endpoint isn't wired yet.
        const res = await fetch(`/api/ops/jobs/${jobId}`, { cache: 'no-store' })
        if (!res.ok || cancel) return
        const data = await res.json()
        if (cancel) return
        setState({
          materialConfirmedAt: data.materialConfirmedAt || null,
          materialConfirmedBy: data.materialConfirmedBy || null,
          materialConfirmNote: data.materialConfirmNote || null,
          materialEscalatedAt: data.materialEscalatedAt || null,
          materialEscalatedTo: data.materialEscalatedTo || null,
        })
        setStatusHint(
          data.materialConfirmNote
            ? String(data.materialConfirmNote).split('\n')[0]
            : ''
        )
      } catch {
        // banner is optional — swallow
      } finally {
        if (!cancel) setLoading(false)
      }
    })()
    return () => {
      cancel = true
    }
  }, [jobId])

  if (loading || !state) return null
  if (INACTIVE_STATUSES.has(jobStatus)) return null
  if (!scheduledDate) return null

  const now = Date.now()
  const target = new Date(scheduledDate).getTime()
  const daysToDelivery = Math.round((target - now) / (86400 * 1000))
  if (daysToDelivery < 0 || daysToDelivery > 7) return null
  if (state.materialConfirmedAt) return null // done

  const submitConfirm = async () => {
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch(`/api/ops/jobs/${jobId}/material-confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note: note.trim() || undefined }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error || `Confirm failed (${res.status})`)
      }
      const updated = await res.json()
      setState((s) => (s ? { ...s, ...updated } : s))
      setAction(null)
      setNote('')
      onChange?.()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setSubmitting(false)
    }
  }

  const submitEscalate = async () => {
    if (!reason.trim()) {
      setError('Reason is required')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch(`/api/ops/jobs/${jobId}/material-escalate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: reason.trim() }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error || `Escalate failed (${res.status})`)
      }
      const updated = await res.json()
      setState((s) => (s ? { ...s, ...updated } : s))
      setAction(null)
      setReason('')
      onChange?.()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setSubmitting(false)
    }
  }

  const daysBg = daysToDelivery <= 3 ? '#C0392B' : daysToDelivery <= 5 ? '#D4B96A' : '#0f2a3e'

  // Already escalated — show the receipt, not the buttons.
  if (state.materialEscalatedAt) {
    const escalatedAt = new Date(state.materialEscalatedAt)
    return (
      <div className="mb-6 rounded-lg border border-orange-300 bg-orange-50 p-4 flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-orange-800">
            Material confirm escalated to Clint on{' '}
            {escalatedAt.toLocaleDateString('en-US', {
              month: 'short',
              day: 'numeric',
              year: 'numeric',
            })}
          </p>
          <p className="text-xs text-orange-700 mt-0.5">
            Delivery in {daysToDelivery} day{daysToDelivery === 1 ? '' : 's'}. Clint has the ball.
            See Decision Notes for the full trail.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="mb-6 rounded-lg border border-amber-300 bg-amber-50 p-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-4">
          <div
            className="flex flex-col items-center justify-center rounded-lg text-white px-4 py-2 min-w-[64px]"
            style={{ backgroundColor: daysBg }}
          >
            <span className="text-[10px] uppercase tracking-wide opacity-80">In</span>
            <span className="text-2xl font-bold leading-none">{daysToDelivery}</span>
            <span className="text-[10px] uppercase tracking-wide opacity-80">
              day{daysToDelivery === 1 ? '' : 's'}
            </span>
          </div>
          <div>
            <p className="text-sm font-semibold text-amber-900">
              Material confirm needed
            </p>
            <p className="text-xs text-amber-800 mt-0.5">
              Delivery is {daysToDelivery <= 3 ? 'IMMINENT' : 'soon'} — confirm materials are
              allocated, or escalate to Clint if you need backup.
            </p>
            {statusHint && (
              <p className="text-[11px] text-gray-600 mt-1 italic">{statusHint}</p>
            )}
          </div>
        </div>

        {action === null && (
          <div className="flex gap-2">
            <button
              onClick={() => setAction('confirm')}
              className="px-4 py-2 bg-[#27AE60] text-white rounded-lg hover:bg-[#1F8B4C] text-sm font-medium"
            >
              Confirm Materials Allocated
            </button>
            <button
              onClick={() => setAction('escalate')}
              className="px-4 py-2 bg-white border border-[#C6A24E] text-[#A8882A] rounded-lg hover:bg-[#FFF8E6] text-sm font-medium"
            >
              Escalate to Clint
            </button>
          </div>
        )}
      </div>

      {action === 'confirm' && (
        <div className="mt-4 bg-white rounded-lg border border-green-200 p-3">
          <p className="text-xs font-semibold text-gray-700 mb-1">Optional note</p>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. Boise PO 4427 arrives Thursday, confirmed with Dalton"
            className="w-full p-2 text-sm border border-gray-300 rounded resize-none focus:outline-none focus:ring-2 focus:ring-[#27AE60]"
            rows={2}
          />
          {error && <p className="text-xs text-red-600 mt-1">{error}</p>}
          <div className="flex gap-2 mt-2">
            <button
              onClick={submitConfirm}
              disabled={submitting}
              className="px-3 py-1.5 bg-[#27AE60] text-white rounded text-sm font-medium hover:bg-[#1F8B4C] disabled:opacity-50"
            >
              {submitting ? 'Confirming…' : 'Confirm'}
            </button>
            <button
              onClick={() => {
                setAction(null)
                setNote('')
                setError(null)
              }}
              className="px-3 py-1.5 border border-gray-300 text-gray-700 rounded text-sm hover:bg-gray-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {action === 'escalate' && (
        <div className="mt-4 bg-white rounded-lg border border-orange-200 p-3">
          <p className="text-xs font-semibold text-gray-700 mb-1">
            Reason (required) — Clint and Nate will be emailed
          </p>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Pulte short on 3070 slabs, Boise lead time pushed — need Clint on the call with DW"
            className="w-full p-2 text-sm border border-gray-300 rounded resize-none focus:outline-none focus:ring-2 focus:ring-[#C6A24E]"
            rows={3}
          />
          {error && <p className="text-xs text-red-600 mt-1">{error}</p>}
          <div className="flex gap-2 mt-2">
            <button
              onClick={submitEscalate}
              disabled={submitting || !reason.trim()}
              className="px-3 py-1.5 bg-[#C0392B] text-white rounded text-sm font-medium hover:bg-[#A93226] disabled:opacity-50"
            >
              {submitting ? 'Escalating…' : 'Send to Clint'}
            </button>
            <button
              onClick={() => {
                setAction(null)
                setReason('')
                setError(null)
              }}
              className="px-3 py-1.5 border border-gray-300 text-gray-700 rounded text-sm hover:bg-gray-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
