'use client'

import { useState, useEffect } from 'react'

interface ValuationData {
  totalValue: number
  totalItems: number
  totalUnits: number
  byCategory: Array<{
    category: string
    units: number
    value: number
    pct: string
    itemCount: number
  }>
  byLocation: Array<{
    location: string
    units: number
    value: number
    pct: string
  }>
  topItems: Array<{
    productId: string
    sku: string
    productName: string
    category: string
    onHand: number
    unitCost: number
    totalValue: number
  }>
  zeroCostItems: number
  slowMovingItems: Array<{
    productId: string
    sku: string
    productName: string
    onHand: number
    unitCost: number
    totalValue: number
    lastReceivedAt: string | null
  }>
  slowMovingValue: number
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value)
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return 'Never'
  const date = new Date(dateStr)
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' })
}

export default function ValuationPage() {
  const [data, setData] = useState<ValuationData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchValuation()
  }, [])

  const fetchValuation = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/ops/inventory/valuation')
      if (res.ok) {
        const valData = await res.json()
        setData(valData)
      } else {
        setError('Failed to fetch valuation data')
      }
    } catch (err) {
      console.error('Error fetching valuation:', err)
      setError('Error loading valuation data')
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 p-6 flex items-center justify-center">
        <div className="text-gray-600">Loading inventory valuation...</div>
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 p-6 flex items-center justify-center">
        <div className="text-red-600">{error || 'Failed to load data'}</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-fg mb-2">Inventory Valuation</h1>
          <p className="text-gray-600">Complete inventory value breakdown by category and location</p>
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-4 gap-4 mb-8">
          <div className="bg-white/80 backdrop-blur-sm border border-white/20 rounded-xl shadow-lg p-6">
            <div className="text-sm font-medium text-gray-600 mb-2">Total Value</div>
            <div className="text-3xl font-semibold text-fg">
              {formatCurrency(data.totalValue)}
            </div>
          </div>
          <div className="bg-white/80 backdrop-blur-sm border border-white/20 rounded-xl shadow-lg p-6">
            <div className="text-sm font-medium text-gray-600 mb-2">Total Items</div>
            <div className="text-3xl font-semibold text-fg">{data.totalItems}</div>
          </div>
          <div className="bg-white/80 backdrop-blur-sm border border-white/20 rounded-xl shadow-lg p-6">
            <div className="text-sm font-medium text-gray-600 mb-2">Total Units</div>
            <div className="text-3xl font-semibold text-fg">
              {data.totalUnits.toLocaleString()}
            </div>
          </div>
          <div className="bg-white/80 backdrop-blur-sm border border-white/20 rounded-xl shadow-lg p-6">
            <div className="text-sm font-medium text-gray-600 mb-2">Avg Unit Cost</div>
            <div className="text-3xl font-semibold text-fg">
              {data.totalUnits > 0
                ? formatCurrency(data.totalValue / data.totalUnits)
                : '$0'}
            </div>
          </div>
        </div>

        {/* Category Breakdown */}
        <div className="bg-white/80 backdrop-blur-sm border border-white/20 rounded-xl shadow-lg p-6 mb-8">
          <h2 className="text-xl font-semibold text-fg mb-6">By Category</h2>
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="text-left py-3 text-sm font-semibold text-gray-900">Category</th>
                <th className="text-left py-3 text-sm font-semibold text-gray-900">Items</th>
                <th className="text-left py-3 text-sm font-semibold text-gray-900">Units</th>
                <th className="text-left py-3 text-sm font-semibold text-gray-900">Value</th>
                <th className="text-left py-3 text-sm font-semibold text-gray-900">% of Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {data.byCategory.map((cat) => (
                <tr key={cat.category} className="hover:bg-row-hover">
                  <td className="py-3 text-sm font-medium text-gray-900">{cat.category}</td>
                  <td className="py-3 text-sm text-gray-600">{cat.itemCount}</td>
                  <td className="py-3 text-sm text-gray-600">{cat.units.toLocaleString()}</td>
                  <td className="py-3 text-sm text-gray-600">{formatCurrency(cat.value)}</td>
                  <td className="py-3 text-sm text-gray-600">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-2 bg-gray-200 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-[#0f2a3e]"
                          style={{ width: `${parseFloat(cat.pct)}%` }}
                        ></div>
                      </div>
                      <span className="w-12 text-right">{cat.pct}%</span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Location Breakdown */}
        <div className="bg-white/80 backdrop-blur-sm border border-white/20 rounded-xl shadow-lg p-6 mb-8">
          <h2 className="text-xl font-semibold text-fg mb-6">By Location</h2>
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="text-left py-3 text-sm font-semibold text-gray-900">Location</th>
                <th className="text-left py-3 text-sm font-semibold text-gray-900">Units</th>
                <th className="text-left py-3 text-sm font-semibold text-gray-900">Value</th>
                <th className="text-left py-3 text-sm font-semibold text-gray-900">% of Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {data.byLocation.map((loc) => (
                <tr key={loc.location} className="hover:bg-row-hover">
                  <td className="py-3 text-sm font-medium text-gray-900">{loc.location}</td>
                  <td className="py-3 text-sm text-gray-600">{loc.units.toLocaleString()}</td>
                  <td className="py-3 text-sm text-gray-600">{formatCurrency(loc.value)}</td>
                  <td className="py-3 text-sm text-gray-600">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-2 bg-gray-200 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-signal"
                          style={{ width: `${parseFloat(loc.pct)}%` }}
                        ></div>
                      </div>
                      <span className="w-12 text-right">{loc.pct}%</span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Top 20 Items */}
        <div className="bg-white/80 backdrop-blur-sm border border-white/20 rounded-xl shadow-lg p-6 mb-8">
          <h2 className="text-xl font-semibold text-fg mb-6">Top 20 Highest-Value Items</h2>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left py-3 text-sm font-semibold text-gray-900">SKU</th>
                  <th className="text-left py-3 text-sm font-semibold text-gray-900">Product</th>
                  <th className="text-left py-3 text-sm font-semibold text-gray-900">Category</th>
                  <th className="text-left py-3 text-sm font-semibold text-gray-900">On Hand</th>
                  <th className="text-left py-3 text-sm font-semibold text-gray-900">Unit Cost</th>
                  <th className="text-left py-3 text-sm font-semibold text-gray-900">Total Value</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {data.topItems.map((item) => (
                  <tr key={item.productId} className="hover:bg-row-hover">
                    <td className="py-3 text-sm font-mono text-gray-600">{item.sku}</td>
                    <td className="py-3 text-sm text-gray-900">{item.productName}</td>
                    <td className="py-3 text-sm text-gray-600">{item.category}</td>
                    <td className="py-3 text-sm text-gray-600">{item.onHand}</td>
                    <td className="py-3 text-sm text-gray-600">{formatCurrency(item.unitCost)}</td>
                    <td className="py-3 text-sm font-semibold text-fg">
                      {formatCurrency(item.totalValue)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Alerts */}
        <div className="grid grid-cols-2 gap-8">
          {data.zeroCostItems > 0 && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-6">
              <h3 className="text-lg font-semibold text-red-900 mb-2">⚠️ Data Quality Alert</h3>
              <p className="text-red-700 mb-2">
                {data.zeroCostItems} item{data.zeroCostItems !== 1 ? 's' : ''} with zero cost
                found. Please review pricing data.
              </p>
            </div>
          )}

          {data.slowMovingItems.length > 0 && (
            <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-6">
              <h3 className="text-lg font-semibold text-yellow-900 mb-2">⚠️ Slow-Moving Inventory</h3>
              <p className="text-yellow-700 mb-2">
                {data.slowMovingItems.length} item{data.slowMovingItems.length !== 1 ? 's' : ''} not
                received in 90+ days
              </p>
              <p className="text-yellow-700 font-semibold">
                Value: {formatCurrency(data.slowMovingValue)}
              </p>
            </div>
          )}
        </div>

        {/* Slow-Moving Details */}
        {data.slowMovingItems.length > 0 && (
          <div className="bg-white/80 backdrop-blur-sm border border-white/20 rounded-xl shadow-lg p-6 mt-8">
            <h2 className="text-xl font-semibold text-fg mb-6">Slow-Moving Items Detail</h2>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="text-left py-3 text-sm font-semibold text-gray-900">SKU</th>
                    <th className="text-left py-3 text-sm font-semibold text-gray-900">Product</th>
                    <th className="text-left py-3 text-sm font-semibold text-gray-900">On Hand</th>
                    <th className="text-left py-3 text-sm font-semibold text-gray-900">Unit Cost</th>
                    <th className="text-left py-3 text-sm font-semibold text-gray-900">Total Value</th>
                    <th className="text-left py-3 text-sm font-semibold text-gray-900">Last Received</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {data.slowMovingItems.map((item) => (
                    <tr key={item.productId} className="hover:bg-row-hover">
                      <td className="py-3 text-sm font-mono text-gray-600">{item.sku}</td>
                      <td className="py-3 text-sm text-gray-900">{item.productName}</td>
                      <td className="py-3 text-sm text-gray-600">{item.onHand}</td>
                      <td className="py-3 text-sm text-gray-600">{formatCurrency(item.unitCost)}</td>
                      <td className="py-3 text-sm font-semibold text-fg">
                        {formatCurrency(item.totalValue)}
                      </td>
                      <td className="py-3 text-sm text-gray-600">
                        {formatDate(item.lastReceivedAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
