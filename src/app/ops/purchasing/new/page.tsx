'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import React, { Suspense } from 'react'
import { ArrowLeft, CheckCircle2, AlertTriangle, Search, Plus, Trash2, Package } from 'lucide-react'
import { PageHeader, Card } from '@/components/ui'
import { cn } from '@/lib/utils'

interface Vendor {
  id: string
  name: string
  email?: string
}

interface ProductInfo {
  id: string
  name: string
  sku: string
  category: string
  cost: number
  basePrice: number
  onHand?: number
  reorderPoint?: number
  reorderQty?: number
}

interface LineItem {
  key: string // client-side key for React
  productId: string
  productName: string
  sku: string
  category: string
  quantity: number
  unitCost: number
  onHand?: number
}

function NewPOForm() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const productId = searchParams.get('product')

  const [vendors, setVendors] = useState<Vendor[]>([])
  const [lineItems, setLineItems] = useState<LineItem[]>([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState('')

  // Product search state
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<ProductInfo[]>([])
  const [searching, setSearching] = useState(false)
  const [showResults, setShowResults] = useState(false)
  const searchRef = useRef<HTMLDivElement>(null)
  const searchTimeout = useRef<NodeJS.Timeout | null>(null)

  const [form, setForm] = useState({
    vendorId: '',
    notes: '',
    priority: 'NORMAL',
    expectedDate: '',
  })

  useEffect(() => {
    fetchInitialData()
  }, [productId])

  // Close search dropdown on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setShowResults(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  async function fetchInitialData() {
    setLoading(true)
    try {
      // Fetch vendors
      const vendorRes = await fetch('/api/ops/vendors?status=active&limit=200')
      if (vendorRes.ok) {
        const vData = await vendorRes.json()
        setVendors(Array.isArray(vData) ? vData : (vData.vendors || vData.data || []))
      }

      // Pre-fill product if arriving from inventory page with ?product=<id>
      if (productId) {
        const prodRes = await fetch(`/api/ops/products?search=${productId}&take=10`)
        if (prodRes.ok) {
          const pData = await prodRes.json()
          const items = Array.isArray(pData) ? pData : (pData.products || pData.data || [])
          const found = items.find((i: any) => i.id === productId || i.sku === productId)
          if (found) {
            addProductToLines(found)
          }
        }
      }
    } catch {
      // silent
    } finally {
      setLoading(false)
    }
  }

  // Debounced product search
  const handleSearch = useCallback((query: string) => {
    setSearchQuery(query)
    if (searchTimeout.current) clearTimeout(searchTimeout.current)

    if (query.length < 2) {
      setSearchResults([])
      setShowResults(false)
      return
    }

    setSearching(true)
    setShowResults(true)

    searchTimeout.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/ops/products?search=${encodeURIComponent(query)}&take=10`)
        if (res.ok) {
          const data = await res.json()
          const products = Array.isArray(data) ? data : (data.products || data.data || [])
          setSearchResults(products)
        }
      } catch {
        setSearchResults([])
      } finally {
        setSearching(false)
      }
    }, 300)
  }, [])

  function addProductToLines(product: ProductInfo) {
    // Don't add duplicates
    if (lineItems.some(li => li.productId === product.id)) {
      setError(`${product.sku} is already on this PO`)
      setTimeout(() => setError(''), 3000)
      return
    }

    const newLine: LineItem = {
      key: `${product.id}-${Date.now()}`,
      productId: product.id,
      productName: product.name,
      sku: product.sku,
      category: product.category || '',
      quantity: product.reorderQty || 1,
      unitCost: product.cost || 0,
      onHand: product.onHand,
    }
    setLineItems(prev => [...prev, newLine])
    setSearchQuery('')
    setSearchResults([])
    setShowResults(false)
  }

  function updateLineItem(key: string, field: keyof LineItem, value: number) {
    setLineItems(prev =>
      prev.map(li => (li.key === key ? { ...li, [field]: value } : li))
    )
  }

  function removeLineItem(key: string) {
    setLineItems(prev => prev.filter(li => li.key !== key))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.vendorId) { setError('Please select a vendor'); return }
    if (lineItems.length === 0) { setError('Add at least one product to the PO'); return }
    if (lineItems.some(li => li.quantity <= 0)) { setError('All quantities must be greater than 0'); return }

    setSubmitting(true)
    setError('')
    try {
      const res = await fetch('/api/ops/procurement/purchase-orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vendorId: form.vendorId,
          priority: form.priority,
          notes: form.notes,
          expectedDate: form.expectedDate || null,
          items: lineItems.map(li => ({
            productId: li.productId,
            productName: li.productName,
            sku: li.sku,
            quantity: li.quantity,
            unitCost: li.unitCost,
          })),
        }),
      })

      if (res.ok) {
        setSuccess(true)
        setTimeout(() => router.push('/ops/purchasing'), 2000)
      } else {
        const data = await res.json()
        setError(data.error || 'Failed to create PO')
      }
    } catch {
      setError('Failed to create purchase order')
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[300px] text-sm text-fg-muted">
        Loading…
      </div>
    )
  }

  if (success) {
    return (
      <div className="max-w-xl mx-auto py-10 text-center">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-data-positive-bg ring-1 ring-border mb-4">
          <CheckCircle2 className="w-8 h-8 text-data-positive" />
        </div>
        <h2 className="text-xl font-semibold text-fg mb-1">Purchase Order Created</h2>
        <p className="text-sm text-fg-muted">Redirecting to purchase orders…</p>
      </div>
    )
  }

  const totalCost = lineItems.reduce((sum, li) => sum + li.quantity * li.unitCost, 0)

  return (
    <div className="space-y-5 animate-enter max-w-3xl">
      <PageHeader
        eyebrow="Procurement"
        title="Create Purchase Order"
        description="Add products by BC code or name, select a vendor, and submit."
        crumbs={[
          { label: 'Ops', href: '/ops' },
          { label: 'Purchasing', href: '/ops/purchasing' },
          { label: 'New' },
        ]}
        actions={
          <button
            type="button"
            onClick={() => router.back()}
            className="btn btn-secondary btn-sm"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Back
          </button>
        }
      />

      {/* Product Search */}
      <Card variant="default" padding="md">
        <div className="flex items-center gap-2 mb-3">
          <Package className="w-4 h-4 text-fg-muted" />
          <span className="text-sm font-semibold text-fg">Add Products</span>
        </div>
        <div ref={searchRef} className="relative">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-fg-subtle" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => handleSearch(e.target.value)}
              onFocus={() => searchResults.length > 0 && setShowResults(true)}
              placeholder="Type BC code or product name… (e.g. BC003764)"
              className="input w-full pl-9"
              autoComplete="off"
            />
          </div>

          {/* Search Results Dropdown */}
          {showResults && (
            <div className="absolute z-50 top-full left-0 right-0 mt-1 panel border border-border rounded-lg shadow-lg max-h-64 overflow-y-auto">
              {searching ? (
                <div className="px-4 py-3 text-sm text-fg-muted">Searching…</div>
              ) : searchResults.length === 0 ? (
                <div className="px-4 py-3 text-sm text-fg-muted">
                  {searchQuery.length >= 2 ? 'No products found' : 'Type at least 2 characters'}
                </div>
              ) : (
                searchResults.map(product => {
                  const alreadyAdded = lineItems.some(li => li.productId === product.id)
                  return (
                    <button
                      key={product.id}
                      type="button"
                      disabled={alreadyAdded}
                      onClick={() => addProductToLines(product)}
                      className={cn(
                        'w-full px-4 py-2.5 text-left flex items-center justify-between gap-3 transition-colors',
                        alreadyAdded
                          ? 'opacity-40 cursor-not-allowed'
                          : 'hover:bg-surface-hover cursor-pointer'
                      )}
                    >
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-fg truncate">{product.name}</div>
                        <div className="text-xs text-fg-muted font-mono mt-0.5">
                          {product.sku}
                          <span className="text-fg-subtle"> · </span>
                          {product.category}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-xs text-fg-muted">
                          Cost: ${(product.cost || 0).toFixed(2)}
                        </div>
                        {product.onHand !== undefined && (
                          <div className="text-xs text-fg-subtle">
                            Stock: {product.onHand}
                          </div>
                        )}
                      </div>
                      {!alreadyAdded && (
                        <Plus className="w-4 h-4 text-fg-muted shrink-0" />
                      )}
                    </button>
                  )
                })
              )}
            </div>
          )}
        </div>
      </Card>

      {/* Line Items */}
      {lineItems.length > 0 && (
        <Card variant="default" padding="md">
          <div className="text-sm font-semibold text-fg mb-3">
            Line Items ({lineItems.length})
          </div>

          {/* Header */}
          <div className="hidden md:grid grid-cols-[1fr_80px_100px_100px_32px] gap-2 px-1 pb-2 border-b border-border">
            <div className="text-[11px] font-medium text-fg-subtle uppercase tracking-wider">Product</div>
            <div className="text-[11px] font-medium text-fg-subtle uppercase tracking-wider text-right">Qty</div>
            <div className="text-[11px] font-medium text-fg-subtle uppercase tracking-wider text-right">Unit Cost</div>
            <div className="text-[11px] font-medium text-fg-subtle uppercase tracking-wider text-right">Line Total</div>
            <div />
          </div>

          {/* Rows */}
          <div className="divide-y divide-border">
            {lineItems.map(li => (
              <div key={li.key} className="grid grid-cols-1 md:grid-cols-[1fr_80px_100px_100px_32px] gap-2 py-2.5 px-1 items-center">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-fg truncate">{li.productName}</div>
                  <div className="text-xs text-fg-muted font-mono">{li.sku}</div>
                  {li.onHand !== undefined && (
                    <div className="text-[11px] text-fg-subtle">On hand: {li.onHand}</div>
                  )}
                </div>
                <div>
                  <input
                    type="number"
                    min={1}
                    value={li.quantity}
                    onChange={e => updateLineItem(li.key, 'quantity', Number(e.target.value))}
                    className="input w-full text-right tabular-nums text-sm"
                  />
                </div>
                <div>
                  <input
                    type="number"
                    step="0.01"
                    min={0}
                    value={li.unitCost}
                    onChange={e => updateLineItem(li.key, 'unitCost', Number(e.target.value))}
                    className="input w-full text-right tabular-nums text-sm"
                  />
                </div>
                <div className="text-sm tabular-nums text-right text-fg font-medium self-center">
                  ${(li.quantity * li.unitCost).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
                <button
                  type="button"
                  onClick={() => removeLineItem(li.key)}
                  className="text-fg-subtle hover:text-data-negative transition-colors self-center justify-self-center"
                  title="Remove item"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* PO Details Form */}
      <Card variant="default" padding="md">
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="flex items-start gap-2 panel border-l-2 border-l-data-negative p-3">
              <AlertTriangle className="w-4 h-4 text-data-negative shrink-0 mt-0.5" />
              <div className="text-sm text-fg">{error}</div>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-fg-muted mb-1">
                Vendor <span className="text-data-negative">*</span>
              </label>
              <select
                value={form.vendorId}
                onChange={e => setForm({ ...form, vendorId: e.target.value })}
                className="input w-full"
              >
                <option value="">Select vendor…</option>
                {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-fg-muted mb-1">Priority</label>
              <select
                value={form.priority}
                onChange={e => setForm({ ...form, priority: e.target.value })}
                className="input w-full"
              >
                <option value="LOW">Low</option>
                <option value="NORMAL">Normal</option>
                <option value="HIGH">High</option>
                <option value="URGENT">Urgent</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-fg-muted mb-1">Expected Delivery Date</label>
              <input
                type="date"
                value={form.expectedDate}
                onChange={e => setForm({ ...form, expectedDate: e.target.value })}
                className="input w-full"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-fg-muted mb-1">Notes</label>
            <textarea
              value={form.notes}
              onChange={e => setForm({ ...form, notes: e.target.value })}
              rows={3}
              placeholder="Any special instructions…"
              className="input w-full resize-y"
            />
          </div>

          {/* Total */}
          <div className="panel border-l-2 border-l-data-positive p-4 flex items-center justify-between">
            <div className="text-sm font-medium text-fg-muted">
              Estimated Total
              {lineItems.length > 0 && (
                <span className="text-fg-subtle"> ({lineItems.length} item{lineItems.length !== 1 ? 's' : ''})</span>
              )}
            </div>
            <div className="metric metric-lg tabular-nums text-data-positive">
              ${totalCost.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
          </div>

          <div className="flex items-center gap-2 pt-2">
            <button
              type="submit"
              disabled={submitting || lineItems.length === 0}
              className="btn btn-primary btn-md flex-1"
            >
              {submitting ? 'Creating PO…' : 'Create Purchase Order'}
            </button>
            <button
              type="button"
              onClick={() => router.push('/ops/purchasing')}
              className="btn btn-secondary btn-md"
            >
              Cancel
            </button>
          </div>
        </form>
      </Card>
    </div>
  )
}

export default function NewPurchaseOrderPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center min-h-[300px] text-sm text-fg-muted">
        Loading…
      </div>
    }>
      <NewPOForm />
    </Suspense>
  )
}
