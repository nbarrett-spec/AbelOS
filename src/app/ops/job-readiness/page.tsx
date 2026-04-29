'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  PageHeader,
  Button,
  Card,
  Badge,
  Kbd,
  EmptyState,
  StatusDot,
} from '@/components/ui'
import { useToast } from '@/contexts/ToastContext'
import {
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  AlertCircle,
  CheckCircle,
  AlertTriangle,
  ArrowRight,
} from 'lucide-react'

// ──────────────────────────────────────────────────────────────────────────
// Job Readiness Board (GAP-13) — Material status for upcoming jobs,
// with per-line ATP status and action buttons for RED items.
// ──────────────────────────────────────────────────────────────────────────

type MaterialStatus = 'RED' | 'AMBER' | 'GREEN' | 'UNKNOWN'

interface MaterialLine {
  sku: string | null
  productName: string | null
  required: number
  allocated: number
  available: number
  incoming: number
  shortfall: number
  status: 'RED' | 'AMBER' | 'GREEN'
  recommendation: string
}

interface JobReadinessCard {
  jobId: string
  jobNumber: string
  builderName: string
  community: string | null
  lot: string | null
  address: string | null
  scheduledDate: string
  daysUntilScheduled: number
  assignedPmId: string | null
  assignedPmName: string | null
  overallStatus: MaterialStatus
  lines: MaterialLine[]
  actionNeeded: string
}

interface JobReadinessResponse {
  asOf: string
  lookAheadDays: number
  windowStart: string
  windowEnd: string
  totalJobsInWindow: number
  totalJobsReturned: number
  filters: Record<string, any>
  counts: {
    red: number
    amber: number
    green: number
    unknown: number
  }
  jobs: JobReadinessCard[]
}

const STATUS_CONFIG: Record<MaterialStatus, { color: string; dotTone: any; label: string; icon: any }> = {
  RED: {
    color: 'bg-red-50 border-red-200',
    dotTone: 'alert',
    label: 'Action Required',
    icon: AlertCircle,
  },
  AMBER: {
    color: 'bg-amber-50 border-amber-200',
    dotTone: 'active',
    label: 'Monitor',
    icon: AlertTriangle,
  },
  GREEN: {
    color: 'bg-green-50 border-green-200',
    dotTone: 'success',
    label: 'On Track',
    icon: CheckCircle,
  },
  UNKNOWN: {
    color: 'bg-gray-50 border-gray-200',
    dotTone: 'offline',
    label: 'Pending',
    icon: AlertCircle,
  },
}

const LINE_STATUS_CONFIG: Record<string, { textColor: string; bgColor: string }> = {
  RED: { textColor: 'text-red-700', bgColor: 'bg-red-100' },
  AMBER: { textColor: 'text-amber-700', bgColor: 'bg-amber-100' },
  GREEN: { textColor: 'text-green-700', bgColor: 'bg-green-100' },
}

