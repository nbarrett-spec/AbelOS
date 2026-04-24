'use client'

import { useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, Send, Loader2, AlertTriangle, CheckCircle2 } from 'lucide-react'
import RecommendationRow, { type Recommendation, type Priority } from './RecommendationRow'

export interface VendorInfo {
  id: string
  name: string | null
  code: string | null
  avgLeadDays: number | null
  creditHold: boolean
  paymentTerms: string | null
}

export interface VendorGroupData {
  vendor: VendorInfo
  recs: Recommendation[]
  totals: {
    count: number
    amount: number
    priorityCounts: { HIGH: number; MEDIUM: number; LOW: number }
  }
}

interface Props {
  group: VendorGroupData
  initiallyOpen?: boolean
  onRecShipped: (recId: string, poId: string) => void
  onRecSkipped: (recId: string) => void
  onRecHold: (recId: string) => void
  selected: Set<string>
  onToggleRec: (recId: string) => void
  onSelectAllForVendor: (vendorId: string, select: boolean) => void
}

function fmt$(v: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(v || 0)
}

export default function VendorGroup({
  group,
  initiallyOpen = true,
  onRecShipped,
  onRecSkipped,
  onRecHold,
  selected,
  onToggleRec,
  onSelectAllForVendor,
}: Props) {
  const [open, setOpen] = useState(initiallyOpen)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<
    | null
    | { kind: 'ok'; shipped: number; poIds: string[]; skipped: number }
    | { kind: 'err'; message: string }
  >(null)

  const { vendor, recs, totals } = group

  const hotBadge = totals.priorityCounts.HIGH > 0
  const localSelectedCount = useMemo(
    () => recs.reduce((n, r) => n + (selected.has(r.id) ? 1 : 0), 0),
    [recs, selected]
  )
  const allLocalSelected = recs.length > 0 && localSelectedCount === recs.length

  async function shipAll() {
    setBusy(true)
    setResult(null)
    try {
      const res = await fetch('/api/ops/smartpo/ship', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'all_for_vendor', vendorId: vendor.id }),
      })
      const json = await res.json()
      if (!res.ok || !json.ok) {
        throw new Error(json?.error || `HTTP ${res.status}`)
      }
      setResult({
        kind: 'ok',
        shipped: json.shipped ?? 0,
        skipped: json.skipped ?? 0,
        poIds: json.poIds ?? [],
      })
      // Mark every rec in this group as shipped so the UI collapses
      for (const r of recs) onRecShipped(r.id, (json.poIds && json.poIds[0]) || '')
    } catch (e: any) {
      setResult({ kind: 'err', message: e?.message || String(e) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="rounded-xl border border-border bg-surface/60 overflow-hidden">
      {/* ── Vendor header ──────────────────────────────────────────────── */}
      <header
        className="flex items-center gap-3 px-4 py-3 border-b border-border bg-gradient-to-r from-surface to-surface-muted"
        style={{
          borderLeft: hotBadge ? '4px solid var(--c1)' : '4px solid var(--c3)',
        }}
      >
        <button
          onClick={() => setOpen((o) => !o)}
          className="p-1 rounded hover:bg-white/[0.04] text-fg-subtle hover:text-fg transition-colors"
          aria-label={open ? 'Collapse vendor' : 'Expand vendor'}
        >
          {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </button>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="text-[14px] font-semibold text-fg truncate">
              {vendor.name || vendor.id}
            </h3>
            {vendor.code && (
              <span className="text-[10px] font-mono text-fg-subtle uppercase">
                {vendor.code}
              </span>
            )}
            {vendor.creditHold && (
              <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-data-negative-bg text-data-negative">
                <AlertTriangle className="w-3 h-3" />
                Credit hold
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-0.5 text-[11px] text-fg-subtle mt-0.5">
            <span>
              <span className="font-mono font-semibold text-fg">{totals.count}</span> recs
            </span>
            <span>
              <span className="font-mono font-semibold text-fg">{fmt$(totals.amount)}</span> total
            </span>
            {totals.priorityCounts.HIGH > 0 && (
              <span className="text-c1 font-semibold">
                {totals.priorityCounts.HIGH} HIGH
              </span>
            )}
            {totals.priorityCounts.MEDIUM > 0 && (
              <span>{totals.priorityCounts.MEDIUM} MED</span>
            )}
            {totals.priorityCounts.LOW > 0 && (
              <span>{totals.priorityCounts.LOW} LOW</span>
            )}
            {vendor.avgLeadDays != null && (
              <span>avg {vendor.avgLeadDays}d lead</span>
            )}
            {vendor.paymentTerms && <span>{vendor.paymentTerms}</span>}
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <label className="inline-flex items-center gap-1.5 text-[11px] text-fg-subtle cursor-pointer">
            <input
              type="checkbox"
              checked={allLocalSelected}
              onChange={(e) => onSelectAllForVendor(vendor.id, e.target.checked)}
            />
            Select all
          </label>
          <button
            onClick={shipAll}
            disabled={busy || recs.length === 0}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-semibold rounded-md text-white shadow-sm disabled:opacity-40 transition-opacity"
            style={{
              background: hotBadge
                ? 'linear-gradient(135deg, var(--c1), var(--c2))'
                : 'var(--c2)',
            }}
            title="Ship every pending rec for this vendor — creates a single draft PO"
          >
            {busy ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Send className="w-3.5 h-3.5" />
            )}
            Ship All ({totals.count})
          </button>
        </div>
      </header>

      {result && result.kind === 'ok' && (
        <div className="px-4 py-2 text-[11px] bg-data-positive-bg/40 text-data-positive flex items-center gap-2 border-b border-border">
          <CheckCircle2 className="w-3.5 h-3.5" />
          Shipped {result.shipped} rec(s) → {result.poIds.length} PO(s) created
          {result.skipped > 0 ? ` · ${result.skipped} already-shipped skipped (idempotent)` : ''}
        </div>
      )}
      {result && result.kind === 'err' && (
        <div className="px-4 py-2 text-[11px] bg-data-negative-bg/40 text-data-negative flex items-center gap-2 border-b border-border">
          <AlertTriangle className="w-3.5 h-3.5" />
          {result.message}
        </div>
      )}

      {/* ── Rows ───────────────────────────────────────────────────────── */}
      {open && recs.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead className="bg-surface-muted/40 border-b border-border">
              <tr className="text-left text-[10px] uppercase tracking-wider text-fg-subtle">
                <th className="px-3 py-2 w-8"></th>
                <th className="px-3 py-2">SKU · Description</th>
                <th className="px-3 py-2 text-right">Qty</th>
                <th className="px-3 py-2 text-right">Unit</th>
                <th className="px-3 py-2 text-right">Line Total</th>
                <th className="px-3 py-2">Lead</th>
                <th className="px-3 py-2">Order By</th>
                <th className="px-3 py-2">Source Jobs</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {recs.map((r) => (
                <RecommendationRow
                  key={r.id}
                  rec={r}
                  onShipped={onRecShipped}
                  onSkipped={onRecSkipped}
                  onHold={onRecHold}
                  checked={selected.has(r.id)}
                  onToggle={onToggleRec}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
