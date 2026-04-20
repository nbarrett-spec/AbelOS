'use client'

import { useEffect, useState } from 'react'

// ═══════════════════════════════════════════════════════════════════════════
// TYPE DEFINITIONS
// ═══════════════════════════════════════════════════════════════════════════

interface ReturnItem {
  id: string
  description: string
  orderedQty: number
  receivedQty: number
  returnQty: number
  reason: 'DEFECTIVE' | 'WRONG_ITEM' | 'OVERSHIP' | 'QUALITY' | 'OTHER'
  condition: 'DAMAGED' | 'UNOPENED' | 'USED'
  unitPrice: number
}

interface VendorReturn {
  id: string
  rmaNumber: string
  vendorId: string
  vendorName: string
  poNumber: string
  status: 'PENDING' | 'APPROVED' | 'SHIPPED' | 'CREDIT_ISSUED' | 'CLOSED'
  reason: string
  totalAmount: number
  items: ReturnItem[]
  notes: string
  createdAt: string
  updatedAt: string
  statusHistory: StatusHistoryEntry[]
}

interface StatusHistoryEntry {
  status: string
  timestamp: string
  notes?: string
}

interface PurchaseOrder {
  id: string
  poNumber: string
  vendorId: string
  vendorName: string
  totalAmount: number
  status: string
}

interface POItem {
  id: string
  description: string
  sku: string
  orderedQty: number
  receivedQty: number
  damagedQty: number
  unitPrice: number
}

// ═══════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════

const NAVY = '#3E2A1E'
const ORANGE = '#C9822B'

const STATUS_COLORS: Record<string, string> = {
  PENDING: '#FBBF24',
  APPROVED: '#3B82F6',
  SHIPPED: '#A855F7',
  CREDIT_ISSUED: '#10B981',
  CLOSED: '#9CA3AF',
}

const REASON_OPTIONS = [
  { value: 'DEFECTIVE', label: 'Defective' },
  { value: 'WRONG_ITEM', label: 'Wrong Item' },
  { value: 'OVERSHIP', label: 'Overship' },
  { value: 'QUALITY', label: 'Quality Issue' },
  { value: 'OTHER', label: 'Other' },
]

const CONDITION_OPTIONS = [
  { value: 'DAMAGED', label: 'Damaged' },
  { value: 'UNOPENED', label: 'Unopened' },
  { value: 'USED', label: 'Used' },
]

// ═══════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════════════

