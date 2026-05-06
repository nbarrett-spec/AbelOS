'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

interface Builder {
  id: string
  companyName: string
  contactName: string
  email: string
  phone?: string
  paymentTerm: string
  status: string
  totalProjects: number
  totalQuotes: number
  totalRevenue: number
}

const PAYMENT_TERMS = ['PAY_AT_ORDER', 'PAY_ON_DELIVERY', 'NET_15', 'NET_30'] as const
const STATUSES = ['PENDING', 'ACTIVE', 'SUSPENDED', 'CLOSED'] as const

type ToastTone = 'success' | 'error'

interface NewBuilderForm {
  companyName: string
  contactName: string
  email: string
  phone: string
  address: string
  city: string
  state: string
  zip: string
  paymentTerm: string
  creditLimit: string
  taxExempt: boolean
  status: string
}

const EMPTY_FORM: NewBuilderForm = {
  companyName: '',
  contactName: '',
  email: '',
  phone: '',
  address: '',
  city: '',
  state: '',
  zip: '',
  paymentTerm: 'NET_30',
  creditLimit: '',
  taxExempt: false,
  status: 'PENDING',
}

export default function BuildersPage() {
  const [builders, setBuilders] = useState<Builder[]>([])
  const [searchTerm, setSearchTerm] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [toast, setToast] = useState<{ msg: string; tone: ToastTone } | null>(null)
  const [actingId, setActingId] = useState<string | null>(null)
  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState<NewBuilderForm>(EMPTY_FORM)
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState('')

  function showToast(msg: string, tone: ToastTone = 'success') {
    setToast({ msg, tone })
    setTimeout(() => setToast(null), 3500)
  }

  async function fetchBuilders() {
    try {
      const res = await fetch('/api/admin/builders')
      if (!res.ok) throw new Error('Failed to fetch builders')
      const data = await res.json()
      setBuilders(data.builders)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error fetching builders')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchBuilders()
  }, [])

  const filteredBuilders = builders.filter(
    (builder) =>
      builder.companyName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      builder.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
      builder.contactName.toLowerCase().includes(searchTerm.toLowerCase())
  )

  async function patchStatus(id: string, status: 'ACTIVE' | 'CLOSED', actionLabel: string) {
    setActingId(id)
    try {
      const res = await fetch(`/api/admin/builders/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error || `HTTP ${res.status}`)
      }
      showToast(`Builder ${actionLabel}`, 'success')
      // Optimistically update local row.
      setBuilders((prev) => prev.map((b) => (b.id === id ? { ...b, status } : b)))
    } catch (err: any) {
      showToast(err?.message || `Failed to ${actionLabel.toLowerCase()}`, 'error')
    } finally {
      setActingId(null)
    }
  }

  function handleApprove(builder: Builder) {
    patchStatus(builder.id, 'ACTIVE', 'approved')
  }

  function handleDeny(builder: Builder) {
    const ok = window.confirm(
      `Deny ${builder.companyName}?\n\nThis sets the builder status to CLOSED. They will not be able to access the portal.`
    )
    if (!ok) return
    patchStatus(builder.id, 'CLOSED', 'denied')
  }

  function openModal() {
    setForm(EMPTY_FORM)
    setFormError('')
    setShowModal(true)
  }

  function closeModal() {
    if (submitting) return
    setShowModal(false)
  }

  async function submitNewBuilder(e: React.FormEvent) {
    e.preventDefault()
    setFormError('')

    if (!form.companyName.trim()) {
      setFormError('Company name is required')
      return
    }
    if (!form.contactName.trim()) {
      setFormError('Contact name is required')
      return
    }
    if (!form.email.trim()) {
      setFormError('Email is required')
      return
    }

    setSubmitting(true)
    try {
      const payload: Record<string, any> = {
        companyName: form.companyName.trim(),
        contactName: form.contactName.trim(),
        email: form.email.trim(),
        phone: form.phone.trim() || undefined,
        address: form.address.trim() || undefined,
        city: form.city.trim() || undefined,
        state: form.state.trim() || undefined,
        zip: form.zip.trim() || undefined,
        paymentTerm: form.paymentTerm,
        taxExempt: form.taxExempt,
        status: form.status,
      }
      if (form.creditLimit.trim()) {
        const num = Number(form.creditLimit)
        if (Number.isNaN(num)) {
          setFormError('Credit limit must be a number')
          setSubmitting(false)
          return
        }
        payload.creditLimit = num
      }

      const res = await fetch('/api/admin/builders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(j.error || `HTTP ${res.status}`)
      }
      showToast('Builder created', 'success')
      setShowModal(false)
      // Refresh list to pick up the new row + aggregated stats.
      setLoading(true)
      await fetchBuilders()
    } catch (err: any) {
      setFormError(err?.message || 'Failed to create builder')
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return <div className="text-center py-12">Loading...</div>
  }

  if (error) {
    return <div className="text-center py-12 text-red-600">{error}</div>
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Builders</h1>
          <p className="text-gray-600 mt-2">Manage all builder accounts</p>
        </div>
        <button
          type="button"
          onClick={openModal}
          className="bg-brand text-white px-4 py-2 rounded-md font-medium hover:opacity-90 transition shrink-0"
        >
          + New Builder
        </button>
      </div>

      {/* Search Bar */}
      <div>
        <input
          type="text"
          placeholder="Search by company name, email, or contact..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="input max-w-md"
        />
      </div>

      {/* Builders Table */}
      <div className="card p-6">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-gray-200">
              <tr className="text-gray-600 font-semibold">
                <th className="text-left py-3 px-4">Company Name</th>
                <th className="text-left py-3 px-4 hidden sm:table-cell">Contact</th>
                <th className="text-left py-3 px-4 hidden md:table-cell">Email</th>
                <th className="text-left py-3 px-4 hidden lg:table-cell">Payment Term</th>
                <th className="text-left py-3 px-4 hidden sm:table-cell">Projects</th>
                <th className="text-left py-3 px-4 hidden md:table-cell">Quotes</th>
                <th className="text-left py-3 px-4">Status</th>
                <th className="text-left py-3 px-4">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredBuilders.length > 0 ? (
                filteredBuilders.map((builder) => {
                  const isPending = builder.status === 'PENDING'
                  const isActing = actingId === builder.id
                  return (
                    <tr
                      key={builder.id}
                      className="border-b border-gray-100 hover:bg-gray-50 transition"
                    >
                      <td className="py-3 px-4 font-medium text-brand">
                        {builder.companyName}
                      </td>
                      <td className="py-3 px-4 hidden sm:table-cell">{builder.contactName}</td>
                      <td className="py-3 px-4 text-gray-600 hidden md:table-cell">{builder.email}</td>
                      <td className="py-3 px-4 hidden lg:table-cell">
                        <span className="bg-blue-50 text-blue-800 px-2 py-1 rounded text-xs font-medium">
                          {builder.paymentTerm}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-center hidden sm:table-cell">
                        {builder.totalProjects}
                      </td>
                      <td className="py-3 px-4 text-center hidden md:table-cell">
                        {builder.totalQuotes}
                      </td>
                      <td className="py-3 px-4">
                        <span
                          className={`inline-block px-3 py-1 rounded-full text-xs font-medium ${
                            builder.status === 'ACTIVE'
                              ? 'bg-green-100 text-green-800'
                              : builder.status === 'PENDING'
                              ? 'bg-yellow-100 text-yellow-800'
                              : builder.status === 'SUSPENDED'
                              ? 'bg-red-100 text-red-800'
                              : 'bg-gray-100 text-gray-800'
                          }`}
                        >
                          {builder.status}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-3">
                          {isPending && (
                            <>
                              <button
                                type="button"
                                onClick={() => handleApprove(builder)}
                                disabled={isActing}
                                className="text-green-700 hover:underline font-medium disabled:opacity-50 disabled:no-underline"
                              >
                                Approve
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDeny(builder)}
                                disabled={isActing}
                                className="text-red-700 hover:underline font-medium disabled:opacity-50 disabled:no-underline"
                              >
                                Deny
                              </button>
                            </>
                          )}
                          <Link
                            href={`/admin/builders/${builder.id}`}
                            className="text-brand hover:underline font-medium"
                          >
                            View
                          </Link>
                        </div>
                      </td>
                    </tr>
                  )
                })
              ) : (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-gray-500">
                    {searchTerm
                      ? 'No builders match your search'
                      : 'No builders yet'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* New Builder Modal */}
      {showModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={closeModal}
        >
          <div
            className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <form onSubmit={submitNewBuilder}>
              <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
                <h2 className="text-xl font-semibold text-gray-900">New Builder</h2>
                <button
                  type="button"
                  onClick={closeModal}
                  className="text-gray-500 hover:text-gray-700 text-2xl leading-none"
                  aria-label="Close"
                  disabled={submitting}
                >
                  &times;
                </button>
              </div>

              <div className="px-6 py-4 space-y-4">
                {formError && (
                  <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded text-sm">
                    {formError}
                  </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="md:col-span-2">
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Company Name <span className="text-red-600">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      value={form.companyName}
                      onChange={(e) => setForm({ ...form, companyName: e.target.value })}
                      className="input w-full"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Contact Name <span className="text-red-600">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      value={form.contactName}
                      onChange={(e) => setForm({ ...form, contactName: e.target.value })}
                      className="input w-full"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Email <span className="text-red-600">*</span>
                    </label>
                    <input
                      type="email"
                      required
                      value={form.email}
                      onChange={(e) => setForm({ ...form, email: e.target.value })}
                      className="input w-full"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Phone
                    </label>
                    <input
                      type="tel"
                      value={form.phone}
                      onChange={(e) => setForm({ ...form, phone: e.target.value })}
                      className="input w-full"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Status
                    </label>
                    <select
                      value={form.status}
                      onChange={(e) => setForm({ ...form, status: e.target.value })}
                      className="input w-full"
                    >
                      {STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="md:col-span-2">
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Address
                    </label>
                    <input
                      type="text"
                      value={form.address}
                      onChange={(e) => setForm({ ...form, address: e.target.value })}
                      className="input w-full"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      City
                    </label>
                    <input
                      type="text"
                      value={form.city}
                      onChange={(e) => setForm({ ...form, city: e.target.value })}
                      className="input w-full"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        State
                      </label>
                      <input
                        type="text"
                        maxLength={2}
                        value={form.state}
                        onChange={(e) => setForm({ ...form, state: e.target.value.toUpperCase() })}
                        className="input w-full"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Zip
                      </label>
                      <input
                        type="text"
                        value={form.zip}
                        onChange={(e) => setForm({ ...form, zip: e.target.value })}
                        className="input w-full"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Payment Term
                    </label>
                    <select
                      value={form.paymentTerm}
                      onChange={(e) => setForm({ ...form, paymentTerm: e.target.value })}
                      className="input w-full"
                    >
                      {PAYMENT_TERMS.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Credit Limit
                    </label>
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      value={form.creditLimit}
                      onChange={(e) => setForm({ ...form, creditLimit: e.target.value })}
                      className="input w-full"
                    />
                  </div>

                  <div className="md:col-span-2">
                    <label className="flex items-center gap-2 text-sm text-gray-700">
                      <input
                        type="checkbox"
                        checked={form.taxExempt}
                        onChange={(e) => setForm({ ...form, taxExempt: e.target.checked })}
                      />
                      Tax exempt
                    </label>
                  </div>
                </div>
              </div>

              <div className="px-6 py-4 border-t border-gray-200 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={closeModal}
                  disabled={submitting}
                  className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-md disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="bg-brand text-white px-4 py-2 rounded-md font-medium hover:opacity-90 disabled:opacity-50"
                >
                  {submitting ? 'Creating...' : 'Create Builder'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div
          className={`fixed bottom-6 right-6 px-4 py-3 rounded-lg shadow-lg text-sm font-medium z-50 ${
            toast.tone === 'success'
              ? 'bg-green-600 text-white'
              : 'bg-red-600 text-white'
          }`}
        >
          {toast.msg}
        </div>
      )}
    </div>
  )
}
