'use client'

// ──────────────────────────────────────────────────────────────────────────
// AR Aging Dashboard — /ops/finance/ar
//
// For Dawn: Total AR, Overdue, Expected This Week, DSO at the top; six-bucket
// aging (Current / 1-15 / 16-30 / 31-45 / 46-60 / 60+); per-builder breakdown
// with click-through drill-down to that builder's open invoices.
// ──────────────────────────────────────────────────────────────────────────

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Wallet, AlertTriangle, RefreshCw, CalendarDays, TrendingDown,
  Filter, ArrowLeft, ExternalLink, Send,
} from 'lucide-react'
import {
  PageHeader, KPICard, Badge, StatusBadge, DataTable, EmptyState,
  Card, CardHeader, CardTitle, CardDescription, CardBody,
  LiveDataIndicator,
} from '@/components/ui'
import { cn } from '@/lib/utils'

// ── Types ────────────────────────────────────────────────────────────────

type BucketKey = 'current' | 'd1_15' | 'd16_30' | 'd31_45' | 'd46_60' | 'd60_plus'

interface ArData {
  asOf: string
  kpi: {
    totalAR: number
    overdueTotal: number
    expectedThisWeek: number
    dso: number
  }
  buckets: Record<BucketKey, { count: number; amount: number }>
  bucketOrder: BucketKey[]
  byBuilder: Array<{
    builderId: string
    builderName: string
    current: number
    d1_30: number
    d31_60: number
    d60_plus: number
    total: number
    invoiceCount: number
  }>
  invoices: Array<{
    id: string
    invoiceNumber: string
    builderId: string
    builderName: string
    balanceDue: number
    total: number
    amountPaid: number
    status: string
    paymentTerm: string | null
    dueDate: string | null
    issuedAt: string | null
    daysPastDue: number
    bucket: BucketKey
  }>
}

// ── Formatters ───────────────────────────────────────────────────────────

const fmtMoney = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n)

const fmtMoneyExact = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)

