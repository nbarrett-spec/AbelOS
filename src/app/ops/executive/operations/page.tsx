'use client'

import { useEffect, useState } from 'react'

interface OperationsData {
  crewUtilization: Array<{
    crewId: string
    crewName: string
    scheduled: number
    inProgress: number
    completed: number
  }>
  scheduleHeatmap: Array<{
    date: string
    deliveries: number
    installations: number
    total: number
  }>
  jobVelocity: Array<{
    status: string
    avgDays: number
  }>
  exceptions: Array<{
    id: string
    jobNumber: string | null
    noteType: string
    subject: string
    author: string | null
    createdAt: string
  }>
  vendorPerformance: Array<{
    vendorId: string
    vendorName: string
    onTimeRate: number
    avgLeadDays: number
    totalOrders: number
    openPOValue: number
  }>
}

const COLORS = ['#3E2A1E', '#C9822B', '#27AE60', '#3498DB', '#8E44AD', '#E74C3C']

export default function OperationsDashboard() {
  const [data, setData] = useState<OperationsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchData()
  }, [])

  const fetchData = async () => {
    try {
      const response = await fetch('/api/ops/executive/operations')
      if (!response.ok) throw new Error('Failed to fetch data')
      const result = await response.json()
      setData(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 0,
    }).format(value)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-gray-500">Loading operations data...</div>
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-red-500">Error: {error || 'No data'}</div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Operations Manager View</h1>
        <p className="text-gray-500 mt-1">
          Crew utilization, schedule heatmap, job velocity, and exceptions
        </p>
      </div>

      {/* Crew Utilization */}
      <div className="bg-white rounded-lg shadow p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">
          Crew Utilization (Next 2 Weeks)
        </h3>
        <div className="space-y-6">
          {data.crewUtilization.map((crew) => {
            const total = crew.scheduled + crew.inProgress + crew.completed
            return (
              <div key={crew.crewId}>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-gray-700">{crew.crewName}</span>
                  <span className="text-xs text-gray-500">{total} total</span>
                </div>
                <div className="flex gap-1 h-6 bg-gray-100 rounded overflow-hidden">
                  <div
                    className="bg-[#3498DB] transition-all"
                    style={{ width: `${(crew.scheduled / total) * 100}%` }}
                    title={`Scheduled: ${crew.scheduled}`}
                  ></div>
                  <div
                    className="bg-[#C9822B] transition-all"
                    style={{ width: `${(crew.inProgress / total) * 100}%` }}
                    title={`In Progress: ${crew.inProgress}`}
                  ></div>
                  <div
                    className="bg-[#27AE60] transition-all"
                    style={{ width: `${(crew.completed / total) * 100}%` }}
                    title={`Completed: ${crew.completed}`}
                  ></div>
                </div>
              </div>
            )
          })}
          <div className="flex gap-6 justify-center text-xs pt-4 border-t">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 bg-[#3498DB] rounded"></div>
              <span>Scheduled</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 bg-[#C9822B] rounded"></div>
              <span>In Progress</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 bg-[#27AE60] rounded"></div>
              <span>Completed</span>
            </div>
          </div>
        </div>
      </div>

      {/* Schedule Heatmap */}
      <div className="bg-white rounded-lg shadow p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">
          Schedule Density Heatmap
        </h3>
        <div className="mb-6 space-y-3">
          {data.scheduleHeatmap.map((day) => {
            const maxTotal = Math.max(...data.scheduleHeatmap.map(d => d.total))
            const percentage = (day.total / maxTotal) * 100
            return (
              <div key={day.date}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-medium text-gray-700">{day.date}</span>
                  <span className="text-sm font-semibold text-gray-900">{day.total}</span>
                </div>
                <div className="flex gap-1 h-6 bg-gray-100 rounded overflow-hidden">
                  <div
                    className="bg-[#3E2A1E] transition-all"
                    style={{ width: `${(day.deliveries / day.total) * 100}%` }}
                    title={`Deliveries: ${day.deliveries}`}
                  ></div>
                  <div
                    className="bg-[#27AE60] transition-all"
                    style={{ width: `${(day.installations / day.total) * 100}%` }}
                    title={`Installations: ${day.installations}`}
                  ></div>
                </div>
              </div>
            )
          })}
        </div>
        <div className="flex gap-6 justify-center text-xs pt-4 border-t mb-4">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 bg-[#3E2A1E] rounded"></div>
            <span>Deliveries</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 bg-[#27AE60] rounded"></div>
            <span>Installations</span>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-4">
          {data.scheduleHeatmap.map((day) => (
            <div key={day.date} className="border rounded p-3">
              <div className="text-xs text-gray-500">{day.date}</div>
              <div className="text-2xl font-bold text-gray-900 mt-1">
                {day.total}
              </div>
              <p className="text-xs text-gray-400 mt-1">
                {day.deliveries} deliveries, {day.installations} installs
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* Job Velocity */}
      <div className="bg-white rounded-lg shadow p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">
          Job Velocity by Status Stage
        </h3>
        <div className="space-y-4">
          {data.jobVelocity.map((stage) => {
            const maxDays = Math.max(...data.jobVelocity.map(s => s.avgDays))
            const percentage = (stage.avgDays / maxDays) * 100
            return (
              <div key={stage.status}>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-gray-700">{stage.status}</span>
                  <span className="text-sm font-semibold text-gray-900">{stage.avgDays} days</span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-3">
                  <div
                    className="h-3 rounded-full bg-[#3E2A1E] transition-all"
                    style={{ width: `${percentage}%` }}
                  ></div>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Exception Tracker & Vendor Performance */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Exception Tracker */}
        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">
            Exception Tracker
          </h3>
          <div className="space-y-3 max-h-96 overflow-y-auto">
            {data.exceptions.length > 0 ? (
              data.exceptions.map((exc) => (
                <div
                  key={exc.id}
                  className={`border-l-4 p-3 rounded ${
                    exc.noteType === 'ESCALATION'
                      ? 'border-red-500 bg-red-50'
                      : 'border-orange-500 bg-orange-50'
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="font-semibold text-gray-900 text-sm">
                        {exc.subject}
                      </div>
                      <div className="text-xs text-gray-600 mt-1">
                        Job: {exc.jobNumber || 'N/A'}
                      </div>
                      <div className="text-xs text-gray-500 mt-1">
                        {exc.author} • {new Date(exc.createdAt).toLocaleDateString()}
                      </div>
                    </div>
                    <span
                      className={`text-xs font-semibold px-2 py-1 rounded ${
                        exc.noteType === 'ESCALATION'
                          ? 'bg-red-200 text-red-800'
                          : 'bg-orange-200 text-orange-800'
                      }`}
                    >
                      {exc.noteType}
                    </span>
                  </div>
                </div>
              ))
            ) : (
              <div className="text-gray-500 text-center py-8">
                No exceptions found
              </div>
            )}
          </div>
        </div>

        {/* Vendor Performance */}
        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">
            Vendor Performance
          </h3>
          <div className="space-y-3 max-h-96 overflow-y-auto">
            {data.vendorPerformance.map((vendor) => (
              <div key={vendor.vendorId} className="border rounded p-3">
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <div className="font-semibold text-gray-900 text-sm">
                      {vendor.vendorName}
                    </div>
                    <div className="flex items-center gap-4 mt-2">
                      <div className="text-xs">
                        <span className="text-gray-500">On-Time Rate:</span>
                        <span className="ml-1 font-semibold text-gray-900">
                          {Math.round(vendor.onTimeRate * 100)}%
                        </span>
                      </div>
                      <div className="text-xs">
                        <span className="text-gray-500">Lead Time:</span>
                        <span className="ml-1 font-semibold text-gray-900">
                          {vendor.avgLeadDays} days
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 mt-2">
                      <span className="text-xs text-gray-500">
                        Open PO Value:
                      </span>
                      <span className="text-xs font-semibold text-gray-900">
                        {formatCurrency(vendor.openPOValue)}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Key Metrics Summary */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white rounded-lg shadow p-6 border-l-4 border-[#3E2A1E]">
          <div className="text-gray-500 text-sm">Active Crews</div>
          <div className="text-3xl font-bold text-gray-900 mt-2">
            {data.crewUtilization.length}
          </div>
          <p className="text-xs text-gray-400 mt-2">2-week forecast</p>
        </div>

        <div className="bg-white rounded-lg shadow p-6 border-l-4 border-[#C9822B]">
          <div className="text-gray-500 text-sm">Avg Days per Stage</div>
          <div className="text-3xl font-bold text-gray-900 mt-2">
            {data.jobVelocity.length > 0
              ? Math.round(
                  (data.jobVelocity.reduce((sum, stage) => sum + stage.avgDays, 0) /
                    data.jobVelocity.length) *
                    10
                ) / 10
              : 0}
          </div>
          <p className="text-xs text-gray-400 mt-2">Across all stages</p>
        </div>

        <div className="bg-white rounded-lg shadow p-6 border-l-4 border-[#27AE60]">
          <div className="text-gray-500 text-sm">Active Vendors</div>
          <div className="text-3xl font-bold text-gray-900 mt-2">
            {data.vendorPerformance.length}
          </div>
          <p className="text-xs text-gray-400 mt-2">Performance tracking</p>
        </div>
      </div>
    </div>
  )
}
