'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'

interface StagingJob {
  id: string
  jobNumber: string
  builderName: string
  community: string | null
  lotBlock: string | null
  scheduledDate: string | null
  status: string
  materialPicksCount: number
  materialPicks: {
    id: string
    sku: string
    description: string
    quantity: number
    pickedQty: number
    status: string
  }[]
}

interface ApiResponse {
  jobs: StagingJob[]
  total: number
  statusCounts: Record<string, number>
}

export default function StagingPage() {
  const [jobs, setJobs] = useState<StagingJob[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [statusCounts, setStatusCounts] = useState<Record<string, number>>({})

  useEffect(() => {
    fetchStagingJobs()
  }, [])

  const fetchStagingJobs = async () => {
    try {
      setLoading(true)
      const response = await fetch('/api/ops/manufacturing/staging')
      if (!response.ok) {
        throw new Error('Failed to fetch staging jobs')
      }
      const data: ApiResponse = await response.json()
      setJobs(data.jobs || [])
      setStatusCounts(data.statusCounts || {})
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setLoading(false)
    }
  }

  const jobsByStatus = {
    IN_PRODUCTION: jobs.filter((j) => j.status === 'IN_PRODUCTION'),
    STAGED: jobs.filter((j) => j.status === 'STAGED'),
    LOADED: jobs.filter((j) => j.status === 'LOADED'),
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-[#1B4F72]" />
          <p className="mt-4 text-gray-600">Loading staging area...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Staging Area</h1>
          <p className="text-sm text-gray-500 mt-1">
            Manage job staging workflow from production through loading
          </p>
        </div>
        <Link
          href="/ops/manufacturing"
          className="text-xs text-[#1B4F72] hover:underline"
        >
          ← Back to Dashboard
        </Link>
      </div>

      {/* Error message */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700">
          Error loading staging jobs: {error}
        </div>
      )}

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <SummaryCard
          label="In Production"
          count={statusCounts['IN_PRODUCTION'] || 0}
          color="bg-purple-50 border-purple-200"
          icon="🏭"
        />
        <SummaryCard
          label="Staged"
          count={statusCounts['STAGED'] || 0}
          color="bg-yellow-50 border-yellow-200"
          icon="📦"
        />
        <SummaryCard
          label="Loaded"
          count={statusCounts['LOADED'] || 0}
          color="bg-green-50 border-green-200"
          icon="🚚"
        />
      </div>

      {/* Kanban Board */}
      <div className="overflow-x-auto">
        <div className="flex gap-4 min-w-max pb-4">
          {/* In Production Column */}
          <div className="w-[380px] flex-shrink-0">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-3 h-3 rounded-full bg-purple-500" />
              <span className="font-semibold text-gray-900">In Production</span>
              <span className="text-xs font-medium text-gray-500 bg-gray-100 px-2 py-0.5 rounded">
                {jobsByStatus.IN_PRODUCTION.length}
              </span>
            </div>
            <div className="bg-gray-100/50 rounded-lg min-h-[600px] p-3 border border-dashed border-gray-300 space-y-2">
              {jobsByStatus.IN_PRODUCTION.length === 0 ? (
                <div className="text-center text-xs text-gray-400 pt-8">
                  No jobs in production
                </div>
              ) : (
                jobsByStatus.IN_PRODUCTION.map((job) => (
                  <JobCard
                    key={job.id}
                    job={job}
                    status="IN_PRODUCTION"
                    onRefresh={fetchStagingJobs}
                  />
                ))
              )}
            </div>
          </div>

          {/* Staged Column */}
          <div className="w-[380px] flex-shrink-0">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-3 h-3 rounded-full bg-yellow-500" />
              <span className="font-semibold text-gray-900">Staged</span>
              <span className="text-xs font-medium text-gray-500 bg-gray-100 px-2 py-0.5 rounded">
                {jobsByStatus.STAGED.length}
              </span>
            </div>
            <div className="bg-gray-100/50 rounded-lg min-h-[600px] p-3 border border-dashed border-gray-300 space-y-2">
              {jobsByStatus.STAGED.length === 0 ? (
                <div className="text-center text-xs text-gray-400 pt-8">
                  No jobs staged
                </div>
              ) : (
                jobsByStatus.STAGED.map((job) => (
                  <JobCard
                    key={job.id}
                    job={job}
                    status="STAGED"
                    onRefresh={fetchStagingJobs}
                  />
                ))
              )}
            </div>
          </div>

          {/* Loaded Column */}
          <div className="w-[380px] flex-shrink-0">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-3 h-3 rounded-full bg-green-500" />
              <span className="font-semibold text-gray-900">Loaded</span>
              <span className="text-xs font-medium text-gray-500 bg-gray-100 px-2 py-0.5 rounded">
                {jobsByStatus.LOADED.length}
              </span>
            </div>
            <div className="bg-gray-100/50 rounded-lg min-h-[600px] p-3 border border-dashed border-gray-300 space-y-2">
              {jobsByStatus.LOADED.length === 0 ? (
                <div className="text-center text-xs text-gray-400 pt-8">
                  No jobs loaded
                </div>
              ) : (
                jobsByStatus.LOADED.map((job) => (
                  <JobCard
                    key={job.id}
                    job={job}
                    status="LOADED"
                    onRefresh={fetchStagingJobs}
                  />
                ))
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Instructions */}
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-sm text-blue-900">
        <p className="font-medium mb-2">Staging Workflow</p>
        <ul className="space-y-1 text-xs">
          <li>• <strong>In Production:</strong> Job manufacturing in process, materials being assembled</li>
          <li>• <strong>Staged:</strong> Production complete, job packed and staged in warehouse ready for loading</li>
          <li>• <strong>Loaded:</strong> Job confirmed on truck, ready for delivery</li>
        </ul>
      </div>
    </div>
  )
}

function SummaryCard({
  label,
  count,
  color,
  icon,
}: {
  label: string
  count: number
  color: string
  icon: string
}) {
  return (
    <div className={`${color} border rounded-xl p-4`}>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs text-gray-600">{label}</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">{count}</p>
        </div>
        <div className="text-3xl">{icon}</div>
      </div>
    </div>
  )
}

function JobCard({
  job,
  status,
  onRefresh,
}: {
  job: StagingJob
  status: string
  onRefresh: () => void
}) {
  const [isUpdating, setIsUpdating] = useState(false)
  const [toast, setToast] = useState('')
  const [toastType, setToastType] = useState<'success' | 'error'>('success')
  const showToast = (msg: string, type: 'success' | 'error' = 'success') => {
    setToast(msg); setToastType(type);
    setTimeout(() => setToast(''), 3500);
  };

  const getNextStatus = (currentStatus: string) => {
    if (currentStatus === 'IN_PRODUCTION') return 'STAGED'
    if (currentStatus === 'STAGED') return 'LOADED'
    return currentStatus
  }

  const handleAdvanceStatus = async () => {
    try {
      setIsUpdating(true)
      const nextStatus = getNextStatus(status)
      const response = await fetch(`/api/ops/jobs/${job.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: nextStatus,
        }),
      })

      if (!response.ok) {
        throw new Error('Failed to update job status')
      }

      onRefresh()
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to update status', 'error')
    } finally {
      setIsUpdating(false)
    }
  }

  const allPicksReady = job.materialPicks.every(
    (p) => p.status === 'VERIFIED' || p.status === 'PICKED'
  )
  const pickProgress = job.materialPicks.length > 0
    ? (job.materialPicks.filter((p) => p.pickedQty === p.quantity).length /
        job.materialPicks.length) *
      100
    : 0

  return (
    <div className="bg-white rounded-lg p-3 border border-gray-200 hover:shadow-md hover:border-[#1B4F72] transition-all">
      {toast && (
        <div className={`fixed top-4 right-4 z-50 px-4 py-2 rounded-lg shadow-lg text-sm text-white ${
          toastType === 'error' ? 'bg-red-600' : 'bg-[#1B4F72]'
        }`}>
          {toast}
        </div>
      )}
      <Link href={`/ops/jobs/${job.id}`} className="block mb-2">
        <p className="text-xs font-bold text-gray-900 hover:text-[#1B4F72]">{job.jobNumber}</p>
        <p className="text-xs text-gray-600">{job.builderName}</p>
      </Link>

      {job.community && (
        <p className="text-xs text-gray-500 mb-2">{job.community}</p>
      )}

      {job.scheduledDate && (
        <p className="text-xs text-gray-600 mb-2">
          Scheduled: {new Date(job.scheduledDate).toLocaleDateString()}
        </p>
      )}

      {/* Pick Progress */}
      <div className="mb-3">
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs text-gray-600">Items Complete</span>
          <span className="text-xs font-medium text-gray-700">{Math.round(pickProgress)}%</span>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-1.5">
          <div
            className="bg-[#E67E22] h-1.5 rounded-full transition-all"
            style={{ width: `${pickProgress}%` }}
          />
        </div>
      </div>

      {/* Materials Summary */}
      <div className="text-xs text-gray-600 mb-3 space-y-0.5">
        <p>{job.materialPicksCount} items • {job.materialPicks.length} picked</p>
      </div>

      {/* Action Button */}
      {status !== 'LOADED' && (
        <button
          onClick={handleAdvanceStatus}
          disabled={!allPicksReady || isUpdating}
          className={`w-full px-2 py-1 rounded text-xs font-medium transition-colors ${
            allPicksReady
              ? 'bg-[#1B4F72] text-white hover:bg-[#154360]'
              : 'bg-gray-200 text-gray-500 cursor-not-allowed'
          } disabled:opacity-50`}
        >
          {isUpdating ? 'Updating...' : status === 'IN_PRODUCTION' ? 'Move to Staging' : 'Confirm Load'}
        </button>
      )}

      {status === 'LOADED' && (
        <div className="w-full px-2 py-1 rounded text-xs font-medium bg-green-100 text-green-700 text-center">
          ✓ Loaded
        </div>
      )}
    </div>
  )
}
