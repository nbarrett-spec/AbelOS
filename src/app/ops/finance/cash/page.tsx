'use client'

import { useEffect, useState } from 'react'
import { PageHeader, KPICard, Card, Button, Badge, DataTable } from '@/components/ui'

interface CashDash {
  trailing30: {
    cashIn: number
    cashOut: number
    net: number
    paymentCount: number
    poReceivedCount: number
  }
  openTotals: { openAR: number; openAP: number; arCount: number; apCount: number }
  forecast: Array<{ weekStart: string; cashIn: number; cashOut: number; net: number; cumNet: number }>
}

interface ARHeatmap {
  bucketOrder: string[]
  rows: Array<{
    builderId: string
    builderName: string
    buckets: Record<string, { amount: number; count: number; invoiceIds: string[] }>
    total: number
  }>
  totals: Record<string, number>
  grandTotal: number
}

interface APSchedule {
  buckets: Record<string, any[]>
  totals: Record<string, number>
  counts: Record<string, number>
}

interface GrossMargin {
  rows: Array<{
    builderId: string
    builderName: string
    revenue: number
    cogs: number
    gmDollar: number
    gmPct: number
    band: 'green' | 'amber' | 'red' | 'neutral'
    orderCount: number
  }>
  totals: { revenue: number; cogs: number; gmDollar: number; gmPct: number }
}

interface DsoCompliance {
  rows: Array<{
    builderId: string
    builderName: string
    avgDso: number
    contractTerm: string
    contractDays: number
    deltaDays: number
    flagged: boolean
    invoiceCount: number
    totalRevenue: number
  }>
  flaggedCount: number
}

interface ARFeed {
  invoices: Array<{
    id: string
    invoiceNumber: string
    builderId: string
    builderName: string
    balanceDue: number
    dueDate: string | null
    issuedAt: string | null
    daysPastDue: number
  }>
}

interface ProjectionWeek {
  weekStart: Date
  weekLabel: string // 'MM/DD'
  total: number
  invoiceCount: number
  // weighted average builder lag for the bucket — used to label confidence
  highConfidenceAmount: number
  medConfidenceAmount: number
  lowConfidenceAmount: number
  hasConfidenceData: boolean
}

const USD = (n: number) =>
  n >= 1_000_000
    ? `$${(n / 1_000_000).toFixed(2)}M`
    : n >= 10_000
      ? `$${Math.round(n / 1000)}k`
      : `$${Math.round(n).toLocaleString()}`

