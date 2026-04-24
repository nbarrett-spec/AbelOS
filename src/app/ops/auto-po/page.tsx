'use client'

import { useEffect, useState, useCallback } from 'react'
import { AlertCircle, CheckCircle2, Clock, Loader2, XCircle, Receipt } from 'lucide-react'
import PageHeader from '@/components/ui/PageHeader'
import EmptyState from '@/components/ui/EmptyState'
import { Badge, getStatusBadgeVariant } from '@/components/ui/Badge'

interface Candidate {
  id: string
  name: string
  sku: string
  currentStock: number
  reorderPoint: number
  reorderQty: number
  unitCost: number
  vendorId: string | null
  vendorName: string | null
}

interface RecentPO {
  id: string
  poNumber: string
  status: string
  total: number
  createdAt: string
  vendorName: string | null
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
    vendorName: string
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

  const getStatusIcon = (status: string) => {
    switch (status?.toUpperCase()) {
      case 'DRAFT':
        return <Clock className="h-3 w-3" />
      case 'ORDERED':
        return <Clock className="h-3 w-3" />
      case 'RECEIVED':
        return <CheckCircle2 className="h-3 w-3" />
      case 'CANCELLED':
        return <XCircle className="h-3 w-3" />
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
    <div className="min-h-screen bg-canvas">
      <div className="px-6 py-8">
        <PageHeader
          title="Auto-PO Generation"
          description="Create purchase orders automatically when stock falls below reorder points."
          crumbs={[
            { label: 'Ops', href: '/ops' },
            { label: 'Purchasing', href: '/ops/purchasing' },
            { label: 'Auto-PO' },
          ]}
        />

        {/* Error Alert */}
        {error && (
          <div className="mb-6 rounded-lg border border-data-negative/30 bg-data-negative-bg p-4 text-data-negative-fg">
            <div className="flex items-start">
              <AlertCircle className="mr-3 h-5 w-5 flex-shrink-0 text-data-negative" />
              <div>{error}</div>
            </div>
          </div>
        )}

        {/* Success Message */}
        {successMessage && (
          <div className="mb-6 rounded-lg border border-data-positive/30 bg-data-positive-bg p-4 text-data-positive-fg">
            <div className="flex items-start">
              <CheckCircle2 className="mr-3 h-5 w-5 flex-shrink-0 text-data-positive" />
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
                className="h-32 animate-pulse rounded-lg bg-surface-elev"
              />
            ))}
          </div>
        ) : data ? (
          <div className="mb-8 grid gap-4 md:grid-cols-3">
            {/* Needs Reorder */}
            <div className="rounded-lg border border-border bg-surface p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-fg-muted">
                    Needs Reorder
                  </p>
                  <p className="mt-2 text-3xl font-semibold text-signal">
                    {data.stats.needsReorder}
                  </p>
                </div>
                <div className="h-12 w-12 rounded-lg bg-signal-subtle flex items-center justify-center">
                  <AlertCircle className="h-6 w-6 text-signal" />
                </div>
              </div>
            </div>

            {/* Out of Stock */}
            <div className="rounded-lg border border-border bg-surface p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-fg-muted">
                    Out of Stock
                  </p>
                  <p className="mt-2 text-3xl font-semibold text-data-negative">
                    {data.stats.outOfStock}
                  </p>
                </div>
                <div className="h-12 w-12 rounded-lg bg-data-negative-bg flex items-center justify-center">
                  <XCircle className="h-6 w-6 text-data-negative" />
                </div>
              </div>
            </div>

            {/* Total Tracked */}
            <div className="rounded-lg border border-border bg-surface p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-fg-muted">
                    Total Tracked
                  </p>
                  <p className="mt-2 text-3xl font-semibold text-fg">
                    {data.stats.totalTracked}
                  </p>
                </div>
                <div className="h-12 w-12 rounded-lg bg-surface-muted flex items-center justify-center">
                  <CheckCircle2 className="h-6 w-6 text-fg-subtle" />
                </div>
              </div>
            </div>
          </div>
        ) : null}

        {/* Candidates Section */}
        <div className="mb-8 rounded-lg border border-border bg-surface">
          <div className="border-b border-border px-6 py-4">
            <h2 className="text-lg font-semibold text-fg">
              Reorder Candidates
            </h2>
            <p className="mt-1 text-sm text-fg-muted">
              Products at or below reorder point
            </p>
          </div>

          {loading ? (
            <div className="px-6 py-12 text-center">
              <Loader2 className="mx-auto h-8 w-8 animate-spin text-fg-subtle" />
              <p className="mt-2 text-fg-muted">Loading candidates...</p>
            </div>
          ) : data && data.candidates.length > 0 ? (
            <>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="border-b border-border bg-surface-muted/40">
                    <tr>
                      <th className="px-6 py-3 text-left">
                        <input
                          type="checkbox"
                          checked={
                            selectedProducts.size > 0 &&
                            selectedProducts.size === data.candidates.length
                          }
                          onChange={handleSelectAll}
                          className="h-4 w-4 rounded border-border text-signal focus:ring-signal"
                          aria-label="Select all candidates"
                        />
                      </th>
                      <th className="px-6 py-3 text-left text-sm font-semibold text-fg-muted">
                        Product
                      </th>
                      <th className="px-6 py-3 text-left text-sm font-semibold text-fg-muted">
                        SKU
                      </th>
                      <th className="px-6 py-3 text-right text-sm font-semibold text-fg-muted">
                        Current Stock
                      </th>
                      <th className="px-6 py-3 text-right text-sm font-semibold text-fg-muted">
                        Reorder Pt
                      </th>
                      <th className="px-6 py-3 text-right text-sm font-semibold text-fg-muted">
                        Reorder Qty
                      </th>
                      <th className="px-6 py-3 text-left text-sm font-semibold text-fg-muted">
                        Supplier
                      </th>
                      <th className="px-6 py-3 text-right text-sm font-semibold text-fg-muted">
                        Est. Cost
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {data.candidates.map((candidate) => (
                      <tr key={candidate.id} className="hover:bg-row-hover transition-colors">
                        <td className="px-6 py-4">
                          <input
                            type="checkbox"
                            checked={selectedProducts.has(candidate.id)}
                            onChange={() =>
                              handleSelectProduct(candidate.id)
                            }
                            className="h-4 w-4 rounded border-border text-signal focus:ring-signal"
                            aria-label={`Select ${candidate.name}`}
                          />
                        </td>
                        <td className="px-6 py-4 text-sm font-medium text-fg">
                          {candidate.name}
                        </td>
                        <td className="px-6 py-4 text-sm text-fg-muted">
                          {candidate.sku}
                        </td>
                        <td className="px-6 py-4 text-right text-sm text-fg">
                          {candidate.currentStock}
                        </td>
                        <td className="px-6 py-4 text-right text-sm text-fg">
                          {candidate.reorderPoint}
                        </td>
                        <td className="px-6 py-4 text-right text-sm font-medium text-fg">
                          {candidate.reorderQty}
                        </td>
                        <td className="px-6 py-4 text-sm text-fg-muted">
                          {candidate.vendorName || '—'}
                        </td>
                        <td className="px-6 py-4 text-right text-sm font-medium text-fg">
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
              <div className="border-t border-border px-6 py-4 flex gap-3 justify-between">
                <p className="text-sm text-fg-muted py-2">
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
                    className="inline-flex items-center rounded-lg border border-border bg-surface px-4 py-2 text-sm font-medium text-fg hover:bg-surface-muted disabled:opacity-50 disabled:cursor-not-allowed"
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
                    className="inline-flex items-center rounded-lg bg-signal px-4 py-2 text-sm font-medium text-fg-on-accent hover:bg-signal-hover disabled:opacity-50 disabled:cursor-not-allowed"
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
            <EmptyState
              icon={<Receipt className="w-8 h-8 text-fg-subtle" />}
              title="All stocked"
              description="No products are below their reorder points."
            />
          )}
        </div>

        {/* Recent POs Section */}
        <div className="rounded-lg border border-border bg-surface">
          <div className="border-b border-border px-6 py-4">
            <h2 className="text-lg font-semibold text-fg">
              Recent Auto-Generated POs
            </h2>
            <p className="mt-1 text-sm text-fg-muted">
              Last 30 days
            </p>
          </div>

          {loading ? (
            <div className="px-6 py-12 text-center">
              <Loader2 className="mx-auto h-8 w-8 animate-spin text-fg-subtle" />
              <p className="mt-2 text-fg-muted">Loading POs...</p>
            </div>
          ) : data && data.recentPOs.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="border-b border-border bg-surface-muted/40">
                  <tr>
                    <th className="px-6 py-3 text-left text-sm font-semibold text-fg-muted">
                      PO Number
                    </th>
                    <th className="px-6 py-3 text-left text-sm font-semibold text-fg-muted">
                      Supplier
                    </th>
                    <th className="px-6 py-3 text-right text-sm font-semibold text-fg-muted">
                      Lines
                    </th>
                    <th className="px-6 py-3 text-right text-sm font-semibold text-fg-muted">
                      Total
                    </th>
                    <th className="px-6 py-3 text-left text-sm font-semibold text-fg-muted">
                      Status
                    </th>
                    <th className="px-6 py-3 text-left text-sm font-semibold text-fg-muted">
                      Date
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {data.recentPOs.map((po) => (
                    <tr key={po.id} className="hover:bg-row-hover transition-colors">
                      <td className="px-6 py-4 text-sm font-medium text-fg">
                        {po.poNumber}
                      </td>
                      <td className="px-6 py-4 text-sm text-fg-muted">
                        {po.vendorName || '—'}
                      </td>
                      <td className="px-6 py-4 text-right text-sm text-fg">
                        {po.lineCount}
                      </td>
                      <td className="px-6 py-4 text-right text-sm font-medium text-fg">
                        {formatCurrency(po.total)}
                      </td>
                      <td className="px-6 py-4">
                        <Badge variant={getStatusBadgeVariant(po.status)} icon={getStatusIcon(po.status)}>
                          {po.status}
                        </Badge>
                      </td>
                      <td className="px-6 py-4 text-sm text-fg-muted">
                        {formatDate(po.createdAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState
              icon={<Receipt className="w-8 h-8 text-fg-subtle" />}
              title="No POs yet"
              description="Auto-generated POs will appear here."
            />
          )}
        </div>
      </div>
    </div>
  )
}
