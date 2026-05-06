'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  PageHeader,
  KPICard,
  Badge,
  Card,
  CardBody,
  EmptyState,
  LiveDataIndicator,
  Button,
} from '@/components/ui'
import {
  AlertTriangle,
  Mail,
  ExternalLink,
  RefreshCw,
  ShoppingCart,
  Repeat,
  CheckCircle2,
} from 'lucide-react'

// ── Types (must mirror /api/ops/shortages response) ──────────────────────

export interface ShortageAlternative {
  productId: string
  sku: string
  name: string
  available: number
}

export interface ShortageItem {
  productId: string
  sku: string
  name: string
  category: string | null
  onHand: number
  committed: number
  available: number
  reorderPoint: number
  reorderQty: number
  safetyStock: number
  forecastDemand: number
  shortageQty: number
  shortageDollars: number
  severity: 'CRITICAL' | 'LOW' | 'OK'
  daysOfCoverage: number | null
  daysUntilStockout: number | null
  earliestShortDate: string | null
  openPoCount: number
  inTransitQty: number
  earliestExpected: string | null
  affectedJobCount: number
  preferredVendor: null | {
    vendorId: string
    name: string
    code: string
    email: string | null
    contactName: string | null
    leadTimeDays: number | null
  }
  unitCost: number
  alternatives: ShortageAlternative[]
}

interface Summary {
  shortSkus: number
  shortageDollars: number
  minDaysOfCoverage: number | null
  criticalCount?: number
  lowCount?: number
  categories?: string[]
}

interface ApiResponse {
  asOf: string
  horizonDays: number
  severity: 'all' | 'high' | 'critical' | 'low'
  vendorId: string | null
  summary: Summary
  items: ShortageItem[]
  note?: string
}

type Horizon = 7 | 14 | 30
type SeverityFilter = 'all' | 'critical' | 'low'

// ── Helpers ──────────────────────────────────────────────────────────────

const fmtMoney = (n: number) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(n)

const fmtInt = (n: number) =>
  new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(n)

const fmtDate = (iso: string | null) => {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  })
}

function buildMailto(item: ShortageItem, horizonDays: number): string {
  const vendor = item.preferredVendor
  if (!vendor || !vendor.email) return '#'
  const to = encodeURIComponent(vendor.email)
  const by = item.earliestShortDate
    ? new Date(item.earliestShortDate)
    : new Date(Date.now() + horizonDays * 86400000)
  const byStr = by.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
  const subject = encodeURIComponent(
    `Abel Lumber expedite — ${item.sku} (${item.shortageQty} units needed by ${byStr})`
  )
  const greeting = vendor.contactName ? `${vendor.contactName}, ` : 'Team, '
  const body = encodeURIComponent(
    [
      `${greeting}`,
      ``,
      `We're forecast short ${item.shortageQty} of ${item.sku} — ${item.name} — by ${byStr}.`,
      ``,
      `Currently on hand: ${item.onHand}. Forecast demand over the next ${horizonDays} days: ${item.forecastDemand}.`,
      `Open POs in transit: ${item.inTransitQty} (${item.openPoCount} PO${item.openPoCount === 1 ? '' : 's'}).`,
      item.affectedJobCount > 0
        ? `${item.affectedJobCount} active job${item.affectedJobCount === 1 ? '' : 's'} is waiting on this SKU.`
        : '',
      ``,
      `Can you confirm expedited delivery? If the quantity on order isn't enough, please quote the delta.`,
      ``,
      `Thanks,`,
      `Abel Lumber Procurement`,
    ]
      .filter(Boolean)
      .join('\n')
  )
  return `mailto:${to}?subject=${subject}&body=${body}`
}

function severityBadge(sev: ShortageItem['severity']) {
  if (sev === 'CRITICAL') {
    return (
      <Badge variant="danger" size="sm">
        Critical
      </Badge>
    )
  }
  if (sev === 'LOW') {
    return (
      <Badge variant="warning" size="sm">
        Low
      </Badge>
    )
  }
  return (
    <Badge variant="neutral" size="sm">
      OK
    </Badge>
  )
}

// ── Main component ───────────────────────────────────────────────────────

