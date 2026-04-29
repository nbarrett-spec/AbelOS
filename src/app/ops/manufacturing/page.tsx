'use client'

import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import { Factory } from 'lucide-react'
import EmptyState from '@/components/ui/EmptyState'
import PageHeader from '@/components/ui/PageHeader'
import { Badge, getStatusBadgeVariant } from '@/components/ui/Badge'
import { useManufacturingToast } from '@/hooks/useManufacturingToast'

interface DashboardData {
  productionQueue: {
    id: string
    jobNumber: string
    builderName: string
    community: string
    scheduledDate: string
    status: string
  }[]
  materialPickSummary: {
    pending: number
    picking: number
    picked: number
    verified: number
    short: number
  }
  qualityCheckSummary: {
    recentChecks: {
      id: string
      jobId: string
      jobNumber: string
      checkType: string
      result: string
      createdAt: string
    }[]
    passRate: number
  }
  todaysProduction: {
    jobsInProduction: number
    itemsStaged: number
    qcPassRate: number
    picksPending: number
  }
  kpis: {
    jobsInProduction: number
    picksPending: number
    qcPassRate: number
    itemsStaged: number
  }
}

interface BomCoverageData {
  coverage: {
    total: number
    withBom: number
    percentage: number
  }
  missingBom: { productId: string; sku: string; name: string; category: string }[]
  brokenComponents: { parentSku: string; componentSku: string; issue: string }[]
}

