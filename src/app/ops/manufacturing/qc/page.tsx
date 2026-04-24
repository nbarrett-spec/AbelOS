'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { Factory } from 'lucide-react'
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

export default function QualityControlPage() {
  const [checks, setChecks] = useState<QualityCheck[]>([])
  const [stats, setStats] = useState<ApiResponse['stats'] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeFilter, setActiveFilter] = useState('ALL')
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false)

  useEffect(() => {
    fetchChecks()
  }, [])

  const fetchChecks = async () => {
    try {
      setLoading(true)
      const response = await fetch('/api/ops/manufacturing/qc')
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
  }

  const filteredChecks = checks.filter(
    (check) => activeFilter === 'ALL' || check.checkType === activeFilter
  )

  const passCount = checks.filter((c) => c.result === 'PASS').length
  const failCount = checks.filter((c) => c.result === 'FAIL').length
  const conditionalCount = checks.filter((c) => c.result === 'CONDITIONAL_PASS').length
  const passRate = checks.length > 0 ? (passCount / checks.length) * 100 : 0

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
              onClick={() => setIsCreateModalOpen(true)}
              className="px-3 py-1.5 text-sm bg-[#0f2a3e] text-white rounded-lg hover:bg-[#0a1a28] transition-colors"
            >
              + New QC Check
            </button>
            <Link
              href="/ops/manufacturing"
              className="px-3 py-1.5 text-sm text-fg-muted bg-gray-100 rounded-lg hover:bg-surface-muted"
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

      {/* Type filter pills */}
      <div className="flex gap-2 flex-wrap">
        <button
          onClick={() => setActiveFilter('ALL')}
          className={`px-3 py-1 text-xs rounded-full border transition-colors ${
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
              className={`px-3 py-1 text-xs rounded-full border transition-colors ${
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
            title="No jobs in production"
            description="No quality checks recorded for the current filter."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-fg-muted">Job</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-fg-muted">Type</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-fg-muted">Inspector</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-fg-muted">Result</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-fg-muted">Defects</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-fg-muted">Notes</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-fg-muted">Date</th>
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
                              className="px-2 py-0.5 rounded text-xs bg-gray-100 text-fg-muted"
                            >
                              {code}
                            </span>
                          ))}
                          {check.defectCodes.length > 2 && (
                            <span className="px-2 py-0.5 text-xs text-fg-muted">
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
          onClose={() => setIsCreateModalOpen(false)}
          onSuccess={() => {
            setIsCreateModalOpen(false)
            fetchChecks()
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
          <p className="text-xs text-fg-muted mb-1">{label}</p>
          <p className={`text-2xl font-semibold ${textColor}`}>{value}</p>
        </div>
        <div className="text-3xl">{icon}</div>
      </div>
    </div>
  )
}

function CreateQCModal({
  onClose,
  onSuccess,
}: {
  onClose: () => void
  onSuccess: () => void
}) {
  const [loading, setLoading] = useState(false)
  const [toast, setToast] = useState('')
  const [toastType, setToastType] = useState<'success' | 'error'>('success')
  const [formData, setFormData] = useState({
    jobId: '',
    checkType: 'FINAL_UNIT',
    result: 'PASS',
    notes: '',
    defectCodes: '',
  })
  const showToast = (msg: string, type: 'success' | 'error' = 'success') => {
    setToast(msg); setToastType(type);
    setTimeout(() => setToast(''), 3500);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      setLoading(true)
      const response = await fetch('/api/ops/manufacturing/qc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...formData,
          defectCodes: formData.defectCodes
            .split(',')
            .map((c) => c.trim())
            .filter((c) => c),
          jobId: formData.jobId || null,
        }),
      })

      if (!response.ok) {
        throw new Error('Failed to create quality check')
      }

      onSuccess()
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to create quality check', 'error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      {toast && (
        <div className={`fixed top-4 right-4 z-50 px-4 py-2 rounded-lg shadow-lg text-sm text-white ${
          toastType === 'error' ? 'bg-red-600' : 'bg-[#0f2a3e]'
        }`}>
          {toast}
        </div>
      )}
      <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6">
        <h2 className="text-lg font-semibold text-fg mb-4">New Quality Check</h2>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-fg-muted mb-1">
              Job (Optional)
            </label>
            <input
              type="text"
              value={formData.jobId}
              onChange={(e) => setFormData({ ...formData, jobId: e.target.value })}
              placeholder="Job ID"
              className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-[#0f2a3e]/20"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-fg-muted mb-1">
              Check Type
            </label>
            <select
              value={formData.checkType}
              onChange={(e) => setFormData({ ...formData, checkType: e.target.value })}
              className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-[#0f2a3e]/20"
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
              className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-[#0f2a3e]/20"
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
              className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-[#0f2a3e]/20"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-fg-muted mb-1">
              Notes
            </label>
            <textarea
              value={formData.notes}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              placeholder="Inspection notes..."
              className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-[#0f2a3e]/20 resize-none"
              rows={3}
            />
          </div>

          <div className="flex gap-2 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 border rounded-lg text-sm font-medium text-fg-muted hover:bg-row-hover"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 px-4 py-2 bg-[#0f2a3e] text-white rounded-lg text-sm font-medium hover:bg-[#0a1a28] disabled:opacity-50"
            >
              {loading ? 'Creating...' : 'Create Check'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
