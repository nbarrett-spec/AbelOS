'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'

const REFERRAL_STATUSES = [
  { key: 'PENDING', label: 'Pending', color: '#95A5A6' },
  { key: 'CONTACTED', label: 'Contacted', color: '#3498DB' },
  { key: 'SIGNED_UP', label: 'Signed Up', color: '#C9822B' },
  { key: 'FIRST_ORDER', label: 'First Order', color: '#27AE60' },
  { key: 'CREDITED', label: 'Credited', color: '#D9993F' },
]

interface Referral {
  id: string
  referredCompany: string
  referredContact: string
  referredEmail: string
  referralCode: string
  status: string
  creditAmount: number
  referrerCredited: boolean
  referreeCredited: boolean
  createdAt: string
}

interface Stats {
  totalEarned: number
  pendingCredit: number
  totalSubmitted: number
}

export default function ReferralsPage() {
  const [referrals, setReferrals] = useState<Referral[]>([])
  const [stats, setStats] = useState<Stats>({ totalEarned: 0, pendingCredit: 0, totalSubmitted: 0 })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [toast, setToast] = useState('')
  const [copiedCode, setCopiedCode] = useState<string | null>(null)

  const [formData, setFormData] = useState({
    referredCompany: '',
    referredContact: '',
    referredEmail: '',
    referredPhone: '',
    notes: '',
  })

  useEffect(() => {
    fetchReferrals()
  }, [])

  const fetchReferrals = async () => {
    try {
      setLoading(true)
      const response = await fetch('/api/builder/referrals')
      if (!response.ok) throw new Error('Failed to fetch referrals')
      const data = await response.json()
      setReferrals(data.referrals || [])
      setStats(data.stats || { totalEarned: 0, pendingCredit: 0, totalSubmitted: 0 })
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load referrals')
    } finally {
      setLoading(false)
    }
  }

  const handleSubmitReferral = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!formData.referredCompany || !formData.referredContact || !formData.referredEmail || !formData.referredPhone) {
      setToast('Please fill in all required fields')
      return
    }

    setSubmitting(true)
    try {
      const response = await fetch('/api/builder/referrals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      })

      if (!response.ok) throw new Error('Failed to submit referral')

      setToast('Referral submitted successfully!')
      setFormData({
        referredCompany: '',
        referredContact: '',
        referredEmail: '',
        referredPhone: '',
        notes: '',
      })
      setShowForm(false)
      await fetchReferrals()
    } catch (err) {
      setToast(err instanceof Error ? err.message : 'Failed to submit referral')
    } finally {
      setSubmitting(false)
    }
  }

  const copyToClipboard = (code: string) => {
    navigator.clipboard.writeText(code)
    setCopiedCode(code)
    setTimeout(() => setCopiedCode(null), 2000)
  }

  const getStatusColor = (status: string): string => {
    const statusConfig = REFERRAL_STATUSES.find(s => s.key === status)
    return statusConfig?.color || '#95A5A6'
  }

  const getStatusLabel = (status: string): string => {
    const statusConfig = REFERRAL_STATUSES.find(s => s.key === status)
    return statusConfig?.label || status
  }

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '4rem' }}>
        <div style={{ textAlign: 'center' }}>
          <div
            style={{
              display: 'inline-block',
              animation: 'spin 1s linear infinite',
              marginBottom: '1rem',
            }}
          >
            ⏳
          </div>
          <p style={{ color: '#666' }}>Loading referrals...</p>
        </div>
      </div>
    )
  }

  return (
    <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '2rem' }}>
      {toast && (
        <div
          style={{
            position: 'fixed',
            top: '1rem',
            right: '1rem',
            backgroundColor: toast.includes('success') ? '#27AE60' : '#E74C3C',
            color: '#fff',
            padding: '1rem 1.5rem',
            borderRadius: '0.5rem',
            fontSize: '0.875rem',
            fontWeight: '500',
            zIndex: 50,
          }}
        >
          {toast}
        </div>
      )}

      {/* Header */}
      <div style={{ marginBottom: '3rem' }}>
        <Link href="/dashboard" style={{ fontSize: '0.875rem', color: '#3E2A1E', textDecoration: 'none' }}>
          ← Back to Dashboard
        </Link>
        <h1 style={{ fontSize: '2rem', fontWeight: 'bold', margin: '1rem 0 0.5rem 0' }}>
          🎁 Refer a Builder, Earn Rewards
        </h1>
        <p style={{ color: '#666', fontSize: '0.875rem' }}>
          For every builder you refer who places their first order, you both get $250 credit
        </p>
      </div>

      {/* Hero / Program Info */}
      <div
        style={{
          backgroundColor: '#F5F5F5',
          border: '1px solid #E0E0E0',
          borderRadius: '0.75rem',
          padding: '2rem',
          marginBottom: '2rem',
        }}
      >
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '2rem', marginBottom: '2rem' }}>
          <div>
            <div style={{ fontSize: '2rem', fontWeight: 'bold', color: '#3E2A1E' }}>
              ${stats.totalEarned.toFixed(2)}
            </div>
            <div style={{ color: '#666', fontSize: '0.875rem', marginTop: '0.5rem' }}>
              Total Earned
            </div>
          </div>
          <div>
            <div style={{ fontSize: '2rem', fontWeight: 'bold', color: '#C9822B' }}>
              ${stats.pendingCredit.toFixed(2)}
            </div>
            <div style={{ color: '#666', fontSize: '0.875rem', marginTop: '0.5rem' }}>
              Pending Credit
            </div>
          </div>
          <div>
            <div style={{ fontSize: '2rem', fontWeight: 'bold', color: '#27AE60' }}>
              {stats.totalSubmitted}
            </div>
            <div style={{ color: '#666', fontSize: '0.875rem', marginTop: '0.5rem' }}>
              Referrals Submitted
            </div>
          </div>
        </div>
      </div>

      {/* Referral Code Section */}
      <div
        style={{
          backgroundColor: '#fff',
          border: '2px solid #3E2A1E',
          borderRadius: '0.75rem',
          padding: '1.5rem',
          marginBottom: '2rem',
        }}
      >
        <h2 style={{ fontSize: '1.125rem', fontWeight: '600', marginTop: 0, marginBottom: '1rem' }}>
          Your Unique Referral Code
        </h2>
        <p style={{ color: '#666', fontSize: '0.875rem', marginBottom: '1rem' }}>
          Share this code with builders you know. They'll get $250 credit when they use it to sign up.
        </p>
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
          {referrals.length > 0 && referrals[0].referralCode ? (
            <>
              <input
                type="text"
                value={referrals[0].referralCode}
                readOnly
                style={{
                  padding: '0.75rem 1rem',
                  fontSize: '1.25rem',
                  fontWeight: 'bold',
                  fontFamily: 'monospace',
                  border: '1px solid #ddd',
                  borderRadius: '0.5rem',
                  backgroundColor: '#f9f9f9',
                  flex: 1,
                  minWidth: '200px',
                }}
              />
              <button
                onClick={() => copyToClipboard(referrals[0].referralCode)}
                style={{
                  padding: '0.75rem 1.5rem',
                  backgroundColor: copiedCode === referrals[0].referralCode ? '#27AE60' : '#3E2A1E',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '0.5rem',
                  cursor: 'pointer',
                  fontWeight: '500',
                  transition: 'background-color 0.2s',
                }}
              >
                {copiedCode === referrals[0].referralCode ? '✓ Copied' : 'Copy'}
              </button>
            </>
          ) : (
            <p style={{ color: '#999' }}>Submit your first referral to get a unique code</p>
          )}
        </div>
      </div>

      {/* New Referral Button */}
      {!showForm && (
        <button
          onClick={() => setShowForm(true)}
          style={{
            width: '100%',
            padding: '1rem',
            backgroundColor: '#3E2A1E',
            color: '#fff',
            border: 'none',
            borderRadius: '0.5rem',
            fontSize: '1rem',
            fontWeight: '600',
            cursor: 'pointer',
            marginBottom: '2rem',
          }}
        >
          + Submit New Referral
        </button>
      )}

      {/* Referral Form */}
      {showForm && (
        <form
          onSubmit={handleSubmitReferral}
          style={{
            backgroundColor: '#f9f9f9',
            border: '1px solid #E0E0E0',
            borderRadius: '0.75rem',
            padding: '1.5rem',
            marginBottom: '2rem',
          }}
        >
          <h3 style={{ marginTop: 0, marginBottom: '1.5rem', fontSize: '1rem', fontWeight: '600' }}>
            New Referral
          </h3>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: '500', marginBottom: '0.5rem' }}>
                Company Name *
              </label>
              <input
                type="text"
                value={formData.referredCompany}
                onChange={e => setFormData({ ...formData, referredCompany: e.target.value })}
                placeholder="ABC Builders Inc."
                style={{
                  width: '100%',
                  padding: '0.75rem',
                  border: '1px solid #ddd',
                  borderRadius: '0.5rem',
                  fontSize: '0.875rem',
                }}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: '500', marginBottom: '0.5rem' }}>
                Contact Name *
              </label>
              <input
                type="text"
                value={formData.referredContact}
                onChange={e => setFormData({ ...formData, referredContact: e.target.value })}
                placeholder="John Smith"
                style={{
                  width: '100%',
                  padding: '0.75rem',
                  border: '1px solid #ddd',
                  borderRadius: '0.5rem',
                  fontSize: '0.875rem',
                }}
              />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: '500', marginBottom: '0.5rem' }}>
                Email *
              </label>
              <input
                type="email"
                value={formData.referredEmail}
                onChange={e => setFormData({ ...formData, referredEmail: e.target.value })}
                placeholder="john@example.com"
                style={{
                  width: '100%',
                  padding: '0.75rem',
                  border: '1px solid #ddd',
                  borderRadius: '0.5rem',
                  fontSize: '0.875rem',
                }}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: '500', marginBottom: '0.5rem' }}>
                Phone *
              </label>
              <input
                type="tel"
                value={formData.referredPhone}
                onChange={e => setFormData({ ...formData, referredPhone: e.target.value })}
                placeholder="(555) 123-4567"
                style={{
                  width: '100%',
                  padding: '0.75rem',
                  border: '1px solid #ddd',
                  borderRadius: '0.5rem',
                  fontSize: '0.875rem',
                }}
              />
            </div>
          </div>

          <div style={{ marginBottom: '1.5rem' }}>
            <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: '500', marginBottom: '0.5rem' }}>
              Notes (optional)
            </label>
            <textarea
              value={formData.notes}
              onChange={e => setFormData({ ...formData, notes: e.target.value })}
              placeholder="Any additional notes about this referral..."
              style={{
                width: '100%',
                padding: '0.75rem',
                border: '1px solid #ddd',
                borderRadius: '0.5rem',
                fontSize: '0.875rem',
                minHeight: '100px',
                fontFamily: 'inherit',
              }}
            />
          </div>

          <div style={{ display: 'flex', gap: '1rem', justifyContent: 'flex-end' }}>
            <button
              type="button"
              onClick={() => setShowForm(false)}
              style={{
                padding: '0.75rem 1.5rem',
                backgroundColor: '#f0f0f0',
                color: '#333',
                border: 'none',
                borderRadius: '0.5rem',
                cursor: 'pointer',
                fontWeight: '500',
              }}
              disabled={submitting}
            >
              Cancel
            </button>
            <button
              type="submit"
              style={{
                padding: '0.75rem 1.5rem',
                backgroundColor: '#3E2A1E',
                color: '#fff',
                border: 'none',
                borderRadius: '0.5rem',
                cursor: 'pointer',
                fontWeight: '500',
              }}
              disabled={submitting}
            >
              {submitting ? 'Submitting...' : 'Send Referral'}
            </button>
          </div>
        </form>
      )}

      {/* Referrals List */}
      <div>
        <h2 style={{ fontSize: '1.25rem', fontWeight: '600', marginBottom: '1.5rem' }}>
          Your Referrals
        </h2>

        {referrals.length === 0 ? (
          <div
            style={{
              textAlign: 'center',
              padding: '3rem',
              backgroundColor: '#f9f9f9',
              borderRadius: '0.75rem',
              color: '#999',
            }}
          >
            <div style={{ fontSize: '2rem', marginBottom: '1rem' }}>📭</div>
            <p>No referrals yet. Submit your first referral to get started!</p>
          </div>
        ) : (
          <div style={{ display: 'grid', gap: '1rem' }}>
            {referrals.map(ref => (
              <div
                key={ref.id}
                style={{
                  backgroundColor: '#fff',
                  border: '1px solid #E0E0E0',
                  borderRadius: '0.75rem',
                  padding: '1.5rem',
                  display: 'grid',
                  gridTemplateColumns: 'auto 1fr auto',
                  gap: '1.5rem',
                  alignItems: 'center',
                }}
              >
                {/* Company info */}
                <div style={{ minWidth: '200px' }}>
                  <div style={{ fontWeight: '600', fontSize: '1rem' }}>
                    {ref.referredCompany}
                  </div>
                  <div style={{ color: '#666', fontSize: '0.875rem', marginTop: '0.25rem' }}>
                    {ref.referredContact}
                  </div>
                  <div style={{ color: '#999', fontSize: '0.75rem', marginTop: '0.25rem' }}>
                    {ref.referredEmail}
                  </div>
                </div>

                {/* Status and details */}
                <div>
                  <div style={{ display: 'flex', gap: '2rem', flexWrap: 'wrap', alignItems: 'center' }}>
                    <div>
                      <div style={{ fontSize: '0.75rem', color: '#999', marginBottom: '0.25rem' }}>
                        STATUS
                      </div>
                      <div
                        style={{
                          display: 'inline-block',
                          padding: '0.375rem 0.75rem',
                          backgroundColor: getStatusColor(ref.status),
                          color: '#fff',
                          borderRadius: '0.25rem',
                          fontSize: '0.75rem',
                          fontWeight: 'bold',
                        }}
                      >
                        {getStatusLabel(ref.status)}
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: '0.75rem', color: '#999', marginBottom: '0.25rem' }}>
                        REFERRED DATE
                      </div>
                      <div style={{ fontSize: '0.875rem', fontWeight: '500' }}>
                        {new Date(ref.createdAt).toLocaleDateString()}
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: '0.75rem', color: '#999', marginBottom: '0.25rem' }}>
                        CREDIT
                      </div>
                      <div
                        style={{
                          fontSize: '0.875rem',
                          fontWeight: '600',
                          color: ref.referrerCredited ? '#27AE60' : '#D9993F',
                        }}
                      >
                        ${ref.creditAmount.toFixed(2)}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Code */}
                <div style={{ textAlign: 'right', minWidth: '150px' }}>
                  <div style={{ fontSize: '0.75rem', color: '#999', marginBottom: '0.5rem' }}>
                    REFERRAL CODE
                  </div>
                  <div
                    style={{
                      fontFamily: 'monospace',
                      fontSize: '0.875rem',
                      fontWeight: 'bold',
                      color: '#3E2A1E',
                    }}
                  >
                    {ref.referralCode}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <style jsx>{`
        @keyframes spin {
          from {
            transform: rotate(0deg);
          }
          to {
            transform: rotate(360deg);
          }
        }
      `}</style>
    </div>
  )
}
