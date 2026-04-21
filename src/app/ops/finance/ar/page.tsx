'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Wallet, AlertTriangle, RefreshCw, Mail, Eye, Phone, DollarSign,
  Building2, Clock, Filter,
} from 'lucide-react'
import {
  PageHeader, KPICard, Badge, StatusBadge, DataTable, EmptyState,
  Card, CardHeader, CardTitle, CardDescription, CardBody,
  AnimatedNumber, LiveDataIndicator, InfoTip,
} from '@/components/ui'
import { cn } from '@/lib/utils'

// ── Types ────────────────────────────────────────────────────────────────

interface Invoice {
  id: string
  invoiceNumber: string
  builderId: string
  builderName: string
  amount: number
  status: string
  dueDate: string
  issuedAt: string
  daysOutstanding: number
  amountPaid: number
  balanceDue: number
}

interface ARData {
  agingBuckets: {
    current:     { count: number; amount: number }
    days1to30:   { count: number; amount: number }
    days31to60:  { count: number; amount: number }
    days60plus:  { count: number; amount: number }
  }
  invoices: Invoice[]
  builderSummary: Array<{
    builderId: string
    builderName: string
    totalOutstanding: number
    invoiceCount: number
  }>
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

const fmtDate = (s: string) => s ? new Date(s).toLocaleDateString('en-US') : '—'

// ── Page ─────────────────────────────────────────────────────────────────

export default function AccountsReceivablePage() {
  const router = useRouter()
  const [data, setData] = useState<ARData | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [refreshTick, setRefreshTick] = useState<number | null>(null)

  useEffect(() => { fetchData() }, [])

  async function fetchData() {
    setRefreshing(true)
    try {
      const res = await fetch('/api/ops/finance/ar')
      if (!res.ok) throw new Error('Failed to fetch AR data')
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
    return data.agingBuckets.current.amount
      + data.agingBuckets.days1to30.amount
      + data.agingBuckets.days31to60.amount
      + data.agingBuckets.days60plus.amount
  }, [data])

  const filteredInvoices = useMemo(() => {
    if (!data) return []
    if (statusFilter === 'all') return data.invoices
    return data.invoices.filter(i => i.status.toLowerCase() === statusFilter.toLowerCase())
  }, [data, statusFilter])

  async function sendReminder(invoice: Invoice) {
    // Fire-and-forget — route already exists in ops/invoices. Fallback to mailto.
    try {
      const res = await fetch(`/api/ops/invoices/${invoice.id}/remind`, { method: 'POST' })
      if (!res.ok) throw new Error('fallback')
    } catch {
      window.location.href = `mailto:?subject=Reminder: Invoice ${invoice.invoiceNumber}&body=Hi%20${encodeURIComponent(invoice.builderName)},%0A%0AFriendly reminder — invoice ${invoice.invoiceNumber} for ${fmtMoney(invoice.balanceDue)} is outstanding.`
    }
  }

  if (loading || !data) {
    return (
      <div className="space-y-5">
        <PageHeader eyebrow="Finance" title="Accounts Receivable" description="AR aging · collection actions · builder exposure." />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[0,1,2,3].map(i => <KPICard key={i} title="" value="" loading />)}
        </div>
        <div className="h-64 skeleton rounded-lg" />
      </div>
    )
  }

  // ── Derived ────────────────────────────────────────────────────────────
  const overdue = data.agingBuckets.days1to30.amount + data.agingBuckets.days31to60.amount + data.agingBuckets.days60plus.amount
  const overduePct = totalOutstanding > 0 ? (overdue / totalOutstanding) * 100 : 0

  const buckets = [
    { key: 'current',    label: 'Current',       amount: data.agingBuckets.current.amount,    count: data.agingBuckets.current.count,    tone: 'positive' as const,
      explainer: 'Invoices issued but not yet overdue. Healthy AR sits here.' },
    { key: 'days1to30',  label: '1–30 Days',     amount: data.agingBuckets.days1to30.amount,  count: data.agingBuckets.days1to30.count,  tone: 'accent' as const,
      explainer: 'Just slipped — a friendly reminder usually closes these.' },
    { key: 'days31to60', label: '31–60 Days',    amount: data.agingBuckets.days31to60.amount, count: data.agingBuckets.days31to60.count, tone: 'negative' as const,
      explainer: 'Escalate: phone the PM or controller, confirm receipt of invoice.' },
    { key: 'days60plus', label: '60+ Days',      amount: data.agingBuckets.days60plus.amount, count: data.agingBuckets.days60plus.count, tone: 'negative' as const,
      explainer: '60-day+ bucket. Consider credit hold, demand letter, or collections.' },
  ]

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <div className="space-y-5 animate-enter">
      <LiveDataIndicator trigger={refreshTick} />

