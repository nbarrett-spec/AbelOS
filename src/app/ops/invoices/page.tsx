'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { Receipt } from 'lucide-react'
import PageHeader from '@/components/ui/PageHeader'
import EmptyState from '@/components/ui/EmptyState'
import { Badge, getStatusBadgeVariant } from '@/components/ui/Badge'
import { CreateInvoiceModal } from '../components/CreateInvoiceModal'
import { RecordPaymentModal } from '../components/RecordPaymentModal'
import { BatchPaymentModal, type BatchInvoice } from '../components/BatchPaymentModal'

const INV_STATUSES = [
  { key: 'ALL', label: 'All' },
  { key: 'DRAFT', label: 'Draft' },
  { key: 'ISSUED', label: 'Issued' },
  { key: 'SENT', label: 'Sent' },
  { key: 'OVERDUE', label: 'Overdue' },
  { key: 'PARTIALLY_PAID', label: 'Partial' },
  { key: 'PAID', label: 'Paid' },
]

interface Invoice {
  id: string
  invoiceNumber: string
  builderId: string
  builderName?: string
  jobId?: string | null
  jobNumber?: string | null
  community?: string | null
  jobAddress?: string | null
  total: number
  balanceDue: number
  amountPaid: number
  dueDate: string | null
  issuedAt: string | null
  status: string
  items: any[]
  payments: any[]
}

interface AgingData {
  totalOutstanding: number
  current: number
  days1to30: number
  days31to60: number
  days60plus: number
}

interface ApiResponse {
  invoices: Invoice[]
  pagination: { page: number; limit: number; total: number; pages: number }
  aging: AgingData
}

