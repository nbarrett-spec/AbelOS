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
import { AlertTriangle, Mail, ExternalLink, Package, RefreshCw } from 'lucide-react'

// ── Types (must mirror /api/ops/shortages response) ──────────────────────

export interface ShortageItem {
  productId: string
  sku: string
  name: string
  category: string | null
  onHand: number
  available: number
  forecastDemand: number
  shortageQty: number
  shortageDollars: number
  daysOfCoverage: number | null
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
}

interface Summary {
  shortSkus: number
  shortageDollars: number
  minDaysOfCoverage: number | null
}

interface ApiResponse {
  asOf: string
  horizonDays: number
  severity: 'all' | 'high'
  vendorId: string | null
  summary: Summary
  items: ShortageItem[]
  note?: string
}

type Horizon = 7 | 14 | 30
type Severity = 'all' | 'high'

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

// ── Main component ───────────────────────────────────────────────────────

interface Props {
  initial: ApiResponse | null
  initialError: string | null
}

export default function ShortageTable({ initial, initialError }: Props) {
  const [horizon, setHorizon] = useState<Horizon>(
    (initial?.horizonDays as Horizon) || 14
  )
  const [severity, setSeverity] = useState<Severity>(initial?.severity || 'all')
  const [vendorId, setVendorId] = useState<string>('')
  const [data, setData] = useState<ApiResponse | null>(initial)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(initialError)

  // Refetch when filters change (skip first mount — initial is from SSR)
  useEffect(() => {
    // If nothing changed from initial, don't fire the network call
    if (
      initial &&
      horizon === initial.horizonDays &&
      severity === initial.severity &&
      !vendorId
    ) {
      return
    }
    void refetch(horizon, severity, vendorId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [horizon, severity, vendorId])

  async function refetch(h: Horizon, s: Severity, v: string) {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      params.set('horizon', String(h))
      params.set('severity', s)
      if (v) params.set('vendorId', v)
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

  // Unique vendor list for the filter
  const vendorOptions = useMemo(() => {
    const map = new Map<string, string>()
    for (const it of data?.items || []) {
      if (it.preferredVendor) {
        map.set(it.preferredVendor.vendorId, it.preferredVendor.name)
      }
    }
    return Array.from(map.entries()).sort((a, b) => a[1].localeCompare(b[1]))
  }, [data])

  const summary = data?.summary || {
    shortSkus: 0,
    shortageDollars: 0,
    minDaysOfCoverage: null,
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
        description="SKUs the current demand forecast says we'll run short on, with open-PO coverage and affected jobs."
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
              onClick={() => void refetch(horizon, severity, vendorId)}
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
      <div className="grid gap-4 grid-cols-1 sm:grid-cols-3">
        <KPICard
          title="Short SKUs"
          value={fmtInt(summary.shortSkus)}
          subtitle={`over the next ${horizon} days`}
          accent={summary.shortSkus > 0 ? 'negative' : 'neutral'}
          icon={<AlertTriangle className="w-4 h-4" />}
        />
        <KPICard
          title="Shortage $"
          value={fmtMoney(summary.shortageDollars)}
          subtitle="at current Product.cost"
          accent={summary.shortageDollars > 0 ? 'negative' : 'neutral'}
        />
        <KPICard
          title="Min days of coverage"
          value={
            summary.minDaysOfCoverage === null
              ? '—'
              : `${summary.minDaysOfCoverage.toFixed(1)}d`
          }
          subtitle="tightest SKU in the set"
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
        <CardBody className="flex flex-col sm:flex-row sm:items-center gap-3">
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
              <button
                type="button"
                className={`px-3 py-1.5 text-sm transition-colors ${
                  severity === 'all'
                    ? 'bg-[var(--c2)] text-white'
                    : 'bg-transparent text-fg hover:bg-surface-muted'
                }`}
                onClick={() => setSeverity('all')}
                aria-pressed={severity === 'all'}
              >
                Any
              </button>
              <button
                type="button"
                className={`px-3 py-1.5 text-sm transition-colors ${
                  severity === 'high'
                    ? 'bg-[var(--c2)] text-white'
                    : 'bg-transparent text-fg hover:bg-surface-muted'
                }`}
                onClick={() => setSeverity('high')}
                aria-pressed={severity === 'high'}
              >
                High only
              </button>
            </div>
          </div>

          <div className="flex items-center gap-2 sm:ml-auto">
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
            severity === 'high'
              ? 'No SKUs meet the high-severity threshold. Try Any severity.'
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
                  <th className="text-left px-3 py-2.5 font-medium">SKU</th>
                  <th className="text-left px-3 py-2.5 font-medium">Description</th>
                  <th className="text-right px-3 py-2.5 font-medium">On-hand</th>
                  <th className="text-right px-3 py-2.5 font-medium">Forecast {horizon}d</th>
                  <th className="text-right px-3 py-2.5 font-medium">Short qty</th>
                  <th className="text-right px-3 py-2.5 font-medium">Short $</th>
                  <th className="text-left px-3 py-2.5 font-medium">Earliest short</th>
                  <th className="text-left px-3 py-2.5 font-medium">Open POs</th>
                  <th className="text-right px-3 py-2.5 font-medium">Jobs</th>
                  <th className="text-right px-3 py-2.5 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {data!.items.map((it) => {
                  const tightCoverage =
                    it.daysOfCoverage !== null && it.daysOfCoverage <= 3
                  const mailto = buildMailto(it, data!.horizonDays)
                  const vendorMissing = !it.preferredVendor?.email
                  return (
                    <tr
                      key={it.productId}
                      className="border-t border-border hover:bg-surface-muted/40 transition-colors"
                    >
                      <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">
                        {it.sku}
                      </td>
                      <td className="px-3 py-2 min-w-[220px]">
                        <div className="truncate max-w-[360px]" title={it.name}>
                          {it.name}
                        </div>
                        {it.category && (
                          <div className="text-xs text-fg-subtle">{it.category}</div>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {fmtInt(it.available)}
                        {it.onHand !== it.available && (
                          <span
                            className="text-xs text-fg-subtle ml-1"
                            title={`onHand ${it.onHand}, available ${it.available}`}
                          >
                            /{fmtInt(it.onHand)}
                          </span>
                        )}
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
                        {it.daysOfCoverage !== null && (
                          <div className="text-xs text-fg-subtle">
                            {it.daysOfCoverage.toFixed(1)}d coverage
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums font-medium">
                        {fmtMoney(it.shortageDollars)}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        {it.earliestShortDate ? (
                          <Badge
                            variant={tightCoverage ? 'danger' : 'warning'}
                            size="sm"
                          >
                            {fmtDate(it.earliestShortDate)}
                          </Badge>
                        ) : (
                          <span className="text-fg-subtle">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {it.openPoCount > 0 ? (
                          <div className="text-xs">
                            <span className="font-medium">{it.openPoCount}</span>{' '}
                            PO{it.openPoCount === 1 ? '' : 's'} ·{' '}
                            {fmtInt(it.inTransitQty)} in transit
                            {it.earliestExpected && (
                              <div className="text-fg-subtle">
                                ETA {fmtDate(it.earliestExpected)}
                              </div>
                            )}
                          </div>
                        ) : (
                          <span className="text-fg-subtle text-xs">None</span>
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
                      <td className="px-3 py-2 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1">
                          {vendorMissing ? (
                            <span
                              className="text-xs text-fg-subtle"
                              title="No preferred vendor email on file"
                            >
                              No vendor
                            </span>
                          ) : (
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
                            View SKU
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
