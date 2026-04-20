'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useToast } from '@/contexts/ToastContext'

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

interface QCResult {
  id: string
  jobNumber: string | null
  checkType: string
  result: string
  passed: boolean
  notes: string | null
  checkedAt: string
  checkedByName: string
}

interface FailedJob {
  id: string
  jobNumber: string
  builderName: string
  failedAt: string
  defectNotes: string | null
  status: string
}

interface DefectSummary {
  defectType: string
  count: number
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
  recentResults: QCResult[]
  failedJobs: FailedJob[]
  defectSummary: DefectSummary[]
}

const QC_TYPES = [
  { key: 'PRE_PRODUCTION', label: 'Pre-Production' },
  { key: 'IN_PROCESS', label: 'In Process' },
  { key: 'FINAL_UNIT', label: 'Final Unit' },
  { key: 'PRE_DELIVERY', label: 'Pre-Delivery' },
  { key: 'POST_INSTALL', label: 'Post-Install' },
]

const COMMON_DEFECTS = [
  'DIMENSION_ERROR', 'MATERIAL_DEFECT', 'FINISH_ISSUE', 'ASSEMBLY_ERROR',
  'COLOR_MISMATCH', 'HARDWARE_MISSING', 'DAMAGE_SCRATCH', 'WARPING',
]

