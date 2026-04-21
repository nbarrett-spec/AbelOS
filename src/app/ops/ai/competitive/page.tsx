'use client'

import { useEffect, useState } from 'react'

interface Competitor {
  id: string
  name: string
  category: 'NATIONAL' | 'REGIONAL' | 'LOCAL'
  strengths: string[]
  weaknesses: string[]
  primaryOverlap: string[]
  winRate: number
  lossRate: number
  recentMoves: string[]
}

interface Alert {
  type: string
  severity: 'HIGH' | 'MEDIUM' | 'LOW'
  title: string
  description: string
}

interface CompetitiveData {
  competitors: Competitor[]
  marketPosition: {
    totalDealsWon: number
    totalDealsLost: number
    winRate: number
    topLossReasons: Array<{ reason: string; count: number }>
    pricingPressureProducts: Array<{ name: string; marginDelta: number; currentMargin: number; priorMargin: number }>
  }
  alerts: Alert[]
  lastUpdated: string
}

export default function CompetitiveIntelligencePage() {
  const [data, setData] = useState<CompetitiveData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function loadData() {
      try {
        const resp = await fetch('/api/ops/ai/competitive')
        if (!resp.ok) throw new Error('Failed to load competitive data')
        const json = await resp.json()
        setData(json)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error')
      } finally {
        setLoading(false)
      }
    }
    loadData()
  }, [])

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-gray-600">Loading competitive intelligence...</div>
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-red-600">{error || 'Failed to load data'}</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-[#0f2a3e] text-white px-8 py-12">
        <div className="max-w-7xl mx-auto">
          <h1 className="text-4xl font-bold mb-2">Competitive Intelligence</h1>
          <p className="text-gray-300 text-lg">Market positioning and competitor analysis</p>
          <button className="mt-6 px-4 py-2 bg-[#C6A24E] text-white rounded font-medium hover:bg-[#B87520] transition">
            + Add Competitor
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-8 py-12">
        {/* Market Position Summary */}
        <div className="mb-12">
          <h2 className="text-2xl font-bold text-gray-900 mb-6">Market Position</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
            <div className="bg-white rounded-lg shadow p-6 border-l-4 border-[#27AE60]">
              <div className="text-sm font-medium text-gray-600 mb-2">Win Rate</div>
              <div className="text-4xl font-bold text-gray-900">{data.marketPosition.winRate}%</div>
              <div className="text-xs text-gray-500 mt-2">Last 6 months</div>
            </div>
            <div className="bg-white rounded-lg shadow p-6 border-l-4 border-[#27AE60]">
              <div className="text-sm font-medium text-gray-600 mb-2">Deals Won</div>
              <div className="text-4xl font-bold text-gray-900">{data.marketPosition.totalDealsWon}</div>
              <div className="text-xs text-gray-500 mt-2">Closed</div>
            </div>
            <div className="bg-white rounded-lg shadow p-6 border-l-4 border-red-500">
              <div className="text-sm font-medium text-gray-600 mb-2">Deals Lost</div>
              <div className="text-4xl font-bold text-gray-900">{data.marketPosition.totalDealsLost}</div>
              <div className="text-xs text-gray-500 mt-2">Lost</div>
            </div>
            <div className="bg-white rounded-lg shadow p-6 border-l-4 border-[#C6A24E]">
              <div className="text-sm font-medium text-gray-600 mb-2">Total Deals</div>
              <div className="text-4xl font-bold text-gray-900">
                {data.marketPosition.totalDealsWon + data.marketPosition.totalDealsLost}
              </div>
              <div className="text-xs text-gray-500 mt-2">Pipeline activity</div>
            </div>
          </div>
        </div>

        {/* Alerts Section */}
        {data.alerts.length > 0 && (
          <div className="mb-12">
            <h2 className="text-2xl font-bold text-gray-900 mb-6">Competitive Alerts</h2>
            <div className="space-y-4">
              {data.alerts.map((alert, idx) => {
                const bgColor = alert.severity === 'HIGH' ? 'bg-red-50 border-red-200' : 'bg-yellow-50 border-yellow-200'
                const titleColor = alert.severity === 'HIGH' ? 'text-red-900' : 'text-yellow-900'
                const badgeColor =
                  alert.severity === 'HIGH'
                    ? 'bg-red-100 text-red-700'
                    : 'bg-yellow-100 text-yellow-700'
                return (
                  <div key={idx} className={`${bgColor} border rounded-lg p-4`}>
                    <div className="flex items-start gap-3">
                      <div className={`${badgeColor} px-2 py-1 rounded text-xs font-medium shrink-0`}>
                        {alert.severity}
                      </div>
                      <div className="flex-1">
                        <h3 className={`${titleColor} font-bold text-sm mb-1`}>{alert.title}</h3>
                        <p className="text-gray-700 text-sm">{alert.description}</p>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Competitors Grid */}
        <div className="mb-12">
          <h2 className="text-2xl font-bold text-gray-900 mb-6">Competitors</h2>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {data.competitors.map((comp) => (
              <div key={comp.id} className="bg-white rounded-lg shadow p-6 border-t-4 border-[#C6A24E]">
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <h3 className="text-lg font-bold text-gray-900">{comp.name}</h3>
                    <div className="flex gap-2 mt-2">
                      <span
                        className={`inline-block px-2 py-1 text-xs font-medium rounded ${
                          comp.category === 'NATIONAL'
                            ? 'bg-blue-100 text-blue-700'
                            : comp.category === 'REGIONAL'
                              ? 'bg-purple-100 text-purple-700'
                              : 'bg-gray-100 text-gray-700'
                        }`}
                      >
                        {comp.category}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Win/Loss Rate */}
                <div className="grid grid-cols-2 gap-4 mb-4 pb-4 border-b">
                  <div>
                    <div className="text-sm text-gray-600 font-medium">Win Rate</div>
                    <div className="text-2xl font-bold text-[#27AE60]">{comp.winRate}%</div>
                  </div>
                  <div>
                    <div className="text-sm text-gray-600 font-medium">Loss Rate</div>
                    <div className="text-2xl font-bold text-red-600">{comp.lossRate}%</div>
                  </div>
                </div>

                {/* Strengths */}
                <div className="mb-4">
                  <h4 className="text-sm font-bold text-[#27AE60] mb-2">Strengths</h4>
                  <ul className="space-y-1">
                    {comp.strengths.map((s, idx) => (
                      <li key={idx} className="text-sm text-gray-700 flex items-start gap-2">
                        <span className="text-[#27AE60] font-bold">+</span>
                        {s}
                      </li>
                    ))}
                  </ul>
                </div>

                {/* Weaknesses */}
                <div className="mb-4">
                  <h4 className="text-sm font-bold text-red-600 mb-2">Weaknesses</h4>
                  <ul className="space-y-1">
                    {comp.weaknesses.map((w, idx) => (
                      <li key={idx} className="text-sm text-gray-700 flex items-start gap-2">
                        <span className="text-red-600 font-bold">−</span>
                        {w}
                      </li>
                    ))}
                  </ul>
                </div>

                {/* Overlap Categories */}
                <div className="mb-4">
                  <h4 className="text-sm font-bold text-gray-900 mb-2">Product Overlap</h4>
                  <div className="flex flex-wrap gap-1">
                    {comp.primaryOverlap.map((cat, idx) => (
                      <span key={idx} className="inline-block bg-gray-200 text-gray-800 px-2 py-1 text-xs rounded">
                        {cat}
                      </span>
                    ))}
                  </div>
                </div>

                {/* Recent Moves */}
                {comp.recentMoves.length > 0 && (
                  <div>
                    <h4 className="text-sm font-bold text-gray-900 mb-2">Recent Moves</h4>
                    <ul className="space-y-1">
                      {comp.recentMoves.map((move, idx) => (
                        <li key={idx} className="text-sm text-gray-700 flex items-start gap-2">
                          <span className="text-[#C6A24E] font-bold">•</span>
                          {move}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Loss Analysis */}
        {data.marketPosition.topLossReasons.length > 0 && (
          <div className="mb-12">
            <h2 className="text-2xl font-bold text-gray-900 mb-6">Top Loss Reasons</h2>
            <div className="bg-white rounded-lg shadow p-6">
              <div className="space-y-6">
                {data.marketPosition.topLossReasons.map((reason, idx) => {
                  const maxCount = Math.max(...data.marketPosition.topLossReasons.map((r) => r.count))
                  const percentage = (reason.count / maxCount) * 100
                  return (
                    <div key={idx}>
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm font-medium text-gray-900">{reason.reason}</span>
                        <span className="text-sm font-bold text-gray-600">{reason.count} losses</span>
                      </div>
                      <div className="w-full bg-gray-200 rounded-full h-2">
                        <div
                          className="bg-red-500 h-2 rounded-full transition-all duration-300"
                          style={{ width: `${percentage}%` }}
                        />
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        )}

        {/* Pricing Pressure */}
        {data.marketPosition.pricingPressureProducts.length > 0 && (
          <div className="mb-12">
            <h2 className="text-2xl font-bold text-gray-900 mb-6">Products Under Margin Pressure</h2>
            <div className="bg-white rounded-lg shadow overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="bg-gray-100 border-b">
                      <th className="px-6 py-3 text-left text-sm font-bold text-gray-900">Product</th>
                      <th className="px-6 py-3 text-right text-sm font-bold text-gray-900">Current Margin</th>
                      <th className="px-6 py-3 text-right text-sm font-bold text-gray-900">Prior Margin</th>
                      <th className="px-6 py-3 text-right text-sm font-bold text-gray-900">Change</th>
                      <th className="px-6 py-3 text-center text-sm font-bold text-gray-900">Trend</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.marketPosition.pricingPressureProducts.map((product, idx) => {
                      const isNegative = product.marginDelta < 0
                      return (
                        <tr key={idx} className="border-b hover:bg-gray-50">
                          <td className="px-6 py-4 text-sm text-gray-900 font-medium">{product.name}</td>
                          <td className="px-6 py-4 text-right text-sm text-gray-900">
                            {product.currentMargin.toFixed(1)}%
                          </td>
                          <td className="px-6 py-4 text-right text-sm text-gray-600">
                            {product.priorMargin.toFixed(1)}%
                          </td>
                          <td
                            className={`px-6 py-4 text-right text-sm font-bold ${
                              isNegative ? 'text-red-600' : 'text-[#27AE60]'
                            }`}
                          >
                            {isNegative ? '−' : '+'}
                            {Math.abs(product.marginDelta).toFixed(1)}%
                          </td>
                          <td className="px-6 py-4 text-center">
                            <span className={`inline-block ${isNegative ? 'text-red-600' : 'text-[#27AE60]'}`}>
                              {isNegative ? '▼' : '▲'}
                            </span>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* Last Updated */}
        <div className="text-center text-sm text-gray-500 mt-8">
          Last updated: {new Date(data.lastUpdated).toLocaleString()}
        </div>
      </div>
    </div>
  )
}