export default function ReturnsPage() {
  const [view, setView] = useState<'list' | 'detail'>('list')
  const [returns, setReturns] = useState<VendorReturn[]>([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState('ALL')
  const [search, setSearch] = useState('')
  const [selectedReturn, setSelectedReturn] = useState<VendorReturn | null>(null)

  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false)
  const [toast, setToast] = useState('')
  const [toastType, setToastType] = useState<'success' | 'error'>('success')

  const showToast = (msg: string, type: 'success' | 'error' = 'success') => {
    setToast(msg)
    setToastType(type)
    setTimeout(() => setToast(''), 3500)
  }

  useEffect(() => {
    fetchReturns()
  }, [statusFilter])

  const fetchReturns = async () => {
    try {
      setLoading(true)
      const url = statusFilter === 'ALL'
        ? '/api/ops/returns'
        : `/api/ops/returns?status=${statusFilter}`
      const res = await fetch(url)
      const data = await res.json()
      // API returns { returns: [...], pagination, statusCounts }
      const list = Array.isArray(data) ? data : (data.returns || [])
      // Map API field names to component interface
      const mapped = list.map((r: any) => ({
        ...r,
        rmaNumber: r.returnNumber || r.rmaNumber || '',
        vendorName: r.vendor?.name || r.vendorName || '',
        poNumber: r.poNumber || '',
        items: r.items || [],
        statusHistory: r.statusHistory || [],
      }))
      setReturns(mapped)
    } catch (err) {
      console.error('Failed to load returns:', err)
      showToast('Failed to load returns', 'error')
    } finally {
      setLoading(false)
    }
  }

  const filtered = returns.filter((ret) => {
    if (search) {
      const s = search.toLowerCase()
      if (
        !ret.rmaNumber.toLowerCase().includes(s) &&
        !ret.vendorName.toLowerCase().includes(s) &&
        !ret.poNumber.toLowerCase().includes(s)
      ) {
        return false
      }
    }
    return true
  })

  const statusCounts = {
    ALL: returns.length,
    PENDING: returns.filter(r => r.status === 'PENDING').length,
    APPROVED: returns.filter(r => r.status === 'APPROVED').length,
    SHIPPED: returns.filter(r => r.status === 'SHIPPED').length,
    CREDIT_ISSUED: returns.filter(r => r.status === 'CREDIT_ISSUED').length,
    CLOSED: returns.filter(r => r.status === 'CLOSED').length,
  }

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr)
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  }

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount)
  }

  if (view === 'list') {
    return (
      <div style={{ padding: '24px', maxWidth: '1400px', margin: '0 auto' }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: '32px' }}>
          <div>
            <h1 style={{ fontSize: '28px', fontWeight: 'bold', color: NAVY, margin: '0 0 8px 0' }}>
              Vendor Returns
            </h1>
            <p style={{ fontSize: '14px', color: '#666', margin: '0' }}>
              Manage vendor returns and track RMA status
            </p>
          </div>
          <button
            onClick={() => setIsCreateModalOpen(true)}
            style={{
              padding: '12px 20px',
              backgroundColor: ORANGE,
              color: 'white',
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer',
              fontSize: '14px',
              fontWeight: 'bold',
              transition: 'background-color 0.2s',
            }}
            onMouseEnter={e => (e.currentTarget.style.backgroundColor = '#D46D1A')}
            onMouseLeave={e => (e.currentTarget.style.backgroundColor = ORANGE)}
          >
            + New Return
          </button>
        </div>

        {/* Status Tabs */}
        <div style={{ display: 'flex', gap: '8px', marginBottom: '24px', overflowX: 'auto', paddingBottom: '8px' }}>
          {['ALL', 'PENDING', 'APPROVED', 'SHIPPED', 'CREDIT_ISSUED', 'CLOSED'].map((status) => (
            <button
              key={status}
              onClick={() => setStatusFilter(status)}
              style={{
                padding: '8px 16px',
                backgroundColor: statusFilter === status ? ORANGE : '#f0f0f0',
                color: statusFilter === status ? 'white' : '#333',
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer',
                fontSize: '13px',
                fontWeight: '500',
                whiteSpace: 'nowrap',
                transition: 'all 0.2s',
              }}
            >
              {status.replace(/_/g, ' ')} ({statusCounts[status as keyof typeof statusCounts]})
            </button>
          ))}
        </div>

        {/* Search */}
        <div style={{ marginBottom: '24px' }}>
          <input
            type="text"
            placeholder="Search by RMA #, vendor name, or PO #..."
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

        {/* Loading State */}
        {loading ? (
          <div style={{ display: 'grid', gap: '12px' }}>
            {[...Array(5)].map((_, i) => (
              <div
                key={i}
                style={{
                  padding: '16px',
                  backgroundColor: '#f0f0f0',
                  borderRadius: '6px',
                  height: '60px',
                  animation: 'pulse 2s infinite',
                }}
              />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div style={{
            textAlign: 'center',
            padding: '64px 24px',
            backgroundColor: '#f9f9f9',
            borderRadius: '8px',
            border: '1px dashed #ddd',
          }}>
            <div style={{ fontSize: '48px', marginBottom: '16px' }}>📋</div>
            <h3 style={{ fontSize: '18px', fontWeight: 'bold', color: NAVY, marginBottom: '8px' }}>
              No returns found
            </h3>
            <p style={{ fontSize: '14px', color: '#666' }}>
              {search ? 'Try adjusting your search filters' : 'Create a new return to get started'}
            </p>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', backgroundColor: 'white', borderRadius: '6px', border: '1px solid #ddd' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #ddd', backgroundColor: '#f9f9f9' }}>
                  <th style={{ padding: '12px 16px', textAlign: 'left', fontSize: '13px', fontWeight: '600', color: '#666' }}>RMA #</th>
                  <th style={{ padding: '12px 16px', textAlign: 'left', fontSize: '13px', fontWeight: '600', color: '#666' }}>Vendor</th>
                  <th style={{ padding: '12px 16px', textAlign: 'left', fontSize: '13px', fontWeight: '600', color: '#666' }}>PO #</th>
                  <th style={{ padding: '12px 16px', textAlign: 'left', fontSize: '13px', fontWeight: '600', color: '#666' }}>Items</th>
                  <th style={{ padding: '12px 16px', textAlign: 'right', fontSize: '13px', fontWeight: '600', color: '#666' }}>Total</th>
                  <th style={{ padding: '12px 16px', textAlign: 'left', fontSize: '13px', fontWeight: '600', color: '#666' }}>Status</th>
                  <th style={{ padding: '12px 16px', textAlign: 'left', fontSize: '13px', fontWeight: '600', color: '#666' }}>Created</th>
                  <th style={{ padding: '12px 16px', textAlign: 'center', fontSize: '13px', fontWeight: '600', color: '#666' }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((ret) => (
                  <tr
                    key={ret.id}
                    style={{
                      borderBottom: '1px solid #eee',
                      transition: 'background-color 0.2s',
                      cursor: 'pointer',
                    }}
                    onMouseEnter={e => (e.currentTarget.style.backgroundColor = '#f9f9f9')}
                    onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'white')}
                  >
                    <td style={{ padding: '12px 16px', fontSize: '14px', fontWeight: '600', color: NAVY }}>
                      {ret.rmaNumber}
                    </td>
                    <td style={{ padding: '12px 16px', fontSize: '14px', color: '#333' }}>
                      {ret.vendorName}
                    </td>
                    <td style={{ padding: '12px 16px', fontSize: '13px', color: '#666', fontFamily: 'monospace' }}>
                      {ret.poNumber}
                    </td>
                    <td style={{ padding: '12px 16px', fontSize: '14px', color: '#333' }}>
                      {ret.items.length}
                    </td>
                    <td style={{ padding: '12px 16px', fontSize: '14px', fontWeight: '600', color: NAVY, textAlign: 'right' }}>
                      {formatCurrency(ret.totalAmount)}
                    </td>
                    <td style={{ padding: '12px 16px' }}>
                      <span style={{
                        display: 'inline-block',
                        padding: '4px 12px',
                        backgroundColor: STATUS_COLORS[ret.status],
                        color: 'white',
                        borderRadius: '12px',
                        fontSize: '12px',
                        fontWeight: '600',
                      }}>
                        {ret.status.replace(/_/g, ' ')}
                      </span>
                    </td>
                    <td style={{ padding: '12px 16px', fontSize: '13px', color: '#666' }}>
                      {formatDate(ret.createdAt)}
                    </td>
                    <td style={{ padding: '12px 16px', textAlign: 'center' }}>
                      <button
                        onClick={() => {
                          setSelectedReturn(ret)
                          setView('detail')
                        }}
                        style={{
                          padding: '6px 12px',
                          backgroundColor: 'transparent',
                          color: ORANGE,
                          border: `1px solid ${ORANGE}`,
                          borderRadius: '4px',
                          cursor: 'pointer',
                          fontSize: '12px',
                          fontWeight: '600',
                          transition: 'all 0.2s',
                        }}
                        onMouseEnter={e => {
                          e.currentTarget.style.backgroundColor = ORANGE
                          e.currentTarget.style.color = 'white'
                        }}
                        onMouseLeave={e => {
                          e.currentTarget.style.backgroundColor = 'transparent'
                          e.currentTarget.style.color = ORANGE
                        }}
                      >
                        View
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Toast Notification */}
        {toast && (
          <div style={{
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
            zIndex: 50,
            animation: 'slideIn 0.3s ease-out',
          }}>
            {toast}
          </div>
        )}

        {/* Create Modal */}
        {isCreateModalOpen && (
          <CreateReturnModal
            onClose={() => setIsCreateModalOpen(false)}
            onSuccess={() => {
              setIsCreateModalOpen(false)
              fetchReturns()
              showToast('Return created successfully')
            }}
            showToast={showToast}
          />
        )}

        <style>{`
          @keyframes slideIn {
            from { transform: translateX(400px); opacity: 0; }
            to { transform: translateX(0); opacity: 1; }
          }
          @keyframes pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.5; }
          }
        `}</style>
      </div>
    )
  }

  if (view === 'detail' && selectedReturn) {
    return (
      <ReturnDetailView
        returnData={selectedReturn}
        onBack={() => {
          setView('list')
          fetchReturns()
        }}
        showToast={showToast}
      />
    )
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// CREATE RETURN MODAL
// ═══════════════════════════════════════════════════════════════════════════

interface CreateReturnModalProps {
  onClose: () => void
  onSuccess: () => void
  showToast: (msg: string, type: 'success' | 'error') => void
}

function CreateReturnModal({ onClose, onSuccess, showToast }: CreateReturnModalProps) {
  const [step, setStep] = useState(1)
  const [pos, setPos] = useState<PurchaseOrder[]>([])
  const [selectedPO, setSelectedPO] = useState<string>('')
  const [poItems, setPoItems] = useState<POItem[]>([])
  const [loading, setLoading] = useState(false)

  const [selectedItems, setSelectedItems] = useState<Record<string, {
    returnQty: number
    reason: string
    condition: string
  }>>({})

  const [overallReason, setOverallReason] = useState('')
  const [notes, setNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    loadPOs()
  }, [])

  const loadPOs = async () => {
    try {
      setLoading(true)
      const res = await fetch('/api/ops/receiving')
      const data = await res.json()
      setPos(data.pos || [])
    } catch (err) {
      console.error('Failed to load POs:', err)
      showToast('Failed to load purchase orders', 'error')
    } finally {
      setLoading(false)
    }
  }

  const loadPOItems = async (poId: string) => {
    try {
      setLoading(true)
      const res = await fetch(`/api/ops/receiving/${poId}`)
      const data = await res.json()
      setPoItems(data.items || [])
      setSelectedItems({})
    } catch (err) {
      console.error('Failed to load PO items:', err)
      showToast('Failed to load PO items', 'error')
    } finally {
      setLoading(false)
    }
  }

  const handlePOSelect = (poId: string) => {
    setSelectedPO(poId)
    loadPOItems(poId)
    setStep(2)
  }

  const handleItemCheck = (itemId: string) => {
    const newItems = { ...selectedItems }
    if (newItems[itemId]) {
      delete newItems[itemId]
    } else {
      newItems[itemId] = { returnQty: 0, reason: 'DEFECTIVE', condition: 'DAMAGED' }
    }
    setSelectedItems(newItems)
  }

  const updateItemData = (itemId: string, field: string, value: any) => {
    setSelectedItems(prev => ({
      ...prev,
      [itemId]: {
        ...prev[itemId],
        [field]: value,
      },
    }))
  }

  const handleSubmit = async () => {
    if (Object.keys(selectedItems).length === 0) {
      showToast('Please select at least one item', 'error')
      return
    }

    if (!overallReason.trim()) {
      showToast('Please provide an overall reason', 'error')
      return
    }

    setSubmitting(true)
    try {
      const items = Object.entries(selectedItems).map(([itemId, data]) => ({
        itemId,
        ...data,
      }))

      const res = await fetch('/api/ops/returns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          poId: selectedPO,
          items,
          reason: overallReason,
          notes: notes.trim(),
        }),
      })

      if (!res.ok) throw new Error('Failed to create return')

      showToast('Return created successfully', 'success')
      onSuccess()
    } catch (err) {
      console.error('Failed to create return:', err)
      showToast('Failed to create return', 'error')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      backgroundColor: 'rgba(0,0,0,0.5)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 50,
      padding: '16px',
    }}>
      <div style={{
        backgroundColor: 'white',
        borderRadius: '8px',
        maxWidth: '600px',
        width: '100%',
        maxHeight: '90vh',
        overflowY: 'auto',
      }}>
        {/* Header */}
        <div style={{
          padding: '20px',
          borderBottom: '1px solid #ddd',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          position: 'sticky',
          top: 0,
          backgroundColor: 'white',
        }}>
          <div>
            <h2 style={{ fontSize: '18px', fontWeight: 'bold', color: NAVY, margin: 0 }}>
              Create Vendor Return
            </h2>
            <p style={{ fontSize: '12px', color: '#666', margin: '4px 0 0 0' }}>
              Step {step} of 3
            </p>
          </div>
          <button
            onClick={onClose}
            style={{
              fontSize: '24px',
              border: 'none',
              backgroundColor: 'transparent',
              cursor: 'pointer',
              color: '#999',
            }}
          >
            ×
          </button>
        </div>

        <div style={{ padding: '20px' }}>
          {/* Step 1: Select PO */}
          {step === 1 && (
            <div>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: '600', marginBottom: '8px', color: '#333' }}>
                Select Purchase Order
              </label>
              <div style={{ display: 'grid', gap: '8px' }}>
                {loading ? (
                  <p style={{ color: '#666', fontSize: '13px' }}>Loading POs...</p>
                ) : pos.length === 0 ? (
                  <p style={{ color: '#666', fontSize: '13px' }}>No purchase orders available</p>
                ) : (
                  pos.map(po => (
                    <button
                      key={po.id}
                      onClick={() => handlePOSelect(po.id)}
                      style={{
                        padding: '12px 16px',
                        border: '1px solid #ddd',
                        borderRadius: '6px',
                        backgroundColor: 'white',
                        cursor: 'pointer',
                        textAlign: 'left',
                        transition: 'all 0.2s',
                      }}
                      onMouseEnter={e => {
                        e.currentTarget.style.borderColor = ORANGE
                        e.currentTarget.style.backgroundColor = '#fff8f0'
                      }}
                      onMouseLeave={e => {
                        e.currentTarget.style.borderColor = '#ddd'
                        e.currentTarget.style.backgroundColor = 'white'
                      }}
                    >
                      <div style={{ fontSize: '13px', fontWeight: '600', color: NAVY }}>
                        PO: {po.poNumber}
                      </div>
                      <div style={{ fontSize: '12px', color: '#666', marginTop: '4px' }}>
                        {po.vendorName}
                      </div>
                    </button>
                  ))
                )}
              </div>
            </div>
          )}

          {/* Step 2: Select Items */}
          {step === 2 && (
            <div>
              <h3 style={{ fontSize: '14px', fontWeight: '600', marginBottom: '16px', color: NAVY }}>
                Select items to return
              </h3>
              <div style={{ display: 'grid', gap: '16px' }}>
                {poItems.map(item => (
                  <div key={item.id} style={{ padding: '12px', border: '1px solid #ddd', borderRadius: '6px' }}>
                    <div style={{ display: 'flex', gap: '12px', marginBottom: '12px' }}>
                      <input
                        type="checkbox"
                        checked={!!selectedItems[item.id]}
                        onChange={() => handleItemCheck(item.id)}
                        style={{ cursor: 'pointer', marginTop: '2px' }}
                      />
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: '13px', fontWeight: '600', color: '#333' }}>
                          {item.description}
                        </div>
                        <div style={{ fontSize: '12px', color: '#666', marginTop: '4px' }}>
                          Ordered: {item.orderedQty} | Received: {item.receivedQty}
                        </div>
                      </div>
                    </div>

                    {selectedItems[item.id] && (
                      <div style={{ display: 'grid', gap: '8px', paddingTop: '12px', borderTop: '1px solid #eee' }}>
                        <div>
                          <label style={{ fontSize: '12px', color: '#666', display: 'block', marginBottom: '4px' }}>
                            Return Quantity
                          </label>
                          <input
                            type="number"
                            min="0"
                            max={item.receivedQty}
                            value={selectedItems[item.id].returnQty}
                            onChange={e => updateItemData(item.id, 'returnQty', parseInt(e.target.value) || 0)}
                            style={{
                              width: '100%',
                              padding: '6px 8px',
                              border: '1px solid #ddd',
                              borderRadius: '4px',
                              fontSize: '13px',
                              boxSizing: 'border-box',
                            }}
                          />
                        </div>
                        <div>
                          <label style={{ fontSize: '12px', color: '#666', display: 'block', marginBottom: '4px' }}>
                            Reason
                          </label>
                          <select
                            value={selectedItems[item.id].reason}
                            onChange={e => updateItemData(item.id, 'reason', e.target.value)}
                            style={{
                              width: '100%',
                              padding: '6px 8px',
                              border: '1px solid #ddd',
                              borderRadius: '4px',
                              fontSize: '13px',
                              boxSizing: 'border-box',
                            }}
                          >
                            {REASON_OPTIONS.map(opt => (
                              <option key={opt.value} value={opt.value}>
                                {opt.label}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label style={{ fontSize: '12px', color: '#666', display: 'block', marginBottom: '4px' }}>
                            Condition
                          </label>
                          <select
                            value={selectedItems[item.id].condition}
                            onChange={e => updateItemData(item.id, 'condition', e.target.value)}
                            style={{
                              width: '100%',
                              padding: '6px 8px',
                              border: '1px solid #ddd',
                              borderRadius: '4px',
                              fontSize: '13px',
                              boxSizing: 'border-box',
                            }}
                          >
                            {CONDITION_OPTIONS.map(opt => (
                              <option key={opt.value} value={opt.value}>
                                {opt.label}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Step 3: Summary */}
          {step === 3 && (
            <div style={{ display: 'grid', gap: '16px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: '600', marginBottom: '8px', color: '#333' }}>
                  Overall Reason
                </label>
                <select
                  value={overallReason}
                  onChange={e => setOverallReason(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    border: '1px solid #ddd',
                    borderRadius: '6px',
                    fontSize: '14px',
                    boxSizing: 'border-box',
                  }}
                >
                  <option value="">-- Select reason --</option>
                  {REASON_OPTIONS.map(opt => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: '600', marginBottom: '8px', color: '#333' }}>
                  Notes
                </label>
                <textarea
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  placeholder="Add any additional notes about this return..."
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    border: '1px solid #ddd',
                    borderRadius: '6px',
                    fontSize: '13px',
                    minHeight: '100px',
                    boxSizing: 'border-box',
                    fontFamily: 'inherit',
                    resize: 'vertical',
                  }}
                />
              </div>

              <div style={{ backgroundColor: '#f9f9f9', padding: '12px', borderRadius: '6px' }}>
                <h4 style={{ fontSize: '12px', fontWeight: '600', color: NAVY, margin: '0 0 8px 0' }}>
                  Return Summary
                </h4>
                <div style={{ fontSize: '13px', color: '#666', display: 'grid', gap: '4px' }}>
                  <div>Items: {Object.keys(selectedItems).length}</div>
                  <div>PO: {pos.find(p => p.id === selectedPO)?.poNumber}</div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer Buttons */}
        <div style={{
          padding: '20px',
          borderTop: '1px solid #ddd',
          display: 'flex',
          gap: '12px',
          justifyContent: 'flex-end',
          position: 'sticky',
          bottom: 0,
          backgroundColor: 'white',
        }}>
          {step > 1 && (
            <button
              onClick={() => setStep(step - 1)}
              style={{
                padding: '10px 20px',
                backgroundColor: '#f0f0f0',
                color: '#333',
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer',
                fontSize: '13px',
                fontWeight: '600',
              }}
            >
              Back
            </button>
          )}
          {step < 3 ? (
            <button
              onClick={() => setStep(step + 1)}
              disabled={step === 2 && Object.keys(selectedItems).length === 0}
              style={{
                padding: '10px 20px',
                backgroundColor: ORANGE,
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                cursor: Object.keys(selectedItems).length === 0 && step === 2 ? 'not-allowed' : 'pointer',
                fontSize: '13px',
                fontWeight: '600',
                opacity: step === 2 && Object.keys(selectedItems).length === 0 ? 0.5 : 1,
              }}
            >
              Next
            </button>
          ) : (
            <button
              onClick={handleSubmit}
              disabled={submitting}
              style={{
                padding: '10px 20px',
                backgroundColor: ORANGE,
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                cursor: submitting ? 'not-allowed' : 'pointer',
                fontSize: '13px',
                fontWeight: '600',
                opacity: submitting ? 0.7 : 1,
              }}
            >
              {submitting ? 'Creating...' : 'Create Return'}
            </button>
          )}
          <button
            onClick={onClose}
            style={{
              padding: '10px 20px',
              backgroundColor: 'transparent',
              color: '#666',
              border: '1px solid #ddd',
              borderRadius: '6px',
              cursor: 'pointer',
              fontSize: '13px',
              fontWeight: '600',
            }}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// RETURN DETAIL VIEW
// ═══════════════════════════════════════════════════════════════════════════

interface ReturnDetailViewProps {
  returnData: VendorReturn
  onBack: () => void
  showToast: (msg: string, type: 'success' | 'error') => void
}

function ReturnDetailView({ returnData, onBack, showToast }: ReturnDetailViewProps) {
  const [notes, setNotes] = useState(returnData.notes)
  const [tracking, setTracking] = useState('')
  const [actionLoading, setActionLoading] = useState(false)

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr)
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  }

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount)
  }

  const handleStatusUpdate = async (newStatus: string, trackingNumber?: string) => {
    setActionLoading(true)
    try {
      const res = await fetch(`/api/ops/returns/${returnData.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: newStatus,
          ...(trackingNumber && { trackingNumber }),
          notes: notes.trim(),
        }),
      })

      if (!res.ok) throw new Error('Failed to update return')

      showToast('Return updated successfully', 'success')
      onBack()
    } catch (err) {
      console.error('Failed to update return:', err)
      showToast('Failed to update return', 'error')
    } finally {
      setActionLoading(false)
    }
  }

  return (
    <div style={{ padding: '24px', maxWidth: '1000px', margin: '0 auto' }}>
      {/* Header */}
      <button
        onClick={onBack}
        style={{
          padding: '8px 16px',
          backgroundColor: 'transparent',
          color: ORANGE,
          border: `1px solid ${ORANGE}`,
          borderRadius: '6px',
          cursor: 'pointer',
          fontSize: '13px',
          fontWeight: '600',
          marginBottom: '24px',
        }}
      >
        ← Back to Returns
      </button>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: '24px' }}>
        {/* Main Content */}
        <div>
          {/* Return Info Card */}
          <div style={{ backgroundColor: 'white', borderRadius: '8px', padding: '20px', border: '1px solid #ddd', marginBottom: '24px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', marginBottom: '20px' }}>
              <div>
                <p style={{ fontSize: '12px', color: '#666', margin: '0 0 4px 0', fontWeight: '600', textTransform: 'uppercase' }}>
                  RMA Number
                </p>
                <p style={{ fontSize: '16px', fontWeight: 'bold', color: NAVY, margin: 0 }}>
                  {returnData.rmaNumber}
                </p>
              </div>
              <div>
                <p style={{ fontSize: '12px', color: '#666', margin: '0 0 4px 0', fontWeight: '600', textTransform: 'uppercase' }}>
                  Status
                </p>
                <span style={{
                  display: 'inline-block',
                  padding: '6px 12px',
                  backgroundColor: STATUS_COLORS[returnData.status],
                  color: 'white',
                  borderRadius: '12px',
                  fontSize: '13px',
                  fontWeight: '600',
                }}>
                  {returnData.status.replace(/_/g, ' ')}
                </span>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '20px' }}>
              <div>
                <p style={{ fontSize: '12px', color: '#666', margin: '0 0 4px 0', fontWeight: '600' }}>Vendor</p>
                <p style={{ fontSize: '14px', color: '#333', margin: 0 }}>{returnData.vendorName}</p>
              </div>
              <div>
                <p style={{ fontSize: '12px', color: '#666', margin: '0 0 4px 0', fontWeight: '600' }}>PO Number</p>
                <p style={{ fontSize: '14px', color: '#333', margin: 0 }}>{returnData.poNumber}</p>
              </div>
              <div>
                <p style={{ fontSize: '12px', color: '#666', margin: '0 0 4px 0', fontWeight: '600' }}>Return Amount</p>
                <p style={{ fontSize: '14px', fontWeight: '600', color: ORANGE, margin: 0 }}>
                  {formatCurrency(returnData.totalAmount)}
                </p>
              </div>
            </div>
          </div>

          {/* Items Table */}
          <div style={{ backgroundColor: 'white', borderRadius: '8px', padding: '20px', border: '1px solid #ddd', marginBottom: '24px' }}>
            <h3 style={{ fontSize: '14px', fontWeight: '600', color: NAVY, margin: '0 0 16px 0' }}>
              Return Items
            </h3>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #ddd' }}>
                    <th style={{ padding: '10px 0', textAlign: 'left', fontSize: '12px', fontWeight: '600', color: '#666' }}>
                      Description
                    </th>
                    <th style={{ padding: '10px 0', textAlign: 'center', fontSize: '12px', fontWeight: '600', color: '#666' }}>
                      Return Qty
                    </th>
                    <th style={{ padding: '10px 0', textAlign: 'center', fontSize: '12px', fontWeight: '600', color: '#666' }}>
                      Unit Price
                    </th>
                    <th style={{ padding: '10px 0', textAlign: 'right', fontSize: '12px', fontWeight: '600', color: '#666' }}>
                      Total
                    </th>
                    <th style={{ padding: '10px 0', textAlign: 'left', fontSize: '12px', fontWeight: '600', color: '#666' }}>
                      Reason
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {returnData.items.map(item => (
                    <tr key={item.id} style={{ borderBottom: '1px solid #eee' }}>
                      <td style={{ padding: '12px 0', fontSize: '13px', color: '#333' }}>
                        {item.description}
                      </td>
                      <td style={{ padding: '12px 0', textAlign: 'center', fontSize: '13px', color: '#333' }}>
                        {item.returnQty}
                      </td>
                      <td style={{ padding: '12px 0', textAlign: 'center', fontSize: '13px', color: '#666' }}>
                        {formatCurrency(item.unitPrice)}
                      </td>
                      <td style={{ padding: '12px 0', textAlign: 'right', fontSize: '13px', fontWeight: '600', color: NAVY }}>
                        {formatCurrency(item.returnQty * item.unitPrice)}
                      </td>
                      <td style={{ padding: '12px 0', fontSize: '12px', color: '#666' }}>
                        {item.reason}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Notes Section */}
          <div style={{ backgroundColor: 'white', borderRadius: '8px', padding: '20px', border: '1px solid #ddd' }}>
            <label style={{ display: 'block', fontSize: '13px', fontWeight: '600', marginBottom: '8px', color: '#333' }}>
              Notes
            </label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              style={{
                width: '100%',
                padding: '10px 12px',
                border: '1px solid #ddd',
                borderRadius: '6px',
                fontSize: '13px',
                minHeight: '80px',
                boxSizing: 'border-box',
                fontFamily: 'inherit',
                resize: 'vertical',
              }}
            />
          </div>
        </div>

        {/* Sidebar */}
        <div>
          {/* Action Buttons */}
          <div style={{ backgroundColor: 'white', borderRadius: '8px', padding: '20px', border: '1px solid #ddd', marginBottom: '24px' }}>
            <h4 style={{ fontSize: '12px', fontWeight: '600', color: NAVY, margin: '0 0 16px 0', textTransform: 'uppercase' }}>
              Actions
            </h4>
            <div style={{ display: 'grid', gap: '8px' }}>
              {returnData.status === 'PENDING' && (
                <button
                  onClick={() => handleStatusUpdate('APPROVED')}
                  disabled={actionLoading}
                  style={{
                    padding: '10px 12px',
                    backgroundColor: '#3B82F6',
                    color: 'white',
                    border: 'none',
                    borderRadius: '6px',
                    cursor: actionLoading ? 'not-allowed' : 'pointer',
                    fontSize: '12px',
                    fontWeight: '600',
                    opacity: actionLoading ? 0.7 : 1,
                  }}
                >
                  Approve Return
                </button>
              )}

              {returnData.status === 'APPROVED' && (
                <div>
                  <input
                    type="text"
                    placeholder="Tracking #"
                    value={tracking}
                    onChange={e => setTracking(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '8px 10px',
                      border: '1px solid #ddd',
                      borderRadius: '6px',
                      fontSize: '12px',
                      marginBottom: '8px',
                      boxSizing: 'border-box',
                    }}
                  />
                  <button
                    onClick={() => handleStatusUpdate('SHIPPED', tracking)}
                    disabled={!tracking || actionLoading}
                    style={{
                      width: '100%',
                      padding: '10px 12px',
                      backgroundColor: '#A855F7',
                      color: 'white',
                      border: 'none',
                      borderRadius: '6px',
                      cursor: !tracking || actionLoading ? 'not-allowed' : 'pointer',
                      fontSize: '12px',
                      fontWeight: '600',
                      opacity: !tracking || actionLoading ? 0.7 : 1,
                    }}
                  >
                    Mark Shipped
                  </button>
                </div>
              )}

              {returnData.status === 'SHIPPED' && (
                <button
                  onClick={() => handleStatusUpdate('CREDIT_ISSUED')}
                  disabled={actionLoading}
                  style={{
                    padding: '10px 12px',
                    backgroundColor: '#10B981',
                    color: 'white',
                    border: 'none',
                    borderRadius: '6px',
                    cursor: actionLoading ? 'not-allowed' : 'pointer',
                    fontSize: '12px',
                    fontWeight: '600',
                    opacity: actionLoading ? 0.7 : 1,
                  }}
                >
                  Record Credit
                </button>
              )}

              {returnData.status === 'CREDIT_ISSUED' && (
                <button
                  onClick={() => handleStatusUpdate('CLOSED')}
                  disabled={actionLoading}
                  style={{
                    padding: '10px 12px',
                    backgroundColor: '#9CA3AF',
                    color: 'white',
                    border: 'none',
                    borderRadius: '6px',
                    cursor: actionLoading ? 'not-allowed' : 'pointer',
                    fontSize: '12px',
                    fontWeight: '600',
                    opacity: actionLoading ? 0.7 : 1,
                  }}
                >
                  Close Return
                </button>
              )}

              {returnData.status === 'CLOSED' && (
                <div style={{
                  padding: '12px',
                  backgroundColor: '#f0f0f0',
                  borderRadius: '6px',
                  fontSize: '12px',
                  color: '#666',
                  textAlign: 'center',
                }}>
                  This return is closed
                </div>
              )}
            </div>
          </div>

          {/* Timeline */}
          <div style={{ backgroundColor: 'white', borderRadius: '8px', padding: '20px', border: '1px solid #ddd' }}>
            <h4 style={{ fontSize: '12px', fontWeight: '600', color: NAVY, margin: '0 0 16px 0', textTransform: 'uppercase' }}>
              Timeline
            </h4>
            <div style={{ display: 'grid', gap: '12px' }}>
              {returnData.statusHistory && returnData.statusHistory.length > 0 ? (
                returnData.statusHistory.map((entry, idx) => (
                  <div key={idx} style={{ paddingLeft: '16px', borderLeft: `2px solid ${STATUS_COLORS[entry.status] || '#ddd'}` }}>
                    <p style={{ fontSize: '12px', fontWeight: '600', color: NAVY, margin: '0 0 2px 0' }}>
                      {entry.status.replace(/_/g, ' ')}
                    </p>
                    <p style={{ fontSize: '11px', color: '#666', margin: 0 }}>
                      {new Date(entry.timestamp).toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </p>
                    {entry.notes && (
                      <p style={{ fontSize: '11px', color: '#999', margin: '4px 0 0 0' }}>
                        {entry.notes}
                      </p>
                    )}
                  </div>
                ))
              ) : (
                <p style={{ fontSize: '12px', color: '#666', margin: 0 }}>No history</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
