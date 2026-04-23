'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  ShoppingCart, Package, CheckCircle2, Clock, RefreshCw, Filter, Eye,
  DollarSign, AlertTriangle, Building, Calendar,
} from 'lucide-react'
import {
  PageHeader, KPICard, Badge, StatusBadge, DataTable, EmptyState,
  Card, CardHeader, CardTitle, CardDescription, CardBody,
  AnimatedNumber, LiveDataIndicator, InfoTip, Dialog,
} from '@/components/ui'
import { cn } from '@/lib/utils'

// ── Types ────────────────────────────────────────────────────────────────

interface WaterfallPO {
  id: string
  poNumber: string
  vendorId: string
  vendorName: string
  status: string
  amount: number
  expectedDate: string | null
  daysPastExpected: number | null
  orderedAt: string | null
  paymentHint: string | null
  bucket: 'current' | 'd1_30' | 'd31_60' | 'd61_90' | 'd90_plus'
  window: 'overdue' | 'this_week' | 'next_week' | 'later' | 'no_date'
}

interface APWaterfallData {
  asOf: string
  waterfall: {
    current:  { count: number; amount: number }
    d1_30:    { count: number; amount: number }
    d31_60:   { count: number; amount: number }
    d61_90:   { count: number; amount: number }
    d90_plus: { count: number; amount: number }
  }
  windows: {
    this_week: { count: number; amount: number }
    next_week: { count: number; amount: number }
    later:     { count: number; amount: number }
    overdue:   { count: number; amount: number }
    no_date:   { count: number; amount: number }
  }
  vendors: Array<{ vendorId: string; vendorName: string; amount: number; count: number }>
  purchaseOrders: WaterfallPO[]
}

const fmtMoney = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n)

