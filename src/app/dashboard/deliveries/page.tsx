'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useAuth } from '@/hooks/useAuth'
import { DeliveryRescheduleModal } from '@/components/DeliveryRescheduleModal'

interface TrackingEvent {
  id: string
  status: string
  location: string | null
  notes: string | null
  eta: string | null
  timestamp: string
}

interface Delivery {
  id: string
  deliveryNumber: string
  jobNumber: string
  address: string
  community: string | null
  orderNumber: string
  projectName: string | null
  status: string
  scheduledDate: string
  departedAt: string | null
  arrivedAt: string | null
  completedAt: string | null
  loadPhotos: string[]
  sitePhotos: string[]
  signedBy: string | null
  damageNotes: string | null
  notes: string | null
  tracking: TrackingEvent[]
  latestStatus: string
  latestLocation: string | null
  latestEta: string | null
  latestTimestamp: string
}

interface GroupedDeliveries {
  upcoming: Delivery[]
  in_transit: Delivery[]
  completed: Delivery[]
  all: Delivery[]
}

const STATUS_CONFIG: Record<
  string,
  { bg: string; text: string; label: string; dot: string }
> = {
  SCHEDULED: { bg: 'bg-blue-50', text: 'text-blue-700', label: 'Scheduled', dot: 'bg-blue-500' },
  LOADING: { bg: 'bg-blue-50', text: 'text-blue-700', label: 'Loading', dot: 'bg-blue-500' },
  IN_TRANSIT: { bg: 'bg-orange-50', text: 'text-orange-700', label: 'In Transit', dot: 'bg-orange-500 animate-pulse' },
  ARRIVED: { bg: 'bg-orange-50', text: 'text-orange-700', label: 'Arrived', dot: 'bg-orange-500' },
  UNLOADING: { bg: 'bg-orange-50', text: 'text-orange-700', label: 'Unloading', dot: 'bg-orange-500' },
  COMPLETE: { bg: 'bg-green-50', text: 'text-green-700', label: 'Delivered', dot: 'bg-green-500' },
  PARTIAL_DELIVERY: { bg: 'bg-yellow-50', text: 'text-yellow-700', label: 'Partial', dot: 'bg-yellow-500' },
  REFUSED: { bg: 'bg-red-50', text: 'text-red-700', label: 'Refused', dot: 'bg-red-500' },
  RESCHEDULED: { bg: 'bg-purple-50', text: 'text-purple-700', label: 'Rescheduled', dot: 'bg-purple-500' },
}