interface Props {
  initial: ApiResponse | null
  initialError: string | null
}

export default function ShortageTable({ initial, initialError }: Props) {
  const [horizon, setHorizon] = useState<Horizon>(
    (initial?.horizonDays as Horizon) || 14
  )
  const [severity, setSeverity] = useState<SeverityFilter>(
    initial?.severity === 'critical'
      ? 'critical'
      : initial?.severity === 'low'
        ? 'low'
        : 'all'
  )
  const [vendorId, setVendorId] = useState<string>('')
  const [category, setCategory] = useState<string>('')
  const [data, setData] = useState<ApiResponse | null>(initial)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(initialError)
  const [reorderState, setReorderState] = useState<
    Record<string, 'idle' | 'pending' | 'done' | 'error'>
  >({})
  const [reorderResult, setReorderResult] = useState<
    Record<string, { poNumber?: string; poId?: string; error?: string }>
  >({})

  // Refetch when filters change (skip first mount — initial is from SSR)
  useEffect(() => {
    void refetch(horizon, severity, vendorId, category)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [horizon, severity, vendorId, category])

  async function refetch(
    h: Horizon,
    s: SeverityFilter,
    v: string,
    c: string
  ) {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      params.set('horizon', String(h))
      params.set('severity', s)
      if (v) params.set('vendorId', v)
      if (c) params.set('category', c)
      const res = await fetch(`/api/ops/shortages?${params.toString()}`, {
        cache: 'no-store',
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body?.error || `HTTP ${res.status}`)
      }
      const json = (await res.json()) as ApiResponse
      setData(json)
    } catch (err: any) {
      setError(err?.message || 'Failed to load shortages')
    } finally {
      setLoading(false)
    }
  }

  async function handleReorder(item: ShortageItem) {
    setReorderState((s) => ({ ...s, [item.productId]: 'pending' }))
    setReorderResult((r) => ({ ...r, [item.productId]: {} }))
    try {
      // Don't pre-pin quantity — let suggest-po roll the forecast forward and
      // honor reorderQty/minOrderQty floors. If we wanted to override, we'd
      // pass `quantity: Math.max(item.shortageQty, item.reorderQty)`.
      const res = await fetch('/api/ops/mrp/suggest-po', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ productId: item.productId }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body?.error || `HTTP ${res.status}`)
      }
      const json = await res.json()
      const po = json?.po || {}
      setReorderState((s) => ({ ...s, [item.productId]: 'done' }))
      setReorderResult((r) => ({
        ...r,
        [item.productId]: { poId: po.id, poNumber: po.poNumber },
      }))
    } catch (err: any) {
      setReorderState((s) => ({ ...s, [item.productId]: 'error' }))
      setReorderResult((r) => ({
        ...r,
        [item.productId]: { error: err?.message || 'Failed' },
      }))
    }
  }

  // Unique vendor list for the filter (drawn from the current dataset)
  const vendorOptions = useMemo(() => {
    const map = new Map<string, string>()
    for (const it of data?.items || []) {
      if (it.preferredVendor) {
        map.set(it.preferredVendor.vendorId, it.preferredVendor.name)
      }
    }
    return Array.from(map.entries()).sort((a, b) => a[1].localeCompare(b[1]))
  }, [data])

  const categoryOptions = data?.summary?.categories || []

  const summary = data?.summary || {
    shortSkus: 0,
    shortageDollars: 0,
    minDaysOfCoverage: null,
    criticalCount: 0,
    lowCount: 0,
    categories: [],
  }

  const hasItems = (data?.items || []).length > 0
  const asOfLabel = data?.asOf
    ? new Date(data.asOf).toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
      })
    : ''

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Operations · MRP"
        title={`Forecast Shortages — next ${horizon} days`}
        description="SKUs the demand forecast says we'll run short on, with severity vs reorder thresholds, vendor ETA, and one-click reorder."
        actions={
          <div className="flex items-center gap-2">
            {data?.asOf && (
              <div className="flex items-center gap-2 text-xs text-fg-muted">
                <LiveDataIndicator trigger={data.asOf} tone="accent" />
                <span>As of {asOfLabel}</span>
              </div>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void refetch(horizon, severity, vendorId, category)}
              disabled={loading}
              aria-label="Refresh"
            >
              <RefreshCw
                className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`}
              />
            </Button>
          </div>
        }
      />

      {/* KPI strip */}
      <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
        <KPICard
          title="Critical"
          value={fmtInt(summary.criticalCount ?? 0)}
          subtitle="at or below safety stock"
          accent={
            (summary.criticalCount ?? 0) > 0 ? 'negative' : 'neutral'
          }
          icon={<AlertTriangle className="w-4 h-4" />}
        />
        <KPICard
          title="Low"
          value={fmtInt(summary.lowCount ?? 0)}
          subtitle="below reorder point"
          accent={(summary.lowCount ?? 0) > 0 ? 'forecast' : 'neutral'}
        />
        <KPICard
          title="Shortage $"
          value={fmtMoney(summary.shortageDollars)}
          subtitle="at current Product.cost"
          accent={summary.shortageDollars > 0 ? 'negative' : 'neutral'}
        />
        <KPICard
          title="Min coverage"
          value={
            summary.minDaysOfCoverage === null
              ? '—'
              : `${summary.minDaysOfCoverage.toFixed(1)}d`
          }
          subtitle="tightest SKU in window"
          accent={
            summary.minDaysOfCoverage !== null && summary.minDaysOfCoverage <= 3
              ? 'negative'
              : summary.minDaysOfCoverage !== null &&
                  summary.minDaysOfCoverage <= 7
                ? 'forecast'
                : 'neutral'
          }
        />
      </div>

      {/* Filters */}
      <Card>
        <CardBody className="flex flex-col lg:flex-row lg:items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="text-xs uppercase tracking-wide text-fg-subtle">
              Horizon
            </span>
            <div className="inline-flex rounded-md border border-border overflow-hidden">
              {([7, 14, 30] as Horizon[]).map((h) => (
                <button
                  key={h}
                  type="button"
                  className={`px-3 py-1.5 text-sm transition-colors ${
                    horizon === h
                      ? 'bg-[var(--c2)] text-white'
                      : 'bg-transparent text-fg hover:bg-surface-muted'
                  }`}
                  onClick={() => setHorizon(h)}
                  aria-pressed={horizon === h}
                >
                  {h}d
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs uppercase tracking-wide text-fg-subtle">
              Severity
            </span>
            <div className="inline-flex rounded-md border border-border overflow-hidden">
              {(
                [
                  { value: 'all', label: 'All' },
                  { value: 'critical', label: 'Critical' },
                  { value: 'low', label: 'Low' },
                ] as Array<{ value: SeverityFilter; label: string }>
              ).map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  className={`px-3 py-1.5 text-sm transition-colors ${
                    severity === opt.value
                      ? 'bg-[var(--c2)] text-white'
                      : 'bg-transparent text-fg hover:bg-surface-muted'
                  }`}
                  onClick={() => setSeverity(opt.value)}
                  aria-pressed={severity === opt.value}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {categoryOptions.length > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-xs uppercase tracking-wide text-fg-subtle">
                Category
              </span>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="rounded-md border border-border bg-surface px-2 py-1.5 text-sm min-w-[160px]"
              >
                <option value="">All categories</option>
                {categoryOptions.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="flex items-center gap-2 lg:ml-auto">
            <span className="text-xs uppercase tracking-wide text-fg-subtle">
              Vendor
            </span>
            <select
              value={vendorId}
              onChange={(e) => setVendorId(e.target.value)}
              className="rounded-md border border-border bg-surface px-2 py-1.5 text-sm min-w-[180px]"
            >
              <option value="">All vendors</option>
              {vendorOptions.map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          </div>
        </CardBody>
      </Card>

      {error && (
        <Card>
          <CardBody>
            <div className="flex items-start gap-2 text-[var(--data-red-500)]">
              <AlertTriangle className="w-4 h-4 mt-0.5" />
              <div>
                <div className="font-medium">Couldn't load shortages</div>
                <div className="text-sm text-fg-muted">{error}</div>
              </div>
            </div>
          </CardBody>
        </Card>
      )}

      {data?.note && !hasItems && !error && (
        <EmptyState
          icon="package"
          title="No forecast shortage data yet"
          description={data.note}
          size="full"
        />
      )}

      {!error && !data?.note && !hasItems && !loading && (
        <EmptyState
          icon="package"
          title="Nothing short in the window"
          description={
            severity === 'critical'
              ? 'Nothing is at or below safety stock right now.'
              : severity === 'low'
                ? 'Nothing is between safety and reorder point. Try All.'
                : `No SKUs are forecast to fall short over the next ${horizon} days given current on-hand plus incoming POs.`
          }
          size="full"
        />
      )}

      {hasItems && (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface-muted text-fg-muted text-xs uppercase tracking-wide">
                <tr>
                  <th className="text-left px-3 py-2.5 font-medium">Severity</th>
                  <th className="text-left px-3 py-2.5 font-medium">SKU</th>
                  <th className="text-left px-3 py-2.5 font-medium">Description</th>
                  <th className="text-right px-3 py-2.5 font-medium">Avail / Reorder / Safety</th>
                  <th className="text-right px-3 py-2.5 font-medium">Forecast {horizon}d</th>
                  <th className="text-right px-3 py-2.5 font-medium">Short qty</th>
                  <th className="text-right px-3 py-2.5 font-medium">Short $</th>
                  <th className="text-left px-3 py-2.5 font-medium">Stockout</th>
                  <th className="text-left px-3 py-2.5 font-medium">Vendor / ETA</th>
                  <th className="text-right px-3 py-2.5 font-medium">Jobs</th>
                  <th className="text-left px-3 py-2.5 font-medium">Alternatives</th>
                  <th className="text-right px-3 py-2.5 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {data!.items.map((it) => {
                  const tightCoverage =
                    it.daysUntilStockout !== null && it.daysUntilStockout <= 3
                  const mailto = buildMailto(it, data!.horizonDays)
                  const vendorMissing = !it.preferredVendor?.email
                  const reorderS = reorderState[it.productId] || 'idle'
                  const reorderR = reorderResult[it.productId] || {}
                  const rowAccent =
                    it.severity === 'CRITICAL'
                      ? 'border-l-4 border-l-[var(--data-red-500)]'
                      : it.severity === 'LOW'
                        ? 'border-l-4 border-l-[var(--data-amber-500)]'
                        : ''
                  return (
                    <tr
                      key={it.productId}
                      className={`border-t border-border hover:bg-surface-muted/40 transition-colors ${rowAccent}`}
                    >
                      <td className="px-3 py-2 whitespace-nowrap">
                        {severityBadge(it.severity)}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">
                        {it.sku}
                      </td>
                      <td className="px-3 py-2 min-w-[220px]">
                        <div className="truncate max-w-[320px]" title={it.name}>
                          {it.name}
                        </div>
                        {it.category && (
                          <div className="text-xs text-fg-subtle">
                            {it.category}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">
                        <div className="font-medium">
                          {fmtInt(it.available)}
                          {it.committed > 0 && (
                            <span
                              className="text-xs text-fg-subtle ml-1"
                              title={`onHand ${it.onHand}, committed ${it.committed}`}
                            >
                              ({fmtInt(it.onHand)}-{fmtInt(it.committed)})
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-fg-subtle">
                          ROP {fmtInt(it.reorderPoint)} / SS{' '}
                          {fmtInt(it.safetyStock)}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {fmtInt(it.forecastDemand)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums font-medium">
                        <span
                          className={
                            tightCoverage
                              ? 'text-[var(--data-red-500)]'
                              : undefined
                          }
                        >
                          {fmtInt(it.shortageQty)}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums font-medium">
                        {fmtMoney(it.shortageDollars)}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        {it.daysUntilStockout !== null ? (
                          <div className="text-xs">
                            <span
                              className={
                                tightCoverage
                                  ? 'text-[var(--data-red-500)] font-medium'
                                  : 'font-medium'
                              }
                            >
                              {it.daysUntilStockout.toFixed(1)}d
                            </span>
                            {it.earliestShortDate && (
                              <div className="text-fg-subtle">
                                short {fmtDate(it.earliestShortDate)}
                              </div>
                            )}
                          </div>
                        ) : (
                          <span className="text-fg-subtle text-xs">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {it.preferredVendor ? (
                          <div className="text-xs">
                            <div
                              className="truncate max-w-[140px] font-medium"
                              title={it.preferredVendor.name}
                            >
                              {it.preferredVendor.name}
                            </div>
                            <div className="text-fg-subtle">
                              {it.preferredVendor.leadTimeDays != null
                                ? `${it.preferredVendor.leadTimeDays}d lead`
                                : 'lead unknown'}
                              {it.openPoCount > 0 && (
                                <>
                                  {' · '}
                                  {fmtInt(it.inTransitQty)} in transit
                                </>
                              )}
                            </div>
                            {it.earliestExpected && (
                              <div className="text-fg-subtle">
                                ETA {fmtDate(it.earliestExpected)}
                              </div>
                            )}
                          </div>
                        ) : (
                          <span className="text-fg-subtle text-xs">
                            No vendor
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {it.affectedJobCount > 0 ? (
                          <Badge variant="warning" size="sm">
                            {it.affectedJobCount}
                          </Badge>
                        ) : (
                          <span className="text-fg-subtle">0</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {it.alternatives && it.alternatives.length > 0 ? (
                          <div className="text-xs space-y-0.5">
                            {it.alternatives.slice(0, 2).map((alt) => (
                              <Link
                                key={alt.productId}
                                href={`/ops/catalog/${alt.productId}`}
                                className="flex items-center gap-1 hover:underline"
                                title={`${alt.name} — ${alt.available} available`}
                              >
                                <Repeat className="w-3 h-3 text-fg-subtle shrink-0" />
                                <span className="font-mono truncate max-w-[110px]">
                                  {alt.sku}
                                </span>
                                <span className="text-fg-subtle">
                                  ({fmtInt(alt.available)})
                                </span>
                              </Link>
                            ))}
                            {it.alternatives.length > 2 && (
                              <div className="text-fg-subtle">
                                +{it.alternatives.length - 2} more
                              </div>
                            )}
                          </div>
                        ) : (
                          <span className="text-fg-subtle text-xs">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1">
                          {reorderS === 'done' && reorderR.poId ? (
                            <Link
                              href={`/ops/purchasing/${reorderR.poId}`}
                              className="inline-flex items-center gap-1 rounded-md border border-[var(--data-green-500)] text-[var(--data-green-500)] px-2 py-1 text-xs hover:bg-surface-muted transition-colors"
                              title={`Draft PO ${reorderR.poNumber}`}
                            >
                              <CheckCircle2 className="w-3 h-3" />
                              {reorderR.poNumber || 'PO created'}
                            </Link>
                          ) : (
                            <button
                              type="button"
                              onClick={() => void handleReorder(it)}
                              disabled={
                                reorderS === 'pending' ||
                                !it.preferredVendor
                              }
                              className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs hover:bg-surface-muted transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                              title={
                                !it.preferredVendor
                                  ? 'No preferred vendor — set one in catalog'
                                  : reorderS === 'error'
                                    ? reorderR.error || 'Retry'
                                    : 'Create draft PO via MRP'
                              }
                            >
                              <ShoppingCart
                                className={`w-3 h-3 ${reorderS === 'pending' ? 'animate-pulse' : ''}`}
                              />
                              {reorderS === 'pending'
                                ? '…'
                                : reorderS === 'error'
                                  ? 'Retry'
                                  : 'Reorder'}
                            </button>
                          )}
                          {!vendorMissing && (
                            <a
                              href={mailto}
                              className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs hover:bg-surface-muted transition-colors"
                              title={`Email ${it.preferredVendor?.name}`}
                            >
                              <Mail className="w-3 h-3" />
                              Expedite
                            </a>
                          )}
                          <Link
                            href={`/ops/catalog/${it.productId}`}
                            className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs hover:bg-surface-muted transition-colors"
                          >
                            <ExternalLink className="w-3 h-3" />
                            View
                          </Link>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  )
}
