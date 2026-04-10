'use client'

import { useState, useEffect } from 'react'

interface Inquiry {
  id: string
  inquiryNumber: string
  contactName: string
  companyName?: string
  email: string
  phone?: string
  projectType?: string
  projectCity?: string
  projectState?: string
  scopeNotes?: string
  status: string
  priority: string
  assignedTo?: { id: string; firstName: string; lastName: string; role: string }
  aiEstimatedValue?: number
  aiComplexity?: string
  createdAt: string
}

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  NEW: { label: 'New', color: '#3B82F6', bg: '#EFF6FF' },
  REVIEWING: { label: 'Reviewing', color: '#F59E0B', bg: '#FFFBEB' },
  ASSIGNED: { label: 'Assigned', color: '#8B5CF6', bg: '#F5F3FF' },
  TAKEOFF_IN_PROGRESS: { label: 'Takeoff Running', color: '#E67E22', bg: '#FFF7ED' },
  TAKEOFF_COMPLETE: { label: 'Takeoff Done', color: '#10B981', bg: '#ECFDF5' },
  QUOTE_SENT: { label: 'Quote Sent', color: '#1B4F72', bg: '#EBF5FB' },
  CONVERTED: { label: 'Converted', color: '#059669', bg: '#D1FAE5' },
  DECLINED: { label: 'Declined', color: '#EF4444', bg: '#FEF2F2' },
  STALE: { label: 'Stale', color: '#9CA3AF', bg: '#F3F4F6' },
}

const PRIORITY_CONFIG: Record<string, { label: string; color: string }> = {
  LOW: { label: 'Low', color: '#9CA3AF' },
  NORMAL: { label: 'Normal', color: '#3B82F6' },
  HIGH: { label: 'High', color: '#F59E0B' },
  URGENT: { label: 'Urgent', color: '#EF4444' },
}

