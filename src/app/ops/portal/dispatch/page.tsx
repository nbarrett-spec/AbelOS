'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, Check, Truck, X } from 'lucide-react'
import { PageHeader, Card, KPICard, Badge, Button } from '@/components/ui'
import EmptyState from '@/components/ui/EmptyState'

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
  // Optional fields — present on /api/ops/delivery/today payload but typed
  // permissively so the alerts widget can read them without breaking when a
  // future shape change drops a field.
  completedAt?: string | null
  departedAt?: string | null
  arrivedAt?: string | null
  notes?: string | null
  damageNotes?: string | null
}

interface TodayBucket {
  driverId: string | null
  driverName: string
  crewId: string | null
  crewName: string | null
  deliveries: TodayStop[]
}

type AlertSeverity = 'high' | 'medium' | 'low'

interface DispatchAlert {
  id: string
  kind: 'overdue' | 'stale' | 'failed'
  severity: AlertSeverity
  title: string
  description: string
  deliveryId?: string
  crewId?: string
}

export default function DispatchPage() {
  const [live, setLive] = useState<LiveResponse | null>(null)
  const [today, setToday] = useState<TodayBucket[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null)
  const [dismissedAlerts, setDismissedAlerts] = useState<Set<string>>(new Set())

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

  // ── Alerts: computed from already-fetched data ────────────────────────────
  // Three rule families from the spec:
  //   1) Delivery overdue   — SHIPPED-ish status, no completedAt, departed > 4h
  //   2) No driver update   — most-recent GPS ping per crew > 30 min stale
  //   3) Failed delivery    — status REFUSED, or damageNotes / damage-flagged notes
  const alerts = useMemo<DispatchAlert[]>(() => {
    const out: DispatchAlert[] = []
    const now = Date.now()

    // (1) overdue deliveries
    const SHIPPING_STATES = new Set(['SHIPPED', 'IN_TRANSIT', 'ARRIVED', 'UNLOADING'])
    for (const bucket of today || []) {
      for (const d of bucket.deliveries) {
        if (!SHIPPING_STATES.has(d.status)) continue
        if (d.completedAt) continue
        const startedAt = d.departedAt || d.arrivedAt
        if (!startedAt) continue
        const ageMs = now - new Date(startedAt).getTime()
        if (ageMs <= 4 * 60 * 60 * 1000) continue
        const hours = Math.floor(ageMs / (60 * 60 * 1000))
        out.push({
          id: `overdue-${d.id}`,
          kind: 'overdue',
          severity: hours >= 6 ? 'high' : 'medium',
          title: `Delivery overdue — ${d.deliveryNumber}`,
          description: `${bucket.driverName} · ${d.builderName || '—'} · ${hours}h since shipped, not yet completed`,
          deliveryId: d.id,
          crewId: bucket.crewId || undefined,
        })
      }
    }

    // (2) stale GPS — > 30 min since last ping
    for (const loc of live?.locations || []) {
      const ageMs = now - new Date(loc.timestamp).getTime()
      if (ageMs <= 30 * 60 * 1000) continue
      const minutes = Math.round(ageMs / 60000)
      const driverName =
        loc.crew.members[0]?.staff
          ? `${loc.crew.members[0].staff.firstName} ${loc.crew.members[0].staff.lastName}`
          : loc.crewName || loc.crew.name
      out.push({
        id: `stale-${loc.crewId}`,
        kind: 'stale',
        severity: minutes >= 60 ? 'medium' : 'low',
        title: `No driver update — ${driverName}`,
        description: `Last GPS ping ${minutes}m ago${loc.delivery ? ` · on ${loc.delivery.deliveryNumber}` : ''}`,
        deliveryId: loc.delivery?.id,
        crewId: loc.crewId,
      })
    }

    // (3) failed / refused / damage-flagged deliveries
    for (const bucket of today || []) {
      for (const d of bucket.deliveries) {
        const isRefused = d.status === 'REFUSED'
        const damageStr = (d.damageNotes || '').trim()
        // notes field on today payload is a free-form joined string; flag the
        // common keywords PMs use when something's wrong on the truck.
        const noteStr = (d.notes || '').toLowerCase()
        const hasDamageKw =
          !!damageStr ||
          noteStr.includes('damage') ||
          noteStr.includes('refused') ||
          noteStr.includes('reject')
        if (!isRefused && !hasDamageKw) continue
        out.push({
          id: `failed-${d.id}`,
          kind: 'failed',
          severity: 'high',
          title: `${isRefused ? 'Refused delivery' : 'Damage flagged'} — ${d.deliveryNumber}`,
          description: `${bucket.driverName} · ${d.builderName || '—'}${damageStr ? ` · ${damageStr}` : ''}`,
          deliveryId: d.id,
          crewId: bucket.crewId || undefined,
        })
      }
    }

    // Sort: high → medium → low, stable within group
    const order: Record<AlertSeverity, number> = { high: 0, medium: 1, low: 2 }
    return out
      .filter((a) => !dismissedAlerts.has(a.id))
      .sort((a, b) => order[a.severity] - order[b.severity])
  }, [today, live, dismissedAlerts])

  const focusDelivery = useCallback((deliveryId?: string, crewId?: string) => {
    if (typeof document === 'undefined') return
    const target =
      (deliveryId && document.getElementById(`delivery-${deliveryId}`)) ||
      (crewId && document.getElementById(`crew-${crewId}`)) ||
      null
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'center' })
      target.classList.add('ring-2', 'ring-accent-fg')
      setTimeout(() => target.classList.remove('ring-2', 'ring-accent-fg'), 1600)
    }
  }, [])

  const dismissAlert = useCallback((id: string) => {
    setDismissedAlerts((prev) => {
      const next = new Set(prev)
      next.add(id)
      return next
    })
  }, [])

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

        {/* Active alerts — computed client-side from fleet/live + delivery/today */}
        <Card padding="lg">
          <div className="flex items-center justify-between mb-3">
            <div>
              <div className="text-sm font-semibold text-fg">Active alerts</div>
              <div className="text-[11px] text-fg-subtle">
                Delays, stale pings, and refused / damaged deliveries — computed live from
                today's fleet data. Dismiss to hide until the next refresh.
              </div>
            </div>
            <Badge
              variant={alerts.length === 0 ? 'success' : alerts.some((a) => a.severity === 'high') ? 'danger' : 'warning'}
              size="sm"
            >
              {alerts.length === 0 ? 'All clear' : `${alerts.length} open`}
            </Badge>
          </div>

          {alerts.length === 0 ? (
            <div className="flex items-center gap-2 text-sm text-data-positive-fg bg-data-positive-bg/50 border border-data-positive/30 rounded-md px-3 py-2">
              <Check className="w-4 h-4" />
              <span>All deliveries on track</span>
            </div>
          ) : (
            <div className="space-y-2">
              {alerts.map((a) => {
                const borderClass =
                  a.severity === 'high'
                    ? 'border-l-4 border-l-data-negative'
                    : a.severity === 'medium'
                      ? 'border-l-4 border-l-data-warning'
                      : 'border-l-4 border-l-data-info'
                const iconColor =
                  a.severity === 'high'
                    ? 'text-data-negative-fg'
                    : a.severity === 'medium'
                      ? 'text-data-warning-fg'
                      : 'text-data-info-fg'
                return (
                  <div
                    key={a.id}
                    className={`flex items-start gap-3 rounded-md border border-border bg-surface ${borderClass} p-3`}
                  >
                    <AlertTriangle className={`w-4 h-4 mt-0.5 shrink-0 ${iconColor}`} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-semibold text-fg truncate">{a.title}</span>
                        <Badge
                          variant={a.severity === 'high' ? 'danger' : a.severity === 'medium' ? 'warning' : 'info'}
                          size="xs"
                        >
                          {a.severity}
                        </Badge>
                      </div>
                      <div className="text-[11px] text-fg-muted mt-0.5">{a.description}</div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {(a.deliveryId || a.crewId) && (
                        <Button
                          size="xs"
                          variant="ghost"
                          onClick={() => focusDelivery(a.deliveryId, a.crewId)}
                        >
                          View
                        </Button>
                      )}
                      <button
                        type="button"
                        onClick={() => dismissAlert(a.id)}
                        aria-label="Dismiss alert"
                        className="p-1 rounded text-fg-subtle hover:text-fg hover:bg-surface-muted transition-colors"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </Card>

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
            <EmptyState
              size="compact"
              icon={<Truck className="w-6 h-6 text-fg-subtle" />}
              title="No GPS pings yet today"
              description="Drivers need to toggle Share Location on their portal."
            />
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {live?.locations.map((loc) => {
              const ageMin = Math.round((Date.now() - new Date(loc.timestamp).getTime()) / 60000)
              const isStale = ageMin > 15
              return (
                <Card
                  key={loc.id}
                  padding="md"
                  className="border border-border transition-shadow"
                  id={`crew-${loc.crewId}`}
                >
                  {loc.delivery && (
                    <span id={`delivery-${loc.delivery.id}`} className="block -mt-2 mb-2" />
                  )}
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
            <EmptyState
              size="compact"
              icon={<Truck className="w-6 h-6 text-fg-subtle" />}
              title="No deliveries scheduled"
              description="No deliveries scheduled today."
            />
          )}
          <div className="space-y-4">
            {today?.map((bucket) => {
              const done = bucket.deliveries.filter(
                (d) => d.status === 'COMPLETE' || d.status === 'PARTIAL_DELIVERY'
              ).length
              const total = bucket.deliveries.length
              const pct = total ? Math.round((done / total) * 100) : 0
              return (
                <div
                  key={bucket.crewId || bucket.driverName}
                  id={bucket.crewId ? `crew-${bucket.crewId}` : undefined}
                  className="border border-border rounded-md p-3 transition-shadow"
                >
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
                        id={`delivery-${d.id}`}
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
