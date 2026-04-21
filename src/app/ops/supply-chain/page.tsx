'use client'

import { useEffect, useState } from 'react'

interface VendorConcentration {
  vendorId: string
  vendorName: string
  poCount: number
  spend: number
  percentOfTotal: number
  isHighRisk: boolean
}

interface VendorScorecard {
  vendorId: string
  vendorName: string
  poCount: number
  totalSpend: number
  percentOfTotal: number
  avgLeadDays: number
  onTimeRate: number | null
  reliabilityScore: number
  grade: 'A' | 'B' | 'C' | 'D' | 'F'
}

interface MaterialForecastItem {
  inventoryId: string
  productName: string
  onHand: number
  reorderPoint: number
  onOrder: number
  available: number
  preferredVendor: string | null
  urgency: 'critical' | 'high' | 'medium' | 'low'
}

interface RiskAlert {
  type: 'concentration' | 'lead_time' | 'stockout' | 'vendor_inactive'
  severity: 'high' | 'medium' | 'low'
  title: string
  message: string
  affectedVendor?: string
  affectedProduct?: string
  metadata?: Record<string, any>
}

interface SupplyChainData {
  vendorConcentration: VendorConcentration[]
  leadTimes: Record<string, { avgLeadDays: number; completedPOs: number }>
  poPipeline: Record<string, { count: number; value: number }>
  materialForecast: MaterialForecastItem[]
  vendorScorecards: VendorScorecard[]
  riskAlerts: RiskAlert[]
  totalOpenPOValue: number
  avgLeadDays: number
  totalSpend: number
  timestamp: string
}

const COLOR_URGENCY = {
  critical: 'bg-red-50 border-red-200',
  high: 'bg-orange-50 border-orange-200',
  medium: 'bg-yellow-50 border-yellow-200',
  low: 'bg-green-50 border-green-200',
}

const COLOR_SEVERITY = {
  high: 'bg-red-100 text-red-700',
  medium: 'bg-yellow-100 text-yellow-700',
  low: 'bg-blue-100 text-blue-700',
}

const GRADE_COLORS = {
  A: 'bg-green-100 text-green-700',
  B: 'bg-blue-100 text-blue-700',
  C: 'bg-yellow-100 text-yellow-700',
  D: 'bg-orange-100 text-orange-700',
  F: 'bg-red-100 text-red-700',
}

