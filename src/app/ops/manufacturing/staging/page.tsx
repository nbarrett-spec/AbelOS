'use client'

import { useState, useEffect, useMemo } from 'react'
import Link from 'next/link'
import { Factory, Search, X, ArrowRight } from 'lucide-react'
import EmptyState from '@/components/ui/EmptyState'
import PageHeader from '@/components/ui/PageHeader'

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
  const [search, setSearch] = useState('')
  const [moveModalOpen, setMoveModalOpen] = useState(false)
  const [pageToast, setPageToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null)

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

  const showPageToast = (msg: string, type: 'success' | 'error' = 'success') => {
    setPageToast({ msg, type })
    setTimeout(() => setPageToast(null), 3500)
  }

  // Pure client-side filter — applies to all 3 columns. No refetch.
  // Address isn't returned by the staging API, so we include `community`
  // and `lotBlock` (the location surrogates that are in the payload).
  const filteredJobs = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return jobs
    return jobs.filter((j) => {
      const haystack = [
        j.jobNumber,
        j.builderName,
        j.community || '',
        j.lotBlock || '',
      ]
        .join(' ')
        .toLowerCase()
      return haystack.includes(q)
    })
  }, [jobs, search])

  const jobsByStatus = {
    IN_PRODUCTION: filteredJobs.filter((j) => j.status === 'IN_PRODUCTION'),
    STAGED: filteredJobs.filter((j) => j.status === 'STAGED'),
    LOADED: filteredJobs.filter((j) => j.status === 'LOADED'),
  }

  // Unfiltered IN_PRODUCTION list — fuels the "Move Job to Staging" picker
  // so the modal isn't constrained by the page-level search above.
  const inProductionAll = useMemo(
    () => jobs.filter((j) => j.status === 'IN_PRODUCTION'),
    [jobs]
  )

  const handleMoveToStaged = async (jobId: string) => {
    try {
      const res = await fetch(`/api/ops/jobs/${jobId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'STAGED' }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body?.error || 'Failed to move job to staging')
      }
      showPageToast('Job moved to Staged', 'success')
      setMoveModalOpen(false)
      await fetchStagingJobs()
    } catch (err) {
      showPageToast(
        err instanceof Error ? err.message : 'Failed to move job',
        'error'
      )
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-[#0f2a3e]" />
          <p className="mt-4 text-fg-muted">Loading staging area...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Staging Area"
        description="Manage job staging workflow from production through loading"
        actions={
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setMoveModalOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#0f2a3e] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#0a1a28]"
            >
              <ArrowRight className="w-3.5 h-3.5" />
              Move Job to Staging
            </button>
            <Link
              href="/ops/manufacturing"
              className="text-xs text-[#0f2a3e] hover:underline"
            >
              ← Back to Dashboard
            </Link>
          </div>
        }
      />

      {/* Page-level toast for Move action */}
      {pageToast && (
        <div
          className={`fixed top-4 right-4 z-50 px-4 py-2 rounded-lg shadow-lg text-sm text-white ${
            pageToast.type === 'error' ? 'bg-red-600' : 'bg-[#0f2a3e]'
          }`}
        >
          {pageToast.msg}
        </div>
      )}

      {/* Search bar — pure client-side filter on already-loaded jobs */}
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-fg-subtle pointer-events-none" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by job #, community, lot/block, or builder…"
          className="w-full pl-9 pr-9 py-2 rounded-lg border border-border bg-surface text-sm text-fg placeholder:text-fg-subtle focus:outline-none focus:border-[#0f2a3e]"
        />
        {search && (
          <button
            type="button"
            onClick={() => setSearch('')}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded hover:bg-surface-muted"
            aria-label="Clear search"
          >
            <X className="w-4 h-4 text-fg-subtle" />
          </button>
        )}
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
              <span className="font-semibold text-fg">In Production</span>
              <span className="text-xs font-medium text-fg-subtle bg-gray-100 px-2 py-0.5 rounded">
                {jobsByStatus.IN_PRODUCTION.length}
              </span>
            </div>
            <div className="bg-gray-100/50 rounded-lg min-h-[600px] p-3 border border-dashed border-gray-300 space-y-2">
              {jobsByStatus.IN_PRODUCTION.length === 0 ? (
                <EmptyState
                  size="compact"
                  icon={<Factory className="w-6 h-6 text-fg-subtle" />}
                  title="No jobs in production"
                />
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
              <span className="font-semibold text-fg">Staged</span>
              <span className="text-xs font-medium text-fg-subtle bg-gray-100 px-2 py-0.5 rounded">
                {jobsByStatus.STAGED.length}
              </span>
            </div>
            <div className="bg-gray-100/50 rounded-lg min-h-[600px] p-3 border border-dashed border-gray-300 space-y-2">
              {jobsByStatus.STAGED.length === 0 ? (
                <div className="text-center text-xs text-fg-subtle pt-8">
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
              <span className="font-semibold text-fg">Loaded</span>
              <span className="text-xs font-medium text-fg-subtle bg-gray-100 px-2 py-0.5 rounded">
                {jobsByStatus.LOADED.length}
              </span>
            </div>
            <div className="bg-gray-100/50 rounded-lg min-h-[600px] p-3 border border-dashed border-gray-300 space-y-2">
              {jobsByStatus.LOADED.length === 0 ? (
                <div className="text-center text-xs text-fg-subtle pt-8">
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

      {/* Move Job to Staging modal */}
      {moveModalOpen && (
        <MoveJobModal
          inProductionJobs={inProductionAll}
          onClose={() => setMoveModalOpen(false)}
          onMove={handleMoveToStaged}
        />
      )}
    </div>
  )
}

function MoveJobModal({
  inProductionJobs,
  onClose,
  onMove,
}: {
  inProductionJobs: StagingJob[]
  onClose: () => void
  onMove: (jobId: string) => Promise<void>
}) {
  const [modalSearch, setModalSearch] = useState('')
  const [movingId, setMovingId] = useState<string | null>(null)

  const filtered = useMemo(() => {
    const q = modalSearch.trim().toLowerCase()
    if (!q) return inProductionJobs
    return inProductionJobs.filter((j) => {
      const haystack = [
        j.jobNumber,
        j.builderName,
        j.community || '',
        j.lotBlock || '',
      ]
        .join(' ')
        .toLowerCase()
      return haystack.includes(q)
    })
  }, [inProductionJobs, modalSearch])

  const handleSelect = async (jobId: string) => {
    if (movingId) return
    setMovingId(jobId)
    try {
      await onMove(jobId)
    } finally {
      setMovingId(null)
    }
  }

  return (
    <div
      className="fixed inset-0 z-40 bg-black/40 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-lg w-full max-w-lg max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <div>
            <h3 className="text-sm font-semibold text-fg">Move Job to Staging</h3>
            <p className="text-xs text-fg-muted">
              Select an in-production job to move to STAGED.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded hover:bg-surface-muted"
            aria-label="Close"
          >
            <X className="w-4 h-4 text-fg-subtle" />
          </button>
        </div>

        <div className="px-4 py-3 border-b border-border">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-fg-subtle pointer-events-none" />
            <input
              type="text"
              value={modalSearch}
              onChange={(e) => setModalSearch(e.target.value)}
              placeholder="Search in-production jobs…"
              autoFocus
              className="w-full pl-9 pr-3 py-2 rounded-lg border border-border bg-surface text-sm text-fg placeholder:text-fg-subtle focus:outline-none focus:border-[#0f2a3e]"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-2 py-2">
          {filtered.length === 0 ? (
            <div className="text-center text-xs text-fg-subtle py-8">
              {inProductionJobs.length === 0
                ? 'No jobs currently in production.'
                : 'No matches.'}
            </div>
          ) : (
            <ul className="space-y-1">
              {filtered.map((job) => (
                <li key={job.id}>
                  <button
                    type="button"
                    onClick={() => handleSelect(job.id)}
                    disabled={movingId !== null}
                    className="w-full text-left px-3 py-2 rounded-lg border border-border hover:bg-row-hover hover:border-[#0f2a3e] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-fg truncate">
                          {job.jobNumber}
                        </p>
                        <p className="text-xs text-fg-muted truncate">
                          {job.builderName}
                          {job.community ? ` · ${job.community}` : ''}
                          {job.lotBlock ? ` · ${job.lotBlock}` : ''}
                        </p>
                      </div>
                      <span className="text-xs font-medium text-[#0f2a3e] whitespace-nowrap">
                        {movingId === job.id ? 'Moving…' : 'Move →'}
                      </span>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
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
          <p className="text-xs text-fg-muted">{label}</p>
          <p className="text-2xl font-semibold text-fg mt-1">{count}</p>
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
    <div className="bg-white rounded-lg p-3 border border-gray-200 hover:shadow-md hover:border-[#0f2a3e] transition-all">
      {toast && (
        <div className={`fixed top-4 right-4 z-50 px-4 py-2 rounded-lg shadow-lg text-sm text-white ${
          toastType === 'error' ? 'bg-red-600' : 'bg-[#0f2a3e]'
        }`}>
          {toast}
        </div>
      )}
      <Link href={`/ops/jobs/${job.id}`} className="block mb-2">
        <p className="text-xs font-semibold text-fg hover:text-[#0f2a3e]">{job.jobNumber}</p>
        <p className="text-xs text-fg-muted">{job.builderName}</p>
      </Link>

      {job.community && (
        <p className="text-xs text-fg-subtle mb-2">{job.community}</p>
      )}

      {job.scheduledDate && (
        <p className="text-xs text-fg-muted mb-2">
          Scheduled: {new Date(job.scheduledDate).toLocaleDateString()}
        </p>
      )}

      {/* Pick Progress */}
      <div className="mb-3">
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs text-fg-muted">Items Complete</span>
          <span className="text-xs font-medium text-fg-muted">{Math.round(pickProgress)}%</span>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-1.5">
          <div
            className="bg-signal h-1.5 rounded-full transition-all"
            style={{ width: `${pickProgress}%` }}
          />
        </div>
      </div>

      {/* Materials Summary */}
      <div className="text-xs text-fg-muted mb-3 space-y-0.5">
        <p>{job.materialPicksCount} items • {job.materialPicks.length} picked</p>
      </div>

      {/* Action Button */}
      {status !== 'LOADED' && (
        <button
          onClick={handleAdvanceStatus}
          disabled={!allPicksReady || isUpdating}
          className={`w-full px-2 py-1 rounded text-xs font-medium transition-colors ${
            allPicksReady
              ? 'bg-[#0f2a3e] text-white hover:bg-[#0a1a28]'
              : 'bg-gray-200 text-fg-subtle cursor-not-allowed'
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
