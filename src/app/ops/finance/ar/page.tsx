'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Wallet, AlertTriangle, RefreshCw, Mail, Eye, Phone, DollarSign,
  Building2, Clock, Filter, TrendingDown, Calendar, Send,
} from 'lucide-react'
import {
  PageHeader, KPICard, Badge, StatusBadge, DataTable, EmptyState,
  Card, CardHeader, CardTitle, CardDescription, CardBody,
  NumberFlow, AnimatedNumber, LiveDataIndicator, InfoTip, Sparkline,
} from '@/components/ui'
import { cn } from '@/lib/utils'

// ── Types ────────────────────────────────────────────────────────────────

interface PredictInvoice {
  id: string
  invoiceNumber: string
  builderId: string
  builderName: string
  paymentTerm: string | null
  balanceDue: number
  total: number
  amountPaid: number
  status: string
  issuedAt: string
  dueDate: string | null
  daysOutstanding: number
  daysPastDue: number
  predictedPaymentDate: string | null
  builderAvgLag: number
  bucket: 'current' | 'd1_30' | 'd31_60' | 'd61_90' | 'd90_plus'
}

interface PredictData {
  asOf: string
  waterfall: {
    current:  { count: number; amount: number }
    d1_30:    { count: number; amount: number }
    d31_60:   { count: number; amount: number }
    d61_90:   { count: number; amount: number }
    d90_plus: { count: number; amount: number }
  }
  invoices: PredictInvoice[]
  reminderHistory: Record<string, number>
  dsoTrend: Array<{ date: string; dso: number }>
  builderPatterns: Array<{
    builderId: string
    builderName: string
    avgDaysLate: number
    sampleSize: number
  }>
  globalAvgLag: number
}

// ── Formatters ───────────────────────────────────────────────────────────

const fmtMoney = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n)

