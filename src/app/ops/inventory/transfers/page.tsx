'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'

interface TransferItem {
  productId: string
  sku?: string
  productName?: string
  quantity: number
  damagedQty?: number
  notes?: string
}

interface Transfer {
  id: string
  transferNumber: string
  fromLocation: string
  toLocation: string
  status: string
  notes?: string
  itemCount: number
  createdAt: string
  completedAt?: string
}

export default function TransfersPage() {
  const router = useRouter()
  const [transfers, setTransfers] = useState<Transfer[]>([])
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)

  const [showNewForm, setShowNewForm] = useState(false)
  const [formData, setFormData] = useState<{
    fromLocation: string
    toLocation: string
    items: { productId: string; quantity: number; damagedQty: number }[]
    notes: string
  }>({
    fromLocation: 'MAIN_WAREHOUSE',
    toLocation: 'STAGING',
    items: [{ productId: '', quantity: 0, damagedQty: 0 }],
    notes: '',
  })
  const [submitting, setSubmitting] = useState(false)

  const locations = ['MAIN_WAREHOUSE', 'STAGING', 'WAREHOUSE_B', 'DAMAGED']

  useEffect(() => {
    fetchTransfers()
  }, [page])

  const fetchTransfers = async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/ops/inventory/transfers?page=${page}&limit=50`)
      if (res.ok) {
        const data = await res.json()
        setTransfers(data.data)
        setTotal(data.pagination.total)
      }
    } catch (error) {
      console.error('Failed to fetch transfers:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleAddItem = () => {
    setFormData({
      ...formData,
      items: [...formData.items, { productId: '', quantity: 0, damagedQty: 0 }],
    })
  }

  const handleItemChange = (index: number, field: string, value: any) => {
    const newItems = [...formData.items]
    newItems[index] = { ...newItems[index], [field]: value }
    setFormData({ ...formData, items: newItems })
  }

  const handleRemoveItem = (index: number) => {
    setFormData({
      ...formData,
      items: formData.items.filter((_, i) => i !== index),
    })
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitting(true)

    try {
      const res = await fetch('/api/ops/inventory/transfers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      })

      if (res.ok) {
        setFormData({
          fromLocation: 'MAIN_WAREHOUSE',
          toLocation: 'STAGING',
          items: [{ productId: '', quantity: 0, damagedQty: 0 }],
          notes: '',
        })
        setShowNewForm(false)
        setPage(1)
        fetchTransfers()
      } else {
        const error = await res.json()
        alert(`Error: ${error.error}`)
      }
    } catch (error) {
      console.error('Failed to create transfer:', error)
      alert('Failed to create transfer')
    } finally {
      setSubmitting(false)
    }
  }

  const handleComplete = async (transferId: string) => {
    if (!confirm('Mark this transfer as completed?')) return

    try {
      const res = await fetch(
        `/api/ops/inventory/transfers/${transferId}/complete`,
        { method: 'POST' }
      )

      if (res.ok) {
        fetchTransfers()
      } else {
        const error = await res.json()
        alert(`Error: ${error.error}`)
      }
    } catch (error) {
      console.error('Failed to complete transfer:', error)
      alert('Failed to complete transfer')
    }
  }

  const getStatusBadge = (status: string) => {
    const bgColor =
      status === 'COMPLETED'
        ? 'bg-green-100 text-green-800'
        : status === 'IN_TRANSIT'
          ? 'bg-blue-100 text-blue-800'
          : 'bg-yellow-100 text-yellow-800'
    return (
      <span className={`inline-block px-2 py-1 rounded text-sm font-medium ${bgColor}`}>
        {status}
      </span>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-3xl font-bold text-[#0f2a3e] mb-2">Stock Transfers</h1>
            <p className="text-gray-600">Manage inventory transfers between locations</p>
          </div>
          <button
            onClick={() => setShowNewForm(!showNewForm)}
            className="px-6 py-2 bg-[#0f2a3e] text-white rounded-lg hover:bg-[#0a1a28] font-semibold"
          >
            {showNewForm ? 'Cancel' : 'New Transfer'}
          </button>
        </div>

        {/* New Form */}
        {showNewForm && (
          <div className="bg-white/80 backdrop-blur-sm border border-white/20 rounded-xl shadow-lg p-6 mb-8">
            <h2 className="text-xl font-bold text-[#0f2a3e] mb-6">Create Transfer</h2>
            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="grid grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    From Location
                  </label>
                  <select
                    value={formData.fromLocation}
                    onChange={(e) =>
                      setFormData({ ...formData, fromLocation: e.target.value })
                    }
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                  >
                    {locations.map((loc) => (
                      <option key={loc} value={loc}>
                        {loc}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    To Location
                  </label>
                  <select
                    value={formData.toLocation}
                    onChange={(e) =>
                      setFormData({ ...formData, toLocation: e.target.value })
                    }
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                  >
                    {locations.map((loc) => (
                      <option key={loc} value={loc}>
                        {loc}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-4">Items</label>
                <div className="space-y-3">
                  {formData.items.map((item, idx) => (
                    <div key={idx} className="flex gap-3">
                      <input
                        type="text"
                        placeholder="Product ID"
                        value={item.productId}
                        onChange={(e) =>
                          handleItemChange(idx, 'productId', e.target.value)
                        }
                        className="flex-1 px-3 py-2 border border-gray-300 rounded-lg"
                      />
                      <input
                        type="number"
                        placeholder="Quantity"
                        value={item.quantity || ''}
                        onChange={(e) =>
                          handleItemChange(idx, 'quantity', parseInt(e.target.value) || 0)
                        }
                        className="w-24 px-3 py-2 border border-gray-300 rounded-lg"
                      />
                      <input
                        type="number"
                        placeholder="Damaged Qty"
                        value={item.damagedQty || ''}
                        onChange={(e) =>
                          handleItemChange(idx, 'damagedQty', parseInt(e.target.value) || 0)
                        }
                        className="w-28 px-3 py-2 border border-gray-300 rounded-lg"
                      />
                      {formData.items.length > 1 && (
                        <button
                          type="button"
                          onClick={() => handleRemoveItem(idx)}
                          className="px-3 py-2 bg-red-100 text-red-700 rounded-lg hover:bg-red-200"
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={handleAddItem}
                  className="mt-3 px-4 py-2 bg-gray-200 text-gray-800 rounded-lg hover:bg-gray-300"
                >
                  + Add Item
                </button>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Notes</label>
                <textarea
                  value={formData.notes}
                  onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                  rows={3}
                  placeholder="Optional notes about this transfer"
                />
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="w-full px-6 py-3 bg-[#0f2a3e] text-white rounded-lg hover:bg-[#0a1a28] font-semibold disabled:opacity-50"
              >
                {submitting ? 'Creating...' : 'Create Transfer'}
              </button>
            </form>
          </div>
        )}

        {/* Transfers List */}
        <div className="bg-white/80 backdrop-blur-sm border border-white/20 rounded-xl shadow-lg overflow-hidden">
          {loading ? (
            <div className="p-8 text-center text-gray-600">Loading transfers...</div>
          ) : transfers.length === 0 ? (
            <div className="p-8 text-center text-gray-600">No transfers found</div>
          ) : (
            <>
              <table className="w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900">
                      Transfer #
                    </th>
                    <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900">
                      From
                    </th>
                    <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900">
                      To
                    </th>
                    <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900">
                      Items
                    </th>
                    <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900">
                      Status
                    </th>
                    <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900">
                      Created
                    </th>
                    <th className="px-6 py-3 text-right text-sm font-semibold text-gray-900">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {transfers.map((transfer) => (
                    <tr key={transfer.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className="font-mono text-sm font-semibold text-[#0f2a3e]">
                          {transfer.transferNumber}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                        {transfer.fromLocation}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                        {transfer.toLocation}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                        {transfer.itemCount} item{transfer.itemCount !== 1 ? 's' : ''}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        {getStatusBadge(transfer.status)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                        {new Date(transfer.createdAt).toLocaleDateString()}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right space-x-2">
                        {transfer.status === 'PENDING' && (
                          <button
                            onClick={() => handleComplete(transfer.id)}
                            className="inline-block px-3 py-1 bg-green-100 text-green-700 rounded text-sm hover:bg-green-200"
                          >
                            Complete
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* Pagination */}
              <div className="bg-gray-50 px-6 py-4 flex justify-between items-center">
                <div className="text-sm text-gray-600">
                  Showing {transfers.length} of {total}
                </div>
                <div className="space-x-2">
                  <button
                    onClick={() => setPage(Math.max(1, page - 1))}
                    disabled={page === 1}
                    className="px-4 py-2 border border-gray-300 rounded-lg disabled:opacity-50"
                  >
                    Previous
                  </button>
                  <button
                    onClick={() => setPage(page + 1)}
                    disabled={page * 50 >= total}
                    className="px-4 py-2 border border-gray-300 rounded-lg disabled:opacity-50"
                  >
                    Next
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
