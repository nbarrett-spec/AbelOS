'use client'

import { useState, useEffect } from 'react'
import { Modal } from './Modal'

interface Vendor {
  id: string
  name: string
}

interface POItem {
  id: string
  vendorSku: string
  description: string
  quantity: number
  unitCost: number
}

interface CreatePOModalProps {
  isOpen: boolean
  onClose: () => void
  onSuccess: () => void
}

export function CreatePOModal({
  isOpen,
  onClose,
  onSuccess,
}: CreatePOModalProps) {
  const [formData, setFormData] = useState({
    vendorId: '',
    expectedDate: '',
    notes: '',
  })

  const [items, setItems] = useState<POItem[]>([
    { id: '1', vendorSku: '', description: '', quantity: 1, unitCost: 0 },
  ])

  const [vendors, setVendors] = useState<Vendor[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const fetchVendors = async () => {
      try {
        const response = await fetch('/api/ops/vendors')
        if (response.ok) {
          const data = await response.json()
          setVendors(Array.isArray(data) ? data : data.vendors || [])
        }
      } catch (err) {
        console.error('Failed to fetch vendors:', err)
      }
    }

    if (isOpen) {
      fetchVendors()
    }
  }, [isOpen])

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
      [field]: field === 'quantity' || field === 'unitCost' ? parseFloat(value) || 0 : value,
    }
    setItems(newItems)
  }

  const addItem = () => {
    setItems([
      ...items,
      {
        id: Date.now().toString(),
        vendorSku: '',
        description: '',
        quantity: 1,
        unitCost: 0,
      },
    ])
  }

  const removeItem = (index: number) => {
    if (items.length > 1) {
      setItems(items.filter((_, i) => i !== index))
    }
  }

  const calculateLineTotal = (quantity: number, unitCost: number) => {
    return quantity * unitCost
  }

  const calculateTotal = () => {
    return items.reduce((sum, item) => sum + calculateLineTotal(item.quantity, item.unitCost), 0)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)

    try {
      if (!formData.vendorId) {
        throw new Error('Please select a vendor')
      }

      if (items.some((item) => !item.description || item.quantity <= 0 || item.unitCost < 0)) {
        throw new Error('All line items must have a description, quantity, and unit cost')
      }

      const payload = {
        vendorId: formData.vendorId,
        expectedDate: formData.expectedDate ? new Date(formData.expectedDate).toISOString() : undefined,
        notes: formData.notes || undefined,
        items: items.map((item) => ({
          vendorSku: item.vendorSku,
          description: item.description,
          quantity: item.quantity,
          unitCost: item.unitCost,
        })),
      }

      const response = await fetch('/api/ops/purchasing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to create purchase order')
      }

      // Reset form
      setFormData({
        vendorId: '',
        expectedDate: '',
        notes: '',
      })
      setItems([{ id: '1', vendorSku: '', description: '', quantity: 1, unitCost: 0 }])

      onSuccess()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create purchase order')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Create Purchase Order" size="xl">
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="panel panel-live p-3 text-sm text-data-negative">
            {error}
          </div>
        )}

        <div className="grid grid-cols-2 gap-4">
          {/* Vendor */}
          <div>
            <label className="label">
              Vendor <span className="text-red-500">*</span>
            </label>
            <select
              name="vendorId"
              value={formData.vendorId}
              onChange={handleChange}
              required
              className="input"
            >
              <option value="">Select a vendor</option>
              {vendors.map((vendor) => (
                <option key={vendor.id} value={vendor.id}>
                  {vendor.name}
                </option>
              ))}
            </select>
          </div>

          {/* Expected Date */}
          <div>
            <label className="label">
              Expected Delivery Date
            </label>
            <input
              type="date"
              name="expectedDate"
              value={formData.expectedDate}
              onChange={handleChange}
              className="input"
            />
          </div>
        </div>

        {/* Line Items */}
        <div className="border-t border-border pt-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="eyebrow">Line Items</h3>
            <button type="button" onClick={addItem} className="btn btn-secondary btn-sm">
              + Add Item
            </button>
          </div>

          <div className="space-y-3 max-h-48 overflow-y-auto">
            {items.map((item, index) => (
              <div key={item.id} className="flex gap-2 items-end text-sm">
                <div className="w-24">
                  <input
                    type="text"
                    value={item.vendorSku}
                    onChange={(e) => handleItemChange(index, 'vendorSku', e.target.value)}
                    placeholder="Vendor SKU"
                    className="input"
                  />
                </div>
                <div className="flex-1">
                  <input
                    type="text"
                    value={item.description}
                    onChange={(e) => handleItemChange(index, 'description', e.target.value)}
                    placeholder="Description"
                    className="input"
                  />
                </div>
                <div className="w-20">
                  <input
                    type="number"
                    value={item.quantity}
                    onChange={(e) => handleItemChange(index, 'quantity', e.target.value)}
                    placeholder="Qty"
                    min="1"
                    className="input"
                  />
                </div>
                <div className="w-24">
                  <input
                    type="number"
                    value={item.unitCost}
                    onChange={(e) => handleItemChange(index, 'unitCost', e.target.value)}
                    placeholder="Cost"
                    step="0.01"
                    min="0"
                    className="input"
                  />
                </div>
                <div className="w-24 text-right">
                  <div className="font-medium text-gray-900">
                    ${calculateLineTotal(item.quantity, item.unitCost).toFixed(2)}
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

          <div className="flex justify-end mt-3 pt-3 border-t border-border">
            <div className="w-48">
              <div className="flex justify-between text-sm mb-2">
                <span className="text-fg-muted">Subtotal</span>
                <span className="font-medium font-numeric tabular-nums text-fg">${calculateTotal().toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-base font-bold">
                <span className="text-fg">Total</span>
                <span className="text-brand font-numeric tabular-nums">${calculateTotal().toFixed(2)}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Notes */}
        <div>
          <label className="label">Notes</label>
          <textarea
            name="notes"
            value={formData.notes}
            onChange={handleChange}
            placeholder="Special instructions, shipping notes, etc."
            rows={2}
            className="input"
          />
        </div>

        {/* Buttons */}
        <div className="flex gap-2 justify-end pt-4 border-t border-border">
          <button type="button" onClick={onClose} className="btn btn-ghost btn-sm">
            Cancel
          </button>
          <button
            type="submit"
            disabled={loading}
            className="btn btn-primary btn-sm disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {loading ? 'Creating...' : 'Create PO'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
