'use client'

import { useState, useEffect } from 'react'

interface OrderItem {
  id: string
  description: string
  quantity: number
  unitPrice: number
  lineTotal: number
  product?: { name: string; sku: string }
}

interface Order {
  id: string
  orderNumber: string
  status: string
  paymentStatus: string
  subtotal: number
  taxAmount: number
  total: number
  paymentTerm: string
  deliveryDate?: string
  deliveryNotes?: string
  deliveryConfirmedAt?: string
  poNumber?: string
  createdAt: string
  builder?: { id: string; companyName: string; contactName: string; email: string; phone: string }
  items: OrderItem[]
  quote?: { quoteNumber: string; project?: { name: string; jobAddress: string; city: string; state: string } }
  jobs?: { id: string; jobNumber: string; status: string }[]
}

const STATUS_CONFIG: Record<string, { bg: string; text: string; label: string; ring: string }> = {
  RECEIVED:       { bg: 'bg-blue-50',    text: 'text-blue-700',    ring: 'ring-blue-200',    label: 'Received' },
  CONFIRMED:      { bg: 'bg-indigo-50',  text: 'text-indigo-700',  ring: 'ring-indigo-200',  label: 'Confirmed' },
  IN_PRODUCTION:  { bg: 'bg-amber-50',   text: 'text-amber-700',   ring: 'ring-amber-200',   label: 'In Production' },
  READY_TO_SHIP:  { bg: 'bg-emerald-50', text: 'text-emerald-700', ring: 'ring-emerald-200', label: 'Ready to Ship' },
  SHIPPED:        { bg: 'bg-cyan-50',    text: 'text-cyan-700',    ring: 'ring-cyan-200',    label: 'Shipped' },
  DELIVERED:      { bg: 'bg-violet-50',  text: 'text-violet-700',  ring: 'ring-violet-200',  label: 'Delivered' },
  COMPLETE:       { bg: 'bg-green-50',   text: 'text-green-700',   ring: 'ring-green-200',   label: 'Complete' },
}

const PAYMENT_LABELS: Record<string, string> = {
  PAY_AT_ORDER: 'Pay at Order', PAY_ON_DELIVERY: 'Pay on Delivery',
  DUE_ON_RECEIPT: 'Due on Receipt', NET_15: 'Net 15', NET_30: 'Net 30',
}

function fmt(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)
}

