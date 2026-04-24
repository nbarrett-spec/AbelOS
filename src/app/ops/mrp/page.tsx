'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  PageHeader,
  KPICard,
  Card,
  Badge,
  DataTable,
  Tabs,
  Button,
  EmptyState,
  AnimatedNumber,
  LiveDataIndicator,
  InfoTip,
} from '@/components/ui'
import { useLiveTick } from '@/hooks/useLiveTopic'

type Tab =
  | 'overview'
  | 'heatmap'
  | 'stockouts'
  | 'queue'
  | 'explode'
  | 'daily'
  | 'about'

interface Stockout {
  productId: string
  sku: string
  name: string
  category: string | null
  onHand: number
  totalDemand: number
  totalInbound: number
  endingBalance: number
  stockoutDate: string | null
  daysUntilStockout: number | null
  shortfallQty: number
  urgency: 'CRITICAL' | 'HIGH' | 'NORMAL' | 'LOW'
  preferredVendor: {
    vendorId: string
    name: string
    leadTimeDays: number | null
    vendorCost: number | null
    minOrderQty: number
  } | null
}

interface StockoutsResponse {
  asOf: string
  horizonDays: number
  unscheduledJobCount: number
  summary: {
    total: number
    critical: number
    high: number
    normal: number
    low: number
    estimatedReorderValue: number
  }
  stockouts: Stockout[]
}

interface HeatmapRow {
  productId: string
  sku: string
  name: string
  category: string | null
  buckets: number[]
  total: number
}

interface HeatmapResponse {
  weeks: number
  weekLabels: string[]
  maxCellValue: number
  rows: HeatmapRow[]
  totalSkus: number
}

interface QueueItem {
  id: string
  orderNumber: string
  poNumber: string | null
  status: string
  column: 'RECEIVED' | 'CONFIRMED' | 'IN_PRODUCTION' | 'READY_TO_SHIP'
  total: number
  deliveryDate: string | null
  daysToDelivery: number | null
  urgency: 'RED' | 'AMBER' | 'GREEN' | 'NONE'
  builderName: string
  builderId: string | null
  lineCount: number
  unitCount: number
  jobNumbers: string[]
  flagged: boolean
}

interface QueueResponse {
  columns: Array<QueueItem['column']>
  buckets: Record<QueueItem['column'], QueueItem[]>
  totals: {
    RECEIVED: number
    CONFIRMED: number
    IN_PRODUCTION: number
    READY_TO_SHIP: number
    AWAITING_MATERIAL: number
  }
}

interface DailyOutput {
  yesterday: { date: string; orders: number; units: number; onTime: number; late: number }
  rolling7: { avgOrdersPerDay: number; avgUnitsPerDay: number; onTimeRate: number | null }
  spark: Array<{ date: string; units: number; orders: number }>
  pmProductivity: Array<{ pmId: string; pmName: string; completed: number }>
}

interface ExplodeRow {
  productId: string
  sku: string
  name: string
  category: string | null
  quantity: number
  unitCost: number
  extendedCost: number
  onHand: number
  available: number
  shortfall: number
  fullyAvailable: boolean
}

interface ExplodeResponse {
  order: {
    id: string
    orderNumber: string
    status: string
    deliveryDate: string | null
    builderName: string | null
  }
  summary: {
    lineCount: number
    terminalCount: number
    totalExtendedCost: number
    shortfallCount: number
  }
  components: ExplodeRow[]
}

// ──────────────────────────────────────────────────────────────────────────

