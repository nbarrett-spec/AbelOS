'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'

interface Community {
  id: string
  name: string
  activeLots: number
}

interface Contract {
  id: string
  contractNumber: string
  title: string
  expirationDate: string
}

interface Division {
  id: string
  name: string
  code: string
  region: string
  city: string
  state: string
  active: boolean
  communityCount: number
  builderCount: number
}

interface Organization {
  id: string
  name: string
  code: string
  type: string
  contactName: string
  email: string
  phone: string
  address: string
  city: string
  state: string
  zip: string
  builderCount: number
  communityCount: number
  contractCount: number
  divisionCount: number
  communities: Community[]
  contracts: Contract[]
  divisions: Division[]
  _count: {
    builders: number
    communities: number
    contracts: number
    divisions: number
  }
}

interface ApiResponse {
  organizations: Organization[]
  total: number
  page: number
  totalPages: number
}

export default function OrganizationsPage() {
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [organizations, setOrganizations] = useState<Organization[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set())
  const [availableTypes, setAvailableTypes] = useState<string[]>([])
  const [showAddModal, setShowAddModal] = useState(false)
  const [showAddDivisionModal, setShowAddDivisionModal] = useState(false)
  const [selectedOrgForDivision, setSelectedOrgForDivision] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [divisionFormError, setDivisionFormError] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const [formData, setFormData] = useState({
    name: '',
    code: '',
    type: 'NATIONAL',
    contactName: '',
    email: '',
    phone: '',
    address: '',
    city: '',
    state: '',
    zip: '',
    defaultPaymentTerm: 'NET_30',
    creditLimit: '',
    taxExempt: false,
    taxId: '',
    notes: '',
  })
  const [divisionFormData, setDivisionFormData] = useState({
    name: '',
    code: '',
    region: '',
    contactName: '',
    email: '',
    phone: '',
    city: '',
    state: '',
    zip: '',
    notes: '',
  })

  // Fetch organizations from API
  useEffect(() => {
    const fetchOrganizations = async () => {
      try {
        setLoading(true)
        setError(null)

        const params = new URLSearchParams()
        if (search) params.append('search', search)
        if (typeFilter) params.append('type', typeFilter)
        params.append('limit', '100')

        const response = await fetch(`/api/ops/organizations?${params.toString()}`)
        if (!response.ok) {
          throw new Error('Failed to fetch organizations')
        }

        const data: ApiResponse = await response.json()
        setOrganizations(data.organizations)

        // Extract unique types from the fetched organizations
        const types = Array.from(new Set(data.organizations.map(org => org.type)))
        setAvailableTypes(types)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'An error occurred')
      } finally {
        setLoading(false)
      }
    }

    // Add a small debounce for search
    const timer = setTimeout(fetchOrganizations, 300)
    return () => clearTimeout(timer)
  }, [search, typeFilter, refreshKey])

  const toggleRowExpand = (orgId: string) => {
    const newExpanded = new Set(expandedRows)
    if (newExpanded.has(orgId)) {
      newExpanded.delete(orgId)
    } else {
      newExpanded.add(orgId)
    }
    setExpandedRows(newExpanded)
  }

  const getTypeColor = (type: string): string => {
    switch (type?.toLowerCase()) {
      case 'builder':
        return '#3E2A1E'
      case 'vendor':
        return '#C9822B'
      case 'subcontractor':
        return '#27ae60'
      default:
        return '#6b7280'
    }
  }

  const formatDate = (dateString: string): string => {
    try {
      return new Date(dateString).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      })
    } catch {
      return dateString
    }
  }

  const handleCreateOrg = async (e: React.FormEvent) => {
    e.preventDefault()
    setFormError(null)

    // Validation
    if (!formData.name.trim()) {
      setFormError('Organization name is required')
      return
    }
    if (!formData.code.trim()) {
      setFormError('Organization code is required')
      return
    }

    try {
      setSubmitting(true)
      const payload = {
        ...formData,
        code: formData.code.toUpperCase(),
        creditLimit: formData.creditLimit ? parseInt(formData.creditLimit) : undefined,
      }

      const response = await fetch('/api/ops/organizations', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.message || 'Failed to create organization')
      }

      // Reset form and close modal
      setFormData({
        name: '',
        code: '',
        type: 'NATIONAL',
        contactName: '',
        email: '',
        phone: '',
        address: '',
        city: '',
        state: '',
        zip: '',
        defaultPaymentTerm: 'NET_30',
        creditLimit: '',
        taxExempt: false,
        taxId: '',
        notes: '',
      })
      setShowAddModal(false)
      setRefreshKey(prev => prev + 1)
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setSubmitting(false)
    }
  }

  const handleCreateDivision = async (e: React.FormEvent) => {
    e.preventDefault()
    setDivisionFormError(null)

    // Validation
    if (!divisionFormData.name.trim()) {
      setDivisionFormError('Division name is required')
      return
    }

    if (!selectedOrgForDivision) {
      setDivisionFormError('Organization not selected')
      return
    }

    try {
      setSubmitting(true)
      const payload = {
        ...divisionFormData,
        code: divisionFormData.code.toUpperCase(),
        organizationId: selectedOrgForDivision,
      }

      const response = await fetch('/api/ops/divisions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.message || 'Failed to create division')
      }

      // Reset form and close modal
      setDivisionFormData({
        name: '',
        code: '',
        region: '',
        contactName: '',
        email: '',
        phone: '',
        city: '',
        state: '',
        zip: '',
        notes: '',
      })
      setShowAddDivisionModal(false)
      setSelectedOrgForDivision(null)
      setRefreshKey(prev => prev + 1)
    } catch (err) {
      setDivisionFormError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <div style={{ padding: '32px', maxWidth: '1400px', margin: '0 auto' }}>
        <h1 style={{ fontSize: '28px', fontWeight: 700, color: '#3E2A1E', marginBottom: '8px' }}>
          Organizations
        </h1>
        <p style={{ fontSize: '16px', color: '#6b7280', marginBottom: '24px' }}>
          Manage builder organizations and company accounts
        </p>
        <div style={{ textAlign: 'center', padding: '60px 32px' }}>
          <div style={{
            display: 'inline-block',
            width: '40px',
            height: '40px',
            border: '4px solid #e5e7eb',
            borderTop: '4px solid #3E2A1E',
            borderRadius: '50%',
            animation: 'spin 1s linear infinite',
          }} />
          <p style={{ fontSize: '16px', color: '#6b7280', marginTop: '16px' }}>Loading organizations...</p>
          <style>{`
            @keyframes spin {
              0% { transform: rotate(0deg); }
              100% { transform: rotate(360deg); }
            }
          `}</style>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div style={{ padding: '32px', maxWidth: '1400px', margin: '0 auto' }}>
        <h1 style={{ fontSize: '28px', fontWeight: 700, color: '#3E2A1E', marginBottom: '8px' }}>
          Organizations
        </h1>
        <div style={{
          backgroundColor: '#fee',
          border: '1px solid #fcc',
          borderRadius: '8px',
          padding: '16px',
          color: '#c33',
          marginTop: '20px',
        }}>
          <p style={{ fontWeight: 600, marginBottom: '8px' }}>Error loading organizations</p>
          <p style={{ fontSize: '14px' }}>{error}</p>
        </div>
      </div>
    )
  }

  return (
    <div style={{ padding: '32px', maxWidth: '1400px', margin: '0 auto' }}>
      {/* Header */}
      <div style={{ marginBottom: '32px' }}>
        <h1 style={{ fontSize: '28px', fontWeight: 700, color: '#3E2A1E', marginBottom: '8px' }}>
          Organizations
        </h1>
        <p style={{ fontSize: '16px', color: '#6b7280', marginBottom: '24px' }}>
          Manage builder organizations and company accounts
        </p>

        {/* Search and Filters */}
        <div style={{ display: 'flex', gap: '12px', marginBottom: '24px', flexWrap: 'wrap' }}>
          <input
            type="text"
            placeholder="Search organizations, contacts, or phone..."
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
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            style={{
              padding: '12px 16px',
              borderRadius: '8px',
              border: '1px solid #d1d5db',
              fontSize: '14px',
              boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
              backgroundColor: 'white',
            }}
          >
            <option value="">All Types</option>
            {availableTypes.map(type => (
              <option key={type} value={type}>{type}</option>
            ))}
          </select>
          <button
            onClick={() => setShowAddModal(true)}
            style={{
              padding: '12px 24px',
              backgroundColor: '#3E2A1E',
              color: 'white',
              border: 'none',
              borderRadius: '8px',
              fontWeight: 600,
              fontSize: '14px',
              cursor: 'pointer',
              transition: 'all 0.2s',
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.backgroundColor = '#0f3453'
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.backgroundColor = '#3E2A1E'
            }}
          >
            + Add Organization
          </button>
        </div>
      </div>

      {/* Table */}
      {organizations.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px 32px', color: '#9ca3af' }}>
          <p style={{ fontSize: '48px', marginBottom: '12px' }}>🏢</p>
          <p style={{ fontSize: '16px', fontWeight: 500, marginBottom: '4px' }}>No organizations found</p>
          <p style={{ fontSize: '14px' }}>Try adjusting your search or filter criteria</p>
        </div>
      ) : (
        <div style={{ backgroundColor: 'white', borderRadius: '12px', border: '1px solid #e5e7eb', overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
          {/* Table Header */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: '40px 2fr 1fr 1.5fr 1.5fr 1.2fr',
            gap: '16px',
            padding: '16px 20px',
            backgroundColor: '#f9fafb',
            borderBottom: '1px solid #e5e7eb',
            fontWeight: 600,
            fontSize: '12px',
            color: '#6b7280',
            textTransform: 'uppercase',
            alignItems: 'center',
          }}>
            <div />
            <div>Organization Name</div>
            <div>Type</div>
            <div>Contact</div>
            <div>Phone</div>
            <div>Stats</div>
          </div>

          {/* Table Body */}
          {organizations.map((org, idx) => {
            const isExpanded = expandedRows.has(org.id)
            return (
              <div key={org.id}>
                {/* Main Row */}
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '40px 2fr 1fr 1.5fr 1.5fr 1.2fr',
                    gap: '16px',
                    padding: '16px 20px',
                    borderBottom: '1px solid #f3f4f6',
                    alignItems: 'center',
                    cursor: 'pointer',
                    transition: 'background-color 0.2s',
                    backgroundColor: isExpanded ? '#f9fafb' : 'white',
                  }}
                  onClick={() => toggleRowExpand(org.id)}
                  onMouseEnter={(e) => {
                    if (!isExpanded) {
                      (e.currentTarget as HTMLElement).style.backgroundColor = '#f9fafb'
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!isExpanded) {
                      (e.currentTarget as HTMLElement).style.backgroundColor = 'white'
                    }
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
                    <span style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      width: '24px',
                      height: '24px',
                      transition: 'transform 0.2s',
                      transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
                      color: '#6b7280',
                      fontSize: '16px',
                    }}>
                      ›
                    </span>
                  </div>
                  <div>
                    <p style={{ fontSize: '14px', fontWeight: 600, color: '#1f2937' }}>
                      {org.name}
                    </p>
                  </div>
                  <div>
                    <span
                      style={{
                        display: 'inline-block',
                        padding: '4px 12px',
                        backgroundColor: getTypeColor(org.type) + '20',
                        color: getTypeColor(org.type),
                        borderRadius: '6px',
                        fontSize: '12px',
                        fontWeight: 600,
                      }}
                    >
                      {org.type}
                    </span>
                  </div>
                  <div>
                    <p style={{ fontSize: '13px', color: '#6b7280' }}>
                      {org.contactName || 'N/A'}
                    </p>
                  </div>
                  <div>
                    <p style={{ fontSize: '13px', color: '#6b7280', fontFamily: 'monospace' }}>
                      {org.phone || 'N/A'}
                    </p>
                  </div>
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    {org._count.builders > 0 && (
                      <span style={{
                        display: 'inline-block',
                        padding: '3px 8px',
                        backgroundColor: '#C9822B20',
                        color: '#C9822B',
                        borderRadius: '4px',
                        fontSize: '11px',
                        fontWeight: 600,
                      }}>
                        {org._count.builders} builders
                      </span>
                    )}
                    {org._count.divisions > 0 && (
                      <span style={{
                        display: 'inline-block',
                        padding: '3px 8px',
                        backgroundColor: '#9333ea20',
                        color: '#9333ea',
                        borderRadius: '4px',
                        fontSize: '11px',
                        fontWeight: 600,
                      }}>
                        {org._count.divisions} divisions
                      </span>
                    )}
                    {org._count.communities > 0 && (
                      <span style={{
                        display: 'inline-block',
                        padding: '3px 8px',
                        backgroundColor: '#3E2A1E20',
                        color: '#3E2A1E',
                        borderRadius: '4px',
                        fontSize: '11px',
                        fontWeight: 600,
                      }}>
                        {org._count.communities} communities
                      </span>
                    )}
                    {org._count.contracts > 0 && (
                      <span style={{
                        display: 'inline-block',
                        padding: '3px 8px',
                        backgroundColor: '#27ae6020',
                        color: '#27ae60',
                        borderRadius: '4px',
                        fontSize: '11px',
                        fontWeight: 600,
                      }}>
                        {org._count.contracts} contracts
                      </span>
                    )}
                  </div>
                </div>

                {/* Expanded Details Row */}
                {isExpanded && (
                  <div style={{
                    padding: '20px',
                    backgroundColor: '#f9fafb',
                    borderBottom: idx < organizations.length - 1 ? '1px solid #f3f4f6' : 'none',
                    display: 'grid',
                    gridTemplateColumns: '1fr',
                    gap: '24px',
                  }}>
                    {/* Organization Details */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
                      <div>
                        <h4 style={{ fontSize: '12px', fontWeight: 700, color: '#6b7280', marginBottom: '12px', textTransform: 'uppercase' }}>
                          Organization Details
                        </h4>
                        <div style={{ display: 'grid', gap: '8px' }}>
                          <div>
                            <p style={{ fontSize: '11px', color: '#9ca3af', fontWeight: 500 }}>Code</p>
                            <p style={{ fontSize: '13px', color: '#1f2937', fontFamily: 'monospace' }}>{org.code || 'N/A'}</p>
                          </div>
                          <div>
                            <p style={{ fontSize: '11px', color: '#9ca3af', fontWeight: 500 }}>Email</p>
                            <p style={{ fontSize: '13px', color: '#1f2937' }}>{org.email || 'N/A'}</p>
                          </div>
                          <div>
                            <p style={{ fontSize: '11px', color: '#9ca3af', fontWeight: 500 }}>Address</p>
                            <p style={{ fontSize: '13px', color: '#1f2937' }}>
                              {[org.address, org.city, org.state, org.zip].filter(Boolean).join(', ') || 'N/A'}
                            </p>
                          </div>
                        </div>
                      </div>

                      {/* Communities */}
                      <div>
                        <h4 style={{ fontSize: '12px', fontWeight: 700, color: '#6b7280', marginBottom: '12px', textTransform: 'uppercase' }}>
                          Communities ({org.communities.length})
                        </h4>
                        {org.communities.length > 0 ? (
                          <div style={{ display: 'grid', gap: '8px' }}>
                            {org.communities.map(community => (
                              <div key={community.id} style={{
                                padding: '8px',
                                backgroundColor: 'white',
                                borderRadius: '6px',
                                border: '1px solid #e5e7eb',
                              }}>
                                <p style={{ fontSize: '13px', fontWeight: 500, color: '#1f2937', marginBottom: '4px' }}>
                                  {community.name}
                                </p>
                                <p style={{ fontSize: '12px', color: '#6b7280' }}>
                                  {community.activeLots} active lots
                                </p>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p style={{ fontSize: '13px', color: '#9ca3af' }}>No communities</p>
                        )}
                      </div>
                    </div>

                    {/* Divisions Section */}
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                        <h4 style={{ fontSize: '12px', fontWeight: 700, color: '#6b7280', margin: 0, textTransform: 'uppercase' }}>
                          Divisions ({org.divisions.length})
                        </h4>
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            setSelectedOrgForDivision(org.id)
                            setShowAddDivisionModal(true)
                          }}
                          style={{
                            padding: '6px 12px',
                            backgroundColor: '#9333ea',
                            color: 'white',
                            border: 'none',
                            borderRadius: '4px',
                            fontSize: '12px',
                            fontWeight: 600,
                            cursor: 'pointer',
                            transition: 'all 0.2s',
                          }}
                          onMouseEnter={(e) => {
                            (e.currentTarget as HTMLElement).style.backgroundColor = '#7e22ce'
                          }}
                          onMouseLeave={(e) => {
                            (e.currentTarget as HTMLElement).style.backgroundColor = '#9333ea'
                          }}
                        >
                          + Add Division
                        </button>
                      </div>
                      {org.divisions.length > 0 ? (
                        <div style={{
                          backgroundColor: 'white',
                          borderRadius: '8px',
                          border: '1px solid #e5e7eb',
                          overflow: 'hidden',
                        }}>
                          {/* Division Table Header */}
                          <div style={{
                            display: 'grid',
                            gridTemplateColumns: '1.2fr 0.8fr 1fr 1fr 0.8fr 0.8fr 0.6fr',
                            gap: '12px',
                            padding: '12px 16px',
                            backgroundColor: '#f3f4f6',
                            borderBottom: '1px solid #e5e7eb',
                            fontSize: '11px',
                            fontWeight: 600,
                            color: '#6b7280',
                            textTransform: 'uppercase',
                          }}>
                            <div>Name</div>
                            <div>Code</div>
                            <div>Region</div>
                            <div>Location</div>
                            <div>Communities</div>
                            <div>Builders</div>
                            <div>Status</div>
                          </div>
                          {/* Division Table Body */}
                          {org.divisions.map(division => (
                            <div
                              key={division.id}
                              style={{
                                display: 'grid',
                                gridTemplateColumns: '1.2fr 0.8fr 1fr 1fr 0.8fr 0.8fr 0.6fr',
                                gap: '12px',
                                padding: '12px 16px',
                                borderBottom: '1px solid #f3f4f6',
                                alignItems: 'center',
                                fontSize: '13px',
                              }}
                            >
                              <div style={{ fontWeight: 500, color: '#1f2937' }}>
                                {division.name}
                              </div>
                              <div style={{ fontFamily: 'monospace', color: '#6b7280', fontSize: '12px' }}>
                                {division.code}
                              </div>
                              <div style={{ color: '#6b7280', fontSize: '12px' }}>
                                {division.region || 'N/A'}
                              </div>
                              <div style={{ color: '#6b7280', fontSize: '12px' }}>
                                {division.city && division.state ? `${division.city}, ${division.state}` : 'N/A'}
                              </div>
                              <div style={{
                                display: 'inline-block',
                                padding: '3px 8px',
                                backgroundColor: '#3E2A1E20',
                                color: '#3E2A1E',
                                borderRadius: '4px',
                                fontSize: '11px',
                                fontWeight: 600,
                                textAlign: 'center',
                              }}>
                                {division.communityCount}
                              </div>
                              <div style={{
                                display: 'inline-block',
                                padding: '3px 8px',
                                backgroundColor: '#C9822B20',
                                color: '#C9822B',
                                borderRadius: '4px',
                                fontSize: '11px',
                                fontWeight: 600,
                                textAlign: 'center',
                              }}>
                                {division.builderCount}
                              </div>
                              <div>
                                <span style={{
                                  display: 'inline-block',
                                  padding: '4px 8px',
                                  backgroundColor: division.active ? '#d1fae520' : '#f3f4f620',
                                  color: division.active ? '#059669' : '#9ca3af',
                                  borderRadius: '4px',
                                  fontSize: '11px',
                                  fontWeight: 600,
                                }}>
                                  {division.active ? 'Active' : 'Inactive'}
                                </span>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p style={{ fontSize: '13px', color: '#9ca3af' }}>No divisions</p>
                      )}
                    </div>

                    {/* Contracts */}
                    {org.contracts.length > 0 && (
                      <div style={{ gridColumn: '1 / -1' }}>
                        <h4 style={{ fontSize: '12px', fontWeight: 700, color: '#6b7280', marginBottom: '12px', textTransform: 'uppercase' }}>
                          Active Contracts ({org.contracts.length})
                        </h4>
                        <div style={{ display: 'grid', gap: '8px' }}>
                          {org.contracts.map(contract => (
                            <div key={contract.id} style={{
                              padding: '8px',
                              backgroundColor: 'white',
                              borderRadius: '6px',
                              border: '1px solid #e5e7eb',
                              display: 'grid',
                              gridTemplateColumns: '1fr auto',
                              gap: '12px',
                              alignItems: 'center',
                            }}>
                              <div>
                                <p style={{ fontSize: '13px', fontWeight: 500, color: '#1f2937', marginBottom: '4px' }}>
                                  {contract.title}
                                </p>
                                <p style={{ fontSize: '12px', color: '#6b7280' }}>
                                  {contract.contractNumber} • Expires {formatDate(contract.expirationDate)}
                                </p>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Quick Actions */}
                    <div style={{ gridColumn: '1 / -1', paddingTop: '16px', borderTop: '1px solid #e5e7eb', display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                      <Link
                        href={`/ops/accounts?org=${encodeURIComponent(org.name)}`}
                        onClick={(e) => e.stopPropagation()}
                        style={{
                          padding: '8px 16px',
                          backgroundColor: '#C9822B',
                          color: 'white',
                          borderRadius: '6px',
                          fontSize: '13px',
                          fontWeight: 600,
                          textDecoration: 'none',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '6px',
                        }}
                      >
                        👤 View Builder Accounts ({org._count.builders})
                      </Link>
                      <Link
                        href={`/ops/communities?org=${encodeURIComponent(org.name)}`}
                        onClick={(e) => e.stopPropagation()}
                        style={{
                          padding: '8px 16px',
                          backgroundColor: '#3E2A1E',
                          color: 'white',
                          borderRadius: '6px',
                          fontSize: '13px',
                          fontWeight: 600,
                          textDecoration: 'none',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '6px',
                        }}
                      >
                        🏘️ View Communities ({org._count.communities})
                      </Link>
                      <Link
                        href="/ops/contracts"
                        onClick={(e) => e.stopPropagation()}
                        style={{
                          padding: '8px 16px',
                          border: '1px solid #d1d5db',
                          backgroundColor: 'white',
                          color: '#374151',
                          borderRadius: '6px',
                          fontSize: '13px',
                          fontWeight: 600,
                          textDecoration: 'none',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '6px',
                        }}
                      >
                        📝 Contracts ({org._count.contracts})
                      </Link>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Add Division Modal */}
      {showAddDivisionModal && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.5)',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          zIndex: 1000,
        }}>
          <div style={{
            backgroundColor: 'white',
            borderRadius: '12px',
            boxShadow: '0 10px 40px rgba(0,0,0,0.2)',
            maxWidth: '720px',
            width: '90%',
            maxHeight: '90vh',
            overflow: 'auto',
          }}>
            {/* Modal Header */}
            <div style={{
              padding: '24px',
              borderBottom: '1px solid #e5e7eb',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}>
              <h2 style={{ fontSize: '20px', fontWeight: 700, color: '#3E2A1E', margin: 0 }}>
                Add Division
              </h2>
              <button
                onClick={() => {
                  setShowAddDivisionModal(false)
                  setSelectedOrgForDivision(null)
                }}
                style={{
                  background: 'none',
                  border: 'none',
                  fontSize: '24px',
                  cursor: 'pointer',
                  color: '#6b7280',
                }}
              >
                ×
              </button>
            </div>

            {/* Modal Body */}
            <form onSubmit={handleCreateDivision} style={{ padding: '24px' }}>
              {divisionFormError && (
                <div style={{
                  backgroundColor: '#fee',
                  border: '1px solid #fcc',
                  borderRadius: '8px',
                  padding: '12px 16px',
                  color: '#c33',
                  marginBottom: '20px',
                  fontSize: '14px',
                  fontWeight: 500,
                }}>
                  {divisionFormError}
                </div>
              )}

              <div style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: '20px',
                marginBottom: '20px',
              }}>
                {/* Left Column */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  {/* Name */}
                  <div>
                    <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#374151', marginBottom: '6px' }}>
                      Division Name <span style={{ color: '#ef4444' }}>*</span>
                    </label>
                    <input
                      type="text"
                      required
                      value={divisionFormData.name}
                      onChange={(e) => setDivisionFormData({ ...divisionFormData, name: e.target.value })}
                      style={{
                        width: '100%',
                        padding: '10px 12px',
                        border: '1px solid #d1d5db',
                        borderRadius: '6px',
                        fontSize: '14px',
                        boxSizing: 'border-box',
                      }}
                      placeholder="Enter division name"
                    />
                  </div>

                  {/* Code */}
                  <div>
                    <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#374151', marginBottom: '6px' }}>
                      Code
                    </label>
                    <input
                      type="text"
                      value={divisionFormData.code}
                      onChange={(e) => setDivisionFormData({ ...divisionFormData, code: e.target.value.toUpperCase() })}
                      style={{
                        width: '100%',
                        padding: '10px 12px',
                        border: '1px solid #d1d5db',
                        borderRadius: '6px',
                        fontSize: '14px',
                        boxSizing: 'border-box',
                      }}
                      placeholder="Division code (auto-uppercased)"
                    />
                  </div>

                  {/* Region */}
                  <div>
                    <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#374151', marginBottom: '6px' }}>
                      Region
                    </label>
                    <input
                      type="text"
                      value={divisionFormData.region}
                      onChange={(e) => setDivisionFormData({ ...divisionFormData, region: e.target.value })}
                      style={{
                        width: '100%',
                        padding: '10px 12px',
                        border: '1px solid #d1d5db',
                        borderRadius: '6px',
                        fontSize: '14px',
                        boxSizing: 'border-box',
                      }}
                      placeholder="Region (e.g., Northeast, West Coast)"
                    />
                  </div>

                  {/* Contact Name */}
                  <div>
                    <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#374151', marginBottom: '6px' }}>
                      Contact Name
                    </label>
                    <input
                      type="text"
                      value={divisionFormData.contactName}
                      onChange={(e) => setDivisionFormData({ ...divisionFormData, contactName: e.target.value })}
                      style={{
                        width: '100%',
                        padding: '10px 12px',
                        border: '1px solid #d1d5db',
                        borderRadius: '6px',
                        fontSize: '14px',
                        boxSizing: 'border-box',
                      }}
                      placeholder="Contact name"
                    />
                  </div>

                  {/* Email */}
                  <div>
                    <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#374151', marginBottom: '6px' }}>
                      Email
                    </label>
                    <input
                      type="email"
                      value={divisionFormData.email}
                      onChange={(e) => setDivisionFormData({ ...divisionFormData, email: e.target.value })}
                      style={{
                        width: '100%',
                        padding: '10px 12px',
                        border: '1px solid #d1d5db',
                        borderRadius: '6px',
                        fontSize: '14px',
                        boxSizing: 'border-box',
                      }}
                      placeholder="Email address"
                    />
                  </div>

                  {/* Phone */}
                  <div>
                    <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#374151', marginBottom: '6px' }}>
                      Phone
                    </label>
                    <input
                      type="tel"
                      value={divisionFormData.phone}
                      onChange={(e) => setDivisionFormData({ ...divisionFormData, phone: e.target.value })}
                      style={{
                        width: '100%',
                        padding: '10px 12px',
                        border: '1px solid #d1d5db',
                        borderRadius: '6px',
                        fontSize: '14px',
                        boxSizing: 'border-box',
                      }}
                      placeholder="Phone number"
                    />
                  </div>
                </div>

                {/* Right Column */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  {/* City */}
                  <div>
                    <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#374151', marginBottom: '6px' }}>
                      City
                    </label>
                    <input
                      type="text"
                      value={divisionFormData.city}
                      onChange={(e) => setDivisionFormData({ ...divisionFormData, city: e.target.value })}
                      style={{
                        width: '100%',
                        padding: '10px 12px',
                        border: '1px solid #d1d5db',
                        borderRadius: '6px',
                        fontSize: '14px',
                        boxSizing: 'border-box',
                      }}
                      placeholder="City"
                    />
                  </div>

                  {/* State */}
                  <div>
                    <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#374151', marginBottom: '6px' }}>
                      State
                    </label>
                    <input
                      type="text"
                      value={divisionFormData.state}
                      onChange={(e) => setDivisionFormData({ ...divisionFormData, state: e.target.value })}
                      style={{
                        width: '100%',
                        padding: '10px 12px',
                        border: '1px solid #d1d5db',
                        borderRadius: '6px',
                        fontSize: '14px',
                        boxSizing: 'border-box',
                      }}
                      placeholder="State"
                    />
                  </div>

                  {/* Zip */}
                  <div>
                    <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#374151', marginBottom: '6px' }}>
                      Zip
                    </label>
                    <input
                      type="text"
                      value={divisionFormData.zip}
                      onChange={(e) => setDivisionFormData({ ...divisionFormData, zip: e.target.value })}
                      style={{
                        width: '100%',
                        padding: '10px 12px',
                        border: '1px solid #d1d5db',
                        borderRadius: '6px',
                        fontSize: '14px',
                        boxSizing: 'border-box',
                      }}
                      placeholder="Zip code"
                    />
                  </div>

                  {/* Notes */}
                  <div>
                    <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#374151', marginBottom: '6px' }}>
                      Notes
                    </label>
                    <textarea
                      value={divisionFormData.notes}
                      onChange={(e) => setDivisionFormData({ ...divisionFormData, notes: e.target.value })}
                      style={{
                        width: '100%',
                        padding: '10px 12px',
                        border: '1px solid #d1d5db',
                        borderRadius: '6px',
                        fontSize: '14px',
                        boxSizing: 'border-box',
                        minHeight: '80px',
                        fontFamily: 'inherit',
                      }}
                      placeholder="Additional notes"
                    />
                  </div>
                </div>
              </div>

              {/* Modal Footer */}
              <div style={{
                display: 'flex',
                justifyContent: 'flex-end',
                gap: '12px',
                borderTop: '1px solid #e5e7eb',
                paddingTop: '20px',
              }}>
                <button
                  type="button"
                  onClick={() => {
                    setShowAddDivisionModal(false)
                    setSelectedOrgForDivision(null)
                  }}
                  style={{
                    padding: '10px 24px',
                    backgroundColor: '#f3f4f6',
                    color: '#374151',
                    border: '1px solid #d1d5db',
                    borderRadius: '6px',
                    fontWeight: 600,
                    fontSize: '14px',
                    cursor: 'pointer',
                    transition: 'all 0.2s',
                  }}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLElement).style.backgroundColor = '#e5e7eb'
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLElement).style.backgroundColor = '#f3f4f6'
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  style={{
                    padding: '10px 24px',
                    backgroundColor: submitting ? '#9ca3af' : '#9333ea',
                    color: 'white',
                    border: 'none',
                    borderRadius: '6px',
                    fontWeight: 600,
                    fontSize: '14px',
                    cursor: submitting ? 'not-allowed' : 'pointer',
                    transition: 'all 0.2s',
                  }}
                  onMouseEnter={(e) => {
                    if (!submitting) {
                      (e.currentTarget as HTMLElement).style.backgroundColor = '#7e22ce'
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!submitting) {
                      (e.currentTarget as HTMLElement).style.backgroundColor = '#9333ea'
                    }
                  }}
                >
                  {submitting ? 'Creating...' : 'Create Division'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add Organization Modal */}
      {showAddModal && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.5)',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          zIndex: 1000,
        }}>
          <div style={{
            backgroundColor: 'white',
            borderRadius: '12px',
            boxShadow: '0 10px 40px rgba(0,0,0,0.2)',
            maxWidth: '720px',
            width: '90%',
            maxHeight: '90vh',
            overflow: 'auto',
          }}>
            {/* Modal Header */}
            <div style={{
              padding: '24px',
              borderBottom: '1px solid #e5e7eb',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}>
              <h2 style={{ fontSize: '20px', fontWeight: 700, color: '#3E2A1E', margin: 0 }}>
                Add Organization
              </h2>
              <button
                onClick={() => setShowAddModal(false)}
                style={{
                  background: 'none',
                  border: 'none',
                  fontSize: '24px',
                  cursor: 'pointer',
                  color: '#6b7280',
                }}
              >
                ×
              </button>
            </div>

            {/* Modal Body */}
            <form onSubmit={handleCreateOrg} style={{ padding: '24px' }}>
              {formError && (
                <div style={{
                  backgroundColor: '#fee',
                  border: '1px solid #fcc',
                  borderRadius: '8px',
                  padding: '12px 16px',
                  color: '#c33',
                  marginBottom: '20px',
                  fontSize: '14px',
                  fontWeight: 500,
                }}>
                  {formError}
                </div>
              )}

              <div style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: '20px',
                marginBottom: '20px',
              }}>
                {/* Left Column */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  {/* Name */}
                  <div>
                    <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#374151', marginBottom: '6px' }}>
                      Organization Name <span style={{ color: '#ef4444' }}>*</span>
                    </label>
                    <input
                      type="text"
                      required
                      value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      style={{
                        width: '100%',
                        padding: '10px 12px',
                        border: '1px solid #d1d5db',
                        borderRadius: '6px',
                        fontSize: '14px',
                        boxSizing: 'border-box',
                      }}
                      placeholder="Enter organization name"
                    />
                  </div>

                  {/* Code */}
                  <div>
                    <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#374151', marginBottom: '6px' }}>
                      Code <span style={{ color: '#ef4444' }}>*</span>
                    </label>
                    <input
                      type="text"
                      required
                      value={formData.code}
                      onChange={(e) => setFormData({ ...formData, code: e.target.value.toUpperCase() })}
                      style={{
                        width: '100%',
                        padding: '10px 12px',
                        border: '1px solid #d1d5db',
                        borderRadius: '6px',
                        fontSize: '14px',
                        boxSizing: 'border-box',
                      }}
                      placeholder="Enter code (auto-uppercased)"
                    />
                  </div>

                  {/* Type */}
                  <div>
                    <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#374151', marginBottom: '6px' }}>
                      Type
                    </label>
                    <select
                      value={formData.type}
                      onChange={(e) => setFormData({ ...formData, type: e.target.value })}
                      style={{
                        width: '100%',
                        padding: '10px 12px',
                        border: '1px solid #d1d5db',
                        borderRadius: '6px',
                        fontSize: '14px',
                        boxSizing: 'border-box',
                        backgroundColor: 'white',
                      }}
                    >
                      <option value="NATIONAL">NATIONAL</option>
                      <option value="REGIONAL">REGIONAL</option>
                      <option value="LOCAL">LOCAL</option>
                      <option value="CUSTOM">CUSTOM</option>
                    </select>
                  </div>

                  {/* Contact Name */}
                  <div>
                    <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#374151', marginBottom: '6px' }}>
                      Contact Name
                    </label>
                    <input
                      type="text"
                      value={formData.contactName}
                      onChange={(e) => setFormData({ ...formData, contactName: e.target.value })}
                      style={{
                        width: '100%',
                        padding: '10px 12px',
                        border: '1px solid #d1d5db',
                        borderRadius: '6px',
                        fontSize: '14px',
                        boxSizing: 'border-box',
                      }}
                      placeholder="Contact name"
                    />
                  </div>

                  {/* Email */}
                  <div>
                    <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#374151', marginBottom: '6px' }}>
                      Email
                    </label>
                    <input
                      type="email"
                      value={formData.email}
                      onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                      style={{
                        width: '100%',
                        padding: '10px 12px',
                        border: '1px solid #d1d5db',
                        borderRadius: '6px',
                        fontSize: '14px',
                        boxSizing: 'border-box',
                      }}
                      placeholder="Email address"
                    />
                  </div>

                  {/* Phone */}
                  <div>
                    <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#374151', marginBottom: '6px' }}>
                      Phone
                    </label>
                    <input
                      type="tel"
                      value={formData.phone}
                      onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                      style={{
                        width: '100%',
                        padding: '10px 12px',
                        border: '1px solid #d1d5db',
                        borderRadius: '6px',
                        fontSize: '14px',
                        boxSizing: 'border-box',
                      }}
                      placeholder="Phone number"
                    />
                  </div>
                </div>

                {/* Right Column */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  {/* Address */}
                  <div>
                    <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#374151', marginBottom: '6px' }}>
                      Address
                    </label>
                    <input
                      type="text"
                      value={formData.address}
                      onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                      style={{
                        width: '100%',
                        padding: '10px 12px',
                        border: '1px solid #d1d5db',
                        borderRadius: '6px',
                        fontSize: '14px',
                        boxSizing: 'border-box',
                      }}
                      placeholder="Street address"
                    />
                  </div>

                  {/* City */}
                  <div>
                    <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#374151', marginBottom: '6px' }}>
                      City
                    </label>
                    <input
                      type="text"
                      value={formData.city}
                      onChange={(e) => setFormData({ ...formData, city: e.target.value })}
                      style={{
                        width: '100%',
                        padding: '10px 12px',
                        border: '1px solid #d1d5db',
                        borderRadius: '6px',
                        fontSize: '14px',
                        boxSizing: 'border-box',
                      }}
                      placeholder="City"
                    />
                  </div>

                  {/* State */}
                  <div>
                    <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#374151', marginBottom: '6px' }}>
                      State
                    </label>
                    <input
                      type="text"
                      value={formData.state}
                      onChange={(e) => setFormData({ ...formData, state: e.target.value })}
                      style={{
                        width: '100%',
                        padding: '10px 12px',
                        border: '1px solid #d1d5db',
                        borderRadius: '6px',
                        fontSize: '14px',
                        boxSizing: 'border-box',
                      }}
                      placeholder="State"
                    />
                  </div>

                  {/* Zip */}
                  <div>
                    <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#374151', marginBottom: '6px' }}>
                      Zip
                    </label>
                    <input
                      type="text"
                      value={formData.zip}
                      onChange={(e) => setFormData({ ...formData, zip: e.target.value })}
                      style={{
                        width: '100%',
                        padding: '10px 12px',
                        border: '1px solid #d1d5db',
                        borderRadius: '6px',
                        fontSize: '14px',
                        boxSizing: 'border-box',
                      }}
                      placeholder="Zip code"
                    />
                  </div>

                  {/* Payment Term */}
                  <div>
                    <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#374151', marginBottom: '6px' }}>
                      Default Payment Term
                    </label>
                    <select
                      value={formData.defaultPaymentTerm}
                      onChange={(e) => setFormData({ ...formData, defaultPaymentTerm: e.target.value })}
                      style={{
                        width: '100%',
                        padding: '10px 12px',
                        border: '1px solid #d1d5db',
                        borderRadius: '6px',
                        fontSize: '14px',
                        boxSizing: 'border-box',
                        backgroundColor: 'white',
                      }}
                    >
                      <option value="NET_30">NET 30</option>
                      <option value="NET_45">NET 45</option>
                      <option value="NET_60">NET 60</option>
                      <option value="NET_90">NET 90</option>
                      <option value="DUE_ON_RECEIPT">DUE ON RECEIPT</option>
                    </select>
                  </div>

                  {/* Credit Limit */}
                  <div>
                    <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#374151', marginBottom: '6px' }}>
                      Credit Limit
                    </label>
                    <input
                      type="number"
                      value={formData.creditLimit}
                      onChange={(e) => setFormData({ ...formData, creditLimit: e.target.value })}
                      style={{
                        width: '100%',
                        padding: '10px 12px',
                        border: '1px solid #d1d5db',
                        borderRadius: '6px',
                        fontSize: '14px',
                        boxSizing: 'border-box',
                      }}
                      placeholder="Credit limit amount"
                    />
                  </div>

                  {/* Tax Exempt */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <input
                      type="checkbox"
                      id="taxExempt"
                      checked={formData.taxExempt}
                      onChange={(e) => setFormData({ ...formData, taxExempt: e.target.checked })}
                      style={{
                        width: '16px',
                        height: '16px',
                        cursor: 'pointer',
                      }}
                    />
                    <label htmlFor="taxExempt" style={{ fontSize: '13px', fontWeight: 600, color: '#374151', margin: 0, cursor: 'pointer' }}>
                      Tax Exempt
                    </label>
                  </div>

                  {/* Tax ID */}
                  <div>
                    <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#374151', marginBottom: '6px' }}>
                      Tax ID
                    </label>
                    <input
                      type="text"
                      value={formData.taxId}
                      onChange={(e) => setFormData({ ...formData, taxId: e.target.value })}
                      style={{
                        width: '100%',
                        padding: '10px 12px',
                        border: '1px solid #d1d5db',
                        borderRadius: '6px',
                        fontSize: '14px',
                        boxSizing: 'border-box',
                      }}
                      placeholder="Tax ID"
                    />
                  </div>
                </div>
              </div>

              {/* Notes - Full Width */}
              <div style={{ marginBottom: '24px' }}>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#374151', marginBottom: '6px' }}>
                  Notes
                </label>
                <textarea
                  value={formData.notes}
                  onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    border: '1px solid #d1d5db',
                    borderRadius: '6px',
                    fontSize: '14px',
                    boxSizing: 'border-box',
                    minHeight: '80px',
                    fontFamily: 'inherit',
                  }}
                  placeholder="Additional notes"
                />
              </div>

              {/* Modal Footer */}
              <div style={{
                display: 'flex',
                justifyContent: 'flex-end',
                gap: '12px',
                borderTop: '1px solid #e5e7eb',
                paddingTop: '20px',
              }}>
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  style={{
                    padding: '10px 24px',
                    backgroundColor: '#f3f4f6',
                    color: '#374151',
                    border: '1px solid #d1d5db',
                    borderRadius: '6px',
                    fontWeight: 600,
                    fontSize: '14px',
                    cursor: 'pointer',
                    transition: 'all 0.2s',
                  }}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLElement).style.backgroundColor = '#e5e7eb'
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLElement).style.backgroundColor = '#f3f4f6'
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  style={{
                    padding: '10px 24px',
                    backgroundColor: submitting ? '#9ca3af' : '#3E2A1E',
                    color: 'white',
                    border: 'none',
                    borderRadius: '6px',
                    fontWeight: 600,
                    fontSize: '14px',
                    cursor: submitting ? 'not-allowed' : 'pointer',
                    transition: 'all 0.2s',
                  }}
                  onMouseEnter={(e) => {
                    if (!submitting) {
                      (e.currentTarget as HTMLElement).style.backgroundColor = '#0f3453'
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!submitting) {
                      (e.currentTarget as HTMLElement).style.backgroundColor = '#3E2A1E'
                    }
                  }}
                >
                  {submitting ? 'Creating...' : 'Create Organization'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
