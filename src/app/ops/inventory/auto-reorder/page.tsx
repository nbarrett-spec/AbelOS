'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { AlertTriangle, Zap, Package, TrendingDown, CheckCircle2, Loader2, XCircle } from 'lucide-react'
import { useToast } from '@/contexts/ToastContext'

// ─── Types ──────────────────────────────────────────────────────────

interface ReorderItem {
  productId: string
  sku: string | null
  productName: string | null
  onHand: number
  reorderPoint: number
  reorderQty: number
  vendorSku: string
  vendorCost: number | null
  lineTotal: number
}

interface VendorGroup {
  vendorId: string
  vendorName: string
  items: ReorderItem[]
  subtotal: number
  itemCount: number
}

interface NoVendorItem {
  productId: string
  sku: string | null
  productName: string | null
  onHand: number
  reorderPoint: number
  reorderQty: number
}

interface AutoReorderData {
  belowReorderPoint: number
  suggestions: VendorGroup[]
  noVendorItems: NoVendorItem[]
}

interface CreatedPO {
  poId: string
  poNumber: string
  vendorId: string
  vendorName: string
  itemCount: number
  total: number
}

// ─── Helpers ────────────────────────────────────────────────────────

const fmtMoney = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(n)

const fmtNum = (n: number) => new Intl.NumberFormat('en-US').format(Math.round(n))

// ─── Components ──────────────────────────────────────────────────────

function KPICard({ label, value, icon: Icon }: { label: string; value: string | number; icon: any }) {
  return (
    <div className="bg-white/80 backdrop-blur border border-gray-200 rounded-xl p-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs text-gray-500 mb-1">{label}</p>
          <p className="text-2xl font-bold text-[#0f2a3e]">{value}</p>
        </div>
        <Icon className="w-8 h-8 text-[#C6A24E] opacity-60" />
      </div>
    </div>
  )
}

