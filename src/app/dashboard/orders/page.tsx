'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

interface OrderSearchResult {
  id: string
  orderNumber: string
  createdAt: string
  status: string
  total: number
  itemCount: number
  itemPreview: string[]
}

interface ReorderItem {
  productId: string
  productName: string
  sku: string
  quantity: number
  originalUnitPrice: number
  currentUnitPrice: number
  priceChanged: boolean
  inStock: boolean
  discontinued: boolean
}

interface SearchResponse {
  orders: OrderSearchResult[]
  total: number
  page: number
  limit: number
  totalPages: number
}

const STATUS_CONFIG: Record<string, { bg: string; text: string; label: string }> = {
  RECEIVED:       { bg: 'bg-blue-50',    text: 'text-blue-700',    label: 'Pending' },
  CONFIRMED:      { bg: 'bg-indigo-50',  text: 'text-indigo-700',  label: 'Confirmed' },
  IN_PRODUCTION:  { bg: 'bg-amber-50',   text: 'text-amber-700',   label: 'In Production' },
  READY_TO_SHIP:  { bg: 'bg-emerald-50', text: 'text-emerald-700', label: 'Ready to Ship' },
  SHIPPED:        { bg: 'bg-cyan-50',    text: 'text-cyan-700',    label: 'Shipped' },
  DELIVERED:      { bg: 'bg-violet-50',  text: 'text-violet-700',  label: 'Delivered' },
  COMPLETE:       { bg: 'bg-green-50',   text: 'text-green-700',   label: 'Complete' },
  CANCELLED:      { bg: 'bg-red-50',     text: 'text-red-700',     label: 'Cancelled' },
}

function fmt(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)
}

const PAGE_SIZE = 10

