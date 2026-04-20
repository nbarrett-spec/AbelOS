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

interface RecommendationGroup {
  vendorId: string
  vendorName: string
  vendorCode: string
  itemCount: number
  estimatedTotal: number
  urgency: 'CRITICAL' | 'STANDARD'
  items: Array<{
    productId: string
    sku: string
    productName: string
    onHand: number
    onOrder: number
    reorderPoint: number
    recommendedQty: number
    estimatedCost: number
  }>
}

interface VendorScorecard {
  vendorId: string
  vendorName: string
  vendorCode: string
  totalPOs: number
  onTimeRate: number
  avgLeadDays: number
  spend30Days: number
  spend90Days: number
  spend365Days: number
  qualityIssues: number
  topProducts: Array<any>
  trend: {
    previousMonth: number
    currentMonth: number
    percentChange: number
  }
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
  const [recommendations, setRecommendations] = useState<RecommendationGroup[]>([])
  const [scorecards, setScorecards] = useState<VendorScorecard[]>([])
  const [recsLoading, setRecsLoading] = useState(false)
  const [scoresLoading, setScoresLoading] = useState(false)
  const [activeTab, setActiveTab] = useState<'overview' | 'scorecards'>('overview')
  const [expandedVendor, setExpandedVendor] = useState<string | null>(null)
  const [expandedScorecard, setExpandedScorecard] = useState<string | null>(null)

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

  const fetchRecommendations = useCallback(async () => {
    setRecsLoading(true)
    try {
      const res = await fetch('/api/ops/purchasing/recommendations')
      if (res.ok) {
        const data = await res.json()
        setRecommendations(data)
      }
    } catch (err) {
      console.error('[Purchasing] Failed to load recommendations:', err)
    } finally {
      setRecsLoading(false)
    }
  }, [])

  const fetchScorecards = useCallback(async () => {
    setScoresLoading(true)
    try {
      const res = await fetch('/api/ops/vendors/scorecard')
      if (res.ok) {
        const data = await res.json()
        setScorecards(data)
      }
    } catch (err) {
      console.error('[Purchasing] Failed to load scorecards:', err)
    } finally {
      setScoresLoading(false)
    }
  }, [])

