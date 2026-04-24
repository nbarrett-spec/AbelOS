// Legacy client component for /admin/builders/[id].
//
// Extracted unchanged from the original page.tsx so the server-component
// wrapper (page.tsx) can mount it inside the "Details" tab. All editing
// logic (payment term, status, auto-invoice toggle) lives here exactly as
// before — no behavior change. Renders below the new Overview tab sections.

'use client'

import { useEffect, useState } from 'react'
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
  autoInvoiceOnDelivery?: boolean
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

export default function BuilderDetailClient({ builderId }: { builderId: string }) {
  const [builder, setBuilder] = useState<BuilderDetail | null>(null)
  const [projects, setProjects] = useState<Project[]>([])
  const [quotes, setQuotes] = useState<Quote[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [updating, setUpdating] = useState(false)
  const [editPaymentTerm, setEditPaymentTerm] = useState('')
  const [editStatus, setEditStatus] = useState('')
  const [autoInvoiceOnDelivery, setAutoInvoiceOnDelivery] = useState(true)
  const [savingToggle, setSavingToggle] = useState(false)
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

        // Settings (autoInvoiceOnDelivery etc.) live on the ops endpoint to
        // keep the admin core payload stable. Fetch separately; failure is
        // non-fatal — we fall back to the default (true).
        try {
          const settingsRes = await fetch(`/api/ops/builders/${builderId}/settings`)
          if (settingsRes.ok) {
            const settingsData = await settingsRes.json()
            setAutoInvoiceOnDelivery(settingsData.settings?.autoInvoiceOnDelivery ?? true)
          }
        } catch {
          // keep defaults
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Error fetching builder')
      } finally {
        setLoading(false)
      }
    }

    fetchBuilder()
  }, [builderId])

  const handleToggleAutoInvoice = async (next: boolean) => {
    setSavingToggle(true)
    const prev = autoInvoiceOnDelivery
    // Optimistic update so the switch feels responsive; revert on failure.
    setAutoInvoiceOnDelivery(next)
    try {
      const res = await fetch(`/api/ops/builders/${builderId}/settings`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ autoInvoiceOnDelivery: next }),
      })
      if (!res.ok) throw new Error('Failed to save toggle')
      showToast(
        next
          ? 'Auto-invoice on delivery enabled'
          : 'Auto-invoice on delivery disabled'
      )
    } catch (err) {
      setAutoInvoiceOnDelivery(prev)
      showToast('Could not save setting', 'error')
    } finally {
      setSavingToggle(false)
    }
  }

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

            <div className="pt-4 mt-2 border-t border-gray-200">
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={autoInvoiceOnDelivery}
                  onChange={(e) => handleToggleAutoInvoice(e.target.checked)}
                  disabled={savingToggle}
                  className="mt-1 h-4 w-4 rounded border-gray-300 text-brand focus:ring-brand"
                />
                <span className="text-sm">
                  <span className="font-medium text-gray-900 block">
                    Auto-invoice on delivery
                  </span>
                  <span className="text-gray-600 text-xs">
                    When on, a DRAFT invoice is created automatically the moment
                    a delivery is marked complete. Turn off for COD / prepay
                    accounts that invoice manually.
                  </span>
                </span>
              </label>
            </div>
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
                    <td className="py-3 px-4 font-medium text-brand">
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
                    <td className="py-3 px-4 font-medium text-brand">
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