export default function QCPortal() {
  const { addToast } = useToast()
  const [briefing, setBriefing] = useState<QCBriefing | null>(null)
  const [loading, setLoading] = useState(true)
  const [showLogModal, setShowLogModal] = useState(false)
  const [logForm, setLogForm] = useState({ jobId: '', checkType: 'FINAL_UNIT', result: 'PASS', notes: '', defectCodes: [] as string[] })
  const [submittingLog, setSubmittingLog] = useState(false)

  const loadData = async () => {
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

  useEffect(() => { loadData() }, [])

  const handleLogInspection = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmittingLog(true)
    try {
      const res = await fetch('/api/ops/manufacturing/qc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...logForm,
          jobId: logForm.jobId || null,
        }),
      })
      if (res.ok) {
        addToast({ type: 'success', title: 'Inspection Logged', message: `QC check recorded as ${logForm.result.replace('_', ' ')}` })
        setShowLogModal(false)
        setLogForm({ jobId: '', checkType: 'FINAL_UNIT', result: 'PASS', notes: '', defectCodes: [] })
        loadData()
      } else {
        const err = await res.json()
        addToast({ type: 'error', title: 'Error', message: err.error || 'Failed to log inspection' })
      }
    } catch (error) {
      addToast({ type: 'error', title: 'Error', message: 'Failed to log inspection' })
    } finally {
      setSubmittingLog(false)
    }
  }

  const toggleDefect = (code: string) => {
    setLogForm(prev => ({
      ...prev,
      defectCodes: prev.defectCodes.includes(code)
        ? prev.defectCodes.filter(c => c !== code)
        : [...prev.defectCodes, code]
    }))
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
        <p className="text-gray-500">Failed to load QC briefing</p>
      </div>
    )
  }

  const priorityColors: Record<string, { bg: string; border: string; badge: string }> = {
    CRITICAL: {
      bg: 'bg-red-50',
      border: 'border-red-200 hover:border-[#C0392B]',
      badge: 'bg-[#C0392B] text-white',
    },
    HIGH: {
      bg: 'bg-orange-50',
      border: 'border-orange-200 hover:border-orange-500',
      badge: 'bg-orange-500 text-white',
    },
    NORMAL: {
      bg: 'bg-blue-50',
      border: 'border-blue-200 hover:border-[#3E2A1E]',
      badge: 'bg-[#3E2A1E] text-white',
    },
  }

  const urgencyIndicator = (date: string | null): string => {
    if (!date) return ''
    const now = new Date()
    const scheduled = new Date(date)
    const hoursUntil = (scheduled.getTime() - now.getTime()) / 3600000

    if (hoursUntil <= 24) return '🔴 Due Today'
    if (hoursUntil <= 48) return '🟠 Tomorrow'
    if (hoursUntil <= 72) return '🟡 This Week'
    return ''
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Quality Control Center</h1>
          <p className="text-gray-600 mt-1">
            {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setShowLogModal(true)}
            className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors text-sm font-medium"
          >
            Log Result
          </button>
          <Link
            href="/ops/portal/qc/queue"
            className="px-4 py-2 bg-[#C0392B] text-white rounded-lg hover:bg-[#A93226] transition-colors text-sm font-medium"
          >
            + Start Inspection
          </Link>
          <Link
            href="/ops/manufacturing/qc"
            className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors text-sm font-medium"
          >
            All Checks
          </Link>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-4">
        <div className="bg-white rounded-xl border p-4">
          <p className="text-xs font-medium text-gray-600 uppercase">Inspections Today</p>
          <p className="text-3xl font-bold text-gray-900 mt-2">{briefing.summary.inspectionsToday}</p>
          <p className="text-xs text-gray-500 mt-1">QC checks completed</p>
        </div>

        <div className="bg-white rounded-xl border p-4">
          <p className="text-xs font-medium text-gray-600 uppercase">Pending Queue</p>
          <p className="text-3xl font-bold text-[#C0392B] mt-2">{briefing.summary.pendingInspections}</p>
          <p className="text-xs text-gray-500 mt-1">Jobs awaiting QC</p>
        </div>

        <div className="bg-white rounded-xl border p-4">
          <p className="text-xs font-medium text-gray-600 uppercase">Pass Rate (7d)</p>
          <p className="text-3xl font-bold text-green-600 mt-2">{briefing.summary.passRate7d}%</p>
          <p className="text-xs text-gray-500 mt-1">Quality metric</p>
        </div>

        <div className="bg-white rounded-xl border p-4">
          <p className="text-xs font-medium text-gray-600 uppercase">Failed/Rework</p>
          <p className="text-3xl font-bold text-red-600 mt-2">{briefing.summary.failedAwaitingRework}</p>
          <p className="text-xs text-gray-500 mt-1">Re-inspection needed</p>
        </div>

        <div className="bg-white rounded-xl border p-4">
          <p className="text-xs font-medium text-gray-600 uppercase">Completed (7d)</p>
          <p className="text-3xl font-bold text-blue-600 mt-2">{briefing.summary.totalCompleted7d}</p>
          <p className="text-xs text-gray-500 mt-1">Total inspections</p>
        </div>

        <div className="bg-white rounded-xl border p-4">
          <p className="text-xs font-medium text-gray-600 uppercase">Critical Defects</p>
          <p className="text-3xl font-bold text-orange-600 mt-2">{briefing.summary.criticalDefects}</p>
          <p className="text-xs text-gray-500 mt-1">Last 7 days</p>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="bg-white rounded-xl border p-6">
        <h3 className="text-lg font-bold text-gray-900 mb-4">Quick Actions</h3>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <Link
            href="/ops/portal/qc/queue"
            className="px-4 py-3 rounded-lg border border-[#C0392B] bg-red-50 hover:bg-red-100 transition-all text-sm font-medium text-gray-900 text-center"
          >
            🔍 Start Inspection
          </Link>
          <Link
            href="/ops/portal/qc/queue"
            className="px-4 py-3 rounded-lg border border-gray-200 hover:bg-blue-50 hover:border-[#3E2A1E] transition-all text-sm font-medium text-gray-900 text-center"
          >
            📋 View Queue
          </Link>
          <Link
            href="/ops/portal/qc/trends"
            className="px-4 py-3 rounded-lg border border-gray-200 hover:bg-purple-50 hover:border-purple-500 transition-all text-sm font-medium text-gray-900 text-center"
          >
            📊 Defect Trends
          </Link>
          <Link
            href="/ops/portal/qc/rework"
            className="px-4 py-3 rounded-lg border border-gray-200 hover:bg-orange-50 hover:border-orange-500 transition-all text-sm font-medium text-gray-900 text-center"
          >
            🔧 Rework Queue
          </Link>
          <button className="px-4 py-3 rounded-lg border border-gray-200 hover:bg-green-50 hover:border-[#27AE60] transition-all text-sm font-medium text-gray-900">
            📈 QC Reports
          </button>
          <button className="px-4 py-3 rounded-lg border border-gray-200 hover:bg-gray-100 transition-all text-sm font-medium text-gray-900">
            📖 Standards
          </button>
        </div>
      </div>

      {/* Main content grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Inspection Queue - spans 2 columns */}
        <div className="lg:col-span-2 bg-white rounded-xl border p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold text-gray-900">Inspection Queue</h2>
            <Link href="/ops/portal/qc/queue" className="text-sm text-[#C0392B] hover:text-[#A93226]">
              View All →
            </Link>
          </div>

          {briefing.inspectionQueue.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              <p className="text-3xl mb-2">✅</p>
              <p>All jobs inspected!</p>
            </div>
          ) : (
            <div className="space-y-3">
              {briefing.inspectionQueue.slice(0, 8).map((job) => {
                const colors = priorityColors[job.priority]
                return (
                  <Link key={job.id} href={`/ops/jobs/${job.id}`}>
                    <div className={`flex items-center justify-between p-4 rounded-lg border ${colors.border} ${colors.bg} hover:shadow-md transition-all`}>
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <p className="font-semibold text-gray-900">{job.jobNumber}</p>
                          <span className={`px-2 py-0.5 text-xs font-medium rounded ${colors.badge}`}>
                            {job.priority}
                          </span>
                        </div>
                        <p className="text-sm text-gray-600 mt-0.5">{job.builderName}</p>
                        <div className="flex gap-3 text-xs text-gray-500 mt-1">
                          <span>{job.productCount} products</span>
                          {job.scheduledDate && <span>• {urgencyIndicator(job.scheduledDate)}</span>}
                        </div>
                      </div>
                      <div className="text-right">
                        {job.scheduledDate && (
                          <p className="text-xs text-gray-600 mb-2">
                            📅 {new Date(job.scheduledDate).toLocaleDateString()}
                          </p>
                        )}
                        <button className="px-3 py-1.5 text-xs font-medium bg-[#C0392B] text-white rounded hover:bg-[#A93226] transition-colors">
                          Inspect →
                        </button>
                      </div>
                    </div>
                  </Link>
                )
              })}
            </div>
          )}
        </div>

        {/* Failed/Rework Queue */}
        <div className="bg-white rounded-xl border p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold text-gray-900">Rework Needed</h2>
            <Link href="/ops/portal/qc/rework" className="text-sm text-[#C0392B] hover:text-[#A93226]">
              View All →
            </Link>
          </div>

          {briefing.failedJobs.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              <p className="text-3xl mb-2">🎉</p>
              <p>No rework needed</p>
            </div>
          ) : (
            <div className="space-y-3">
              {briefing.failedJobs.slice(0, 5).map((job) => (
                <Link key={job.id} href={`/ops/jobs/${job.id}`}>
                  <div className="p-3 rounded-lg border border-red-200 bg-red-50 hover:border-[#C0392B] transition-all">
                    <p className="font-semibold text-gray-900 text-sm">{job.jobNumber}</p>
                    <p className="text-xs text-gray-600 mt-1">{job.builderName}</p>
                    {job.defectNotes && (
                      <p className="text-xs text-red-700 mt-1 line-clamp-2">{job.defectNotes}</p>
                    )}
                    <p className="text-xs text-gray-500 mt-2">
                      Failed: {new Date(job.failedAt).toLocaleDateString()}
                    </p>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Recent Results */}
      <div className="bg-white rounded-xl border p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-gray-900">Recent Inspection Results</h2>
          <button className="text-sm text-[#C0392B] hover:text-[#A93226]">View All →</button>
        </div>

        {briefing.recentResults.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            <p className="text-3xl mb-2">📋</p>
            <p>No inspection results yet</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left py-2 px-3 font-semibold text-gray-600">Job #</th>
                  <th className="text-left py-2 px-3 font-semibold text-gray-600">Check Type</th>
                  <th className="text-left py-2 px-3 font-semibold text-gray-600">Result</th>
                  <th className="text-left py-2 px-3 font-semibold text-gray-600">Inspector</th>
                  <th className="text-left py-2 px-3 font-semibold text-gray-600">Date</th>
                </tr>
              </thead>
              <tbody>
                {briefing.recentResults.slice(0, 10).map((result) => (
                  <tr key={result.id} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="py-3 px-3 font-medium text-gray-900">{result.jobNumber}</td>
                    <td className="py-3 px-3 text-gray-600">{result.checkType.replace(/_/g, ' ')}</td>
                    <td className="py-3 px-3">
                      <span
                        className={`px-2 py-1 rounded-full text-xs font-medium ${
                          result.passed
                            ? 'bg-green-100 text-green-700'
                            : 'bg-red-100 text-red-700'
                        }`}
                      >
                        {result.result}
                      </span>
                    </td>
                    <td className="py-3 px-3 text-gray-600 text-xs">{result.checkedByName}</td>
                    <td className="py-3 px-3 text-gray-500 text-xs">
                      {new Date(result.checkedAt).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Defect Summary */}
      {briefing.defectSummary.length > 0 && (
        <div className="bg-white rounded-xl border p-6">
          <h2 className="text-lg font-bold text-gray-900 mb-4">Defect Summary (Last 30 Days)</h2>
          <div className="space-y-3">
            {briefing.defectSummary.map((defect) => {
              const maxCount = Math.max(...briefing.defectSummary.map((d) => d.count))
              const percentage = (defect.count / maxCount) * 100
              return (
                <div key={defect.defectType}>
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-sm font-medium text-gray-900">{defect.defectType.replace(/_/g, ' ')}</p>
                    <p className="text-sm font-semibold text-gray-600">{defect.count}</p>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div
                      className="bg-[#C0392B] h-2 rounded-full transition-all"
                      style={{ width: `${percentage}%` }}
                    />
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
      {/* Log Inspection Modal */}
      {showLogModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <form onSubmit={handleLogInspection} className="bg-white rounded-xl shadow-xl max-w-lg w-full">
            <div className="border-b p-6 flex justify-between items-center">
              <h2 className="text-xl font-bold text-gray-900">Log QC Inspection</h2>
              <button type="button" onClick={() => setShowLogModal(false)} className="text-gray-400 hover:text-gray-600">✕</button>
            </div>

            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Job Number or ID</label>
                <input
                  type="text"
                  value={logForm.jobId}
                  onChange={(e) => setLogForm({ ...logForm, jobId: e.target.value })}
                  placeholder="Enter job number..."
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-[#C0392B]/20 focus:border-[#C0392B]"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Check Type</label>
                  <select
                    value={logForm.checkType}
                    onChange={(e) => setLogForm({ ...logForm, checkType: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-[#C0392B]/20"
                  >
                    {QC_TYPES.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Result</label>
                  <select
                    value={logForm.result}
                    onChange={(e) => setLogForm({ ...logForm, result: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-[#C0392B]/20"
                  >
                    <option value="PASS">✅ Pass</option>
                    <option value="FAIL">❌ Fail</option>
                    <option value="CONDITIONAL_PASS">⚠️ Conditional Pass</option>
                  </select>
                </div>
              </div>

              {logForm.result !== 'PASS' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Defect Codes</label>
                  <div className="flex flex-wrap gap-2">
                    {COMMON_DEFECTS.map(code => (
                      <button
                        key={code}
                        type="button"
                        onClick={() => toggleDefect(code)}
                        className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                          logForm.defectCodes.includes(code)
                            ? 'bg-red-100 border-red-300 text-red-800'
                            : 'bg-gray-50 border-gray-200 text-gray-600 hover:bg-gray-100'
                        }`}
                      >
                        {code.replace(/_/g, ' ')}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
                <textarea
                  value={logForm.notes}
                  onChange={(e) => setLogForm({ ...logForm, notes: e.target.value })}
                  placeholder="Inspection notes, observations..."
                  rows={3}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-[#C0392B]/20 resize-none"
                />
              </div>
            </div>

            <div className="bg-gray-50 border-t p-6 flex justify-end gap-3">
              <button type="button" onClick={() => setShowLogModal(false)} className="px-4 py-2 text-sm text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50">
                Cancel
              </button>
              <button
                type="submit"
                disabled={submittingLog}
                className="px-4 py-2 text-sm bg-[#C0392B] text-white rounded-lg hover:bg-[#A93226] disabled:opacity-50 font-medium"
              >
                {submittingLog ? 'Logging...' : 'Log Inspection'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}
