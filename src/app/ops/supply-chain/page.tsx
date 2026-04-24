'use client'

import { useEffect, useState } from 'react'
import PageHeader from '@/components/ui/PageHeader'
import EmptyState from '@/components/ui/EmptyState'
import { Factory } from 'lucide-react'

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
  critical: 'bg-data-negative-bg border-data-negative/30',
  high: 'bg-data-warning-bg border-data-warning/30',
  medium: 'bg-signal-subtle border-signal/20',
  low: 'bg-data-positive-bg border-data-positive/30',
}

const COLOR_SEVERITY = {
  high: 'bg-data-negative-bg text-data-negative-fg',
  medium: 'bg-data-warning-bg text-data-warning-fg',
  low: 'bg-data-info-bg text-data-info-fg',
}

const GRADE_COLORS = {
  A: 'bg-data-positive-bg text-data-positive-fg',
  B: 'bg-data-info-bg text-data-info-fg',
  C: 'bg-data-warning-bg text-data-warning-fg',
  D: 'bg-signal-subtle text-signal',
  F: 'bg-data-negative-bg text-data-negative-fg',
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
          <div className="w-12 h-12 border-4 border-surface-elev border-t-signal rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-fg-muted">Loading Supply Chain Command Center...</p>
        </div>
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="p-8">
        <div className="bg-data-negative-bg border border-data-negative/30 rounded-lg p-6">
          <h2 className="text-data-negative-fg font-semibold">Error Loading Data</h2>
          <p className="text-data-negative-fg mt-2">{error || 'No data received'}</p>
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
    <div className="bg-canvas">
      {/* Header */}
      <div className="px-8 py-6">
        <PageHeader
          title="Supply Chain Command Center"
          description="Vendor performance, procurement pipeline, and risk monitoring"
          crumbs={[{ label: 'Ops', href: '/ops' }, { label: 'Supply Chain' }]}
        />
        <p className="text-xs text-fg-subtle -mt-3">Last updated: {new Date(data.timestamp).toLocaleTimeString()}</p>
      </div>

      <div className="p-8 space-y-8">
        {/* KPI Row */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          {/* Total Open PO Value */}
          <div className="bg-surface rounded-lg border border-border p-6">
            <p className="text-fg-muted text-sm font-medium">Total Open PO Value</p>
            <p className="text-3xl font-semibold text-fg mt-2">{formatCurrency(data.totalOpenPOValue)}</p>
            <p className="text-xs text-fg-subtle mt-2">
              {Object.values(data.poPipeline).reduce((sum, p) => sum + p.count, 0)} open orders
            </p>
          </div>

          {/* Avg Lead Time */}
          <div className="bg-surface rounded-lg border border-border p-6">
            <p className="text-fg-muted text-sm font-medium">Avg Lead Time</p>
            <p className="text-3xl font-semibold text-fg mt-2">{data.avgLeadDays.toFixed(1)}</p>
            <p className="text-xs text-fg-subtle mt-2">days from PO to delivery</p>
          </div>

          {/* Vendor Count */}
          <div className="bg-surface rounded-lg border border-border p-6">
            <p className="text-fg-muted text-sm font-medium">Active Vendors</p>
            <p className="text-3xl font-semibold text-fg mt-2">{data.vendorConcentration.length}</p>
            <p className="text-xs text-fg-subtle mt-2">suppliers tracked (12m)</p>
          </div>

          {/* At-Risk Materials */}
          <div className="bg-surface rounded-lg border border-border p-6">
            <p className="text-fg-muted text-sm font-medium">At-Risk Materials</p>
            <p className="text-3xl font-semibold text-fg mt-2">{data.materialForecast.length}</p>
            <p className="text-xs text-fg-subtle mt-2">products below reorder point</p>
          </div>
        </div>

        {/* Vendor Concentration Chart */}
        <div className="bg-surface rounded-lg border border-border p-6">
          <h2 className="text-lg font-semibold text-fg mb-4">Vendor Concentration</h2>
          <div className="space-y-3">
            {data.vendorConcentration.slice(0, 10).map(v => (
              <div key={v.vendorId} className="flex items-center gap-4">
                <div className="w-32 text-sm font-medium text-fg truncate">
                  {v.vendorName}
                </div>
                <div className="flex-1 bg-surface-elev rounded-full h-6 border border-border overflow-hidden relative">
                  <div
                    className={`h-full transition-all ${v.isHighRisk ? 'bg-data-negative' : 'bg-signal'}`}
                    style={{ width: `${Math.min(v.percentOfTotal, 100)}%` }}
                  />
                </div>
                <div className="w-20 text-right">
                  <p className="text-sm font-semibold text-fg">{v.percentOfTotal.toFixed(1)}%</p>
                  <p className="text-xs text-fg-subtle">{v.poCount} POs</p>
                </div>
              </div>
            ))}
          </div>
          {data.vendorConcentration.length > 10 && (
            <p className="text-xs text-fg-subtle mt-4">
              +{data.vendorConcentration.length - 10} more vendors
            </p>
          )}
        </div>

        {/* PO Pipeline */}
        <div className="bg-surface rounded-lg border border-border p-6">
          <h2 className="text-lg font-semibold text-fg mb-4">Procurement Pipeline</h2>
          <div className="flex gap-2">
            {/* DRAFT */}
            {draftCount > 0 && (
              <div className="flex-1 bg-surface-muted rounded-lg p-4 text-center">
                <p className="text-2xl font-semibold text-fg">{draftCount}</p>
                <p className="text-xs text-fg-muted mt-1">DRAFT</p>
                <p className="text-xs text-fg-subtle mt-2">{formatCurrency(data.poPipeline['DRAFT']?.value || 0)}</p>
              </div>
            )}

            {/* APPROVED */}
            {approvedCount > 0 && (
              <div className="flex-1 bg-data-info-bg rounded-lg p-4 text-center">
                <p className="text-2xl font-semibold text-data-info-fg">{approvedCount}</p>
                <p className="text-xs text-data-info-fg mt-1">APPROVED</p>
                <p className="text-xs text-data-info-fg mt-2">{formatCurrency(data.poPipeline['APPROVED']?.value || 0)}</p>
              </div>
            )}

            {/* SENT */}
            {sentCount > 0 && (
              <div className="flex-1 bg-signal rounded-lg p-4 text-center">
                <p className="text-2xl font-semibold text-fg-on-accent">{sentCount}</p>
                <p className="text-xs text-fg-on-accent mt-1">SENT</p>
                <p className="text-xs text-fg-on-accent mt-2">{formatCurrency(data.poPipeline['SENT']?.value || 0)}</p>
              </div>
            )}

            {/* PARTIALLY_RECEIVED */}
            {partiallyReceivedCount > 0 && (
              <div className="flex-1 bg-data-positive-bg rounded-lg p-4 text-center">
                <p className="text-2xl font-semibold text-data-positive-fg">{partiallyReceivedCount}</p>
                <p className="text-xs text-data-positive-fg mt-1">PARTIAL RX</p>
                <p className="text-xs text-data-positive-fg mt-2">
                  {formatCurrency(data.poPipeline['PARTIALLY_RECEIVED']?.value || 0)}
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Vendor Scorecard Table */}
        <div className="bg-surface rounded-lg border border-border p-6 overflow-x-auto">
          <h2 className="text-lg font-semibold text-fg mb-4">Vendor Scorecard</h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border-strong">
                <th className="text-left py-3 px-3 font-semibold text-fg-muted">Vendor</th>
                <th className="text-center py-3 px-3 font-semibold text-fg-muted">PO Count</th>
                <th className="text-right py-3 px-3 font-semibold text-fg-muted">Total Spend</th>
                <th className="text-center py-3 px-3 font-semibold text-fg-muted">% of Total</th>
                <th className="text-center py-3 px-3 font-semibold text-fg-muted">Avg Lead (days)</th>
                <th className="text-center py-3 px-3 font-semibold text-fg-muted">On-Time %</th>
                <th className="text-center py-3 px-3 font-semibold text-fg-muted">Score</th>
                <th className="text-center py-3 px-3 font-semibold text-fg-muted">Grade</th>
              </tr>
            </thead>
            <tbody>
              {data.vendorScorecards.map(v => (
                <tr key={v.vendorId} className="border-b border-border hover:bg-row-hover transition-colors">
                  <td className="py-3 px-3 font-medium text-fg">{v.vendorName}</td>
                  <td className="py-3 px-3 text-center text-fg-muted">{v.poCount}</td>
                  <td className="py-3 px-3 text-right text-fg-muted font-semibold">{formatCurrency(v.totalSpend)}</td>
                  <td className="py-3 px-3 text-center text-fg-muted">{v.percentOfTotal.toFixed(1)}%</td>
                  <td className="py-3 px-3 text-center text-fg-muted">{v.avgLeadDays.toFixed(1)}</td>
                  <td className="py-3 px-3 text-center text-fg-muted">
                    {v.onTimeRate !== null ? `${(v.onTimeRate * 100).toFixed(0)}%` : '—'}
                  </td>
                  <td className="py-3 px-3 text-center text-fg-muted font-semibold">{v.reliabilityScore}</td>
                  <td className="py-3 px-3 text-center">
                    <span className={`inline-block px-3 py-1 rounded font-semibold text-xs ${GRADE_COLORS[v.grade]}`}>
                      {v.grade}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Material Forecast Table */}
        <div className="bg-surface rounded-lg border border-border p-6 overflow-x-auto">
          <h2 className="text-lg font-semibold text-fg mb-4">Material Forecast (Below Reorder Point)</h2>
          {data.materialForecast.length === 0 ? (
            <EmptyState
              size="compact"
              icon={<Factory className="w-6 h-6 text-fg-subtle" />}
              title="Above reorder threshold"
              description="All materials above reorder threshold."
            />
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border-strong">
                  <th className="text-left py-3 px-3 font-semibold text-fg-muted">Product</th>
                  <th className="text-center py-3 px-3 font-semibold text-fg-muted">On Hand</th>
                  <th className="text-center py-3 px-3 font-semibold text-fg-muted">Reorder Point</th>
                  <th className="text-center py-3 px-3 font-semibold text-fg-muted">On Order</th>
                  <th className="text-center py-3 px-3 font-semibold text-fg-muted">Available</th>
                  <th className="text-left py-3 px-3 font-semibold text-fg-muted">Preferred Vendor</th>
                  <th className="text-center py-3 px-3 font-semibold text-fg-muted">Urgency</th>
                </tr>
              </thead>
              <tbody>
                {data.materialForecast.map(m => (
                  <tr
                    key={m.inventoryId}
                    className={`border-b border-border hover:bg-row-hover transition-colors ${COLOR_URGENCY[m.urgency]}`}
                  >
                    <td className="py-3 px-3 font-medium text-fg">{m.productName}</td>
                    <td className="py-3 px-3 text-center text-fg-muted font-semibold">{m.onHand}</td>
                    <td className="py-3 px-3 text-center text-fg-muted">{m.reorderPoint}</td>
                    <td className="py-3 px-3 text-center text-fg-muted">{m.onOrder}</td>
                    <td className="py-3 px-3 text-center text-fg-muted">{m.available}</td>
                    <td className="py-3 px-3 text-fg">{m.preferredVendor || '—'}</td>
                    <td className="py-3 px-3 text-center">
                      <span
                        className={`inline-block px-2 py-1 rounded text-xs font-semibold ${
                          m.urgency === 'critical'
                            ? 'bg-data-negative-bg text-data-negative-fg'
                            : m.urgency === 'high'
                              ? 'bg-data-warning-bg text-data-warning-fg'
                              : m.urgency === 'medium'
                                ? 'bg-signal-subtle text-signal'
                                : 'bg-data-positive-bg text-data-positive-fg'
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
          <h2 className="text-lg font-semibold text-fg">Risk Alerts</h2>
          {data.riskAlerts.length === 0 ? (
            <div className="bg-data-positive-bg border border-data-positive/30 rounded-lg p-6">
              <p className="text-data-positive-fg font-medium">No active supply chain risks detected</p>
              <p className="text-data-positive-fg text-sm mt-1">All vendors and inventory levels are within normal parameters.</p>
            </div>
          ) : (
            data.riskAlerts.map((alert, idx) => (
              <div
                key={idx}
                className={`rounded-lg border p-4 cursor-pointer transition-all ${
                  expandedRisks[idx]
                    ? alert.severity === 'high'
                      ? 'bg-data-negative-bg border-data-negative/30'
                      : alert.severity === 'medium'
                        ? 'bg-data-warning-bg border-data-warning/30'
                        : 'bg-data-info-bg border-data-info/30'
                    : 'bg-surface border-border'
                }`}
                onClick={() => toggleRisk(idx)}
              >
                <div className="flex items-start gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <p className="font-semibold text-fg">{alert.title}</p>
                      <span className={`inline-block px-2 py-0.5 rounded text-xs font-semibold ${COLOR_SEVERITY[alert.severity]}`}>
                        {alert.severity.toUpperCase()}
                      </span>
                    </div>
                    {expandedRisks[idx] && (
                      <div className="mt-2 space-y-2">
                        <p className="text-fg">{alert.message}</p>
                        {alert.metadata && (
                          <div className="text-xs text-fg-muted bg-surface-muted/50 rounded px-2 py-1">
                            <p className="font-mono">{JSON.stringify(alert.metadata, null, 2)}</p>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                  <p className="text-fg-subtle text-lg">{expandedRisks[idx] ? '▼' : '▶'}</p>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
