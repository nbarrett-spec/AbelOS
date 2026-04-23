'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

interface PassRateByWeek {
  weekStart: string
  passed: number
  conditional: number
  failed: number
  total: number
  passRate: number
  acceptableRate: number
}

interface DefectByType {
  checkType: string
  passed: number
  failed: number
  total: number
  passRate: number
}

interface FailureReason {
  reason: string
  count: number
}

interface DefectByCrew {
  crewName: string | null
  passed: number
  failed: number
  total: number
  passRate: number
}

interface DailyTrend {
  date: string
  passed: number
  failed: number
  total: number
}

interface ResultBreakdown {
  result: string
  count: number
}

interface QCTrends {
  period: number
  passRateByWeek: PassRateByWeek[]
  defectsByType: DefectByType[]
  topFailureReasons: FailureReason[]
  defectsByCrew: DefectByCrew[]
  dailyTrend: DailyTrend[]
  resultBreakdown: ResultBreakdown[]
}

interface QCMetrics {
  passRate: { d7: number; d30: number; d90: number }
  totals: { d7: number; d30: number; d90: number }
  pass: { d7: number; d30: number; d90: number }
  fail: { d7: number; d30: number; d90: number }
  topFailureReasons: Array<{ reason: string; count: number }>
  perOperator: Array<{
    inspectorId: string
    name: string
    total: number
    passed: number
    failed: number
    passRate: number
  }>
}

