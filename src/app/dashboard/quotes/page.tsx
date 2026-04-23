'use client'

import { useState, useEffect, Fragment } from 'react'
import { useAuth } from '@/hooks/useAuth'
import { formatDate } from '@/lib/utils'
import Link from 'next/link'

// ─── Types ──────────────────────────────────────────────────────────

interface QuoteRequest {
  id: string
  referenceNumber: string
  projectName: string
  projectAddress: string
  city?: string
  state?: string
  zip?: string
  description: string
  productCategories: string | string[]
  estimatedSquareFootage?: number
  preferredDeliveryDate?: string
  notes?: string
  status: string
  createdAt: string
}

interface FormalQuote {
  id: string
  quoteNumber: string
  status: string
  subtotal: number
  termAdjustment: number
  total: number
  validUntil?: string
  createdAt: string
  project?: { name: string; planName?: string }
  items: Array<{
    id: string
    description: string
    quantity: number
    unitPrice: number
    lineTotal: number
  }>
}

interface FormData {
  projectName: string
  projectAddress: string
  city: string
  state: string
  zip: string
  description: string
  productCategories: string
  estimatedSquareFootage: string
  preferredDeliveryDate: string
  notes: string
}

// ─── Helpers ────────────────────────────────────────────────────────

function fmt(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)
}

const REQUEST_STATUS_COLORS: Record<string, string> = {
  NEW: 'bg-data-info-bg text-data-info-fg',
  PENDING: 'bg-data-warning-bg text-data-warning-fg',
  IN_PROGRESS: 'bg-data-warning-bg text-data-warning-fg',
  QUOTED: 'bg-data-positive-bg text-data-positive-fg',
  ACCEPTED: 'bg-data-positive-bg text-data-positive-fg',
  REJECTED: 'bg-data-negative-bg text-data-negative-fg',
  EXPIRED: 'bg-surface-muted text-fg-muted',
}

const QUOTE_STATUS_CONFIG: Record<string, { color: string; label: string }> = {
  DRAFT: { color: 'bg-surface-muted text-fg-muted', label: 'Draft' },
  SENT: { color: 'bg-data-info-bg text-data-info-fg', label: 'Ready for Review' },
  APPROVED: { color: 'bg-data-positive-bg text-data-positive-fg', label: 'Approved' },
  REJECTED: { color: 'bg-data-negative-bg text-data-negative-fg', label: 'Rejected' },
  EXPIRED: { color: 'bg-surface-muted text-fg-muted', label: 'Expired' },
  ORDERED: { color: 'bg-data-positive-bg text-data-positive-fg', label: 'Ordered' },
}

// ─── Page Component ─────────────────────────────────────────────────