      <PageHeader
        eyebrow="Finance"
        title="Accounts Receivable"
        description="AR aging heatmap · one-click collection actions · builder exposure."
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
          value={<AnimatedNumber value={totalOutstanding} format={fmtMoneyCompact} />}
          subtitle={`${data.invoices.length} invoices`}
          icon={<Wallet className="w-3.5 h-3.5" />}
          accent="brand"
        />
        <KPICard
          title="Overdue"
          value={<AnimatedNumber value={overdue} format={fmtMoneyCompact} />}
          delta={`${overduePct.toFixed(1)}%`}
          deltaDirection={overduePct > 20 ? 'up' : 'flat'}
          subtitle="of total AR"
          icon={<AlertTriangle className="w-3.5 h-3.5" />}
          accent={overduePct > 20 ? 'negative' : overduePct > 10 ? 'accent' : 'positive'}
        />
        <KPICard
          title="60+ Day Exposure"
          value={<AnimatedNumber value={data.agingBuckets.days60plus.amount} format={fmtMoneyCompact} />}
          subtitle={`${data.agingBuckets.days60plus.count} invoices`}
          icon={<Clock className="w-3.5 h-3.5" />}
          accent={data.agingBuckets.days60plus.amount > 0 ? 'negative' : 'positive'}
          badge={data.agingBuckets.days60plus.count > 0 ? <Badge variant="danger" size="xs" dot>Escalate</Badge> : undefined}
        />
        <KPICard
          title="Top Debtor"
          value={data.builderSummary[0]?.builderName?.slice(0, 18) ?? '—'}
          subtitle={data.builderSummary[0] ? fmtMoneyCompact(data.builderSummary[0].totalOutstanding) : 'No AR'}
          icon={<Building2 className="w-3.5 h-3.5" />}
          accent="neutral"
          onClick={data.builderSummary[0] ? () => router.push(`/ops/accounts/${data.builderSummary[0].builderId}`) : undefined}
        />
      </div>

