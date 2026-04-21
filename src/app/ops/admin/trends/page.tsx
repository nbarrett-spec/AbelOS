'use client'

import { useEffect, useState } from 'react'

interface MetricSeries {
  period: string
  value: number
}

interface Metric {
  id: string
  name: string
  currentValue: number
  priorValue: number
  changePercent: number
  trend: 'UP' | 'DOWN' | 'FLAT'
  format: 'currency' | 'percent' | 'number' | 'days'
  series: MetricSeries[]
}

interface TrendsResponse {
  metrics: Metric[]
  generatedAt: string
}

// Format value based on type
function formatValue(value: number, format: string): string {
  if (format === 'currency') {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value)
  }
  if (format === 'percent') {
    return `${Math.round(value * 100) / 100}%`
  }
  if (format === 'days') {
    return `${Math.round(value)} days`
  }
  return Math.round(value).toString()
}

// Inline SVG sparkline
function Sparkline({ series, trend }: { series: MetricSeries[]; trend: string }) {
  if (!series || series.length === 0) {
    return <div className="w-full h-10 bg-gray-100 rounded" />
  }

  const values = series.map((s) => s.value)
  const maxVal = Math.max(...values)
  const minVal = Math.min(...values)
  const range = maxVal - minVal || 1

  const points = values
    .map((v, i) => {
      const x = (i / (values.length - 1 || 1)) * 120
      const y = 40 - ((v - minVal) / range) * 36
      return `${x},${y}`
    })
    .join(' ')

  const strokeColor =
    trend === 'UP' ? '#27AE60' : trend === 'DOWN' ? '#E74C3C' : '#999999'

  return (
    <svg viewBox="0 0 120 40" className="w-full h-10">
      <polyline points={points} fill="none" stroke={strokeColor} strokeWidth="2" />
    </svg>
  )
}