export default function ManufacturingDashboard() {
  const [data, setData] = useState<DashboardData | null>(null)
  const [bomCoverage, setBomCoverage] = useState<BomCoverageData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [qcBlockedCount, setQcBlockedCount] = useState<number>(0)

  const toast = useManufacturingToast()
  // Snapshot of last-seen state for diffing on each poll. `null` = haven't
  // seen the first response yet; we skip diffing on the very first tick so
  // we don't fire toasts for state that already existed when the page loaded.
  const lastSnapshotRef = useRef<{
    qcFailIds: Set<string>
    shortCount: number
    jobStatusByNumber: Map<string, string>
  } | null>(null)
  // Guard so a slow poll doesn't double-fire if 30s elapses mid-flight.
  const pollInFlightRef = useRef(false)

  useEffect(() => {
    const fetchDashboard = async () => {
      try {
        setLoading(true)
        const response = await fetch('/api/ops/manufacturing/dashboard')
        if (!response.ok) {
          throw new Error('Failed to fetch dashboard data')
        }
        const result = await response.json()
        setData(result)
        setError(null)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'An error occurred')
        setData(null)
      } finally {
        setLoading(false)
      }
    }

    fetchDashboard()

    // Count jobs blocked by failing QC (fire-and-forget).
    fetch('/api/ops/inspections?status=FAIL&limit=100')
      .then((r) => (r.ok ? r.json() : { inspections: [] }))
      .then((d) => {
        const unique = new Set((d.inspections || []).map((i: any) => i.jobId).filter(Boolean))
        setQcBlockedCount(unique.size)
      })
      .catch(() => setQcBlockedCount(0))

    // Fetch BOM coverage (fire-and-forget).
    fetch('/api/ops/manufacturing/bom-audit')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setBomCoverage(d))
      .catch(() => setBomCoverage(null))
  }, [])

  // Real-time alerts: poll the dashboard every 30s and fire toasts for new
  // QC fails, fresh material shortages, or status advances. Reuses the
  // existing dashboard endpoint — no new API.
  useEffect(() => {
    let cancelled = false

    const tick = async () => {
      if (pollInFlightRef.current) return
      pollInFlightRef.current = true
      try {
        const response = await fetch('/api/ops/manufacturing/dashboard')
        if (!response.ok) return
        const result: DashboardData = await response.json()
        if (cancelled) return

        const qcFailIds = new Set(
          result.qualityCheckSummary.recentChecks
            .filter((c) => c.result === 'FAIL')
            .map((c) => c.id)
        )
        const shortCount = result.materialPickSummary.short
        const jobStatusByNumber = new Map(
          result.productionQueue.map((j) => [j.jobNumber, j.status] as const)
        )

        const prev = lastSnapshotRef.current
        if (prev) {
          // New QC fails since last snapshot -> red toast per job.
          for (const check of result.qualityCheckSummary.recentChecks) {
            if (check.result === 'FAIL' && !prev.qcFailIds.has(check.id)) {
              toast.qcFail(check.jobNumber)
            }
          }

          // Net-new shortages -> yellow toast. We don't have per-SKU detail
          // on this endpoint, so surface an aggregate notice with the delta.
          if (shortCount > prev.shortCount) {
            const delta = shortCount - prev.shortCount
            toast.materialShort('multiple', `${delta} new pick${delta === 1 ? '' : 's'} short`)
          }

          // Status advances within the production queue -> green toast.
          for (const [jobNumber, status] of jobStatusByNumber) {
            const prevStatus = prev.jobStatusByNumber.get(jobNumber)
            if (prevStatus && prevStatus !== status) {
              toast.jobAdvanced(jobNumber, status)
            }
          }
        }

        lastSnapshotRef.current = { qcFailIds, shortCount, jobStatusByNumber }

        // Keep the page state in sync so banners/KPIs reflect the poll too.
        setData(result)
      } catch {
        // Silent — toasts shouldn't error-spam the user.
      } finally {
        pollInFlightRef.current = false
      }
    }

    const id = setInterval(tick, 30_000)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [toast])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-[#0f2a3e]" />
          <p className="mt-4 text-fg-muted">Loading manufacturing dashboard...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Manufacturing Dashboard"
        description="Production floor overview — track jobs, picks, and quality"
        actions={
          <>
            <Link href="/ops/manufacturing/build-sheet" className="px-4 py-2 bg-[#0f2a3e] text-white rounded-lg hover:bg-[#0a1a28] text-sm font-medium">
              Build Sheet
            </Link>
            <Link href="/ops/manufacturing/bom" className="px-4 py-2 border border-border rounded-lg hover:bg-row-hover text-sm font-medium">
              Manage BOMs
            </Link>
          </>
        }
      />

      {/* Error message */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700">
          Error loading dashboard: {error}
        </div>
      )}

      {/* QC-blocked banner */}
      {qcBlockedCount > 0 && (
        <div className="bg-red-50 border border-red-300 rounded-xl p-4 flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-red-800">
              QC FAIL — {qcBlockedCount} job{qcBlockedCount === 1 ? '' : 's'} blocked from advancement.
            </p>
            <p className="text-xs text-red-700 mt-0.5">
              These jobs have an unresolved failing inspection and cannot ship until re-inspected.
            </p>
          </div>
          <Link
            href="/ops/portal/qc/queue"
            className="px-3 py-1.5 bg-[#C0392B] text-white rounded text-sm font-medium hover:bg-[#A93226]"
          >
            Review Queue
          </Link>
        </div>
      )}

      {/* KPI Cards */}
      {data && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <KPICard
            label="Jobs in Production"
            value={data.kpis.jobsInProduction}
            icon="🏭"
            color="bg-blue-50 border-blue-200"
            textColor="text-blue-700"
          />
          <KPICard
            label="Picks Pending"
            value={data.kpis.picksPending}
            icon="📋"
            color="bg-yellow-50 border-yellow-200"
            textColor="text-yellow-700"
          />
          <KPICard
            label="QC Pass Rate"
            value={`${Math.round(data.kpis.qcPassRate * 100)}%`}
            icon="✅"
            color="bg-green-50 border-green-200"
            textColor="text-green-700"
          />
          <KPICard
            label="Items Staged"
            value={data.kpis.itemsStaged}
            icon="📦"
            color="bg-orange-50 border-orange-200"
            textColor="text-orange-700"
          />
        </div>
      )}

      {data && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Production Queue */}
          <div className="bg-white rounded-xl border p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-fg">Production Queue</h2>
              <Link
                href="/ops/manufacturing/picks"
                className="text-xs text-[#0f2a3e] hover:underline"
              >
                View All →
              </Link>
            </div>
            <div className="space-y-2">
              {data.productionQueue.length === 0 ? (
                <EmptyState
                  size="compact"
                  icon={<Factory className="w-6 h-6 text-fg-subtle" />}
                  title="No jobs in production"
                />
              ) : (
                data.productionQueue.slice(0, 5).map((job) => (
                  <Link
                    key={job.id}
                    href={`/ops/jobs/${job.id}`}
                    className="flex items-start justify-between p-3 bg-gray-50 rounded-lg border border-gray-200 hover:bg-blue-50 hover:border-blue-300 transition-colors cursor-pointer no-underline"
                  >
                    <div className="flex-1">
                      <p className="text-sm font-semibold text-fg">{job.jobNumber}</p>
                      <p className="text-xs text-fg-muted">{job.builderName}</p>
                      {job.community && (
                        <p className="text-xs text-fg-subtle">{job.community}</p>
                      )}
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-fg-muted">
                        {new Date(job.scheduledDate).toLocaleDateString()}
                      </p>
                      <Badge variant={getStatusBadgeVariant(job.status)} size="xs" className="mt-1">
                        {job.status === 'IN_PRODUCTION' ? 'Production' : 'Staged'}
                      </Badge>
                    </div>
                  </Link>
                ))
              )}
            </div>
          </div>

          {/* BOM Coverage */}
          {bomCoverage && (
            <div className="bg-white rounded-xl border p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-fg">BOM Coverage</h2>
                <Link
                  href="/ops/manufacturing/bom"
                  className="text-xs text-[#0f2a3e] hover:underline"
                >
                  Details →
                </Link>
              </div>
              <div className="space-y-3">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm text-fg-muted">Coverage</span>
                    <span className="font-semibold text-fg">
                      {bomCoverage.coverage.withBom}/{bomCoverage.coverage.total}
                    </span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div
                      className="bg-green-500 h-2 rounded-full transition-all"
                      style={{ width: `${Math.min(100, bomCoverage.coverage.percentage)}%` }}
                    />
                  </div>
                  <p className="text-xs text-fg-muted mt-1">
                    {Math.round(bomCoverage.coverage.percentage)}% of assembly products have BOMs
                  </p>
                </div>
                {bomCoverage.missingBom.length > 0 && (
                  <div className="bg-yellow-50 border border-yellow-200 rounded p-2">
                    <p className="text-xs font-semibold text-yellow-800">
                      {bomCoverage.missingBom.length} product{bomCoverage.missingBom.length !== 1 ? 's' : ''} missing BOMs
                    </p>
                  </div>
                )}
                {bomCoverage.brokenComponents.length > 0 && (
                  <div className="bg-red-50 border border-red-200 rounded p-2">
                    <p className="text-xs font-semibold text-red-800">
                      {bomCoverage.brokenComponents.length} broken component{bomCoverage.brokenComponents.length !== 1 ? 's' : ''}
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Material Pick Status */}
          <div className="bg-white rounded-xl border p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-fg">Material Pick Status</h2>
              <Link
                href="/ops/manufacturing/picks"
                className="text-xs text-[#0f2a3e] hover:underline"
              >
                Manage Picks →
              </Link>
            </div>
            <div className="space-y-3">
              <PickStatusRow label="Pending" count={data.materialPickSummary.pending} color="bg-gray-100" />
              <PickStatusRow label="Picking" count={data.materialPickSummary.picking} color="bg-yellow-100" />
              <PickStatusRow label="Picked" count={data.materialPickSummary.picked} color="bg-blue-100" />
              <PickStatusRow label="Verified" count={data.materialPickSummary.verified} color="bg-green-100" />
              <PickStatusRow label="Short" count={data.materialPickSummary.short} color="bg-red-100" />
            </div>
          </div>

          {/* QC Summary */}
          <div className="bg-white rounded-xl border p-6 lg:col-span-2">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-fg">Recent Quality Checks</h2>
              <Link
                href="/ops/manufacturing/qc"
                className="text-xs text-[#0f2a3e] hover:underline"
              >
                QC Details →
              </Link>
            </div>
            {data.qualityCheckSummary.recentChecks.length === 0 ? (
              <p className="text-sm text-fg-muted py-4">No recent quality checks</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b bg-gray-50">
                    <tr>
                      <th className="text-left py-2 px-3 font-semibold text-fg-muted">Job</th>
                      <th className="text-left py-2 px-3 font-semibold text-fg-muted">Type</th>
                      <th className="text-left py-2 px-3 font-semibold text-fg-muted">Result</th>
                      <th className="text-left py-2 px-3 font-semibold text-fg-muted">Date</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {data.qualityCheckSummary.recentChecks.slice(0, 5).map((check) => (
                      <tr key={check.id} className="hover:bg-row-hover cursor-pointer" onClick={() => window.location.href = `/ops/jobs/${check.jobId}`}>
                        <td className="py-2 px-3 text-fg font-medium hover:text-[#0f2a3e] hover:underline">{check.jobNumber}</td>
                        <td className="py-2 px-3 text-fg-muted">{check.checkType.replace(/_/g, ' ')}</td>
                        <td className="py-2 px-3">
                          <Badge variant={getStatusBadgeVariant(check.result)} size="xs">
                            {check.result}
                          </Badge>
                        </td>
                        <td className="py-2 px-3 text-fg-muted text-xs">
                          {new Date(check.createdAt).toLocaleDateString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function KPICard({
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

function PickStatusRow({
  label,
  count,
  color,
}: {
  label: string
  count: number
  color: string
}) {
  return (
    <div className="flex items-center justify-between p-2">
      <span className="text-sm text-fg-muted">{label}</span>
      <span className={`px-3 py-1 rounded-lg font-semibold text-sm text-fg ${color}`}>
        {count}
      </span>
    </div>
  )
}
