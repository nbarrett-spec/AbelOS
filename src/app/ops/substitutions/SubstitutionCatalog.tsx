'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ArrowLeftRight,
  Check,
  Filter,
  History,
  Package,
  RefreshCw,
  Search,
  X,
} from 'lucide-react'

// ──────────────────────────────────────────────────────────────────────────
// SubstitutionCatalog — catalog-style browse + apply for substitutable
// products. Sibling tab to the existing PM approval queue.
//
// Capabilities
//   - Search products by SKU / name
//   - Filter chips: All / Low stock / Out of stock
//   - Per-product card with on-hand, available, reorder point and a ranked
//     list of available substitutes (DIRECT > UPGRADE > VE > DOWNGRADE)
//   - "Substitute now" per substitute → opens an apply modal that hits
//     POST /api/ops/products/[productId]/substitutes/apply
//     (CONDITIONAL substitutions create a PENDING SubstitutionRequest;
//     IDENTICAL/COMPATIBLE swap inventory immediately)
//   - Bulk apply: select multiple low-stock primaries and apply each one's
//     top-ranked substitute in a single click (one apply call per row;
//     same-job requirement still enforced)
//   - Audit panel (collapsible) showing recent applied/requested swaps
// ──────────────────────────────────────────────────────────────────────────

interface CatalogSubstitute {
  id: string
  substituteProductId: string
  sku: string | null
  name: string | null
  onHand: number
  available: number
  priceDelta: number | null
  substitutionType: string
  compatibility: string | null
  conditions: string | null
  source: string | null
  score: number
}

interface CatalogProduct {
  id: string
  sku: string
  name: string
  category: string | null
  cost: number | null
  basePrice: number | null
  onHand: number
  available: number
  committed: number
  reorderPoint: number
  reorderQty: number
  inventoryStatus: string | null
  substituteCount: number
  substitutes: CatalogSubstitute[]
}

interface CatalogResponse {
  count: number
  filter: string
  q: string
  products: CatalogProduct[]
}

interface AuditEntry {
  id: string
  action: string
  createdAt: string
  staffId: string | null
  staffName: string | null
  jobId: string | null
  jobNumber: string | null
  originalProductId: string | null
  originalSku: string | null
  originalName: string | null
  substituteProductId: string | null
  substituteSku: string | null
  substituteName: string | null
  quantity: number | null
  compatibility: string | null
  severity: string | null
}

type StockFilter = 'ALL' | 'LOW' | 'OUT'

