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
        <div className="w-8 h-8 border-4 border-[#3E2A1E] border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  const subtotal = cart.items.reduce((acc, item) => acc + item.unitPrice * item.quantity, 0)

  // Empty state
  if (cart.items.length === 0) {
    return (
      <div className="max-w-2xl mx-auto py-12">
        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
          <div className="text-5xl mb-4">🛒</div>
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Your Cart is Empty</h2>
          <p className="text-gray-600 mb-6">
            Browse our product catalog and add items to get started.
          </p>
          <Link
            href="/catalog"
            className="inline-block bg-[#3E2A1E] hover:bg-[#3E2A1E]/90 text-white font-bold py-3 px-6 rounded-lg transition"
          >
            Continue Shopping
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-4xl mx-auto">
      {/* Back Link */}
      <Link href="/catalog" className="text-sm text-[#3E2A1E] hover:underline mb-4 inline-block">
        &larr; Continue Shopping
      </Link>

      {/* Header */}
      <h1 className="text-3xl font-bold text-gray-900 mb-6">Review Cart</h1>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {/* Cart Items Table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden mb-6">
        <div className="px-5 py-4 border-b border-gray-100">
          <h3 className="text-sm font-semibold text-gray-700">Items ({cart.items.length})</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr className="text-xs text-gray-500 uppercase tracking-wider">
                <th className="px-5 py-3 text-left font-semibold">Product</th>
                <th className="px-5 py-3 text-center font-semibold">Quantity</th>
                <th className="px-5 py-3 text-right font-semibold">Unit Price</th>
                <th className="px-5 py-3 text-right font-semibold">Total</th>
                <th className="px-5 py-3 text-center font-semibold">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {cart.items.map(item => (
                <tr key={item.productId}>
                  <td className="px-5 py-4">
                    <p className="text-sm font-medium text-gray-900">{item.description}</p>
                    <p className="text-xs text-gray-400 mt-0.5">SKU: {item.sku}</p>
                  </td>
                  <td className="px-5 py-4">
                    <div className="flex items-center justify-center gap-2">
                      <button
                        onClick={() => handleUpdateQuantity(item.productId, item.quantity - 1)}
                        className="w-8 h-8 flex items-center justify-center rounded border border-gray-300 hover:bg-gray-50 transition"
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
                        className="w-12 text-center px-2 py-1 border border-gray-300 rounded text-sm"
                      />
                      <button
                        onClick={() => handleUpdateQuantity(item.productId, item.quantity + 1)}
                        className="w-8 h-8 flex items-center justify-center rounded border border-gray-300 hover:bg-gray-50 transition"
                      >
                        +
                      </button>
                    </div>
                  </td>
                  <td className="px-5 py-4 text-sm text-gray-700 text-right">{fmt(item.unitPrice)}</td>
                  <td className="px-5 py-4 text-sm font-semibold text-gray-900 text-right">
                    {fmt(item.unitPrice * item.quantity)}
                  </td>
                  <td className="px-5 py-4 text-center">
                    <button
                      onClick={() => handleRemoveItem(item.productId)}
                      className="text-red-600 hover:text-red-700 font-semibold text-sm transition"
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
      <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
        <div className="space-y-3">
          <div className="flex justify-between items-center">
            <span className="text-sm font-medium text-gray-700">Items ({cart.items.length})</span>
            <span className="text-sm font-semibold text-gray-900">{fmt(subtotal)}</span>
          </div>
          <div className="flex justify-between items-center border-t pt-3">
            <span className="text-base font-bold text-gray-900">Subtotal</span>
            <span className="text-base font-bold text-[#3E2A1E]">{fmt(subtotal)}</span>
          </div>
          <p className="text-xs text-gray-500 pt-2">
            Tax will be calculated and final pricing shown after generating a quote based on your project details.
          </p>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex gap-3">
        <button
          onClick={() => setShowQuoteModal(true)}
          className="flex-1 bg-[#C9822B] hover:bg-[#C9822B]/90 text-white font-bold py-4 px-6 rounded-lg transition"
        >
          Generate Quote
        </button>
        <Link
          href="/catalog"
          className="flex-1 bg-gray-200 hover:bg-gray-300 text-gray-900 font-bold py-4 px-6 rounded-lg transition text-center"
        >
          Continue Shopping
        </Link>
      </div>

      {/* Cross-Sell Recommendations */}
      <CrossSellBanner cartProductIds={cart.items.map(item => item.productId)} />

      {/* Generate Quote Modal */}
      {showQuoteModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl border border-gray-200 max-w-md w-full p-6">
            <h3 className="text-lg font-bold text-gray-900 mb-4">Generate Quote</h3>

            <div className="mb-4">
              <label className="block text-sm font-semibold text-gray-700 mb-2">
                Project Name <span className="text-red-600">*</span>
              </label>
              <input
                type="text"
                value={projectName}
                onChange={e => setProjectName(e.target.value)}
                placeholder="e.g., Kitchen Renovation, Deck Project..."
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#3E2A1E]"
                autoFocus
              />
            </div>

            <div className="mb-4">
              <label className="block text-sm font-semibold text-gray-700 mb-2">
                Delivery Notes (Optional)
              </label>
              <textarea
                value={deliveryNotes}
                onChange={e => setDeliveryNotes(e.target.value)}
                placeholder="e.g., Preferred delivery dates, special instructions..."
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#3E2A1E]"
                rows={3}
              />
            </div>

            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-4">
              <p className="text-sm text-blue-700">
                Cart subtotal: <span className="font-semibold">{fmt(subtotal)}</span>
              </p>
            </div>

            {error && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4">
                <p className="text-sm text-red-700">{error}</p>
              </div>
            )}

            <div className="flex gap-3">
              <button
                onClick={() => setShowQuoteModal(false)}
                disabled={generating}
                className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-gray-700 font-semibold hover:bg-gray-50 transition disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleGenerateQuote}
                disabled={generating || !projectName.trim()}
                className="flex-1 px-4 py-2 bg-[#C9822B] hover:bg-[#C9822B]/90 text-white font-semibold rounded-lg transition disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {generating && <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
                {generating ? 'Generating...' : 'Generate Quote'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