export default function SupplyChainPage() {
  const [data, setData] = useState<SupplyChainData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expandedRisks, setExpandedRisks] = useState<Record<string, boolean>>({})

  useEffect(() => {
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const resp = await fetch('/api/ops/supply-chain')
        if (!resp.ok) {
          throw new Error(`API error: ${resp.statusText}`)
        }
        const result = await resp.json()
        setData(result)
      } catch (err) {
        console.error('Failed to load supply chain data:', err)
        setError(String(err))
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-[#0f2a3e] border-t-[#C6A24E] rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-gray-600">Loading Supply Chain Command Center...</p>
        </div>
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="p-8">
        <div className="bg-red-50 border border-red-200 rounded-lg p-6">
          <h2 className="text-red-900 font-semibold">Error Loading Data</h2>
          <p className="text-red-700 mt-2">{error || 'No data received'}</p>
        </div>
      </div>
    )
  }

  const draftCount = data.poPipeline['DRAFT']?.count || 0
  const approvedCount = data.poPipeline['APPROVED']?.count || 0
  const sentCount = data.poPipeline['SENT']?.count || 0
  const partiallyReceivedCount = data.poPipeline['PARTIALLY_RECEIVED']?.count || 0

  const formatCurrency = (value: number) => {
    return `$${(value / 1000).toFixed(1)}K`
  }

  const toggleRisk = (index: number) => {
    setExpandedRisks(prev => ({
      ...prev,
      [index]: !prev[index],
    }))
  }

  return (
    <div className="bg-white">
      {/* Header */}
      <div className="border-b border-gray-200 px-8 py-6">
        <h1 className="text-3xl font-bold text-[#0f2a3e]">Supply Chain Command Center</h1>
        <p className="text-gray-600 mt-1">Vendor performance, procurement pipeline, and risk monitoring</p>
        <p className="text-xs text-gray-400 mt-3">Last updated: {new Date(data.timestamp).toLocaleTimeString()}</p>
      </div>

      <div className="p-8 space-y-8">
        {/* KPI Row */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          {/* Total Open PO Value */}
          <div className="bg-gray-50 rounded-lg border border-gray-200 p-6">
            <p className="text-gray-600 text-sm font-medium">Total Open PO Value</p>
            <p className="text-3xl font-bold text-[#0f2a3e] mt-2">{formatCurrency(data.totalOpenPOValue)}</p>
            <p className="text-xs text-gray-500 mt-2">
              {Object.values(data.poPipeline).reduce((sum, p) => sum + p.count, 0)} open orders
            </p>
          </div>

          {/* Avg Lead Time */}
          <div className="bg-gray-50 rounded-lg border border-gray-200 p-6">
            <p className="text-gray-600 text-sm font-medium">Avg Lead Time</p>
            <p className="text-3xl font-bold text-[#0f2a3e] mt-2">{data.avgLeadDays.toFixed(1)}</p>
            <p className="text-xs text-gray-500 mt-2">days from PO to delivery</p>
          </div>

          {/* Vendor Count */}
          <div className="bg-gray-50 rounded-lg border border-gray-200 p-6">
            <p className="text-gray-600 text-sm font-medium">Active Vendors</p>
            <p className="text-3xl font-bold text-[#0f2a3e] mt-2">{data.vendorConcentration.length}</p>
            <p className="text-xs text-gray-500 mt-2">suppliers tracked (12m)</p>
          </div>

          {/* At-Risk Materials */}
          <div className="bg-gray-50 rounded-lg border border-gray-200 p-6">
            <p className="text-gray-600 text-sm font-medium">At-Risk Materials</p>
            <p className="text-3xl font-bold text-[#0f2a3e] mt-2">{data.materialForecast.length}</p>
            <p className="text-xs text-gray-500 mt-2">products below reorder point</p>
          </div>
        </div>

        {/* Vendor Concentration Chart */}
        <div className="bg-gray-50 rounded-lg border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-[#0f2a3e] mb-4">Vendor Concentration</h2>
          <div className="space-y-3">
            {data.vendorConcentration.slice(0, 10).map(v => (
              <div key={v.vendorId} className="flex items-center gap-4">
                <div className="w-32 text-sm font-medium text-gray-700 truncate">
                  {v.vendorName}
                </div>
                <div className="flex-1 bg-white rounded-full h-6 border border-gray-200 overflow-hidden relative">
                  <div
                    className={`h-full transition-all ${v.isHighRisk ? 'bg-red-400' : 'bg-[#C6A24E]'}`}
                    style={{ width: `${Math.min(v.percentOfTotal, 100)}%` }}
                  />
                </div>
                <div className="w-20 text-right">
                  <p className="text-sm font-semibold text-[#0f2a3e]">{v.percentOfTotal.toFixed(1)}%</p>
                  <p className="text-xs text-gray-500">{v.poCount} POs</p>
                </div>
              </div>
            ))}
          </div>
          {data.vendorConcentration.length > 10 && (
            <p className="text-xs text-gray-500 mt-4">
              +{data.vendorConcentration.length - 10} more vendors
            </p>
          )}
        </div>

        {/* PO Pipeline */}
        <div className="bg-gray-50 rounded-lg border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-[#0f2a3e] mb-4">Procurement Pipeline</h2>
          <div className="flex gap-2">
            {/* DRAFT */}
            {draftCount > 0 && (
              <div className="flex-1 bg-gray-300 rounded-lg p-4 text-center">
                <p className="text-2xl font-bold text-gray-700">{draftCount}</p>
                <p className="text-xs text-gray-600 mt-1">DRAFT</p>
                <p className="text-xs text-gray-500 mt-2">{formatCurrency(data.poPipeline['DRAFT']?.value || 0)}</p>
              </div>
            )}

            {/* APPROVED */}
            {approvedCount > 0 && (
              <div className="flex-1 bg-blue-300 rounded-lg p-4 text-center">
                <p className="text-2xl font-bold text-blue-700">{approvedCount}</p>
                <p className="text-xs text-blue-600 mt-1">APPROVED</p>
                <p className="text-xs text-blue-500 mt-2">{formatCurrency(data.poPipeline['APPROVED']?.value || 0)}</p>
              </div>
            )}

            {/* SENT */}
            {sentCount > 0 && (
              <div className="flex-1 bg-[#C6A24E] rounded-lg p-4 text-center">
                <p className="text-2xl font-bold text-white">{sentCount}</p>
                <p className="text-xs text-amber-100 mt-1">SENT</p>
                <p className="text-xs text-amber-100 mt-2">{formatCurrency(data.poPipeline['SENT']?.value || 0)}</p>
              </div>
            )}

            {/* PARTIALLY_RECEIVED */}
            {partiallyReceivedCount > 0 && (
              <div className="flex-1 bg-green-300 rounded-lg p-4 text-center">
                <p className="text-2xl font-bold text-green-700">{partiallyReceivedCount}</p>
                <p className="text-xs text-green-600 mt-1">PARTIAL RX</p>
                <p className="text-xs text-green-500 mt-2">
                  {formatCurrency(data.poPipeline['PARTIALLY_RECEIVED']?.value || 0)}
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Vendor Scorecard Table */}
        <div className="bg-gray-50 rounded-lg border border-gray-200 p-6 overflow-x-auto">
          <h2 className="text-lg font-semibold text-[#0f2a3e] mb-4">Vendor Scorecard</h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-300">
                <th className="text-left py-3 px-3 font-semibold text-gray-700">Vendor</th>
                <th className="text-center py-3 px-3 font-semibold text-gray-700">PO Count</th>
                <th className="text-right py-3 px-3 font-semibold text-gray-700">Total Spend</th>
                <th className="text-center py-3 px-3 font-semibold text-gray-700">% of Total</th>
                <th className="text-center py-3 px-3 font-semibold text-gray-700">Avg Lead (days)</th>
                <th className="text-center py-3 px-3 font-semibold text-gray-700">On-Time %</th>
                <th className="text-center py-3 px-3 font-semibold text-gray-700">Score</th>
                <th className="text-center py-3 px-3 font-semibold text-gray-700">Grade</th>
              </tr>
            </thead>
            <tbody>
              {data.vendorScorecards.map(v => (
                <tr key={v.vendorId} className="border-b border-gray-200 hover:bg-white">
                  <td className="py-3 px-3 font-medium text-gray-700">{v.vendorName}</td>
                  <td className="py-3 px-3 text-center text-gray-600">{v.poCount}</td>
                  <td className="py-3 px-3 text-right text-gray-600 font-semibold">{formatCurrency(v.totalSpend)}</td>
                  <td className="py-3 px-3 text-center text-gray-600">{v.percentOfTotal.toFixed(1)}%</td>
                  <td className="py-3 px-3 text-center text-gray-600">{v.avgLeadDays.toFixed(1)}</td>
                  <td className="py-3 px-3 text-center text-gray-600">
                    {v.onTimeRate !== null ? `${(v.onTimeRate * 100).toFixed(0)}%` : '—'}
                  </td>
                  <td className="py-3 px-3 text-center text-gray-600 font-semibold">{v.reliabilityScore}</td>
                  <td className="py-3 px-3 text-center">
                    <span className={`inline-block px-3 py-1 rounded font-bold text-xs ${GRADE_COLORS[v.grade]}`}>
                      {v.grade}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Material Forecast Table */}
        <div className="bg-gray-50 rounded-lg border border-gray-200 p-6 overflow-x-auto">
          <h2 className="text-lg font-semibold text-[#0f2a3e] mb-4">Material Forecast (Below Reorder Point)</h2>
          {data.materialForecast.length === 0 ? (
            <p className="text-gray-500 text-sm">All materials above reorder threshold.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-300">
                  <th className="text-left py-3 px-3 font-semibold text-gray-700">Product</th>
                  <th className="text-center py-3 px-3 font-semibold text-gray-700">On Hand</th>
                  <th className="text-center py-3 px-3 font-semibold text-gray-700">Reorder Point</th>
                  <th className="text-center py-3 px-3 font-semibold text-gray-700">On Order</th>
                  <th className="text-center py-3 px-3 font-semibold text-gray-700">Available</th>
                  <th className="text-left py-3 px-3 font-semibold text-gray-700">Preferred Vendor</th>
                  <th className="text-center py-3 px-3 font-semibold text-gray-700">Urgency</th>
                </tr>
              </thead>
              <tbody>
                {data.materialForecast.map(m => (
                  <tr
                    key={m.inventoryId}
                    className={`border-b border-gray-200 hover:bg-white ${COLOR_URGENCY[m.urgency]}`}
                  >
                    <td className="py-3 px-3 font-medium text-gray-700">{m.productName}</td>
                    <td className="py-3 px-3 text-center text-gray-600 font-semibold">{m.onHand}</td>
                    <td className="py-3 px-3 text-center text-gray-600">{m.reorderPoint}</td>
                    <td className="py-3 px-3 text-center text-gray-600">{m.onOrder}</td>
                    <td className="py-3 px-3 text-center text-gray-600">{m.available}</td>
                    <td className="py-3 px-3 text-gray-700">{m.preferredVendor || '—'}</td>
                    <td className="py-3 px-3 text-center">
                      <span
                        className={`inline-block px-2 py-1 rounded text-xs font-semibold ${
                          m.urgency === 'critical'
                            ? 'bg-red-100 text-red-700'
                            : m.urgency === 'high'
                              ? 'bg-orange-100 text-orange-700'
                              : m.urgency === 'medium'
                                ? 'bg-yellow-100 text-yellow-700'
                                : 'bg-green-100 text-green-700'
                        }`}
                      >
                        {m.urgency.charAt(0).toUpperCase() + m.urgency.slice(1)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Risk Alerts */}
        <div className="space-y-3">
          <h2 className="text-lg font-semibold text-[#0f2a3e]">Risk Alerts</h2>
          {data.riskAlerts.length === 0 ? (
            <div className="bg-green-50 border border-green-200 rounded-lg p-6">
              <p className="text-green-700 font-medium">No active supply chain risks detected</p>
              <p className="text-green-600 text-sm mt-1">All vendors and inventory levels are within normal parameters.</p>
            </div>
          ) : (
            data.riskAlerts.map((alert, idx) => (
              <div
                key={idx}
                className={`rounded-lg border p-4 cursor-pointer transition-all ${
                  expandedRisks[idx]
                    ? alert.severity === 'high'
                      ? 'bg-red-50 border-red-200'
                      : alert.severity === 'medium'
                        ? 'bg-yellow-50 border-yellow-200'
                        : 'bg-blue-50 border-blue-200'
                    : 'bg-gray-50 border-gray-200'
                }`}
                onClick={() => toggleRisk(idx)}
              >
                <div className="flex items-start gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <p className="font-semibold text-gray-900">{alert.title}</p>
                      <span className={`inline-block px-2 py-0.5 rounded text-xs font-bold ${COLOR_SEVERITY[alert.severity]}`}>
                        {alert.severity.toUpperCase()}
                      </span>
                    </div>
                    {expandedRisks[idx] && (
                      <div className="mt-2 space-y-2">
                        <p className="text-gray-700">{alert.message}</p>
                        {alert.metadata && (
                          <div className="text-xs text-gray-600 bg-white bg-opacity-50 rounded px-2 py-1">
                            <p className="font-mono">{JSON.stringify(alert.metadata, null, 2)}</p>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                  <p className="text-gray-500 text-lg">{expandedRisks[idx] ? '▼' : '▶'}</p>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
