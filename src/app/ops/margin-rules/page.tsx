'use client'

import { useEffect, useState } from 'react'
import { DollarSign } from 'lucide-react'
import PageHeader from '@/components/ui/PageHeader'
import EmptyState from '@/components/ui/EmptyState'

interface Rule {
  id: string
  name: string
  description: string
  threshold: number
  unit: string
  category: string
  severity: 'BLOCK' | 'WARN'
  active: boolean
}

interface Violation {
  id: string
  quoteNumber: string
  total: number
  subtotal: number
  createdAt: string
  builderName: string
  repName: string
  calculatedMargin: number
}

interface MarginStats {
  totalQuotes30d: number
  avgMargin: number
  belowFloor: number
  negativeMargin: number
}

interface ProductHealth {
  lowMarginProducts: number
  negativeMarginProducts: number
  totalActiveProducts: number
}

interface MarginData {
  rules: Rule[]
  violations: Violation[]
  marginStats: MarginStats
  productHealth: ProductHealth
}

export default function MarginRulesPage() {
  const [data, setData] = useState<MarginData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Colors: walnut (#0f2a3e), amber (#C6A24E), green (#27AE60)

  useEffect(() => {
    const fetchData = async () => {
      try {
        const res = await fetch('/api/ops/margin-rules')
        if (!res.ok) throw new Error(`API error: ${res.status}`)
        const json = await res.json()
        setData(json)
        setError(null)
      } catch (err: any) {
        setError(err.message || 'Failed to load margin rules')
      } finally {
        setLoading(false)
      }
    }

    fetchData()
  }, [])

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50">
        <div className="text-gray-600">Loading margin protection data...</div>
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50">
        <div className="text-red-600 font-semibold">{error || 'Failed to load data'}</div>
      </div>
    )
  }

  const hasRedFlags =
    data.marginStats.belowFloor > 0 || data.marginStats.negativeMargin > 0 || data.productHealth.negativeMarginProducts > 0

  return (
    <div className="min-h-screen bg-gray-50 px-6 py-8">
      <PageHeader
        title="Margin Protection Rules"
        description="Monitor pricing floors, enforce margin minimums, and catch low-margin quotes before they hurt profitability."
      />

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        {/* Total Quotes */}
        <div className="bg-white rounded-lg shadow p-6 border-l-4 border-gray-300">
          <div className="text-gray-600 text-sm font-semibold uppercase">Total Quotes (30d)</div>
          <div className="text-3xl font-bold mt-2" style={{ color: '#0f2a3e' }}>
            {data.marginStats.totalQuotes30d}
          </div>
        </div>

        {/* Average Margin */}
        <div className="bg-white rounded-lg shadow p-6 border-l-4" style={{ borderColor: '#27AE60' }}>
          <div className="text-gray-600 text-sm font-semibold uppercase">Avg Margin</div>
          <div className="text-3xl font-bold mt-2" style={{ color: '#27AE60' }}>
            {data.marginStats.avgMargin.toFixed(1)}%
          </div>
        </div>

        {/* Below Floor */}
        <div className="bg-white rounded-lg shadow p-6 border-l-4" style={{ borderColor: '#dc2626' }}>
          <div className="text-gray-600 text-sm font-semibold uppercase">Below Floor (15%)</div>
          <div className="text-3xl font-bold mt-2" style={{ color: '#dc2626' }}>
            {data.marginStats.belowFloor}
          </div>
          <div className="text-xs text-gray-500 mt-2">
            {((data.marginStats.belowFloor / Math.max(data.marginStats.totalQuotes30d, 1)) * 100).toFixed(1)}% of quotes
          </div>
        </div>

        {/* Negative Margin */}
        <div className="bg-white rounded-lg shadow p-6 border-l-4" style={{ borderColor: '#dc2626' }}>
          <div className="text-gray-600 text-sm font-semibold uppercase">Negative Margin</div>
          <div className="text-3xl font-bold mt-2" style={{ color: '#dc2626' }}>
            {data.marginStats.negativeMargin}
          </div>
          <div className="text-xs text-gray-500 mt-2">quotes losing money</div>
        </div>
      </div>

      {/* Alert Banner */}
      {hasRedFlags && (
        <div className="mb-8 bg-red-50 border border-red-200 rounded-lg p-4" style={{ borderLeftColor: '#dc2626', borderLeftWidth: '4px' }}>
          <div className="flex gap-3">
            <span className="text-red-600 font-bold text-lg flex-shrink-0">⚠</span>
            <div>
              <div className="font-semibold text-red-900">Margin violations detected</div>
              <div className="text-red-700 text-sm mt-1">
                {data.marginStats.belowFloor > 0 && `${data.marginStats.belowFloor} quotes below floor`}
                {data.marginStats.belowFloor > 0 && data.marginStats.negativeMargin > 0 && ' • '}
                {data.marginStats.negativeMargin > 0 && `${data.marginStats.negativeMargin} with negative margin`}
                {data.productHealth.negativeMarginProducts > 0 && ' • '}
                {data.productHealth.negativeMarginProducts > 0 && `${data.productHealth.negativeMarginProducts} products losing money`}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Rules Table */}
      <div className="bg-white rounded-lg shadow mb-8">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold" style={{ color: '#0f2a3e' }}>
            Active Rules
          </h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="px-6 py-3 text-left font-semibold text-gray-700">Rule Name</th>
                <th className="px-6 py-3 text-left font-semibold text-gray-700">Description</th>
                <th className="px-6 py-3 text-left font-semibold text-gray-700">Threshold</th>
                <th className="px-6 py-3 text-left font-semibold text-gray-700">Category</th>
                <th className="px-6 py-3 text-center font-semibold text-gray-700">Severity</th>
                <th className="px-6 py-3 text-center font-semibold text-gray-700">Status</th>
              </tr>
            </thead>
            <tbody>
              {data.rules.map((rule) => (
                <tr key={rule.id} className="border-b border-gray-200 hover:bg-row-hover">
                  <td className="px-6 py-4 font-semibold" style={{ color: '#0f2a3e' }}>
                    {rule.name}
                  </td>
                  <td className="px-6 py-4 text-gray-600">{rule.description}</td>
                  <td className="px-6 py-4 font-mono text-gray-900">
                    {rule.threshold}
                    {rule.unit}
                  </td>
                  <td className="px-6 py-4">
                    <span className="inline-block px-2 py-1 text-xs rounded" style={{ backgroundColor: '#F5F5F5', color: '#666' }}>
                      {rule.category}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-center">
                    <span
                      className="inline-block px-3 py-1 text-xs font-semibold rounded text-white"
                      style={{ backgroundColor: rule.severity === 'BLOCK' ? '#dc2626' : '#F59E0B' }}
                    >
                      {rule.severity}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-center">
                    <input type="checkbox" checked={rule.active} readOnly className="w-4 h-4" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Product Health */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8">
        {/* Product Margin Health */}
        <div className="bg-white rounded-lg shadow">
          <div className="px-6 py-4 border-b border-gray-200">
            <h3 className="text-lg font-semibold" style={{ color: '#0f2a3e' }}>
              Product Margin Health
            </h3>
          </div>
          <div className="px-6 py-6">
            <div className="space-y-4">
              <div className="flex justify-between items-center pb-4 border-b border-gray-200">
                <div>
                  <div className="text-sm font-semibold text-gray-700">Low Margin Products</div>
                  <div className="text-xs text-gray-500 mt-1">&lt; 15% margin</div>
                </div>
                <div className="text-2xl font-bold" style={{ color: '#C6A24E' }}>
                  {data.productHealth.lowMarginProducts}
                </div>
              </div>

              <div className="flex justify-between items-center pb-4 border-b border-gray-200">
                <div>
                  <div className="text-sm font-semibold text-gray-700">Negative Margin Products</div>
                  <div className="text-xs text-gray-500 mt-1">losing money at base price</div>
                </div>
                <div className="text-2xl font-bold" style={{ color: '#dc2626' }}>
                  {data.productHealth.negativeMarginProducts}
                </div>
              </div>

              <div className="flex justify-between items-center">
                <div>
                  <div className="text-sm font-semibold text-gray-700">Total Active Products</div>
                  <div className="text-xs text-gray-500 mt-1">in catalog</div>
                </div>
                <div className="text-2xl font-bold" style={{ color: '#0f2a3e' }}>
                  {data.productHealth.totalActiveProducts}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Rule Impact */}
        <div className="bg-white rounded-lg shadow">
          <div className="px-6 py-4 border-b border-gray-200">
            <h3 className="text-lg font-semibold" style={{ color: '#0f2a3e' }}>
              Recent Activity
            </h3>
          </div>
          <div className="px-6 py-6">
            <div className="space-y-3">
              {data.violations.length === 0 ? (
                <EmptyState
                  icon={<DollarSign className="w-8 h-8 text-fg-subtle" />}
                  title="No violations"
                  description="No quotes have crossed the margin floor in the past 30 days."
                  size="compact"
                />
              ) : (
                <>
                  <p className="text-xs text-gray-500 font-semibold uppercase mb-4">
                    {data.violations.length} quotes below 15% floor
                  </p>
                  <div className="space-y-2 max-h-48 overflow-y-auto">
                    {data.violations.slice(0, 5).map((v) => (
                      <div key={v.id} className="text-xs p-2 rounded" style={{ backgroundColor: '#FEF3C7' }}>
                        <div className="font-semibold" style={{ color: '#B45309' }}>
                          {v.quoteNumber} — {Math.round(v.calculatedMargin)}%
                        </div>
                        <div className="text-gray-700">{v.builderName}</div>
                      </div>
                    ))}
                  </div>
                  {data.violations.length > 5 && (
                    <p className="text-xs text-gray-500 mt-2 pt-2 border-t border-gray-200">
                      +{data.violations.length - 5} more below threshold
                    </p>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Recent Violations (if any) */}
      {data.violations.length > 0 && (
        <div className="bg-white rounded-lg shadow">
          <div className="px-6 py-4 border-b border-gray-200">
            <h3 className="text-lg font-semibold" style={{ color: '#0f2a3e' }}>
              Recent Margin Violations
            </h3>
            <p className="text-sm text-gray-600 mt-1">Quotes below 15% margin floor (last 30 days)</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="px-6 py-3 text-left font-semibold text-gray-700">Quote #</th>
                  <th className="px-6 py-3 text-left font-semibold text-gray-700">Builder</th>
                  <th className="px-6 py-3 text-left font-semibold text-gray-700">Rep</th>
                  <th className="px-6 py-3 text-right font-semibold text-gray-700">Margin %</th>
                  <th className="px-6 py-3 text-right font-semibold text-gray-700">Total</th>
                  <th className="px-6 py-3 text-left font-semibold text-gray-700">Created</th>
                </tr>
              </thead>
              <tbody>
                {data.violations.map((v) => (
                  <tr key={v.id} className="border-b border-gray-200 hover:bg-row-hover">
                    <td className="px-6 py-4 font-mono font-semibold" style={{ color: '#0f2a3e' }}>
                      {v.quoteNumber}
                    </td>
                    <td className="px-6 py-4 text-gray-700">{v.builderName}</td>
                    <td className="px-6 py-4 text-gray-600">{v.repName || '—'}</td>
                    <td className="px-6 py-4 text-right font-semibold">
                      <span style={{ color: v.calculatedMargin < 0 ? '#dc2626' : '#C6A24E' }}>
                        {v.calculatedMargin.toFixed(1)}%
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right font-mono">${v.total.toFixed(2)}</td>
                    <td className="px-6 py-4 text-gray-600 text-xs">
                      {new Date(v.createdAt).toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Footer */}
      <div className="mt-12 text-center text-sm text-gray-500">
        <p>Margin protection rules last updated: {new Date().toLocaleDateString()}</p>
      </div>
    </div>
  )
}
