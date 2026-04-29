'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { AlertTriangle, ClipboardList, PlayCircle, RefreshCcw, ArrowLeft } from 'lucide-react'
import { useToast } from '@/contexts/ToastContext'
import EmptyState from '@/components/ui/EmptyState'

// ──────────────────────────────────────────────────────────────────────────
// Rework Queue
//
// Surfaces jobs that failed QC and need rework. Wires to:
//   • /api/ops/qc-briefing      → failed-job list + summary counts
//   • /api/ops/manufacturing/qc → per-check defect codes / address (richer)
// Both endpoints already exist; this page does NOT add API routes or change
// schema. The schema enum addition (REWORK status) is out of scope — we
// derive a local rework workflow state ("pending" / "in_progress" / "complete")
// from latest failure plus a localStorage marker so PMs can track progress
// inside this session and across reloads.
//
// TODO: Replace localStorage rework state with a real ReworkStatus model or
// JobRework table once the schema sweep lands. See M-9 follow-up.
// ──────────────────────────────────────────────────────────────────────────

interface FailedJobBriefing {
  id: string
  jobNumber: string
  builderName: string
  failedAt: string
  defectNotes: string | null
  status: string
}

interface QCBriefingResponse {
  failedJobs?: FailedJobBriefing[]
  summary?: {
    failedAwaitingRework?: number
  }
}

interface QCFailCheck {
  id: string
  checkType: string
  result: string
  notes: string | null
  defectCodes: string[]
  createdAt: string
  job: {
    id: string
    jobNumber: string
    builderName: string
    jobAddress: string | null
  } | null
}

interface QCFailResponse {
  checks?: QCFailCheck[]
}

type ReworkState = 'pending' | 'in_progress' | 'complete'

interface ReworkRow {
  id: string
  jobNumber: string
  builderName: string
  community: string | null
  failedAt: string
  defectNotes: string | null
  defectCodes: string[]
  jobStatus: string
  reworkState: ReworkState
}

const STORAGE_KEY = 'abel.qc.reworkState.v1'

function loadLocalState(): Record<string, { state: ReworkState; updatedAt: string }> {
  if (typeof window === 'undefined') return {}
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function persistLocalState(map: Record<string, { state: ReworkState; updatedAt: string }>) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(map))
  } catch {
    /* ignore quota / private-mode failures */
  }
}

const STATE_PILL: Record<ReworkState, { label: string; cls: string }> = {
  pending: {
    label: 'Pending Rework',
    cls: 'bg-red-100 text-red-700 ring-1 ring-red-200',
  },
  in_progress: {
    label: 'Rework In Progress',
    cls: 'bg-amber-100 text-amber-800 ring-1 ring-amber-200',
  },
  complete: {
    label: 'Rework Complete',
    cls: 'bg-emerald-100 text-emerald-700 ring-1 ring-emerald-200',
  },
}

