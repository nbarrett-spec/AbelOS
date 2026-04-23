'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { CreateJobModal } from '../components/CreateJobModal'

const JOB_STATUSES = [
  { key: 'CREATED', label: 'New', color: '#95A5A6' },
  { key: 'READINESS_CHECK', label: 'T-72 Check', color: '#3498DB' },
  { key: 'MATERIALS_LOCKED', label: 'T-48 Lock', color: '#4B0082' },
  { key: 'IN_PRODUCTION', label: 'Production', color: '#9B59B6' },
  { key: 'STAGED', label: 'Staged', color: '#F1C40F' },
  { key: 'LOADED', label: 'T-24 Loaded', color: '#C6A24E' },
  { key: 'IN_TRANSIT', label: 'In Transit', color: '#FFA500' },
  { key: 'DELIVERED', label: 'Delivered', color: '#1ABC9C' },
  { key: 'INSTALLING', label: 'Installing', color: '#00BCD4' },
  { key: 'PUNCH_LIST', label: 'Punch List', color: '#E74C3C' },
  { key: 'COMPLETE', label: 'Complete', color: '#27AE60' },
  { key: 'INVOICED', label: 'Invoiced', color: '#16A085' },
]

interface Job {
  id: string
  builderName: string
  community: string | null
  lotBlock: string | null
  jobAddress: string | null
  assignedPM?: {
    firstName: string
    lastName: string
  } | null
  scheduledDate?: string | null
  status: string
  jobNumber: string
  scopeType: string
  dropPlan: string | null
  _count?: { decisionNotes: number; tasks: number; deliveries: number; installations: number }
}

interface ApiResponse {
  jobs: Job[]
  pagination: {
    total: number
    page: number
    pageSize: number
  }
  statusCounts: Record<string, number>
}

