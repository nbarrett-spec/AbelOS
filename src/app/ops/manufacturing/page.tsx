'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'

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

export default function ManufacturingDashboard() {
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

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
  }, [])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-[#0f2a3e]" />
          <p className="mt-4 text-gray-600">Loading manufacturing dashboard...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Manufacturing Dashboard</h1>
          <p className="text-sm text-gray-500 mt-1">
            Production floor overview — track jobs, picks, and quality
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/ops/manufacturing/build-sheet" className="px-4 py-2 bg-[#0f2a3e] text-white rounded-lg hover:bg-[#0a1a28] text-sm font-medium">
            Build Sheet
          </Link>
          <Link href="/ops/manufacturing/bom" className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 text-sm font-medium">
            Manage BOMs
          </Link>
        </div>
      </div>

      {/* Error message */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700">
          Error loading dashboard: {error}
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
              <h2 className="text-lg font-bold text-gray-900">Production Queue</h2>
              <Link
                href="/ops/manufacturing/picks"
                className="text-xs text-[#0f2a3e] hover:underline"
              >
                View All →
              </Link>
            </div>
            <div className="space-y-2">
              {data.productionQueue.length === 0 ? (
                <p className="text-sm text-gray-500 py-4">No jobs in production</p>
              ) : (
                data.productionQueue.slice(0, 5).map((job) => (
                  <Link
                    key={job.id}
                    href={`/ops/jobs/${job.id}`}
                    className="flex items-start justify-between p-3 bg-gray-50 rounded-lg border border-gray-200 hover:bg-blue-50 hover:border-blue-300 transition-colors cursor-pointer no-underline"
                  >
                    <div className="flex-1">
                      <p className="text-sm font-semibold text-gray-900">{job.jobNumber}</p>
                      <p className="text-xs text-gray-600">{job.builderName}</p>
                      {job.community && (
                        <p className="text-xs text-gray-500">{job.community}</p>
                      )}
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-gray-600">
                        {new Date(job.scheduledDate).toLocaleDateString()}
                      </p>
                      <span className="inline-block mt-1 px-2 py-0.5 rounded text-xs font-medium bg-[#9B59B6]/10 text-[#9B59B6]">
                        {job.status === 'IN_PRODUCTION' ? 'Production' : 'Staged'}
                      </span>
                    </div>
                  </Link>
                ))
              )}
            </div>
          </div>

          {/* Material Pick Status */}
          <div className="bg-white rounded-xl border p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-gray-900">Material Pick Status</h2>
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
              <h2 className="text-lg font-bold text-gray-900">Recent Quality Checks</h2>
              <Link
                href="/ops/manufacturing/qc"
                className="text-xs text-[#0f2a3e] hover:underline"
              >
                QC Details →
              </Link>
            </div>
            {data.qualityCheckSummary.recentChecks.length === 0 ? (
              <p className="text-sm text-gray-500 py-4">No recent quality checks</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b bg-gray-50">
                    <tr>
                      <th className="text-left py-2 px-3 font-semibold text-gray-700">Job</th>
                      <th className="text-left py-2 px-3 font-semibold text-gray-700">Type</th>
                      <th className="text-left py-2 px-3 font-semibold text-gray-700">Result</th>
                      <th className="text-left py-2 px-3 font-semibold text-gray-700">Date</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {data.qualityCheckSummary.recentChecks.slice(0, 5).map((check) => (
                      <tr key={check.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => window.location.href = `/ops/jobs/${check.jobId}`}>
                        <td className="py-2 px-3 text-gray-900 font-medium hover:text-[#0f2a3e] hover:underline">{check.jobNumber}</td>
                        <td className="py-2 px-3 text-gray-600">{check.checkType.replace(/_/g, ' ')}</td>
                        <td className="py-2 px-3">
                          <span
                            className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
                              check.result === 'PASS'
                                ? 'bg-green-100 text-green-700'
                                : check.result === 'FAIL'
                                  ? 'bg-red-100 text-red-700'
                                  : 'bg-yellow-100 text-yellow-700'
                            }`}
                          >
                            {check.result}
                          </span>
                        </td>
                        <td className="py-2 px-3 text-gray-600 text-xs">
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
          <p className="text-xs text-gray-600 mb-1">{label}</p>
          <p className={`text-2xl font-bold ${textColor}`}>{value}</p>
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
      <span className="text-sm text-gray-700">{label}</span>
      <span className={`px-3 py-1 rounded-lg font-semibold text-sm text-gray-900 ${color}`}>
        {count}
      </span>
    </div>
  )
}
