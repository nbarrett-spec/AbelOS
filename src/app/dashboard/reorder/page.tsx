'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

interface Product {
  productId: string
  productName: string
  sku: string
  currentPrice: number
  currentStock: number
  orderCount: number
  totalQtyOrdered: number
  lastOrdered: string
  inStock: boolean
}

interface OrderItem {
  lineId: string
  productId: string
  quantity: number
  unitPrice: number
  lineTotal: number
  productName: string
  sku: string
  currentPrice: number
  currentStock: number
  inStock: boolean
}

interface RecentOrder {
  orderId: string
  orderNumber: string
  orderDate: string
  orderStatus: string
  orderTotal: number
  itemCount: number
  items: OrderItem[]
}

interface CartItem {
  productId: string
  productName: string
  sku: string
  quantity: number
  unitPrice: number
  lineTotal: number
}

export default function ReorderPage() {
  const router = useRouter()
  const [frequentItems, setFrequentItems] = useState<Product[]>([])
  const [recentOrders, setRecentOrders] = useState<RecentOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Cart state
  const [cart, setCart] = useState<CartItem[]>([])
  const [notes, setNotes] = useState('')
  const [expandedOrders, setExpandedOrders] = useState<Set<string>>(new Set())
  const [submitting, setSubmitting] = useState(false)
  const [success, setSuccess] = useState<{ orderNumber: string } | null>(null)

  // Quantity inputs for frequent items
  const [quantities, setQuantities] = useState<Record<string, number>>({})

  useEffect(() => {
    fetchReorderData()
  }, [])

  async function fetchReorderData() {
    try {
      setLoading(true)
      setError(null)
      const res = await fetch('/api/dashboard/reorder', { method: 'GET' })
      if (!res.ok) {
        throw new Error('Failed to load reorder data')
      }
      const data = await res.json()
      setFrequentItems(data.frequentItems || [])
      setRecentOrders(data.recentOrders || [])
    } catch (err: any) {
      setError(err.message || 'Failed to load data')
    } finally {
      setLoading(false)
    }
  }

  function addFrequentItemToCart(product: Product) {
    const qty = quantities[product.productId] || 1
    if (qty <= 0) return

    const existing = cart.findIndex(i => i.productId === product.productId)
    const newItem: CartItem = {
      productId: product.productId,
      productName: product.productName,
      sku: product.sku,
      quantity: qty,
      unitPrice: product.currentPrice,
      lineTotal: product.currentPrice * qty,
    }

    if (existing >= 0) {
      const updated = [...cart]
      updated[existing].quantity += qty
      updated[existing].lineTotal = updated[existing].unitPrice * updated[existing].quantity
      setCart(updated)
    } else {
      setCart([...cart, newItem])
    }

    setQuantities({ ...quantities, [product.productId]: 1 })
  }

  function addOrderLineToCart(line: OrderItem) {
    const existing = cart.findIndex(i => i.productId === line.productId)
    const newItem: CartItem = {
      productId: line.productId,
      productName: line.productName,
      sku: line.sku,
      quantity: line.quantity,
      unitPrice: line.currentPrice,
      lineTotal: line.currentPrice * line.quantity,
    }

    if (existing >= 0) {
      const updated = [...cart]
      updated[existing].quantity += line.quantity
      updated[existing].lineTotal = updated[existing].unitPrice * updated[existing].quantity
      setCart(updated)
    } else {
      setCart([...cart, newItem])
    }
  }

  function addOrderToCart(order: RecentOrder) {
    order.items.forEach(line => addOrderLineToCart(line))
  }

  function removeFromCart(productId: string) {
    setCart(cart.filter(i => i.productId !== productId))
  }

  function updateCartQty(productId: string, qty: number) {
    if (qty <= 0) {
      removeFromCart(productId)
      return
    }
    const updated = [...cart]
    const idx = updated.findIndex(i => i.productId === productId)
    if (idx >= 0) {
      updated[idx].quantity = qty
      updated[idx].lineTotal = updated[idx].unitPrice * qty
      setCart(updated)
    }
  }

  const cartTotal = cart.reduce((sum, item) => sum + item.lineTotal, 0)

  async function submitReorder() {
    if (cart.length === 0) return

    try {
      setSubmitting(true)
      const res = await fetch('/api/dashboard/reorder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: cart.map(item => ({
            productId: item.productId,
            quantity: item.quantity,
          })),
          notes: notes || undefined,
        }),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to create reorder')
      }

      const data = await res.json()
      setSuccess({ orderNumber: data.orderNumber })
      setCart([])
      setNotes('')
      setTimeout(() => {
        router.push(`/dashboard/orders/${data.orderId}`)
      }, 2000)
    } catch (err: any) {
      setError(err.message || 'Failed to submit reorder')
    } finally {
      setSubmitting(false)
    }
  }

  function toggleOrder(orderId: string) {
    const updated = new Set(expandedOrders)
    if (updated.has(orderId)) {
      updated.delete(orderId)
    } else {
      updated.add(orderId)
    }
    setExpandedOrders(updated)
  }

  function formatDate(dateStr: string): string {
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })
  }

  function formatCurrency(num: number): string {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(num)
  }

  if (success) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-16">
        <div className="bg-green-50 border border-green-200 rounded-lg p-8 text-center">
          <div className="text-5xl mb-4">✓</div>
          <h1 className="text-2xl font-semibold text-green-900 mb-2">Reorder Submitted</h1>
          <p className="text-green-800 mb-4">
            Order <span className="font-mono font-semibold">{success.orderNumber}</span> has been placed!
          </p>
          <p className="text-sm text-green-700">We'll review and confirm shortly. Redirecting...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">Quick Reorder</h1>
        <p className="text-gray-600">Reorder from your previous orders in seconds</p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6 text-red-800">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Main content */}
        <div className="lg:col-span-2 space-y-8">
          {/* Loading state */}
          {loading && (
            <div className="space-y-6">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="h-32 bg-gray-100 rounded animate-pulse" />
              ))}
            </div>
          )}

          {!loading && (
            <>
              {/* Frequently Ordered */}
              <section>
                <h2 className="text-xl font-semibold text-gray-900 mb-4">Frequently Ordered</h2>
                {frequentItems.length === 0 ? (
                  <div className="text-center py-8 text-gray-500">No order history yet</div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {frequentItems.map(product => (
                      <div
                        key={product.productId}
                        className="border border-gray-200 rounded-lg p-4 hover:shadow-md transition"
                      >
                        <div className="flex justify-between items-start mb-2">
                          <div className="flex-1">
                            <h3 className="font-semibold text-gray-900 text-sm">
                              {product.productName}
                            </h3>
                            <p className="text-xs text-gray-500 mt-1">SKU: {product.sku}</p>
                          </div>
                          {product.inStock ? (
                            <span className="bg-green-100 text-green-800 text-xs px-2 py-1 rounded">
                              In Stock
                            </span>
                          ) : (
                            <span className="bg-red-100 text-red-800 text-xs px-2 py-1 rounded">
                              Out
                            </span>
                          )}
                        </div>

                        <div className="grid grid-cols-2 gap-2 text-xs text-gray-600 mb-3">
                          <div>
                            <span className="text-gray-500">Price: </span>
                            <span className="font-semibold text-gray-900">
                              {formatCurrency(product.currentPrice)}
                            </span>
                          </div>
                          <div>
                            <span className="text-gray-500">Times Ordered: </span>
                            <span className="font-semibold text-gray-900">{product.orderCount}</span>
                          </div>
                          <div className="col-span-2">
                            <span className="text-gray-500">Last Ordered: </span>
                            <span className="text-gray-700">{formatDate(product.lastOrdered)}</span>
                          </div>
                        </div>

                        <div className="flex gap-2">
                          <input
                            type="number"
                            min="1"
                            value={quantities[product.productId] || 1}
                            onChange={e =>
                              setQuantities({
                                ...quantities,
                                [product.productId]: parseInt(e.target.value) || 1,
                              })
                            }
                            className="w-16 px-2 py-1 border border-gray-300 rounded text-sm"
                          />
                          <button
                            onClick={() => addFrequentItemToCart(product)}
                            disabled={!product.inStock}
                            className="flex-1 bg-amber-600 hover:bg-amber-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white text-sm font-medium py-1 rounded transition"
                          >
                            Add to Cart
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              {/* Recent Orders */}
              <section>
                <h2 className="text-xl font-semibold text-gray-900 mb-4">Recent Orders</h2>
                {recentOrders.length === 0 ? (
                  <div className="text-center py-8 text-gray-500">No completed orders yet</div>
                ) : (
                  <div className="space-y-2">
                    {recentOrders.map(order => (
                      <div key={order.orderId} className="border border-gray-200 rounded-lg">
                        <button
                          onClick={() => toggleOrder(order.orderId)}
                          className="w-full px-4 py-3 flex justify-between items-center hover:bg-gray-50 transition"
                        >
                          <div className="text-left flex-1">
                            <div className="font-semibold text-gray-900">
                              {order.orderNumber}
                            </div>
                            <div className="text-sm text-gray-500">
                              {formatDate(order.orderDate)} · {order.itemCount} items ·{' '}
                              {formatCurrency(order.orderTotal)}
                            </div>
                          </div>
                          <span className="text-xl text-gray-400">
                            {expandedOrders.has(order.orderId) ? '−' : '+'}
                          </span>
                        </button>

                        {expandedOrders.has(order.orderId) && (
                          <div className="border-t border-gray-200 bg-gray-50 p-4 space-y-3">
                            {order.items.map(line => (
                              <div
                                key={line.lineId}
                                className="flex justify-between items-start gap-3 pb-3 border-b border-gray-200 last:border-0 last:pb-0"
                              >
                                <div className="flex-1 text-sm">
                                  <div className="font-medium text-gray-900">
                                    {line.productName}
                                  </div>
                                  <div className="text-xs text-gray-500">
                                    SKU: {line.sku} · Qty: {line.quantity} ·{' '}
                                    {formatCurrency(line.unitPrice)} each
                                  </div>
                                </div>
                                <button
                                  onClick={() => addOrderLineToCart(line)}
                                  className="px-3 py-1 bg-blue-100 text-blue-700 hover:bg-blue-200 text-xs font-medium rounded transition whitespace-nowrap"
                                >
                                  Reorder
                                </button>
                              </div>
                            ))}
                            <button
                              onClick={() => addOrderToCart(order)}
                              className="w-full mt-3 px-3 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded transition"
                            >
                              Reorder Entire Order
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </>
          )}
        </div>

        {/* Cart Sidebar */}
        <div className="lg:col-span-1">
          <div className="sticky top-4 border border-gray-200 rounded-lg bg-white shadow-sm">
            <div className="bg-walnut text-white px-6 py-4 rounded-t-lg">
              <h3 className="font-semibold text-lg">Order Summary</h3>
            </div>

            <div className="p-6 space-y-4">
              {cart.length === 0 ? (
                <div className="text-center py-8">
                  <p className="text-gray-500 text-sm">Your cart is empty</p>
                </div>
              ) : (
                <>
                  <div className="space-y-3 max-h-64 overflow-y-auto">
                    {cart.map(item => (
                      <div key={item.productId} className="text-sm border-b border-gray-100 pb-3">
                        <div className="flex justify-between items-start mb-2">
                          <div>
                            <div className="font-medium text-gray-900">{item.productName}</div>
                            <div className="text-xs text-gray-500">SKU: {item.sku}</div>
                          </div>
                          <button
                            onClick={() => removeFromCart(item.productId)}
                            className="text-gray-400 hover:text-red-600 text-lg leading-none"
                          >
                            ×
                          </button>
                        </div>
                        <div className="flex justify-between items-center gap-2">
                          <input
                            type="number"
                            min="1"
                            value={item.quantity}
                            onChange={e =>
                              updateCartQty(item.productId, parseInt(e.target.value) || 1)
                            }
                            className="w-12 px-2 py-1 border border-gray-300 rounded text-xs"
                          />
                          <span className="text-gray-600 flex-1">
                            @ {formatCurrency(item.unitPrice)}
                          </span>
                          <span className="font-semibold text-gray-900">
                            {formatCurrency(item.lineTotal)}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="pt-4 border-t border-gray-200 space-y-3">
                    <div className="flex justify-between items-center">
                      <span className="text-gray-600">Items:</span>
                      <span className="font-semibold text-gray-900">{cart.length}</span>
                    </div>
                    <div className="flex justify-between items-center text-lg font-semibold">
                      <span className="text-gray-900">Total:</span>
                      <span className="text-walnut">{formatCurrency(cartTotal)}</span>
                    </div>
                  </div>

                  <div className="pt-3 space-y-3">
                    <label className="block">
                      <span className="text-xs font-medium text-gray-700 mb-1 block">
                        Order Notes (optional)
                      </span>
                      <textarea
                        value={notes}
                        onChange={e => setNotes(e.target.value)}
                        placeholder="Add any special requests or delivery notes..."
                        className="w-full px-3 py-2 text-xs border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-amber-500 resize-none"
                        rows={3}
                      />
                    </label>

                    <button
                      onClick={submitReorder}
                      disabled={submitting || cart.length === 0}
                      className="w-full bg-amber-600 hover:bg-amber-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white font-semibold py-3 rounded transition"
                    >
                      {submitting ? 'Submitting...' : 'Place Reorder'}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