const fmtMoneyCompact = (n: number) => {
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`
  if (Math.abs(n) >= 10_000) return `$${Math.round(n / 1000)}K`
  if (Math.abs(n) >= 1_000) return `$${(n / 1000).toFixed(1)}K`
  return fmtMoney(n)
}

const fmtShortDate = (s: string | null) => {
  if (!s) return '—'
  return new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

// JetBrains Mono for money. Tailwind ships `font-mono` which we alias at the
// app level; inline fallback keeps it honest if tokens aren't loaded.
const MONO_STYLE = { fontFamily: '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace' } as const

const BUCKET_META: Record<BucketKey, { label: string; tone: 'positive' | 'accent' | 'negative'; short: string }> = {
  current:  { label: 'Current',     tone: 'positive', short: 'Current' },
  d1_15:    { label: '1–15 days',   tone: 'accent',   short: '1–15' },
  d16_30:   { label: '16–30 days',  tone: 'accent',   short: '16–30' },
  d31_45:   { label: '31–45 days',  tone: 'negative', short: '31–45' },
  d46_60:   { label: '46–60 days',  tone: 'negative', short: '46–60' },
  d60_plus: { label: '60+ days',    tone: 'negative', short: '60+' },
}

// ── Page ─────────────────────────────────────────────────────────────────

export default function ARAgingDashboardPage() {
  const router = useRouter()
  const [data, setData] = useState<ArData | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [bucketFilter, setBucketFilter] = useState<BucketKey | 'all'>('all')
  const [builderDrill, setBuilderDrill] = useState<string | null>(null)
  const [refreshTick, setRefreshTick] = useState<number | null>(null)

  useEffect(() => { fetchData() }, [])

  async function fetchData() {
    setRefreshing(true)
    try {
      const res = await fetch('/api/ops/finance/ar')
      if (!res.ok) throw new Error('Failed to fetch AR data')
      setData(await res.json())
      setRefreshTick(Date.now())
    } catch (err) {
      console.error('AR fetch error:', err)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  const filteredInvoices = useMemo(() => {
    if (!data) return []
    return data.invoices.filter((i) => {
      if (bucketFilter !== 'all' && i.bucket !== bucketFilter) return false
      if (builderDrill && i.builderId !== builderDrill) return false
      return true
    })
  }, [data, bucketFilter, builderDrill])

  if (loading || !data) {
    return (
      <div className="space-y-5">
        <PageHeader eyebrow="Finance" title="Accounts Receivable" description="Aging buckets · collections queue · DSO trend." />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[0, 1, 2, 3].map((i) => <KPICard key={i} title="" value="" loading />)}
        </div>
        <div className="h-48 skeleton rounded-lg" />
      </div>
    )
  }

  const buckets = data.bucketOrder.map((k) => ({
    key: k,
    ...BUCKET_META[k],
    amount: data.buckets[k].amount,
    count: data.buckets[k].count,
  }))
  const maxBucketAmount = Math.max(...buckets.map((b) => b.amount), 1)
  const overduePct = data.kpi.totalAR > 0 ? (data.kpi.overdueTotal / data.kpi.totalAR) * 100 : 0
  const drillBuilder = builderDrill
    ? data.byBuilder.find((b) => b.builderId === builderDrill)
    : null

  return (
    <div className="space-y-5 animate-enter">
      <LiveDataIndicator trigger={refreshTick} />

      <PageHeader
        eyebrow="Finance"
        title="Accounts Receivable"
        description="Aging buckets · collections queue · expected cash · DSO."
        actions={
          <button onClick={fetchData} className="btn btn-secondary btn-sm" disabled={refreshing}>
            <RefreshCw className={cn('w-3.5 h-3.5', refreshing && 'animate-spin')} />
            Refresh
          </button>
        }
      />

      {/* KPI strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KPICard
          title="Total AR"
          value={<span style={MONO_STYLE}>{fmtMoneyCompact(data.kpi.totalAR)}</span>}
          subtitle={`${data.invoices.length} open invoices`}
          icon={<Wallet className="w-3.5 h-3.5" />}
          accent="brand"
        />
        <KPICard
          title="Overdue Total"
          value={<span style={MONO_STYLE}>{fmtMoneyCompact(data.kpi.overdueTotal)}</span>}
          delta={`${overduePct.toFixed(1)}%`}
          deltaDirection={overduePct > 20 ? 'up' : 'flat'}
          subtitle="of total AR"
          icon={<AlertTriangle className="w-3.5 h-3.5" />}
          accent={overduePct > 20 ? 'negative' : overduePct > 10 ? 'accent' : 'positive'}
        />
        <KPICard
          title="Expected This Week"
          value={<span style={MONO_STYLE}>{fmtMoneyCompact(data.kpi.expectedThisWeek)}</span>}
          subtitle="invoices due Mon–Sun"
          icon={<CalendarDays className="w-3.5 h-3.5" />}
          accent="neutral"
        />
        <KPICard
          title="DSO"
          value={<span style={MONO_STYLE}>{data.kpi.dso} days</span>}
          subtitle="30-day trailing"
          icon={<TrendingDown className="w-3.5 h-3.5" />}
          accent={data.kpi.dso > 45 ? 'negative' : data.kpi.dso > 30 ? 'accent' : 'positive'}
        />
      </div>

      {/* Aging buckets */}
      <Card variant="default" padding="none">
        <CardHeader>
          <div>
            <CardTitle>Aging Buckets</CardTitle>
            <CardDescription>Click a bucket to filter the invoice list below.</CardDescription>
          </div>
          {bucketFilter !== 'all' && (
            <button onClick={() => setBucketFilter('all')} className="btn btn-ghost btn-xs">
              Clear filter
            </button>
          )}
        </CardHeader>
        <CardBody>
          <div className="grid grid-cols-3 md:grid-cols-6 gap-3" style={{ minHeight: 180 }}>
            {buckets.map((b) => {
              const heightPct = (b.amount / maxBucketAmount) * 100
              const selected = bucketFilter === b.key
              return (
                <button
                  key={b.key}
                  onClick={() => setBucketFilter((prev) => (prev === b.key ? 'all' : b.key))}
                  className={cn(
                    'relative flex flex-col items-center justify-end rounded-md transition-all',
                    'border-2 hover:border-brand/60 min-h-[160px] p-3',
                    selected ? 'border-brand' : 'border-transparent',
                    'bg-surface-muted/30 group',
                  )}
                >
                  <div className="absolute top-2 left-2 right-2 flex flex-col items-start">
                    <span className="text-[10px] eyebrow text-fg-muted">{b.label}</span>
                    <span
                      className={cn(
                        'text-[13px] font-bold tabular-nums',
                        b.tone === 'positive' && 'text-data-positive',
                        b.tone === 'accent' && 'text-accent',
                        b.tone === 'negative' && 'text-data-negative',
                      )}
                      style={MONO_STYLE}
                    >
                      {fmtMoneyCompact(b.amount)}
                    </span>
                    <span className="text-[10px] text-fg-subtle">{b.count} inv</span>
                  </div>
                  <div
                    className={cn(
                      'w-[70%] rounded-t-md transition-all duration-300',
                      b.tone === 'positive' && 'bg-data-positive/70 group-hover:bg-data-positive',
                      b.tone === 'accent' && 'bg-accent/70 group-hover:bg-accent',
                      b.tone === 'negative' && 'bg-data-negative/70 group-hover:bg-data-negative',
                    )}
                    style={{ height: `${Math.max(heightPct, 4)}%` }}
                  />
                </button>
              )
            })}
          </div>
        </CardBody>
      </Card>

      {/* Per-builder breakdown */}
      <Card variant="default" padding="none">
        <CardHeader>
          <div>
            <CardTitle>Per-Builder Breakdown</CardTitle>
            <CardDescription>
              {drillBuilder
                ? `Viewing ${drillBuilder.builderName} — ${drillBuilder.invoiceCount} open invoice${drillBuilder.invoiceCount === 1 ? '' : 's'}`
                : 'Click a builder to drill into their open invoices.'}
            </CardDescription>
          </div>
          {builderDrill && (
            <button onClick={() => setBuilderDrill(null)} className="btn btn-ghost btn-xs">
              <ArrowLeft className="w-3.5 h-3.5" />
              All builders
            </button>
          )}
        </CardHeader>
        <CardBody>
          {data.byBuilder.length === 0 ? (
            <EmptyState icon="users" size="compact" title="No open AR" description="Every builder is paid up." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="text-left text-fg-muted eyebrow text-[10px]">
                    <th className="px-3 py-2 font-medium">Builder</th>
                    <th className="px-3 py-2 font-medium text-right">Current</th>
                    <th className="px-3 py-2 font-medium text-right">1–30</th>
                    <th className="px-3 py-2 font-medium text-right">31–60</th>
                    <th className="px-3 py-2 font-medium text-right">60+</th>
                    <th className="px-3 py-2 font-medium text-right">Total</th>
                    <th className="px-3 py-2 font-medium text-right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {data.byBuilder.map((b) => {
                    const selected = builderDrill === b.builderId
                    const overdue = b.d1_30 + b.d31_60 + b.d60_plus
                    return (
                      <tr
                        key={b.builderId}
                        onClick={() => setBuilderDrill(selected ? null : b.builderId)}
                        className={cn(
                          'border-t border-border-subtle hover:bg-surface-muted/40 cursor-pointer transition-colors',
                          selected && 'bg-brand/5',
                        )}
                      >
                        <td className="px-3 py-2 font-medium text-fg">
                          <div className="flex items-center gap-2">
                            <span>{b.builderName}</span>
                            <span className="text-fg-subtle text-[10px]">({b.invoiceCount})</span>
                          </div>
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums" style={MONO_STYLE}>
                          {b.current > 0 ? fmtMoney(b.current) : <span className="text-fg-subtle">—</span>}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-accent" style={MONO_STYLE}>
                          {b.d1_30 > 0 ? fmtMoney(b.d1_30) : <span className="text-fg-subtle">—</span>}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-data-negative" style={MONO_STYLE}>
                          {b.d31_60 > 0 ? fmtMoney(b.d31_60) : <span className="text-fg-subtle">—</span>}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-data-negative" style={MONO_STYLE}>
                          {b.d60_plus > 0 ? fmtMoney(b.d60_plus) : <span className="text-fg-subtle">—</span>}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums font-semibold" style={MONO_STYLE}>
                          {fmtMoney(b.total)}
                        </td>
                        <td className="px-3 py-2 text-right">
                          {overdue > 0 ? (
                            <button
                              onClick={(e) => { e.stopPropagation(); router.push(`/ops/collections?builder=${b.builderId}`) }}
                              className="inline-flex items-center gap-1 text-[11px] text-brand hover:underline"
                            >
                              <Send className="w-3 h-3" />
                              Collect
                            </button>
                          ) : (
                            <span className="text-fg-subtle text-[11px]">Current</span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>

      {/* Invoice-level drilldown */}
      <DataTable
        density="compact"
        data={filteredInvoices}
        rowKey={(r) => r.id}
        onRowClick={(r) => router.push(`/ops/invoices/${r.id}`)}
        keyboardNav
        hint
        toolbar={
          <div className="flex items-center gap-3 w-full flex-wrap">
            <div className="flex items-center gap-2">
              <Filter className="w-3.5 h-3.5 text-fg-muted" />
              <span className="text-[11px] font-medium text-fg-muted">Filter</span>
            </div>
            <select
              value={bucketFilter}
              onChange={(e) => setBucketFilter(e.target.value as BucketKey | 'all')}
              className="input h-7 w-40 text-[12px]"
            >
              <option value="all">All buckets</option>
              {data.bucketOrder.map((k) => (
                <option key={k} value={k}>{BUCKET_META[k].label}</option>
              ))}
            </select>
            {builderDrill && drillBuilder && (
              <Badge variant="neutral" size="xs">
                {drillBuilder.builderName}
              </Badge>
            )}
            <div className="ml-auto text-[11px] text-fg-subtle">
              {filteredInvoices.length} of {data.invoices.length} invoices
            </div>
          </div>
        }
        columns={[
          {
            key: 'invoiceNumber', header: 'Invoice', width: '110px', sortable: true,
            cell: (r) => <span className="font-medium text-fg font-mono text-[12px]" style={MONO_STYLE}>{r.invoiceNumber}</span>,
          },
          {
            key: 'builderName', header: 'Builder', sortable: true,
            cell: (r) => <span className="truncate max-w-[200px] block">{r.builderName}</span>,
          },
          {
            key: 'balanceDue', header: 'Balance', numeric: true, sortable: true, heatmap: true,
            heatmapValue: (r) => r.balanceDue,
            cell: (r) => <span className="font-semibold tabular-nums" style={MONO_STYLE}>{fmtMoneyExact(r.balanceDue)}</span>,
          },
          {
            key: 'dueDate', header: 'Due', numeric: true, sortable: true, width: '90px',
            cell: (r) => <span className="text-fg-muted text-[12px]">{fmtShortDate(r.dueDate)}</span>,
          },
          {
            key: 'daysPastDue', header: 'Past due', numeric: true, sortable: true, width: '90px',
            cell: (r) => (
              <span
                className={cn(
                  'tabular-nums text-[12px] font-medium',
                  r.daysPastDue > 60 && 'text-data-negative',
                  r.daysPastDue > 30 && r.daysPastDue <= 60 && 'text-accent',
                  r.daysPastDue <= 30 && r.daysPastDue > 0 && 'text-fg',
                  r.daysPastDue <= 0 && 'text-fg-subtle',
                )}
                style={MONO_STYLE}
              >
                {r.daysPastDue > 0 ? `+${r.daysPastDue}d` : 'current'}
              </span>
            ),
          },
          {
            key: 'bucket', header: 'Bucket', width: '110px',
            cell: (r) => <Badge variant="neutral" size="xs">{BUCKET_META[r.bucket].short}</Badge>,
          },
          {
            key: 'status', header: 'Status', width: '110px',
            cell: (r) => <StatusBadge status={r.status} size="sm" />,
          },
        ]}
        rowActions={[
          {
            id: 'view',
            icon: <ExternalLink className="w-3.5 h-3.5" />,
            label: 'View detail',
            shortcut: '↵',
            onClick: (r) => router.push(`/ops/invoices/${r.id}`),
          },
          {
            id: 'collect',
            icon: <Send className="w-3.5 h-3.5" />,
            label: 'Open in collections',
            shortcut: 'M',
            onClick: (r) => router.push(`/ops/collections?invoice=${r.id}`),
            show: (r) => r.daysPastDue > 0,
          },
        ]}
        empty={
          <EmptyState
            icon="document"
            size="compact"
            title={bucketFilter !== 'all' || builderDrill ? 'No invoices match' : 'No open invoices'}
            description={bucketFilter !== 'all' ? `Nothing in the ${BUCKET_META[bucketFilter as BucketKey]?.label} bucket.` : 'Everyone is paid up.'}
            secondaryAction={bucketFilter !== 'all' || builderDrill ? { label: 'Clear filters', onClick: () => { setBucketFilter('all'); setBuilderDrill(null) } } : undefined}
          />
        }
      />
    </div>
  )
}
