'use client'

import { useState, useEffect, useCallback, useRef } from 'react'

interface Product {
  id: string
  sku: string
  name: string
  displayName: string
  category: string
  basePrice: number
  stock: number
}

interface OrderItem {
  id: string
  productId: string
  sku: string
  name: string
  quantity: number
  unitPrice: number
  stock: number
}

interface PastOrder {
  id: string
  orderNumber: string
  status: string
  total: number
  createdAt: string
  deliveryDate: string | null
  projectName: string | null
  itemCount: number
}

type TabMode = 'quick-order' | 'reorder'

export default function QuickOrderPage() {
  const [activeTab, setActiveTab] = useState<TabMode>('quick-order')
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<Product[]>([])
  const [orderItems, setOrderItems] = useState<OrderItem[]>([])
  const [showDropdown, setShowDropdown] = useState(false)
  const [searchLoading, setSearchLoading] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [successMessage, setSuccessMessage] = useState('')
  const [errorMessage, setErrorMessage] = useState('')
  const [saveTemplateMode, setSaveTemplateMode] = useState(false)
  const [templateName, setTemplateName] = useState('')
  const [pastOrders, setPastOrders] = useState<PastOrder[]>([])
  const [ordersLoading, setOrdersLoading] = useState(false)
  const [reorderingId, setReorderingId] = useState<string | null>(null)
  const searchRef = useRef<HTMLDivElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout>>()

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setShowDropdown(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  // Fetch past orders when reorder tab is opened
  useEffect(() => {
    if (activeTab === 'reorder' && pastOrders.length === 0) {
      fetchPastOrders()
    }
  }, [activeTab])

  async function fetchPastOrders() {
    setOrdersLoading(true)
    try {
      const res = await fetch('/api/orders')
      if (res.ok) {
        const data = await res.json()
        setPastOrders(data.orders || [])
      }
    } catch (err) {
      if (process.env.NODE_ENV !== 'production') {
        console.error('Failed to load orders:', err)
      }
    } finally {
      setOrdersLoading(false)
    }
  }

  async function handleReorder(orderId: string) {
    setReorderingId(orderId)
    try {
      const res = await fetch(`/api/orders/${orderId}/reorder`, { method: 'POST' })
      if (res.ok) {
        const data = await res.json()
        setSuccessMessage(`${data.itemsAdded} item(s) from order ${data.orderNumber} added to cart!`)
        setTimeout(() => setSuccessMessage(''), 4000)
      } else {
        setErrorMessage('Failed to reorder — please try again'); setTimeout(() => setErrorMessage(''), 5000)
      }
    } catch (err) {
      if (process.env.NODE_ENV !== 'production') {
        console.error('Reorder error:', err)
      }
      alert('Failed to reorder — please try again')
    } finally {
      setReorderingId(null)
    }
  }

  // Debounced search
  const performSearch = useCallback(async (query: string) => {
    if (query.length < 1) {
      setSearchResults([])
      return
    }
    setSearchLoading(true)
    try {
      const res = await fetch(`/api/quick-order/search?q=${encodeURIComponent(query)}`)
      if (res.ok) {
        const data = await res.json()
        setSearchResults(data.results || [])
        setShowDropdown(data.results?.length > 0)
      }
    } catch (err) {
      if (process.env.NODE_ENV !== 'production') {
        console.error('Search error:', err)
      }
    } finally {
      setSearchLoading(false)
    }
  }, [])

  const handleSearchChange = (val: string) => {
    setSearchQuery(val)
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current)
    debounceTimerRef.current = setTimeout(() => {
      performSearch(val)
    }, 300)
  }

  const handleSelectProduct = (product: Product) => {
    const itemId = `item${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    setOrderItems([...orderItems, {
      id: itemId,
      productId: product.id,
      sku: product.sku,
      name: product.displayName || product.name,
      quantity: 1,
      unitPrice: product.basePrice,
      stock: product.stock,
    }])
    setSearchQuery('')
    setSearchResults([])
    setShowDropdown(false)
    searchInputRef.current?.focus()
  }

  const handleQuantityChange = (itemId: string, newQty: number) => {
    if (newQty < 1) return
    setOrderItems(orderItems.map(item =>
      item.id === itemId ? { ...item, quantity: newQty } : item
    ))
  }

  const handleRemoveItem = (itemId: string) => {
    setOrderItems(orderItems.filter(item => item.id !== itemId))
  }

  const handleClearAll = () => {
    if (orderItems.length === 0) return
    if (window.confirm('Clear all order items?')) {
      setOrderItems([])
    }
  }

  const handleAddToCart = async () => {
    if (orderItems.length === 0) return
    setIsSubmitting(true)
    try {
      for (const item of orderItems) {
        const res = await fetch('/api/catalog/cart', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            productId: item.productId,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            description: item.name,
            sku: item.sku,
          }),
        })
        if (!res.ok) throw new Error('Failed to add item to cart')
      }
      setSuccessMessage(`${orderItems.length} item(s) added to cart`)
      setOrderItems([])
      setTimeout(() => setSuccessMessage(''), 3000)
    } catch (err) {
      if (process.env.NODE_ENV !== 'production') {
        console.error('Cart error:', err)
      }
      setErrorMessage('Failed to add items to cart'); setTimeout(() => setErrorMessage(''), 5000)
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleSaveTemplate = async () => {
    if (!templateName.trim() || orderItems.length === 0) {
      setErrorMessage('Enter a template name and add items first'); setTimeout(() => setErrorMessage(''), 5000)
      return
    }
    setIsSubmitting(true)
    try {
      const res = await fetch('/api/builder/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: templateName.trim(),
          items: orderItems.map(item => ({
            productId: item.productId,
            quantity: item.quantity,
          })),
        }),
      })
      if (!res.ok) throw new Error('Failed to save template')
      setSuccessMessage(`Template "${templateName}" saved!`)
      setTemplateName('')
      setSaveTemplateMode(false)
      setTimeout(() => setSuccessMessage(''), 3000)
    } catch (err) {
      if (process.env.NODE_ENV !== 'production') {
        console.error('Template error:', err)
      }
      setErrorMessage('Failed to save template'); setTimeout(() => setErrorMessage(''), 5000)
    } finally {
      setIsSubmitting(false)
    }
  }

  const totalItems = orderItems.length
  const totalAmount = orderItems.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0)

  const getStockStatus = (stock: number) => {
    if (stock === 0) return { label: 'Out of Stock', color: '#999', bg: '#f3f4f6' }
    if (stock < 10) return { label: `Low Stock (${stock})`, color: '#dc2626', bg: '#fee2e2' }
    return { label: `In Stock (${stock})`, color: '#16a34a', bg: '#dcfce7' }
  }

  const S = {
    page: { display: 'flex', flexDirection: 'column' as const, minHeight: '100vh', backgroundColor: '#f5f6fa', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' } as React.CSSProperties,
    header: { backgroundColor: '#0f2a3e', color: '#fff', padding: '24px 32px', boxShadow: '0 2px 8px rgba(0,0,0,0.1)' } as React.CSSProperties,
    headerTitle: { fontSize: 28, fontWeight: 700, margin: 0, marginBottom: 4 } as React.CSSProperties,
    headerSubtitle: { fontSize: 14, color: 'rgba(255,255,255,0.8)', margin: 0 } as React.CSSProperties,
    container: { maxWidth: 1200, margin: '0 auto', padding: '32px', flex: 1, width: '100%' } as React.CSSProperties,
    searchBox: { display: 'flex', gap: 12, marginBottom: 32 } as React.CSSProperties,
    searchContainer: { flex: 1, position: 'relative' as const } as React.CSSProperties,
    searchInput: { width: '100%', padding: '12px 16px', border: '2px solid #d1d5db', borderRadius: 8, fontSize: 16, outline: 'none', boxSizing: 'border-box' } as React.CSSProperties,
    dropdown: { position: 'absolute' as const, top: '100%', left: 0, right: 0, marginTop: 8, backgroundColor: '#fff', border: '1px solid #d1d5db', borderRadius: 8, boxShadow: '0 4px 12px rgba(0,0,0,0.1)', zIndex: 10, maxHeight: 400, overflowY: 'auto' as const } as React.CSSProperties,
    dropdownItem: { padding: '12px 16px', borderBottom: '1px solid #f3f4f6', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' } as React.CSSProperties,
    dropdownItemHover: { backgroundColor: '#f9fafb' } as React.CSSProperties,
    dropdownLabel: { display: 'flex', flex: 1, justifyContent: 'space-between', gap: 16 } as React.CSSProperties,
    dropdownSku: { fontSize: 12, color: '#6b7280', fontWeight: 500 } as React.CSSProperties,
    dropdownName: { fontSize: 14, fontWeight: 500, color: '#1f2937' } as React.CSSProperties,
    dropdownPrice: { fontSize: 14, fontWeight: 600, color: '#0f2a3e' } as React.CSSProperties,
    tableContainer: { backgroundColor: '#fff', borderRadius: 8, border: '1px solid #e5e7eb', overflow: 'hidden', marginBottom: 24 } as React.CSSProperties,
    table: { width: '100%', borderCollapse: 'collapse' as const } as React.CSSProperties,
    th: { padding: '14px 16px', backgroundColor: '#f9fafb', borderBottom: '1px solid #e5e7eb', textAlign: 'left' as const, fontSize: 12, fontWeight: 700, color: '#374151', textTransform: 'uppercase' as const, letterSpacing: 0.5 } as React.CSSProperties,
    td: { padding: '14px 16px', borderBottom: '1px solid #f3f4f6', fontSize: 14 } as React.CSSProperties,
    tdSku: { fontSize: 12, fontWeight: 600, color: '#6b7280', fontFamily: 'monospace' } as React.CSSProperties,
    tdName: { fontWeight: 500, color: '#1f2937' } as React.CSSProperties,
    quantityInput: { width: 70, padding: '6px 8px', border: '1px solid #d1d5db', borderRadius: 4, fontSize: 14, textAlign: 'center' as const, boxSizing: 'border-box' } as React.CSSProperties,
    removeBtn: { padding: '6px 12px', backgroundColor: '#fee2e2', color: '#dc2626', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 12, fontWeight: 600, transition: 'background-color 0.2s' } as React.CSSProperties,
    stockBadge: (color: string, bg: string) => ({
      display: 'inline-block',
      padding: '4px 8px',
      borderRadius: 4,
      fontSize: 12,
      fontWeight: 600,
      backgroundColor: bg,
      color,
    }),
    footer: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '24px', backgroundColor: '#fff', borderTop: '1px solid #e5e7eb' } as React.CSSProperties,
    totals: { display: 'flex', gap: 32 } as React.CSSProperties,
    totalItem: { display: 'flex', flexDirection: 'column' as const, gap: 4 } as React.CSSProperties,
    totalLabel: { fontSize: 12, color: '#6b7280', fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: 0.5 } as React.CSSProperties,
    totalValue: { fontSize: 20, fontWeight: 700, color: '#0f2a3e' } as React.CSSProperties,
    actions: { display: 'flex', gap: 12 } as React.CSSProperties,
    btn: { padding: '10px 20px', border: 'none', borderRadius: 6, fontSize: 14, fontWeight: 600, cursor: 'pointer', transition: 'all 0.2s' } as React.CSSProperties,
    btnPrimary: { backgroundColor: '#C6A24E', color: '#fff' } as React.CSSProperties,
    btnSecondary: { backgroundColor: '#e5e7eb', color: '#374151' } as React.CSSProperties,
    btnDanger: { backgroundColor: '#fee2e2', color: '#dc2626' } as React.CSSProperties,
    empty: { textAlign: 'center' as const, padding: 60, color: '#9ca3af' } as React.CSSProperties,
    success: { padding: '12px 16px', backgroundColor: '#dcfce7', color: '#166534', borderRadius: 6, marginBottom: 16, fontSize: 14, fontWeight: 500 } as React.CSSProperties,
    modal: { position: 'fixed' as const, top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 } as React.CSSProperties,
    modalBox: { backgroundColor: '#fff', borderRadius: 12, padding: 32, maxWidth: 400, width: '90%', boxShadow: '0 8px 32px rgba(0,0,0,0.15)' } as React.CSSProperties,
    modalTitle: { fontSize: 18, fontWeight: 700, color: '#0f2a3e', marginBottom: 20, margin: 0 } as React.CSSProperties,
    modalInput: { width: '100%', padding: '10px 14px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 14, marginBottom: 20, boxSizing: 'border-box' } as React.CSSProperties,
    modalButtons: { display: 'flex', gap: 12 } as React.CSSProperties,
  }

  const statusColor: Record<string, { bg: string; text: string }> = {
    RECEIVED: { bg: '#dbeafe', text: '#1e40af' },
    CONFIRMED: { bg: '#dcfce7', text: '#166534' },
    PROCESSING: { bg: '#fef3c7', text: '#92400e' },
    SHIPPED: { bg: '#e0e7ff', text: '#3730a3' },
    DELIVERED: { bg: '#d1fae5', text: '#065f46' },
    CANCELLED: { bg: '#fee2e2', text: '#991b1b' },
  }

  function fmtDate(d: string): string {
    return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  }

  function fmtPrice(n: number): string {
    return '$' + Number(n).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  }

  return (
    <div style={S.page}>
      {/* Header */}
      <div style={S.header}>
        <h1 style={S.headerTitle}>Quick Order</h1>
        <p style={S.headerSubtitle}>Rapidly enter SKU and quantities to build orders fast</p>
        {/* Tab Nav */}
        <div style={{ display: 'flex', gap: 4, marginTop: 16 }}>
          <button
            onClick={() => setActiveTab('quick-order')}
            style={{
              padding: '8px 20px',
              borderRadius: '8px 8px 0 0',
              border: 'none',
              fontWeight: 600,
              fontSize: 14,
              cursor: 'pointer',
              backgroundColor: activeTab === 'quick-order' ? '#fff' : 'rgba(255,255,255,0.15)',
              color: activeTab === 'quick-order' ? '#0f2a3e' : 'rgba(255,255,255,0.9)',
              transition: 'all 0.2s',
            }}
          >
            New Order
          </button>
          <button
            onClick={() => setActiveTab('reorder')}
            style={{
              padding: '8px 20px',
              borderRadius: '8px 8px 0 0',
              border: 'none',
              fontWeight: 600,
              fontSize: 14,
              cursor: 'pointer',
              backgroundColor: activeTab === 'reorder' ? '#fff' : 'rgba(255,255,255,0.15)',
              color: activeTab === 'reorder' ? '#0f2a3e' : 'rgba(255,255,255,0.9)',
              transition: 'all 0.2s',
            }}
          >
            Reorder from History
          </button>
        </div>
      </div>

      {/* Main Container */}
      <div style={S.container}>
        {/* Success Message */}
        {successMessage && (
          <div style={S.success}>
            {successMessage}
          </div>
        )}
        {/* Error Message */}
        {errorMessage && (
          <div style={{ ...S.success, backgroundColor: '#FEF2F2', borderColor: '#FCA5A5', color: '#DC2626' }}>
            {errorMessage}
          </div>
        )}

        {/* ── Reorder from History Tab ── */}
        {activeTab === 'reorder' && (
          <div>
            <p style={{ fontSize: 14, color: '#6b7280', marginBottom: 20 }}>
              Select a past order to instantly add all its items to your cart.
            </p>
            {ordersLoading ? (
              <div style={{ textAlign: 'center', padding: 60, color: '#9ca3af' }}>
                <div style={{ fontSize: 16, marginBottom: 8 }}>Loading your orders...</div>
              </div>
            ) : pastOrders.length === 0 ? (
              <div style={{ ...S.tableContainer, ...S.empty }}>
                <p style={{ fontSize: 18, marginBottom: 8 }}>No past orders found</p>
                <p style={{ fontSize: 14 }}>Place your first order and it will appear here for easy reordering</p>
              </div>
            ) : (
              <div style={S.tableContainer}>
                <table style={S.table}>
                  <thead>
                    <tr>
                      <th style={S.th}>Order #</th>
                      <th style={S.th}>Project</th>
                      <th style={S.th}>Date</th>
                      <th style={S.th}>Items</th>
                      <th style={S.th}>Total</th>
                      <th style={S.th}>Status</th>
                      <th style={{ ...S.th, width: 140, textAlign: 'right' as const }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {pastOrders.map((order) => {
                      const sc = statusColor[order.status] || { bg: '#f3f4f6', text: '#374151' }
                      return (
                        <tr key={order.id}>
                          <td style={S.td}>
                            <span style={{ fontWeight: 600, color: '#0f2a3e', fontFamily: 'monospace', fontSize: 13 }}>
                              {order.orderNumber}
                            </span>
                          </td>
                          <td style={S.td}>
                            <span style={{ fontWeight: 500, color: '#1f2937' }}>
                              {order.projectName || '—'}
                            </span>
                          </td>
                          <td style={S.td}>
                            <span style={{ color: '#6b7280', fontSize: 13 }}>{fmtDate(order.createdAt)}</span>
                          </td>
                          <td style={S.td}>
                            <span style={{ fontWeight: 500 }}>{order.itemCount}</span>
                          </td>
                          <td style={S.td}>
                            <span style={{ fontWeight: 600, color: '#0f2a3e' }}>{fmtPrice(order.total)}</span>
                          </td>
                          <td style={S.td}>
                            <span style={{
                              display: 'inline-block',
                              padding: '3px 10px',
                              borderRadius: 4,
                              fontSize: 12,
                              fontWeight: 600,
                              backgroundColor: sc.bg,
                              color: sc.text,
                            }}>
                              {order.status}
                            </span>
                          </td>
                          <td style={{ ...S.td, textAlign: 'right' as const }}>
                            <button
                              onClick={() => handleReorder(order.id)}
                              disabled={reorderingId === order.id}
                              style={{
                                padding: '8px 16px',
                                backgroundColor: reorderingId === order.id ? '#d1d5db' : '#C6A24E',
                                color: '#fff',
                                border: 'none',
                                borderRadius: 6,
                                fontSize: 13,
                                fontWeight: 600,
                                cursor: reorderingId === order.id ? 'default' : 'pointer',
                                transition: 'background-color 0.2s',
                              }}
                              onMouseEnter={(e) => {
                                if (reorderingId !== order.id)
                                  (e.currentTarget as HTMLButtonElement).style.backgroundColor = '#A8882A'
                              }}
                              onMouseLeave={(e) => {
                                if (reorderingId !== order.id)
                                  (e.currentTarget as HTMLButtonElement).style.backgroundColor = '#C6A24E'
                              }}
                            >
                              {reorderingId === order.id ? 'Adding...' : 'Reorder'}
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ── Quick Order Tab (original) ── */}
        {activeTab === 'quick-order' && <>

        {/* Search Box */}
        <div style={S.searchBox}>
          <div style={S.searchContainer} ref={searchRef}>
            <input
              ref={searchInputRef}
              type="text"
              placeholder="Search by SKU or product name..."
              value={searchQuery}
              onChange={e => handleSearchChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && searchResults.length > 0) {
                  handleSelectProduct(searchResults[0])
                }
              }}
              style={S.searchInput}
              onFocus={() => searchQuery && searchResults.length > 0 && setShowDropdown(true)}
            />
            {showDropdown && searchResults.length > 0 && (
              <div style={S.dropdown}>
                {searchResults.map((product, idx) => (
                  <div
                    key={`${product.id}-${idx}`}
                    style={S.dropdownItem}
                    onClick={() => handleSelectProduct(product)}
                    onMouseEnter={(e) => {
                      (e.currentTarget as HTMLDivElement).style.backgroundColor = '#f9fafb'
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLDivElement).style.backgroundColor = 'transparent'
                    }}
                  >
                    <div style={S.dropdownLabel}>
                      <div>
                        <div style={S.dropdownName}>{product.displayName}</div>
                        <div style={S.dropdownSku}>{product.sku}</div>
                      </div>
                    </div>
                    <div style={{ textAlign: 'right', flexShrink: 0 }}>
                      <div style={S.dropdownPrice}>${product.basePrice.toFixed(2)}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Order Table */}
        {orderItems.length > 0 ? (
          <div style={S.tableContainer}>
            <table style={S.table}>
              <thead>
                <tr>
                  <th style={S.th}>SKU</th>
                  <th style={S.th}>Product Name</th>
                  <th style={{ ...S.th, width: 100 }}>Qty</th>
                  <th style={{ ...S.th, width: 110 }}>Unit Price</th>
                  <th style={{ ...S.th, width: 110 }}>Line Total</th>
                  <th style={{ ...S.th, width: 140 }}>Stock Status</th>
                  <th style={{ ...S.th, width: 60 }}></th>
                </tr>
              </thead>
              <tbody>
                {orderItems.map((item) => {
                  const lineTotal = item.quantity * item.unitPrice
                  const stockStatus = getStockStatus(item.stock)
                  return (
                    <tr key={item.id}>
                      <td style={S.td}>
                        <div style={S.tdSku}>{item.sku}</div>
                      </td>
                      <td style={S.td}>
                        <div style={S.tdName}>{item.name}</div>
                      </td>
                      <td style={S.td}>
                        <input
                          type="number"
                          min="1"
                          value={item.quantity}
                          onChange={(e) => handleQuantityChange(item.id, parseInt(e.target.value) || 1)}
                          onFocus={(e) => e.target.select()}
                          style={S.quantityInput}
                        />
                      </td>
                      <td style={S.td}>${item.unitPrice.toFixed(2)}</td>
                      <td style={{ ...S.td, fontWeight: 600, color: '#0f2a3e' }}>${lineTotal.toFixed(2)}</td>
                      <td style={S.td}>
                        <span style={S.stockBadge(stockStatus.color, stockStatus.bg)}>
                          {stockStatus.label}
                        </span>
                      </td>
                      <td style={S.td}>
                        <button
                          onClick={() => handleRemoveItem(item.id)}
                          style={S.removeBtn}
                          onMouseEnter={(e) => {
                            (e.currentTarget as HTMLButtonElement).style.backgroundColor = '#fecaca'
                          }}
                          onMouseLeave={(e) => {
                            (e.currentTarget as HTMLButtonElement).style.backgroundColor = '#fee2e2'
                          }}
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div style={{ ...S.tableContainer, ...S.empty }}>
            <p style={{ fontSize: 18, marginBottom: 8 }}>No items yet</p>
            <p style={{ fontSize: 14 }}>Search and select products to get started</p>
          </div>
        )}

        </>}
      </div>

      {/* Footer — only show on quick-order tab */}
      {activeTab === 'quick-order' && (
      <div style={S.footer}>
        <div style={S.totals}>
          <div style={S.totalItem}>
            <div style={S.totalLabel}>Items</div>
            <div style={S.totalValue}>{totalItems}</div>
          </div>
          <div style={S.totalItem}>
            <div style={S.totalLabel}>Total</div>
            <div style={S.totalValue}>${totalAmount.toFixed(2)}</div>
          </div>
        </div>
        <div style={S.actions}>
          <button
            onClick={handleClearAll}
            style={{ ...S.btn, ...S.btnDanger }}
            disabled={orderItems.length === 0}
            onMouseEnter={(e) => !orderItems.length ? null : (e.currentTarget as HTMLButtonElement).style.backgroundColor = '#fecaca'}
            onMouseLeave={(e) => (e.currentTarget as HTMLButtonElement).style.backgroundColor = '#fee2e2'}
          >
            Clear All
          </button>
          <button
            onClick={() => setSaveTemplateMode(true)}
            style={{ ...S.btn, ...S.btnSecondary }}
            disabled={orderItems.length === 0}
            onMouseEnter={(e) => !orderItems.length ? null : (e.currentTarget as HTMLButtonElement).style.backgroundColor = '#d1d5db'}
            onMouseLeave={(e) => (e.currentTarget as HTMLButtonElement).style.backgroundColor = '#e5e7eb'}
          >
            Save Template
          </button>
          <button
            onClick={handleAddToCart}
            style={{ ...S.btn, ...S.btnPrimary }}
            disabled={orderItems.length === 0 || isSubmitting}
            onMouseEnter={(e) => !orderItems.length ? null : (e.currentTarget as HTMLButtonElement).style.backgroundColor = '#d97706'}
            onMouseLeave={(e) => (e.currentTarget as HTMLButtonElement).style.backgroundColor = '#C6A24E'}
          >
            {isSubmitting ? 'Adding...' : 'Add to Cart'}
          </button>
        </div>
      </div>
      )}

      {/* Save Template Modal */}
      {saveTemplateMode && (
        <div style={S.modal} onClick={() => !isSubmitting && setSaveTemplateMode(false)}>
          <div style={S.modalBox} onClick={(e) => e.stopPropagation()}>
            <h2 style={S.modalTitle}>Save as Template</h2>
            <input
              type="text"
              placeholder="Template name"
              value={templateName}
              onChange={(e) => setTemplateName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !isSubmitting && handleSaveTemplate()}
              style={S.modalInput}
              autoFocus
            />
            <div style={S.modalButtons}>
              <button
                onClick={() => setSaveTemplateMode(false)}
                style={{ ...S.btn, ...S.btnSecondary, flex: 1 }}
                disabled={isSubmitting}
              >
                Cancel
              </button>
              <button
                onClick={handleSaveTemplate}
                style={{ ...S.btn, ...S.btnPrimary, flex: 1 }}
                disabled={!templateName.trim() || isSubmitting}
              >
                {isSubmitting ? 'Saving...' : 'Save Template'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
