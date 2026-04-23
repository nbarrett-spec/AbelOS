'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useStaffAuth } from '@/hooks/useStaffAuth'
import { useDriverLocation } from '@/hooks/useDriverLocation'
import { flushQueue, queueCount } from './ServiceWorker'
import { Badge } from '@/components/ui'

// ──────────────────────────────────────────────────────────────────────────
// Driver Portal — Today's Stops
//
// Mobile-first list of today's deliveries ordered by routeOrder. Every stop
// is a single big card with: tap-to-call, tap-to-navigate, complete button.
// No tables. No tight spacing. No small tap targets.
// ──────────────────────────────────────────────────────────────────────────

interface Stop {
  id: string
  deliveryNumber: string
  address: string | null
  routeOrder: number
  status: string
  builderName: string | null
  builderPhone?: string | null
  orderNumber: string | null
  orderTotal: number | null
  jobNumber: string
  crewId: string | null
  window: string | null
  notes: string
  signedBy: string | null
  completedAt: string | null
  departedAt: string | null
  arrivedAt: string | null
}

interface TodayResponse {
  date: string
  asOf: string
  drivers: Array<{
    driverId: string | null
    driverName: string
    crewId: string | null
    crewName: string | null
    deliveries: Stop[]
  }>
  summary: {
    total: number
    scheduled: number
    inTransit: number
    complete: number
  }
}

const STATUS_TONE: Record<string, 'neutral' | 'info' | 'warning' | 'success' | 'danger'> = {
  SCHEDULED: 'neutral',
  LOADING: 'info',
  IN_TRANSIT: 'warning',
  ARRIVED: 'info',
  UNLOADING: 'info',
  COMPLETE: 'success',
  PARTIAL_DELIVERY: 'warning',
  REFUSED: 'danger',
  RESCHEDULED: 'neutral',
}

function mapsUrl(address: string | null): string {
  if (!address) return '#'
  // Universal maps URL — iOS opens Apple Maps, Android opens Google Maps
  return `https://maps.google.com/?q=${encodeURIComponent(address)}`
}

function formatWindow(iso: string | null): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
    })
  } catch {
    return '—'
  }
}

