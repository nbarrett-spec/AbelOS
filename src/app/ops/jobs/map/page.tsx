'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import Link from 'next/link'

// ──────────────────────────────────────────────────────────────────────────
// Live Jobsite Map — Leaflet + OpenStreetMap
//
// Shows all active jobsites on an interactive map with:
//   • House icons color-coded by job status
//   • Click-to-brief popup with job summary
//   • Drill-down links to full job detail (SOs, WOs, deliveries, etc.)
//   • Status filter bar
//   • Community clustering
//   • Address-based geocoding (Nominatim, free, no API key)
//
// Leaflet is loaded via CDN to avoid SSR issues with Next.js.
// ──────────────────────────────────────────────────────────────────────────

const JOB_STATUSES = [
  { key: 'ALL', label: 'All Jobs', color: '#1B4F72' },
  { key: 'CREATED', label: 'New', color: '#95A5A6' },
  { key: 'READINESS_CHECK', label: 'T-72 Check', color: '#3498DB' },
  { key: 'MATERIALS_LOCKED', label: 'T-48 Lock', color: '#4B0082' },
  { key: 'IN_PRODUCTION', label: 'Production', color: '#9B59B6' },
  { key: 'STAGED', label: 'Staged', color: '#F1C40F' },
  { key: 'LOADED', label: 'T-24 Loaded', color: '#E67E22' },
  { key: 'IN_TRANSIT', label: 'In Transit', color: '#FFA500' },
  { key: 'DELIVERED', label: 'Delivered', color: '#1ABC9C' },
  { key: 'INSTALLING', label: 'Installing', color: '#00BCD4' },
  { key: 'PUNCH_LIST', label: 'Punch List', color: '#E74C3C' },
  { key: 'COMPLETE', label: 'Complete', color: '#27AE60' },
  { key: 'INVOICED', label: 'Invoiced', color: '#16A085' },
]

interface Job {
  id: string
  builderName: string
  community: string | null
  lotBlock: string | null
  jobAddress: string | null
  assignedPM?: { firstName: string; lastName: string } | null
  scheduledDate?: string | null
  status: string
  jobNumber: string
  scopeType: string
  dropPlan: string | null
  _count?: { decisionNotes: number; tasks: number; deliveries: number; installations: number }
}

interface GeocodedJob extends Job {
  lat: number
  lng: number
}

// Simple in-memory geocode cache so we don't re-request the same address
const geocodeCache = new Map<string, { lat: number; lng: number } | null>()

