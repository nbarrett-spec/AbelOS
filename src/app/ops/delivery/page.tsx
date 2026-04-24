'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { Truck } from 'lucide-react'
import EmptyState from '@/components/ui/EmptyState'

interface DeliveryData {
  id: string
  deliveryNumber: string
  jobNumber: string
  address: string
  status: string
  crewName: string | null
  builder: {
    companyName: string
    contactName: string
    email: string
  } | null
  jobAddress: string | null
  latestTracking: {
    status: string
    location: string | null
    eta: string | null
    timestamp: string
  } | null
  eta: string | null
  lastUpdate: string
}

interface Job {
  id: string
  jobNumber: string
  jobAddress: string | null
  status: string
  scheduledDate: string | null
  builder: {
    companyName: string
  }
}

const STATUS_COLORS: Record<string, string> = {
  PICKING: '#6B7280',
  LOADED: '#3B82F6',
  DEPARTED: '#8B5CF6',
  EN_ROUTE: '#F97316',
  NEARBY: '#EAB308',
  ARRIVED: '#10B981',
  UNLOADING: '#6366F1',
  COMPLETE: '#059669',
  SCHEDULED: '#9CA3AF',
  LOADING: '#0EA5E9',
  IN_TRANSIT: '#F97316',
}

export default function DeliveryCommandCenter() {
  const [deliveries, setDeliveries] = useState<DeliveryData[]>([])
  const [todayJobs, setTodayJobs] = useState<Job[]>([])
  const [loading, setLoading] = useState(true)
  const [stats, setStats] = useState({
    todayCount: 0,
    inTransit: 0,
    completed: 0,
    crewsActive: 0,
  })
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<'all' | 'in-transit' | 'pending' | 'completed'>('all')
  const [viewMode, setViewMode] = useState<'list' | 'reorder'>('list')

  const loadData = async () => {
    try {
      setLoading(true)
      const today = new Date().toISOString().split('T')[0]

      const [deliveriesRes, jobsRes] = await Promise.all([
        fetch(`/api/ops/delivery/tracking?date=${today}`),
        fetch(`/api/ops/jobs?scheduledDateFrom=${today}&scheduledDateTo=${today}`),
      ])

      if (deliveriesRes.ok) {
        const data = await deliveriesRes.json()
        setDeliveries(data.deliveries || [])

        // Calculate stats
        const inTransit = (data.deliveries || []).filter(
          (d: DeliveryData) =>
            ['EN_ROUTE', 'NEARBY', 'DEPARTED', 'LOADED'].includes(d.status) ||
            (d.latestTracking?.status &&
              ['EN_ROUTE', 'NEARBY', 'DEPARTED', 'LOADED'].includes(
                d.latestTracking.status
              ))
        ).length
        const completed = (data.deliveries || []).filter(
          (d: DeliveryData) =>
            d.status === 'COMPLETE' ||
            (d.latestTracking?.status === 'COMPLETE')
        ).length
        const crewsActive = new Set(
          (data.deliveries || [])
            .filter(
              (d: DeliveryData) =>
                !['SCHEDULED', 'COMPLETE'].includes(d.status)
            )
            .map((d: DeliveryData) => d.crewName)
        ).size

        setStats({
          todayCount: data.deliveries.length,
          inTransit,
          completed,
          crewsActive,
        })
      }

      if (jobsRes.ok) {
        const data = await jobsRes.json()
        const unstarted = (data.jobs || []).filter(
          (j: Job) =>
            j.status === 'CREATED' ||
            j.status === 'READINESS_CHECK' ||
            j.status === 'MATERIALS_LOCKED'
        )
        setTodayJobs(unstarted)
      }
    } catch (error) {
      console.error('Failed to load delivery data:', error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
    // Auto-refresh every 30 seconds
    const interval = setInterval(loadData, 30000)
    return () => clearInterval(interval)
  }, [])

  const handleStatusUpdate = async (deliveryId: string, newStatus: string) => {
    setActionLoading(deliveryId)
    try {
      const delivery = deliveries.find((d) => d.id === deliveryId)
      if (!delivery) return

      const res = await fetch('/api/ops/delivery/tracking', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deliveryId,
          status: newStatus,
          location: delivery.address,
        }),
      })

      if (res.ok) {
        // Reload data
        await loadData()
      }
    } catch (error) {
      console.error('Failed to update delivery status:', error)
    } finally {
      setActionLoading(null)
    }
  }

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr)
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  const formatTime = (dateStr: string) => {
    const date = new Date(dateStr)
    const now = new Date()
    const diff = now.getTime() - date.getTime()
    const minutes = Math.floor(diff / 60000)
    if (minutes < 1) return 'just now'
    if (minutes < 60) return `${minutes}m ago`
    const hours = Math.floor(minutes / 60)
    if (hours < 24) return `${hours}h ago`
    const days = Math.floor(hours / 24)
    return `${days}d ago`
  }

  const getFilteredDeliveries = () => {
    return deliveries.filter((d) => {
      const status = d.latestTracking?.status || d.status
      if (statusFilter === 'all') return true
      if (statusFilter === 'in-transit') return ['EN_ROUTE', 'NEARBY', 'DEPARTED', 'LOADED'].includes(status)
      if (statusFilter === 'pending') return ['SCHEDULED', 'PICKING', 'LOADING'].includes(status)
      if (statusFilter === 'completed') return status === 'COMPLETE'
      return true
    })
  }

  const moveDeliveryUp = (index: number) => {
    if (index === 0) return
    const filtered = getFilteredDeliveries()
    const original = deliveries
    const itemToMove = filtered[index]
    const newIndex = original.indexOf(itemToMove) - 1
    if (newIndex < 0) return
    const newDeliveries = [...original]
    const temp = newDeliveries[newIndex]
    newDeliveries[newIndex] = newDeliveries[newIndex + 1]
    newDeliveries[newIndex + 1] = temp
    setDeliveries(newDeliveries)
  }

  const moveDeliveryDown = (index: number) => {
    const filtered = getFilteredDeliveries()
    if (index === filtered.length - 1) return
    const original = deliveries
    const itemToMove = filtered[index]
    const newIndex = original.indexOf(itemToMove) + 1
    if (newIndex >= original.length) return
    const newDeliveries = [...original]
    const temp = newDeliveries[newIndex]
    newDeliveries[newIndex] = newDeliveries[newIndex + 1]
    newDeliveries[newIndex + 1] = temp
    setDeliveries(newDeliveries)
  }

  const startNextDelivery = () => {
    const pending = getFilteredDeliveries().find((d) => {
      const status = d.latestTracking?.status || d.status
      return ['SCHEDULED', 'PICKING'].includes(status)
    })
    if (pending) {
      window.location.href = `/ops/jobs/${pending.jobNumber}`
    }
  }

  if (loading) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '400px',
        }}
      >
        <div
          style={{
            width: '40px',
            height: '40px',
            border: '4px solid #0f2a3e',
            borderTop: '4px solid transparent',
            borderRadius: '50%',
            animation: 'spin 1s linear infinite',
          }}
        />
      </div>
    )
  }

  return (
    <div style={{ maxWidth: '1400px', margin: '0 auto', padding: '20px' }}>
      <style>{`
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
        .stat-card {
          backgroundColor: white;
          border: 1px solid #E5E7EB;
          borderRadius: 8px;
          padding: 20px;
          textAlign: center;
        }
        .stat-value {
          fontSize: 28px;
          fontWeight: bold;
          color: #1B2A4A;
          margin: 8px 0;
        }
        .stat-label {
          fontSize: 12px;
          color: #6B7280;
          textTransform: uppercase;
          letterSpacing: 0.5px;
        }
        .status-badge {
          display: inline-block;
          padding: 6px 14px;
          borderRadius: 14px;
          fontSize: 12px;
          fontWeight: 700;
          color: white;
          textTransform: uppercase;
          letterSpacing: 0.5px;
        }
        .action-button {
          padding: 6px 12px;
          fontSize: 12px;
          fontWeight: 500;
          border: none;
          borderRadius: 6px;
          cursor: pointer;
          backgroundColor: #0f2a3e;
          color: white;
          marginRight: 6px;
          marginBottom: 6px;
          transition: background-color 0.2s;
        }
        .action-button:hover {
          backgroundColor: #0a1a28;
        }
        .action-button:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }
        .filter-button {
          padding: 8px 16px;
          fontSize: 13px;
          fontWeight: 500;
          border: 1px solid #E5E7EB;
          borderRadius: 6px;
          cursor: pointer;
          backgroundColor: white;
          color: #6B7280;
          marginRight: 8px;
          transition: all 0.2s;
        }
        .filter-button.active {
          backgroundColor: #0f2a3e;
          color: white;
          borderColor: #0f2a3e;
        }
        .filter-button:hover {
          borderColor: #0f2a3e;
          color: #0f2a3e;
        }
        .delivery-row {
          backgroundColor: white;
          border: 1px solid #E5E7EB;
          borderRadius: 8px;
          padding: 16px;
          marginBottom: 12px;
          display: grid;
          gridTemplateColumns: auto 1fr 1.5fr 1fr 1fr 1fr auto;
          gap: 16px;
          alignItems: start;
        }
        .delivery-row > div {
          display: flex;
          flexDirection: column;
        }
        .delivery-header {
          fontWeight: 600;
          color: #1B2A4A;
          marginBottom: 4px;
        }
        .delivery-sub {
          fontSize: 12px;
          color: #6B7280;
          marginBottom: 2px;
        }
        .timeline-container {
          backgroundColor: white;
          border: 1px solid #E5E7EB;
          borderRadius: 8px;
          padding: 20px;
          marginBottom: 24px;
          overflow-x: auto;
        }
        .timeline-block {
          display: inline-block;
          height: 60px;
          borderRadius: 6px;
          margin-right: 12px;
          padding: 8px;
          color: white;
          fontSize: 11px;
          fontWeight: 600;
          whiteSpace: nowrap;
          text-align: center;
          min-width: 80px;
          position: relative;
        }
        .move-button {
          padding: 4px 8px;
          fontSize: 11px;
          fontWeight: 500;
          border: 1px solid #E5E7EB;
          borderRadius: 4px;
          cursor: pointer;
          backgroundColor: white;
          color: #6B7280;
          transition: all 0.2s;
        }
        .move-button:hover {
          backgroundColor: #F3F4F6;
          borderColor: #0f2a3e;
          color: #0f2a3e;
        }
        .move-button:disabled {
          opacity: 0.4;
          cursor: not-allowed;
        }
      `}</style>

      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: '24px',
        }}
      >
        <div>
          <h1 style={{ fontSize: '24px', fontWeight: 'bold', color: '#1B2A4A' }}>
            Delivery Command Center
          </h1>
          <p style={{ fontSize: '14px', color: '#6B7280', marginTop: '4px' }}>
            Real-time delivery tracking and route management
          </p>
        </div>
        <button
          onClick={loadData}
          style={{
            padding: '8px 16px',
            fontSize: '14px',
            backgroundColor: '#C6A24E',
            color: 'white',
            border: 'none',
            borderRadius: '6px',
            cursor: 'pointer',
            fontWeight: '500',
          }}
        >
          Refresh
        </button>
      </div>

      {/* Quick Dispatch Panel */}
      {deliveries.filter(d => {
        const s = d.latestTracking?.status || d.status
        return !['COMPLETE', 'ARRIVED'].includes(s)
      }).length > 0 && (
        <div style={{ background: 'linear-gradient(135deg, #0f2a3e 0%, #2E86C1 100%)', borderRadius: 12, padding: 20, marginBottom: 24, color: '#fff' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <h3 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>Quick Dispatch</h3>
            <span style={{ fontSize: 12, opacity: 0.8 }}>Click to advance each delivery</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 10 }}>
            {deliveries
              .filter(d => {
                const s = d.latestTracking?.status || d.status
                return !['COMPLETE'].includes(s)
              })
              .slice(0, 6)
              .map(d => {
                const currentStatus = d.latestTracking?.status || d.status
                const nextStatusMap: Record<string, { next: string; label: string; color: string }> = {
                  SCHEDULED: { next: 'PICKING', label: 'Start Picking', color: '#3B82F6' },
                  PICKING: { next: 'LOADED', label: 'Mark Loaded', color: '#8B5CF6' },
                  LOADED: { next: 'DEPARTED', label: 'Depart Yard', color: '#F97316' },
                  LOADING: { next: 'LOADED', label: 'Mark Loaded', color: '#8B5CF6' },
                  DEPARTED: { next: 'EN_ROUTE', label: 'En Route', color: '#F97316' },
                  EN_ROUTE: { next: 'ARRIVED', label: 'Mark Arrived', color: '#10B981' },
                  NEARBY: { next: 'ARRIVED', label: 'Mark Arrived', color: '#10B981' },
                  ARRIVED: { next: 'COMPLETE', label: 'Complete', color: '#059669' },
                  UNLOADING: { next: 'COMPLETE', label: 'Complete', color: '#059669' },
                }
                const nextAction = nextStatusMap[currentStatus]
                return (
                  <div key={d.id} style={{ background: 'rgba(255,255,255,0.12)', borderRadius: 8, padding: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {d.builder?.companyName || d.deliveryNumber}
                      </div>
                      <div style={{ fontSize: 11, opacity: 0.7 }}>
                        {d.crewName || 'No crew'} · {currentStatus.replace(/_/g, ' ')}
                      </div>
                    </div>
                    {nextAction ? (
                      <button
                        onClick={() => handleStatusUpdate(d.id, nextAction.next)}
                        disabled={actionLoading === d.id}
                        style={{
                          padding: '6px 14px', borderRadius: 6, border: 'none', cursor: 'pointer',
                          background: nextAction.color, color: '#fff', fontSize: 11, fontWeight: 700,
                          whiteSpace: 'nowrap', opacity: actionLoading === d.id ? 0.6 : 1,
                        }}
                      >
                        {actionLoading === d.id ? '...' : nextAction.label}
                      </button>
                    ) : (
                      <span style={{ fontSize: 11, padding: '6px 14px', background: 'rgba(255,255,255,0.2)', borderRadius: 6, fontWeight: 600 }}>
                        Done
                      </span>
                    )}
                  </div>
                )
              })}
          </div>
        </div>
      )}

      {/* Stats Row */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: '16px',
          marginBottom: '24px',
        }}
      >
        <div className="stat-card">
          <div className="stat-label">Today's Deliveries</div>
          <div className="stat-value" style={{ color: '#0f2a3e' }}>
            {stats.todayCount}
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-label">In Transit</div>
          <div className="stat-value" style={{ color: '#F97316' }}>
            {stats.inTransit}
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Completed Today</div>
          <div className="stat-value" style={{ color: '#10B981' }}>
            {stats.completed}
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Crews Active</div>
          <div className="stat-value" style={{ color: '#8B5CF6' }}>
            {stats.crewsActive}
          </div>
        </div>
      </div>

      {/* Timeline View */}
      <div className="timeline-container">
        <div style={{ marginBottom: '12px' }}>
          <p style={{ fontSize: '12px', fontWeight: '600', color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            Today's Timeline
          </p>
        </div>
        <div style={{ display: 'flex', overflowX: 'auto', paddingBottom: '8px' }}>
          {getFilteredDeliveries().length === 0 ? (
            <p style={{ fontSize: '13px', color: '#9CA3AF' }}>No deliveries to display</p>
          ) : (
            getFilteredDeliveries().map((d) => {
              const status = d.latestTracking?.status || d.status
              const statusColor = STATUS_COLORS[status] || STATUS_COLORS.SCHEDULED
              const eta = d.eta || d.latestTracking?.eta || 'TBD'
              const etaTime = eta !== 'TBD' ? new Date(eta).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : 'TBD'
              return (
                <div
                  key={d.id}
                  className="timeline-block"
                  style={{ backgroundColor: statusColor }}
                  title={`${d.deliveryNumber} - ${etaTime}`}
                >
                  <div style={{ fontSize: '10px', fontWeight: '700' }}>{d.deliveryNumber}</div>
                  <div style={{ fontSize: '9px', marginTop: '2px', opacity: 0.9 }}>{etaTime}</div>
                </div>
              )
            })
          )}
        </div>
      </div>

      {/* Quick Filters */}
      <div
        style={{
          marginBottom: '24px',
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          flexWrap: 'wrap',
        }}
      >
        <span style={{ fontSize: '13px', fontWeight: '600', color: '#6B7280' }}>Filter:</span>
        <button
          className={`filter-button ${statusFilter === 'all' ? 'active' : ''}`}
          onClick={() => setStatusFilter('all')}
        >
          All
        </button>
        <button
          className={`filter-button ${statusFilter === 'in-transit' ? 'active' : ''}`}
          onClick={() => setStatusFilter('in-transit')}
        >
          In Transit
        </button>
        <button
          className={`filter-button ${statusFilter === 'pending' ? 'active' : ''}`}
          onClick={() => setStatusFilter('pending')}
        >
          Pending
        </button>
        <button
          className={`filter-button ${statusFilter === 'completed' ? 'active' : ''}`}
          onClick={() => setStatusFilter('completed')}
        >
          Completed
        </button>
      </div>

      {/* Start Next Delivery Button */}
      {getFilteredDeliveries().length > 0 && (
        <button
          onClick={startNextDelivery}
          style={{
            backgroundColor: '#C6A24E',
            color: 'white',
            padding: '14px 24px',
            fontSize: '15px',
            fontWeight: '700',
            border: 'none',
            borderRadius: '8px',
            cursor: 'pointer',
            marginBottom: '24px',
            transition: 'background-color 0.2s',
            width: '100%',
            textAlign: 'center',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#D46711')}
          onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#C6A24E')}
        >
          Start Next Delivery
        </button>
      )}

      {/* Active Deliveries */}
      <div style={{ marginBottom: '32px' }}>
        <div style={{ marginBottom: '16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h2 style={{ fontSize: '18px', fontWeight: '600', color: '#1B2A4A' }}>
            Delivery Schedule
          </h2>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              onClick={() => setViewMode('list')}
              style={{
                padding: '6px 12px',
                fontSize: '12px',
                fontWeight: '500',
                backgroundColor: viewMode === 'list' ? '#0f2a3e' : 'white',
                color: viewMode === 'list' ? 'white' : '#6B7280',
                border: `1px solid ${viewMode === 'list' ? '#0f2a3e' : '#E5E7EB'}`,
                borderRadius: '6px',
                cursor: 'pointer',
              }}
            >
              List
            </button>
            <button
              onClick={() => setViewMode('reorder')}
              style={{
                padding: '6px 12px',
                fontSize: '12px',
                fontWeight: '500',
                backgroundColor: viewMode === 'reorder' ? '#0f2a3e' : 'white',
                color: viewMode === 'reorder' ? 'white' : '#6B7280',
                border: `1px solid ${viewMode === 'reorder' ? '#0f2a3e' : '#E5E7EB'}`,
                borderRadius: '6px',
                cursor: 'pointer',
              }}
            >
              Reorder
            </button>
            <Link href="/ops/delivery/route-optimizer" style={{ textDecoration: 'none' }}>
              <button
                style={{
                  padding: '6px 12px',
                  fontSize: '12px',
                  fontWeight: '500',
                  backgroundColor: '#F3F4F6',
                  color: '#0f2a3e',
                  border: '1px solid #E5E7EB',
                  borderRadius: '6px',
                  cursor: 'pointer',
                }}
              >
                Route Optimizer
              </button>
            </Link>
          </div>
        </div>

        {getFilteredDeliveries().length === 0 ? (
          <div className="bg-surface border border-border rounded-lg p-10">
            <EmptyState
              icon={<Truck className="w-8 h-8 text-fg-subtle" />}
              title="No deliveries scheduled"
              description="No deliveries match this filter. Try switching to All or refresh."
            />
          </div>
        ) : (
          <div>
            {getFilteredDeliveries().map((delivery, index) => {
              const currentStatus =
                delivery.latestTracking?.status || delivery.status
              const statusColor =
                STATUS_COLORS[currentStatus] || STATUS_COLORS.SCHEDULED
              return (
                <div key={delivery.id} className="delivery-row">
                  {/* Reorder Controls */}
                  {viewMode === 'reorder' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      <button
                        className="move-button"
                        onClick={() => moveDeliveryUp(index)}
                        disabled={index === 0}
                        title="Move up in priority"
                      >
                        ↑
                      </button>
                      <button
                        className="move-button"
                        onClick={() => moveDeliveryDown(index)}
                        disabled={index === getFilteredDeliveries().length - 1}
                        title="Move down in priority"
                      >
                        ↓
                      </button>
                    </div>
                  )}

                  {/* Builder & Order */}
                  <div>
                    <div className="delivery-header">
                      {delivery.builder?.companyName || 'Unknown Builder'}
                    </div>
                    <div className="delivery-sub">
                      {delivery.deliveryNumber}
                    </div>
                    <div className="delivery-sub" style={{ marginTop: '4px' }}>
                      Order: {delivery.jobNumber}
                    </div>
                  </div>

                  {/* Address & Items */}
                  <div>
                    <div className="delivery-header" style={{ fontSize: '13px' }}>
                      {delivery.address || delivery.jobAddress || 'TBD'}
                    </div>
                    <div className="delivery-sub">
                      Crew: {delivery.crewName || 'Unassigned'}
                    </div>
                    <div className="delivery-sub" style={{ marginTop: '4px', color: '#0f2a3e', fontWeight: '500' }}>
                      Est. Time: {delivery.eta
                        ? formatDate(delivery.eta)
                        : delivery.latestTracking?.eta
                          ? formatDate(delivery.latestTracking.eta)
                          : 'TBD'}
                    </div>
                  </div>

                  {/* Status */}
                  <div>
                    <div
                      className="status-badge"
                      style={{ backgroundColor: statusColor }}
                    >
                      {currentStatus}
                    </div>
                    <div className="delivery-sub" style={{ marginTop: '8px' }}>
                      Last: {formatTime(delivery.lastUpdate)}
                    </div>
                  </div>

                  {/* Contact Info */}
                  <div>
                    <div className="delivery-header" style={{ fontSize: '13px' }}>
                      {delivery.builder?.contactName || 'N/A'}
                    </div>
                    <div className="delivery-sub">
                      {delivery.builder?.email || 'No email'}
                    </div>
                  </div>

                  {/* Actions */}
                  <div>
                    <div
                      style={{
                        display: 'flex',
                        flexWrap: 'wrap',
                        gap: '4px',
                      }}
                    >
                      {currentStatus !== 'LOADED' && (
                        <button
                          className="action-button"
                          disabled={actionLoading === delivery.id}
                          onClick={() =>
                            handleStatusUpdate(delivery.id, 'LOADED')
                          }
                        >
                          Mark Loaded
                        </button>
                      )}
                      {currentStatus !== 'DEPARTED' && (
                        <button
                          className="action-button"
                          disabled={actionLoading === delivery.id}
                          onClick={() =>
                            handleStatusUpdate(delivery.id, 'DEPARTED')
                          }
                        >
                          Mark Departed
                        </button>
                      )}
                      {currentStatus !== 'ARRIVED' && (
                        <button
                          className="action-button"
                          disabled={actionLoading === delivery.id}
                          onClick={() =>
                            handleStatusUpdate(delivery.id, 'ARRIVED')
                          }
                        >
                          Mark Arrived
                        </button>
                      )}
                      {currentStatus !== 'COMPLETE' && (
                        <button
                          className="action-button"
                          disabled={actionLoading === delivery.id}
                          onClick={() =>
                            handleStatusUpdate(delivery.id, 'COMPLETE')
                          }
                          style={{
                            backgroundColor:
                              actionLoading === delivery.id ? '#6B7280' : '#10B981',
                          }}
                        >
                          Mark Complete
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Start New Delivery */}
      {todayJobs.length > 0 && (
        <div style={{ marginBottom: '24px' }}>
          <div style={{ marginBottom: '16px' }}>
            <h2 style={{ fontSize: '18px', fontWeight: '600', color: '#1B2A4A' }}>
              Start New Delivery
            </h2>
            <p style={{ fontSize: '12px', color: '#6B7280', marginTop: '4px' }}>
              Today's scheduled jobs not yet started
            </p>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))',
              gap: '12px',
            }}
          >
            {todayJobs.map((job) => (
              <Link key={job.id} href={`/ops/jobs/${job.id}`}>
                <div
                  style={{
                    backgroundColor: 'white',
                    border: '1px solid #E5E7EB',
                    borderRadius: '8px',
                    padding: '12px',
                    cursor: 'pointer',
                    transition: 'box-shadow 0.2s',
                  }}
                  onMouseEnter={(e) =>
                    (e.currentTarget.style.boxShadow =
                      '0 4px 12px rgba(0,0,0,0.1)')
                  }
                  onMouseLeave={(e) =>
                    (e.currentTarget.style.boxShadow = 'none')
                  }
                >
                  <div
                    style={{
                      fontWeight: '600',
                      color: '#1B2A4A',
                      marginBottom: '4px',
                    }}
                  >
                    {job.jobNumber}
                  </div>
                  <div style={{ fontSize: '12px', color: '#6B7280' }}>
                    {job.builder.companyName}
                  </div>
                  <div style={{ fontSize: '12px', color: '#6B7280', marginTop: '4px' }}>
                    📍 {job.jobAddress || 'Address TBD'}
                  </div>
                  {job.scheduledDate && (
                    <div
                      style={{
                        fontSize: '12px',
                        color: '#0f2a3e',
                        marginTop: '8px',
                        fontWeight: '500',
                      }}
                    >
                      {formatDate(job.scheduledDate)}
                    </div>
                  )}
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