export default function TakeoffInquiriesPage() {
  const [inquiries, setInquiries] = useState<Inquiry[]>([])
  const [statusCounts, setStatusCounts] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('')
  const [staff, setStaff] = useState<any[]>([])
  const [assigning, setAssigning] = useState<string | null>(null)

  useEffect(() => {
    fetchInquiries()
    fetchStaff()
  }, [filter])

  async function fetchInquiries() {
    try {
      const params = filter ? `?status=${filter}` : ''
      const res = await fetch(`/api/ops/takeoff-inquiries${params}`)
      const data = await res.json()
      setInquiries(data.inquiries || [])
      setStatusCounts(data.statusCounts || {})
    } catch (err) {
      console.error('Failed to fetch inquiries:', err)
    } finally {
      setLoading(false)
    }
  }

  async function fetchStaff() {
    try {
      const res = await fetch('/api/ops/staff')
      const data = await res.json()
      setStaff(data.staff || [])
    } catch {}
  }

  async function assignInquiry(id: string, staffId: string) {
    try {
      await fetch('/api/ops/takeoff-inquiries', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, assignedToId: staffId }),
      })
      setAssigning(null)
      fetchInquiries()
    } catch (err) {
      console.error('Assign error:', err)
    }
  }

  async function updateStatus(id: string, status: string) {
    try {
      await fetch('/api/ops/takeoff-inquiries', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status }),
      })
      fetchInquiries()
    } catch (err) {
      console.error('Status update error:', err)
    }
  }

  const totalNew = statusCounts['NEW'] || 0
  const totalActive = Object.entries(statusCounts)
    .filter(([k]) => !['CONVERTED', 'DECLINED', 'STALE'].includes(k))
    .reduce((sum, [, v]) => sum + v, 0)

  return (
    <div style={{ padding: 32, maxWidth: 1200 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: '#1f2937' }}>
            Takeoff Inquiries
            {totalNew > 0 && (
              <span style={{
                marginLeft: 8,
                padding: '2px 10px',
                borderRadius: 20,
                backgroundColor: '#EF4444',
                color: 'white',
                fontSize: 13,
                fontWeight: 600,
              }}>
                {totalNew} new
              </span>
            )}
          </h1>
          <p style={{ fontSize: 14, color: '#6b7280', marginTop: 4 }}>
            AI takeoff requests from new and existing builders — assign, process, and convert
          </p>
        </div>
        <div style={{ textAlign: 'right' }}>
          <p style={{ fontSize: 24, fontWeight: 700, color: '#1B4F72' }}>{totalActive}</p>
          <p style={{ fontSize: 11, color: '#9ca3af' }}>Active Inquiries</p>
        </div>
      </div>

      {/* Status Filter Pills */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 20, flexWrap: 'wrap' }}>
        <button
          onClick={() => setFilter('')}
          style={{
            padding: '6px 14px',
            borderRadius: 20,
            border: 'none',
            backgroundColor: !filter ? '#1B4F72' : '#f3f4f6',
            color: !filter ? 'white' : '#374151',
            fontSize: 12,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          All ({Object.values(statusCounts).reduce((a, b) => a + b, 0)})
        </button>
        {Object.entries(STATUS_CONFIG).map(([key, cfg]) => (
          <button
            key={key}
            onClick={() => setFilter(filter === key ? '' : key)}
            style={{
              padding: '6px 14px',
              borderRadius: 20,
              border: 'none',
              backgroundColor: filter === key ? cfg.color : cfg.bg,
              color: filter === key ? 'white' : cfg.color,
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            {cfg.label} ({statusCounts[key] || 0})
          </button>
        ))}
      </div>

      {/* Inquiry Cards */}
      {loading ? (
        <p style={{ color: '#9ca3af', textAlign: 'center', padding: 40 }}>Loading inquiries...</p>
      ) : inquiries.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 60, color: '#9ca3af' }}>
          <p style={{ fontSize: 48 }}>📨</p>
          <p style={{ fontSize: 16, marginTop: 8 }}>No takeoff inquiries{filter ? ` with status "${STATUS_CONFIG[filter]?.label}"` : ''}</p>
          <p style={{ fontSize: 13 }}>Inquiries from AI takeoffs will appear here for assignment</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {inquiries.map(inquiry => {
            const statusCfg = STATUS_CONFIG[inquiry.status] || STATUS_CONFIG.NEW
            const priorityCfg = PRIORITY_CONFIG[inquiry.priority] || PRIORITY_CONFIG.NORMAL

            return (
              <div key={inquiry.id} style={{
                padding: 20,
                backgroundColor: 'white',
                borderRadius: 12,
                border: '1px solid #e5e7eb',
                borderLeft: `4px solid ${priorityCfg.color}`,
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontFamily: 'monospace', fontSize: 12, color: '#9ca3af' }}>{inquiry.inquiryNumber}</span>
                      <span style={{
                        padding: '2px 8px',
                        borderRadius: 12,
                        backgroundColor: statusCfg.bg,
                        color: statusCfg.color,
                        fontSize: 11,
                        fontWeight: 600,
                      }}>
                        {statusCfg.label}
                      </span>
                      <span style={{
                        padding: '2px 8px',
                        borderRadius: 12,
                        backgroundColor: priorityCfg.color + '15',
                        color: priorityCfg.color,
                        fontSize: 11,
                        fontWeight: 600,
                      }}>
                        {priorityCfg.label}
                      </span>
                    </div>
                    <h3 style={{ fontSize: 15, fontWeight: 600, color: '#1f2937', marginTop: 6 }}>
                      {inquiry.contactName}
                      {inquiry.companyName && <span style={{ color: '#6b7280', fontWeight: 400 }}> — {inquiry.companyName}</span>}
                    </h3>
                    <p style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>
                      {inquiry.email}{inquiry.phone ? ` · ${inquiry.phone}` : ''}
                      {inquiry.projectCity ? ` · ${inquiry.projectCity}, ${inquiry.projectState}` : ''}
                      {inquiry.projectType ? ` · ${inquiry.projectType}` : ''}
                    </p>
                    {inquiry.scopeNotes && (
                      <p style={{ fontSize: 13, color: '#374151', marginTop: 6, fontStyle: 'italic' }}>
                        "{inquiry.scopeNotes.length > 150 ? inquiry.scopeNotes.substring(0, 150) + '...' : inquiry.scopeNotes}"
                      </p>
                    )}
                  </div>
                  <div style={{ textAlign: 'right', minWidth: 120 }}>
                    {inquiry.assignedTo ? (
                      <span style={{ fontSize: 12, color: '#6b7280' }}>
                        Assigned to <strong>{inquiry.assignedTo.firstName} {inquiry.assignedTo.lastName}</strong>
                      </span>
                    ) : (
                      assigning === inquiry.id ? (
                        <select
                          autoFocus
                          onChange={e => { if (e.target.value) assignInquiry(inquiry.id, e.target.value) }}
                          onBlur={() => setAssigning(null)}
                          style={{ fontSize: 12, padding: '4px 8px', borderRadius: 4, border: '1px solid #d1d5db' }}
                        >
                          <option value="">Select staff...</option>
                          {staff.filter(s => ['ADMIN', 'MANAGER', 'PROJECT_MANAGER', 'ESTIMATOR', 'SALES_REP'].includes(s.role)).map(s => (
                            <option key={s.id} value={s.id}>{s.firstName} {s.lastName} ({s.role})</option>
                          ))}
                        </select>
                      ) : (
                        <button
                          onClick={() => setAssigning(inquiry.id)}
                          style={{ fontSize: 12, padding: '4px 12px', backgroundColor: '#E67E22', color: 'white', border: 'none', borderRadius: 4, cursor: 'pointer', fontWeight: 600 }}
                        >
                          Assign
                        </button>
                      )
                    )}
                    <p style={{ fontSize: 11, color: '#9ca3af', marginTop: 4 }}>
                      {new Date(inquiry.createdAt).toLocaleDateString()}
                    </p>
                    {inquiry.aiEstimatedValue && (
                      <p style={{ fontSize: 13, fontWeight: 600, color: '#27AE60', marginTop: 2 }}>
                        ~${inquiry.aiEstimatedValue.toLocaleString()}
                      </p>
                    )}
                  </div>
                </div>

                {/* Quick Actions */}
                {inquiry.status !== 'CONVERTED' && inquiry.status !== 'DECLINED' && (
                  <div style={{ display: 'flex', gap: 6, marginTop: 12, paddingTop: 12, borderTop: '1px solid #f3f4f6' }}>
                    {inquiry.status === 'NEW' && (
                      <button onClick={() => updateStatus(inquiry.id, 'REVIEWING')} style={actionBtnStyle}>Start Review</button>
                    )}
                    {inquiry.status === 'ASSIGNED' && (
                      <button onClick={() => updateStatus(inquiry.id, 'TAKEOFF_IN_PROGRESS')} style={actionBtnStyle}>Start Takeoff</button>
                    )}
                    {inquiry.status === 'TAKEOFF_COMPLETE' && (
                      <button onClick={() => updateStatus(inquiry.id, 'QUOTE_SENT')} style={actionBtnStyle}>Mark Quote Sent</button>
                    )}
                    {inquiry.status === 'QUOTE_SENT' && (
                      <button onClick={() => updateStatus(inquiry.id, 'CONVERTED')} style={{...actionBtnStyle, backgroundColor: '#27AE60', color: 'white'}}>Convert to Account</button>
                    )}
                    <button onClick={() => updateStatus(inquiry.id, 'DECLINED')} style={{...actionBtnStyle, color: '#EF4444'}}>Decline</button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

const actionBtnStyle: React.CSSProperties = {
  padding: '6px 14px',
  backgroundColor: '#f3f4f6',
  border: 'none',
  borderRadius: 6,
  fontSize: 12,
  fontWeight: 500,
  cursor: 'pointer',
  color: '#374151',
}