export default function CashCommandCenter() {
  const [cash, setCash] = useState<CashDash | null>(null)
  const [ar, setAr] = useState<ARHeatmap | null>(null)
  const [ap, setAp] = useState<APSchedule | null>(null)
  const [gm, setGm] = useState<GrossMargin | null>(null)
  const [dso, setDso] = useState<DsoCompliance | null>(null)
  const [arFeed, setArFeed] = useState<ARFeed | null>(null)
  const [loading, setLoading] = useState(false)

  async function load() {
    setLoading(true)
    try {
      const [c, a, pp, g, d, f] = await Promise.allSettled([
        fetch('/api/ops/finance/cash-dashboard').then((r) => r.json()),
        fetch('/api/ops/finance/ar-heatmap').then((r) => r.json()),
        fetch('/api/ops/finance/ap-schedule').then((r) => r.json()),
        fetch('/api/ops/finance/gross-margin').then((r) => r.json()),
        fetch('/api/ops/finance/dso-compliance').then((r) => r.json()),
        fetch('/api/ops/finance/ar').then((r) => r.json()),
      ])
      if (c.status === 'fulfilled') setCash(c.value)
      if (a.status === 'fulfilled') setAr(a.value)
      if (pp.status === 'fulfilled') setAp(pp.value)
      if (g.status === 'fulfilled') setGm(g.value)
      if (d.status === 'fulfilled') setDso(d.value)
      if (f.status === 'fulfilled') setArFeed(f.value)
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => {
    load()
  }, [])

  function downloadCsv() {
    if (!cash) return
    const rows = [
      ['Metric', 'Value'],
      ['Cash in (30d)', cash.trailing30.cashIn],
      ['Cash out (30d)', cash.trailing30.cashOut],
      ['Net (30d)', cash.trailing30.net],
      ['Open AR', cash.openTotals.openAR],
      ['Open AP', cash.openTotals.openAP],
      [''],
      ['Week', 'Cash in', 'Cash out', 'Net', 'Cum Net'],
      ...cash.forecast.map((f) => [f.weekStart, f.cashIn, f.cashOut, f.net, f.cumNet]),
    ]
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `cash-dashboard-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  function copyForHW() {
    if (!cash || !gm || !ar) return
    const lines = [
      `Abel Lumber — Cash Snapshot`,
      `As of ${new Date().toLocaleDateString('en-US')}`,
      ``,
      `Trailing 30 days: net cash ${USD(cash.trailing30.net)} (in ${USD(cash.trailing30.cashIn)}, out ${USD(cash.trailing30.cashOut)})`,
      `Open receivables: ${USD(cash.openTotals.openAR)} across ${cash.openTotals.arCount} invoices`,
      `Open payables: ${USD(cash.openTotals.openAP)} across ${cash.openTotals.apCount} POs`,
      ``,
      `YTD revenue ${USD(gm.totals.revenue)}, gross margin ${(gm.totals.gmPct * 100).toFixed(1)}% (${USD(gm.totals.gmDollar)})`,
      `AR over 60 days past due: ${USD((ar.totals['61-90'] || 0) + (ar.totals['90+'] || 0))}`,
    ]
    navigator.clipboard.writeText(lines.join('\n'))
    alert('Copied HW-ready snapshot to clipboard.')
  }

  return (
    <div className="min-h-screen bg-canvas text-fg">
      <div className="max-w-[1800px] mx-auto p-6 space-y-5">
        <PageHeader
          eyebrow="Finance"
          title="Cash Command Center"
          description="Cash position, receivables aging, payables schedule, gross margin, and DSO compliance — in one sheet."
          crumbs={[
            { label: 'Ops', href: '/ops' },
            { label: 'Finance', href: '/ops/finance' },
            { label: 'Cash' },
          ]}
          actions={
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" loading={loading} onClick={load}>
                Refresh
              </Button>
              <Button variant="outline" size="sm" onClick={downloadCsv}>
                Download CSV
              </Button>
              <Button variant="primary" size="sm" onClick={copyForHW}>
                Copy for HW pitch
              </Button>
            </div>
          }
        />

        {/* Top KPIs */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <KPICard
            title="Net Cash — 30d"
            value={cash ? USD(cash.trailing30.net) : '—'}
            subtitle={cash ? `${USD(cash.trailing30.cashIn)} in / ${USD(cash.trailing30.cashOut)} out` : undefined}
            accent={cash && cash.trailing30.net >= 0 ? 'positive' : 'negative'}
          />
          <KPICard
            title="Open AR"
            value={cash ? USD(cash.openTotals.openAR) : '—'}
            subtitle={cash ? `${cash.openTotals.arCount} invoices` : undefined}
            accent="brand"
          />
          <KPICard
            title="Open AP"
            value={cash ? USD(cash.openTotals.openAP) : '—'}
            subtitle={cash ? `${cash.openTotals.apCount} POs` : undefined}
            accent="accent"
          />
          <KPICard
            title="YTD GM%"
            value={gm ? `${(gm.totals.gmPct * 100).toFixed(1)}%` : '—'}
            subtitle={gm ? `${USD(gm.totals.gmDollar)} GM$ on ${USD(gm.totals.revenue)}` : undefined}
            accent={gm && gm.totals.gmPct >= 0.3 ? 'positive' : gm && gm.totals.gmPct >= 0.15 ? 'accent' : 'negative'}
          />
        </div>

        {/* Forecast waterfall */}
        {cash && (
          <Card padding="md">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-fg">90-day cash forecast</h3>
              <span className="text-xs text-fg-muted">
                bars: weekly net · line: cumulative
              </span>
            </div>
            <CashWaterfall forecast={cash.forecast} />
          </Card>
        )}

        {/* Projected Cash Inflows — predicted from open invoices + builder lag */}
        {arFeed && arFeed.invoices && arFeed.invoices.length > 0 && (() => {
          const projection = computeInflowProjection(arFeed.invoices, dso?.rows || [])
          if (projection.weeks.length === 0) return null
          return (
            <Card padding="md">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h3 className="text-sm font-semibold text-fg">Projected cash inflows</h3>
                  <p className="text-[11px] text-fg-muted mt-0.5">
                    Open invoices, projected by builder payment patterns. Predicted pay date = due date + average builder lag.
                  </p>
                </div>
                <div className="text-xs text-fg-muted">
                  {projection.totalProjected > 0 ? (
                    <>
                      Next {projection.weeks.length} weeks:{' '}
                      <strong className="text-fg">{USD(projection.totalProjected)}</strong>
                      {' · '}
                      {projection.totalCount} invoices
                    </>
                  ) : (
                    'No projected inflows in window'
                  )}
                </div>
              </div>
              <ProjectedInflowsChart weeks={projection.weeks} />
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-surface-muted/50">
                    <tr>
                      <th className="text-left px-3 py-2 text-xs font-medium text-fg-muted">Week of</th>
                      <th className="text-right px-3 py-2 text-xs font-medium text-fg-muted">Projected</th>
                      <th className="text-right px-3 py-2 text-xs font-medium text-fg-muted">Invoices</th>
                      <th className="text-left px-3 py-2 text-xs font-medium text-fg-muted">Confidence</th>
                    </tr>
                  </thead>
                  <tbody>
                    {projection.weeks.map((w) => {
                      const dom = dominantConfidence(w)
                      return (
                        <tr key={w.weekLabel} className="border-t border-border">
                          <td className="px-3 py-2 text-sm">{w.weekLabel}</td>
                          <td className="px-3 py-2 text-right font-numeric text-sm">{USD(w.total)}</td>
                          <td className="px-3 py-2 text-right font-numeric text-sm">{w.invoiceCount}</td>
                          <td className="px-3 py-2 text-sm">
                            {w.hasConfidenceData ? (
                              <Badge
                                variant={dom === 'high' ? 'success' : dom === 'med' ? 'warning' : 'danger'}
                                size="sm"
                              >
                                {dom === 'high' ? 'High — pays on time' : dom === 'med' ? 'Medium — some lag' : 'Low — chronically late'}
                              </Badge>
                            ) : (
                              <span className="text-[11px] text-fg-subtle">No history</span>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              {!projection.anyConfidenceData && (
                <p className="mt-2 text-[11px] text-fg-subtle">
                  Builder payment-lag history not yet available — projections assume invoices land on their due date.
                </p>
              )}
            </Card>
          )
        })()}

        {/* AR Heatmap */}
        {ar && (
          <Card padding="none" className="overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <h3 className="text-sm font-semibold text-fg">AR aging heatmap</h3>
              <div className="text-xs text-fg-muted">
                Total outstanding: <strong className="text-fg">{USD(ar.grandTotal)}</strong>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-surface-muted/50">
                  <tr>
                    <th className="text-left px-3 py-2 text-xs font-medium text-fg-muted">Builder</th>
                    {ar.bucketOrder.map((b) => (
                      <th key={b} className="px-3 py-2 text-xs font-medium text-fg-muted text-right uppercase tracking-wide">
                        {b}
                      </th>
                    ))}
                    <th className="px-3 py-2 text-xs font-medium text-fg-muted text-right">Total</th>
                    <th className="px-3 py-2 text-xs font-medium text-fg-muted text-right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {ar.rows.map((r) => (
                    <tr key={r.builderId} className="border-t border-border">
                      <td className="px-3 py-2 text-sm">{r.builderName}</td>
                      {ar.bucketOrder.map((b) => {
                        const cell = r.buckets[b]
                        const intensity =
                          b === 'current'
                            ? 0.06
                            : b === '1-30'
                              ? 0.12
                              : b === '31-60'
                                ? 0.25
                                : b === '61-90'
                                  ? 0.45
                                  : 0.7
                        const color =
                          b === 'current' ? 'var(--data-positive)' : b === '1-30' ? 'var(--data-warning)' : 'var(--data-negative)'
                        const relativeScale = Math.min(1, cell.amount / Math.max(r.total, 1))
                        const bg =
                          cell.amount === 0
                            ? 'transparent'
                            : `color-mix(in oklab, ${color} ${Math.round(intensity * 100 + relativeScale * 20)}%, transparent)`
                        return (
                          <td
                            key={b}
                            className="px-3 py-2 text-right font-numeric text-sm"
                            style={{ background: bg }}
                            title={`${cell.count} invoice${cell.count === 1 ? '' : 's'}`}
                          >
                            {cell.amount ? USD(cell.amount) : ''}
                          </td>
                        )
                      })}
                      <td className="px-3 py-2 text-right font-numeric text-sm font-semibold">{USD(r.total)}</td>
                      <td className="px-3 py-2 text-right">
                        <button
                          disabled
                          aria-disabled="true"
                          title="Not yet wired — /api/ops/collections/send-email endpoint is pending. Use the Collections cycle workflow in the meantime."
                          className="text-[11px] text-fg-muted cursor-not-allowed opacity-50"
                        >
                          Send collection
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-t-2 border-border bg-surface-muted/30">
                  <tr>
                    <td className="px-3 py-2 text-xs font-semibold text-fg-muted uppercase">Totals</td>
                    {ar.bucketOrder.map((b) => (
                      <td key={b} className="px-3 py-2 text-right font-numeric text-sm">
                        {USD(ar.totals[b] || 0)}
                      </td>
                    ))}
                    <td className="px-3 py-2 text-right font-numeric text-sm font-bold">{USD(ar.grandTotal)}</td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          </Card>
        )}

        {/* AP Schedule */}
        {ap && (
          <Card padding="md">
            <h3 className="text-sm font-semibold text-fg mb-3">AP payment schedule</h3>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              {(['overdue', 'this_week', 'next_week', 'later', 'no_date'] as const).map((w) => (
                <div key={w} className="panel p-3 rounded-md">
                  <div className="eyebrow">{w.replace('_', ' ')}</div>
                  <div className="metric metric-md mt-1">{USD(ap.totals[w] || 0)}</div>
                  <div className="text-[11px] text-fg-muted mt-1">
                    {ap.counts[w] || 0} POs
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-4 space-y-4">
              {(['overdue', 'this_week', 'next_week', 'later'] as const).map((w) => {
                const items = ap.buckets[w] || []
                if (items.length === 0) return null
                return (
                  <div key={w}>
                    <div className="text-xs font-semibold text-fg-muted uppercase tracking-wider mb-1">
                      {w.replace('_', ' ')}
                    </div>
                    <div className="space-y-1">
                      {items.slice(0, 5).map((po: any) => (
                        <div
                          key={po.id}
                          className="flex items-center justify-between text-sm py-1 border-b border-border last:border-0"
                        >
                          <div className="min-w-0">
                            <span className="font-mono text-xs text-fg-muted">{po.poNumber}</span>{' '}
                            <span className="text-fg">{po.vendorName}</span>
                          </div>
                          <div className="flex items-center gap-3 shrink-0">
                            <span className="font-numeric">{USD(po.total)}</span>
                            {po.daysFromNow != null && (
                              <span
                                className={`text-[11px] ${
                                  po.daysFromNow < 0
                                    ? 'text-data-negative'
                                    : po.daysFromNow <= 7
                                      ? 'text-data-warning'
                                      : 'text-fg-muted'
                                }`}
                              >
                                {po.daysFromNow < 0
                                  ? `${Math.abs(po.daysFromNow)}d late`
                                  : `${po.daysFromNow}d`}
                              </span>
                            )}
                          </div>
                        </div>
                      ))}
                      {items.length > 5 && (
                        <div className="text-[11px] text-fg-subtle">
                          +{items.length - 5} more
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </Card>
        )}

        {/* Gross Margin */}
        {gm && (
          <Card padding="none" className="overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <h3 className="text-sm font-semibold text-fg">Gross margin by builder — YTD</h3>
              <div className="text-xs text-fg-muted">
                Total: {USD(gm.totals.revenue)} rev · {(gm.totals.gmPct * 100).toFixed(1)}% GM
              </div>
            </div>
            <DataTable
              data={gm.rows}
              rowKey={(r) => r.builderId}
              empty="No revenue YTD."
              columns={[
                { key: 'name', header: 'Builder', cell: (r) => r.builderName },
                { key: 'rev', header: 'Revenue', numeric: true, cell: (r) => USD(r.revenue) },
                { key: 'cogs', header: 'COGS', numeric: true, cell: (r) => USD(r.cogs) },
                { key: 'gmd', header: 'GM$', numeric: true, cell: (r) => USD(r.gmDollar) },
                {
                  key: 'gmp',
                  header: 'GM%',
                  numeric: true,
                  cell: (r) => {
                    const color =
                      r.band === 'green'
                        ? 'text-data-positive'
                        : r.band === 'amber'
                          ? 'text-data-warning'
                          : r.band === 'red'
                            ? 'text-data-negative'
                            : ''
                    return <span className={`font-semibold ${color}`}>{(r.gmPct * 100).toFixed(1)}%</span>
                  },
                },
                { key: 'orders', header: 'Orders', numeric: true, cell: (r) => r.orderCount },
              ]}
            />
          </Card>
        )}

        {/* DSO compliance */}
        {dso && (
          <Card padding="none" className="overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <h3 className="text-sm font-semibold text-fg">Payment terms compliance</h3>
              <div className="text-xs">
                <Badge variant={dso.flaggedCount > 0 ? 'danger' : 'success'} size="sm">
                  {dso.flaggedCount} flagged
                </Badge>
              </div>
            </div>
            <DataTable
              data={dso.rows}
              rowKey={(r) => r.builderId}
              empty="No paid invoices in the last 90 days."
              columns={[
                { key: 'b', header: 'Builder', cell: (r) => r.builderName },
                { key: 't', header: 'Contract', cell: (r) => r.contractTerm.replace('_', ' ') },
                {
                  key: 'cd',
                  header: 'Contract Days',
                  numeric: true,
                  cell: (r) => r.contractDays,
                },
                {
                  key: 'ad',
                  header: 'Actual DSO',
                  numeric: true,
                  cell: (r) => (
                    <span className={r.flagged ? 'text-data-negative font-semibold' : ''}>
                      {r.avgDso}d
                    </span>
                  ),
                },
                {
                  key: 'delta',
                  header: 'Δ',
                  numeric: true,
                  cell: (r) => (
                    <span className={r.flagged ? 'text-data-negative font-semibold' : r.deltaDays < 0 ? 'text-data-positive' : ''}>
                      {r.deltaDays > 0 ? `+${r.deltaDays}` : r.deltaDays}
                    </span>
                  ),
                },
                { key: 'n', header: 'Invoices', numeric: true, cell: (r) => r.invoiceCount },
                { key: 'rev', header: 'Revenue', numeric: true, cell: (r) => USD(r.totalRevenue) },
              ]}
            />
          </Card>
        )}

        <div className="flex justify-end">
          <a
            href="/ops/finance/modeler"
            className="text-sm text-accent-fg hover:underline"
          >
            Open the "$1M scenario" modeler →
          </a>
        </div>
      </div>
    </div>
  )

  async function sendCollectionEmail(builderId: string, builderName: string) {
    // TODO: no /api/ops/collections/send-email endpoint exists yet (only
    // /api/ops/collections, /api/ops/collections/run-cycle, /api/ops/collections/rules).
    // Fail loudly instead of a silent "queued" toast so we don't pretend to
    // have sent anything. Wire to a real endpoint when one ships.
    void builderId
    alert(`Not implemented: collection email for ${builderName}. No backing endpoint yet.`)
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Inflow projection — predict payment date per open invoice using builder
// avg DSO delta as the lag proxy. Group into the next N weekly buckets.
// ──────────────────────────────────────────────────────────────────────────
const INFLOW_WEEKS = 6 // 6-week horizon

function startOfMonday(d: Date): Date {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  // ISO week (Mon=0). Mon JS getDay()=1 → 0; Sun=0 → 6.
  const off = (x.getDay() + 6) % 7
  x.setDate(x.getDate() - off)
  return x
}

function fmtMmDd(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${m}/${dd}`
}

function computeInflowProjection(
  invoices: ARFeed['invoices'],
  dsoRows: DsoCompliance['rows'],
): { weeks: ProjectionWeek[]; totalProjected: number; totalCount: number; anyConfidenceData: boolean } {
  // builderId → lag days (positive = pays late vs. due, negative clamped to 0)
  // Confidence: high if delta ≤ 5, med if 5–15, low if > 15 (or flagged).
  const lagByBuilder = new Map<string, { lag: number; flagged: boolean; hasData: boolean }>()
  for (const row of dsoRows) {
    lagByBuilder.set(row.builderId, {
      lag: Math.max(0, row.deltaDays),
      flagged: row.flagged,
      hasData: true,
    })
  }

  const now = new Date()
  const weekStart0 = startOfMonday(now)
  const weeks: ProjectionWeek[] = []
  for (let i = 0; i < INFLOW_WEEKS; i++) {
    const ws = new Date(weekStart0)
    ws.setDate(ws.getDate() + i * 7)
    weeks.push({
      weekStart: ws,
      weekLabel: fmtMmDd(ws),
      total: 0,
      invoiceCount: 0,
      highConfidenceAmount: 0,
      medConfidenceAmount: 0,
      lowConfidenceAmount: 0,
      hasConfidenceData: false,
    })
  }
  const horizonEnd = new Date(weekStart0)
  horizonEnd.setDate(horizonEnd.getDate() + INFLOW_WEEKS * 7)

  let totalProjected = 0
  let totalCount = 0
  let anyConfidenceData = false

  for (const inv of invoices) {
    if (!inv.balanceDue || inv.balanceDue <= 0) continue
    // Reference date for projecting payment: dueDate when present, else
    // issuedAt (treated as due immediately). If neither, skip.
    const baseStr = inv.dueDate || inv.issuedAt
    if (!baseStr) continue
    const base = new Date(baseStr)
    if (isNaN(base.getTime())) continue

    const builderInfo = lagByBuilder.get(inv.builderId)
    const lagDays = builderInfo?.lag ?? 0
    if (builderInfo?.hasData) anyConfidenceData = true

    const predicted = new Date(base)
    predicted.setDate(predicted.getDate() + Math.round(lagDays))
    // Past-dated predictions roll into the current week (cash you should
    // already be chasing).
    const projected = predicted < weekStart0 ? weekStart0 : predicted
    if (projected >= horizonEnd) continue

    const idx = Math.floor((projected.getTime() - weekStart0.getTime()) / (7 * 24 * 60 * 60 * 1000))
    if (idx < 0 || idx >= weeks.length) continue

    const wk = weeks[idx]
    wk.total += inv.balanceDue
    wk.invoiceCount += 1
    totalProjected += inv.balanceDue
    totalCount += 1

    if (builderInfo?.hasData) {
      wk.hasConfidenceData = true
      // High: pays within 5d of due. Med: 5–15d lag. Low: >15d or flagged.
      if (builderInfo.flagged || lagDays > 15) wk.lowConfidenceAmount += inv.balanceDue
      else if (lagDays > 5) wk.medConfidenceAmount += inv.balanceDue
      else wk.highConfidenceAmount += inv.balanceDue
    }
  }

  return { weeks, totalProjected, totalCount, anyConfidenceData }
}

function dominantConfidence(w: ProjectionWeek): 'high' | 'med' | 'low' {
  const { highConfidenceAmount: h, medConfidenceAmount: m, lowConfidenceAmount: l } = w
  if (l >= h && l >= m) return 'low'
  if (m >= h && m >= l) return 'med'
  return 'high'
}

function ProjectedInflowsChart({ weeks }: { weeks: ProjectionWeek[] }) {
  const w = 900
  const h = 200
  const padL = 50
  const padR = 12
  const padT = 12
  const padB = 36
  const innerW = w - padL - padR
  const innerH = h - padT - padB
  const n = weeks.length || 1
  const slot = innerW / n
  const barW = slot * 0.65
  const max = Math.max(1, ...weeks.map((wk) => wk.total))

  return (
    <svg width={w} height={h} className="w-full" viewBox={`0 0 ${w} ${h}`}>
      {/* y-axis baseline */}
      <line x1={padL} y1={padT + innerH} x2={w - padR} y2={padT + innerH} stroke="var(--border)" />
      {/* gridline at midpoint */}
      <line
        x1={padL}
        y1={padT + innerH / 2}
        x2={w - padR}
        y2={padT + innerH / 2}
        stroke="var(--border)"
        strokeDasharray="2 2"
        opacity={0.5}
      />
      <text x={padL - 6} y={padT + 4} fontSize="9" textAnchor="end" fill="var(--fg-subtle)" fontFamily="var(--font-numeric)">
        {`$${Math.round(max / 1000)}k`}
      </text>
      <text
        x={padL - 6}
        y={padT + innerH / 2 + 3}
        fontSize="9"
        textAnchor="end"
        fill="var(--fg-subtle)"
        fontFamily="var(--font-numeric)"
      >
        {`$${Math.round(max / 2000)}k`}
      </text>

      {weeks.map((wk, i) => {
        const x = padL + i * slot + (slot - barW) / 2
        // Stack: high (positive), med (warning), low (negative) bottom-up so
        // the worst stuff is most visible at the base of the bar.
        const lowH = (wk.lowConfidenceAmount / max) * innerH
        const medH = (wk.medConfidenceAmount / max) * innerH
        const highH = (wk.highConfidenceAmount / max) * innerH
        const noDataH =
          ((wk.total - wk.lowConfidenceAmount - wk.medConfidenceAmount - wk.highConfidenceAmount) / max) * innerH
        const baseY = padT + innerH

        let yCursor = baseY
        const segs: Array<{ amount: number; height: number; color: string; opacity: number }> = []
        if (lowH > 0) segs.push({ amount: wk.lowConfidenceAmount, height: lowH, color: 'var(--data-negative)', opacity: 0.85 })
        if (medH > 0) segs.push({ amount: wk.medConfidenceAmount, height: medH, color: 'var(--data-warning)', opacity: 0.85 })
        if (highH > 0) segs.push({ amount: wk.highConfidenceAmount, height: highH, color: 'var(--data-positive)', opacity: 0.85 })
        if (noDataH > 0) segs.push({ amount: wk.total - wk.lowConfidenceAmount - wk.medConfidenceAmount - wk.highConfidenceAmount, height: noDataH, color: 'var(--fg-subtle)', opacity: 0.4 })

        return (
          <g key={i}>
            {segs.map((s, j) => {
              yCursor -= s.height
              return (
                <rect
                  key={j}
                  x={x}
                  y={yCursor}
                  width={barW}
                  height={Math.max(1, s.height)}
                  fill={s.color}
                  opacity={s.opacity}
                  rx={2}
                >
                  <title>{`Week of ${wk.weekLabel}: ${USD(s.amount)}`}</title>
                </rect>
              )
            })}
            <text
              x={x + barW / 2}
              y={baseY + 14}
              textAnchor="middle"
              fontSize="10"
              fill="var(--fg-muted)"
              fontFamily="var(--font-numeric)"
            >
              {wk.weekLabel}
            </text>
            {wk.total > 0 && (
              <text
                x={x + barW / 2}
                y={baseY - (lowH + medH + highH + noDataH) - 4}
                textAnchor="middle"
                fontSize="9"
                fill="var(--fg-muted)"
                fontFamily="var(--font-numeric)"
              >
                {USD(wk.total)}
              </text>
            )}
          </g>
        )
      })}

      {/* Legend */}
      <g transform={`translate(${padL}, ${h - 6})`}>
        <rect x={0} y={-8} width={9} height={9} fill="var(--data-positive)" opacity={0.85} rx={1.5} />
        <text x={13} y={0} fontSize="9" fill="var(--fg-muted)">High</text>
        <rect x={48} y={-8} width={9} height={9} fill="var(--data-warning)" opacity={0.85} rx={1.5} />
        <text x={61} y={0} fontSize="9" fill="var(--fg-muted)">Medium</text>
        <rect x={108} y={-8} width={9} height={9} fill="var(--data-negative)" opacity={0.85} rx={1.5} />
        <text x={121} y={0} fontSize="9" fill="var(--fg-muted)">Low</text>
        <rect x={155} y={-8} width={9} height={9} fill="var(--fg-subtle)" opacity={0.4} rx={1.5} />
        <text x={168} y={0} fontSize="9" fill="var(--fg-muted)">No history</text>
      </g>
    </svg>
  )
}

// ──────────────────────────────────────────────────────────────────────────
// Cash waterfall — pure SVG
// ──────────────────────────────────────────────────────────────────────────
function CashWaterfall({ forecast }: { forecast: CashDash['forecast'] }) {
  const w = 900
  const h = 220
  const padL = 40
  const padR = 10
  const padT = 10
  const padB = 30
  const innerW = w - padL - padR
  const innerH = h - padT - padB
  const n = forecast.length
  const barW = (innerW / n) * 0.7
  const gap = (innerW / n) * 0.3

  const mins = Math.min(0, ...forecast.map((f) => f.cumNet), ...forecast.map((f) => f.net))
  const maxs = Math.max(0, ...forecast.map((f) => f.cumNet), ...forecast.map((f) => f.net))
  const range = maxs - mins || 1
  const yFor = (v: number) => padT + innerH - ((v - mins) / range) * innerH
  const y0 = yFor(0)

  const linePoints = forecast
    .map((f, i) => {
      const x = padL + i * (barW + gap) + barW / 2
      return `${x},${yFor(f.cumNet)}`
    })
    .join(' ')

  return (
    <svg width={w} height={h} className="w-full" viewBox={`0 0 ${w} ${h}`}>
      {/* baseline */}
      <line x1={padL} y1={y0} x2={w - padR} y2={y0} stroke="var(--border)" strokeDasharray="2 2" />
      {forecast.map((f, i) => {
        const x = padL + i * (barW + gap)
        const barH = Math.abs(yFor(f.net) - y0)
        const y = f.net >= 0 ? yFor(f.net) : y0
        const fill = f.net >= 0 ? 'var(--data-positive)' : 'var(--data-negative)'
        return (
          <g key={i}>
            <rect x={x} y={y} width={barW} height={Math.max(1, barH)} fill={fill} opacity={0.75} rx={2} />
            {i % 2 === 0 && (
              <text
                x={x + barW / 2}
                y={h - 10}
                textAnchor="middle"
                fontSize="9"
                fill="var(--fg-subtle)"
                fontFamily="var(--font-numeric)"
              >
                {f.weekStart.slice(5)}
              </text>
            )}
          </g>
        )
      })}
      <polyline points={linePoints} fill="none" stroke="var(--brand)" strokeWidth="2" />
      {forecast.map((f, i) => {
        const x = padL + i * (barW + gap) + barW / 2
        const y = yFor(f.cumNet)
        return <circle key={i} cx={x} cy={y} r="2.5" fill="var(--brand)" />
      })}
    </svg>
  )
}