const fmtMoneyCompact = (n: number) => {
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`
  if (Math.abs(n) >= 10_000)    return `$${Math.round(n / 1000)}K`
  if (Math.abs(n) >= 1_000)     return `$${(n / 1000).toFixed(1)}K`
  return fmtMoney(n)
}

const fmtDate = (s: string | null) => s ? new Date(s).toLocaleDateString('en-US') : '—'

const fmtShortDate = (s: string | null) => {
  if (!s) return '—'
  const d = new Date(s)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

const BUCKET_LABELS: Record<PredictInvoice['bucket'], string> = {
  current:  'Current',
  d1_30:    '1–30 days',
  d31_60:   '31–60 days',
  d61_90:   '61–90 days',
  d90_plus: '90+ days',
}

// ── Page ─────────────────────────────────────────────────────────────────

export default function AccountsReceivablePage() {
  const router = useRouter()
  const [data, setData] = useState<PredictData | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [bucketFilter, setBucketFilter] = useState<string>('all')
  const [refreshTick, setRefreshTick] = useState<number | null>(null)
  const [reminderSent, setReminderSent] = useState<Record<string, boolean>>({})

  useEffect(() => { fetchData() }, [])

  async function fetchData() {
    setRefreshing(true)
    try {
      const res = await fetch('/api/ops/finance/ar-predict')
      if (!res.ok) throw new Error('Failed to fetch AR predict data')
      const result = await res.json()
      setData(result)
      setRefreshTick(Date.now())
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  const totalOutstanding = useMemo(() => {
    if (!data) return 0
    const w = data.waterfall
    return w.current.amount + w.d1_30.amount + w.d31_60.amount + w.d61_90.amount + w.d90_plus.amount
  }, [data])

  const filteredInvoices = useMemo(() => {
    if (!data) return []
    return data.invoices.filter(i => {
      if (bucketFilter !== 'all' && i.bucket !== bucketFilter) return false
      if (statusFilter !== 'all' && i.status.toLowerCase() !== statusFilter.toLowerCase()) return false
      return true
    })
  }, [data, statusFilter, bucketFilter])

  const builderSummary = useMemo(() => {
    if (!data) return []
    const map: Record<string, { builderId: string; builderName: string; totalOutstanding: number; invoiceCount: number }> = {}
    for (const inv of data.invoices) {
      if (!map[inv.builderId]) {
        map[inv.builderId] = { builderId: inv.builderId, builderName: inv.builderName, totalOutstanding: 0, invoiceCount: 0 }
      }
      map[inv.builderId].totalOutstanding += inv.balanceDue
      map[inv.builderId].invoiceCount++
    }
    return Object.values(map).sort((a, b) => b.totalOutstanding - a.totalOutstanding)
  }, [data])

  async function sendReminder(invoice: PredictInvoice) {
    try {
      const res = await fetch(`/api/ops/invoices/${invoice.id}/remind`, { method: 'POST' })
      if (res.ok) {
        setReminderSent(prev => ({ ...prev, [invoice.id]: true }))
      } else {
        window.location.href = `mailto:?subject=Reminder: Invoice ${invoice.invoiceNumber}&body=Hi%20${encodeURIComponent(invoice.builderName)},%0A%0AFriendly reminder — invoice ${invoice.invoiceNumber} for ${fmtMoney(invoice.balanceDue)} is outstanding.`
      }
    } catch {
      window.location.href = `mailto:?subject=Reminder: Invoice ${invoice.invoiceNumber}`
    }
  }

  if (loading || !data) {
    return (
      <div className="space-y-5">
        <PageHeader eyebrow="Finance" title="Accounts Receivable" description="Aging waterfall · payment prediction · collection actions." />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[0, 1, 2, 3].map(i => <KPICard key={i} title="" value="" loading />)}
        </div>
        <div className="h-64 skeleton rounded-lg" />
      </div>
    )
  }

  // ── Derived ────────────────────────────────────────────────────────────
  const overdue = data.waterfall.d1_30.amount + data.waterfall.d31_60.amount + data.waterfall.d61_90.amount + data.waterfall.d90_plus.amount
  const overduePct = totalOutstanding > 0 ? (overdue / totalOutstanding) * 100 : 0

  const buckets: Array<{
    key: PredictInvoice['bucket']
    label: string
    amount: number
    count: number
    tone: 'positive' | 'accent' | 'negative'
    explainer: string
  }> = [
    { key: 'current',  label: 'Current',   amount: data.waterfall.current.amount,  count: data.waterfall.current.count,  tone: 'positive',
      explainer: 'Invoices issued but not yet past due. Healthy AR sits here.' },
    { key: 'd1_30',    label: '1–30 Days', amount: data.waterfall.d1_30.amount,    count: data.waterfall.d1_30.count,    tone: 'accent',
      explainer: 'Just slipped — a reminder usually closes these.' },
    { key: 'd31_60',   label: '31–60 Days',amount: data.waterfall.d31_60.amount,   count: data.waterfall.d31_60.count,   tone: 'negative',
      explainer: 'Escalate: call the PM or controller, confirm invoice receipt.' },
    { key: 'd61_90',   label: '61–90 Days',amount: data.waterfall.d61_90.amount,   count: data.waterfall.d61_90.count,   tone: 'negative',
      explainer: 'Very late — consider a credit hold and formal demand.' },
    { key: 'd90_plus', label: '90+ Days',  amount: data.waterfall.d90_plus.amount, count: data.waterfall.d90_plus.count, tone: 'negative',
      explainer: 'Collections territory. Time for a demand letter or write-off discussion.' },
  ]

  const maxBucketAmount = Math.max(...buckets.map(b => b.amount), 1)
  const currentDso = data.dsoTrend[data.dsoTrend.length - 1]?.dso ?? 0

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <div className="space-y-5 animate-enter">
      <LiveDataIndicator trigger={refreshTick} />

      <PageHeader
        eyebrow="Finance"
        title="Accounts Receivable"
        description="Aging waterfall · payment prediction · builder exposure · one-click collections."
        actions={
          <button onClick={fetchData} className="btn btn-secondary btn-sm" disabled={refreshing}>
            <RefreshCw className={cn('w-3.5 h-3.5', refreshing && 'animate-spin')} />
            Refresh
          </button>
        }
      />

      {/* Summary strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KPICard
          title="Total Outstanding"
          value={fmtMoneyCompact(totalOutstanding)}
          subtitle={`${data.invoices.length} invoices`}
          icon={<Wallet className="w-3.5 h-3.5" />}
          accent="brand"
        />
        <KPICard
          title="Overdue"
          value={fmtMoneyCompact(overdue)}
          delta={`${overduePct.toFixed(1)}%`}
          deltaDirection={overduePct > 20 ? 'up' : 'flat'}
          subtitle="of total AR"
          icon={<AlertTriangle className="w-3.5 h-3.5" />}
          accent={overduePct > 20 ? 'negative' : overduePct > 10 ? 'accent' : 'positive'}
        />
        <KPICard
          title="90+ Day Exposure"
          value={fmtMoneyCompact(data.waterfall.d90_plus.amount)}
          subtitle={`${data.waterfall.d90_plus.count} invoices`}
          icon={<Clock className="w-3.5 h-3.5" />}
          accent={data.waterfall.d90_plus.amount > 0 ? 'negative' : 'positive'}
          badge={data.waterfall.d90_plus.count > 0 ? <Badge variant="danger" size="xs" dot>Escalate</Badge> : undefined}
        />
        <KPICard
          title="Current DSO"
          value={`${currentDso} days`}
          subtitle={data.dsoTrend.length > 1 ? '12-month trend' : 'Computed in-query'}
          icon={<TrendingDown className="w-3.5 h-3.5" />}
          accent="neutral"
          sparkline={data.dsoTrend.map(d => d.dso)}
        />
      </div>

      {/* Aging waterfall chart */}
      <Card variant="default" padding="none">
        <CardHeader>
          <div>
            <CardTitle>Aging Waterfall</CardTitle>
            <CardDescription>Click a bar to drill into invoices in that bucket.</CardDescription>
          </div>
          {bucketFilter !== 'all' && (
            <button onClick={() => setBucketFilter('all')} className="btn btn-ghost btn-xs">
              Clear filter
            </button>
          )}
        </CardHeader>
        <CardBody>
          <div className="grid grid-cols-5 gap-3" style={{ height: 220 }}>
            {buckets.map((b) => {
              const heightPct = (b.amount / maxBucketAmount) * 100
              const selected = bucketFilter === b.key
              return (
                <button
                  key={b.key}
                  onClick={() => setBucketFilter(prev => prev === b.key ? 'all' : b.key)}
                  className={cn(
                    'relative flex flex-col items-center justify-end rounded-md transition-all',
                    'border-2 hover:border-brand/60',
                    selected ? 'border-brand' : 'border-transparent',
                    'bg-surface-muted/30 group',
                  )}
                >
                  {/* Value label */}
                  <div className="absolute top-2 left-2 right-2 flex flex-col items-start">
                    <span className="text-[10px] eyebrow text-fg-muted">{b.label}</span>
                    <span className={cn(
                      'text-[13px] font-bold tabular-nums',
                      b.tone === 'positive' && 'text-data-positive',
                      b.tone === 'accent' && 'text-accent',
                      b.tone === 'negative' && 'text-data-negative',
                    )}>
                      {fmtMoneyCompact(b.amount)}
                    </span>
                    <span className="text-[10px] text-fg-subtle">{b.count} inv</span>
                  </div>
                  {/* The bar itself, grows from bottom */}
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

      {/* Builder exposure + DSO trend */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        {/* Builder exposure */}
        <Card variant="default" padding="none" className="lg:col-span-1">
          <CardHeader>
            <div>
              <CardTitle>Builder Exposure</CardTitle>
              <CardDescription>Outstanding by account</CardDescription>
            </div>
          </CardHeader>
          <CardBody className="pt-4">
            {builderSummary.length === 0 ? (
              <EmptyState icon="users" size="compact" title="No balances" description="Every builder is current." />
            ) : (
              <div className="space-y-2">
                {builderSummary.slice(0, 8).map(b => {
                  const max = builderSummary[0]?.totalOutstanding || 1
                  const pct = (b.totalOutstanding / max) * 100
                  return (
                    <button
                      key={b.builderId}
                      onClick={() => router.push(`/ops/accounts/${b.builderId}`)}
                      className="w-full text-left py-1.5 px-2 -mx-2 rounded-md hover:bg-surface-muted transition-colors group"
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-medium text-fg truncate max-w-[180px]">{b.builderName}</span>
                        <span className="text-[11px] font-semibold tabular-nums text-data-negative">
                          {fmtMoneyCompact(b.totalOutstanding)}
                        </span>
                      </div>
                      <div className="relative h-1 w-full bg-surface-muted rounded-full overflow-hidden">
                        <div className="absolute inset-y-0 left-0 bg-data-negative/70 rounded-full group-hover:bg-data-negative transition-colors" style={{ width: `${pct}%` }} />
                      </div>
                      <div className="text-[10px] text-fg-subtle mt-0.5">{b.invoiceCount} invoice{b.invoiceCount === 1 ? '' : 's'}</div>
                    </button>
                  )
                })}
              </div>
            )}
          </CardBody>
        </Card>

        {/* DSO trend */}
        <Card variant="default" padding="none" className="lg:col-span-2">
          <CardHeader>
            <div>
              <CardTitle>DSO Trend</CardTitle>
              <CardDescription>
                {data.dsoTrend.length > 1
                  ? 'Days Sales Outstanding — last 12 months'
                  : 'Days Sales Outstanding — snapshot table empty, computed in-query'}
              </CardDescription>
            </div>
            <div className="text-right">
              <div className="text-[20px] font-bold tabular-nums text-fg">{currentDso}</div>
              <div className="text-[11px] text-fg-subtle">days</div>
            </div>
          </CardHeader>
          <CardBody>
            {data.dsoTrend.length === 0 ? (
              <EmptyState icon="chart" size="compact" title="No data yet" description="DSO history will appear as snapshots accumulate." />
            ) : (
              <div className="space-y-2">
                <Sparkline data={data.dsoTrend.map(d => d.dso)} height={80} width={600} showArea showDot />
                <div className="grid grid-cols-12 gap-1 mt-2">
                  {data.dsoTrend.map((d, i) => (
                    <div key={i} className="text-[9px] text-fg-subtle text-center tabular-nums">
                      {d.date.slice(5)}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardBody>
        </Card>
      </div>

      {/* Predicted payments table */}
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
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="input h-7 w-40 text-[12px]"
            >
              <option value="all">All statuses</option>
              <option value="issued">Issued</option>
              <option value="sent">Sent</option>
              <option value="partially_paid">Partially paid</option>
              <option value="overdue">Overdue</option>
            </select>
            <select
              value={bucketFilter}
              onChange={(e) => setBucketFilter(e.target.value)}
              className="input h-7 w-40 text-[12px]"
            >
              <option value="all">All buckets</option>
              <option value="current">Current</option>
              <option value="d1_30">1–30 days</option>
              <option value="d31_60">31–60 days</option>
              <option value="d61_90">61–90 days</option>
              <option value="d90_plus">90+ days</option>
            </select>
            <div className="ml-auto text-[11px] text-fg-subtle">
              Sorted by predicted payment date · {filteredInvoices.length} of {data.invoices.length}
            </div>
          </div>
        }
        columns={[
          {
            key: 'invoiceNumber', header: 'Invoice', width: '110px', sortable: true,
            cell: (r) => <span className="font-medium text-fg font-mono text-[12px]">{r.invoiceNumber}</span>,
          },
          {
            key: 'builderName', header: 'Builder', sortable: true,
            cell: (r) => <span className="truncate max-w-[180px] block">{r.builderName}</span>,
          },
          {
            key: 'balanceDue', header: 'Balance', numeric: true, sortable: true, heatmap: true,
            heatmapValue: (r) => r.balanceDue,
            cell: (r) => <span className="font-semibold">{fmtMoney(r.balanceDue)}</span>,
          },
          {
            key: 'dueDate', header: 'Due', numeric: true, sortable: true, width: '90px',
            cell: (r) => <span className="text-fg-muted text-[12px]">{fmtShortDate(r.dueDate)}</span>,
          },
          {
            key: 'predictedPaymentDate', header: 'Predicted pay', numeric: true, sortable: true, width: '120px',
            cell: (r) => (
              <div className="flex flex-col items-end">
                <span className={cn('text-[12px] font-medium tabular-nums',
                  r.builderAvgLag > 15 ? 'text-data-negative' : r.builderAvgLag > 5 ? 'text-accent' : 'text-fg'
                )}>
                  {fmtShortDate(r.predictedPaymentDate)}
                </span>
                <span className="text-[9px] text-fg-subtle">
                  {r.builderAvgLag >= 0 ? `+${r.builderAvgLag}` : r.builderAvgLag}d vs due
                </span>
              </div>
            ),
          },
          {
            key: 'status', header: 'Status', width: '110px',
            cell: (r) => <StatusBadge status={r.status} size="sm" />,
          },
          {
            key: 'reminders', header: 'Reminders', numeric: true, width: '80px',
            cell: (r) => {
              const count = (data.reminderHistory[r.id] ?? 0) + (reminderSent[r.id] ? 1 : 0)
              return count > 0
                ? <Badge variant="neutral" size="xs">{count} sent</Badge>
                : <span className="text-fg-subtle text-[11px]">—</span>
            },
          },
        ]}
        rowActions={[
          { id: 'view', icon: <Eye className="w-3.5 h-3.5" />, label: 'View detail', shortcut: '↵',
            onClick: (r) => router.push(`/ops/invoices/${r.id}`) },
          { id: 'email', icon: <Send className="w-3.5 h-3.5" />, label: 'Send reminder', shortcut: 'M',
            onClick: (r) => sendReminder(r),
            show: (r) => r.balanceDue > 0 },
          { id: 'call', icon: <Phone className="w-3.5 h-3.5" />, label: 'Log call',
            onClick: (r) => router.push(`/ops/communication-log?invoice=${r.id}`),
            show: (r) => r.daysPastDue > 30 },
        ]}
        empty={
          <EmptyState
            icon="document"
            size="compact"
            title={bucketFilter !== 'all' || statusFilter !== 'all' ? 'No invoices match' : 'No outstanding invoices'}
            description={bucketFilter !== 'all' ? `Nothing in the ${BUCKET_LABELS[bucketFilter as PredictInvoice['bucket']]} bucket.` : 'Everyone is paid up.'}
            secondaryAction={bucketFilter !== 'all' || statusFilter !== 'all' ? { label: 'Clear filters', onClick: () => { setBucketFilter('all'); setStatusFilter('all') } } : undefined}
          />
        }
      />
    </div>
  )
}
