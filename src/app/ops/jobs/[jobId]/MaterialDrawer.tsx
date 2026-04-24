'use client'

// ──────────────────────────────────────────────────────────────────────
// MaterialDrawer — right-slide drawer that drills into the material
// picture for a single Job. Fetches /api/ops/jobs/[jobId]/materials and
// renders a per-SKU table: needed / on-hand / incoming (from open POs)
// / short, with the earliest expected date for the next incoming PO and
// a jump-link to the first open PO per line.
//
// Rows with short > 0 get a red left border so shortages read at a
// glance without scanning the numbers column.
//
// Feature-flagged via NEXT_PUBLIC_FEATURE_MATERIAL_DRAWER.
//   'off' → render null (parent still mounts the component, flag kills it).
//   anything else → render on.
//
// Read-only. No mutations, no audit entries.
// ──────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useMemo, useState } from 'react'

export interface MaterialDrawerProps {
  jobId: string
  open: boolean
  onClose: () => void
}

interface OpenPO {
  poId: string
  poNumber: string
  qty: number
  expectedDate: string | null
}

interface MaterialItem {
  productId: string
  sku: string | null
  description: string | null
  needed: number
  onHand: number
  incoming: number
  short: number
  expectedDate: string | null
  unitCost: number
  openPOs: OpenPO[]
}

interface MaterialsResponse {
  jobId: string
  asOf: string
  items: MaterialItem[]
  summary: {
    totalSkus: number
    shortSkus: number
    shortageDollars: number
  }
}

type LoadState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; data: MaterialsResponse }
  | { status: 'error'; message: string }

function isFeatureEnabled(): boolean {
  const flag = process.env.NEXT_PUBLIC_FEATURE_MATERIAL_DRAWER
  if (flag === 'off') return false
  // Default: ON.
  return true
}

function formatCurrency(n: number | null | undefined): string {
  if (n == null || isNaN(Number(n))) return '—'
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(Number(n))
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function formatRelative(iso: string | null | undefined): string {
  if (!iso) return ''
  const t = new Date(iso).getTime()
  if (isNaN(t)) return ''
  const diff = Date.now() - t
  if (Math.abs(diff) < 60_000) return 'just now'
  if (diff < 0) {
    const mins = Math.floor(-diff / 60_000)
    if (mins < 60) return `in ${mins}m`
    const hrs = Math.floor(mins / 60)
    if (hrs < 24) return `in ${hrs}h`
    const days = Math.floor(hrs / 24)
    return `in ${days}d`
  }
  const mins = Math.floor(diff / 60_000)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  return `${days}d ago`
}

export default function MaterialDrawer({
  jobId,
  open,
  onClose,
}: MaterialDrawerProps) {
  const [state, setState] = useState<LoadState>({ status: 'idle' })

  const fetchMaterials = useCallback(async () => {
    setState({ status: 'loading' })
    try {
      const res = await fetch(
        `/api/ops/jobs/${encodeURIComponent(jobId)}/materials`,
        { cache: 'no-store' },
      )
      if (!res.ok) {
        setState({
          status: 'error',
          message: `Request failed (${res.status}).`,
        })
        return
      }
      const json = (await res.json()) as MaterialsResponse
      setState({ status: 'ready', data: json })
    } catch (err: any) {
      setState({
        status: 'error',
        message: err?.message || 'Network error while loading materials.',
      })
    }
  }, [jobId])

  // Fetch each time the drawer opens. Close → reset to idle (re-fetch next open).
  useEffect(() => {
    if (!isFeatureEnabled()) return
    if (!open) {
      setState({ status: 'idle' })
      return
    }
    if (!jobId) return
    fetchMaterials()
  }, [open, jobId, fetchMaterials])

  // Lock body scroll while open.
  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prev
      document.removeEventListener('keydown', onKey)
    }
  }, [open, onClose])

  if (!isFeatureEnabled()) return null
  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex"
      role="dialog"
      aria-modal="true"
      aria-label="Material snapshot"
    >
      <div
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
        aria-label="Close material drawer"
      />
      <div className="relative ml-auto h-full w-full max-w-4xl bg-white shadow-2xl flex flex-col">
        <DrawerHeader
          state={state}
          onRefresh={fetchMaterials}
          onClose={onClose}
        />
        <div className="flex-1 overflow-y-auto">
          <DrawerBody state={state} onRetry={fetchMaterials} />
        </div>
      </div>
    </div>
  )
}

function DrawerHeader({
  state,
  onRefresh,
  onClose,
}: {
  state: LoadState
  onRefresh: () => void
  onClose: () => void
}) {
  const summary = state.status === 'ready' ? state.data.summary : null
  const asOf = state.status === 'ready' ? state.data.asOf : null
  return (
    <div className="flex items-start justify-between gap-3 p-5 border-b border-gray-200">
      <div className="min-w-0">
        <h2 className="text-lg font-semibold text-gray-900">Materials</h2>
        <p className="text-xs text-gray-500 mt-0.5">
          {state.status === 'loading'
            ? 'Loading…'
            : state.status === 'ready' && asOf
              ? `Snapshot as of ${formatRelative(asOf)}`
              : 'Needed / on hand / incoming per SKU.'}
        </p>
        {summary && (
          <div className="mt-3 flex flex-wrap items-center gap-4 text-xs">
            <SummaryStat label="Total SKUs" value={summary.totalSkus.toString()} />
            <SummaryStat
              label="Short SKUs"
              value={summary.shortSkus.toString()}
              tone={summary.shortSkus > 0 ? 'bad' : 'ok'}
            />
            <SummaryStat
              label="Shortage value"
              value={formatCurrency(summary.shortageDollars)}
              tone={summary.shortageDollars > 0 ? 'bad' : 'ok'}
            />
          </div>
        )}
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onRefresh}
          disabled={state.status === 'loading'}
          className="px-3 py-1.5 text-xs rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 font-medium disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Refresh
        </button>
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-gray-600 text-2xl leading-none px-2"
          aria-label="Close"
        >
          ×
        </button>
      </div>
    </div>
  )
}

