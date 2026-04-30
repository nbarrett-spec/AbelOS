'use client'

/**
 * Builder Portal — Schedule client.
 *
 * §4.6 Schedule. Renders:
 *   - 4-card stat strip (active jobs / upcoming / in-transit / done this month)
 *   - Week-aware calendar grid (← This Week →)
 *   - Upcoming Deliveries list with Track + Reschedule
 *   - In-Transit list (separate, gets the amber gradient accent)
 *
 * The calendar pulls events from BOTH the /api/builder/schedule timeline
 * (job-level events) AND /api/builder/deliveries (per-delivery scheduled
 * dates). They get color-coded: delivery (amber), install (walnut),
 * meeting/other (sky).
 */

import { useMemo, useState } from 'react'
import {
  ChevronLeft,
  ChevronRight,
  Clock,
  MapPin,
  Package,
  Truck,
  X,
} from 'lucide-react'
import { PortalCard } from '@/components/portal/PortalCard'
import type { DeliveriesResponse, PortalDelivery } from '@/types/portal'

export interface ScheduleResponse {
  timeline: Array<{
    id: string
    jobNumber: string
    status: string
    scopeType: string | null
    address: string | null
    community: string | null
    orderNumber: string | null
    orderId: string | null
    projectName: string | null
    scheduledDate: string | null
    actualDate: string | null
    completedAt: string | null
    schedule: Array<{
      id: string
      type: string | null
      title: string
      date: string | null
      time: string | null
      status: string | null
    }>
    deliveries: Array<{
      id: string
      deliveryNumber: string
      status: string
      address: string | null
    }>
  }>
  stats: {
    totalJobs: number
    activeJobs: number
    upcomingDeliveries: number
    inTransit: number
    completedThisMonth: number
  }
  projects: Array<{ id: string; name: string }>
}

interface CalendarEvent {
  id: string
  date: Date
  type: 'delivery' | 'install' | 'job' | 'other'
  title: string
  subtitle?: string
  status?: string
  href?: string
}

function startOfWeek(d: Date): Date {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  const dow = x.getDay() // 0=Sun
  // Use Monday as week start (most builder schedules)
  const offset = dow === 0 ? -6 : 1 - dow
  x.setDate(x.getDate() + offset)
  return x
}

