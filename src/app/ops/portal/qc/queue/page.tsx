'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

interface QCJob {
  id: string
  jobNumber: string
  builderName: string
  community: string
  jobStatus: string
  scheduledDate: string | null
  productCount: number
  priority: 'CRITICAL' | 'HIGH' | 'NORMAL'
}

interface QCBriefing {
  summary: {
    inspectionsToday: number
    pendingInspections: number
    passRate7d: number
    failedAwaitingRework: number
    totalCompleted7d: number
    criticalDefects: number
  }
  inspectionQueue: QCJob[]
}

export default function QCQueuePage() {
  const router = useRouter()
  const [briefing, setBriefing] = useState<QCBriefing | null>(null)
  const [loading, setLoading] = useState(true)
  const [selectedTab, setSelectedTab] = useState<'ALL' | 'CRITICAL' | 'HIGH' | 'NORMAL'>('ALL')
  const [sortBy, setSortBy] = useState<'priority' | 'date' | 'builder'>('priority')
  const [dateFilter, setDateFilter] = useState<'TODAY' | '48H' | '72H' | 'ALL'>('ALL')

  useEffect(() => {
    async function loadData() {
      try {
        const res = await fetch('/api/ops/qc-briefing')
        if (res.ok) {
          const data = await res.json()
          setBriefing(data)
        }
      } catch (error) {
        console.error('Failed to load QC briefing:', error)
      } finally {
        setLoading(false)
      }
    }

    loadData()
  }, [])

  const handleInspect = (job: QCJob) => {
    // Navigate to the job inspection page with jobId parameter
    // This allows inspectors to record pass/fail results and QC findings
    router.push(`/ops/jobs/${job.id}?tab=qc-inspection`)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#C0392B]" />
      </div>
    )
  }

  if (!briefing) {
    return (
      <div className="text-center py-8">
        <p className="text-gray-500">Failed to load inspection queue</p>
      </div>
    )
  }

  // Filter by tab
  let filteredQueue = briefing.inspectionQueue
  if (selectedTab !== 'ALL') {
    filteredQueue = briefing.inspectionQueue.filter((job) => job.priority === selectedTab)
  }

  // Filter by date range
  if (dateFilter !== 'ALL') {
    const now = new Date()
    filteredQueue = filteredQueue.filter((job) => {
      if (!job.scheduledDate) return false
      const scheduled = new Date(job.scheduledDate)
      const hoursUntil = (scheduled.getTime() - now.getTime()) / 3600000

      if (dateFilter === 'TODAY') return hoursUntil <= 24
      if (dateFilter === '48H') return hoursUntil <= 48
      if (dateFilter === '72H') return hoursUntil <= 72
      return true
    })
  }

  // Sort
  const sortedQueue = [...filteredQueue].sort((a, b) => {
    if (sortBy === 'priority') {
      const priorityOrder = { CRITICAL: 1, HIGH: 2, NORMAL: 3 }
      return priorityOrder[a.priority] - priorityOrder[b.priority]
    }
    if (sortBy === 'date') {
      if (!a.scheduledDate) return 1
      if (!b.scheduledDate) return -1
      return new Date(a.scheduledDate).getTime() - new Date(b.scheduledDate).getTime()
    }
    if (sortBy === 'builder') {
      return a.builderName.localeCompare(b.builderName)
    }
    return 0
  })

  const priorityColors: Record<string, { badge: string; bg: string }> = {
    CRITICAL: { badge: 'bg-red-100 text-[#C0392B]', bg: 'hover:bg-red-50' },
    HIGH: { badge: 'bg-orange-100 text-orange-700', bg: 'hover:bg-orange-50' },
    NORMAL: { badge: 'bg-blue-100 text-[#0f2a3e]', bg: 'hover:bg-blue-50' },
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Inspection Queue</h1>
          <p className="text-gray-600 mt-1">{sortedQueue.length} jobs awaiting QC inspection</p>
        </div>
        <Link
          href="/ops/portal/qc"
          className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors text-sm font-medium"
        >
          ← Back to Dashboard
        </Link>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl border p-4">
          <p className="text-xs font-medium text-gray-600 uppercase">Total in Queue</p>
          <p className="text-2xl font-bold text-gray-900 mt-2">{briefing.inspectionQueue.length}</p>
        </div>
        <div className="bg-white rounded-xl border p-4">
          <p className="text-xs font-medium text-gray-600 uppercase">Critical (48h)</p>
          <p className="text-2xl font-bold text-[#C0392B] mt-2">
            {briefing.inspectionQueue.filter((j) => j.priority === 'CRITICAL').length}
          </p>
        </div>
        <div className="bg-white rounded-xl border p-4">
          <p className="text-xs font-medium text-gray-600 uppercase">High (72h)</p>
          <p className="text-2xl font-bold text-orange-600 mt-2">
            {briefing.inspectionQueue.filter((j) => j.priority === 'HIGH').length}
          </p>
        </div>
        <div className="bg-white rounded-xl border p-4">
          <p className="text-xs font-medium text-gray-600 uppercase">Completed Today</p>
          <p className="text-2xl font-bold text-green-600 mt-2">{briefing.summary.inspectionsToday}</p>
        </div>
      </div>

      {/* Tabs and Filters */}
      <div className="bg-white rounded-xl border p-6">
        <div className="flex flex-wrap gap-4 items-center justify-between">
          {/* Priority Tabs */}
          <div className="flex gap-2">
            {['ALL', 'CRITICAL', 'HIGH', 'NORMAL'].map((tab) => (
              <button
                key={tab}
                onClick={() => setSelectedTab(tab as typeof selectedTab)}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                  selectedTab === tab
                    ? 'bg-[#C0392B] text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                {tab === 'ALL' ? 'All Jobs' : tab}
              </button>
            ))}
          </div>

          {/* Date Filter */}
          <div className="flex gap-2">
            {(['TODAY', '48H', '72H', 'ALL'] as const).map((dateOpt) => (
              <button
                key={dateOpt}
                onClick={() => setDateFilter(dateOpt)}
                className={`px-3 py-2 rounded text-xs font-medium transition-all ${
                  dateFilter === dateOpt
                    ? 'bg-[#C0392B] text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                {dateOpt === 'TODAY' ? '📅 Today' : dateOpt === '48H' ? '📅 48h' : dateOpt === '72H' ? '📅 72h' : 'All'}
              </button>
            ))}
          </div>

          {/* Sort */}
          <div>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
              className="px-3 py-2 rounded border border-gray-300 text-sm font-medium text-gray-700 hover:border-gray-400 transition-all"
            >
              <option value="priority">Sort by Priority</option>
              <option value="date">Sort by Date</option>
              <option value="builder">Sort by Builder</option>
            </select>
          </div>
        </div>
      </div>

      {/* Queue Table */}
      <div className="bg-white rounded-xl border p-6">
        {sortedQueue.length === 0 ? (
          <div className="text-center py-12 text-gray-500">
            <p className="text-3xl mb-2">✅</p>
            <p className="text-lg">No jobs in this queue</p>
            <p className="text-sm mt-1">All jobs are either scheduled for QC or already passed</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left py-3 px-4 font-semibold text-gray-600 text-sm">Job #</th>
                  <th className="text-left py-3 px-4 font-semibold text-gray-600 text-sm">Builder</th>
                  <th className="text-left py-3 px-4 font-semibold text-gray-600 text-sm">Products</th>
                  <th className="text-left py-3 px-4 font-semibold text-gray-600 text-sm">Delivery Date</th>
                  <th className="text-left py-3 px-4 font-semibold text-gray-600 text-sm">Priority</th>
                  <th className="text-left py-3 px-4 font-semibold text-gray-600 text-sm">Status</th>
                  <th className="text-right py-3 px-4 font-semibold text-gray-600 text-sm">Action</th>
                </tr>
              </thead>
              <tbody>
                {sortedQueue.map((job) => (
                  <tr key={job.id} className={`border-b border-gray-100 transition-all ${priorityColors[job.priority].bg}`}>
                    <td className="py-4 px-4">
                      <Link href={`/ops/jobs/${job.id}`} className="font-semibold text-[#C0392B] hover:text-[#A93226]">
                        {job.jobNumber}
                      </Link>
                    </td>
                    <td className="py-4 px-4">
                      <div>
                        <p className="font-medium text-gray-900">{job.builderName}</p>
                        {job.community && <p className="text-xs text-gray-500">{job.community}</p>}
                      </div>
                    </td>
                    <td className="py-4 px-4">
                      <span className="text-sm font-medium text-gray-700">{job.productCount} items</span>
                    </td>
                    <td className="py-4 px-4">
                      {job.scheduledDate ? (
                        <div>
                          <p className="text-sm text-gray-900">
                            {new Date(job.scheduledDate).toLocaleDateString()}
                          </p>
                          <p className="text-xs text-gray-500">
                            {new Date(job.scheduledDate).toLocaleTimeString([], {
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </p>
                        </div>
                      ) : (
                        <span className="text-xs text-gray-500">Not scheduled</span>
                      )}
                    </td>
                    <td className="py-4 px-4">
                      <span className={`px-3 py-1 rounded-full text-xs font-semibold ${priorityColors[job.priority].badge}`}>
                        {job.priority}
                      </span>
                    </td>
                    <td className="py-4 px-4">
                      <span className="text-xs font-medium text-gray-600">
                        {job.jobStatus.replace(/_/g, ' ')}
                      </span>
                    </td>
                    <td className="py-4 px-4 text-right">
                      <button
                        onClick={() => handleInspect(job)}
                        className="px-4 py-2 bg-[#C0392B] text-white rounded-lg hover:bg-[#A93226] transition-colors text-sm font-medium"
                      >
                        Inspect →
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
