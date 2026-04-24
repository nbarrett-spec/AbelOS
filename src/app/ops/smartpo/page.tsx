'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { PageHeader, Card, CardBody, KPICard, EmptyState } from '@/components/ui'
import {
  Filter,
  RefreshCw,
  Zap,
  Package,
  DollarSign,
  TrendingUp,
  ChevronLeft,
  ChevronRight,
  Loader2,
} from 'lucide-react'
import VendorGroup, { type VendorGroupData } from './VendorGroup'
import type { Priority, Recommendation } from './RecommendationRow'

// ──────────────────────────────────────────────────────────────────────────
// SmartPO Queue — /ops/smartpo — Agent C6 (Wave-3)
//
// Polished vendor-grouped queue. Monday Nate is shipping 384 POs across 8+
// vendors, total ~$148K. Designed for 1-click per vendor ("Ship All") and
// per-line granularity underneath.
//
// Feature flag: NEXT_PUBLIC_FEATURE_SMARTPO !== 'off' — default on. A flag
// of 'off' renders a 404 via notFound().
// ──────────────────────────────────────────────────────────────────────────

interface ApiResponse {
  ok: boolean
  totalRecs: number
  totalVendors: number
  totalAmount: number
  groups: VendorGroupData[]
  page: number
  pageSize: number
  hasMore: boolean
  error?: string
}

function fmt$(v: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(v || 0)
}

function fmtNum(v: number): string {
  return new Intl.NumberFormat('en-US').format(v || 0)
}

// Feature flag gate. NEXT_PUBLIC_FEATURE_SMARTPO is inlined at build time,
// so this is a module-level constant — safe to short-circuit render below.
const FEATURE_DISABLED = process.env.NEXT_PUBLIC_FEATURE_SMARTPO === 'off'

