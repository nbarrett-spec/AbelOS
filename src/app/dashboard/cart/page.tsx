'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useAuth } from '@/hooks/useAuth'
import CrossSellBanner from '@/components/CrossSellBanner'

interface CartItem {
  productId: string
  quantity: number
  unitPrice: number
  description: string
  sku: string
}

interface CartData {
  items: CartItem[]
}

function fmt(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)
}

export default function CartPage() {
  const router = useRouter()
  const { builder, loading: authLoading } = useAuth()

  const [cart, setCart] = useState<CartData>({ items: [] })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showQuoteModal, setShowQuoteModal] = useState(false)
  const [projectName, setProjectName] = useState('')
  const [deliveryNotes, setDeliveryNotes] = useState('')
  const [generating, setGenerating] = useState(false)

  useEffect(() => {
    fetchCart()
  }, [])

  async function fetchCart() {
    try {
      setLoading(true)
      const res = await fetch('/api/catalog/cart')
      if (!res.ok) throw new Error('Failed to load cart')
      const data = await res.json()
      setCart(data)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  async function handleRemoveItem(productId: string) {
    try {
      const res = await fetch('/api/catalog/cart', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId }),
      })
      if (!res.ok) throw new Error('Failed to remove item')
      const data = await res.json()
      setCart(data)
    } catch (err: any) {
      setError(err.message)
    }
  }

  async function handleUpdateQuantity(productId: string, newQuantity: number) {
    if (newQuantity < 1) {
      await handleRemoveItem(productId)
      return
    }

    const item = cart.items.find(i => i.productId === productId)
    if (!item) return

    try {
      // Remove the item first
      await fetch('/api/catalog/cart', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId }),
      })

      // Re-add with new quantity
      const res = await fetch('/api/catalog/cart', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productId: item.productId,
          quantity: newQuantity,
          unitPrice: item.unitPrice,
          description: item.description,
          sku: item.sku,
        }),
      })
      if (!res.ok) throw new Error('Failed to update quantity')
      const data = await res.json()
      setCart(data)
    } catch (err: any) {
      setError(err.message)
    }
  }

  async function handleGenerateQuote() {
    if (!projectName.trim()) {
      setError('Project name is required')
      return
    }

    try {
      setGenerating(true)
      setError('')

      // Create quote from cart items
      const res = await fetch('/api/quotes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: cart.items,
          projectName: projectName.trim(),
          deliveryNotes: deliveryNotes.trim() || null,
        }),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to generate quote')
      }

      const data = await res.json()
      const quoteId = data.quote.id

      // Clear cart
      for (const item of cart.items) {
        await fetch('/api/catalog/cart', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ productId: item.productId }),
        })
      }

      // Redirect to quote detail page
      router.push(`/dashboard/quotes/${quoteId}`)
    } catch (err: any) {
      setError(err.message)
      setGenerating(false)
    }
  }

  if (loading || authLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 border-4 border-brand border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  const subtotal = cart.items.reduce((acc, item) => acc + item.unitPrice * item.quantity, 0)

  // Empty state
  if (cart.items.length === 0) {
    return (
      <div className="max-w-2xl mx-auto py-12">
        <div className="bg-surface rounded-xl border border-border p-8 text-center">
          <div className="text-5xl mb-4">🛒</div>
          <h2 className="text-2xl font-bold text-fg mb-2">Your cart is empty</h2>
          <p className="text-fg-muted mb-6">
            Browse the catalog and add items to get started.
          </p>
          <Link
            href="/catalog"
            className="inline-block bg-brand hover:bg-brand-hover text-fg-on-accent font-bold py-3 px-6 rounded-lg transition"
          >
            Continue shopping
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-4xl mx-auto">
      {/* Back Link */}
      <Link href="/catalog" className="text-sm text-brand hover:underline mb-4 inline-block">
        &larr; Continue shopping
      </Link>

      {/* Header */}
      <h1 className="text-3xl font-bold text-fg mb-6">Review your cart</h1>

      {error && (
        <div className="bg-data-negative-bg border border-data-negative rounded-lg p-4 mb-6">
          <p className="text-sm text-data-negative-fg">{error}</p>
        </div>
      )}

      {/* Cart Items Table */}
      <div className="bg-surface rounded-xl border border-border overflow-hidden mb-6">
        <div className="px-5 py-4 border-b border-border">
          <h3 className="text-sm font-semibold text-fg-muted">Items ({cart.items.length})</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-surface-muted">
              <tr className="text-xs text-fg-muted uppercase tracking-wider">
                <th className="px-5 py-3 text-left font-semibold">Product</th>
                <th className="px-5 py-3 text-center font-semibold">Quantity</th>
                <th className="px-5 py-3 text-right font-semibold">Unit price</th>
                <th className="px-5 py-3 text-right font-semibold">Total</th>
                <th className="px-5 py-3 text-center font-semibold">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {cart.items.map(item => (
                <tr key={item.productId}>
                  <td className="px-5 py-4">
                    <p className="text-sm font-medium text-fg">{item.description}</p>
                    <p className="text-xs text-fg-subtle mt-0.5">SKU: {item.sku}</p>
                  </td>
                  <td className="px-5 py-4">
                    <div className="flex items-center justify-center gap-2">
                      <button
                        onClick={() => handleUpdateQuantity(item.productId, item.quantity - 1)}
                        className="w-8 h-8 flex items-center justify-center rounded border border-border hover:bg-surface-muted transition"
                      >
                        −
                      </button>
                      <input
                        type="number"
                        value={item.quantity}
                        onChange={e => {
                          const val = parseInt(e.target.value)
                          if (!isNaN(val) && val > 0) handleUpdateQuantity(item.productId, val)
                        }}
                        className="w-12 text-center px-2 py-1 border border-border rounded text-sm bg-surface text-fg"
                      />
                      <button
                        onClick={() => handleUpdateQuantity(item.productId, item.quantity + 1)}
                        className="w-8 h-8 flex items-center justify-center rounded border border-border hover:bg-surface-muted transition"
                      >
                        +
                      </button>
                    </div>
                  </td>
                  <td className="px-5 py-4 text-sm text-fg-muted text-right">{fmt(item.unitPrice)}</td>
                  <td className="px-5 py-4 text-sm font-semibold text-fg text-right">
                    {fmt(item.unitPrice * item.quantity)}
                  </td>
                  <td className="px-5 py-4 text-center">
                    <button
                      onClick={() => handleRemoveItem(item.productId)}
                      className="text-data-negative-fg hover:opacity-80 font-semibold text-sm transition"
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Summary */}
      <div className="bg-surface rounded-xl border border-border p-6 mb-6">
        <div className="space-y-3">
          <div className="flex justify-between items-center">
            <span className="text-sm font-medium text-fg-muted">Items ({cart.items.length})</span>
            <span className="text-sm font-semibold text-fg">{fmt(subtotal)}</span>
          </div>
          <div className="flex justify-between items-center border-t border-border pt-3">
            <span className="text-base font-bold text-fg">Subtotal</span>
            <span className="text-base font-bold text-brand">{fmt(subtotal)}</span>
          </div>
          <p className="text-xs text-fg-muted pt-2">
            Tax and final pricing lock in after we build your quote.
          </p>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex gap-3">
        <button
          onClick={() => setShowQuoteModal(true)}
          className="flex-1 bg-accent hover:bg-accent-hover text-fg-on-accent font-bold py-4 px-6 rounded-lg transition"
        >
          Generate quote
        </button>
        <Link
          href="/catalog"
          className="flex-1 bg-surface-muted hover:bg-border text-fg font-bold py-4 px-6 rounded-lg transition text-center"
        >
          Continue shopping
        </Link>
      </div>

      {/* Cross-Sell Recommendations */}
      <CrossSellBanner cartProductIds={cart.items.map(item => item.productId)} />

      {/* Generate Quote Modal */}
      {showQuoteModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-surface rounded-xl border border-border max-w-md w-full p-6">
            <h3 className="text-lg font-bold text-fg mb-4">Generate Quote</h3>

            <div className="mb-4">
              <label className="block text-sm font-semibold text-fg-muted mb-2">
                Project name <span className="text-data-negative-fg">*</span>
              </label>
              <input
                type="text"
                value={projectName}
                onChange={e => setProjectName(e.target.value)}
                placeholder="e.g., Kitchen Renovation, Deck Project..."
                className="w-full px-3 py-2 border border-border rounded-lg text-sm bg-surface text-fg focus:outline-none focus:ring-2 focus:ring-signal"
                autoFocus
              />
            </div>

            <div className="mb-4">
              <label className="block text-sm font-semibold text-fg-muted mb-2">
                Delivery notes (optional)
              </label>
              <textarea
                value={deliveryNotes}
                onChange={e => setDeliveryNotes(e.target.value)}
                placeholder="e.g., Preferred dates, gate codes, unload instructions..."
                className="w-full px-3 py-2 border border-border rounded-lg text-sm bg-surface text-fg focus:outline-none focus:ring-2 focus:ring-signal"
                rows={3}
              />
            </div>

            <div className="bg-data-info-bg border border-data-info rounded-lg p-3 mb-4">
              <p className="text-sm text-data-info-fg">
                Cart subtotal: <span className="font-semibold">{fmt(subtotal)}</span>
              </p>
            </div>

            {error && (
              <div className="bg-data-negative-bg border border-data-negative rounded-lg p-3 mb-4">
                <p className="text-sm text-data-negative-fg">{error}</p>
              </div>
            )}

            <div className="flex gap-3">
              <button
                onClick={() => setShowQuoteModal(false)}
                disabled={generating}
                className="flex-1 px-4 py-2 border border-border rounded-lg text-fg-muted font-semibold hover:bg-surface-muted transition disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleGenerateQuote}
                disabled={generating || !projectName.trim()}
                className="flex-1 px-4 py-2 bg-accent hover:bg-accent-hover text-fg-on-accent font-semibold rounded-lg transition disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {generating && <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
                {generating ? 'Generating...' : 'Generate quote'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
