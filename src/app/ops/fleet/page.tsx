'use client'

import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'

// ──────────────────────────────────────────────────────────────────────────
// Fleet & Logistics Hub
//
// Unified dashboard for Abel Lumber's delivery fleet:
//   • Live vehicle tracking map (GPS tracker integration ready)
//   • Route planning with stop optimization
//   • Driver/crew dispatch board
//   • Vehicle management (maintenance, fuel, inspections)
//   • Third-party vs in-house delivery tracking
//   • GPS tracker recommendations
// ──────────────────────────────────────────────────────────────────────────

interface Crew {
  id: string
  name: string
  crewType: string
  active: boolean
  vehicleId: string | null
  vehiclePlate: string | null
  _count: { members: number; deliveries: number }
}

interface DeliveryData {
  id: string
  deliveryNumber: string
  address: string
  status: string
  routeOrder: number
  crewId: string | null
  crewName: string | null
  departedAt: string | null
  arrivedAt: string | null
  completedAt: string | null
  job: {
    id: string
    jobNumber: string
    builderName: string
    community: string | null
  }
  latestTracking: {
    status: string
    location: string | null
    eta: string | null
    timestamp: string
  } | null
}

interface Vehicle {
  id: string
  plate: string
  type: string
  make: string
  model: string
  year: number
  status: 'ACTIVE' | 'MAINTENANCE' | 'OUT_OF_SERVICE'
  mileage: number
  lastInspection: string | null
  nextInspection: string | null
  fuelType: string
  assignedCrewId: string | null
  assignedCrewName: string | null
  gpsTrackerId: string | null
  lastKnownLocation: string | null
  lastLocationUpdate: string | null
}

const TABS = [
  { id: 'overview', label: 'Fleet Overview', icon: '🚛' },
  { id: 'tracking', label: 'Live Tracking', icon: '📍' },
  { id: 'routes', label: 'Route Planning', icon: '🗺️' },
  { id: 'dispatch', label: 'Dispatch Board', icon: '📋' },
  { id: 'vehicles', label: 'Vehicles', icon: '🔧' },
  { id: 'gps-setup', label: 'GPS Trackers', icon: '📡' },
]

const STATUS_COLORS: Record<string, { bg: string; text: string; label: string }> = {
  SCHEDULED: { bg: '#F3F4F6', text: '#374151', label: 'Scheduled' },
  LOADING: { bg: '#DBEAFE', text: '#1E40AF', label: 'Loading' },
  IN_TRANSIT: { bg: '#FEF3C7', text: '#92400E', label: 'In Transit' },
  ARRIVED: { bg: '#D1FAE5', text: '#065F46', label: 'Arrived' },
  UNLOADING: { bg: '#E0E7FF', text: '#3730A3', label: 'Unloading' },
  COMPLETE: { bg: '#D1FAE5', text: '#065F46', label: 'Complete' },
  PARTIAL_DELIVERY: { bg: '#FEE2E2', text: '#991B1B', label: 'Partial' },
  REFUSED: { bg: '#FEE2E2', text: '#991B1B', label: 'Refused' },
  RESCHEDULED: { bg: '#F3F4F6', text: '#374151', label: 'Rescheduled' },
}