export default function QCTrendsPage() {
  const [trends, setTrends] = useState<QCTrends | null>(null)
  const [metrics, setMetrics] = useState<QCMetrics | null>(null)
  const [loading, setLoading] = useState(true)
  const [period, setPeriod] = useState<'30' | '90' | '180' | '365'>('90')

  useEffect(() => {
    async function loadData() {
      try {
        const [tRes, mRes] = await Promise.all([
          fetch(`/api/ops/qc-trends?period=${period}`),
          fetch(`/api/ops/qc/metrics`),
        ])
        if (tRes.ok) setTrends(await tRes.json())
        if (mRes.ok) setMetrics(await mRes.json())
      } catch (error) {
        console.error('Failed to load QC trends:', error)
      } finally {
        setLoading(false)
      }
    }

    setLoading(true)
    loadData()
  }, [period])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#C0392B]" />
      </div>
    )
  }

  if (!trends) {
    return (
      <div className="text-center py-8">
        <p className="text-gray-500">Failed to load QC trends</p>
      </div>
    )
  }

  const totalInspections = trends.resultBreakdown.reduce((sum, r) => sum + r.count, 0)
  const totalPassed = trends.resultBreakdown.find((r) => r.result === 'PASS')?.count || 0
  const totalFailed = trends.resultBreakdown.find((r) => r.result === 'FAIL')?.count || 0
  const overallPassRate = totalInspections > 0 ? Math.round((totalPassed / totalInspections) * 100) : 0

  return (
    <div className="space-y-4 sm:space-y-6 pb-20">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">Quality Trends & Analytics</h1>
          <p className="text-gray-600 mt-1 text-sm">Historical quality metrics and defect analysis</p>
        </div>
        <div className="flex gap-2">
          <Link
            href="/ops/portal/qc"
            className="px-4 py-3 min-h-[48px] border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors text-sm font-medium flex items-center justify-center"
          >
            ← Back to Dashboard
          </Link>
        </div>
      </div>

      {/* Period Selector */}
      <div className="bg-white rounded-xl border p-4 sm:p-6">
        <p className="text-sm font-medium text-gray-700 mb-3">Period:</p>
        <div className="grid grid-cols-2 sm:flex sm:flex-wrap gap-2">
          {(['30', '90', '180', '365'] as const).map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`px-3 sm:px-4 py-3 min-h-[48px] rounded-lg text-sm font-medium transition-all ${
                period === p
                  ? 'bg-[#C0392B] text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {p === '30' ? '30 Days' : p === '90' ? '90 Days' : p === '180' ? '6 Months' : '1 Year'}
            </button>
          ))}
        </div>
      </div>

      {/* Unified QC metrics (7/30/90d) — from /api/ops/qc/metrics */}
      {metrics && (
        <div className="bg-white rounded-xl border p-4 sm:p-6">
          <h2 className="text-base sm:text-lg font-bold text-gray-900 mb-3 sm:mb-4">Rolling Pass Rate</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
            {(['d7', 'd30', 'd90'] as const).map((k) => (
              <div key={k} className="p-3 sm:p-4 rounded-lg bg-gray-50 border">
                <p className="text-[11px] sm:text-xs font-medium text-gray-600 uppercase">
                  Last {k === 'd7' ? '7' : k === 'd30' ? '30' : '90'} days
                </p>
                <p className="text-2xl sm:text-3xl font-bold text-gray-900 mt-1">
                  {metrics.passRate[k]}%
                </p>
                <p className="text-xs text-gray-600 mt-1">
                  {metrics.pass[k]} pass / {metrics.fail[k]} fail ({metrics.totals[k]} total)
                </p>
              </div>
            ))}
          </div>

          {metrics.topFailureReasons.length > 0 && (
            <div className="mt-6">
              <h3 className="text-sm font-semibold text-gray-900 mb-2">
                Top failure reasons (90d)
              </h3>
              <div className="space-y-1">
                {metrics.topFailureReasons.slice(0, 5).map((r) => (
                  <div key={r.reason} className="flex items-center justify-between text-sm py-1">
                    <span className="text-gray-700">{r.reason}</span>
                    <span className="font-semibold text-[#C0392B]">{r.count}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {metrics.perOperator.length > 0 && (
            <div className="mt-6">
              <h3 className="text-sm font-semibold text-gray-900 mb-2">
                Pass rate by inspector (90d)
              </h3>
              {/* Mobile card list */}
              <div className="flex flex-col gap-2 md:hidden">
                {metrics.perOperator.map((op) => (
                  <div key={op.inspectorId} className="border border-gray-100 rounded-lg p-3 bg-gray-50">
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-medium text-gray-900 text-sm">{op.name}</p>
                      <span className="font-semibold text-sm">{op.passRate}%</span>
                    </div>
                    <div className="flex gap-4 text-xs text-gray-600 mt-2">
                      <span className="text-green-600">✓ {op.passed}</span>
                      <span className="text-red-600">✗ {op.failed}</span>
                      <span>{op.total} total</span>
                    </div>
                  </div>
                ))}
              </div>
              {/* Desktop table */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200">
                      <th className="text-left py-2 px-3 font-semibold text-gray-600">Inspector</th>
                      <th className="text-right py-2 px-3 font-semibold text-gray-600">Passed</th>
                      <th className="text-right py-2 px-3 font-semibold text-gray-600">Failed</th>
                      <th className="text-right py-2 px-3 font-semibold text-gray-600">Total</th>
                      <th className="text-right py-2 px-3 font-semibold text-gray-600">Pass %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {metrics.perOperator.map((op) => (
                      <tr key={op.inspectorId} className="border-b border-gray-100">
                        <td className="py-2 px-3 text-gray-900">{op.name}</td>
                        <td className="py-2 px-3 text-right text-green-600">{op.passed}</td>
                        <td className="py-2 px-3 text-right text-red-600">{op.failed}</td>
                        <td className="py-2 px-3 text-right text-gray-600">{op.total}</td>
                        <td className="py-2 px-3 text-right font-semibold">{op.passRate}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Summary Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-4">
        <div className="bg-white rounded-xl border p-3 sm:p-4">
          <p className="text-[11px] sm:text-xs font-medium text-gray-600 uppercase">Total Inspections</p>
          <p className="text-2xl sm:text-3xl font-bold text-gray-900 mt-1 sm:mt-2">{totalInspections}</p>
        </div>
        <div className="bg-white rounded-xl border p-3 sm:p-4">
          <p className="text-[11px] sm:text-xs font-medium text-gray-600 uppercase">Overall Pass Rate</p>
          <p className="text-2xl sm:text-3xl font-bold text-green-600 mt-1 sm:mt-2">{overallPassRate}%</p>
        </div>
        <div className="bg-white rounded-xl border p-3 sm:p-4">
          <p className="text-[11px] sm:text-xs font-medium text-gray-600 uppercase">Passed</p>
          <p className="text-2xl sm:text-3xl font-bold text-green-600 mt-1 sm:mt-2">{totalPassed}</p>
        </div>
        <div className="bg-white rounded-xl border p-3 sm:p-4">
          <p className="text-[11px] sm:text-xs font-medium text-gray-600 uppercase">Failed</p>
          <p className="text-2xl sm:text-3xl font-bold text-[#C0392B] mt-1 sm:mt-2">{totalFailed}</p>
        </div>
      </div>

      {/* Pass Rate Trend */}
      <div className="bg-white rounded-xl border p-4 sm:p-6">
        <h2 className="text-base sm:text-lg font-bold text-gray-900 mb-3 sm:mb-4">Pass Rate Trend (Weekly)</h2>
        {trends.passRateByWeek.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            <p>No data available for this period</p>
          </div>
        ) : (
          <div className="space-y-4">
            {trends.passRateByWeek.reverse().map((week) => (
              <div key={week.weekStart}>
                <div className="flex items-center justify-between mb-1 gap-2 flex-wrap">
                  <p className="text-xs sm:text-sm font-medium text-gray-900">
                    Week of {new Date(week.weekStart).toLocaleDateString()}
                  </p>
                  <div className="flex gap-3 sm:gap-4">
                    <span className="text-sm font-semibold text-gray-700">{week.passRate}%</span>
                    <span className="text-xs text-gray-500">{week.total} checks</span>
                  </div>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-3 overflow-hidden">
                  <div className="flex h-full">
                    <div
                      className="bg-green-500 h-full"
                      style={{ width: `${week.passRate}%` }}
                    />
                    <div
                      className="bg-yellow-400 h-full"
                      style={{ width: `${week.acceptableRate - week.passRate}%` }}
                    />
                    <div
                      className="bg-[#C0392B] h-full"
                      style={{ width: `${100 - week.acceptableRate}%` }}
                    />
                  </div>
                </div>
                <div className="flex gap-6 text-xs text-gray-600 mt-1">
                  <span>✓ {week.passed} passed</span>
                  <span>~ {week.conditional} conditional</span>
                  <span>✗ {week.failed} failed</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Defects by Type */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
        <div className="bg-white rounded-xl border p-4 sm:p-6">
          <h2 className="text-base sm:text-lg font-bold text-gray-900 mb-3 sm:mb-4">Defect Breakdown by Type</h2>
          {trends.defectsByType.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              <p>No defect data available</p>
            </div>
          ) : (
            <div className="space-y-4">
              {trends.defectsByType.map((defect) => {
                const maxTotal = Math.max(...trends.defectsByType.map((d) => d.total))
                const barWidth = (defect.total / maxTotal) * 100
                return (
                  <div key={defect.checkType}>
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-sm font-medium text-gray-900">{defect.checkType.replace(/_/g, ' ')}</p>
                      <div className="flex gap-3 text-xs">
                        <span className="text-green-600 font-semibold">{defect.passRate}%</span>
                        <span className="text-gray-500">{defect.total} total</span>
                      </div>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-2">
                      <div
                        className="bg-[#C0392B] h-2 rounded-full"
                        style={{ width: `${barWidth}%` }}
                      />
                    </div>
                    <div className="flex gap-4 text-xs text-gray-600 mt-1">
                      <span>✓ {defect.passed}</span>
                      <span>✗ {defect.failed}</span>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Result Breakdown Pie */}
        <div className="bg-white rounded-xl border p-4 sm:p-6">
          <h2 className="text-base sm:text-lg font-bold text-gray-900 mb-3 sm:mb-4">Overall Result Distribution</h2>
          {trends.resultBreakdown.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              <p>No data available</p>
            </div>
          ) : (
            <div className="space-y-4">
              {trends.resultBreakdown.map((result) => {
                const percentage = totalInspections > 0 ? (result.count / totalInspections) * 100 : 0
                const colors: Record<string, string> = {
                  PASS: 'bg-green-100',
                  FAIL: 'bg-red-100',
                  CONDITIONAL_PASS: 'bg-yellow-100',
                }
                const textColors: Record<string, string> = {
                  PASS: 'text-green-700',
                  FAIL: 'text-red-700',
                  CONDITIONAL_PASS: 'text-yellow-700',
                }

                return (
                  <div key={result.result} className={`p-3 rounded-lg ${colors[result.result] || 'bg-gray-100'}`}>
                    <div className="flex items-center justify-between">
                      <p className={`font-medium text-sm ${textColors[result.result] || 'text-gray-700'}`}>
                        {result.result === 'CONDITIONAL_PASS' ? 'Conditional Pass' : result.result}
                      </p>
                      <div className="text-right">
                        <p className={`font-bold text-lg ${textColors[result.result] || 'text-gray-700'}`}>
                          {result.count}
                        </p>
                        <p className="text-xs text-gray-600">{percentage.toFixed(1)}%</p>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* Top Failure Reasons */}
      {trends.topFailureReasons.length > 0 && (
        <div className="bg-white rounded-xl border p-4 sm:p-6">
          <h2 className="text-base sm:text-lg font-bold text-gray-900 mb-3 sm:mb-4">Top Failure Reasons</h2>
          <div className="space-y-3">
            {trends.topFailureReasons.map((reason, idx) => {
              const maxCount = Math.max(...trends.topFailureReasons.map((r) => r.count))
              const percentage = (reason.count / maxCount) * 100
              return (
                <div key={idx}>
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-sm font-medium text-gray-900 line-clamp-2">{reason.reason || 'No notes'}</p>
                    <span className="text-sm font-semibold text-[#C0392B]">{reason.count}</span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div
                      className="bg-[#C0392B] h-2 rounded-full"
                      style={{ width: `${percentage}%` }}
                    />
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Defects by Crew */}
      {trends.defectsByCrew.length > 0 && (
        <div className="bg-white rounded-xl border p-4 sm:p-6">
          <h2 className="text-base sm:text-lg font-bold text-gray-900 mb-3 sm:mb-4">Quality by Crew/Team</h2>
          {/* Mobile card list */}
          <div className="flex flex-col gap-2 md:hidden">
            {trends.defectsByCrew.map((crew) => (
              <div key={crew.crewName} className="border border-gray-100 rounded-lg p-3 bg-gray-50">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-medium text-gray-900 text-sm">{crew.crewName || 'Unassigned'}</p>
                  <span
                    className={`px-2 py-1 rounded text-xs font-semibold ${
                      crew.passRate >= 90
                        ? 'bg-green-100 text-green-700'
                        : crew.passRate >= 75
                          ? 'bg-yellow-100 text-yellow-700'
                          : 'bg-red-100 text-red-700'
                    }`}
                  >
                    {crew.passRate}%
                  </span>
                </div>
                <div className="flex gap-4 text-xs text-gray-600 mt-2">
                  <span className="text-green-600">✓ {crew.passed}</span>
                  <span className="text-red-600">✗ {crew.failed}</span>
                  <span>{crew.total} total</span>
                </div>
              </div>
            ))}
          </div>
          {/* Desktop table */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left py-2 px-3 font-semibold text-gray-600">Crew/Team</th>
                  <th className="text-right py-2 px-3 font-semibold text-gray-600">Passed</th>
                  <th className="text-right py-2 px-3 font-semibold text-gray-600">Failed</th>
                  <th className="text-right py-2 px-3 font-semibold text-gray-600">Total</th>
                  <th className="text-right py-2 px-3 font-semibold text-gray-600">Pass Rate</th>
                </tr>
              </thead>
              <tbody>
                {trends.defectsByCrew.map((crew) => (
                  <tr key={crew.crewName} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="py-3 px-3 font-medium text-gray-900">{crew.crewName || 'Unassigned'}</td>
                    <td className="py-3 px-3 text-right text-green-600 font-medium">{crew.passed}</td>
                    <td className="py-3 px-3 text-right text-red-600 font-medium">{crew.failed}</td>
                    <td className="py-3 px-3 text-right text-gray-600 font-medium">{crew.total}</td>
                    <td className="py-3 px-3 text-right">
                      <span
                        className={`px-2 py-1 rounded text-sm font-semibold ${
                          crew.passRate >= 90
                            ? 'bg-green-100 text-green-700'
                            : crew.passRate >= 75
                              ? 'bg-yellow-100 text-yellow-700'
                              : 'bg-red-100 text-red-700'
                        }`}
                      >
                        {crew.passRate}%
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Daily Trend Chart */}
      {trends.dailyTrend.length > 0 && (
        <div className="bg-white rounded-xl border p-4 sm:p-6">
          <h2 className="text-base sm:text-lg font-bold text-gray-900 mb-3 sm:mb-4">Daily Inspection Trend</h2>
          <div className="space-y-2">
            {trends.dailyTrend
              .reverse()
              .slice(0, 14)
              .map((day) => {
                const maxDaily = Math.max(...trends.dailyTrend.map((d) => d.total))
                const barWidth = (day.total / maxDaily) * 100
                return (
                  <div key={day.date}>
                    <div className="flex items-center justify-between mb-1 gap-2 flex-wrap">
                      <p className="text-xs sm:text-sm font-medium text-gray-900 flex-shrink-0">
                        {new Date(day.date).toLocaleDateString()}
                      </p>
                      <div className="flex gap-2 text-xs flex-wrap">
                        <span className="text-green-600 font-semibold">{day.passed}</span>
                        <span className="text-red-600 font-semibold">{day.failed}</span>
                        <span className="text-gray-500">({day.total} total)</span>
                      </div>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-2 overflow-hidden">
                      <div className="flex h-full">
                        <div
                          className="bg-green-500 h-full"
                          style={{ width: `${(day.passed / day.total) * 100}%` }}
                        />
                        <div
                          className="bg-[#C0392B] h-full"
                          style={{ width: `${(day.failed / day.total) * 100}%` }}
                        />
                      </div>
                    </div>
                  </div>
                )
              })}
          </div>
        </div>
      )}
    </div>
  )
}