function Badge({ label, color }: { label: string; color: string }) {
  const colors: Record<string, string> = {
    red: 'bg-red-100 text-red-700',
    orange: 'bg-orange-100 text-orange-700',
    yellow: 'bg-yellow-100 text-yellow-700',
    green: 'bg-green-100 text-green-700',
    blue: 'bg-blue-100 text-blue-700',
    gray: 'bg-gray-100 text-gray-600',
  }
  return <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${colors[color] || colors.gray}`}>{label}</span>
}

function SuccessMessage({ createdPOs }: { createdPOs: CreatedPO[] }) {
  return (
    <div className="bg-green-50 border border-green-200 rounded-xl p-6 mb-6">
      <div className="flex gap-4">
        <CheckCircle2 className="w-6 h-6 text-green-600 flex-shrink-0 mt-0.5" />
        <div className="flex-1">
          <h3 className="font-semibold text-green-900 mb-2">Success: {createdPOs.length} Draft PO(s) Created</h3>
          <p className="text-sm text-green-700 mb-3">Your reorder purchase orders are ready for review.</p>
          <div className="space-y-1">
            {createdPOs.map((po) => (
              <div key={po.poId} className="flex items-center justify-between text-sm bg-white rounded p-2">
                <div>
                  <span className="font-medium text-gray-900">{po.poNumber}</span>
                  <span className="text-gray-600 ml-2">{po.vendorName}</span>
                  <span className="text-gray-500 ml-2">({po.itemCount} items)</span>
                </div>
                <span className="font-semibold text-green-700">{fmtMoney(po.total)}</span>
              </div>
            ))}
          </div>
          <div className="mt-4 pt-3 border-t border-green-200">
            <Link
              href="/ops/purchasing"
              className="text-sm font-medium text-green-700 hover:text-green-800 underline"
            >
              View all Purchase Orders →
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}

function LoadingSpinner() {
  return (
    <div className="flex items-center justify-center py-12">
      <Loader2 className="w-8 h-8 text-[#C6A24E] animate-spin" />
    </div>
  )
}

function ErrorMessage({ message }: { message: string }) {
  return (
    <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex gap-3">
      <XCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
      <p className="text-sm text-red-700">{message}</p>
    </div>
  )
}

// ─── Page Component ─────────────────────────────────────────────────

export default function AutoReorderPage() {
  const { addToast } = useToast()
  const [data, setData] = useState<AutoReorderData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedVendors, setSelectedVendors] = useState<Set<string>>(new Set())
  const [generating, setGenerating] = useState(false)
  const [createdPOs, setCreatedPOs] = useState<CreatedPO[]>([])
  const [showSuccess, setShowSuccess] = useState(false)

  // Load reorder suggestions
  useEffect(() => {
    const fetchData = async () => {
      setLoading(true)
      setError(null)

      try {
        const res = await fetch('/api/ops/inventory/auto-reorder', {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' },
        })

        if (!res.ok) {
          const err = await res.json()
          throw new Error(err.error || 'Failed to load reorder suggestions')
        }

        const result = (await res.json()) as AutoReorderData
        setData(result)

        // Auto-select all vendors by default
        if (result.suggestions.length > 0) {
          setSelectedVendors(new Set(result.suggestions.map((s) => s.vendorId)))
        }
      } catch (err: any) {
        setError(err.message || 'Failed to load reorder suggestions')
        addToast({ title: 'Error', message: err.message || 'Failed to load reorder suggestions', type: 'error' })
      } finally {
        setLoading(false)
      }
    }

    fetchData()
  }, [addToast])

  const toggleVendor = (vendorId: string) => {
    const newSelected = new Set(selectedVendors)
    if (newSelected.has(vendorId)) {
      newSelected.delete(vendorId)
    } else {
      newSelected.add(vendorId)
    }
    setSelectedVendors(newSelected)
  }

  const selectedGroupCount = data?.suggestions.filter((s) => selectedVendors.has(s.vendorId)).length || 0
  const selectedItemCount =
    data?.suggestions
      .filter((s) => selectedVendors.has(s.vendorId))
      .reduce((sum, s) => sum + s.itemCount, 0) || 0
  const selectedTotal =
    data?.suggestions
      .filter((s) => selectedVendors.has(s.vendorId))
      .reduce((sum, s) => sum + s.subtotal, 0) || 0

  const handleGeneratePOs = async () => {
    if (selectedGroupCount === 0) {
      addToast({ title: 'Error', message: 'Please select at least one vendor', type: 'error' })
      return
    }

    setGenerating(true)

    try {
      const suggestionsToCreate = data!.suggestions
        .filter((s) => selectedVendors.has(s.vendorId))
        .map((s) => ({
          vendorId: s.vendorId,
          items: s.items.map((item) => ({
            productId: item.productId,
            vendorSku: item.vendorSku,
            description: item.productName || 'Unknown Product',
            quantity: item.reorderQty,
            unitCost: item.vendorCost || 0,
          })),
        }))

      const res = await fetch('/api/ops/inventory/auto-reorder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ suggestions: suggestionsToCreate }),
      })

      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || 'Failed to generate POs')
      }

      const result = await res.json()
      setCreatedPOs(result.created)
      setShowSuccess(true)
      addToast({ title: 'Success', message: `Created ${result.created.length} draft PO(s)`, type: 'success' })

      // Reset selection after success
      setTimeout(() => {
        setSelectedVendors(new Set())
      }, 2000)
    } catch (err: any) {
      addToast({ title: 'Error', message: err.message || 'Failed to generate POs', type: 'error' })
    } finally {
      setGenerating(false)
    }
  }

  if (showSuccess) {
    return (
      <div className="p-6 max-w-6xl mx-auto">
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-[#0f2a3e] mb-1">Auto-Reorder Purchase Orders</h1>
          <p className="text-gray-600">Bulk PO generation from inventory thresholds</p>
        </div>

        <SuccessMessage createdPOs={createdPOs} />

        <div className="text-center">
          <button
            onClick={() => {
              setShowSuccess(false)
              setCreatedPOs([])
              setSelectedVendors(new Set())
            }}
            className="px-6 py-2 bg-[#C6A24E] text-white rounded-lg hover:bg-[#B08841] font-medium transition"
          >
            Generate More POs
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-[#0f2a3e] mb-1">Auto-Reorder Purchase Orders</h1>
        <p className="text-gray-600">Automatically generate draft POs for items below reorder point</p>
      </div>

      {/* KPIs */}
      {data && !loading && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
          <KPICard label="Items Below Reorder Point" value={fmtNum(data.belowReorderPoint)} icon={TrendingDown} />
          <KPICard label="Vendor Groups" value={fmtNum(data.suggestions.length)} icon={Package} />
          <KPICard label="Items to Reorder" value={fmtNum(selectedItemCount)} icon={Zap} />
          <KPICard label="Estimated Total" value={fmtMoney(selectedTotal)} icon={AlertTriangle} />
        </div>
      )}

      {/* Error State */}
      {error && !loading && <ErrorMessage message={error} />}

      {/* Loading State */}
      {loading && <LoadingSpinner />}

      {/* Content */}
      {!loading && data && (
        <>
          {/* No items case */}
          {data.belowReorderPoint === 0 ? (
            <div className="bg-green-50 border border-green-200 rounded-xl p-8 text-center">
              <CheckCircle2 className="w-12 h-12 text-green-600 mx-auto mb-3" />
              <h2 className="text-xl font-semibold text-green-900 mb-1">All Inventory Healthy</h2>
              <p className="text-green-700">No items currently below reorder point.</p>
            </div>
          ) : (
            <>
              {/* Vendor Groups */}
              <div className="mb-8">
                <h2 className="text-xl font-semibold text-[#0f2a3e] mb-4">Vendor Groups ({selectedGroupCount} selected)</h2>
                <div className="space-y-4">
                  {data.suggestions.map((group) => (
                    <div key={group.vendorId} className="bg-white/80 backdrop-blur border border-gray-200 rounded-xl p-5">
                      {/* Vendor header with checkbox */}
                      <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-3 flex-1">
                          <input
                            type="checkbox"
                            checked={selectedVendors.has(group.vendorId)}
                            onChange={() => toggleVendor(group.vendorId)}
                            className="w-5 h-5 rounded border-gray-300 text-[#C6A24E] cursor-pointer"
                          />
                          <div>
                            <h3 className="font-semibold text-[#0f2a3e]">{group.vendorName}</h3>
                            <p className="text-sm text-gray-600">{group.itemCount} items to reorder</p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="font-semibold text-[#0f2a3e]">{fmtMoney(group.subtotal)}</p>
                          <p className="text-xs text-gray-500">{group.itemCount} items</p>
                        </div>
                      </div>

                      {/* Items table */}
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-t border-gray-100">
                              <th className="text-left py-2 px-3 font-medium text-gray-600">SKU</th>
                              <th className="text-left py-2 px-3 font-medium text-gray-600">Product</th>
                              <th className="text-right py-2 px-3 font-medium text-gray-600">On Hand</th>
                              <th className="text-right py-2 px-3 font-medium text-gray-600">Reorder Qty</th>
                              <th className="text-right py-2 px-3 font-medium text-gray-600">Unit Cost</th>
                              <th className="text-right py-2 px-3 font-medium text-gray-600">Line Total</th>
                            </tr>
                          </thead>
                          <tbody>
                            {group.items.map((item) => (
                              <tr key={item.productId} className="border-t border-gray-100 hover:bg-gray-50">
                                <td className="py-2 px-3 font-mono text-gray-700">{item.sku || '—'}</td>
                                <td className="py-2 px-3 text-gray-700">{item.productName || '—'}</td>
                                <td className="py-2 px-3 text-right">
                                  <Badge
                                    label={String(item.onHand)}
                                    color={item.onHand <= item.reorderPoint / 2 ? 'red' : 'orange'}
                                  />
                                </td>
                                <td className="py-2 px-3 text-right font-medium text-gray-900">{item.reorderQty}</td>
                                <td className="py-2 px-3 text-right text-gray-700">
                                  {item.vendorCost ? fmtMoney(item.vendorCost) : '—'}
                                </td>
                                <td className="py-2 px-3 text-right font-semibold text-[#C6A24E]">
                                  {fmtMoney(item.lineTotal)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Items without vendors warning */}
              {data.noVendorItems.length > 0 && (
                <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-5 mb-8">
                  <div className="flex gap-3">
                    <AlertTriangle className="w-5 h-5 text-yellow-600 flex-shrink-0 mt-0.5" />
                    <div>
                      <h3 className="font-semibold text-yellow-900 mb-2">
                        {data.noVendorItems.length} items have no preferred vendor
                      </h3>
                      <p className="text-sm text-yellow-700 mb-3">
                        These items won't be included in the auto-reorder:
                      </p>
                      <div className="space-y-1">
                        {data.noVendorItems.map((item) => (
                          <p key={item.productId} className="text-sm text-yellow-700">
                            {item.productName || item.sku || 'Unknown'} ({item.onHand} on hand, min {item.reorderPoint})
                          </p>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* CTA */}
              <div className="bg-white/80 backdrop-blur border border-gray-200 rounded-xl p-6">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h3 className="font-semibold text-[#0f2a3e] mb-1">Generate Draft POs</h3>
                    <p className="text-sm text-gray-600">
                      {selectedGroupCount > 0
                        ? `Create ${selectedGroupCount} draft PO(s) with ${selectedItemCount} items totaling ${fmtMoney(selectedTotal)}`
                        : 'Select vendors above to generate POs'}
                    </p>
                  </div>
                </div>
                <div className="flex gap-3">
                  <button
                    onClick={handleGeneratePOs}
                    disabled={selectedGroupCount === 0 || generating}
                    className="px-6 py-2 bg-[#C6A24E] text-white rounded-lg hover:bg-[#B08841] disabled:bg-gray-300 disabled:cursor-not-allowed font-medium transition flex items-center gap-2"
                  >
                    {generating && <Loader2 className="w-4 h-4 animate-spin" />}
                    {generating ? 'Generating...' : 'Generate Draft POs'}
                  </button>
                  <Link
                    href="/ops/purchasing"
                    className="px-6 py-2 bg-gray-200 text-gray-900 rounded-lg hover:bg-gray-300 font-medium transition"
                  >
                    View All POs
                  </Link>
                </div>
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}