export default function FleetLogisticsHub() {
  const [activeTab, setActiveTab] = useState('overview')
  const [crews, setCrews] = useState<Crew[]>([])
  const [deliveries, setDeliveries] = useState<DeliveryData[]>([])
  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadData()
  }, [])

  async function loadData() {
    setLoading(true)
    try {
      const today = new Date().toISOString().split('T')[0]
      const [crewsRes, deliveriesRes] = await Promise.all([
        fetch('/api/ops/crews'),
        fetch(`/api/ops/delivery/tracking?date=${today}`),
      ])

      if (crewsRes.ok) {
        const data = await crewsRes.json()
        setCrews(data.crews || [])
      }
      if (deliveriesRes.ok) {
        const data = await deliveriesRes.json()
        setDeliveries(data.deliveries || [])
      }

      // Vehicle data — try to load, fall back to generating from crews
      try {
        const vehicleRes = await fetch('/api/ops/fleet/vehicles')
        if (vehicleRes.ok) {
          const data = await vehicleRes.json()
          setVehicles(data.vehicles || [])
        }
      } catch {
        // Vehicles API may not exist yet — that's OK
      }
    } catch (err) {
      console.error('Failed to load fleet data:', err)
    } finally {
      setLoading(false)
    }
  }

  const deliveryCrews = crews.filter((c) => c.crewType === 'DELIVERY' && c.active)
  const inTransit = deliveries.filter((d) => ['IN_TRANSIT', 'LOADING', 'ARRIVED', 'UNLOADING'].includes(d.status))
  const completed = deliveries.filter((d) => d.status === 'COMPLETE')
  const scheduled = deliveries.filter((d) => d.status === 'SCHEDULED')

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-[#1e3a5f] text-white px-8 py-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold flex items-center gap-3">
              <span>🚛</span> Fleet & Logistics Hub
            </h1>
            <p className="text-blue-200 mt-2">
              Vehicle tracking, route planning, dispatch, and delivery management
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Link
              href="/ops/delivery"
              className="bg-white/10 hover:bg-white/20 text-white px-4 py-2 rounded-lg text-sm"
            >
              Delivery Center
            </Link>
            <Link
              href="/ops/delivery/route-optimizer"
              className="bg-[#C6A24E] hover:bg-[#A8882A] text-white px-4 py-2 rounded-lg text-sm font-medium"
            >
              Route Optimizer
            </Link>
            <Link
              href="/ops/jobs/map"
              className="bg-white/10 hover:bg-white/20 text-white px-4 py-2 rounded-lg text-sm"
            >
              Jobsite Map
            </Link>
          </div>
        </div>
      </div>

      {/* Tab Bar */}
      <div className="bg-white border-b border-gray-200 px-8">
        <div className="flex gap-1 -mb-px overflow-x-auto">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                activeTab === tab.id
                  ? 'border-[#C6A24E] text-[#C6A24E]'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              <span className="mr-1.5">{tab.icon}</span>
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="max-w-7xl mx-auto px-8 py-8">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-8 h-8 border-4 border-[#0f2a3e] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <>
            {activeTab === 'overview' && (
              <OverviewTab
                crews={deliveryCrews}
                deliveries={deliveries}
                inTransit={inTransit}
                completed={completed}
                scheduled={scheduled}
                vehicles={vehicles}
              />
            )}
            {activeTab === 'tracking' && (
              <LiveTrackingTab deliveries={deliveries} crews={deliveryCrews} />
            )}
            {activeTab === 'routes' && (
              <RoutePlanningTab deliveries={deliveries} crews={deliveryCrews} />
            )}
            {activeTab === 'dispatch' && (
              <DispatchBoard deliveries={deliveries} crews={deliveryCrews} />
            )}
            {activeTab === 'vehicles' && (
              <VehiclesTab vehicles={vehicles} crews={crews} />
            )}
            {activeTab === 'gps-setup' && <GPSTrackerSetup />}
          </>
        )}
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────────
// Tab: Fleet Overview
// ──────────────────────────────────────────────────────────────────────────