export default function SmartPOPage() {
  const [data, setData] = useState<ApiResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // ── Filters ──────────────────────────────────────────────────────────
  const [vendorFilter, setVendorFilter] = useState('')
  const [priorityFilter, setPriorityFilter] = useState<'' | Priority>('')
  const [minAmount, setMinAmount] = useState('')
  const [hideOnHold, setHideOnHold] = useState(false)
  const [page, setPage] = useState(1)

  // ── Selection state (for potential bulk ops) ─────────────────────────
  const [selected, setSelected] = useState<Set<string>>(new Set())

  // Transient client-side suppressions so shipped/held/skipped rows
  // disappear without a full re-fetch.
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  const [shippedPos, setShippedPos] = useState<Array<{ recId: string; poId: string }>>([])

  const load = useCallback(
    async (resetPage = false) => {
      setLoading(true)
      setError(null)
      try {
        const qs = new URLSearchParams()
        if (vendorFilter) qs.set('vendorId', vendorFilter)
        if (priorityFilter) qs.set('priority', priorityFilter)
        const min = parseFloat(minAmount)
        if (Number.isFinite(min) && min > 0) qs.set('minAmount', String(min))
        if (hideOnHold) qs.set('hideOnHold', 'true')
        const p = resetPage ? 1 : page
        qs.set('page', String(p))

        const res = await fetch(`/api/ops/smartpo/recommendations?${qs.toString()}`, {
          credentials: 'include',
        })
        const json: ApiResponse = await res.json()
        if (!res.ok || !json.ok) {
          throw new Error(json?.error || `HTTP ${res.status}`)
        }
        setData(json)
        if (resetPage) setPage(1)
      } catch (e: any) {
        setError(e?.message || String(e))
      } finally {
        setLoading(false)
      }
    },
    [vendorFilter, priorityFilter, minAmount, hideOnHold, page]
  )

  // Re-fetch when page changes
  useEffect(() => {
    load(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page])

  // Initial load
  useEffect(() => {
    load(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Filtered groups: strip rows that were shipped/held/skipped this session
  const groups: VendorGroupData[] = useMemo(() => {
    if (!data?.groups) return []
    return data.groups
      .map((g) => ({
        ...g,
        recs: g.recs.filter((r: Recommendation) => !hidden.has(r.id)),
      }))
      .filter((g) => g.recs.length > 0)
  }, [data, hidden])

  const allVendors = useMemo(() => {
    const m = new Map<string, string>()
    for (const g of data?.groups || []) {
      if (!m.has(g.vendor.id)) m.set(g.vendor.id, g.vendor.name || g.vendor.id)
    }
    return Array.from(m.entries()).sort((a, b) => a[1].localeCompare(b[1]))
  }, [data])

  // ── Selection handlers ──────────────────────────────────────────────
  const onToggleRec = useCallback((recId: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(recId)) next.delete(recId)
      else next.add(recId)
      return next
    })
  }, [])

  const onSelectAllForVendor = useCallback(
    (vendorId: string, selectAll: boolean) => {
      const grp = data?.groups.find((g) => g.vendor.id === vendorId)
      if (!grp) return
      setSelected((prev) => {
        const next = new Set(prev)
        for (const r of grp.recs) {
          if (selectAll) next.add(r.id)
          else next.delete(r.id)
        }
        return next
      })
    },
    [data]
  )

  const onRecShipped = useCallback((recId: string, poId: string) => {
    setHidden((prev) => {
      const next = new Set(prev)
      next.add(recId)
      return next
    })
    setShippedPos((prev) => [...prev, { recId, poId }])
  }, [])

  const onRecSkipped = useCallback((recId: string) => {
    setHidden((prev) => {
      const next = new Set(prev)
      next.add(recId)
      return next
    })
  }, [])

  const onRecHold = useCallback((recId: string) => {
    setHidden((prev) => {
      const next = new Set(prev)
      next.add(recId)
      return next
    })
  }, [])

  const applyFilters = () => {
    setPage(1)
    load(true)
  }

  const totalPages = data?.totalRecs
    ? Math.max(1, Math.ceil(data.totalRecs / (data.pageSize || 50)))
    : 1

  const headerTitle = data
    ? `SmartPO Queue — ${fmt$(data.totalAmount)} across ${data.totalVendors} vendor${
        data.totalVendors === 1 ? '' : 's'
      }`
    : 'SmartPO Queue'

  if (FEATURE_DISABLED) {
    return (
      <div className="min-h-screen">
        <PageHeader
          title="SmartPO Queue"
          description="This feature is currently disabled."
          crumbs={[
            { label: 'Ops', href: '/ops' },
            { label: 'Purchasing', href: '/ops/purchasing' },
            { label: 'SmartPO' },
          ]}
        />
        <Card>
          <CardBody>
            <EmptyState
              icon="sparkles"
              title="SmartPO is disabled"
              description="Set NEXT_PUBLIC_FEATURE_SMARTPO to anything other than 'off' to enable."
            />
          </CardBody>
        </Card>
      </div>
    )
  }

  return (
    <div className="min-h-screen">
      <PageHeader
        eyebrow="Monday push"
        title={headerTitle}
        description={
          data
            ? `${fmtNum(data.totalRecs)} recommendation${
                data.totalRecs === 1 ? '' : 's'
              } pending — vendor-grouped, 1-click ship.`
            : 'Loading queue…'
        }
        crumbs={[
          { label: 'Ops', href: '/ops' },
          { label: 'Purchasing', href: '/ops/purchasing' },
          { label: 'SmartPO' },
        ]}
        actions={
          <button
            onClick={() => load(true)}
            className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-fg-subtle hover:text-fg"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        }
      />

      <div className="max-w-[1400px] mx-auto space-y-5">
        {/* ── KPIs ─────────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <KPICard
            title="Total Queue"
            value={data ? fmtNum(data.totalRecs) : '—'}
            subtitle={data ? `${data.totalVendors} vendors` : ''}
            accent="brand"
            icon={<Zap className="w-4 h-4" />}
          />
          <KPICard
            title="Queue $"
            value={data ? fmt$(data.totalAmount) : '—'}
            subtitle="pending approval"
            accent="accent"
            icon={<DollarSign className="w-4 h-4" />}
          />
          <KPICard
            title="HIGH Priority"
            value={
              data
                ? fmtNum(
                    data.groups.reduce(
                      (s, g) => s + (g.totals.priorityCounts.HIGH || 0),
                      0
                    )
                  )
                : '—'
            }
            subtitle="ship first"
            accent="negative"
            icon={<TrendingUp className="w-4 h-4" />}
          />
          <KPICard
            title="Shipped this session"
            value={fmtNum(shippedPos.length)}
            subtitle={
              shippedPos.length > 0
                ? `${new Set(shippedPos.map((s) => s.poId).filter(Boolean)).size} PO(s)`
                : 'none yet'
            }
            accent="positive"
            icon={<Package className="w-4 h-4" />}
          />
        </div>

        {/* ── Filter bar ────────────────────────────────────────────── */}
        <Card>
          <CardBody>
            <div className="flex flex-wrap items-center gap-3">
              <Filter className="w-4 h-4 text-fg-subtle" />

              <select
                value={vendorFilter}
                onChange={(e) => setVendorFilter(e.target.value)}
                className="text-[12px] bg-surface border border-border rounded px-2 py-1 min-w-[180px]"
              >
                <option value="">All vendors</option>
                {allVendors.map(([id, name]) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </select>

              <select
                value={priorityFilter}
                onChange={(e) => setPriorityFilter(e.target.value as any)}
                className="text-[12px] bg-surface border border-border rounded px-2 py-1"
              >
                <option value="">All priorities</option>
                <option value="HIGH">HIGH</option>
                <option value="MEDIUM">MEDIUM</option>
                <option value="LOW">LOW</option>
              </select>

              <input
                type="number"
                placeholder="Min $"
                value={minAmount}
                onChange={(e) => setMinAmount(e.target.value)}
                className="text-[12px] bg-surface border border-border rounded px-2 py-1 w-[110px]"
                inputMode="decimal"
                min={0}
              />

              <label className="inline-flex items-center gap-1.5 text-[12px] text-fg-subtle cursor-pointer">
                <input
                  type="checkbox"
                  checked={hideOnHold}
                  onChange={(e) => setHideOnHold(e.target.checked)}
                />
                Hide on hold
              </label>

              <button
                onClick={applyFilters}
                className="ml-auto inline-flex items-center gap-1.5 px-3 py-1 text-[11px] font-semibold rounded bg-c1 text-white hover:opacity-90 transition-opacity"
              >
                Apply
              </button>
              {(vendorFilter || priorityFilter || minAmount || hideOnHold) && (
                <button
                  onClick={() => {
                    setVendorFilter('')
                    setPriorityFilter('')
                    setMinAmount('')
                    setHideOnHold(false)
                    setPage(1)
                    setTimeout(() => load(true), 0)
                  }}
                  className="text-[11px] text-fg-subtle hover:text-fg"
                >
                  Clear
                </button>
              )}
            </div>
          </CardBody>
        </Card>

        {/* ── Error banner ─────────────────────────────────────────── */}
        {error && (
          <Card>
            <CardBody>
              <div className="text-[12px] text-data-negative">Error loading queue: {error}</div>
            </CardBody>
          </Card>
        )}

        {/* ── Loading state (first load only) ──────────────────────── */}
        {loading && !data && (
          <Card>
            <CardBody>
              <div className="flex items-center gap-2 text-fg-subtle text-[12px]">
                <Loader2 className="w-4 h-4 animate-spin" />
                Loading recommendations…
              </div>
            </CardBody>
          </Card>
        )}

        {/* ── Empty state ──────────────────────────────────────────── */}
        {!loading && data && groups.length === 0 && (
          <Card>
            <CardBody>
              <EmptyState
                icon="sparkles"
                title="Nothing to ship"
                description={
                  data.totalRecs === 0
                    ? 'No pending SmartPO recommendations. The shortage-forecast cron populates this queue automatically as RED ATP lines appear.'
                    : 'All queued recs were filtered out or already handled this session. Try clearing filters.'
                }
              />
            </CardBody>
          </Card>
        )}

        {/* ── Vendor groups ─────────────────────────────────────────── */}
        {groups.map((g) => (
          <VendorGroup
            key={g.vendor.id}
            group={g}
            initiallyOpen={g.totals.priorityCounts.HIGH > 0 || groups.length <= 3}
            onRecShipped={onRecShipped}
            onRecSkipped={onRecSkipped}
            onRecHold={onRecHold}
            selected={selected}
            onToggleRec={onToggleRec}
            onSelectAllForVendor={onSelectAllForVendor}
          />
        ))}

        {/* ── Pagination ────────────────────────────────────────────── */}
        {data && data.totalRecs > data.pageSize && (
          <div className="flex items-center justify-between pt-2">
            <div className="text-[11px] text-fg-subtle">
              Page {page} of {totalPages} · {data.pageSize} per page ·{' '}
              {fmtNum(data.totalRecs)} total recs
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1 || loading}
                className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold rounded border border-border hover:bg-surface-muted disabled:opacity-40"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
                Prev
              </button>
              <button
                onClick={() => setPage((p) => (data.hasMore ? p + 1 : p))}
                disabled={!data.hasMore || loading}
                className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold rounded border border-border hover:bg-surface-muted disabled:opacity-40"
              >
                Next
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
