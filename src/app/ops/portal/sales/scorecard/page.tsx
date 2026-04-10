'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'

export default function SalesScorecardPage() {
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [period, setPeriod] = useState(30)

  useEffect(() => {
    setLoading(true)
    fetch(`/api/ops/sales-scorecard?period=${period}`)
      .then(r => r.json())
      .then(d => setData(d))
      .catch((err) => {
        console.error('Failed to fetch sales scorecard:', err)
        setError('Failed to load scorecard data. Please try refreshing.')
      })
      .finally(() => setLoading(false))
  }, [period])

  const fmtCurrency = (n: number) => '$' + (n || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })

  const gradeColors: Record<string, string> = {
    A: 'bg-green-100 text-green-800 border-green-300',
    B: 'bg-blue-100 text-blue-800 border-blue-300',
    C: 'bg-yellow-100 text-yellow-800 border-yellow-300',
    D: 'bg-orange-100 text-orange-800 border-orange-300',
    F: 'bg-red-100 text-red-800 border-red-300',
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 border-4 border-[#1B4F72] border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="space-y-4">
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
          <p>{error}</p>
          <button onClick={() => { setError(null); window.location.reload() }} className="text-red-900 underline text-sm mt-1">
            Try again
          </button>
        </div>
      </div>
    )
  }

  const reps = data?.reps || []
  const companyAvg = data?.companyAverages || {}

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Sales Performance Scorecard</h1>
          <p className="text-sm text-gray-500 mt-1">Win rates, pipeline, and activity metrics</p>
        </div>
        <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
          {[30, 90, 180, 365].map(d => (
            <button key={d} onClick={() => setPeriod(d)} className={`px-3 py-1.5 text-sm rounded-md font-medium transition ${period === d ? 'bg-white shadow text-[#1B4F72]' : 'text-gray-500 hover:text-gray-700'}`}>
              {d === 365 ? '1yr' : `${d}d`}
            </button>
          ))}
        </div>
      </div>

      {/* Company Averages */}
      {companyAvg && (
        <div className="bg-gradient-to-r from-blue-50 to-indigo-50 rounded-xl border border-blue-200 p-6">
          <h3 className="text-sm font-bold text-blue-900 mb-4">Company Benchmarks</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <p className="text-xs text-blue-700">Avg Win Rate</p>
              <p className="text-2xl font-bold text-blue-900">{companyAvg.avgWinRate || 0}%</p>
            </div>
            <div>
              <p className="text-xs text-blue-700">Avg Cycle Time</p>
              <p className="text-2xl font-bold text-blue-900">{companyAvg.avgCycleTime || '—'} days</p>
            </div>
            <div>
              <p className="text-xs text-blue-700">Avg Pipeline</p>
              <p className="text-2xl font-bold text-blue-900">{fmtCurrency(companyAvg.avgPipelineValue)}</p>
            </div>
            <div>
              <p className="text-xs text-blue-700">Avg Activities/Week</p>
              <p className="text-2xl font-bold text-blue-900">{companyAvg.avgActivitiesPerWeek || 0}</p>
            </div>
          </div>
        </div>
      )}

      {/* Scorecard Grid */}
      {reps.length === 0 ? (
        <div className="bg-white rounded-xl border p-8 text-center text-gray-400">
          <p className="text-4xl mb-3">📊</p>
          <p>No sales rep data available for this period</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {reps.map((rep: any) => (
            <div key={rep.staffId} className="bg-white rounded-xl border p-5">
              {/* Header */}
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center text-lg font-bold border-2 ${gradeColors[rep.grade] || gradeColors.C}`}>
                    {rep.grade}
                  </div>
                  <div>
                    <p className="font-semibold text-gray-900">{rep.repName}</p>
                    <p className="text-xs text-gray-500">{rep.email}</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-2xl font-bold text-[#1B4F72]">{rep.score}</p>
                  <p className="text-xs text-gray-400">score</p>
                </div>
              </div>

              {/* Key Metrics Grid */}
              <div className="grid grid-cols-2 gap-3 mb-4">
                <div className="bg-gray-50 rounded-lg p-2 text-center">
                  <p className="text-lg font-bold text-gray-900">{rep.activeDeals}</p>
                  <p className="text-[10px] text-gray-500">Active Deals</p>
                </div>
                <div className="bg-gray-50 rounded-lg p-2 text-center">
                  <p className="text-lg font-bold text-[#27AE60]">{rep.wonDeals30d}</p>
                  <p className="text-[10px] text-gray-500">Won (30d)</p>
                </div>
                <div className="bg-gray-50 rounded-lg p-2 text-center">
                  <p className="text-lg font-bold text-gray-900">{rep.winRate}%</p>
                  <p className="text-[10px] text-gray-500">Win Rate</p>
                </div>
                <div className="bg-gray-50 rounded-lg p-2 text-center">
                  <p className="text-lg font-bold" style={{ color: rep.avgCycleTime > 60 ? '#E74C3C' : '#27AE60' }}>
                    {rep.avgCycleTime}d
                  </p>
                  <p className="text-[10px] text-gray-500">Cycle Time</p>
                </div>
              </div>

              {/* Bar metrics */}
              <div className="space-y-2 mb-4">
                {[
                  {
                    label: 'Win Rate',
                    value: rep.winRate,
                    color: '#1B4F72',
                    benchmark: companyAvg.avgWinRate || 50,
                  },
                  {
                    label: 'Pipeline vs Avg',
                    value: Math.min(100, (rep.pipelineValue / (companyAvg.avgPipelineValue + 1)) * 100),
                    color: '#27AE60',
                    benchmark: 100,
                  },
                  {
                    label: 'Activity Level',
                    value: Math.min(100, (rep.activitiesThisWeek / 5) * 100),
                    color: '#E67E22',
                    benchmark: 100,
                  },
                ].map(metric => (
                  <div key={metric.label}>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-gray-600">{metric.label}</span>
                      <span className="font-medium">{Math.round(metric.value)}%</span>
                    </div>
                    <div className="h-2 bg-gray-100 rounded-full overflow-hidden relative">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${metric.value}%`,
                          backgroundColor: metric.color,
                          opacity: 0.8,
                        }}
                      />
                      {metric.benchmark !== 100 && (
                        <div
                          className="absolute h-full border-r-2 border-gray-400"
                          style={{
                            left: `${metric.benchmark}%`,
                            opacity: 0.5,
                          }}
                        />
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {/* Footer stats */}
              <div className="flex justify-between pt-3 border-t text-xs text-gray-500">
                <div>
                  <p className="font-medium text-gray-700">{fmtCurrency(rep.wonValue30d)}</p>
                  <p>Won (30d)</p>
                </div>
                <div className="text-right">
                  <p className="font-medium text-gray-700">{fmtCurrency(rep.pipelineValue)}</p>
                  <p>Pipeline</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