function OverviewTab({
  crews,
  deliveries,
  inTransit,
  completed,
  scheduled,
  vehicles,
}: {
  crews: Crew[]
  deliveries: DeliveryData[]
  inTransit: DeliveryData[]
  completed: DeliveryData[]
  scheduled: DeliveryData[]
  vehicles: Vehicle[]
}) {
  const activeVehicles = vehicles.filter((v) => v.status === 'ACTIVE')
  const maintenanceVehicles = vehicles.filter((v) => v.status === 'MAINTENANCE')

  return (
    <div className="space-y-6">
      {/* KPI Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
        <KPICard label="Active Crews" value={crews.length} icon="👷" color="#0f2a3e" />
        <KPICard label="In Transit" value={inTransit.length} icon="🚚" color="#C6A24E" />
        <KPICard label="Completed Today" value={completed.length} icon="✅" color="#27AE60" />
        <KPICard label="Scheduled" value={scheduled.length} icon="📅" color="#3498DB" />
        <KPICard
          label="Vehicles Active"
          value={activeVehicles.length || crews.length}
          icon="🚛"
          color="#9B59B6"
        />
        <KPICard label="In Maintenance" value={maintenanceVehicles.length} icon="🔧" color="#E74C3C" />
      </div>

      {/* Active Deliveries */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h3 className="font-bold text-[#1e3a5f]">Today's Deliveries</h3>
          <span className="text-sm text-gray-500">{deliveries.length} total</span>
        </div>
        <div className="divide-y divide-gray-100">
          {deliveries.length === 0 ? (
            <div className="px-6 py-8 text-center text-gray-400">No deliveries scheduled for today</div>
          ) : (
            deliveries.slice(0, 15).map((d) => {
              const statusInfo = STATUS_COLORS[d.status] || STATUS_COLORS.SCHEDULED
              return (
                <div key={d.id} className="px-6 py-3 flex items-center gap-4 hover:bg-gray-50">
                  <span
                    className="px-2 py-0.5 rounded-full text-xs font-medium"
                    style={{ background: statusInfo.bg, color: statusInfo.text }}
                  >
                    {statusInfo.label}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm text-gray-800 truncate">
                      {d.deliveryNumber} — {d.job?.builderName || 'Unknown'}
                    </div>
                    <div className="text-xs text-gray-500 truncate">{d.address}</div>
                  </div>
                  <div className="text-xs text-gray-500">{d.crewName || 'Unassigned'}</div>
                  {d.latestTracking?.eta && (
                    <div className="text-xs font-medium text-[#C6A24E]">
                      ETA: {new Date(d.latestTracking.eta).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                    </div>
                  )}
                  <Link
                    href={`/ops/jobs/${d.job?.id || ''}`}
                    className="text-xs text-[#0f2a3e] hover:underline"
                  >
                    View Job
                  </Link>
                </div>
              )
            })
          )}
        </div>
      </div>

      {/* Crew Status Grid */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100">
          <h3 className="font-bold text-[#1e3a5f]">Crew Status</h3>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 p-6">
          {crews.length === 0 ? (
            <div className="col-span-full text-center text-gray-400 py-4">No delivery crews found</div>
          ) : (
            crews.map((crew) => {
              const crewDeliveries = deliveries.filter((d) => d.crewId === crew.id)
              const activeDelivery = crewDeliveries.find((d) =>
                ['IN_TRANSIT', 'LOADING', 'ARRIVED', 'UNLOADING'].includes(d.status)
              )
              const completedCount = crewDeliveries.filter((d) => d.status === 'COMPLETE').length
              const remainingCount = crewDeliveries.filter((d) =>
                ['SCHEDULED', 'LOADING'].includes(d.status)
              ).length

              return (
                <div
                  key={crew.id}
                  className={`rounded-lg border p-4 ${
                    activeDelivery ? 'border-[#C6A24E] bg-orange-50' : 'border-gray-200'
                  }`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-semibold text-sm text-[#1e3a5f]">{crew.name}</span>
                    {activeDelivery && (
                      <span className="text-xs bg-[#C6A24E] text-white px-2 py-0.5 rounded-full">
                        Active
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-gray-500 space-y-1">
                    <div>
                      {crew.vehiclePlate ? `🚛 ${crew.vehiclePlate}` : 'No vehicle assigned'}
                    </div>
                    <div>
                      👷 {crew._count?.members || 0} members • {crewDeliveries.length} deliveries today
                    </div>
                    <div>
                      ✅ {completedCount} done • 📦 {remainingCount} remaining
                    </div>
                    {activeDelivery && (
                      <div className="font-medium text-[#C6A24E]">
                        → {activeDelivery.address}
                      </div>
                    )}
                  </div>
                </div>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────────
// Tab: Live Tracking
// ──────────────────────────────────────────────────────────────────────────

function LiveTrackingTab({
  deliveries,
  crews,
}: {
  deliveries: DeliveryData[]
  crews: Crew[]
}) {
  const mapRef = useRef<HTMLDivElement>(null)
  const activeDeliveries = deliveries.filter((d) =>
    ['IN_TRANSIT', 'LOADING', 'ARRIVED', 'UNLOADING'].includes(d.status)
  )

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h3 className="font-bold text-[#1e3a5f]">Live Vehicle Positions</h3>
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
            <span className="text-xs text-gray-500">
              {activeDeliveries.length} vehicles active
            </span>
          </div>
        </div>
        <div
          ref={mapRef}
          className="h-[500px] bg-gray-100 flex items-center justify-center"
        >
          <div className="text-center max-w-md px-8">
            <div className="text-4xl mb-3">📡</div>
            <h4 className="font-bold text-[#1e3a5f] mb-2">GPS Tracking Ready</h4>
            <p className="text-sm text-gray-600 mb-4">
              Connect GPS trackers to see real-time vehicle positions on this map.
              See the GPS Trackers tab for setup instructions and recommended hardware.
            </p>
            <Link
              href="/ops/jobs/map"
              className="inline-block bg-[#0f2a3e] text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-[#163d5c]"
            >
              View Jobsite Map Instead →
            </Link>
          </div>
        </div>
      </div>

      {/* Active Deliveries List */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100">
          <h3 className="font-bold text-[#1e3a5f]">Active Deliveries</h3>
        </div>
        <div className="divide-y divide-gray-100">
          {activeDeliveries.length === 0 ? (
            <div className="px-6 py-8 text-center text-gray-400">
              No deliveries currently in transit
            </div>
          ) : (
            activeDeliveries.map((d) => (
              <div key={d.id} className="px-6 py-4">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-medium text-sm">{d.deliveryNumber}</div>
                    <div className="text-xs text-gray-500">{d.address}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs font-medium">{d.crewName || 'Unassigned'}</div>
                    {d.latestTracking && (
                      <div className="text-xs text-gray-500">
                        Last update: {d.latestTracking.location || d.latestTracking.status}
                        {d.latestTracking.eta && (
                          <span className="ml-2 text-[#C6A24E]">
                            ETA {new Date(d.latestTracking.eta).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────────
// Tab: Route Planning
// ──────────────────────────────────────────────────────────────────────────

function RoutePlanningTab({
  deliveries,
  crews,
}: {
  deliveries: DeliveryData[]
  crews: Crew[]
}) {
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0])
  const [optimizing, setOptimizing] = useState(false)

  const scheduledDeliveries = deliveries.filter((d) =>
    ['SCHEDULED', 'LOADING'].includes(d.status)
  )

  // Group by crew
  const crewRoutes = crews.map((crew) => {
    const crewDeliveries = deliveries
      .filter((d) => d.crewId === crew.id)
      .sort((a, b) => a.routeOrder - b.routeOrder)
    return { crew, deliveries: crewDeliveries }
  })

  const unassigned = deliveries.filter((d) => !d.crewId)

  return (
    <div className="space-y-6">
      {/* Controls */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <h3 className="font-bold text-[#1e3a5f]">Route Planning</h3>
            <p className="text-sm text-gray-500 mt-1">
              Plan and optimize delivery routes for your crews
            </p>
          </div>
          <div className="flex items-center gap-3">
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
            />
            <Link
              href="/ops/delivery/route-optimizer"
              className="bg-[#C6A24E] hover:bg-[#A8882A] text-white px-4 py-2 rounded-lg text-sm font-medium"
            >
              Advanced Optimizer →
            </Link>
          </div>
        </div>
      </div>

      {/* Unassigned Deliveries */}
      {unassigned.length > 0 && (
        <div className="bg-red-50 rounded-xl border border-red-200 overflow-hidden">
          <div className="px-6 py-3 border-b border-red-200">
            <h4 className="font-bold text-red-800 text-sm">
              ⚠️ {unassigned.length} Unassigned Deliveries
            </h4>
          </div>
          <div className="divide-y divide-red-100">
            {unassigned.map((d) => (
              <div key={d.id} className="px-6 py-2 flex items-center justify-between text-sm">
                <div>
                  <span className="font-medium">{d.deliveryNumber}</span>
                  <span className="text-gray-500 ml-2">{d.address}</span>
                </div>
                <span className="text-red-600 text-xs">Needs crew assignment</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Crew Routes */}
      {crewRoutes.map(({ crew, deliveries: crewDels }) => (
        <div key={crew.id} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="text-lg">🚛</span>
              <div>
                <h4 className="font-bold text-[#1e3a5f] text-sm">{crew.name}</h4>
                <div className="text-xs text-gray-500">
                  {crew.vehiclePlate || 'No vehicle'} • {crewDels.length} stops
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-400">
                Est. {Math.ceil(crewDels.length * 35)} min total
              </span>
            </div>
          </div>
          <div className="divide-y divide-gray-50">
            {crewDels.length === 0 ? (
              <div className="px-6 py-4 text-sm text-gray-400">No stops assigned</div>
            ) : (
              crewDels.map((d, idx) => {
                const statusInfo = STATUS_COLORS[d.status] || STATUS_COLORS.SCHEDULED
                return (
                  <div key={d.id} className="px-6 py-3 flex items-center gap-4">
                    <div className="w-6 h-6 rounded-full bg-[#0f2a3e] text-white text-xs flex items-center justify-center font-bold">
                      {idx + 1}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">
                        {d.job?.builderName} — {d.job?.jobNumber}
                      </div>
                      <div className="text-xs text-gray-500 truncate">{d.address}</div>
                    </div>
                    <span
                      className="px-2 py-0.5 rounded-full text-xs font-medium"
                      style={{ background: statusInfo.bg, color: statusInfo.text }}
                    >
                      {statusInfo.label}
                    </span>
                  </div>
                )
              })
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────────
// Tab: Dispatch Board
// ──────────────────────────────────────────────────────────────────────────

function DispatchBoard({
  deliveries,
  crews,
}: {
  deliveries: DeliveryData[]
  crews: Crew[]
}) {
  const columns = [
    { key: 'SCHEDULED', label: 'Scheduled', color: '#9CA3AF' },
    { key: 'LOADING', label: 'Loading', color: '#3B82F6' },
    { key: 'IN_TRANSIT', label: 'In Transit', color: '#F97316' },
    { key: 'ARRIVED', label: 'Arrived', color: '#10B981' },
    { key: 'COMPLETE', label: 'Complete', color: '#059669' },
  ]

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="font-bold text-[#1e3a5f]">Dispatch Board</h3>
        <div className="text-sm text-gray-500">
          Drag and drop coming soon — use Delivery Center for status updates
        </div>
      </div>
      <div className="grid grid-cols-5 gap-4">
        {columns.map((col) => {
          const colDeliveries = deliveries.filter((d) => d.status === col.key)
          return (
            <div key={col.key} className="bg-gray-50 rounded-xl p-3 min-h-[400px]">
              <div className="flex items-center gap-2 mb-3">
                <span
                  className="w-2.5 h-2.5 rounded-full"
                  style={{ background: col.color }}
                />
                <span className="text-xs font-bold text-gray-700">{col.label}</span>
                <span className="text-xs text-gray-400 ml-auto">{colDeliveries.length}</span>
              </div>
              <div className="space-y-2">
                {colDeliveries.map((d) => (
                  <div
                    key={d.id}
                    className="bg-white rounded-lg border border-gray-200 p-3 shadow-sm"
                  >
                    <div className="text-xs font-bold text-[#1e3a5f]">{d.deliveryNumber}</div>
                    <div className="text-xs text-gray-600 mt-1 truncate">
                      {d.job?.builderName}
                    </div>
                    <div className="text-[10px] text-gray-400 mt-1 truncate">{d.address}</div>
                    {d.crewName && (
                      <div className="mt-2 text-[10px] bg-gray-50 rounded px-1.5 py-0.5 text-gray-600">
                        🚛 {d.crewName}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────────
// Tab: Vehicles
// ──────────────────────────────────────────────────────────────────────────

function VehiclesTab({ vehicles, crews }: { vehicles: Vehicle[]; crews: Crew[] }) {
  // If no dedicated vehicle records, show fleet based on crew data
  const fleetData =
    vehicles.length > 0
      ? vehicles
      : crews
          .filter((c) => c.vehiclePlate)
          .map((c) => ({
            id: c.id,
            plate: c.vehiclePlate!,
            type: 'Flatbed Truck',
            make: '—',
            model: '—',
            year: 0,
            status: 'ACTIVE' as const,
            mileage: 0,
            lastInspection: null,
            nextInspection: null,
            fuelType: 'Diesel',
            assignedCrewId: c.id,
            assignedCrewName: c.name,
            gpsTrackerId: null,
            lastKnownLocation: null,
            lastLocationUpdate: null,
          }))

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="font-bold text-[#1e3a5f]">Vehicle Fleet</h3>
        <button className="bg-[#0f2a3e] text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-[#163d5c]">
          + Add Vehicle
        </button>
      </div>

      {fleetData.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
          <div className="text-4xl mb-3">🚛</div>
          <h4 className="font-bold text-[#1e3a5f] mb-2">No Vehicles Registered</h4>
          <p className="text-sm text-gray-500 max-w-md mx-auto">
            Add your fleet vehicles to track maintenance, fuel, mileage, and GPS positions.
            Vehicles are assigned to delivery crews.
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500">Vehicle</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500">Assigned Crew</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500">Status</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500">GPS Tracker</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500">Last Location</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {fleetData.map((v) => (
                <tr key={v.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <div className="font-medium">{v.plate}</div>
                    <div className="text-xs text-gray-500">
                      {v.year > 0 ? `${v.year} ${v.make} ${v.model}` : v.type}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-gray-600">{v.assignedCrewName || '—'}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                        v.status === 'ACTIVE'
                          ? 'bg-green-100 text-green-800'
                          : v.status === 'MAINTENANCE'
                          ? 'bg-yellow-100 text-yellow-800'
                          : 'bg-red-100 text-red-800'
                      }`}
                    >
                      {v.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-500">
                    {v.gpsTrackerId ? (
                      <span className="text-green-600 text-xs">✓ Connected</span>
                    ) : (
                      <span className="text-gray-400 text-xs">Not installed</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500">
                    {v.lastKnownLocation || 'No data'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────────
// Tab: GPS Tracker Setup & Recommendations
// ──────────────────────────────────────────────────────────────────────────

function GPSTrackerSetup() {
  const trackers = [
    {
      name: 'Samsara VG54',
      type: 'OBD-II Plug & Play',
      price: '$33/mo per vehicle',
      bestFor: 'Full fleet management',
      pros: [
        'Real-time GPS + engine diagnostics',
        'Driver safety scoring & dash cam option',
        'ELD compliance (HOS)',
        'Geofencing & alerts',
        'Open API for Aegis integration',
        'Route replay & breadcrumb trails',
      ],
      cons: ['Higher monthly cost', 'Annual contract typical'],
      integration: 'REST API — can push location updates to Aegis every 30 seconds',
      recommended: true,
    },
    {
      name: 'GPS Trackit Spartan',
      type: 'Hardwired',
      price: '$25/mo per vehicle',
      bestFor: 'Budget fleet tracking',
      pros: [
        'Real-time tracking (10-sec updates)',
        'Geofencing & speed alerts',
        'Ignition on/off reporting',
        'Tamper-proof hardwired install',
        'Low monthly cost',
      ],
      cons: ['No engine diagnostics', 'Professional install needed', 'Basic API'],
      integration: 'Webhook-based — sends location events that Aegis can consume',
      recommended: false,
    },
    {
      name: 'Vyncs GPS',
      type: 'OBD-II Plug & Play',
      price: '$7/mo per vehicle (annual plan)',
      bestFor: 'Basic tracking on a budget',
      pros: [
        'Cheapest GPS tracking option',
        'No contract required',
        'Real-time tracking (3-min updates)',
        'Trip history & fuel monitoring',
        'Self-install OBD-II plug',
      ],
      cons: ['3-minute update intervals (not real-time)', 'Limited API', 'No driver ID'],
      integration: 'CSV export — manual import or scrape via Aegis scheduled job',
      recommended: false,
    },
    {
      name: 'LandAirSea Overdrive',
      type: 'OBD-II Plug & Play',
      price: '$20/mo per vehicle',
      bestFor: 'Simple plug-and-play tracking',
      pros: [
        'Real-time tracking (3-sec updates)',
        'Speed & geofence alerts',
        'Ignition alerts',
        'Compact OBD-II form factor',
        'No installation needed',
      ],
      cons: ['No engine diagnostics', 'Limited fleet management features', 'No open API'],
      integration: 'Manual — view in their app, no direct Aegis integration yet',
      recommended: false,
    },
    {
      name: 'Motive (formerly KeepTruckin)',
      type: 'ELD + GPS + Dashcam',
      price: '$35-50/mo per vehicle',
      bestFor: 'If you need DOT compliance or run CDL drivers',
      pros: [
        'ELD/HOS compliance built in',
        'AI-powered dashcam',
        'GPS tracking + route optimization',
        'DVIR (vehicle inspections)',
        'Open API for integration',
        'Driver app with navigation',
      ],
      cons: ['Premium pricing', 'Overkill if no DOT requirements'],
      integration: 'REST API — full integration possible with Aegis',
      recommended: false,
    },
  ]

  return (
    <div className="space-y-6">
      {/* Recommendation Banner */}
      <div className="bg-gradient-to-r from-[#0f2a3e] to-[#2980B9] rounded-xl p-6 text-white">
        <h3 className="text-xl font-bold mb-2">GPS Tracker Recommendations for Abel Lumber</h3>
        <p className="text-blue-100 text-sm leading-relaxed">
          For a building materials delivery fleet, we recommend <strong>Samsara</strong> for the best
          integration capabilities, or <strong>GPS Trackit</strong> for a budget-friendly option.
          Both support real-time tracking with API integration into Aegis.
        </p>
        <div className="mt-4 flex gap-4 text-sm">
          <div className="bg-white/10 rounded-lg px-4 py-2">
            <div className="font-bold">Key Requirements</div>
            <div className="text-blue-200 text-xs mt-1">Real-time GPS, Geofencing, API access, Driver alerts</div>
          </div>
          <div className="bg-white/10 rounded-lg px-4 py-2">
            <div className="font-bold">Fleet Size Estimate</div>
            <div className="text-blue-200 text-xs mt-1">5-15 vehicles typical for lumber yard</div>
          </div>
          <div className="bg-white/10 rounded-lg px-4 py-2">
            <div className="font-bold">Monthly Budget</div>
            <div className="text-blue-200 text-xs mt-1">$165-$495/mo for 5 trucks (Samsara)</div>
          </div>
        </div>
      </div>

      {/* Comparison Cards */}
      <div className="space-y-4">
        {trackers.map((tracker) => (
          <div
            key={tracker.name}
            className={`bg-white rounded-xl border overflow-hidden ${
              tracker.recommended ? 'border-[#C6A24E] ring-2 ring-[#C6A24E]/20' : 'border-gray-200'
            }`}
          >
            <div className="px-6 py-4 flex items-center justify-between border-b border-gray-100">
              <div className="flex items-center gap-3">
                <span className="text-2xl">📡</span>
                <div>
                  <div className="flex items-center gap-2">
                    <h4 className="font-bold text-[#1e3a5f]">{tracker.name}</h4>
                    {tracker.recommended && (
                      <span className="bg-[#C6A24E] text-white text-[10px] font-bold px-2 py-0.5 rounded-full">
                        RECOMMENDED
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-gray-500">{tracker.type}</div>
                </div>
              </div>
              <div className="text-right">
                <div className="font-bold text-[#1e3a5f]">{tracker.price}</div>
                <div className="text-xs text-gray-500">Best for: {tracker.bestFor}</div>
              </div>
            </div>
            <div className="px-6 py-4 grid grid-cols-3 gap-6">
              <div>
                <h5 className="text-xs font-bold text-green-700 mb-2">Pros</h5>
                <ul className="space-y-1">
                  {tracker.pros.map((pro, i) => (
                    <li key={i} className="text-xs text-gray-600 flex items-start gap-1">
                      <span className="text-green-500 mt-0.5">✓</span> {pro}
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <h5 className="text-xs font-bold text-red-700 mb-2">Cons</h5>
                <ul className="space-y-1">
                  {tracker.cons.map((con, i) => (
                    <li key={i} className="text-xs text-gray-600 flex items-start gap-1">
                      <span className="text-red-500 mt-0.5">✕</span> {con}
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <h5 className="text-xs font-bold text-[#0f2a3e] mb-2">Aegis Integration</h5>
                <p className="text-xs text-gray-600">{tracker.integration}</p>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Integration Architecture */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h3 className="font-bold text-[#1e3a5f] mb-4">How GPS Integration Works with Aegis</h3>
        <div className="grid grid-cols-4 gap-4 text-center">
          <div className="bg-gray-50 rounded-lg p-4">
            <div className="text-2xl mb-2">📡</div>
            <div className="text-xs font-bold text-gray-700">GPS Tracker</div>
            <div className="text-[10px] text-gray-500 mt-1">Reports location every 10-30s</div>
          </div>
          <div className="bg-gray-50 rounded-lg p-4">
            <div className="text-2xl mb-2">☁️</div>
            <div className="text-xs font-bold text-gray-700">Tracker Cloud</div>
            <div className="text-[10px] text-gray-500 mt-1">Samsara/Trackit servers</div>
          </div>
          <div className="bg-gray-50 rounded-lg p-4">
            <div className="text-2xl mb-2">🔗</div>
            <div className="text-xs font-bold text-gray-700">Webhook/API</div>
            <div className="text-[10px] text-gray-500 mt-1">Pushes events to Aegis</div>
          </div>
          <div className="bg-[#0f2a3e]/10 rounded-lg p-4 border border-[#0f2a3e]/20">
            <div className="text-2xl mb-2">🖥️</div>
            <div className="text-xs font-bold text-[#0f2a3e]">Aegis</div>
            <div className="text-[10px] text-gray-500 mt-1">Shows on Fleet Hub map</div>
          </div>
        </div>
        <div className="flex items-center justify-between mt-4 px-8">
          <div className="h-0.5 flex-1 bg-gray-300" />
          <span className="px-3 text-xs text-gray-400">Data Flow</span>
          <div className="h-0.5 flex-1 bg-gray-300" />
        </div>
        <div className="mt-4 bg-blue-50 rounded-lg p-4 text-sm text-blue-800">
          <strong>Next step:</strong> Once you choose a tracker, we'll build the webhook endpoint
          at <code className="bg-blue-100 px-1 rounded">/api/ops/fleet/gps-webhook</code> to receive
          location updates and display them on the Live Tracking map.
        </div>
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────────
// Shared Components
// ──────────────────────────────────────────────────────────────────────────

function KPICard({
  label,
  value,
  icon,
  color,
}: {
  label: string
  value: number
  icon: string
  color: string
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-lg">{icon}</span>
        <span className="text-xs text-gray-500">{label}</span>
      </div>
      <div className="text-2xl font-bold" style={{ color }}>
        {value}
      </div>
    </div>
  )
}
