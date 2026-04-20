'use client'

import { useState, useEffect, useCallback } from 'react'
import { useToast } from '@/contexts/ToastContext'

interface Door {
  id: string
  serialNumber: string
  nfcTagId: string | null
  nfcUrl: string | null
  status: string
  orderId: string | null
  jobId: string | null
  bayId: string | null
  bayNumber: string | null
  manufacturedAt: string | null
  qcPassedAt: string | null
  stagedAt: string | null
  deliveredAt: string | null
  installedAt: string | null
  homeownerName: string | null
  installAddress: string | null
  productName: string | null
  sku: string | null
  category: string | null
}

interface Summary {
  total: number
  inProduction: number
  qcPassed: number
  stored: number
  staged: number
  delivered: number
  installed: number
}

const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  PRODUCTION: { bg: '#F3F4F6', text: '#6B7280' },
  QC_PASSED: { bg: '#D1FAE5', text: '#065F46' },
  QC_FAILED: { bg: '#FEE2E2', text: '#991B1B' },
  STORED: { bg: '#DBEAFE', text: '#1E40AF' },
  STAGED: { bg: '#FEF3C7', text: '#92400E' },
  DELIVERED: { bg: '#EDE9FE', text: '#5B21B6' },
  INSTALLED: { bg: '#E0F2FE', text: '#0C4A6E' },
}

const STATUS_LABELS = ['PRODUCTION', 'QC_PASSED', 'STORED', 'STAGED', 'DELIVERED', 'INSTALLED']

