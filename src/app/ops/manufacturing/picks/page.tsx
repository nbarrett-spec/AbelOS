'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { Factory } from 'lucide-react'
import EmptyState from '@/components/ui/EmptyState'
import PageHeader from '@/components/ui/PageHeader'

const PICK_STATUSES = [
  { key: 'PENDING', label: 'Pending', color: '#95A5A6' },
  { key: 'PICKING', label: 'Picking', color: '#F1C40F' },
  { key: 'PICKED', label: 'Picked', color: '#3498DB' },
  { key: 'VERIFIED', label: 'Verified', color: '#27AE60' },
  { key: 'SHORT', label: 'Short', color: '#E74C3C' },
  { key: 'SUBSTITUTED', label: 'Substituted', color: '#9B59B6' },
]

interface MaterialPick {
  id: string
  sku: string
  description: string
  quantity: number
  pickedQty: number
  status: string
  zone: string | null
  job: {
    id: string
    jobNumber: string
    builderName: string
  }
  createdAt: string
}

interface ApiResponse {
  picks: MaterialPick[]
  total: number
  statusCounts: Record<string, number>
}

export default function PickListPage() {
  const [picks, setPicks] = useState<MaterialPick[]>([])
  const [statusCounts, setStatusCounts] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeFilter, setActiveFilter] = useState('ALL')
  const [groupByJob, setGroupByJob] = useState(false)
  const [updatingId, setUpdatingId] = useState<string | null>(null)
  const [toast, setToast] = useState('')
  const [toastType, setToastType] = useState<'success' | 'error'>('success')
  const showToast = (msg: string, type: 'success' | 'error' = 'success') => {
    setToast(msg); setToastType(type); setTimeout(() => setToast(''), 3500)
  }

  useEffect(() => {
    fetchPicks()
  }, [])

  const fetchPicks = async () => {
    try {
      setLoading(true)
      const response = await fetch('/api/ops/manufacturing/picks')
      if (!response.ok) {
        throw new Error('Failed to fetch picks')
      }
      const data: ApiResponse = await response.json()
      setPicks(data.picks || [])
      setStatusCounts(data.statusCounts || {})
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setLoading(false)
    }
  }

  const filteredPicks = picks.filter(
    (pick) => activeFilter === 'ALL' || pick.status === activeFilter
  )

  const groupedPicks = groupByJob
    ? filteredPicks.reduce(
        (acc, pick) => {
          const jobNum = pick.job.jobNumber
          if (!acc[jobNum]) {
            acc[jobNum] = { job: pick.job, picks: [] }
          }
          acc[jobNum].picks.push(pick)
          return acc
        },
        {} as Record<string, { job: MaterialPick['job']; picks: MaterialPick[] }>
      )
    : null

  const handleStatusChange = async (pickId: string, newStatus: string) => {
    try {
      setUpdatingId(pickId)
      const response = await fetch(`/api/ops/manufacturing/picks/${pickId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      })
      if (!response.ok) throw new Error('Failed to update pick')
      await fetchPicks()
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to update pick', 'error')
    } finally {
      setUpdatingId(null)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-[#0f2a3e]" />
          <p className="mt-4 text-fg-muted">Loading material picks...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {toast && (
        <div className={`fixed top-4 right-4 z-50 px-5 py-3 rounded-lg shadow-lg text-white text-sm font-medium transition-all ${toastType === 'success' ? 'bg-green-600' : 'bg-red-600'}`}>
          {toast}
        </div>
      )}
      <PageHeader
        title="Material Pick List"
        description="Manage warehouse picks for production jobs"
        actions={
          <Link
            href="/ops/manufacturing"
            className="text-sm md:text-xs text-[#0f2a3e] hover:underline inline-flex items-center min-h-[44px] md:min-h-0 px-2 md:px-0"
          >
            ← Back to Dashboard
          </Link>
        }
      />

      {/* Error message */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700">
          Error loading picks: {error}
        </div>
      )}

      {/* Controls */}
      <div className="bg-white rounded-xl border p-4 flex items-center gap-4 flex-wrap">
        <div className="flex gap-1">
          <button
            onClick={() => setGroupByJob(!groupByJob)}
            className={`px-4 py-2 min-h-[48px] md:min-h-[44px] text-base md:text-sm rounded-lg transition-colors ${
              groupByJob
                ? 'bg-[#0f2a3e] text-white'
                : 'bg-gray-100 text-fg-muted hover:bg-surface-muted'
            }`}
          >
            {groupByJob ? 'Grouped by Job' : 'All Picks'}
          </button>
        </div>
      </div>

      {/* Status filter pills */}
      <div className="flex gap-2 flex-wrap">
        <button
          onClick={() => setActiveFilter('ALL')}
          className={`px-4 py-2 min-h-[44px] text-sm md:text-xs rounded-full border transition-colors ${
            activeFilter === 'ALL'
              ? 'bg-[#0f2a3e] text-white border-transparent'
              : 'text-fg-muted border-border hover:border-border-strong bg-white'
          }`}
        >
          All Picks ({picks.length})
        </button>
        {PICK_STATUSES.map((status) => (
          <button
            key={status.key}
            onClick={() => setActiveFilter(status.key)}
            className={`px-4 py-2 min-h-[44px] text-sm md:text-xs rounded-full border transition-colors ${
              activeFilter === status.key
                ? 'text-white border-transparent'
                : 'text-fg-muted border-border hover:border-border-strong bg-white'
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

      {/* Picks Table */}
      {groupByJob && groupedPicks ? (
        // Grouped view
        <div className="space-y-4">
          {Object.entries(groupedPicks).map(([jobNum, { job, picks: jobPicks }]) => (
            <div key={jobNum} className="bg-white rounded-xl border overflow-hidden">
              <div className="bg-gray-50 px-4 py-3 border-b font-semibold text-fg text-base md:text-sm">
                {job.jobNumber} — {job.builderName}
              </div>
              {/* Desktop: table */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50 border-b">
                    <tr>
                      <th className="px-4 py-2 text-left text-xs font-semibold text-fg-muted">SKU</th>
                      <th className="px-4 py-2 text-left text-xs font-semibold text-fg-muted">Description</th>
                      <th className="px-4 py-2 text-left text-xs font-semibold text-fg-muted">Qty</th>
                      <th className="px-4 py-2 text-left text-xs font-semibold text-fg-muted">Picked</th>
                      <th className="px-4 py-2 text-left text-xs font-semibold text-fg-muted">Zone</th>
                      <th className="px-4 py-2 text-left text-xs font-semibold text-fg-muted">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {jobPicks.map((pick) => (
                      <PickRow
                        key={pick.id}
                        pick={pick}
                        onStatusChange={handleStatusChange}
                        isUpdating={updatingId === pick.id}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
              {/* Mobile: cards */}
              <div className="md:hidden divide-y">
                {jobPicks.map((pick) => (
                  <PickCard
                    key={pick.id}
                    pick={pick}
                    onStatusChange={handleStatusChange}
                    isUpdating={updatingId === pick.id}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        // List view
        <div className="bg-white rounded-xl border overflow-hidden">
          {filteredPicks.length === 0 ? (
            <EmptyState
              icon={<Factory className="w-8 h-8 text-fg-subtle" />}
              title="No jobs in production"
              description="No picks match the current filter."
            />
          ) : (
            <>
              {/* Desktop: table */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50 border-b">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-fg-muted">SKU</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-fg-muted">Description</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-fg-muted">Job</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-fg-muted">Builder</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-fg-muted">Qty</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-fg-muted">Picked</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-fg-muted">Zone</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-fg-muted">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {filteredPicks.map((pick) => (
                      <PickRow
                        key={pick.id}
                        pick={pick}
                        onStatusChange={handleStatusChange}
                        isUpdating={updatingId === pick.id}
                        showJobInfo
                      />
                    ))}
                  </tbody>
                </table>
              </div>
              {/* Mobile: cards */}
              <div className="md:hidden divide-y">
                {filteredPicks.map((pick) => (
                  <PickCard
                    key={pick.id}
                    pick={pick}
                    onStatusChange={handleStatusChange}
                    isUpdating={updatingId === pick.id}
                    showJobInfo
                  />
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

function PickCard({
  pick,
  onStatusChange,
  isUpdating,
  showJobInfo = false,
}: {
  pick: MaterialPick
  onStatusChange: (id: string, status: string) => void
  isUpdating: boolean
  showJobInfo?: boolean
}) {
  const statusConfig = PICK_STATUSES.find((s) => s.key === pick.status)
  const pickProgress = pick.quantity > 0 ? (pick.pickedQty / pick.quantity) * 100 : 0

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-mono text-fg break-all">{pick.sku}</p>
          <p className="text-sm text-fg-muted mt-1">{pick.description}</p>
        </div>
        <span
          className="shrink-0 px-2 py-1 rounded-full text-xs font-semibold text-white"
          style={{ backgroundColor: statusConfig?.color || '#95A5A6' }}
        >
          {statusConfig?.label || pick.status}
        </span>
      </div>

      {showJobInfo && (
        <div className="text-sm">
          <Link
            href={`/ops/jobs/${pick.job.id}`}
            className="text-[#0f2a3e] font-medium hover:underline inline-flex items-center min-h-[44px]"
          >
            {pick.job.jobNumber}
          </Link>
          <span className="text-fg-muted"> — {pick.job.builderName}</span>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <p className="text-xs text-fg-muted uppercase tracking-wide">Qty</p>
          <p className="text-base text-fg">{pick.quantity}</p>
        </div>
        <div>
          <p className="text-xs text-fg-muted uppercase tracking-wide">Zone</p>
          <p className="text-base text-fg">{pick.zone || '—'}</p>
        </div>
      </div>

      <div>
        <p className="text-xs text-fg-muted uppercase tracking-wide mb-1">
          Picked {pick.pickedQty}/{pick.quantity}
        </p>
        <div className="w-full bg-gray-200 rounded-full h-2">
          <div
            className="bg-signal h-2 rounded-full"
            style={{ width: `${pickProgress}%` }}
          />
        </div>
      </div>

      <div>
        <label className="text-xs text-fg-muted uppercase tracking-wide block mb-1">
          Update Status
        </label>
        <select
          value={pick.status}
          onChange={(e) => onStatusChange(pick.id, e.target.value)}
          disabled={isUpdating}
          className="w-full px-3 py-2 min-h-[48px] rounded-lg text-base font-medium border border-gray-300 focus:ring-2 focus:ring-[#0f2a3e]/20 focus:border-[#0f2a3e] disabled:opacity-50"
          style={{
            backgroundColor: statusConfig?.color || '#95A5A6',
            color: 'white',
          }}
        >
          {PICK_STATUSES.map((status) => (
            <option key={status.key} value={status.key} className="text-fg bg-white">
              {status.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  )
}

function PickRow({
  pick,
  onStatusChange,
  isUpdating,
  showJobInfo = false,
}: {
  pick: MaterialPick
  onStatusChange: (id: string, status: string) => void
  isUpdating: boolean
  showJobInfo?: boolean
}) {
  const statusConfig = PICK_STATUSES.find((s) => s.key === pick.status)
  const pickProgress = pick.quantity > 0 ? (pick.pickedQty / pick.quantity) * 100 : 0

  return (
    <tr className="hover:bg-row-hover">
      <td className="px-4 py-3 text-sm font-mono text-fg">{pick.sku}</td>
      <td className="px-4 py-3 text-sm text-fg-muted max-w-xs truncate">{pick.description}</td>
      {showJobInfo && (
        <>
          <td className="px-4 py-3 text-sm text-fg font-medium">
            <Link
              href={`/ops/jobs/${pick.job.id}`}
              className="text-[#0f2a3e] hover:underline"
            >
              {pick.job.jobNumber}
            </Link>
          </td>
          <td className="px-4 py-3 text-sm text-fg-muted">{pick.job.builderName}</td>
        </>
      )}
      <td className="px-4 py-3 text-sm text-fg-muted">{pick.quantity}</td>
      <td className="px-4 py-3">
        <div className="w-24">
          <div className="w-full bg-gray-200 rounded-full h-2">
            <div
              className="bg-signal h-2 rounded-full"
              style={{ width: `${pickProgress}%` }}
            />
          </div>
          <p className="text-xs text-fg-muted mt-1">{pick.pickedQty}/{pick.quantity}</p>
        </div>
      </td>
      <td className="px-4 py-3 text-sm text-fg-muted">{pick.zone || '—'}</td>
      <td className="px-4 py-3">
        <select
          value={pick.status}
          onChange={(e) => onStatusChange(pick.id, e.target.value)}
          disabled={isUpdating}
          className="px-2 py-1 min-h-[44px] rounded text-sm font-medium border border-gray-300 focus:ring-2 focus:ring-[#0f2a3e]/20 focus:border-[#0f2a3e] disabled:opacity-50"
          style={{
            backgroundColor: statusConfig?.color || '#95A5A6',
            color: 'white',
          }}
        >
          {PICK_STATUSES.map((status) => (
            <option key={status.key} value={status.key} className="text-fg bg-white">
              {status.label}
            </option>
          ))}
        </select>
      </td>
    </tr>
  )
}
