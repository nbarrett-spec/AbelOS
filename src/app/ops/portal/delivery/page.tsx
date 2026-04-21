'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

interface Delivery {
  id: string
  title: string
  scheduledDate: string
  scheduledTime?: string
  status: string
  job?: { builderName: string; jobAddress?: string; community?: string } | null
  crew?: { name: string; members: number } | null
}

interface Crew {
  id: string
  name: string
  members: number
  activeDeliveries: number
  onDutyHours: number
}

interface Route {
  routeId: string
  stops: number
  miles: number
  estimatedTime: string
  crew: string
  status: string
}

export default function DeliveryPortal() {
  const [todayDeliveries, setTodayDeliveries] = useState<Delivery[]>([])
  const [upcomingDeliveries, setUpcomingDeliveries] = useState<Delivery[]>([])
  const [crewAssignments, setCrewAssignments] = useState<Crew[]>([])
  const [activeRoutes, setActiveRoutes] = useState<Route[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function loadData() {
      try {
        const today = new Date()
        const todayStr = today.toISOString().split('T')[0]

        const threeDaysFromNow = new Date(today)
        threeDaysFromNow.setDate(threeDaysFromNow.getDate() + 3)
        const threeDaysStr = threeDaysFromNow.toISOString().split('T')[0]

        const [todayRes, upcomingRes, crewRes] = await Promise.all([
          fetch(`/api/ops/schedule?startDate=${todayStr}&endDate=${todayStr}&entryType=DELIVERY&limit=10`),
          fetch(`/api/ops/schedule?startDate=${todayStr}&endDate=${threeDaysStr}&entryType=DELIVERY&limit=15`),
          fetch('/api/ops/crews?limit=10'),
        ])

        const [todayData, upcomingData, crewData] = await Promise.all([
          todayRes.ok ? todayRes.json() : { entries: [] },
          upcomingRes.ok ? upcomingRes.json() : { entries: [] },
          crewRes.ok ? crewRes.json() : { crews: [] },
        ])

        setTodayDeliveries((todayData.entries || []).slice(0, 8))
        setUpcomingDeliveries((upcomingData.entries || []).slice(0, 6))
        setCrewAssignments(crewData.crews || [])

        setActiveRoutes([])
      } catch (error) {
        console.error('Failed to load delivery data:', error)
        setError('Failed to load data. Please try again.')
      } finally {
        setLoading(false)
      }
    }

    loadData()
  }, [])

  const statusColors: Record<string, string> = {
    FIRM: 'bg-green-100 text-green-700',
    IN_PROGRESS: 'bg-blue-100 text-blue-700',
    COMPLETED: 'bg-gray-100 text-gray-700',
    PENDING: 'bg-yellow-100 text-yellow-700',
    CANCELLED: 'bg-red-100 text-red-700',
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#3498DB]" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="text-center py-12">
        <div className="text-4xl mb-4">⚠️</div>
        <p className="text-gray-600 font-medium">{error}</p>
        <button onClick={() => { setError(null); window.location.reload() }} className="mt-4 px-4 py-2 bg-[#0f2a3e] text-white rounded-lg hover:bg-[#0a1a28] text-sm">
          Retry
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Delivery & Logistics Dashboard</h1>
          <p className="text-gray-600 mt-1">Route planning, crew coordination, and delivery tracking</p>
        </div>
        <div className="flex gap-2">
          <Link href="/ops/schedule" className="px-4 py-2 bg-[#3498DB] text-white rounded-lg hover:bg-[#2980B9] transition-colors text-sm font-medium">
            🆕 Start Route
          </Link>
          <Link href="/ops/reports" className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors text-sm font-medium">
            📊 Reports
          </Link>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl border border-l-4 border-l-[#3498DB] p-4">
          <p className="text-xs text-gray-500 uppercase tracking-wide">Today's Deliveries</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">{todayDeliveries.length}</p>
          <p className="text-xs text-gray-400 mt-1">
            {todayDeliveries.filter(d => d.status === 'IN_PROGRESS').length} in progress
          </p>
        </div>
        <div className="bg-white rounded-xl border border-l-4 border-l-[#27AE60] p-4">
          <p className="text-xs text-gray-500 uppercase tracking-wide">Active Routes</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">{activeRoutes.length}</p>
          <p className="text-xs text-gray-400 mt-1">In delivery</p>
        </div>
        <div className="bg-white rounded-xl border border-l-4 border-l-[#C6A24E] p-4">
          <p className="text-xs text-gray-500 uppercase tracking-wide">Crews Available</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">
            {crewAssignments.filter(c => c.activeDeliveries === 0).length}
          </p>
          <p className="text-xs text-gray-400 mt-1">Ready to dispatch</p>
        </div>
        <div className="bg-white rounded-xl border border-l-4 border-l-purple-500 p-4">
          <p className="text-xs text-gray-500 uppercase tracking-wide">Next 3 Days</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">{upcomingDeliveries.length}</p>
          <p className="text-xs text-gray-400 mt-1">Scheduled deliveries</p>
        </div>
      </div>

      {/* Main Grid: Today's Deliveries + Quick Actions */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Today's Deliveries */}
        <div className="lg:col-span-2 bg-white rounded-xl border p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold text-gray-900">Today's Deliveries</h2>
            <Link href="/ops/schedule" className="text-sm text-[#3498DB] hover:text-[#2980B9]">
              Full Schedule →
            </Link>
          </div>

          {todayDeliveries.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              <p className="text-3xl mb-2">🚚</p>
              <p>No deliveries scheduled for today</p>
            </div>
          ) : (
            <div className="space-y-3">
              {todayDeliveries.map((delivery) => (
                <div key={delivery.id} className="p-4 rounded-lg border border-gray-200 hover:border-[#3498DB] transition-all">
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex-1">
                      <p className="font-semibold text-gray-900">{delivery.title}</p>
                      {delivery.job && (
                        <p className="text-sm text-gray-600 mt-0.5">
                          {delivery.job.builderName} • {delivery.job.community || 'TBD'}
                        </p>
                      )}
                      {delivery.job?.jobAddress && (
                        <p className="text-xs text-gray-500 mt-1">📍 {delivery.job.jobAddress}</p>
                      )}
                    </div>
                    <span className={`px-3 py-1 rounded-full text-xs font-medium ${statusColors[delivery.status] || 'bg-gray-100 text-gray-700'}`}>
                      {delivery.status}
                    </span>
                  </div>
                  <div className="flex items-center justify-between pt-2 border-t border-gray-100">
                    <div className="text-sm">
                      <p className="text-gray-600">
                        {delivery.scheduledTime ? `${delivery.scheduledTime} ` : ''}
                        {delivery.crew ? `• ${delivery.crew.name}` : '• Unassigned'}
                      </p>
                    </div>
                    {delivery.status === 'FIRM' && (
                      <Link href="/ops/schedule" className="px-3 py-1 text-xs rounded bg-blue-100 text-blue-700 hover:bg-blue-200 transition-colors font-medium">
                        Start Route
                      </Link>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Quick Actions */}
        <div className="bg-white rounded-xl border p-6">
          <h3 className="text-lg font-bold text-gray-900 mb-4">Quick Actions</h3>
          <div className="space-y-2">
            <Link href="/ops/schedule" className="w-full px-4 py-3 rounded-lg border border-gray-200 hover:bg-blue-50 hover:border-[#3498DB] transition-all text-sm font-medium text-gray-900 block text-center">
              🆕 Start Route
            </Link>
            <Link href="/ops/schedule" className="w-full px-4 py-3 rounded-lg border border-gray-200 hover:bg-green-50 hover:border-[#27AE60] transition-all text-sm font-medium text-gray-900 block text-center">
              ✅ Log Delivery
            </Link>
            <Link href="/ops/jobs" className="w-full px-4 py-3 rounded-lg border border-gray-200 hover:bg-orange-50 hover:border-[#C6A24E] transition-all text-sm font-medium text-gray-900 block text-center">
              ⚠️ Report Issue
            </Link>
            <Link href="/ops/reports" className="w-full px-4 py-3 rounded-lg border border-gray-200 hover:bg-purple-50 hover:border-purple-500 transition-all text-sm font-medium text-gray-900 block text-center">
              📊 Route Analysis
            </Link>
          </div>
        </div>
      </div>

      {/* Active Routes in Real-Time */}
      <div className="bg-white rounded-xl border p-6">
        <h2 className="text-lg font-bold text-gray-900 mb-4">Active Routes (Live Tracking)</h2>

        {activeRoutes.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            <p className="text-3xl mb-2">🗺️</p>
            <p>No active routes</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {activeRoutes.map((route) => (
              <div key={route.routeId} className="p-4 rounded-lg border border-blue-200 bg-blue-50">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <p className="font-semibold text-gray-900">{route.routeId}</p>
                    <p className="text-sm text-gray-600">{route.crew}</p>
                  </div>
                  <span className="px-2 py-1 text-xs rounded-full bg-green-100 text-green-700 font-medium">
                    🟢 IN PROGRESS
                  </span>
                </div>

                <div className="space-y-2 mb-3 pb-3 border-b border-blue-200">
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-600">Stops Completed</span>
                    <span className="font-semibold text-gray-900">{Math.floor(route.stops / 2)}/{route.stops}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-600">Distance</span>
                    <span className="font-semibold text-gray-900">{route.miles} miles</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-600">Est. Completion</span>
                    <span className="font-semibold text-gray-900">{route.estimatedTime}</span>
                  </div>
                </div>

                <div className="mb-3">
                  <div className="w-full bg-blue-100 rounded-full h-2">
                    <div
                      className="h-2 rounded-full bg-[#3498DB]"
                      style={{ width: '65%' }}
                    />
                  </div>
                  <p className="text-xs text-gray-600 mt-1">65% complete</p>
                </div>

                <Link href="/ops/schedule" className="w-full text-sm py-2 rounded border border-blue-300 hover:bg-blue-100 text-blue-700 font-medium transition-colors block text-center">
                  View Route Details
                </Link>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Two columns: Upcoming Deliveries + Crew Assignments */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Upcoming Deliveries (Next 3 Days) */}
        <div className="bg-white rounded-xl border p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold text-gray-900">Upcoming (Next 3 Days)</h2>
            <Link href="/ops/schedule" className="text-sm text-[#3498DB] hover:text-[#2980B9]">
              Full Calendar →
            </Link>
          </div>

          {upcomingDeliveries.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              <p className="text-3xl mb-2">📅</p>
              <p>No upcoming deliveries</p>
            </div>
          ) : (
            <div className="space-y-2">
              {upcomingDeliveries.map((delivery) => (
                <div key={delivery.id} className="p-3 rounded-lg border border-gray-200 hover:border-gray-300 transition-all">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <p className="font-medium text-gray-900 text-sm">{delivery.title}</p>
                      <p className="text-xs text-gray-600 mt-0.5">{delivery.job?.builderName}</p>
                    </div>
                    <span className="text-xs px-2 py-1 rounded bg-gray-100 text-gray-700 whitespace-nowrap ml-2">
                      {delivery.status}
                    </span>
                  </div>
                  <p className="text-xs text-gray-500 mt-1.5">
                    📅 {new Date(delivery.scheduledDate).toLocaleDateString()}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Crew Assignments & Utilization */}
        <div className="bg-white rounded-xl border p-6">
          <h2 className="text-lg font-bold text-gray-900 mb-4">Crew Status & Assignments</h2>

          {crewAssignments.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              <p className="text-3xl mb-2">👥</p>
              <p>No crew data</p>
            </div>
          ) : (
            <div className="space-y-3">
              {crewAssignments.map((crew) => {
                const utilizationPercent = (crew.activeDeliveries / 3) * 100
                const isAvailable = crew.activeDeliveries === 0

                return (
                  <div key={crew.id} className={`p-3 rounded-lg border transition-all ${
                    isAvailable ? 'border-green-200 bg-green-50' : 'border-blue-200 bg-blue-50'
                  }`}>
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <p className="font-semibold text-gray-900">{crew.name}</p>
                        <p className="text-xs text-gray-600">{crew.members} crew members</p>
                      </div>
                      <span className={`text-xs px-2 py-1 rounded font-medium ${
                        isAvailable ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'
                      }`}>
                        {isAvailable ? '✅ AVAILABLE' : `${crew.activeDeliveries} ACTIVE`}
                      </span>
                    </div>

                    <div className="space-y-1 text-xs">
                      <div className="flex justify-between">
                        <span className="text-gray-600">Utilization</span>
                        <span className="font-semibold text-gray-900">{Math.round(utilizationPercent)}%</span>
                      </div>
                      <div className="w-full bg-gray-200 rounded-full h-1.5">
                        <div
                          className={`h-1.5 rounded-full ${isAvailable ? 'bg-green-500' : 'bg-blue-500'}`}
                          style={{ width: `${Math.min(utilizationPercent, 100)}%` }}
                        />
                      </div>
                    </div>

                    {isAvailable && (
                      <Link href="/ops/schedule" className="w-full mt-2 text-xs py-1.5 rounded bg-green-600 text-white hover:bg-green-700 transition-colors font-medium block text-center">
                        Assign Delivery
                      </Link>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* Delivery Performance Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white rounded-xl border p-6">
          <h3 className="text-sm font-semibold text-gray-600 uppercase mb-3">On-Time Delivery Rate</h3>
          <div className="text-center">
            {todayDeliveries.length === 0 ? (
              <p className="text-sm text-gray-500">No data yet</p>
            ) : (
              <>
                <p className="text-4xl font-bold text-green-600">{todayDeliveries.filter(d => d.status === 'COMPLETED').length > 0 ? '—' : '—'}</p>
                <p className="text-xs text-gray-600 mt-2">Waiting for completed deliveries</p>
              </>
            )}
          </div>
        </div>

        <div className="bg-white rounded-xl border p-6">
          <h3 className="text-sm font-semibold text-gray-600 uppercase mb-3">Completed Deliveries</h3>
          <div className="text-center">
            <p className="text-4xl font-bold text-blue-600">{todayDeliveries.filter(d => d.status === 'COMPLETED').length}</p>
            <p className="text-xs text-gray-600 mt-2">Today</p>
          </div>
        </div>

        <div className="bg-white rounded-xl border p-6">
          <h3 className="text-sm font-semibold text-gray-600 uppercase mb-3">Active Deliveries</h3>
          <div className="text-center">
            <p className="text-4xl font-bold text-orange-600">{todayDeliveries.filter(d => d.status === 'IN_PROGRESS').length}</p>
            <p className="text-xs text-gray-600 mt-2">In progress</p>
          </div>
        </div>
      </div>
    </div>
  )
}
