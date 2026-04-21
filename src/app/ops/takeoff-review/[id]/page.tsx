'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'

interface TakeoffItem {
  id: string
  category: string
  description: string
  location: string | null
  quantity: number
  confidence: number | null
  aiNotes: string | null
  productId: string | null
  product?: {
    id: string
    sku: string
    name: string
    basePrice: number
  } | null
}

const CATEGORY_ICONS: Record<string, string> = {
  'Interior Door': '🚪', 'Exterior Door': '🏠', 'Hardware': '🔩',
  'Trim': '📏', 'Window Trim': '🪟', 'Closet Component': '👔',
  'Specialty': '🔨', 'Miscellaneous': '📦',
}

export default function TakeoffReviewDetailPage() {
  const params = useParams()
  const router = useRouter()
  const takeoffId = params.id as string

  const [takeoff, setTakeoff] = useState<any>(null)
  const [items, setItems] = useState<TakeoffItem[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [editingItem, setEditingItem] = useState<string | null>(null)
  const [editValues, setEditValues] = useState<any>({})
  const [filter, setFilter] = useState('all')
  const [viewMode, setViewMode] = useState<'room' | 'category'>('room')
  const [productSearch, setProductSearch] = useState('')
  const [productResults, setProductResults] = useState<any[]>([])
  const [searchingProducts, setSearchingProducts] = useState(false)
  const [pendingChanges, setPendingChanges] = useState<Set<string>>(new Set())
  const [generatingQuote, setGeneratingQuote] = useState(false)
  const [toast, setToast] = useState('')
  const [toastType, setToastType] = useState<'success' | 'error'>('success')
  const showToast = (msg: string, type: 'success' | 'error' = 'success') => {
    setToast(msg); setToastType(type); setTimeout(() => setToast(''), 3500)
  }

  const fetchTakeoff = useCallback(async () => {
    try {
      const res = await fetch(`/api/ops/takeoffs/${takeoffId}`)
      if (res.ok) {
        const data = await res.json()
        setTakeoff(data)
        setItems(data.items || [])
      }
    } finally {
      setLoading(false)
    }
  }, [takeoffId])

  useEffect(() => { fetchTakeoff() }, [fetchTakeoff])

  // Product search for swapping
  const searchProducts = async (query: string) => {
    if (query.length < 2) { setProductResults([]); return }
    setSearchingProducts(true)
    try {
      const res = await fetch(`/api/ops/products/search?q=${encodeURIComponent(query)}&limit=10`)
      if (res.ok) {
        const data = await res.json()
        setProductResults(data.products || [])
      }
    } finally {
      setSearchingProducts(false)
    }
  }

  // Save a single item edit
  const saveItemEdit = async (itemId: string) => {
    setSaving(true)
    try {
      const values = editValues[itemId]
      if (!values) return

      const res = await fetch(`/api/ops/takeoffs/${takeoffId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'updateItem',
          itemId,
          ...values,
        }),
      })

      if (res.ok) {
        const updated = await res.json()
        setItems(prev => prev.map(i => i.id === itemId ? { ...i, ...updated } : i))
        setEditingItem(null)
        setEditValues((prev: any) => { const next = { ...prev }; delete next[itemId]; return next })
        setPendingChanges(prev => { const next = new Set(prev); next.delete(itemId); return next })
      }
    } finally {
      setSaving(false)
    }
  }

  // Delete an item
  const deleteItem = async (itemId: string) => {
    if (!confirm('Remove this item from the takeoff?')) return
    try {
      const res = await fetch(`/api/ops/takeoffs/${takeoffId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'deleteItem', itemId }),
      })
      if (res.ok) {
        setItems(prev => prev.filter(i => i.id !== itemId))
      }
    } catch (e) {
      console.error(e)
    }
  }

  // Add new item
  const addItem = async () => {
    try {
      const res = await fetch(`/api/ops/takeoffs/${takeoffId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'addItem',
          category: 'Miscellaneous',
          description: 'New item — click to edit',
          quantity: 1,
        }),
      })
      if (res.ok) {
        const newItem = await res.json()
        setItems(prev => [...prev, newItem])
        setEditingItem(newItem.id)
        setEditValues((prev: any) => ({ ...prev, [newItem.id]: { description: '', quantity: 1, category: 'Miscellaneous' } }))
      }
    } catch (e) {
      console.error(e)
    }
  }

  // Approve takeoff (mark as reviewed)
  const approveTakeoff = async () => {
    try {
      await fetch(`/api/ops/takeoffs/${takeoffId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'updateStatus', status: 'APPROVED' }),
      })
      setTakeoff((prev: any) => ({ ...prev, status: 'APPROVED' }))
    } catch (e) {
      console.error(e)
    }
  }

  // Generate ops-side quote from this takeoff
  const generateQuote = async () => {
    if (!takeoff) return
    setGeneratingQuote(true)
    try {
      const res = await fetch('/api/ops/quotes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          takeoffId: takeoff.id,
          projectId: takeoff.projectId,
          builderId: takeoff.project?.builder?.id,
        }),
      })
      if (res.ok) {
        const data = await res.json()
        router.push('/ops/quotes')
      } else {
        const err = await res.json()
        showToast(`Quote generation failed: ${err.error}`, 'error')
      }
    } finally {
      setGeneratingQuote(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 border-4 border-[#0f2a3e] border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!takeoff) {
    return <div className="text-center py-20 text-gray-500">Takeoff not found.</div>
  }

  const categories = Array.from(new Set(items.map(i => i.category)))
  const filteredItems = filter === 'all' ? items : items.filter(i => i.category === filter)

  const grouped = filteredItems.reduce((acc, item) => {
    const key = viewMode === 'room' ? (item.location || 'General') : item.category
    if (!acc[key]) acc[key] = []
    acc[key].push(item)
    return acc
  }, {} as Record<string, TakeoffItem[]>)

  const matchedCount = items.filter(i => i.product).length
  const unmatchedCount = items.length - matchedCount
  const estimatedTotal = items.reduce((sum, item) =>
    item.product ? sum + item.product.basePrice * item.quantity : sum, 0
  )

  return (
    <div>
      {toast && (
        <div className={`fixed top-4 right-4 z-50 px-5 py-3 rounded-lg shadow-lg text-white text-sm font-medium transition-all ${toastType === 'success' ? 'bg-green-600' : 'bg-red-600'}`}>
          {toast}
        </div>
      )}
      {/* Header */}
      <div className="flex items-center gap-2 text-sm text-gray-500 mb-4">
        <Link href="/ops/takeoff-review" className="hover:text-[#0f2a3e]">Takeoff Review</Link>
        <span>/</span>
        <span className="text-gray-900">{takeoff.project?.name}</span>
      </div>

      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{takeoff.project?.name}</h1>
          <p className="text-sm text-gray-500 mt-1">
            {takeoff.project?.builder?.companyName} &middot;
            {takeoff.project?.planName || 'No plan'} &middot;
            {takeoff.project?.sqFootage?.toLocaleString() || '—'} sf &middot;
            {Math.round(takeoff.confidence * 100)}% confidence
          </p>
        </div>
        <div className="flex gap-2">
          {takeoff.status === 'NEEDS_REVIEW' && (
            <button onClick={approveTakeoff} className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white text-sm font-medium rounded-lg transition">
              Approve Takeoff
            </button>
          )}
          <button onClick={addItem} className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm font-medium rounded-lg transition">
            + Add Item
          </button>
          <button
            onClick={generateQuote}
            disabled={generatingQuote}
            className="px-6 py-2 bg-[#C6A24E] hover:bg-[#A8882A] text-white text-sm font-semibold rounded-lg transition disabled:opacity-50"
          >
            {generatingQuote ? 'Generating...' : 'Generate Quote →'}
          </button>
        </div>
      </div>

      {/* Stats Bar */}
      <div className="grid grid-cols-5 gap-3 mb-6">
        <div className="bg-white rounded-lg border p-3 text-center">
          <p className="text-2xl font-bold text-[#0f2a3e]">{items.length}</p>
          <p className="text-xs text-gray-500">Items</p>
        </div>
        <div className="bg-white rounded-lg border p-3 text-center">
          <p className="text-2xl font-bold text-green-600">{matchedCount}</p>
          <p className="text-xs text-gray-500">Matched</p>
        </div>
        <div className="bg-white rounded-lg border p-3 text-center">
          <p className={`text-2xl font-bold ${unmatchedCount > 0 ? 'text-signal' : 'text-gray-400'}`}>{unmatchedCount}</p>
          <p className="text-xs text-gray-500">Unmatched</p>
        </div>
        <div className="bg-white rounded-lg border p-3 text-center">
          <p className="text-2xl font-bold text-[#0f2a3e]">${estimatedTotal.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</p>
          <p className="text-xs text-gray-500">Est. Total</p>
        </div>
        <div className="bg-white rounded-lg border p-3 text-center">
          <p className={`text-2xl font-bold ${takeoff.status === 'APPROVED' ? 'text-green-600' : 'text-signal'}`}>
            {takeoff.status === 'APPROVED' ? '✓' : '⏳'}
          </p>
          <p className="text-xs text-gray-500">{takeoff.status === 'APPROVED' ? 'Approved' : 'Needs Review'}</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={() => setFilter('all')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${filter === 'all' ? 'bg-[#0f2a3e] text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
          >
            All ({items.length})
          </button>
          {categories.map(cat => (
            <button
              key={cat}
              onClick={() => setFilter(filter === cat ? 'all' : cat)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${filter === cat ? 'bg-[#0f2a3e] text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
            >
              {CATEGORY_ICONS[cat] || '📋'} {cat} ({items.filter(i => i.category === cat).length})
            </button>
          ))}
        </div>
        <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
          <button onClick={() => setViewMode('room')} className={`px-3 py-1 text-xs font-medium rounded-md transition ${viewMode === 'room' ? 'bg-white shadow text-gray-900' : 'text-gray-500'}`}>By Room</button>
          <button onClick={() => setViewMode('category')} className={`px-3 py-1 text-xs font-medium rounded-md transition ${viewMode === 'category' ? 'bg-white shadow text-gray-900' : 'text-gray-500'}`}>By Category</button>
        </div>
      </div>

      {/* Items */}
      <div className="space-y-4">
        {Object.entries(grouped).map(([groupName, groupItems]) => (
          <div key={groupName} className="bg-white rounded-xl border overflow-hidden">
            <div className="bg-gray-50 px-4 py-3 border-b flex items-center justify-between">
              <h3 className="font-medium text-gray-900">{groupName}</h3>
              <span className="text-xs text-gray-500">{groupItems.length} items &middot; ${groupItems.reduce((s, i) => i.product ? s + i.product.basePrice * i.quantity : s, 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
            </div>
            <div className="divide-y">
              {groupItems.map(item => {
                const isEditing = editingItem === item.id
                const vals = editValues[item.id] || {}

                return (
                  <div key={item.id} className={`px-4 py-3 ${isEditing ? 'bg-blue-50/50' : 'hover:bg-gray-50'}`}>
                    {isEditing ? (
                      /* Edit Mode */
                      <div className="space-y-3">
                        <div className="grid grid-cols-12 gap-3">
                          <div className="col-span-5">
                            <label className="text-xs text-gray-500 mb-1 block">Description</label>
                            <input
                              type="text"
                              value={vals.description ?? item.description}
                              onChange={e => setEditValues((p: any) => ({ ...p, [item.id]: { ...vals, description: e.target.value } }))}
                              className="w-full px-3 py-1.5 border rounded text-sm focus:ring-2 focus:ring-[#0f2a3e]/20"
                            />
                          </div>
                          <div className="col-span-2">
                            <label className="text-xs text-gray-500 mb-1 block">Category</label>
                            <select
                              value={vals.category ?? item.category}
                              onChange={e => setEditValues((p: any) => ({ ...p, [item.id]: { ...vals, category: e.target.value } }))}
                              className="w-full px-3 py-1.5 border rounded text-sm"
                            >
                              {Object.keys(CATEGORY_ICONS).map(c => <option key={c} value={c}>{c}</option>)}
                            </select>
                          </div>
                          <div className="col-span-2">
                            <label className="text-xs text-gray-500 mb-1 block">Qty</label>
                            <input
                              type="number"
                              min="0"
                              value={vals.quantity ?? item.quantity}
                              onChange={e => setEditValues((p: any) => ({ ...p, [item.id]: { ...vals, quantity: parseInt(e.target.value) || 0 } }))}
                              className="w-full px-3 py-1.5 border rounded text-sm focus:ring-2 focus:ring-[#0f2a3e]/20"
                            />
                          </div>
                          <div className="col-span-3">
                            <label className="text-xs text-gray-500 mb-1 block">Swap Product</label>
                            <input
                              type="text"
                              placeholder="Search SKU or name..."
                              value={productSearch}
                              onChange={e => { setProductSearch(e.target.value); searchProducts(e.target.value) }}
                              className="w-full px-3 py-1.5 border rounded text-sm focus:ring-2 focus:ring-[#0f2a3e]/20"
                            />
                            {productResults.length > 0 && (
                              <div className="absolute z-10 mt-1 bg-white border rounded-lg shadow-lg max-h-48 overflow-y-auto w-72">
                                {productResults.map((p: any) => (
                                  <button
                                    key={p.id}
                                    onClick={() => {
                                      setEditValues((prev: any) => ({ ...prev, [item.id]: { ...vals, productId: p.id } }))
                                      setProductSearch(`${p.sku} — ${p.name}`)
                                      setProductResults([])
                                    }}
                                    className="w-full text-left px-3 py-2 hover:bg-gray-50 text-xs border-b"
                                  >
                                    <span className="font-medium">{p.sku}</span> — {p.name}
                                    <span className="text-gray-400 ml-2">${p.basePrice?.toFixed(2)}</span>
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                        <div className="flex gap-2 justify-end">
                          <button
                            onClick={() => { setEditingItem(null); setProductSearch('') }}
                            className="px-3 py-1.5 text-xs text-gray-500 hover:bg-gray-100 rounded"
                          >
                            Cancel
                          </button>
                          <button
                            onClick={() => { saveItemEdit(item.id); setProductSearch('') }}
                            disabled={saving}
                            className="px-4 py-1.5 text-xs bg-[#0f2a3e] text-white rounded hover:bg-[#0a1a28] disabled:opacity-50"
                          >
                            {saving ? 'Saving...' : 'Save Changes'}
                          </button>
                        </div>
                      </div>
                    ) : (
                      /* View Mode */
                      <div className="flex items-center justify-between group">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-xs px-2 py-0.5 rounded bg-gray-100 text-gray-600 font-medium">
                              {CATEGORY_ICONS[item.category] || '📋'} {item.category}
                            </span>
                            {item.product ? (
                              <span className="text-xs px-2 py-0.5 bg-green-100 text-green-700 rounded">
                                ✓ {item.product.sku}
                              </span>
                            ) : (
                              <span className="text-xs px-2 py-0.5 bg-yellow-100 text-yellow-700 rounded">
                                Unmatched
                              </span>
                            )}
                            {item.confidence && item.confidence < 0.88 && (
                              <span className="text-xs px-2 py-0.5 bg-red-100 text-red-700 rounded">Low confidence</span>
                            )}
                          </div>
                          <p className="text-sm text-gray-800 mt-1">{item.description}</p>
                          {item.product && (
                            <p className="text-xs text-gray-500 mt-0.5">
                              → {item.product.name} @ ${item.product.basePrice.toFixed(2)}
                            </p>
                          )}
                        </div>
                        <div className="flex items-center gap-4">
                          <div className="text-right">
                            <p className="text-lg font-semibold text-gray-900">{item.quantity}</p>
                            {item.product && (
                              <p className="text-xs text-green-600 font-medium">
                                ${(item.product.basePrice * item.quantity).toFixed(2)}
                              </p>
                            )}
                          </div>
                          <div className="opacity-0 group-hover:opacity-100 transition flex gap-1">
                            <button
                              onClick={() => {
                                setEditingItem(item.id)
                                setEditValues((p: any) => ({
                                  ...p,
                                  [item.id]: { description: item.description, quantity: item.quantity, category: item.category }
                                }))
                              }}
                              className="p-1.5 text-gray-400 hover:text-[#0f2a3e] hover:bg-blue-50 rounded"
                              title="Edit"
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                              </svg>
                            </button>
                            <button
                              onClick={() => deleteItem(item.id)}
                              className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded"
                              title="Delete"
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                              </svg>
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Bottom Bar */}
      <div className="mt-6 flex justify-between items-center bg-white rounded-xl border p-4">
        <div className="text-lg font-semibold text-gray-900">
          Estimated Total: <span className="text-green-600">${estimatedTotal.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
        </div>
        <div className="flex gap-2">
          {takeoff.status === 'NEEDS_REVIEW' && (
            <button onClick={approveTakeoff} className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white text-sm font-medium rounded-lg">
              Approve Takeoff
            </button>
          )}
          <button
            onClick={generateQuote}
            disabled={generatingQuote}
            className="px-8 py-2 bg-[#C6A24E] hover:bg-[#A8882A] text-white font-semibold rounded-lg shadow transition disabled:opacity-50"
          >
            {generatingQuote ? 'Generating...' : 'Generate Quote →'}
          </button>
        </div>
      </div>
    </div>
  )
}
