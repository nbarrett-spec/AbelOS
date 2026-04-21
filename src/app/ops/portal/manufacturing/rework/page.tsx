'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useToast } from '@/contexts/ToastContext'

interface DefectCheck {
  id: string
  jobId: string
  jobNumber: string
  builderName: string
  community: string
  checkType: string
  result: string
  notes: string | null
  defectCodes: string[]
  createdAt: string
  inspector_firstName: string | null
  inspector_lastName: string | null
  status: string
}

interface DefectCodeFrequency {
  code: string
  count: number
}

interface WeeklyTrend {
  week: string
  failCount: number
  conditionalCount: number
  totalChecks: number
  failRate: number
}

interface ReworkMetrics {
  avgDaysToResolve: number
  totalOpen: number
  totalResolvedThisMonth: number
  failRatePercent: number
}

interface DefectByCheckType {
  checkType: string
  failCount: number
  passCount: number
  passRate: number
}

interface ReworkData {
  openDefects: { count: number; items: DefectCheck[] }
  inRework: { count: number; items: DefectCheck[] }
  resolved: { count: number; items: DefectCheck[] }
  defectCodeFrequency: DefectCodeFrequency[]
  weeklyTrend: WeeklyTrend[]
  reworkMetrics: ReworkMetrics
  defectsByCheckType: DefectByCheckType[]
}

