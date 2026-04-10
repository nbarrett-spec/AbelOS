'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

interface BriefingData {
  summary: {
    jobsInProduction: number
    picksToComplete: number
    qcChecksNeeded: number
    itemsToStage: number
    materialsArriving: number
    exceptions: number
  }
  productionQueue: Array<{
    id: string
    jobNumber: string
    builderName: string
    community: string
    status: string
    scheduledDate: string
    picksRemaining: number
    picksCompleted: number
  }>
  pendingPicks: Array<{
    id: string
    jobId: string
    jobNumber: string
    itemCount: number
    priority: number
    createdAt: string
    status: string
  }>
  qcNeeded: Array<{
    id: string
    jobNumber: string
    builderName: string
    productCount: number
    scheduledDate: string
  }>
  stagingReady: Array<{
    id: string
    jobNumber: string
    builderName: string
    community: string
    itemCount: number
    scheduledDate: string
  }>
  materialsArriving: Array<{
    id: string
    poNumber: string
    vendor: { id: string; name: string }
    itemCount: number
    totalAmount: number
    expectedDate: string
  }>
  exceptions: Array<{
    type: string
    jobNumber: string
    id: string
    severity: string
    count: number
    description: string
  }>
}

export default function WarehouseBriefingPage() {
  const [briefing, setBriefing] = useState<BriefingData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function loadBriefing() {
      try {
        const res = await fetch('/api/ops/warehouse-briefing')
        if (res.ok) {
          const data = await res.json()
          setBriefing(data)
        }
      } catch (error) {
        console.error('Failed to load warehouse briefing:', error)
      } finally {
        setLoading(false)
      }
    }

    loadBriefing()
  }, [])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#27AE60]" />
      </div>
    )
  }

  if (!briefing) {
    return (
      <div className="text-center py-12 text-gray-500">
        <p>Failed to load briefing</p>
      </div>
    )
  }

  const dateStr = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'critical':
        return 'bg-red-100 border-red-300 text-red-800'
      case 'warning':
        return 'bg-yellow-100 border-yellow-300 text-yellow-800'
      default:
        return 'bg-blue-100 border-blue-300 text-blue-800'
    }
  }

  const getSeverityIcon = (severity: string) => {
    switch (severity) {
      case 'critical':
        return '🚨'
      case 'warning':
        return '⚠️'
      default:
        return 'ℹ️'
    }
  }

  return (
    <div className="space-y-6">
      {/* Header with greeting and date */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Shift Briefing</h1>
          <p className="text-gray-600 mt-1">{dateStr}</p>
        </div>
        <Link
          href="/ops/portal/warehouse"
          className="px-4 py-2 bg-gray-200 text-gray-900 rounded-lg hover:bg-gray-300 transition-colors text-sm font-medium"
        >
          ← Back to Dashboard
        </Link>
      </div>

      {/* KPI Cards - 6 columns */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-4">
        <div className="bg-white rounded-xl border border-l-4 border-l-[#27AE60] p-4">
          <p className="text-xs text-gray-500 uppercase tracking-wide">
            In Production
          </p>
          <p className="text-2xl font-bold text-gray-900 mt-1">
            {briefing.summary.jobsInProduction}
          </p>
          <p className="text-xs text-gray-400 mt-1">Jobs</p>
        </div>

        <div className="bg-white rounded-xl border border-l-4 border-l-blue-500 p-4">
          <p className="text-xs text-gray-500 uppercase tracking-wide">
            Picks to Complete
          </p>
          <p className="text-2xl font-bold text-blue-600 mt-1">
            {briefing.summary.picksToComplete}
          </p>
          <p className="text-xs text-gray-400 mt-1">Pick lists</p>
        </div>

        <div className="bg-white rounded-xl border border-l-4 border-l-purple-500 p-4">
          <p className="text-xs text-gray-500 uppercase tracking-wide">
            QC Checks
          </p>
          <p className="text-2xl font-bold text-purple-600 mt-1">
            {briefing.summary.qcChecksNeeded}
          </p>
          <p className="text-xs text-gray-400 mt-1">Ready</p>
        </div>

        <div className="bg-white rounded-xl border border-l-4 border-l-orange-500 p-4">
          <p className="text-xs text-gray-500 uppercase tracking-wide">
            Ready to Stage
          </p>
          <p className="text-2xl font-bold text-orange-600 mt-1">
            {briefing.summary.itemsToStage}
          </p>
          <p className="text-xs text-gray-400 mt-1">Jobs</p>
        </div>

        <div className="bg-white rounded-xl border border-l-4 border-l-green-600 p-4">
          <p className="text-xs text-gray-500 uppercase tracking-wide">
            Materials Today
          </p>
          <p className="text-2xl font-bold text-green-600 mt-1">
            {briefing.summary.materialsArriving}
          </p>
          <p className="text-xs text-gray-400 mt-1">Deliveries</p>
        </div>

        <div className="bg-white rounded-xl border border-l-4 border-l-red-600 p-4">
          <p className="text-xs text-gray-500 uppercase tracking-wide">
            Exceptions
          </p>
          <p className="text-2xl font-bold text-red-600 mt-1">
            {briefing.summary.exceptions}
          </p>
          <p className="text-xs text-gray-400 mt-1">Issues</p>
        </div>
      </div>

      {/* Exceptions Board (Most Important) */}
      {briefing.exceptions.length > 0 && (
        <div className="bg-gradient-to-r from-red-50 to-orange-50 border-2 border-red-300 rounded-xl p-6">
          <h2 className="text-lg font-bold text-red-800 mb-4">
            🚨 Production Exceptions ({briefing.exceptions.length})
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {briefing.exceptions.map((exc, idx) => (
              <div
                key={idx}
                className={`rounded-lg border-2 p-4 ${getSeverityColor(exc.severity)}`}
              >
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <p className="text-sm font-bold">{exc.type.replace(/_/g, ' ')}</p>
                    <Link
                      href={`/ops/manufacturing/jobs/${exc.id}`}
                      className="text-sm font-semibold text-[#27AE60] hover:text-[#1E8449] mt-1"
                    >
                      {exc.jobNumber}
                    </Link>
                  </div>
                  <span className="text-2xl">{getSeverityIcon(exc.severity)}</span>
                </div>
                <p className="text-sm mt-2">{exc.description}</p>
                {exc.count > 1 && (
                  <p className="text-xs mt-2 font-semibold opacity-80">
                    {exc.count} items affected
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Production Queue */}
      <div className="bg-white rounded-xl border p-6">
        <h2 className="text-lg font-bold text-gray-900 mb-4">
          Production Queue ({briefing.productionQueue.length})
        </h2>

        {briefing.productionQueue.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            <p>No jobs in production today</p>
          </div>
        ) : (
          <div className="space-y-3">
            {briefing.productionQueue.map((job) => {
              const pickProgress =
                job.picksCompleted + job.picksRemaining > 0
                  ? (job.picksCompleted /
                      (job.picksCompleted + job.picksRemaining)) *
                    100
                  : 0
              return (
                <div
                  key={job.id}
                  className="p-4 rounded-lg border border-gray-200 hover:border-[#27AE60] transition-all"
                >
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <Link
                        href={`/ops/manufacturing/jobs/${job.id}`}
                        className="font-semibold text-[#27AE60] hover:text-[#1E8449]"
                      >
                        {job.jobNumber}
                      </Link>
                      <p className="text-sm text-gray-700 mt-1">
                        {job.builderName} · {job.community}
                      </p>
                    </div>
                    <span
                      className={`text-xs px-2 py-1 rounded font-semibold ${
                        job.status === 'IN_PRODUCTION'
                          ? 'bg-blue-100 text-blue-800'
                          : 'bg-green-100 text-green-800'
                      }`}
                    >
                      {job.status === 'IN_PRODUCTION'
                        ? 'In Production'
                        : 'Ready to Stage'}
                    </span>
                  </div>

                  {/* Pick progress bar */}
                  <div className="mt-3">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs text-gray-600">Pick Progress</span>
                      <span className="text-xs font-semibold text-gray-900">
                        {job.picksCompleted} / {job.picksCompleted + job.picksRemaining}
                      </span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-2">
                      <div
                        className={`h-2 rounded-full transition-all ${
                          pickProgress < 50
                            ? 'bg-red-500'
                            : pickProgress < 100
                              ? 'bg-yellow-500'
                              : 'bg-green-500'
                        }`}
                        style={{ width: `${Math.min(pickProgress, 100)}%` }}
                      />
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Two Column: Pending Picks | QC Queue */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Pending Picks */}
        <div className="bg-white rounded-xl border p-6">
          <h2 className="text-lg font-bold text-gray-900 mb-4">
            Pending Picks ({briefing.pendingPicks.length})
          </h2>

          {briefing.pendingPicks.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              <p>All picks completed</p>
            </div>
          ) : (
            <div className="space-y-3">
              {briefing.pendingPicks.map((pick) => (
                <div
                  key={pick.id}
                  className="p-4 rounded-lg border border-blue-200 bg-blue-50 hover:border-blue-300 transition-colors"
                >
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <Link
                        href={`/ops/manufacturing/jobs/${pick.jobId}`}
                        className="font-semibold text-[#27AE60] hover:text-[#1E8449]"
                      >
                        {pick.jobNumber}
                      </Link>
                      <p className="text-xs text-gray-600 mt-1">
                        Priority: {pick.priority}
                      </p>
                    </div>
                    <span className="text-xs px-2 py-1 rounded bg-blue-200 text-blue-800 font-semibold">
                      {pick.itemCount} items
                    </span>
                  </div>
                  <p className="text-xs text-gray-500">
                    Created: {new Date(pick.createdAt).toLocaleTimeString()}
                  </p>
                  <button className="mt-3 w-full px-3 py-2 text-sm font-medium rounded border border-blue-300 text-blue-700 hover:bg-blue-100 transition-colors">
                    Start Picking
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* QC Queue */}
        <div className="bg-white rounded-xl border p-6">
          <h2 className="text-lg font-bold text-gray-900 mb-4">
            QC Queue ({briefing.qcNeeded.length})
          </h2>

          {briefing.qcNeeded.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              <p>No jobs waiting for QC</p>
            </div>
          ) : (
            <div className="space-y-3">
              {briefing.qcNeeded.map((job) => (
                <div
                  key={job.id}
                  className="p-4 rounded-lg border border-purple-200 bg-purple-50 hover:border-purple-300 transition-colors"
                >
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <Link
                        href={`/ops/manufacturing/jobs/${job.id}`}
                        className="font-semibold text-[#27AE60] hover:text-[#1E8449]"
                      >
                        {job.jobNumber}
                      </Link>
                      <p className="text-sm text-gray-700 mt-1">
                        {job.builderName}
                      </p>
                    </div>
                    <span className="text-xs px-2 py-1 rounded bg-purple-200 text-purple-800 font-semibold">
                      {job.productCount} items
                    </span>
                  </div>
                  <button className="mt-3 w-full px-3 py-2 text-sm font-medium rounded border border-purple-300 text-purple-700 hover:bg-purple-100 transition-colors">
                    Start QC Inspection
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Materials Arriving */}
      {briefing.materialsArriving.length > 0 && (
        <div className="bg-white rounded-xl border p-6">
          <h2 className="text-lg font-bold text-gray-900 mb-4">
            Materials Arriving Today ({briefing.materialsArriving.length})
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {briefing.materialsArriving.map((material) => (
              <div
                key={material.id}
                className="p-4 rounded-lg border border-green-200 bg-green-50"
              >
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <p className="font-semibold text-gray-900 text-sm">
                      {material.vendor.name}
                    </p>
                    <Link
                      href={`/ops/purchasing/${material.id}`}
                      className="text-sm text-[#27AE60] hover:text-[#1E8449] font-mono mt-1"
                    >
                      {material.poNumber}
                    </Link>
                  </div>
                  <span className="text-xs px-2 py-1 rounded bg-green-200 text-green-800 font-semibold">
                    {material.itemCount} items
                  </span>
                </div>
                <p className="text-sm font-semibold text-gray-900 mt-3">
                  ${material.totalAmount.toLocaleString('en-US', {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </p>
                <p className="text-xs text-gray-500 mt-2">
                  Expected:{' '}
                  {new Date(material.expectedDate).toLocaleTimeString()}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Staging Ready */}
      {briefing.stagingReady.length > 0 && (
        <div className="bg-white rounded-xl border p-6">
          <h2 className="text-lg font-bold text-gray-900 mb-4">
            Ready for Staging ({briefing.stagingReady.length})
          </h2>
          <div className="space-y-3">
            {briefing.stagingReady.map((job) => (
              <div
                key={job.id}
                className="p-4 rounded-lg border border-orange-200 bg-orange-50 hover:border-orange-300 transition-colors"
              >
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <Link
                      href={`/ops/manufacturing/jobs/${job.id}`}
                      className="font-semibold text-[#27AE60] hover:text-[#1E8449]"
                    >
                      {job.jobNumber}
                    </Link>
                    <p className="text-sm text-gray-700 mt-1">
                      {job.builderName} · {job.community}
                    </p>
                  </div>
                  <span className="text-xs px-2 py-1 rounded bg-orange-200 text-orange-800 font-semibold">
                    {job.itemCount} items
                  </span>
                </div>
                <button className="mt-3 w-full px-3 py-2 text-sm font-medium rounded bg-orange-500 text-white hover:bg-orange-600 transition-colors">
                  Prepare for Staging
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