export default function JobReadinessPage() {
  const [data, setData] = useState<JobReadinessResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [lookaheadDays, setLookaheadDays] = useState(14)
  const [selectedPmId, setSelectedPmId] = useState<string | null>(null)
  const [selectedStatus, setSelectedStatus] = useState<MaterialStatus | null>(null)
  const [expandedJobId, setExpandedJobId] = useState<string | null>(null)
  const { addToast } = useToast()

  // ── Fetch job readiness data ────────────────────────────────────────────
  const fetchData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({
        days: String(lookaheadDays),
        ...(selectedPmId && { pmId: selectedPmId }),
        ...(selectedStatus && { status: selectedStatus }),
      })
      const res = await fetch(`/api/ops/job-readiness?${params.toString()}`, {
        cache: 'no-store',
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || `HTTP ${res.status}`)
      }
      const json: JobReadinessResponse = await res.json()
      setData(json)
    } catch (err: any) {
      setError(err?.message ?? 'Failed to load job readiness')
      addToast({
        type: 'error',
        title: 'Failed to load',
        message: err?.message ?? 'Could not fetch job readiness data',
      })
    } finally {
      setLoading(false)
    }
  }, [lookaheadDays, selectedPmId, selectedStatus, addToast])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  // Auto-refresh every 60s
  useEffect(() => {
    const id = setInterval(() => {
      fetchData()
    }, 60_000)
    return () => clearInterval(id)
  }, [fetchData])

  // Get unique PMs from current data
  const uniquePMs = useMemo(() => {
    if (!data) return []
    const seen = new Map<string, string>()
    for (const job of data.jobs) {
      if (job.assignedPmId && job.assignedPmName) {
        seen.set(job.assignedPmId, job.assignedPmName)
      }
    }
    return Array.from(seen.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [data])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading job readiness...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-8">
        <PageHeader
          title="Job Readiness Board"
          description="Material status for upcoming jobs"
        />
        <Card className="mt-6 border-red-200 bg-red-50">
          <div className="flex items-start gap-3 p-4">
            <AlertCircle className="h-5 w-5 text-red-600 mt-0.5 flex-shrink-0" />
            <div>
              <p className="font-semibold text-red-900">Error loading data</p>
              <p className="text-sm text-red-700 mt-1">{error}</p>
            </div>
          </div>
        </Card>
      </div>
    )
  }

  if (!data || data.totalJobsReturned === 0) {
    return (
      <div className="p-8">
        <PageHeader
          title="Job Readiness Board"
          description="Material status for upcoming jobs"
        />
        <div className="mt-6">
          <EmptyState
            icon="📅"
            title="No jobs in readiness window"
            description={`No active jobs scheduled within the next ${lookaheadDays} days${
              selectedStatus ? ` with status ${selectedStatus}` : ''
            }${selectedPmId ? ' for the selected PM' : ''}.`}
          />
        </div>
      </div>
    )
  }

  return (
    <div className="p-8 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <PageHeader
            title="Job Readiness Board"
            description="Material status for upcoming jobs with action items"
          />
        </div>
        <Button
          onClick={fetchData}
          variant="outline"
          size="sm"
          className="gap-2"
        >
          <RefreshCw className="h-4 w-4" />
          Refresh
        </Button>
      </div>

      {/* Filter Bar */}
      <Card className="p-4 bg-gray-50 border-gray-200">
        <div className="flex flex-wrap items-center gap-4">
          {/* Days Lookahead */}
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-gray-700">Look Ahead:</span>
            <div className="flex gap-1">
              {[7, 14, 30].map((days) => (
                <button
                  key={days}
                  onClick={() => setLookaheadDays(days)}
                  className={`px-3 py-1.5 text-sm rounded border transition-colors ${
                    lookaheadDays === days
                      ? 'bg-blue-500 text-white border-blue-500'
                      : 'bg-white text-gray-700 border-gray-300 hover:border-gray-400'
                  }`}
                >
                  {days}d
                </button>
              ))}
            </div>
          </div>

          {/* Status Filter */}
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-gray-700">Status:</span>
            <div className="flex gap-1">
              {[null, 'RED', 'AMBER', 'GREEN'].map((status) => (
                <button
                  key={status || 'all'}
                  onClick={() => setSelectedStatus(status as MaterialStatus | null)}
                  className={`px-3 py-1.5 text-sm rounded border transition-colors ${
                    selectedStatus === status
                      ? 'bg-blue-500 text-white border-blue-500'
                      : 'bg-white text-gray-700 border-gray-300 hover:border-gray-400'
                  }`}
                >
                  {status ? status : 'All'}
                </button>
              ))}
            </div>
          </div>

          {/* PM Filter */}
          {uniquePMs.length > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-gray-700">PM:</span>
              <select
                value={selectedPmId || ''}
                onChange={(e) => setSelectedPmId(e.target.value || null)}
                className="px-3 py-1.5 text-sm rounded border border-gray-300 bg-white text-gray-700"
              >
                <option value="">All</option>
                {uniquePMs.map(({ id, name }) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      </Card>

      {/* Status Summary */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: 'RED (Critical)', count: data.counts.red, color: 'text-red-600' },
          { label: 'AMBER (Monitor)', count: data.counts.amber, color: 'text-amber-600' },
          { label: 'GREEN (On Track)', count: data.counts.green, color: 'text-green-600' },
          { label: 'UNKNOWN (Pending)', count: data.counts.unknown, color: 'text-gray-600' },
        ].map(({ label, count, color }) => (
          <Card key={label} className="p-4">
            <p className={`text-sm font-medium ${color}`}>{label}</p>
            <p className="text-2xl font-bold text-gray-900">{count}</p>
          </Card>
        ))}
      </div>

      {/* Job Cards */}
      <div className="space-y-4">
        {data.jobs.map((job) => {
          const config = STATUS_CONFIG[job.overallStatus]
          const isExpanded = expandedJobId === job.jobId
          const redLineCount = job.lines.filter((l) => l.status === 'RED').length

          return (
            <Card key={job.jobId} className={`${config.color} border transition-all`}>
              {/* Job Header */}
              <div
                className="p-4 cursor-pointer hover:bg-opacity-75 transition-opacity"
                onClick={() =>
                  setExpandedJobId(isExpanded ? null : job.jobId)
                }
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 mb-2">
                      <StatusDot tone={config.dotTone} />
                      <div>
                        <h3 className="font-semibold text-gray-900">
                          {job.jobNumber} • {job.builderName}
                        </h3>
                        <p className="text-sm text-gray-600">
                          {job.community && `${job.community}`}
                          {job.lot && ` • Lot ${job.lot}`}
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Right side: Status & Date */}
                  <div className="text-right ml-4">
                    <Badge className="mb-2">{config.label}</Badge>
                    <p className="text-sm font-medium text-gray-900">
                      {job.scheduledDate}
                    </p>
                    <p className="text-xs text-gray-600">
                      {job.daysUntilScheduled === 0
                        ? 'Today'
                        : job.daysUntilScheduled === 1
                          ? 'Tomorrow'
                          : `in ${job.daysUntilScheduled}d`}
                    </p>
                  </div>
                </div>

                {/* Summary */}
                <div className="flex items-center justify-between mt-3 pt-3 border-t border-current border-opacity-20">
                  <div className="flex items-center gap-4 text-sm">
                    {job.assignedPmName && (
                      <span className="text-gray-700">
                        <span className="font-medium">PM:</span> {job.assignedPmName}
                      </span>
                    )}
                    {job.actionNeeded && (
                      <span className="text-gray-700 font-medium">
                        {job.actionNeeded}
                      </span>
                    )}
                  </div>
                  <ChevronRight
                    className={`h-5 w-5 text-gray-400 transition-transform ${
                      isExpanded ? 'rotate-90' : ''
                    }`}
                  />
                </div>
              </div>

              {/* Expanded Material Lines */}
              {isExpanded && job.lines.length > 0 && (
                <div className="border-t border-current border-opacity-20 p-4 bg-white bg-opacity-50">
                  <p className="text-sm font-semibold text-gray-900 mb-3">
                    Material Status ({job.lines.length} items)
                  </p>
                  <div className="space-y-2">
                    {job.lines.map((line, idx) => {
                      const lineConfig = LINE_STATUS_CONFIG[line.status]
                      return (
                        <div
                          key={idx}
                          className={`p-3 rounded border ${lineConfig.bgColor} border-opacity-50`}
                        >
                          <div className="flex items-start justify-between gap-4">
                            <div className="flex-1 min-w-0">
                              <p className={`text-sm font-medium ${lineConfig.textColor}`}>
                                {line.sku || 'N/A'} • {line.productName || 'Unknown'}
                              </p>
                              <div className="text-xs text-gray-600 mt-1 space-y-1">
                                <div>
                                  <span className="font-medium">Required:</span> {line.required}{' '}
                                  | <span className="font-medium">Allocated:</span> {line.allocated}{' '}
                                  | <span className="font-medium">Available:</span> {line.available}
                                </div>
                                <div>
                                  <span className="font-medium">Incoming:</span> {line.incoming} |{' '}
                                  <span className="font-medium">Shortfall:</span> {line.shortfall}
                                </div>
                              </div>
                            </div>
                            {line.status === 'RED' && (
                              <div className="flex gap-2 flex-shrink-0">
                                <a
                                  href="/ops/purchasing"
                                  className="inline-flex items-center px-2 py-1 text-xs font-medium text-red-600 border border-red-300 rounded hover:bg-red-50 transition-colors"
                                >
                                  Create PO
                                </a>
                              </div>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* Expanded No Lines */}
              {isExpanded && job.lines.length === 0 && (
                <div className="border-t border-current border-opacity-20 p-4 bg-white bg-opacity-50">
                  <p className="text-sm text-gray-600">
                    No material data available. Check job order status.
                  </p>
                </div>
              )}
            </Card>
          )
        })}
      </div>

      {/* Footer timestamp */}
      <div className="text-xs text-gray-500 text-center pt-4 border-t border-gray-200">
        Last updated: {new Date(data.asOf).toLocaleTimeString()}
      </div>
    </div>
  )
}
