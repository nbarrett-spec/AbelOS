'use client'

import { useEffect, useState } from 'react'

interface DashboardData {
  timestamp: string
  pnl: {
    current: {
      revenue: number
      cogs: number
      grossProfit: number
      grossMarginPct: number
    }
    prior: {
      revenue: number
      cogs: number
      grossProfit: number
      grossMarginPct: number
    }
    revenueChangePercent: number
  }
  cashPosition: {
    totalAR: number
    totalAP: number
    netPosition: number
  }
  arAging: {
    current: number
    days_1_30: number
    days_31_60: number
    days_61_90: number
    days_90_plus: number
  }
  topBuilders: Array<{
    id: string
    companyName: string
    outstanding: number
    creditLimit: number
    utilizationPercent: number
  }>
  revenueTrend: Array<{ month: string; revenue: number }>
  dsoTrend: Array<{ month: string; dso: number }>
  currentDSO: number
  marginTrend: Array<{ month: string; grossMarginPct: number }>
  deliveryPerformance: {
    onTimePercent: number
  }
  headcount: Array<{ department: string; count: number }>
  alerts: {
    overdue: number
    creditBreach: number
    stockout: number
  }
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value)
}

function formatPercent(value: number): string {
  return `${(Math.round(value * 100) / 100).toFixed(1)}%`
}