export default function DriverTodayPage() {
  const { staff, loading: authLoading } = useStaffAuth()
  const [data, setData] = useState<TodayResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [online, setOnline] = useState(true)
  const [pending, setPending] = useState(0)
  const [shareLocation, setShareLocation] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/ops/delivery/today')
      if (res.ok) setData(await res.json())
    } catch {
      // Offline — SW will serve a cached copy on retry
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
    const t = setInterval(load, 60_000)
    return () => clearInterval(t)
  }, [load])

  // Online / offline + queue size
  useEffect(() => {
    if (typeof window === 'undefined') return
    const syncOnline = () => setOnline(navigator.onLine)
    const syncQueue = () => setPending(queueCount())
    syncOnline()
    syncQueue()
    const onOnline = async () => {
      syncOnline()
      await flushQueue()
      syncQueue()
      load()
    }
    const onOffline = () => syncOnline()
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    const t = setInterval(syncQueue, 10_000)
    return () => {
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
      clearInterval(t)
    }
  }, [load])

  // Pick "my" bucket — match by staffId = driverId if possible; else show all
  const myBucket = useMemo(() => {
    if (!data) return null
    if (!staff) return data.drivers[0] || null
    const mine = data.drivers.find((b) => b.driverId === staff.id)
    return mine || data.drivers[0] || null
  }, [data, staff])

  const nextStop = useMemo(() => {
    if (!myBucket) return null
    return (
      myBucket.deliveries.find((d) => d.status !== 'COMPLETE' && d.status !== 'PARTIAL_DELIVERY') ||
      null
    )
  }, [myBucket])

  // GPS — only pings when user opts in AND we have a crewId for the active stop
  const gps = useDriverLocation({
    crewId: myBucket?.crewId || nextStop?.crewId || null,
    enabled: shareLocation,
    activeDeliveryId: nextStop?.id || null,
  })

  if (authLoading) {
    return (
      <div style={{ padding: 32, textAlign: 'center', fontSize: 14 }}>
        Loading your route…
      </div>
    )
  }

  const stops = myBucket?.deliveries || []
  const completed = stops.filter((s) => s.status === 'COMPLETE' || s.status === 'PARTIAL_DELIVERY').length

  return (
    <div style={{ minHeight: '100vh', paddingBottom: 64 }}>
      {/* Sticky header — name, progress, status chips */}
      <header
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 10,
          background: 'var(--canvas, #0e1113)',
          borderBottom: '1px solid var(--border, #2a2722)',
          padding: '14px 16px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <div>
            <div style={{ fontSize: 12, color: 'var(--fg-muted, #a39a8a)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
              Today · {new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
            </div>
            <div style={{ fontSize: 22, fontWeight: 600, marginTop: 2 }}>
              {staff?.firstName ? `${staff.firstName}'s route` : myBucket?.driverName || 'Your route'}
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 22, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
              {completed}<span style={{ color: 'var(--fg-subtle, #7a7369)', fontWeight: 400 }}>/{stops.length}</span>
            </div>
            <div style={{ fontSize: 11, color: 'var(--fg-muted, #a39a8a)' }}>stops done</div>
          </div>
        </div>

        {/* Status chips */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
          {!online && (
            <span
              style={{
                fontSize: 11,
                padding: '4px 10px',
                borderRadius: 999,
                background: '#3b1d1d',
                color: '#fca5a5',
                fontWeight: 600,
              }}
            >
              OFFLINE
            </span>
          )}
          {pending > 0 && (
            <span
              style={{
                fontSize: 11,
                padding: '4px 10px',
                borderRadius: 999,
                background: '#2b2414',
                color: '#f5c168',
                fontWeight: 600,
              }}
            >
              QUEUED {pending}
            </span>
          )}
          <label
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 12,
              color: 'var(--fg-muted, #a39a8a)',
              marginLeft: 'auto',
              cursor: 'pointer',
            }}
          >
            <input
              type="checkbox"
              checked={shareLocation}
              onChange={(e) => setShareLocation(e.target.checked)}
              style={{ width: 18, height: 18 }}
            />
            Share location
          </label>
          {shareLocation && (
            <span
              style={{
                fontSize: 10,
                color:
                  gps.status === 'active'
                    ? '#7dd3a0'
                    : gps.status === 'denied' || gps.status === 'error'
                      ? '#fca5a5'
                      : 'var(--fg-subtle, #7a7369)',
                fontWeight: 600,
              }}
            >
              {gps.status === 'active'
                ? `GPS ${gps.postCount}`
                : gps.status === 'denied'
                  ? 'GPS denied'
                  : gps.status === 'unsupported'
                    ? 'GPS n/a'
                    : gps.status === 'prompting'
                      ? 'GPS…'
                      : gps.status === 'error'
                        ? 'GPS err'
                        : ''}
            </span>
          )}
        </div>

        {/* Quick links */}
        <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
          <Link
            href="/ops/portal/driver/briefing"
            style={linkBtnStyle}
          >
            Morning briefing
          </Link>
          <Link
            href="/ops/portal/driver/manifest"
            style={linkBtnStyle}
          >
            Print manifest
          </Link>
          <button onClick={load} disabled={loading} style={{ ...linkBtnStyle, marginLeft: 'auto' }}>
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </header>

      {/* Stops list */}
      <main style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
        {stops.length === 0 && !loading && (
          <div
            style={{
              textAlign: 'center',
              padding: 48,
              color: 'var(--fg-muted, #a39a8a)',
              background: 'var(--surface, #161a1d)',
              border: '1px solid var(--border, #2a2722)',
              borderRadius: 12,
            }}
          >
            No deliveries scheduled for you today.
          </div>
        )}

        {stops.map((stop, idx) => (
          <StopCard
            key={stop.id}
            stop={stop}
            index={idx}
            isNext={stop.id === nextStop?.id}
          />
        ))}
      </main>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────────
// StopCard — big, tappable, everything you need before tapping through
// ──────────────────────────────────────────────────────────────────────────

function StopCard({
  stop,
  index,
  isNext,
}: {
  stop: Stop
  index: number
  isNext: boolean
}) {
  const done = stop.status === 'COMPLETE' || stop.status === 'PARTIAL_DELIVERY'

  return (
    <article
      style={{
        background: 'var(--surface, #161a1d)',
        border: `1px solid ${isNext ? 'var(--accent-fg, #c6a24e)' : 'var(--border, #2a2722)'}`,
        borderRadius: 14,
        overflow: 'hidden',
        opacity: done ? 0.6 : 1,
        boxShadow: isNext ? '0 0 0 2px rgba(198, 162, 78, 0.15)' : 'none',
      }}
    >
      {/* Top row — stop number + status + window */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '14px 16px 10px',
          borderBottom: '1px solid var(--border, #2a2722)',
        }}
      >
        <div
          style={{
            flexShrink: 0,
            width: 40,
            height: 40,
            borderRadius: 20,
            background: isNext ? 'var(--accent-fg, #c6a24e)' : 'var(--surface-muted, #1f2326)',
            color: isNext ? '#0e1113' : 'var(--fg, #e7e1d6)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 16,
            fontWeight: 700,
          }}
        >
          {index + 1}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 16, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {stop.builderName || '—'}
          </div>
          <div style={{ fontSize: 12, color: 'var(--fg-muted, #a39a8a)', marginTop: 2 }}>
            {stop.deliveryNumber} · {stop.orderNumber || 'no PO'}
          </div>
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <Badge variant={STATUS_TONE[stop.status] || 'neutral'} size="sm">
            {stop.status.replace('_', ' ')}
          </Badge>
          {stop.window && (
            <div style={{ fontSize: 11, color: 'var(--fg-muted, #a39a8a)', marginTop: 4 }}>
              {formatWindow(stop.window)}
            </div>
          )}
        </div>
      </div>

      {/* Address — tap to open maps */}
      {stop.address && (
        <a
          href={mapsUrl(stop.address)}
          target="_blank"
          rel="noreferrer"
          style={{
            display: 'block',
            padding: '12px 16px',
            background: 'var(--canvas, #0e1113)',
            fontSize: 14,
            color: 'var(--fg, #e7e1d6)',
            textDecoration: 'none',
            borderBottom: '1px solid var(--border, #2a2722)',
          }}
        >
          <div style={{ fontSize: 10, color: 'var(--fg-muted, #a39a8a)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>
            Address · tap for maps
          </div>
          <div style={{ fontWeight: 500 }}>{stop.address}</div>
        </a>
      )}

      {/* Notes */}
      {stop.notes && (
        <div style={{ padding: '10px 16px', fontSize: 12, color: 'var(--fg-muted, #a39a8a)', fontStyle: 'italic', borderBottom: '1px solid var(--border, #2a2722)' }}>
          {stop.notes}
        </div>
      )}

      {/* Order meta */}
      {stop.orderTotal != null && (
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '10px 16px',
            borderBottom: '1px solid var(--border, #2a2722)',
          }}
        >
          <div style={{ fontSize: 11, color: 'var(--fg-muted, #a39a8a)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
            Order total
          </div>
          <div style={{ fontSize: 14, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
            ${Math.round(stop.orderTotal).toLocaleString()}
          </div>
        </div>
      )}

      {/* Action buttons — big, full-width, thumb-friendly */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0 }}>
        {stop.builderPhone && (
          <a
            href={`tel:${stop.builderPhone.replace(/[^\d+]/g, '')}`}
            style={{
              ...bigBtnStyle,
              color: 'var(--fg, #e7e1d6)',
              background: 'var(--surface-muted, #1f2326)',
              borderRight: '1px solid var(--border, #2a2722)',
            }}
          >
            Call
          </a>
        )}
        <a
          href={mapsUrl(stop.address)}
          target="_blank"
          rel="noreferrer"
          style={{
            ...bigBtnStyle,
            color: 'var(--fg, #e7e1d6)',
            background: 'var(--surface-muted, #1f2326)',
            gridColumn: stop.builderPhone ? undefined : '1 / -1',
          }}
        >
          Navigate
        </a>
      </div>

      {!done ? (
        <Link
          href={`/ops/portal/driver/${stop.id}`}
          style={{
            ...bigBtnStyle,
            display: 'block',
            color: '#0e1113',
            background: 'var(--accent-fg, #c6a24e)',
            textAlign: 'center',
            borderTop: '1px solid var(--border, #2a2722)',
            fontSize: 16,
            fontWeight: 700,
          }}
        >
          Complete delivery →
        </Link>
      ) : (
        <div
          style={{
            padding: '14px 16px',
            fontSize: 13,
            color: 'var(--data-positive, #7dd3a0)',
            background: 'var(--canvas, #0e1113)',
            borderTop: '1px solid var(--border, #2a2722)',
            textAlign: 'center',
          }}
        >
          {stop.signedBy ? `Signed by ${stop.signedBy}` : 'Delivered'}
        </div>
      )}
    </article>
  )
}

// Shared button styles — we don't use the Button component here because the
// drivers need comically-large tap targets that break the component's size
// scale. The rest of the portal (PageHeader, Badge, etc.) stays inside the
// design system.
const bigBtnStyle: React.CSSProperties = {
  padding: '16px 12px',
  fontSize: 15,
  fontWeight: 600,
  textAlign: 'center',
  textDecoration: 'none',
  border: 'none',
  cursor: 'pointer',
  minHeight: 56,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
}

const linkBtnStyle: React.CSSProperties = {
  padding: '8px 12px',
  fontSize: 12,
  fontWeight: 500,
  borderRadius: 8,
  background: 'var(--surface-muted, #1f2326)',
  color: 'var(--fg, #e7e1d6)',
  border: '1px solid var(--border, #2a2722)',
  textDecoration: 'none',
  cursor: 'pointer',
}