const fmtMoneyCompact = (n: number) => {
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`
  if (Math.abs(n) >= 10_000) return `$${Math.round(n / 1000)}K`
  if (Math.abs(n) >= 1_000)  return `$${(n / 1000).toFixed(1)}K`
  return fmtMoney(n)
}

const fmtDate = (s: string | null) => s ? new Date(s).toLocaleDateString('en-US') : '—'
const fmtShort = (s: string | null) => !s ? '—' : new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

const WINDOW_LABELS = {
  overdue:   'Overdue',
  this_week: 'This week',
  next_week: 'Next week',
  later:     'Later',
  no_date:   'No date',
}

export default function AccountsPayablePage() {
  const router = useRouter()
  const [data, setData] = useState<APWaterfallData | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [bucketFilter, setBucketFilter] = useState<string>('all')
  const [windowFilter, setWindowFilter] = useState<string>('all')
  const [tick, setTick] = useState<number | null>(null)

  // Pay-modal state
  const [payModal, setPayModal] = useState<{ poId: string; poNumber: string; amount: number } | null>(null)
  const [payAmount, setPayAmount] = useState('')
  const [payMethod, setPayMethod] = useState('CHECK')
  const [payRef, setPayRef] = useState('')
  const [paySubmitting, setPaySubmitting] = useState(false)
  const [payResult, setPayResult] = useState('')

  useEffect(() => { fetchData() }, [])

  async function fetchData() {
    setRefreshing(true)
    try {
      const res = await fetch('/api/ops/finance/ap-waterfall')
      if (!res.ok) throw new Error('Failed to fetch AP waterfall')
      setData(await res.json())
      setTick(Date.now())
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  async function markPaid() {
    if (!payModal) return
    setPaySubmitting(true)
    setPayResult('')
    try {
      const res = await fetch('/api/ops/finance/ap-waterfall', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          poId: payModal.poId,
          amount: parseFloat(payAmount) || payModal.amount,
          method: payMethod,
          reference: payRef,
        }),
      })
      const j = await res.json()
      if (res.ok) {
        setPayResult(`Payment recorded on PO ${j.poNumber}`)
        setTimeout(() => { setPayModal(null); setPayResult(''); fetchData() }, 1200)
      } else {
        setPayResult(j.error || 'Failed')
      }
    } catch {
      setPayResult('Network error')
    } finally {
      setPaySubmitting(false)
    }
  }

  const filteredPOs = useMemo(() => {
    if (!data) return []
    return data.purchaseOrders.filter(po => {
      if (bucketFilter !== 'all' && po.bucket !== bucketFilter) return false
      if (windowFilter !== 'all' && po.window !== windowFilter) return false
      return true
    })
  }, [data, bucketFilter, windowFilter])

  if (loading || !data) {
    return (
      <div className="space-y-5">
        <PageHeader eyebrow="Finance" title="Accounts Payable" description="AP aging waterfall · pay windows · vendor exposure." />
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {[0,1,2,3,4].map(i => <KPICard key={i} title="" value="" loading />)}
        </div>
      </div>
    )
  }

  const buckets: Array<{ key: keyof APWaterfallData['waterfall']; label: string; tone: 'positive' | 'accent' | 'negative'; explainer: string }> = [
    { key: 'current',  label: 'Current', tone: 'positive', explainer: 'Not yet due — healthy.' },
    { key: 'd1_30',    label: '1–30 days late', tone: 'accent', explainer: 'Slightly past expected — check with vendor.' },
    { key: 'd31_60',   label: '31–60 days late', tone: 'negative', explainer: 'Starting to risk credit-standing.' },
    { key: 'd61_90',   label: '61–90 days late', tone: 'negative', explainer: 'Expect vendor to pause shipments.' },
    { key: 'd90_plus', label: '90+ days late', tone: 'negative', explainer: 'Credit hold risk — call the vendor today.' },
  ]

  const grandTotal = Object.values(data.waterfall).reduce((s, b) => s + b.amount, 0)
  const maxAmount = Math.max(...buckets.map(b => data.waterfall[b.key].amount), 1)

  return (
    <div className="space-y-5 animate-enter">
      <LiveDataIndicator trigger={tick} />

      <PageHeader
        eyebrow="Finance"
        title="Accounts Payable"
        description="Aging waterfall · pay windows · vendor exposure · one-click mark paid."
        actions={
          <button onClick={fetchData} className="btn btn-secondary btn-sm" disabled={refreshing}>
            <RefreshCw className={cn('w-3.5 h-3.5', refreshing && 'animate-spin')} />
            Refresh
          </button>
        }
      />

      {/* Summary KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <KPICard
          title="Total Open"
          value={fmtMoneyCompact(grandTotal)}
          subtitle={`${data.purchaseOrders.length} POs`}
          icon={<DollarSign className="w-3.5 h-3.5" />}
          accent="brand"
        />
        <KPICard
          title="Overdue"
          value={fmtMoneyCompact(data.windows.overdue.amount)}
          subtitle={`${data.windows.overdue.count} POs`}
          icon={<AlertTriangle className="w-3.5 h-3.5" />}
          accent={data.windows.overdue.amount > 0 ? 'negative' : 'positive'}
        />
        <KPICard
          title="Pay this week"
          value={fmtMoneyCompact(data.windows.this_week.amount)}
          subtitle={`${data.windows.this_week.count} POs`}
          icon={<Calendar className="w-3.5 h-3.5" />}
          accent="accent"
        />
        <KPICard
          title="Pay next week"
          value={fmtMoneyCompact(data.windows.next_week.amount)}
          subtitle={`${data.windows.next_week.count} POs`}
          icon={<Calendar className="w-3.5 h-3.5" />}
          accent="forecast"
        />
        <KPICard
          title="Later"
          value={fmtMoneyCompact(data.windows.later.amount)}
          subtitle={`${data.windows.later.count} POs`}
          icon={<Clock className="w-3.5 h-3.5" />}
          accent="neutral"
        />
      </div>

      {/* Aging waterfall */}
      <Card variant="default" padding="none">
        <CardHeader>
          <div>
            <CardTitle>AP Aging Waterfall</CardTitle>
            <CardDescription>Click a bar to filter the table below.</CardDescription>
          </div>
          {bucketFilter !== 'all' && (
            <button onClick={() => setBucketFilter('all')} className="btn btn-ghost btn-xs">Clear</button>
          )}
        </CardHeader>
        <CardBody>
          <div className="grid grid-cols-5 gap-3" style={{ height: 220 }}>
            {buckets.map(b => {
              const bucket = data.waterfall[b.key]
              const heightPct = (bucket.amount / maxAmount) * 100
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
                  <div className="absolute top-2 left-2 right-2 flex flex-col items-start">
                    <span className="text-[10px] eyebrow text-fg-muted">{b.label}</span>
                    <span className={cn('text-[13px] font-bold tabular-nums',
                      b.tone === 'positive' && 'text-data-positive',
                      b.tone === 'accent' && 'text-accent',
                      b.tone === 'negative' && 'text-data-negative',
                    )}>
                      {fmtMoneyCompact(bucket.amount)}
                    </span>
                    <span className="text-[10px] text-fg-subtle">{bucket.count} PO{bucket.count === 1 ? '' : 's'}</span>
                  </div>
                  <div
                    className={cn('w-[70%] rounded-t-md transition-all duration-300',
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

      {/* Top vendor exposure cards */}
      <Card variant="default" padding="none">
        <CardHeader>
          <div>
            <CardTitle>Vendor Exposure</CardTitle>
            <CardDescription>Open AP by vendor, largest first.</CardDescription>
          </div>
        </CardHeader>
        <CardBody>
          {data.vendors.length === 0 ? (
            <EmptyState icon="users" size="compact" title="No vendor exposure" description="All POs are closed." />
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {data.vendors.slice(0, 8).map(v => (
                <button
                  key={v.vendorId}
                  onClick={() => router.push(`/ops/vendors/${v.vendorId}`)}
                  className="panel panel-interactive p-3 flex flex-col gap-1 text-left hover:border-brand/40"
                >
                  <span className="text-[11px] font-semibold text-fg-muted truncate">{v.vendorName}</span>
                  <span className="text-[16px] font-bold tabular-nums text-fg">{fmtMoneyCompact(v.amount)}</span>
                  <span className="text-[10px] text-fg-subtle">{v.count} PO{v.count === 1 ? '' : 's'}</span>
                </button>
              ))}
            </div>
          )}
        </CardBody>
      </Card>

      {/* PO table */}
      <DataTable
        density="compact"
        data={filteredPOs}
        rowKey={(r) => r.id}
        onRowClick={(r) => router.push(`/ops/purchasing?po=${r.poNumber}`)}
        keyboardNav
        hint
        toolbar={
          <div className="flex items-center gap-3 w-full flex-wrap">
            <div className="flex items-center gap-2">
              <Filter className="w-3.5 h-3.5 text-fg-muted" />
              <span className="text-[11px] font-medium text-fg-muted">Filter</span>
            </div>
            <select value={bucketFilter} onChange={e => setBucketFilter(e.target.value)} className="input h-7 w-36 text-[12px]">
              <option value="all">All buckets</option>
              <option value="current">Current</option>
              <option value="d1_30">1–30 late</option>
              <option value="d31_60">31–60 late</option>
              <option value="d61_90">61–90 late</option>
              <option value="d90_plus">90+ late</option>
            </select>
            <select value={windowFilter} onChange={e => setWindowFilter(e.target.value)} className="input h-7 w-32 text-[12px]">
              <option value="all">All windows</option>
              <option value="overdue">Overdue</option>
              <option value="this_week">This week</option>
              <option value="next_week">Next week</option>
              <option value="later">Later</option>
              <option value="no_date">No date</option>
            </select>
            <div className="ml-auto text-[11px] text-fg-subtle">{filteredPOs.length} of {data.purchaseOrders.length}</div>
          </div>
        }
        columns={[
          { key: 'poNumber', header: 'PO', width: '110px', sortable: true,
            cell: r => <span className="font-mono text-[12px] font-semibold text-fg">{r.poNumber}</span> },
          { key: 'vendorName', header: 'Vendor', sortable: true,
            cell: r => <span className="truncate max-w-[200px] block">{r.vendorName}</span> },
          { key: 'amount', header: 'Amount', numeric: true, sortable: true, heatmap: true,
            heatmapValue: r => r.amount,
            cell: r => <span className="font-semibold">{fmtMoney(r.amount)}</span> },
          { key: 'expectedDate', header: 'Expected', numeric: true, sortable: true, width: '100px',
            cell: r => <span className="text-fg-muted text-[12px]">{fmtShort(r.expectedDate)}</span> },
          { key: 'window', header: 'When', width: '100px',
            cell: r => (
              <Badge
                variant={r.window === 'overdue' ? 'danger' : r.window === 'this_week' ? 'warning' : r.window === 'next_week' ? 'info' : 'neutral'}
                size="xs"
              >
                {WINDOW_LABELS[r.window]}
              </Badge>
            ) },
          { key: 'status', header: 'Status', width: '130px',
            cell: r => <StatusBadge status={r.status} size="sm" /> },
        ]}
        rowActions={[
          { id: 'view', icon: <Eye className="w-3.5 h-3.5" />, label: 'View PO', shortcut: '↵',
            onClick: r => router.push(`/ops/purchasing?po=${r.poNumber}`) },
          { id: 'pay', icon: <DollarSign className="w-3.5 h-3.5" />, label: 'Mark paid',
            onClick: r => { setPayModal({ poId: r.id, poNumber: r.poNumber, amount: r.amount }); setPayAmount(String(r.amount)); setPayMethod('CHECK'); setPayRef(''); setPayResult('') } },
          { id: 'vendor', icon: <Building className="w-3.5 h-3.5" />, label: 'Open vendor',
            onClick: r => router.push(`/ops/vendors/${r.vendorId}`) },
        ]}
        empty={
          <EmptyState
            icon="package"
            size="compact"
            title="No POs match"
            description={bucketFilter !== 'all' || windowFilter !== 'all' ? 'Try a different filter.' : 'No open purchase orders.'}
            secondaryAction={bucketFilter !== 'all' || windowFilter !== 'all' ? { label: 'Clear filters', onClick: () => { setBucketFilter('all'); setWindowFilter('all') } } : undefined}
          />
        }
      />

      {/* Pay modal */}
      <Dialog
        open={!!payModal}
        onClose={() => setPayModal(null)}
        title="Record Payment"
        description={payModal ? `PO ${payModal.poNumber}` : undefined}
        size="md"
        footer={
          <>
            <button onClick={() => setPayModal(null)} className="btn btn-secondary btn-sm">Cancel</button>
            <button onClick={markPaid} disabled={paySubmitting || !payAmount} className="btn btn-primary btn-sm">
              {paySubmitting ? 'Recording…' : 'Record Payment'}
            </button>
          </>
        }
      >
        <div className="space-y-3">
          <div>
            <label className="text-[11px] font-semibold text-fg-muted">Amount</label>
            <input type="number" step="0.01" value={payAmount} onChange={e => setPayAmount(e.target.value)}
              className="input w-full text-sm" placeholder="0.00" />
          </div>
          <div>
            <label className="text-[11px] font-semibold text-fg-muted">Method</label>
            <select value={payMethod} onChange={e => setPayMethod(e.target.value)} className="input w-full text-sm">
              <option value="CHECK">Check</option>
              <option value="ACH">ACH</option>
              <option value="WIRE">Wire</option>
              <option value="CREDIT_CARD">Credit Card</option>
              <option value="CASH">Cash</option>
            </select>
          </div>
          <div>
            <label className="text-[11px] font-semibold text-fg-muted">Reference (optional)</label>
            <input type="text" value={payRef} onChange={e => setPayRef(e.target.value)}
              className="input w-full text-sm" placeholder="Check #, ACH ref, etc." />
          </div>
          {payResult && (
            <div className={cn('p-2 rounded-md text-xs',
              payResult.includes('recorded') ? 'bg-data-positive/10 text-data-positive' : 'bg-data-negative/10 text-data-negative',
            )}>
              {payResult}
            </div>
          )}
        </div>
      </Dialog>
    </div>
  )
}
