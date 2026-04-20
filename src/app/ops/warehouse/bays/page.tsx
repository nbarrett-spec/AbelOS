'use client'

import { useState, useEffect, useCallback } from 'react'
import { useToast } from '@/contexts/ToastContext'

interface Bay {
  id: string
  bayNumber: string
  zone: string
  aisle: string | null
  position: string | null
  capacity: number
  currentCount: number
  active: boolean
  doorCount: number
  readyCount: number
  stagedCount: number
}

interface ZoneSummary {
  zone: string
  bayCount: number
  totalDoors: number
  totalCapacity: number
}

interface DoorInBay {
  id: string
  serialNumber: string
  status: string
  orderId: string | null
  productName: string | null
  sku: string | null
  category: string | null
}

const STATUS_COLORS: Record<string, string> = {
  PRODUCTION: '#9CA3AF',
  QC_PASSED: '#10B981',
  QC_FAILED: '#EF4444',
  STORED: '#3B82F6',
  STAGED: '#F59E0B',
  DELIVERED: '#8B5CF6',
  INSTALLED: '#3E2A1E',
}

const ZONE_COLORS: Record<string, string> = {
  MAIN: '#3E2A1E',
  STAGING: '#C9822B',
  SHIPPING: '#10B981',
  QC: '#8B5CF6',
  OVERFLOW: '#6B7280',
  RETURNS: '#EF4444',
}