function addDays(d: Date, n: number): Date {
  const x = new Date(d)
  x.setDate(x.getDate() + n)
  return x
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

function fmtDate(d: Date): string {
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

const DELIVERY_STATUS_COLOR: Record<
  string,
  { bg: string; fg: string; label: string }
> = {
  SCHEDULED:        { bg: 'rgba(140,168,184,0.16)', fg: '#3D5A6A', label: 'Scheduled' },
  LOADING:          { bg: 'rgba(212,165,74,0.16)',  fg: '#7A5413', label: 'Loading' },
  IN_TRANSIT:       { bg: 'rgba(201,130,43,0.14)',  fg: '#7A4E0F', label: 'In Transit' },
  ARRIVED:          { bg: 'rgba(201,130,43,0.14)',  fg: '#7A4E0F', label: 'Arrived' },
  UNLOADING:        { bg: 'rgba(201,130,43,0.14)',  fg: '#7A4E0F', label: 'Unloading' },
  COMPLETE:         { bg: 'rgba(56,128,77,0.12)',   fg: '#1A4B21', label: 'Complete' },
  PARTIAL_DELIVERY: { bg: 'rgba(212,165,74,0.16)',  fg: '#7A5413', label: 'Partial' },
  REFUSED:          { bg: 'rgba(110,42,36,0.10)',   fg: '#7E2417', label: 'Refused' },
  RESCHEDULED:      { bg: 'rgba(184,135,107,0.16)', fg: '#7A5A45', label: 'Rescheduled' },
}

interface ScheduleClientProps {
  schedule: ScheduleResponse | null
  deliveries: DeliveriesResponse
}

export function ScheduleClient({
  schedule,
  deliveries,
}: ScheduleClientProps) {
  const today = useMemo(() => {
    const t = new Date()
    t.setHours(0, 0, 0, 0)
    return t
  }, [])
  const [weekStart, setWeekStart] = useState(() => startOfWeek(today))
  const [selected, setSelected] = useState<CalendarEvent | null>(null)

  const stats = schedule?.stats ?? {
    totalJobs: 0,
    activeJobs: 0,
    upcomingDeliveries: 0,
    inTransit: 0,
    completedThisMonth: 0,
  }

  // Build event list from both schedule + deliveries
  const events: CalendarEvent[] = useMemo(() => {
    const out: CalendarEvent[] = []

    // From timeline jobs: scheduled date
    for (const job of schedule?.timeline ?? []) {
      if (job.scheduledDate) {
        out.push({
          id: `job-${job.id}`,
          date: new Date(job.scheduledDate),
          type: 'install',
          title: job.jobNumber,
          subtitle: job.address || job.community || '',
          status: job.status,
          href: job.orderId ? `/portal/orders/${job.orderId}` : undefined,
        })
      }
      for (const se of job.schedule || []) {
        if (!se.date) continue
        out.push({
          id: `se-${se.id}`,
          date: new Date(se.date),
          type:
            se.type?.toUpperCase() === 'DELIVERY'
              ? 'delivery'
              : se.type?.toUpperCase() === 'INSTALL'
                ? 'install'
                : 'other',
          title: se.title,
          subtitle: job.jobNumber,
          status: se.status || undefined,
        })
      }
    }

    // From deliveries: scheduledDate
    for (const d of deliveries.all) {
      out.push({
        id: `del-${d.id}`,
        date: new Date(d.scheduledDate),
        type: 'delivery',
        title: d.deliveryNumber,
        subtitle: d.address || d.community || '',
        status: d.latestStatus || d.status,
      })
    }

    return out
  }, [schedule, deliveries])

  const days = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
    [weekStart],
  )
  const weekEnd = addDays(weekStart, 6)
  const monthLabel = `${weekStart.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${weekEnd.toLocaleDateString(
    undefined,
    {
      month: weekStart.getMonth() === weekEnd.getMonth() ? undefined : 'short',
      day: 'numeric',
      year: 'numeric',
    },
  )}`

  function eventsForDay(day: Date): CalendarEvent[] {
    return events.filter((e) => sameDay(e.date, day))
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h2
            className="text-2xl font-medium leading-tight"
            style={{
              fontFamily: 'var(--font-portal-display, Georgia)',
              color: 'var(--portal-text-strong, #3E2A1E)',
              letterSpacing: '-0.02em',
            }}
          >
            Schedule
          </h2>
          <p
            className="text-sm mt-1"
            style={{ color: 'var(--portal-text-muted, #6B6056)' }}
          >
            Deliveries, installs, and jobs across your active builds.
          </p>
        </div>
      </div>

      {/* Stat strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Active Jobs" value={stats.activeJobs} accent="var(--portal-walnut, #3E2A1E)" />
        <Stat label="Upcoming Deliveries" value={stats.upcomingDeliveries} accent="var(--portal-amber, #C9822B)" />
        <Stat label="In Transit" value={stats.inTransit} accent="var(--portal-sky, #8CA8B8)" />
        <Stat label="Done This Month" value={stats.completedThisMonth} accent="var(--portal-success, #1A4B21)" />
      </div>

      {/* Week navigator + calendar */}
      <PortalCard
        title="Week View"
        action={
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setWeekStart((w) => addDays(w, -7))}
              className="h-8 w-8 inline-flex items-center justify-center rounded transition-colors hover:bg-[var(--portal-bg-elevated)]"
              aria-label="Previous week"
              style={{
                background: 'var(--portal-bg-card, #FFFFFF)',
                border: '1px solid var(--portal-border, #E8DFD0)',
                color: 'var(--portal-text-strong, #3E2A1E)',
              }}
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <div
              className="text-xs font-medium px-3 h-8 inline-flex items-center"
              style={{ color: 'var(--portal-text-strong, #3E2A1E)' }}
            >
              {monthLabel}
            </div>
            <button
              type="button"
              onClick={() => setWeekStart(startOfWeek(today))}
              className="h-8 px-3 inline-flex items-center justify-center rounded transition-colors text-xs font-medium"
              style={{
                background: 'var(--portal-bg-elevated, #FAF5E8)',
                color: 'var(--portal-walnut, #3E2A1E)',
              }}
              aria-label="Today"
            >
              Today
            </button>
            <button
              type="button"
              onClick={() => setWeekStart((w) => addDays(w, 7))}
              className="h-8 w-8 inline-flex items-center justify-center rounded transition-colors hover:bg-[var(--portal-bg-elevated)]"
              aria-label="Next week"
              style={{
                background: 'var(--portal-bg-card, #FFFFFF)',
                border: '1px solid var(--portal-border, #E8DFD0)',
                color: 'var(--portal-text-strong, #3E2A1E)',
              }}
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        }
      >
        <div className="grid grid-cols-7 gap-2">
          {days.map((d) => {
            const dayEvents = eventsForDay(d)
            const isToday = sameDay(d, today)
            return (
              <div
                key={d.toISOString()}
                className="min-h-[140px] rounded-md p-2 flex flex-col gap-1"
                style={{
                  background: isToday
                    ? 'rgba(201,130,43,0.04)'
                    : 'var(--portal-bg-card, #FFFFFF)',
                  border: isToday
                    ? '1px solid rgba(201,130,43,0.3)'
                    : '1px solid var(--portal-border-light, #F0E8DA)',
                }}
              >
                <div className="flex items-baseline justify-between">
                  <span
                    className="text-[10px] uppercase tracking-wider font-semibold"
                    style={{
                      color: isToday
                        ? 'var(--portal-amber, #C9822B)'
                        : 'var(--portal-kiln-oak, #8B6F47)',
                    }}
                  >
                    {d.toLocaleDateString(undefined, { weekday: 'short' })}
                  </span>
                  <span
                    className="text-sm font-mono tabular-nums"
                    style={{
                      color: isToday
                        ? 'var(--portal-amber, #C9822B)'
                        : 'var(--portal-text-strong, #3E2A1E)',
                      fontWeight: isToday ? 700 : 500,
                    }}
                  >
                    {d.getDate()}
                  </span>
                </div>
                <div className="flex flex-col gap-1 mt-1">
                  {dayEvents.slice(0, 4).map((e) => (
                    <button
                      key={e.id}
                      type="button"
                      onClick={() => setSelected(e)}
                      className="text-left text-[10px] px-1.5 py-1 rounded leading-tight truncate"
                      style={{
                        background:
                          e.type === 'delivery'
                            ? 'rgba(201,130,43,0.14)'
                            : e.type === 'install'
                              ? 'rgba(62,42,30,0.10)'
                              : 'rgba(140,168,184,0.16)',
                        color:
                          e.type === 'delivery'
                            ? '#7A4E0F'
                            : e.type === 'install'
                              ? 'var(--portal-walnut, #3E2A1E)'
                              : '#3D5A6A',
                      }}
                      title={`${e.title}${e.subtitle ? ' — ' + e.subtitle : ''}`}
                    >
                      {e.title}
                    </button>
                  ))}
                  {dayEvents.length > 4 && (
                    <span
                      className="text-[9px]"
                      style={{ color: 'var(--portal-text-muted, #6B6056)' }}
                    >
                      +{dayEvents.length - 4} more
                    </span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </PortalCard>

      {/* In Transit (highlighted) */}
      {deliveries.in_transit.length > 0 && (
        <InTransitRibbon deliveries={deliveries.in_transit} />
      )}

      {/* Two-column delivery lists */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <PortalCard
          title="Upcoming Deliveries"
          subtitle={
            deliveries.upcoming.length > 0
              ? `${deliveries.upcoming.length} scheduled`
              : 'None scheduled'
          }
        >
          {deliveries.upcoming.length === 0 ? (
            <p
              className="text-sm py-6 text-center"
              style={{ color: 'var(--portal-text-muted, #6B6056)' }}
            >
              No upcoming deliveries.
            </p>
          ) : (
            <ul className="space-y-3">
              {deliveries.upcoming.slice(0, 6).map((d) => (
                <DeliveryCard key={d.id} delivery={d} />
              ))}
            </ul>
          )}
        </PortalCard>

        <PortalCard
          title="Recently Completed"
          subtitle={
            deliveries.completed.length > 0
              ? `${deliveries.completed.length} delivered`
              : 'None yet'
          }
        >
          {deliveries.completed.length === 0 ? (
            <p
              className="text-sm py-6 text-center"
              style={{ color: 'var(--portal-text-muted, #6B6056)' }}
            >
              No completed deliveries yet.
            </p>
          ) : (
            <ul className="space-y-3">
              {deliveries.completed.slice(0, 6).map((d) => (
                <DeliveryCard key={d.id} delivery={d} compact />
              ))}
            </ul>
          )}
        </PortalCard>
      </div>

      {/* Event detail popover */}
      {selected && (
        <EventPopover event={selected} onClose={() => setSelected(null)} />
      )}
    </div>
  )
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string
  value: number
  accent: string
}) {
  return (
    <div
      className="rounded-[14px] p-4 relative overflow-hidden"
      style={{
        background: 'var(--portal-bg-card, #FFFFFF)',
        border: '1px solid var(--portal-border-light, #F0E8DA)',
      }}
    >
      <div
        className="absolute left-0 top-0 bottom-0 w-1"
        style={{ background: accent }}
      />
      <div className="pl-1.5">
        <div
          className="text-[10px] uppercase tracking-wider font-semibold"
          style={{ color: 'var(--portal-kiln-oak, #8B6F47)' }}
        >
          {label}
        </div>
        <div
          className="text-2xl font-semibold tabular-nums mt-1"
          style={{
            fontFamily: 'var(--font-portal-display, Georgia)',
            color: 'var(--portal-text-strong, #3E2A1E)',
            letterSpacing: '-0.02em',
          }}
        >
          {value}
        </div>
      </div>
    </div>
  )
}

function InTransitRibbon({
  deliveries,
}: {
  deliveries: PortalDelivery[]
}) {
  return (
    <div
      className="relative overflow-hidden rounded-[14px] p-4"
      style={{
        background:
          'linear-gradient(135deg, var(--portal-walnut, #3E2A1E), #4F3829)',
        color: 'white',
        boxShadow: 'var(--shadow-lg, 0 8px 24px rgba(62,42,30,0.18))',
      }}
    >
      <div
        className="absolute inset-0 opacity-[0.08] pointer-events-none"
        style={{
          backgroundImage:
            'radial-gradient(circle at 90% 20%, #C9822B 0, transparent 50%)',
        }}
      />
      {/* Animated glow line — visual ode to spec's BorderBeam */}
      <div
        className="absolute top-0 left-0 right-0 h-[2px]"
        style={{
          background:
            'linear-gradient(90deg, transparent, #D4A54A 50%, transparent)',
          animation: 'shimmer 3s linear infinite',
        }}
      />
      <div className="relative flex items-center justify-between gap-4 flex-wrap">
        <div>
          <div className="text-[10px] uppercase tracking-wider opacity-70">
            <Truck className="w-3 h-3 inline mr-1" />
            In Transit
          </div>
          <h3
            className="text-lg font-medium mt-0.5"
            style={{ fontFamily: 'var(--font-portal-display, Georgia)' }}
          >
            {deliveries.length} delivery{deliveries.length === 1 ? '' : ' on the move'}
          </h3>
        </div>
        <div className="flex flex-col gap-1.5 text-xs">
          {deliveries.slice(0, 3).map((d) => (
            <div
              key={d.id}
              className="flex items-center gap-2"
            >
              <span className="font-mono opacity-80">{d.deliveryNumber}</span>
              <span className="opacity-50">·</span>
              <span className="truncate max-w-[200px]">{d.address}</span>
              {d.latestEta && (
                <>
                  <span className="opacity-50">·</span>
                  <span className="opacity-90">
                    ETA {new Date(d.latestEta).toLocaleTimeString(undefined, {
                      hour: 'numeric',
                      minute: '2-digit',
                    })}
                  </span>
                </>
              )}
            </div>
          ))}
        </div>
      </div>
      <style jsx>{`
        @keyframes shimmer {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(100%); }
        }
        @media (prefers-reduced-motion: reduce) {
          .relative > div:nth-child(2) { animation: none; }
        }
      `}</style>
    </div>
  )
}

function DeliveryCard({
  delivery,
  compact,
}: {
  delivery: PortalDelivery
  compact?: boolean
}) {
  const status = delivery.latestStatus || delivery.status
  const badge = DELIVERY_STATUS_COLOR[status] || {
    bg: 'rgba(107,96,86,0.12)',
    fg: '#5A4F46',
    label: status,
  }
  const [rescheduling, setRescheduling] = useState(false)
  const [newDate, setNewDate] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [rescheduled, setRescheduled] = useState(false)

  async function handleReschedule() {
    if (!newDate) return
    setError(null)
    try {
      const res = await fetch(
        `/api/builder/deliveries/${delivery.id}/reschedule`,
        {
          method: 'PATCH',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ scheduledDate: newDate }),
        },
      )
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        throw new Error(data?.error || 'Failed to reschedule')
      }
      setRescheduled(true)
      setTimeout(() => {
        setRescheduling(false)
        setRescheduled(false)
      }, 1500)
    } catch (e: any) {
      setError(e?.message || 'Reschedule failed')
    }
  }

  return (
    <li
      className="rounded-md p-3"
      style={{
        background: 'var(--portal-bg-card, #FFFFFF)',
        border: '1px solid var(--portal-border-light, #F0E8DA)',
      }}
    >
      <div className="flex items-start gap-3">
        <div
          className="w-8 h-8 shrink-0 rounded-md flex items-center justify-center"
          style={{
            background: 'rgba(201,130,43,0.10)',
            color: 'var(--portal-amber, #C9822B)',
          }}
        >
          <Package className="w-4 h-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2 flex-wrap">
            <span
              className="font-mono text-xs font-medium"
              style={{ color: 'var(--portal-text-strong, #3E2A1E)' }}
            >
              {delivery.deliveryNumber}
            </span>
            <span
              className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium"
              style={{ background: badge.bg, color: badge.fg }}
            >
              {badge.label}
            </span>
          </div>
          <div
            className="text-xs mt-0.5 line-clamp-1 flex items-center gap-1"
            style={{ color: 'var(--portal-text-muted, #6B6056)' }}
          >
            <MapPin className="w-3 h-3 shrink-0" />
            {delivery.address || delivery.community || delivery.jobNumber}
          </div>
          {!compact && (
            <div
              className="text-[11px] mt-0.5 flex items-center gap-1"
              style={{ color: 'var(--portal-text-muted, #6B6056)' }}
            >
              <Clock className="w-3 h-3" />
              {new Date(delivery.scheduledDate).toLocaleDateString(undefined, {
                weekday: 'short',
                month: 'short',
                day: 'numeric',
              })}
              {delivery.latestEta && (
                <>
                  <span>·</span>
                  ETA{' '}
                  {new Date(delivery.latestEta).toLocaleTimeString(undefined, {
                    hour: 'numeric',
                    minute: '2-digit',
                  })}
                </>
              )}
            </div>
          )}
          {!compact && rescheduling && (
            <div className="mt-2 flex items-center gap-1.5 flex-wrap">
              <input
                type="date"
                value={newDate}
                onChange={(e) => setNewDate(e.target.value)}
                className="h-7 px-2 text-xs rounded"
                style={{
                  background: 'var(--portal-bg-card, #FFFFFF)',
                  border: '1px solid var(--portal-border, #E8DFD0)',
                  color: 'var(--portal-text-strong, #3E2A1E)',
                }}
              />
              <button
                type="button"
                onClick={handleReschedule}
                disabled={!newDate || rescheduled}
                className="h-7 px-2 text-[11px] rounded font-medium disabled:opacity-60"
                style={{
                  background: 'var(--portal-walnut, #3E2A1E)',
                  color: 'white',
                }}
              >
                {rescheduled ? 'Saved!' : 'Save'}
              </button>
              <button
                type="button"
                onClick={() => setRescheduling(false)}
                className="h-7 w-7 inline-flex items-center justify-center rounded hover:bg-[var(--portal-bg-elevated)]"
                aria-label="Cancel reschedule"
              >
                <X
                  className="w-3 h-3"
                  style={{ color: 'var(--portal-text-muted, #6B6056)' }}
                />
              </button>
              {error && (
                <p
                  className="w-full text-[10px]"
                  style={{ color: '#7E2417' }}
                >
                  {error}
                </p>
              )}
            </div>
          )}
          {!compact && !rescheduling && (
            <div className="mt-2 flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setRescheduling(true)}
                className="text-[11px] font-medium px-2 h-6 rounded transition-colors"
                style={{
                  background: 'var(--portal-bg-elevated, #FAF5E8)',
                  color: 'var(--portal-walnut, #3E2A1E)',
                }}
              >
                Reschedule
              </button>
              {delivery.latestLocation && (
                <span
                  className="text-[10px] inline-flex items-center gap-0.5"
                  style={{ color: 'var(--portal-text-muted, #6B6056)' }}
                >
                  <MapPin className="w-2.5 h-2.5" />
                  {delivery.latestLocation}
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    </li>
  )
}

function EventPopover({
  event,
  onClose,
}: {
  event: CalendarEvent
  onClose: () => void
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="absolute inset-0 backdrop-blur-sm"
        style={{ background: 'rgba(62,42,30,0.30)' }}
      />
      <div
        className="relative max-w-md w-full rounded-[14px] p-5"
        style={{
          background: 'var(--portal-bg-card, #FFFFFF)',
          border: '1px solid var(--portal-border, #E8DFD0)',
          boxShadow: 'var(--shadow-lg, 0 8px 24px rgba(62,42,30,0.18))',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute top-3 right-3 w-7 h-7 rounded-full flex items-center justify-center hover:bg-[var(--portal-bg-elevated)]"
          aria-label="Close"
        >
          <X className="w-4 h-4" style={{ color: 'var(--portal-text-muted, #6B6056)' }} />
        </button>
        <div
          className="text-[10px] uppercase tracking-wider font-semibold"
          style={{ color: 'var(--portal-kiln-oak, #8B6F47)' }}
        >
          {event.type}
        </div>
        <h3
          className="text-lg font-semibold mt-0.5 font-mono"
          style={{
            fontFamily: 'var(--font-portal-mono, JetBrains Mono)',
            color: 'var(--portal-text-strong, #3E2A1E)',
          }}
        >
          {event.title}
        </h3>
        {event.subtitle && (
          <p
            className="text-sm mt-1"
            style={{ color: 'var(--portal-text-muted, #6B6056)' }}
          >
            {event.subtitle}
          </p>
        )}
        <p
          className="text-xs mt-3 flex items-center gap-1"
          style={{ color: 'var(--portal-text-muted, #6B6056)' }}
        >
          <Clock className="w-3 h-3" />
          {event.date.toLocaleDateString(undefined, {
            weekday: 'long',
            month: 'long',
            day: 'numeric',
            year: 'numeric',
          })}
        </p>
        {event.status && (
          <p
            className="text-xs mt-1"
            style={{ color: 'var(--portal-text-muted, #6B6056)' }}
          >
            Status: {event.status.replace(/_/g, ' ').toLowerCase()}
          </p>
        )}
        {event.href && (
          <a
            href={event.href}
            className="inline-flex items-center gap-1.5 mt-4 px-3 h-8 rounded-md text-xs font-medium transition-shadow"
            style={{
              background:
                'var(--grad-amber, linear-gradient(135deg, #C9822B, #D4A54A, #C9822B))',
              color: 'white',
            }}
          >
            View Order
            <ChevronRight className="w-3 h-3" />
          </a>
        )}
      </div>
    </div>
  )
}

void fmtDate
