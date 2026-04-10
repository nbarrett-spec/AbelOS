'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'

interface TrackingEvent {
  id: string
  status: string
  location: string | null
  notes: string | null
  eta: string | null
  timestamp: string
}

interface DeliveryDetail {
  id: string
  deliveryNumber: string
  jobNumber: string
  address: string | null
  status: string
  crew: { id: string; name: string; vehiclePlate: string | null } | null
  currentStatus: {
    status: string
    eta: string | null
    location: string | null
    notes: string | null
    timestamp: string
  }
  timeline: TrackingEvent[]
  departedAt: string | null
  arrivedAt: string | null
  completedAt: string | null
}

interface TrackingData {
  orderId: string
  deliveries: DeliveryDetail[]
}

const STATUS_STEPS = [
  { key: 'SCHEDULED', label: 'Scheduled', icon: '📋' },
  { key: 'LOADING', label: 'Loading', icon: '📦' },
  { key: 'IN_TRANSIT', label: 'In Transit', icon: '🚚' },
  { key: 'ARRIVED', label: 'Arrived', icon: '📍' },
  { key: 'UNLOADING', label: 'Unloading', icon: '⬇️' },
  { key: 'COMPLETE', label: 'Delivered', icon: '✅' },
]

const STATUS_COLOR: Record<string, string> = {
  SCHEDULED: '#3b82f6',
  LOADING: '#3b82f6',
  IN_TRANSIT: '#f59e0b',
  ARRIVED: '#f59e0b',
  UNLOADING: '#f59e0b',
  COMPLETE: '#10b981',
  PARTIAL_DELIVERY: '#eab308',
  REFUSED: '#ef4444',
  RESCHEDULED: '#8b5cf6',
}

function fmtTime(d: string | null): string {
  if (!d) return '—'
  return new Date(d).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

function fmtDateTime(d: string | null): string {
  if (!d) return '—'
  return new Date(d).toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  })
}

function fmtEta(d: string | null): string {
  if (!d) return ''
  const eta = new Date(d)
  const now = new Date()
  const diffMin = Math.round((eta.getTime() - now.getTime()) / 60000)
  if (diffMin <= 0) return 'Arriving now'
  if (diffMin < 60) return `~${diffMin} min away`
  return `ETA: ${fmtTime(d)}`
}

