'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { Briefcase } from 'lucide-react'
import { CreateJobModal } from '../components/CreateJobModal'
import PageHeader from '@/components/ui/PageHeader'
import EmptyState from '@/components/ui/EmptyState'
import { DrillLink } from '@/components/ui/DrillLink'
import { fullName } from '@/lib/formatting'

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
    firstName: string | null
    lastName: string | null
  } | null
  scheduledDate?: string | null
  status: string
  jobNumber: string
  scopeType: string
  dropPlan: string | null
  buildSheetNotes?: string | null
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

// Synthetic filter for jobs whose scheduledDate was auto-defaulted to
// createdAt + 14d by scripts/backfill-scheduled-dates.mjs. The marker
// [NEEDS_REVIEW | DEFAULT_LEAD_TIME] is carried in buildSheetNotes.
const NEEDS_REVIEW_FILTER = 'NEEDS_REVIEW'

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

  // Jobs whose scheduledDate was auto-backfilled to createdAt + 14d. Loaded
  // from the dedicated endpoint because the main /api/ops/jobs query does not
  // return buildSheetNotes. Keyed by job.id for quick lookup in the main list.
  const [needsReviewJobs, setNeedsReviewJobs] = useState<Job[]>([])
  const [needsReviewCount, setNeedsReviewCount] = useState<number>(0)
  // Per-row state for inline date editing on the NEEDS_REVIEW view.
  const [editingDates, setEditingDates] = useState<Record<string, string>>({})
  const [savingRow, setSavingRow] = useState<string | null>(null)

  const fetchNeedsReview = async () => {
    try {
      const response = await fetch('/api/ops/jobs/needs-review')
      if (!response.ok) return
      const data = await response.json()
      const list: Job[] = data.data || []
      setNeedsReviewJobs(list)
      setNeedsReviewCount(data.count || list.length)
    } catch (err) {
      // Silent — this is an augmentation, not the primary data source.
      console.warn('needs-review fetch failed', err)
    }
  }

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
    fetchNeedsReview()
  }, [])

  const handleConfirmScheduledDate = async (jobId: string, newDate?: string) => {
    setSavingRow(jobId)
    try {
      const res = await fetch(`/api/ops/jobs/${jobId}/confirm-scheduled-date`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newDate ? { scheduledDate: newDate } : {}),
      })
      if (!res.ok) throw new Error('Failed to confirm scheduled date')
      // Remove this row locally
      setNeedsReviewJobs((prev) => prev.filter((j) => j.id !== jobId))
      setNeedsReviewCount((c) => Math.max(0, c - 1))
      setEditingDates((prev) => {
        const next = { ...prev }
        delete next[jobId]
        return next
      })
      // Also update the corresponding row in the main jobs list so the
      // main list view reflects the new date without a full refetch.
      if (newDate) {
        setJobs((prev) =>
          prev.map((j) =>
            j.id === jobId ? { ...j, scheduledDate: newDate, buildSheetNotes: null } : j
          )
        )
      } else {
        setJobs((prev) =>
          prev.map((j) => (j.id === jobId ? { ...j, buildSheetNotes: null } : j))
        )
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to confirm scheduled date')
    } finally {
      setSavingRow(null)
    }
  }

  // Filter jobs based on search and active filter. The NEEDS_REVIEW pseudo-
  // filter drops us into a dedicated table; everything else filters the
  // primary /api/ops/jobs result set.
  const filteredJobs = jobs.filter((job) => {
    if (activeFilter === NEEDS_REVIEW_FILTER) return false // handled separately
    const matchesFilter = activeFilter === 'ALL' || job.status === activeFilter
    const matchesSearch =
      search === '' ||
      (job.builderName || '').toLowerCase().includes(search.toLowerCase()) ||
      (job.community || '').toLowerCase().includes(search.toLowerCase())
    return matchesFilter && matchesSearch
  })

  const filteredNeedsReview = needsReviewJobs.filter((job) => {
    if (search === '') return true
    const needle = search.toLowerCase()
    return (
      (job.builderName || '').toLowerCase().includes(needle) ||
      (job.community || '').toLowerCase().includes(needle) ||
      (job.jobAddress || '').toLowerCase().includes(needle) ||
      (job.jobNumber || '').toLowerCase().includes(needle)
    )
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
    fetchNeedsReview()
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-signal" />
          <p className="mt-4 text-fg-muted">Loading jobs...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Job Pipeline"
        description="Track every job from order to closeout — T-72 → T-48 → T-24 → Day-of"
        actions={
          <button
            onClick={() => setIsCreateModalOpen(true)}
            className="px-3 py-1.5 text-sm bg-signal text-fg-on-accent rounded-lg hover:bg-signal-hover transition-colors"
          >
            + Create Job
          </button>
        }
      />

      {/* Error message */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700">
          Error loading jobs: {error}
        </div>
      )}

      {/* Needs-Date-Review banner — surfaces the auto-defaulted scheduledDate queue */}
      {needsReviewCount > 0 && activeFilter !== NEEDS_REVIEW_FILTER && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <span className="text-lg leading-none mt-0.5" aria-hidden>⚠</span>
            <div>
              <p className="text-sm font-semibold text-amber-900">
                {needsReviewCount} {needsReviewCount === 1 ? 'job needs' : 'jobs need'} date review
              </p>
              <p className="text-xs text-amber-800 mt-0.5">
                These rows were auto-backfilled to <span className="font-mono">createdAt + 14d</span>.
                Confirm or correct each one so the default lead time isn't treated as truth.
              </p>
            </div>
          </div>
          <button
            onClick={() => setActiveFilter(NEEDS_REVIEW_FILTER)}
            className="px-3 py-1.5 text-sm bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition-colors whitespace-nowrap"
          >
            Review Queue →
          </button>
        </div>
      )}

      {/* Controls bar */}
      <div className="bg-surface rounded-xl border p-4 flex items-center gap-4 flex-wrap">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search jobs by builder, community..."
          className="flex-1 min-w-[200px] px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-signal/20 focus:border-signal"
        />
        <div className="flex gap-1">
          <button
            onClick={() => setViewMode('board')}
            className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
              viewMode === 'board'
                ? 'bg-signal text-fg-on-accent'
                : 'bg-surface-muted text-fg-muted hover:bg-surface-muted/70'
            }`}
          >
            Board
          </button>
          <button
            onClick={() => setViewMode('list')}
            className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
              viewMode === 'list'
                ? 'bg-signal text-fg-on-accent'
                : 'bg-surface-muted text-fg-muted hover:bg-surface-muted/70'
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
              ? 'bg-signal text-fg-on-accent border-transparent'
              : 'text-fg-muted border-border hover:border-border-strong bg-surface'
          }`}
        >
          All Jobs
        </button>
        {needsReviewCount > 0 && (
          <button
            onClick={() => setActiveFilter(NEEDS_REVIEW_FILTER)}
            className={`px-3 py-1 text-xs rounded-full border transition-colors ${
              activeFilter === NEEDS_REVIEW_FILTER
                ? 'bg-amber-600 text-white border-transparent'
                : 'bg-amber-50 text-amber-900 border-amber-300 hover:bg-amber-100'
            }`}
            title="Jobs whose scheduledDate was auto-defaulted to createdAt + 14d"
          >
            ⚠ Needs Date Review ({needsReviewCount})
          </button>
        )}
        {JOB_STATUSES.map((status) => (
          <button
            key={status.key}
            onClick={() => setActiveFilter(status.key)}
            className={`px-3 py-1 text-xs rounded-full border transition-colors ${
              activeFilter === status.key
                ? 'text-white border-transparent'
                : 'text-fg-muted border-border hover:border-border-strong bg-surface'
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

      {/* Needs-Date-Review dedicated view — inline confirm/edit per row */}
      {activeFilter === NEEDS_REVIEW_FILTER ? (
        <div className="bg-surface rounded-xl border overflow-hidden">
          <div className="px-4 py-3 bg-amber-50 border-b border-amber-200 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-amber-900">
                ⚠ Jobs with auto-defaulted scheduled date
              </h3>
              <p className="text-xs text-amber-800 mt-0.5">
                Showing {filteredNeedsReview.length} of {needsReviewCount}. Confirm the 14-day default,
                or pick the real date and save.
              </p>
            </div>
            <button
              onClick={() => setActiveFilter('ALL')}
              className="text-xs text-amber-900 underline hover:no-underline"
            >
              ← Back to all jobs
            </button>
          </div>
          {filteredNeedsReview.length === 0 ? (
            <div className="text-center text-fg-muted text-sm py-16">
              <p className="text-4xl mb-3">✓</p>
              <p className="font-medium">No jobs need date review</p>
              <p className="text-xs mt-2 max-w-md mx-auto">
                {needsReviewCount === 0
                  ? 'All scheduled dates have been confirmed.'
                  : 'No matches for the current search.'}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-surface-muted border-b">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-fg">Job #</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-fg">Builder</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-fg">Address</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-fg">Community</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-fg">PM</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-fg">
                      Default (createdAt+14d)
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-fg">Edit Date</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-fg">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {filteredNeedsReview.map((job) => {
                    const currentIso = job.scheduledDate
                      ? new Date(job.scheduledDate).toISOString().slice(0, 10)
                      : ''
                    const editVal = editingDates[job.id] ?? currentIso
                    const edited = editVal !== currentIso
                    const saving = savingRow === job.id
                    return (
                      <tr key={job.id} className="hover:bg-row-hover transition-colors">
                        <td className="px-4 py-3 text-sm">
                          <Link
                            href={`/ops/jobs/${job.id}`}
                            className="font-mono text-signal hover:underline"
                          >
                            {job.jobNumber}
                          </Link>
                        </td>
                        <td className="px-4 py-3 text-sm font-medium text-fg">
                          {job.builderName || '—'}
                        </td>
                        <td className="px-4 py-3 text-sm text-fg-muted max-w-xs truncate" title={job.jobAddress || ''}>
                          {job.jobAddress || '—'}
                        </td>
                        <td className="px-4 py-3 text-sm text-fg-muted">
                          {job.community || '—'}
                          {job.lotBlock && (
                            <span className="text-fg-subtle"> / {job.lotBlock}</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-sm text-fg-muted">
                          {job.assignedPM
                            ? fullName(job.assignedPM)
                            : <span className="text-fg-subtle">Unassigned</span>}
                        </td>
                        <td className="px-4 py-3 text-sm">
                          <span className="inline-block px-2 py-0.5 rounded bg-amber-100 text-amber-900 font-mono text-xs">
                            {job.scheduledDate
                              ? new Date(job.scheduledDate).toLocaleDateString()
                              : '—'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-sm">
                          <input
                            type="date"
                            value={editVal}
                            onChange={(e) =>
                              setEditingDates((prev) => ({
                                ...prev,
                                [job.id]: e.target.value,
                              }))
                            }
                            className="px-2 py-1 border rounded text-xs focus:ring-2 focus:ring-signal/20 focus:border-signal"
                          />
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button
                            disabled={saving}
                            onClick={() =>
                              handleConfirmScheduledDate(
                                job.id,
                                edited ? new Date(editVal).toISOString() : undefined
                              )
                            }
                            className={`px-3 py-1.5 text-xs rounded-lg text-white transition-colors disabled:opacity-50 ${
                              edited
                                ? 'bg-signal hover:bg-signal-hover'
                                : 'bg-emerald-600 hover:bg-emerald-700'
                            }`}
                          >
                            {saving ? 'Saving…' : edited ? 'Save Date' : 'Confirm'}
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
      ) : viewMode === 'board' ? (
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
                    <span className="text-sm font-medium text-fg">
                      {status.label}
                    </span>
                    <span className="text-xs text-fg-subtle bg-surface-muted px-1.5 py-0.5 rounded">
                      {statusJobs.length}
                    </span>
                  </div>
                  <div className="bg-surface-muted/50 rounded-lg min-h-[400px] p-3 border border-dashed border-border space-y-2">
                    {statusJobs.length === 0 ? (
                      <div className="text-center text-xs text-fg-subtle pt-8">
                        No jobs
                      </div>
                    ) : (
                      statusJobs.map((job) => (
                        <Link
                          key={job.id}
                          href={`/ops/jobs/${job.id}`}
                          className="block"
                        >
                          <div className="bg-surface rounded-lg p-3 border border-border hover:shadow-md hover:border-signal transition-all cursor-pointer">
                            <div className="flex items-start justify-between mb-2">
                              <div className="flex-1">
                                <p className="text-xs font-mono font-semibold text-signal truncate" title={job.jobNumber}>
                                  {job.jobNumber}
                                </p>
                                <p className="text-xs font-semibold text-fg truncate">
                                  {job.builderName}
                                </p>
                                <p className="text-xs text-fg-muted truncate">
                                  {job.community || '—'}
                                </p>
                              </div>
                            </div>
                            <div className="space-y-1.5 text-xs">
                              {job.lotBlock && (
                              <div className="text-fg-muted">
                                <span className="font-medium">Lot:</span> {job.lotBlock}
                              </div>
                              )}
                              <div className="text-fg-muted truncate" title={job.jobAddress || ''}>
                                <span className="font-medium">Address:</span> {job.jobAddress || '—'}
                              </div>
                              {job.assignedPM && (
                                <div className="text-fg-muted">
                                  <span className="font-medium">PM:</span> {fullName(job.assignedPM)}
                                </div>
                              )}
                              {job.scheduledDate && (
                                <div className="text-fg-muted">
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
        <div className="bg-surface rounded-xl border overflow-hidden">
          {filteredJobs.length === 0 ? (
            <EmptyState
              icon={<Briefcase className="w-8 h-8 text-fg-subtle" />}
              title="No jobs to display"
              description={
                jobs.length === 0
                  ? 'Jobs are created when quotes are approved and converted to orders.'
                  : 'Try adjusting your search or filters.'
              }
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-surface-muted border-b">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-fg">
                      Job #
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-fg">
                      Builder
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-fg">
                      Community
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-fg">
                      Lot/Block
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-fg">
                      Address
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-fg">
                      PM
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-fg">
                      Scheduled
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-fg">
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
                        className="hover:bg-row-hover transition-colors"
                      >
                        <td className="px-4 py-3">
                          <DrillLink entity="job" id={job.id} className="text-sm font-mono font-medium">
                            {job.jobNumber}
                          </DrillLink>
                        </td>
                        <td className="px-4 py-3">
                          <DrillLink entity="job" id={job.id} className="text-sm font-medium">
                            {job.builderName}
                          </DrillLink>
                        </td>
                        <td className="px-4 py-3 text-sm text-fg-muted">
                          {job.community || '—'}
                        </td>
                        <td className="px-4 py-3 text-sm text-fg-muted">
                          {job.lotBlock || '—'}
                        </td>
                        <td className="px-4 py-3 text-sm text-fg-muted max-w-xs">
                          <DrillLink entity="job" id={job.id} className="truncate block">
                            {job.jobAddress || '—'}
                          </DrillLink>
                        </td>
                        <td className="px-4 py-3 text-sm text-fg-muted">
                          {fullName(job.assignedPM, '—')}
                        </td>
                        <td className="px-4 py-3 text-sm text-fg-muted">
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
            <div className="flex items-center justify-between px-4 py-3 border-t text-sm text-fg-muted">
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
      <div className="bg-surface rounded-xl border p-5">
        <h3 className="font-semibold text-fg mb-3">
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
        <p className="text-sm font-medium text-fg">{label}</p>
        <p className="text-xs text-fg-muted mt-1">{description}</p>
      </div>
    </div>
  )
}