function SummaryStat({
  label,
  value,
  tone = 'ok',
}: {
  label: string
  value: string
  tone?: 'ok' | 'bad'
}) {
  const valueColor = tone === 'bad' ? 'text-[#C0392B]' : 'text-[#0f2a3e]'
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="text-[10px] uppercase tracking-wider text-gray-500">
        {label}
      </span>
      <span className={`text-sm font-bold font-mono tabular-nums ${valueColor}`}>
        {value}
      </span>
    </div>
  )
}

function DrawerBody({
  state,
  onRetry,
}: {
  state: LoadState
  onRetry: () => void
}) {
  if (state.status === 'idle' || state.status === 'loading') {
    return (
      <div className="p-5 space-y-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="h-10 rounded-md bg-gray-100 animate-pulse"
            aria-hidden
          />
        ))}
      </div>
    )
  }

  if (state.status === 'error') {
    return (
      <div className="p-5">
        <div className="rounded-md border border-red-200 bg-red-50 p-4">
          <p className="text-sm font-semibold text-red-800">
            Unable to load materials
          </p>
          <p className="text-xs text-red-700 mt-1">{state.message}</p>
          <button
            onClick={onRetry}
            className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-red-300 text-red-700 hover:bg-red-100 font-medium"
          >
            Retry
          </button>
        </div>
      </div>
    )
  }

  const { items } = state.data
  if (items.length === 0) {
    return (
      <div className="p-10 text-center">
        <p className="text-sm text-gray-500 italic">No BoM for this job yet</p>
        <p className="text-xs text-gray-400 mt-2">
          Allocations will appear here once materials are reserved for this
          job.
        </p>
      </div>
    )
  }

  return <MaterialTable items={items} />
}

function MaterialTable({ items }: { items: MaterialItem[] }) {
  return (
    <div className="p-5">
      <div className="overflow-x-auto border border-gray-200 rounded-lg">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 text-gray-600">
            <tr>
              <Th>SKU</Th>
              <Th>Description</Th>
              <Th align="right">Needed</Th>
              <Th align="right">On Hand</Th>
              <Th align="right">Incoming</Th>
              <Th align="right">Short</Th>
              <Th>Expected</Th>
              <Th>PO</Th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <MaterialRow key={item.productId} item={item} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function Th({
  children,
  align = 'left',
}: {
  children: React.ReactNode
  align?: 'left' | 'right'
}) {
  return (
    <th
      className={`px-3 py-2 text-[11px] uppercase tracking-wider font-semibold border-b border-gray-200 ${
        align === 'right' ? 'text-right' : 'text-left'
      }`}
    >
      {children}
    </th>
  )
}

function MaterialRow({ item }: { item: MaterialItem }) {
  const isShort = item.short > 0
  const firstPo = item.openPOs[0]
  // Color-code short rows with a red left border, per spec.
  const borderStyle = useMemo(
    () =>
      isShort
        ? { boxShadow: 'inset 3px 0 0 0 #C0392B' }
        : undefined,
    [isShort],
  )
  return (
    <tr
      className={`border-b border-gray-100 last:border-b-0 hover:bg-gray-50 ${
        isShort ? 'bg-red-50/40' : ''
      }`}
      style={borderStyle}
    >
      <td className="px-3 py-2 font-mono text-[12px] text-gray-900 tabular-nums">
        {item.sku ?? '—'}
      </td>
      <td className="px-3 py-2 text-[12.5px] text-gray-700 max-w-[320px]">
        <span className="block truncate" title={item.description ?? undefined}>
          {item.description ?? '—'}
        </span>
      </td>
      <td className="px-3 py-2 text-right font-mono tabular-nums text-gray-900">
        {item.needed}
      </td>
      <td className="px-3 py-2 text-right font-mono tabular-nums text-gray-700">
        {item.onHand}
      </td>
      <td className="px-3 py-2 text-right font-mono tabular-nums text-gray-700">
        {item.incoming}
      </td>
      <td
        className={`px-3 py-2 text-right font-mono tabular-nums font-semibold ${
          isShort ? 'text-[#C0392B]' : 'text-gray-400'
        }`}
      >
        {item.short > 0 ? item.short : '—'}
      </td>
      <td className="px-3 py-2 text-[12px] text-gray-600">
        {formatDate(item.expectedDate)}
      </td>
      <td className="px-3 py-2">
        {firstPo ? (
          <a
            href={`/ops/purchasing/po/${encodeURIComponent(firstPo.poId)}`}
            className="inline-flex items-center gap-1 text-[12px] font-medium text-[#0f2a3e] hover:underline"
            title={`Open ${firstPo.poNumber}`}
          >
            View PO
          </a>
        ) : (
          <span className="text-[11px] text-gray-400 italic">—</span>
        )}
      </td>
    </tr>
  )
}