export default function OpsOrdersPage() {
  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState('')
  const [search, setSearch] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [sortBy, setSortBy] = useState('createdAt')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [expandedOrder, setExpandedOrder] = useState<string | null>(null)
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [bulkAction, setBulkAction] = useState('')
  const [bulkUpdating, setBulkUpdating] = useState(false)

  // Delivery scheduling modal
  const [scheduleModal, setScheduleModal] = useState<Order | null>(null)
  const [schedDate, setSchedDate] = useState('')
  const [schedNotes, setSchedNotes] = useState('')
  const [saving, setSaving] = useState(false)

  // Generate invoice state
  const [invoiceMsg, setInvoiceMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  useEffect(() => { fetchOrders() }, [statusFilter, search, dateFrom, dateTo, sortBy, sortDir, page])

  async function fetchOrders() {
    try {
      const params = new URLSearchParams()
      if (statusFilter) params.set('status', statusFilter)
      if (search) params.set('search', search)
      if (dateFrom) params.set('dateFrom', dateFrom)
      if (dateTo) params.set('dateTo', dateTo)
      params.set('sortBy', sortBy)
      params.set('sortDir', sortDir)
      params.set('page', String(page))
      params.set('limit', '50')
      const res = await fetch(`/api/ops/orders?${params}`)
      const data = await res.json()
      setOrders(data.data || [])
      setTotal(data.pagination?.total || 0)
    } catch (err) {
      console.error('Failed to fetch orders:', err)
    } finally {
      setLoading(false)
    }
  }

  async function updateOrder(orderId: string, updates: Record<string, any>) {
    setSaving(true)
    try {
      const res = await fetch(`/api/ops/orders/${orderId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      })
      if (res.ok) {
        fetchOrders()
        setScheduleModal(null)
      }
    } catch (err) {
      console.error('Update failed:', err)
    } finally {
      setSaving(false)
    }
  }

  function openScheduleModal(order: Order) {
    setScheduleModal(order)
    setSchedDate(order.deliveryDate ? new Date(order.deliveryDate).toISOString().split('T')[0] : '')
    setSchedNotes(order.deliveryNotes || '')
  }

  async function generateInvoice(orderId: string) {
    setSaving(true)
    setInvoiceMsg(null)
    try {
      const res = await fetch('/api/ops/invoices/from-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId }),
      })
      const data = await res.json()
      if (res.ok) {
        setInvoiceMsg({ type: 'success', text: `Invoice ${data.invoiceNumber} created — ${data.orderNumber}` })
        setTimeout(() => setInvoiceMsg(null), 5000)
      } else if (res.status === 409) {
        setInvoiceMsg({ type: 'error', text: `Invoice ${data.invoiceNumber} already exists for this order` })
        setTimeout(() => setInvoiceMsg(null), 4000)
      } else {
        setInvoiceMsg({ type: 'error', text: data.error || 'Failed to generate invoice' })
        setTimeout(() => setInvoiceMsg(null), 4000)
      }
    } catch (err) {
      setInvoiceMsg({ type: 'error', text: 'Network error generating invoice' })
      setTimeout(() => setInvoiceMsg(null), 4000)
    } finally {
      setSaving(false)
    }
  }

  // Bulk operations
  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  const toggleSelectAll = () => {
    if (selectedIds.size === orders.length) setSelectedIds(new Set())
    else setSelectedIds(new Set(orders.map(o => o.id)))
  }
  const handleBulkUpdate = async () => {
    if (!bulkAction || selectedIds.size === 0) return
    setBulkUpdating(true)
    try {
      const res = await fetch('/api/ops/orders/bulk', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderIds: Array.from(selectedIds),
          status: bulkAction,
        }),
      })
      const data = await res.json()
      if (res.ok) {
        const label = STATUS_CONFIG[bulkAction]?.label || bulkAction
        setInvoiceMsg({
          type: data.failCount > 0 ? 'error' : 'success',
          text: data.failCount > 0
            ? `Updated ${data.successCount} orders to ${label}, ${data.failCount} failed`
            : `Updated ${data.successCount} orders to ${label}`,
        })
      } else {
        setInvoiceMsg({ type: 'error', text: data.error || 'Bulk update failed' })
      }
      setTimeout(() => setInvoiceMsg(null), 4000)
      setSelectedIds(new Set())
      setBulkAction('')
      fetchOrders()
    } catch {
      setInvoiceMsg({ type: 'error', text: 'Bulk update failed' })
      setTimeout(() => setInvoiceMsg(null), 4000)
    } finally {
      setBulkUpdating(false)
    }
  }

  const toggleSort = (col: string) => {
    if (sortBy === col) setSortDir(prev => prev === 'asc' ? 'desc' : 'asc')
    else { setSortBy(col); setSortDir('desc') }
    setPage(1)
  }
  const SortIcon = ({ col }: { col: string }) => (
    <span className="ml-1 text-[10px]">{sortBy === col ? (sortDir === 'asc' ? '▲' : '▼') : '⇅'}</span>
  )

  const statuses = Object.keys(STATUS_CONFIG)
  const received = orders.filter(o => o.status === 'RECEIVED').length
  const inProd = orders.filter(o => o.status === 'IN_PRODUCTION').length
  const readyShip = orders.filter(o => o.status === 'READY_TO_SHIP').length
  const totalValue = orders.reduce((sum, o) => sum + o.total, 0)
  const totalPages = Math.ceil(total / 50)

  return (
    <div className="max-w-[1400px]">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Order Management</h1>
          <p className="text-sm text-gray-500 mt-1">Track orders from receipt through production, shipping, and delivery</p>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Total Orders', value: total || orders.length, color: 'text-[#1B4F72]', icon: '📋' },
          { label: 'Awaiting Confirm', value: received, color: 'text-blue-600', icon: '📥' },
          { label: 'In Production', value: inProd, color: 'text-amber-600', icon: '🏭' },
          { label: 'Pipeline Value', value: fmt(totalValue), color: 'text-emerald-600', icon: '💰' },
        ].map(c => (
          <div key={c.label} className="bg-white rounded-xl border border-gray-200 p-4">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-lg">{c.icon}</span>
              <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide">{c.label}</span>
            </div>
            <p className={`text-2xl font-bold ${c.color}`}>{c.value}</p>
          </div>
        ))}
      </div>

      {/* Invoice generation toast */}
      {invoiceMsg && (
        <div className={`mb-4 px-4 py-3 rounded-lg text-sm font-medium flex items-center gap-2 ${
          invoiceMsg.type === 'success'
            ? 'bg-green-50 text-green-800 border border-green-200'
            : 'bg-red-50 text-red-800 border border-red-200'
        }`}>
          <span>{invoiceMsg.type === 'success' ? '✓' : '!'}</span>
          <span>{invoiceMsg.text}</span>
          <button onClick={() => setInvoiceMsg(null)} className="ml-auto text-lg leading-none opacity-50 hover:opacity-100">&times;</button>
        </div>
      )}

      {/* Bulk action bar */}
      {selectedIds.size > 0 && (
        <div className="mb-4 px-4 py-3 bg-[#1B4F72]/5 border border-[#1B4F72]/20 rounded-lg flex items-center gap-3 flex-wrap">
          <span className="text-sm font-medium text-[#1B4F72]">{selectedIds.size} order{selectedIds.size > 1 ? 's' : ''} selected</span>
          <select value={bulkAction} onChange={(e) => setBulkAction(e.target.value)}
            className="px-3 py-1.5 text-sm border rounded-lg">
            <option value="">Choose action...</option>
            {statuses.map(s => (
              <option key={s} value={s}>Move to {STATUS_CONFIG[s].label}</option>
            ))}
          </select>
          <button onClick={handleBulkUpdate} disabled={!bulkAction || bulkUpdating}
            className="px-3 py-1.5 text-sm bg-[#E67E22] text-white font-medium rounded-lg hover:bg-[#d35400] disabled:opacity-50 transition">
            {bulkUpdating ? 'Updating...' : 'Apply'}
          </button>
          <button onClick={() => setSelectedIds(new Set())}
            className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-800">Clear Selection</button>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-col gap-3 mb-5">
        <div className="flex flex-col sm:flex-row gap-3">
          <input
            type="text"
            placeholder="Search orders, builders, PO numbers..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1) }}
            className="px-4 py-2 border border-gray-300 rounded-lg text-sm w-full sm:w-72 focus:outline-none focus:ring-2 focus:ring-[#1B4F72]/30 focus:border-[#1B4F72]"
          />
          <div className="flex items-center gap-2">
            <label className="text-xs text-gray-500 font-medium whitespace-nowrap">From</label>
            <input type="date" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setPage(1) }}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#1B4F72]/30 focus:border-[#1B4F72]" />
            <label className="text-xs text-gray-500 font-medium whitespace-nowrap">To</label>
            <input type="date" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setPage(1) }}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#1B4F72]/30 focus:border-[#1B4F72]" />
            {(dateFrom || dateTo) && (
              <button onClick={() => { setDateFrom(''); setDateTo(''); setPage(1) }}
                className="text-xs text-red-500 hover:text-red-700 font-medium">Clear</button>
            )}
          </div>
        </div>
        <div className="flex gap-1.5 flex-wrap">
          <button
            onClick={() => setStatusFilter('')}
            className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-all ${
              !statusFilter ? 'bg-[#1B4F72] text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
            }`}
          >
            All
          </button>
          {statuses.map(s => {
            const sc = STATUS_CONFIG[s]
            return (
              <button
                key={s}
                onClick={() => setStatusFilter(s === statusFilter ? '' : s)}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-all ${
                  statusFilter === s
                    ? `${sc.bg} ${sc.text} ring-1 ${sc.ring}`
                    : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                }`}
              >
                {sc.label}
              </button>
            )
          })}
        </div>
      </div>

      {/* Sortable Column Headers */}
      <div className="bg-white rounded-t-xl border border-gray-200 border-b-0 px-5 py-2 flex items-center gap-4 text-[10px] font-bold text-gray-400 uppercase tracking-wider">
        <div className="w-8" />
        <button onClick={() => toggleSort('orderNumber')} className="w-32 text-left hover:text-gray-600 flex items-center">
          Order #<SortIcon col="orderNumber" />
        </button>
        <button onClick={() => toggleSort('status')} className="w-28 text-left hover:text-gray-600 flex items-center">
          Status<SortIcon col="status" />
        </button>
        <button onClick={() => toggleSort('builder')} className="flex-1 text-left hover:text-gray-600 flex items-center">
          Builder<SortIcon col="builder" />
        </button>
        <button onClick={() => toggleSort('total')} className="w-28 text-right hover:text-gray-600 flex items-center justify-end">
          Total<SortIcon col="total" />
        </button>
        <button onClick={() => toggleSort('createdAt')} className="w-28 text-right hover:text-gray-600 flex items-center justify-end">
          Date<SortIcon col="createdAt" />
        </button>
      </div>

      {/* Orders List */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="w-8 h-8 border-4 border-[#1B4F72] border-t-transparent rounded-full animate-spin" />
        </div>
      ) : orders.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-xl border border-gray-200">
          <p className="text-lg text-gray-500 mb-2">No orders found</p>
          <p className="text-sm text-gray-400">Orders are created when approved quotes are converted</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {/* Select all */}
          <div className="flex items-center gap-2 px-1">
            <input type="checkbox" checked={selectedIds.size === orders.length && orders.length > 0}
              onChange={toggleSelectAll} className="w-4 h-4 rounded border-gray-300" />
            <span className="text-xs text-gray-500">Select all ({orders.length})</span>
          </div>
          {orders.map(order => {
            const isExpanded = expandedOrder === order.id
            const sc = STATUS_CONFIG[order.status] || STATUS_CONFIG.RECEIVED
            const project = order.quote?.project

            return (
              <div key={order.id} className={`bg-white rounded-xl border overflow-hidden hover:shadow-sm transition-shadow ${selectedIds.has(order.id) ? 'border-[#E67E22] ring-1 ring-[#E67E22]/30' : 'border-gray-200'}`}>
                {/* Header Row */}
                <div
                  className="px-5 py-4 cursor-pointer flex items-center justify-between gap-4"
                >
                  <div className="flex items-center gap-4 min-w-0">
                    <input type="checkbox" checked={selectedIds.has(order.id)}
                      onChange={() => toggleSelect(order.id)} onClick={(e) => e.stopPropagation()}
                      className="w-4 h-4 rounded border-gray-300 flex-shrink-0" />
                    <div className="min-w-0 flex-1 cursor-pointer" onClick={() => setExpandedOrder(isExpanded ? null : order.id)}>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-bold text-[#1B4F72] font-mono">{order.orderNumber}</span>
                        <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-semibold ${sc.bg} ${sc.text}`}>
                          {sc.label}
                        </span>
                        {order.quote && (
                          <span className="text-[11px] text-gray-400">from {order.quote.quoteNumber}</span>
                        )}
                        {order.deliveryDate && (
                          <span className="text-[11px] text-gray-400 hidden sm:inline">
                            📅 {new Date(order.deliveryDate).toLocaleDateString()}
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-gray-600 mt-1 truncate">
                        {order.builder?.companyName || 'Unknown'}
                        {project?.name && <span className="text-gray-400"> — {project.name}</span>}
                        {order.poNumber && <span className="text-gray-400 ml-2">PO: {order.poNumber}</span>}
                      </p>
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-lg font-bold text-gray-900">{fmt(order.total)}</p>
                    <p className="text-[11px] text-gray-400">
                      {PAYMENT_LABELS[order.paymentTerm] || order.paymentTerm} · {new Date(order.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                </div>

                {/* Expanded Detail */}
                {isExpanded && (
                  <div className="border-t border-gray-100 px-5 py-4">
                    {/* Info Grid */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-5">
                      {/* Builder Info */}
                      <div className="bg-gray-50 rounded-lg p-3">
                        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">Builder</p>
                        <p className="text-sm font-medium text-gray-900">{order.builder?.companyName}</p>
                        <p className="text-xs text-gray-500">{order.builder?.contactName}</p>
                        {order.builder?.email && <p className="text-xs text-gray-400 mt-1">{order.builder.email}</p>}
                        {order.builder?.phone && <p className="text-xs text-gray-400">{order.builder.phone}</p>}
                      </div>

                      {/* Project/Delivery Info */}
                      <div className="bg-gray-50 rounded-lg p-3">
                        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">Project & Delivery</p>
                        {project?.name && <p className="text-sm font-medium text-gray-900">{project.name}</p>}
                        {project?.jobAddress && (
                          <p className="text-xs text-gray-500">{project.jobAddress}, {project.city} {project.state}</p>
                        )}
                        {order.deliveryDate ? (
                          <p className="text-xs text-emerald-600 font-medium mt-1">
                            📅 Scheduled: {new Date(order.deliveryDate).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                          </p>
                        ) : (
                          <p className="text-xs text-amber-600 mt-1">No delivery date scheduled</p>
                        )}
                        {order.deliveryNotes && <p className="text-xs text-gray-400 mt-1 italic">{order.deliveryNotes}</p>}
                        {order.deliveryConfirmedAt && (
                          <p className="text-xs text-green-600 font-semibold mt-1">
                            ✓ Delivered {new Date(order.deliveryConfirmedAt).toLocaleDateString()}
                          </p>
                        )}
                      </div>

                      {/* Payment Info */}
                      <div className="bg-gray-50 rounded-lg p-3">
                        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">Payment</p>
                        <p className="text-sm font-medium text-gray-900">{fmt(order.total)}</p>
                        <p className="text-xs text-gray-500">{PAYMENT_LABELS[order.paymentTerm] || order.paymentTerm}</p>
                        <div className="mt-1">
                          <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-semibold ${
                            order.paymentStatus === 'PAID' ? 'bg-green-100 text-green-700'
                            : order.paymentStatus === 'PARTIAL' ? 'bg-amber-100 text-amber-700'
                            : 'bg-gray-100 text-gray-600'
                          }`}>
                            {order.paymentStatus || 'PENDING'}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Line Items */}
                    <div className="border border-gray-200 rounded-lg overflow-hidden mb-4">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="bg-gray-50 border-b border-gray-200">
                            <th className="text-left px-4 py-2 text-[10px] font-bold text-gray-400 uppercase">Item</th>
                            <th className="text-right px-4 py-2 text-[10px] font-bold text-gray-400 uppercase">Qty</th>
                            <th className="text-right px-4 py-2 text-[10px] font-bold text-gray-400 uppercase hidden sm:table-cell">Unit</th>
                            <th className="text-right px-4 py-2 text-[10px] font-bold text-gray-400 uppercase">Total</th>
                          </tr>
                        </thead>
                        <tbody>
                          {order.items.slice(0, 10).map(item => (
                            <tr key={item.id} className="border-b border-gray-50">
                              <td className="px-4 py-2 text-gray-700">
                                {item.description}
                                {item.product?.sku && <span className="text-gray-400 ml-2 text-xs">{item.product.sku}</span>}
                              </td>
                              <td className="px-4 py-2 text-right text-gray-600">{item.quantity}</td>
                              <td className="px-4 py-2 text-right text-gray-600 hidden sm:table-cell">{fmt(item.unitPrice)}</td>
                              <td className="px-4 py-2 text-right font-medium text-gray-900">{fmt(item.lineTotal)}</td>
                            </tr>
                          ))}
                          {order.items.length > 10 && (
                            <tr>
                              <td colSpan={4} className="px-4 py-2 text-center text-xs text-gray-400">
                                + {order.items.length - 10} more items
                              </td>
                            </tr>
                          )}
                        </tbody>
                        <tfoot>
                          <tr className="border-t-2 border-gray-200 bg-gray-50">
                            <td colSpan={3} className="px-4 py-2 text-right font-bold text-gray-700">Total</td>
                            <td className="px-4 py-2 text-right font-bold text-[#1B4F72] text-base">{fmt(order.total)}</td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>

                    {/* Linked Jobs */}
                    {order.jobs && order.jobs.length > 0 && (
                      <div className="bg-green-50 border border-green-200 rounded-lg p-3 mb-4">
                        <p className="text-[10px] font-bold text-green-600 uppercase tracking-wider mb-1">Linked Jobs</p>
                        {order.jobs.map(job => (
                          <p key={job.id} className="text-sm text-gray-700">
                            {job.jobNumber} — <span className="text-green-600 font-medium">{job.status}</span>
                          </p>
                        ))}
                      </div>
                    )}

                    {/* Actions Bar */}
                    <div className="flex flex-wrap gap-2 pt-3 border-t border-gray-100">
                      {/* Schedule Delivery — always available */}
                      <button
                        onClick={() => openScheduleModal(order)}
                        className="px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50 transition-colors"
                      >
                        📅 Schedule Delivery
                      </button>

                      {/* Status progression buttons */}
                      {order.status === 'RECEIVED' && (
                        <button onClick={() => updateOrder(order.id, { status: 'CONFIRMED' })}
                          className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-semibold hover:bg-indigo-700 transition-colors">
                          ✅ Confirm Order
                        </button>
                      )}
                      {order.status === 'CONFIRMED' && (
                        <button onClick={() => updateOrder(order.id, { status: 'IN_PRODUCTION' })}
                          className="px-4 py-2 bg-amber-600 text-white rounded-lg text-sm font-semibold hover:bg-amber-700 transition-colors">
                          🏭 Start Production
                        </button>
                      )}
                      {order.status === 'IN_PRODUCTION' && (
                        <button onClick={() => updateOrder(order.id, { status: 'READY_TO_SHIP' })}
                          className="px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-semibold hover:bg-emerald-700 transition-colors">
                          📦 Mark Ready to Ship
                        </button>
                      )}
                      {order.status === 'READY_TO_SHIP' && (
                        <button onClick={() => updateOrder(order.id, { status: 'SHIPPED' })}
                          className="px-4 py-2 bg-cyan-600 text-white rounded-lg text-sm font-semibold hover:bg-cyan-700 transition-colors">
                          🚚 Mark Shipped
                        </button>
                      )}
                      {order.status === 'SHIPPED' && (
                        <button onClick={() => updateOrder(order.id, { status: 'DELIVERED', confirmDelivery: true })}
                          className="px-4 py-2 bg-violet-600 text-white rounded-lg text-sm font-semibold hover:bg-violet-700 transition-colors">
                          🏠 Confirm Delivery
                        </button>
                      )}
                      {order.status === 'DELIVERED' && (
                        <button onClick={() => updateOrder(order.id, { status: 'COMPLETE' })}
                          className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-semibold hover:bg-green-700 transition-colors">
                          ✓ Mark Complete
                        </button>
                      )}

                      {/* Generate Invoice */}
                      {['CONFIRMED', 'IN_PRODUCTION', 'READY_TO_SHIP', 'SHIPPED', 'DELIVERED', 'COMPLETE'].includes(order.status) && (
                        <button
                          onClick={() => generateInvoice(order.id)}
                          disabled={saving}
                          className="px-4 py-2 bg-white border border-[#1B4F72] text-[#1B4F72] rounded-lg text-sm font-medium hover:bg-blue-50 transition-colors disabled:opacity-50"
                        >
                          🧾 Generate Invoice
                        </button>
                      )}

                      {/* Payment actions */}
                      {order.paymentStatus !== 'PAID' && (
                        <button onClick={() => updateOrder(order.id, { paymentStatus: 'PAID' })}
                          className="px-4 py-2 bg-white border border-green-300 text-green-700 rounded-lg text-sm font-medium hover:bg-green-50 transition-colors ml-auto">
                          💵 Mark Paid
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4 px-1">
          <p className="text-sm text-gray-500">
            Showing {((page - 1) * 50) + 1}–{Math.min(page * 50, total)} of {total} orders
          </p>
          <div className="flex items-center gap-2">
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
              className="px-3 py-1.5 text-sm border rounded-lg disabled:opacity-40 hover:bg-gray-50">← Prev</button>
            <span className="text-sm text-gray-600">Page {page} of {totalPages}</span>
            <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
              className="px-3 py-1.5 text-sm border rounded-lg disabled:opacity-40 hover:bg-gray-50">Next →</button>
          </div>
        </div>
      )}

      {/* Delivery Scheduling Modal */}
      {scheduleModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4"
          onClick={() => setScheduleModal(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md" onClick={e => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-gray-100">
              <h3 className="text-lg font-bold text-gray-900">Schedule Delivery</h3>
              <p className="text-sm text-gray-500 mt-0.5">{scheduleModal.orderNumber} — {scheduleModal.builder?.companyName}</p>
            </div>
            <div className="px-6 py-5 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Delivery Date</label>
                <input
                  type="date"
                  value={schedDate}
                  onChange={e => setSchedDate(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#1B4F72]/30 focus:border-[#1B4F72]"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Delivery Notes</label>
                <textarea
                  value={schedNotes}
                  onChange={e => setSchedNotes(e.target.value)}
                  placeholder="Gate code, contact on site, special instructions..."
                  rows={3}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#1B4F72]/30 focus:border-[#1B4F72] resize-none"
                />
              </div>
              {scheduleModal.quote?.project?.jobAddress && (
                <div className="bg-gray-50 rounded-lg p-3">
                  <p className="text-[10px] font-bold text-gray-400 uppercase">Delivery Address</p>
                  <p className="text-sm text-gray-700 mt-1">
                    {scheduleModal.quote.project.jobAddress}, {scheduleModal.quote.project.city} {scheduleModal.quote.project.state}
                  </p>
                </div>
              )}
            </div>
            <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-3">
              <button
                onClick={() => setScheduleModal(null)}
                className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-800"
              >
                Cancel
              </button>
              <button
                onClick={() => updateOrder(scheduleModal.id, {
                  deliveryDate: schedDate || null,
                  deliveryNotes: schedNotes || null,
                })}
                disabled={saving}
                className="px-5 py-2 bg-[#1B4F72] text-white rounded-lg text-sm font-semibold hover:bg-[#163d5a] transition-colors disabled:opacity-50"
              >
                {saving ? 'Saving...' : 'Save Schedule'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