export default function QuotesPage() {
  const { builder, loading: authLoading } = useAuth()
  const [activeTab, setActiveTab] = useState<'quotes' | 'requests'>('quotes')
  const [requests, setRequests] = useState<QuoteRequest[]>([])
  const [quotes, setQuotes] = useState<FormalQuote[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [convertingId, setConvertingId] = useState<string | null>(null)
  const [convertSuccess, setConvertSuccess] = useState<string | null>(null)
  const [formData, setFormData] = useState<FormData>({
    projectName: '',
    projectAddress: '',
    city: '',
    state: '',
    zip: '',
    description: '',
    productCategories: '',
    estimatedSquareFootage: '',
    preferredDeliveryDate: '',
    notes: '',
  })

  useEffect(() => {
    if (builder) {
      fetchAll()
    }
  }, [builder])

  async function fetchAll() {
    setLoading(true)
    await Promise.all([fetchQuotes(), fetchQuoteRequests()])
    setLoading(false)
  }

  async function fetchQuotes() {
    try {
      const res = await fetch('/api/quotes')
      if (res.ok) {
        const data = await res.json()
        setQuotes(data.quotes || [])
      }
    } catch (err) {
      console.error('Error fetching quotes:', err)
    }
  }

  async function convertToOrder(quoteId: string) {
    if (convertingId) return
    setConvertingId(quoteId)
    try {
      const res = await fetch(`/api/quotes/${quoteId}/convert`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const data = await res.json()
      if (res.ok) {
        setConvertSuccess(data.message || 'Quote converted to order!')
        setTimeout(() => setConvertSuccess(null), 5000)
        fetchQuotes()
      } else {
        setError(data.error || 'Failed to convert quote')
        setTimeout(() => setError(''), 5000)
      }
    } catch {
      setError('Failed to convert quote')
    } finally {
      setConvertingId(null)
    }
  }

  async function fetchQuoteRequests() {
    try {
      const res = await fetch('/api/builders/quote-request')
      if (res.ok) {
        const data = await res.json()
        setRequests(data.quoteRequests || [])
      }
    } catch (err) {
      console.error('Error fetching quote requests:', err)
    }
  }

  function handleInputChange(
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) {
    const { name, value } = e.target
    setFormData(prev => ({ ...prev, [name]: value }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setError('')
    setSuccess('')

    try {
      if (!formData.projectName.trim()) { setError('Project name is required'); setSubmitting(false); return }
      if (!formData.projectAddress.trim()) { setError('Project address is required'); setSubmitting(false); return }
      if (!formData.description.trim()) { setError('Description is required'); setSubmitting(false); return }
      if (!formData.productCategories.trim()) { setError('Product categories are required'); setSubmitting(false); return }
      if (formData.zip.trim() && !/^\d{5}(-\d{4})?$/.test(formData.zip.trim())) { setError('Please enter a valid ZIP code'); setSubmitting(false); return }
      if (formData.state.trim() && !/^[A-Z]{2}$/.test(formData.state.trim().toUpperCase())) { setError('Please enter a valid 2-letter state code'); setSubmitting(false); return }

      const payload = {
        projectName: formData.projectName,
        projectAddress: formData.projectAddress,
        city: formData.city || undefined,
        state: formData.state || undefined,
        zip: formData.zip || undefined,
        description: formData.description,
        productCategories: formData.productCategories,
        sqFootage: formData.estimatedSquareFootage ? parseInt(formData.estimatedSquareFootage) : undefined,
        deliveryDate: formData.preferredDeliveryDate || undefined,
        notes: formData.notes || undefined,
      }

      const res = await fetch('/api/builders/quote-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (res.ok) {
        setSuccess('Quote request submitted successfully!')
        setFormData({ projectName: '', projectAddress: '', city: '', state: '', zip: '', description: '', productCategories: '', estimatedSquareFootage: '', preferredDeliveryDate: '', notes: '' })
        setShowModal(false)
        setActiveTab('requests')
        await fetchQuoteRequests()
        setTimeout(() => setSuccess(''), 3000)
      } else {
        const errData = await res.json()
        setError(errData.error || 'Failed to submit quote request')
      }
    } catch (err) {
      setError('Error submitting quote request')
    } finally {
      setSubmitting(false)
    }
  }

  if (authLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="w-8 h-8 border-4 border-brand border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!builder) {
    return (
      <div className="text-center py-20">
        <p className="text-fg-muted">Please sign in to access quotes.</p>
      </div>
    )
  }

  // Counts for tab badges
  const actionableQuotes = quotes.filter(q => q.status === 'SENT' || q.status === 'DRAFT').length
  const pendingRequests = requests.filter(r => r.status === 'NEW' || r.status === 'PENDING' || r.status === 'IN_PROGRESS').length

  return (
    <div>
      {/* Convert Success Banner */}
      {convertSuccess && (
        <div className="mb-4 px-4 py-3 bg-data-positive-bg border border-data-positive rounded-lg flex items-center gap-2">
          <span className="text-data-positive-fg">✓</span>
          <p className="text-sm text-data-positive-fg font-medium">{convertSuccess}</p>
          <Link href="/dashboard/orders" className="ml-auto text-xs font-semibold text-data-positive-fg underline">View orders</Link>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold text-fg">Your quotes</h1>
          <p className="text-fg-muted text-sm mt-1">Review pricing, approve quotes, and request new ones.</p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="px-4 py-2 bg-accent text-fg-on-accent rounded-lg font-semibold hover:bg-accent-hover transition-colors"
        >
          Request a quote
        </button>
      </div>

      {/* Success / Error */}
      {success && (
        <div className="mb-4 p-4 bg-data-positive-bg border border-data-positive rounded-lg">
          <p className="text-data-positive-fg text-sm font-medium">{success}</p>
        </div>
      )}
      {error && !showModal && (
        <div className="mb-4 p-4 bg-data-negative-bg border border-data-negative rounded-lg">
          <p className="text-data-negative-fg text-sm font-medium">{error}</p>
        </div>
      )}

      {/* Tab Navigation */}
      <div className="flex gap-1 mb-6 bg-surface-muted rounded-lg p-1 w-fit">
        <button
          onClick={() => setActiveTab('quotes')}
          className={`px-4 py-2 rounded-md text-sm font-semibold transition-all ${
            activeTab === 'quotes'
              ? 'bg-surface text-brand shadow-sm'
              : 'text-fg-muted hover:text-fg-muted'
          }`}
        >
          Quotes
          {actionableQuotes > 0 && (
            <span className="ml-2 px-2 py-0.5 bg-accent text-fg-on-accent text-[10px] rounded-full font-bold">
              {actionableQuotes}
            </span>
          )}
        </button>
        <button
          onClick={() => setActiveTab('requests')}
          className={`px-4 py-2 rounded-md text-sm font-semibold transition-all ${
            activeTab === 'requests'
              ? 'bg-surface text-brand shadow-sm'
              : 'text-fg-muted hover:text-fg-muted'
          }`}
        >
          Requests
          {pendingRequests > 0 && (
            <span className="ml-2 px-2 py-0.5 bg-data-info text-fg-on-accent text-[10px] rounded-full font-bold">
              {pendingRequests}
            </span>
          )}
        </button>
      </div>

      {/* ──── Formal Quotes Tab ──── */}
      {activeTab === 'quotes' && (
        <div className="bg-surface rounded-xl border border-border overflow-hidden">
          {loading ? (
            <div className="p-8 text-center">
              <div className="w-6 h-6 mx-auto border-3 border-brand border-t-transparent rounded-full animate-spin" />
            </div>
          ) : quotes.length === 0 ? (
            <div className="p-12 text-center">
              <svg className="w-16 h-16 mx-auto text-fg-subtle mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <h3 className="text-lg font-medium text-fg mb-2">No quotes yet</h3>
              <p className="text-fg-muted mb-6">Quotes prepared for you will land here for review and approval.</p>
              <button
                onClick={() => { setActiveTab('requests'); setShowModal(true) }}
                className="px-4 py-2 bg-accent text-fg-on-accent rounded-lg font-semibold hover:bg-accent-hover transition-colors"
              >
                Request a quote
              </button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-surface-muted border-b border-border">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-fg-muted uppercase">Quote #</th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-fg-muted uppercase">Project</th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-fg-muted uppercase">Items</th>
                    <th className="px-6 py-3 text-right text-xs font-semibold text-fg-muted uppercase">Total</th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-fg-muted uppercase">Status</th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-fg-muted uppercase">Valid until</th>
                    <th className="px-6 py-3 text-right text-xs font-semibold text-fg-muted uppercase">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {quotes.map(q => {
                    const cfg = QUOTE_STATUS_CONFIG[q.status] || { color: 'bg-surface-muted text-fg-muted', label: q.status }
                    const isExpired = q.validUntil && new Date(q.validUntil) < new Date()
                    const needsAction = q.status === 'SENT' || q.status === 'DRAFT'

                    return (
                      <tr key={q.id} className={`hover:bg-surface-muted transition-colors ${needsAction ? 'bg-data-info-bg/40' : ''}`}>
                        <td className="px-6 py-4">
                          <Link href={`/dashboard/quotes/${q.id}`} className="text-sm font-mono font-semibold text-brand hover:underline">
                            {q.quoteNumber}
                          </Link>
                          <p className="text-[11px] text-fg-subtle mt-0.5">{formatDate(q.createdAt)}</p>
                        </td>
                        <td className="px-6 py-4">
                          <p className="text-sm font-medium text-fg">{q.project?.name || '—'}</p>
                        </td>
                        <td className="px-6 py-4 text-sm text-fg-muted">
                          {q.items?.length || 0} items
                        </td>
                        <td className="px-6 py-4 text-right">
                          <span className="text-sm font-bold text-fg">{fmt(q.total)}</span>
                        </td>
                        <td className="px-6 py-4">
                          <span className={`px-3 py-1 rounded-full text-[10px] font-semibold ${isExpired && q.status === 'SENT' ? 'bg-surface-muted text-fg-muted' : cfg.color}`}>
                            {isExpired && q.status === 'SENT' ? 'Expired' : cfg.label}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-sm text-fg-muted">
                          {q.validUntil ? formatDate(q.validUntil) : '—'}
                        </td>
                        <td className="px-6 py-4 text-right">
                          <div className="flex items-center justify-end gap-2">
                            {(q.status === 'SENT' || q.status === 'APPROVED') && !isExpired && (
                              <button
                                onClick={() => convertToOrder(q.id)}
                                disabled={convertingId === q.id}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-brand text-fg-on-accent text-xs font-semibold rounded-lg hover:bg-brand-hover transition-colors disabled:opacity-50"
                              >
                                {convertingId === q.id ? (
                                  <>
                                    <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                                    Converting...
                                  </>
                                ) : (
                                  <>Place order</>
                                )}
                              </button>
                            )}
                            {needsAction && !isExpired ? (
                              <Link
                                href={`/dashboard/quotes/${q.id}`}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-accent text-fg-on-accent text-xs font-semibold rounded-lg hover:bg-accent-hover transition-colors"
                              >
                                Review
                              </Link>
                            ) : (
                              <Link
                                href={`/dashboard/quotes/${q.id}`}
                                className="text-sm text-brand font-medium hover:underline"
                              >
                                View
                              </Link>
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ──── Quote Requests Tab ──── */}
      {activeTab === 'requests' && (
        <div className="bg-surface rounded-xl border border-border overflow-hidden">
          {loading ? (
            <div className="p-8 text-center">
              <div className="w-6 h-6 mx-auto border-3 border-brand border-t-transparent rounded-full animate-spin" />
            </div>
          ) : requests.length === 0 ? (
            <div className="p-12 text-center">
              <svg className="w-16 h-16 mx-auto text-fg-subtle mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <h3 className="text-lg font-medium text-fg mb-2">No requests yet</h3>
              <p className="text-fg-muted mb-6">Submit a request and we&apos;ll build a quote for your project.</p>
              <button
                onClick={() => setShowModal(true)}
                className="px-4 py-2 bg-accent text-fg-on-accent rounded-lg font-semibold hover:bg-accent-hover transition-colors"
              >
                Request a quote
              </button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-surface-muted border-b border-border">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-fg-muted uppercase">Reference</th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-fg-muted uppercase">Project</th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-fg-muted uppercase">Categories</th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-fg-muted uppercase">Status</th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-fg-muted uppercase">Date</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {requests.map(req => {
                    const cats = Array.isArray(req.productCategories)
                      ? req.productCategories
                      : typeof req.productCategories === 'string'
                      ? req.productCategories.split(',').map(c => c.trim())
                      : []
                    const isExpanded = expandedId === req.id

                    return (
                      <Fragment key={req.id}>
                        <tr
                          className="hover:bg-surface-muted transition-colors cursor-pointer"
                          onClick={() => setExpandedId(isExpanded ? null : req.id)}
                        >
                          <td className="px-6 py-4 text-sm font-mono font-semibold text-fg">
                            <span className="inline-block w-4 mr-1 text-fg-subtle">{isExpanded ? '▾' : '▸'}</span>
                            {req.referenceNumber}
                          </td>
                          <td className="px-6 py-4">
                            <div>
                              <p className="text-sm font-medium text-fg">{req.projectName}</p>
                              <p className="text-xs text-fg-muted mt-0.5">{req.projectAddress}</p>
                            </div>
                          </td>
                          <td className="px-6 py-4">
                            <div className="flex flex-wrap gap-1">
                              {cats.map((cat, idx) => (
                                <span key={idx} className="px-2 py-1 bg-surface-muted text-fg-muted text-[10px] rounded font-medium">
                                  {cat}
                                </span>
                              ))}
                            </div>
                          </td>
                          <td className="px-6 py-4">
                            <span className={`px-3 py-1 rounded-full text-[10px] font-semibold ${REQUEST_STATUS_COLORS[req.status] || 'bg-surface-muted text-fg-muted'}`}>
                              {req.status}
                            </span>
                          </td>
                          <td className="px-6 py-4 text-sm text-fg-muted">
                            {formatDate(req.createdAt)}
                          </td>
                        </tr>
                        {isExpanded && (
                          <tr key={`${req.id}-detail`}>
                            <td colSpan={5} className="px-6 py-4 bg-surface-muted border-t border-border">
                              <div className="max-w-3xl space-y-3">
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                  <div>
                                    <p className="text-xs text-fg-muted uppercase tracking-wide font-semibold">Project Address</p>
                                    <p className="text-sm text-fg mt-1">
                                      {req.projectAddress}
                                      {req.city && `, ${req.city}`}
                                      {req.state && `, ${req.state}`}
                                      {req.zip && ` ${req.zip}`}
                                    </p>
                                  </div>
                                  {req.estimatedSquareFootage && (
                                    <div>
                                      <p className="text-xs text-fg-muted uppercase tracking-wide font-semibold">Square Footage</p>
                                      <p className="text-sm text-fg mt-1">{req.estimatedSquareFootage.toLocaleString()} sq ft</p>
                                    </div>
                                  )}
                                  {req.preferredDeliveryDate && (
                                    <div>
                                      <p className="text-xs text-fg-muted uppercase tracking-wide font-semibold">Preferred Delivery</p>
                                      <p className="text-sm text-fg mt-1">{formatDate(req.preferredDeliveryDate)}</p>
                                    </div>
                                  )}
                                </div>
                                <div>
                                  <p className="text-xs text-fg-muted uppercase tracking-wide font-semibold">Description</p>
                                  <p className="text-sm text-fg-muted mt-1 whitespace-pre-wrap">{req.description}</p>
                                </div>
                                {req.notes && (
                                  <div className="p-3 bg-data-warning-bg border border-data-warning rounded-lg">
                                    <p className="text-xs text-data-warning-fg font-semibold mb-1">Notes</p>
                                    <p className="text-sm text-data-warning-fg">{req.notes}</p>
                                  </div>
                                )}
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ──── Request Quote Modal ──── */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-surface rounded-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-surface border-b border-border px-6 py-4 flex items-center justify-between">
              <h2 className="text-xl font-bold text-fg">Request a quote</h2>
              <button
                onClick={() => { setShowModal(false); setError('') }}
                className="text-fg-subtle hover:text-fg-muted transition-colors"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              {error && (
                <div className="p-3 bg-data-negative-bg border border-data-negative rounded-lg">
                  <p className="text-data-negative-fg text-sm font-medium">{error}</p>
                </div>
              )}

              <div>
                <label className="block text-sm font-semibold text-fg mb-1">Project Name *</label>
                <input type="text" name="projectName" value={formData.projectName} onChange={handleInputChange}
                  placeholder="e.g., Downtown Commercial Complex"
                  className="w-full px-3 py-2 border border-border-strong rounded-lg focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent" />
              </div>

              <div>
                <label className="block text-sm font-semibold text-fg mb-1">Project Address *</label>
                <input type="text" name="projectAddress" value={formData.projectAddress} onChange={handleInputChange}
                  placeholder="e.g., 123 Main St"
                  className="w-full px-3 py-2 border border-border-strong rounded-lg focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent" />
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-fg mb-1">City</label>
                  <input type="text" name="city" value={formData.city} onChange={handleInputChange} placeholder="City"
                    className="w-full px-3 py-2 border border-border-strong rounded-lg focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent" />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-fg mb-1">State</label>
                  <input type="text" name="state" value={formData.state} onChange={handleInputChange} placeholder="TX" maxLength={2}
                    className="w-full px-3 py-2 border border-border-strong rounded-lg focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent" />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-fg mb-1">Zip</label>
                  <input type="text" name="zip" value={formData.zip} onChange={handleInputChange} placeholder="75001"
                    className="w-full px-3 py-2 border border-border-strong rounded-lg focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent" />
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold text-fg mb-1">Project Description *</label>
                <textarea name="description" value={formData.description} onChange={handleInputChange}
                  placeholder="Describe your project, scope, and requirements..." rows={3}
                  className="w-full px-3 py-2 border border-border-strong rounded-lg focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent resize-none" />
              </div>

              <div>
                <label className="block text-sm font-semibold text-fg mb-1">Product Categories * (comma-separated)</label>
                <input type="text" name="productCategories" value={formData.productCategories} onChange={handleInputChange}
                  placeholder="e.g., Interior Doors, Hardware, Trim"
                  className="w-full px-3 py-2 border border-border-strong rounded-lg focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent" />
              </div>

              <div>
                <label className="block text-sm font-semibold text-fg mb-1">Estimated Square Footage</label>
                <input type="number" name="estimatedSquareFootage" value={formData.estimatedSquareFootage} onChange={handleInputChange}
                  placeholder="e.g., 5000"
                  className="w-full px-3 py-2 border border-border-strong rounded-lg focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent" />
              </div>

              <div>
                <label className="block text-sm font-semibold text-fg mb-1">Preferred Delivery Date</label>
                <input type="date" name="preferredDeliveryDate" value={formData.preferredDeliveryDate} onChange={handleInputChange}
                  className="w-full px-3 py-2 border border-border-strong rounded-lg focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent" />
              </div>

              <div>
                <label className="block text-sm font-semibold text-fg mb-1">Additional Notes</label>
                <textarea name="notes" value={formData.notes} onChange={handleInputChange}
                  placeholder="Any additional information..." rows={2}
                  className="w-full px-3 py-2 border border-border-strong rounded-lg focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent resize-none" />
              </div>

              <div className="flex gap-3 justify-end pt-4 border-t border-border">
                <button type="button" onClick={() => { setShowModal(false); setError('') }}
                  className="px-4 py-2 border border-border-strong rounded-lg text-fg-muted font-semibold hover:bg-surface-muted transition-colors">
                  Cancel
                </button>
                <button type="submit" disabled={submitting}
                  className="px-4 py-2 bg-accent text-white rounded-lg font-semibold hover:bg-accent-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
                  {submitting ? 'Submitting...' : 'Submit Request'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
