'use client'

import { useState, useEffect, useMemo } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

// ──────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────

interface PickProgress {
  total: number
  completed: number
  short: number
}

interface QCStatus {
  result: string | null
  checkDate: string | null
}

interface ScheduleJob {
  jobNumber: string
  builderName: string
  community: string
  lotBlock: string | null
  scheduledDate: string | null
  status: string
  createdAt: string
  updatedAt: string
  pickProgress: PickProgress
  qcStatus: QCStatus | null
  daysInStatus: number
  pmName: string | null
}

interface ScheduleGroup {
  date: string | null
  dateLabel: string
  jobCount: number
  jobs: ScheduleJob[]
}

interface CapacityMetrics {
  avgJobsPerDay: number
  currentWIP: number
  backlog: number
  pipelineReady: number
  avgDaysInStatus: {
    created_to_readiness: number
    readiness_to_materials: number
    materials_to_production: number
    production_to_staged: number
  }
  bottleneckStatus: {
    status: string
    count: number
  }
}

interface WeeklyLoad {
  week: number
  startDate: string
  endDate: string
  jobCount: number
  capacity: number
  utilization: number
}

interface StatusPipeline {
  status: string
  count: number
  avgDays: number
}

interface ScheduleData {
  schedule: ScheduleGroup[]
  capacity: CapacityMetrics
  weeklyLoad: WeeklyLoad[]
  statusPipeline: StatusPipeline[]
  timestamp: string
}

// ──────────────────────────────────────────────────────────────────────────
// Status Badge Colors
// ──────────────────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  CREATED: { bg: 'bg-gray-700', text: 'text-gray-200', border: 'border-gray-600' },
  READINESS_CHECK: {
    bg: 'bg-yellow-600',
    text: 'text-yellow-100',
    border: 'border-yellow-500',
  },
  MATERIALS_LOCKED: {
    bg: 'bg-blue-600',
    text: 'text-blue-100',
    border: 'border-blue-500',
  },
  IN_PRODUCTION: {
    bg: 'bg-purple-600',
    text: 'text-purple-100',
    border: 'border-purple-500',
  },
  STAGED: {
    bg: 'bg-emerald-600',
    text: 'text-emerald-100',
    border: 'border-emerald-500',
  },
}

const getStatusColor = (
  status: string
): { bg: string; text: string; border: string } => {
  return STATUS_COLORS[status] || STATUS_COLORS.CREATED
}

// ──────────────────────────────────────────────────────────────────────────
// Main Component
// ──────────────────────────────────────────────────────────────────────────

