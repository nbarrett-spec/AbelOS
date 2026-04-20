'use client'

import { useEffect, useState } from 'react'

// ═══════════════════════════════════════════════════════════════════════════
// TYPE DEFINITIONS
// ═══════════════════════════════════════════════════════════════════════════

interface ReceivingPO {
  id: string
  poNumber: string
  vendorName: string
  expectedDate: string
  itemsCount: number
  totalAmount: number
  createdAt: string
}

interface LineItem {
  id: string
  productDescription: string
  vendorSku: string
  orderedQty: number
  receivedQty: number
  remainingQty: number
}

interface ReceivingDetail {
  id: string
  poNumber: string
  vendorName: string
  expectedDate: string
  totalAmount: number
  items: LineItem[]
}

interface ItemCheckIn {
  itemId: string
  receivedQty: number
  damagedQty: number
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════════════

const NAVY = '#3E2A1E'
const ORANGE = '#C9822B'

export default function ReceivingPage() {
  // ─────────────────────────────────────────────────────────────────────────
  // Queue View State
  // ─────────────────────────────────────────────────────────────────────────
  const [view, setView] = useState<'queue' | 'checkin'>('queue')
  const [queue, setQueue] = useState<ReceivingPO[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [error, setError] = useState('')

  // ─────────────────────────────────────────────────────────────────────────
  // Check-In View State
  // ─────────────────────────────────────────────────────────────────────────
  const [selectedPO, setSelectedPO] = useState<ReceivingDetail | null>(null)
  const [poLoading, setPoLoading] = useState(false)
  const [poError, setPoError] = useState('')
  const [checkIns, setCheckIns] = useState<Record<string, ItemCheckIn>>({})
  const [notes, setNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)

  // ─────────────────────────────────────────────────────────────────────────
  // Toast Notifications
  // ─────────────────────────────────────────────────────────────────────────
  const [toast, setToast] = useState('')
  const [toastType, setToastType] = useState<'success' | 'error'>('success')

  const showToast = (msg: string, type: 'success' | 'error' = 'success') => {
    setToast(msg)
    setToastType(type)
    setTimeout(() => setToast(''), 3500)
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Load Queue
  // ─────────────────────────────────────────────────────────────────────────

  async function loadQueue() {
    setLoading(true)
    setError('')
    try {
      const params = new URLSearchParams()
      if (search) params.append('search', search)

      const resp = await fetch(`/api/ops/receiving?${params}`)
      if (!resp.ok) throw new Error('Failed to load queue')

      const data = await resp.json()
      setQueue(data.pos || [])
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to load receiving queue'
      setError(msg)
      showToast(msg, 'error')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    const timer = setTimeout(() => loadQueue(), 300)
    return () => clearTimeout(timer)
  }, [search])

  // ─────────────────────────────────────────────────────────────────────────
  // Load PO Details
  // ─────────────────────────────────────────────────────────────────────────

  async function loadPODetails(poId: string) {
    setPoLoading(true)
    setPoError('')
    try {
      const resp = await fetch(`/api/ops/receiving/${poId}`)
      if (!resp.ok) throw new Error('Failed to load PO details')

      const data = await resp.json()
      setSelectedPO(data)

      // Initialize check-ins with defaults
      const initialCheckIns: Record<string, ItemCheckIn> = {}
      data.items.forEach((item: LineItem) => {
        initialCheckIns[item.id] = {
          itemId: item.id,
          receivedQty: 0,
          damagedQty: 0,
        }
      })
      setCheckIns(initialCheckIns)
      setNotes('')
      setView('checkin')
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to load PO details'
      setPoError(msg)
      showToast(msg, 'error')
    } finally {
      setPoLoading(false)
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Check-In Handlers
  // ─────────────────────────────────────────────────────────────────────────

  function updateItemCheckIn(itemId: string, field: 'receivedQty' | 'damagedQty', value: number) {
    setCheckIns(prev => ({
      ...prev,
      [itemId]: {
        ...prev[itemId],
        [field]: Math.max(0, value),
      },
    }))
  }

  function getItemValidationError(item: LineItem, checkIn: ItemCheckIn): string | null {
    const total = checkIn.receivedQty + checkIn.damagedQty
    if (total > item.orderedQty) {
      return `Received + Damaged cannot exceed ordered quantity (${item.orderedQty})`
    }
    return null
  }

  function receiveAll() {
    if (!selectedPO) return
    const updated: Record<string, ItemCheckIn> = {}
    selectedPO.items.forEach(item => {
      updated[item.id] = {
        itemId: item.id,
        receivedQty: item.remainingQty,
        damagedQty: 0,
      }
    })
    setCheckIns(updated)
    showToast(`Set all ${selectedPO.items.length} items to receive full quantities`)
  }

  async function submitReceiving() {
    if (!selectedPO) return

    // Validate at least one item received
    const hasAnyReceived = Object.values(checkIns).some(ci => ci.receivedQty > 0)
    if (!hasAnyReceived) {
      showToast('Please receive at least one item', 'error')
      return
    }

    // Validate no item exceeds ordered quantity
    for (const item of selectedPO.items) {
      const checkIn = checkIns[item.id]
      if (checkIn && (checkIn.receivedQty + checkIn.damagedQty) > item.orderedQty) {
        showToast(`Item "${item.productDescription}": received + damaged cannot exceed ordered quantity`, 'error')
        return
      }
    }

    setSubmitting(true)
    try {
      const res = await fetch('/api/ops/receiving', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          poId: selectedPO.id,
          items: Object.values(checkIns),
          notes: notes.trim(),
        }),
      })

      if (!res.ok) throw new Error('Failed to complete receiving')

      showToast(`PO ${selectedPO.poNumber} received successfully`)
      setView('queue')
      setSelectedPO(null)
      setCheckIns({})
      setNotes('')
      loadQueue()
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to complete receiving'
      showToast(msg, 'error')
    } finally {
      setSubmitting(false)
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Helper Functions
  // ─────────────────────────────────────────────────────────────────────────

  function getStatusColor(expectedDate: string) {
    const today = new Date()
    today.setHours(0, 0, 0, 0)

    const expected = new Date(expectedDate)
    expected.setHours(0, 0, 0, 0)

    const diffTime = expected.getTime() - today.getTime()
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24))

    if (diffDays < 0) return '#EF4444' // red - overdue
    if (diffDays === 0) return ORANGE // orange - due today
    if (diffDays <= 7) return '#F59E0B' // amber - upcoming week
    return '#10B981' // green - normal
  }

  function formatDate(dateStr: string) {
    const d = new Date(dateStr)
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  }

  function formatCurrency(amount: number) {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount)
  }

  // ─────────────────────────────────────────────────────────────────────────
  // QUEUE VIEW
  // ─────────────────────────────────────────────────────────────────────────

  if (view === 'queue') {
    return (
      <div style={{ padding: '24px', maxWidth: '1400px', margin: '0 auto' }}>
        {/* Header */}
        <div style={{ marginBottom: '32px' }}>
          <h1 style={{ fontSize: '28px', fontWeight: 'bold', color: NAVY, margin: '0 0 8px 0' }}>
            Receiving Queue
          </h1>
          <p style={{ fontSize: '14px', color: '#666', margin: '0' }}>
            Check in purchase orders from vendors
          </p>
        </div>

        {/* Search Bar */}
        <div style={{ marginBottom: '24px' }}>
          <input
            type="text"
            placeholder="Search by PO number or vendor name..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{
              width: '100%',
              padding: '12px 16px',
              fontSize: '14px',
              border: '1px solid #ddd',
              borderRadius: '6px',
              boxSizing: 'border-box',
              fontFamily: 'inherit',
            }}
          />
        </div>

        {/* Error State */}
        {error && (
          <div
            style={{
              padding: '16px',
              marginBottom: '24px',
              backgroundColor: '#FEE2E2',
              border: '1px solid #FECACA',
              borderRadius: '6px',
              color: '#DC2626',
              fontSize: '14px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <span>{error}</span>
            <button
              onClick={() => loadQueue()}
              style={{
                padding: '6px 12px',
                backgroundColor: '#DC2626',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '12px',
                fontWeight: 'bold',
              }}
            >
              Retry
            </button>
          </div>
        )}

        {/* Loading Skeleton */}
        {loading ? (
          <div style={{ display: 'grid', gap: '12px' }}>
            {[...Array(5)].map((_, i) => (
              <div
                key={i}
                style={{
                  padding: '16px',
                  backgroundColor: '#f0f0f0',
                  borderRadius: '6px',
                  height: '80px',
                  animation: 'pulse 2s infinite',
                }}
              />
            ))}
          </div>
        ) : queue.length === 0 ? (
          // Empty State
          <div
            style={{
              textAlign: 'center',
              padding: '64px 24px',
              backgroundColor: '#f9f9f9',
              borderRadius: '8px',
              border: '1px dashed #ddd',
            }}
          >
            <div style={{ fontSize: '48px', marginBottom: '16px' }}>📦</div>
            <h3 style={{ fontSize: '18px', fontWeight: 'bold', color: NAVY, marginBottom: '8px' }}>
              No pending receiving
            </h3>
            <p style={{ fontSize: '14px', color: '#666' }}>
              All purchase orders have been received or none are pending
            </p>
          </div>
        ) : (
          // Queue List
          <div style={{ display: 'grid', gap: '12px' }}>
            {queue.map(po => {
              const statusColor = getStatusColor(po.expectedDate)
              const statusLabel =
                statusColor === '#EF4444'
                  ? 'OVERDUE'
                  : statusColor === ORANGE
                    ? 'DUE TODAY'
                    : statusColor === '#F59E0B'
                      ? 'THIS WEEK'
                      : 'UPCOMING'

              return (
                <div
                  key={po.id}
                  onClick={() => loadPODetails(po.id)}
                  style={{
                    padding: '16px',
                    backgroundColor: 'white',
                    border: `1px solid #e0e0e0`,
                    borderRadius: '8px',
                    cursor: 'pointer',
                    transition: 'all 0.2s',
                    display: 'grid',
                    gridTemplateColumns: 'auto 1fr auto',
                    gap: '24px',
                    alignItems: 'center',
                  }}
                  onMouseEnter={e => {
                    ;(e.currentTarget as HTMLElement).style.backgroundColor = '#f9f9f9'
                    ;(e.currentTarget as HTMLElement).style.borderColor = NAVY
                    ;(e.currentTarget as HTMLElement).style.boxShadow = '0 2px 8px rgba(0,0,0,0.1)'
                  }}
                  onMouseLeave={e => {
                    ;(e.currentTarget as HTMLElement).style.backgroundColor = 'white'
                    ;(e.currentTarget as HTMLElement).style.borderColor = '#e0e0e0'
                    ;(e.currentTarget as HTMLElement).style.boxShadow = 'none'
                  }}
                >
                  {/* Status Indicator */}
                  <div
                    style={{
                      width: '8px',
                      height: '60px',
                      backgroundColor: statusColor,
                      borderRadius: '4px',
                    }}
                  />

                  {/* PO Info */}
                  <div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                      <div>
                        <div
                          style={{
                            fontSize: '12px',
                            color: '#999',
                            fontWeight: 'bold',
                            textTransform: 'uppercase',
                            letterSpacing: '0.5px',
                            marginBottom: '4px',
                          }}
                        >
                          PO Number
                        </div>
                        <div style={{ fontSize: '16px', fontWeight: 'bold', color: NAVY }}>
                          {po.poNumber}
                        </div>
                      </div>
                      <div>
                        <div
                          style={{
                            fontSize: '12px',
                            color: '#999',
                            fontWeight: 'bold',
                            textTransform: 'uppercase',
                            letterSpacing: '0.5px',
                            marginBottom: '4px',
                          }}
                        >
                          Vendor
                        </div>
                        <div style={{ fontSize: '14px', color: '#333' }}>
                          {po.vendorName}
                        </div>
                      </div>
                    </div>

                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '1fr 1fr 1fr',
                        gap: '16px',
                        marginTop: '12px',
                      }}
                    >
                      <div>
                        <div style={{ fontSize: '12px', color: '#999', marginBottom: '4px' }}>
                          Expected Date
                        </div>
                        <div style={{ fontSize: '13px', color: '#333' }}>
                          {formatDate(po.expectedDate)}
                        </div>
                      </div>
                      <div>
                        <div style={{ fontSize: '12px', color: '#999', marginBottom: '4px' }}>
                          Items
                        </div>
                        <div style={{ fontSize: '13px', color: '#333' }}>
                          {po.itemsCount} item{po.itemsCount !== 1 ? 's' : ''}
                        </div>
                      </div>
                      <div>
                        <div style={{ fontSize: '12px', color: '#999', marginBottom: '4px' }}>
                          Total
                        </div>
                        <div style={{ fontSize: '13px', color: '#333', fontWeight: '600' }}>
                          {formatCurrency(po.totalAmount)}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Status Badge */}
                  <div
                    style={{
                      padding: '6px 12px',
                      backgroundColor: statusColor,
                      color: 'white',
                      fontSize: '11px',
                      fontWeight: 'bold',
                      borderRadius: '4px',
                      textAlign: 'center',
                      textTransform: 'uppercase',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {statusLabel}
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* CSS for pulse animation */}
        <style>{`
          @keyframes pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.5; }
          }
        `}</style>
      </div>
    )
  }

  // ─────────────────────────────────────────────────────────────────────────
  // CHECK-IN VIEW
  // ─────────────────────────────────────────────────────────────────────────

  if (poLoading && !selectedPO) {
    return (
      <div style={{ padding: '24px', maxWidth: '1200px', margin: '0 auto' }}>
        <div style={{ fontSize: '48px', textAlign: 'center', marginTop: '80px' }}>
          Loading PO details...
        </div>
      </div>
    )
  }

  if (!selectedPO) {
    return null
  }

  const itemsCompleted = selectedPO.items.filter(
    item => checkIns[item.id]?.receivedQty >= item.remainingQty
  ).length
  const totalUnitsReceived = Object.values(checkIns).reduce((sum, ci) => sum + ci.receivedQty, 0)
  const totalDamaged = Object.values(checkIns).reduce((sum, ci) => sum + ci.damagedQty, 0)

  return (
    <div style={{ padding: '24px', maxWidth: '1200px', margin: '0 auto' }}>
      {/* Back Button */}
      <button
        onClick={() => {
          setView('queue')
          setSelectedPO(null)
        }}
        style={{
          padding: '8px 16px',
          backgroundColor: 'transparent',
          border: `1px solid ${NAVY}`,
          color: NAVY,
          borderRadius: '4px',
          cursor: 'pointer',
          fontSize: '14px',
          fontWeight: 'bold',
          marginBottom: '24px',
        }}
      >
        ← Back to Queue
      </button>

      {/* Header */}
      <div style={{ marginBottom: '24px' }}>
        <h1 style={{ fontSize: '28px', fontWeight: 'bold', color: NAVY, margin: '0 0 8px 0' }}>
          Receiving Check-In
        </h1>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '24px' }}>
          <div>
            <div style={{ fontSize: '12px', color: '#999', fontWeight: 'bold', marginBottom: '4px' }}>
              PO NUMBER
            </div>
            <div style={{ fontSize: '18px', fontWeight: 'bold', color: NAVY }}>
              {selectedPO.poNumber}
            </div>
          </div>
          <div>
            <div style={{ fontSize: '12px', color: '#999', fontWeight: 'bold', marginBottom: '4px' }}>
              VENDOR
            </div>
            <div style={{ fontSize: '16px', color: '#333' }}>
              {selectedPO.vendorName}
            </div>
          </div>
          <div>
            <div style={{ fontSize: '12px', color: '#999', fontWeight: 'bold', marginBottom: '4px' }}>
              EXPECTED DATE
            </div>
            <div style={{ fontSize: '16px', color: '#333' }}>
              {formatDate(selectedPO.expectedDate)}
            </div>
          </div>
          <div>
            <div style={{ fontSize: '12px', color: '#999', fontWeight: 'bold', marginBottom: '4px' }}>
              TOTAL PO
            </div>
            <div style={{ fontSize: '16px', fontWeight: 'bold', color: NAVY }}>
              {formatCurrency(selectedPO.totalAmount)}
            </div>
          </div>
        </div>
      </div>

      {/* Receive All Button */}
      <div style={{ marginBottom: '16px' }}>
        <button
          onClick={receiveAll}
          style={{
            padding: '10px 16px',
            backgroundColor: ORANGE,
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
            fontSize: '14px',
            fontWeight: 'bold',
          }}
        >
          ⚡ Receive All Items
        </button>
      </div>

      {/* Items Table */}
      <div
        style={{
          backgroundColor: 'white',
          border: '1px solid #e0e0e0',
          borderRadius: '8px',
          marginBottom: '24px',
          overflow: 'hidden',
        }}
      >
        {/* Table Header */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr 1fr 1.2fr',
            gap: '16px',
            padding: '16px',
            backgroundColor: NAVY,
            color: 'white',
            fontWeight: 'bold',
            fontSize: '13px',
            textTransform: 'uppercase',
            letterSpacing: '0.5px',
            alignItems: 'center',
            borderBottom: `2px solid ${ORANGE}`,
          }}
        >
          <div>Product Description</div>
          <div style={{ textAlign: 'center' }}>Vendor SKU</div>
          <div style={{ textAlign: 'center' }}>Ordered</div>
          <div style={{ textAlign: 'center' }}>Prev Received</div>
          <div style={{ textAlign: 'center' }}>Remaining</div>
          <div style={{ textAlign: 'center' }}>Received Now</div>
          <div style={{ textAlign: 'center' }}>Damaged</div>
        </div>

        {/* Table Rows */}
        {selectedPO.items.map((item, idx) => {
          const checkIn = checkIns[item.id] || { receivedQty: 0, damagedQty: 0 }
          const isComplete = checkIn.receivedQty >= item.remainingQty
          const isPartial = checkIn.receivedQty > 0 && !isComplete
          const validationError = getItemValidationError(item, checkIn)

          return (
            <div key={item.id}>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr 1fr 1.2fr',
                  gap: '16px',
                  padding: '16px',
                  borderBottom: idx < selectedPO.items.length - 1 ? '1px solid #f0f0f0' : 'none',
                  alignItems: 'center',
                  backgroundColor: validationError ? '#FEE2E2' : isComplete ? '#F0FDF4' : isPartial ? '#FFFBEB' : 'white',
                }}
              >
              {/* Product Description */}
              <div style={{ fontSize: '14px', color: '#333', fontWeight: '500' }}>
                {item.productDescription}
              </div>

              {/* Vendor SKU */}
              <div style={{ fontSize: '13px', color: '#666', textAlign: 'center' }}>
                {item.vendorSku}
              </div>

              {/* Ordered Qty */}
              <div style={{ fontSize: '13px', color: '#666', textAlign: 'center', fontWeight: '600' }}>
                {item.orderedQty}
              </div>

              {/* Previously Received */}
              <div style={{ fontSize: '13px', color: '#666', textAlign: 'center' }}>
                {item.orderedQty - item.remainingQty}
              </div>

              {/* Remaining Qty */}
              <div
                style={{
                  fontSize: '13px',
                  fontWeight: 'bold',
                  textAlign: 'center',
                  color: item.remainingQty > 0 ? '#DC2626' : '#10B981',
                }}
              >
                {item.remainingQty}
              </div>

              {/* Received Input */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <input
                  type="number"
                  min="0"
                  max={item.remainingQty}
                  value={checkIn.receivedQty}
                  onChange={e => updateItemCheckIn(item.id, 'receivedQty', parseInt(e.target.value) || 0)}
                  style={{
                    width: '70px',
                    padding: '6px',
                    fontSize: '13px',
                    border: `1px solid #ddd`,
                    borderRadius: '4px',
                    textAlign: 'center',
                    fontWeight: 'bold',
                  }}
                />
              </div>

              {/* Damaged Input */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <input
                  type="number"
                  min="0"
                  value={checkIn.damagedQty}
                  onChange={e => updateItemCheckIn(item.id, 'damagedQty', parseInt(e.target.value) || 0)}
                  style={{
                    width: '70px',
                    padding: '6px',
                    fontSize: '13px',
                    border: `1px solid #ddd`,
                    borderRadius: '4px',
                    textAlign: 'center',
                    fontWeight: 'bold',
                  }}
                />
              </div>

              {/* Status Indicator */}
              <div style={{ textAlign: 'center' }}>
                {isComplete ? (
                  <div style={{ fontSize: '20px' }}>✓</div>
                ) : isPartial ? (
                  <div style={{ fontSize: '20px' }}>◐</div>
                ) : null}
              </div>
            </div>
            {validationError && (
              <div
                style={{
                  padding: '12px 16px',
                  backgroundColor: '#FEE2E2',
                  borderLeft: '4px solid #DC2626',
                  color: '#DC2626',
                  fontSize: '13px',
                  fontWeight: '500',
                }}
              >
                ⚠ {validationError}
              </div>
            )}
            </div>
          )
        })}
      </div>

      {/* Notes Section */}
      <div style={{ marginBottom: '24px' }}>
        <label
          style={{
            display: 'block',
            fontSize: '14px',
            fontWeight: 'bold',
            color: NAVY,
            marginBottom: '8px',
          }}
        >
          Receiving Notes (Optional)
        </label>
        <textarea
          value={notes}
          onChange={e => setNotes(e.target.value)}
          placeholder="Add any notes about this receiving (e.g., missing items, shipping condition, etc.)"
          style={{
            width: '100%',
            minHeight: '80px',
            padding: '12px',
            fontSize: '14px',
            border: '1px solid #ddd',
            borderRadius: '6px',
            fontFamily: 'inherit',
            boxSizing: 'border-box',
            resize: 'vertical',
          }}
        />
      </div>

      {/* Summary Bar */}
      <div
        style={{
          backgroundColor: NAVY,
          color: 'white',
          padding: '16px',
          borderRadius: '8px',
          marginBottom: '24px',
          display: 'grid',
          gridTemplateColumns: '1fr 1fr 1fr',
          gap: '24px',
        }}
      >
        <div>
          <div style={{ fontSize: '12px', opacity: 0.8, marginBottom: '4px' }}>ITEMS COMPLETED</div>
          <div style={{ fontSize: '24px', fontWeight: 'bold' }}>
            {itemsCompleted}/{selectedPO.items.length}
          </div>
        </div>
        <div>
          <div style={{ fontSize: '12px', opacity: 0.8, marginBottom: '4px' }}>TOTAL UNITS RECEIVED</div>
          <div style={{ fontSize: '24px', fontWeight: 'bold' }}>
            {totalUnitsReceived}
          </div>
        </div>
        <div>
          <div style={{ fontSize: '12px', opacity: 0.8, marginBottom: '4px' }}>TOTAL DAMAGED</div>
          <div
            style={{
              fontSize: '24px',
              fontWeight: 'bold',
              color: totalDamaged > 0 ? '#FCA5A5' : '#86EFAC',
            }}
          >
            {totalDamaged}
          </div>
        </div>
      </div>

      {/* Complete Receiving Button */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '12px' }}>
        <button
          onClick={() => {
            setView('queue')
            setSelectedPO(null)
          }}
          style={{
            padding: '14px 24px',
            backgroundColor: 'white',
            border: `2px solid ${NAVY}`,
            color: NAVY,
            borderRadius: '6px',
            cursor: 'pointer',
            fontSize: '16px',
            fontWeight: 'bold',
          }}
        >
          Cancel
        </button>
        <button
          onClick={submitReceiving}
          disabled={submitting}
          style={{
            padding: '14px 32px',
            backgroundColor: submitting ? '#9CA3AF' : ORANGE,
            color: 'white',
            border: 'none',
            borderRadius: '6px',
            cursor: submitting ? 'not-allowed' : 'pointer',
            fontSize: '16px',
            fontWeight: 'bold',
          }}
        >
          {submitting ? 'Submitting...' : '✓ Complete Receiving'}
        </button>
      </div>

      {/* Toast Notification */}
      {toast && (
        <div
          style={{
            position: 'fixed',
            bottom: '24px',
            right: '24px',
            padding: '16px 24px',
            backgroundColor: toastType === 'success' ? '#10B981' : '#EF4444',
            color: 'white',
            borderRadius: '6px',
            fontSize: '14px',
            fontWeight: '500',
            boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
            zIndex: 1000,
            animation: 'slideIn 0.3s ease-out',
          }}
        >
          {toastType === 'success' ? '✓ ' : '✕ '}
          {toast}
        </div>
      )}

      <style>{`
        @keyframes slideIn {
          from {
            opacity: 0;
            transform: translateY(20px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
      `}</style>
    </div>
  )
}
