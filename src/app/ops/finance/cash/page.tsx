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
  const [loading, setLoading] = useState(false)

  async function load() {
    setLoading(true)
    try {
      const [c, a, pp, g, d] = await Promise.allSettled([
        fetch('/api/ops/finance/cash-dashboard').then((r) => r.json()),
        fetch('/api/ops/finance/ar-heatmap').then((r) => r.json()),
        fetch('/api/ops/finance/ap-schedule').then((r) => r.json()),
        fetch('/api/ops/finance/gross-margin').then((r) => r.json()),
        fetch('/api/ops/finance/dso-compliance').then((r) => r.json()),
      ])
      if (c.status === 'fulfilled') setCash(c.value)
      if (a.status === 'fulfilled') setAr(a.value)
      if (pp.status === 'fulfilled') setAp(pp.value)
      if (g.status === 'fulfilled') setGm(g.value)
      if (d.status === 'fulfilled') setDso(d.value)
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
                          onClick={() => sendCollectionEmail(r.builderId, r.builderName)}
                          className="text-[11px] text-accent-fg hover:underline"
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