// Expanded chart view
function ExpandedChart({ metric }: { metric: Metric }) {
  if (!metric.series || metric.series.length === 0) {
    return <div className="p-4 text-gray-500">No data available</div>
  }

  const values = metric.series.map((s) => s.value)
  const maxVal = Math.max(...values)
  const minVal = Math.min(...values)
  const range = maxVal - minVal || 1

  // Build larger chart with gridlines
  const chartHeight = 200
  const chartWidth = 600

  // Y-axis scale (4 gridlines)
  const ySteps = [0, 0.33, 0.67, 1]
  const yLabels = ySteps.map((step) => minVal + step * range)

  // Data points as SVG
  const points = metric.series
    .map((s, i) => {
      const x = (i / (metric.series.length - 1 || 1)) * (chartWidth - 60)
      const y = chartHeight - ((s.value - minVal) / range) * (chartHeight - 40) - 20
      return `${x + 50},${y}`
    })
    .join(' ')

  const strokeColor =
    metric.trend === 'UP' ? '#27AE60' : metric.trend === 'DOWN' ? '#E74C3C' : '#999999'

  return (
    <div className="p-4 bg-gray-50 rounded">
      <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} className="w-full border border-gray-200 rounded bg-white">
        {/* Gridlines */}
        {ySteps.map((step, i) => (
          <g key={i}>
            <line
              x1="50"
              y1={chartHeight - step * (chartHeight - 40) - 20}
              x2={chartWidth}
              y2={chartHeight - step * (chartHeight - 40) - 20}
              stroke="#ddd"
              strokeDasharray="2,2"
            />
            <text
              x="40"
              y={chartHeight - step * (chartHeight - 40) - 15}
              textAnchor="end"
              className="text-xs"
              fill="#666"
            >
              {formatValue(yLabels[i], metric.format)}
            </text>
          </g>
        ))}

        {/* X-axis */}
        <line x1="50" y1={chartHeight - 20} x2={chartWidth} y2={chartHeight - 20} stroke="#333" />

        {/* Data line */}
        <polyline points={points} fill="none" stroke={strokeColor} strokeWidth="2" />

        {/* Data points */}
        {metric.series.map((s, i) => {
          const x = (i / (metric.series.length - 1 || 1)) * (chartWidth - 60)
          const y = chartHeight - ((s.value - minVal) / range) * (chartHeight - 40) - 20
          return <circle key={i} cx={x + 50} cy={y} r="3" fill={strokeColor} />
        })}
      </svg>

      {/* Data table */}
      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-300">
              <th className="text-left py-2 px-2">Period</th>
              <th className="text-right py-2 px-2">Value</th>
            </tr>
          </thead>
          <tbody>
            {metric.series.map((s, i) => (
              <tr key={i} className="border-b border-gray-200 hover:bg-gray-100">
                <td className="py-2 px-2">{s.period}</td>
                <td className="text-right py-2 px-2 font-mono">{formatValue(s.value, metric.format)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default function AdminTrendsPage() {
  const [data, setData] = useState<TrendsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [period, setPeriod] = useState<'6' | '12'>('12')

  useEffect(() => {
    async function loadTrends() {
      try {
        setLoading(true)
        const res = await fetch(`/api/ops/admin/trends`)
        if (res.ok) {
          const json = await res.json()
          setData(json)
        }
      } catch (error) {
        console.error('Failed to load trends:', error)
      } finally {
        setLoading(false)
      }
    }

    loadTrends()
  }, [period])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#0f2a3e]" />
      </div>
    )
  }

  if (!data) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-500">Failed to load trends data</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-[#0f2a3e] text-white py-8 px-6">
        <h1 className="text-3xl font-bold">Business Trends</h1>
        <p className="text-gray-300 mt-2">12-month metric tracking across all operations</p>
      </div>

      {/* Controls */}
      <div className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
        <div className="flex gap-4">
          <button
            onClick={() => setPeriod('6')}
            className={`px-4 py-2 rounded font-medium transition ${
              period === '6'
                ? 'bg-[#C6A24E] text-white'
                : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
            }`}
          >
            Last 6 Months
          </button>
          <button
            onClick={() => setPeriod('12')}
            className={`px-4 py-2 rounded font-medium transition ${
              period === '12'
                ? 'bg-[#C6A24E] text-white'
                : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
            }`}
          >
            Last 12 Months
          </button>
        </div>
        <p className="text-sm text-gray-500">
          Generated {new Date(data.generatedAt).toLocaleString()}
        </p>
      </div>

      {/* Metrics Grid */}
      <div className="p-6">
        <div className="grid grid-cols-4 gap-6">
          {data.metrics.map((metric) => (
            <div
              key={metric.id}
              onClick={() =>
                setExpandedId(expandedId === metric.id ? null : metric.id)
              }
              className="bg-white rounded-lg shadow p-5 cursor-pointer hover:shadow-lg transition border-l-4 border-[#C6A24E]"
            >
              {/* Metric name */}
              <h3 className="text-sm font-semibold text-gray-700 truncate">
                {metric.name}
              </h3>

              {/* Current value */}
              <p className="text-2xl font-bold text-[#0f2a3e] mt-3">
                {formatValue(metric.currentValue, metric.format)}
              </p>

              {/* Change indicator */}
              <div className="flex items-center gap-2 mt-2">
                {metric.trend === 'UP' && (
                  <span className="text-[#27AE60] font-bold text-lg">▲</span>
                )}
                {metric.trend === 'DOWN' && (
                  <span className="text-[#E74C3C] font-bold text-lg">▼</span>
                )}
                {metric.trend === 'FLAT' && (
                  <span className="text-gray-400 font-bold text-lg">—</span>
                )}
                <span
                  className={`text-sm font-semibold ${
                    metric.trend === 'UP'
                      ? 'text-[#27AE60]'
                      : metric.trend === 'DOWN'
                        ? 'text-[#E74C3C]'
                        : 'text-gray-500'
                  }`}
                >
                  {Math.abs(metric.changePercent).toFixed(1)}%
                </span>
              </div>

              {/* Sparkline */}
              <div className="mt-4">
                <Sparkline series={metric.series} trend={metric.trend} />
              </div>
            </div>
          ))}
        </div>

        {/* Expanded view */}
        {expandedId && (
          <div className="mt-8 bg-white rounded-lg shadow p-6 border-l-4 border-[#C6A24E]">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-2xl font-bold text-[#0f2a3e]">
                {data.metrics.find((m) => m.id === expandedId)?.name}
              </h2>
              <button
                onClick={() => setExpandedId(null)}
                className="text-gray-500 hover:text-gray-700 text-2xl"
              >
                ✕
              </button>
            </div>
            {data.metrics.find((m) => m.id === expandedId) && (
              <ExpandedChart metric={data.metrics.find((m) => m.id === expandedId)!} />
            )}
          </div>
        )}
      </div>
    </div>
  )
}
