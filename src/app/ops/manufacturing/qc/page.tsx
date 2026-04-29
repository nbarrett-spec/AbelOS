'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import Link from 'next/link'
import { Factory, ClipboardCheck } from 'lucide-react'
import EmptyState from '@/components/ui/EmptyState'
import PageHeader from '@/components/ui/PageHeader'
import { Badge, getStatusBadgeVariant } from '@/components/ui/Badge'

const QC_TYPES = [
  { key: 'PRE_PRODUCTION', label: 'Pre-Production' },
  { key: 'IN_PROCESS', label: 'In Process' },
  { key: 'FINAL_UNIT', label: 'Final Unit' },
  { key: 'PRE_DELIVERY', label: 'Pre-Delivery' },
  { key: 'POST_INSTALL', label: 'Post-Install' },
]

// Active (non-terminal) job statuses used by the modal's job-search dropdown.
// Matches the server-side ACTIVE_JOB_STATUSES in /api/ops/manufacturing/qc.
// Excludes terminal statuses COMPLETE / INVOICED / CLOSED. The Job-status
// enum has no CANCELLED or ON_HOLD value.
const ACTIVE_JOB_STATUSES = [
  'CREATED',
  'READINESS_CHECK',
  'MATERIALS_LOCKED',
  'IN_PRODUCTION',
  'STAGED',
  'LOADED',
  'IN_TRANSIT',
  'DELIVERED',
  'INSTALLING',
  'PUNCH_LIST',
].join(',')

interface QualityCheck {
  id: string
  checkType: string
  result: string
  notes: string | null
  defectCodes: string[]
  inspector: {
    firstName: string
    lastName: string
  }
  job: {
    id: string
    jobNumber: string
    builderName: string
    jobAddress?: string | null
  } | null
  createdAt: string
}

interface ApiResponse {
  checks: QualityCheck[]
  total: number
  stats: {
    passRate: number
    failRate: number
    conditionalPassRate: number
    commonDefects: Record<string, number>
  }
}

interface PendingJob {
  id: string
  jobNumber: string
  builderName: string
  jobAddress: string | null
  community: string | null
  jobType: string | null
  scopeType: string | null
  status: string
  scheduledDate: string | null
}

type PendingSortKey = 'jobNumber' | 'builderName' | 'jobAddress' | 'community' | 'jobType' | 'scheduledDate'