export default function ExecutiveDashboard() {
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<string>('')

  const fetchData = async () => {
    try {
      const response = await fetch('/api/executive/dashboard')
      if (response.ok) {
        const json = await response.json()
        setData(json)
        setLastUpdated(new Date().toLocaleTimeString())
        setError(null)
      } else {
        setError(`Failed to load dashboard: ${response.statusText}`)
      }
    } catch (err) {
      console.error('Failed to fetch dashboard data:', err)
      setError('Unable to connect to server')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchData()
    const interval = setInterval(fetchData, 300000) // 5 minutes
    return () => clearInterval(interval)
  }, [])

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <p className="text-gray-500">Loading dashboard...</p>
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="p-8">
        <div className="bg-red-50 border border-red-200 rounded-lg p-6">
          <h2 className="font-semibold text-red-900">Error Loading Dashboard</h2>
          <p className="text-red-700 mt-2">{error || 'No data received'}</p>
        </div>
      </div>
    )
  }

  const revenueChangeSign = data.pnl.revenueChangePercent >= 0 ? '+' : ''
  const revenueChangeColor =
    data.pnl.revenueChangePercent >= 0 ? 'text-green-700' : 'text-red-700'

  const revenueTrendMax = Math.max(...data.revenueTrend.map(r => r.revenue), 1)
  const dsoTrendMax = Math.max(...data.dsoTrend.map(d => d.dso), 1)

  const arAgingTotal =
    data.arAging.current +
    data.arAging.days_1_30 +
    data.arAging.days_31_60 +
    data.arAging.days_61_90 +
    data.arAging.days_90_plus

  return (
    <div className="space-y-6 pb-12">
      {/* Top Row: 4 KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Monthly Revenue */}
        <div className="bg-white rounded-lg border border-gray-200 p-6 shadow-sm">
          <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-2">
            Monthly Revenue
          </p>
          <p className="text-3xl font-bold text-[#3E2A1E]">
            {formatCurrency(data.pnl.current.revenue)}
          </p>
          <p
            className={`text-sm font-medium mt-2 ${revenueChangeColor}`}
          >
            {revenueChangeSign}{formatPercent(data.pnl.revenueChangePercent)} vs prior month
          </p>
        </div>

        {/* Gross Margin % */}
        <div className="bg-white rounded-lg border border-gray-200 p-6 shadow-sm">
          <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-2">
            Gross Margin
          </p>
          <p className="text-3xl font-bold text-[#C9822B]">
            {formatPercent(data.pnl.current.grossMarginPct)}
          </p>
          <p className="text-sm text-gray-500 mt-2">
            {formatCurrency(data.pnl.current.grossProfit)} profit
          </p>
        </div>

        {/* AR Outstanding */}
        <div className="bg-white rounded-lg border border-gray-200 p-6 shadow-sm">
          <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-2">
            AR Outstanding
          </p>
          <p className="text-3xl font-bold text-[#3E2A1E]">
            {formatCurrency(data.cashPosition.totalAR)}
          </p>
          <p className="text-sm text-gray-500 mt-2">
            {formatPercent(
              (data.arAging.days_90_plus / arAgingTotal) * 100 || 0
            )}{' '}
            past due
          </p>
        </div>

        {/* DSO */}
        <div className="bg-white rounded-lg border border-gray-200 p-6 shadow-sm">
          <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-2">
            DSO (Days Sales Outstanding)
          </p>
          <p className="text-3xl font-bold text-[#27AE60]">
            {Math.round(data.currentDSO)}
          </p>
          <p className="text-sm text-gray-500 mt-2">days to collect</p>
        </div>
      </div>

      {/* Second Row: Revenue Trend + AR Aging */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Revenue Trend */}
        <div className="bg-white rounded-lg border border-gray-200 p-6 shadow-sm">
          <h2 className="text-sm font-bold text-[#3E2A1E] mb-4 uppercase tracking-wide">
            12-Month Revenue Trend
          </h2>
          <svg className="w-full h-48" viewBox="0 0 400 200">
            {/* Grid */}
            <line
              x1="40"
              y1="150"
              x2="390"
              y2="150"
              stroke="#e5e7eb"
              strokeWidth="1"
            />
            <line
              x1="40"
              y1="100"
              x2="390"
              y2="100"
              stroke="#e5e7eb"
              strokeWidth="1"
            />
            <line
              x1="40"
              y1="50"
              x2="390"
              y2="50"
              stroke="#e5e7eb"
              strokeWidth="1"
            />

            {/* Y-axis label */}
            <text x="15" y="155" fontSize="10" fill="#666" textAnchor="end">
              $0
            </text>
            <text x="15" y="105" fontSize="10" fill="#666" textAnchor="end">
              {formatCurrency(revenueTrendMax / 2).substring(0, 3)}k
            </text>
            <text x="15" y="55" fontSize="10" fill="#666" textAnchor="end">
              {formatCurrency(revenueTrendMax).substring(0, 3)}k
            </text>

            {/* Bars */}
            {data.revenueTrend.map((point, idx) => {
              const barHeight = (point.revenue / revenueTrendMax) * 130
              const barX = 50 + (idx * 360) / data.revenueTrend.length
              const barWidth = (360 / data.revenueTrend.length) * 0.7
              return (
                <g key={`bar-${idx}`}>
                  <rect
                    x={barX}
                    y={150 - barHeight}
                    width={barWidth}
                    height={barHeight}
                    fill="#C9822B"
                    rx="2"
                  />
                </g>
              )
            })}

            {/* X-axis labels */}
            {data.revenueTrend.map((point, idx) => {
              const barX = 50 + (idx * 360) / data.revenueTrend.length
              const monthStr = new Date(point.month).toLocaleDateString(
                'en-US',
                {
                  month: 'short',
                }
              )
              return (
                <text
                  key={`label-${idx}`}
                  x={barX + (360 / data.revenueTrend.length) * 0.35}
                  y="170"
                  fontSize="9"
                  fill="#666"
                  textAnchor="middle"
                >
                  {monthStr}
                </text>
              )
            })}
          </svg>
        </div>

        {/* AR Aging Waterfall */}
        <div className="bg-white rounded-lg border border-gray-200 p-6 shadow-sm">
          <h2 className="text-sm font-bold text-[#3E2A1E] mb-4 uppercase tracking-wide">
            AR Aging
          </h2>
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <div className="w-24 text-xs font-medium text-gray-700">Current</div>
              <div className="flex-1 bg-gray-100 rounded h-6 overflow-hidden">
                <div
                  className="bg-[#27AE60] h-full"
                  style={{
                    width: `${(data.arAging.current / arAgingTotal) * 100 || 0}%`,
                  }}
                />
              </div>
              <div className="w-20 text-right text-xs font-medium text-gray-700">
                {formatCurrency(data.arAging.current)}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-24 text-xs font-medium text-gray-700">1-30 days</div>
              <div className="flex-1 bg-gray-100 rounded h-6 overflow-hidden">
                <div
                  className="bg-[#C9822B] h-full"
                  style={{
                    width: `${(data.arAging.days_1_30 / arAgingTotal) * 100 || 0}%`,
                  }}
                />
              </div>
              <div className="w-20 text-right text-xs font-medium text-gray-700">
                {formatCurrency(data.arAging.days_1_30)}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-24 text-xs font-medium text-gray-700">31-60 days</div>
              <div className="flex-1 bg-gray-100 rounded h-6 overflow-hidden">
                <div
                  className="bg-yellow-500 h-full"
                  style={{
                    width: `${(data.arAging.days_31_60 / arAgingTotal) * 100 || 0}%`,
                  }}
                />
              </div>
              <div className="w-20 text-right text-xs font-medium text-gray-700">
                {formatCurrency(data.arAging.days_31_60)}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-24 text-xs font-medium text-gray-700">61-90 days</div>
              <div className="flex-1 bg-gray-100 rounded h-6 overflow-hidden">
                <div
                  className="bg-orange-500 h-full"
                  style={{
                    width: `${(data.arAging.days_61_90 / arAgingTotal) * 100 || 0}%`,
                  }}
                />
              </div>
              <div className="w-20 text-right text-xs font-medium text-gray-700">
                {formatCurrency(data.arAging.days_61_90)}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-24 text-xs font-medium text-gray-700">90+ days</div>
              <div className="flex-1 bg-gray-100 rounded h-6 overflow-hidden">
                <div
                  className="bg-red-600 h-full"
                  style={{
                    width: `${(data.arAging.days_90_plus / arAgingTotal) * 100 || 0}%`,
                  }}
                />
              </div>
              <div className="w-20 text-right text-xs font-medium text-gray-700">
                {formatCurrency(data.arAging.days_90_plus)}
              </div>
            </div>
          </div>
          <p className="text-xs text-gray-500 mt-4">
            Total AR: {formatCurrency(arAgingTotal)}
          </p>
        </div>
      </div>

      {/* Third Row: Top Builders + Cash Position */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Top Builders */}
        <div className="bg-white rounded-lg border border-gray-200 p-6 shadow-sm">
          <h2 className="text-sm font-bold text-[#3E2A1E] mb-4 uppercase tracking-wide">
            Top 5 Builder Exposure
          </h2>
          <div className="space-y-3">
            {data.topBuilders.map(builder => (
              <div key={builder.id} className="border-b border-gray-100 pb-3 last:border-0">
                <div className="flex items-start justify-between mb-1">
                  <p className="text-sm font-medium text-gray-900">
                    {builder.companyName}
                  </p>
                  <span
                    className={`text-xs font-semibold ${
                      builder.utilizationPercent > 90
                        ? 'text-red-600'
                        : builder.utilizationPercent > 70
                          ? 'text-yellow-600'
                          : 'text-gray-600'
                    }`}
                  >
                    {formatPercent(builder.utilizationPercent)}
                  </span>
                </div>
                <div className="text-xs text-gray-500 mb-2">
                  Outstanding: {formatCurrency(builder.outstanding)} / Limit:{' '}
                  {formatCurrency(builder.creditLimit)}
                </div>
                <div className="w-full bg-gray-100 rounded h-2 overflow-hidden">
                  <div
                    className={`h-full ${
                      builder.utilizationPercent > 90
                        ? 'bg-red-600'
                        : builder.utilizationPercent > 70
                          ? 'bg-yellow-500'
                          : 'bg-[#27AE60]'
                    }`}
                    style={{
                      width: `${Math.min(builder.utilizationPercent, 100)}%`,
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Cash Position Summary */}
        <div className="bg-white rounded-lg border border-gray-200 p-6 shadow-sm">
          <h2 className="text-sm font-bold text-[#3E2A1E] mb-6 uppercase tracking-wide">
            Cash Position
          </h2>
          <div className="space-y-6">
            <div>
              <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-2">
                Accounts Receivable
              </p>
              <p className="text-4xl font-bold text-[#27AE60]">
                {formatCurrency(data.cashPosition.totalAR)}
              </p>
            </div>
            <div>
              <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-2">
                Accounts Payable
              </p>
              <p className="text-4xl font-bold text-[#C9822B]">
                {formatCurrency(data.cashPosition.totalAP)}
              </p>
            </div>
            <div className="border-t pt-4">
              <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-2">
                Net Position
              </p>
              <p
                className={`text-4xl font-bold ${
                  data.cashPosition.netPosition >= 0
                    ? 'text-[#27AE60]'
                    : 'text-red-600'
                }`}
              >
                {formatCurrency(data.cashPosition.netPosition)}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Fourth Row: Delivery + Headcount + Alerts */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Delivery On-Time */}
        <div className="bg-white rounded-lg border border-gray-200 p-6 shadow-sm">
          <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-4">
            Delivery On-Time (30d)
          </p>
          <div className="flex items-center gap-4">
            <div className="flex-1">
              <p className="text-4xl font-bold text-[#27AE60]">
                {Math.round(data.deliveryPerformance.onTimePercent)}%
              </p>
            </div>
            <div className="w-24 h-24">
              <svg viewBox="0 0 100 100" className="w-full h-full">
                <circle
                  cx="50"
                  cy="50"
                  r="45"
                  fill="none"
                  stroke="#e5e7eb"
                  strokeWidth="8"
                />
                <circle
                  cx="50"
                  cy="50"
                  r="45"
                  fill="none"
                  stroke="#27AE60"
                  strokeWidth="8"
                  strokeDasharray={`${
                    (data.deliveryPerformance.onTimePercent / 100) * 282.7
                  } 282.7`}
                  strokeLinecap="round"
                  transform="rotate(-90 50 50)"
                />
              </svg>
            </div>
          </div>
        </div>

        {/* Headcount by Department */}
        <div className="bg-white rounded-lg border border-gray-200 p-6 shadow-sm">
          <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-4">
            Headcount by Department
          </p>
          <div className="space-y-2">
            {data.headcount.map(dept => (
              <div key={dept.department} className="flex items-center justify-between">
                <span className="text-sm text-gray-700">{dept.department}</span>
                <span className="text-sm font-bold text-[#3E2A1E]">
                  {dept.count}
                </span>
              </div>
            ))}
          </div>
          <p className="text-xs text-gray-500 mt-4">
            Total:{' '}
            <span className="font-semibold">
              {data.headcount.reduce((sum, d) => sum + d.count, 0)}
            </span>
          </p>
        </div>

        {/* Active Alerts */}
        <div className="bg-white rounded-lg border border-gray-200 p-6 shadow-sm">
          <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-4">
            Active Alerts
          </p>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-700">Overdue Invoices</span>
              <span className="text-sm font-bold px-2 py-1 rounded bg-red-100 text-red-700">
                {data.alerts.overdue}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-700">Credit Breaches</span>
              <span className="text-sm font-bold px-2 py-1 rounded bg-orange-100 text-orange-700">
                {data.alerts.creditBreach}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-700">Low Stock Items</span>
              <span className="text-sm font-bold px-2 py-1 rounded bg-yellow-100 text-yellow-700">
                {data.alerts.stockout}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="text-right text-xs text-gray-400 mt-8">
        Last updated: {lastUpdated || 'Never'}
      </div>
    </div>
  )
}
