'use client'

import { useState, useEffect } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import React, { Suspense } from 'react'

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
      const vendorRes = await fetch('/api/ops/vendors?active=true')
      if (vendorRes.ok) {
        const vData = await vendorRes.json()
        setVendors(vData.vendors || [])
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
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 300, color: '#6B7280' }}>
        Loading...
      </div>
    )
  }

  if (success) {
    return (
      <div style={{ maxWidth: 600, margin: '40px auto', textAlign: 'center', padding: 40 }}>
        <div style={{ fontSize: 64, marginBottom: 16 }}>✅</div>
        <h2 style={{ color: '#16A34A', fontSize: 24, fontWeight: 700, marginBottom: 8 }}>Purchase Order Created!</h2>
        <p style={{ color: '#6B7280' }}>Redirecting to purchase orders...</p>
      </div>
    )
  }

  const totalCost = form.quantity * form.unitCost

  return (
    <div style={{ maxWidth: 700, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: '#0f2a3e', margin: 0 }}>Create Purchase Order</h1>
          <p style={{ color: '#6B7280', fontSize: 14, marginTop: 4 }}>
            {product ? `Reorder: ${product.name}` : 'Create a new purchase order'}
          </p>
        </div>
        <button onClick={() => router.back()}
          style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid #D1D5DB', background: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
          ← Back
        </button>
      </div>

      {/* Product Info Card */}
      {product && (
        <div style={{ background: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: 12, padding: 20, marginBottom: 24 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: 16, color: '#0f2a3e' }}>{product.name}</div>
              <div style={{ fontSize: 13, color: '#6B7280', marginTop: 2 }}>SKU: {product.sku} • {product.category}</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 13, color: '#6B7280' }}>Current Stock</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: (product.onHand || 0) <= (product.reorderPoint || 0) ? '#DC2626' : '#16A34A' }}>
                {product.onHand}
              </div>
              <div style={{ fontSize: 11, color: '#9CA3AF' }}>Reorder at {product.reorderPoint}</div>
            </div>
          </div>
        </div>
      )}

      {/* Form */}
      <form onSubmit={handleSubmit} style={{ background: '#fff', borderRadius: 12, border: '1px solid #E5E7EB', padding: 24 }}>
        {error && (
          <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8, padding: 12, marginBottom: 16, color: '#DC2626', fontSize: 14 }}>
            {error}
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
          <div>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 4 }}>Vendor *</label>
            <select value={form.vendorId} onChange={e => setForm({ ...form, vendorId: e.target.value })}
              style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #D1D5DB', fontSize: 14 }}>
              <option value="">Select vendor...</option>
              {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 4 }}>Priority</label>
            <select value={form.priority} onChange={e => setForm({ ...form, priority: e.target.value })}
              style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #D1D5DB', fontSize: 14 }}>
              <option value="LOW">Low</option>
              <option value="NORMAL">Normal</option>
              <option value="HIGH">High</option>
              <option value="URGENT">Urgent</option>
            </select>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16, marginBottom: 16 }}>
          <div>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 4 }}>Quantity *</label>
            <input type="number" value={form.quantity} onChange={e => setForm({ ...form, quantity: Number(e.target.value) })}
              style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #D1D5DB', fontSize: 14 }} />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 4 }}>Unit Cost ($)</label>
            <input type="number" step="0.01" value={form.unitCost} onChange={e => setForm({ ...form, unitCost: Number(e.target.value) })}
              style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #D1D5DB', fontSize: 14 }} />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 4 }}>Expected Date</label>
            <input type="date" value={form.expectedDate} onChange={e => setForm({ ...form, expectedDate: e.target.value })}
              style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #D1D5DB', fontSize: 14 }} />
          </div>
        </div>

        <div style={{ marginBottom: 16 }}>
          <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 4 }}>Notes</label>
          <textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} rows={3}
            placeholder="Any special instructions..."
            style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #D1D5DB', fontSize: 14, resize: 'vertical' }} />
        </div>

        {/* Total */}
        <div style={{ background: '#F0FDF4', border: '1px solid #BBF7D0', borderRadius: 8, padding: 16, marginBottom: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: '#166534' }}>Estimated Total</div>
          <div style={{ fontSize: 24, fontWeight: 800, color: '#166534' }}>
            ${totalCost.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 12 }}>
          <button type="submit" disabled={submitting}
            style={{ flex: 1, padding: '12px 24px', borderRadius: 8, border: 'none', background: submitting ? '#9CA3AF' : '#C6A24E', color: '#fff', fontWeight: 700, fontSize: 15, cursor: submitting ? 'default' : 'pointer' }}>
            {submitting ? 'Creating PO...' : 'Create Purchase Order'}
          </button>
          <button type="button" onClick={() => router.push('/ops/purchasing')}
            style={{ padding: '12px 24px', borderRadius: 8, border: '1px solid #D1D5DB', background: '#fff', cursor: 'pointer', fontWeight: 600, fontSize: 14 }}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  )
}

export default function NewPurchaseOrderPage() {
  return (
    <Suspense fallback={<div style={{ display: 'flex', justifyContent: 'center', padding: 40, color: '#6B7280' }}>Loading...</div>}>
      <NewPOForm />
    </Suspense>
  )
}
