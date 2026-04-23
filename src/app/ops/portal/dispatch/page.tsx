'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { PageHeader, Card, KPICard, Badge, Button } from '@/components/ui'

// ──────────────────────────────────────────────────────────────────────────
// Dispatch view — for Jordyn Steider (Delivery Logistical Supervisor)
//
// Shows every active driver: current stop, GPS freshness, status. Polls
// /api/ops/fleet/live every 30s. Falls back cleanly when there are no GPS
// pings (e.g. drivers haven't enabled Share Location yet).
// ──────────────────────────────────────────────────────────────────────────

interface LiveLocation {
  id: string
  crewId: string
  vehicleId: string | null
  latitude: number
  longitude: number
  heading?: number
  speed?: number
  status: string
  address: string | null
  activeDeliveryId: string | null
  timestamp: string
  crewName: string | null
  crew: {
    name: string
    vehiclePlate: string | null
    members: Array<{ staff: { firstName: string; lastName: string; id: string } }>
  }
  delivery?: {
    id: string
    deliveryNumber: string
    address: string
    status: string
    jobNumber?: string | null
    builderName?: string | null
  }
}

interface LiveResponse {
  locations: LiveLocation[]
  count: number
}

interface TodayStop {
  id: string
  deliveryNumber: string
  status: string
  builderName: string | null
  address: string | null
}

interface TodayBucket {
  driverId: string | null
  driverName: string
  crewId: string | null
  crewName: string | null
  deliveries: TodayStop[]
}