export default function JobPipelinePage() {
  const [activeFilter, setActiveFilter] = useState('ALL')
  const [viewMode, setViewMode] = useState<'board' | 'list'>('board')
  const [search, setSearch] = useState('')
  const [jobs, setJobs] = useState<Job[]>([])
  const [statusCounts, setStatusCounts] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false)
  const [listPage, setListPage] = useState(1)
  const LIST_PAGE_SIZE = 50

  useEffect(() => {
    const fetchJobs = async () => {
      try {
        setLoading(true)
        const response = await fetch('/api/ops/jobs?limit=1000')
        if (!response.ok) {
          throw new Error('Failed to fetch jobs')
        }
        const data = await response.json()
        setJobs(data.data || data.jobs || [])
        setStatusCounts(data.statusCounts || {})
        setError(null)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'An error occurred')
        setJobs([])
      } finally {
        setLoading(false)
      }
    }

    fetchJobs()
  }, [])

  // Filter jobs based on search and active filter
  const filteredJobs = jobs.filter((job) => {
    const matchesFilter = activeFilter === 'ALL' || job.status === activeFilter
    const matchesSearch =
      search === '' ||
      (job.builderName || '').toLowerCase().includes(search.toLowerCase()) ||
      (job.community || '').toLowerCase().includes(search.toLowerCase())
    return matchesFilter && matchesSearch
  })

  // Get jobs for a specific status (for board view)
  const getJobsByStatus = (status: string) => {
    return filteredJobs.filter((job) => job.status === status)
  }

  const handleCreateJobSuccess = () => {
    // Refresh the jobs list
    const fetchJobs = async () => {
      try {
        setLoading(true)
        const response = await fetch('/api/ops/jobs?limit=1000')
        if (!response.ok) {
          throw new Error('Failed to fetch jobs')
        }
        const data = await response.json()
        setJobs(data.data || data.jobs || [])
        setStatusCounts(data.statusCounts || {})
        setError(null)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'An error occurred')
        setJobs([])
      } finally {
        setLoading(false)
      }
    }
    fetchJobs()
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-[#0f2a3e]" />
          <p className="mt-4 text-gray-600">Loading jobs...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Job Pipeline</h1>
          <p className="text-sm text-gray-500 mt-1">
            Track every job from order to closeout — T-72 → T-48 → T-24 → Day-of
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setIsCreateModalOpen(true)}
            className="px-3 py-1.5 text-sm bg-[#0f2a3e] text-white rounded-lg hover:bg-[#0a1a28] transition-colors"
          >
            + Create Job
          </button>
        </div>
      </div>

      {/* Error message */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700">
          Error loading jobs: {error}
        </div>
      )}

      {/* Controls bar */}
      <div className="bg-white rounded-xl border p-4 flex items-center gap-4 flex-wrap">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search jobs by builder, community..."
          className="flex-1 min-w-[200px] px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-[#0f2a3e]/20 focus:border-[#0f2a3e]"
        />
        <div className="flex gap-1">
          <button
            onClick={() => setViewMode('board')}
            className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
              viewMode === 'board'
                ? 'bg-[#0f2a3e] text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            Board
          </button>
          <button
            onClick={() => setViewMode('list')}
            className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
              viewMode === 'list'
                ? 'bg-[#0f2a3e] text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            List
          </button>
        </div>
      </div>

      {/* Status filter pills */}
      <div className="flex gap-2 flex-wrap">
        <button
          onClick={() => setActiveFilter('ALL')}
          className={`px-3 py-1 text-xs rounded-full border transition-colors ${
            activeFilter === 'ALL'
              ? 'bg-[#0f2a3e] text-white border-transparent'
              : 'text-gray-600 border-gray-200 hover:border-gray-300 bg-white'
          }`}
        >
          All Jobs
        </button>
        {JOB_STATUSES.map((status) => (
          <button
            key={status.key}
            onClick={() => setActiveFilter(status.key)}
            className={`px-3 py-1 text-xs rounded-full border transition-colors ${
              activeFilter === status.key
                ? 'text-white border-transparent'
                : 'text-gray-600 border-gray-200 hover:border-gray-300 bg-white'
            }`}
            style={
              activeFilter === status.key
                ? { backgroundColor: status.color }
                : undefined
            }
          >
            {status.label} ({statusCounts[status.key] || 0})
          </button>
        ))}
      </div>

      {/* Board View */}
      {viewMode === 'board' ? (
        <div className="overflow-x-auto">
          <div className="flex gap-4 min-w-max pb-4">
            {JOB_STATUSES.map((status) => {
              const statusJobs = getJobsByStatus(status.key)
              return (
                <div
                  key={status.key}
                  className="w-[320px] flex-shrink-0"
                >
                  <div className="flex items-center gap-2 mb-3 px-2">
                    <div
                      className="w-2.5 h-2.5 rounded-full"
                      style={{ backgroundColor: status.color }}
                    />
                    <span className="text-sm font-medium text-gray-700">
                      {status.label}
                    </span>
                    <span className="text-xs text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">
                      {statusJobs.length}
                    </span>
                  </div>
                  <div className="bg-gray-100/50 rounded-lg min-h-[400px] p-3 border border-dashed border-gray-200 space-y-2">
                    {statusJobs.length === 0 ? (
                      <div className="text-center text-xs text-gray-400 pt-8">
                        No jobs
                      </div>
                    ) : (
                      statusJobs.map((job) => (
                        <Link
                          key={job.id}
                          href={`/ops/jobs/${job.id}`}
                          className="block"
                        >
                          <div className="bg-white rounded-lg p-3 border border-gray-200 hover:shadow-md hover:border-[#0f2a3e] transition-all cursor-pointer">
                            <div className="flex items-start justify-between mb-2">
                              <div className="flex-1">
                                <p className="text-xs font-semibold text-gray-900 truncate">
                                  {job.builderName}
                                </p>
                                <p className="text-xs text-gray-600 truncate">
                                  {job.community || '—'}
                                </p>
                              </div>
                            </div>
                            <div className="space-y-1.5 text-xs">
                              {job.lotBlock && (
                              <div className="text-gray-700">
                                <span className="font-medium">Lot:</span> {job.lotBlock}
                              </div>
                              )}
                              <div className="text-gray-600 truncate" title={job.jobAddress || ''}>
                                <span className="font-medium">Address:</span> {job.jobAddress || '—'}
                              </div>
                              {job.assignedPM && (
                                <div className="text-gray-600">
                                  <span className="font-medium">PM:</span> {job.assignedPM.firstName} {job.assignedPM.lastName}
                                </div>
                              )}
                              {job.scheduledDate && (
                                <div className="text-gray-600">
                                  <span className="font-medium">Scheduled:</span>{' '}
                                  {new Date(job.scheduledDate).toLocaleDateString()}
                                </div>
                              )}
                            </div>
                          </div>
                        </Link>
                      ))
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      ) : (
        /* List View */
        <div className="bg-white rounded-xl border overflow-hidden">
          {filteredJobs.length === 0 ? (
            <div className="text-center text-gray-400 text-sm py-16">
              <p className="text-4xl mb-3">📋</p>
              <p className="font-medium">No jobs found</p>
              <p className="text-xs mt-2 max-w-md mx-auto">
                {jobs.length === 0
                  ? 'Jobs are created when quotes are approved and converted to orders.'
                  : 'Try adjusting your search or filters.'}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 border-b">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700">
                      Builder
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700">
                      Community
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700">
                      Lot/Block
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700">
                      Address
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700">
                      PM
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700">
                      Scheduled
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700">
                      Status
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {filteredJobs.slice((listPage - 1) * LIST_PAGE_SIZE, listPage * LIST_PAGE_SIZE).map((job) => {
                    const statusConfig = JOB_STATUSES.find(
                      (s) => s.key === job.status
                    )
                    return (
                      <tr
                        key={job.id}
                        className="hover:bg-gray-50 transition-colors"
                      >
                        <td className="px-4 py-3">
                          <Link
                            href={`/ops/jobs/${job.id}`}
                            className="text-sm font-medium text-[#0f2a3e] hover:underline"
                          >
                            {job.builderName}
                          </Link>
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-700">
                          {job.community || '—'}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-700">
                          {job.lotBlock || '—'}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-700 max-w-xs truncate">
                          {job.jobAddress || '—'}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-700">
                          {job.assignedPM ? `${job.assignedPM.firstName} ${job.assignedPM.lastName}` : '—'}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-700">
                          {job.scheduledDate
                            ? new Date(job.scheduledDate).toLocaleDateString()
                            : '—'}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className="inline-block px-2 py-1 rounded-full text-xs font-medium text-white"
                            style={{
                              backgroundColor: statusConfig?.color || '#95A5A6',
                            }}
                          >
                            {statusConfig?.label || job.status}
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
          {filteredJobs.length > LIST_PAGE_SIZE && (
            <div className="flex items-center justify-between px-4 py-3 border-t text-sm text-gray-500">
              <span>Showing {Math.min((listPage - 1) * LIST_PAGE_SIZE + 1, filteredJobs.length)}–{Math.min(listPage * LIST_PAGE_SIZE, filteredJobs.length)} of {filteredJobs.length}</span>
              <div className="flex gap-2">
                <button onClick={() => setListPage(p => Math.max(1, p - 1))} disabled={listPage <= 1} className="px-3 py-1 border rounded text-xs disabled:opacity-40">Previous</button>
                <button onClick={() => setListPage(p => p + 1)} disabled={listPage * LIST_PAGE_SIZE >= filteredJobs.length} className="px-3 py-1 border rounded text-xs disabled:opacity-40">Next</button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* T-72/T-48/T-24 Workflow Legend */}
      <div className="bg-white rounded-xl border p-5">
        <h3 className="font-semibold text-gray-900 mb-3">
          Job Lifecycle — Drop Workflow
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <WorkflowStep
            label="T-72 Readiness Check"
            description="Verify specs, confirm materials in InFlow, check crew availability. Builder gets notification."
            color="#3498DB"
          />
          <WorkflowStep
            label="T-48 Materials Lock"
            description="Final material count, spec validation, damage inspection. Lock materials in InFlow — no changes after this."
            color="#4B0082"
          />
          <WorkflowStep
            label="T-24 Load Confirm"
            description="Stage materials in warehouse. Picks & pack slips generated. Pre-departure photos taken. Route planned."
            color="#C6A24E"
          />
          <WorkflowStep
            label="Day-of Delivery"
            description="Truck dispatched. On-site photos on arrival. Material placement per builder specs. PM confirmation."
            color="#27AE60"
          />
        </div>
      </div>

      <CreateJobModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        onSuccess={handleCreateJobSuccess}
      />
    </div>
  )
}

function WorkflowStep({
  label,
  description,
  color,
}: {
  label: string
  description: string
  color: string
}) {
  return (
    <div className="flex gap-3">
      <div
        className="w-1 rounded-full flex-shrink-0"
        style={{ backgroundColor: color }}
      />
      <div>
        <p className="text-sm font-medium text-gray-900">{label}</p>
        <p className="text-xs text-gray-500 mt-1">{description}</p>
      </div>
    </div>
  )
}
