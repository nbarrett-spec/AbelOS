'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import {
  Search, Calendar, FileText, Inbox, Factory, Package, DollarSign,
  Truck, CheckCircle, ChevronDown, ChevronUp, X, Receipt, CreditCard,
  ShoppingCart, Download
} from 'lucide-react'
import { PageHeader, KPICard, StatusBadge, Badge } from '@/components/ui'
import EmptyState from '@/components/ui/EmptyState'
import { cn } from '@/lib/utils'

type DoorMaterial = 'WOOD' | 'FIBERGLASS' | 'METAL'

interface OrderItem {
  id: string
  description: string
  quantity: number
  unitPrice: number
  lineTotal: number
  productId?: string | null
  // Strike-type flag for dunnage / Final Front items. Drives whether
  // production cuts a wood-bore or fiberglass/metal strike. Captured at
  // order entry; required for those categories at the form layer.
  doorMaterial?: DoorMaterial | null
  product?: { id?: string; name: string; sku: string; category?: string; subcategory?: string } | null
}

// Categories where the door slab material drives strike type and the
// dropdown becomes a hard requirement. Keep in sync with
// src/lib/product-categories.ts (Specialty Doors → Dunnage Doors).
function needsDoorMaterial(item: OrderItem): boolean {
  const cat = (item.product?.category || '').toLowerCase()
  const sub = (item.product?.subcategory || '').toLowerCase()
  const desc = (item.description || '').toLowerCase()
  // Dunnage doors (Specialty Doors > Dunnage Doors)
  if (sub.includes('dunnage') || desc.includes('dunnage')) return true
  // Final Front items — flagged by description token "final front" / "FF"
  if (desc.includes('final front') || /\bff\b/i.test(item.description || '')) return true
  // Exterior front-entry doors are the canonical "final front" target
  // and benefit from the same strike-type call-out.
  if (cat === 'exterior doors') return true
  return false
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
  /** True if at least one OrderItem links to a Product that is the parent of any BomEntry — i.e. order routes through manufacturing. */
  hasBomItems?: boolean
}

