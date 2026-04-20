'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { CreateInvoiceModal } from '../components/CreateInvoiceModal'
import { RecordPaymentModal } from '../components/RecordPaymentModal'

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
        <p className="text-gray-500">Loading invoices...</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Invoicing & Accounts Receivable</h1>
          <p className="text-sm text-gray-500 mt-1">
            Generate invoices, track payments, and manage AR aging
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => void 0 /* ECI Bolt import - coming soon */}
            className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50"
          >
            Import from ECI Bolt
          </button>
          <button
            onClick={() => setIsCreateModalOpen(true)}
            className="px-3 py-1.5 text-sm bg-[#3E2A1E] text-white rounded-lg hover:bg-[#2A1C14]"
          >
            + Create Invoice
          </button>
        </div>
      </div>

      {/* AR summary */}
      {data?.aging && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-4">
          <div className="bg-white rounded-xl border p-4">
            <p className="text-xs text-gray-500 uppercase">Total Outstanding</p>
            <p className="text-2xl font-bold text-gray-900">{formatCurrency(data.aging.totalOutstanding)}</p>
          </div>
          <div className="bg-white rounded-xl border p-4">
            <p className="text-xs text-gray-500 uppercase">Current</p>
            <p className="text-2xl font-bold text-[#27AE60]">{formatCurrency(data.aging.current)}</p>
          </div>
          <div className="bg-white rounded-xl border p-4">
            <p className="text-xs text-gray-500 uppercase">1-30 Days</p>
            <p className="text-2xl font-bold text-[#D9993F]">{formatCurrency(data.aging.days1to30)}</p>
          </div>
          <div className="bg-white rounded-xl border p-4">
            <p className="text-xs text-gray-500 uppercase">31-60 Days</p>
            <p className="text-2xl font-bold text-[#C9822B]">{formatCurrency(data.aging.days31to60)}</p>
          </div>
          <div className="bg-white rounded-xl border p-4">
            <p className="text-xs text-gray-500 uppercase">60+ Days</p>
            <p className="text-2xl font-bold text-[#E74C3C]">{formatCurrency(data.aging.days60plus)}</p>
          </div>
        </div>
      )}

      {/* AR Aging chart */}
      {data?.aging && (
        <div className="bg-white rounded-xl border p-5">
          <h3 className="font-semibold text-gray-900 mb-4">AR Aging Summary</h3>
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
                <p className="text-xs text-gray-600 mt-2 font-medium">{bucket.label}</p>
                <p className="text-xs text-gray-500">{formatCurrency(bucket.value)}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* AI Cash Flow Intelligence Panel */}
      {cashFlowHealth && (
        <div className="bg-gradient-to-r from-[#3E2A1E] to-[#2E86C1] rounded-xl p-5 text-white">
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
        <div className="bg-white rounded-xl border border-orange-200 p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <span className="text-lg">📞</span>
              <h3 className="font-semibold text-gray-900">AI Collection Priorities</h3>
              <span className="px-2 py-0.5 text-xs bg-orange-100 text-orange-700 rounded-full font-medium">
                {collectionsData.actions.length} actions
              </span>
            </div>
            <Link
              href="/ops/cash-flow-optimizer"
              className="text-xs text-[#3E2A1E] hover:underline"
            >
              View all in Collections →
            </Link>
          </div>
          <div className="space-y-2">
            {collectionsData.actions.slice(0, 3).map((action: any, i: number) => (
              <div key={i} className="flex items-center gap-3 p-2 rounded-lg bg-gray-50">
                <div className={`w-2 h-2 rounded-full flex-shrink-0 ${
                  action.urgency === 'CRITICAL' ? 'bg-red-500' :
                  action.urgency === 'HIGH' ? 'bg-orange-500' :
                  action.urgency === 'MEDIUM' ? 'bg-yellow-500' : 'bg-blue-500'
                }`} />
                <span className="text-sm text-gray-700 flex-1">{action.builderName || 'Builder'} — {formatCurrency(action.amountDue || 0)} overdue {action.daysOverdue || 0}d</span>
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
                  ? 'bg-white text-[#3E2A1E] font-medium border border-b-0'
                  : 'text-gray-500 hover:text-gray-700'
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
          <label className="text-xs text-gray-500 font-medium whitespace-nowrap">From</label>
          <input type="date" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setPage(1) }}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#3E2A1E]/30 focus:border-[#3E2A1E]" />
          <label className="text-xs text-gray-500 font-medium whitespace-nowrap">To</label>
          <input type="date" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setPage(1) }}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#3E2A1E]/30 focus:border-[#3E2A1E]" />
          {(dateFrom || dateTo) && (
            <button onClick={() => { setDateFrom(''); setDateTo(''); setPage(1) }}
              className="text-xs text-red-500 hover:text-red-700 font-medium">Clear</button>
          )}
        </div>
      </div>

      {/* Invoice table or empty state */}
      {filteredInvoices.length === 0 ? (
        <div className="bg-white rounded-xl border p-12 text-center">
          <p className="text-4xl mb-3">💰</p>
          <p className="font-medium text-gray-600">No invoices found</p>
          <p className="text-sm text-gray-400 mt-2 max-w-md mx-auto">
            {statusFilter === 'ALL'
              ? 'Invoices are created from completed jobs. You can also import invoices from ECI Bolt or create them manually.'
              : `No invoices with status "${INV_STATUSES.find((s) => s.key === statusFilter)?.label}"`}
          </p>
          {statusFilter === 'ALL' && (
            <div className="flex gap-3 justify-center mt-6">
              <button
                onClick={() => setIsCreateModalOpen(true)}
                className="px-4 py-2 text-sm bg-[#3E2A1E] text-white rounded-lg hover:bg-[#2A1C14]"
              >
                Create Invoice
              </button>
              <button
                onClick={() => void 0 /* ECI Bolt import - coming soon */}
                className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                Import from ECI Bolt
              </button>
            </div>
          )}
        </div>
      ) : (
        <>
        <div className="bg-white rounded-xl border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase cursor-pointer hover:bg-gray-100"
                    onClick={() => toggleSort('invoiceNumber')}>
                    Invoice #
                    <SortIcon col="invoiceNumber" />
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase cursor-pointer hover:bg-gray-100"
                    onClick={() => toggleSort('builder')}>
                    Builder
                    <SortIcon col="builder" />
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase cursor-pointer hover:bg-gray-100"
                    onClick={() => toggleSort('total')}>
                    Amount
                    <SortIcon col="total" />
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase cursor-pointer hover:bg-gray-100"
                    onClick={() => toggleSort('dueDate')}>
                    Due Date
                    <SortIcon col="dueDate" />
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase cursor-pointer hover:bg-gray-100"
                    onClick={() => toggleSort('status')}>
                    Status
                    <SortIcon col="status" />
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase cursor-pointer hover:bg-gray-100"
                    onClick={() => toggleSort('balanceDue')}>
                    Balance
                    <SortIcon col="balanceDue" />
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {filteredInvoices.map((invoice) => (
                  <tr key={invoice.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 text-sm font-medium text-[#3E2A1E]">{invoice.invoiceNumber}</td>
                    <td className="px-6 py-4 text-sm text-gray-900">{invoice.builderName || 'Unknown'}</td>
                    <td className="px-6 py-4 text-sm font-medium text-gray-900">{formatCurrency(invoice.total)}</td>
                    <td className="px-6 py-4 text-sm text-gray-500">{invoice.dueDate ? formatDate(invoice.dueDate) : '-'}</td>
                    <td className="px-6 py-4">
                      <span className={`px-2 py-1 text-xs font-medium rounded ${getStatusColor(invoice.status)}`}>
                        {invoice.status.replace(/_/g, ' ')}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm font-medium text-gray-900">{formatCurrency(invoice.balanceDue)}</td>
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
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Pagination */}
        {data?.pagination && data.pagination.pages > 1 && (
          <div className="flex items-center justify-between p-4 border-t bg-gray-50">
            <button
              onClick={() => setPage(prev => Math.max(1, prev - 1))}
              disabled={page === 1}
              className="px-4 py-2 text-sm bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed font-medium"
            >
              Prev
            </button>
            <span className="text-sm text-gray-600">
              Page {page} of {data.pagination.pages}
            </span>
            <button
              onClick={() => setPage(prev => Math.min(data.pagination.pages, prev + 1))}
              disabled={page === data.pagination.pages}
              className="px-4 py-2 text-sm bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed font-medium"
            >
              Next
            </button>
          </div>
        )}
        </>
      )}

      {/* Payment collection workflow */}
      <div className="bg-white rounded-xl border p-5">
        <h3 className="font-semibold text-gray-900 mb-3">Payment Collection Workflow</h3>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {[
            { step: '1', label: 'Job Complete', desc: 'PM confirms all work done, photos uploaded, QC passed' },
            { step: '2', label: 'Invoice Generated', desc: 'Auto-generated from job with line items, terms, and due date' },
            { step: '3', label: 'Sent to Builder', desc: 'Email with PDF invoice, payment link, and statement' },
            { step: '4', label: 'Payment Received', desc: 'Record check/ACH/wire payment, update AR aging' },
          ].map((item) => (
            <div key={item.step} className="flex gap-3">
              <div className="w-8 h-8 rounded-full bg-[#3E2A1E] text-white flex items-center justify-center text-sm font-bold flex-shrink-0">
                {item.step}
              </div>
              <div>
                <p className="text-sm font-medium text-gray-900">{item.label}</p>
                <p className="text-xs text-gray-500 mt-0.5">{item.desc}</p>
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
    </div>
  )
}
