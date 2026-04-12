'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useToast } from '@/contexts/ToastContext'

interface BuilderApplication {
  id: string
  referenceNumber: string
  companyName: string
  contactName: string
  contactEmail: string
  contactPhone: string | null
  address: string | null
  city: string | null
  state: string | null
  zip: string | null
  businessLicense: string | null
  taxId: string | null
  estimatedAnnualVolume: string | null
  referralSource: string | null
  notes: string | null
  status: string
  reviewedBy: string | null
  reviewNotes: string | null
  reviewedAt: string | null
  createdAt: string
}

export default function BuilderApplicationsPage() {
  const { addToast } = useToast()
  const [apps, setApps] = useState<BuilderApplication[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('PENDING_APPROVAL')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [actionId, setActionId] = useState<string | null>(null)
  const [reviewNotes, setReviewNotes] = useState('')
  const [showRejectModal, setShowRejectModal] = useState<string | null>(null)
  const [counts, setCounts] = useState({ pending: 0, approved: 0, rejected: 0 })

  useEffect(() => {
    loadApps()
    loadCounts()
  }, [filter])

  async function loadApps() {
    setLoading(true)
    try {
      const resp = await fetch(`/api/ops/builders/applications?status=${filter}&limit=50`)
      const data = await resp.json()
      setApps(data.applications || [])
    } catch (err) {
      console.error('Failed to load applications:', err)
    } finally {
      setLoading(false)
    }
  }

  async function loadCounts() {
    try {
      const [pending, approved, rejected] = await Promise.all([
        fetch('/api/ops/builders/applications?status=PENDING_APPROVAL&limit=1').then(r => r.json()),
        fetch('/api/ops/builders/applications?status=APPROVED&limit=1').then(r => r.json()),
        fetch('/api/ops/builders/applications?status=REJECTED&limit=1').then(r => r.json()),
      ])
      setCounts({
        pending: pending.pagination?.total || 0,
        approved: approved.pagination?.total || 0,
        rejected: rejected.pagination?.total || 0,
      })
    } catch (err) {
      console.error('Failed to load counts:', err)
    }
  }

  async function handleApprove(applicationId: string) {
    setActionId(applicationId)
    try {
      const resp = await fetch('/api/ops/builders/applications', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ applicationId, action: 'APPROVE', reviewNotes: reviewNotes || undefined }),
      })
      const data = await resp.json()
      if (resp.ok && data.success) {
        setApps(prev => prev.filter(a => a.id !== applicationId))
        setCounts(prev => ({ ...prev, pending: Math.max(0, prev.pending - 1), approved: prev.approved + 1 }))
        setExpandedId(null)
        setReviewNotes('')
        addToast({ type: 'info', title: 'Account Created', message: `Temp password: ${data.application?.tempPassword || 'AbelBuilder2026!'}`, duration: 10000 })
      } else {
        addToast({ type: 'error', title: 'Error', message: data.error || 'Failed to approve' })
      }
    } catch (err) {
      console.error('Approve error:', err)
      addToast({ type: 'error', title: 'Error', message: 'Failed to approve application' })
    } finally {
      setActionId(null)
    }
  }

  async function handleReject(applicationId: string) {
    if (!reviewNotes.trim()) {
      addToast({ type: 'warning', title: 'Validation Error', message: 'Please provide a reason for rejection' })
      return
    }
    setActionId(applicationId)
    try {
      const resp = await fetch('/api/ops/builders/applications', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ applicationId, action: 'REJECT', reviewNotes }),
      })
      const data = await resp.json()
      if (resp.ok && data.success) {
        setApps(prev => prev.filter(a => a.id !== applicationId))
        setCounts(prev => ({ ...prev, pending: Math.max(0, prev.pending - 1), rejected: prev.rejected + 1 }))
        setShowRejectModal(null)
        setReviewNotes('')
      } else {
        addToast({ type: 'error', title: 'Error', message: data.error || 'Failed to reject' })
      }
    } catch (err) {
      console.error('Reject error:', err)
    } finally {
      setActionId(null)
    }
  }

  function timeAgo(dateStr: string) {
    const diff = Date.now() - new Date(dateStr).getTime()
    const hrs = Math.floor(diff / 3600000)
    if (hrs < 1) return 'Just now'
    if (hrs < 24) return `${hrs}h ago`
    const days = Math.floor(diff / 86400000)
    if (days === 1) return 'Yesterday'
    if (days < 7) return `${days} days ago`
    return new Date(dateStr).toLocaleDateString()
  }

  function parseNotes(notes: string | null): Record<string, string> {
    if (!notes) return {}
    const parsed: Record<string, string> = {}
    notes.split('\n').forEach(line => {
      const idx = line.indexOf(':')
      if (idx > 0) {
        parsed[line.slice(0, idx).trim()] = line.slice(idx + 1).trim()
      }
    })
    return parsed
  }

  const statusColor = (s: string) => {
    if (s === 'PENDING_APPROVAL') return { bg: '#FEF3C7', text: '#92400E', label: 'Pending' }
    if (s === 'APPROVED') return { bg: '#D1FAE5', text: '#065F46', label: 'Approved' }
    if (s === 'REJECTED') return { bg: '#FEE2E2', text: '#991B1B', label: 'Rejected' }
    return { bg: '#F3F4F6', text: '#374151', label: s }
  }

  return (
    <div style={{ padding: 32, maxWidth: 1200, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: '#1f2937' }}>Builder Applications</h1>
          <p style={{ fontSize: 14, color: '#6b7280', marginTop: 4 }}>
            Review, approve, or decline new builder account requests
          </p>
        </div>
        <Link href="/apply" target="_blank" style={{
          padding: '8px 16px', borderRadius: 8, backgroundColor: '#E67E22', color: 'white',
          fontSize: 13, fontWeight: 600, textDecoration: 'none',
        }}>
          View Public Form
        </Link>
      </div>

      {/* Stats Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 24 }}>
        {[
          { label: 'Pending Review', count: counts.pending, color: '#F59E0B', filterVal: 'PENDING_APPROVAL' },
          { label: 'Approved', count: counts.approved, color: '#10B981', filterVal: 'APPROVED' },
          { label: 'Rejected', count: counts.rejected, color: '#EF4444', filterVal: 'REJECTED' },
        ].map(stat => (
          <button
            key={stat.filterVal}
            onClick={() => setFilter(stat.filterVal)}
            style={{
              padding: 20, borderRadius: 12, border: filter === stat.filterVal ? `2px solid ${stat.color}` : '1px solid #e5e7eb',
              backgroundColor: 'white', textAlign: 'left', cursor: 'pointer',
            }}
          >
            <p style={{ fontSize: 30, fontWeight: 700, color: stat.color }}>{stat.count}</p>
            <p style={{ fontSize: 13, color: '#6b7280', marginTop: 2 }}>{stat.label}</p>
          </button>
        ))}
      </div>

      {/* Application List */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: 60, color: '#9ca3af' }}>Loading...</div>
      ) : apps.length === 0 ? (
        <div style={{
          textAlign: 'center', padding: 60, backgroundColor: 'white',
          borderRadius: 12, border: '1px solid #e5e7eb',
        }}>
          <p style={{ fontSize: 48, marginBottom: 8 }}>
            {filter === 'PENDING_APPROVAL' ? '✅' : filter === 'APPROVED' ? '🎉' : '📋'}
          </p>
          <p style={{ fontSize: 18, fontWeight: 600, color: '#1f2937' }}>
            {filter === 'PENDING_APPROVAL' ? 'No pending applications' : `No ${filter.toLowerCase()} applications`}
          </p>
          <p style={{ fontSize: 14, color: '#6b7280', marginTop: 4 }}>
            {filter === 'PENDING_APPROVAL'
              ? 'All applications have been reviewed'
              : 'No applications match this filter'}
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {apps.map(app => {
            const sc = statusColor(app.status)
            const notes = parseNotes(app.notes)
            const isExpanded = expandedId === app.id

            return (
              <div key={app.id} style={{
                backgroundColor: 'white', borderRadius: 12, border: '1px solid #e5e7eb',
                overflow: 'hidden',
              }}>
                {/* Header Row */}
                <div
                  style={{
                    padding: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    cursor: 'pointer',
                  }}
                  onClick={() => setExpandedId(isExpanded ? null : app.id)}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 16, flex: 1 }}>
                    <div style={{
                      width: 44, height: 44, borderRadius: '50%', backgroundColor: '#1B4F72', color: 'white',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontWeight: 700, fontSize: 18, flexShrink: 0,
                    }}>
                      {app.companyName.charAt(0)}
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <h3 style={{ fontSize: 16, fontWeight: 700, color: '#1f2937' }}>{app.companyName}</h3>
                        <span style={{
                          padding: '2px 10px', borderRadius: 99, fontSize: 11, fontWeight: 600,
                          backgroundColor: sc.bg, color: sc.text,
                        }}>
                          {sc.label}
                        </span>
                      </div>
                      <div style={{ display: 'flex', gap: 16, marginTop: 4, fontSize: 13, color: '#6b7280' }}>
                        <span>{app.contactName}</span>
                        <span>{app.contactEmail}</span>
                        {notes['Business Type'] && <span>{notes['Business Type']}</span>}
                        <span>{timeAgo(app.createdAt)}</span>
                      </div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {app.referenceNumber && (
                      <span style={{ fontSize: 11, fontFamily: 'monospace', color: '#9ca3af' }}>{app.referenceNumber}</span>
                    )}
                    <span style={{ fontSize: 18, color: '#9ca3af', transform: isExpanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>
                      ▼
                    </span>
                  </div>
                </div>

                {/* Expanded Detail */}
                {isExpanded && (
                  <div style={{ borderTop: '1px solid #f3f4f6', padding: 20 }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
                      {/* Contact Info */}
                      <div>
                        <h4 style={{ fontSize: 13, fontWeight: 600, color: '#1B4F72', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 }}>Contact</h4>
                        <div style={{ fontSize: 14, color: '#374151', lineHeight: 1.8 }}>
                          <div><strong>Name:</strong> {app.contactName}</div>
                          <div><strong>Email:</strong> {app.contactEmail}</div>
                          {app.contactPhone && <div><strong>Phone:</strong> {app.contactPhone}</div>}
                          {app.city && <div><strong>Location:</strong> {app.city}, {app.state} {app.zip}</div>}
                          {app.address && <div><strong>Address:</strong> {app.address}</div>}
                        </div>
                      </div>

                      {/* Business Details */}
                      <div>
                        <h4 style={{ fontSize: 13, fontWeight: 600, color: '#1B4F72', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 }}>Business</h4>
                        <div style={{ fontSize: 14, color: '#374151', lineHeight: 1.8 }}>
                          {notes['Business Type'] && <div><strong>Type:</strong> {notes['Business Type']}</div>}
                          {notes['Years in Business'] && <div><strong>Years:</strong> {notes['Years in Business']}</div>}
                          {app.businessLicense && <div><strong>License:</strong> {app.businessLicense}</div>}
                          {app.taxId && <div><strong>Tax ID:</strong> {app.taxId}</div>}
                          {app.estimatedAnnualVolume && <div><strong>Volume:</strong> {app.estimatedAnnualVolume}</div>}
                          {app.referralSource && <div><strong>Referral:</strong> {app.referralSource}</div>}
                        </div>
                      </div>

                      {/* Product Interests */}
                      {notes['Product Interests'] && (
                        <div>
                          <h4 style={{ fontSize: 13, fontWeight: 600, color: '#1B4F72', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 }}>Product Interests</h4>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                            {notes['Product Interests'].split(', ').map(p => (
                              <span key={p} style={{
                                padding: '4px 12px', borderRadius: 99, fontSize: 12, fontWeight: 500,
                                backgroundColor: '#EBF5FF', color: '#1B4F72',
                              }}>
                                {p}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Current Suppliers */}
                      {notes['Current Suppliers'] && (
                        <div>
                          <h4 style={{ fontSize: 13, fontWeight: 600, color: '#1B4F72', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 }}>Current Suppliers</h4>
                          <p style={{ fontSize: 14, color: '#374151' }}>{notes['Current Suppliers']}</p>
                        </div>
                      )}

                      {/* Additional Notes */}
                      {notes['Additional Notes'] && (
                        <div style={{ gridColumn: '1 / -1' }}>
                          <h4 style={{ fontSize: 13, fontWeight: 600, color: '#1B4F72', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 }}>Notes</h4>
                          <p style={{ fontSize: 14, color: '#374151' }}>{notes['Additional Notes']}</p>
                        </div>
                      )}

                      {/* Review Notes (if already reviewed) */}
                      {app.reviewNotes && (
                        <div style={{ gridColumn: '1 / -1' }}>
                          <h4 style={{ fontSize: 13, fontWeight: 600, color: '#991B1B', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 }}>Review Notes</h4>
                          <p style={{ fontSize: 14, color: '#374151' }}>{app.reviewNotes}</p>
                          {app.reviewedAt && (
                            <p style={{ fontSize: 12, color: '#9ca3af', marginTop: 4 }}>
                              Reviewed {new Date(app.reviewedAt).toLocaleDateString()}
                            </p>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Actions for Pending */}
                    {app.status === 'PENDING_APPROVAL' && (
                      <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid #f3f4f6' }}>
                        <div style={{ marginBottom: 12 }}>
                          <label style={{ fontSize: 13, fontWeight: 500, color: '#374151', display: 'block', marginBottom: 4 }}>
                            Review Notes (optional for approval, required for rejection)
                          </label>
                          <textarea
                            value={reviewNotes}
                            onChange={e => setReviewNotes(e.target.value)}
                            placeholder="Add notes about this application..."
                            rows={2}
                            style={{
                              width: '100%', padding: '10px 14px', borderRadius: 8, border: '1px solid #d1d5db',
                              fontSize: 14, outline: 'none', resize: 'vertical', fontFamily: 'inherit',
                            }}
                          />
                        </div>
                        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                          <button
                            onClick={() => {
                              if (!reviewNotes.trim()) {
                                setShowRejectModal(app.id)
                              } else {
                                handleReject(app.id)
                              }
                            }}
                            disabled={actionId === app.id}
                            style={{
                              padding: '10px 24px', borderRadius: 8, border: '1px solid #FCA5A5',
                              backgroundColor: '#FEF2F2', color: '#DC2626',
                              fontSize: 14, fontWeight: 600, cursor: 'pointer',
                              opacity: actionId === app.id ? 0.5 : 1,
                            }}
                          >
                            Decline Application
                          </button>
                          <button
                            onClick={() => handleApprove(app.id)}
                            disabled={actionId === app.id}
                            style={{
                              padding: '10px 24px', borderRadius: 8, border: 'none',
                              backgroundColor: '#10B981', color: 'white',
                              fontSize: 14, fontWeight: 700, cursor: 'pointer',
                              opacity: actionId === app.id ? 0.5 : 1,
                            }}
                          >
                            {actionId === app.id ? 'Processing...' : 'Approve & Create Account'}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Reject Modal */}
      {showRejectModal && (
        <div style={{
          position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50,
        }}>
          <div style={{ backgroundColor: 'white', borderRadius: 16, padding: 32, maxWidth: 480, width: '100%' }}>
            <h3 style={{ fontSize: 18, fontWeight: 700, color: '#1f2937', marginBottom: 4 }}>Decline Application</h3>
            <p style={{ fontSize: 14, color: '#6b7280', marginBottom: 16 }}>Please provide a reason for declining this application.</p>
            <textarea
              autoFocus
              value={reviewNotes}
              onChange={e => setReviewNotes(e.target.value)}
              placeholder="Reason for declining..."
              rows={3}
              style={{
                width: '100%', padding: '10px 14px', borderRadius: 8, border: '1px solid #d1d5db',
                fontSize: 14, outline: 'none', resize: 'vertical', fontFamily: 'inherit',
                marginBottom: 16,
              }}
            />
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button
                onClick={() => { setShowRejectModal(null); setReviewNotes('') }}
                style={{
                  padding: '8px 20px', borderRadius: 8, border: '1px solid #e5e7eb',
                  backgroundColor: 'white', color: '#374151', fontSize: 14, fontWeight: 500, cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                onClick={() => handleReject(showRejectModal)}
                disabled={!reviewNotes.trim() || actionId === showRejectModal}
                style={{
                  padding: '8px 20px', borderRadius: 8, border: 'none',
                  backgroundColor: '#DC2626', color: 'white', fontSize: 14, fontWeight: 600, cursor: 'pointer',
                  opacity: !reviewNotes.trim() ? 0.5 : 1,
                }}
              >
                Confirm Decline
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
