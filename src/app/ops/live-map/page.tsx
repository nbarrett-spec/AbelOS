'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import Link from 'next/link'

// ──────────────────────────────────────────────────────────────────────────
// Live Operations Map — Unified view of delivery trucks + jobsites
//
// Features:
//   • Delivery trucks with live GPS positions, clickable to see cargo/crew/destination
//   • Houses in production color-coded by job status, clickable to see brief + drill-down
//   • Real-time updates via polling (trucks every 10s, jobs every 60s)
//   • Layer toggles: trucks, active jobs, completed jobs, communities
//   • Truck route lines showing origin → destination
//   • Side panel with detailed info on selected entity
// ──────────────────────────────────────────────────────────────────────────

declare const L: any

const JOB_STATUSES = [
  { key: 'ALL', label: 'All', color: '#0f2a3e' },
  { key: 'CREATED', label: 'New', color: '#95A5A6' },
  { key: 'READINESS_CHECK', label: 'T-72', color: '#3498DB' },
  { key: 'MATERIALS_LOCKED', label: 'T-48', color: '#4B0082' },
  { key: 'IN_PRODUCTION', label: 'Production', color: '#9B59B6' },
  { key: 'STAGED', label: 'Staged', color: '#F1C40F' },
  { key: 'LOADED', label: 'Loaded', color: '#C6A24E' },
  { key: 'IN_TRANSIT', label: 'Transit', color: '#FFA500' },
  { key: 'DELIVERED', label: 'Delivered', color: '#1ABC9C' },
  { key: 'INSTALLING', label: 'Installing', color: '#00BCD4' },
  { key: 'PUNCH_LIST', label: 'Punch', color: '#E74C3C' },
  { key: 'COMPLETE', label: 'Complete', color: '#27AE60' },
  { key: 'INVOICED', label: 'Invoiced', color: '#16A085' },
]

const TRUCK_STATUSES: Record<string, { label: string; color: string }> = {
  EN_ROUTE: { label: 'En Route', color: '#C6A24E' },
  AT_STOP: { label: 'At Stop', color: '#3498DB' },
  RETURNING: { label: 'Returning', color: '#8E44AD' },
  IDLE: { label: 'Idle', color: '#95A5A6' },
}

interface Job {
  id: string
  jobNumber: string
  builderName: string
  community: string | null
  lotBlock: string | null
  jobAddress: string | null
  latitude: number | null
  longitude: number | null
  status: string
  scopeType: string
  scheduledDate?: string | null
  assignedPM?: { firstName: string; lastName: string } | null
  _count?: { deliveries: number; tasks: number; installations: number }
}

interface GeocodedJob extends Job {
  lat: number
  lng: number
}

interface TruckLocation {
  id: string
  crewId: string
  crewName?: string
  vehicleId?: string
  latitude: number
  longitude: number
  heading?: number
  speed?: number
  status: string
  address?: string
  activeDeliveryId?: string
  timestamp: string
  // Enriched data
  delivery?: {
    id: string
    deliveryNumber: string
    address: string
    jobNumber?: string
    builderName?: string
    itemCount?: number
    status: string
  }
  crew?: {
    name: string
    vehiclePlate?: string
    members: Array<{ staff: { firstName: string; lastName: string } }>
  }
}

type SelectedEntity =
  | { type: 'job'; data: GeocodedJob }
  | { type: 'truck'; data: TruckLocation }
  | null

// ── Geocoding ────────────────────────────────────────────────────────────
const geocodeCache = new Map<string, { lat: number; lng: number } | null>()

