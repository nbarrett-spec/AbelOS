'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  ShoppingCart, Package, CheckCircle2, Clock, RefreshCw, Filter, Eye,
  DollarSign, AlertTriangle, Building,
} from 'lucide-react'
import {
  PageHeader, KPICard, Badge, StatusBadge, DataTable, EmptyState,
  Card, CardHeader, CardTitle, CardDescription, CardBody,
  AnimatedNumber, LiveDataIndicator, InfoTip,
} from '@/components/ui'
import { cn } from '@/lib/utils'

// ── Types ────────────────────────────────────────────────────────────────

interface PurchaseOrder {
  id: string
  poNumber: string
  vendorId: string
  vendorName: string
  amount: number
  status: string
  expectedDate: string
  items: number
}

interface APData {
  openPOSummary: {
    draft: number
    pendingApproval: number
    approved: number
    sent: number
    received: number
  }
  vendorSpend: Array<{
    vendorId: string
    vendorName: string
    totalPOs: number
    paidAmount: number
    outstandingAmount: number
    status: string
  }>
  purchaseOrders: PurchaseOrder[]
  billPayQueue: Array<{
    poNumber: string
    vendorName: string
    amount: number
    expectedDate: string
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

export default function AccountsPayablePage() {
  const router = useRouter()
  const [data, setData] = useState<APData | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [tick, setTick] = useState<number | null>(null)

  // Payment modal state
  const [payModal, setPayModal] = useState<{ poId: string; poNumber: string; amount: number } | null>(null)
  const [payAmount, setPayAmount] = useState('')
  const [payMethod, setPayMethod] = useState('CHECK')
  const [payRef, setPayRef] = useState('')
  const [paySubmitting, setPaySubmitting] = useState(false)
  const [payResult, setPayResult] = useState('')

  async function recordPayment() {
    if (!payModal) return
    setPaySubmitting(true)
    setPayResult('')
    try {
      const res = await fetch(`/api/ops/procurement/purchase-orders/${payModal.poId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'mark_paid',
          paymentAmount: parseFloat(payAmount) || payModal.amount,
          paymentMethod: payMethod,
          paymentReference: payRef,
        }),
      })
      const result = await res.json()
      if (res.ok) {
        setPayResult(`Payment recorded: ${result.message}`)
        setTimeout(() => { setPayModal(null); setPayResult(''); fetchData() }, 1500)
      } else {
        setPayResult(result.error || 'Payment failed')
      }
    } catch {
      setPayResult('Network error — try again')
    } finally {
      setPaySubmitting(false)
    }
  }

  useEffect(() => { fetchData() }, [])

  async function fetchData() {
    setRefreshing(true)
    try {
      const res = await fetch('/api/ops/finance/ap')
      if (!res.ok) throw new Error('Failed to fetch AP data')
      setData(await res.json())
      setTick(Date.now())
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  const filteredPOs = useMemo(() => {
    if (!data) return []
    if (statusFilter === 'all') return data.purchaseOrders
    return data.purchaseOrders.filter(p => p.status.toLowerCase() === statusFilter.toLowerCase())
  }, [data, statusFilter])

  const billPayTotal = useMemo(() => {
    if (!data) return 0
    return data.billPayQueue.reduce((sum, p) => sum + p.amount, 0)
  }, [data])

  const totalOutstanding = useMemo(() => {
    if (!data) return 0
    return data.vendorSpend.reduce((s, v) => s + v.outstandingAmount, 0)
  }, [data])

  if (loading || !data) {
    return (
      <div className="space-y-5">
        <PageHeader eyebrow="Finance" title="Accounts Payable" description="Vendor payments · PO pipeline · bill pay queue." />
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {[0,1,2,3,4].map(i => <KPICard key={i} title="" value="" loading />)}
        </div>
        <div className="h-64 skeleton rounded-lg" />
      </div>
    )
  }

  const sum = data.openPOSummary
  const totalPipeline = sum.draft + sum.pendingApproval + sum.approved + sum.sent + sum.received

  return (
    <div className="space-y-5 animate-enter">
      <LiveDataIndicator trigger={tick} />

      <PageHeader
        eyebrow="Finance"
        title="Accounts Payable"
        description="Vendor payments · PO pipeline · bill pay queue."
        actions={
          <button onClick={fetchData} className="btn btn-secondary btn-sm" disabled={refreshing}>
            <RefreshCw className={cn('w-3.5 h-3.5', refreshing && 'animate-spin')} />
            Refresh
          </button>
        }
      />

      {/* PO status pipeline as KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {[
          { label: 'Draft',            count: sum.draft,            tone: 'neutral' as const },
          { label: 'Pending',          count: sum.pendingApproval,  tone: 'accent'  as const },
          { label: 'Approved',         count: sum.approved,         tone: 'forecast' as const },
          { label: 'Sent',             count: sum.sent,             tone: 'brand'   as const },
          { label: 'Received',         count: sum.received,         tone: 'positive' as const },
        ].map((b, i) => {
          const pct = totalPipeline > 0 ? (b.count / totalPipeline) * 100 : 0
          return (
            <KPICard
              key={b.label}
              title={b.label}
              value={<AnimatedNumber value={b.count} />}
              subtitle={`${pct.toFixed(0)}% of pipeline`}
              accent={b.tone}
            />
          )
        })}
      </div>

      {/* Key financial KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        <KPICard
          title="Total Outstanding"
          value={<AnimatedNumber value={totalOutstanding} format={fmtMoneyCompact} />}
          subtitle={`${data.vendorSpend.length} vendors`}
          icon={<DollarSign className="w-3.5 h-3.5" />}
          accent="negative"
        />
        <KPICard
          title="Ready to Pay"
          value={<AnimatedNumber value={billPayTotal} format={fmtMoneyCompact} />}
          subtitle={`${data.billPayQueue.length} bills queued`}
          icon={<CheckCircle2 className="w-3.5 h-3.5" />}
          accent="positive"
          badge={data.billPayQueue.length > 0 ? <Badge variant="success" size="xs" dot>Action</Badge> : undefined}
        />
        <KPICard
          title="Awaiting Approval"
          value={<AnimatedNumber value={sum.pendingApproval} />}
          subtitle="POs blocking spend"
          icon={<Clock className="w-3.5 h-3.5" />}
          accent={sum.pendingApproval > 5 ? 'negative' : 'accent'}
        />
      </div>

      {/* Bill-pay queue + vendor exposure */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        {/* Bill pay queue */}
        <Card variant="default" padding="none" className="lg:col-span-1">
          <CardHeader>
            <div>
              <CardTitle>Bill Pay Queue</CardTitle>
              <CardDescription>Ready for payment</CardDescription>
            </div>
            <Badge variant="brand" size="sm">{data.billPayQueue.length}</Badge>
          </CardHeader>
          <CardBody className="pt-3">
            {data.billPayQueue.length === 0 ? (
              <EmptyState
                icon="sparkles"
                size="compact"
                title="Caught up"
                description="No POs ready for payment."
              />
            ) : (
              <div className="space-y-2">
                {data.billPayQueue.slice(0, 8).map((po, idx) => (
                  <button
                    key={`${po.poNumber}-${idx}`}
                    onClick={() => router.push(`/ops/purchasing?po=${po.poNumber}`)}
                    className="w-full text-left px-3 py-2 rounded-md hover:bg-surface-muted transition-colors border border-border"
                  >
                    <div className="flex items-center justify-between">
                      <div className="min-w-0 flex-1">
                        <div className="font-mono text-[12px] font-semibold text-fg">{po.poNumber}</div>
                        <div className="text-[11px] text-fg-muted truncate">{po.vendorName}</div>
                      </div>
                      <div className="text-right shrink-0 ml-3">
                        <div className="text-[13px] font-semibold tabular-nums text-fg">{fmtMoneyCompact(po.amount)}</div>
                        <div className="text-[10px] text-fg-subtle">{fmtDate(po.expectedDate)}</div>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </CardBody>
        </Card>

        {/* Vendor spend */}
        <Card variant="default" padding="none" className="lg:col-span-2">
          <CardHeader>
            <div className="flex items-center gap-2">
              <CardTitle>Vendor Spend</CardTitle>
              <InfoTip label="Vendor Spend">
                Paid vs outstanding by vendor. Heatmap shades outstanding balances — darker red = higher exposure.
              </InfoTip>
            </div>
            <CardDescription>Top 15</CardDescription>
          </CardHeader>
          <div className="overflow-x-auto">
            <DataTable
              density="compact"
              data={data.vendorSpend.slice(0, 15)}
              rowKey={(r) => r.vendorId}
              onRowClick={(r) => router.push(`/ops/vendors/${r.vendorId}`)}
              className="!border-0"
              columns={[
                { key: 'vendorName', header: 'Vendor',
                  cell: (r) => <span className="truncate max-w-[220px] block font-medium text-fg">{r.vendorName}</span> },
                { key: 'totalPOs', header: 'POs', numeric: true, width: '60px',
                  cell: (r) => <span className="text-fg-muted tabular-nums">{r.totalPOs}</span> },
                { key: 'paidAmount', header: 'Paid', numeric: true,
                  cell: (r) => <span className="text-data-positive font-medium">{fmtMoneyCompact(r.paidAmount)}</span> },
                { key: 'outstandingAmount', header: 'Outstanding', numeric: true, heatmap: true,
                  heatmapValue: (r) => r.outstandingAmount,
                  cell: (r) => <span className="font-semibold text-fg">{fmtMoneyCompact(r.outstandingAmount)}</span> },
                { key: 'status', header: 'Status', width: '110px',
                  cell: (r) => <Badge variant={r.status === 'active' ? 'success' : 'neutral'} size="xs" dot>{r.status}</Badge> },
              ]}
              empty={<EmptyState icon="users" size="compact" title="No vendor activity" description="No PO spend recorded yet." />}
            />
          </div>
        </Card>
      </div>

      {/* Purchase orders table */}
      <DataTable
        density="compact"
        data={filteredPOs}
        rowKey={(r) => r.id}
        onRowClick={(r) => router.push(`/ops/purchasing?po=${r.poNumber}`)}
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
              className="input h-7 w-48 text-[12px]"
            >
              <option value="all">All statuses</option>
              <option value="draft">Draft</option>
              <option value="pending_approval">Pending approval</option>
              <option value="approved">Approved</option>
              <option value="sent_to_vendor">Sent to vendor</option>
              <option value="partially_received">Partially received</option>
              <option value="received">Received</option>
            </select>
            <div className="ml-auto text-[11px] text-fg-subtle">
              {filteredPOs.length} of {data.purchaseOrders.length}
            </div>
          </div>
        }
        columns={[
          { key: 'poNumber', header: 'PO', width: '110px', sortable: true,
            cell: (r) => <span className="font-mono text-[12px] font-semibold text-fg">{r.poNumber}</span> },
          { key: 'vendorName', header: 'Vendor', sortable: true,
            cell: (r) => <span className="truncate max-w-[200px] block">{r.vendorName}</span> },
          { key: 'amount', header: 'Amount', numeric: true, sortable: true, heatmap: true,
            heatmapValue: (r) => r.amount,
            cell: (r) => <span className="font-semibold">{fmtMoney(r.amount)}</span> },
          { key: 'items', header: 'Items', numeric: true, width: '70px',
            cell: (r) => <span className="text-fg-muted">{r.items}</span> },
          { key: 'status', header: 'Status', width: '130px',
            cell: (r) => <StatusBadge status={r.status} size="sm" /> },
          { key: 'expectedDate', header: 'Expected', numeric: true, sortable: true,
            cell: (r) => <span className="text-fg-muted text-[12px]">{fmtDate(r.expectedDate)}</span> },
        ]}
        rowActions={[
          { id: 'view', icon: <Eye className="w-3.5 h-3.5" />, label: 'View PO', shortcut: '↵',
            onClick: (r) => router.push(`/ops/purchasing?po=${r.poNumber}`) },
          { id: 'approve', icon: <CheckCircle2 className="w-3.5 h-3.5" />, label: 'Approve',
            onClick: (r) => router.push(`/ops/purchasing?po=${r.poNumber}&action=approve`),
            show: (r) => r.status === 'PENDING_APPROVAL' },
          { id: 'vendor', icon: <Building className="w-3.5 h-3.5" />, label: 'Open vendor',
            onClick: (r) => router.push(`/ops/vendors/${r.vendorId}`) },
          { id: 'pay', icon: <DollarSign className="w-3.5 h-3.5" />, label: 'Record payment',
            onClick: (r) => { setPayModal({ poId: r.id, poNumber: r.poNumber, amount: r.amount }); setPayAmount(String(r.amount)); setPayMethod('CHECK'); setPayRef(''); setPayResult('') },
            show: (r) => ['APPROVED', 'SENT_TO_VENDOR', 'PARTIALLY_RECEIVED', 'RECEIVED'].includes(r.status) },
        ]}
        empty={
          <EmptyState
            icon="package"
            size="compact"
            title="No purchase orders"
            description={statusFilter === 'all' ? 'Create your first PO from the Purchasing page.' : `Nothing in status "${statusFilter}".`}
            action={statusFilter === 'all' ? { label: 'Open purchasing', href: '/ops/purchasing' } : undefined}
            secondaryAction={statusFilter !== 'all' ? { label: 'Clear filter', onClick: () => setStatusFilter('all') } : undefined}
          />
        }
      />

      {/* Payment modal */}
      {payModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}
          onClick={() => setPayModal(null)}>
          <div style={{ background: 'white', borderRadius: 12, padding: 24, width: 420, maxWidth: '90vw' }}
            onClick={(e) => e.stopPropagation()}>
            <h3 style={{ margin: '0 0 4px', fontSize: 16, fontWeight: 600 }}>Record Payment</h3>
            <p style={{ margin: '0 0 16px', fontSize: 13, color: '#6B7280' }}>PO {payModal.poNumber}</p>

            <label style={{ display: 'block', fontSize: 12, fontWeight: 500, marginBottom: 4 }}>Amount</label>
            <input type="number" step="0.01" value={payAmount}
              onChange={(e) => setPayAmount(e.target.value)}
              style={{ width: '100%', padding: '8px 12px', border: '1px solid #D1D5DB', borderRadius: 6, fontSize: 14, marginBottom: 12 }}
              placeholder="0.00" />

            <label style={{ display: 'block', fontSize: 12, fontWeight: 500, marginBottom: 4 }}>Method</label>
            <select value={payMethod} onChange={(e) => setPayMethod(e.target.value)}
              style={{ width: '100%', padding: '8px 12px', border: '1px solid #D1D5DB', borderRadius: 6, fontSize: 14, marginBottom: 12 }}>
              <option value="CHECK">Check</option>
              <option value="ACH">ACH</option>
              <option value="WIRE">Wire</option>
              <option value="CREDIT_CARD">Credit Card</option>
              <option value="CASH">Cash</option>
            </select>

            <label style={{ display: 'block', fontSize: 12, fontWeight: 500, marginBottom: 4 }}>Reference # (optional)</label>
            <input type="text" value={payRef}
              onChange={(e) => setPayRef(e.target.value)}
              style={{ width: '100%', padding: '8px 12px', border: '1px solid #D1D5DB', borderRadius: 6, fontSize: 14, marginBottom: 16 }}
              placeholder="Check #, ACH ref, etc." />

            {payResult && (
              <div style={{ padding: 10, borderRadius: 6, marginBottom: 12, fontSize: 13,
                background: payResult.includes('recorded') ? '#D1FAE5' : '#FEE2E2',
                color: payResult.includes('recorded') ? '#065F46' : '#991B1B' }}>
                {payResult}
              </div>
            )}

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setPayModal(null)}
                style={{ padding: '8px 16px', border: '1px solid #D1D5DB', borderRadius: 6, fontSize: 13, cursor: 'pointer', background: 'white' }}>
                Cancel
              </button>
              <button onClick={recordPayment} disabled={paySubmitting || !payAmount}
                style={{ padding: '8px 16px', background: '#0f2a3e', color: 'white', border: 'none', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: paySubmitting ? 'not-allowed' : 'pointer', opacity: paySubmitting ? 0.7 : 1 }}>
                {paySubmitting ? 'Recording...' : 'Record Payment'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
