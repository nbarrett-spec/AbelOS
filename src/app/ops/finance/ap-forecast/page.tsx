'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  RefreshCw, TrendingDown, Calendar, AlertTriangle, DollarSign,
} from 'lucide-react'
import {
  PageHeader, KPICard, Badge, DataTable, EmptyState,
  Card, CardHeader, CardTitle, CardDescription, CardBody,
  LiveDataIndicator, Sparkline,
} from '@/components/ui'
import { cn } from '@/lib/utils'

// ──────────────────────────────────────────────────────────────────────────
// 90-Day AP Forecast
// ──────────────────────────────────────────────────────────────────────────
// Forward cash-out projection based on PO expected dates. Line chart
// cumulative + weekly bars. Vendor breakdown.
// ──────────────────────────────────────────────────────────────────────────

interface Forecast {
  asOf: string
  horizonDate: string
  overdue: { amount: number; count: number }
  pastWindow: number
  grandTotal: number
  daily: Array<{ date: string; amount: number; count: number }>
  weekly: Array<{ weekStart: string; amount: number; count: number }>
  cumulative: Array<{ date: string; cumAmount: number; daily: number }>
  vendors: Array<{ vendorId: string; vendorName: string; amount: number; count: number }>
}

const fmtMoney = (n: number) =>
  n >= 10000 ? `$${Math.round(n / 1000)}K` : `$${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}`

const fmtDate = (s: string) => new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

export default function APForecastPage() {
  const router = useRouter()
  const [data, setData] = useState<Forecast | null>(null)
  const [loading, setLoading] = useState(true)
  const [tick, setTick] = useState<number | null>(null)

  async function fetchData() {
    try {
      const res = await fetch('/api/ops/finance/ap-forecast')
      if (!res.ok) throw new Error('Failed')
      setData(await res.json())
      setTick(Date.now())
    } catch (err) { console.error(err) }
    finally { setLoading(false) }
  }

  useEffect(() => { fetchData() }, [])

  const maxWeekly = useMemo(() => {
    if (!data) return 1
    return Math.max(1, ...data.weekly.map(w => w.amount))
  }, [data])

  if (loading || !data) {
    return (
      <div className="space-y-5">
        <PageHeader eyebrow="Finance" title="90-Day AP Forecast" description="Forward cash-out projection based on PO expected dates." />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[0,1,2,3].map(i => <KPICard key={i} title="" value="" loading />)}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-5 animate-enter">
      <LiveDataIndicator trigger={tick} />

      <PageHeader
        eyebrow="Finance"
        title="90-Day AP Forecast"
        description="Forward cash-out based on PO expected dates. Plan cash with vendor detail below."
        actions={
          <button onClick={fetchData} className="btn btn-secondary btn-sm">
            <RefreshCw className="w-3.5 h-3.5" /> Refresh
          </button>
        }
      />

      {/* Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KPICard
          title="90-day total"
          value={fmtMoney(data.grandTotal)}
          subtitle={`${data.daily.reduce((s, d) => s + d.count, 0)} POs in window`}
          icon={<DollarSign className="w-3.5 h-3.5" />}
          accent="brand"
        />
        <KPICard
          title="Overdue now"
          value={fmtMoney(data.overdue.amount)}
          subtitle={`${data.overdue.count} POs`}
          icon={<AlertTriangle className="w-3.5 h-3.5" />}
          accent={data.overdue.amount > 0 ? 'negative' : 'positive'}
        />
        <KPICard
          title="Beyond 90 days"
          value={fmtMoney(data.pastWindow)}
          subtitle="Future POs"
          icon={<Calendar className="w-3.5 h-3.5" />}
          accent="neutral"
        />
        <KPICard
          title="Peak week"
          value={fmtMoney(Math.max(0, ...data.weekly.map(w => w.amount)))}
          subtitle={`Week of ${fmtDate(data.weekly.reduce((peak, w) => w.amount > peak.amount ? w : peak, data.weekly[0] ?? { weekStart: data.asOf, amount: 0, count: 0 }).weekStart)}`}
          icon={<TrendingDown className="w-3.5 h-3.5" />}
          accent="accent"
        />
      </div>

      {/* Cumulative line chart */}
      <Card variant="default" padding="none">
        <CardHeader>
          <div>
            <CardTitle>Cumulative Cash-out (90 days)</CardTitle>
            <CardDescription>Running total of cash that needs to clear.</CardDescription>
          </div>
        </CardHeader>
        <CardBody>
          {data.cumulative.length === 0 ? (
            <EmptyState icon="chart" size="compact" title="Nothing in window" description="No open POs expected in the next 90 days." />
          ) : (
            <Sparkline
              data={data.cumulative.map(c => c.cumAmount)}
              height={120}
              width={900}
              showArea
              showDot
            />
          )}
        </CardBody>
      </Card>

      {/* Weekly bars */}
      <Card variant="default" padding="none">
        <CardHeader>
          <div>
            <CardTitle>Weekly Cash-out</CardTitle>
            <CardDescription>Next 13 weeks — rough bill pay plan.</CardDescription>
          </div>
        </CardHeader>
        <CardBody>
          <div className="grid grid-cols-13 gap-2" style={{ gridTemplateColumns: 'repeat(13, 1fr)', height: 180 }}>
            {data.weekly.map((w, i) => {
              const h = (w.amount / maxWeekly) * 100
              return (
                <div key={i} className="flex flex-col items-center justify-end gap-1 group">
                  <span className="text-[10px] tabular-nums text-fg-muted">{fmtMoney(w.amount)}</span>
                  <div
                    className={cn(
                      'w-full rounded-t-sm transition-all',
                      w.amount > 0 ? 'bg-brand/80 group-hover:bg-brand' : 'bg-surface-muted',
                    )}
                    style={{ height: `${Math.max(h, 2)}%`, minHeight: 4 }}
                    title={`Week of ${fmtDate(w.weekStart)}: ${fmtMoney(w.amount)} · ${w.count} POs`}
                  />
                  <span className="text-[9px] text-fg-subtle">{fmtDate(w.weekStart).slice(0, 6)}</span>
                </div>
              )
            })}
          </div>
        </CardBody>
      </Card>

      {/* Vendor breakdown */}
      <DataTable
        density="compact"
        data={data.vendors}
        rowKey={r => r.vendorId}
        onRowClick={r => router.push(`/ops/vendors/${r.vendorId}`)}
        toolbar={<span className="text-[11px] text-fg-muted">Top vendors in forecast — {data.vendors.length} total</span>}
        columns={[
          { key: 'vendorName', header: 'Vendor', sortable: true,
            cell: r => <span className="font-semibold text-fg text-[13px]">{r.vendorName}</span> },
          { key: 'amount', header: '90-day exposure', numeric: true, sortable: true, heatmap: true, heatmapValue: r => r.amount,
            cell: r => <span className="font-semibold tabular-nums">{fmtMoney(r.amount)}</span> },
          { key: 'count', header: 'POs', numeric: true, sortable: true, width: '80px',
            cell: r => <span className="tabular-nums">{r.count}</span> },
        ]}
        empty={<EmptyState icon="users" size="compact" title="No vendors in window" description="No open POs expected in next 90 days." />}
      />
    </div>
  )
}