export default function WarehouseBayMapPage() {
  const { addToast } = useToast()
  const [bays, setBays] = useState<Bay[]>([])
  const [zones, setZones] = useState<ZoneSummary[]>([])
  const [selectedBay, setSelectedBay] = useState<Bay | null>(null)
  const [bayDoors, setBayDoors] = useState<DoorInBay[]>([])
  const [loading, setLoading] = useState(true)
  const [zoneFilter, setZoneFilter] = useState<string>('')
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [showBulkModal, setShowBulkModal] = useState(false)
  const [creating, setCreating] = useState(false)

  // Single create form
  const [newBay, setNewBay] = useState({ bayNumber: '', zone: 'MAIN', aisle: '', capacity: '20' })
  // Bulk create form
  const [bulkForm, setBulkForm] = useState({ zone: 'MAIN', prefix: '', startNum: '1', endNum: '10', capacity: '20', aisle: '' })

  const fetchBays = useCallback(async () => {
    try {
      const url = zoneFilter
        ? `/api/ops/warehouse/bays?zone=${zoneFilter}`
        : '/api/ops/warehouse/bays'
      const res = await fetch(url)
      const data = await res.json()
      setBays(data.bays || [])
      if (!zoneFilter) setZones(data.zones || [])
    } catch (err) {
      console.error('Failed to fetch bays:', err)
    } finally {
      setLoading(false)
    }
  }, [zoneFilter])

  useEffect(() => { fetchBays() }, [fetchBays])

  async function openBay(bay: Bay) {
    setSelectedBay(bay)
    try {
      const res = await fetch(`/api/ops/warehouse/bays?bayId=${bay.id}`)
      const data = await res.json()
      setBayDoors(data.doors || [])
    } catch {
      setBayDoors([])
    }
  }

  async function handleCreateBay() {
    setCreating(true)
    try {
      const res = await fetch('/api/ops/warehouse/bays', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bayNumber: newBay.bayNumber,
          zone: newBay.zone,
          aisle: newBay.aisle || undefined,
          capacity: parseInt(newBay.capacity) || 20,
        })
      })
      const data = await res.json()
      if (data.success) {
        setShowCreateModal(false)
        setNewBay({ bayNumber: '', zone: 'MAIN', aisle: '', capacity: '20' })
        fetchBays()
      } else {
        addToast({ type: 'error', title: 'Error', message: data.error || 'Failed to create bay' })
      }
    } catch (e: any) {
      addToast({ type: 'error', title: 'Error', message: e.message })
    } finally {
      setCreating(false)
    }
  }

  async function handleBulkCreate() {
    setCreating(true)
    try {
      const res = await fetch('/api/ops/warehouse/bays', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'bulk_create',
          zone: bulkForm.zone,
          prefix: bulkForm.prefix,
          startNum: parseInt(bulkForm.startNum),
          endNum: parseInt(bulkForm.endNum),
          capacity: parseInt(bulkForm.capacity) || 20,
          aisle: bulkForm.aisle || undefined,
        })
      })
      const data = await res.json()
      if (data.success) {
        setShowBulkModal(false)
        setBulkForm({ zone: 'MAIN', prefix: '', startNum: '1', endNum: '10', capacity: '20', aisle: '' })
        fetchBays()
      } else {
        addToast({ type: 'error', title: 'Error', message: data.error || 'Failed to create bays' })
      }
    } catch (e: any) {
      addToast({ type: 'error', title: 'Error', message: e.message })
    } finally {
      setCreating(false)
    }
  }

  function getUtilPct(bay: Bay) {
    if (!bay.capacity) return 0
    return Math.round((bay.doorCount / bay.capacity) * 100)
  }

  function getUtilColor(pct: number) {
    if (pct >= 90) return '#EF4444'
    if (pct >= 70) return '#F59E0B'
    if (pct >= 40) return '#10B981'
    return '#9CA3AF'
  }

  const totalDoors = bays.reduce((s, b) => s + (b.doorCount || 0), 0)
  const totalCapacity = bays.reduce((s, b) => s + (b.capacity || 0), 0)
  const totalReady = bays.reduce((s, b) => s + (b.readyCount || 0), 0)
  const totalStaged = bays.reduce((s, b) => s + (b.stagedCount || 0), 0)

  if (loading) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: '#6B7280' }}>
        <p style={{ fontSize: 14 }}>Loading warehouse bay map...</p>
      </div>
    )
  }

  return (
    <div style={{ maxWidth: 1400, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: '#3E2A1E', margin: 0 }}>
            🏭 Warehouse Bay Map
          </h1>
          <p style={{ fontSize: 13, color: '#6B7280', marginTop: 4 }}>
            Real-time bay utilization and door locations
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={() => setShowCreateModal(true)}
            style={{ padding: '8px 16px', background: '#3E2A1E', color: 'white', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
          >
            + Add Bay
          </button>
          <button
            onClick={() => setShowBulkModal(true)}
            style={{ padding: '8px 16px', background: '#C9822B', color: 'white', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
          >
            + Bulk Create
          </button>
        </div>
      </div>

      {/* Summary Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 24 }}>
        <div style={{ background: 'white', borderRadius: 10, padding: 16, border: '1px solid #E5E7EB' }}>
          <div style={{ fontSize: 11, color: '#6B7280', fontWeight: 600, textTransform: 'uppercase' }}>Total Bays</div>
          <div style={{ fontSize: 28, fontWeight: 700, color: '#3E2A1E' }}>{bays.length}</div>
        </div>
        <div style={{ background: 'white', borderRadius: 10, padding: 16, border: '1px solid #E5E7EB' }}>
          <div style={{ fontSize: 11, color: '#6B7280', fontWeight: 600, textTransform: 'uppercase' }}>Doors Stored</div>
          <div style={{ fontSize: 28, fontWeight: 700, color: '#3E2A1E' }}>{totalDoors}</div>
          <div style={{ fontSize: 11, color: '#6B7280' }}>of {totalCapacity} capacity</div>
        </div>
        <div style={{ background: 'white', borderRadius: 10, padding: 16, border: '1px solid #E5E7EB' }}>
          <div style={{ fontSize: 11, color: '#6B7280', fontWeight: 600, textTransform: 'uppercase' }}>QC Passed</div>
          <div style={{ fontSize: 28, fontWeight: 700, color: '#10B981' }}>{totalReady}</div>
          <div style={{ fontSize: 11, color: '#6B7280' }}>ready for staging</div>
        </div>
        <div style={{ background: 'white', borderRadius: 10, padding: 16, border: '1px solid #E5E7EB' }}>
          <div style={{ fontSize: 11, color: '#6B7280', fontWeight: 600, textTransform: 'uppercase' }}>Staged</div>
          <div style={{ fontSize: 28, fontWeight: 700, color: '#F59E0B' }}>{totalStaged}</div>
          <div style={{ fontSize: 11, color: '#6B7280' }}>ready for delivery</div>
        </div>
        <div style={{ background: 'white', borderRadius: 10, padding: 16, border: '1px solid #E5E7EB' }}>
          <div style={{ fontSize: 11, color: '#6B7280', fontWeight: 600, textTransform: 'uppercase' }}>Utilization</div>
          <div style={{ fontSize: 28, fontWeight: 700, color: getUtilColor(totalCapacity ? Math.round((totalDoors / totalCapacity) * 100) : 0) }}>
            {totalCapacity ? Math.round((totalDoors / totalCapacity) * 100) : 0}%
          </div>
        </div>
      </div>

      {/* Zone Filter */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
        <button
          onClick={() => setZoneFilter('')}
          style={{
            padding: '6px 14px', borderRadius: 20, fontSize: 12, fontWeight: 600, cursor: 'pointer',
            background: !zoneFilter ? '#3E2A1E' : 'white',
            color: !zoneFilter ? 'white' : '#374151',
            border: '1px solid #E5E7EB'
          }}
        >
          All Zones
        </button>
        {zones.map(z => (
          <button
            key={z.zone}
            onClick={() => setZoneFilter(z.zone)}
            style={{
              padding: '6px 14px', borderRadius: 20, fontSize: 12, fontWeight: 600, cursor: 'pointer',
              background: zoneFilter === z.zone ? (ZONE_COLORS[z.zone] || '#3E2A1E') : 'white',
              color: zoneFilter === z.zone ? 'white' : '#374151',
              border: '1px solid #E5E7EB'
            }}
          >
            {z.zone} ({z.bayCount})
          </button>
        ))}
      </div>

      {/* Bay Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12, marginBottom: 24 }}>
        {bays.map(bay => {
          const util = getUtilPct(bay)
          const zoneColor = ZONE_COLORS[bay.zone] || '#6B7280'
          return (
            <div
              key={bay.id}
              onClick={() => openBay(bay)}
              style={{
                background: 'white', borderRadius: 10, padding: 14,
                border: selectedBay?.id === bay.id ? `2px solid ${zoneColor}` : '1px solid #E5E7EB',
                cursor: 'pointer', transition: 'all 0.15s',
                position: 'relative', overflow: 'hidden'
              }}
            >
              {/* Zone color strip */}
              <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: zoneColor }} />

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <span style={{ fontSize: 15, fontWeight: 700, color: '#1a1a2e' }}>{bay.bayNumber}</span>
                <span style={{
                  fontSize: 10, padding: '2px 8px', borderRadius: 10,
                  background: `${zoneColor}15`, color: zoneColor, fontWeight: 600
                }}>
                  {bay.zone}
                </span>
              </div>

              {/* Utilization bar */}
              <div style={{ background: '#F3F4F6', borderRadius: 4, height: 8, marginBottom: 8, overflow: 'hidden' }}>
                <div style={{
                  width: `${Math.min(util, 100)}%`,
                  height: '100%',
                  background: getUtilColor(util),
                  borderRadius: 4,
                  transition: 'width 0.3s'
                }} />
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#6B7280' }}>
                <span>{bay.doorCount || 0} / {bay.capacity} doors</span>
                <span style={{ fontWeight: 600, color: getUtilColor(util) }}>{util}%</span>
              </div>

              {/* Status breakdown */}
              {(bay.readyCount > 0 || bay.stagedCount > 0) && (
                <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                  {bay.readyCount > 0 && (
                    <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 8, background: '#D1FAE5', color: '#065F46' }}>
                      {bay.readyCount} QC
                    </span>
                  )}
                  {bay.stagedCount > 0 && (
                    <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 8, background: '#FEF3C7', color: '#92400E' }}>
                      {bay.stagedCount} staged
                    </span>
                  )}
                </div>
              )}
            </div>
          )
        })}

        {bays.length === 0 && (
          <div style={{ gridColumn: '1 / -1', textAlign: 'center', padding: 40, color: '#9CA3AF' }}>
            <p style={{ fontSize: 16, marginBottom: 8 }}>No bays created yet</p>
            <p style={{ fontSize: 13 }}>Use &quot;Add Bay&quot; or &quot;Bulk Create&quot; to set up your warehouse</p>
          </div>
        )}
      </div>

      {/* Bay Detail Drawer */}
      {selectedBay && (
        <div style={{
          background: 'white', borderRadius: 12, padding: 24,
          border: '1px solid #E5E7EB', marginBottom: 24,
          boxShadow: '0 4px 12px rgba(0,0,0,0.05)'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <div>
              <h2 style={{ fontSize: 20, fontWeight: 700, color: '#3E2A1E', margin: 0 }}>
                Bay {selectedBay.bayNumber}
              </h2>
              <p style={{ fontSize: 13, color: '#6B7280', marginTop: 2 }}>
                Zone: {selectedBay.zone} {selectedBay.aisle ? `| Aisle: ${selectedBay.aisle}` : ''}
                {' '}| Capacity: {selectedBay.capacity}
              </p>
            </div>
            <button
              onClick={() => { setSelectedBay(null); setBayDoors([]) }}
              style={{ padding: '6px 12px', background: '#F3F4F6', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13 }}
            >
              Close
            </button>
          </div>

          {/* Door list */}
          {bayDoors.length === 0 ? (
            <p style={{ fontSize: 13, color: '#9CA3AF', textAlign: 'center', padding: 20 }}>No doors in this bay</p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid #E5E7EB' }}>
                    <th style={{ textAlign: 'left', padding: '8px 12px', color: '#6B7280', fontWeight: 600, fontSize: 11, textTransform: 'uppercase' }}>Serial</th>
                    <th style={{ textAlign: 'left', padding: '8px 12px', color: '#6B7280', fontWeight: 600, fontSize: 11, textTransform: 'uppercase' }}>Product</th>
                    <th style={{ textAlign: 'left', padding: '8px 12px', color: '#6B7280', fontWeight: 600, fontSize: 11, textTransform: 'uppercase' }}>SKU</th>
                    <th style={{ textAlign: 'left', padding: '8px 12px', color: '#6B7280', fontWeight: 600, fontSize: 11, textTransform: 'uppercase' }}>Status</th>
                    <th style={{ textAlign: 'left', padding: '8px 12px', color: '#6B7280', fontWeight: 600, fontSize: 11, textTransform: 'uppercase' }}>Order</th>
                  </tr>
                </thead>
                <tbody>
                  {bayDoors.map(door => (
                    <tr key={door.id} style={{ borderBottom: '1px solid #F3F4F6' }}>
                      <td style={{ padding: '8px 12px' }}>
                        <a href={`/door/${door.serialNumber}`} style={{ color: '#3E2A1E', fontWeight: 600, textDecoration: 'none' }}>
                          {door.serialNumber}
                        </a>
                      </td>
                      <td style={{ padding: '8px 12px', color: '#374151' }}>{door.productName || '—'}</td>
                      <td style={{ padding: '8px 12px', color: '#6B7280', fontFamily: 'monospace', fontSize: 12 }}>{door.sku || '—'}</td>
                      <td style={{ padding: '8px 12px' }}>
                        <span style={{
                          display: 'inline-block', padding: '2px 10px', borderRadius: 10, fontSize: 11, fontWeight: 600,
                          background: `${STATUS_COLORS[door.status] || '#9CA3AF'}20`,
                          color: STATUS_COLORS[door.status] || '#9CA3AF'
                        }}>
                          {door.status}
                        </span>
                      </td>
                      <td style={{ padding: '8px 12px', color: '#6B7280', fontSize: 12 }}>{door.orderId || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Zone Summary Table */}
      {zones.length > 0 && !zoneFilter && (
        <div style={{ background: 'white', borderRadius: 12, padding: 20, border: '1px solid #E5E7EB' }}>
          <h3 style={{ fontSize: 16, fontWeight: 700, color: '#1a1a2e', marginBottom: 12 }}>Zone Summary</h3>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #E5E7EB' }}>
                <th style={{ textAlign: 'left', padding: '8px 12px', color: '#6B7280', fontWeight: 600, fontSize: 11, textTransform: 'uppercase' }}>Zone</th>
                <th style={{ textAlign: 'right', padding: '8px 12px', color: '#6B7280', fontWeight: 600, fontSize: 11, textTransform: 'uppercase' }}>Bays</th>
                <th style={{ textAlign: 'right', padding: '8px 12px', color: '#6B7280', fontWeight: 600, fontSize: 11, textTransform: 'uppercase' }}>Doors</th>
                <th style={{ textAlign: 'right', padding: '8px 12px', color: '#6B7280', fontWeight: 600, fontSize: 11, textTransform: 'uppercase' }}>Capacity</th>
                <th style={{ textAlign: 'right', padding: '8px 12px', color: '#6B7280', fontWeight: 600, fontSize: 11, textTransform: 'uppercase' }}>Utilization</th>
              </tr>
            </thead>
            <tbody>
              {zones.map(z => {
                const util = z.totalCapacity ? Math.round(((z.totalDoors || 0) / z.totalCapacity) * 100) : 0
                return (
                  <tr key={z.zone} style={{ borderBottom: '1px solid #F3F4F6' }}>
                    <td style={{ padding: '8px 12px' }}>
                      <span style={{
                        display: 'inline-flex', alignItems: 'center', gap: 6
                      }}>
                        <span style={{
                          width: 10, height: 10, borderRadius: '50%',
                          background: ZONE_COLORS[z.zone] || '#6B7280', display: 'inline-block'
                        }} />
                        <span style={{ fontWeight: 600, color: '#374151' }}>{z.zone}</span>
                      </span>
                    </td>
                    <td style={{ padding: '8px 12px', textAlign: 'right', color: '#374151' }}>{z.bayCount}</td>
                    <td style={{ padding: '8px 12px', textAlign: 'right', color: '#374151' }}>{z.totalDoors || 0}</td>
                    <td style={{ padding: '8px 12px', textAlign: 'right', color: '#374151' }}>{z.totalCapacity || 0}</td>
                    <td style={{ padding: '8px 12px', textAlign: 'right' }}>
                      <span style={{ fontWeight: 600, color: getUtilColor(util) }}>{util}%</span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Create Bay Modal */}
      {showCreateModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: 'white', borderRadius: 12, padding: 24, width: 400, maxWidth: '90vw' }}>
            <h3 style={{ fontSize: 18, fontWeight: 700, color: '#3E2A1E', marginBottom: 16 }}>Add Warehouse Bay</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 4 }}>Bay Number *</label>
                <input
                  value={newBay.bayNumber}
                  onChange={e => setNewBay({ ...newBay, bayNumber: e.target.value })}
                  placeholder="e.g. A-001"
                  style={{ width: '100%', padding: '8px 12px', border: '1px solid #D1D5DB', borderRadius: 6, fontSize: 13 }}
                />
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 4 }}>Zone</label>
                <select
                  value={newBay.zone}
                  onChange={e => setNewBay({ ...newBay, zone: e.target.value })}
                  style={{ width: '100%', padding: '8px 12px', border: '1px solid #D1D5DB', borderRadius: 6, fontSize: 13 }}
                >
                  <option value="MAIN">MAIN</option>
                  <option value="STAGING">STAGING</option>
                  <option value="SHIPPING">SHIPPING</option>
                  <option value="QC">QC</option>
                  <option value="OVERFLOW">OVERFLOW</option>
                  <option value="RETURNS">RETURNS</option>
                </select>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 4 }}>Aisle</label>
                  <input
                    value={newBay.aisle}
                    onChange={e => setNewBay({ ...newBay, aisle: e.target.value })}
                    placeholder="e.g. A"
                    style={{ width: '100%', padding: '8px 12px', border: '1px solid #D1D5DB', borderRadius: 6, fontSize: 13 }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 4 }}>Capacity</label>
                  <input
                    value={newBay.capacity}
                    onChange={e => setNewBay({ ...newBay, capacity: e.target.value })}
                    type="number"
                    style={{ width: '100%', padding: '8px 12px', border: '1px solid #D1D5DB', borderRadius: 6, fontSize: 13 }}
                  />
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}>
              <button onClick={() => setShowCreateModal(false)} style={{ padding: '8px 16px', background: '#F3F4F6', border: 'none', borderRadius: 6, fontSize: 13, cursor: 'pointer' }}>Cancel</button>
              <button onClick={handleCreateBay} disabled={creating || !newBay.bayNumber} style={{ padding: '8px 16px', background: '#3E2A1E', color: 'white', border: 'none', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer', opacity: creating || !newBay.bayNumber ? 0.6 : 1 }}>
                {creating ? 'Creating...' : 'Create Bay'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk Create Modal */}
      {showBulkModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: 'white', borderRadius: 12, padding: 24, width: 440, maxWidth: '90vw' }}>
            <h3 style={{ fontSize: 18, fontWeight: 700, color: '#3E2A1E', marginBottom: 4 }}>Bulk Create Bays</h3>
            <p style={{ fontSize: 12, color: '#6B7280', marginBottom: 16 }}>Creates numbered bays from prefix + start to end number</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 4 }}>Zone</label>
                  <select
                    value={bulkForm.zone}
                    onChange={e => setBulkForm({ ...bulkForm, zone: e.target.value })}
                    style={{ width: '100%', padding: '8px 12px', border: '1px solid #D1D5DB', borderRadius: 6, fontSize: 13 }}
                  >
                    <option value="MAIN">MAIN</option>
                    <option value="STAGING">STAGING</option>
                    <option value="SHIPPING">SHIPPING</option>
                    <option value="QC">QC</option>
                    <option value="OVERFLOW">OVERFLOW</option>
                    <option value="RETURNS">RETURNS</option>
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 4 }}>Aisle</label>
                  <input
                    value={bulkForm.aisle}
                    onChange={e => setBulkForm({ ...bulkForm, aisle: e.target.value })}
                    placeholder="e.g. A"
                    style={{ width: '100%', padding: '8px 12px', border: '1px solid #D1D5DB', borderRadius: 6, fontSize: 13 }}
                  />
                </div>
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 4 }}>Prefix *</label>
                <input
                  value={bulkForm.prefix}
                  onChange={e => setBulkForm({ ...bulkForm, prefix: e.target.value })}
                  placeholder="e.g. A- (creates A-001, A-002...)"
                  style={{ width: '100%', padding: '8px 12px', border: '1px solid #D1D5DB', borderRadius: 6, fontSize: 13 }}
                />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 4 }}>Start #</label>
                  <input
                    value={bulkForm.startNum}
                    onChange={e => setBulkForm({ ...bulkForm, startNum: e.target.value })}
                    type="number"
                    style={{ width: '100%', padding: '8px 12px', border: '1px solid #D1D5DB', borderRadius: 6, fontSize: 13 }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 4 }}>End #</label>
                  <input
                    value={bulkForm.endNum}
                    onChange={e => setBulkForm({ ...bulkForm, endNum: e.target.value })}
                    type="number"
                    style={{ width: '100%', padding: '8px 12px', border: '1px solid #D1D5DB', borderRadius: 6, fontSize: 13 }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 4 }}>Capacity</label>
                  <input
                    value={bulkForm.capacity}
                    onChange={e => setBulkForm({ ...bulkForm, capacity: e.target.value })}
                    type="number"
                    style={{ width: '100%', padding: '8px 12px', border: '1px solid #D1D5DB', borderRadius: 6, fontSize: 13 }}
                  />
                </div>
              </div>
              {bulkForm.prefix && (
                <p style={{ fontSize: 12, color: '#6B7280', background: '#F9FAFB', padding: '8px 12px', borderRadius: 6 }}>
                  Preview: {bulkForm.prefix}{String(parseInt(bulkForm.startNum) || 1).padStart(3, '0')} → {bulkForm.prefix}{String(parseInt(bulkForm.endNum) || 10).padStart(3, '0')}
                  {' '}({(parseInt(bulkForm.endNum) || 10) - (parseInt(bulkForm.startNum) || 1) + 1} bays)
                </p>
              )}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}>
              <button onClick={() => setShowBulkModal(false)} style={{ padding: '8px 16px', background: '#F3F4F6', border: 'none', borderRadius: 6, fontSize: 13, cursor: 'pointer' }}>Cancel</button>
              <button onClick={handleBulkCreate} disabled={creating || !bulkForm.prefix} style={{ padding: '8px 16px', background: '#C9822B', color: 'white', border: 'none', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer', opacity: creating || !bulkForm.prefix ? 0.6 : 1 }}>
                {creating ? 'Creating...' : 'Create Bays'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
