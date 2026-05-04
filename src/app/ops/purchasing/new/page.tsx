'use client'

import { useState, useEffect } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import React, { Suspense } from 'react'
import { ArrowLeft, CheckCircle2, AlertTriangle } from 'lucide-react'
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
  unitCost: number
  onHand: number
  reorderPoint: number
  reorderQty: number
}

function NewPOForm() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const productId = searchParams.get('product')

  const [product, setProduct] = useState<ProductInfo | null>(null)
  const [vendors, setVendors] = useState<Vendor[]>([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState('')

  const [form, setForm] = useState({
    vendorId: '',
    quantity: 0,
    unitCost: 0,
    notes: '',
    priority: 'NORMAL',
    expectedDate: '',
  })

  useEffect(() => {
    fetchData()
  }, [productId])

  async function fetchData() {
    setLoading(true)
    try {
      // Fetch vendors
      const vendorRes = await fetch('/api/ops/vendors?status=active&limit=200')
      if (vendorRes.ok) {
        const vData = await vendorRes.json()
        setVendors(Array.isArray(vData) ? vData : (vData.vendors || vData.data || []))
      }

      // Fetch product info if productId provided
      if (productId) {
        const prodRes = await fetch(`/api/ops/procurement/inventory?search=${productId}`)
        if (prodRes.ok) {
          const pData = await prodRes.json()
          const items = pData.inventory || []
          const found = items.find((i: any) => i.id === productId)
          if (found) {
            setProduct(found)
            setForm(prev => ({
              ...prev,
              quantity: Math.max(found.reorderQty || 0, found.reorderPoint - found.onHand),
              unitCost: found.unitCost || 0,
            }))
          }
        }
      }
    } catch {
      // silent
    } finally {
      setLoading(false)
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.vendorId) { setError('Please select a vendor'); return }
    if (form.quantity <= 0) { setError('Quantity must be greater than 0'); return }

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
          expectedDeliveryDate: form.expectedDate || null,
          items: productId ? [{
            productId,
            productName: product?.name || '',
            sku: product?.sku || '',
            quantity: form.quantity,
            unitCost: form.unitCost,
          }] : [],
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

  const totalCost = form.quantity * form.unitCost
  const lowStock = product && (product.onHand || 0) <= (product.reorderPoint || 0)

  return (
    <div className="space-y-5 animate-enter max-w-3xl">
      <PageHeader
        eyebrow="Procurement"
        title="Create Purchase Order"
        description={product ? `Reorder: ${product.name}` : 'Create a new purchase order.'}
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

      {/* Product Info Card */}
      {product && (
        <Card variant="default" padding="md">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="font-semibold text-fg truncate">{product.name}</div>
              <div className="text-xs text-fg-muted mt-0.5 font-mono">
                SKU: {product.sku} <span className="text-fg-subtle">·</span> {product.category}
              </div>
            </div>
            <div className="text-right shrink-0">
              <div className="eyebrow">Current Stock</div>
              <div
                className={cn(
                  'metric metric-md tabular-nums mt-0.5',
                  lowStock ? 'text-data-negative' : 'text-data-positive'
                )}
              >
                {product.onHand}
              </div>
              <div className="text-[11px] text-fg-subtle">Reorder at {product.reorderPoint}</div>
            </div>
          </div>
        </Card>
      )}

      {/* Form */}
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

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-fg-muted mb-1">
                Quantity <span className="text-data-negative">*</span>
              </label>
              <input
                type="number"
                value={form.quantity}
                onChange={e => setForm({ ...form, quantity: Number(e.target.value) })}
                className="input w-full tabular-nums"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-fg-muted mb-1">Unit Cost ($)</label>
              <input
                type="number"
                step="0.01"
                value={form.unitCost}
                onChange={e => setForm({ ...form, unitCost: Number(e.target.value) })}
                className="input w-full tabular-nums"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-fg-muted mb-1">Expected Date</label>
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
            <div className="text-sm font-medium text-fg-muted">Estimated Total</div>
            <div className="metric metric-lg tabular-nums text-data-positive">
              ${totalCost.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
          </div>

          <div className="flex items-center gap-2 pt-2">
            <button
              type="submit"
              disabled={submitting}
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
    <Suspense
      fallback={
        <div className="flex items-center justify-center py-10 text-sm text-fg-muted">
          Loading…
        </div>
      }
    >
      <NewPOForm />
    </Suspense>
  )
}
