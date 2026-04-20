'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { useToast } from '@/contexts/ToastContext'

interface InventoryItem {
  id: string; sku: string; productName: string; category: string; location: string
  quantityOnHand: number; quantityCommitted: number; quantityOnOrder: number; quantityAvailable: number
  reorderPoint: number; reorderQty: number; safetyStock: number; maxStock: number
  unitCost: number; totalValue: number; lastReceivedAt: string; avgDailyUsage: number
  daysOfSupply: number; stockStatus: string; calcDaysOfSupply: number; status: string
}

interface Stats {
  totalItems: number; totalValue: number; lowStockCount: number; outOfStockCount: number
  overstockCount: number; criticalCount: number
}

export default function InventoryPage() {
  const { addToast } = useToast()
  const [inventory, setInventory] = useState<InventoryItem[]>([])
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState({ category: '', status: '', search: '', sort: 'daysOfSupply' })
  const [editItem, setEditItem] = useState<string | null>(null)
  const [editForm, setEditForm] = useState<any>({})
  const [syncing, setSyncing] = useState(false)
  const [expandedItem, setExpandedItem] = useState<string | null>(null)

  const fetchInventory = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (filter.category) params.set('category', filter.category)
      if (filter.status) params.set('status', filter.status)
      if (filter.search) params.set('search', filter.search)
      if (filter.sort) params.set('sort', filter.sort)
      const res = await fetch(`/api/ops/procurement/inventory?${params}`)
      if (res.ok) { const d = await res.json(); setInventory(d.inventory || []); setStats(d.stats || null) }
    } catch (err) {
      console.error('[Inventory] Failed to load inventory:', err)
    } finally { setLoading(false) }
  }, [filter])

  useEffect(() => {
    fetch('/api/ops/procurement/setup', { method: 'POST' }).then(() => fetchInventory())
  }, []) // eslint-disable-line

  useEffect(() => { fetchInventory() }, [fetchInventory])

  const syncProducts = async () => {
    setSyncing(true)
    try {
      const res = await fetch('/api/ops/procurement/inventory', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'sync_products' }),
      })
      if (res.ok) { const d = await res.json(); addToast({ type: 'success', title: 'Sync Complete', message: d.message }); fetchInventory() }
    } catch (err) {
      console.error('[Inventory] Failed to sync products:', err)
    } finally { setSyncing(false) }
  }

  const updateItem = async (id: string) => {
    try {
      await fetch('/api/ops/procurement/inventory', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, ...editForm }),
      })
      setEditItem(null)
      fetchInventory()
    } catch (err) {
      console.error('[Inventory] Failed to update inventory item:', err)
    }
  }

  const statusColor = (s: string) => {
    const m: Record<string, string> = { OUT_OF_STOCK: '#DC2626', CRITICAL: '#EA580C', LOW_STOCK: '#D97706', OVERSTOCK: '#7C3AED', IN_STOCK: '#16A34A' }
    return m[s] || '#6B7280'
  }

  const categories = Array.from(new Set(inventory.map(i => i.category))).sort()

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: '#3E2A1E', margin: 0 }}>📦 Inventory Management</h1>
          <p style={{ color: '#6B7280', fontSize: 14, marginTop: 4 }}>Track stock levels, reorder points & daily usage</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <a href="/ops/procurement-intelligence" style={{ padding: '10px 16px', borderRadius: 8, background: '#C9822B', color: '#fff', textDecoration: 'none', fontWeight: 600, fontSize: 13 }}>
            🤖 AI Analysis
          </a>
          <button onClick={syncProducts} disabled={syncing}
            style={{ padding: '10px 16px', borderRadius: 8, border: 'none', cursor: 'pointer', background: syncing ? '#9CA3AF' : '#3E2A1E', color: '#fff', fontWeight: 600, fontSize: 13 }}>
            {syncing ? '⏳ Syncing...' : '🔄 Sync Products'}
          </button>
        </div>
      </div>

      {/* Stats */}
      {stats && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 24 }}>
          {[
            { label: 'Total Items', value: stats.totalItems, color: '#3E2A1E', icon: '📦', status: '' },
            { label: 'Inventory Value', value: `$${Number(stats.totalValue || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`, color: '#16A34A', icon: '💰', status: '' },
            { label: 'Out of Stock', value: stats.outOfStockCount, color: '#DC2626', icon: '🚫', status: 'OUT_OF_STOCK' },
            { label: 'Critical', value: stats.criticalCount, color: '#EA580C', icon: '🚨', status: 'CRITICAL' },
            { label: 'Low Stock', value: stats.lowStockCount, color: '#D97706', icon: '⚠️', status: 'LOW_STOCK' },
            { label: 'Overstocked', value: stats.overstockCount, color: '#7C3AED', icon: '📈', status: 'OVERSTOCK' },
          ].map((s, i) => (
            <div key={i} onClick={s.status ? () => setFilter({ ...filter, status: s.status }) : undefined}
              style={{
                background: '#fff',
                borderRadius: 10,
                border: '1px solid #E5E7EB',
                padding: 14,
                textAlign: 'center',
                cursor: s.status ? 'pointer' : 'default',
                transition: 'all 0.2s ease',
                boxShadow: filter.status === s.status ? '0 0 0 2px ' + s.color : 'none'
              }}
              onMouseEnter={(e) => s.status && (e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.1)')}
              onMouseLeave={(e) => s.status && (e.currentTarget.style.boxShadow = filter.status === s.status ? '0 0 0 2px ' + s.color : 'none')}
            >
              <div style={{ fontSize: 11, color: '#6B7280' }}>{s.icon} {s.label}</div>
              <div style={{ fontSize: 22, fontWeight: 800, color: s.color, marginTop: 4 }}>{s.value}</div>
            </div>
          ))}
        </div>
      )}

      {/* Low Stock Alert Panel */}
      {!loading && inventory.filter(i => ['OUT_OF_STOCK', 'CRITICAL', 'LOW_STOCK'].includes(i.stockStatus)).length > 0 && (
        <div style={{ background: '#FEF2F2', border: '1px solid #FCA5A5', borderRadius: 12, padding: 16, marginBottom: 24 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#991B1B' }}>
              Reorder Alerts — {inventory.filter(i => ['OUT_OF_STOCK', 'CRITICAL', 'LOW_STOCK'].includes(i.stockStatus)).length} items need attention
            </h3>
            <button
              onClick={() => setFilter({ ...filter, status: 'LOW_STOCK' })}
              style={{ padding: '6px 12px', borderRadius: 6, border: '1px solid #FCA5A5', background: '#fff', color: '#991B1B', fontWeight: 600, fontSize: 12, cursor: 'pointer' }}
            >
              View All Low Stock
            </button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 10 }}>
            {inventory
              .filter(i => ['OUT_OF_STOCK', 'CRITICAL', 'LOW_STOCK'].includes(i.stockStatus))
              .sort((a, b) => (a.calcDaysOfSupply || a.daysOfSupply || 999) - (b.calcDaysOfSupply || b.daysOfSupply || 999))
              .slice(0, 6)
              .map(item => {
                const needQty = Math.max(item.reorderPoint - item.quantityOnHand, 0)
                const daysLeft = Number(item.calcDaysOfSupply || item.daysOfSupply || 0)
                return (
                  <div
                    key={item.id}
                    onClick={() => setExpandedItem(expandedItem === item.id ? null : item.id)}
                    style={{
                      background: '#fff',
                      borderRadius: 8,
                      padding: 12,
                      border: item.stockStatus === 'OUT_OF_STOCK' ? '2px solid #DC2626' : '1px solid #FECACA',
                      cursor: 'pointer',
                      transition: 'all 0.2s',
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.1)'; e.currentTarget.style.transform = 'translateY(-1px)' }}
                    onMouseLeave={(e) => { e.currentTarget.style.boxShadow = 'none'; e.currentTarget.style.transform = 'none' }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: '#111', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.productName}</div>
                        <div style={{ fontSize: 11, color: '#6B7280', fontFamily: 'monospace' }}>{item.sku}</div>
                      </div>
                      <span style={{
                        padding: '2px 6px', borderRadius: 4, fontSize: 10, fontWeight: 700, color: '#fff', marginLeft: 8, whiteSpace: 'nowrap',
                        background: item.stockStatus === 'OUT_OF_STOCK' ? '#DC2626' : item.stockStatus === 'CRITICAL' ? '#EA580C' : '#D97706'
                      }}>
                        {item.stockStatus.replace(/_/g, ' ')}
                      </span>
                    </div>
                    <div style={{ display: 'flex', gap: 12, fontSize: 12 }}>
                      <div><span style={{ color: '#6B7280' }}>On Hand:</span> <span style={{ fontWeight: 700, color: item.quantityOnHand === 0 ? '#DC2626' : '#111' }}>{item.quantityOnHand}</span></div>
                      <div><span style={{ color: '#6B7280' }}>Need:</span> <span style={{ fontWeight: 700, color: '#DC2626' }}>{needQty}</span></div>
                      <div><span style={{ color: '#6B7280' }}>Days Left:</span> <span style={{ fontWeight: 700, color: daysLeft < 7 ? '#DC2626' : '#D97706' }}>{daysLeft >= 999 ? '—' : Math.round(daysLeft)}</span></div>
                    </div>
                    <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                      <a
                        href={`/ops/purchasing/new?product=${item.id}`}
                        onClick={(e) => e.stopPropagation()}
                        style={{ padding: '4px 10px', borderRadius: 4, background: '#3E2A1E', color: '#fff', textDecoration: 'none', fontSize: 11, fontWeight: 600 }}
                      >
                        Create PO
                      </a>
                      <button
                        onClick={(e) => { e.stopPropagation(); setExpandedItem(item.id) }}
                        style={{ padding: '4px 10px', borderRadius: 4, border: '1px solid #D1D5DB', background: '#fff', fontSize: 11, fontWeight: 500, cursor: 'pointer' }}
                      >
                        View Details
                      </button>
                    </div>
                  </div>
                )
              })}
          </div>
        </div>
      )}

      {/* Filters */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap', alignItems: 'center' }}>
        <input placeholder="Search SKU or product..." value={filter.search} onChange={e => setFilter({ ...filter, search: e.target.value })}
          style={{ padding: '8px 14px', borderRadius: 8, border: '1px solid #D1D5DB', fontSize: 14, minWidth: 200 }} />
        <select value={filter.category} onChange={e => setFilter({ ...filter, category: e.target.value })}
          style={{ padding: '8px 14px', borderRadius: 8, border: '1px solid #D1D5DB', fontSize: 14 }}>
          <option value="">All Categories</option>
          {categories.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={filter.status} onChange={e => setFilter({ ...filter, status: e.target.value })}
          style={{ padding: '8px 14px', borderRadius: 8, border: '1px solid #D1D5DB', fontSize: 14 }}>
          <option value="">All Status</option>
          <option value="OUT_OF_STOCK">Out of Stock</option>
          <option value="LOW_STOCK">Low Stock</option>
          <option value="IN_STOCK">In Stock</option>
          <option value="OVERSTOCK">Overstocked</option>
        </select>
        <select value={filter.sort} onChange={e => setFilter({ ...filter, sort: e.target.value })}
          style={{ padding: '8px 14px', borderRadius: 8, border: '1px solid #D1D5DB', fontSize: 14 }}>
          <option value="daysOfSupply">Sort: Days of Supply</option>
          <option value="name">Sort: Name</option>
          <option value="value">Sort: Value</option>
          <option value="usage">Sort: Usage</option>
        </select>
      </div>

      {/* Inventory Table */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: 40, color: '#6B7280' }}>Loading inventory...</div>
      ) : inventory.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 60, background: '#F9FAFB', borderRadius: 12 }}>
          <div style={{ fontSize: 48 }}>📦</div>
          <h3 style={{ color: '#3E2A1E' }}>No inventory items</h3>
          <p style={{ color: '#6B7280' }}>Click "Sync Products" to populate inventory from your product catalog.</p>
        </div>
      ) : (
        <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #E5E7EB', overflow: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 900 }}>
            <thead>
              <tr style={{ background: '#F8FAFC' }}>
                {['Status', 'Product', 'SKU', 'Category', 'On Hand', 'Committed', 'Available', 'On Order', 'Reorder Pt', 'Safety', 'Usage/Day', 'Days Supply', 'Value', 'Actions'].map(h => (
                  <th key={h} style={{ textAlign: ['Product', 'SKU', 'Category', 'Status'].includes(h) ? 'left' : 'right', padding: '10px 8px', color: '#6B7280', fontWeight: 600, fontSize: 12, whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {inventory.map((item, i) => {
                const isExpanded = expandedItem === item.id
                const needsReorder = item.quantityOnHand < item.reorderPoint
                const reorderQty = needsReorder ? item.reorderPoint - item.quantityOnHand : 0
                const stockPercent = Math.min(100, (item.quantityOnHand / item.maxStock) * 100)
                const reorderPercent = Math.min(100, (item.reorderPoint / item.maxStock) * 100)

                return (
                  <React.Fragment key={i}>
                    <tr
                      onClick={(e) => {
                        if ((e.target as HTMLElement).closest('button')) return
                        setExpandedItem(isExpanded ? null : item.id)
                      }}
                      style={{
                        borderBottom: '1px solid #F3F4F6',
                        background: item.stockStatus === 'OUT_OF_STOCK' ? '#FEF2F2' : item.stockStatus === 'CRITICAL' ? '#FFF7ED' : 'transparent',
                        cursor: 'pointer',
                        transition: 'background-color 0.2s'
                      }}
                      onMouseEnter={(e) => !isExpanded && (e.currentTarget.style.backgroundColor = '#F9FAFB')}
                      onMouseLeave={(e) => {
                        if (item.stockStatus === 'OUT_OF_STOCK') e.currentTarget.style.backgroundColor = '#FEF2F2'
                        else if (item.stockStatus === 'CRITICAL') e.currentTarget.style.backgroundColor = '#FFF7ED'
                        else e.currentTarget.style.backgroundColor = 'transparent'
                      }}
                    >
                      <td style={{ padding: '8px' }}>
                        <span style={{ padding: '3px 8px', borderRadius: 4, fontSize: 10, fontWeight: 700, color: '#fff', background: statusColor(item.stockStatus), whiteSpace: 'nowrap' }}>
                          {(item.stockStatus || 'N/A').replace(/_/g, ' ')}
                        </span>
                      </td>
                      <td style={{ padding: '8px', fontWeight: 500, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.productName}</td>
                      <td style={{ padding: '8px', fontFamily: 'monospace', fontSize: 11, color: '#6B7280' }}>{item.sku}</td>
                      <td style={{ padding: '8px', fontSize: 12 }}>{item.category}</td>
                      <td style={{ padding: '8px', textAlign: 'right', fontWeight: 700, color: item.quantityOnHand === 0 ? '#DC2626' : '#111' }}>
                        {editItem === item.id ? (
                          <input type="number" value={editForm.quantityOnHand ?? item.quantityOnHand} onChange={e => setEditForm({ ...editForm, quantityOnHand: Number(e.target.value) })}
                            style={{ width: 60, padding: 2, textAlign: 'right', border: '1px solid #2563EB', borderRadius: 4 }} />
                        ) : item.quantityOnHand}
                      </td>
                      <td style={{ padding: '8px', textAlign: 'right' }}>{item.quantityCommitted}</td>
                      <td style={{ padding: '8px', textAlign: 'right', fontWeight: 600, color: (item.quantityAvailable || 0) < 0 ? '#DC2626' : '#111' }}>{item.quantityAvailable}</td>
                      <td style={{ padding: '8px', textAlign: 'right', color: '#2563EB' }}>{item.quantityOnOrder}</td>
                      <td style={{ padding: '8px', textAlign: 'right' }}>
                        {editItem === item.id ? (
                          <input type="number" value={editForm.reorderPoint ?? item.reorderPoint} onChange={e => setEditForm({ ...editForm, reorderPoint: Number(e.target.value) })}
                            style={{ width: 50, padding: 2, textAlign: 'right', border: '1px solid #2563EB', borderRadius: 4 }} />
                        ) : item.reorderPoint}
                      </td>
                      <td style={{ padding: '8px', textAlign: 'right' }}>{item.safetyStock}</td>
                      <td style={{ padding: '8px', textAlign: 'right' }}>
                        {editItem === item.id ? (
                          <input type="number" step="0.1" value={editForm.avgDailyUsage ?? item.avgDailyUsage} onChange={e => setEditForm({ ...editForm, avgDailyUsage: Number(e.target.value) })}
                            style={{ width: 50, padding: 2, textAlign: 'right', border: '1px solid #2563EB', borderRadius: 4 }} />
                        ) : Number(item.avgDailyUsage || 0).toFixed(1)}
                      </td>
                      <td style={{ padding: '8px', textAlign: 'right', fontWeight: 600, color: Number(item.calcDaysOfSupply || item.daysOfSupply) < 7 ? '#DC2626' : Number(item.calcDaysOfSupply || item.daysOfSupply) < 14 ? '#D97706' : '#16A34A' }}>
                        {Number(item.calcDaysOfSupply || item.daysOfSupply) >= 999 ? '∞' : Math.round(Number(item.calcDaysOfSupply || item.daysOfSupply))}
                      </td>
                      <td style={{ padding: '8px', textAlign: 'right', fontSize: 12, color: '#6B7280' }}>
                        ${Number(item.totalValue || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                      </td>
                      <td style={{ padding: '8px', textAlign: 'right' }}>
                        {editItem === item.id ? (
                          <div style={{ display: 'flex', gap: 4 }}>
                            <button onClick={() => updateItem(item.id)} style={{ padding: '4px 8px', borderRadius: 4, border: 'none', background: '#16A34A', color: '#fff', cursor: 'pointer', fontSize: 11 }}>Save</button>
                            <button onClick={() => setEditItem(null)} style={{ padding: '4px 8px', borderRadius: 4, border: '1px solid #D1D5DB', background: '#fff', cursor: 'pointer', fontSize: 11 }}>×</button>
                          </div>
                        ) : (
                          <button onClick={() => { setEditItem(item.id); setEditForm({}) }}
                            style={{ padding: '4px 8px', borderRadius: 4, border: '1px solid #D1D5DB', background: '#fff', cursor: 'pointer', fontSize: 11, color: '#2563EB' }}>Edit</button>
                        )}
                      </td>
                    </tr>

                    {isExpanded && (
                      <tr style={{ borderBottom: '1px solid #F3F4F6', background: '#FAFBFC' }}>
                        <td colSpan={14} style={{ padding: 0 }}>
                          <div style={{ padding: 20, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
                            <div>
                              <h3 style={{ fontSize: 16, fontWeight: 700, color: '#3E2A1E', margin: '0 0 12px 0' }}>{item.productName}</h3>
                              <div style={{ fontSize: 12, color: '#6B7280', marginBottom: 16 }}>SKU: <span style={{ fontFamily: 'monospace', color: '#111', fontWeight: 600 }}>{item.sku}</span></div>

                              <div style={{ marginBottom: 16 }}>
                                <div style={{ fontSize: 11, fontWeight: 600, color: '#6B7280', marginBottom: 8 }}>Stock Level Visualization</div>
                                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                                  <div style={{ flex: 1, height: 24, background: '#E5E7EB', borderRadius: 4, overflow: 'hidden', position: 'relative' }}>
                                    <div style={{ height: '100%', width: stockPercent + '%', background: item.quantityOnHand < item.reorderPoint ? '#DC2626' : item.quantityOnHand < item.reorderPoint * 1.5 ? '#D97706' : '#16A34A', transition: 'width 0.3s' }} />
                                    <div style={{ position: 'absolute', top: 0, left: reorderPercent + '%', height: '100%', width: '2px', background: '#2563EB', opacity: 0.7 }} />
                                  </div>
                                  <div style={{ fontSize: 12, fontWeight: 600, minWidth: 80 }}>{item.quantityOnHand} / {item.maxStock}</div>
                                </div>
                                <div style={{ fontSize: 10, color: '#6B7280', marginTop: 4 }}>
                                  Reorder Point: {item.reorderPoint} | Safety Stock: {item.safetyStock}
                                </div>
                              </div>

                              {needsReorder && (
                                <div style={{ padding: 12, background: '#FEF2F2', border: '1px solid #FCA5A5', borderRadius: 6, marginBottom: 16 }}>
                                  <div style={{ fontSize: 12, color: '#DC2626', fontWeight: 600 }}>⚠️ Reorder Alert</div>
                                  <div style={{ fontSize: 13, color: '#991B1B', marginTop: 4, fontWeight: 600 }}>Need to order {reorderQty} units to reach reorder point</div>
                                </div>
                              )}

                              <a href={`/ops/purchasing/new?product=${item.id}`}
                                style={{ display: 'inline-block', padding: '10px 16px', background: '#3E2A1E', color: '#fff', borderRadius: 6, textDecoration: 'none', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>
                                + Create PO
                              </a>
                            </div>

                            <div>
                              <div style={{ marginBottom: 16 }}>
                                <div style={{ fontSize: 11, fontWeight: 600, color: '#6B7280', marginBottom: 4 }}>Last Received</div>
                                <div style={{ fontSize: 14, fontWeight: 600, color: '#111' }}>
                                  {item.lastReceivedAt ? new Date(item.lastReceivedAt).toLocaleDateString() : 'No records'}
                                </div>
                              </div>

                              <div style={{ marginBottom: 16 }}>
                                <div style={{ fontSize: 11, fontWeight: 600, color: '#6B7280', marginBottom: 4 }}>Daily Usage Trend</div>
                                <div style={{ fontSize: 13, color: '#111' }}>
                                  <div style={{ marginBottom: 8 }}>
                                    <span style={{ fontWeight: 600 }}>{Number(item.avgDailyUsage || 0).toFixed(1)}</span>
                                    <span style={{ color: '#6B7280', marginLeft: 4 }}>units/day</span>
                                  </div>
                                  <div style={{ fontSize: 12, color: '#6B7280' }}>
                                    Days of Supply: <span style={{ fontWeight: 600, color: Number(item.calcDaysOfSupply || item.daysOfSupply) < 7 ? '#DC2626' : '#16A34A' }}>
                                      {Number(item.calcDaysOfSupply || item.daysOfSupply) >= 999 ? '∞' : Math.round(Number(item.calcDaysOfSupply || item.daysOfSupply))} days
                                    </span>
                                  </div>
                                </div>
                              </div>

                              <div>
                                <div style={{ fontSize: 11, fontWeight: 600, color: '#6B7280', marginBottom: 4 }}>Inventory Value</div>
                                <div style={{ fontSize: 16, fontWeight: 700, color: '#16A34A' }}>
                                  ${Number(item.totalValue || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                                </div>
                              </div>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