export default function ReworkDefectTrackingPage() {
  const router = useRouter()
  const { addToast } = useToast()
  const [data, setData] = useState<ReworkData | null>(null)
  const [loading, setLoading] = useState(true)
  const [sortColumn, setSortColumn] = useState<string>('createdAt')
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc')
  const [markingResolved, setMarkingResolved] = useState<string | null>(null)

  useEffect(() => {
    async function loadData() {
      try {
        const res = await fetch('/api/ops/manufacturing-command/rework')
        if (res.ok) {
          const reworkData: ReworkData = await res.json()
          setData(reworkData)
        } else {
          console.error('Failed to load rework data')
        }
      } catch (error: any) {
        console.error('Error loading rework data:', error)
      } finally {
        setLoading(false)
      }
    }

    loadData()
  }, [])

  const handleMarkResolved = async (jobId: string) => {
    setMarkingResolved(jobId)
    try {
      const res = await fetch('/api/ops/manufacturing/qc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jobId,
          checkType: 'RE_INSPECTION',
          result: 'PASS',
        }),
      })

      if (res.ok) {
        // Reload data
        const reloadRes = await fetch('/api/ops/manufacturing-command/rework')
        if (reloadRes.ok) {
          const reworkData: ReworkData = await reloadRes.json()
          setData(reworkData)
        }
      } else {
        addToast({ type: 'error', title: 'Update Failed', message: 'Failed to mark as resolved. Please try again.' })
      }
    } catch (error: any) {
      console.error('Error marking as resolved:', error)
      addToast({ type: 'error', title: 'Error', message: 'Error marking as resolved' })
    } finally {
      setMarkingResolved(null)
    }
  }

  const sortedOpenDefects = [...(data?.openDefects.items || [])].sort(
    (a: any, b: any) => {
      let aVal = a[sortColumn as keyof DefectCheck]
      let bVal = b[sortColumn as keyof DefectCheck]

      if (typeof aVal === 'string') {
        aVal = aVal.toLowerCase()
        bVal = (bVal as string).toLowerCase()
      }

      if (aVal < bVal) return sortOrder === 'asc' ? -1 : 1
      if (aVal > bVal) return sortOrder === 'asc' ? 1 : -1
      return 0
    }
  )

  const handleSort = (column: string) => {
    if (sortColumn === column) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')
    } else {
      setSortColumn(column)
      setSortOrder('asc')
    }
  }

  const getCheckTypeColor = (
    type: string
  ): 'bg-blue-100 text-blue-800' | 'bg-purple-100 text-purple-800' | 'bg-orange-100 text-orange-800' | 'bg-green-100 text-green-800' | 'bg-red-100 text-red-800' => {
    const colors: {
      [key: string]:
        | 'bg-blue-100 text-blue-800'
        | 'bg-purple-100 text-purple-800'
        | 'bg-orange-100 text-orange-800'
        | 'bg-green-100 text-green-800'
        | 'bg-red-100 text-red-800'
    } = {
      PRE_PRODUCTION: 'bg-blue-100 text-blue-800',
      IN_PROCESS: 'bg-purple-100 text-purple-800',
      FINAL_UNIT: 'bg-orange-100 text-orange-800',
      PRE_DELIVERY: 'bg-green-100 text-green-800',
      POST_INSTALL: 'bg-red-100 text-red-800',
    }
    return colors[type] || 'bg-gray-100 text-gray-800'
  }

  const getFailRateColor = (rate: number): string => {
    if (rate < 5) return 'text-emerald-400'
    if (rate < 10) return 'text-yellow-400'
    return 'text-red-400'
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-red-500" />
      </div>
    )
  }

  if (!data) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-400">Failed to load rework data</p>
      </div>
    )
  }

  return (
    <div className="space-y-6 bg-gray-950 min-h-screen p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white">Rework & Defect Tracking</h1>
          <p className="text-gray-400 mt-1">
            Monitor quality issues, track resolution, and analyze defect trends
          </p>
        </div>
        <Link
          href="/ops/portal/manufacturing"
          className="px-4 py-2 border border-gray-700 rounded-lg hover:bg-gray-900 transition-colors text-sm font-medium text-gray-300"
        >
          ← Back to Manufacturing
        </Link>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
        {/* Open Defects */}
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-gray-400 text-sm">Open Defects</p>
              <p className="text-3xl font-bold text-red-500 mt-1">
                {data.openDefects.count}
              </p>
            </div>
            <div className="text-red-500 text-3xl">⚠</div>
          </div>
        </div>

        {/* In Rework */}
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-gray-400 text-sm">In Rework</p>
              <p className="text-3xl font-bold text-signal mt-1">
                {data.inRework.count}
              </p>
            </div>
            <div className="text-signal text-3xl">🔧</div>
          </div>
        </div>

        {/* Resolved This Month */}
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-gray-400 text-sm">Resolved This Month</p>
              <p className="text-3xl font-bold text-emerald-500 mt-1">
                {data.reworkMetrics.totalResolvedThisMonth}
              </p>
            </div>
            <div className="text-emerald-500 text-3xl">✓</div>
          </div>
        </div>

        {/* Avg Days to Resolve */}
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-gray-400 text-sm">Avg Days to Resolve</p>
              <p className="text-3xl font-bold text-blue-400 mt-1">
                {data.reworkMetrics.avgDaysToResolve.toFixed(1)}
              </p>
            </div>
            <div className="text-blue-400 text-3xl">📅</div>
          </div>
        </div>

        {/* Fail Rate */}
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-gray-400 text-sm">Fail Rate %</p>
              <p
                className={`text-3xl font-bold mt-1 ${getFailRateColor(
                  data.reworkMetrics.failRatePercent
                )}`}
              >
                {data.reworkMetrics.failRatePercent.toFixed(1)}%
              </p>
            </div>
            <div className="text-gray-600 text-3xl">📊</div>
          </div>
        </div>
      </div>

      {/* Defect Trend - Weekly Bars */}
      {data.weeklyTrend.length > 0 && (
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-6">
          <h2 className="text-lg font-semibold text-white mb-4">
            Weekly Defect Trend (Last 8 Weeks)
          </h2>
          <div className="space-y-3">
            {data.weeklyTrend.map((week: WeeklyTrend) => {
              const maxRate = Math.max(
                ...data.weeklyTrend.map((w: WeeklyTrend) => w.failRate),
                10
              )
              const barWidth = (week.failRate / maxRate) * 100
              const barColor =
                week.failRate < 5
                  ? 'bg-emerald-500'
                  : week.failRate < 10
                    ? 'bg-yellow-500'
                    : 'bg-red-500'

              return (
                <div key={week.week} className="flex items-center gap-4">
                  <div className="w-20 text-sm text-gray-400">
                    {new Date(week.week).toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                    })}
                  </div>
                  <div className="flex-1">
                    <div className="bg-gray-800 rounded-full h-6 overflow-hidden">
                      <div
                        className={`${barColor} h-full rounded-full transition-all`}
                        style={{ width: `${barWidth}%` }}
                      />
                    </div>
                  </div>
                  <div className="w-24 text-right text-sm">
                    <span className="text-gray-300">
                      {week.failRate.toFixed(1)}%
                    </span>
                    <span className="text-gray-500 ml-2">
                      ({week.failCount + week.conditionalCount}/{week.totalChecks})
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Open Defects Table */}
      <div className="bg-gray-900 border border-gray-800 rounded-lg overflow-hidden">
        <div className="p-6 border-b border-gray-800">
          <h2 className="text-lg font-semibold text-white">Open Defects</h2>
          <p className="text-gray-400 text-sm mt-1">
            {data.openDefects.count} jobs awaiting rework
          </p>
        </div>

        {data.openDefects.count === 0 ? (
          <div className="p-8 text-center">
            <p className="text-gray-400">No open defects. Great work!</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-800 bg-gray-800">
                  <th
                    className="px-6 py-3 text-left text-xs font-semibold text-gray-300 cursor-pointer hover:text-white"
                    onClick={() => handleSort('jobNumber')}
                  >
                    Job #
                    {sortColumn === 'jobNumber' &&
                      (sortOrder === 'asc' ? ' ↑' : ' ↓')}
                  </th>
                  <th
                    className="px-6 py-3 text-left text-xs font-semibold text-gray-300 cursor-pointer hover:text-white"
                    onClick={() => handleSort('builderName')}
                  >
                    Builder
                    {sortColumn === 'builderName' &&
                      (sortOrder === 'asc' ? ' ↑' : ' ↓')}
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-gray-300">
                    Check Type
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-gray-300">
                    Defect Codes
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-gray-300">
                    Inspector
                  </th>
                  <th
                    className="px-6 py-3 text-left text-xs font-semibold text-gray-300 cursor-pointer hover:text-white"
                    onClick={() => handleSort('createdAt')}
                  >
                    Date
                    {sortColumn === 'createdAt' &&
                      (sortOrder === 'asc' ? ' ↑' : ' ↓')}
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-gray-300">
                    Days Open
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-semibold text-gray-300">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {sortedOpenDefects.map((check: DefectCheck) => {
                  const daysOpen = Math.floor(
                    (Date.now() - new Date(check.createdAt).getTime()) /
                      (1000 * 60 * 60 * 24)
                  )
                  return (
                    <tr
                      key={check.id}
                      className="border-b border-gray-800 hover:bg-gray-800 transition-colors"
                    >
                      <td className="px-6 py-4">
                        <Link
                          href={`/ops/jobs/${check.jobId}`}
                          className="font-semibold text-blue-400 hover:text-blue-300"
                        >
                          {check.jobNumber}
                        </Link>
                      </td>
                      <td className="px-6 py-4 text-gray-300">
                        {check.builderName}
                      </td>
                      <td className="px-6 py-4">
                        <span
                          className={`px-2 py-1 rounded text-xs font-semibold ${getCheckTypeColor(
                            check.checkType
                          )}`}
                        >
                          {check.checkType.replace(/_/g, ' ')}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex flex-wrap gap-1">
                          {check.defectCodes && check.defectCodes.length > 0 ? (
                            check.defectCodes.map((code: string) => (
                              <span
                                key={code}
                                className="px-2 py-1 bg-red-900 text-red-200 rounded text-xs font-medium"
                              >
                                {code}
                              </span>
                            ))
                          ) : (
                            <span className="text-gray-500 text-sm">
                              No codes
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4 text-gray-300 text-sm">
                        {check.inspector_firstName && check.inspector_lastName
                          ? `${check.inspector_firstName} ${check.inspector_lastName}`
                          : 'Unknown'}
                      </td>
                      <td className="px-6 py-4 text-gray-300 text-sm">
                        {new Date(check.createdAt).toLocaleDateString()}
                      </td>
                      <td className="px-6 py-4 text-gray-300 text-sm">
                        {daysOpen} days
                      </td>
                      <td className="px-6 py-4 text-right">
                        <button
                          onClick={() => handleMarkResolved(check.jobId)}
                          disabled={markingResolved === check.jobId}
                          className="px-3 py-1.5 bg-emerald-600 text-white rounded text-xs font-medium hover:bg-emerald-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {markingResolved === check.jobId
                            ? 'Saving...'
                            : 'Mark Resolved'}
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Top Defect Codes */}
      {data.defectCodeFrequency.length > 0 && (
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-6">
          <h2 className="text-lg font-semibold text-white mb-4">
            Top Defect Codes
          </h2>
          <div className="space-y-3">
            {data.defectCodeFrequency.map((defect: DefectCodeFrequency) => {
              const maxCount = Math.max(
                ...data.defectCodeFrequency.map((d: DefectCodeFrequency) => d.count),
                1
              )
              const barWidth = (defect.count / maxCount) * 100

              return (
                <div key={defect.code} className="flex items-center gap-4">
                  <div className="w-24 text-sm font-semibold text-gray-300">
                    {defect.code}
                  </div>
                  <div className="flex-1">
                    <div className="bg-gray-800 rounded-full h-6 overflow-hidden">
                      <div
                        className="bg-red-500 h-full rounded-full transition-all"
                        style={{ width: `${barWidth}%` }}
                      />
                    </div>
                  </div>
                  <div className="w-12 text-right text-sm text-gray-300 font-semibold">
                    {defect.count}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Defects by Check Type */}
      {data.defectsByCheckType.length > 0 && (
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-6">
          <h2 className="text-lg font-semibold text-white mb-4">
            Defects by Check Type
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {data.defectsByCheckType.map((checkType: DefectByCheckType) => (
              <div
                key={checkType.checkType}
                className="bg-gray-800 border border-gray-700 rounded-lg p-4"
              >
                <div className="flex items-start justify-between mb-3">
                  <h3 className="font-semibold text-white text-sm">
                    {checkType.checkType.replace(/_/g, ' ')}
                  </h3>
                </div>
                <div className="space-y-2">
                  <div className="flex justify-between items-center">
                    <span className="text-gray-400 text-sm">Failures</span>
                    <span className="text-red-400 font-semibold">
                      {checkType.failCount}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-gray-400 text-sm">Passes</span>
                    <span className="text-emerald-400 font-semibold">
                      {checkType.passCount}
                    </span>
                  </div>
                  <div className="pt-2 border-t border-gray-700 flex justify-between items-center">
                    <span className="text-gray-400 text-sm">Pass Rate</span>
                    <span className="text-blue-400 font-semibold">
                      {checkType.passRate.toFixed(1)}%
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
