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
  NEW: 'bg-blue-100 text-blue-700',
  PENDING: 'bg-yellow-100 text-yellow-700',
  IN_PROGRESS: 'bg-amber-100 text-amber-700',
  QUOTED: 'bg-green-100 text-green-700',
  ACCEPTED: 'bg-emerald-100 text-emerald-700',
  REJECTED: 'bg-red-100 text-red-700',
  EXPIRED: 'bg-gray-100 text-gray-700',
}

const QUOTE_STATUS_CONFIG: Record<string, { color: string; label: string }> = {
  DRAFT: { color: 'bg-gray-100 text-gray-700', label: 'Draft' },
  SENT: { color: 'bg-blue-100 text-blue-700', label: 'Ready for Review' },
  APPROVED: { color: 'bg-green-100 text-green-700', label: 'Approved' },
  REJECTED: { color: 'bg-red-100 text-red-700', label: 'Rejected' },
  EXPIRED: { color: 'bg-gray-100 text-gray-500', label: 'Expired' },
  ORDERED: { color: 'bg-emerald-100 text-emerald-700', label: 'Ordered' },
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
        <div className="w-8 h-8 border-4 border-[#1B2A4A] border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!builder) {
    return (
      <div className="text-center py-20">
        <p className="text-gray-500">Please sign in to access quotes.</p>
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
        <div className="mb-4 px-4 py-3 bg-green-50 border border-green-200 rounded-lg flex items-center gap-2">
          <span className="text-green-600">✅</span>
          <p className="text-sm text-green-700 font-medium">{convertSuccess}</p>
          <Link href="/dashboard/orders" className="ml-auto text-xs font-semibold text-green-700 underline">View Orders</Link>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Quotes</h1>
          <p className="text-gray-500 text-sm mt-1">View quotes and submit new requests</p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="px-4 py-2 bg-[#E67E22] text-white rounded-lg font-semibold hover:bg-[#d35400] transition-colors"
        >
          Request a Quote
        </button>
      </div>

      {/* Success / Error */}
      {success && (
        <div className="mb-4 p-4 bg-green-50 border border-green-200 rounded-lg">
          <p className="text-green-700 text-sm font-medium">{success}</p>
        </div>
      )}
      {error && !showModal && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg">
          <p className="text-red-700 text-sm font-medium">{error}</p>
        </div>
      )}

      {/* Tab Navigation */}
      <div className="flex gap-1 mb-6 bg-gray-100 rounded-lg p-1 w-fit">
        <button
          onClick={() => setActiveTab('quotes')}
          className={`px-4 py-2 rounded-md text-sm font-semibold transition-all ${
            activeTab === 'quotes'
              ? 'bg-white text-[#1B4F72] shadow-sm'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          Formal Quotes
          {actionableQuotes > 0 && (
            <span className="ml-2 px-2 py-0.5 bg-[#E67E22] text-white text-[10px] rounded-full font-bold">
              {actionableQuotes}
            </span>
          )}
        </button>
        <button
          onClick={() => setActiveTab('requests')}
          className={`px-4 py-2 rounded-md text-sm font-semibold transition-all ${
            activeTab === 'requests'
              ? 'bg-white text-[#1B4F72] shadow-sm'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          Quote Requests
          {pendingRequests > 0 && (
            <span className="ml-2 px-2 py-0.5 bg-blue-500 text-white text-[10px] rounded-full font-bold">
              {pendingRequests}
            </span>
          )}
        </button>
      </div>

      {/* ──── Formal Quotes Tab ──── */}
      {activeTab === 'quotes' && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          {loading ? (
            <div className="p-8 text-center">
              <div className="w-6 h-6 mx-auto border-3 border-[#1B2A4A] border-t-transparent rounded-full animate-spin" />
            </div>
          ) : quotes.length === 0 ? (
            <div className="p-12 text-center">
              <svg className="w-16 h-16 mx-auto text-gray-300 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <h3 className="text-lg font-medium text-gray-900 mb-2">No quotes yet</h3>
              <p className="text-gray-500 mb-6">Once Abel Lumber prepares a quote for you, it will appear here for review and approval.</p>
              <button
                onClick={() => { setActiveTab('requests'); setShowModal(true) }}
                className="px-4 py-2 bg-[#E67E22] text-white rounded-lg font-semibold hover:bg-[#d35400] transition-colors"
              >
                Request a Quote
              </button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Quote #</th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Project</th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Items</th>
                    <th className="px-6 py-3 text-right text-xs font-semibold text-gray-600 uppercase">Total</th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Status</th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Valid Until</th>
                    <th className="px-6 py-3 text-right text-xs font-semibold text-gray-600 uppercase">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {quotes.map(q => {
                    const cfg = QUOTE_STATUS_CONFIG[q.status] || { color: 'bg-gray-100 text-gray-700', label: q.status }
                    const isExpired = q.validUntil && new Date(q.validUntil) < new Date()
                    const needsAction = q.status === 'SENT' || q.status === 'DRAFT'

                    return (
                      <tr key={q.id} className={`hover:bg-gray-50 transition-colors ${needsAction ? 'bg-blue-50/30' : ''}`}>
                        <td className="px-6 py-4">
                          <Link href={`/dashboard/quotes/${q.id}`} className="text-sm font-mono font-semibold text-[#1B4F72] hover:underline">
                            {q.quoteNumber}
                          </Link>
                          <p className="text-[11px] text-gray-400 mt-0.5">{formatDate(q.createdAt)}</p>
                        </td>
                        <td className="px-6 py-4">
                          <p className="text-sm font-medium text-gray-900">{q.project?.name || '—'}</p>
                        </td>
                        <td className="px-6 py-4 text-sm text-gray-600">
                          {q.items?.length || 0} items
                        </td>
                        <td className="px-6 py-4 text-right">
                          <span className="text-sm font-bold text-gray-900">{fmt(q.total)}</span>
                        </td>
                        <td className="px-6 py-4">
                          <span className={`px-3 py-1 rounded-full text-[10px] font-semibold ${isExpired && q.status === 'SENT' ? 'bg-gray-100 text-gray-500' : cfg.color}`}>
                            {isExpired && q.status === 'SENT' ? 'Expired' : cfg.label}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-sm text-gray-500">
                          {q.validUntil ? formatDate(q.validUntil) : '—'}
                        </td>
                        <td className="px-6 py-4 text-right">
                          <div className="flex items-center justify-end gap-2">
                            {(q.status === 'SENT' || q.status === 'APPROVED') && !isExpired && (
                              <button
                                onClick={() => convertToOrder(q.id)}
                                disabled={convertingId === q.id}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#1B4F72] text-white text-xs font-semibold rounded-lg hover:bg-[#163d59] transition-colors disabled:opacity-50"
                              >
                                {convertingId === q.id ? (
                                  <>
                                    <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                                    Converting...
                                  </>
                                ) : (
                                  <>📦 Place Order</>
                                )}
                              </button>
                            )}
                            {needsAction && !isExpired ? (
                              <Link
                                href={`/dashboard/quotes/${q.id}`}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#E67E22] text-white text-xs font-semibold rounded-lg hover:bg-[#d35400] transition-colors"
                              >
                                Review
                              </Link>
                            ) : (
                              <Link
                                href={`/dashboard/quotes/${q.id}`}
                                className="text-sm text-[#1B4F72] font-medium hover:underline"
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
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          {loading ? (
            <div className="p-8 text-center">
              <div className="w-6 h-6 mx-auto border-3 border-[#1B2A4A] border-t-transparent rounded-full animate-spin" />
            </div>
          ) : requests.length === 0 ? (
            <div className="p-12 text-center">
              <svg className="w-16 h-16 mx-auto text-gray-300 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <h3 className="text-lg font-medium text-gray-900 mb-2">No quote requests yet</h3>
              <p className="text-gray-500 mb-6">Submit a new quote request for your project.</p>
              <button
                onClick={() => setShowModal(true)}
                className="px-4 py-2 bg-[#E67E22] text-white rounded-lg font-semibold hover:bg-[#d35400] transition-colors"
              >
                Request a Quote
              </button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Reference</th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Project</th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Categories</th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Status</th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Date</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
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
                          className="hover:bg-gray-50 transition-colors cursor-pointer"
                          onClick={() => setExpandedId(isExpanded ? null : req.id)}
                        >
                          <td className="px-6 py-4 text-sm font-mono font-semibold text-[#1B2A4A]">
                            <span className="inline-block w-4 mr-1 text-gray-400">{isExpanded ? '▾' : '▸'}</span>
                            {req.referenceNumber}
                          </td>
                          <td className="px-6 py-4">
                            <div>
                              <p className="text-sm font-medium text-gray-900">{req.projectName}</p>
                              <p className="text-xs text-gray-500 mt-0.5">{req.projectAddress}</p>
                            </div>
                          </td>
                          <td className="px-6 py-4">
                            <div className="flex flex-wrap gap-1">
                              {cats.map((cat, idx) => (
                                <span key={idx} className="px-2 py-1 bg-gray-100 text-gray-700 text-[10px] rounded font-medium">
                                  {cat}
                                </span>
                              ))}
                            </div>
                          </td>
                          <td className="px-6 py-4">
                            <span className={`px-3 py-1 rounded-full text-[10px] font-semibold ${REQUEST_STATUS_COLORS[req.status] || 'bg-gray-100 text-gray-700'}`}>
                              {req.status}
                            </span>
                          </td>
                          <td className="px-6 py-4 text-sm text-gray-500">
                            {formatDate(req.createdAt)}
                          </td>
                        </tr>
                        {isExpanded && (
                          <tr key={`${req.id}-detail`}>
                            <td colSpan={5} className="px-6 py-4 bg-gray-50 border-t border-gray-100">
                              <div className="max-w-3xl space-y-3">
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                  <div>
                                    <p className="text-xs text-gray-500 uppercase tracking-wide font-semibold">Project Address</p>
                                    <p className="text-sm text-gray-900 mt-1">
                                      {req.projectAddress}
                                      {req.city && `, ${req.city}`}
                                      {req.state && `, ${req.state}`}
                                      {req.zip && ` ${req.zip}`}
                                    </p>
                                  </div>
                                  {req.estimatedSquareFootage && (
                                    <div>
                                      <p className="text-xs text-gray-500 uppercase tracking-wide font-semibold">Square Footage</p>
                                      <p className="text-sm text-gray-900 mt-1">{req.estimatedSquareFootage.toLocaleString()} sq ft</p>
                                    </div>
                                  )}
                                  {req.preferredDeliveryDate && (
                                    <div>
                                      <p className="text-xs text-gray-500 uppercase tracking-wide font-semibold">Preferred Delivery</p>
                                      <p className="text-sm text-gray-900 mt-1">{formatDate(req.preferredDeliveryDate)}</p>
                                    </div>
                                  )}
                                </div>
                                <div>
                                  <p className="text-xs text-gray-500 uppercase tracking-wide font-semibold">Description</p>
                                  <p className="text-sm text-gray-700 mt-1 whitespace-pre-wrap">{req.description}</p>
                                </div>
                                {req.notes && (
                                  <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                                    <p className="text-xs text-yellow-700 font-semibold mb-1">Notes</p>
                                    <p className="text-sm text-yellow-800">{req.notes}</p>
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
          <div className="bg-white rounded-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
              <h2 className="text-xl font-bold text-gray-900">Request a Quote</h2>
              <button
                onClick={() => { setShowModal(false); setError('') }}
                className="text-gray-400 hover:text-gray-600 transition-colors"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              {error && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
                  <p className="text-red-700 text-sm font-medium">{error}</p>
                </div>
              )}

              <div>
                <label className="block text-sm font-semibold text-gray-900 mb-1">Project Name *</label>
                <input type="text" name="projectName" value={formData.projectName} onChange={handleInputChange}
                  placeholder="e.g., Downtown Commercial Complex"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#E67E22] focus:border-transparent" />
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-900 mb-1">Project Address *</label>
                <input type="text" name="projectAddress" value={formData.projectAddress} onChange={handleInputChange}
                  placeholder="e.g., 123 Main St"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#E67E22] focus:border-transparent" />
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-900 mb-1">City</label>
                  <input type="text" name="city" value={formData.city} onChange={handleInputChange} placeholder="City"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#E67E22] focus:border-transparent" />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-900 mb-1">State</label>
                  <input type="text" name="state" value={formData.state} onChange={handleInputChange} placeholder="TX" maxLength={2}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#E67E22] focus:border-transparent" />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-900 mb-1">Zip</label>
                  <input type="text" name="zip" value={formData.zip} onChange={handleInputChange} placeholder="75001"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#E67E22] focus:border-transparent" />
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-900 mb-1">Project Description *</label>
                <textarea name="description" value={formData.description} onChange={handleInputChange}
                  placeholder="Describe your project, scope, and requirements..." rows={3}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#E67E22] focus:border-transparent resize-none" />
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-900 mb-1">Product Categories * (comma-separated)</label>
                <input type="text" name="productCategories" value={formData.productCategories} onChange={handleInputChange}
                  placeholder="e.g., Interior Doors, Hardware, Trim"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#E67E22] focus:border-transparent" />
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-900 mb-1">Estimated Square Footage</label>
                <input type="number" name="estimatedSquareFootage" value={formData.estimatedSquareFootage} onChange={handleInputChange}
                  placeholder="e.g., 5000"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#E67E22] focus:border-transparent" />
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-900 mb-1">Preferred Delivery Date</label>
                <input type="date" name="preferredDeliveryDate" value={formData.preferredDeliveryDate} onChange={handleInputChange}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#E67E22] focus:border-transparent" />
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-900 mb-1">Additional Notes</label>
                <textarea name="notes" value={formData.notes} onChange={handleInputChange}
                  placeholder="Any additional information..." rows={2}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#E67E22] focus:border-transparent resize-none" />
              </div>

              <div className="flex gap-3 justify-end pt-4 border-t border-gray-200">
                <button type="button" onClick={() => { setShowModal(false); setError('') }}
                  className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 font-semibold hover:bg-gray-50 transition-colors">
                  Cancel
                </button>
                <button type="submit" disabled={submitting}
                  className="px-4 py-2 bg-[#E67E22] text-white rounded-lg font-semibold hover:bg-[#d35400] transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
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