export default function DoorRegistryPage() {
  const { addToast } = useToast()
  const [doors, setDoors] = useState<Door[]>([])
  const [summary, setSummary] = useState<Summary | null>(null)
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState('')
  const [search, setSearch] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [showOrderModal, setShowOrderModal] = useState(false)
  const [creating, setCreating] = useState(false)

  // Single create
  const [singleForm, setSingleForm] = useState({ productId: '', orderId: '', jobId: '', nfcTagId: '' })
  // Order create
  const [orderForm, setOrderForm] = useState({ orderId: '', jobId: '', manufacturedBy: '' })

  const fetchDoors = useCallback(async () => {
    try {
      const params = new URLSearchParams()
      if (statusFilter) params.set('status', statusFilter)
      if (search) params.set('search', search)
      const res = await fetch(`/api/ops/manufacturing/tag-program?${params}`)
      const data = await res.json()
      setDoors(data.doors || [])
      setSummary(data.summary || null)
    } catch (err) {
      console.error('Failed to fetch doors:', err)
    } finally {
      setLoading(false)
    }
  }, [statusFilter, search])

  useEffect(() => { fetchDoors() }, [fetchDoors])

  function handleSearch(e: React.FormEvent) {
    e.preventDefault()
    setSearch(searchInput)
  }

  async function handleCreateSingle() {
    setCreating(true)
    try {
      const res = await fetch('/api/ops/manufacturing/tag-program', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create_single',
          productId: singleForm.productId,
          orderId: singleForm.orderId || undefined,
          jobId: singleForm.jobId || undefined,
          nfcTagId: singleForm.nfcTagId || undefined,
        })
      })
      const data = await res.json()
      if (data.success) {
        setShowCreateModal(false)
        setSingleForm({ productId: '', orderId: '', jobId: '', nfcTagId: '' })
        fetchDoors()
        addToast({ type: 'success', title: 'Success', message: `Door created: ${data.serialNumber}` })
      } else {
        addToast({ type: 'error', title: 'Error', message: data.error || 'Failed to create door' })
      }
    } catch (e: any) {
      addToast({ type: 'error', title: 'Error', message: e.message })
    } finally {
      setCreating(false)
    }
  }

  async function handleCreateFromOrder() {
    setCreating(true)
    try {
      const res = await fetch('/api/ops/manufacturing/tag-program', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create_from_order',
          orderId: orderForm.orderId,
          jobId: orderForm.jobId || undefined,
          manufacturedBy: orderForm.manufacturedBy || undefined,
        })
      })
      const data = await res.json()
      if (data.success) {
        setShowOrderModal(false)
        setOrderForm({ orderId: '', jobId: '', manufacturedBy: '' })
        fetchDoors()
        addToast({ type: 'success', title: 'Success', message: `${data.created} doors created from order` })
      } else {
        addToast({ type: 'error', title: 'Error', message: data.error || 'Failed to create doors from order' })
      }
    } catch (e: any) {
      addToast({ type: 'error', title: 'Error', message: e.message })
    } finally {
      setCreating(false)
    }
  }

  function formatDate(d: string | null) {
    if (!d) return '—'
    return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  }

  if (loading) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: '#6B7280' }}>
        <p style={{ fontSize: 14 }}>Loading door registry...</p>
      </div>
    )
  }

  return (
    <div style={{ maxWidth: 1400, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: '#3E2A1E', margin: 0 }}>
            📱 Door Identity Registry
          </h1>
          <p style={{ fontSize: 13, color: '#6B7280', marginTop: 4 }}>
            NFC-tagged door lifecycle tracking — production through installation
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={() => setShowCreateModal(true)}
            style={{ padding: '8px 16px', background: '#3E2A1E', color: 'white', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
          >
            + Tag Single Door
          </button>
          <button
            onClick={() => setShowOrderModal(true)}
            style={{ padding: '8px 16px', background: '#C9822B', color: 'white', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
          >
            + Tag From Order
          </button>
        </div>
      </div>

      {/* Summary Cards */}
      {summary && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 10, marginBottom: 24 }}>
          <SummaryCard label="Total Doors" value={summary.total} color="#3E2A1E" />
          <SummaryCard label="In Production" value={summary.inProduction} color="#6B7280" />
          <SummaryCard label="QC Passed" value={summary.qcPassed} color="#10B981" />
          <SummaryCard label="Stored" value={summary.stored} color="#3B82F6" />
          <SummaryCard label="Staged" value={summary.staged} color="#F59E0B" />
          <SummaryCard label="Delivered" value={summary.delivered} color="#8B5CF6" />
          <SummaryCard label="Installed" value={summary.installed} color="#3E2A1E" />
        </div>
      )}

      {/* Filters */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap', alignItems: 'center' }}>
        <form onSubmit={handleSearch} style={{ display: 'flex', gap: 8 }}>
          <input
            value={searchInput}
            onChange={e => setSearchInput(e.target.value)}
            placeholder="Search serial, NFC tag, homeowner..."
            style={{ width: 280, padding: '8px 12px', border: '1px solid #D1D5DB', borderRadius: 8, fontSize: 13 }}
          />
          <button type="submit" style={{ padding: '8px 14px', background: '#F3F4F6', border: '1px solid #D1D5DB', borderRadius: 8, fontSize: 13, cursor: 'pointer' }}>
            Search
          </button>
        </form>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button
            onClick={() => setStatusFilter('')}
            style={{
              padding: '5px 12px', borderRadius: 16, fontSize: 11, fontWeight: 600, cursor: 'pointer',
              background: !statusFilter ? '#3E2A1E' : 'white',
              color: !statusFilter ? 'white' : '#374151',
              border: '1px solid #E5E7EB'
            }}
          >All</button>
          {STATUS_LABELS.map(s => (
            <button
              key={s}
              onClick={() => setStatusFilter(statusFilter === s ? '' : s)}
              style={{
                padding: '5px 12px', borderRadius: 16, fontSize: 11, fontWeight: 600, cursor: 'pointer',
                background: statusFilter === s ? (STATUS_COLORS[s]?.text || '#3E2A1E') : 'white',
                color: statusFilter === s ? 'white' : '#374151',
                border: '1px solid #E5E7EB'
              }}
            >{s.replace('_', ' ')}</button>
          ))}
        </div>
      </div>

      {/* Door Table */}
      <div style={{ background: 'white', borderRadius: 12, border: '1px solid #E5E7EB', overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #E5E7EB', background: '#F9FAFB' }}>
                <th style={{ textAlign: 'left', padding: '10px 12px', color: '#6B7280', fontWeight: 600, fontSize: 11, textTransform: 'uppercase' }}>Serial #</th>
                <th style={{ textAlign: 'left', padding: '10px 12px', color: '#6B7280', fontWeight: 600, fontSize: 11, textTransform: 'uppercase' }}>Product</th>
                <th style={{ textAlign: 'left', padding: '10px 12px', color: '#6B7280', fontWeight: 600, fontSize: 11, textTransform: 'uppercase' }}>Status</th>
                <th style={{ textAlign: 'left', padding: '10px 12px', color: '#6B7280', fontWeight: 600, fontSize: 11, textTransform: 'uppercase' }}>Bay</th>
                <th style={{ textAlign: 'left', padding: '10px 12px', color: '#6B7280', fontWeight: 600, fontSize: 11, textTransform: 'uppercase' }}>Order / Job</th>
                <th style={{ textAlign: 'left', padding: '10px 12px', color: '#6B7280', fontWeight: 600, fontSize: 11, textTransform: 'uppercase' }}>NFC Tag</th>
                <th style={{ textAlign: 'left', padding: '10px 12px', color: '#6B7280', fontWeight: 600, fontSize: 11, textTransform: 'uppercase' }}>Last Activity</th>
              </tr>
            </thead>
            <tbody>
              {doors.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ padding: 40, textAlign: 'center', color: '#9CA3AF' }}>
                    {search || statusFilter ? 'No doors match your filter' : 'No doors registered yet. Use "Tag From Order" to get started.'}
                  </td>
                </tr>
              ) : doors.map(door => {
                const colors = STATUS_COLORS[door.status] || STATUS_COLORS.PRODUCTION
                const lastDate = door.installedAt || door.deliveredAt || door.stagedAt || door.qcPassedAt || door.manufacturedAt
                return (
                  <tr key={door.id} style={{ borderBottom: '1px solid #F3F4F6' }}>
                    <td style={{ padding: '10px 12px' }}>
                      <a href={`/door/${door.serialNumber}`} style={{ color: '#3E2A1E', fontWeight: 600, textDecoration: 'none', fontFamily: 'monospace', fontSize: 12 }}>
                        {door.serialNumber}
                      </a>
                    </td>
                    <td style={{ padding: '10px 12px' }}>
                      <div style={{ color: '#374151', fontSize: 13 }}>{door.productName || '—'}</div>
                      {door.sku && <div style={{ color: '#9CA3AF', fontSize: 11, fontFamily: 'monospace' }}>{door.sku}</div>}
                    </td>
                    <td style={{ padding: '10px 12px' }}>
                      <span style={{
                        display: 'inline-block', padding: '3px 10px', borderRadius: 12,
                        fontSize: 11, fontWeight: 600,
                        background: colors.bg, color: colors.text
                      }}>
                        {door.status.replace('_', ' ')}
                      </span>
                    </td>
                    <td style={{ padding: '10px 12px', color: '#374151', fontSize: 12 }}>
                      {door.bayNumber || '—'}
                    </td>
                    <td style={{ padding: '10px 12px', fontSize: 12 }}>
                      <div style={{ color: '#374151' }}>{door.orderId || '—'}</div>
                      {door.jobId && <div style={{ color: '#9CA3AF', fontSize: 11 }}>Job: {door.jobId}</div>}
                    </td>
                    <td style={{ padding: '10px 12px', fontFamily: 'monospace', fontSize: 11, color: door.nfcTagId ? '#374151' : '#D1D5DB' }}>
                      {door.nfcTagId || 'not linked'}
                    </td>
                    <td style={{ padding: '10px 12px', color: '#6B7280', fontSize: 12 }}>
                      {formatDate(lastDate)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Create Single Door Modal */}
      {showCreateModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: 'white', borderRadius: 12, padding: 24, width: 420, maxWidth: '90vw' }}>
            <h3 style={{ fontSize: 18, fontWeight: 700, color: '#3E2A1E', marginBottom: 16 }}>Tag Single Door</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 4 }}>Product ID *</label>
                <input
                  value={singleForm.productId}
                  onChange={e => setSingleForm({ ...singleForm, productId: e.target.value })}
                  placeholder="Product ID"
                  style={{ width: '100%', padding: '8px 12px', border: '1px solid #D1D5DB', borderRadius: 6, fontSize: 13 }}
                />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 4 }}>Order ID</label>
                  <input
                    value={singleForm.orderId}
                    onChange={e => setSingleForm({ ...singleForm, orderId: e.target.value })}
                    style={{ width: '100%', padding: '8px 12px', border: '1px solid #D1D5DB', borderRadius: 6, fontSize: 13 }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 4 }}>Job ID</label>
                  <input
                    value={singleForm.jobId}
                    onChange={e => setSingleForm({ ...singleForm, jobId: e.target.value })}
                    style={{ width: '100%', padding: '8px 12px', border: '1px solid #D1D5DB', borderRadius: 6, fontSize: 13 }}
                  />
                </div>
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 4 }}>NFC Tag ID (optional)</label>
                <input
                  value={singleForm.nfcTagId}
                  onChange={e => setSingleForm({ ...singleForm, nfcTagId: e.target.value })}
                  placeholder="Scan or type NFC tag UID"
                  style={{ width: '100%', padding: '8px 12px', border: '1px solid #D1D5DB', borderRadius: 6, fontSize: 13 }}
                />
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}>
              <button onClick={() => setShowCreateModal(false)} style={{ padding: '8px 16px', background: '#F3F4F6', border: 'none', borderRadius: 6, fontSize: 13, cursor: 'pointer' }}>Cancel</button>
              <button onClick={handleCreateSingle} disabled={creating || !singleForm.productId} style={{ padding: '8px 16px', background: '#3E2A1E', color: 'white', border: 'none', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer', opacity: creating || !singleForm.productId ? 0.6 : 1 }}>
                {creating ? 'Creating...' : 'Create & Tag'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create From Order Modal */}
      {showOrderModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: 'white', borderRadius: 12, padding: 24, width: 420, maxWidth: '90vw' }}>
            <h3 style={{ fontSize: 18, fontWeight: 700, color: '#C9822B', marginBottom: 4 }}>Tag Doors From Order</h3>
            <p style={{ fontSize: 12, color: '#6B7280', marginBottom: 16 }}>
              Creates one door identity per unit for every item in the order
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 4 }}>Order ID *</label>
                <input
                  value={orderForm.orderId}
                  onChange={e => setOrderForm({ ...orderForm, orderId: e.target.value })}
                  placeholder="SO-XXXXX"
                  style={{ width: '100%', padding: '8px 12px', border: '1px solid #D1D5DB', borderRadius: 6, fontSize: 13 }}
                />
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 4 }}>Job ID</label>
                <input
                  value={orderForm.jobId}
                  onChange={e => setOrderForm({ ...orderForm, jobId: e.target.value })}
                  placeholder="Link to job (optional)"
                  style={{ width: '100%', padding: '8px 12px', border: '1px solid #D1D5DB', borderRadius: 6, fontSize: 13 }}
                />
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 4 }}>Manufactured By</label>
                <input
                  value={orderForm.manufacturedBy}
                  onChange={e => setOrderForm({ ...orderForm, manufacturedBy: e.target.value })}
                  placeholder="Staff name or ID"
                  style={{ width: '100%', padding: '8px 12px', border: '1px solid #D1D5DB', borderRadius: 6, fontSize: 13 }}
                />
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}>
              <button onClick={() => setShowOrderModal(false)} style={{ padding: '8px 16px', background: '#F3F4F6', border: 'none', borderRadius: 6, fontSize: 13, cursor: 'pointer' }}>Cancel</button>
              <button onClick={handleCreateFromOrder} disabled={creating || !orderForm.orderId} style={{ padding: '8px 16px', background: '#C9822B', color: 'white', border: 'none', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer', opacity: creating || !orderForm.orderId ? 0.6 : 1 }}>
                {creating ? 'Creating...' : 'Create Door Tags'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function SummaryCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{ background: 'white', borderRadius: 10, padding: 14, border: '1px solid #E5E7EB' }}>
      <div style={{ fontSize: 10, color: '#6B7280', fontWeight: 600, textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 700, color }}>{value}</div>
    </div>
  )
}