      {/* Aging buckets — heatmap-style cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {buckets.map((b, i) => {
          const pct = totalOutstanding > 0 ? (b.amount / totalOutstanding) * 100 : 0
          return (
            <button
              key={b.key}
              onClick={() => router.push(`/ops/finance/ar?bucket=${b.key}`)}
              className={cn(
                'panel panel-interactive text-left px-4 py-3.5 flex flex-col gap-2 relative overflow-hidden',
                'animate-enter',
                `animate-enter-delay-${i + 1}`,
              )}
            >
              <span
                aria-hidden
                className={cn(
                  'absolute left-0 top-0 bottom-0 w-[3px]',
                  b.tone === 'positive' ? 'bg-data-positive'
                  : b.tone === 'negative' ? 'bg-data-negative'
                  : 'bg-accent'
                )}
              />
              <div className="flex items-center justify-between">
                <span className="eyebrow">{b.label}</span>
                <InfoTip label={b.label}>{b.explainer}</InfoTip>
              </div>
              <div className={cn(
                'metric metric-md tabular-nums',
                b.tone === 'positive' ? 'text-data-positive'
                : b.tone === 'negative' ? 'text-data-negative'
                : 'text-accent'
              )}>
                <AnimatedNumber value={b.amount} format={fmtMoneyCompact} />
              </div>
              <div className="text-[11px] text-fg-subtle flex items-center justify-between">
                <span>{b.count} invoices</span>
                <span className="tabular-nums">{pct.toFixed(1)}%</span>
              </div>
              <div className="relative h-1 w-full bg-surface-muted rounded-full overflow-hidden mt-0.5">
                <div
                  className={cn(
                    'absolute inset-y-0 left-0 rounded-full transition-all duration-slow',
                    b.tone === 'positive' ? 'bg-data-positive'
                    : b.tone === 'negative' ? 'bg-data-negative'
                    : 'bg-accent'
                  )}
                  style={{ width: `${Math.min(100, pct)}%` }}
                />
              </div>
            </button>
          )
        })}
      </div>

      {/* Builder summary + invoice table */}
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
            {data.builderSummary.length === 0 ? (
              <EmptyState
                icon="users"
                size="compact"
                title="No outstanding balances"
                description="Every builder is current. Nice."
              />
            ) : (
              <div className="space-y-2">
                {data.builderSummary.slice(0, 8).map(b => {
                  const max = data.builderSummary[0]?.totalOutstanding || 1
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

        {/* Invoice table */}
        <div className="lg:col-span-2">
          <DataTable
            density="compact"
            data={filteredInvoices}
            rowKey={(r) => r.id}
            onRowClick={(r) => router.push(`/ops/invoices/${r.id}`)}
            keyboardNav
            hint
            toolbar={
              <div className="flex items-center gap-3 w-full">
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
                  <option value="draft">Draft</option>
                  <option value="issued">Issued</option>
                  <option value="sent">Sent</option>
                  <option value="partially_paid">Partially paid</option>
                  <option value="paid">Paid</option>
                  <option value="overdue">Overdue</option>
                </select>
                <div className="ml-auto text-[11px] text-fg-subtle">
                  {filteredInvoices.length} of {data.invoices.length}
                </div>
              </div>
            }
            columns={[
              {
                key: 'invoiceNumber',
                header: 'Invoice',
                width: '110px',
                cell: (r) => <span className="font-medium text-fg font-mono text-[12px]">{r.invoiceNumber}</span>,
                sortable: true,
              },
              {
                key: 'builderName',
                header: 'Builder',
                cell: (r) => <span className="truncate max-w-[180px] block">{r.builderName}</span>,
                sortable: true,
              },
              {
                key: 'balanceDue',
                header: 'Balance',
                numeric: true,
                sortable: true,
                heatmap: true,
                heatmapValue: (r) => r.balanceDue,
                cell: (r) => (
                  <span className={cn('font-semibold', r.balanceDue > 0 ? 'text-fg' : 'text-data-positive')}>
                    {fmtMoney(r.balanceDue)}
                  </span>
                ),
              },
              {
                key: 'status',
                header: 'Status',
                width: '120px',
                cell: (r) => <StatusBadge status={r.status} size="sm" />,
              },
              {
                key: 'dueDate',
                header: 'Due',
                numeric: true,
                sortable: true,
                cell: (r) => <span className="text-fg-muted text-[12px]">{fmtDate(r.dueDate)}</span>,
              },
              {
                key: 'daysOutstanding',
                header: 'DSO',
                numeric: true,
                sortable: true,
                width: '70px',
                cell: (r) => (
                  <span className={cn(
                    'font-semibold tabular-nums',
                    r.daysOutstanding > 60 ? 'text-data-negative'
                    : r.daysOutstanding > 30 ? 'text-accent'
                    : 'text-fg-muted'
                  )}>
                    {r.daysOutstanding}d
                  </span>
                ),
              },
            ]}
            rowActions={[
              { id: 'view', icon: <Eye className="w-3.5 h-3.5" />, label: 'View detail', shortcut: '↵',
                onClick: (r) => router.push(`/ops/invoices/${r.id}`) },
              { id: 'email', icon: <Mail className="w-3.5 h-3.5" />, label: 'Send reminder', shortcut: 'M',
                onClick: (r) => sendReminder(r),
                show: (r) => r.balanceDue > 0 },
              { id: 'call',  icon: <Phone className="w-3.5 h-3.5" />, label: 'Log call',
                onClick: (r) => router.push(`/ops/communication-log?invoice=${r.id}`),
                show: (r) => r.daysOutstanding > 30 },
            ]}
            empty={
              <EmptyState
                icon="document"
                size="compact"
                title="No invoices match"
                description={statusFilter === 'all' ? 'No invoices yet.' : `Nothing in status "${statusFilter}".`}
                secondaryAction={statusFilter !== 'all' ? { label: 'Clear filter', onClick: () => setStatusFilter('all') } : undefined}
              />
            }
          />
        </div>
      </div>
    </div>
  )
}
