'use client'

import { useState } from 'react'
import { X, AlertTriangle } from 'lucide-react'

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
    setFormData((prev) => ({ ...prev, [name]: value }))
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
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="panel panel-elevated max-w-md w-full max-h-[90vh] overflow-y-auto scrollbar-thin">
        <div className="sticky top-0 bg-surface border-b border-border px-6 py-4 flex items-center justify-between z-10">
          <div>
            <div className="eyebrow">Procurement</div>
            <h2 className="text-lg font-semibold text-fg">Add New Vendor</h2>
          </div>
          <button onClick={onClose} className="btn btn-ghost btn-sm" aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          {error && (
            <div className="panel panel-live p-3 flex items-start gap-2 text-sm text-data-negative">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <div>
            <label className="label">Vendor Name <span className="text-data-negative">*</span></label>
            <input
              type="text"
              name="name"
              value={formData.name}
              onChange={handleChange}
              required
              placeholder="e.g., DW Distribution"
              className="input"
            />
          </div>

          <div>
            <label className="label">Vendor Code <span className="text-data-negative">*</span></label>
            <input
              type="text"
              name="code"
              value={formData.code}
              onChange={handleChange}
              required
              placeholder="e.g., DW, BC, MASO"
              className="input font-mono"
            />
          </div>

          <div>
            <label className="label">Contact Name</label>
            <input
              type="text"
              name="contactName"
              value={formData.contactName}
              onChange={handleChange}
              placeholder="John Smith"
              className="input"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Email</label>
              <input
                type="email"
                name="email"
                value={formData.email}
                onChange={handleChange}
                placeholder="contact@vendor.com"
                className="input"
              />
            </div>
            <div>
              <label className="label">Phone</label>
              <input
                type="tel"
                name="phone"
                value={formData.phone}
                onChange={handleChange}
                placeholder="(555) 123-4567"
                className="input"
              />
            </div>
          </div>

          <div>
            <label className="label">Address</label>
            <input
              type="text"
              name="address"
              value={formData.address}
              onChange={handleChange}
              placeholder="123 Main St, City, State 12345"
              className="input"
            />
          </div>

          <div>
            <label className="label">Website</label>
            <input
              type="url"
              name="website"
              value={formData.website}
              onChange={handleChange}
              placeholder="https://www.vendor.com"
              className="input"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Account Number</label>
              <input
                type="text"
                name="accountNumber"
                value={formData.accountNumber}
                onChange={handleChange}
                placeholder="Abel's acct #"
                className="input"
              />
            </div>
            <div>
              <label className="label">Avg Lead Days</label>
              <input
                type="number"
                name="avgLeadDays"
                value={formData.avgLeadDays}
                onChange={handleChange}
                placeholder="5"
                min="0"
                className="input"
              />
            </div>
          </div>

          <div className="border-t border-border pt-4 flex gap-2 justify-end">
            <button type="button" onClick={onClose} className="btn btn-ghost btn-sm">
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || !formData.name || !formData.code}
              className="btn btn-primary btn-sm disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {loading ? 'Creating...' : 'Create Vendor'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
