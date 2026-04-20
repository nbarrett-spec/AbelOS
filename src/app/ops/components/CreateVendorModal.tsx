'use client'

import { useState } from 'react'

interface CreateVendorModalProps {
  onClose: () => void
  onVendorCreated: () => void
}

export function CreateVendorModal({ onClose, onVendorCreated }: CreateVendorModalProps) {
  const [formData, setFormData] = useState({
    name: '',
    code: '',
    contactName: '',
    email: '',
    phone: '',
    address: '',
    website: '',
    accountNumber: '',
    avgLeadDays: '',
  })

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => {
    const { name, value } = e.target
    setFormData((prev) => ({
      ...prev,
      [name]: value,
    }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)

    try {
      const res = await fetch('/api/ops/vendors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: formData.name,
          code: formData.code,
          contactName: formData.contactName || null,
          email: formData.email || null,
          phone: formData.phone || null,
          address: formData.address || null,
          website: formData.website || null,
          accountNumber: formData.accountNumber || null,
          avgLeadDays: formData.avgLeadDays ? parseInt(formData.avgLeadDays) : null,
        }),
      })

      if (!res.ok) {
        const errorData = await res.json()
        throw new Error(errorData.error || 'Failed to create vendor')
      }

      onVendorCreated()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg max-w-md w-full max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-white border-b px-6 py-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-gray-900">Add New Vendor</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-2xl leading-none"
          >
            ×
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-4 space-y-4">
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">
              {error}
            </div>
          )}

          <div>
            <label className="block text-xs text-gray-500 uppercase font-semibold mb-2">
              Vendor Name *
            </label>
            <input
              type="text"
              name="name"
              value={formData.name}
              onChange={handleChange}
              required
              placeholder="e.g., DW Distribution"
              className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#C9822B]"
            />
          </div>

          <div>
            <label className="block text-xs text-gray-500 uppercase font-semibold mb-2">
              Vendor Code *
            </label>
            <input
              type="text"
              name="code"
              value={formData.code}
              onChange={handleChange}
              required
              placeholder="e.g., DW, BC, MASO"
              className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#C9822B] font-mono"
            />
          </div>

          <div>
            <label className="block text-xs text-gray-500 uppercase font-semibold mb-2">
              Contact Name
            </label>
            <input
              type="text"
              name="contactName"
              value={formData.contactName}
              onChange={handleChange}
              placeholder="John Smith"
              className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#C9822B]"
            />
          </div>

          <div>
            <label className="block text-xs text-gray-500 uppercase font-semibold mb-2">
              Email
            </label>
            <input
              type="email"
              name="email"
              value={formData.email}
              onChange={handleChange}
              placeholder="contact@vendor.com"
              className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#C9822B]"
            />
          </div>

          <div>
            <label className="block text-xs text-gray-500 uppercase font-semibold mb-2">
              Phone
            </label>
            <input
              type="tel"
              name="phone"
              value={formData.phone}
              onChange={handleChange}
              placeholder="(555) 123-4567"
              className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#C9822B]"
            />
          </div>

          <div>
            <label className="block text-xs text-gray-500 uppercase font-semibold mb-2">
              Address
            </label>
            <input
              type="text"
              name="address"
              value={formData.address}
              onChange={handleChange}
              placeholder="123 Main St, City, State 12345"
              className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#C9822B]"
            />
          </div>

          <div>
            <label className="block text-xs text-gray-500 uppercase font-semibold mb-2">
              Website
            </label>
            <input
              type="url"
              name="website"
              value={formData.website}
              onChange={handleChange}
              placeholder="https://www.vendor.com"
              className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#C9822B]"
            />
          </div>

          <div>
            <label className="block text-xs text-gray-500 uppercase font-semibold mb-2">
              Account Number
            </label>
            <input
              type="text"
              name="accountNumber"
              value={formData.accountNumber}
              onChange={handleChange}
              placeholder="Abel's account number with vendor"
              className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#C9822B]"
            />
          </div>

          <div>
            <label className="block text-xs text-gray-500 uppercase font-semibold mb-2">
              Average Lead Days
            </label>
            <input
              type="number"
              name="avgLeadDays"
              value={formData.avgLeadDays}
              onChange={handleChange}
              placeholder="5"
              min="0"
              className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#C9822B]"
            />
          </div>

          <div className="border-t pt-4 flex gap-2 justify-end">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-gray-700 rounded-lg hover:bg-gray-100 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-4 py-2 text-sm font-medium text-white bg-[#C9822B] rounded-lg hover:bg-[#D46D1A] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? 'Creating...' : 'Create Vendor'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
