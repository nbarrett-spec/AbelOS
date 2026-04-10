'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'

export default function PMScorecardPage() {
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [period, setPeriod] = useState(90)

  useEffect(() => {
    setLoading(true)
    fetch(`/api/ops/pm-scorecard?period=${period}`)
      .then(r => r.json())
      .then(d => setData(d))
      .catch((err) => {
        console.error('Failed to fetch PM scorecard:', err)
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

  const scorecards = data?.scorecards || []

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">PM Performance Scorecard</h1>
          <p className="text-sm text-gray-500 mt-1">Benchmarks, completion rates, and delivery metrics</p>
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
      {data?.companyAverage && (
        <div className="bg-gray-50 rounded-xl border p-4 flex gap-6">
          <div>
            <p className="text-xs text-gray-500">Company Avg Cycle</p>
            <p className="text-lg font-bold text-gray-700">{data.companyAverage.avgCycleDays || '—'} days</p>
          </div>
          <div>
            <p className="text-xs text-gray-500">Avg Completed/PM</p>
            <p className="text-lg font-bold text-gray-700">{data.companyAverage.avgCompletedJobs || 0} jobs</p>
          </div>
        </div>
      )}

      {/* Scorecard Grid */}
      {scorecards.length === 0 ? (
        <div className="bg-white rounded-xl border p-8 text-center text-gray-400">
          <p className="text-4xl mb-3">📊</p>
          <p>No PM data available for this period</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {scorecards.map((pm: any, i: number) => (
            <div key={pm.staffId} className="bg-white rounded-xl border p-5">
              {/* Header */}
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center text-lg font-bold border-2 ${gradeColors[pm.grade] || gradeColors.C}`}>
                    {pm.grade}
                  </div>
                  <div>
                    <p className="font-semibold text-gray-900">{pm.pmName}</p>
                    <p className="text-xs text-gray-500">{pm.email}</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-2xl font-bold text-[#1B4F72]">{pm.score}</p>
                  <p className="text-xs text-gray-400">score</p>
                </div>
              </div>

              {/* Metrics Grid */}
              <div className="grid grid-cols-3 gap-3 mb-4">
                <div className="bg-gray-50 rounded-lg p-2 text-center">
                  <p className="text-lg font-bold text-gray-900">{pm.completedJobs}</p>
                  <p className="text-[10px] text-gray-500">Completed</p>
                </div>
                <div className="bg-gray-50 rounded-lg p-2 text-center">
                  <p className="text-lg font-bold text-gray-900">{pm.activeJobs}</p>
                  <p className="text-[10px] text-gray-500">Active</p>
                </div>
                <div className="bg-gray-50 rounded-lg p-2 text-center">
                  <p className="text-lg font-bold" style={{ color: pm.stalledJobs > 0 ? '#E74C3C' : '#27AE60' }}>{pm.stalledJobs}</p>
                  <p className="text-[10px] text-gray-500">Stalled</p>
                </div>
              </div>

              {/* Bar metrics */}
              <div className="space-y-2">
                {[
                  { label: 'On-Time Delivery', value: pm.onTimeRate, color: '#1B4F72' },
                  { label: 'QC Pass Rate', value: pm.qcPassRate, color: '#27AE60' },
                  { label: 'Completion Rate', value: pm.completionRate, color: '#E67E22' },
                ].map(metric => (
                  <div key={metric.label}>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-gray-600">{metric.label}</span>
                      <span className="font-medium">{metric.value}%</span>
                    </div>
                    <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div className="h-full rounded-full" style={{ width: `${metric.value}%`, backgroundColor: metric.color }} />
                    </div>
                  </div>
                ))}
              </div>

              {/* Footer stats */}
              <div className="flex justify-between mt-4 pt-3 border-t text-xs text-gray-500">
                <span>Avg Cycle: {pm.avgCycleDays || '—'} days</span>
                <span>Revenue: {fmtCurrency(pm.totalRevenue)}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
