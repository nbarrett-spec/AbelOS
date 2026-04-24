'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

interface FloorPlan {
  id: string
  name: string
  sqFootage: number
  bedrooms: number
  bathrooms: number
  stories: number
  interiorDoorCount: number
  exteriorDoorCount: number
  basePackagePrice: number
}

interface Organization {
  id: string
  name: string
  code: string
}

interface Division {
  id: string
  name: string
}

interface Community {
  id: string
  name: string
  code: string
  city: string
  state: string
  zip: string
  address: string
  totalLots: number
  activeLots: number
  notes?: string
  active: boolean
  orgName: string
  orgCode: string
  orgId: string
  jobCount: number
  floorPlanCount: number
  floorPlans: FloorPlan[]
  organization: Organization
  _count: { jobs: number; floorPlans: number }
  divisionId?: string
  divisionName?: string
}

interface ApiResponse {
  communities: Community[]
}

interface OrgOption {
  id: string
  name: string
  code: string
}

interface PmOption {
  id: string
  firstName: string
  lastName: string
}

interface FormData {
  organizationId: string
  name: string
  code: string
  city: string
  state: string
  zip: string
  address: string
  totalLots: string
  notes: string
  divisionId: string
}

export default function CommunitiesPage() {
  const [communities, setCommunities] = useState<Community[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [showAddModal, setShowAddModal] = useState(false)
  const [formData, setFormData] = useState<FormData>({
    organizationId: '',
    name: '',
    code: '',
    city: '',
    state: '',
    zip: '',
    address: '',
    totalLots: '',
    notes: '',
    divisionId: '',
  })
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [orgOptions, setOrgOptions] = useState<OrgOption[]>([])
  const [divisionOptions, setDivisionOptions] = useState<Division[]>([])
  const [selectedDivisionFilter, setSelectedDivisionFilter] = useState('')
  const [pmFilter, setPmFilter] = useState<string>('')
  const [pms, setPms] = useState<PmOption[]>([])
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    fetch('/api/ops/pm/roster')
      .then((r) => r.json())
      .then((d) => setPms(d.pms || d.data || []))
      .catch(() => {})
  }, [])

  useEffect(() => {
    const fetchCommunities = async () => {
      try {
        setLoading(true)
        setError(null)
        const params = new URLSearchParams()
        if (search) {
          params.append('search', search)
        }
        if (selectedDivisionFilter) {
          params.append('divisionId', selectedDivisionFilter)
        }
        if (pmFilter) {
          params.append('pmId', pmFilter)
        }
        const response = await fetch(`/api/ops/communities?${params.toString()}`)
        if (!response.ok) {
          throw new Error('Failed to fetch communities')
        }
        const data: ApiResponse = await response.json()
        setCommunities(data.communities || [])
      } catch (err) {
        setError(err instanceof Error ? err.message : 'An error occurred')
      } finally {
        setLoading(false)
      }
    }

    const debounceTimer = setTimeout(fetchCommunities, 300)
    return () => clearTimeout(debounceTimer)
  }, [search, refreshKey, selectedDivisionFilter, pmFilter])

  const router = useRouter()

  const handleCardClick = (id: string, e: React.MouseEvent) => {
    // If clicking on the floor plans toggle, expand inline; otherwise navigate to detail
    const target = e.target as HTMLElement
    if (target.closest('[data-toggle-floorplans]')) {
      e.preventDefault()
      setExpandedId(expandedId === id ? null : id)
    } else {
      router.push(`/ops/communities/${id}`)
    }
  }

  const fetchOrganizations = async () => {
    try {
      const response = await fetch('/api/ops/organizations?limit=200')
      if (!response.ok) {
        throw new Error('Failed to fetch organizations')
      }
      const data = await response.json()
      setOrgOptions(data.organizations || [])
    } catch (err) {
      console.error('Error fetching organizations:', err)
      setFormError('Failed to load organizations')
    }
  }

  const fetchDivisions = async (organizationId: string) => {
    if (!organizationId) {
      setDivisionOptions([])
      return
    }
    try {
      const response = await fetch(`/api/ops/divisions?organizationId=${organizationId}`)
      if (!response.ok) {
        throw new Error('Failed to fetch divisions')
      }
      const data = await response.json()
      setDivisionOptions(data.divisions || [])
    } catch (err) {
      console.error('Error fetching divisions:', err)
      setDivisionOptions([])
    }
  }

  const handleOpenModal = async () => {
    setShowAddModal(true)
    setFormError(null)
    setFormData({
      organizationId: '',
      name: '',
      code: '',
      city: '',
      state: '',
      zip: '',
      address: '',
      totalLots: '',
      notes: '',
      divisionId: '',
    })
    setDivisionOptions([])
    await fetchOrganizations()
  }

  const handleCloseModal = () => {
    setShowAddModal(false)
    setFormError(null)
  }

  const handleFormChange = async (field: keyof FormData, value: string) => {
    setFormData((prev) => ({
      ...prev,
      [field]: value,
    }))
    // Fetch divisions when organization changes
    if (field === 'organizationId') {
      await fetchDivisions(value)
    }
  }

  const handleCreateCommunity = async () => {
    setFormError(null)

    if (!formData.organizationId || !formData.name) {
      setFormError('Organization and Name are required')
      return
    }

    setSubmitting(true)
    try {
      const payload = {
        organizationId: formData.organizationId,
        name: formData.name,
        code: formData.code || undefined,
        city: formData.city || undefined,
        state: formData.state || undefined,
        zip: formData.zip || undefined,
        address: formData.address || undefined,
        totalLots: formData.totalLots ? parseInt(formData.totalLots, 10) : undefined,
        notes: formData.notes || undefined,
        divisionId: formData.divisionId || undefined,
      }

      const response = await fetch('/api/ops/communities', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.message || 'Failed to create community')
      }

      handleCloseModal()
      setRefreshKey((prev) => prev + 1)
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div style={{ padding: '32px', maxWidth: '1400px', margin: '0 auto' }}>
      {/* Header */}
      <div style={{ marginBottom: '32px' }}>
        <h1 style={{ fontSize: '28px', fontWeight: 700, color: '#0f2a3e', marginBottom: '8px' }}>
          Community Management
        </h1>
        <p style={{ fontSize: '16px', color: '#6b7280', marginBottom: '24px' }}>
          Track builder communities, subdivisions, and developments
        </p>

        {/* Search and Filters Bar */}
        <div style={{ display: 'flex', gap: '12px', marginBottom: '24px', flexWrap: 'wrap', alignItems: 'center' }}>
          <input
            type="text"
            placeholder="Search communities, organizations, or locations..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{
              flex: 1,
              minWidth: '250px',
              padding: '12px 16px',
              borderRadius: '8px',
              border: '1px solid #d1d5db',
              fontSize: '14px',
              boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
            }}
          />
          <select
            value={selectedDivisionFilter}
            onChange={(e) => setSelectedDivisionFilter(e.target.value)}
            style={{
              padding: '12px 16px',
              borderRadius: '8px',
              border: '1px solid #d1d5db',
              fontSize: '14px',
              backgroundColor: 'white',
              cursor: 'pointer',
              boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
            }}
          >
            <option value="">All Divisions</option>
            {divisionOptions.map((div) => (
              <option key={div.id} value={div.id}>
                {div.name}
              </option>
            ))}
          </select>
          <select
            value={pmFilter}
            onChange={(e) => setPmFilter(e.target.value)}
            style={{
              padding: '12px 16px',
              borderRadius: '8px',
              border: '1px solid #d1d5db',
              fontSize: '14px',
              backgroundColor: 'white',
              cursor: 'pointer',
              boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
            }}
          >
            <option value="">All PMs</option>
            {pms.map((pm) => (
              <option key={pm.id} value={pm.id}>
                {pm.firstName} {pm.lastName}
              </option>
            ))}
          </select>
          <button
            onClick={handleOpenModal}
            style={{
              padding: '12px 24px',
              backgroundColor: '#C6A24E',
              color: 'white',
              border: 'none',
              borderRadius: '8px',
              fontSize: '14px',
              fontWeight: 600,
              cursor: 'pointer',
              boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
              transition: 'all 0.2s',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = '#A8882A'
              e.currentTarget.style.boxShadow = '0 4px 12px rgba(230, 126, 34, 0.3)'
              e.currentTarget.style.transform = 'translateY(-2px)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = '#C6A24E'
              e.currentTarget.style.boxShadow = '0 1px 2px rgba(0,0,0,0.05)'
              e.currentTarget.style.transform = 'translateY(0)'
            }}
          >
            + Add Community
          </button>
        </div>
      </div>

      {/* Loading State */}
      {loading && (
        <div style={{ textAlign: 'center', padding: '60px 32px', color: '#9ca3af' }}>
          <p style={{ fontSize: '16px', fontWeight: 500 }}>Loading communities...</p>
        </div>
      )}

      {/* Error State */}
      {error && !loading && (
        <div style={{ textAlign: 'center', padding: '40px 32px', backgroundColor: '#fee2e2', borderRadius: '8px', border: '1px solid #fecaca' }}>
          <p style={{ fontSize: '16px', color: '#991b1b', fontWeight: 500 }}>Error loading communities</p>
          <p style={{ fontSize: '14px', color: '#7f1d1d', marginTop: '8px' }}>{error}</p>
        </div>
      )}

      {/* Empty State */}
      {!loading && !error && communities.length === 0 && (
        <div style={{ textAlign: 'center', padding: '60px 32px', color: '#9ca3af' }}>
          <p style={{ fontSize: '48px', marginBottom: '12px' }}>🏘️</p>
          <p style={{ fontSize: '16px', fontWeight: 500, marginBottom: '4px' }}>No communities found</p>
          <p style={{ fontSize: '14px' }}>Try adjusting your search criteria</p>
        </div>
      )}

      {/* Community Grid */}
      {!loading && !error && communities.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '20px', marginBottom: '40px' }}>
          {communities.map((community) => (
            <div key={community.id}>
              {/* Card */}
              <div
                onClick={(e) => handleCardClick(community.id, e)}
                style={{
                  backgroundColor: 'white',
                  borderRadius: '12px',
                  border: expandedId === community.id ? `2px solid #C6A24E` : '1px solid #e5e7eb',
                  overflow: 'hidden',
                  boxShadow: expandedId === community.id ? '0 4px 12px rgba(230, 126, 34, 0.2)' : '0 1px 3px rgba(0,0,0,0.1)',
                  transition: 'all 0.2s',
                  cursor: 'pointer',
                  position: 'relative',
                }}
                onMouseEnter={(e) => {
                  if (expandedId !== community.id) {
                    e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)'
                    e.currentTarget.style.transform = 'translateY(-2px)'
                  }
                }}
                onMouseLeave={(e) => {
                  if (expandedId !== community.id) {
                    e.currentTarget.style.boxShadow = '0 1px 3px rgba(0,0,0,0.1)'
                    e.currentTarget.style.transform = 'translateY(0)'
                  }
                }}
              >
                {/* Card Header */}
                <div style={{ padding: '20px' }}>
                  {/* Organization and Division Labels */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                    <p style={{ fontSize: '11px', color: '#9ca3af', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                      {community.orgName}
                    </p>
                    {community.divisionName && (
                      <p style={{ fontSize: '11px', color: '#C6A24E', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                        {community.divisionName}
                      </p>
                    )}
                    {!community.divisionName && (
                      <p style={{ fontSize: '11px', color: '#9ca3af', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                        —
                      </p>
                    )}
                  </div>

                  {/* Community Name */}
                  <div style={{ marginBottom: '12px' }}>
                    <Link href={`/ops/communities/${community.id}`} style={{ textDecoration: 'none' }}>
                      <h3 style={{ fontSize: '18px', fontWeight: 700, color: '#0f2a3e', marginBottom: '4px', cursor: 'pointer' }}>
                        {community.name}
                      </h3>
                    </Link>
                  </div>

                  {/* Location */}
                  <div style={{ marginBottom: '16px' }}>
                    <p style={{ fontSize: '13px', color: '#6b7280' }}>
                      {community.city}, {community.state} {community.zip}
                    </p>
                  </div>

                  {/* Stats Grid */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', paddingTop: '16px', borderTop: '1px solid #f3f4f6' }}>
                    <div>
                      <p style={{ fontSize: '20px', fontWeight: 700, color: '#C6A24E' }}>
                        {community.totalLots}
                      </p>
                      <p style={{ fontSize: '11px', color: '#9ca3af', marginTop: '2px' }}>
                        Total Lots
                      </p>
                    </div>
                    <div>
                      <p style={{ fontSize: '20px', fontWeight: 700, color: '#0f2a3e' }}>
                        {community.activeLots}
                      </p>
                      <p style={{ fontSize: '11px', color: '#9ca3af', marginTop: '2px' }}>
                        Active Lots
                      </p>
                    </div>
                    <div>
                      <p style={{ fontSize: '20px', fontWeight: 700, color: '#6b7280' }}>
                        {community.jobCount}
                      </p>
                      <p style={{ fontSize: '11px', color: '#9ca3af', marginTop: '2px' }}>
                        Jobs
                      </p>
                    </div>
                    <div>
                      <p style={{ fontSize: '20px', fontWeight: 700, color: '#6b7280' }}>
                        {community.floorPlanCount}
                      </p>
                      <p style={{ fontSize: '11px', color: '#9ca3af', marginTop: '2px' }}>
                        Floor Plans
                      </p>
                    </div>
                  </div>

                  {/* Expand Indicator */}
                  <div data-toggle-floorplans style={{ marginTop: '12px', textAlign: 'center' }}>
                    <span style={{ fontSize: '12px', color: '#C6A24E', fontWeight: 600 }}>
                      {expandedId === community.id ? '▲ Hide Floor Plans' : '▼ View Floor Plans'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Expanded Floor Plans Section */}
              {expandedId === community.id && (
                <div
                  style={{
                    marginTop: '12px',
                    backgroundColor: 'white',
                    borderRadius: '12px',
                    border: '1px solid #e5e7eb',
                    overflow: 'hidden',
                    boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
                  }}
                >
                  <div style={{ padding: '20px' }}>
                    <h4 style={{ fontSize: '16px', fontWeight: 700, color: '#0f2a3e', marginBottom: '16px' }}>
                      Floor Plans
                    </h4>

                    {community.floorPlans && community.floorPlans.length > 0 ? (
                      <div style={{ overflowX: 'auto' }}>
                        <table
                          style={{
                            width: '100%',
                            borderCollapse: 'collapse',
                            fontSize: '13px',
                          }}
                        >
                          <thead>
                            <tr style={{ borderBottom: '2px solid #C6A24E' }}>
                              <th style={{ padding: '12px 8px', textAlign: 'left', fontWeight: 700, color: '#0f2a3e' }}>
                                Name
                              </th>
                              <th style={{ padding: '12px 8px', textAlign: 'center', fontWeight: 700, color: '#0f2a3e' }}>
                                Sq Ft
                              </th>
                              <th style={{ padding: '12px 8px', textAlign: 'center', fontWeight: 700, color: '#0f2a3e' }}>
                                Beds
                              </th>
                              <th style={{ padding: '12px 8px', textAlign: 'center', fontWeight: 700, color: '#0f2a3e' }}>
                                Baths
                              </th>
                              <th style={{ padding: '12px 8px', textAlign: 'center', fontWeight: 700, color: '#0f2a3e' }}>
                                Stories
                              </th>
                              <th style={{ padding: '12px 8px', textAlign: 'center', fontWeight: 700, color: '#0f2a3e' }}>
                                Int Doors
                              </th>
                              <th style={{ padding: '12px 8px', textAlign: 'center', fontWeight: 700, color: '#0f2a3e' }}>
                                Ext Doors
                              </th>
                              <th style={{ padding: '12px 8px', textAlign: 'right', fontWeight: 700, color: '#0f2a3e' }}>
                                Base Price
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {community.floorPlans.map((plan, idx) => (
                              <tr
                                key={plan.id}
                                style={{
                                  borderBottom: idx < community.floorPlans.length - 1 ? '1px solid #f3f4f6' : 'none',
                                  backgroundColor: idx % 2 === 0 ? '#ffffff' : '#f9fafb',
                                }}
                              >
                                <td style={{ padding: '12px 8px', color: '#1f2937', fontWeight: 600 }}>
                                  {plan.name}
                                </td>
                                <td style={{ padding: '12px 8px', textAlign: 'center', color: '#6b7280' }}>
                                  {plan.sqFootage.toLocaleString()}
                                </td>
                                <td style={{ padding: '12px 8px', textAlign: 'center', color: '#6b7280' }}>
                                  {plan.bedrooms}
                                </td>
                                <td style={{ padding: '12px 8px', textAlign: 'center', color: '#6b7280' }}>
                                  {plan.bathrooms}
                                </td>
                                <td style={{ padding: '12px 8px', textAlign: 'center', color: '#6b7280' }}>
                                  {plan.stories}
                                </td>
                                <td style={{ padding: '12px 8px', textAlign: 'center', color: '#6b7280' }}>
                                  {plan.interiorDoorCount}
                                </td>
                                <td style={{ padding: '12px 8px', textAlign: 'center', color: '#6b7280' }}>
                                  {plan.exteriorDoorCount}
                                </td>
                                <td style={{ padding: '12px 8px', textAlign: 'right', color: '#C6A24E', fontWeight: 600 }}>
                                  ${plan.basePackagePrice.toLocaleString()}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <div style={{ padding: '20px', textAlign: 'center', backgroundColor: '#f9fafb', borderRadius: '8px', color: '#9ca3af' }}>
                        <p style={{ fontSize: '14px' }}>No floor plans configured</p>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Add Community Modal */}
      {showAddModal && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}
          onClick={handleCloseModal}
        >
          <div
            style={{
              backgroundColor: 'white',
              borderRadius: '12px',
              boxShadow: '0 20px 25px rgba(0,0,0,0.15)',
              maxWidth: '600px',
              width: '90%',
              maxHeight: '90vh',
              overflow: 'auto',
              padding: '32px',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <h2 style={{ fontSize: '24px', fontWeight: 700, color: '#0f2a3e', marginBottom: '8px' }}>
              Add Community
            </h2>
            <p style={{ fontSize: '14px', color: '#6b7280', marginBottom: '24px' }}>
              Create a new community or subdivision
            </p>

            {/* Error Message */}
            {formError && (
              <div style={{ marginBottom: '16px', padding: '12px 16px', backgroundColor: '#fee2e2', borderRadius: '8px', border: '1px solid #fecaca' }}>
                <p style={{ fontSize: '14px', color: '#991b1b', fontWeight: 500 }}>{formError}</p>
              </div>
            )}

            {/* Form Fields */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '24px' }}>
              {/* Organization - Required */}
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={{ display: 'block', fontSize: '14px', fontWeight: 600, color: '#0f2a3e', marginBottom: '6px' }}>
                  Organization <span style={{ color: '#C6A24E' }}>*</span>
                </label>
                <select
                  value={formData.organizationId}
                  onChange={(e) => handleFormChange('organizationId', e.target.value)}
                  disabled={submitting}
                  style={{
                    width: '100%',
                    padding: '12px 16px',
                    borderRadius: '8px',
                    border: '1px solid #d1d5db',
                    fontSize: '14px',
                    boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
                    backgroundColor: 'white',
                    cursor: 'pointer',
                    opacity: submitting ? 0.6 : 1,
                  }}
                >
                  <option value="">-- Select an organization --</option>
                  {orgOptions.map((org) => (
                    <option key={org.id} value={org.id}>
                      {org.name} ({org.code})
                    </option>
                  ))}
                </select>
              </div>

              {/* Division - Optional */}
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={{ display: 'block', fontSize: '14px', fontWeight: 600, color: '#0f2a3e', marginBottom: '6px' }}>
                  Division
                </label>
                <select
                  value={formData.divisionId}
                  onChange={(e) => handleFormChange('divisionId', e.target.value)}
                  disabled={submitting || !formData.organizationId}
                  style={{
                    width: '100%',
                    padding: '12px 16px',
                    borderRadius: '8px',
                    border: '1px solid #d1d5db',
                    fontSize: '14px',
                    boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
                    backgroundColor: 'white',
                    cursor: !formData.organizationId || submitting ? 'not-allowed' : 'pointer',
                    opacity: submitting || !formData.organizationId ? 0.6 : 1,
                  }}
                >
                  <option value="">-- No Division (Org Level) --</option>
                  {divisionOptions.map((div) => (
                    <option key={div.id} value={div.id}>
                      {div.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Name - Required */}
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={{ display: 'block', fontSize: '14px', fontWeight: 600, color: '#0f2a3e', marginBottom: '6px' }}>
                  Name <span style={{ color: '#C6A24E' }}>*</span>
                </label>
                <input
                  type="text"
                  placeholder="Community name"
                  value={formData.name}
                  onChange={(e) => handleFormChange('name', e.target.value)}
                  disabled={submitting}
                  style={{
                    width: '100%',
                    padding: '12px 16px',
                    borderRadius: '8px',
                    border: '1px solid #d1d5db',
                    fontSize: '14px',
                    boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
                    opacity: submitting ? 0.6 : 1,
                  }}
                />
              </div>

              {/* Code */}
              <div>
                <label style={{ display: 'block', fontSize: '14px', fontWeight: 600, color: '#0f2a3e', marginBottom: '6px' }}>
                  Code
                </label>
                <input
                  type="text"
                  placeholder="Code"
                  value={formData.code}
                  onChange={(e) => handleFormChange('code', e.target.value)}
                  disabled={submitting}
                  style={{
                    width: '100%',
                    padding: '12px 16px',
                    borderRadius: '8px',
                    border: '1px solid #d1d5db',
                    fontSize: '14px',
                    boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
                    opacity: submitting ? 0.6 : 1,
                  }}
                />
              </div>

              {/* City */}
              <div>
                <label style={{ display: 'block', fontSize: '14px', fontWeight: 600, color: '#0f2a3e', marginBottom: '6px' }}>
                  City
                </label>
                <input
                  type="text"
                  placeholder="City"
                  value={formData.city}
                  onChange={(e) => handleFormChange('city', e.target.value)}
                  disabled={submitting}
                  style={{
                    width: '100%',
                    padding: '12px 16px',
                    borderRadius: '8px',
                    border: '1px solid #d1d5db',
                    fontSize: '14px',
                    boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
                    opacity: submitting ? 0.6 : 1,
                  }}
                />
              </div>

              {/* State */}
              <div>
                <label style={{ display: 'block', fontSize: '14px', fontWeight: 600, color: '#0f2a3e', marginBottom: '6px' }}>
                  State
                </label>
                <input
                  type="text"
                  placeholder="State"
                  value={formData.state}
                  onChange={(e) => handleFormChange('state', e.target.value)}
                  disabled={submitting}
                  style={{
                    width: '100%',
                    padding: '12px 16px',
                    borderRadius: '8px',
                    border: '1px solid #d1d5db',
                    fontSize: '14px',
                    boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
                    opacity: submitting ? 0.6 : 1,
                  }}
                />
              </div>

              {/* Zip */}
              <div>
                <label style={{ display: 'block', fontSize: '14px', fontWeight: 600, color: '#0f2a3e', marginBottom: '6px' }}>
                  Zip
                </label>
                <input
                  type="text"
                  placeholder="Zip code"
                  value={formData.zip}
                  onChange={(e) => handleFormChange('zip', e.target.value)}
                  disabled={submitting}
                  style={{
                    width: '100%',
                    padding: '12px 16px',
                    borderRadius: '8px',
                    border: '1px solid #d1d5db',
                    fontSize: '14px',
                    boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
                    opacity: submitting ? 0.6 : 1,
                  }}
                />
              </div>

              {/* Address */}
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={{ display: 'block', fontSize: '14px', fontWeight: 600, color: '#0f2a3e', marginBottom: '6px' }}>
                  Address
                </label>
                <input
                  type="text"
                  placeholder="Street address"
                  value={formData.address}
                  onChange={(e) => handleFormChange('address', e.target.value)}
                  disabled={submitting}
                  style={{
                    width: '100%',
                    padding: '12px 16px',
                    borderRadius: '8px',
                    border: '1px solid #d1d5db',
                    fontSize: '14px',
                    boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
                    opacity: submitting ? 0.6 : 1,
                  }}
                />
              </div>

              {/* Total Lots */}
              <div>
                <label style={{ display: 'block', fontSize: '14px', fontWeight: 600, color: '#0f2a3e', marginBottom: '6px' }}>
                  Total Lots
                </label>
                <input
                  type="number"
                  placeholder="Number of lots"
                  value={formData.totalLots}
                  onChange={(e) => handleFormChange('totalLots', e.target.value)}
                  disabled={submitting}
                  style={{
                    width: '100%',
                    padding: '12px 16px',
                    borderRadius: '8px',
                    border: '1px solid #d1d5db',
                    fontSize: '14px',
                    boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
                    opacity: submitting ? 0.6 : 1,
                  }}
                />
              </div>

              {/* Notes */}
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={{ display: 'block', fontSize: '14px', fontWeight: 600, color: '#0f2a3e', marginBottom: '6px' }}>
                  Notes
                </label>
                <textarea
                  placeholder="Additional notes..."
                  value={formData.notes}
                  onChange={(e) => handleFormChange('notes', e.target.value)}
                  disabled={submitting}
                  style={{
                    width: '100%',
                    padding: '12px 16px',
                    borderRadius: '8px',
                    border: '1px solid #d1d5db',
                    fontSize: '14px',
                    boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
                    minHeight: '100px',
                    fontFamily: 'inherit',
                    resize: 'vertical',
                    opacity: submitting ? 0.6 : 1,
                  }}
                />
              </div>
            </div>

            {/* Modal Footer */}
            <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
              <button
                onClick={handleCloseModal}
                disabled={submitting}
                style={{
                  padding: '12px 24px',
                  backgroundColor: '#f3f4f6',
                  color: '#1f2937',
                  border: '1px solid #d1d5db',
                  borderRadius: '8px',
                  fontSize: '14px',
                  fontWeight: 600,
                  cursor: submitting ? 'not-allowed' : 'pointer',
                  opacity: submitting ? 0.6 : 1,
                  transition: 'all 0.2s',
                }}
                onMouseEnter={(e) => {
                  if (!submitting) {
                    e.currentTarget.style.backgroundColor = '#e5e7eb'
                  }
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = '#f3f4f6'
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleCreateCommunity}
                disabled={submitting}
                style={{
                  padding: '12px 24px',
                  backgroundColor: '#0f2a3e',
                  color: 'white',
                  border: 'none',
                  borderRadius: '8px',
                  fontSize: '14px',
                  fontWeight: 600,
                  cursor: submitting ? 'not-allowed' : 'pointer',
                  opacity: submitting ? 0.6 : 1,
                  transition: 'all 0.2s',
                }}
                onMouseEnter={(e) => {
                  if (!submitting) {
                    e.currentTarget.style.backgroundColor = '#0f3460'
                    e.currentTarget.style.boxShadow = '0 4px 12px rgba(62, 42, 30, 0.3)'
                    e.currentTarget.style.transform = 'translateY(-2px)'
                  }
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = '#0f2a3e'
                  e.currentTarget.style.boxShadow = 'none'
                  e.currentTarget.style.transform = 'translateY(0)'
                }}
              >
                {submitting ? 'Creating...' : 'Create Community'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