  const createRecommendationPO = async (vendorId: string, vendorName: string, items: any[]) => {
    const staffId = 'staff_default' // TODO: Get from auth context
    setActionLoading(`rec-${vendorId}`)
    try {
      const res = await fetch('/api/ops/purchasing/recommendations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vendorId,
          createdById: staffId,
          items: items.map(i => ({
            productId: i.productId,
            sku: i.sku,
            productName: i.productName,
            recommendedQty: i.recommendedQty,
            unitCost: i.unitCost
          }))
        })
      })
      if (res.ok) {
        alert(`Draft PO created for ${vendorName}`)
        fetchPOs()
        fetchRecommendations()
      }
    } catch (err) {
      console.error('[Purchasing] Failed to create recommendation PO:', err)
      alert('Failed to create PO from recommendation')
    } finally {
      setActionLoading(null)
    }
  }

  useEffect(() => {
    fetch('/api/ops/procurement/setup', { method: 'POST' }).then(() => {
      fetchPOs()
      fetchRecommendations()
      fetchScorecards()
    })
  }, []) // eslint-disable-line

  useEffect(() => { fetchPOs() }, [fetchPOs])
  useEffect(() => { fetchRecommendations() }, [fetchRecommendations])
  useEffect(() => { fetchScorecards() }, [fetchScorecards])

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
      IN_TRANSIT: '#C9822B', PARTIALLY_RECEIVED: '#EA580C', RECEIVED: '#16A34A', CANCELLED: '#DC2626',
    }
    return m[s] || '#6B7280'
  }

  const STATUSES = ['ALL', 'DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'SENT', 'IN_TRANSIT', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED']

  if (error) {
    return (
      <div style={{ textAlign: 'center', padding: '48px 20px' }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>⚠️</div>
        <p style={{ color: '#6B7280', fontWeight: 500, marginBottom: 24 }}>{error}</p>
        <button onClick={() => { setError(null); fetchPOs() }} style={{ padding: '10px 20px', background: '#3E2A1E', color: '#fff', borderRadius: 8, border: 'none', cursor: 'pointer', fontWeight: 600, fontSize: 14 }}>
          Retry
        </button>
      </div>
    )
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: '#3E2A1E', margin: 0 }}>🛒 Purchase Orders</h1>
          <p style={{ color: '#6B7280', fontSize: 14, marginTop: 4 }}>Smart PO recommendations, vendor scorecards & order management</p>
        </div>
        <a href="/ops/procurement-intelligence" style={{ padding: '10px 20px', borderRadius: 8, background: '#C9822B', color: '#fff', textDecoration: 'none', fontWeight: 600, fontSize: 14 }}>
          🤖 AI Generate POs
        </a>
      </div>

      {/* Tab Navigation */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20, borderBottom: '2px solid #E5E7EB' }}>
        <button
          onClick={() => setActiveTab('overview')}
          style={{
            padding: '12px 20px',
            border: 'none',
            background: 'transparent',
            cursor: 'pointer',
            fontSize: 14,
            fontWeight: activeTab === 'overview' ? 700 : 500,
            color: activeTab === 'overview' ? '#3E2A1E' : '#9CA3AF',
            borderBottom: activeTab === 'overview' ? '3px solid #C9822B' : 'none',
            marginBottom: '-2px'
          }}
        >
          Overview & Recommendations
        </button>
        <button
          onClick={() => setActiveTab('scorecards')}
          style={{
            padding: '12px 20px',
            border: 'none',
            background: 'transparent',
            cursor: 'pointer',
            fontSize: 14,
            fontWeight: activeTab === 'scorecards' ? 700 : 500,
            color: activeTab === 'scorecards' ? '#3E2A1E' : '#9CA3AF',
            borderBottom: activeTab === 'scorecards' ? '3px solid #C9822B' : 'none',
            marginBottom: '-2px'
          }}
        >
          Vendor Scorecards
        </button>
      </div>

      {/* Overview Tab */}
      {activeTab === 'overview' && (
        <>
          {/* Smart PO Recommendations Panel */}
          <div style={{ background: '#FFF8F0', borderRadius: 12, border: '2px solid #C9822B', padding: 16, marginBottom: 24 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <h2 style={{ fontSize: 16, fontWeight: 700, color: '#3E2A1E', margin: 0 }}>⚡ Smart PO Recommendations (MRP)</h2>
              <button
                onClick={() => fetchRecommendations()}
                disabled={recsLoading}
                style={{ padding: '6px 12px', borderRadius: 6, border: 'none', background: '#C9822B', color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
              >
                {recsLoading ? 'Loading...' : 'Refresh'}
              </button>
            </div>

            {recsLoading ? (
              <div style={{ textAlign: 'center', padding: 20, color: '#6B7280' }}>Loading recommendations...</div>
            ) : recommendations.length === 0 ? (
              <div style={{ padding: 20, color: '#6B7280', textAlign: 'center' }}>All inventory levels are healthy. No reorder recommendations.</div>
            ) : (
              <div style={{ display: 'grid', gap: 8 }}>
                {recommendations.map((rec, idx) => (
                  <div key={idx} style={{ background: '#fff', borderRadius: 8, border: `2px solid ${rec.urgency === 'CRITICAL' ? '#DC2626' : '#F59E0B'}`, overflow: 'hidden' }}>
                    <div
                      onClick={() => setExpandedVendor(expandedVendor === rec.vendorId ? null : rec.vendorId)}
                      style={{
                        padding: 12,
                        cursor: 'pointer',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        background: rec.urgency === 'CRITICAL' ? '#FEE2E2' : '#FEF3C7'
                      }}
                    >
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 14, fontWeight: 700, color: '#111' }}>
                          {rec.vendorName}
                          <span style={{
                            marginLeft: 8,
                            padding: '3px 8px',
                            borderRadius: 4,
                            fontSize: 11,
                            fontWeight: 600,
                            background: rec.urgency === 'CRITICAL' ? '#DC2626' : '#F59E0B',
                            color: '#fff'
                          }}>
                            {rec.urgency}
                          </span>
                        </div>
                        <div style={{ fontSize: 12, color: '#6B7280', marginTop: 2 }}>
                          {rec.itemCount} items • Est. ${Number(rec.estimatedTotal).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                        </div>
                      </div>
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          createRecommendationPO(rec.vendorId, rec.vendorName, rec.items)
                        }}
                        disabled={actionLoading === `rec-${rec.vendorId}`}
                        style={{
                          padding: '8px 16px',
                          borderRadius: 6,
                          border: 'none',
                          background: '#27AE60',
                          color: '#fff',
                          fontSize: 12,
                          fontWeight: 600,
                          cursor: 'pointer',
                          marginRight: 12
                        }}
                      >
                        {actionLoading === `rec-${rec.vendorId}` ? 'Creating...' : '+ Create PO'}
                      </button>
                      <span style={{ color: '#6B7280', fontSize: 12 }}>{expandedVendor === rec.vendorId ? '▲' : '▼'}</span>
                    </div>

                    {/* Expanded recommendation items */}
                    {expandedVendor === rec.vendorId && (
                      <div style={{ padding: 12, background: '#F9FAFB', borderTop: '1px solid #E5E7EB' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                          <thead>
                            <tr style={{ background: '#F3F4F6' }}>
                              <th style={{ textAlign: 'left', padding: '6px 8px', fontWeight: 600, color: '#6B7280' }}>SKU</th>
                              <th style={{ textAlign: 'left', padding: '6px 8px', fontWeight: 600, color: '#6B7280' }}>Product</th>
                              <th style={{ textAlign: 'right', padding: '6px 8px', fontWeight: 600, color: '#6B7280' }}>On Hand</th>
                              <th style={{ textAlign: 'right', padding: '6px 8px', fontWeight: 600, color: '#6B7280' }}>Rec. Qty</th>
                              <th style={{ textAlign: 'right', padding: '6px 8px', fontWeight: 600, color: '#6B7280' }}>Est. Cost</th>
                            </tr>
                          </thead>
                          <tbody>
                            {rec.items.map((item, i) => (
                              <tr key={i} style={{ borderBottom: '1px solid #E5E7EB' }}>
                                <td style={{ padding: '6px 8px', fontFamily: 'monospace', color: '#6B7280' }}>{item.sku}</td>
                                <td style={{ padding: '6px 8px' }}>{item.productName}</td>
                                <td style={{ padding: '6px 8px', textAlign: 'right' }}>{item.onHand}</td>
                                <td style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 600 }}>{item.recommendedQty}</td>
                                <td style={{ padding: '6px 8px', textAlign: 'right' }}>${Number(item.estimatedCost).toFixed(2)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Stats */}
          {stats && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 24 }}>
              {[
                { label: 'Total POs', value: stats.totalPOs, color: '#3E2A1E' },
                { label: 'Drafts', value: stats.draftCount, color: '#6B7280' },
                { label: 'Open/In Transit', value: stats.openCount, color: '#7C3AED' },
                { label: 'Pending Approval', value: stats.pendingApproval, color: '#D97706' },
                { label: 'Open Value', value: `$${Number(stats.openValue).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`, color: '#C9822B' },
                { label: 'Overdue', value: stats.overdueCount, color: '#DC2626' },
              ].map((s, i) => (
                <div key={i} style={{ background: '#fff', borderRadius: 10, border: '1px solid #E5E7EB', padding: 14, textAlign: 'center' }}>
                  <div style={{ fontSize: 11, color: '#6B7280' }}>{s.label}</div>
                  <div style={{ fontSize: 22, fontWeight: 800, color: s.color, marginTop: 4 }}>{s.value}</div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* Vendor Scorecards Tab */}
      {activeTab === 'scorecards' && (
        <div style={{ marginBottom: 24 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <h2 style={{ fontSize: 16, fontWeight: 700, color: '#3E2A1E', margin: 0 }}>📊 Vendor Performance Scorecards</h2>
            <button
              onClick={() => fetchScorecards()}
              disabled={scoresLoading}
              style={{ padding: '6px 12px', borderRadius: 6, border: 'none', background: '#C9822B', color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
            >
              {scoresLoading ? 'Loading...' : 'Refresh'}
            </button>
          </div>

          {scoresLoading ? (
            <div style={{ textAlign: 'center', padding: 40, color: '#6B7280' }}>Loading vendor scorecards...</div>
          ) : scorecards.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 40, background: '#F9FAFB', borderRadius: 12 }}>
              <p style={{ color: '#6B7280' }}>No vendors found. Create vendors first.</p>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 16 }}>
              {scorecards.map(sc => {
                const rateColor = sc.onTimeRate >= 90 ? '#27AE60' : sc.onTimeRate >= 70 ? '#F59E0B' : '#DC2626'
                return (
                  <div key={sc.vendorId} style={{ background: '#fff', borderRadius: 12, border: '1px solid #E5E7EB', overflow: 'hidden' }}>
                    <div
                      onClick={() => setExpandedScorecard(expandedScorecard === sc.vendorId ? null : sc.vendorId)}
                      style={{
                        padding: 16,
                        cursor: 'pointer',
                        borderBottom: expandedScorecard === sc.vendorId ? '1px solid #E5E7EB' : 'none'
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: 12 }}>
                        <div>
                          <h3 style={{ fontSize: 15, fontWeight: 700, color: '#111', margin: 0 }}>{sc.vendorName}</h3>
                          <p style={{ fontSize: 12, color: '#6B7280', margin: '4px 0 0' }}>{sc.vendorCode}</p>
                        </div>
                        <span style={{ fontSize: 18 }}>{expandedScorecard === sc.vendorId ? '▲' : '▼'}</span>
                      </div>

                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                        <div style={{ background: '#F3EAD8', borderRadius: 8, padding: 10 }}>
                          <div style={{ fontSize: 11, color: '#6B7280', marginBottom: 2 }}>On-Time Rate</div>
                          <div style={{ fontSize: 20, fontWeight: 700, color: rateColor }}>
                            {Math.round(sc.onTimeRate)}%
                          </div>
                        </div>
                        <div style={{ background: '#F3EAD8', borderRadius: 8, padding: 10 }}>
                          <div style={{ fontSize: 11, color: '#6B7280', marginBottom: 2 }}>Avg Lead Days</div>
                          <div style={{ fontSize: 20, fontWeight: 700, color: '#3E2A1E' }}>
                            {sc.avgLeadDays}d
                          </div>
                        </div>
                      </div>

                      <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid #E5E7EB' }}>
                        <div style={{ fontSize: 11, color: '#6B7280', marginBottom: 4 }}>90-Day Spend</div>
                        <div style={{ fontSize: 16, fontWeight: 700, color: '#3E2A1E' }}>
                          ${Number(sc.spend90Days).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                        </div>
                      </div>
                    </div>

                    {/* Expanded scorecard detail */}
                    {expandedScorecard === sc.vendorId && (
                      <div style={{ padding: 16, background: '#F9FAFB', borderTop: '1px solid #E5E7EB' }}>
                        <div style={{ marginBottom: 16 }}>
                          <div style={{ fontSize: 12, fontWeight: 600, color: '#6B7280', marginBottom: 8 }}>Spend by Period</div>
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                            <div style={{ background: '#fff', borderRadius: 6, padding: 10, textAlign: 'center' }}>
                              <div style={{ fontSize: 10, color: '#6B7280' }}>30 Days</div>
                              <div style={{ fontSize: 14, fontWeight: 700, marginTop: 2 }}>
                                ${Math.round(sc.spend30Days).toLocaleString()}
                              </div>
                            </div>
                            <div style={{ background: '#fff', borderRadius: 6, padding: 10, textAlign: 'center' }}>
                              <div style={{ fontSize: 10, color: '#6B7280' }}>90 Days</div>
                              <div style={{ fontSize: 14, fontWeight: 700, marginTop: 2 }}>
                                ${Math.round(sc.spend90Days).toLocaleString()}
                              </div>
                            </div>
                            <div style={{ background: '#fff', borderRadius: 6, padding: 10, textAlign: 'center' }}>
                              <div style={{ fontSize: 10, color: '#6B7280' }}>1 Year</div>
                              <div style={{ fontSize: 14, fontWeight: 700, marginTop: 2 }}>
                                ${Math.round(sc.spend365Days).toLocaleString()}
                              </div>
                            </div>
                          </div>
                        </div>

                        <div>
                          <div style={{ fontSize: 12, fontWeight: 600, color: '#6B7280', marginBottom: 8 }}>Key Metrics</div>
                          <div style={{ display: 'grid', gap: 6, fontSize: 12 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                              <span style={{ color: '#6B7280' }}>Total POs</span>
                              <span style={{ fontWeight: 600 }}>{sc.totalPOs}</span>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: 6, borderBottom: '1px solid #E5E7EB' }}>
                              <span style={{ color: '#6B7280' }}>Quality Issues</span>
                              <span style={{ fontWeight: 600 }}>{sc.qualityIssues}</span>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', color: sc.trend.percentChange >= 0 ? '#27AE60' : '#DC2626' }}>
                              <span>Month-over-Month</span>
                              <span style={{ fontWeight: 600 }}>{sc.trend.percentChange > 0 ? '+' : ''}{sc.trend.percentChange.toFixed(1)}%</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* Filters - Only show in overview tab */}
      {activeTab === 'overview' && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap', alignItems: 'center' }}>
          <input placeholder="Search PO# or supplier..." value={search} onChange={e => setSearch(e.target.value)}
            style={{ padding: '8px 14px', borderRadius: 8, border: '1px solid #D1D5DB', fontSize: 14, minWidth: 200 }} />
          {STATUSES.map(s => (
            <button key={s} onClick={() => setStatusFilter(s)}
              style={{ padding: '6px 12px', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: statusFilter === s ? 700 : 500,
                background: statusFilter === s ? '#3E2A1E' : '#F3F4F6', color: statusFilter === s ? '#fff' : '#6B7280' }}>
              {s.replace(/_/g, ' ')}
            </button>
          ))}
        </div>
      )}

      {/* PO List - Only show in overview tab */}
      {activeTab === 'overview' && (
        <>
      {loading ? (
        <div style={{ textAlign: 'center', padding: 40, color: '#6B7280' }}>Loading purchase orders...</div>
      ) : orders.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 60, background: '#F9FAFB', borderRadius: 12 }}>
          <div style={{ fontSize: 48 }}>🛒</div>
          <h3 style={{ color: '#3E2A1E' }}>No purchase orders</h3>
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
                      <div style={{ fontWeight: 600, color: po.totalReceived >= po.totalOrdered ? '#16A34A' : '#C9822B' }}>
                        {po.totalReceived}/{po.totalOrdered}
                      </div>
                    </div>
                  )}
                  <div style={{ textAlign: 'right', minWidth: 100 }}>
                    <div style={{ fontWeight: 700, fontSize: 16, color: '#3E2A1E' }}>
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
                      <div style={{ fontSize: 12, fontWeight: 700, color: '#3E2A1E' }}>🤖 AI Reason</div>
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
                          <td style={{ padding: '8px 10px', textAlign: 'right', color: (item.quantityReceived || 0) >= item.quantity ? '#16A34A' : '#C9822B', fontWeight: 600 }}>
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
                      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', fontSize: 15, fontWeight: 700, borderTop: '2px solid #3E2A1E', marginTop: 4 }}>
                        <span>Total:</span><span style={{ color: '#3E2A1E' }}>${Number(po.totalCost || 0).toFixed(2)}</span>
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
                        style={{ padding: '8px 16px', borderRadius: 6, border: 'none', cursor: 'pointer', background: '#C9822B', color: '#fff', fontWeight: 600, fontSize: 13 }}>
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
        </>
      )}
    </div>
  )
}
