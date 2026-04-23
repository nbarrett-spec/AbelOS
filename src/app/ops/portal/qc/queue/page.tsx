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
  pendingInspectionId?: string | null
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

// Common defect options for the inline modal.
const COMMON_DEFECTS = [
  'Door sticks',
  'Scratched finish',
  'Hardware misaligned',
  'Wrong handing',
  'Damaged frame',
  'Short-ship',
  'Trim piece missing',
  'Customer request discrepancy',
]

type ResultKind = 'PASS' | 'PASS_WITH_NOTES' | 'FAIL'

interface ModalState {
  job: QCJob
  result: ResultKind
}

export default function QCQueuePage() {
  const router = useRouter()
  const [briefing, setBriefing] = useState<QCBriefing | null>(null)
  const [loading, setLoading] = useState(true)
  const [selectedTab, setSelectedTab] = useState<'ALL' | 'CRITICAL' | 'HIGH' | 'NORMAL'>('ALL')
  const [sortBy, setSortBy] = useState<'priority' | 'date' | 'builder'>('priority')
  const [dateFilter, setDateFilter] = useState<'TODAY' | '48H' | '72H' | 'ALL'>('ALL')
  const [modal, setModal] = useState<ModalState | null>(null)

  const loadData = async () => {
    try {
      const res = await fetch('/api/ops/qc-briefing')
      if (res.ok) setBriefing(await res.json())
    } catch (error) {
      console.error('Failed to load QC briefing:', error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [])

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

  // Sort — PENDING (no passing inspection yet) rises to the top by convention.
  const sortedQueue = [...filteredQueue].sort((a, b) => {
    // Pending rows ahead of already-graded rows.
    const aPending = a.jobStatus !== 'COMPLETE' ? 0 : 1
    const bPending = b.jobStatus !== 'COMPLETE' ? 0 : 1
    if (aPending !== bPending) return aPending - bPending

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
    <div className="space-y-4 sm:space-y-6 pb-20">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">Inspection Queue</h1>
          <p className="text-gray-600 mt-1 text-sm">{sortedQueue.length} jobs awaiting QC inspection</p>
        </div>
        <Link
          href="/ops/portal/qc"
          className="px-4 py-3 min-h-[48px] border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors text-sm font-medium flex items-center justify-center"
        >
          Back to Dashboard
        </Link>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-4">
        <div className="bg-white rounded-xl border p-3 sm:p-4">
          <p className="text-[11px] sm:text-xs font-medium text-gray-600 uppercase">Total in Queue</p>
          <p className="text-xl sm:text-2xl font-bold text-gray-900 mt-1 sm:mt-2">{briefing.inspectionQueue.length}</p>
        </div>
        <div className="bg-white rounded-xl border p-3 sm:p-4">
          <p className="text-[11px] sm:text-xs font-medium text-gray-600 uppercase">Critical (48h)</p>
          <p className="text-xl sm:text-2xl font-bold text-[#C0392B] mt-1 sm:mt-2">
            {briefing.inspectionQueue.filter((j) => j.priority === 'CRITICAL').length}
          </p>
        </div>
        <div className="bg-white rounded-xl border p-3 sm:p-4">
          <p className="text-[11px] sm:text-xs font-medium text-gray-600 uppercase">High (72h)</p>
          <p className="text-xl sm:text-2xl font-bold text-orange-600 mt-1 sm:mt-2">
            {briefing.inspectionQueue.filter((j) => j.priority === 'HIGH').length}
          </p>
        </div>
        <div className="bg-white rounded-xl border p-3 sm:p-4">
          <p className="text-[11px] sm:text-xs font-medium text-gray-600 uppercase">Completed Today</p>
          <p className="text-xl sm:text-2xl font-bold text-green-600 mt-1 sm:mt-2">{briefing.summary.inspectionsToday}</p>
        </div>
      </div>

      {/* Tabs and Filters */}
      <div className="bg-white rounded-xl border p-4 sm:p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-4">
          <div className="flex gap-2 flex-wrap">
            {(['ALL', 'CRITICAL', 'HIGH', 'NORMAL'] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setSelectedTab(tab)}
                className={`px-3 sm:px-4 py-3 min-h-[48px] rounded-lg text-sm font-medium transition-all ${
                  selectedTab === tab
                    ? 'bg-[#C0392B] text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                {tab === 'ALL' ? 'All' : tab}
              </button>
            ))}
          </div>

          <div className="flex gap-2 flex-wrap">
            {(['TODAY', '48H', '72H', 'ALL'] as const).map((dateOpt) => (
              <button
                key={dateOpt}
                onClick={() => setDateFilter(dateOpt)}
                className={`px-3 py-3 min-h-[48px] rounded text-xs font-medium transition-all ${
                  dateFilter === dateOpt
                    ? 'bg-[#C0392B] text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                {dateOpt === 'TODAY' ? 'Today' : dateOpt === '48H' ? '48h' : dateOpt === '72H' ? '72h' : 'All'}
              </button>
            ))}
          </div>

          <div>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
              className="px-3 py-3 min-h-[48px] w-full sm:w-auto rounded border border-gray-300 text-sm font-medium text-gray-700 hover:border-gray-400 transition-all"
            >
              <option value="priority">Sort by Priority</option>
              <option value="date">Sort by Date</option>
              <option value="builder">Sort by Builder</option>
            </select>
          </div>
        </div>
      </div>

      {/* Queue — mobile cards, desktop table */}
      <div className="bg-white rounded-xl border p-4 sm:p-6">
        {sortedQueue.length === 0 ? (
          <div className="text-center py-12 text-gray-500">
            <p className="text-lg">No jobs in this queue</p>
            <p className="text-sm mt-1">All jobs are either scheduled for QC or already passed</p>
          </div>
        ) : (
          <>
            {/* Mobile card list */}
            <div className="flex flex-col gap-3 lg:hidden">
              {sortedQueue.map((job) => (
                <div key={job.id} className={`border border-gray-200 rounded-lg p-4 ${priorityColors[job.priority].bg}`}>
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Link href={`/ops/jobs/${job.id}`} className="font-semibold text-[#C0392B] hover:text-[#A93226] text-base">
                          {job.jobNumber}
                        </Link>
                        <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${priorityColors[job.priority].badge}`}>
                          {job.priority}
                        </span>
                      </div>
                      <p className="font-medium text-gray-900 mt-1 text-sm">{job.builderName}</p>
                      {job.community && <p className="text-xs text-gray-500">{job.community}</p>}
                      <div className="flex gap-3 text-xs text-gray-600 mt-2 flex-wrap">
                        <span>{job.productCount} items</span>
                        {job.scheduledDate && <span>{new Date(job.scheduledDate).toLocaleDateString()}</span>}
                        <span>{job.jobStatus.replace(/_/g, ' ')}</span>
                      </div>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-2 mt-3">
                    <button
                      onClick={() => setModal({ job, result: 'PASS' })}
                      className="px-3 py-3 min-h-[48px] bg-green-600 text-white rounded text-sm font-medium hover:bg-green-700"
                    >
                      Pass
                    </button>
                    <button
                      onClick={() => setModal({ job, result: 'PASS_WITH_NOTES' })}
                      className="px-3 py-3 min-h-[48px] bg-yellow-500 text-white rounded text-sm font-medium hover:bg-yellow-600"
                    >
                      Pass+Notes
                    </button>
                    <button
                      onClick={() => setModal({ job, result: 'FAIL' })}
                      className="px-3 py-3 min-h-[48px] bg-[#C0392B] text-white rounded text-sm font-medium hover:bg-[#A93226]"
                    >
                      Fail
                    </button>
                  </div>
                </div>
              ))}
            </div>
            {/* Desktop table */}
            <div className="hidden lg:block overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="text-left py-3 px-4 font-semibold text-gray-600 text-sm">Job #</th>
                    <th className="text-left py-3 px-4 font-semibold text-gray-600 text-sm">Builder</th>
                    <th className="text-left py-3 px-4 font-semibold text-gray-600 text-sm">Products</th>
                    <th className="text-left py-3 px-4 font-semibold text-gray-600 text-sm">Delivery Date</th>
                    <th className="text-left py-3 px-4 font-semibold text-gray-600 text-sm">Priority</th>
                    <th className="text-left py-3 px-4 font-semibold text-gray-600 text-sm">Status</th>
                    <th className="text-right py-3 px-4 font-semibold text-gray-600 text-sm">Grade</th>
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
                      <td className="py-4 px-4">
                        <div className="flex justify-end gap-1">
                          <button
                            onClick={() => setModal({ job, result: 'PASS' })}
                            className="px-2.5 py-1.5 bg-green-600 text-white rounded text-xs font-medium hover:bg-green-700"
                          >
                            Pass
                          </button>
                          <button
                            onClick={() => setModal({ job, result: 'PASS_WITH_NOTES' })}
                            className="px-2.5 py-1.5 bg-yellow-500 text-white rounded text-xs font-medium hover:bg-yellow-600"
                          >
                            Pass+Notes
                          </button>
                          <button
                            onClick={() => setModal({ job, result: 'FAIL' })}
                            className="px-2.5 py-1.5 bg-[#C0392B] text-white rounded text-xs font-medium hover:bg-[#A93226]"
                          >
                            Fail
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {modal && (
        <GradeModal
          state={modal}
          onClose={() => setModal(null)}
          onSuccess={() => {
            setModal(null)
            setLoading(true)
            loadData()
          }}
        />
      )}
    </div>
  )
}

// ── Grade modal ──────────────────────────────────────────────────────

function GradeModal({
  state,
  onClose,
  onSuccess,
}: {
  state: ModalState
  onClose: () => void
  onSuccess: () => void
}) {
  const { job, result } = state
  const [notes, setNotes] = useState('')
  const [severity, setSeverity] = useState<'MINOR' | 'MAJOR' | 'CRITICAL'>(
    result === 'FAIL' ? 'MAJOR' : 'MINOR'
  )
  const [selectedDefects, setSelectedDefects] = useState<string[]>([])
  const [customDefect, setCustomDefect] = useState('')
  const [photos, setPhotos] = useState<string[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const toggleDefect = (d: string) => {
    setSelectedDefects((prev) =>
      prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]
    )
  }

  const onFile = async (file: File) => {
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setPhotos((p) => [...p, reader.result as string].slice(-10))
      }
    }
    reader.readAsDataURL(file)
  }

  const submit = async () => {
    setSubmitting(true)
    setError(null)

    try {
      const defects = [
        ...selectedDefects.map((description) => ({ description })),
        ...(customDefect.trim() ? [{ description: customDefect.trim() }] : []),
      ]

      // 1. Create an Inspection row for this job (result-first flow — the
      //    briefing exposes jobs, not inspections yet, so we POST a new
      //    Inspection row with the terminal status + defects.
      const tplId = await pickDefaultTemplate()
      const createRes = await fetch('/api/ops/inspections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          templateId: tplId,
          jobId: job.id,
          scheduledDate: new Date().toISOString(),
          notes,
        }),
      })
      if (!createRes.ok) {
        const body = await createRes.json().catch(() => ({}))
        throw new Error(body.error || 'Failed to create inspection')
      }
      const { inspection } = await createRes.json()
      const inspectionId: string = inspection.id

      // 2. Upload photos (if any).
      if (photos.length > 0) {
        await fetch(`/api/ops/inspections/${inspectionId}/photos`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ photos }),
        })
      }

      // 3. Patch with terminal result + defects for the side-effect chain.
      const patchRes = await fetch(`/api/ops/inspections/${inspectionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: result,
          notes,
          defects,
          severity,
          completedDate: new Date().toISOString(),
        }),
      })
      if (!patchRes.ok) {
        const body = await patchRes.json().catch(() => ({}))
        throw new Error(body.error || 'Failed to submit result')
      }

      onSuccess()
    } catch (e: any) {
      setError(e?.message || 'Submit failed')
    } finally {
      setSubmitting(false)
    }
  }

  const title =
    result === 'PASS' ? 'Pass Inspection'
    : result === 'PASS_WITH_NOTES' ? 'Pass with Notes'
    : 'Fail Inspection'

  const accent =
    result === 'PASS' ? 'bg-green-600 hover:bg-green-700'
    : result === 'PASS_WITH_NOTES' ? 'bg-yellow-500 hover:bg-yellow-600'
    : 'bg-[#C0392B] hover:bg-[#A93226]'

  return (
    <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4 overflow-y-auto">
      <div className="bg-white rounded-t-xl sm:rounded-xl shadow-xl max-w-lg w-full p-4 sm:p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-lg font-bold text-gray-900">{title}</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="w-12 h-12 min-w-[48px] min-h-[48px] flex items-center justify-center text-gray-400 hover:text-gray-600 text-xl leading-none rounded-lg"
          >
            ✕
          </button>
        </div>
        <p className="text-sm text-gray-600 mb-4">
          {job.jobNumber} — {job.builderName}
        </p>

        {/* Defect checklist */}
        {result !== 'PASS' && (
          <div className="mb-4">
            <p className="text-sm font-medium text-gray-700 mb-2">Defects</p>
            <div className="space-y-1">
              {COMMON_DEFECTS.map((d) => (
                <label key={d} className="flex items-center gap-3 text-sm text-gray-700 cursor-pointer py-3 min-h-[48px]">
                  <input
                    type="checkbox"
                    checked={selectedDefects.includes(d)}
                    onChange={() => toggleDefect(d)}
                    className="rounded w-5 h-5"
                  />
                  {d}
                </label>
              ))}
            </div>
            <input
              type="text"
              value={customDefect}
              onChange={(e) => setCustomDefect(e.target.value)}
              placeholder="Add another..."
              className="mt-2 w-full px-3 py-3 min-h-[48px] border rounded text-base"
            />
          </div>
        )}

        {/* Severity (for FAIL) */}
        {result === 'FAIL' && (
          <div className="mb-4">
            <p className="text-sm font-medium text-gray-700 mb-2">Severity</p>
            <div className="flex gap-2">
              {(['MINOR', 'MAJOR', 'CRITICAL'] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setSeverity(s)}
                  className={`flex-1 px-3 py-3 min-h-[48px] rounded text-sm font-medium ${
                    severity === s
                      ? s === 'CRITICAL'
                        ? 'bg-[#C0392B] text-white'
                        : s === 'MAJOR'
                          ? 'bg-orange-600 text-white'
                          : 'bg-gray-600 text-white'
                      : 'bg-gray-100 text-gray-700'
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Notes */}
        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            className="w-full px-3 py-2 border rounded text-base"
            placeholder="Inspector observations..."
          />
        </div>

        {/* Photo upload */}
        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 mb-1">Photos</label>
          <input
            type="file"
            accept="image/*"
            capture="environment"
            multiple
            onChange={(e) => {
              const files = Array.from(e.target.files || [])
              files.forEach((f) => { onFile(f) })
            }}
            className="text-sm w-full min-h-[48px]"
          />
          {photos.length > 0 && (
            <div className="flex gap-2 mt-2 flex-wrap">
              {photos.map((p, i) => (
                <img key={i} src={p} alt="" className="w-16 h-16 object-cover rounded border" />
              ))}
            </div>
          )}
        </div>

        {error && (
          <div className="mb-3 p-2 bg-red-50 border border-red-200 rounded text-sm text-red-700">
            {error}
          </div>
        )}

        <div className="flex flex-col-reverse sm:flex-row gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 px-4 py-3 min-h-[48px] border rounded text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={submitting}
            className={`flex-1 px-4 py-3 min-h-[48px] text-white rounded text-sm font-medium disabled:opacity-50 ${accent}`}
          >
            {submitting ? 'Submitting...' : `Submit ${title}`}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Template picker ──────────────────────────────────────────────────
// Picks the first MFG_QC template, falling back to any active template.
// Cached in memory because templates rarely change.

let _cachedTemplateId: string | null = null

async function pickDefaultTemplate(): Promise<string | null> {
  if (_cachedTemplateId) return _cachedTemplateId
  try {
    const res = await fetch('/api/ops/inspections/templates')
    if (!res.ok) return null
    const data = await res.json()
    const tpl =
      (data.templates || []).find((t: any) => t.code === 'MFG_QC') ||
      (data.templates || [])[0]
    _cachedTemplateId = tpl?.id || null
    return _cachedTemplateId
  } catch {
    return null
  }
}