export default function MrpPage() {
  const [tab, setTab] = useState<Tab>('overview')
  const [stockouts, setStockouts] = useState<StockoutsResponse | null>(null)
  const [heatmap, setHeatmap] = useState<HeatmapResponse | null>(null)
  const [queue, setQueue] = useState<QueueResponse | null>(null)
  const [daily, setDaily] = useState<DailyOutput | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [flash, setFlash] = useState<string | null>(null)
  const [refreshTick, setRefreshTick] = useState<number | null>(null)
  const liveTick = useLiveTick('orders')

  const loadAll = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [so, hm, q, d] = await Promise.allSettled([
        fetch('/api/ops/mrp/stockouts').then((r) => (r.ok ? r.json() : null)),
        fetch('/api/ops/mrp/demand-heatmap').then((r) => (r.ok ? r.json() : null)),
        fetch('/api/ops/mrp/production-queue').then((r) => (r.ok ? r.json() : null)),
        fetch('/api/ops/mrp/daily-output').then((r) => (r.ok ? r.json() : null)),
      ])
      if (so.status === 'fulfilled') setStockouts(so.value)
      if (hm.status === 'fulfilled') setHeatmap(hm.value)
      if (q.status === 'fulfilled') setQueue(q.value)
      if (d.status === 'fulfilled') setDaily(d.value)
      setRefreshTick(Date.now())
    } catch (e: any) {
      setError(e?.message || 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { if (liveTick > 0) loadAll() /* eslint-disable-next-line */ }, [liveTick])

  // Run setup + initial load once
  useEffect(() => {
    fetch('/api/ops/mrp/setup', { method: 'POST' }).catch(() => {})
    loadAll()
  }, [loadAll])

  // Clear flash banner
  useEffect(() => {
    if (!flash) return
    const t = setTimeout(() => setFlash(null), 4000)
    return () => clearTimeout(t)
  }, [flash])

  async function handleGeneratePO(productId: string, sku: string) {
    try {
      const res = await fetch('/api/ops/mrp/suggest-po', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`)
      setFlash(`Drafted ${json.po.poNumber} for ${sku}`)
    } catch (e: any) {
      setFlash(`PO failed: ${e?.message || 'error'}`)
    }
  }

  async function handleAdvanceOrder(orderId: string, newStatus: string) {
    try {
      const res = await fetch('/api/ops/mrp/production-queue', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId, status: newStatus }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const updated = await fetch('/api/ops/mrp/production-queue').then((r) => r.json())
      setQueue(updated)
      setFlash(`Moved to ${newStatus}`)
    } catch (e: any) {
      setFlash(`Move failed: ${e?.message}`)
    }
  }

  return (
    <div className="min-h-screen bg-canvas text-fg">
      <div className="max-w-[1800px] mx-auto p-6 space-y-5">
        <LiveDataIndicator trigger={refreshTick} />
        <PageHeader
          eyebrow="Manufacturing"
          title="Material Requirements Planning"
          description="Forward-looking demand, stockout risk, BOM explosion, and floor throughput — all in one place."
          crumbs={[{ label: 'Ops', href: '/ops' }, { label: 'MRP' }]}
          actions={
            <>
              <Button variant="ghost" size="sm" onClick={loadAll} loading={loading}>
                Refresh
              </Button>
            </>
          }
        />

        {flash && (
          <Card padding="xs" className="border-accent/40 bg-accent-subtle text-accent-fg">
            {flash}
          </Card>
        )}
        {error && (
          <Card padding="xs" className="border-data-negative/40 bg-data-negative-bg text-data-negative-fg">
            {error}
          </Card>
        )}

        <Tabs
          tabs={[
            { id: 'overview', label: 'Overview' },
            { id: 'heatmap', label: 'Demand Heatmap' },
            { id: 'stockouts', label: 'Stockout Risk' },
            { id: 'queue', label: 'Production Queue' },
            { id: 'explode', label: 'BOM Explode' },
            { id: 'daily', label: 'Daily Output' },
            { id: 'about', label: 'About' },
          ] as any}
          activeTab={tab}
          onChange={(t) => setTab(t as Tab)}
        />

        {tab === 'overview' && (
          <OverviewTab
            stockouts={stockouts}
            queue={queue}
            daily={daily}
            heatmap={heatmap}
          />
        )}

        {tab === 'heatmap' && (
          <HeatmapTab heatmap={heatmap} search={search} setSearch={setSearch} />
        )}

        {tab === 'stockouts' && (
          <StockoutsTab
            data={stockouts}
            search={search}
            setSearch={setSearch}
            onSuggestPO={handleGeneratePO}
          />
        )}

        {tab === 'queue' && <QueueTab queue={queue} onAdvance={handleAdvanceOrder} />}

        {tab === 'explode' && <ExplodeTab />}

        {tab === 'daily' && <DailyTab daily={daily} />}

        {tab === 'about' && <AboutTab />}
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────────
// Tab: Overview
// ──────────────────────────────────────────────────────────────────────────
function OverviewTab({
  stockouts,
  queue,
  daily,
  heatmap,
}: {
  stockouts: StockoutsResponse | null
  queue: QueueResponse | null
  daily: DailyOutput | null
  heatmap: HeatmapResponse | null
}) {
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KPICard
          title="Critical Stockouts"
          value={stockouts ? <AnimatedNumber value={stockouts.summary.critical} /> : '—'}
          subtitle="< 7 days runway"
          accent="negative"
          badge={
            <InfoTip label="Stockout Risk">
              Critical = projected to run out within 7 days based on demand forecast + lead time.
              Generate a PO from the Stockout Risk tab.
            </InfoTip>
          }
        />
        <KPICard
          title="Est. Reorder Spend"
          value={
            stockouts
              ? <AnimatedNumber value={stockouts.summary.estimatedReorderValue} format={(v) => `$${Math.round(v / 1000)}k`} />
              : '—'
          }
          subtitle="to cover projected shortfalls"
          accent="accent"
        />
        <KPICard
          title="In Production"
          value={queue ? <AnimatedNumber value={queue.totals.IN_PRODUCTION} /> : '—'}
          subtitle={`${queue?.totals.AWAITING_MATERIAL ?? 0} awaiting material`}
          accent="brand"
        />
        <KPICard
          title="Yesterday's Output"
          value={daily ? <AnimatedNumber value={daily.yesterday.units} /> : '—'}
          delta={
            daily && daily.rolling7.avgUnitsPerDay
              ? `${
                  daily.yesterday.units >= daily.rolling7.avgUnitsPerDay ? '+' : ''
                }${Math.round(
                  ((daily.yesterday.units - daily.rolling7.avgUnitsPerDay) /
                    Math.max(daily.rolling7.avgUnitsPerDay, 1)) *
                    100
                )}% vs 7d avg`
              : undefined
          }
          accent={
            daily &&
            daily.rolling7.avgUnitsPerDay &&
            daily.yesterday.units >= daily.rolling7.avgUnitsPerDay
              ? 'positive'
              : 'negative'
          }
          sparkline={daily?.spark.map((s) => s.units)}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card padding="md">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-fg">Top stockout risks</h3>
            <a href="#" className="text-[11px] text-fg-muted hover:text-fg">
              {stockouts?.summary.total ?? 0} total
            </a>
          </div>
          <div className="space-y-1.5">
            {(stockouts?.stockouts || []).slice(0, 6).map((s) => (
              <div
                key={s.productId}
                className="flex items-center justify-between py-1.5 border-b border-border last:border-0"
              >
                <div className="min-w-0">
                  <div className="text-xs font-mono text-fg-muted">{s.sku}</div>
                  <div className="text-sm text-fg truncate">{s.name}</div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-xs text-fg-muted font-numeric">
                    {s.daysUntilStockout ?? '—'}d
                  </span>
                  <UrgencyBadge urgency={s.urgency} />
                </div>
              </div>
            ))}
            {!stockouts?.stockouts.length && (
              <div className="text-xs text-fg-subtle py-4 text-center">No stockouts projected.</div>
            )}
          </div>
        </Card>

        <Card padding="md">
          <h3 className="text-sm font-semibold text-fg mb-3">Production queue pulse</h3>
          <div className="grid grid-cols-4 gap-2">
            {(['RECEIVED', 'CONFIRMED', 'IN_PRODUCTION', 'READY_TO_SHIP'] as const).map((c) => (
              <div key={c} className="panel p-3 rounded-md">
                <div className="eyebrow">{c.replace('_', ' ')}</div>
                <div className="metric metric-md mt-1">
                  {queue?.totals[c] ?? 0}
                </div>
              </div>
            ))}
          </div>
          <div className="mt-3 text-xs text-fg-muted">
            {heatmap
              ? `Top-${heatmap.rows.length} SKUs in demand over next ${heatmap.weeks} weeks.`
              : 'Loading demand…'}
          </div>
        </Card>
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────────
// Tab: Heatmap
// ──────────────────────────────────────────────────────────────────────────
function HeatmapTab({
  heatmap,
  search,
  setSearch,
}: {
  heatmap: HeatmapResponse | null
  search: string
  setSearch: (s: string) => void
}) {
  if (!heatmap) {
    return <Card padding="lg">Loading heatmap…</Card>
  }
  const rows = heatmap.rows.filter((r) => {
    if (!search) return true
    const q = search.toLowerCase()
    return (
      r.sku.toLowerCase().includes(q) ||
      r.name.toLowerCase().includes(q) ||
      (r.category || '').toLowerCase().includes(q)
    )
  })

  // Narrow heatmap for inner closures (TS can't carry the null-check across them).
  const hm = heatmap

  function cellStyle(v: number): React.CSSProperties {
    if (v === 0) return { background: 'var(--surface)' }
    const t = Math.min(1, v / Math.max(hm.maxCellValue, 1))
    const alpha = (0.12 + t * 0.78).toFixed(2)
    return {
      background: `color-mix(in oklab, var(--accent) ${Math.round(parseFloat(alpha) * 100)}%, transparent)`,
    }
  }

  return (
    <Card padding="none" className="overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-border">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Filter SKU, product, category…"
          className="input w-64 text-sm"
        />
        <div className="text-xs text-fg-muted">
          {rows.length} of {heatmap.totalSkus} SKUs · max cell = {heatmap.maxCellValue}
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-surface-muted/50">
            <tr>
              <th className="text-left px-3 py-2 text-xs font-medium text-fg-muted sticky left-0 bg-surface-muted/80 backdrop-blur">
                SKU / Product
              </th>
              {heatmap.weekLabels.map((w, i) => (
                <th
                  key={i}
                  className="px-2 py-2 text-xs font-medium text-fg-muted text-center whitespace-nowrap"
                >
                  {w}
                </th>
              ))}
              <th className="px-3 py-2 text-xs font-medium text-fg-muted text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.productId} className="border-t border-border">
                <td className="px-3 py-1.5 sticky left-0 bg-canvas">
                  <div className="text-[11px] font-mono text-fg-muted">{r.sku}</div>
                  <div className="text-sm text-fg truncate max-w-[260px]">{r.name}</div>
                </td>
                {r.buckets.map((v, i) => (
                  <td
                    key={i}
                    className="px-1 py-1 text-center text-xs font-numeric"
                    style={cellStyle(v)}
                    title={`Week ${i + 1}: ${v} units`}
                  >
                    {v > 0 ? v : ''}
                  </td>
                ))}
                <td className="px-3 py-1.5 text-right font-numeric text-sm">{r.total}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

// ──────────────────────────────────────────────────────────────────────────
// Tab: Stockouts
// ──────────────────────────────────────────────────────────────────────────
function StockoutsTab({
  data,
  search,
  setSearch,
  onSuggestPO,
}: {
  data: StockoutsResponse | null
  search: string
  setSearch: (s: string) => void
  onSuggestPO: (productId: string, sku: string) => void
}) {
  const rows = useMemo(() => {
    if (!data?.stockouts) return []
    if (!search) return data.stockouts
    const q = search.toLowerCase()
    return data.stockouts.filter(
      (s) =>
        s.sku.toLowerCase().includes(q) ||
        s.name.toLowerCase().includes(q) ||
        (s.category || '').toLowerCase().includes(q)
    )
  }, [data, search])

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <KPICard title="Total stockouts" value={data?.summary.total ?? '—'} accent="neutral" />
        <KPICard title="Critical" value={data?.summary.critical ?? '—'} accent="negative" subtitle="< 7d" />
        <KPICard title="High" value={data?.summary.high ?? '—'} accent="accent" subtitle="< 14d" />
        <KPICard title="Normal" value={data?.summary.normal ?? '—'} accent="neutral" subtitle="< 30d" />
        <KPICard
          title="Reorder spend"
          value={
            data ? `$${Math.round(data.summary.estimatedReorderValue).toLocaleString()}` : '—'
          }
          accent="forecast"
        />
      </div>

      <div className="text-[11px] text-fg-subtle">
        Labor and service items are excluded from MRP suggestions.
      </div>

      <DataTable
        data={rows}
        rowKey={(r) => r.productId}
        toolbar={
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter SKU / product / category…"
            className="input w-64 text-sm"
          />
        }
        empty="No stockouts projected. Inventory is healthy."
        columns={[
          {
            key: 'urgency',
            header: 'Urgency',
            cell: (r) => <UrgencyBadge urgency={r.urgency} />,
            width: '96px',
          },
          { key: 'sku', header: 'SKU', cell: (r) => <span className="font-mono text-xs">{r.sku}</span> },
          {
            key: 'name',
            header: 'Product',
            cell: (r) => (
              <>
                <div className="text-sm">{r.name}</div>
                <div className="text-[11px] text-fg-subtle">{r.category}</div>
              </>
            ),
          },
          { key: 'onHand', header: 'On Hand', numeric: true, cell: (r) => r.onHand },
          {
            key: 'demand',
            header: 'Demand',
            numeric: true,
            cell: (r) => <span className="text-data-negative">−{r.totalDemand}</span>,
          },
          {
            key: 'inbound',
            header: 'Inbound',
            numeric: true,
            cell: (r) => <span className="text-data-positive">+{r.totalInbound}</span>,
          },
          {
            key: 'endingBalance',
            header: 'Ending',
            numeric: true,
            cell: (r) => (
              <span className={r.endingBalance < 0 ? 'text-data-negative font-semibold' : ''}>
                {r.endingBalance}
              </span>
            ),
          },
          {
            key: 'stocksOut',
            header: 'Stocks Out',
            cell: (r) => (
              <>
                <div className="text-xs">{r.stockoutDate}</div>
                <div className="text-[11px] text-fg-subtle">in {r.daysUntilStockout}d</div>
              </>
            ),
          },
          {
            key: 'vendor',
            header: 'Vendor',
            cell: (r) =>
              r.preferredVendor ? (
                <>
                  <div className="text-xs">{r.preferredVendor.name}</div>
                  <div className="text-[11px] text-fg-subtle">
                    {r.preferredVendor.leadTimeDays
                      ? `${r.preferredVendor.leadTimeDays}d lead`
                      : 'lead unknown'}
                  </div>
                </>
              ) : (
                <span className="text-[11px] text-accent-fg">No preferred</span>
              ),
          },
          {
            key: 'action',
            header: '',
            cell: (r) => (
              <Button
                size="sm"
                variant="outline"
                onClick={() => onSuggestPO(r.productId, r.sku)}
                disabled={!r.preferredVendor}
              >
                Draft PO
              </Button>
            ),
          },
        ]}
      />
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────────
// Tab: Production Queue
// ──────────────────────────────────────────────────────────────────────────
function QueueTab({
  queue,
  onAdvance,
}: {
  queue: QueueResponse | null
  onAdvance: (orderId: string, newStatus: string) => void
}) {
  if (!queue) return <Card padding="lg">Loading…</Card>

  const NEXT: Record<QueueItem['column'], string | null> = {
    RECEIVED: 'CONFIRMED',
    CONFIRMED: 'IN_PRODUCTION',
    IN_PRODUCTION: 'READY_TO_SHIP',
    READY_TO_SHIP: 'SHIPPED',
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
      {queue.columns.map((col) => (
        <Card key={col} padding="none" className="flex flex-col overflow-hidden">
          <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-surface-muted/40">
            <div className="text-xs font-semibold text-fg uppercase tracking-wider">
              {col.replace('_', ' ')}
            </div>
            <Badge variant="neutral" size="sm">
              {queue.buckets[col].length}
            </Badge>
          </div>
          <div className="p-2 space-y-2 min-h-[300px] max-h-[70vh] overflow-y-auto">
            {queue.buckets[col].map((o) => (
              <QueueCard key={o.id} order={o} nextStatus={NEXT[col]} onAdvance={onAdvance} />
            ))}
            {!queue.buckets[col].length && (
              <div className="text-xs text-fg-subtle text-center py-6">Empty</div>
            )}
          </div>
        </Card>
      ))}
    </div>
  )
}

function QueueCard({
  order,
  nextStatus,
  onAdvance,
}: {
  order: QueueItem
  nextStatus: string | null
  onAdvance: (id: string, s: string) => void
}) {
  const urgencyColor: Record<QueueItem['urgency'], string> = {
    RED: 'border-l-data-negative',
    AMBER: 'border-l-data-warning',
    GREEN: 'border-l-data-positive',
    NONE: 'border-l-border',
  }
  return (
    <div className={`panel panel-interactive border-l-2 ${urgencyColor[order.urgency]} p-2.5`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[11px] font-mono text-fg-muted">{order.orderNumber}</div>
          <div className="text-sm font-medium text-fg truncate">{order.builderName}</div>
        </div>
        {order.flagged && (
          <Badge variant="warning" size="xs">
            MATL
          </Badge>
        )}
      </div>
      <div className="mt-1.5 flex items-center justify-between text-[11px] text-fg-muted">
        <span>
          {order.lineCount} lines · {order.unitCount} units
        </span>
        {order.daysToDelivery != null && (
          <span
            className={
              order.daysToDelivery < 0
                ? 'text-data-negative'
                : order.daysToDelivery <= 3
                  ? 'text-data-warning'
                  : ''
            }
          >
            {order.daysToDelivery < 0
              ? `${Math.abs(order.daysToDelivery)}d late`
              : `${order.daysToDelivery}d out`}
          </span>
        )}
      </div>
      <div className="mt-1 font-numeric text-sm text-fg">${order.total.toLocaleString()}</div>
      {nextStatus && (
        <button
          onClick={() => onAdvance(order.id, nextStatus)}
          className="mt-2 w-full text-[11px] px-2 py-1 rounded-sm border border-border hover:border-border-strong hover:bg-surface-muted transition-colors"
        >
          Advance → {nextStatus.replace('_', ' ')}
        </button>
      )}
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────────
// Tab: BOM Explode
// ──────────────────────────────────────────────────────────────────────────
function ExplodeTab() {
  const [orderSearch, setOrderSearch] = useState('')
  const [orderOptions, setOrderOptions] = useState<
    Array<{ id: string; orderNumber: string; builderName: string }>
  >([])
  const [explode, setExplode] = useState<ExplodeResponse | null>(null)
  const [busy, setBusy] = useState(false)

  async function searchOrders(q: string) {
    if (q.length < 2) {
      setOrderOptions([])
      return
    }
    try {
      const res = await fetch(`/api/orders?search=${encodeURIComponent(q)}&limit=10`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json()
      const rows = (json.orders || json.data || []).map((o: any) => ({
        id: o.id,
        orderNumber: o.orderNumber,
        builderName: o.builder?.companyName || o.builderName || '—',
      }))
      setOrderOptions(rows)
    } catch {
      setOrderOptions([])
    }
  }

  async function explodeOrder(orderId: string) {
    setBusy(true)
    try {
      const res = await fetch(`/api/ops/mrp/bom-explode/${orderId}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setExplode(await res.json())
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <Card padding="md">
        <div className="flex items-start gap-3">
          <div className="flex-1">
            <label className="eyebrow">Pick an order</label>
            <input
              className="input w-full text-sm mt-1"
              value={orderSearch}
              onChange={(e) => {
                setOrderSearch(e.target.value)
                searchOrders(e.target.value)
              }}
              placeholder="Order #, PO #, builder..."
            />
            {orderOptions.length > 0 && (
              <div className="panel mt-1 max-h-56 overflow-y-auto">
                {orderOptions.map((o) => (
                  <button
                    key={o.id}
                    className="w-full text-left px-3 py-2 hover:bg-surface-muted text-sm border-b border-border last:border-0"
                    onClick={() => {
                      setOrderSearch(o.orderNumber)
                      setOrderOptions([])
                      explodeOrder(o.id)
                    }}
                  >
                    <span className="font-mono">{o.orderNumber}</span>
                    <span className="text-fg-muted ml-2">{o.builderName}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </Card>

      {busy && <Card padding="lg">Exploding BOM…</Card>}
      {!busy && explode && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <KPICard title="Lines" value={explode.summary.lineCount} accent="neutral" />
            <KPICard
              title="Terminal Components"
              value={explode.summary.terminalCount}
              accent="brand"
            />
            <KPICard
              title="Extended Cost"
              value={`$${Math.round(explode.summary.totalExtendedCost).toLocaleString()}`}
              accent="accent"
            />
            <KPICard
              title="Shortfalls"
              value={explode.summary.shortfallCount}
              accent={explode.summary.shortfallCount > 0 ? 'negative' : 'positive'}
            />
          </div>
          <DataTable
            data={explode.components}
            rowKey={(r) => r.productId}
            empty="No components."
            columns={[
              { key: 'sku', header: 'SKU', cell: (r) => <span className="font-mono text-xs">{r.sku}</span> },
              { key: 'name', header: 'Component', cell: (r) => r.name },
              { key: 'qty', header: 'Qty Needed', numeric: true, cell: (r) => r.quantity },
              { key: 'onHand', header: 'On Hand', numeric: true, cell: (r) => r.onHand },
              {
                key: 'short',
                header: 'Shortfall',
                numeric: true,
                cell: (r) =>
                  r.shortfall > 0 ? (
                    <span className="text-data-negative font-semibold">{r.shortfall}</span>
                  ) : (
                    <span className="text-data-positive">0</span>
                  ),
              },
              {
                key: 'extCost',
                header: 'Ext. Cost',
                numeric: true,
                cell: (r) => `$${r.extendedCost.toLocaleString()}`,
              },
            ]}
          />
        </>
      )}
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────────
// Tab: Daily Output
// ──────────────────────────────────────────────────────────────────────────
function DailyTab({ daily }: { daily: DailyOutput | null }) {
  if (!daily) return <Card padding="lg">Loading…</Card>
  const onTimePct = daily.rolling7.onTimeRate != null ? Math.round(daily.rolling7.onTimeRate * 100) : null

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KPICard
          title="Yesterday — Units"
          value={daily.yesterday.units}
          subtitle={`${daily.yesterday.orders} orders`}
          accent="brand"
          sparkline={daily.spark.map((s) => s.units)}
        />
        <KPICard
          title="7-day Avg Units/Day"
          value={daily.rolling7.avgUnitsPerDay}
          subtitle={`${daily.rolling7.avgOrdersPerDay} orders/day`}
          accent="accent"
        />
        <KPICard
          title="On-Time %"
          value={onTimePct != null ? `${onTimePct}%` : '—'}
          accent={onTimePct == null ? 'neutral' : onTimePct >= 90 ? 'positive' : onTimePct >= 75 ? 'accent' : 'negative'}
        />
        <KPICard
          title="Late Yesterday"
          value={daily.yesterday.late}
          subtitle={`${daily.yesterday.onTime} on time`}
          accent={daily.yesterday.late === 0 ? 'positive' : 'negative'}
        />
      </div>

      <Card padding="md">
        <h3 className="text-sm font-semibold text-fg mb-3">PM productivity — last 7 days</h3>
        {daily.pmProductivity.length === 0 ? (
          <EmptyState title="No completed jobs" description="No jobs hit COMPLETE/CLOSED in the last 7 days." />
        ) : (
          <div className="space-y-2">
            {daily.pmProductivity.map((p) => {
              const max = Math.max(...daily.pmProductivity.map((x) => x.completed), 1)
              return (
                <div key={p.pmId}>
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className="text-fg">{p.pmName}</span>
                    <span className="text-fg-muted font-numeric">{p.completed}</span>
                  </div>
                  <div className="h-2 bg-surface-muted rounded-full overflow-hidden">
                    <div
                      className="h-full bg-brand"
                      style={{ width: `${(p.completed / max) * 100}%` }}
                    />
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </Card>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────────
// Tab: About
// ──────────────────────────────────────────────────────────────────────────
function AboutTab() {
  return (
    <Card padding="lg">
      <div className="prose prose-invert max-w-none text-sm">
        <h2 className="text-fg">How MRP works</h2>
        <p className="text-fg-muted">
          For each active job with a scheduled date, the engine walks
          <code className="mx-1 text-accent-fg">Job → Order → OrderItem</code>
          and recursively expands each line through matching{' '}
          <code className="mx-1 text-accent-fg">BomEntry</code> relationships (up to 4
          levels). Components with no further BOM children are terminal — they consume
          themselves.
        </p>
        <p className="text-fg-muted">
          Demand is bucketed on <code>scheduledDate − leadBufferDays</code> so material
          is on hand before install. Inbound supply comes from open Purchase Orders
          (APPROVED / SENT / PARTIALLY_RECEIVED).
        </p>
        <p className="text-fg-muted">
          The Demand Heatmap rolls OrderItem quantities into ISO weeks based on
          <code className="mx-1">Order.deliveryDate</code>. Cell intensity scales with
          max-cell across the visible grid.
        </p>
        <p className="text-fg-subtle text-xs">
          See <code>docs/MRP_SPEC.md</code> for the full spec.
        </p>
        {/* TODO: replace with AI insight once NUC brain is wired */}
      </div>
    </Card>
  )
}

// ──────────────────────────────────────────────────────────────────────────
// Shared
// ──────────────────────────────────────────────────────────────────────────
function UrgencyBadge({ urgency }: { urgency: 'CRITICAL' | 'HIGH' | 'NORMAL' | 'LOW' }) {
  const variantMap = {
    CRITICAL: 'danger',
    HIGH: 'warning',
    NORMAL: 'info',
    LOW: 'neutral',
  } as const
  return (
    <Badge variant={variantMap[urgency]} size="sm">
      {urgency}
    </Badge>
  )
}