export default function InvoicesPage() {
  const [statusFilter, setStatusFilter] = useState('ALL')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [sortBy, setSortBy] = useState('createdAt')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [page, setPage] = useState(1)
  const [data, setData] = useState<ApiResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false)
  const [paymentInvoice, setPaymentInvoice] = useState<Invoice | null>(null)
  const [cashFlowHealth, setCashFlowHealth] = useState<any>(null)
  const [collectionsData, setCollectionsData] = useState<any>(null)
  // Batch-payment selection: invoice ids only — kept as a Set so toggle is
  // O(1). The full Invoice rows we need at submit time are derived from
  // `data.invoices` at render via the selectedInvoiceList memo below.
  const [selectedInvoices, setSelectedInvoices] = useState<Set<string>>(new Set())
  const [isBatchModalOpen, setIsBatchModalOpen] = useState(false)

  const fetchCashFlowInsights = async () => {
    try {
      const [wc, coll] = await Promise.all([
        fetch('/api/ops/cash-flow-optimizer/working-capital').then(r => r.ok ? r.json() : null),
        fetch('/api/ops/cash-flow-optimizer/collections').then(r => r.ok ? r.json() : null),
      ])
      if (wc) setCashFlowHealth(wc)
      if (coll) setCollectionsData({ ...coll, actions: coll.prioritizedActions || coll.actions || [] })
    } catch { /* silent */ }
  }

  const fetchInvoices = async () => {
    try {
      setLoading(true)
      const params = new URLSearchParams()
      params.set('page', page.toString())
      params.set('sortBy', sortBy)
      params.set('sortDir', sortDir)
      if (dateFrom) params.set('dateFrom', dateFrom)
      if (dateTo) params.set('dateTo', dateTo)
      if (statusFilter !== 'ALL') params.set('status', statusFilter)

      const response = await fetch(`/api/ops/invoices?${params.toString()}`)
      if (!response.ok) throw new Error('Failed to fetch invoices')
      const result = await response.json()
      // Normalize API response to match expected shape
      const aging = result.arAgingSummary || result.aging || {}
      const normalized = {
        invoices: result.data || result.invoices || [],
        pagination: result.pagination || { page: 1, limit: 50, total: 0 },
        aging: {
          totalOutstanding: (aging.current || 0) + (aging.days_1_30 || 0) + (aging.days_31_60 || 0) + (aging.days_60_plus || 0),
          current: aging.current || 0,
          days1to30: aging.days_1_30 || 0,
          days31to60: aging.days_31_60 || 0,
          days60plus: aging.days_60_plus || 0,
        },
      }
      setData(normalized)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchInvoices()
  }, [statusFilter, dateFrom, dateTo, sortBy, sortDir, page])

  useEffect(() => {
    fetchCashFlowInsights()
  }, [])

  const toggleSort = (col: string) => {
    if (sortBy === col) {
      setSortDir(prev => prev === 'asc' ? 'desc' : 'asc')
    } else {
      setSortBy(col)
      setSortDir('desc')
    }
    setPage(1)
  }

  const SortIcon = ({ col }: { col: string }) => (
    <span className="ml-1 text-[10px]">{sortBy === col ? (sortDir === 'asc' ? '▲' : '▼') : '⇅'}</span>
  )

  const filteredInvoices = data?.invoices.filter(
    (inv) => statusFilter === 'ALL' || inv.status === statusFilter
  ) || []

  const overdueCoun = data?.invoices.filter((inv) => inv.status === 'OVERDUE').length || 0

  // Only unpaid invoices with a positive balance can be batched. PAID rows
  // and zero-balance rows would just clutter the distribution preview and
  // fail validation server-side.
  const isBatchEligible = (inv: Invoice) =>
    inv.status !== 'PAID' && Number(inv.balanceDue) > 0

  const toggleSelected = (invoiceId: string) => {
    setSelectedInvoices((prev) => {
      const next = new Set(prev)
      if (next.has(invoiceId)) next.delete(invoiceId)
      else next.add(invoiceId)
      return next
    })
  }

  const eligibleInPage = filteredInvoices.filter(isBatchEligible)
  const allEligibleSelected =
    eligibleInPage.length > 0 && eligibleInPage.every((inv) => selectedInvoices.has(inv.id))
  const someEligibleSelected =
    !allEligibleSelected && eligibleInPage.some((inv) => selectedInvoices.has(inv.id))

  const toggleSelectAllVisible = () => {
    setSelectedInvoices((prev) => {
      const next = new Set(prev)
      if (allEligibleSelected) {
        eligibleInPage.forEach((inv) => next.delete(inv.id))
      } else {
        eligibleInPage.forEach((inv) => next.add(inv.id))
      }
      return next
    })
  }

  // Derive the actual selected Invoice records for the modal, plus a total.
  const selectedInvoiceList: BatchInvoice[] = (data?.invoices || [])
    .filter((inv) => selectedInvoices.has(inv.id) && isBatchEligible(inv))
    .map((inv) => ({
      id: inv.id,
      invoiceNumber: inv.invoiceNumber,
      total: Number(inv.total),
      balanceDue: Number(inv.balanceDue),
      dueDate: inv.dueDate,
      builderName: inv.builderName,
    }))
  const selectedBalanceTotal = selectedInvoiceList.reduce(
    (sum, inv) => sum + Number(inv.balanceDue || 0),
    0
  )

  const handleBatchSuccess = () => {
    setSelectedInvoices(new Set())
    setIsBatchModalOpen(false)
    fetchInvoices()
  }

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(value)
  }

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'DRAFT':
        return 'bg-gray-100 text-gray-700'
      case 'ISSUED':
        return 'bg-blue-100 text-blue-700'
      case 'SENT':
        return 'bg-blue-100 text-blue-700'
      case 'OVERDUE':
        return 'bg-red-100 text-red-700'
      case 'PARTIALLY_PAID':
        return 'bg-orange-100 text-orange-700'
      case 'PAID':
        return 'bg-green-100 text-green-700'
      default:
        return 'bg-gray-100 text-gray-700'
    }
  }

  const getBarColor = (amount: number) => {
    if (amount === 0) return '#E5E7EB'
    return '#27AE60'
  }

  const maxAmount = data?.aging
    ? Math.max(data.aging.current, data.aging.days1to30, data.aging.days31to60, data.aging.days60plus)
    : 0

  const getBarHeight = (amount: number) => {
    if (maxAmount === 0) return 4
    return (amount / maxAmount) * 120
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <p className="text-fg-muted">Loading invoices...</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <PageHeader
        title="Invoicing & Accounts Receivable"
        description="Generate invoices, track payments, and manage AR aging"
        actions={
          <>
            <button
              onClick={() => {
                const params = new URLSearchParams()
                params.set('format', 'csv')
                if (statusFilter !== 'ALL') params.set('status', statusFilter)
                if (dateFrom) params.set('dateFrom', dateFrom)
                if (dateTo) params.set('dateTo', dateTo)
                params.set('sortBy', sortBy)
                params.set('sortDir', sortDir)
                window.location.href = `/api/ops/invoices?${params.toString()}`
              }}
              className="px-3 py-1.5 text-sm border border-border rounded-lg hover:bg-row-hover"
            >
              Export CSV
            </button>
            <button
              onClick={() => void 0 /* ECI Bolt import - coming soon */}
              className="px-3 py-1.5 text-sm border border-border rounded-lg hover:bg-row-hover"
            >
              Import from ECI Bolt
            </button>
            <button
              onClick={() => setIsCreateModalOpen(true)}
              className="px-3 py-1.5 text-sm bg-surface-elevated text-white rounded-lg hover:bg-canvas"
            >
              + Create Invoice
            </button>
          </>
        }
      />

      {/* AR summary */}
      {data?.aging && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-4">
          <div className="bg-surface rounded-xl border p-4">
            <p className="text-xs text-fg-muted uppercase">Total Outstanding</p>
            <p className="text-2xl font-semibold text-fg">{formatCurrency(data.aging.totalOutstanding)}</p>
          </div>
          <div className="bg-surface rounded-xl border p-4">
            <p className="text-xs text-fg-muted uppercase">Current</p>
            <p className="text-2xl font-semibold text-[#27AE60]">{formatCurrency(data.aging.current)}</p>
          </div>
          <div className="bg-surface rounded-xl border p-4">
            <p className="text-xs text-fg-muted uppercase">1-30 Days</p>
            <p className="text-2xl font-semibold text-[#D4B96A]">{formatCurrency(data.aging.days1to30)}</p>
          </div>
          <div className="bg-surface rounded-xl border p-4">
            <p className="text-xs text-fg-muted uppercase">31-60 Days</p>
            <p className="text-2xl font-semibold text-signal">{formatCurrency(data.aging.days31to60)}</p>
          </div>
          <div className="bg-surface rounded-xl border p-4">
            <p className="text-xs text-fg-muted uppercase">60+ Days</p>
            <p className="text-2xl font-semibold text-[#E74C3C]">{formatCurrency(data.aging.days60plus)}</p>
          </div>
        </div>
      )}

      {/* AR Aging chart */}
      {data?.aging && (
        <div className="bg-surface rounded-xl border p-5">
          <h3 className="font-semibold text-fg mb-4">AR Aging Summary</h3>
          <div className="h-40 flex items-end gap-4 px-4">
            {[
              { label: 'Current', value: data.aging.current },
              { label: '1-30', value: data.aging.days1to30 },
              { label: '31-60', value: data.aging.days31to60 },
              { label: '60+', value: data.aging.days60plus },
            ].map((bucket) => (
              <div key={bucket.label} className="flex-1 text-center">
                <div className="relative h-32 flex items-end justify-center">
                  <div
                    className="rounded-t"
                    style={{
                      width: '70%',
                      height: `${getBarHeight(bucket.value)}px`,
                      backgroundColor: bucket.value > 0 ? '#27AE60' : '#E5E7EB',
                      minHeight: '4px',
                    }}
                  />
                </div>
                <p className="text-xs text-fg-muted mt-2 font-medium">{bucket.label}</p>
                <p className="text-xs text-fg-muted">{formatCurrency(bucket.value)}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* AI Cash Flow Intelligence Panel */}
      {cashFlowHealth && (
        <div className="bg-gradient-to-r from-surface-elevated to-[#2E86C1] rounded-xl p-5 text-white">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <span className="text-xl">🧠</span>
              <h3 className="font-semibold text-lg">AI Cash Flow Intelligence</h3>
            </div>
            <Link
              href="/ops/cash-flow-optimizer"
              className="px-3 py-1.5 text-xs bg-white/20 hover:bg-white/30 rounded-lg transition-colors"
            >
              Open Command Center →
            </Link>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <div className="bg-white/10 rounded-lg p-3">
              <p className="text-xs text-white/70">Working Capital</p>
              <p className="text-xl font-bold">{formatCurrency(cashFlowHealth.currentPosition?.workingCapital ?? 0)}</p>
            </div>
            <div className="bg-white/10 rounded-lg p-3">
              <p className="text-xs text-white/70">Total AR</p>
              <p className="text-xl font-bold">{formatCurrency(cashFlowHealth.currentPosition?.totalAR ?? 0)}</p>
            </div>
            <div className="bg-white/10 rounded-lg p-3">
              <p className="text-xs text-white/70">DSO</p>
              <p className="text-xl font-bold">{cashFlowHealth.metrics?.dso ?? '—'} <span className="text-sm text-white/60">days</span></p>
            </div>
            <div className="bg-white/10 rounded-lg p-3">
              <p className="text-xs text-white/70">Cash Cycle</p>
              <p className="text-xl font-bold">{cashFlowHealth.metrics?.ccc ?? '—'} <span className="text-sm text-white/60">days</span></p>
            </div>
            <div className="bg-white/10 rounded-lg p-3">
              <p className="text-xs text-white/70">Current Ratio</p>
              <p className="text-xl font-bold">{(cashFlowHealth.metrics?.currentRatio ?? 0).toFixed(2)}<span className="text-sm text-white/60">x</span></p>
            </div>
          </div>
          {cashFlowHealth.recommendations && cashFlowHealth.recommendations.length > 0 && (
            <div className="mt-3 flex gap-2 flex-wrap">
              {cashFlowHealth.recommendations.slice(0, 2).map((rec: any, i: number) => (
                <div key={i} className="flex items-center gap-2 bg-white/10 rounded-lg px-3 py-1.5 text-xs">
                  <span className={rec.priority === 'CRITICAL' ? 'text-red-300' : rec.priority === 'HIGH' ? 'text-orange-300' : 'text-yellow-300'}>●</span>
                  <span className="text-white/90">{rec.description?.slice(0, 80)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* AI Collection Suggestions */}
      {collectionsData?.actions && collectionsData.actions.length > 0 && (
        <div className="bg-surface rounded-xl border border-orange-200 p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <span className="text-lg">📞</span>
              <h3 className="font-semibold text-fg">AI Collection Priorities</h3>
              <span className="px-2 py-0.5 text-xs bg-orange-100 text-orange-700 rounded-full font-medium">
                {collectionsData.actions.length} actions
              </span>
            </div>
            <Link
              href="/ops/cash-flow-optimizer"
              className="text-xs text-fg hover:underline"
            >
              View all in Collections →
            </Link>
          </div>
          <div className="space-y-2">
            {collectionsData.actions.slice(0, 3).map((action: any, i: number) => (
              <div key={i} className="flex items-center gap-3 p-2 rounded-lg bg-surface-muted">
                <div className={`w-2 h-2 rounded-full flex-shrink-0 ${
                  action.urgency === 'CRITICAL' ? 'bg-red-500' :
                  action.urgency === 'HIGH' ? 'bg-orange-500' :
                  action.urgency === 'MEDIUM' ? 'bg-yellow-500' : 'bg-blue-500'
                }`} />
                <span className="text-sm text-fg flex-1">{action.builderName || 'Builder'} — {formatCurrency(action.amountDue || 0)} overdue {action.daysOverdue || 0}d</span>
                <span className="text-xs px-2 py-0.5 bg-blue-50 text-blue-600 rounded font-medium">{action.channel || 'EMAIL'}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Status filter tabs and date range filters */}
      <div className="space-y-4">
        <div className="flex gap-2 border-b pb-2 flex-wrap">
          {INV_STATUSES.map((status) => (
            <button
              key={status.key}
              onClick={() => { setStatusFilter(status.key); setPage(1) }}
              className={`px-3 py-1.5 text-sm rounded-t transition-colors ${
                statusFilter === status.key
                  ? 'bg-surface text-fg font-medium border border-b-0'
                  : 'text-fg-muted hover:text-fg'
              }`}
            >
              {status.label}
              {status.key === 'OVERDUE' && overdueCoun > 0 && (
                <span className="ml-1 bg-red-100 text-red-600 text-xs px-1.5 py-0.5 rounded-full">
                  {overdueCoun}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Date range filters */}
        <div className="flex items-center gap-2 flex-wrap">
          <label className="text-xs text-fg-muted font-medium whitespace-nowrap">From</label>
          <input type="date" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setPage(1) }}
            className="px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-signal/30 focus:border-signal" />
          <label className="text-xs text-fg-muted font-medium whitespace-nowrap">To</label>
          <input type="date" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setPage(1) }}
            className="px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-signal/30 focus:border-signal" />
          {(dateFrom || dateTo) && (
            <button onClick={() => { setDateFrom(''); setDateTo(''); setPage(1) }}
              className="text-xs text-red-500 hover:text-red-700 font-medium">Clear</button>
          )}
        </div>
      </div>

      {/* Invoice table or empty state */}
      {filteredInvoices.length === 0 ? (
        <div className="bg-surface rounded-xl border">
          <EmptyState
            icon={<Receipt className="w-8 h-8 text-fg-subtle" />}
            title="No invoices found"
            description={statusFilter === 'ALL'
              ? 'Invoices are created from completed jobs. You can also import invoices from ECI Bolt or create them manually.'
              : `No invoices with status "${INV_STATUSES.find((s) => s.key === statusFilter)?.label}"`}
            action={statusFilter === 'ALL' ? {
              label: 'Create Invoice',
              onClick: () => setIsCreateModalOpen(true),
            } : undefined}
            secondaryAction={statusFilter === 'ALL' ? {
              label: 'Import from ECI Bolt',
              onClick: () => void 0,
            } : undefined}
            size="full"
          />
        </div>
      ) : (
        <>
        <div className="bg-surface rounded-xl border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-surface-muted border-b">
                <tr>
                  <th className="px-3 py-3 text-left w-10">
                    <input
                      type="checkbox"
                      aria-label="Select all eligible invoices on this page"
                      checked={allEligibleSelected}
                      ref={(el) => {
                        if (el) el.indeterminate = someEligibleSelected
                      }}
                      onChange={toggleSelectAllVisible}
                      disabled={eligibleInPage.length === 0}
                      className="rounded border-border accent-signal"
                    />
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-fg-muted uppercase cursor-pointer hover:bg-row-hover"
                    onClick={() => toggleSort('invoiceNumber')}>
                    Invoice #
                    <SortIcon col="invoiceNumber" />
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-fg-muted uppercase cursor-pointer hover:bg-row-hover"
                    onClick={() => toggleSort('builder')}>
                    Builder
                    <SortIcon col="builder" />
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-fg-muted uppercase cursor-pointer hover:bg-row-hover"
                    onClick={() => toggleSort('jobNumber')}>
                    Job
                    <SortIcon col="jobNumber" />
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-fg-muted uppercase cursor-pointer hover:bg-row-hover"
                    onClick={() => toggleSort('community')}>
                    Community
                    <SortIcon col="community" />
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-fg-muted uppercase cursor-pointer hover:bg-row-hover"
                    onClick={() => toggleSort('total')}>
                    Amount
                    <SortIcon col="total" />
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-fg-muted uppercase cursor-pointer hover:bg-row-hover"
                    onClick={() => toggleSort('dueDate')}>
                    Due Date
                    <SortIcon col="dueDate" />
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-fg-muted uppercase cursor-pointer hover:bg-row-hover"
                    onClick={() => toggleSort('status')}>
                    Status
                    <SortIcon col="status" />
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-fg-muted uppercase cursor-pointer hover:bg-row-hover"
                    onClick={() => toggleSort('balanceDue')}>
                    Balance
                    <SortIcon col="balanceDue" />
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-fg-muted uppercase">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {filteredInvoices.map((invoice) => {
                  const eligible = isBatchEligible(invoice)
                  const checked = selectedInvoices.has(invoice.id)
                  return (
                  <tr key={invoice.id} className={`hover:bg-row-hover ${checked ? 'bg-signal/5' : ''}`}>
                    <td className="px-3 py-4 w-10">
                      {eligible ? (
                        <input
                          type="checkbox"
                          aria-label={`Select invoice ${invoice.invoiceNumber}`}
                          checked={checked}
                          onChange={() => toggleSelected(invoice.id)}
                          className="rounded border-border accent-signal"
                        />
                      ) : (
                        <span className="inline-block w-4 h-4" aria-hidden />
                      )}
                    </td>
                    <td className="px-6 py-4 text-sm font-medium text-fg">
                      <Link href={`/ops/invoices/${invoice.id}`} className="hover:underline">
                        {invoice.invoiceNumber}
                      </Link>
                    </td>
                    <td className="px-6 py-4 text-sm text-fg">{invoice.builderName || 'Unknown'}</td>
                    <td className="px-6 py-4 text-sm text-fg">
                      {invoice.jobId && invoice.jobNumber ? (
                        <Link href={`/ops/jobs/${invoice.jobId}`} className="text-signal hover:underline">
                          {invoice.jobNumber}
                        </Link>
                      ) : (
                        <span className="text-fg-muted">—</span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-sm text-fg">
                      {invoice.community || <span className="text-fg-muted">—</span>}
                    </td>
                    <td className="px-6 py-4 text-sm font-medium text-fg">{formatCurrency(invoice.total)}</td>
                    <td className="px-6 py-4 text-sm text-fg-muted">{invoice.dueDate ? formatDate(invoice.dueDate) : '-'}</td>
                    <td className="px-6 py-4">
                      <Badge variant={getStatusBadgeVariant(invoice.status)} size="sm">
                        {invoice.status.replace(/_/g, ' ')}
                      </Badge>
                    </td>
                    <td className="px-6 py-4 text-sm font-medium text-fg">{formatCurrency(invoice.balanceDue)}</td>
                    <td className="px-6 py-4">
                      {invoice.status !== 'PAID' && invoice.balanceDue > 0 && (
                        <button
                          onClick={() => setPaymentInvoice(invoice)}
                          className="px-3 py-1 text-xs bg-[#27AE60] text-white rounded hover:bg-[#229954] font-medium"
                        >
                          Record Payment
                        </button>
                      )}
                    </td>
                  </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Pagination */}
        {data?.pagination && data.pagination.pages > 1 && (
          <div className="flex items-center justify-between p-4 border-t bg-surface-muted">
            <button
              onClick={() => setPage(prev => Math.max(1, prev - 1))}
              disabled={page === 1}
              className="px-4 py-2 text-sm bg-surface border border-border rounded-lg hover:bg-row-hover disabled:opacity-50 disabled:cursor-not-allowed font-medium"
            >
              Prev
            </button>
            <span className="text-sm text-fg-muted">
              Page {page} of {data.pagination.pages}
            </span>
            <button
              onClick={() => setPage(prev => Math.min(data.pagination.pages, prev + 1))}
              disabled={page === data.pagination.pages}
              className="px-4 py-2 text-sm bg-surface border border-border rounded-lg hover:bg-row-hover disabled:opacity-50 disabled:cursor-not-allowed font-medium"
            >
              Next
            </button>
          </div>
        )}
        </>
      )}

      {/* Payment collection workflow */}
      <div className="bg-surface rounded-xl border p-5">
        <h3 className="font-semibold text-fg mb-3">Payment Collection Workflow</h3>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {[
            { step: '1', label: 'Job Complete', desc: 'PM confirms all work done, photos uploaded, QC passed' },
            { step: '2', label: 'Invoice Generated', desc: 'Auto-generated from job with line items, terms, and due date' },
            { step: '3', label: 'Sent to Builder', desc: 'Email with PDF invoice, payment link, and statement' },
            { step: '4', label: 'Payment Received', desc: 'Record check/ACH/wire payment, update AR aging' },
          ].map((item) => (
            <div key={item.step} className="flex gap-3">
              <div className="w-8 h-8 rounded-full bg-surface-elevated text-white flex items-center justify-center text-sm font-semibold flex-shrink-0">
                {item.step}
              </div>
              <div>
                <p className="text-sm font-medium text-fg">{item.label}</p>
                <p className="text-xs text-fg-muted mt-0.5">{item.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      <CreateInvoiceModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        onSuccess={fetchInvoices}
      />

      <RecordPaymentModal
        isOpen={!!paymentInvoice}
        invoice={paymentInvoice}
        onClose={() => setPaymentInvoice(null)}
        onSuccess={fetchInvoices}
      />

      <BatchPaymentModal
        isOpen={isBatchModalOpen}
        invoices={selectedInvoiceList}
        onClose={() => setIsBatchModalOpen(false)}
        onSuccess={handleBatchSuccess}
      />

      {/* Sticky batch-action bar — appears whenever 1+ invoices are checked.
          Floats above the page footer so Dawn can scroll without losing it. */}
      {selectedInvoiceList.length > 0 && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 panel panel-elevated px-5 py-3 shadow-[0_24px_48px_rgba(0,0,0,0.35)] flex items-center gap-4 bg-surface-elevated text-white">
          <div className="text-sm">
            <span className="font-semibold">{selectedInvoiceList.length}</span> invoice
            {selectedInvoiceList.length === 1 ? '' : 's'} selected
            <span className="px-2 text-white/40">·</span>
            <span className="font-bold tabular-nums">{formatCurrency(selectedBalanceTotal)}</span>
            <span className="text-white/60"> total balance</span>
          </div>
          <button
            onClick={() => setSelectedInvoices(new Set())}
            className="px-3 py-1.5 text-xs rounded-md bg-white/10 hover:bg-white/20 text-white"
          >
            Clear
          </button>
          <button
            onClick={() => setIsBatchModalOpen(true)}
            className="px-4 py-1.5 text-sm rounded-md bg-[#27AE60] hover:bg-[#229954] text-white font-semibold"
          >
            Record Batch Payment
          </button>
        </div>
      )}
    </div>
  )
}
