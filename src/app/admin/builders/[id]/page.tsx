'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { formatCurrency, formatDate } from '@/lib/utils'

interface BuilderDetail {
  id: string
  companyName: string
  contactName: string
  email: string
  phone?: string
  address?: string
  city?: string
  state?: string
  zip?: string
  paymentTerm: string
  status: string
  accountBalance: number
  taxExempt: boolean
  taxId?: string
  customPricingCount: number
}

interface Project {
  id: string
  name: string
  status: string
  createdAt: string
}

interface Quote {
  id: string
  quoteNumber: string
  total: number
  status: string
  createdAt: string
}

const PAYMENT_TERMS = ['PAY_AT_ORDER', 'PAY_ON_DELIVERY', 'NET_15', 'NET_30']
const STATUSES = ['PENDING', 'ACTIVE', 'SUSPENDED', 'CLOSED']

export default function BuilderDetailPage() {
  const params = useParams()
  const builderId = params.id as string

  const [builder, setBuilder] = useState<BuilderDetail | null>(null)
  const [projects, setProjects] = useState<Project[]>([])
  const [quotes, setQuotes] = useState<Quote[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [updating, setUpdating] = useState(false)
  const [editPaymentTerm, setEditPaymentTerm] = useState('')
  const [editStatus, setEditStatus] = useState('')
  const [toast, setToast] = useState('')
  const [toastType, setToastType] = useState<'success' | 'error'>('success')
  const showToast = (msg: string, type: 'success' | 'error' = 'success') => {
    setToast(msg); setToastType(type); setTimeout(() => setToast(''), 3500)
  }

  useEffect(() => {
    async function fetchBuilder() {
      try {
        const res = await fetch(`/api/admin/builders/${builderId}`)
        if (!res.ok) throw new Error('Failed to fetch builder')
        const data = await res.json()
        setBuilder(data.builder)
        setProjects(data.builder.projects)
        setQuotes(data.quotes)
        setEditPaymentTerm(data.builder.paymentTerm)
        setEditStatus(data.builder.status)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Error fetching builder')
      } finally {
        setLoading(false)
      }
    }

    fetchBuilder()
  }, [builderId])

  const handleUpdateBuilder = async () => {
    if (!builder) return

    setUpdating(true)
    try {
      const res = await fetch(`/api/admin/builders/${builderId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: editStatus,
          paymentTerm: editPaymentTerm,
        }),
      })

      if (!res.ok) throw new Error('Failed to update builder')
      const data = await res.json()
      setBuilder({ ...builder, ...data.builder })
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Error updating builder', 'error')
    } finally {
      setUpdating(false)
    }
  }

  if (loading) {
    return <div className="text-center py-12">Loading...</div>
  }

  if (error || !builder) {
    return <div className="text-center py-12 text-red-600">{error || 'Builder not found'}</div>
  }

  return (
    <div className="space-y-8">
      {toast && (
        <div className={`fixed top-4 right-4 z-50 px-5 py-3 rounded-lg shadow-lg text-white text-sm font-medium transition-all ${toastType === 'success' ? 'bg-green-600' : 'bg-red-600'}`}>
          {toast}
        </div>
      )}
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <Link href="/admin/builders" className="text-abel-navy hover:underline text-sm font-medium mb-2 inline-block">
            ← Back to Builders
          </Link>
          <h1 className="text-3xl font-bold text-gray-900">{builder.companyName}</h1>
          <p className="text-gray-600 mt-1">{builder.contactName}</p>
        </div>
      </div>

      {/* Main Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Contact Info Card */}
        <div className="card p-6">
          <h2 className="text-lg font-bold text-gray-900 mb-4">Contact Info</h2>
          <div className="space-y-3 text-sm">
            <div>
              <p className="text-gray-600 font-medium">Email</p>
              <p className="text-gray-900">{builder.email}</p>
            </div>
            <div>
              <p className="text-gray-600 font-medium">Phone</p>
              <p className="text-gray-900">{builder.phone || 'N/A'}</p>
            </div>
            {builder.address && (
              <div>
                <p className="text-gray-600 font-medium">Address</p>
                <p className="text-gray-900">
                  {builder.address}
                  {builder.city && `, ${builder.city}`}
                  {builder.state && `, ${builder.state}`}
                  {builder.zip && ` ${builder.zip}`}
                </p>
              </div>
            )}
            {builder.taxId && (
              <div>
                <p className="text-gray-600 font-medium">Tax ID</p>
                <p className="text-gray-900">{builder.taxId}</p>
              </div>
            )}
          </div>
        </div>

        {/* Account Info Card */}
        <div className="card p-6">
          <h2 className="text-lg font-bold text-gray-900 mb-4">Account Info</h2>
          <div className="space-y-3 text-sm">
            <div>
              <p className="text-gray-600 font-medium">Balance</p>
              <p className={`text-lg font-semibold ${builder.accountBalance >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                {formatCurrency(builder.accountBalance)}
              </p>
            </div>
            <div>
              <p className="text-gray-600 font-medium">Custom Pricing</p>
              <p className="text-gray-900">{builder.customPricingCount} products</p>
            </div>
            <div>
              <p className="text-gray-600 font-medium">Tax Exempt</p>
              <p className="text-gray-900">{builder.taxExempt ? 'Yes' : 'No'}</p>
            </div>
          </div>
        </div>

        {/* Settings Card */}
        <div className="card p-6">
          <h2 className="text-lg font-bold text-gray-900 mb-4">Settings</h2>
          <div className="space-y-4">
            <div>
              <label className="label">Payment Term</label>
              <select
                value={editPaymentTerm}
                onChange={(e) => setEditPaymentTerm(e.target.value)}
                className="input text-sm"
              >
                {PAYMENT_TERMS.map((term) => (
                  <option key={term} value={term}>
                    {term}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Status</label>
              <select
                value={editStatus}
                onChange={(e) => setEditStatus(e.target.value)}
                className="input text-sm"
              >
                {STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ))}
              </select>
            </div>
            <button
              onClick={handleUpdateBuilder}
              disabled={updating}
              className="btn-primary w-full disabled:opacity-50"
            >
              {updating ? 'Updating...' : 'Save Changes'}
            </button>
          </div>
        </div>
      </div>

      {/* Projects Section */}
      <div className="card p-6">
        <h2 className="text-lg font-bold text-gray-900 mb-4">
          Projects ({projects.length})
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-gray-200">
              <tr className="text-gray-600 font-semibold">
                <th className="text-left py-3 px-4">Project Name</th>
                <th className="text-left py-3 px-4">Status</th>
                <th className="text-left py-3 px-4">Created</th>
              </tr>
            </thead>
            <tbody>
              {projects.length > 0 ? (
                projects.map((project) => (
                  <tr
                    key={project.id}
                    className="border-b border-gray-100 hover:bg-gray-50"
                  >
                    <td className="py-3 px-4 font-medium text-abel-navy">
                      {project.name}
                    </td>
                    <td className="py-3 px-4">
                      <span className="inline-block px-2 py-1 rounded text-xs font-medium bg-blue-50 text-blue-800">
                        {project.status}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-gray-600">
                      {formatDate(project.createdAt)}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={3} className="py-8 text-center text-gray-500">
                    No projects yet
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Recent Quotes Section */}
      <div className="card p-6">
        <h2 className="text-lg font-bold text-gray-900 mb-4">
          Recent Quotes ({quotes.length})
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-gray-200">
              <tr className="text-gray-600 font-semibold">
                <th className="text-left py-3 px-4">Quote Number</th>
                <th className="text-left py-3 px-4">Total</th>
                <th className="text-left py-3 px-4">Status</th>
                <th className="text-left py-3 px-4">Date</th>
              </tr>
            </thead>
            <tbody>
              {quotes.length > 0 ? (
                quotes.map((quote) => (
                  <tr
                    key={quote.id}
                    className="border-b border-gray-100 hover:bg-gray-50"
                  >
                    <td className="py-3 px-4 font-medium text-abel-navy">
                      {quote.quoteNumber}
                    </td>
                    <td className="py-3 px-4 font-semibold">
                      {formatCurrency(quote.total)}
                    </td>
                    <td className="py-3 px-4">
                      <span
                        className={`inline-block px-3 py-1 rounded-full text-xs font-medium ${
                          quote.status === 'APPROVED'
                            ? 'bg-green-100 text-green-800'
                            : quote.status === 'SENT'
                            ? 'bg-blue-100 text-blue-800'
                            : quote.status === 'DRAFT'
                            ? 'bg-gray-100 text-gray-800'
                            : 'bg-orange-100 text-orange-800'
                        }`}
                      >
                        {quote.status}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-gray-600">
                      {formatDate(quote.createdAt)}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={4} className="py-8 text-center text-gray-500">
                    No quotes yet
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