export default function DeliveryTrackingPage() {
  const params = useParams()
  const deliveryId = params.id as string
  const [data, setData] = useState<TrackingData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [autoRefresh, setAutoRefresh] = useState(true)

  const fetchTracking = useCallback(async () => {
    try {
      // The existing API expects an orderId — we'll try both the delivery tracking endpoint
      const res = await fetch(`/api/builder/deliveries/track/${deliveryId}`)
      if (res.ok) {
        const result = await res.json()
        setData(result)
        setError(null)
      } else {
        setError('Unable to load delivery tracking')
      }
    } catch (err) {
      setError('Network error — check your connection')
    } finally {
      setLoading(false)
    }
  }, [deliveryId])

  useEffect(() => {
    fetchTracking()
  }, [fetchTracking])

  // Auto-refresh every 30 seconds for active deliveries
  useEffect(() => {
    if (!autoRefresh || !data) return
    const hasActive = data.deliveries.some(d =>
      ['IN_TRANSIT', 'ARRIVED', 'UNLOADING', 'LOADING'].includes(d.currentStatus.status)
    )
    if (!hasActive) return

    const interval = setInterval(fetchTracking, 30000)
    return () => clearInterval(interval)
  }, [autoRefresh, data, fetchTracking])

  const S = {
    page: { minHeight: '100vh', backgroundColor: '#f5f6fa', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' } as React.CSSProperties,
    header: { backgroundColor: '#1B4F72', color: '#fff', padding: '20px 32px' } as React.CSSProperties,
    breadcrumb: { fontSize: 13, color: 'rgba(255,255,255,0.6)', marginBottom: 8 } as React.CSSProperties,
    title: { fontSize: 24, fontWeight: 700, margin: 0 } as React.CSSProperties,
    container: { maxWidth: 900, margin: '0 auto', padding: '24px 32px' } as React.CSSProperties,
    card: { backgroundColor: '#fff', borderRadius: 12, border: '1px solid #e5e7eb', marginBottom: 20, overflow: 'hidden' } as React.CSSProperties,
    cardHeader: { padding: '20px 24px', borderBottom: '1px solid #f3f4f6' } as React.CSSProperties,
    cardBody: { padding: '20px 24px' } as React.CSSProperties,
    statusBanner: (color: string) => ({
      padding: '16px 24px', backgroundColor: color + '15', borderLeft: `4px solid ${color}`,
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    }) as React.CSSProperties,
    progressTrack: { display: 'flex', alignItems: 'center', padding: '24px 24px 16px', gap: 0 } as React.CSSProperties,
    stepDot: (active: boolean, current: boolean) => ({
      width: 32, height: 32, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: 14, flexShrink: 0,
      backgroundColor: active ? (current ? '#E67E22' : '#10b981') : '#e5e7eb',
      color: active ? '#fff' : '#9ca3af',
      border: current ? '3px solid #E67E22' : 'none',
      boxShadow: current ? '0 0 0 4px rgba(230,126,34,0.2)' : 'none',
    }) as React.CSSProperties,
    stepLine: (active: boolean) => ({
      flex: 1, height: 3, backgroundColor: active ? '#10b981' : '#e5e7eb',
    }) as React.CSSProperties,
    stepLabels: { display: 'flex', justifyContent: 'space-between', padding: '0 24px 20px', fontSize: 11, color: '#6b7280' } as React.CSSProperties,
    timelineItem: { display: 'flex', gap: 16, padding: '12px 0', borderBottom: '1px solid #f9fafb' } as React.CSSProperties,
    timelineDot: (color: string) => ({
      width: 10, height: 10, borderRadius: '50%', backgroundColor: color, marginTop: 4, flexShrink: 0,
    }) as React.CSSProperties,
    timelineContent: { flex: 1 } as React.CSSProperties,
    timelineStatus: { fontWeight: 600, fontSize: 14, color: '#1f2937' } as React.CSSProperties,
    timelineDetail: { fontSize: 13, color: '#6b7280', marginTop: 2 } as React.CSSProperties,
    timelineTime: { fontSize: 12, color: '#9ca3af', marginTop: 2 } as React.CSSProperties,
    crewCard: { display: 'flex', gap: 16, alignItems: 'center', padding: '16px 20px', backgroundColor: '#f9fafb', borderRadius: 8 } as React.CSSProperties,
    etaBanner: { padding: '12px 24px', backgroundColor: '#fffbeb', borderTop: '1px solid #fde68a', textAlign: 'center' as const, fontSize: 15, fontWeight: 600, color: '#92400e' } as React.CSSProperties,
    refreshBadge: { padding: '4px 10px', borderRadius: 20, fontSize: 11, fontWeight: 600, backgroundColor: autoRefresh ? '#dcfce7' : '#f3f4f6', color: autoRefresh ? '#166534' : '#6b7280', cursor: 'pointer', border: 'none' } as React.CSSProperties,
    link: { color: '#1B4F72', textDecoration: 'none', fontWeight: 600 } as React.CSSProperties,
    empty: { textAlign: 'center' as const, padding: 60, color: '#9ca3af' } as React.CSSProperties,
  }

  if (loading) {
    return (
      <div style={S.page}>
        <div style={S.header}>
          <h1 style={S.title}>Loading delivery tracking...</h1>
        </div>
      </div>
    )
  }

  if (error || !data) {
    return (
      <div style={S.page}>
        <div style={S.header}>
          <h1 style={S.title}>Delivery Tracking</h1>
        </div>
        <div style={S.container}>
          <div style={S.empty}>
            <div style={{ fontSize: 18, marginBottom: 12 }}>{error || 'No tracking data found'}</div>
            <Link href="/dashboard/deliveries" style={S.link}>← Back to Deliveries</Link>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div style={S.page}>
      <div style={S.header}>
        <div style={S.breadcrumb}>
          <Link href="/dashboard/deliveries" style={{ color: 'rgba(255,255,255,0.8)', textDecoration: 'none' }}>
            Deliveries
          </Link> → Tracking
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h1 style={S.title}>
            Delivery Tracking
          </h1>
          <button
            onClick={() => setAutoRefresh(!autoRefresh)}
            style={S.refreshBadge}
          >
            {autoRefresh ? '● Live' : '○ Paused'}
          </button>
        </div>
      </div>

      <div style={S.container}>
        {data.deliveries.map((delivery) => {
          const statusColor = STATUS_COLOR[delivery.currentStatus.status] || '#6b7280'
          const statusIdx = STATUS_STEPS.findIndex(s => s.key === delivery.currentStatus.status)

          return (
            <div key={delivery.id} style={S.card}>
              {/* Status banner */}
              <div style={S.statusBanner(statusColor)}>
                <div>
                  <div style={{ fontSize: 20, fontWeight: 700, color: statusColor }}>
                    {STATUS_STEPS.find(s => s.key === delivery.currentStatus.status)?.icon || '📦'}{' '}
                    {STATUS_STEPS.find(s => s.key === delivery.currentStatus.status)?.label || delivery.currentStatus.status}
                  </div>
                  <div style={{ fontSize: 14, color: '#374151', marginTop: 4 }}>
                    {delivery.deliveryNumber} — {delivery.address || 'Address pending'}
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 12, color: '#6b7280' }}>Last updated</div>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>{fmtDateTime(delivery.currentStatus.timestamp)}</div>
                </div>
              </div>

              {/* ETA banner */}
              {delivery.currentStatus.eta && ['IN_TRANSIT', 'LOADING'].includes(delivery.currentStatus.status) && (
                <div style={S.etaBanner}>
                  {fmtEta(delivery.currentStatus.eta)}
                </div>
              )}

              {/* Progress steps */}
              <div style={S.progressTrack}>
                {STATUS_STEPS.map((step, i) => (
                  <div key={step.key} style={{ display: 'contents' }}>
                    <div style={S.stepDot(i <= statusIdx, i === statusIdx)}>
                      {i <= statusIdx ? step.icon : ''}
                    </div>
                    {i < STATUS_STEPS.length - 1 && (
                      <div style={S.stepLine(i < statusIdx)} />
                    )}
                  </div>
                ))}
              </div>
              <div style={S.stepLabels}>
                {STATUS_STEPS.map(step => (
                  <span key={step.key} style={{ width: `${100 / STATUS_STEPS.length}%`, textAlign: 'center' }}>{step.label}</span>
                ))}
              </div>

              {/* Crew info */}
              {delivery.crew && (
                <div style={{ padding: '0 24px 16px' }}>
                  <div style={S.crewCard}>
                    <div style={{ width: 40, height: 40, borderRadius: '50%', backgroundColor: '#1B4F72', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, fontWeight: 700 }}>
                      🚛
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600, fontSize: 14 }}>{delivery.crew.name}</div>
                      {delivery.crew.vehiclePlate && (
                        <div style={{ fontSize: 13, color: '#6b7280' }}>Vehicle: {delivery.crew.vehiclePlate}</div>
                      )}
                    </div>
                    {delivery.currentStatus.location && (
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: 12, color: '#6b7280' }}>Last Location</div>
                        <div style={{ fontSize: 13, fontWeight: 500 }}>{delivery.currentStatus.location}</div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Timeline */}
              {delivery.timeline.length > 0 && (
                <div style={S.cardBody}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#374151', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 12 }}>
                    Tracking Timeline
                  </div>
                  {[...delivery.timeline].reverse().map((event) => {
                    const evColor = STATUS_COLOR[event.status] || '#6b7280'
                    return (
                      <div key={event.id} style={S.timelineItem}>
                        <div style={S.timelineDot(evColor)} />
                        <div style={S.timelineContent}>
                          <div style={S.timelineStatus}>{event.status.replace(/_/g, ' ')}</div>
                          {event.location && (
                            <div style={S.timelineDetail}>{event.location}</div>
                          )}
                          {event.notes && (
                            <div style={S.timelineDetail}>{event.notes}</div>
                          )}
                          <div style={S.timelineTime}>{fmtDateTime(event.timestamp)}</div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}

              {/* Key timestamps */}
              <div style={{ ...S.cardBody, borderTop: '1px solid #f3f4f6' }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
                  <div>
                    <div style={{ fontSize: 11, color: '#6b7280', fontWeight: 600, textTransform: 'uppercase' }}>Departed</div>
                    <div style={{ fontSize: 14, fontWeight: 500, marginTop: 4 }}>{fmtDateTime(delivery.departedAt)}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 11, color: '#6b7280', fontWeight: 600, textTransform: 'uppercase' }}>Arrived</div>
                    <div style={{ fontSize: 14, fontWeight: 500, marginTop: 4 }}>{fmtDateTime(delivery.arrivedAt)}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 11, color: '#6b7280', fontWeight: 600, textTransform: 'uppercase' }}>Completed</div>
                    <div style={{ fontSize: 14, fontWeight: 500, marginTop: 4 }}>{fmtDateTime(delivery.completedAt)}</div>
                  </div>
                </div>
              </div>
            </div>
          )
        })}

        {data.deliveries.length === 0 && (
          <div style={S.empty}>
            <div style={{ fontSize: 18, marginBottom: 12 }}>No deliveries found for this order</div>
            <Link href="/dashboard/deliveries" style={S.link}>← Back to Deliveries</Link>
          </div>
        )}
      </div>
    </div>
  )
}