function getDaysUntil(dateStr: string): string {
  const date = new Date(dateStr)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  date.setHours(0, 0, 0, 0)

  const diff = Math.ceil((date.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))

  if (diff < 0) return 'Overdue'
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Tomorrow'
  if (diff <= 7) return `In ${diff} days`

  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function formatTime(dateStr: string): string {
  return new Date(dateStr).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

interface ExpandedDeliveries {
  [key: string]: boolean
}

export default function DeliveriesPage() {
  const { builder, loading: authLoading } = useAuth()
  const [deliveries, setDeliveries] = useState<GroupedDeliveries | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'upcoming' | 'in_transit' | 'completed' | 'all'>('upcoming')
  const [expanded, setExpanded] = useState<ExpandedDeliveries>({})
  const [rescheduleModal, setRescheduleModal] = useState<{ deliveryId: string; deliveryNumber: string } | null>(null)

  useEffect(() => {
    const fetchDeliveries = async () => {
      try {
        const res = await fetch('/api/builder/deliveries')
        if (!res.ok) {
          throw new Error('Failed to fetch deliveries')
        }
        const data = await res.json()
        setDeliveries(data)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error')
      } finally {
        setLoading(false)
      }
    }

    if (!authLoading && builder) {
      fetchDeliveries()
    }
  }, [builder, authLoading])

  if (authLoading || loading) {
    return (
      <div style={{ padding: '40px', textAlign: 'center' }}>
        <p style={{ color: '#666' }}>Loading deliveries...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div style={{ padding: '40px' }}>
        <div style={{
          backgroundColor: '#fee2e2',
          border: '1px solid #fca5a5',
          borderRadius: '8px',
          padding: '16px',
          color: '#991b1b',
        }}>
          <p><strong>Error:</strong> {error}</p>
        </div>
      </div>
    )
  }

  if (!deliveries) {
    return (
      <div style={{ padding: '40px', textAlign: 'center' }}>
        <p style={{ color: '#666' }}>No deliveries found</p>
      </div>
    )
  }

  const stats = {
    scheduled: deliveries.upcoming.length,
    inTransit: deliveries.in_transit.length,
    delivered: deliveries.completed.filter((d) => d.latestStatus === 'COMPLETE').length,
  }

  const tabData = deliveries[activeTab]

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#f9fafb' }}>
      {/* Header */}
      <div style={{ backgroundColor: '#fff', borderBottom: '1px solid #e5e7eb', padding: '32px 24px' }}>
        <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
          <h1 style={{
            fontSize: '32px',
            fontWeight: 'bold',
            color: '#1f2937',
            marginBottom: '8px',
          }}>
            Deliveries
          </h1>
          <p style={{ color: '#666', fontSize: '14px' }}>
            Track your lumber and materials deliveries in real-time
          </p>
        </div>
      </div>

      {/* Summary Cards */}
      <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '24px 24px' }}>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
          gap: '16px',
          marginBottom: '32px',
        }}>
          {/* Scheduled This Week */}
          <div style={{
            backgroundColor: '#fff',
            border: '1px solid #e5e7eb',
            borderRadius: '8px',
            padding: '20px',
            boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
          }}>
            <div style={{ fontSize: '12px', color: '#6b7280', fontWeight: '500', marginBottom: '8px' }}>
              SCHEDULED THIS WEEK
            </div>
            <div style={{ fontSize: '32px', fontWeight: 'bold', color: '#1B4F72', marginBottom: '4px' }}>
              {stats.scheduled}
            </div>
            <div style={{ fontSize: '12px', color: '#9ca3af' }}>
              deliveries coming up
            </div>
          </div>

          {/* In Transit */}
          <div style={{
            backgroundColor: '#fff',
            border: '1px solid #e5e7eb',
            borderRadius: '8px',
            padding: '20px',
            boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
          }}>
            <div style={{ fontSize: '12px', color: '#6b7280', fontWeight: '500', marginBottom: '8px' }}>
              IN TRANSIT
            </div>
            <div style={{
              fontSize: '32px',
              fontWeight: 'bold',
              color: '#E67E22',
              marginBottom: '4px',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
            }}>
              {stats.inTransit}
              {stats.inTransit > 0 && (
                <div style={{
                  width: '8px',
                  height: '8px',
                  borderRadius: '50%',
                  backgroundColor: '#E67E22',
                  animation: 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
                }} />
              )}
            </div>
            <div style={{ fontSize: '12px', color: '#9ca3af' }}>
              on the road
            </div>
          </div>

          {/* Delivered This Month */}
          <div style={{
            backgroundColor: '#fff',
            border: '1px solid #e5e7eb',
            borderRadius: '8px',
            padding: '20px',
            boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
          }}>
            <div style={{ fontSize: '12px', color: '#6b7280', fontWeight: '500', marginBottom: '8px' }}>
              DELIVERED THIS MONTH
            </div>
            <div style={{ fontSize: '32px', fontWeight: 'bold', color: '#16a34a', marginBottom: '4px' }}>
              {stats.delivered}
            </div>
            <div style={{ fontSize: '12px', color: '#9ca3af' }}>
              completed deliveries
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div style={{
          display: 'flex',
          gap: '0',
          backgroundColor: '#fff',
          borderBottom: '1px solid #e5e7eb',
          borderRadius: '8px 8px 0 0',
          marginBottom: '24px',
          boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
        }}>
          {['upcoming', 'in_transit', 'completed', 'all'].map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab as typeof activeTab)}
              style={{
                flex: 1,
                padding: '12px 16px',
                backgroundColor: activeTab === tab ? '#f3f4f6' : 'transparent',
                color: activeTab === tab ? '#1B4F72' : '#6b7280',
                border: 'none',
                borderBottom: activeTab === tab ? '3px solid #1B4F72' : '1px solid #e5e7eb',
                fontSize: '14px',
                fontWeight: activeTab === tab ? '600' : '500',
                cursor: 'pointer',
                transition: 'all 0.2s',
              }}
            >
              {tab === 'in_transit' ? 'In Transit' : tab.charAt(0).toUpperCase() + tab.slice(1)}
              {tab === 'upcoming' && stats.scheduled > 0 && ` (${stats.scheduled})`}
              {tab === 'in_transit' && stats.inTransit > 0 && ` (${stats.inTransit})`}
              {tab === 'completed' && stats.delivered > 0 && ` (${stats.delivered})`}
              {tab === 'all' && deliveries.all.length > 0 && ` (${deliveries.all.length})`}
            </button>
          ))}
        </div>

        {/* Delivery Cards */}
        {tabData.length === 0 ? (
          <div style={{
            backgroundColor: '#f3f4f6',
            borderRadius: '8px',
            padding: '40px',
            textAlign: 'center',
          }}>
            <p style={{ color: '#6b7280', marginBottom: '8px' }}>No {activeTab.replace('_', ' ')} deliveries</p>
            <p style={{ color: '#9ca3af', fontSize: '13px' }}>
              {activeTab === 'upcoming' && "You'll see scheduled deliveries here"}
              {activeTab === 'in_transit' && 'No deliveries currently in transit'}
              {activeTab === 'completed' && 'No completed deliveries yet'}
              {activeTab === 'all' && 'No deliveries to display'}
            </p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {tabData.map((delivery) => {
              const config = STATUS_CONFIG[delivery.latestStatus] || STATUS_CONFIG.SCHEDULED
              const isExpanded = expanded[delivery.id]

              return (
                <div
                  key={delivery.id}
                  style={{
                    backgroundColor: '#fff',
                    border: '1px solid #e5e7eb',
                    borderRadius: '8px',
                    overflow: 'hidden',
                    boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
                    transition: 'box-shadow 0.2s',
                  }}
                >
                  {/* Card Header - Clickable to expand */}
                  <button
                    onClick={() =>
                      setExpanded({
                        ...expanded,
                        [delivery.id]: !isExpanded,
                      })
                    }
                    style={{
                      width: '100%',
                      padding: '16px',
                      backgroundColor: '#fff',
                      border: 'none',
                      textAlign: 'left',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: '12px',
                    }}
                  >
                    <div style={{ flex: 1, display: 'flex', gap: '12px', alignItems: 'center' }}>
                      {/* Status Dot */}
                      <div
                        style={{
                          width: '12px',
                          height: '12px',
                          borderRadius: '50%',
                          backgroundColor: config.dot.includes('animate-pulse')
                            ? '#E67E22'
                            : config.dot.split(' ')[0].match(/bg-(\w+)-(\d+)/)?.[0],
                          animation: config.dot.includes('animate-pulse') ? 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite' : 'none',
                          flexShrink: 0,
                        }}
                      />

                      {/* Main Info */}
                      <div style={{ flex: 1 }}>
                        <div style={{
                          display: 'grid',
                          gridTemplateColumns: '1fr 1fr 1fr auto',
                          gap: '16px',
                          alignItems: 'center',
                        }}>
                          {/* Order & Address */}
                          <div>
                            <div style={{
                              fontSize: '13px',
                              color: '#6b7280',
                              fontWeight: '500',
                              marginBottom: '2px',
                            }}>
                              {delivery.orderNumber}
                            </div>
                            <div style={{
                              fontSize: '14px',
                              fontWeight: '500',
                              color: '#1f2937',
                              maxWidth: '300px',
                              whiteSpace: 'nowrap',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                            }}>
                              {delivery.address}
                            </div>
                            {delivery.projectName && (
                              <div style={{
                                fontSize: '12px',
                                color: '#9ca3af',
                                marginTop: '2px',
                              }}>
                                {delivery.projectName}
                              </div>
                            )}
                          </div>

                          {/* Status & Date */}
                          <div>
                            <div style={{
                              backgroundColor: config.bg,
                              color: config.text,
                              padding: '4px 8px',
                              borderRadius: '4px',
                              fontSize: '12px',
                              fontWeight: '500',
                              display: 'inline-block',
                              marginBottom: '4px',
                            }}>
                              {config.label}
                            </div>
                            <div style={{
                              fontSize: '13px',
                              color: '#6b7280',
                              marginTop: '4px',
                            }}>
                              {getDaysUntil(delivery.scheduledDate)}
                            </div>
                          </div>

                          {/* Location/ETA */}
                          <div style={{ textAlign: 'right' }}>
                            {delivery.latestLocation && (
                              <>
                                <div style={{
                                  fontSize: '12px',
                                  color: '#6b7280',
                                  marginBottom: '2px',
                                }}>
                                  Location
                                </div>
                                <div style={{
                                  fontSize: '13px',
                                  color: '#1f2937',
                                  fontWeight: '500',
                                  maxWidth: '200px',
                                  whiteSpace: 'nowrap',
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                }}>
                                  {delivery.latestLocation}
                                </div>
                              </>
                            )}
                            {delivery.latestEta && (
                              <>
                                <div style={{
                                  fontSize: '12px',
                                  color: '#6b7280',
                                  marginTop: '2px',
                                  marginBottom: '2px',
                                }}>
                                  ETA
                                </div>
                                <div style={{
                                  fontSize: '13px',
                                  color: '#E67E22',
                                  fontWeight: '500',
                                }}>
                                  {formatTime(delivery.latestEta)}
                                </div>
                              </>
                            )}
                          </div>

                          {/* Expand Arrow */}
                          <div style={{
                            color: '#9ca3af',
                            transition: 'transform 0.2s',
                            transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
                            fontSize: '20px',
                          }}>
                            ▼
                          </div>
                        </div>
                      </div>
                    </div>
                  </button>

                  {/* Expanded Content */}
                  {isExpanded && (
                    <div style={{
                      borderTop: '1px solid #e5e7eb',
                      padding: '20px',
                      backgroundColor: '#f9fafb',
                    }}>
                      {/* Tracking Timeline */}
                      <div style={{ marginBottom: '24px' }}>
                        <h3 style={{
                          fontSize: '14px',
                          fontWeight: '600',
                          color: '#1f2937',
                          marginBottom: '12px',
                        }}>
                          Delivery Timeline
                        </h3>
                        <div style={{
                          position: 'relative',
                          paddingLeft: '24px',
                        }}>
                          {delivery.tracking.length === 0 ? (
                            <p style={{ color: '#9ca3af', fontSize: '13px' }}>No tracking events yet</p>
                          ) : (
                            <>
                              {delivery.tracking.map((event, idx) => (
                                <div
                                  key={event.id}
                                  style={{
                                    position: 'relative',
                                    paddingBottom: idx < delivery.tracking.length - 1 ? '16px' : '0',
                                  }}
                                >
                                  {/* Timeline dot */}
                                  <div
                                    style={{
                                      position: 'absolute',
                                      left: '-16px',
                                      top: '2px',
                                      width: '8px',
                                      height: '8px',
                                      borderRadius: '50%',
                                      backgroundColor: '#1B4F72',
                                      border: '2px solid #fff',
                                    }}
                                  />
                                  {/* Timeline line */}
                                  {idx < delivery.tracking.length - 1 && (
                                    <div
                                      style={{
                                        position: 'absolute',
                                        left: '-12px',
                                        top: '12px',
                                        width: '1px',
                                        height: '16px',
                                        backgroundColor: '#e5e7eb',
                                      }}
                                    />
                                  )}

                                  {/* Event content */}
                                  <div>
                                    <div style={{
                                      fontSize: '13px',
                                      fontWeight: '600',
                                      color: '#1f2937',
                                      marginBottom: '2px',
                                    }}>
                                      {event.status}
                                    </div>
                                    <div style={{
                                      fontSize: '12px',
                                      color: '#6b7280',
                                      marginBottom: event.location ? '4px' : '0',
                                    }}>
                                      {formatTime(event.timestamp)} on {formatDate(event.timestamp)}
                                    </div>
                                    {event.location && (
                                      <div style={{
                                        fontSize: '12px',
                                        color: '#6b7280',
                                        marginBottom: event.notes ? '4px' : '0',
                                      }}>
                                        📍 {event.location}
                                      </div>
                                    )}
                                    {event.notes && (
                                      <div style={{
                                        fontSize: '12px',
                                        color: '#6b7280',
                                        fontStyle: 'italic',
                                      }}>
                                        {event.notes}
                                      </div>
                                    )}
                                  </div>
                                </div>
                              ))}
                            </>
                          )}
                        </div>
                      </div>

                      {/* Delivery Photos */}
                      {(delivery.loadPhotos.length > 0 || delivery.sitePhotos.length > 0) && (
                        <div style={{ marginBottom: '24px' }}>
                          <h3 style={{
                            fontSize: '14px',
                            fontWeight: '600',
                            color: '#1f2937',
                            marginBottom: '12px',
                          }}>
                            Delivery Photos
                          </h3>
                          <div style={{
                            display: 'grid',
                            gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))',
                            gap: '8px',
                          }}>
                            {delivery.loadPhotos.map((photo, idx) => (
                              <a
                                key={`load-${idx}`}
                                href={photo}
                                target="_blank"
                                rel="noopener noreferrer"
                                style={{
                                  aspectRatio: '1',
                                  backgroundColor: '#e5e7eb',
                                  borderRadius: '4px',
                                  overflow: 'hidden',
                                  border: '1px solid #d1d5db',
                                  textDecoration: 'none',
                                }}
                              >
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                  src={photo}
                                  alt={`Load photo ${idx}`}
                                  loading="lazy"
                                  decoding="async"
                                  style={{
                                    width: '100%',
                                    height: '100%',
                                    objectFit: 'cover',
                                  }}
                                />
                              </a>
                            ))}
                            {delivery.sitePhotos.map((photo, idx) => (
                              <a
                                key={`site-${idx}`}
                                href={photo}
                                target="_blank"
                                rel="noopener noreferrer"
                                style={{
                                  aspectRatio: '1',
                                  backgroundColor: '#e5e7eb',
                                  borderRadius: '4px',
                                  overflow: 'hidden',
                                  border: '1px solid #d1d5db',
                                  textDecoration: 'none',
                                }}
                              >
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                  src={photo}
                                  alt={`Site photo ${idx}`}
                                  loading="lazy"
                                  decoding="async"
                                  style={{
                                    width: '100%',
                                    height: '100%',
                                    objectFit: 'cover',
                                  }}
                                />
                              </a>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Delivery Info */}
                      <div style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                        gap: '16px',
                        backgroundColor: '#fff',
                        padding: '12px',
                        borderRadius: '4px',
                        border: '1px solid #e5e7eb',
                      }}>
                        <div>
                          <div style={{ fontSize: '12px', color: '#6b7280', fontWeight: '500', marginBottom: '4px' }}>
                            Delivery #
                          </div>
                          <div style={{ fontSize: '13px', color: '#1f2937', fontWeight: '500' }}>
                            {delivery.deliveryNumber}
                          </div>
                        </div>
                        <div>
                          <div style={{ fontSize: '12px', color: '#6b7280', fontWeight: '500', marginBottom: '4px' }}>
                            Job #
                          </div>
                          <div style={{ fontSize: '13px', color: '#1f2937', fontWeight: '500' }}>
                            {delivery.jobNumber}
                          </div>
                        </div>
                        {delivery.signedBy && (
                          <div>
                            <div style={{ fontSize: '12px', color: '#6b7280', fontWeight: '500', marginBottom: '4px' }}>
                              Signed By
                            </div>
                            <div style={{ fontSize: '13px', color: '#1f2937', fontWeight: '500' }}>
                              {delivery.signedBy}
                            </div>
                          </div>
                        )}
                        {delivery.damageNotes && (
                          <div>
                            <div style={{ fontSize: '12px', color: '#c2410c', fontWeight: '500', marginBottom: '4px' }}>
                              ⚠️ Damage Notes
                            </div>
                            <div style={{ fontSize: '13px', color: '#1f2937' }}>
                              {delivery.damageNotes}
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Action Buttons */}
                      {['SCHEDULED', 'LOADING'].includes(delivery.latestStatus) && (
                        <div style={{
                          marginTop: '16px',
                          display: 'flex',
                          gap: '8px',
                        }}>
                          <button
                            style={{
                              padding: '8px 16px',
                              backgroundColor: '#fff',
                              color: '#6b7280',
                              border: '1px solid #d1d5db',
                              borderRadius: '4px',
                              fontSize: '13px',
                              fontWeight: '500',
                              cursor: 'pointer',
                              transition: 'all 0.2s',
                            }}
                            onMouseOver={(e) => {
                              e.currentTarget.style.backgroundColor = '#f3f4f6'
                            }}
                            onMouseOut={(e) => {
                              e.currentTarget.style.backgroundColor = '#fff'
                            }}
                          >
                            📞 Contact Driver
                          </button>
                          <button
                            onClick={() => setRescheduleModal({ deliveryId: delivery.id, deliveryNumber: delivery.deliveryNumber })}
                            style={{
                              padding: '8px 16px',
                              backgroundColor: '#fff',
                              color: '#6b7280',
                              border: '1px solid #d1d5db',
                              borderRadius: '4px',
                              fontSize: '13px',
                              fontWeight: '500',
                              cursor: 'pointer',
                              transition: 'all 0.2s',
                            }}
                            onMouseOver={(e) => {
                              e.currentTarget.style.backgroundColor = '#f3f4f6'
                            }}
                            onMouseOut={(e) => {
                              e.currentTarget.style.backgroundColor = '#fff'
                            }}
                          >
                            🔄 Reschedule
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Reschedule Modal */}
      {rescheduleModal && (
        <DeliveryRescheduleModal
          deliveryId={rescheduleModal.deliveryId}
          deliveryNumber={rescheduleModal.deliveryNumber}
          isOpen={true}
          onClose={() => setRescheduleModal(null)}
          onSuccess={() => {
            // Refresh deliveries after successful reschedule
            const fetchDeliveries = async () => {
              try {
                const res = await fetch('/api/builder/deliveries')
                if (res.ok) {
                  const data = await res.json()
                  setDeliveries(data)
                }
              } catch (err) {
                console.error('Failed to refresh deliveries:', err)
              }
            }
            fetchDeliveries()
          }}
        />
      )}

      <style>{`
        @keyframes pulse {
          0%, 100% {
            opacity: 1;
          }
          50% {
            opacity: 0.5;
          }
        }
      `}</style>
    </div>
  )
}