export default function DispatchPage() {
  const [live, setLive] = useState<LiveResponse | null>(null)
  const [today, setToday] = useState<TodayBucket[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [liveRes, todayRes] = await Promise.all([
        fetch('/api/ops/fleet/live'),
        fetch('/api/ops/delivery/today'),
      ])
      if (liveRes.ok) setLive(await liveRes.json())
      if (todayRes.ok) {
        const data = await todayRes.json()
        setToday(data.drivers || [])
      }
      setLastRefresh(new Date())
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
    const t = setInterval(load, 30_000)
    return () => clearInterval(t)
  }, [load])

  const activeCount = live?.locations.length || 0
  const todayTotal = today?.reduce((acc, b) => acc + b.deliveries.length, 0) || 0
  const todayComplete =
    today?.reduce(
      (acc, b) =>
        acc +
        b.deliveries.filter((d) => d.status === 'COMPLETE' || d.status === 'PARTIAL_DELIVERY')
          .length,
      0
    ) || 0
  const staleCount =
    live?.locations.filter((l) => {
      const age = Date.now() - new Date(l.timestamp).getTime()
      return age > 15 * 60 * 1000
    }).length || 0

  return (
    <div className="min-h-screen bg-canvas text-fg">
      <div className="max-w-[1800px] mx-auto p-6 space-y-5">
        <PageHeader
          eyebrow="Delivery"
          title="Dispatch"
          description="Live driver positions, current stops, and route progress."
          crumbs={[
            { label: 'Ops', href: '/ops' },
            { label: 'Portals', href: '/ops/portal' },
            { label: 'Dispatch' },
          ]}
          actions={
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-fg-subtle">
                {lastRefresh ? `Updated ${lastRefresh.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit' })}` : '—'}
              </span>
              <Button variant="ghost" size="sm" loading={loading} onClick={load}>
                Refresh
              </Button>
              <Link
                href="/ops/delivery/today"
                className="text-xs text-accent-fg hover:underline"
              >
                Full board →
              </Link>
            </div>
          }
        />

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <KPICard title="Drivers active" value={activeCount} accent="brand" />
          <KPICard title="Stops today" value={todayTotal} accent="neutral" />
          <KPICard title="Completed" value={todayComplete} accent="positive" />
          <KPICard
            title="Stale pings"
            value={staleCount}
            accent={staleCount > 0 ? 'accent' : 'neutral'}
          />
        </div>

        {/* Active drivers (have GPS) */}
        <Card padding="lg">
          <div className="flex items-center justify-between mb-3">
            <div>
              <div className="text-sm font-semibold text-fg">Active drivers</div>
              <div className="text-[11px] text-fg-subtle">
                GPS pings from the last 2 hours. Drivers who haven't enabled Share Location
                appear below with scheduled stops only.
              </div>
            </div>
            <Badge variant="info" size="sm">
              {live?.count || 0} live
            </Badge>
          </div>

          {(!live?.locations || live.locations.length === 0) && (
            <div className="text-sm text-fg-muted py-4">
              No GPS pings yet today. Drivers need to toggle Share Location on their portal.
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {live?.locations.map((loc) => {
              const ageMin = Math.round((Date.now() - new Date(loc.timestamp).getTime()) / 60000)
              const isStale = ageMin > 15
              return (
                <Card key={loc.id} padding="md" className="border border-border">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold truncate">
                        {loc.crew.members[0]?.staff
                          ? `${loc.crew.members[0].staff.firstName} ${loc.crew.members[0].staff.lastName}`
                          : loc.crewName || loc.crew.name}
                      </div>
                      <div className="text-[11px] text-fg-subtle">
                        {loc.crew.vehiclePlate || '—'} · {loc.crew.name}
                      </div>
                    </div>
                    <Badge
                      variant={isStale ? 'warning' : 'success'}
                      size="xs"
                    >
                      {isStale ? `${ageMin}m stale` : `${ageMin}m ago`}
                    </Badge>
                  </div>

                  {loc.delivery && (
                    <div className="mt-3 text-xs border-t border-border pt-3">
                      <div className="text-[10px] uppercase tracking-wider text-fg-subtle">
                        Current stop
                      </div>
                      <div className="text-sm font-medium mt-1">
                        {loc.delivery.builderName || '—'}
                      </div>
                      <div className="text-[11px] text-fg-muted">
                        {loc.delivery.deliveryNumber} · {loc.delivery.status}
                      </div>
                      <div className="text-[11px] text-fg-subtle mt-1 truncate">
                        {loc.delivery.address}
                      </div>
                    </div>
                  )}

                  <div className="mt-3 flex items-center justify-between text-[11px] text-fg-muted">
                    <span>
                      {loc.latitude.toFixed(4)}, {loc.longitude.toFixed(4)}
                    </span>
                    <a
                      href={`https://maps.google.com/?q=${loc.latitude},${loc.longitude}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-accent-fg hover:underline"
                    >
                      Map →
                    </a>
                  </div>
                </Card>
              )
            })}
          </div>
        </Card>

        {/* Per-driver scheduled route with progress */}
        <Card padding="lg">
          <div className="text-sm font-semibold mb-3">Route progress by driver</div>
          {(!today || today.length === 0) && (
            <div className="text-sm text-fg-muted py-4">No deliveries scheduled today.</div>
          )}
          <div className="space-y-4">
            {today?.map((bucket) => {
              const done = bucket.deliveries.filter(
                (d) => d.status === 'COMPLETE' || d.status === 'PARTIAL_DELIVERY'
              ).length
              const total = bucket.deliveries.length
              const pct = total ? Math.round((done / total) * 100) : 0
              return (
                <div key={bucket.crewId || bucket.driverName} className="border border-border rounded-md p-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm font-semibold">{bucket.driverName}</div>
                      {bucket.crewName && (
                        <div className="text-[11px] text-fg-subtle">{bucket.crewName}</div>
                      )}
                    </div>
                    <div className="text-xs text-fg-muted font-numeric">
                      {done}/{total} · {pct}%
                    </div>
                  </div>
                  <div className="mt-2 h-1.5 rounded-full bg-surface-muted overflow-hidden">
                    <div
                      className="h-full bg-accent-fg transition-all"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {bucket.deliveries.map((d, i) => (
                      <span
                        key={d.id}
                        title={`${d.builderName || '—'} · ${d.address || ''} · ${d.status}`}
                        className={`inline-flex items-center justify-center text-[10px] px-1.5 py-0.5 rounded border font-numeric ${
                          d.status === 'COMPLETE' || d.status === 'PARTIAL_DELIVERY'
                            ? 'bg-data-positive/15 border-data-positive/40 text-data-positive'
                            : d.status === 'IN_TRANSIT' || d.status === 'ARRIVED' || d.status === 'UNLOADING'
                              ? 'bg-accent-fg/15 border-accent-fg/40 text-accent-fg'
                              : 'bg-surface-muted border-border text-fg-muted'
                        }`}
                      >
                        {i + 1}
                      </span>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        </Card>
      </div>
    </div>
  )
}