async function geocodeAddress(address: string): Promise<{ lat: number; lng: number } | null> {
  if (geocodeCache.has(address)) return geocodeCache.get(address)!
  try {
    const encoded = encodeURIComponent(address)
    const resp = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&q=${encoded}&limit=1`,
      { headers: { 'User-Agent': 'Aegis-JobMap/1.0' } }
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

function getStatusInfo(key: string) {
  return JOB_STATUSES.find((s) => s.key === key) || { key, label: key, color: '#6B7280' }
}

function formatDate(d: string | null | undefined) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

// Create an SVG house marker with the given color
function houseIconSvg(color: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="38" viewBox="0 0 32 38">
    <defs><filter id="s" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="1" stdDeviation="1.5" flood-opacity="0.3"/></filter></defs>
    <path d="M16 0 L32 14 L32 32 Q32 36 28 36 L4 36 Q0 36 0 32 L0 14 Z" fill="${color}" filter="url(#s)" stroke="#fff" stroke-width="1"/>
    <rect x="12" y="22" width="8" height="14" rx="1" fill="#fff" opacity="0.85"/>
    <rect x="5" y="16" width="6" height="5" rx="0.5" fill="#fff" opacity="0.6"/>
    <rect x="21" y="16" width="6" height="5" rx="0.5" fill="#fff" opacity="0.6"/>
    <polygon points="16,2 30,14 2,14" fill="${color}" stroke="#fff" stroke-width="1"/>
  </svg>`
}

export default function JobsiteMapPage() {
  const mapContainerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<any>(null)
  const markersRef = useRef<any[]>([])
  const [jobs, setJobs] = useState<Job[]>([])
  const [geocodedJobs, setGeocodedJobs] = useState<GeocodedJob[]>([])
  const [loading, setLoading] = useState(true)
  const [geocoding, setGeocoding] = useState(false)
  const [geocodeProgress, setGeocodeProgress] = useState({ done: 0, total: 0 })
  const [statusFilter, setStatusFilter] = useState('ALL')
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedJob, setSelectedJob] = useState<GeocodedJob | null>(null)
  const [mapReady, setMapReady] = useState(false)
  const [statusCounts, setStatusCounts] = useState<Record<string, number>>({})

  // Load jobs from API
  useEffect(() => {
    async function loadJobs() {
      try {
        setLoading(true)
        const resp = await fetch('/api/ops/jobs?pageSize=500')
        if (!resp.ok) throw new Error('Failed to load jobs')
        const data = await resp.json()
        const jobList = data.data || data.jobs || []
        setJobs(jobList)
        setStatusCounts(data.statusCounts || {})
      } catch (err) {
        console.error('Failed to load jobs:', err)
      } finally {
        setLoading(false)
      }
    }
    loadJobs()
  }, [])

  // Geocode jobs with addresses
  useEffect(() => {
    if (jobs.length === 0) return
    let cancelled = false

    async function geocodeAll() {
      setGeocoding(true)
      const withAddress = jobs.filter((j) => j.jobAddress && j.jobAddress.trim().length > 5)
      setGeocodeProgress({ done: 0, total: withAddress.length })
      const results: GeocodedJob[] = []

      // Batch geocode with rate limiting (Nominatim requires 1 req/sec)
      for (let i = 0; i < withAddress.length; i++) {
        if (cancelled) break
        const job = withAddress[i]
        const coords = await geocodeAddress(job.jobAddress!)
        if (coords) {
          results.push({ ...job, lat: coords.lat, lng: coords.lng })
        }
        setGeocodeProgress({ done: i + 1, total: withAddress.length })

        // Rate limit: Nominatim asks for max 1 request/second
        // Only delay if not cached
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

  // Load Leaflet CSS + JS via CDN
  useEffect(() => {
    if (typeof window === 'undefined') return

    // Check if already loaded
    if ((window as any).L) {
      setMapReady(true)
      return
    }

    const css = document.createElement('link')
    css.rel = 'stylesheet'
    css.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'
    document.head.appendChild(css)

    const script = document.createElement('script')
    script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'
    script.onload = () => setMapReady(true)
    document.head.appendChild(script)

    return () => {
      // Don't remove on cleanup — Leaflet should persist
    }
  }, [])

  // Initialize map once Leaflet is ready and container exists
  useEffect(() => {
    if (!mapReady || !mapContainerRef.current || mapRef.current) return

    const L = (window as any).L
    if (!L) return

    // Default center: roughly middle of US
    const map = L.map(mapContainerRef.current, {
      center: [35.5, -97.5],
      zoom: 5,
      zoomControl: true,
    })

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 19,
    }).addTo(map)

    mapRef.current = map

    // Force resize after mount
    setTimeout(() => map.invalidateSize(), 200)
  }, [mapReady])

  // Update markers when geocoded jobs or filter changes
  const updateMarkers = useCallback(() => {
    if (!mapRef.current || !mapReady) return
    const L = (window as any).L
    if (!L) return

    // Clear existing markers
    markersRef.current.forEach((m) => m.remove())
    markersRef.current = []

    // Filter jobs
    let filtered = geocodedJobs
    if (statusFilter !== 'ALL') {
      filtered = filtered.filter((j) => j.status === statusFilter)
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      filtered = filtered.filter(
        (j) =>
          j.builderName?.toLowerCase().includes(q) ||
          j.jobAddress?.toLowerCase().includes(q) ||
          j.community?.toLowerCase().includes(q) ||
          j.jobNumber?.toLowerCase().includes(q)
      )
    }

    if (filtered.length === 0) return

    const bounds: [number, number][] = []

    filtered.forEach((job) => {
      const status = getStatusInfo(job.status)
      const svgIcon = L.divIcon({
        html: houseIconSvg(status.color),
        className: 'abel-house-marker',
        iconSize: [32, 38],
        iconAnchor: [16, 38],
        popupAnchor: [0, -38],
      })

      const pm = job.assignedPM
        ? `${job.assignedPM.firstName} ${job.assignedPM.lastName}`
        : 'Unassigned'
      const counts = job._count || { decisionNotes: 0, tasks: 0, deliveries: 0, installations: 0 }

      const popupContent = `
        <div style="min-width:260px;font-family:system-ui,sans-serif;">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
            <span style="display:inline-block;width:12px;height:12px;border-radius:50%;background:${status.color};flex-shrink:0;"></span>
            <strong style="font-size:14px;color:#1e3a5f;">${job.jobNumber}</strong>
            <span style="background:${status.color};color:#fff;font-size:11px;padding:2px 8px;border-radius:10px;">${status.label}</span>
          </div>
          <div style="font-size:13px;color:#374151;line-height:1.5;">
            <div><strong>Builder:</strong> ${job.builderName}</div>
            ${job.community ? `<div><strong>Community:</strong> ${job.community}</div>` : ''}
            ${job.lotBlock ? `<div><strong>Lot/Block:</strong> ${job.lotBlock}</div>` : ''}
            <div><strong>Address:</strong> ${job.jobAddress || '—'}</div>
            <div><strong>Scope:</strong> ${job.scopeType}</div>
            <div><strong>PM:</strong> ${pm}</div>
            <div><strong>Scheduled:</strong> ${formatDate(job.scheduledDate)}</div>
            ${job.dropPlan ? `<div><strong>Drop Plan:</strong> ${job.dropPlan}</div>` : ''}
          </div>
          <div style="display:flex;gap:12px;margin-top:8px;font-size:12px;color:#6B7280;">
            <span>📋 ${counts.tasks} tasks</span>
            <span>🚚 ${counts.deliveries} deliveries</span>
            <span>🔨 ${counts.installations} installs</span>
          </div>
          <div style="margin-top:10px;display:flex;gap:8px;">
            <a href="/ops/jobs/${job.id}" style="display:inline-block;background:#1B4F72;color:#fff;padding:6px 14px;border-radius:6px;text-decoration:none;font-size:12px;font-weight:600;">
              Full Job Detail →
            </a>
            <a href="/ops/jobs/${job.id}#orders" style="display:inline-block;background:#E67E22;color:#fff;padding:6px 14px;border-radius:6px;text-decoration:none;font-size:12px;font-weight:600;">
              Orders & WOs
            </a>
          </div>
        </div>
      `

      const marker = L.marker([job.lat, job.lng], { icon: svgIcon })
        .addTo(mapRef.current)
        .bindPopup(popupContent, { maxWidth: 320, closeButton: true })

      marker.on('click', () => setSelectedJob(job))
      markersRef.current.push(marker)
      bounds.push([job.lat, job.lng])
    })

    // Fit map to markers
    if (bounds.length > 0) {
      if (bounds.length === 1) {
        mapRef.current.setView(bounds[0], 15)
      } else {
        mapRef.current.fitBounds(bounds, { padding: [40, 40], maxZoom: 15 })
      }
    }
  }, [geocodedJobs, statusFilter, searchQuery, mapReady])

  useEffect(() => {
    updateMarkers()
  }, [updateMarkers])

  const filteredCount =
    statusFilter === 'ALL'
      ? geocodedJobs.length
      : geocodedJobs.filter((j) => j.status === statusFilter).length

  const totalJobs = jobs.length
  const mappedJobs = geocodedJobs.length
  const unmappedJobs = totalJobs - mappedJobs

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Header */}
      <div className="bg-[#1e3a5f] text-white px-6 py-6">
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-3">
              <span className="text-2xl">🗺️</span>
              <h1 className="text-2xl font-bold">Live Jobsite Map</h1>
            </div>
            <p className="text-blue-200 mt-1 text-sm">
              {mappedJobs} jobsites mapped of {totalJobs} total
              {unmappedJobs > 0 && ` • ${unmappedJobs} missing address`}
              {geocoding && ` • Geocoding ${geocodeProgress.done}/${geocodeProgress.total}...`}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Link
              href="/ops/jobs"
              className="bg-white/10 hover:bg-white/20 text-white px-4 py-2 rounded-lg text-sm transition-colors"
            >
              ← Job Pipeline
            </Link>
            <Link
              href="/ops/delivery"
              className="bg-[#e67e22] hover:bg-[#d35400] text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
            >
              Delivery Center →
            </Link>
          </div>
        </div>
      </div>

      {/* Status Filter Bar */}
      <div className="bg-white border-b border-gray-200 px-6 py-3">
        <div className="flex items-center gap-2 overflow-x-auto pb-1">
          {JOB_STATUSES.map((status) => {
            const count =
              status.key === 'ALL'
                ? geocodedJobs.length
                : geocodedJobs.filter((j) => j.status === status.key).length
            return (
              <button
                key={status.key}
                onClick={() => setStatusFilter(status.key)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-all ${
                  statusFilter === status.key
                    ? 'text-white shadow-sm'
                    : 'text-gray-600 bg-gray-100 hover:bg-gray-200'
                }`}
                style={
                  statusFilter === status.key
                    ? { background: status.color }
                    : undefined
                }
              >
                <span
                  className="w-2 h-2 rounded-full flex-shrink-0"
                  style={{ background: status.color }}
                />
                {status.label}
                <span className="text-[10px] opacity-80">({count})</span>
              </button>
            )
          })}
        </div>
      </div>

      {/* Search + Stats Bar */}
      <div className="bg-white border-b border-gray-200 px-6 py-2 flex items-center gap-4">
        <div className="relative flex-1 max-w-md">
          <input
            type="text"
            placeholder="Search by builder, address, community, job #..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-8 pr-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#1B4F72] focus:border-transparent"
          />
          <svg className="absolute left-2.5 top-2.5 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        </div>
        <div className="text-xs text-gray-500">
          Showing <strong className="text-gray-700">{filteredCount}</strong> jobs on map
        </div>
      </div>

      {/* Main Content: Map + Side Panel */}
      <div className="flex flex-1 relative" style={{ minHeight: 'calc(100vh - 220px)' }}>
        {/* Map */}
        <div className="flex-1 relative">
          {loading ? (
            <div className="flex items-center justify-center h-full bg-gray-100">
              <div className="text-center">
                <div className="w-10 h-10 border-4 border-[#1B4F72] border-t-transparent rounded-full animate-spin mx-auto mb-3" />
                <p className="text-gray-600 text-sm">Loading jobs...</p>
              </div>
            </div>
          ) : geocoding && geocodeProgress.done === 0 ? (
            <div className="flex items-center justify-center h-full bg-gray-100">
              <div className="text-center">
                <div className="w-10 h-10 border-4 border-[#e67e22] border-t-transparent rounded-full animate-spin mx-auto mb-3" />
                <p className="text-gray-600 text-sm">Geocoding addresses...</p>
                <p className="text-gray-400 text-xs mt-1">This may take a moment for first load</p>
              </div>
            </div>
          ) : (
            <>
              <div
                ref={mapContainerRef}
                className="absolute inset-0 z-0"
                style={{ background: '#e8e8e8' }}
              />
              {geocoding && (
                <div className="absolute top-3 left-3 z-[1000] bg-white rounded-lg shadow-lg px-4 py-2 flex items-center gap-2">
                  <div className="w-4 h-4 border-2 border-[#e67e22] border-t-transparent rounded-full animate-spin" />
                  <span className="text-xs text-gray-600">
                    Geocoding {geocodeProgress.done}/{geocodeProgress.total}...
                  </span>
                  <div className="w-20 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-[#e67e22] rounded-full transition-all"
                      style={{
                        width: `${geocodeProgress.total > 0 ? (geocodeProgress.done / geocodeProgress.total) * 100 : 0}%`,
                      }}
                    />
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Side Panel — Job Brief */}
        {selectedJob && (
          <div className="w-96 bg-white border-l border-gray-200 overflow-y-auto shadow-lg z-10">
            <div className="sticky top-0 bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between">
              <h3 className="font-bold text-[#1e3a5f] text-sm">Job Brief</h3>
              <button
                onClick={() => setSelectedJob(null)}
                className="text-gray-400 hover:text-gray-600"
              >
                ✕
              </button>
            </div>
            <div className="p-4 space-y-4">
              {/* Job Header */}
              <div className="flex items-center gap-2">
                <span
                  className="inline-block px-2.5 py-0.5 rounded-full text-xs font-semibold text-white"
                  style={{ background: getStatusInfo(selectedJob.status).color }}
                >
                  {getStatusInfo(selectedJob.status).label}
                </span>
                <span className="font-bold text-lg text-[#1e3a5f]">{selectedJob.jobNumber}</span>
              </div>

              {/* Details */}
              <div className="space-y-2 text-sm">
                <DetailRow label="Builder" value={selectedJob.builderName} />
                <DetailRow label="Address" value={selectedJob.jobAddress || '—'} />
                {selectedJob.community && <DetailRow label="Community" value={selectedJob.community} />}
                {selectedJob.lotBlock && <DetailRow label="Lot/Block" value={selectedJob.lotBlock} />}
                <DetailRow label="Scope" value={selectedJob.scopeType} />
                <DetailRow
                  label="PM"
                  value={
                    selectedJob.assignedPM
                      ? `${selectedJob.assignedPM.firstName} ${selectedJob.assignedPM.lastName}`
                      : 'Unassigned'
                  }
                />
                <DetailRow label="Scheduled" value={formatDate(selectedJob.scheduledDate)} />
                {selectedJob.dropPlan && <DetailRow label="Drop Plan" value={selectedJob.dropPlan} />}
              </div>

              {/* Counts */}
              <div className="grid grid-cols-3 gap-2">
                <MiniStat label="Tasks" value={selectedJob._count?.tasks || 0} icon="📋" />
                <MiniStat label="Deliveries" value={selectedJob._count?.deliveries || 0} icon="🚚" />
                <MiniStat label="Installs" value={selectedJob._count?.installations || 0} icon="🔨" />
              </div>

              {/* Action Buttons */}
              <div className="space-y-2 pt-2">
                <Link
                  href={`/ops/jobs/${selectedJob.id}`}
                  className="block w-full text-center bg-[#1B4F72] hover:bg-[#163d5c] text-white py-2.5 rounded-lg text-sm font-semibold transition-colors"
                >
                  Open Full Job Detail →
                </Link>
                <div className="grid grid-cols-2 gap-2">
                  <Link
                    href={`/ops/jobs/${selectedJob.id}#orders`}
                    className="text-center bg-[#e67e22] hover:bg-[#d35400] text-white py-2 rounded-lg text-xs font-medium transition-colors"
                  >
                    Sales Orders
                  </Link>
                  <Link
                    href={`/ops/jobs/${selectedJob.id}#work-orders`}
                    className="text-center bg-[#9B59B6] hover:bg-[#8E44AD] text-white py-2 rounded-lg text-xs font-medium transition-colors"
                  >
                    Work Orders
                  </Link>
                  <Link
                    href={`/ops/jobs/${selectedJob.id}#deliveries`}
                    className="text-center bg-[#27AE60] hover:bg-[#219a52] text-white py-2 rounded-lg text-xs font-medium transition-colors"
                  >
                    Deliveries
                  </Link>
                  <Link
                    href={`/ops/jobs/${selectedJob.id}#schedule`}
                    className="text-center bg-[#3498DB] hover:bg-[#2980B9] text-white py-2 rounded-lg text-xs font-medium transition-colors"
                  >
                    Schedule
                  </Link>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Custom CSS for Leaflet markers */}
      <style jsx global>{`
        .abel-house-marker {
          background: transparent !important;
          border: none !important;
        }
        .leaflet-popup-content-wrapper {
          border-radius: 10px !important;
          box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15) !important;
        }
        .leaflet-popup-content {
          margin: 12px 14px !important;
        }
      `}</style>
    </div>
  )
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-gray-500">{label}</span>
      <span className="font-medium text-gray-800 text-right max-w-[200px]">{value}</span>
    </div>
  )
}

function MiniStat({ label, value, icon }: { label: string; value: number; icon: string }) {
  return (
    <div className="bg-gray-50 rounded-lg p-2 text-center">
      <div className="text-lg">{icon}</div>
      <div className="font-bold text-[#1e3a5f]">{value}</div>
      <div className="text-[10px] text-gray-500">{label}</div>
    </div>
  )
}
