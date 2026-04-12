'use client'

import { useState, useEffect, useCallback, useRef } from 'react'

interface PO {
  id: string; poNumber: string; supplierId: string; supplierName: string; supplierType: string
  supplierCountry: string; status: string; priority: string; subtotal: number; shippingCost: number
  dutyCost: number; totalCost: number; expectedDate: string; actualDate: string; trackingNumber: string
  notes: string; aiGenerated: boolean; aiReason: string; itemCount: number; totalReceived: number
  totalOrdered: number; createdAt: string
}

interface POStats {
  totalPOs: number; draftCount: number; openCount: number; pendingApproval: number
  totalSpend: number; openValue: number; overdueCount: number
}

export default function PurchaseOrdersPage() {
  const [orders, setOrders] = useState<PO[]>([])
  const [stats, setStats] = useState<POStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState('ALL')
  const [search, setSearch] = useState('')
  const [expandedPO, setExpandedPO] = useState<string | null>(null)
  const [poItems, setPoItems] = useState<any[]>([])
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [trackingInput, setTrackingInput] = useState<string | null>(null)
  const [trackingValue, setTrackingValue] = useState('')

  const fetchPOs = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      if (statusFilter !== 'ALL') params.set('status', statusFilter)
      if (search) params.set('search', search)
      const res = await fetch(`/api/ops/procurement/purchase-orders?${params}`)
      if (res.ok) { const d = await res.json(); setOrders(d.orders || []); setStats(d.stats || null) }
    } catch (err) {
      console.error('[Purchasing] Failed to load purchase orders:', err)
      setError('Failed to load data. Please try again.')
    } finally { setLoading(false) }
  }, [statusFilter, search])

  useEffect(() => {
    fetch('/api/ops/procurement/setup', { method: 'POST' }).then(() => fetchPOs())
  }, []) // eslint-disable-line

  useEffect(() => { fetchPOs() }, [fetchPOs])

  const loadPODetail = async (poId: string) => {
    if (expandedPO === poId) { setExpandedPO(null); return }
    setExpandedPO(poId)
    try {
      const res = await fetch(`/api/ops/procurement/purchase-orders/${poId}`)
      if (res.ok) { const d = await res.json(); setPoItems(d.items || []) }
    } catch { setPoItems([]) }
  }

  const performAction = async (poId: string, action: string, extra?: any) => {
    setActionLoading(`${poId}-${action}`)
    try {
      const res = await fetch(`/api/ops/procurement/purchase-orders/${poId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...extra }),
      })
      if (res.ok) fetchPOs()
    } catch (err) {
      console.error('[Purchasing] Failed to perform PO action:', err)
    } finally { setActionLoading(null) }
  }

  const receiveAll = async (poId: string) => {
    const items = poItems.filter((i: any) => (i.quantityReceived || 0) < i.quantity)
    if (items.length === 0) return
    await performAction(poId, 'receive', {
      receivedItems: items.map((i: any) => ({ itemId: i.id, quantityReceived: i.quantity - (i.quantityReceived || 0) }))
    })
  }

  const statusColor = (s: string) => {
    const m: Record<string, string> = {
      DRAFT: '#6B7280', PENDING_APPROVAL: '#D97706', APPROVED: '#2563EB', SENT: '#7C3AED',
      IN_TRANSIT: '#E67E22', PARTIALLY_RECEIVED: '#EA580C', RECEIVED: '#16A34A', CANCELLED: '#DC2626',
    }
    return m[s] || '#6B7280'
  }

  const STATUSES = ['ALL', 'DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'SENT', 'IN_TRANSIT', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED']

  if (error) {
    return (
      <div style={{ textAlign: 'center', padding: '48px 20px' }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>⚠️</div>
        <p style={{ color: '#6B7280', fontWeight: 500, marginBottom: 24 }}>{error}</p>
        <button onClick={() => { setError(null); fetchPOs() }} style={{ padding: '10px 20px', background: '#1B4F72', color: '#fff', borderRadius: 8, border: 'none', cursor: 'pointer', fontWeight: 600, fontSize: 14 }}>
          Retry
        </button>
      </div>
    )
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: '#1B4F72', margin: 0 }}>🛒 Purchase Orders</h1>
          <p style={{ color: '#6B7280', fontSize: 14, marginTop: 4 }}>Manage purchase orders, track shipments & receive inventory</p>
        </div>
        <a href="/ops/procurement-intelligence" style={{ padding: '10px 20px', borderRadius: 8, background: '#E67E22', color: '#fff', textDecoration: 'none', fontWeight: 600, fontSize: 14 }}>
          🤖 AI Generate POs
        </a>
      </div>

      {/* Stats */}
      {stats && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 24 }}>
          {[
            { label: 'Total POs', value: stats.totalPOs, color: '#1B4F72' },
            { label: 'Drafts', value: stats.draftCount, color: '#6B7280' },
            { label: 'Open/In Transit', value: stats.openCount, color: '#7C3AED' },
            { label: 'Pending Approval', value: stats.pendingApproval, color: '#D97706' },
            { label: 'Open Value', value: `$${Number(stats.openValue).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`, color: '#E67E22' },
            { label: 'Overdue', value: stats.overdueCount, color: '#DC2626' },
          ].map((s, i) => (
            <div key={i} style={{ background: '#fff', borderRadius: 10, border: '1px solid #E5E7EB', padding: 14, textAlign: 'center' }}>
              <div style={{ fontSize: 11, color: '#6B7280' }}>{s.label}</div>
              <div style={{ fontSize: 22, fontWeight: 800, color: s.color, marginTop: 4 }}>{s.value}</div>
            </div>
          ))}
        </div>
      )}

      {/* Filters */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap', alignItems: 'center' }}>
        <input placeholder="Search PO# or supplier..." value={search} onChange={e => setSearch(e.target.value)}
          style={{ padding: '8px 14px', borderRadius: 8, border: '1px solid #D1D5DB', fontSize: 14, minWidth: 200 }} />
        {STATUSES.map(s => (
          <button key={s} onClick={() => setStatusFilter(s)}
            style={{ padding: '6px 12px', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: statusFilter === s ? 700 : 500,
              background: statusFilter === s ? '#1B4F72' : '#F3F4F6', color: statusFilter === s ? '#fff' : '#6B7280' }}>
            {s.replace(/_/g, ' ')}
          </button>
        ))}
      </div>

      {/* PO List */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: 40, color: '#6B7280' }}>Loading purchase orders...</div>
      ) : orders.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 60, background: '#F9FAFB', borderRadius: 12 }}>
          <div style={{ fontSize: 48 }}>🛒</div>
          <h3 style={{ color: '#1B4F72' }}>No purchase orders</h3>
          <p style={{ color: '#6B7280' }}>Use the AI Procurement Brain to auto-generate POs or create them manually.</p>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 8 }}>
          {orders.map(po => (
            <div key={po.id} style={{ background: '#fff', borderRadius: 12, border: '1px solid #E5E7EB', overflow: 'hidden' }}>
              <div onClick={() => loadPODetail(po.id)} style={{ padding: 16, cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1 }}>
                  <span style={{ padding: '4px 10px', borderRadius: 6, fontSize: 11, fontWeight: 700, color: '#fff', background: statusColor(po.status) }}>
                    {po.status.replace(/_/g, ' ')}
                  </span>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontWeight: 700, fontSize: 15, color: '#111' }}>{po.poNumber}</span>
                      {po.aiGenerated && <span style={{ fontSize: 10, background: '#F3E8FF', color: '#7C3AED', padding: '2px 6px', borderRadius: 4 }}>🤖 AI</span>}
                      {po.priority === 'URGENT' && <span style={{ fontSize: 10, background: '#FEE2E2', color: '#DC2626', padding: '2px 6px', borderRadius: 4 }}>URGENT</span>}
                    </div>
                    <div style={{ fontSize: 12, color: '#6B7280', marginTop: 2 }}>
                      {po.supplierName} ({po.supplierType}) • {po.itemCount} items
                      {po.expectedDate && ` • ETA: ${new Date(po.expectedDate).toLocaleDateString()}`}
                    </div>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                  {po.totalOrdered > 0 && (
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: 11, color: '#6B7280' }}>Received</div>
                      <div style={{ fontWeight: 600, color: po.totalReceived >= po.totalOrdered ? '#16A34A' : '#E67E22' }}>
                        {po.totalReceived}/{po.totalOrdered}
                      </div>
                    </div>
                  )}
                  <div style={{ textAlign: 'right', minWidth: 100 }}>
                    <div style={{ fontWeight: 700, fontSize: 16, color: '#1B4F72' }}>
                      ${Number(po.totalCost || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                    </div>
                    <div style={{ fontSize: 11, color: '#6B7280' }}>
                      {new Date(po.createdAt).toLocaleDateString()}
                    </div>
                  </div>
                  <span style={{ fontSize: 16, color: '#9CA3AF' }}>{expandedPO === po.id ? '▲' : '▼'}</span>
                </div>
              </div>

              {/* Expanded Detail */}
              {expandedPO === po.id && (
                <div style={{ borderTop: '1px solid #E5E7EB', padding: 16, background: '#FAFAFA' }}>
                  {po.aiReason && (
                    <div style={{ background: '#F0F9FF', borderRadius: 8, padding: 12, marginBottom: 12 }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: '#1B4F72' }}>🤖 AI Reason</div>
                      <p style={{ margin: '4px 0 0', fontSize: 13, color: '#334155' }}>{po.aiReason}</p>
                    </div>
                  )}

                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, marginBottom: 16 }}>
                    <thead>
                      <tr style={{ background: '#F3F4F6' }}>
                        <th style={{ textAlign: 'left', padding: '8px 10px' }}>Product</th>
                        <th style={{ textAlign: 'left', padding: '8px 10px' }}>SKU</th>
                        <th style={{ textAlign: 'right', padding: '8px 10px' }}>Qty</th>
                        <th style={{ textAlign: 'right', padding: '8px 10px' }}>Unit Cost</th>
                        <th style={{ textAlign: 'right', padding: '8px 10px' }}>Line Total</th>
                        <th style={{ textAlign: 'right', padding: '8px 10px' }}>Received</th>
                      </tr>
                    </thead>
                    <tbody>
                      {poItems.map((item: any, i: number) => (
                        <tr key={i} style={{ borderBottom: '1px solid #E5E7EB' }}>
                          <td style={{ padding: '8px 10px', fontWeight: 500 }}>{item.productName}</td>
                          <td style={{ padding: '8px 10px', fontFamily: 'monospace', fontSize: 12, color: '#6B7280' }}>{item.sku || '--'}</td>
                          <td style={{ padding: '8px 10px', textAlign: 'right' }}>{item.quantity}</td>
                          <td style={{ padding: '8px 10px', textAlign: 'right' }}>${Number(item.unitCost).toFixed(2)}</td>
                          <td style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 600 }}>${Number(item.lineTotal).toFixed(2)}</td>
                          <td style={{ padding: '8px 10px', textAlign: 'right', color: (item.quantityReceived || 0) >= item.quantity ? '#16A34A' : '#E67E22', fontWeight: 600 }}>
                            {item.quantityReceived || 0}/{item.quantity}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  {/* Cost Breakdown */}
                  <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
                    <div style={{ minWidth: 200 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 13 }}>
                        <span>Subtotal:</span><span>${Number(po.subtotal || 0).toFixed(2)}</span>
                      </div>
                      {Number(po.dutyCost || 0) > 0 && (
                        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 13, color: '#6B7280' }}>
                          <span>Duty:</span><span>${Number(po.dutyCost).toFixed(2)}</span>
                        </div>
                      )}
                      {Number(po.shippingCost || 0) > 0 && (
                        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 13, color: '#6B7280' }}>
                          <span>Shipping:</span><span>${Number(po.shippingCost).toFixed(2)}</span>
                        </div>
                      )}
                      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', fontSize: 15, fontWeight: 700, borderTop: '2px solid #1B4F72', marginTop: 4 }}>
                        <span>Total:</span><span style={{ color: '#1B4F72' }}>${Number(po.totalCost || 0).toFixed(2)}</span>
                      </div>
                    </div>
                  </div>

                  {/* Action Buttons */}
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {po.status === 'DRAFT' && (
                      <>
                        <button onClick={() => performAction(po.id, 'approve')} disabled={actionLoading === `${po.id}-approve`}
                          style={{ padding: '8px 16px', borderRadius: 6, border: 'none', cursor: 'pointer', background: '#2563EB', color: '#fff', fontWeight: 600, fontSize: 13 }}>
                          ✓ Approve
                        </button>
                        <button onClick={() => performAction(po.id, 'cancel', { reason: 'Cancelled by staff' })}
                          style={{ padding: '8px 16px', borderRadius: 6, border: '1px solid #DC2626', cursor: 'pointer', background: '#fff', color: '#DC2626', fontSize: 13 }}>
                          Cancel
                        </button>
                      </>
                    )}
                    {po.status === 'APPROVED' && (
                      <button onClick={() => performAction(po.id, 'send')}
                        style={{ padding: '8px 16px', borderRadius: 6, border: 'none', cursor: 'pointer', background: '#7C3AED', color: '#fff', fontWeight: 600, fontSize: 13 }}>
                        📤 Send to Supplier
                      </button>
                    )}
                    {po.status === 'SENT' && trackingInput !== po.id && (
                      <button onClick={() => { setTrackingInput(po.id); setTrackingValue('') }}
                        style={{ padding: '8px 16px', borderRadius: 6, border: 'none', cursor: 'pointer', background: '#E67E22', color: '#fff', fontWeight: 600, fontSize: 13 }}>
                        🚚 Mark In Transit
                      </button>
                    )}
                    {po.status === 'SENT' && trackingInput === po.id && (
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        <input
                          autoFocus
                          placeholder="Tracking number..."
                          value={trackingValue}
                          onChange={e => setTrackingValue(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') { performAction(po.id, 'in_transit', { trackingNumber: trackingValue }); setTrackingInput(null) } if (e.key === 'Escape') setTrackingInput(null) }}
                          style={{ padding: '6px 12px', borderRadius: 6, border: '1px solid #d1d5db', fontSize: 13, width: 180 }}
                        />
                        <button onClick={() => { performAction(po.id, 'in_transit', { trackingNumber: trackingValue }); setTrackingInput(null) }}
                          style={{ padding: '6px 12px', borderRadius: 6, border: 'none', cursor: 'pointer', background: '#10B981', color: '#fff', fontWeight: 600, fontSize: 12 }}>
                          Confirm
                        </button>
                        <button onClick={() => setTrackingInput(null)}
                          style={{ padding: '6px 12px', borderRadius: 6, border: '1px solid #e5e7eb', cursor: 'pointer', background: '#fff', fontSize: 12 }}>
                          Cancel
                        </button>
                      </div>
                    )}
                    {['SENT', 'IN_TRANSIT', 'PARTIALLY_RECEIVED'].includes(po.status) && (
                      <button onClick={() => receiveAll(po.id)} disabled={actionLoading?.startsWith(po.id)}
                        style={{ padding: '8px 16px', borderRadius: 6, border: 'none', cursor: 'pointer', background: '#16A34A', color: '#fff', fontWeight: 600, fontSize: 13 }}>
                        📥 Receive All Items
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
