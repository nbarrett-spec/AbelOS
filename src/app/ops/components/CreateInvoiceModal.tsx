'use client'

import { useState, useEffect } from 'react'
import { Modal } from './Modal'

interface Builder {
  id: string
  companyName: string
}

interface Job {
  id: string
  jobNumber: string
  builderName: string
}

interface InvoiceItem {
  id: string
  description: string
  quantity: number
  unitPrice: number
}

interface CreateInvoiceModalProps {
  isOpen: boolean
  onClose: () => void
  onSuccess: () => void
}

const PAYMENT_TERMS = [
  { value: 'PAY_AT_ORDER', label: 'Pay at Order' },
  { value: 'PAY_ON_DELIVERY', label: 'Pay on Delivery' },
  { value: 'NET_15', label: 'Net 15' },
  { value: 'NET_30', label: 'Net 30' },
]

export function CreateInvoiceModal({
  isOpen,
  onClose,
  onSuccess,
}: CreateInvoiceModalProps) {
  const [formData, setFormData] = useState({
    builderId: '',
    jobId: '',
    paymentTerm: 'NET_30',
    dueDate: '',
    notes: '',
  })

  const [items, setItems] = useState<InvoiceItem[]>([
    { id: '1', description: '', quantity: 1, unitPrice: 0 },
  ])

  const [builders, setBuilders] = useState<Builder[]>([])
  const [jobs, setJobs] = useState<Job[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const fetchBuilders = async () => {
      try {
        const response = await fetch('/api/ops/builders')
        if (response.ok) {
          const data = await response.json()
          setBuilders(Array.isArray(data) ? data : data.data || [])
        }
      } catch (err) {
        console.error('Failed to fetch builders:', err)
      }
    }

    if (isOpen) {
      fetchBuilders()
    }
  }, [isOpen])

  useEffect(() => {
    const fetchJobs = async () => {
      if (!formData.builderId) {
        setJobs([])
        return
      }

      try {
        const response = await fetch(`/api/ops/jobs?builderName=${encodeURIComponent(formData.builderId)}`)
        if (response.ok) {
          const data = await response.json()
          setJobs(Array.isArray(data.data) ? data.data : data.jobs || [])
        }
      } catch (err) {
        console.error('Failed to fetch jobs:', err)
      }
    }

    fetchJobs()
  }, [formData.builderId])

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>
  ) => {
    const { name, value } = e.target
    setFormData((prev) => ({
      ...prev,
      [name]: value,
    }))
  }

  const handleItemChange = (index: number, field: string, value: any) => {
    const newItems = [...items]
    newItems[index] = {
      ...newItems[index],
      [field]: field === 'quantity' || field === 'unitPrice' ? parseFloat(value) || 0 : value,
    }
    setItems(newItems)
  }

  const addItem = () => {
    setItems([
      ...items,
      {
        id: Date.now().toString(),
        description: '',
        quantity: 1,
        unitPrice: 0,
      },
    ])
  }

  const removeItem = (index: number) => {
    if (items.length > 1) {
      setItems(items.filter((_, i) => i !== index))
    }
  }

  const calculateLineTotal = (quantity: number, unitPrice: number) => {
    return quantity * unitPrice
  }

  const calculateTotal = () => {
    return items.reduce((sum, item) => sum + calculateLineTotal(item.quantity, item.unitPrice), 0)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)

    try {
      if (!formData.builderId) {
        throw new Error('Please select a builder')
      }

      if (items.some((item) => !item.description || item.quantity <= 0 || item.unitPrice <= 0)) {
        throw new Error('All line items must have a description, quantity, and unit price')
      }

      const payload = {
        builderId: formData.builderId,
        jobId: formData.jobId || undefined,
        paymentTerm: formData.paymentTerm,
        dueDate: formData.dueDate ? new Date(formData.dueDate).toISOString() : new Date(),
        notes: formData.notes || undefined,
        items: items.map((item) => ({
          description: item.description,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          lineTotal: calculateLineTotal(item.quantity, item.unitPrice),
        })),
      }

      const response = await fetch('/api/ops/invoices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to create invoice')
      }

      // Reset form
      setFormData({
        builderId: '',
        jobId: '',
        paymentTerm: 'NET_30',
        dueDate: '',
        notes: '',
      })
      setItems([{ id: '1', description: '', quantity: 1, unitPrice: 0 }])

      onSuccess()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create invoice')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Create Invoice" size="xl">
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
            {error}
          </div>
        )}

        <div className="grid grid-cols-2 gap-4">
          {/* Builder */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Builder <span className="text-red-500">*</span>
            </label>
            <select
              name="builderId"
              value={formData.builderId}
              onChange={handleChange}
              required
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#3E2A1E]/20 focus:border-[#3E2A1E]"
            >
              <option value="">Select a builder</option>
              {builders.map((builder) => (
                <option key={builder.id} value={builder.id}>
                  {builder.companyName}
                </option>
              ))}
            </select>
          </div>

          {/* Job */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Job
            </label>
            <select
              name="jobId"
              value={formData.jobId}
              onChange={handleChange}
              disabled={!formData.builderId}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#3E2A1E]/20 focus:border-[#3E2A1E] disabled:bg-gray-50"
            >
              <option value="">Select a job (optional)</option>
              {jobs.map((job) => (
                <option key={job.id} value={job.id}>
                  {job.jobNumber}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          {/* Payment Term */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Payment Terms <span className="text-red-500">*</span>
            </label>
            <select
              name="paymentTerm"
              value={formData.paymentTerm}
              onChange={handleChange}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#3E2A1E]/20 focus:border-[#3E2A1E]"
            >
              {PAYMENT_TERMS.map((term) => (
                <option key={term.value} value={term.value}>
                  {term.label}
                </option>
              ))}
            </select>
          </div>

          {/* Due Date */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Due Date
            </label>
            <input
              type="date"
              name="dueDate"
              value={formData.dueDate}
              onChange={handleChange}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#3E2A1E]/20 focus:border-[#3E2A1E]"
            />
          </div>
        </div>

        {/* Line Items */}
        <div className="border-t pt-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-medium text-gray-900">Line Items</h3>
            <button
              type="button"
              onClick={addItem}
              className="px-3 py-1 text-sm bg-[#C9822B] text-white rounded-lg hover:bg-[#A86B1F] transition-colors"
            >
              + Add Item
            </button>
          </div>

          <div className="space-y-3 max-h-48 overflow-y-auto">
            {items.map((item, index) => (
              <div key={item.id} className="flex gap-2 items-end">
                <div className="flex-1">
                  <input
                    type="text"
                    value={item.description}
                    onChange={(e) => handleItemChange(index, 'description', e.target.value)}
                    placeholder="Description"
                    className="w-full px-2 py-2 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-[#3E2A1E]/20 focus:border-[#3E2A1E]"
                  />
                </div>
                <div className="w-20">
                  <input
                    type="number"
                    value={item.quantity}
                    onChange={(e) => handleItemChange(index, 'quantity', e.target.value)}
                    placeholder="Qty"
                    min="1"
                    className="w-full px-2 py-2 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-[#3E2A1E]/20 focus:border-[#3E2A1E]"
                  />
                </div>
                <div className="w-24">
                  <input
                    type="number"
                    value={item.unitPrice}
                    onChange={(e) => handleItemChange(index, 'unitPrice', e.target.value)}
                    placeholder="Price"
                    step="0.01"
                    min="0"
                    className="w-full px-2 py-2 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-[#3E2A1E]/20 focus:border-[#3E2A1E]"
                  />
                </div>
                <div className="w-24 text-right">
                  <div className="text-sm font-medium text-gray-900">
                    ${calculateLineTotal(item.quantity, item.unitPrice).toFixed(2)}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => removeItem(index)}
                  disabled={items.length === 1}
                  className="px-2 py-2 text-red-600 hover:text-red-800 disabled:text-gray-300 disabled:cursor-not-allowed"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>

          <div className="flex justify-end mt-3 pt-3 border-t">
            <div className="w-48">
              <div className="flex justify-between text-sm mb-2">
                <span className="text-gray-600">Subtotal:</span>
                <span className="font-medium">${calculateTotal().toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-base font-bold">
                <span>Total:</span>
                <span className="text-[#3E2A1E]">${calculateTotal().toFixed(2)}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Notes */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Notes
          </label>
          <textarea
            name="notes"
            value={formData.notes}
            onChange={handleChange}
            placeholder="Payment instructions, special notes, etc."
            rows={2}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#3E2A1E]/20 focus:border-[#3E2A1E]"
          />
        </div>

        {/* Buttons */}
        <div className="flex gap-3 justify-end pt-4 border-t">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={loading}
            className="px-4 py-2 text-sm bg-[#3E2A1E] text-white rounded-lg hover:bg-[#2A1C14] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? 'Creating...' : 'Create Invoice'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