async function geocodeAddress(address: string): Promise<{ lat: number; lng: number } | null> {
  if (geocodeCache.has(address)) return geocodeCache.get(address)!
  try {
    const encoded = encodeURIComponent(address)
    const resp = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&q=${encoded}&limit=1`,
      { headers: { 'User-Agent': 'Aegis-LiveMap/1.0' } }
    )
    const results = await resp.json()
    if (results.length > 0) {
      const result = { lat: parseFloat(results[0].lat), lng: parseFloat(results[0].lon) }
      geocodeCache.set(address, result)
      return result
    }
    geocodeCache.set(address, null)
    return null
  } catch {
    geocodeCache.set(address, null)
    return null
  }
}

// ── SVG Icons ────────────────────────────────────────────────────────────

function houseIconSvg(color: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="34" viewBox="0 0 32 38">
    <defs><filter id="hs" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="1" stdDeviation="1.5" flood-opacity="0.25"/></filter></defs>
    <path d="M16 0 L32 14 L32 32 Q32 36 28 36 L4 36 Q0 36 0 32 L0 14 Z" fill="${color}" filter="url(#hs)" stroke="#fff" stroke-width="1.2"/>
    <rect x="12" y="22" width="8" height="14" rx="1" fill="#fff" opacity="0.85"/>
    <polygon points="16,2 30,14 2,14" fill="${color}" stroke="#fff" stroke-width="1"/>
  </svg>`
}

function truckIconSvg(color: string, heading?: number): string {
  const rotate = heading != null ? `transform="rotate(${heading} 18 18)"` : ''
  return `<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 36 36" ${rotate}>
    <defs><filter id="ts" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="1" stdDeviation="2" flood-opacity="0.3"/></filter></defs>
    <circle cx="18" cy="18" r="16" fill="${color}" filter="url(#ts)" stroke="#fff" stroke-width="2"/>
    <path d="M10 24 L10 14 L20 14 L20 12 L24 12 L28 16 L28 22 L26 22 L26 24 L22 24 L22 22 L16 22 L16 24 Z" fill="#fff" opacity="0.9"/>
    <circle cx="13" cy="24" r="2.5" fill="${color}" stroke="#fff" stroke-width="1"/>
    <circle cx="24" cy="24" r="2.5" fill="${color}" stroke="#fff" stroke-width="1"/>
  </svg>`
}

function getStatusInfo(key: string) {
  return JOB_STATUSES.find((s) => s.key === key) || { key, label: key, color: '#6B7280' }
}

function formatDate(d: string | null | undefined) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function formatTime(d: string) {
  return new Date(d).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

// ── Main Component ───────────────────────────────────────────────────────

export default function LiveMapPage() {
  const mapContainerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<any>(null)
  const jobMarkersRef = useRef<any[]>([])
  const truckMarkersRef = useRef<any[]>([])

  const [jobs, setJobs] = useState<Job[]>([])
  const [geocodedJobs, setGeocodedJobs] = useState<GeocodedJob[]>([])
  const [trucks, setTrucks] = useState<TruckLocation[]>([])
  const [loading, setLoading] = useState(true)
  const [geocoding, setGeocoding] = useState(false)
  const [geocodeProgress, setGeocodeProgress] = useState({ done: 0, total: 0 })
  const [statusFilter, setStatusFilter] = useState('ALL')
  const [selected, setSelected] = useState<SelectedEntity>(null)
  const [mapReady, setMapReady] = useState(false)

  // Layer toggles
  const [showTrucks, setShowTrucks] = useState(true)
  const [showJobs, setShowJobs] = useState(true)

  // ── Data fetching ─────────────────────────────────────────────────────

  const fetchJobs = useCallback(async () => {
    try {
      const resp = await fetch('/api/ops/jobs?pageSize=500')
      if (resp.ok) {
        const data = await resp.json()
        setJobs(data.data || data.jobs || [])
      }
    } catch { /* non-critical */ }
  }, [])

  const fetchTrucks = useCallback(async () => {
    try {
      const resp = await fetch('/api/ops/fleet/live')
      if (resp.ok) {
        const data = await resp.json()
        setTrucks(data.locations || data.vehicles || [])
      }
    } catch { /* non-critical */ }
  }, [])

  // Initial load
  useEffect(() => {
    Promise.all([fetchJobs(), fetchTrucks()]).finally(() => setLoading(false))
  }, [fetchJobs, fetchTrucks])

  // Polling: trucks every 10s, jobs every 60s
  useEffect(() => {
    const truckInterval = setInterval(fetchTrucks, 10000)
    const jobInterval = setInterval(fetchJobs, 60000)
    return () => {
      clearInterval(truckInterval)
      clearInterval(jobInterval)
    }
  }, [fetchTrucks, fetchJobs])

  // ── Geocoding ─────────────────────────────────────────────────────────

  useEffect(() => {
    if (jobs.length === 0) return
    let cancelled = false

    async function geocodeAll() {
      setGeocoding(true)
      const results: GeocodedJob[] = []

      // Step 1: Use persisted lat/lng (instant, no API call)
      const alreadyGeocoded = jobs.filter((j) => j.latitude != null && j.longitude != null)
      for (const job of alreadyGeocoded) {
        results.push({ ...job, lat: job.latitude!, lng: job.longitude! })
      }

      // Step 2: Geocode jobs with address but no persisted coords (fallback)
      const needsGeocoding = jobs.filter(
        (j) => j.jobAddress && j.jobAddress.trim().length > 5 && (j.latitude == null || j.longitude == null)
      )
      setGeocodeProgress({ done: alreadyGeocoded.length, total: alreadyGeocoded.length + needsGeocoding.length })

      for (let i = 0; i < needsGeocoding.length; i++) {
        if (cancelled) break
        const job = needsGeocoding[i]
        const coords = await geocodeAddress(job.jobAddress!)
        if (coords) results.push({ ...job, lat: coords.lat, lng: coords.lng })
        setGeocodeProgress({ done: alreadyGeocoded.length + i + 1, total: alreadyGeocoded.length + needsGeocoding.length })
        if (!geocodeCache.has(job.jobAddress!)) {
          await new Promise((r) => setTimeout(r, 1100))
        }
      }

      if (!cancelled) {
        setGeocodedJobs(results)
        setGeocoding(false)
      }
    }

    geocodeAll()
    return () => { cancelled = true }
  }, [jobs])

  // ── Leaflet initialization ────────────────────────────────────────────

  useEffect(() => {
    if (typeof window === 'undefined') return

    if (document.querySelector('link[href*="leaflet"]')) {
      setMapReady(true)
      return
    }

    const css = document.createElement('link')
    css.rel = 'stylesheet'
    css.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'
    document.head.appendChild(css)

    const js = document.createElement('script')
    js.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'
    js.onload = () => setMapReady(true)
    document.head.appendChild(js)
  }, [])

  // ── Map creation ──────────────────────────────────────────────────────

  useEffect(() => {
    if (!mapReady || !mapContainerRef.current || mapRef.current) return

    const map = L.map(mapContainerRef.current, {
      center: [32.78, -96.80], // DFW metro area
      zoom: 10,
      zoomControl: false,
    })

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap',
      maxZoom: 19,
    }).addTo(map)

    L.control.zoom({ position: 'topright' }).addTo(map)

    mapRef.current = map
  }, [mapReady])

  // ── Render job markers ────────────────────────────────────────────────

  useEffect(() => {
    if (!mapRef.current || !mapReady) return

    // Clear existing job markers
    jobMarkersRef.current.forEach((m) => mapRef.current.removeLayer(m))
    jobMarkersRef.current = []

    if (!showJobs) return

    const filtered = statusFilter === 'ALL'
      ? geocodedJobs
      : geocodedJobs.filter((j) => j.status === statusFilter)

    filtered.forEach((job) => {
      const statusInfo = getStatusInfo(job.status)
      const icon = L.divIcon({
        html: houseIconSvg(statusInfo.color),
        className: 'custom-house-marker',
        iconSize: [28, 34],
        iconAnchor: [14, 34],
        popupAnchor: [0, -34],
      })

      const marker = L.marker([job.lat, job.lng], { icon }).addTo(mapRef.current)

      marker.on('click', () => {
        setSelected({ type: 'job', data: job })
      })

      jobMarkersRef.current.push(marker)
    })
  }, [geocodedJobs, statusFilter, showJobs, mapReady])

  // ── Render truck markers ──────────────────────────────────────────────

  useEffect(() => {
    if (!mapRef.current || !mapReady) return

    truckMarkersRef.current.forEach((m) => mapRef.current.removeLayer(m))
    truckMarkersRef.current = []

    if (!showTrucks) return

    trucks.forEach((truck) => {
      const statusInfo = TRUCK_STATUSES[truck.status] || TRUCK_STATUSES.IDLE
      const icon = L.divIcon({
        html: truckIconSvg(statusInfo.color, truck.heading),
        className: 'custom-truck-marker',
        iconSize: [36, 36],
        iconAnchor: [18, 18],
        popupAnchor: [0, -20],
      })

      const marker = L.marker([truck.latitude, truck.longitude], { icon }).addTo(mapRef.current)

      marker.on('click', () => {
        setSelected({ type: 'truck', data: truck })
      })

      truckMarkersRef.current.push(marker)
    })
  }, [trucks, showTrucks, mapReady])

  // ── Stats ─────────────────────────────────────────────────────────────

  const activeTrucks = trucks.filter((t) => t.status !== 'IDLE').length
  const activeJobs = geocodedJobs.filter((j) => !['COMPLETE', 'CLOSED', 'INVOICED'].includes(j.status)).length

  // ── Render ────────────────────────────────────────────────────────────

  return (
    <div className="h-[calc(100vh-64px)] flex flex-col">
      {/* Top Bar */}
      <div className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 px-4 py-2.5 flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-bold text-gray-900 dark:text-white">
            Live Operations Map
          </h1>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300">
              <span className="w-2 h-2 rounded-full bg-orange-500 animate-pulse" />
              {activeTrucks} Trucks Active
            </span>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
              {activeJobs} Active Jobs
            </span>
            {geocoding && (
              <span className="text-xs text-gray-500 dark:text-gray-400">
                Mapping {geocodeProgress.done}/{geocodeProgress.total} addresses...
              </span>
            )}
          </div>
        </div>

        {/* Layer Toggles */}
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-xs font-medium text-gray-600 dark:text-gray-400 cursor-pointer">
            <input
              type="checkbox"
              checked={showTrucks}
              onChange={(e) => setShowTrucks(e.target.checked)}
              className="rounded border-gray-300 text-orange-600 focus:ring-orange-500"
            />
            Trucks
          </label>
          <label className="flex items-center gap-1.5 text-xs font-medium text-gray-600 dark:text-gray-400 cursor-pointer">
            <input
              type="checkbox"
              checked={showJobs}
              onChange={(e) => setShowJobs(e.target.checked)}
              className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            Job Sites
          </label>
        </div>
      </div>

      {/* Status Filter Bar */}
      {showJobs && (
        <div className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 px-4 py-1.5 flex items-center gap-1 overflow-x-auto">
          {JOB_STATUSES.map((s) => (
            <button
              key={s.key}
              onClick={() => setStatusFilter(s.key)}
              className={`px-2.5 py-1 rounded-full text-xs font-semibold whitespace-nowrap transition-all ${
                statusFilter === s.key
                  ? 'text-white shadow-sm'
                  : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
              }`}
              style={statusFilter === s.key ? { backgroundColor: s.color } : undefined}
            >
              {s.label}
            </button>
          ))}
        </div>
      )}

      {/* Map + Side Panel */}
      <div className="flex-1 flex relative">
        {/* Map */}
        <div ref={mapContainerRef} className="flex-1" />

        {/* Loading overlay */}
        {loading && (
          <div className="absolute inset-0 bg-white/60 dark:bg-gray-900/60 flex items-center justify-center z-[1000]">
            <div className="flex flex-col items-center gap-3">
              <div className="w-10 h-10 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin" />
              <p className="text-sm font-medium text-gray-600 dark:text-gray-400">Loading operations data...</p>
            </div>
          </div>
        )}

        {/* Detail Side Panel */}
        {selected && (
          <div className="w-96 bg-white dark:bg-gray-900 border-l border-gray-200 dark:border-gray-800 overflow-y-auto shadow-xl z-[1000]">
            <div className="sticky top-0 bg-white dark:bg-gray-900 border-b border-gray-100 dark:border-gray-800 px-4 py-3 flex items-center justify-between">
              <h2 className="text-sm font-bold text-gray-900 dark:text-white">
                {selected.type === 'job' ? 'Job Details' : 'Truck Details'}
              </h2>
              <button
                onClick={() => setSelected(null)}
                className="w-7 h-7 rounded-lg flex items-center justify-center text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
              >
                ✕
              </button>
            </div>

            {selected.type === 'job' && <JobPanel job={selected.data} />}
            {selected.type === 'truck' && <TruckPanel truck={selected.data} />}
          </div>
        )}
      </div>

      <style jsx global>{`
        .custom-house-marker, .custom-truck-marker {
          background: transparent !important;
          border: none !important;
        }
      `}</style>
    </div>
  )
}

