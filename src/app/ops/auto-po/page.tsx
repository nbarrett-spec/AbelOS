'use client'

import { useEffect, useState, useCallback } from 'react'
import { AlertCircle, CheckCircle2, Clock, Loader2, XCircle } from 'lucide-react'

interface Candidate {
  id: string
  name: string
  sku: string
  currentStock: number
  reorderPoint: number
  reorderQty: number
  unitCost: number
  supplierId: string | null
  supplierName: string | null
}

interface RecentPO {
  id: string
  poNumber: string
  status: string
  total: number
  createdAt: string
  supplierName: string | null
  lineCount: number
}

interface Stats {
  needsReorder: number
  outOfStock: number
  totalTracked: number
}

interface ApiResponse {
  candidates: Candidate[]
  recentPOs: RecentPO[]
  stats: Stats
}

interface CreateResponse {
  created: number
  purchaseOrders: Array<{
    poId: string
    poNumber: string
    supplierName: string
    lineCount: number
    total: number
  }>
}

export default function AutoPOPage() {
  const [data, setData] = useState<ApiResponse | null>(null)
  const [selectedProducts, setSelectedProducts] = useState<Set<string>>(
    new Set()
  )
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  // Fetch initial data
  useEffect(() => {
    fetchData()
  }, [])

  const fetchData = async () => {
    try {
      setLoading(true)
      setError(null)
      const response = await fetch('/api/ops/auto-po')
      if (!response.ok) {
        throw new Error('Failed to fetch auto-PO data')
      }
      const json = (await response.json()) as ApiResponse
      setData(json)
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'An error occurred'
      setError(message)
    } finally {
      setLoading(false)
    }
  }

  const handleSelectProduct = useCallback((productId: string) => {
    setSelectedProducts((prev) => {
      const next = new Set(prev)
      if (next.has(productId)) {
        next.delete(productId)
      } else {
        next.add(productId)
      }
      return next
    })
  }, [])

  const handleSelectAll = useCallback(() => {
    if (!data) return
    if (selectedProducts.size === data.candidates.length) {
      setSelectedProducts(new Set())
    } else {
      setSelectedProducts(
        new Set(data.candidates.map((c) => c.id))
      )
    }
  }, [data, selectedProducts.size])

  const handleGeneratePOs = async (all: boolean) => {
    try {
      setGenerating(true)
      setError(null)
      setSuccessMessage(null)

      const body = all
        ? { all: true }
        : { productIds: Array.from(selectedProducts) }

      const response = await fetch('/api/ops/auto-po', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      if (!response.ok) {
        throw new Error('Failed to generate POs')
      }

      const result = (await response.json()) as CreateResponse
      setSuccessMessage(
        `Generated ${result.created} PO${result.created !== 1 ? 's' : ''}`
      )
      setSelectedProducts(new Set())

      // Refetch data
      await fetchData()
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'An error occurred'
      setError(message)
    } finally {
      setGenerating(false)
    }
  }

  const getStatusColor = (
    status: string
  ): string => {
    switch (status?.toUpperCase()) {
      case 'DRAFT':
        return 'bg-gray-100 text-gray-800'
      case 'ORDERED':
        return 'bg-blue-100 text-blue-800'
      case 'RECEIVED':
        return 'bg-green-100 text-green-800'
      case 'CANCELLED':
        return 'bg-red-100 text-red-800'
      default:
        return 'bg-gray-100 text-gray-800'
    }
  }

  const getStatusIcon = (status: string) => {
    switch (status?.toUpperCase()) {
      case 'DRAFT':
        return <Clock className="h-4 w-4" />
      case 'ORDERED':
        return <Clock className="h-4 w-4" />
      case 'RECEIVED':
        return <CheckCircle2 className="h-4 w-4" />
      case 'CANCELLED':
        return <XCircle className="h-4 w-4" />
      default:
        return null
    }
  }

  const formatCurrency = (value: number): string => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value)
  }

  const formatDate = (dateString: string): string => {
    const date = new Date(dateString)
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="border-b border-gray-200 bg-white px-6 py-8">
        <h1 className="text-3xl font-bold text-gray-900">Auto-PO Generation</h1>
        <p className="mt-2 text-gray-600">
          Create purchase orders automatically when stock falls below reorder points.
        </p>
      </div>

      <div className="px-6 py-8">
        {/* Error Alert */}
        {error && (
          <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4 text-red-800">
            <div className="flex items-start">
              <AlertCircle className="mr-3 h-5 w-5 flex-shrink-0 text-red-600" />
              <div>{error}</div>
            </div>
          </div>
        )}

        {/* Success Message */}
        {successMessage && (
          <div className="mb-6 rounded-lg border border-green-200 bg-green-50 p-4 text-green-800">
            <div className="flex items-start">
              <CheckCircle2 className="mr-3 h-5 w-5 flex-shrink-0 text-green-600" />
              <div>{successMessage}</div>
            </div>
          </div>
        )}

        {/* Summary Cards */}
        {loading ? (
          <div className="mb-8 grid gap-4 md:grid-cols-3">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-32 animate-pulse rounded-lg bg-gray-200"
              />
            ))}
          </div>
        ) : data ? (
          <div className="mb-8 grid gap-4 md:grid-cols-3">
            {/* Needs Reorder */}
            <div className="rounded-lg border border-gray-200 bg-white p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-600">
                    Needs Reorder
                  </p>
                  <p className="mt-2 text-3xl font-bold text-signal">
                    {data.stats.needsReorder}
                  </p>
                </div>
                <div className="h-12 w-12 rounded-lg bg-amber-100 flex items-center justify-center">
                  <AlertCircle className="h-6 w-6 text-signal" />
                </div>
              </div>
            </div>

            {/* Out of Stock */}
            <div className="rounded-lg border border-gray-200 bg-white p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-600">
                    Out of Stock
                  </p>
                  <p className="mt-2 text-3xl font-bold text-red-600">
                    {data.stats.outOfStock}
                  </p>
                </div>
                <div className="h-12 w-12 rounded-lg bg-red-100 flex items-center justify-center">
                  <XCircle className="h-6 w-6 text-red-600" />
                </div>
              </div>
            </div>

            {/* Total Tracked */}
            <div className="rounded-lg border border-gray-200 bg-white p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-600">
                    Total Tracked
                  </p>
                  <p className="mt-2 text-3xl font-bold text-gray-900">
                    {data.stats.totalTracked}
                  </p>
                </div>
                <div className="h-12 w-12 rounded-lg bg-gray-100 flex items-center justify-center">
                  <CheckCircle2 className="h-6 w-6 text-gray-400" />
                </div>
              </div>
            </div>
          </div>
        ) : null}

        {/* Candidates Section */}
        <div className="mb-8 rounded-lg border border-gray-200 bg-white">
          <div className="border-b border-gray-200 px-6 py-4">
            <h2 className="text-lg font-semibold text-gray-900">
              Reorder Candidates
            </h2>
            <p className="mt-1 text-sm text-gray-600">
              Products at or below reorder point
            </p>
          </div>

          {loading ? (
            <div className="px-6 py-12 text-center">
              <Loader2 className="mx-auto h-8 w-8 animate-spin text-gray-400" />
              <p className="mt-2 text-gray-600">Loading candidates...</p>
            </div>
          ) : data && data.candidates.length > 0 ? (
            <>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="border-b border-gray-200 bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left">
                        <input
                          type="checkbox"
                          checked={
                            selectedProducts.size > 0 &&
                            selectedProducts.size === data.candidates.length
                          }
                          onChange={handleSelectAll}
                          className="h-4 w-4 rounded border-gray-300 text-signal focus:ring-amber-500"
                          aria-label="Select all candidates"
                        />
                      </th>
                      <th className="px-6 py-3 text-left text-sm font-semibold text-gray-700">
                        Product
                      </th>
                      <th className="px-6 py-3 text-left text-sm font-semibold text-gray-700">
                        SKU
                      </th>
                      <th className="px-6 py-3 text-right text-sm font-semibold text-gray-700">
                        Current Stock
                      </th>
                      <th className="px-6 py-3 text-right text-sm font-semibold text-gray-700">
                        Reorder Pt
                      </th>
                      <th className="px-6 py-3 text-right text-sm font-semibold text-gray-700">
                        Reorder Qty
                      </th>
                      <th className="px-6 py-3 text-left text-sm font-semibold text-gray-700">
                        Supplier
                      </th>
                      <th className="px-6 py-3 text-right text-sm font-semibold text-gray-700">
                        Est. Cost
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {data.candidates.map((candidate) => (
                      <tr key={candidate.id} className="hover:bg-gray-50">
                        <td className="px-6 py-4">
                          <input
                            type="checkbox"
                            checked={selectedProducts.has(candidate.id)}
                            onChange={() =>
                              handleSelectProduct(candidate.id)
                            }
                            className="h-4 w-4 rounded border-gray-300 text-signal focus:ring-amber-500"
                            aria-label={`Select ${candidate.name}`}
                          />
                        </td>
                        <td className="px-6 py-4 text-sm font-medium text-gray-900">
                          {candidate.name}
                        </td>
                        <td className="px-6 py-4 text-sm text-gray-600">
                          {candidate.sku}
                        </td>
                        <td className="px-6 py-4 text-right text-sm text-gray-900">
                          {candidate.currentStock}
                        </td>
                        <td className="px-6 py-4 text-right text-sm text-gray-900">
                          {candidate.reorderPoint}
                        </td>
                        <td className="px-6 py-4 text-right text-sm font-medium text-gray-900">
                          {candidate.reorderQty}
                        </td>
                        <td className="px-6 py-4 text-sm text-gray-600">
                          {candidate.supplierName || '—'}
                        </td>
                        <td className="px-6 py-4 text-right text-sm font-medium text-gray-900">
                          {formatCurrency(
                            candidate.reorderQty * candidate.unitCost
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Action Buttons */}
              <div className="border-t border-gray-200 px-6 py-4 flex gap-3 justify-between">
                <p className="text-sm text-gray-600 py-2">
                  {selectedProducts.size > 0
                    ? `${selectedProducts.size} selected`
                    : 'No products selected'}
                </p>
                <div className="flex gap-3">
                  <button
                    onClick={() => handleGeneratePOs(false)}
                    disabled={
                      selectedProducts.size === 0 || generating
                    }
                    className="inline-flex items-center rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {generating ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Generating...
                      </>
                    ) : (
                      'Generate Selected'
                    )}
                  </button>
                  <button
                    onClick={() => handleGeneratePOs(true)}
                    disabled={
                      data.candidates.length === 0 || generating
                    }
                    className="inline-flex items-center rounded-lg bg-signal px-4 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {generating ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Generating...
                      </>
                    ) : (
                      'Generate All'
                    )}
                  </button>
                </div>
              </div>
            </>
          ) : (
            <div className="px-6 py-12 text-center">
              <CheckCircle2 className="mx-auto h-12 w-12 text-green-400" />
              <h3 className="mt-2 text-lg font-medium text-gray-900">
                All stocked
              </h3>
              <p className="mt-1 text-gray-600">
                No products are below their reorder points.
              </p>
            </div>
          )}
        </div>

        {/* Recent POs Section */}
        <div className="rounded-lg border border-gray-200 bg-white">
          <div className="border-b border-gray-200 px-6 py-4">
            <h2 className="text-lg font-semibold text-gray-900">
              Recent Auto-Generated POs
            </h2>
            <p className="mt-1 text-sm text-gray-600">
              Last 30 days
            </p>
          </div>

          {loading ? (
            <div className="px-6 py-12 text-center">
              <Loader2 className="mx-auto h-8 w-8 animate-spin text-gray-400" />
              <p className="mt-2 text-gray-600">Loading POs...</p>
            </div>
          ) : data && data.recentPOs.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="border-b border-gray-200 bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-sm font-semibold text-gray-700">
                      PO Number
                    </th>
                    <th className="px-6 py-3 text-left text-sm font-semibold text-gray-700">
                      Supplier
                    </th>
                    <th className="px-6 py-3 text-right text-sm font-semibold text-gray-700">
                      Lines
                    </th>
                    <th className="px-6 py-3 text-right text-sm font-semibold text-gray-700">
                      Total
                    </th>
                    <th className="px-6 py-3 text-left text-sm font-semibold text-gray-700">
                      Status
                    </th>
                    <th className="px-6 py-3 text-left text-sm font-semibold text-gray-700">
                      Date
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {data.recentPOs.map((po) => (
                    <tr key={po.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 text-sm font-medium text-gray-900">
                        {po.poNumber}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-600">
                        {po.supplierName || '—'}
                      </td>
                      <td className="px-6 py-4 text-right text-sm text-gray-900">
                        {po.lineCount}
                      </td>
                      <td className="px-6 py-4 text-right text-sm font-medium text-gray-900">
                        {formatCurrency(po.total)}
                      </td>
                      <td className="px-6 py-4">
                        <span
                          className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${getStatusColor(
                            po.status
                          )}`}
                        >
                          {getStatusIcon(po.status)}
                          {po.status}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-600">
                        {formatDate(po.createdAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="px-6 py-12 text-center">
              <Clock className="mx-auto h-12 w-12 text-gray-400" />
              <h3 className="mt-2 text-lg font-medium text-gray-900">
                No POs yet
              </h3>
              <p className="mt-1 text-gray-600">
                Auto-generated POs will appear here.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