export default function ProductionSchedule(): JSX.Element {
  const router = useRouter()
  const [data, setData] = useState<ScheduleData | null>(null)
  const [loading, setLoading] = useState<boolean>(true)
  const [statusFilter, setStatusFilter] = useState<string>('ALL')
  const [showAllJobs, setShowAllJobs] = useState<boolean>(false)

  // Fetch schedule data
  useEffect(() => {
    const fetchData = async (): Promise<void> => {
      try {
        const response = await fetch('/api/ops/manufacturing-command/schedule', {
          headers: {
            'x-staff-id': 'user', // Will be set by middleware/context
            'x-staff-role': 'WAREHOUSE_LEAD',
          },
        })

        if (response.ok) {
          const scheduleData: ScheduleData = await response.json()
          setData(scheduleData)
        } else {
          console.error('Failed to fetch schedule data')
        }
      } catch (error: any) {
        console.error('Error fetching schedule:', error)
      } finally {
        setLoading(false)
      }
    }

    fetchData()
  }, [])

  // Filter jobs by status
  const filteredSchedule = useMemo(() => {
    if (!data) return []
    if (statusFilter === 'ALL') return data.schedule

    return data.schedule.map((group: ScheduleGroup) => ({
      ...group,
      jobs: group.jobs.filter((job: ScheduleJob) => job.status === statusFilter),
      jobCount: group.jobs.filter((job: ScheduleJob) => job.status === statusFilter)
        .length,
    }))
  }, [data, statusFilter])

  // Get all unique statuses from data
  const allStatuses = useMemo(() => {
    if (!data) return []
    const statuses = new Set<string>()
    data.schedule.forEach((group: ScheduleGroup) => {
      group.jobs.forEach((job: ScheduleJob) => {
        statuses.add(job.status)
      })
    })
    return Array.from(statuses).sort()
  }, [data])

  const pickPercent = (pick: PickProgress): number => {
    return pick.total > 0 ? Math.round((pick.completed / pick.total) * 100) : 0
  }

  const getQCDot = (qc: QCStatus | null): JSX.Element => {
    if (!qc || !qc.result) {
      return (
        <div className="w-3 h-3 rounded-full bg-gray-600" title="No QC" />
      )
    }
    const colors: Record<string, string> = {
      PASS: 'bg-emerald-500',
      FAIL: 'bg-red-500',
      CONDITIONAL: 'bg-signal',
    }
    return (
      <div
        className={`w-3 h-3 rounded-full ${colors[qc.result] || 'bg-gray-600'}`}
        title={`QC: ${qc.result}`}
      />
    )
  }

  const getBottleneckColor = (status: string): string => {
    const color = getStatusColor(status)
    return color.bg
  }

  if (loading) {
    return (
      <div className="bg-gray-950 min-h-screen text-white p-8">
        <div className="max-w-7xl mx-auto">
          <div className="h-12 bg-gray-800 rounded mb-8 animate-pulse" />
          <div className="grid grid-cols-5 gap-4 mb-8">
            {Array.from({ length: 5 }).map((_: any, i: number) => (
              <div key={i} className="h-20 bg-gray-800 rounded animate-pulse" />
            ))}
          </div>
          <div className="space-y-6">
            {Array.from({ length: 3 }).map((_: any, i: number) => (
              <div key={i} className="h-64 bg-gray-800 rounded animate-pulse" />
            ))}
          </div>
        </div>
      </div>
    )
  }

  if (!data) {
    return (
      <div className="bg-gray-950 min-h-screen text-white p-8">
        <div className="max-w-7xl mx-auto">
          <div className="bg-red-900/30 border border-red-600 rounded-lg p-6">
            <h2 className="text-lg font-bold text-red-400 mb-2">
              Failed to Load Schedule
            </h2>
            <p className="text-gray-400">
              Unable to fetch manufacturing schedule data.
            </p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="bg-gray-950 min-h-screen text-white">
      {/* Header */}
      <header className="bg-gray-900 border-b border-gray-800 sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-8 py-4">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <Link
                href="/ops/portal/manufacturing"
                className="text-gray-400 hover:text-blue-400 transition text-sm"
              >
                Manufacturing
              </Link>
              <span className="text-gray-600">/</span>
              <h1 className="text-2xl font-bold">Production Schedule & Capacity</h1>
            </div>
          </div>
        </div>
      </header>

      {/* Capacity Overview Strip */}
      <div className="bg-gray-900 border-b border-gray-800 px-8 py-6">
        <div className="max-w-7xl mx-auto">
          <div className="grid grid-cols-5 gap-4">
            <div className="bg-gray-800 border border-gray-700 rounded p-4">
              <div className="text-gray-400 text-xs font-semibold uppercase">
                Daily Capacity
              </div>
              <div className="text-2xl font-bold text-emerald-400 mt-2">
                {data.capacity.avgJobsPerDay}
              </div>
              <div className="text-xs text-gray-500 mt-1">jobs/day avg</div>
            </div>

            <div className="bg-gray-800 border border-gray-700 rounded p-4">
              <div className="text-gray-400 text-xs font-semibold uppercase">
                Current WIP
              </div>
              <div className="text-2xl font-bold text-blue-400 mt-2">
                {data.capacity.currentWIP}
              </div>
              <div className="text-xs text-gray-500 mt-1">in production</div>
            </div>

            <div className="bg-gray-800 border border-gray-700 rounded p-4">
              <div className="text-gray-400 text-xs font-semibold uppercase">
                Backlog
              </div>
              <div className="text-2xl font-bold text-signal-hover mt-2">
                {data.capacity.backlog}
              </div>
              <div className="text-xs text-gray-500 mt-1">pending work</div>
            </div>

            <div className="bg-gray-800 border border-gray-700 rounded p-4">
              <div className="text-gray-400 text-xs font-semibold uppercase">
                Pipeline Ready
              </div>
              <div className="text-2xl font-bold text-cyan-400 mt-2">
                {data.capacity.pipelineReady}
              </div>
              <div className="text-xs text-gray-500 mt-1">to start</div>
            </div>

            <div
              className={`border rounded p-4 ${getBottleneckColor(data.capacity.bottleneckStatus.status)}/20 border-${getBottleneckColor(data.capacity.bottleneckStatus.status)}/50`}
            >
              <div className="text-gray-400 text-xs font-semibold uppercase">
                Bottleneck
              </div>
              <div className="font-bold mt-2">
                <div className="text-sm text-red-400">
                  {data.capacity.bottleneckStatus.status.replace(/_/g, ' ')}
                </div>
                <div className="text-2xl text-red-400">
                  {data.capacity.bottleneckStatus.count}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-8 py-8">
        <div className="space-y-8">
          {/* Weekly Load */}
          <div className="bg-gray-900 border border-gray-800 rounded-lg p-6">
            <h2 className="text-xl font-bold mb-6">4-Week Load Forecast</h2>
            <div className="space-y-4">
              {data.weeklyLoad.map((week: WeeklyLoad) => {
                const barColor =
                  week.utilization > 100
                    ? 'bg-red-500'
                    : week.utilization > 80
                      ? 'bg-signal'
                      : 'bg-emerald-500'
                return (
                  <div key={week.week} className="flex items-center gap-4">
                    <div className="w-20 text-sm font-semibold">
                      Week {week.week}
                    </div>
                    <div className="flex-1">
                      <div className="flex gap-2 mb-1 text-xs text-gray-400">
                        <span>
                          {week.startDate} to {week.endDate}
                        </span>
                        <span>
                          {week.jobCount}/{week.capacity}
                        </span>
                        <span className="ml-auto">{week.utilization}%</span>
                      </div>
                      <div className="h-6 bg-gray-800 rounded overflow-hidden">
                        <div
                          className={`h-full ${barColor} transition-all flex items-center justify-center`}
                          style={{ width: `${Math.min(week.utilization, 100)}%` }}
                        >
                          {week.utilization > 20 && (
                            <span className="text-xs font-bold text-gray-950">
                              {week.jobCount}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Status Filter */}
          <div className="flex gap-2 flex-wrap">
            <button
              onClick={() => setStatusFilter('ALL')}
              className={`px-4 py-2 rounded text-sm font-semibold transition ${
                statusFilter === 'ALL'
                  ? 'bg-blue-600 border border-blue-500 text-white'
                  : 'bg-gray-800 border border-gray-700 text-gray-400 hover:border-gray-600'
              }`}
            >
              All Jobs
            </button>
            {allStatuses.map((status: string) => {
              const color = getStatusColor(status)
              const isActive = statusFilter === status
              return (
                <button
                  key={status}
                  onClick={() => setStatusFilter(status)}
                  className={`px-4 py-2 rounded text-sm font-semibold transition border ${
                    isActive
                      ? `${color.bg} ${color.border} ${color.text}`
                      : 'bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-600'
                  }`}
                >
                  {status.replace(/_/g, ' ')}
                </button>
              )
            })}
          </div>

          {/* Schedule Timeline */}
          <div className="space-y-6">
            <h2 className="text-xl font-bold">Schedule Timeline</h2>
            {filteredSchedule.length > 0 ? (
              filteredSchedule.slice(0, 14).map((group: ScheduleGroup) => (
                <div key={group.date} className="bg-gray-900 border border-gray-800 rounded-lg overflow-hidden">
                  {/* Date Header */}
                  <div className="bg-gray-800 border-b border-gray-700 px-6 py-3">
                    <div className="font-semibold text-lg">
                      {group.dateLabel}{' '}
                      <span className="text-gray-400 text-sm">
                        — {group.jobCount} job{group.jobCount !== 1 ? 's' : ''}
                      </span>
                    </div>
                  </div>

                  {/* Jobs */}
                  <div className="divide-y divide-gray-800">
                    {group.jobs.map((job: ScheduleJob, idx: number) => {
                      const color = getStatusColor(job.status)
                      const pickPct = pickPercent(job.pickProgress)
                      return (
                        <div
                          key={idx}
                          className="px-6 py-4 hover:bg-gray-800/50 transition"
                        >
                          <div className="flex items-start justify-between mb-3">
                            <div>
                              <div className="font-semibold text-blue-400">
                                Job #{job.jobNumber}
                              </div>
                              <div className="text-sm text-gray-400">
                                {job.builderName}
                                {job.community && ` • ${job.community}`}
                                {job.lotBlock && ` • ${job.lotBlock}`}
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <span
                                className={`px-2 py-1 rounded text-xs font-semibold border ${color.bg} ${color.text} ${color.border}`}
                              >
                                {job.status.replace(/_/g, ' ')}
                              </span>
                              {getQCDot(job.qcStatus)}
                            </div>
                          </div>

                          {/* Progress Bar */}
                          <div className="flex items-center gap-3 mb-2">
                            <div className="flex-1">
                              <div className="flex items-center gap-2 mb-1">
                                <span className="text-xs text-gray-400">
                                  Materials: {job.pickProgress.completed}/
                                  {job.pickProgress.total}
                                </span>
                                {job.pickProgress.short > 0 && (
                                  <span className="text-xs text-red-400">
                                    ({job.pickProgress.short} short)
                                  </span>
                                )}
                              </div>
                              <div className="h-2 bg-gray-700 rounded overflow-hidden">
                                <div
                                  className="h-full bg-blue-500 transition-all"
                                  style={{ width: `${pickPct}%` }}
                                />
                              </div>
                            </div>
                            <span className="text-xs text-gray-400 w-8 text-right">
                              {pickPct}%
                            </span>
                          </div>

                          {/* Footer Info */}
                          <div className="flex items-center justify-between text-xs text-gray-500">
                            <div>
                              {job.daysInStatus} day
                              {job.daysInStatus !== 1 ? 's' : ''} in status
                            </div>
                            <div>
                              {job.pmName ? (
                                <span>PM: {job.pmName}</span>
                              ) : (
                                <span>No PM assigned</span>
                              )}
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              ))
            ) : (
              <div className="bg-gray-900 border border-gray-800 rounded-lg p-8 text-center">
                <p className="text-gray-400">No jobs found with selected filters</p>
              </div>
            )}
          </div>

          {/* Status Pipeline */}
          <div className="bg-gray-900 border border-gray-800 rounded-lg p-6">
            <h2 className="text-xl font-bold mb-6">Production Pipeline</h2>
            <div className="flex items-end gap-4">
              {data.statusPipeline.map((stage: StatusPipeline, idx: number) => (
                <div key={stage.status} className="flex flex-col items-center flex-1">
                  <div
                    className={`w-full rounded-t px-4 py-6 text-center border-t-2 ${getStatusColor(stage.status).bg} ${getStatusColor(stage.status).border}`}
                  >
                    <div className="text-2xl font-bold text-white">
                      {stage.count}
                    </div>
                    <div className="text-xs text-gray-300 mt-1 font-semibold">
                      {stage.status.replace(/_/g, ' ')}
                    </div>
                  </div>
                  {idx < data.statusPipeline.length - 1 && (
                    <div className="text-gray-600 text-xl mt-2">→</div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* All Jobs Table */}
          <div className="bg-gray-900 border border-gray-800 rounded-lg overflow-hidden">
            <div className="border-b border-gray-800 px-6 py-4 flex items-center justify-between">
              <h2 className="text-xl font-bold">All Jobs</h2>
              <button
                onClick={() => setShowAllJobs(!showAllJobs)}
                className="text-sm text-gray-400 hover:text-blue-400 transition"
              >
                {showAllJobs ? 'Hide' : 'Show'}
              </button>
            </div>

            {showAllJobs && (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-800 border-b border-gray-700">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-gray-400 uppercase">
                        Job #
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-gray-400 uppercase">
                        Builder
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-gray-400 uppercase">
                        Community
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-gray-400 uppercase">
                        Scheduled
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-gray-400 uppercase">
                        Status
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-gray-400 uppercase">
                        Days
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-gray-400 uppercase">
                        Pick %
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-gray-400 uppercase">
                        QC
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-gray-400 uppercase">
                        PM
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-800">
                    {filteredSchedule.flatMap((group: ScheduleGroup) => group.jobs).map((job: ScheduleJob, idx: number) => {
                      const color = getStatusColor(job.status)
                      const pickPct = pickPercent(job.pickProgress)
                      return (
                        <tr
                          key={idx}
                          className="hover:bg-gray-800/50 transition"
                        >
                          <td className="px-6 py-3 font-semibold text-blue-400">
                            {job.jobNumber}
                          </td>
                          <td className="px-6 py-3 text-gray-300">
                            {job.builderName}
                          </td>
                          <td className="px-6 py-3 text-gray-400">
                            {job.community}
                          </td>
                          <td className="px-6 py-3 text-gray-400">
                            {job.scheduledDate || 'Unscheduled'}
                          </td>
                          <td className="px-6 py-3">
                            <span
                              className={`px-2 py-1 rounded text-xs font-semibold border ${color.bg} ${color.text} ${color.border}`}
                            >
                              {job.status.replace(/_/g, ' ')}
                            </span>
                          </td>
                          <td className="px-6 py-3 text-gray-400">
                            {job.daysInStatus}
                          </td>
                          <td className="px-6 py-3 text-gray-400">
                            {pickPct}%
                          </td>
                          <td className="px-6 py-3 flex items-center">
                            {getQCDot(job.qcStatus)}
                          </td>
                          <td className="px-6 py-3 text-gray-400">
                            {job.pmName || '—'}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