function formatDate(value: string | null | undefined): string {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

function formatRelative(value: string | null | undefined): string {
  if (!value) return ''
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  const diffMs = Date.now() - d.getTime()
  const diffDays = Math.floor(diffMs / 86_400_000)
  if (diffDays <= 0) return 'today'
  if (diffDays === 1) return '1 day ago'
  if (diffDays < 30) return `${diffDays} days ago`
  return ''
}

export default function QCReworkPage() {
  const router = useRouter()
  const { addToast } = useToast()

  const [reworkRows, setReworkRows] = useState<ReworkRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<'ALL' | ReworkState>('ALL')
  const [localState, setLocalState] = useState<
    Record<string, { state: ReworkState; updatedAt: string }>
  >({})
  const [refreshTick, setRefreshTick] = useState(0)

  // ── Load data ─────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      try {
        // Fire both requests in parallel. The briefing is the queue source of
        // truth; the manufacturing/qc fail list adds defect codes + address.
        const [briefingRes, failRes] = await Promise.all([
          fetch('/api/ops/qc-briefing').catch(() => null),
          fetch('/api/ops/manufacturing/qc?result=FAIL').catch(() => null),
        ])

        const briefing: QCBriefingResponse = briefingRes && briefingRes.ok
          ? await briefingRes.json().catch(() => ({}))
          : {}
        const failData: QCFailResponse = failRes && failRes.ok
          ? await failRes.json().catch(() => ({}))
          : {}

        if (cancelled) return

        const checks = failData.checks ?? []
        // Build per-job aggregate of defect codes + most recent address
        const checksByJob = new Map<
          string,
          { codes: Set<string>; address: string | null; latestAt: string }
        >()
        for (const c of checks) {
          if (!c.job?.id) continue
          const existing = checksByJob.get(c.job.id)
          if (existing) {
            for (const code of c.defectCodes ?? []) existing.codes.add(code)
            if (!existing.address && c.job.jobAddress) existing.address = c.job.jobAddress
            if (c.createdAt > existing.latestAt) existing.latestAt = c.createdAt
          } else {
            checksByJob.set(c.job.id, {
              codes: new Set<string>(c.defectCodes ?? []),
              address: c.job.jobAddress ?? null,
              latestAt: c.createdAt,
            })
          }
        }

        const stored = loadLocalState()

        const rows: ReworkRow[] = (briefing.failedJobs ?? []).map((j) => {
          const enriched = checksByJob.get(j.id)
          const local = stored[j.id]
          return {
            id: j.id,
            jobNumber: j.jobNumber,
            builderName: j.builderName,
            community: enriched?.address ?? null,
            failedAt: j.failedAt,
            defectNotes: j.defectNotes,
            defectCodes: enriched ? Array.from(enriched.codes) : [],
            jobStatus: j.status,
            reworkState: local?.state ?? 'pending',
          }
        })

        // Fall back to checks-only data if briefing was empty but we have
        // failed checks (graceful degradation).
        if (rows.length === 0 && checksByJob.size > 0) {
          checksByJob.forEach((v, jobId) => {
            const c = checks.find((x) => x.job?.id === jobId)
            if (!c?.job) return
            const local = stored[jobId]
            rows.push({
              id: jobId,
              jobNumber: c.job.jobNumber,
              builderName: c.job.builderName,
              community: v.address,
              failedAt: v.latestAt,
              defectNotes: c.notes,
              defectCodes: Array.from(v.codes),
              jobStatus: 'UNKNOWN',
              reworkState: local?.state ?? 'pending',
            })
          })
        }

        setReworkRows(rows)
        setLocalState(stored)
      } catch (e) {
        if (!cancelled) {
          console.error('Failed to load rework queue:', e)
          setError('Could not load the rework queue. Try refreshing.')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [refreshTick])

  // ── Counts ────────────────────────────────────────────────────────────
  const counts = useMemo(() => {
    const c = { total: reworkRows.length, pending: 0, in_progress: 0, complete: 0 }
    for (const r of reworkRows) c[r.reworkState] += 1
    return c
  }, [reworkRows])

  const visibleRows = useMemo(() => {
    if (filter === 'ALL') return reworkRows
    return reworkRows.filter((r) => r.reworkState === filter)
  }, [reworkRows, filter])

  // ── Mutate local rework state ─────────────────────────────────────────
  function setRowState(jobId: string, next: ReworkState) {
    // TODO: replace with real API write once a ReworkStatus / JobRework model
    // exists. For M-9 (UI-only) we record progress in localStorage so PMs
    // can mark items "started" / "complete" between page loads.
    const updated = {
      ...localState,
      [jobId]: { state: next, updatedAt: new Date().toISOString() },
    }
    setLocalState(updated)
    persistLocalState(updated)
    setReworkRows((prev) =>
      prev.map((r) => (r.id === jobId ? { ...r, reworkState: next } : r))
    )
    addToast({
      type: 'success',
      title: 'Rework status updated',
      message: `Marked ${next.replace('_', ' ')}.`,
    })
  }

  // ── Re-inspect: route to the QC entry flow for this job ───────────────
  async function handleReInspect(row: ReworkRow) {
    try {
      const res = await fetch('/api/ops/manufacturing/qc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jobId: row.id,
          checkType: 'FINAL_UNIT',
          result: 'PASS',
          notes: 'Re-inspection scheduled after rework',
        }),
      })
      if (res.ok) {
        addToast({
          type: 'success',
          title: 'Re-inspection logged',
          message: `Sent ${row.jobNumber} back to the QC queue.`,
        })
        // Mark complete locally — a passing re-inspection means rework done.
        setRowState(row.id, 'complete')
        router.push(`/ops/portal/qc/queue?jobId=${row.id}`)
      } else {
        addToast({
          type: 'error',
          title: 'Re-inspection failed',
          message: 'Could not log a re-inspection. Try again from the job page.',
        })
      }
    } catch (e) {
      console.error('Re-inspect error:', e)
      addToast({
        type: 'error',
        title: 'Error',
        message: 'Something went wrong scheduling the re-inspection.',
      })
    }
  }

  // ── Render ────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#C0392B]" />
      </div>
    )
  }

  return (
    <div className="space-y-4 sm:space-y-6 pb-20">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">Rework Queue</h1>
          <p className="text-gray-600 mt-1 text-sm">
            Jobs that failed QC and need re-inspection. Track progress here until
            the QC pass clears them.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setRefreshTick((t) => t + 1)}
            className="px-3 py-3 min-h-[48px] border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors text-sm font-medium flex items-center gap-2"
            aria-label="Refresh queue"
          >
            <RefreshCcw className="w-4 h-4" />
            Refresh
          </button>
          <Link
            href="/ops/portal/qc"
            className="px-4 py-3 min-h-[48px] border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors text-sm font-medium flex items-center justify-center gap-2"
          >
            <ArrowLeft className="w-4 h-4" />
            Back
          </Link>
        </div>
      </div>

      {/* Counts strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <CountCard
          label="Awaiting Rework"
          value={counts.total}
          accent="text-[#C0392B]"
          active={filter === 'ALL'}
          onClick={() => setFilter('ALL')}
        />
        <CountCard
          label="Pending"
          value={counts.pending}
          accent="text-red-700"
          active={filter === 'pending'}
          onClick={() => setFilter('pending')}
        />
        <CountCard
          label="In Progress"
          value={counts.in_progress}
          accent="text-amber-700"
          active={filter === 'in_progress'}
          onClick={() => setFilter('in_progress')}
        />
        <CountCard
          label="Complete"
          value={counts.complete}
          accent="text-emerald-700"
          active={filter === 'complete'}
          onClick={() => setFilter('complete')}
        />
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-800 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <div>{error}</div>
        </div>
      )}

      {/* Queue */}
      <div className="bg-white rounded-xl border p-4 sm:p-6">
        {reworkRows.length === 0 ? (
          <EmptyState
            icon="shield"
            title="No rework needed"
            description="No QC failures are currently open. New failures will appear here automatically."
            secondaryAction={{ label: 'Open QC dashboard', href: '/ops/portal/qc' }}
          />
        ) : visibleRows.length === 0 ? (
          <EmptyState
            icon="inbox"
            title={`No items in "${filter.replace('_', ' ')}"`}
            description="Try clearing the filter to see the rest of the queue."
            secondaryAction={{ label: 'Show all', onClick: () => setFilter('ALL') }}
            size="compact"
          />
        ) : (
          <>
            {/* Mobile cards */}
            <div className="flex flex-col gap-3 lg:hidden">
              {visibleRows.map((row) => (
                <ReworkCard
                  key={row.id}
                  row={row}
                  onStart={() => setRowState(row.id, 'in_progress')}
                  onComplete={() => setRowState(row.id, 'complete')}
                  onReopen={() => setRowState(row.id, 'pending')}
                  onReInspect={() => handleReInspect(row)}
                />
              ))}
            </div>

            {/* Desktop table */}
            <div className="hidden lg:block overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="text-left py-3 px-4 font-semibold text-gray-600 text-sm">Job</th>
                    <th className="text-left py-3 px-4 font-semibold text-gray-600 text-sm">Builder / Community</th>
                    <th className="text-left py-3 px-4 font-semibold text-gray-600 text-sm">Failure</th>
                    <th className="text-left py-3 px-4 font-semibold text-gray-600 text-sm">Failed</th>
                    <th className="text-left py-3 px-4 font-semibold text-gray-600 text-sm">Status</th>
                    <th className="text-right py-3 px-4 font-semibold text-gray-600 text-sm">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleRows.map((row) => (
                    <ReworkRowDesktop
                      key={row.id}
                      row={row}
                      onStart={() => setRowState(row.id, 'in_progress')}
                      onComplete={() => setRowState(row.id, 'complete')}
                      onReopen={() => setRowState(row.id, 'pending')}
                      onReInspect={() => handleReInspect(row)}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {/* Process tips */}
      <div className="bg-blue-50 rounded-xl border border-blue-200 p-4 sm:p-6">
        <h3 className="text-sm font-semibold text-blue-900 mb-3 flex items-center gap-2">
          <ClipboardList className="w-4 h-4" />
          Rework Process
        </h3>
        <ol className="text-sm text-blue-800 space-y-1.5 list-decimal list-inside">
          <li>Review the defect codes and notes from the failed inspection</li>
          <li>Mark the item <strong>Rework Started</strong> when crew/builder begins repair</li>
          <li>When repair is finished, click <strong>Re-inspect</strong> to send it back to the QC queue</li>
          <li>A passing QC marks the rework complete here automatically</li>
        </ol>
        <p className="text-xs text-blue-700 mt-3">
          Note: rework progress is tracked in your browser until the schema-side
          rework status lands. Refreshing on the same machine preserves it; clearing
          site data will reset it.
        </p>
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────────
// Subcomponents
// ──────────────────────────────────────────────────────────────────────────

function CountCard({
  label,
  value,
  accent,
  active,
  onClick,
}: {
  label: string
  value: number
  accent: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={`text-left bg-white rounded-xl border p-4 sm:p-5 transition-colors ${
        active ? 'border-gray-900 ring-1 ring-gray-900/10' : 'border-gray-200 hover:border-gray-300'
      }`}
      aria-pressed={active}
    >
      <p className="text-xs font-medium text-gray-600 uppercase tracking-wide">{label}</p>
      <p className={`text-2xl sm:text-3xl font-bold mt-1 ${accent}`}>{value}</p>
    </button>
  )
}

interface RowProps {
  row: ReworkRow
  onStart: () => void
  onComplete: () => void
  onReopen: () => void
  onReInspect: () => void
}

function ReworkCard({ row, onStart, onComplete, onReopen, onReInspect }: RowProps) {
  const pill = STATE_PILL[row.reworkState]
  return (
    <div className="border border-gray-200 bg-white rounded-lg p-4">
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <Link
          href={`/ops/jobs/${row.id}`}
          className="font-semibold text-[#C0392B] hover:text-[#A93226] text-base"
        >
          {row.jobNumber}
        </Link>
        <span className={`px-3 py-1 rounded-full text-xs font-semibold ${pill.cls}`}>
          {pill.label}
        </span>
      </div>
      <p className="font-medium text-gray-900 mt-1 text-sm">{row.builderName}</p>
      {row.community && (
        <p className="text-xs text-gray-600 mt-0.5">{row.community}</p>
      )}
      {row.defectCodes.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-2">
          {row.defectCodes.slice(0, 4).map((code) => (
            <span
              key={code}
              className="px-2 py-0.5 rounded bg-red-50 text-red-700 text-xs font-medium ring-1 ring-red-200"
            >
              {code.replace(/_/g, ' ')}
            </span>
          ))}
          {row.defectCodes.length > 4 && (
            <span className="px-2 py-0.5 rounded bg-gray-100 text-gray-700 text-xs">
              +{row.defectCodes.length - 4} more
            </span>
          )}
        </div>
      )}
      {row.defectNotes && (
        <p className="text-sm text-gray-700 mt-2 line-clamp-3">{row.defectNotes}</p>
      )}
      <p className="text-xs text-gray-500 mt-2">
        Failed {formatDate(row.failedAt)}
        {formatRelative(row.failedAt) && ` · ${formatRelative(row.failedAt)}`}
        {' · '}
        Job status: {row.jobStatus.replace(/_/g, ' ')}
      </p>
      <div className="grid grid-cols-2 gap-2 mt-3">
        <RowActions
          state={row.reworkState}
          onStart={onStart}
          onComplete={onComplete}
          onReopen={onReopen}
          onReInspect={onReInspect}
          variant="card"
        />
      </div>
    </div>
  )
}

function ReworkRowDesktop({ row, onStart, onComplete, onReopen, onReInspect }: RowProps) {
  const pill = STATE_PILL[row.reworkState]
  return (
    <tr className="border-b border-gray-100 hover:bg-gray-50/60 transition-colors">
      <td className="py-4 px-4 align-top">
        <Link
          href={`/ops/jobs/${row.id}`}
          className="font-semibold text-[#C0392B] hover:text-[#A93226]"
        >
          {row.jobNumber}
        </Link>
        <p className="text-xs text-gray-500 mt-1">
          Job: {row.jobStatus.replace(/_/g, ' ')}
        </p>
      </td>
      <td className="py-4 px-4 align-top">
        <p className="font-medium text-gray-900">{row.builderName}</p>
        {row.community && <p className="text-xs text-gray-600 mt-0.5">{row.community}</p>}
      </td>
      <td className="py-4 px-4 align-top">
        {row.defectCodes.length > 0 ? (
          <div className="flex flex-wrap gap-1.5 max-w-md">
            {row.defectCodes.slice(0, 5).map((code) => (
              <span
                key={code}
                className="px-2 py-0.5 rounded bg-red-50 text-red-700 text-xs font-medium ring-1 ring-red-200"
              >
                {code.replace(/_/g, ' ')}
              </span>
            ))}
            {row.defectCodes.length > 5 && (
              <span className="px-2 py-0.5 rounded bg-gray-100 text-gray-700 text-xs">
                +{row.defectCodes.length - 5}
              </span>
            )}
          </div>
        ) : (
          <span className="text-xs text-gray-400">No codes</span>
        )}
        {row.defectNotes && (
          <p className="text-xs text-gray-700 mt-1.5 max-w-md line-clamp-2">{row.defectNotes}</p>
        )}
      </td>
      <td className="py-4 px-4 align-top text-sm text-gray-700">
        {formatDate(row.failedAt)}
        <p className="text-xs text-gray-500 mt-0.5">{formatRelative(row.failedAt)}</p>
      </td>
      <td className="py-4 px-4 align-top">
        <span className={`px-3 py-1 rounded-full text-xs font-semibold ${pill.cls} whitespace-nowrap`}>
          {pill.label}
        </span>
      </td>
      <td className="py-4 px-4 align-top text-right">
        <div className="flex gap-2 justify-end flex-wrap">
          <RowActions
            state={row.reworkState}
            onStart={onStart}
            onComplete={onComplete}
            onReopen={onReopen}
            onReInspect={onReInspect}
            variant="row"
          />
        </div>
      </td>
    </tr>
  )
}

function RowActions({
  state,
  onStart,
  onComplete,
  onReopen,
  onReInspect,
  variant,
}: {
  state: ReworkState
  onStart: () => void
  onComplete: () => void
  onReopen: () => void
  onReInspect: () => void
  variant: 'card' | 'row'
}) {
  const baseBtn =
    variant === 'card'
      ? 'w-full px-3 py-3 min-h-[48px] rounded text-sm font-medium transition-colors flex items-center justify-center gap-1'
      : 'px-3 py-1.5 rounded text-xs font-medium transition-colors flex items-center gap-1'

  if (state === 'pending') {
    return (
      <>
        <button
          onClick={onStart}
          className={`${baseBtn} bg-[#C0392B] text-white hover:bg-[#A93226]`}
        >
          <PlayCircle className="w-4 h-4" />
          Mark Rework Started
        </button>
        <button
          onClick={onReInspect}
          className={`${baseBtn} border border-gray-300 text-gray-700 hover:bg-gray-50`}
        >
          Re-inspect
        </button>
      </>
    )
  }

  if (state === 'in_progress') {
    return (
      <>
        <button
          onClick={onComplete}
          className={`${baseBtn} bg-emerald-600 text-white hover:bg-emerald-700`}
        >
          Mark Complete
        </button>
        <button
          onClick={onReInspect}
          className={`${baseBtn} border border-gray-300 text-gray-700 hover:bg-gray-50`}
        >
          Re-inspect
        </button>
      </>
    )
  }

  // complete
  return (
    <>
      <button
        onClick={onReopen}
        className={`${baseBtn} border border-gray-300 text-gray-700 hover:bg-gray-50`}
      >
        Reopen
      </button>
      <button
        onClick={onReInspect}
        className={`${baseBtn} border border-gray-300 text-gray-700 hover:bg-gray-50`}
      >
        Re-inspect
      </button>
    </>
  )
}