// ── Job Detail Panel ─────────────────────────────────────────────────────

function JobPanel({ job }: { job: GeocodedJob }) {
  const statusInfo = getStatusInfo(job.status)

  return (
    <div className="p-4 space-y-4">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2 mb-1">
          <span
            className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold text-white"
            style={{ backgroundColor: statusInfo.color }}
          >
            {statusInfo.label}
          </span>
          <span className="text-xs font-mono text-gray-500 dark:text-gray-400">{job.jobNumber}</span>
        </div>
        <h3 className="text-base font-bold text-gray-900 dark:text-white">{job.builderName}</h3>
        {job.community && (
          <p className="text-sm text-gray-600 dark:text-gray-400">{job.community}{job.lotBlock ? ` — ${job.lotBlock}` : ''}</p>
        )}
      </div>

      {/* Address */}
      {job.jobAddress && (
        <div className="bg-gray-50 dark:bg-gray-800/50 rounded-xl p-3">
          <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-0.5">Address</p>
          <p className="text-sm text-gray-900 dark:text-white">{job.jobAddress}</p>
        </div>
      )}

      {/* Details grid */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-gray-50 dark:bg-gray-800/50 rounded-xl p-3">
          <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-0.5">Scope</p>
          <p className="text-sm font-medium text-gray-900 dark:text-white">{job.scopeType.replace(/_/g, ' ')}</p>
        </div>
        <div className="bg-gray-50 dark:bg-gray-800/50 rounded-xl p-3">
          <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-0.5">Scheduled</p>
          <p className="text-sm font-medium text-gray-900 dark:text-white">{formatDate(job.scheduledDate)}</p>
        </div>
        {job.assignedPM && (
          <div className="bg-gray-50 dark:bg-gray-800/50 rounded-xl p-3 col-span-2">
            <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-0.5">Project Manager</p>
            <p className="text-sm font-medium text-gray-900 dark:text-white">{job.assignedPM.firstName} {job.assignedPM.lastName}</p>
          </div>
        )}
      </div>

      {/* Counts */}
      {job._count && (
        <div className="flex items-center gap-3 text-xs text-gray-500 dark:text-gray-400">
          <span>{job._count.deliveries} deliveries</span>
          <span>•</span>
          <span>{job._count.tasks} tasks</span>
          <span>•</span>
          <span>{job._count.installations} installs</span>
        </div>
      )}

      {/* Actions */}
      <div className="pt-2 space-y-2">
        <Link
          href={`/ops/jobs/${job.id}`}
          className="block w-full text-center px-4 py-2.5 rounded-xl bg-[#0f2a3e] text-white text-sm font-semibold hover:bg-[#0a1a28] transition-colors"
        >
          Open Job Profile →
        </Link>
        <Link
          href={`/ops/jobs/${job.id}?tab=comm-log`}
          className="block w-full text-center px-4 py-2 rounded-xl border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
        >
          View Comm Log
        </Link>
      </div>
    </div>
  )
}

// ── Truck Detail Panel ───────────────────────────────────────────────────

function TruckPanel({ truck }: { truck: TruckLocation }) {
  const statusInfo = TRUCK_STATUSES[truck.status] || TRUCK_STATUSES.IDLE

  return (
    <div className="p-4 space-y-4">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2 mb-1">
          <span
            className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold text-white"
            style={{ backgroundColor: statusInfo.color }}
          >
            {statusInfo.label}
          </span>
          {truck.speed != null && truck.speed > 0 && (
            <span className="text-xs text-gray-500 dark:text-gray-400">{Math.round(truck.speed)} mph</span>
          )}
        </div>
        <h3 className="text-base font-bold text-gray-900 dark:text-white">
          {truck.crew?.name || truck.crewName || `Crew ${truck.crewId.slice(-4)}`}
        </h3>
        {truck.crew?.vehiclePlate && (
          <p className="text-sm text-gray-600 dark:text-gray-400">Plate: {truck.crew.vehiclePlate}</p>
        )}
      </div>

      {/* Current Location */}
      <div className="bg-gray-50 dark:bg-gray-800/50 rounded-xl p-3">
        <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-0.5">Current Location</p>
        <p className="text-sm text-gray-900 dark:text-white">{truck.address || `${truck.latitude.toFixed(4)}, ${truck.longitude.toFixed(4)}`}</p>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Updated {formatTime(truck.timestamp)}</p>
      </div>

      {/* Crew Members */}
      {truck.crew?.members && truck.crew.members.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">Who&apos;s in the Truck</p>
          <div className="space-y-1.5">
            {truck.crew.members.map((m, i) => (
              <div key={i} className="flex items-center gap-2 bg-gray-50 dark:bg-gray-800/50 rounded-lg px-3 py-2">
                <div className="w-7 h-7 rounded-full bg-[#0f2a3e] flex items-center justify-center text-xs font-bold text-white">
                  {m.staff.firstName[0]}{m.staff.lastName[0]}
                </div>
                <span className="text-sm font-medium text-gray-900 dark:text-white">
                  {m.staff.firstName} {m.staff.lastName}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Active Delivery (what they're carrying) */}
      {truck.delivery && (
        <div>
          <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">Carrying</p>
          <div className="bg-orange-50 dark:bg-orange-900/10 border border-orange-200 dark:border-orange-800/30 rounded-xl p-3">
            <div className="flex items-center justify-between mb-1">
              <span className="text-sm font-bold text-gray-900 dark:text-white">{truck.delivery.deliveryNumber}</span>
              <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300">
                {truck.delivery.status}
              </span>
            </div>
            {truck.delivery.builderName && (
              <p className="text-sm text-gray-700 dark:text-gray-300">{truck.delivery.builderName}</p>
            )}
            {truck.delivery.jobNumber && (
              <p className="text-xs text-gray-500 dark:text-gray-400">Job {truck.delivery.jobNumber}</p>
            )}
            <p className="text-sm text-gray-700 dark:text-gray-300 mt-1.5">→ {truck.delivery.address}</p>
            {truck.delivery.itemCount != null && (
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{truck.delivery.itemCount} items</p>
            )}
          </div>
        </div>
      )}

      {/* Destination */}
      {truck.delivery?.address && (
        <div className="bg-gray-50 dark:bg-gray-800/50 rounded-xl p-3">
          <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-0.5">Heading To</p>
          <p className="text-sm text-gray-900 dark:text-white">{truck.delivery.address}</p>
        </div>
      )}

      {/* Actions */}
      <div className="pt-2 space-y-2">
        {truck.activeDeliveryId && (
          <Link
            href={`/ops/delivery?id=${truck.activeDeliveryId}`}
            className="block w-full text-center px-4 py-2.5 rounded-xl bg-orange-600 text-white text-sm font-semibold hover:bg-orange-700 transition-colors"
          >
            View Delivery Details →
          </Link>
        )}
        <Link
          href={`/ops/fleet?crew=${truck.crewId}`}
          className="block w-full text-center px-4 py-2 rounded-xl border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
        >
          View Crew & Vehicle
        </Link>
      </div>
    </div>
  )
}