export default function QualityControlPage() {
  const [checks, setChecks] = useState<QualityCheck[]>([])
  const [stats, setStats] = useState<ApiResponse['stats'] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeFilter, setActiveFilter] = useState('ALL')
  const [searchQuery, setSearchQuery] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false)

  // Pending-QC queue state
  const [pending, setPending] = useState<PendingJob[]>([])
  const [pendingLoading, setPendingLoading] = useState(true)
  const [pendingSortKey, setPendingSortKey] = useState<PendingSortKey>('scheduledDate')
  const [pendingSortDir, setPendingSortDir] = useState<'asc' | 'desc'>('asc')

  // Prefilled job id for the modal when launched from the queue's row action.
  const [prefillJobId, setPrefillJobId] = useState<string | null>(null)

  // Debounce searchInput → searchQuery
  useEffect(() => {
    const t = setTimeout(() => setSearchQuery(searchInput.trim()), 300)
    return () => clearTimeout(t)
  }, [searchInput])

  const fetchChecks = useCallback(async () => {
    try {
      setLoading(true)
      const url = searchQuery
        ? `/api/ops/manufacturing/qc?search=${encodeURIComponent(searchQuery)}`
        : '/api/ops/manufacturing/qc'
      const response = await fetch(url)
      if (!response.ok) {
        throw new Error('Failed to fetch quality checks')
      }
      const data: ApiResponse = await response.json()
      setChecks(data.checks || [])
      setStats(data.stats || null)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setLoading(false)
    }
  }, [searchQuery])

  const fetchPending = useCallback(async () => {
    try {
      setPendingLoading(true)
      const res = await fetch('/api/ops/manufacturing/qc?queue=pending')
      if (!res.ok) throw new Error('Failed to load pending queue')
      const data = await res.json()
      setPending(data.pending || [])
    } catch {
      // Non-fatal — keep page usable even if the queue fails.
      setPending([])
    } finally {
      setPendingLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchChecks()
  }, [fetchChecks])

  useEffect(() => {
    fetchPending()
  }, [fetchPending])

  const filteredChecks = checks.filter(
    (check) => activeFilter === 'ALL' || check.checkType === activeFilter
  )

  const passCount = checks.filter((c) => c.result === 'PASS').length
  const failCount = checks.filter((c) => c.result === 'FAIL').length
  const conditionalCount = checks.filter((c) => c.result === 'CONDITIONAL_PASS').length
  const passRate = checks.length > 0 ? (passCount / checks.length) * 100 : 0

  const sortedPending = useMemo(() => {
    const dirMul = pendingSortDir === 'asc' ? 1 : -1
    const arr = [...pending]
    arr.sort((a, b) => {
      const av = (a[pendingSortKey] as string | null) ?? ''
      const bv = (b[pendingSortKey] as string | null) ?? ''
      if (pendingSortKey === 'scheduledDate') {
        const at = av ? new Date(av).getTime() : Number.POSITIVE_INFINITY
        const bt = bv ? new Date(bv).getTime() : Number.POSITIVE_INFINITY
        return (at - bt) * dirMul
      }
      return av.localeCompare(bv) * dirMul
    })
    return arr
  }, [pending, pendingSortKey, pendingSortDir])

  const togglePendingSort = (key: PendingSortKey) => {
    if (pendingSortKey === key) {
      setPendingSortDir(pendingSortDir === 'asc' ? 'desc' : 'asc')
    } else {
      setPendingSortKey(key)
      setPendingSortDir('asc')
    }
  }

  const handleStartCheckForJob = (jobId: string) => {
    setPrefillJobId(jobId)
    setIsCreateModalOpen(true)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-[#0f2a3e]" />
          <p className="mt-4 text-fg-muted">Loading quality checks...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Quality Control"
        description="Track inspections and quality metrics across manufacturing stages"
        actions={
          <>
            <button
              onClick={() => {
                setPrefillJobId(null)
                setIsCreateModalOpen(true)
              }}
              className="px-3 py-1.5 min-h-[44px] text-sm bg-[#0f2a3e] text-white rounded-lg hover:bg-[#0a1a28] transition-colors"
            >
              + New QC Check
            </button>
            <Link
              href="/ops/manufacturing"
              className="px-3 py-1.5 min-h-[44px] inline-flex items-center text-sm text-fg-muted bg-gray-100 rounded-lg hover:bg-surface-muted"
            >
              Dashboard
            </Link>
          </>
        }
      />

      {/* Error message */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700">
          Error loading checks: {error}
        </div>
      )}

      {/* QC Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <MetricCard
          label="Total Checks"
          value={checks.length}
          icon="📊"
          color="bg-blue-50 border-blue-200"
          textColor="text-blue-700"
        />
        <MetricCard
          label="Pass Rate"
          value={`${Math.round(passRate)}%`}
          icon="✅"
          color="bg-green-50 border-green-200"
          textColor="text-green-700"
        />
        <MetricCard
          label="Failures"
          value={failCount}
          icon="❌"
          color="bg-red-50 border-red-200"
          textColor="text-red-700"
        />
        <MetricCard
          label="Conditional Pass"
          value={conditionalCount}
          icon="⚠️"
          color="bg-yellow-50 border-yellow-200"
          textColor="text-yellow-700"
        />
      </div>

      {/* Jobs Pending QC queue (above search) */}
      <div className="bg-white rounded-xl border overflow-hidden">
        <div className="px-4 py-3 border-b flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1">
          <div className="flex items-center gap-2">
            <ClipboardCheck className="w-4 h-4 text-fg-muted" />
            <h2 className="text-sm font-semibold text-fg">Jobs Pending QC</h2>
            <span className="px-2 py-0.5 rounded bg-gray-100 text-sm text-fg-muted">
              {pending.length}
            </span>
          </div>
          <p className="text-sm text-fg-subtle">
            STAGED or IN_PRODUCTION jobs without a PASS QC check
          </p>
        </div>
        {pendingLoading ? (
          <div className="px-4 py-6 text-sm text-fg-muted">Loading queue...</div>
        ) : sortedPending.length === 0 ? (
          <EmptyState
            icon={<ClipboardCheck className="w-8 h-8 text-fg-subtle" />}
            title="No jobs pending QC"
            description="Every staged or in-production job has a passing QC check."
          />
        ) : (
          <>
            {/* Desktop table view */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 border-b">
                  <tr>
                    <SortableTh
                      label="Job"
                      active={pendingSortKey === 'jobNumber'}
                      dir={pendingSortDir}
                      onClick={() => togglePendingSort('jobNumber')}
                    />
                    <SortableTh
                      label="Builder"
                      active={pendingSortKey === 'builderName'}
                      dir={pendingSortDir}
                      onClick={() => togglePendingSort('builderName')}
                    />
                    <SortableTh
                      label="Address"
                      active={pendingSortKey === 'jobAddress'}
                      dir={pendingSortDir}
                      onClick={() => togglePendingSort('jobAddress')}
                    />
                    <SortableTh
                      label="Community"
                      active={pendingSortKey === 'community'}
                      dir={pendingSortDir}
                      onClick={() => togglePendingSort('community')}
                    />
                    <SortableTh
                      label="Type"
                      active={pendingSortKey === 'jobType'}
                      dir={pendingSortDir}
                      onClick={() => togglePendingSort('jobType')}
                    />
                    <SortableTh
                      label="Scheduled"
                      active={pendingSortKey === 'scheduledDate'}
                      dir={pendingSortDir}
                      onClick={() => togglePendingSort('scheduledDate')}
                    />
                    <th className="px-4 py-3 text-left text-sm font-semibold text-fg-muted">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {sortedPending.map((job) => (
                    <tr key={job.id} className="hover:bg-row-hover">
                      <td className="px-4 py-3 text-sm">
                        <Link
                          href={`/ops/jobs/${job.id}`}
                          className="text-[#0f2a3e] hover:underline font-medium"
                        >
                          {job.jobNumber}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-sm text-fg-muted">{job.builderName || '—'}</td>
                      <td className="px-4 py-3 text-sm text-fg-muted">{job.jobAddress || '—'}</td>
                      <td className="px-4 py-3 text-sm text-fg-muted">{job.community || '—'}</td>
                      <td className="px-4 py-3 text-sm text-fg-muted">{job.jobType || '—'}</td>
                      <td className="px-4 py-3 text-sm text-fg-muted">
                        {job.scheduledDate
                          ? new Date(job.scheduledDate).toLocaleDateString()
                          : '—'}
                      </td>
                      <td className="px-4 py-3 text-sm">
                        <button
                          onClick={() => handleStartCheckForJob(job.id)}
                          className="px-3 py-1.5 min-h-[44px] text-sm rounded-lg bg-[#0f2a3e] text-white hover:bg-[#0a1a28]"
                        >
                          Start QC Check
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile card view */}
            <div className="md:hidden divide-y">
              {sortedPending.map((job) => (
                <div key={job.id} className="px-4 py-3 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <Link
                      href={`/ops/jobs/${job.id}`}
                      className="text-[#0f2a3e] hover:underline font-medium text-base"
                    >
                      {job.jobNumber}
                    </Link>
                    <span className="text-sm text-fg-muted">
                      {job.scheduledDate
                        ? new Date(job.scheduledDate).toLocaleDateString()
                        : '—'}
                    </span>
                  </div>
                  <div className="text-sm text-fg-muted space-y-0.5">
                    <div>{job.builderName || '—'}</div>
                    <div>{job.jobAddress || '—'}</div>
                    {job.community && <div>{job.community}</div>}
                    {job.jobType && <div className="text-fg-subtle">{job.jobType}</div>}
                  </div>
                  <button
                    onClick={() => handleStartCheckForJob(job.id)}
                    className="w-full px-3 py-2 min-h-[44px] text-sm rounded-lg bg-[#0f2a3e] text-white hover:bg-[#0a1a28]"
                  >
                    Start QC Check
                  </button>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Search bar — queries job number AND job address */}
      <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
        <input
          type="search"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Search QC checks by job number or address..."
          className="flex-1 px-3 py-2 min-h-[44px] border border-border rounded-lg text-base sm:text-sm bg-white focus:ring-2 focus:ring-[#0f2a3e]/20 focus:outline-none"
        />
        {searchQuery && (
          <button
            onClick={() => setSearchInput('')}
            className="px-3 py-2 min-h-[44px] text-sm rounded-lg border border-border bg-white text-fg-muted hover:bg-row-hover"
          >
            Clear
          </button>
        )}
      </div>

      {/* Type filter pills */}
      <div className="flex gap-2 flex-wrap">
        <button
          onClick={() => setActiveFilter('ALL')}
          className={`px-3 py-2 min-h-[44px] text-sm rounded-full border transition-colors ${
            activeFilter === 'ALL'
              ? 'bg-[#0f2a3e] text-white border-transparent'
              : 'text-fg-muted border-border hover:border-border-strong bg-white'
          }`}
        >
          All Checks ({checks.length})
        </button>
        {QC_TYPES.map((type) => {
          const typeCount = checks.filter((c) => c.checkType === type.key).length
          return (
            <button
              key={type.key}
              onClick={() => setActiveFilter(type.key)}
              className={`px-3 py-2 min-h-[44px] text-sm rounded-full border transition-colors ${
                activeFilter === type.key
                  ? 'bg-[#0f2a3e] text-white border-transparent'
                  : 'text-fg-muted border-border hover:border-border-strong bg-white'
              }`}
            >
              {type.label} ({typeCount})
            </button>
          )
        })}
      </div>

      {/* QC Checks Table */}
      <div className="bg-white rounded-xl border overflow-hidden">
        {filteredChecks.length === 0 ? (
          <EmptyState
            icon={<Factory className="w-8 h-8 text-fg-subtle" />}
            title="No QC checks to display"
            description={
              searchQuery
                ? `No checks match "${searchQuery}". Try a different search.`
                : 'No quality checks recorded for the current filter.'
            }
          />
        ) : (
          <>
            {/* Desktop table view */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 border-b">
                  <tr>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-fg-muted">Job</th>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-fg-muted">Type</th>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-fg-muted">Inspector</th>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-fg-muted">Result</th>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-fg-muted">Defects</th>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-fg-muted">Notes</th>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-fg-muted">Date</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {filteredChecks.map((check) => (
                    <tr key={check.id} className="hover:bg-row-hover">
                      <td className="px-4 py-3 text-sm">
                        {check.job ? (
                          <Link
                            href={`/ops/jobs/${check.job.id}`}
                            className="text-[#0f2a3e] hover:underline font-medium"
                          >
                            {check.job.jobNumber}
                          </Link>
                        ) : (
                          <span className="text-fg-subtle">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm text-fg-muted">
                        {QC_TYPES.find((t) => t.key === check.checkType)?.label || check.checkType}
                      </td>
                      <td className="px-4 py-3 text-sm text-fg-muted">
                        {check.inspector.firstName} {check.inspector.lastName}
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant={getStatusBadgeVariant(check.result)} size="sm">
                          {check.result}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-sm text-fg-muted">
                        {check.defectCodes.length > 0 ? (
                          <div className="flex gap-1 flex-wrap">
                            {check.defectCodes.slice(0, 2).map((code) => (
                              <span
                                key={code}
                                className="px-2 py-0.5 rounded text-sm bg-gray-100 text-fg-muted"
                              >
                                {code}
                              </span>
                            ))}
                            {check.defectCodes.length > 2 && (
                              <span className="px-2 py-0.5 text-sm text-fg-muted">
                                +{check.defectCodes.length - 2}
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="text-fg-subtle">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm text-fg-muted max-w-xs truncate">
                        {check.notes || '—'}
                      </td>
                      <td className="px-4 py-3 text-sm text-fg-muted">
                        {new Date(check.createdAt).toLocaleDateString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile card view */}
            <div className="md:hidden divide-y">
              {filteredChecks.map((check) => (
                <div key={check.id} className="px-4 py-3 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    {check.job ? (
                      <Link
                        href={`/ops/jobs/${check.job.id}`}
                        className="text-[#0f2a3e] hover:underline font-medium text-base"
                      >
                        {check.job.jobNumber}
                      </Link>
                    ) : (
                      <span className="text-fg-subtle text-base">—</span>
                    )}
                    <Badge variant={getStatusBadgeVariant(check.result)} size="sm">
                      {check.result}
                    </Badge>
                  </div>
                  <div className="text-sm text-fg-muted space-y-0.5">
                    <div>
                      <span className="text-fg-subtle">Type:</span>{' '}
                      {QC_TYPES.find((t) => t.key === check.checkType)?.label || check.checkType}
                    </div>
                    <div>
                      <span className="text-fg-subtle">Inspector:</span>{' '}
                      {check.inspector.firstName} {check.inspector.lastName}
                    </div>
                    <div>
                      <span className="text-fg-subtle">Date:</span>{' '}
                      {new Date(check.createdAt).toLocaleDateString()}
                    </div>
                  </div>
                  {check.defectCodes.length > 0 && (
                    <div className="flex gap-1 flex-wrap">
                      {check.defectCodes.map((code) => (
                        <span
                          key={code}
                          className="px-2 py-0.5 rounded text-sm bg-gray-100 text-fg-muted"
                        >
                          {code}
                        </span>
                      ))}
                    </div>
                  )}
                  {check.notes && (
                    <div className="text-sm text-fg-muted">{check.notes}</div>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Common Defects */}
      {stats && stats.commonDefects && Object.keys(stats.commonDefects).length > 0 && (
        <div className="bg-white rounded-xl border p-6">
          <h2 className="text-lg font-semibold text-fg mb-4">Common Defect Codes</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {Object.entries(stats.commonDefects)
              .sort(([, a], [, b]) => b - a)
              .map(([code, count]) => (
                <div key={code} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                  <span className="font-mono font-medium text-fg">{code}</span>
                  <span className="px-2 py-1 rounded bg-red-100 text-red-700 text-sm font-semibold">
                    {count}
                  </span>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* Create QC Modal */}
      {isCreateModalOpen && (
        <CreateQCModal
          initialJobId={prefillJobId}
          onClose={() => {
            setIsCreateModalOpen(false)
            setPrefillJobId(null)
          }}
          onSuccess={() => {
            setIsCreateModalOpen(false)
            setPrefillJobId(null)
            fetchChecks()
            fetchPending()
          }}
        />
      )}
    </div>
  )
}

function MetricCard({
  label,
  value,
  icon,
  color,
  textColor,
}: {
  label: string
  value: string | number
  icon: string
  color: string
  textColor: string
}) {
  return (
    <div className={`${color} border rounded-xl p-4`}>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-fg-muted mb-1">{label}</p>
          <p className={`text-2xl font-semibold ${textColor}`}>{value}</p>
        </div>
        <div className="text-3xl">{icon}</div>
      </div>
    </div>
  )
}

function SortableTh({
  label,
  active,
  dir,
  onClick,
}: {
  label: string
  active: boolean
  dir: 'asc' | 'desc'
  onClick: () => void
}) {
  return (
    <th
      onClick={onClick}
      className="px-4 py-3 text-left text-sm font-semibold text-fg-muted cursor-pointer select-none hover:bg-row-hover"
    >
      <span className="inline-flex items-center gap-1">
        {label}
        {active && <span aria-hidden>{dir === 'asc' ? '↑' : '↓'}</span>}
      </span>
    </th>
  )
}

interface JobSearchResult {
  id: string
  jobNumber: string
  jobAddress?: string | null
  builderName?: string | null
  community?: string | null
  status?: string | null
}

function CreateQCModal({
  initialJobId,
  onClose,
  onSuccess,
}: {
  initialJobId?: string | null
  onClose: () => void
  onSuccess: () => void
}) {
  const [loading, setLoading] = useState(false)
  const [toast, setToast] = useState('')
  const [toastType, setToastType] = useState<'success' | 'error'>('success')

  // Job dropdown state
  const [jobSearchInput, setJobSearchInput] = useState('')
  const [jobResults, setJobResults] = useState<JobSearchResult[]>([])
  const [selectedJob, setSelectedJob] = useState<JobSearchResult | null>(null)
  const [jobsLoading, setJobsLoading] = useState(false)
  const [showJobDropdown, setShowJobDropdown] = useState(false)

  const [formData, setFormData] = useState({
    checkType: 'FINAL_UNIT',
    result: 'PASS',
    notes: '',
    defectCodes: '',
  })

  const showToast = (msg: string, type: 'success' | 'error' = 'success') => {
    setToast(msg)
    setToastType(type)
    setTimeout(() => setToast(''), 4000)
  }

  // Hydrate selectedJob from initialJobId (queue → modal flow). Show a
  // placeholder label immediately; user can still click "Change" to search.
  useEffect(() => {
    if (!initialJobId) return
    setSelectedJob({ id: initialJobId, jobNumber: 'Selected job' })
  }, [initialJobId])

  // Search-as-you-type for jobs (active statuses only).
  useEffect(() => {
    const q = jobSearchInput.trim()
    if (q.length < 2) {
      setJobResults([])
      return
    }
    const t = setTimeout(async () => {
      try {
        setJobsLoading(true)
        const res = await fetch(
          `/api/ops/jobs?search=${encodeURIComponent(q)}&limit=8&status=${ACTIVE_JOB_STATUSES}`
        )
        if (res.ok) {
          const d = await res.json()
          setJobResults(d.jobs || [])
        }
      } catch {
        // ignore
      } finally {
        setJobsLoading(false)
      }
    }, 250)
    return () => clearTimeout(t)
  }, [jobSearchInput])

  const handleSelectJob = (job: JobSearchResult) => {
    setSelectedJob(job)
    setJobSearchInput('')
    setJobResults([])
    setShowJobDropdown(false)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    try {
      const response = await fetch('/api/ops/manufacturing/qc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jobId: selectedJob?.id || null,
          checkType: formData.checkType,
          result: formData.result,
          notes: formData.notes,
          defectCodes: formData.defectCodes
            .split(',')
            .map((c) => c.trim())
            .filter((c) => c),
        }),
      })

      if (!response.ok) {
        // Surface API error message to the user instead of swallowing it.
        let detail = `HTTP ${response.status}`
        try {
          const data = await response.json()
          detail = data.error || data.detail || detail
        } catch {
          // body wasn't JSON — leave detail as the status code
        }
        throw new Error(detail)
      }

      showToast('Quality check created', 'success')
      // Brief delay so the success toast is visible before the modal closes.
      setTimeout(() => onSuccess(), 600)
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : 'Failed to create quality check',
        'error'
      )
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      {toast && (
        <div
          className={`fixed top-4 right-4 z-[60] px-4 py-2 rounded-lg shadow-lg text-sm text-white ${
            toastType === 'error' ? 'bg-red-600' : 'bg-[#0f2a3e]'
          }`}
        >
          {toast}
        </div>
      )}
      <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6 max-h-[90vh] overflow-y-auto">
        <h2 className="text-lg font-semibold text-fg mb-4">New Quality Check</h2>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Job search-as-you-type dropdown */}
          <div className="relative">
            <label className="block text-sm font-medium text-fg-muted mb-1">
              Job
            </label>
            {selectedJob ? (
              <div className="flex items-center justify-between px-3 py-2 min-h-[44px] border rounded-lg bg-gray-50">
                <div className="text-sm">
                  <div className="font-medium text-fg">{selectedJob.jobNumber}</div>
                  {selectedJob.jobAddress && (
                    <div className="text-sm text-fg-muted">{selectedJob.jobAddress}</div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedJob(null)
                    setJobSearchInput('')
                  }}
                  className="px-2 py-2 min-h-[44px] text-sm text-fg-muted hover:text-fg underline"
                >
                  Change
                </button>
              </div>
            ) : (
              <>
                <input
                  type="text"
                  value={jobSearchInput}
                  onChange={(e) => {
                    setJobSearchInput(e.target.value)
                    setShowJobDropdown(true)
                  }}
                  onFocus={() => setShowJobDropdown(true)}
                  placeholder="Search active jobs by number or address..."
                  className="w-full px-3 py-2 min-h-[44px] border rounded-lg text-base sm:text-sm focus:ring-2 focus:ring-[#0f2a3e]/20"
                />
                {showJobDropdown && jobSearchInput.trim().length >= 2 && (
                  <div className="absolute z-10 left-0 right-0 mt-1 bg-white border border-border rounded-lg shadow-lg max-h-60 overflow-auto">
                    {jobsLoading ? (
                      <div className="px-3 py-2 text-sm text-fg-muted">Searching...</div>
                    ) : jobResults.length === 0 ? (
                      <div className="px-3 py-2 text-sm text-fg-muted">
                        No active jobs match.
                      </div>
                    ) : (
                      jobResults.map((j) => (
                        <button
                          type="button"
                          key={j.id}
                          onClick={() => handleSelectJob(j)}
                          className="block w-full text-left px-3 py-3 min-h-[44px] hover:bg-row-hover text-sm"
                        >
                          <div className="font-medium text-fg">{j.jobNumber}</div>
                          <div className="text-sm text-fg-muted">
                            {j.jobAddress || '—'}
                            {j.builderName ? ` · ${j.builderName}` : ''}
                          </div>
                        </button>
                      ))
                    )}
                  </div>
                )}
                <p className="mt-1 text-sm text-fg-subtle">
                  Optional. Searches active (non-terminal) jobs only.
                </p>
              </>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-fg-muted mb-1">
              Check Type
            </label>
            <select
              value={formData.checkType}
              onChange={(e) => setFormData({ ...formData, checkType: e.target.value })}
              className="w-full px-3 py-2 min-h-[44px] border rounded-lg text-base sm:text-sm focus:ring-2 focus:ring-[#0f2a3e]/20"
            >
              {QC_TYPES.map((type) => (
                <option key={type.key} value={type.key}>
                  {type.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-fg-muted mb-1">
              Result
            </label>
            <select
              value={formData.result}
              onChange={(e) => setFormData({ ...formData, result: e.target.value })}
              className="w-full px-3 py-2 min-h-[44px] border rounded-lg text-base sm:text-sm focus:ring-2 focus:ring-[#0f2a3e]/20"
            >
              <option value="PASS">Pass</option>
              <option value="FAIL">Fail</option>
              <option value="CONDITIONAL_PASS">Conditional Pass</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-fg-muted mb-1">
              Defect Codes (comma-separated)
            </label>
            <input
              type="text"
              value={formData.defectCodes}
              onChange={(e) => setFormData({ ...formData, defectCodes: e.target.value })}
              placeholder="e.g., D001, D002"
              className="w-full px-3 py-2 min-h-[44px] border rounded-lg text-base sm:text-sm focus:ring-2 focus:ring-[#0f2a3e]/20"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-fg-muted mb-1">
              Photo (optional)
            </label>
            <input
              type="file"
              accept="image/*"
              capture="environment"
              className="w-full px-3 py-2 min-h-[44px] border rounded-lg text-base sm:text-sm bg-white file:mr-3 file:py-2 file:px-3 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-gray-100 file:text-fg-muted hover:file:bg-row-hover"
            />
            <p className="mt-1 text-sm text-fg-subtle">
              Capture defect or condition photo from device camera.
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-fg-muted mb-1">
              Notes
            </label>
            <textarea
              value={formData.notes}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              placeholder="Inspection notes..."
              className="w-full px-3 py-2 border rounded-lg text-base sm:text-sm focus:ring-2 focus:ring-[#0f2a3e]/20 resize-none"
              rows={3}
            />
          </div>

          <div className="flex gap-2 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 min-h-[44px] border rounded-lg text-sm font-medium text-fg-muted hover:bg-row-hover"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 px-4 py-2 min-h-[44px] bg-[#0f2a3e] text-white rounded-lg text-sm font-medium hover:bg-[#0a1a28] disabled:opacity-50"
            >
              {loading ? 'Creating...' : 'Create Check'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
