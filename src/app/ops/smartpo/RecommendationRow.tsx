'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Send, PauseCircle, X, ExternalLink, Loader2, Check } from 'lucide-react'

export type Priority = 'HIGH' | 'MEDIUM' | 'LOW'

export interface SourceJob {
  id: string
  jobNumber: string | null
  builderName: string | null
  community: string | null
  scheduledDate: string | null
}

export interface Recommendation {
  id: string
  sku: string | null
  productId: string | null
  productName: string | null
  productCategory: string | null
  urgency: string
  priority: Priority
  recommendedQty: number
  unitCost: number
  lineTotal: number
  leadTimeDays: number | null
  orderByDate: string | null
  targetDeliveryDate: string | null
  triggerReason: string
  aiReasoning: string | null
  sourceJobs: SourceJob[]
  createdAt: string
}

interface Props {
  rec: Recommendation
  onShipped: (recId: string, poId: string) => void
  onSkipped: (recId: string) => void
  onHold: (recId: string) => void
  checked: boolean
  onToggle: (recId: string) => void
}

function fmt$(v: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(v || 0)
}

function fmtQty(v: number): string {
  return new Intl.NumberFormat('en-US').format(v || 0)
}

function daysFromNow(iso: string | null): number | null {
  if (!iso) return null
  const diff = new Date(iso).getTime() - Date.now()
  return Math.floor(diff / 86_400_000)
}

/** Left border color per priority — Blueprint palette. */
function priorityBorder(p: Priority): string {
  if (p === 'HIGH') return '3px solid var(--c1)' // indigo-600 anchor
  if (p === 'MEDIUM') return '3px solid var(--c2)'
  return '3px solid var(--c4)' // slate-300 anchor
}