// Status label map (semantic Badge handles the color)
const STATUS_LABEL: Record<string, string> = {
  RECEIVED:      'Received',
  CONFIRMED:     'Confirmed',
  IN_PRODUCTION: 'In Production',
  READY_TO_SHIP: 'Ready to Ship',
  SHIPPED:       'Shipped',
  DELIVERED:     'Delivered',
  COMPLETE:      'Complete',
}
const STATUS_CONFIG: Record<string, { label: string }> = Object.fromEntries(
  Object.entries(STATUS_LABEL).map(([k, label]) => [k, { label }])
)

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
  const [pmFilter, setPmFilter] = useState<string>('')
  const [pms, setPms] = useState<{ id: string; firstName: string; lastName: string }[]>([])
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

  useEffect(() => { fetchOrders() }, [statusFilter, search, dateFrom, dateTo, pmFilter, sortBy, sortDir, page])

  // Load PM roster for filter dropdown — non-blocking; on failure, leave empty.
  useEffect(() => {
    fetch('/api/ops/pm/roster')
      .then(r => r.json())
      .then(d => setPms(d.pms || d.data || []))
      .catch(() => {})
  }, [])

  async function fetchOrders() {
    try {
      const params = new URLSearchParams()
      if (statusFilter) params.set('status', statusFilter)
      if (search) params.set('search', search)
      if (dateFrom) params.set('dateFrom', dateFrom)
      if (dateTo) params.set('dateTo', dateTo)
      if (pmFilter) params.set('pmId', pmFilter)
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

  function exportCsv() {
    const params = new URLSearchParams()
    params.set('format', 'csv')
    if (statusFilter) params.set('status', statusFilter)
    if (search) params.set('search', search)
    if (dateFrom) params.set('dateFrom', dateFrom)
    if (dateTo) params.set('dateTo', dateTo)
    if (pmFilter) params.set('pmId', pmFilter)
    window.location.href = `/api/ops/orders?${params.toString()}`
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

  // Update a single OrderItem (currently used to set door material /
  // strike type on dunnage / Final Front lines). Optimistic update —
  // if the PATCH fails the row is re-fetched on next list load.
  async function updateOrderItem(orderId: string, itemId: string, updates: Record<string, any>) {
    setOrders(prev => prev.map(o => o.id !== orderId ? o : ({
      ...o,
      items: o.items.map(it => it.id === itemId ? { ...it, ...updates } : it),
    })))
    try {
      const res = await fetch(`/api/ops/orders/${orderId}/items/${itemId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      })
      if (!res.ok) {
        // Re-fetch on failure so the UI shows the canonical server state.
        fetchOrders()
      }
    } catch (err) {
      console.error('Update order item failed:', err)
      fetchOrders()
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
    <span className={cn('ml-1 text-[9px]', sortBy === col ? 'text-accent' : 'text-fg-subtle/50')}>
      {sortBy === col ? (sortDir === 'asc' ? '▲' : '▼') : '◇'}
    </span>
  )

  const statuses = Object.keys(STATUS_CONFIG)
  const received = orders.filter(o => o.status === 'RECEIVED').length
  const inProd = orders.filter(o => o.status === 'IN_PRODUCTION').length
  const readyShip = orders.filter(o => o.status === 'READY_TO_SHIP').length
  const totalValue = orders.reduce((sum, o) => sum + o.total, 0)
  const totalPages = Math.ceil(total / 50)

  return (
    <div className="max-w-[1400px] animate-enter">
      <PageHeader
        eyebrow="Operations"
        title="Orders"
        description="Track orders from receipt through production, shipping, and delivery."
        crumbs={[{ label: 'Operations', href: '/ops' }, { label: 'Orders' }]}
      />

      {/* KPI strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <KPICard
          title="Total Orders"
          value={new Intl.NumberFormat('en-US').format(total || orders.length)}
          accent="brand"
          icon={<FileText className="w-3.5 h-3.5" />}
          subtitle="All statuses"
        />
        <KPICard
          title="Awaiting Confirm"
          value={received}
          accent="forecast"
          icon={<Inbox className="w-3.5 h-3.5" />}
          subtitle="Needs review"
        />
        <KPICard
          title="In Production"
          value={inProd}
          accent="accent"
          icon={<Factory className="w-3.5 h-3.5" />}
          subtitle="Active builds"
        />
        <KPICard
          title="Pipeline Value"
          value={fmt(totalValue)}
          accent="positive"
          icon={<DollarSign className="w-3.5 h-3.5" />}
          subtitle={`${orders.length} on page`}
        />
      </div>

      {/* Toast */}
      {invoiceMsg && (
        <div className={cn(
          'mb-4 px-4 py-2.5 rounded-md text-sm font-medium flex items-center gap-2 border',
          invoiceMsg.type === 'success'
            ? 'bg-data-positive-bg text-data-positive-fg border-transparent'
            : 'bg-data-negative-bg text-data-negative-fg border-transparent'
        )}>
          {invoiceMsg.type === 'success'
            ? <CheckCircle className="w-4 h-4 shrink-0" />
            : <X className="w-4 h-4 shrink-0" />}
          <span>{invoiceMsg.text}</span>
          <button onClick={() => setInvoiceMsg(null)} className="ml-auto opacity-60 hover:opacity-100">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Bulk action bar */}
      {selectedIds.size > 0 && (
        <div className="mb-4 panel panel-live px-4 py-2.5 flex items-center gap-3 flex-wrap">
          <span className="text-sm font-medium text-fg">
            <span className="font-numeric tabular-nums text-accent">{selectedIds.size}</span> order{selectedIds.size > 1 ? 's' : ''} selected
          </span>
          <div className="h-4 w-px bg-border" />
          <select value={bulkAction} onChange={(e) => setBulkAction(e.target.value)} className="input" style={{ width: 'auto', height: 32 }}>
            <option value="">Choose action…</option>
            {statuses.map(s => (
              <option key={s} value={s}>Move to {STATUS_CONFIG[s].label}</option>
            ))}
          </select>
          <button onClick={handleBulkUpdate} disabled={!bulkAction || bulkUpdating} className="btn btn-primary btn-sm">
            {bulkUpdating ? 'Updating…' : 'Apply'}
          </button>
          <button onClick={() => setSelectedIds(new Set())} className="btn btn-ghost btn-sm">
            Clear
          </button>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-col gap-3 mb-4">
        <div className="flex flex-col sm:flex-row gap-2">
          <div className="relative w-full sm:w-80">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-fg-subtle pointer-events-none" />
            <input
              type="text"
              placeholder="Search orders, builders, PO numbers…"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1) }}
              className="input pl-9"
            />
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Calendar className="w-3.5 h-3.5 text-fg-subtle" />
            <input type="date" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setPage(1) }}
              className="input font-numeric" style={{ width: 'auto' }} />
            <span className="text-xs text-fg-subtle">→</span>
            <input type="date" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setPage(1) }}
              className="input font-numeric" style={{ width: 'auto' }} />
            {(dateFrom || dateTo) && (
              <button onClick={() => { setDateFrom(''); setDateTo(''); setPage(1) }} className="btn btn-ghost btn-sm text-data-negative">
                <X className="w-3 h-3" /> Clear
              </button>
            )}
            <select
              value={pmFilter}
              onChange={(e) => { setPmFilter(e.target.value); setPage(1) }}
              className="input"
              style={{ width: 'auto' }}
              aria-label="Filter by PM"
            >
              <option value="">All PMs</option>
              {pms.map(pm => (
                <option key={pm.id} value={pm.id}>
                  {pm.firstName} {pm.lastName}
                </option>
              ))}
            </select>
            <button onClick={exportCsv} className="btn btn-secondary btn-sm ml-auto">
              <Download className="w-3.5 h-3.5" /> Export CSV
            </button>
          </div>
        </div>
        <div className="flex gap-1 flex-wrap">
          <button
            onClick={() => setStatusFilter('')}
            className={cn(
              'px-2.5 py-1 rounded-sm text-[11px] font-semibold uppercase tracking-wide transition-colors border',
              !statusFilter
                ? 'bg-accent text-fg-on-accent border-transparent'
                : 'bg-surface text-fg-muted border-border hover:border-border-strong hover:text-fg'
            )}
          >
            All
          </button>
          {statuses.map(s => (
            <button
              key={s}
              onClick={() => setStatusFilter(s === statusFilter ? '' : s)}
              className={cn(
                'px-2.5 py-1 rounded-sm text-[11px] font-semibold uppercase tracking-wide transition-colors border',
                statusFilter === s
                  ? 'bg-accent text-fg-on-accent border-transparent'
                  : 'bg-surface text-fg-muted border-border hover:border-border-strong hover:text-fg'
              )}
            >
              {STATUS_CONFIG[s].label}
            </button>
          ))}
        </div>
      </div>

      {/* Sortable Column Headers */}
      <div className="panel border-b-0 rounded-b-none px-5 py-2 flex items-center gap-4 eyebrow">
        <div className="w-8" />
        <button onClick={() => toggleSort('orderNumber')} className="w-32 text-left hover:text-fg flex items-center transition-colors">
          Order #<SortIcon col="orderNumber" />
        </button>
        <button onClick={() => toggleSort('status')} className="w-32 text-left hover:text-fg flex items-center transition-colors">
          Status<SortIcon col="status" />
        </button>
        <button onClick={() => toggleSort('builder')} className="flex-1 text-left hover:text-fg flex items-center transition-colors">
          Builder<SortIcon col="builder" />
        </button>
        <button onClick={() => toggleSort('total')} className="w-28 text-right hover:text-fg flex items-center justify-end transition-colors">
          Total<SortIcon col="total" />
        </button>
        <button onClick={() => toggleSort('createdAt')} className="w-28 text-right hover:text-fg flex items-center justify-end transition-colors">
          Date<SortIcon col="createdAt" />
        </button>
      </div>

      {/* Orders List */}
      {loading ? (
        <div className="panel border-t-0 rounded-t-none">
          {[0,1,2,3,4].map(i => (
            <div key={i} className="px-5 py-4 flex items-center gap-4 border-b border-grid-line animate-pulse">
              <div className="w-4 h-4 skeleton" />
              <div className="w-24 h-4 skeleton" />
              <div className="w-20 h-4 skeleton" />
              <div className="flex-1 h-4 skeleton" />
              <div className="w-24 h-4 skeleton" />
            </div>
          ))}
        </div>
      ) : orders.length === 0 ? (
        <div className="panel border-t-0 rounded-t-none">
          <EmptyState
            icon={<ShoppingCart className="w-8 h-8 text-fg-subtle" />}
            title="No orders found"
            description="Orders are created when approved quotes are converted"
          />
        </div>
      ) : (
        <div className="panel border-t-0 rounded-t-none overflow-hidden">
          {/* Select all */}
          <div className="flex items-center gap-2 px-5 py-2 border-b border-grid-line bg-surface-muted">
            <input type="checkbox" checked={selectedIds.size === orders.length && orders.length > 0}
              onChange={toggleSelectAll}
              className="w-3.5 h-3.5 rounded-sm border-border-strong accent-accent" />
            <span className="text-[11px] text-fg-muted">Select all on page ({orders.length})</span>
          </div>
          {orders.map(order => {
            const isExpanded = expandedOrder === order.id
            const project = order.quote?.project

            return (
              <div
                key={order.id}
                className={cn(
                  'border-b border-grid-line last:border-b-0 transition-colors cursor-pointer',
                  selectedIds.has(order.id) ? 'bg-accent-subtle' : 'hover:bg-row-hover',
                )}
                style={selectedIds.has(order.id) ? { background: 'var(--row-selected)' } : undefined}
                onClick={() => setExpandedOrder(isExpanded ? null : order.id)}
              >
                {/* Header Row */}
                <div className="px-5 py-3 flex items-center gap-4" onClick={(e) => e.stopPropagation()}>
                  <input type="checkbox" checked={selectedIds.has(order.id)}
                    onChange={() => toggleSelect(order.id)}
                    className="w-3.5 h-3.5 rounded-sm border-border-strong accent-accent flex-shrink-0" />
                  <div className="w-32 min-w-0 cursor-pointer" onClick={() => setExpandedOrder(isExpanded ? null : order.id)}>
                    <span className="text-[13px] font-mono font-semibold text-fg block truncate">{order.orderNumber}</span>
                    {order.quote && (
                      <span className="text-[10px] text-fg-subtle font-mono">← {order.quote.quoteNumber}</span>
                    )}
                  </div>
                  <div className="w-32 shrink-0 flex items-center gap-1.5">
                    <StatusBadge status={order.status} size="sm" />
                    {order.hasBomItems === false && (
                      <Badge
                        variant="neutral"
                        size="sm"
                        title="Order has no manufactured items — skips production"
                      >
                        STOCK ONLY
                      </Badge>
                    )}
                  </div>
                  <div className="flex-1 min-w-0 cursor-pointer" onClick={() => setExpandedOrder(isExpanded ? null : order.id)}>
                    <p className="text-sm text-fg truncate font-medium">
                      {order.builder?.companyName || 'Unknown'}
                    </p>
                    <p className="text-[11px] text-fg-muted truncate">
                      {project?.name && <span>{project.name}</span>}
                      {order.poNumber && <span className="ml-2">· PO {order.poNumber}</span>}
                      {order.deliveryDate && (
                        <span className="ml-2 inline-flex items-center gap-1">
                          <Calendar className="w-3 h-3" />
                          {new Date(order.deliveryDate).toLocaleDateString()}
                        </span>
                      )}
                      {order.jobs && order.jobs.length > 0 && (
                        <span className="ml-2 inline-flex items-center gap-1">
                          <span className="text-fg-subtle">·</span>
                          <Link
                            href={`/ops/jobs/${order.jobs[0].id}`}
                            onClick={(e) => e.stopPropagation()}
                            className="text-signal hover:underline cursor-pointer font-mono"
                          >
                            {order.jobs[0].jobNumber}
                          </Link>
                          {order.jobs.length > 1 && (
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); setExpandedOrder(order.id) }}
                              className="text-signal hover:underline cursor-pointer"
                            >
                              +{order.jobs.length - 1} View all
                            </button>
                          )}
                        </span>
                      )}
                    </p>
                  </div>
                  <div className="w-28 text-right shrink-0 cursor-pointer" onClick={() => setExpandedOrder(isExpanded ? null : order.id)}>
                    <p className="text-sm font-semibold text-fg font-numeric tabular-nums">{fmt(order.total)}</p>
                    <p className="text-[10px] text-fg-subtle">
                      {PAYMENT_LABELS[order.paymentTerm] || order.paymentTerm}
                    </p>
                  </div>
                  <div className="w-28 text-right shrink-0 cursor-pointer text-[11px] text-fg-muted font-numeric tabular-nums" onClick={() => setExpandedOrder(isExpanded ? null : order.id)}>
                    {new Date(order.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                    <div className="text-[10px] text-fg-subtle">
                      {new Date(order.createdAt).getFullYear()}
                    </div>
                  </div>
                  <button
                    onClick={() => setExpandedOrder(isExpanded ? null : order.id)}
                    className="p-1 rounded text-fg-muted hover:text-fg hover:bg-surface-muted transition-colors"
                    aria-label={isExpanded ? 'Collapse' : 'Expand'}
                  >
                    {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  </button>
                </div>

                {/* Expanded Detail */}
                <div
                  className="grid motion-safe:transition-[grid-template-rows] motion-safe:duration-300 motion-safe:ease-out"
                  style={{ gridTemplateRows: isExpanded ? '1fr' : '0fr' }}
                >
                  <div className="overflow-hidden min-h-0">
                  <div className="border-t border-border bg-surface-muted/40 px-5 py-4">
                    {/* Info Grid */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
                      <div className="panel p-3">
                        <p className="eyebrow mb-1.5">Builder</p>
                        <p className="text-sm font-medium text-fg">{order.builder?.companyName}</p>
                        <p className="text-xs text-fg-muted">{order.builder?.contactName}</p>
                        {order.builder?.email && <p className="text-xs text-fg-subtle mt-1">{order.builder.email}</p>}
                        {order.builder?.phone && <p className="text-xs text-fg-subtle font-mono">{order.builder.phone}</p>}
                      </div>

                      <div className="panel p-3">
                        <p className="eyebrow mb-1.5">Project · Delivery</p>
                        {project?.name && <p className="text-sm font-medium text-fg">{project.name}</p>}
                        {project?.jobAddress && (
                          <p className="text-xs text-fg-muted">{project.jobAddress}, {project.city} {project.state}</p>
                        )}
                        {order.deliveryDate ? (
                          <p className="text-xs text-data-positive-fg mt-1 flex items-center gap-1">
                            <Calendar className="w-3 h-3" />
                            Scheduled: {new Date(order.deliveryDate).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                          </p>
                        ) : (
                          <p className="text-xs text-data-warning-fg mt-1">No delivery date scheduled</p>
                        )}
                        {order.deliveryNotes && <p className="text-xs text-fg-subtle mt-1 italic">{order.deliveryNotes}</p>}
                        {order.deliveryConfirmedAt && (
                          <p className="text-xs text-data-positive-fg font-semibold mt-1 flex items-center gap-1">
                            <CheckCircle className="w-3 h-3" />
                            Delivered {new Date(order.deliveryConfirmedAt).toLocaleDateString()}
                          </p>
                        )}
                      </div>

                      <div className="panel p-3">
                        <p className="eyebrow mb-1.5">Payment</p>
                        <p className="text-sm font-semibold text-fg font-numeric tabular-nums">{fmt(order.total)}</p>
                        <p className="text-xs text-fg-muted">{PAYMENT_LABELS[order.paymentTerm] || order.paymentTerm}</p>
                        <div className="mt-1.5">
                          <StatusBadge status={order.paymentStatus || 'UNPAID'} size="sm" />
                        </div>
                      </div>
                    </div>

                    {/* Line Items */}
                    <div className="panel overflow-hidden mb-4">
                      <table className="datatable density-compact">
                        <thead>
                          <tr>
                            <th>Item</th>
                            <th>Material</th>
                            <th className="num">Qty</th>
                            <th className="num hidden sm:table-cell">Unit</th>
                            <th className="num">Total</th>
                          </tr>
                        </thead>
                        <tbody>
                          {order.items.slice(0, 10).map(item => {
                            const productId = item.productId || item.product?.id
                            const skuLabel = item.product?.sku
                            const showMaterial = needsDoorMaterial(item)
                            const missing = showMaterial && !item.doorMaterial
                            return (
                              <tr key={item.id}>
                                <td className="text-fg">
                                  {productId ? (
                                    <Link
                                      href={`/ops/products/${productId}`}
                                      className="text-signal hover:underline cursor-pointer"
                                    >
                                      {item.description}
                                    </Link>
                                  ) : (
                                    <span>{item.description}</span>
                                  )}
                                  {skuLabel && (
                                    productId ? (
                                      <Link
                                        href={`/ops/products/${productId}`}
                                        className="text-signal hover:underline cursor-pointer ml-2 text-xs font-mono"
                                      >
                                        {skuLabel}
                                      </Link>
                                    ) : (
                                      <span className="text-fg-subtle ml-2 text-xs font-mono">{skuLabel}</span>
                                    )
                                  )}
                                </td>
                                <td>
                                  {showMaterial ? (
                                    <select
                                      aria-label="Door material (strike type)"
                                      value={item.doorMaterial || ''}
                                      onChange={(e) => updateOrderItem(
                                        order.id,
                                        item.id,
                                        { doorMaterial: e.target.value || null },
                                      )}
                                      className={cn(
                                        'text-xs px-2 py-1 rounded border bg-surface',
                                        missing
                                          ? 'border-data-negative text-data-negative-fg font-semibold'
                                          : 'border-border text-fg',
                                      )}
                                    >
                                      <option value="">— select —</option>
                                      <option value="WOOD">Wood</option>
                                      <option value="FIBERGLASS">Fiberglass</option>
                                      <option value="METAL">Metal</option>
                                    </select>
                                  ) : (
                                    <span className="text-fg-subtle text-xs">—</span>
                                  )}
                                </td>
                                <td className="num text-fg-muted">{item.quantity}</td>
                                <td className="num text-fg-muted hidden sm:table-cell">{fmt(item.unitPrice)}</td>
                                <td className="num font-medium text-fg">{fmt(item.lineTotal)}</td>
                              </tr>
                            )
                          })}
                          {order.items.length > 10 && (
                            <tr>
                              <td colSpan={5} className="text-center text-xs text-fg-subtle">
                                + {order.items.length - 10} more items
                              </td>
                            </tr>
                          )}
                        </tbody>
                        <tfoot>
                          <tr className="bg-surface-muted">
                            <td colSpan={4} className="text-right eyebrow">Total</td>
                            <td className="num font-semibold text-accent text-base">{fmt(order.total)}</td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>

                    {/* Linked Jobs (Sales Order ↔ Work Order linkage) */}
                    {order.jobs && order.jobs.length > 0 && (
                      <div className="panel p-3 mb-3">
                        <p className="eyebrow mb-1.5">
                          Linked Jobs <span className="text-fg-subtle">({order.jobs.length})</span>
                        </p>
                        <div className="flex flex-wrap gap-2 items-center">
                          {order.jobs.map(job => (
                            <Link
                              key={job.id}
                              href={`/ops/jobs/${job.id}`}
                              className="text-signal hover:underline cursor-pointer"
                            >
                              <Badge variant="success" size="sm" dot>
                                <span className="font-mono">{job.jobNumber}</span>
                                <span className="ml-1 text-fg-muted">· {job.status}</span>
                              </Badge>
                            </Link>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Actions Bar */}
                    <div className="flex flex-wrap gap-2 pt-3 border-t border-border">
                      <button onClick={() => openScheduleModal(order)} className="btn btn-secondary btn-sm">
                        <Calendar className="w-3.5 h-3.5" /> Schedule Delivery
                      </button>

                      {order.status === 'RECEIVED' && (
                        <button onClick={() => updateOrder(order.id, { status: 'CONFIRMED' })} className="btn btn-primary btn-sm">
                          <CheckCircle className="w-3.5 h-3.5" /> Confirm
                        </button>
                      )}
                      {order.status === 'CONFIRMED' && (
                        <button onClick={() => updateOrder(order.id, { status: 'IN_PRODUCTION' })} className="btn btn-primary btn-sm">
                          <Factory className="w-3.5 h-3.5" /> Start Production
                        </button>
                      )}
                      {order.status === 'IN_PRODUCTION' && (
                        <button onClick={() => updateOrder(order.id, { status: 'READY_TO_SHIP' })} className="btn btn-primary btn-sm">
                          <Package className="w-3.5 h-3.5" /> Ready to Ship
                        </button>
                      )}
                      {order.status === 'READY_TO_SHIP' && (
                        <button onClick={() => updateOrder(order.id, { status: 'SHIPPED' })} className="btn btn-primary btn-sm">
                          <Truck className="w-3.5 h-3.5" /> Mark Shipped
                        </button>
                      )}
                      {order.status === 'SHIPPED' && (
                        <button onClick={() => updateOrder(order.id, { status: 'DELIVERED', confirmDelivery: true })} className="btn btn-primary btn-sm">
                          <CheckCircle className="w-3.5 h-3.5" /> Confirm Delivery
                        </button>
                      )}
                      {order.status === 'DELIVERED' && (
                        <button onClick={() => updateOrder(order.id, { status: 'COMPLETE' })} className="btn btn-success btn-sm">
                          <CheckCircle className="w-3.5 h-3.5" /> Mark Complete
                        </button>
                      )}

                      {['CONFIRMED', 'IN_PRODUCTION', 'READY_TO_SHIP', 'SHIPPED', 'DELIVERED', 'COMPLETE'].includes(order.status) && (
                        <button onClick={() => generateInvoice(order.id)} disabled={saving} className="btn btn-secondary btn-sm">
                          <Receipt className="w-3.5 h-3.5" /> Invoice
                        </button>
                      )}

                      {order.paymentStatus !== 'PAID' && (
                        <button onClick={() => updateOrder(order.id, { paymentStatus: 'PAID' })} className="btn btn-secondary btn-sm ml-auto">
                          <CreditCard className="w-3.5 h-3.5" /> Mark Paid
                        </button>
                      )}
                    </div>
                  </div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-3 px-1">
          <p className="text-xs text-fg-muted font-numeric tabular-nums">
            Showing {((page - 1) * 50) + 1}–{Math.min(page * 50, total)} of {total} orders
          </p>
          <div className="flex items-center gap-1.5">
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="btn btn-secondary btn-sm">
              ← Prev
            </button>
            <span className="text-xs text-fg-muted font-numeric tabular-nums px-2">Page {page} / {totalPages}</span>
            <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages} className="btn btn-secondary btn-sm">
              Next →
            </button>
          </div>
        </div>
      )}

      {/* Delivery Scheduling Modal */}
      {scheduleModal && (
        <div className="fixed inset-0 bg-stone-950/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-fade-in"
          onClick={() => setScheduleModal(null)}>
          <div className="panel panel-elevated w-full max-w-md animate-slide-up" onClick={e => e.stopPropagation()}>
            <div className="px-5 py-3.5 border-b border-border">
              <h3 className="text-sm font-semibold text-fg">Schedule Delivery</h3>
              <p className="text-xs text-fg-muted mt-0.5 font-mono">{scheduleModal.orderNumber} · {scheduleModal.builder?.companyName}</p>
            </div>
            <div className="px-5 py-5 space-y-4">
              <div>
                <label className="label">Delivery Date</label>
                <input type="date" value={schedDate} onChange={e => setSchedDate(e.target.value)} className="input font-numeric" />
              </div>
              <div>
                <label className="label">Delivery Notes</label>
                <textarea
                  value={schedNotes}
                  onChange={e => setSchedNotes(e.target.value)}
                  placeholder="Gate code, contact on site, special instructions…"
                  rows={3}
                  className="input resize-none"
                  style={{ height: 'auto', padding: '8px 12px' }}
                />
              </div>
              {scheduleModal.quote?.project?.jobAddress && (
                <div className="panel p-3">
                  <p className="eyebrow mb-1">Delivery Address</p>
                  <p className="text-sm text-fg">
                    {scheduleModal.quote.project.jobAddress}, {scheduleModal.quote.project.city} {scheduleModal.quote.project.state}
                  </p>
                </div>
              )}
            </div>
            <div className="px-5 py-3 border-t border-border flex justify-end gap-2">
              <button onClick={() => setScheduleModal(null)} className="btn btn-ghost btn-sm">
                Cancel
              </button>
              <button
                onClick={() => updateOrder(scheduleModal.id, {
                  deliveryDate: schedDate || null,
                  deliveryNotes: schedNotes || null,
                })}
                disabled={saving}
                className="btn btn-primary btn-sm"
              >
                {saving ? 'Saving…' : 'Save Schedule'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