const FILTER_CHIPS: { id: StockFilter; label: string }[] = [
  { id: 'ALL', label: 'All' },
  { id: 'LOW', label: 'Low stock' },
  { id: 'OUT', label: 'Out of stock' },
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

function stockTone(p: CatalogProduct): string {
  if (p.onHand <= 0) return 'bg-red-50 text-red-800 border-red-200'
  if (p.available <= p.reorderPoint)
    return 'bg-amber-50 text-amber-800 border-amber-200'
  return 'bg-emerald-50 text-emerald-800 border-emerald-200'
}

function stockLabel(p: CatalogProduct): string {
  if (p.onHand <= 0) return 'Out of stock'
  if (p.available <= p.reorderPoint) return 'Low stock'
  return 'In stock'
}

function compatTone(c: string | null): string {
  switch ((c ?? '').toUpperCase()) {
    case 'IDENTICAL':
      return 'bg-emerald-50 text-emerald-800 border-emerald-200'
    case 'COMPATIBLE':
      return 'bg-sky-50 text-sky-800 border-sky-200'
    case 'CONDITIONAL':
      return 'bg-amber-50 text-amber-800 border-amber-200'
    default:
      return 'bg-gray-50 text-gray-700 border-gray-200'
  }
}

export default function SubstitutionCatalog() {
  const [data, setData] = useState<CatalogResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<
    { text: string; tone: 'success' | 'error' | 'info' } | null
  >(null)

  const [q, setQ] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [filter, setFilter] = useState<StockFilter>('LOW')

  const [selected, setSelected] = useState<Set<string>>(new Set())

  const [applyTarget, setApplyTarget] = useState<{
    product: CatalogProduct
    substitute: CatalogSubstitute
  } | null>(null)
  const [applyJobId, setApplyJobId] = useState('')
  const [applyQty, setApplyQty] = useState<string>('1')
  const [applyReason, setApplyReason] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const [showAudit, setShowAudit] = useState(false)
  const [auditEntries, setAuditEntries] = useState<AuditEntry[]>([])
  const [auditLoading, setAuditLoading] = useState(false)
  const [auditError, setAuditError] = useState<string | null>(null)

  const load = useCallback(
    async (opts?: { q?: string; filter?: StockFilter }) => {
      setLoading(true)
      setError(null)
      try {
        const qs = new URLSearchParams()
        const useQ = opts?.q ?? q
        const useFilter = opts?.filter ?? filter
        if (useQ) qs.set('q', useQ)
        qs.set('filter', useFilter)
        qs.set('limit', '100')
        const res = await fetch(
          `/api/ops/substitutions/catalog?${qs.toString()}`,
          { cache: 'no-store' }
        )
        const json = await res.json()
        if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`)
        setData(json)
      } catch (e: any) {
        setError(e?.message ?? 'Failed to load catalog')
      } finally {
        setLoading(false)
      }
    },
    [q, filter]
  )

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter, q])

  const loadAudit = useCallback(async () => {
    setAuditLoading(true)
    setAuditError(null)
    try {
      const res = await fetch('/api/ops/substitutions/audit?limit=25', {
        cache: 'no-store',
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`)
      setAuditEntries(json.entries ?? [])
    } catch (e: any) {
      setAuditError(e?.message ?? 'Failed to load audit trail')
    } finally {
      setAuditLoading(false)
    }
  }, [])

  useEffect(() => {
    if (showAudit) loadAudit()
  }, [showAudit, loadAudit])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 4000)
    return () => clearTimeout(t)
  }, [toast])

  const products = data?.products ?? []

  const onSearchSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault()
      setQ(searchInput.trim())
    },
    [searchInput]
  )

  const onClearSearch = useCallback(() => {
    setSearchInput('')
    setQ('')
  }, [])

  const toggleSelected = useCallback((productId: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(productId)) next.delete(productId)
      else next.add(productId)
      return next
    })
  }, [])

  const clearSelected = useCallback(() => setSelected(new Set()), [])

  // Bulk apply — opens job picker, then for each selected product applies
  // its top-ranked substitute (with the user-entered qty) against the same
  // job. Each apply is a separate POST.
  const [bulkOpen, setBulkOpen] = useState(false)
  const [bulkJobId, setBulkJobId] = useState('')
  const [bulkSubmitting, setBulkSubmitting] = useState(false)

  const bulkRows = useMemo(
    () => products.filter((p) => selected.has(p.id) && p.substitutes.length > 0),
    [products, selected]
  )

  const submitBulk = useCallback(async () => {
    const job = bulkJobId.trim()
    if (!job) {
      setToast({ text: 'Enter a Job ID for the bulk apply.', tone: 'error' })
      return
    }
    if (bulkRows.length === 0) {
      setToast({
        text: 'No selected rows have substitutes available.',
        tone: 'info',
      })
      return
    }
    setBulkSubmitting(true)
    let ok = 0
    let pending = 0
    let failed = 0
    const errors: string[] = []
    for (const p of bulkRows) {
      const sub = p.substitutes[0]
      const qty = Math.max(1, p.reorderQty || 1)
      try {
        const res = await fetch(
          `/api/ops/products/${p.id}/substitutes/apply`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              jobId: job,
              substituteProductId: sub.substituteProductId,
              quantity: qty,
              reason: 'Bulk apply from substitutions catalog',
            }),
          }
        )
        const json = await res.json()
        if (!res.ok) {
          failed += 1
          errors.push(`${p.sku}: ${json.error ?? `HTTP ${res.status}`}`)
        } else if (json.pending) {
          pending += 1
        } else {
          ok += 1
        }
      } catch (e: any) {
        failed += 1
        errors.push(`${p.sku}: ${e?.message ?? 'network error'}`)
      }
    }
    setBulkSubmitting(false)
    setBulkOpen(false)
    setBulkJobId('')
    clearSelected()
    setToast({
      text: `Bulk done — ${ok} applied, ${pending} pending, ${failed} failed${
        errors.length > 0 ? ` (${errors[0]}${errors.length > 1 ? ', …' : ''})` : ''
      }`,
      tone: failed > 0 ? 'error' : 'success',
    })
    await load()
    if (showAudit) await loadAudit()
  }, [bulkJobId, bulkRows, clearSelected, load, loadAudit, showAudit])

  // Single apply submit
  const submitApply = useCallback(async () => {
    if (!applyTarget) return
    const job = applyJobId.trim()
    const qty = parseInt(applyQty, 10)
    if (!job) {
      setToast({ text: 'Job ID is required.', tone: 'error' })
      return
    }
    if (!Number.isFinite(qty) || qty <= 0) {
      setToast({ text: 'Quantity must be > 0.', tone: 'error' })
      return
    }
    setSubmitting(true)
    try {
      const res = await fetch(
        `/api/ops/products/${applyTarget.product.id}/substitutes/apply`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            jobId: job,
            substituteProductId: applyTarget.substitute.substituteProductId,
            quantity: qty,
            reason: applyReason.trim() || undefined,
          }),
        }
      )
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`)
      setToast({
        text: json.pending
          ? `Submitted for approval — ${applyTarget.product.sku} → ${
              applyTarget.substitute.sku ?? 'sub'
            } on Job ${job}`
          : `Applied — ${applyTarget.product.sku} → ${
              applyTarget.substitute.sku ?? 'sub'
            } on Job ${job}`,
        tone: 'success',
      })
      setApplyTarget(null)
      setApplyJobId('')
      setApplyQty('1')
      setApplyReason('')
      await load()
      if (showAudit) await loadAudit()
    } catch (e: any) {
      setToast({ text: e?.message ?? 'Apply failed', tone: 'error' })
    } finally {
      setSubmitting(false)
    }
  }, [applyTarget, applyJobId, applyQty, applyReason, load, loadAudit, showAudit])

  return (
    <div className="space-y-4">
      {/* ── Header / search / filter ───────────────────────────────────── */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <form
          onSubmit={onSearchSubmit}
          className="flex w-full max-w-md items-center gap-2 rounded border border-border bg-bg px-3 py-1.5"
        >
          <Search className="h-4 w-4 text-fg-muted" aria-hidden />
          <input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search SKU or name…"
            className="flex-1 bg-transparent text-[13px] outline-none placeholder:text-fg-subtle"
          />
          {searchInput && (
            <button
              type="button"
              onClick={onClearSearch}
              className="rounded p-0.5 text-fg-muted hover:bg-surface-muted/40 hover:text-fg"
              aria-label="Clear search"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
          <button
            type="submit"
            className="rounded bg-fg px-2.5 py-1 text-[12px] text-bg hover:opacity-90"
          >
            Search
          </button>
        </form>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 text-[11.5px] text-fg-muted">
            <Filter className="h-3.5 w-3.5" />
            Stock:
          </div>
          {FILTER_CHIPS.map((c) => (
            <button
              key={c.id}
              onClick={() => setFilter(c.id)}
              className={`rounded border px-2.5 py-1 text-[11.5px] transition ${
                filter === c.id
                  ? 'border-fg bg-fg text-bg'
                  : 'border-border hover:border-fg-muted hover:bg-surface-muted/40'
              }`}
              aria-pressed={filter === c.id}
            >
              {c.label}
            </button>
          ))}

          <div className="mx-2 h-5 w-px bg-border" aria-hidden />

          <button
            onClick={() => load()}
            disabled={loading}
            className="flex items-center gap-1.5 rounded border border-border px-2.5 py-1 text-[11.5px] hover:bg-surface-muted/40 disabled:opacity-50"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`}
            />
            Refresh
          </button>

          <button
            onClick={() => setShowAudit((v) => !v)}
            className="flex items-center gap-1.5 rounded border border-border px-2.5 py-1 text-[11.5px] hover:bg-surface-muted/40"
            aria-pressed={showAudit}
          >
            <History className="h-3.5 w-3.5" />
            Audit trail
          </button>
        </div>
      </div>

      {/* ── Bulk action bar ────────────────────────────────────────────── */}
      {selected.size > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded border border-fg/20 bg-fg/5 px-3 py-2">
          <span className="text-[12px] text-fg">
            {selected.size} selected · bulk apply will use each row's
            top-ranked substitute and reorder qty.
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={clearSelected}
              className="rounded border border-border bg-bg px-2.5 py-1 text-[11.5px] hover:bg-surface-muted/40"
            >
              Clear
            </button>
            <button
              onClick={() => setBulkOpen(true)}
              disabled={
                products.filter(
                  (p) => selected.has(p.id) && p.substitutes.length > 0
                ).length === 0
              }
              className="rounded bg-fg px-2.5 py-1 text-[11.5px] text-bg hover:opacity-90 disabled:opacity-50"
            >
              Bulk apply…
            </button>
          </div>
        </div>
      )}

      {/* ── Error / toast ──────────────────────────────────────────────── */}
      {error && (
        <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-[12.5px] text-red-800">
          {error}
        </div>
      )}
      {toast && (
        <div
          className={`fixed bottom-4 right-4 z-50 max-w-sm rounded border px-3 py-2 text-[12.5px] shadow-lg ${
            toast.tone === 'success'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
              : toast.tone === 'error'
              ? 'border-red-200 bg-red-50 text-red-900'
              : 'border-border bg-bg text-fg'
          }`}
        >
          {toast.text}
        </div>
      )}

      {/* ── Catalog list ───────────────────────────────────────────────── */}
      {loading && !data ? (
        <div className="rounded border border-border bg-surface-muted/20 px-3 py-8 text-center text-[12.5px] text-fg-muted">
          Loading catalog…
        </div>
      ) : products.length === 0 ? (
        <div className="rounded border border-dashed border-border bg-surface-muted/10 px-3 py-10 text-center">
          <Package
            className="mx-auto mb-2 h-6 w-6 text-fg-subtle"
            aria-hidden
          />
          <p className="text-[13px] text-fg">
            No substitutable products match these filters.
          </p>
          <p className="mt-1 text-[11.5px] text-fg-muted">
            Try widening the stock filter or clearing the search.
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {products.map((p) => {
            const isSelected = selected.has(p.id)
            return (
              <li
                key={p.id}
                className={`rounded border bg-bg transition ${
                  isSelected ? 'border-fg' : 'border-border'
                }`}
              >
                <div className="flex flex-col gap-3 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleSelected(p.id)}
                      aria-label={`Select ${p.sku}`}
                      className="mt-1 h-4 w-4 cursor-pointer"
                    />
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-[12.5px] font-semibold text-fg">
                          {p.sku}
                        </span>
                        {p.category && (
                          <span className="text-[11px] text-fg-muted">
                            {p.category}
                          </span>
                        )}
                      </div>
                      <div className="mt-0.5 text-[12.5px] text-fg">
                        {p.name}
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-[11.5px]">
                    <span
                      className={`inline-flex items-center rounded border px-2 py-0.5 ${stockTone(
                        p
                      )}`}
                    >
                      {stockLabel(p)}
                    </span>
                    <span className="text-fg-muted">
                      On hand <strong className="text-fg">{p.onHand}</strong>
                    </span>
                    <span className="text-fg-muted">
                      Avail{' '}
                      <strong className="text-fg">{p.available}</strong>
                    </span>
                    <span className="text-fg-muted">
                      ROP{' '}
                      <strong className="text-fg">{p.reorderPoint}</strong>
                    </span>
                    <span className="text-fg-muted">
                      Subs{' '}
                      <strong className="text-fg">{p.substituteCount}</strong>
                    </span>
                  </div>
                </div>

                {p.substitutes.length === 0 ? (
                  <div className="border-t border-border px-3 py-2 text-[11.5px] italic text-fg-muted">
                    No active substitutes registered.
                  </div>
                ) : (
                  <ul className="divide-y divide-border border-t border-border">
                    {p.substitutes.slice(0, 5).map((s, idx) => (
                      <li
                        key={s.id}
                        className="flex flex-col gap-2 px-3 py-2 sm:flex-row sm:items-center sm:justify-between"
                      >
                        <div className="flex items-start gap-3">
                          <ArrowLeftRight
                            className="mt-0.5 h-3.5 w-3.5 text-fg-subtle"
                            aria-hidden
                          />
                          <div>
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-mono text-[12px] font-medium text-fg">
                                {s.sku ?? '—'}
                              </span>
                              <span className="text-[11.5px] text-fg-muted">
                                {s.name ?? ''}
                              </span>
                              {idx === 0 && (
                                <span className="rounded bg-fg/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-fg">
                                  Top pick
                                </span>
                              )}
                            </div>
                            <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px]">
                              <span
                                className={`inline-flex items-center rounded border px-1.5 py-0.5 ${compatTone(
                                  s.compatibility
                                )}`}
                              >
                                {s.compatibility ?? 'UNKNOWN'}
                              </span>
                              <span className="rounded border border-border px-1.5 py-0.5 text-fg-muted">
                                {s.substitutionType}
                              </span>
                              <span className="text-fg-muted">
                                Avail{' '}
                                <strong className="text-fg">
                                  {s.available}
                                </strong>
                              </span>
                              <span className={priceDeltaTone(s.priceDelta)}>
                                Δ {fmtPriceDelta(s.priceDelta)}
                              </span>
                              {s.conditions && (
                                <span className="text-fg-muted">
                                  · {s.conditions}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                        <button
                          onClick={() =>
                            setApplyTarget({ product: p, substitute: s })
                          }
                          className="self-start rounded border border-border bg-bg px-2.5 py-1 text-[11.5px] hover:border-fg hover:bg-surface-muted/40 sm:self-center"
                        >
                          Substitute now
                        </button>
                      </li>
                    ))}
                    {p.substitutes.length > 5 && (
                      <li className="px-3 py-1.5 text-[11px] italic text-fg-muted">
                        +{p.substitutes.length - 5} more substitutes available
                      </li>
                    )}
                  </ul>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {/* ── Audit trail panel ──────────────────────────────────────────── */}
      {showAudit && (
        <div className="rounded border border-border bg-surface-muted/10 p-3">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-[13px] font-semibold text-fg">
              Recent substitutions
            </h3>
            <button
              onClick={loadAudit}
              disabled={auditLoading}
              className="flex items-center gap-1.5 rounded border border-border bg-bg px-2 py-0.5 text-[11px] hover:bg-surface-muted/40 disabled:opacity-50"
            >
              <RefreshCw
                className={`h-3 w-3 ${auditLoading ? 'animate-spin' : ''}`}
              />
              Refresh
            </button>
          </div>
          {auditError ? (
            <div className="rounded border border-red-200 bg-red-50 px-2 py-1.5 text-[11.5px] text-red-800">
              {auditError}
            </div>
          ) : auditLoading && auditEntries.length === 0 ? (
            <div className="text-[11.5px] italic text-fg-muted">
              Loading audit trail…
            </div>
          ) : auditEntries.length === 0 ? (
            <div className="text-[11.5px] italic text-fg-muted">
              No recent substitution events.
            </div>
          ) : (
            <ol className="space-y-1.5 text-[11.5px]">
              {auditEntries.map((e) => {
                const when = new Date(e.createdAt)
                const whenLabel = isNaN(when.getTime())
                  ? e.createdAt
                  : when.toLocaleString()
                const tone =
                  e.action === 'REJECT_SUBSTITUTE_REQUEST'
                    ? 'text-red-800'
                    : e.action === 'APPLY_SUBSTITUTE_REQUESTED'
                    ? 'text-amber-800'
                    : 'text-emerald-800'
                return (
                  <li
                    key={e.id}
                    className="flex flex-wrap items-baseline gap-2 border-b border-border/60 pb-1.5 last:border-b-0 last:pb-0"
                  >
                    <span className={`font-medium ${tone}`}>
                      {e.action.replace(/_/g, ' ').toLowerCase()}
                    </span>
                    <span className="text-fg">
                      {e.originalSku ?? '?'} →{' '}
                      {e.substituteSku ?? '?'}
                    </span>
                    {e.quantity != null && (
                      <span className="text-fg-muted">× {e.quantity}</span>
                    )}
                    {e.jobNumber && (
                      <span className="text-fg-muted">
                        on Job {e.jobNumber}
                      </span>
                    )}
                    {e.staffName && (
                      <span className="text-fg-muted">
                        by {e.staffName}
                      </span>
                    )}
                    <span className="ml-auto text-fg-subtle">
                      {whenLabel}
                    </span>
                  </li>
                )
              })}
            </ol>
          )}
        </div>
      )}

      {/* ── Apply modal ────────────────────────────────────────────────── */}
      {applyTarget && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/30 p-4">
          <div className="w-full max-w-md rounded border border-border bg-bg p-4 shadow-xl">
            <div className="mb-3">
              <h3 className="text-[14px] font-semibold text-fg">
                Apply substitution
              </h3>
              <p className="mt-1 text-[11.5px] text-fg-muted">
                <span className="font-mono">{applyTarget.product.sku}</span>{' '}
                →{' '}
                <span className="font-mono">
                  {applyTarget.substitute.sku ?? '—'}
                </span>{' '}
                ({applyTarget.substitute.substitutionType ?? '—'},{' '}
                {applyTarget.substitute.compatibility ?? '—'})
              </p>
            </div>
            <div className="space-y-2">
              <label className="block">
                <span className="text-[11.5px] text-fg-muted">Job ID</span>
                <input
                  value={applyJobId}
                  onChange={(e) => setApplyJobId(e.target.value)}
                  placeholder="job_xxx or jobNumber"
                  className="mt-0.5 w-full rounded border border-border bg-bg px-2 py-1 text-[12.5px] outline-none focus:border-fg"
                />
              </label>
              <label className="block">
                <span className="text-[11.5px] text-fg-muted">Quantity</span>
                <input
                  value={applyQty}
                  onChange={(e) => setApplyQty(e.target.value)}
                  type="number"
                  min={1}
                  className="mt-0.5 w-full rounded border border-border bg-bg px-2 py-1 text-[12.5px] outline-none focus:border-fg"
                />
              </label>
              {applyTarget.substitute.compatibility === 'CONDITIONAL' && (
                <label className="block">
                  <span className="text-[11.5px] text-fg-muted">
                    Reason (required for CONDITIONAL approval)
                  </span>
                  <textarea
                    value={applyReason}
                    onChange={(e) => setApplyReason(e.target.value)}
                    rows={2}
                    placeholder="e.g., shim required for jamb size"
                    className="mt-0.5 w-full rounded border border-border bg-bg px-2 py-1 text-[12.5px] outline-none focus:border-fg"
                  />
                </label>
              )}
              {applyTarget.substitute.compatibility === 'CONDITIONAL' && (
                <p className="rounded border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] text-amber-900">
                  This is a CONDITIONAL substitute — applying will create a
                  pending request that the assigned PM must approve before
                  inventory moves.
                </p>
              )}
            </div>
            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                onClick={() => {
                  setApplyTarget(null)
                  setApplyJobId('')
                  setApplyQty('1')
                  setApplyReason('')
                }}
                disabled={submitting}
                className="rounded border border-border bg-bg px-2.5 py-1 text-[12px] hover:bg-surface-muted/40 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={submitApply}
                disabled={submitting}
                className="flex items-center gap-1.5 rounded bg-fg px-2.5 py-1 text-[12px] text-bg hover:opacity-90 disabled:opacity-50"
              >
                {submitting ? (
                  <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Check className="h-3.5 w-3.5" />
                )}
                {submitting ? 'Applying…' : 'Apply'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Bulk apply modal ───────────────────────────────────────────── */}
      {bulkOpen && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/30 p-4">
          <div className="w-full max-w-md rounded border border-border bg-bg p-4 shadow-xl">
            <h3 className="text-[14px] font-semibold text-fg">
              Bulk apply substitutions
            </h3>
            <p className="mt-1 text-[11.5px] text-fg-muted">
              Will apply each selected row's top-ranked substitute against the
              same Job. Quantity defaults to each product's reorder qty (or 1).
            </p>
            <div className="mt-3 max-h-40 space-y-1 overflow-y-auto rounded border border-border bg-surface-muted/10 p-2 text-[11.5px]">
              {bulkRows.map((p) => (
                <div key={p.id} className="flex items-center justify-between">
                  <span className="font-mono text-fg">{p.sku}</span>
                  <span className="text-fg-muted">
                    → {p.substitutes[0]?.sku ?? '—'} (×{' '}
                    {Math.max(1, p.reorderQty || 1)})
                  </span>
                </div>
              ))}
              {bulkRows.length === 0 && (
                <div className="italic text-fg-muted">
                  No selected rows have substitutes available.
                </div>
              )}
            </div>
            <label className="mt-3 block">
              <span className="text-[11.5px] text-fg-muted">Job ID</span>
              <input
                value={bulkJobId}
                onChange={(e) => setBulkJobId(e.target.value)}
                placeholder="job_xxx"
                className="mt-0.5 w-full rounded border border-border bg-bg px-2 py-1 text-[12.5px] outline-none focus:border-fg"
              />
            </label>
            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                onClick={() => {
                  setBulkOpen(false)
                  setBulkJobId('')
                }}
                disabled={bulkSubmitting}
                className="rounded border border-border bg-bg px-2.5 py-1 text-[12px] hover:bg-surface-muted/40 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={submitBulk}
                disabled={bulkSubmitting || bulkRows.length === 0}
                className="flex items-center gap-1.5 rounded bg-fg px-2.5 py-1 text-[12px] text-bg hover:opacity-90 disabled:opacity-50"
              >
                {bulkSubmitting ? (
                  <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Check className="h-3.5 w-3.5" />
                )}
                {bulkSubmitting
                  ? 'Applying…'
                  : `Apply ${bulkRows.length} substitution${
                      bulkRows.length === 1 ? '' : 's'
                    }`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
