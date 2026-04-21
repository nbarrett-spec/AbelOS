'use client'

import { useEffect, useState } from 'react'

interface SubcontractorPricing {
  id: string
  crewId: string
  builderId: string | null
  pricePerSqFt: number
  pricingType: string
  pricePerDoor: number
  pricePerHardwareSet: number
  pricePerTrimPiece: number
  pricePerWindow: number
  flatRatePerUnit: number | null
  effectiveDate: string
  expiresAt: string | null
  notes: string | null
  active: boolean
  createdAt: string
  updatedAt: string
  crewName: string
  crewType: string
  isSubcontractor: boolean
  subcontractorCompany: string | null
  builderName: string | null
}

interface Crew {
  id: string
  name: string
  crewType: string
  active: boolean
}

interface Builder {
  id: string
  companyName: string
}

export default function SubcontractorPricingPage() {
  const [pricings, setPricings] = useState<SubcontractorPricing[]>([])
  const [crews, setCrews] = useState<Crew[]>([])
  const [builders, setBuilders] = useState<Builder[]>([])
  const [loading, setLoading] = useState(true)
  const [toast, setToast] = useState('')
  const [toastType, setToastType] = useState<'success' | 'error'>('success')
  const [showAddForm, setShowAddForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [typeFilter, setTypeFilter] = useState('ALL')
  const [builderFilter, setBuilderFilter] = useState('ALL')
  const [search, setSearch] = useState('')

  // Form state
  const [formData, setFormData] = useState({
    crewId: '',
    builderId: '',
    pricePerSqFt: '0',
    pricingType: 'PER_SQFT',
    pricePerDoor: '0',
    pricePerHardwareSet: '0',
    pricePerTrimPiece: '0',
    pricePerWindow: '0',
    flatRatePerUnit: '',
    effectiveDate: new Date().toISOString().split('T')[0],
    expiresAt: '',
    notes: '',
  })

  const showToast = (msg: string, type: 'success' | 'error' = 'success') => {
    setToast(msg)
    setToastType(type)
    setTimeout(() => setToast(''), 3500)
  }

  useEffect(() => {
    fetchData()
  }, [])

  const fetchData = async () => {
    try {
      setLoading(true)
      const [pricingRes, crewRes, builderRes] = await Promise.all([
        fetch('/api/ops/crews/subcontractor-pricing'),
        fetch('/api/ops/crews'),
        fetch('/api/ops/builders'),
      ])

      const pricingData = await pricingRes.json()
      const crewData = await crewRes.json()
      const builderData = await builderRes.json()

      setPricings(Array.isArray(pricingData) ? pricingData : pricingData.pricings || [])
      setCrews(Array.isArray(crewData) ? crewData : crewData.crews || [])
      setBuilders(Array.isArray(builderData) ? builderData : builderData.builders || [])
    } catch (err) {
      console.error('Failed to load data:', err)
      showToast('Failed to load pricing data', 'error')
    } finally {
      setLoading(false)
    }
  }

  const handleAddPricing = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!formData.crewId) {
      showToast('Please select a crew', 'error')
      return
    }

    try {
      const res = await fetch('/api/ops/crews/subcontractor-pricing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          crewId: formData.crewId,
          builderId: formData.builderId || null,
          pricePerSqFt: parseFloat(formData.pricePerSqFt),
          pricingType: formData.pricingType,
          pricePerDoor: parseFloat(formData.pricePerDoor),
          pricePerHardwareSet: parseFloat(formData.pricePerHardwareSet),
          pricePerTrimPiece: parseFloat(formData.pricePerTrimPiece),
          pricePerWindow: parseFloat(formData.pricePerWindow),
          flatRatePerUnit: formData.flatRatePerUnit ? parseFloat(formData.flatRatePerUnit) : null,
          effectiveDate: formData.effectiveDate,
          expiresAt: formData.expiresAt || null,
          notes: formData.notes || null,
        }),
      })

      if (res.ok) {
        showToast('Pricing agreement created')
        resetForm()
        fetchData()
      } else {
        const err = await res.json()
        showToast(err.error || 'Failed to create pricing', 'error')
      }
    } catch (err) {
      showToast('Failed to create pricing agreement', 'error')
    }
  }

  const handleUpdatePricing = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editingId) return

    try {
      const res = await fetch('/api/ops/crews/subcontractor-pricing', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: editingId,
          builderId: formData.builderId || null,
          pricePerSqFt: parseFloat(formData.pricePerSqFt),
          pricingType: formData.pricingType,
          pricePerDoor: parseFloat(formData.pricePerDoor),
          pricePerHardwareSet: parseFloat(formData.pricePerHardwareSet),
          pricePerTrimPiece: parseFloat(formData.pricePerTrimPiece),
          pricePerWindow: parseFloat(formData.pricePerWindow),
          flatRatePerUnit: formData.flatRatePerUnit ? parseFloat(formData.flatRatePerUnit) : null,
          effectiveDate: formData.effectiveDate,
          expiresAt: formData.expiresAt || null,
          notes: formData.notes || null,
        }),
      })

      if (res.ok) {
        showToast('Pricing agreement updated')
        setEditingId(null)
        resetForm()
        fetchData()
      } else {
        const err = await res.json()
        showToast(err.error || 'Failed to update pricing', 'error')
      }
    } catch (err) {
      showToast('Failed to update pricing agreement', 'error')
    }
  }

  const handleDeletePricing = async (id: string) => {
    if (!confirm('Are you sure you want to delete this pricing agreement?')) return

    try {
      const res = await fetch(`/api/ops/crews/subcontractor-pricing?id=${id}`, {
        method: 'DELETE',
      })

      if (res.ok) {
        showToast('Pricing agreement deleted')
        fetchData()
      } else {
        showToast('Failed to delete pricing agreement', 'error')
      }
    } catch (err) {
      showToast('Failed to delete pricing agreement', 'error')
    }
  }

  const handleEditPricing = (pricing: SubcontractorPricing) => {
    setFormData({
      crewId: pricing.crewId,
      builderId: pricing.builderId || '',
      pricePerSqFt: (pricing as any).pricePerSqFt?.toString() || '0',
      pricingType: (pricing as any).pricingType || 'PER_SQFT',
      pricePerDoor: pricing.pricePerDoor.toString(),
      pricePerHardwareSet: pricing.pricePerHardwareSet.toString(),
      pricePerTrimPiece: pricing.pricePerTrimPiece.toString(),
      pricePerWindow: pricing.pricePerWindow.toString(),
      flatRatePerUnit: pricing.flatRatePerUnit ? pricing.flatRatePerUnit.toString() : '',
      effectiveDate: new Date(pricing.effectiveDate).toISOString().split('T')[0],
      expiresAt: pricing.expiresAt ? new Date(pricing.expiresAt).toISOString().split('T')[0] : '',
      notes: pricing.notes || '',
    })
    setEditingId(pricing.id)
    setShowAddForm(true)
  }

  const resetForm = () => {
    setFormData({
      crewId: '',
      builderId: '',
      pricePerSqFt: '0',
      pricingType: 'PER_SQFT',
      pricePerDoor: '0',
      pricePerHardwareSet: '0',
      pricePerTrimPiece: '0',
      pricePerWindow: '0',
      flatRatePerUnit: '',
      effectiveDate: new Date().toISOString().split('T')[0],
      expiresAt: '',
      notes: '',
    })
    setEditingId(null)
  }

  const filtered = pricings.filter((p) => {
    if (typeFilter !== 'ALL' && p.crewType !== typeFilter) return false
    if (builderFilter !== 'ALL' && p.builderId !== builderFilter) return false
    if (search) {
      const s = search.toLowerCase()
      return (
        p.crewName.toLowerCase().includes(s) ||
        (p.builderName && p.builderName.toLowerCase().includes(s)) ||
        (p.notes && p.notes.toLowerCase().includes(s))
      )
    }
    return true
  })

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '16rem' }}>
        <div style={{
          animation: 'spin 1s linear infinite',
          width: '2rem',
          height: '2rem',
          borderRadius: '50%',
          borderWidth: '2px',
          borderStyle: 'solid',
          borderColor: 'rgba(230, 126, 34, 0.2)',
          borderTopColor: '#C6A24E'
        }} />
      </div>
    )
  }

  const totalAgreements = pricings.length
  const activeAgreements = pricings.filter((p) => p.active).length
  const uniqueCrews = new Set(pricings.map((p) => p.crewId)).size

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {toast && (
        <div style={{
          position: 'fixed',
          top: '1rem',
          right: '1rem',
          zIndex: 50,
          padding: '0.5rem 1rem',
          borderRadius: '0.5rem',
          boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1)',
          fontSize: '0.875rem',
          color: 'white',
          backgroundColor: toastType === 'error' ? '#DC2626' : '#0f2a3e'
        }}>
          {toast}
        </div>
      )}

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem' }}>
        <div>
          <h1 style={{ fontSize: '1.875rem', fontWeight: 'bold', color: '#111827' }}>
            Subcontractor Pricing
          </h1>
          <p style={{ fontSize: '0.875rem', color: '#6B7280', marginTop: '0.25rem' }}>
            Manage crew and subcontractor pricing agreements by builder
          </p>
        </div>
        <button
          onClick={() => {
            resetForm()
            setShowAddForm(true)
          }}
          style={{
            padding: '0.5rem 1rem',
            backgroundColor: '#C6A24E',
            color: 'white',
            borderRadius: '0.5rem',
            border: 'none',
            cursor: 'pointer',
            fontWeight: 500,
            fontSize: '1rem',
            transition: 'background-color 0.2s'
          }}
          onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#D46D1A')}
          onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#C6A24E')}
        >
          + Add Pricing Agreement
        </button>
      </div>

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(12rem, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
        <div style={{ backgroundColor: 'white', borderRadius: '0.5rem', border: '1px solid #E5E7EB', padding: '1rem' }}>
          <p style={{ fontSize: '0.75rem', color: '#6B7280', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Total Agreements
          </p>
          <p style={{ fontSize: '1.875rem', fontWeight: 'bold', color: '#111827', marginTop: '0.5rem' }}>
            {totalAgreements}
          </p>
        </div>
        <div style={{ backgroundColor: 'white', borderRadius: '0.5rem', border: '1px solid #E5E7EB', padding: '1rem' }}>
          <p style={{ fontSize: '0.75rem', color: '#6B7280', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Active Agreements
          </p>
          <p style={{ fontSize: '1.875rem', fontWeight: 'bold', color: '#16A34A', marginTop: '0.5rem' }}>
            {activeAgreements}
          </p>
        </div>
        <div style={{ backgroundColor: 'white', borderRadius: '0.5rem', border: '1px solid #E5E7EB', padding: '1rem' }}>
          <p style={{ fontSize: '0.75rem', color: '#6B7280', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Unique Crews
          </p>
          <p style={{ fontSize: '1.875rem', fontWeight: 'bold', color: '#0f2a3e', marginTop: '0.5rem' }}>
            {uniqueCrews}
          </p>
        </div>
      </div>

      {/* Filters */}
      <div style={{ backgroundColor: 'white', borderRadius: '0.5rem', border: '1px solid #E5E7EB', padding: '1rem', marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
          <div style={{ flex: '1 1 12rem', minWidth: '12rem' }}>
            <input
              type="text"
              placeholder="Search by crew name, builder, or notes..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{
                width: '100%',
                padding: '0.5rem 0.75rem',
                border: '1px solid #D1D5DB',
                borderRadius: '0.375rem',
                fontSize: '0.875rem',
                outline: 'none'
              }}
              onFocus={(e) => (e.currentTarget.style.boxShadow = '0 0 0 2px #C6A24E')}
              onBlur={(e) => (e.currentTarget.style.boxShadow = 'none')}
            />
          </div>
        </div>
        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <span style={{ fontSize: '0.75rem', color: '#6B7280', fontWeight: 600, textTransform: 'uppercase', paddingTop: '0.375rem' }}>
              Crew Type:
            </span>
            {['ALL', 'DELIVERY', 'INSTALLATION', 'DELIVERY_AND_INSTALL'].map((type) => (
              <button
                key={type}
                onClick={() => setTypeFilter(type)}
                style={{
                  padding: '0.375rem 0.75rem',
                  fontSize: '0.875rem',
                  borderRadius: '0.375rem',
                  fontWeight: 500,
                  border: 'none',
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                  backgroundColor: typeFilter === type ? '#C6A24E' : '#F3F4F6',
                  color: typeFilter === type ? 'white' : '#374151',
                }}
                onMouseEnter={(e) => {
                  if (typeFilter !== type) {
                    e.currentTarget.style.backgroundColor = '#E5E7EB'
                  }
                }}
                onMouseLeave={(e) => {
                  if (typeFilter !== type) {
                    e.currentTarget.style.backgroundColor = '#F3F4F6'
                  }
                }}
              >
                {type === 'ALL' ? 'All' : type === 'DELIVERY_AND_INSTALL' ? 'Delivery & Install' : type}
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <span style={{ fontSize: '0.75rem', color: '#6B7280', fontWeight: 600, textTransform: 'uppercase', paddingTop: '0.375rem' }}>
              Builder:
            </span>
            <select
              value={builderFilter}
              onChange={(e) => setBuilderFilter(e.target.value)}
              style={{
                padding: '0.375rem 0.75rem',
                fontSize: '0.875rem',
                borderRadius: '0.375rem',
                border: '1px solid #D1D5DB',
                backgroundColor: 'white',
                cursor: 'pointer'
              }}
            >
              <option value="ALL">All Builders</option>
              {builders.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.companyName}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Add/Edit Form */}
      {showAddForm && (
        <div style={{
          backgroundColor: 'white',
          borderRadius: '0.5rem',
          border: '1px solid #E5E7EB',
          padding: '1.5rem',
          marginBottom: '1.5rem'
        }}>
          <h2 style={{ fontSize: '1.125rem', fontWeight: 'bold', marginBottom: '1rem', color: '#111827' }}>
            {editingId ? 'Edit Pricing Agreement' : 'Add New Pricing Agreement'}
          </h2>
          <form onSubmit={editingId ? handleUpdatePricing : handleAddPricing}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(15rem, 1fr))', gap: '1rem', marginBottom: '1rem' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.875rem', color: '#6B7280', fontWeight: 600, marginBottom: '0.25rem' }}>
                  Crew *
                </label>
                <select
                  value={formData.crewId}
                  onChange={(e) => setFormData({ ...formData, crewId: e.target.value })}
                  disabled={!!editingId}
                  style={{
                    width: '100%',
                    padding: '0.5rem 0.75rem',
                    border: '1px solid #D1D5DB',
                    borderRadius: '0.375rem',
                    fontSize: '0.875rem',
                    backgroundColor: editingId ? '#F3F4F6' : 'white',
                    cursor: editingId ? 'not-allowed' : 'pointer'
                  }}
                >
                  <option value="">Select a crew</option>
                  {crews.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({c.crewType})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.875rem', color: '#6B7280', fontWeight: 600, marginBottom: '0.25rem' }}>
                  Builder (Optional)
                </label>
                <select
                  value={formData.builderId}
                  onChange={(e) => setFormData({ ...formData, builderId: e.target.value })}
                  style={{
                    width: '100%',
                    padding: '0.5rem 0.75rem',
                    border: '1px solid #D1D5DB',
                    borderRadius: '0.375rem',
                    fontSize: '0.875rem'
                  }}
                >
                  <option value="">All Builders</option>
                  {builders.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.companyName}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.875rem', color: '#6B7280', fontWeight: 600, marginBottom: '0.25rem' }}>
                  Price per Door Install
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={formData.pricePerDoor}
                  onChange={(e) => setFormData({ ...formData, pricePerDoor: e.target.value })}
                  style={{
                    width: '100%',
                    padding: '0.5rem 0.75rem',
                    border: '1px solid #D1D5DB',
                    borderRadius: '0.375rem',
                    fontSize: '0.875rem'
                  }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.875rem', color: '#6B7280', fontWeight: 600, marginBottom: '0.25rem' }}>
                  Price per Hardware Set
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={formData.pricePerHardwareSet}
                  onChange={(e) => setFormData({ ...formData, pricePerHardwareSet: e.target.value })}
                  style={{
                    width: '100%',
                    padding: '0.5rem 0.75rem',
                    border: '1px solid #D1D5DB',
                    borderRadius: '0.375rem',
                    fontSize: '0.875rem'
                  }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.875rem', color: '#6B7280', fontWeight: 600, marginBottom: '0.25rem' }}>
                  Price per Trim Piece
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={formData.pricePerTrimPiece}
                  onChange={(e) => setFormData({ ...formData, pricePerTrimPiece: e.target.value })}
                  style={{
                    width: '100%',
                    padding: '0.5rem 0.75rem',
                    border: '1px solid #D1D5DB',
                    borderRadius: '0.375rem',
                    fontSize: '0.875rem'
                  }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.875rem', color: '#6B7280', fontWeight: 600, marginBottom: '0.25rem' }}>
                  Price per Window
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={formData.pricePerWindow}
                  onChange={(e) => setFormData({ ...formData, pricePerWindow: e.target.value })}
                  style={{
                    width: '100%',
                    padding: '0.5rem 0.75rem',
                    border: '1px solid #D1D5DB',
                    borderRadius: '0.375rem',
                    fontSize: '0.875rem'
                  }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.875rem', color: '#6B7280', fontWeight: 600, marginBottom: '0.25rem' }}>
                  Flat Rate Per Unit (Optional)
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={formData.flatRatePerUnit}
                  onChange={(e) => setFormData({ ...formData, flatRatePerUnit: e.target.value })}
                  placeholder="Alternative to line items"
                  style={{
                    width: '100%',
                    padding: '0.5rem 0.75rem',
                    border: '1px solid #D1D5DB',
                    borderRadius: '0.375rem',
                    fontSize: '0.875rem'
                  }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.875rem', color: '#6B7280', fontWeight: 600, marginBottom: '0.25rem' }}>
                  Effective Date
                </label>
                <input
                  type="date"
                  value={formData.effectiveDate}
                  onChange={(e) => setFormData({ ...formData, effectiveDate: e.target.value })}
                  style={{
                    width: '100%',
                    padding: '0.5rem 0.75rem',
                    border: '1px solid #D1D5DB',
                    borderRadius: '0.375rem',
                    fontSize: '0.875rem'
                  }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.875rem', color: '#6B7280', fontWeight: 600, marginBottom: '0.25rem' }}>
                  Expires At (Optional)
                </label>
                <input
                  type="date"
                  value={formData.expiresAt}
                  onChange={(e) => setFormData({ ...formData, expiresAt: e.target.value })}
                  style={{
                    width: '100%',
                    padding: '0.5rem 0.75rem',
                    border: '1px solid #D1D5DB',
                    borderRadius: '0.375rem',
                    fontSize: '0.875rem'
                  }}
                />
              </div>

              <div style={{ gridColumn: '1 / -1' }}>
                <label style={{ display: 'block', fontSize: '0.875rem', color: '#6B7280', fontWeight: 600, marginBottom: '0.25rem' }}>
                  Notes
                </label>
                <textarea
                  value={formData.notes}
                  onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                  placeholder="e.g., Special agreement for 2026 projects"
                  style={{
                    width: '100%',
                    padding: '0.5rem 0.75rem',
                    border: '1px solid #D1D5DB',
                    borderRadius: '0.375rem',
                    fontSize: '0.875rem',
                    minHeight: '5rem',
                    fontFamily: 'inherit'
                  }}
                />
              </div>
            </div>

            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-start' }}>
              <button
                type="submit"
                style={{
                  padding: '0.5rem 1rem',
                  backgroundColor: '#C6A24E',
                  color: 'white',
                  borderRadius: '0.375rem',
                  border: 'none',
                  cursor: 'pointer',
                  fontWeight: 500,
                  fontSize: '0.875rem',
                  transition: 'background-color 0.2s'
                }}
                onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#D46D1A')}
                onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#C6A24E')}
              >
                {editingId ? 'Update Agreement' : 'Create Agreement'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowAddForm(false)
                  resetForm()
                }}
                style={{
                  padding: '0.5rem 1rem',
                  backgroundColor: '#F3F4F6',
                  color: '#374151',
                  borderRadius: '0.375rem',
                  border: 'none',
                  cursor: 'pointer',
                  fontWeight: 500,
                  fontSize: '0.875rem',
                  transition: 'background-color 0.2s'
                }}
                onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#E5E7EB')}
                onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#F3F4F6')}
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Pricing Table */}
      <div style={{ backgroundColor: 'white', borderRadius: '0.5rem', border: '1px solid #E5E7EB', overflow: 'hidden' }}>
        {filtered.length === 0 ? (
          <div style={{
            padding: '2rem',
            textAlign: 'center',
            color: '#6B7280',
            fontSize: '0.875rem'
          }}>
            No pricing agreements found
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{
              width: '100%',
              borderCollapse: 'collapse',
              fontSize: '0.875rem'
            }}>
              <thead>
                <tr style={{ backgroundColor: '#F9FAFB', borderBottom: '1px solid #E5E7EB' }}>
                  <th style={{ padding: '0.75rem 1rem', textAlign: 'left', fontWeight: 600, color: '#374151' }}>
                    Crew Name
                  </th>
                  <th style={{ padding: '0.75rem 1rem', textAlign: 'left', fontWeight: 600, color: '#374151' }}>
                    Type
                  </th>
                  <th style={{ padding: '0.75rem 1rem', textAlign: 'left', fontWeight: 600, color: '#374151' }}>
                    Builder
                  </th>
                  <th style={{ padding: '0.75rem 1rem', textAlign: 'right', fontWeight: 600, color: '#374151' }}>
                    Per Door
                  </th>
                  <th style={{ padding: '0.75rem 1rem', textAlign: 'right', fontWeight: 600, color: '#374151' }}>
                    Per Hardware
                  </th>
                  <th style={{ padding: '0.75rem 1rem', textAlign: 'right', fontWeight: 600, color: '#374151' }}>
                    Per Trim
                  </th>
                  <th style={{ padding: '0.75rem 1rem', textAlign: 'right', fontWeight: 600, color: '#374151' }}>
                    Per Window
                  </th>
                  <th style={{ padding: '0.75rem 1rem', textAlign: 'left', fontWeight: 600, color: '#374151' }}>
                    Effective Date
                  </th>
                  <th style={{ padding: '0.75rem 1rem', textAlign: 'center', fontWeight: 600, color: '#374151' }}>
                    Status
                  </th>
                  <th style={{ padding: '0.75rem 1rem', textAlign: 'center', fontWeight: 600, color: '#374151' }}>
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((pricing, idx) => (
                  <tr
                    key={pricing.id}
                    style={{
                      borderBottom: '1px solid #E5E7EB',
                      backgroundColor: idx % 2 === 0 ? 'white' : '#F9FAFB'
                    }}
                  >
                    <td style={{ padding: '0.75rem 1rem', fontWeight: 500, color: '#111827' }}>
                      {pricing.crewName}
                    </td>
                    <td style={{ padding: '0.75rem 1rem' }}>
                      <span style={{
                        display: 'inline-block',
                        padding: '0.25rem 0.5rem',
                        borderRadius: '0.25rem',
                        fontSize: '0.75rem',
                        fontWeight: 500,
                        backgroundColor: pricing.crewType === 'DELIVERY' ? '#DBEAFE' : '#FEF3C7',
                        color: pricing.crewType === 'DELIVERY' ? '#1E40AF' : '#92400E'
                      }}>
                        {pricing.crewType === 'DELIVERY' ? 'Delivery' : pricing.crewType === 'DELIVERY_AND_INSTALL' ? 'Delivery & Install' : 'Installation'}
                      </span>
                    </td>
                    <td style={{ padding: '0.75rem 1rem', color: '#374151' }}>
                      {pricing.builderName || '—'}
                    </td>
                    <td style={{ padding: '0.75rem 1rem', textAlign: 'right', color: '#374151' }}>
                      ${pricing.pricePerDoor.toFixed(2)}
                    </td>
                    <td style={{ padding: '0.75rem 1rem', textAlign: 'right', color: '#374151' }}>
                      ${pricing.pricePerHardwareSet.toFixed(2)}
                    </td>
                    <td style={{ padding: '0.75rem 1rem', textAlign: 'right', color: '#374151' }}>
                      ${pricing.pricePerTrimPiece.toFixed(2)}
                    </td>
                    <td style={{ padding: '0.75rem 1rem', textAlign: 'right', color: '#374151' }}>
                      ${pricing.pricePerWindow.toFixed(2)}
                    </td>
                    <td style={{ padding: '0.75rem 1rem', color: '#374151' }}>
                      {new Date(pricing.effectiveDate).toLocaleDateString()}
                    </td>
                    <td style={{ padding: '0.75rem 1rem', textAlign: 'center' }}>
                      <span style={{
                        display: 'inline-block',
                        padding: '0.25rem 0.5rem',
                        borderRadius: '0.25rem',
                        fontSize: '0.75rem',
                        fontWeight: 500,
                        backgroundColor: pricing.active ? '#DCFCE7' : '#FEE2E2',
                        color: pricing.active ? '#166534' : '#991B1B'
                      }}>
                        {pricing.active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td style={{ padding: '0.75rem 1rem', textAlign: 'center' }}>
                      <div style={{ display: 'flex', gap: '0.25rem', justifyContent: 'center' }}>
                        <button
                          onClick={() => handleEditPricing(pricing)}
                          style={{
                            padding: '0.25rem 0.5rem',
                            fontSize: '0.75rem',
                            backgroundColor: '#0f2a3e',
                            color: 'white',
                            border: 'none',
                            borderRadius: '0.25rem',
                            cursor: 'pointer',
                            transition: 'background-color 0.2s'
                          }}
                          onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#0F3460')}
                          onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#0f2a3e')}
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleDeletePricing(pricing.id)}
                          style={{
                            padding: '0.25rem 0.5rem',
                            fontSize: '0.75rem',
                            backgroundColor: '#DC2626',
                            color: 'white',
                            border: 'none',
                            borderRadius: '0.25rem',
                            cursor: 'pointer',
                            transition: 'background-color 0.2s'
                          }}
                          onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#B91C1C')}
                          onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#DC2626')}
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Cost Calculator - shown below table */}
      {filtered.length > 0 && (
        <div style={{
          marginTop: '1.5rem',
          backgroundColor: '#F9FAFB',
          borderRadius: '0.5rem',
          border: '1px solid #E5E7EB',
          padding: '1rem'
        }}>
          <h3 style={{ fontSize: '0.875rem', fontWeight: 600, color: '#0f2a3e', marginBottom: '0.75rem', textTransform: 'uppercase' }}>
            Cost Calculator Example
          </h3>
          <div style={{ fontSize: '0.875rem', color: '#374151', lineHeight: '1.5' }}>
            <p>Select a pricing agreement to calculate costs for your installation:</p>
            <p style={{ marginTop: '0.5rem' }}>
              <strong>Formula:</strong> (Doors × Price Per Door) + (Hardware Sets × Price Per Hardware) + (Trim Pieces × Price Per Trim) + (Windows × Price Per Window)
            </p>
            <p style={{ marginTop: '0.5rem', color: '#6B7280', fontSize: '0.8rem' }}>
              Or use the Flat Rate Per Unit if configured for a simpler pricing model.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