export default function RecommendationRow({
  rec,
  onShipped,
  onSkipped,
  onHold,
  checked,
  onToggle,
}: Props) {
  const [busy, setBusy] = useState<null | 'ship' | 'hold' | 'skip'>(null)
  const [doneState, setDoneState] = useState<null | 'shipped' | 'held' | 'skipped'>(null)
  const [err, setErr] = useState<string | null>(null)

  const due = daysFromNow(rec.orderByDate)
  const dueTone =
    due == null
      ? 'text-fg-subtle'
      : due < 0
        ? 'text-data-negative'
        : due < 3
          ? 'text-data-negative'
          : due < 7
            ? 'text-data-warning'
            : 'text-fg-subtle'

  async function ship() {
    setBusy('ship')
    setErr(null)
    try {
      const res = await fetch('/api/ops/smartpo/ship', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'one', recommendationIds: [rec.id] }),
      })
      const json = await res.json()
      if (!res.ok || !json.ok) {
        throw new Error(json?.error || `HTTP ${res.status}`)
      }
      const poId = (json.poIds && json.poIds[0]) || ''
      setDoneState('shipped')
      onShipped(rec.id, poId)
    } catch (e: any) {
      setErr(e?.message || String(e))
    } finally {
      setBusy(null)
    }
  }

  async function hold() {
    setBusy('hold')
    setErr(null)
    try {
      // Optimistic — we don't have a dedicated hold endpoint wired in this
      // scope. Reflect it in the UI and let the parent track it so the row
      // disappears if the "Hide on hold" filter is on.
      setDoneState('held')
      onHold(rec.id)
    } catch (e: any) {
      setErr(e?.message || String(e))
    } finally {
      setBusy(null)
    }
  }

  async function skip() {
    setBusy('skip')
    setErr(null)
    try {
      setDoneState('skipped')
      onSkipped(rec.id)
    } catch (e: any) {
      setErr(e?.message || String(e))
    } finally {
      setBusy(null)
    }
  }

  if (doneState === 'shipped') {
    return (
      <tr className="border-t border-border bg-data-positive-bg/30 opacity-70">
        <td colSpan={9} className="px-3 py-2 text-[11px] text-data-positive flex items-center gap-2">
          <Check className="w-3.5 h-3.5" />
          Shipped — PO created for <span className="font-mono">{rec.sku}</span>
        </td>
      </tr>
    )
  }
  if (doneState === 'held' || doneState === 'skipped') {
    return (
      <tr className="border-t border-border opacity-40">
        <td colSpan={9} className="px-3 py-2 text-[11px] text-fg-subtle">
          {doneState === 'held' ? 'Put on hold' : 'Skipped'} — <span className="font-mono">{rec.sku}</span>
        </td>
      </tr>
    )
  }

  return (
    <tr
      className="border-t border-border hover:bg-surface-muted/40 transition-colors"
      style={{ borderLeft: priorityBorder(rec.priority) }}
    >
      <td className="px-3 py-2 align-top">
        <input
          type="checkbox"
          checked={checked}
          onChange={() => onToggle(rec.id)}
          aria-label={`Select ${rec.sku ?? rec.id}`}
          className="mt-1"
        />
      </td>

      <td className="px-3 py-2 align-top min-w-[180px]">
        <div className="font-mono text-[12px] text-fg">{rec.sku ?? '—'}</div>
        <div className="text-[11px] text-fg-subtle line-clamp-2 max-w-[280px]">
          {rec.productName || rec.triggerReason}
        </div>
        {rec.productCategory && (
          <div className="text-[10px] text-fg-subtle/80 uppercase tracking-wider mt-0.5">
            {rec.productCategory}
          </div>
        )}
      </td>

      <td className="px-3 py-2 align-top text-right font-mono text-[12px]">
        {fmtQty(rec.recommendedQty)}
      </td>

      <td className="px-3 py-2 align-top text-right font-mono text-[12px] text-fg-subtle">
        {fmt$(rec.unitCost)}
      </td>

      <td className="px-3 py-2 align-top text-right font-mono text-[12px] font-semibold text-fg">
        {fmt$(rec.lineTotal)}
      </td>

      <td className="px-3 py-2 align-top text-[11px]">
        {rec.leadTimeDays != null ? (
          <span className="font-mono">{rec.leadTimeDays}d</span>
        ) : (
          <span className="text-fg-subtle">—</span>
        )}
      </td>

      <td className="px-3 py-2 align-top text-[11px]">
        {rec.orderByDate ? (
          <>
            <div className="font-mono">{new Date(rec.orderByDate).toISOString().slice(0, 10)}</div>
            <div className={`text-[10px] ${dueTone}`}>
              {due == null ? '—' : due < 0 ? `${Math.abs(due)}d overdue` : `in ${due}d`}
            </div>
          </>
        ) : (
          <span className="text-fg-subtle">—</span>
        )}
      </td>

      <td className="px-3 py-2 align-top">
        <div className="flex flex-wrap gap-1 max-w-[220px]">
          {(rec.sourceJobs || []).slice(0, 3).map((j) => (
            <Link
              key={j.id}
              href={`/ops/jobs/${j.id}`}
              className="inline-flex items-center gap-1 text-[10px] font-mono px-1.5 py-0.5 rounded border border-border hover:border-c1 hover:text-c1 transition-colors"
            >
              {j.jobNumber || j.id.slice(0, 6)}
              <ExternalLink className="w-2.5 h-2.5" />
            </Link>
          ))}
          {rec.sourceJobs && rec.sourceJobs.length > 3 && (
            <span className="text-[10px] text-fg-subtle">+{rec.sourceJobs.length - 3}</span>
          )}
          {(!rec.sourceJobs || rec.sourceJobs.length === 0) && (
            <span className="text-[10px] text-fg-subtle">—</span>
          )}
        </div>
        {rec.sourceJobs?.[0]?.builderName && (
          <div className="text-[10px] text-fg-subtle mt-0.5 truncate max-w-[220px]">
            {rec.sourceJobs[0].builderName}
            {rec.sourceJobs[0].community ? ` · ${rec.sourceJobs[0].community}` : ''}
          </div>
        )}
      </td>

      <td className="px-3 py-2 align-top">
        <div className="flex items-center gap-1 justify-end">
          <button
            onClick={ship}
            disabled={busy !== null}
            className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-semibold rounded bg-c1 text-white hover:opacity-90 disabled:opacity-40 transition-opacity"
            title="Ship this line — creates an Aegis PO draft"
          >
            {busy === 'ship' ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <Send className="w-3 h-3" />
            )}
            Ship
          </button>
          <button
            onClick={hold}
            disabled={busy !== null}
            className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-semibold rounded border border-border hover:border-c2 hover:text-c2 transition-colors disabled:opacity-40"
            title="Hold — exclude from this push"
          >
            <PauseCircle className="w-3 h-3" />
            Hold
          </button>
          <button
            onClick={skip}
            disabled={busy !== null}
            className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-semibold rounded border border-border hover:border-data-negative hover:text-data-negative transition-colors disabled:opacity-40"
            title="Skip — remove from queue"
          >
            <X className="w-3 h-3" />
            Skip
          </button>
        </div>
        {err && <div className="text-[10px] text-data-negative mt-1 text-right">{err}</div>}
      </td>
    </tr>
  )
}
