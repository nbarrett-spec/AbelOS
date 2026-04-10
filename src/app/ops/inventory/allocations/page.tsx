'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

interface ProductInventory {
  id: string
  sku: string
  name: string
  onHand: number
  committed: number
  available: number
  onOrder: number
}

interface Allocation {
  id: string
  productId: string
  productSku: string
  productName: string
  orderNumber: string
  jobNumber: string
  quantityAllocated: number
  type: 'SALES_ORDER' | 'JOB' | 'HOLD' | 'TRANSFER'
  status: 'RESERVED' | 'PICKED' | 'RELEASED'
  allocatedAt: string
}

interface BulkAllocationResult {
  success: boolean
  allocated: Array<{
    sku: string
    name: string
    quantity: number
  }>
  insufficient: Array<{
    sku: string
    name: string
    requested: number
    available: number
    shortfall: number
    vendors: Array<{ name: string; leadTime: string }>
  }>
}

export default function AllocationManagementPage() {
  const router = useRouter()
  const NAVY = '#1B4F72'
  const ORANGE = '#E67E22'

  // Summary data
  const [stats, setStats] = useState({
    totalOnHand: 0,
    totalCommitted: 0,
    totalAvailable: 0,
    activeAllocations: 0,
  })

  // Allocations table
  const [allocations, setAllocations] = useState<Allocation[]>([])
  const [allocLoading, setAllocLoading] = useState(true)
  const [orderFilter, setOrderFilter] = useState('')
  const [productFilter, setProductFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('All')

  // Quick allocate panel
  const [products, setProducts] = useState<ProductInventory[]>([])
  const [selectedProduct, setSelectedProduct] = useState<ProductInventory | null>(null)
  const [searchInput, setSearchInput] = useState('')
  const [showProducts, setShowProducts] = useState(false)
  const [allocQty, setAllocQty] = useState('')
  const [allocOrderNum, setAllocOrderNum] = useState('')
  const [allocJobNum, setAllocJobNum] = useState('')
  const [allocType, setAllocType] = useState<'SALES_ORDER' | 'JOB' | 'HOLD' | 'TRANSFER'>('SALES_ORDER')
  const [allocNotes, setAllocNotes] = useState('')
  const [allocating, setAllocating] = useState(false)

  // Bulk allocation
  const [bulkOrderNum, setBulkOrderNum] = useState('')
  const [bulkProcessing, setBulkProcessing] = useState(false)
  const [bulkResult, setBulkResult] = useState<BulkAllocationResult | null>(null)

  // Toast
  const [toast, setToast] = useState('')
  const [toastType, setToastType] = useState<'success' | 'error' | 'warning'>('success')
  const showToast = (msg: string, type: 'success' | 'error' | 'warning' = 'success') => {
    setToast(msg)
    setToastType(type)
    setTimeout(() => setToast(''), 3500)
  }

  // Load allocations
  async function loadAllocations() {
    setAllocLoading(true)
    try {
      const params = new URLSearchParams({
        ...(orderFilter && { order: orderFilter }),
        ...(productFilter && { product: productFilter }),
        ...(statusFilter !== 'All' && { status: statusFilter }),
      })
      const resp = await fetch(`/api/ops/inventory/allocations?${params}`)
      const data = await resp.json()
      setAllocations(data.allocations || [])
      if (data.stats) {
        setStats(data.stats)
      }
    } catch (err) {
      console.error('Failed to load allocations:', err)
      showToast('Failed to load allocations', 'error')
    } finally {
      setAllocLoading(false)
    }
  }

  // Load products for search
  async function loadProducts(search: string) {
    try {
      const params = new URLSearchParams({ search, limit: '10' })
      const resp = await fetch(`/api/ops/inventory/products?${params}`)
      const data = await resp.json()
      setProducts(data.products || [])
      setShowProducts(true)
    } catch (err) {
      console.error('Failed to load products:', err)
    }
  }

  useEffect(() => { loadAllocations() }, [orderFilter, productFilter, statusFilter])

  // Handle product search
  const handleProductSearch = (value: string) => {
    setSearchInput(value)
    if (value.length >= 2) {
      loadProducts(value)
    } else {
      setShowProducts(false)
      setProducts([])
    }
  }

  // Select product from dropdown
  const selectProduct = (product: ProductInventory) => {
    setSelectedProduct(product)
    setSearchInput('')
    setShowProducts(false)
  }

  // Release allocation
  const handleRelease = async (allocationId: string) => {
    try {
      const resp = await fetch(`/api/ops/inventory/allocations/${allocationId}`, {
        method: 'DELETE',
      })
      if (resp.ok) {
        showToast('Allocation released successfully', 'success')
        loadAllocations()
      } else {
        showToast('Failed to release allocation', 'error')
      }
    } catch (err) {
      console.error('Failed to release allocation:', err)
      showToast('Failed to release allocation', 'error')
    }
  }

  // Create allocation
  const handleAllocate = async () => {
    if (!selectedProduct || !allocQty || (!allocOrderNum && !allocJobNum)) {
      showToast('Please fill in all required fields', 'warning')
      return
    }

    const qty = parseInt(allocQty)
    if (qty <= 0 || qty > selectedProduct.available) {
      showToast('Invalid quantity or insufficient stock', 'error')
      return
    }

    setAllocating(true)
    try {
      const resp = await fetch('/api/ops/inventory/allocations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productId: selectedProduct.id,
          orderNumber: allocOrderNum || null,
          jobNumber: allocJobNum || null,
          quantityToAllocate: qty,
          type: allocType,
          notes: allocNotes,
        }),
      })

      if (resp.ok) {
        showToast('Allocation created successfully', 'success')
        setSelectedProduct(null)
        setAllocQty('')
        setAllocOrderNum('')
        setAllocJobNum('')
        setAllocNotes('')
        loadAllocations()
      } else {
        const error = await resp.json()
        showToast(error.message || 'Failed to create allocation', 'error')
      }
    } catch (err) {
      console.error('Failed to create allocation:', err)
      showToast('Failed to create allocation', 'error')
    } finally {
      setAllocating(false)
    }
  }

  // Bulk allocate
  const handleBulkAllocate = async () => {
    if (!bulkOrderNum) {
      showToast('Please select an order', 'warning')
      return
    }

    setBulkProcessing(true)
    try {
      const resp = await fetch('/api/ops/inventory/allocations/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderNumber: bulkOrderNum }),
      })

      if (resp.ok) {
        const result = await resp.json()
        setBulkResult(result)
        showToast('Bulk allocation completed', 'success')
        loadAllocations()
      } else {
        showToast('Failed to process bulk allocation', 'error')
      }
    } catch (err) {
      console.error('Failed to bulk allocate:', err)
      showToast('Failed to process bulk allocation', 'error')
    } finally {
      setBulkProcessing(false)
    }
  }

  // Type badge color
  const typeColor = (type: string) => {
    switch (type) {
      case 'SALES_ORDER': return '#3B82F6'
      case 'JOB': return '#8B5CF6'
      case 'HOLD': return ORANGE
      case 'TRANSFER': return '#6B7280'
      default: return '#6B7280'
    }
  }

  // Status badge color
  const statusColor = (status: string) => {
    switch (status) {
      case 'RESERVED': return '#FBBF24'
      case 'PICKED': return '#34D399'
      case 'RELEASED': return '#EF4444'
      default: return '#6B7280'
    }
  }

  return (
    <div style={{ padding: '24px', backgroundColor: '#F9FAFB', minHeight: '100vh' }}>
      {/* Header */}
      <div style={{ marginBottom: '32px' }}>
        <h1 style={{ fontSize: '32px', fontWeight: 'bold', color: NAVY, marginBottom: '8px' }}>
          Inventory Allocations
        </h1>
        <p style={{ color: '#6B7280', fontSize: '14px' }}>
          Manage inventory allocations to sales orders and jobs
        </p>
      </div>

      {/* Summary Cards */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
        gap: '16px',
        marginBottom: '32px',
      }}>
        {[
          { label: 'Total On Hand', value: stats.totalOnHand, color: '#10B981' },
          { label: 'Total Committed', value: stats.totalCommitted, color: ORANGE },
          { label: 'Total Available', value: stats.totalAvailable, color: '#3B82F6' },
          { label: 'Active Allocations', value: stats.activeAllocations, color: NAVY },
        ].map((card, idx) => (
          <div
            key={idx}
            style={{
              backgroundColor: 'white',
              border: `1px solid #E5E7EB`,
              borderRadius: '8px',
              padding: '16px',
              boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
            }}
          >
            <p style={{ color: '#6B7280', fontSize: '12px', fontWeight: '500', marginBottom: '8px' }}>
              {card.label}
            </p>
            <p style={{ fontSize: '24px', fontWeight: 'bold', color: card.color }}>
              {card.value}
            </p>
          </div>
        ))}
      </div>

      {/* Two-Column Layout */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px', marginBottom: '32px' }}>
        {/* Left Column: Active Allocations */}
        <div style={{ backgroundColor: 'white', borderRadius: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
          <div style={{ padding: '16px', borderBottom: '1px solid #E5E7EB' }}>
            <h2 style={{ fontSize: '18px', fontWeight: '600', color: NAVY, marginBottom: '12px' }}>
              Active Allocations
            </h2>

            {/* Filters */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px' }}>
              <input
                type="text"
                placeholder="Filter by order..."
                value={orderFilter}
                onChange={(e) => setOrderFilter(e.target.value)}
                style={{
                  padding: '8px 12px',
                  border: '1px solid #D1D5DB',
                  borderRadius: '4px',
                  fontSize: '13px',
                }}
              />
              <input
                type="text"
                placeholder="Filter by product..."
                value={productFilter}
                onChange={(e) => setProductFilter(e.target.value)}
                style={{
                  padding: '8px 12px',
                  border: '1px solid #D1D5DB',
                  borderRadius: '4px',
                  fontSize: '13px',
                }}
              />
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                style={{
                  padding: '8px 12px',
                  border: '1px solid #D1D5DB',
                  borderRadius: '4px',
                  fontSize: '13px',
                  backgroundColor: 'white',
                }}
              >
                <option value="All">All Status</option>
                <option value="RESERVED">Reserved</option>
                <option value="PICKED">Picked</option>
                <option value="RELEASED">Released</option>
              </select>
            </div>
          </div>

          {/* Table */}
          <div style={{ padding: '16px', overflowX: 'auto' }}>
            {allocLoading ? (
              <div style={{ textAlign: 'center', padding: '24px', color: '#9CA3AF' }}>
                Loading allocations...
              </div>
            ) : allocations.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '24px', color: '#9CA3AF' }}>
                No allocations found
              </div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                <thead>
                  <tr style={{ borderBottom: `2px solid #E5E7EB` }}>
                    <th style={{ textAlign: 'left', padding: '12px', color: NAVY, fontWeight: '600' }}>Product</th>
                    <th style={{ textAlign: 'left', padding: '12px', color: NAVY, fontWeight: '600' }}>Order #</th>
                    <th style={{ textAlign: 'left', padding: '12px', color: NAVY, fontWeight: '600' }}>Job #</th>
                    <th style={{ textAlign: 'center', padding: '12px', color: NAVY, fontWeight: '600' }}>Qty</th>
                    <th style={{ textAlign: 'left', padding: '12px', color: NAVY, fontWeight: '600' }}>Type</th>
                    <th style={{ textAlign: 'left', padding: '12px', color: NAVY, fontWeight: '600' }}>Status</th>
                    <th style={{ textAlign: 'left', padding: '12px', color: NAVY, fontWeight: '600' }}>Date</th>
                    <th style={{ textAlign: 'center', padding: '12px', color: NAVY, fontWeight: '600' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {allocations.map((alloc, idx) => (
                    <tr
                      key={alloc.id}
                      style={{
                        borderBottom: '1px solid #E5E7EB',
                        backgroundColor: idx % 2 === 0 ? '#FFFFFF' : '#F9FAFB',
                      }}
                    >
                      <td
                        style={{
                          padding: '12px',
                          cursor: 'pointer',
                          color: NAVY,
                          textDecoration: 'underline',
                        }}
                        onClick={() => router.push(`/ops/inventory/${alloc.productId}`)}
                      >
                        <div style={{ fontWeight: '500' }}>{alloc.productSku}</div>
                        <div style={{ color: '#6B7280', fontSize: '12px' }}>{alloc.productName}</div>
                      </td>
                      <td
                        style={{
                          padding: '12px',
                          cursor: 'pointer',
                          color: NAVY,
                          textDecoration: 'underline',
                        }}
                        onClick={() => router.push(`/ops/orders/${alloc.orderNumber}`)}
                      >
                        {alloc.orderNumber || '—'}
                      </td>
                      <td style={{ padding: '12px' }}>{alloc.jobNumber || '—'}</td>
                      <td style={{ padding: '12px', textAlign: 'center', fontWeight: '600' }}>
                        {alloc.quantityAllocated}
                      </td>
                      <td style={{ padding: '12px' }}>
                        <span
                          style={{
                            backgroundColor: typeColor(alloc.type),
                            color: 'white',
                            padding: '4px 8px',
                            borderRadius: '4px',
                            fontSize: '11px',
                            fontWeight: '600',
                          }}
                        >
                          {alloc.type}
                        </span>
                      </td>
                      <td style={{ padding: '12px' }}>
                        <span
                          style={{
                            backgroundColor: statusColor(alloc.status),
                            color: alloc.status === 'RESERVED' ? '#000' : 'white',
                            padding: '4px 8px',
                            borderRadius: '4px',
                            fontSize: '11px',
                            fontWeight: '600',
                          }}
                        >
                          {alloc.status}
                        </span>
                      </td>
                      <td style={{ padding: '12px', color: '#6B7280', fontSize: '12px' }}>
                        {new Date(alloc.allocatedAt).toLocaleDateString()}
                      </td>
                      <td style={{ padding: '12px', textAlign: 'center' }}>
                        {alloc.status === 'RESERVED' && (
                          <button
                            onClick={() => handleRelease(alloc.id)}
                            style={{
                              padding: '4px 8px',
                              backgroundColor: '#EF4444',
                              color: 'white',
                              border: 'none',
                              borderRadius: '4px',
                              cursor: 'pointer',
                              fontSize: '11px',
                              fontWeight: '600',
                            }}
                          >
                            Release
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* Right Column: Quick Allocate Panel */}
        <div style={{ backgroundColor: 'white', borderRadius: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
          <div style={{ padding: '16px', borderBottom: '1px solid #E5E7EB' }}>
            <h2 style={{ fontSize: '18px', fontWeight: '600', color: NAVY }}>Quick Allocate</h2>
          </div>

          <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {/* Product Search */}
            <div>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', marginBottom: '4px', color: NAVY }}>
                Product
              </label>
              <div style={{ position: 'relative' }}>
                <input
                  type="text"
                  placeholder="Search by SKU or name..."
                  value={searchInput}
                  onChange={(e) => handleProductSearch(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    border: '1px solid #D1D5DB',
                    borderRadius: '4px',
                    fontSize: '13px',
                    boxSizing: 'border-box',
                  }}
                />
                {showProducts && products.length > 0 && (
                  <div
                    style={{
                      position: 'absolute',
                      top: '100%',
                      left: 0,
                      right: 0,
                      backgroundColor: 'white',
                      border: '1px solid #D1D5DB',
                      borderRadius: '4px',
                      marginTop: '4px',
                      zIndex: 10,
                      maxHeight: '200px',
                      overflowY: 'auto',
                    }}
                  >
                    {products.map((p) => (
                      <div
                        key={p.id}
                        onClick={() => selectProduct(p)}
                        style={{
                          padding: '8px 12px',
                          cursor: 'pointer',
                          borderBottom: '1px solid #E5E7EB',
                          fontSize: '13px',
                        }}
                        onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#F3F4F6')}
                        onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'white')}
                      >
                        <div style={{ fontWeight: '500' }}>{p.sku} - {p.name}</div>
                        <div style={{ fontSize: '11px', color: '#6B7280' }}>
                          On Hand: {p.onHand} | Committed: {p.committed} | Available: {p.available}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              {selectedProduct && (
                <div style={{ marginTop: '8px', padding: '8px', backgroundColor: '#ECFDF5', borderRadius: '4px', fontSize: '12px' }}>
                  <div style={{ fontWeight: '600', color: NAVY }}>Selected: {selectedProduct.sku}</div>
                  <div style={{ color: '#6B7280', marginTop: '4px' }}>
                    On Hand: {selectedProduct.onHand} | Committed: {selectedProduct.committed} | Available: {selectedProduct.available}
                  </div>
                </div>
              )}
            </div>

            {/* Quantity */}
            <div>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', marginBottom: '4px', color: NAVY }}>
                Quantity to Allocate
              </label>
              <input
                type="number"
                min="1"
                value={allocQty}
                onChange={(e) => setAllocQty(e.target.value)}
                placeholder="0"
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  border: '1px solid #D1D5DB',
                  borderRadius: '4px',
                  fontSize: '13px',
                  boxSizing: 'border-box',
                }}
              />
              {selectedProduct && allocQty && (
                <div
                  style={{
                    marginTop: '8px',
                    fontSize: '11px',
                    color: parseInt(allocQty) > selectedProduct.available ? '#EF4444' : '#10B981',
                    fontWeight: '600',
                  }}
                >
                  {parseInt(allocQty) > selectedProduct.available ? (
                    <span>⚠️ Insufficient stock (need {parseInt(allocQty) - selectedProduct.available} more)</span>
                  ) : (
                    <span>✓ Available</span>
                  )}
                </div>
              )}
            </div>

            {/* Order Number */}
            <div>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', marginBottom: '4px', color: NAVY }}>
                Order #
              </label>
              <input
                type="text"
                value={allocOrderNum}
                onChange={(e) => setAllocOrderNum(e.target.value)}
                placeholder="Optional"
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  border: '1px solid #D1D5DB',
                  borderRadius: '4px',
                  fontSize: '13px',
                  boxSizing: 'border-box',
                }}
              />
            </div>

            {/* Job Number */}
            <div>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', marginBottom: '4px', color: NAVY }}>
                Job #
              </label>
              <input
                type="text"
                value={allocJobNum}
                onChange={(e) => setAllocJobNum(e.target.value)}
                placeholder="Optional"
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  border: '1px solid #D1D5DB',
                  borderRadius: '4px',
                  fontSize: '13px',
                  boxSizing: 'border-box',
                }}
              />
            </div>

            {/* Type */}
            <div>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', marginBottom: '4px', color: NAVY }}>
                Allocation Type
              </label>
              <select
                value={allocType}
                onChange={(e) => setAllocType(e.target.value as any)}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  border: '1px solid #D1D5DB',
                  borderRadius: '4px',
                  fontSize: '13px',
                  backgroundColor: 'white',
                  boxSizing: 'border-box',
                }}
              >
                <option value="SALES_ORDER">Sales Order</option>
                <option value="JOB">Job</option>
                <option value="HOLD">Hold</option>
                <option value="TRANSFER">Transfer</option>
              </select>
            </div>

            {/* Notes */}
            <div>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', marginBottom: '4px', color: NAVY }}>
                Notes
              </label>
              <textarea
                value={allocNotes}
                onChange={(e) => setAllocNotes(e.target.value)}
                placeholder="Add any notes..."
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  border: '1px solid #D1D5DB',
                  borderRadius: '4px',
                  fontSize: '13px',
                  boxSizing: 'border-box',
                  minHeight: '80px',
                  fontFamily: 'inherit',
                  resize: 'none',
                }}
              />
            </div>

            {/* Allocate Button */}
            <button
              onClick={handleAllocate}
              disabled={allocating || !selectedProduct}
              style={{
                padding: '10px 16px',
                backgroundColor: allocating ? '#D1D5DB' : NAVY,
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: allocating ? 'not-allowed' : 'pointer',
                fontWeight: '600',
                fontSize: '13px',
              }}
            >
              {allocating ? 'Allocating...' : 'Allocate'}
            </button>
          </div>
        </div>
      </div>

      {/* Bottom Section: Bulk Order Allocation */}
      <div style={{ backgroundColor: 'white', borderRadius: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
        <div style={{ padding: '16px', borderBottom: '1px solid #E5E7EB' }}>
          <h2 style={{ fontSize: '18px', fontWeight: '600', color: NAVY }}>Bulk Order Allocation</h2>
        </div>

        <div style={{ padding: '16px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 200px', gap: '12px', marginBottom: '16px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', marginBottom: '4px', color: NAVY }}>
                Select Order
              </label>
              <input
                type="text"
                placeholder="Enter order number..."
                value={bulkOrderNum}
                onChange={(e) => setBulkOrderNum(e.target.value)}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  border: '1px solid #D1D5DB',
                  borderRadius: '4px',
                  fontSize: '13px',
                  boxSizing: 'border-box',
                }}
              />
            </div>
            <button
              onClick={handleBulkAllocate}
              disabled={bulkProcessing || !bulkOrderNum}
              style={{
                alignSelf: 'flex-end',
                padding: '8px 16px',
                backgroundColor: bulkProcessing ? '#D1D5DB' : ORANGE,
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: bulkProcessing ? 'not-allowed' : 'pointer',
                fontWeight: '600',
                fontSize: '13px',
              }}
            >
              {bulkProcessing ? 'Processing...' : 'Check & Allocate'}
            </button>
          </div>

          {/* Bulk Results */}
          {bulkResult && (
            <div style={{ marginTop: '16px' }}>
              {bulkResult.allocated.length > 0 && (
                <div style={{ marginBottom: '16px' }}>
                  <h3 style={{ fontSize: '14px', fontWeight: '600', color: '#10B981', marginBottom: '8px' }}>
                    Successfully Allocated
                  </h3>
                  <div style={{ backgroundColor: '#ECFDF5', borderRadius: '4px', padding: '12px' }}>
                    {bulkResult.allocated.map((item, idx) => (
                      <div key={idx} style={{ padding: '4px 0', fontSize: '13px', color: '#065F46' }}>
                        ✓ {item.sku} - {item.name} ({item.quantity} units)
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {bulkResult.insufficient.length > 0 && (
                <div>
                  <h3 style={{ fontSize: '14px', fontWeight: '600', color: '#EF4444', marginBottom: '8px' }}>
                    Insufficient Stock
                  </h3>
                  {bulkResult.insufficient.map((item, idx) => (
                    <div
                      key={idx}
                      style={{
                        backgroundColor: '#FEF2F2',
                        borderRadius: '4px',
                        padding: '12px',
                        marginBottom: '8px',
                        border: '1px solid #FCA5A5',
                      }}
                    >
                      <div style={{ fontWeight: '600', color: '#991B1B', fontSize: '13px' }}>
                        {item.sku} - {item.name}
                      </div>
                      <div style={{ fontSize: '12px', color: '#7F1D1D', marginTop: '4px' }}>
                        Requested: {item.requested} | Available: {item.available} | Shortfall: {item.shortfall}
                      </div>
                      {item.vendors.length > 0 && (
                        <div style={{ fontSize: '12px', color: '#7F1D1D', marginTop: '4px' }}>
                          Available from: {item.vendors.map((v) => `${v.name} (${v.leadTime})`).join(', ')}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Toast */}
      {toast && (
        <div
          style={{
            position: 'fixed',
            bottom: '24px',
            right: '24px',
            padding: '12px 16px',
            backgroundColor: toastType === 'error' ? '#EF4444' : toastType === 'warning' ? '#F59E0B' : '#10B981',
            color: 'white',
            borderRadius: '4px',
            fontSize: '13px',
            fontWeight: '600',
            boxShadow: '0 4px 6px rgba(0,0,0,0.1)',
            animation: 'slideIn 0.3s ease-out',
          }}
        >
          {toast}
        </div>
      )}

      <style>{`
        @keyframes slideIn {
          from {
            transform: translateX(400px);
            opacity: 0;
          }
          to {
            transform: translateX(0);
            opacity: 1;
          }
        }
      `}</style>
    </div>
  )
}