export default function BuilderOrdersPage() {
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [orders, setOrders] = useState<OrderSearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [expandedOrders, setExpandedOrders] = useState<Record<string, boolean>>({})
  const [reorderModal, setReorderModal] = useState<{
    isOpen: boolean
    orderId: string | null
    orderNumber: string | null
    items: ReorderItem[]
    warnings: string[]
    loading: boolean
  }>({
    isOpen: false,
    orderId: null,
    orderNumber: null,
    items: [],
    warnings: [],
    loading: false,
  })
  const searchTimeoutRef = useRef<NodeJS.Timeout>()
  const router = useRouter()

  const searchOrders = useCallback(async (q: string, status: string, pageNum: number) => {
    try {
      setLoading(true)
      setError(false)
      const params = new URLSearchParams()
      if (q) params.append('q', q)
      if (status) params.append('status', status)
      params.append('page', String(pageNum))
      params.append('limit', '20')

      const res = await fetch(`/api/builder/orders/search?${params}`)
      if (!res.ok) throw new Error('Failed to fetch orders')

      const data: SearchResponse = await res.json()
      setOrders(data.orders)
      setTotalPages(data.totalPages)
      setPage(pageNum)
    } catch (err: any) {
      console.error('Search error:', err)
      setError(true)
    } finally {
      setLoading(false)
    }
  }, [])

  // Debounced search on query change
  useEffect(() => {
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current)
    searchTimeoutRef.current = setTimeout(() => {
      searchOrders(searchQuery, statusFilter, 1)
    }, 300)

    return () => {
      if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current)
    }
  }, [searchQuery, statusFilter, searchOrders])

  // Initial load
  useEffect(() => {
    searchOrders('', '', 1)
  }, [])

  const openReorderModal = async (orderId: string, orderNumber: string) => {
    try {
      setReorderModal(prev => ({ ...prev, loading: true, isOpen: true, orderId, orderNumber }))
      const res = await fetch(`/api/builder/orders/${orderId}/reorder`, { method: 'POST' })
      if (!res.ok) throw new Error('Failed to prepare reorder')

      const data = await res.json()
      setReorderModal(prev => ({
        ...prev,
        items: data.items,
        warnings: data.warnings,
        loading: false,
      }))
    } catch (err: any) {
      console.error('Reorder error:', err)
      setReorderModal(prev => ({ ...prev, loading: false }))
    }
  }

  const closeReorderModal = () => {
    setReorderModal({
      isOpen: false,
      orderId: null,
      orderNumber: null,
      items: [],
      warnings: [],
      loading: false,
    })
  }

  const addToCart = async () => {
    if (!reorderModal.items.length) return
    // TODO: Implement add to cart logic
    closeReorderModal()
  }

  return (
    <div className="max-w-5xl mx-auto">
      {error && (
        <div className="mb-4 px-4 py-3 bg-red-50 border border-red-200 rounded-lg flex items-center justify-between">
          <p className="text-sm text-red-700">Failed to load orders. Please check your connection.</p>
          <button onClick={() => searchOrders(searchQuery, statusFilter, 1)} className="text-xs font-semibold text-red-700 hover:text-red-900 underline">Retry</button>
        </div>
      )}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-fg">Order History</h1>
          <p className="text-fg-muted text-sm">Search and reorder past purchases</p>
        </div>
      </div>

      {/* Search Bar */}
      <div className="mb-6 flex gap-3 flex-wrap">
        <input
          type="text"
          placeholder="Search by order #, product name..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="flex-1 min-w-[200px] px-4 py-2 border border-border-strong rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-signal"
        />
      </div>

      {/* Status Filter Tabs */}
      <div className="mb-6 flex gap-2 flex-wrap">
        <button
          onClick={() => setStatusFilter('')}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
            statusFilter === ''
              ? 'bg-brand text-white'
              : 'bg-surface border border-border-strong text-fg-muted hover:bg-surface-muted'
          }`}
        >
          All Orders
        </button>
        {['CONFIRMED', 'IN_PRODUCTION', 'READY_TO_SHIP', 'SHIPPED'].map(status => (
          <button
            key={status}
            onClick={() => setStatusFilter(status)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
              statusFilter === status
                ? 'bg-brand text-white'
                : 'bg-surface border border-border-strong text-fg-muted hover:bg-surface-muted'
            }`}
          >
            {STATUS_CONFIG[status]?.label || status}
          </button>
        ))}
        <button
          onClick={() => setStatusFilter('COMPLETE')}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
            statusFilter === 'COMPLETE'
              ? 'bg-brand text-white'
              : 'bg-surface border border-border-strong text-fg-muted hover:bg-surface-muted'
          }`}
        >
          Completed
        </button>
      </div>

      {loading && !orders.length ? (
        <div className="bg-surface rounded-lg border p-16 flex items-center justify-center">
          <div className="w-6 h-6 border-3 border-brand border-t-transparent rounded-full animate-spin" />
        </div>
      ) : orders.length === 0 ? (
        <div className="bg-surface rounded-lg border p-16 text-center">
          <div className="text-5xl mb-3">📦</div>
          <h3 className="font-semibold text-fg mb-1">No orders found</h3>
          <p className="text-fg-muted text-sm mb-4">Try adjusting your search or filters.</p>
        </div>
      ) : (
        <>
          <div className="space-y-3">
            {orders.map(order => (
              <OrderCard
                key={order.id}
                order={order}
                isExpanded={expandedOrders[order.id]}
                onToggleExpand={() =>
                  setExpandedOrders(prev => ({
                    ...prev,
                    [order.id]: !prev[order.id],
                  }))
                }
                onReorder={() => openReorderModal(order.id, order.orderNumber)}
              />
            ))}
          </div>

          {totalPages > 1 && (
            <div className="mt-6 flex gap-2 justify-center flex-wrap">
              {Array.from({ length: totalPages }, (_, i) => i + 1).map(p => (
                <button
                  key={p}
                  onClick={() => searchOrders(searchQuery, statusFilter, p)}
                  className={`px-3 py-2 rounded-lg text-sm font-medium transition ${
                    p === page
                      ? 'bg-brand text-white'
                      : 'bg-surface border border-border-strong text-fg-muted hover:bg-surface-muted'
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>
          )}
        </>
      )}

      {/* Reorder Modal */}
      {reorderModal.isOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-surface rounded-xl border border-border max-w-2xl w-full p-6 max-h-[80vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-fg">Reorder {reorderModal.orderNumber}</h3>
              <button
                onClick={closeReorderModal}
                className="text-fg-subtle hover:text-fg-muted"
              >
                ✕
              </button>
            </div>

            {reorderModal.loading ? (
              <div className="text-center py-8 text-fg-muted">Loading order details...</div>
            ) : (
              <>
                {reorderModal.warnings.length > 0 && (
                  <div className="mb-4 bg-amber-50 border border-amber-200 rounded-lg p-4">
                    <p className="text-sm font-semibold text-amber-900 mb-2">⚠ Items Not Available</p>
                    {reorderModal.warnings.map((w, i) => (
                      <p key={i} className="text-sm text-amber-800">• {w}</p>
                    ))}
                  </div>
                )}

                <div className="mb-4 overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-surface-muted border-b border-border">
                        <th className="px-3 py-2 text-left font-semibold text-fg">Product</th>
                        <th className="px-3 py-2 text-center font-semibold text-fg">Qty</th>
                        <th className="px-3 py-2 text-right font-semibold text-fg">Original</th>
                        <th className="px-3 py-2 text-right font-semibold text-fg">Current</th>
                      </tr>
                    </thead>
                    <tbody>
                      {reorderModal.items.map(item => (
                        <tr
                          key={item.productId}
                          className={`border-b border-border ${
                            item.discontinued || !item.inStock ? 'opacity-60' : ''
                          } ${item.priceChanged ? 'bg-yellow-50' : ''}`}
                        >
                          <td className="px-3 py-3">
                            <div className="font-medium text-fg">{item.productName}</div>
                            <div className="text-xs text-fg-muted">SKU: {item.sku}</div>
                            {item.discontinued && <div className="text-xs text-red-600">Discontinued</div>}
                            {!item.inStock && !item.discontinued && <div className="text-xs text-signal">Out of stock</div>}
                          </td>
                          <td className="px-3 py-3 text-center text-fg">{item.quantity}</td>
                          <td className="px-3 py-3 text-right text-fg">{fmt(item.originalUnitPrice)}</td>
                          <td className={`px-3 py-3 text-right font-medium ${item.priceChanged ? 'text-accent' : 'text-fg'}`}>
                            {fmt(item.currentUnitPrice)}
                            {item.priceChanged && (
                              <div className="text-xs text-accent">
                                {item.currentUnitPrice > item.originalUnitPrice ? '+' : ''}
                                {fmt(item.currentUnitPrice - item.originalUnitPrice)}
                              </div>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="flex gap-3">
                  <button
                    disabled
                    title="Cart integration coming soon"
                    className="flex-1 px-4 py-2 bg-accent text-white font-semibold rounded-lg opacity-50 cursor-not-allowed"
                  >
                    Add Available Items to Cart
                  </button>
                  <button
                    onClick={closeReorderModal}
                    className="flex-1 px-4 py-2 bg-surface border border-border-strong text-fg-muted font-semibold rounded-lg hover:bg-surface-muted transition"
                  >
                    Cancel
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function OrderCard({
  order,
  isExpanded,
  onToggleExpand,
  onReorder,
}: {
  order: OrderSearchResult
  isExpanded: boolean
  onToggleExpand: () => void
  onReorder: () => void
}) {
  const cfg = STATUS_CONFIG[order.status] || { bg: 'bg-surface-muted', text: 'text-fg-muted', label: order.status }
  const [showSaveTemplate, setShowSaveTemplate] = useState(false)
  const [templateName, setTemplateName] = useState('')
  const [templateDesc, setTemplateDesc] = useState('')
  const [savingTemplate, setSavingTemplate] = useState(false)
  const [error, setError] = useState('')

  async function handleSaveTemplate() {
    if (!templateName.trim()) {
      setError('Template name is required')
      return
    }

    setSavingTemplate(true)
    setError('')

    try {
      const res = await fetch('/api/builder/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: templateName.trim(),
          description: templateDesc.trim() || undefined,
          sourceOrderId: order.id,
        }),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to save template')
      }
      setShowSaveTemplate(false)
      setTemplateName('')
      setTemplateDesc('')
      alert('Template saved successfully!')
    } catch (err: any) {
      setError(err.message)
    } finally {
      setSavingTemplate(false)
    }
  }

  const isCompleted = ['DELIVERED', 'COMPLETE'].includes(order.status)

  return (
    <>
      <div className={`bg-surface rounded-lg border p-4 hover:shadow-md transition cursor-pointer ${isExpanded ? 'shadow-md' : ''}`}>
        <div onClick={onToggleExpand}>
          <div className="flex items-center justify-between">
            <div className="flex-1">
              <div className="font-semibold text-fg">{order.orderNumber}</div>
              <div className="text-sm text-fg-muted mt-1">
                {new Date(order.createdAt).toLocaleDateString()} • {order.itemCount} items
              </div>
              <div className="text-sm text-fg-muted mt-1">
                {order.itemPreview.slice(0, 3).join(', ')}
                {order.itemPreview.length > 3 && ` +${order.itemPreview.length - 3} more`}
              </div>
            </div>
            <div className="text-right ml-4 flex-shrink-0">
              <div className="font-semibold text-fg">{fmt(order.total)}</div>
              <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-medium mt-2 ${cfg.bg} ${cfg.text}`}>
                {cfg.label}
              </span>
            </div>
            <div className="ml-4 text-fg-subtle">{isExpanded ? '▼' : '▶'}</div>
          </div>
        </div>

        {isExpanded && (
          <div className="mt-4 pt-4 border-t border-border">
            <div className="mb-4">
              <p className="text-sm font-semibold text-fg-muted mb-2">Items ({order.itemCount})</p>
              <div className="space-y-2">
                {order.itemPreview.map((item, i) => (
                  <div key={i} className="text-sm text-fg-muted">• {item}</div>
                ))}
                {order.itemPreview.length > 10 && (
                  <div className="text-sm text-fg-muted">+{order.itemPreview.length - 10} more</div>
                )}
              </div>
            </div>

            <div className="flex gap-2 pt-3">
              {isCompleted && (
                <>
                  <button
                    onClick={e => {
                      e.stopPropagation()
                      onReorder()
                    }}
                    className="flex-1 bg-accent hover:bg-accent-hover text-white font-semibold text-sm py-2 rounded transition"
                  >
                    Reorder
                  </button>
                  <button
                    onClick={e => {
                      e.stopPropagation()
                      setShowSaveTemplate(true)
                    }}
                    className="flex-1 bg-brand hover:bg-brand/90 text-white font-semibold text-sm py-2 rounded transition"
                  >
                    Save as Template
                  </button>
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Save Template Modal */}
      {showSaveTemplate && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-surface rounded-xl border border-border max-w-md w-full p-6">
            <h3 className="text-lg font-bold text-fg mb-4">Save Order as Template</h3>

            <div className="mb-4">
              <label className="block text-sm font-semibold text-fg-muted mb-2">
                Template Name <span className="text-red-600">*</span>
              </label>
              <input
                type="text"
                value={templateName}
                onChange={e => setTemplateName(e.target.value)}
                placeholder={`${order.orderNumber} Template`}
                className="w-full px-3 py-2 border border-border-strong rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-signal"
                autoFocus
              />
            </div>

            <div className="mb-4">
              <label className="block text-sm font-semibold text-fg-muted mb-2">
                Description (Optional)
              </label>
              <textarea
                value={templateDesc}
                onChange={e => setTemplateDesc(e.target.value)}
                placeholder="e.g., Standard items for this project type..."
                className="w-full px-3 py-2 border border-border-strong rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-signal"
                rows={3}
              />
            </div>

            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-4">
              <p className="text-sm text-blue-700">
                This will create a template with all {order.itemCount} items from this order.
              </p>
            </div>

            {error && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4">
                <p className="text-sm text-red-700">{error}</p>
              </div>
            )}

            <div className="flex gap-3">
              <button
                onClick={() => {
                  setShowSaveTemplate(false)
                  setTemplateName('')
                  setTemplateDesc('')
                  setError('')
                }}
                disabled={savingTemplate}
                className="flex-1 px-4 py-2 border border-border-strong rounded-lg text-fg-muted font-semibold hover:bg-surface-muted transition disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveTemplate}
                disabled={savingTemplate || !templateName.trim()}
                className="flex-1 px-4 py-2 bg-brand hover:bg-brand/90 text-white font-semibold rounded-lg transition disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {savingTemplate && <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
                {savingTemplate ? 'Saving...' : 'Save Template'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

