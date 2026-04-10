'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'

// ── Types ─────────────────────────────────────────────────────────
interface Milestone {
  key: string
  label: string
  status: 'done' | 'current' | 'upcoming'
  active: boolean
}

interface ScheduleItem {
  id: string
  type: string
  title: string
  date: string
  time: string | null
  status: string
  crew: string | null
  vehicle: string | null
  notes: string | null
  startedAt: string | null
  completedAt: string | null
}

interface DeliveryItem {
  id: string
  deliveryNumber: string
  status: string
  address: string | null
  crew: string | null
  vehicle: string | null
  departedAt: string | null
  arrivedAt: string | null
  completedAt: string | null
  hasPhotos: boolean
  signedBy: string | null
}

interface TimelineJob {
  id: string
  jobNumber: string
  status: string
  scopeType: string
  address: string | null
  community: string | null
  lotBlock: string | null
  dropPlan: string | null
  orderNumber: string
  orderId: string
  orderTotal: number | null
  projectId: string | null
  projectName: string | null
  scheduledDate: string | null
  actualDate: string | null
  completedAt: string | null
  readinessCheck: boolean
  materialsLocked: boolean
  loadConfirmed: boolean
  milestones: Milestone[]
  schedule: ScheduleItem[]
  deliveries: DeliveryItem[]
}

interface Stats {
  totalJobs: number
  activeJobs: number
  upcomingDeliveries: number
  inTransit: number
  completedThisMonth: number
}

interface ProjectFilter {
  id: string
  name: string
}

type ViewMode = 'timeline' | 'calendar' | 'list'

// ── Status colors ──────────────────────────────────────────────────
const JOB_STATUS_CONFIG: Record<string, { bg: string; text: string; label: string }> = {
  CREATED: { bg: '#e0e7ff', text: '#3730a3', label: 'Created' },
  READINESS_CHECK: { bg: '#dbeafe', text: '#1e40af', label: 'Readiness Check' },
  MATERIALS_LOCKED: { bg: '#fef3c7', text: '#92400e', label: 'Materials Locked' },
  IN_PRODUCTION: { bg: '#fed7aa', text: '#9a3412', label: 'In Production' },
  STAGED: { bg: '#fde68a', text: '#78350f', label: 'Staged' },
  LOADED: { bg: '#bfdbfe', text: '#1e3a5f', label: 'Loaded' },
  IN_TRANSIT: { bg: '#fbcfe8', text: '#9d174d', label: 'In Transit' },
  DELIVERED: { bg: '#bbf7d0', text: '#166534', label: 'Delivered' },
  INSTALLING: { bg: '#c4b5fd', text: '#5b21b6', label: 'Installing' },
  PUNCH_LIST: { bg: '#fecaca', text: '#991b1b', label: 'Punch List' },
  COMPLETE: { bg: '#d1fae5', text: '#065f46', label: 'Complete' },
  INVOICED: { bg: '#e5e7eb', text: '#374151', label: 'Invoiced' },
  CLOSED: { bg: '#f3f4f6', text: '#6b7280', label: 'Closed' },
}

const DELIVERY_STATUS: Record<string, { color: string; label: string }> = {
  SCHEDULED: { color: '#3b82f6', label: 'Scheduled' },
  LOADING: { color: '#3b82f6', label: 'Loading' },
  IN_TRANSIT: { color: '#f59e0b', label: 'In Transit' },
  ARRIVED: { color: '#f59e0b', label: 'Arrived' },
  UNLOADING: { color: '#f59e0b', label: 'Unloading' },
  COMPLETE: { color: '#10b981', label: 'Delivered' },
  PARTIAL_DELIVERY: { color: '#eab308', label: 'Partial' },
  REFUSED: { color: '#ef4444', label: 'Refused' },
  RESCHEDULED: { color: '#8b5cf6', label: 'Rescheduled' },
}

const PROJECT_COLORS = [
  '#1B4F72', '#E67E22', '#27AE60', '#8E44AD', '#2980B9',
  '#D35400', '#16A085', '#C0392B', '#2C3E50', '#F39C12',
]

// ── Helpers ────────────────────────────────────────────────────────
function fmtDate(d: string | null): string {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function fmtDateFull(d: string | null): string {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function daysFromNow(d: string | null): string {
  if (!d) return ''
  const date = new Date(d)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  date.setHours(0, 0, 0, 0)
  const diff = Math.ceil((date.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
  if (diff < 0) return `${Math.abs(diff)}d ago`
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Tomorrow'
  return `In ${diff}d`
}

// ── Component ──────────────────────────────────────────────────────
export default function SchedulePage() {
  const [timeline, setTimeline] = useState<TimelineJob[]>([])
  const [stats, setStats] = useState<Stats | null>(null)
  const [projects, setProjects] = useState<ProjectFilter[]>([])
  const [loading, setLoading] = useState(true)
  const [viewMode, setViewMode] = useState<ViewMode>('timeline')
  const [selectedProject, setSelectedProject] = useState<string>('')
  const [expandedJob, setExpandedJob] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<string>('active')

  const fetchSchedule = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (selectedProject) params.set('projectId', selectedProject)
      const res = await fetch(`/api/builder/schedule?${params}`)
      if (res.ok) {
        const data = await res.json()
        setTimeline(data.timeline || [])
        setStats(data.stats || null)
        setProjects(data.projects || [])
      }
    } catch (err) {
      console.error('Failed to load schedule:', err)
    } finally {
      setLoading(false)
    }
  }, [selectedProject])

  useEffect(() => {
    fetchSchedule()
  }, [fetchSchedule])

  // Filter timeline by status
  const filtered = timeline.filter(job => {
    if (statusFilter === 'active') return !['COMPLETE', 'INVOICED', 'CLOSED'].includes(job.status)
    if (statusFilter === 'completed') return ['COMPLETE', 'INVOICED', 'CLOSED'].includes(job.status)
    return true
  })

  // Color per project
  const projectColorMap: Record<string, string> = {}
  const uniqueProjects = [...new Set(timeline.map(j => j.projectId || 'none'))]
  uniqueProjects.forEach((pid, i) => {
    projectColorMap[pid] = PROJECT_COLORS[i % PROJECT_COLORS.length]
  })

  const S = {
    page: { minHeight: '100vh', backgroundColor: '#f5f6fa', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' } as React.CSSProperties,
    header: { backgroundColor: '#1B4F72', color: '#fff', padding: '24px 32px' } as React.CSSProperties,
    headerRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap' as const, gap: 16 } as React.CSSProperties,
    title: { fontSize: 28, fontWeight: 700, margin: 0 } as React.CSSProperties,
    subtitle: { fontSize: 14, color: 'rgba(255,255,255,0.7)', margin: '4px 0 0' } as React.CSSProperties,
    controls: { display: 'flex', gap: 8 } as React.CSSProperties,
    viewBtn: (active: boolean) => ({
      padding: '6px 16px', border: 'none', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer',
      backgroundColor: active ? '#fff' : 'rgba(255,255,255,0.15)',
      color: active ? '#1B4F72' : 'rgba(255,255,255,0.9)',
      transition: 'all 0.2s',
    }) as React.CSSProperties,
    container: { maxWidth: 1400, margin: '0 auto', padding: '24px 32px' } as React.CSSProperties,
    statsRow: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16, marginBottom: 24 } as React.CSSProperties,
    statCard: { backgroundColor: '#fff', borderRadius: 8, padding: '16px 20px', border: '1px solid #e5e7eb' } as React.CSSProperties,
    statValue: { fontSize: 28, fontWeight: 700, color: '#1B4F72' } as React.CSSProperties,
    statLabel: { fontSize: 12, color: '#6b7280', fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: 0.5, marginTop: 4 } as React.CSSProperties,
    filterRow: { display: 'flex', gap: 12, marginBottom: 20, alignItems: 'center', flexWrap: 'wrap' as const } as React.CSSProperties,
    select: { padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 14, backgroundColor: '#fff' } as React.CSSProperties,
    filterBtn: (active: boolean) => ({
      padding: '6px 14px', border: '1px solid ' + (active ? '#1B4F72' : '#d1d5db'), borderRadius: 6,
      fontSize: 13, fontWeight: 600, cursor: 'pointer',
      backgroundColor: active ? '#1B4F72' : '#fff',
      color: active ? '#fff' : '#374151',
    }) as React.CSSProperties,
    jobCard: { backgroundColor: '#fff', borderRadius: 10, border: '1px solid #e5e7eb', marginBottom: 16, overflow: 'hidden', transition: 'box-shadow 0.2s' } as React.CSSProperties,
    jobHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 20px', cursor: 'pointer' } as React.CSSProperties,
    jobLeft: { display: 'flex', alignItems: 'center', gap: 16, flex: 1 } as React.CSSProperties,
    colorBar: (color: string) => ({ width: 4, height: 48, borderRadius: 2, backgroundColor: color }) as React.CSSProperties,
    jobNumber: { fontSize: 15, fontWeight: 700, color: '#1B4F72', fontFamily: 'monospace' } as React.CSSProperties,
    jobAddress: { fontSize: 13, color: '#6b7280', marginTop: 2 } as React.CSSProperties,
    jobRight: { display: 'flex', alignItems: 'center', gap: 16, flexShrink: 0 } as React.CSSProperties,
    badge: (bg: string, text: string) => ({
      display: 'inline-block', padding: '4px 10px', borderRadius: 4, fontSize: 12, fontWeight: 600, backgroundColor: bg, color: text,
    }) as React.CSSProperties,
    dateChip: { fontSize: 13, color: '#374151', fontWeight: 500, textAlign: 'right' as const } as React.CSSProperties,
    dateRelative: { fontSize: 11, color: '#9ca3af', marginTop: 2 } as React.CSSProperties,
    expandIcon: { fontSize: 14, color: '#9ca3af', transition: 'transform 0.2s' } as React.CSSProperties,
    expandBody: { padding: '0 20px 20px', borderTop: '1px solid #f3f4f6' } as React.CSSProperties,
    progressTrack: { display: 'flex', alignItems: 'center', gap: 2, margin: '16px 0 20px', overflowX: 'auto' as const } as React.CSSProperties,
    progressStep: (done: boolean, current: boolean) => ({
      flex: 1, height: 6, borderRadius: 3, minWidth: 20,
      backgroundColor: done ? '#10b981' : current ? '#E67E22' : '#e5e7eb',
      transition: 'background-color 0.3s',
    }) as React.CSSProperties,
    progressLabels: { display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#9ca3af', marginBottom: 16 } as React.CSSProperties,
    section: { marginTop: 16 } as React.CSSProperties,
    sectionTitle: { fontSize: 13, fontWeight: 700, color: '#374151', textTransform: 'uppercase' as const, letterSpacing: 0.5, marginBottom: 8 } as React.CSSProperties,
    scheduleRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', backgroundColor: '#f9fafb', borderRadius: 6, marginBottom: 6, fontSize: 13 } as React.CSSProperties,
    deliveryRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', backgroundColor: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, marginBottom: 8, fontSize: 13 } as React.CSSProperties,
    empty: { textAlign: 'center' as const, padding: '80px 20px', color: '#9ca3af' } as React.CSSProperties,
    link: { color: '#1B4F72', textDecoration: 'none', fontWeight: 600, fontSize: 13 } as React.CSSProperties,
  }

  return (
    <div style={S.page}>
      {/* Header */}
      <div style={S.header}>
        <div style={S.headerRow}>
          <div>
            <h1 style={S.title}>Job Schedule</h1>
            <p style={S.subtitle}>Visual command center for all your active jobs, deliveries, and milestones</p>
          </div>
          <div style={S.controls}>
            <button onClick={() => setViewMode('timeline')} style={S.viewBtn(viewMode === 'timeline')}>Timeline</button>
            <button onClick={() => setViewMode('list')} style={S.viewBtn(viewMode === 'list')}>List</button>
          </div>
        </div>
      </div>

      <div style={S.container}>
        {/* Stats */}
        {stats && (
          <div style={S.statsRow}>
            <div style={S.statCard}>
              <div style={S.statValue}>{stats.activeJobs}</div>
              <div style={S.statLabel}>Active Jobs</div>
            </div>
            <div style={S.statCard}>
              <div style={{ ...S.statValue, color: '#E67E22' }}>{stats.upcomingDeliveries}</div>
              <div style={S.statLabel}>Upcoming Deliveries</div>
            </div>
            <div style={S.statCard}>
              <div style={{ ...S.statValue, color: '#f59e0b' }}>{stats.inTransit}</div>
              <div style={S.statLabel}>In Transit Now</div>
            </div>
            <div style={S.statCard}>
              <div style={{ ...S.statValue, color: '#10b981' }}>{stats.completedThisMonth}</div>
              <div style={S.statLabel}>Completed This Month</div>
            </div>
            <div style={S.statCard}>
              <div style={S.statValue}>{stats.totalJobs}</div>
              <div style={S.statLabel}>Total Jobs</div>
            </div>
          </div>
        )}

        {/* Filters */}
        <div style={S.filterRow}>
          <button onClick={() => setStatusFilter('active')} style={S.filterBtn(statusFilter === 'active')}>Active</button>
          <button onClick={() => setStatusFilter('all')} style={S.filterBtn(statusFilter === 'all')}>All</button>
          <button onClick={() => setStatusFilter('completed')} style={S.filterBtn(statusFilter === 'completed')}>Completed</button>
          <span style={{ width: 1, height: 24, backgroundColor: '#d1d5db' }} />
          <select
            value={selectedProject}
            onChange={e => setSelectedProject(e.target.value)}
            style={S.select}
          >
            <option value="">All Projects</option>
            {projects.map(p => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>

        {/* Loading */}
        {loading ? (
          <div style={S.empty}>
            <div style={{ fontSize: 16, marginBottom: 8 }}>Loading your schedule...</div>
          </div>
        ) : filtered.length === 0 ? (
          <div style={S.empty}>
            <div style={{ fontSize: 20, marginBottom: 8, color: '#6b7280' }}>No jobs found</div>
            <div style={{ fontSize: 14 }}>
              {statusFilter === 'active'
                ? 'No active jobs in the current date range.'
                : 'No jobs match the current filters.'}
            </div>
          </div>
        ) : (
          /* Job Cards */
          filtered.map((job) => {
            const sc = JOB_STATUS_CONFIG[job.status] || { bg: '#f3f4f6', text: '#374151', label: job.status }
            const projColor = projectColorMap[job.projectId || 'none']
            const isExpanded = expandedJob === job.id
            const currentMilestone = job.milestones.find(m => m.status === 'current')

            return (
              <div key={job.id} style={{ ...S.jobCard, boxShadow: isExpanded ? '0 4px 12px rgba(0,0,0,0.08)' : 'none' }}>
                {/* Header row */}
                <div style={S.jobHeader} onClick={() => setExpandedJob(isExpanded ? null : job.id)}>
                  <div style={S.jobLeft}>
                    <div style={S.colorBar(projColor)} />
                    <div>
                      <div style={S.jobNumber}>{job.jobNumber}</div>
                      <div style={S.jobAddress}>
                        {job.projectName && <span style={{ fontWeight: 600, color: '#374151' }}>{job.projectName} — </span>}
                        {job.address || job.community || 'No address'}
                        {job.lotBlock && <span style={{ color: '#9ca3af' }}> ({job.lotBlock})</span>}
                      </div>
                    </div>
                  </div>
                  <div style={S.jobRight}>
                    {currentMilestone && (
                      <span style={{ fontSize: 12, color: '#6b7280', fontWeight: 500 }}>
                        {currentMilestone.label}
                      </span>
                    )}
                    <span style={S.badge(sc.bg, sc.text)}>{sc.label}</span>
                    {job.scheduledDate && (
                      <div style={S.dateChip}>
                        <div>{fmtDate(job.scheduledDate)}</div>
                        <div style={S.dateRelative}>{daysFromNow(job.scheduledDate)}</div>
                      </div>
                    )}
                    <span style={{ ...S.expandIcon, transform: isExpanded ? 'rotate(180deg)' : 'rotate(0)' }}>
                      &#9660;
                    </span>
                  </div>
                </div>

                {/* Expanded detail */}
                {isExpanded && (
                  <div style={S.expandBody}>
                    {/* Progress bar */}
                    <div style={S.progressTrack}>
                      {job.milestones.map((m) => (
                        <div key={m.key} style={S.progressStep(m.status === 'done', m.status === 'current')} title={m.label} />
                      ))}
                    </div>
                    <div style={S.progressLabels}>
                      <span>Created</span>
                      <span>Materials</span>
                      <span>Production</span>
                      <span>Delivery</span>
                      <span>Install</span>
                      <span>Complete</span>
                    </div>

                    {/* Job info grid */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 16 }}>
                      <div style={{ fontSize: 13 }}>
                        <span style={{ color: '#6b7280' }}>Order: </span>
                        <Link href={`/dashboard/orders/${job.orderId}`} style={S.link}>{job.orderNumber}</Link>
                      </div>
                      <div style={{ fontSize: 13 }}>
                        <span style={{ color: '#6b7280' }}>Scope: </span>
                        <span style={{ fontWeight: 500 }}>{job.scopeType.replace(/_/g, ' ')}</span>
                      </div>
                      {job.orderTotal && (
                        <div style={{ fontSize: 13 }}>
                          <span style={{ color: '#6b7280' }}>Order Total: </span>
                          <span style={{ fontWeight: 600, color: '#1B4F72' }}>
                            ${job.orderTotal.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
                          </span>
                        </div>
                      )}
                      <div style={{ fontSize: 13 }}>
                        <span style={{ color: '#6b7280' }}>Drop Plan: </span>
                        <span style={{ fontWeight: 500 }}>{job.dropPlan || 'Standard'}</span>
                      </div>
                    </div>

                    {/* Readiness indicators */}
                    <div style={{ display: 'flex', gap: 16, marginBottom: 16, fontSize: 13 }}>
                      <span style={{ color: job.readinessCheck ? '#10b981' : '#d1d5db' }}>
                        {job.readinessCheck ? '✅' : '⬜'} Readiness (T-72)
                      </span>
                      <span style={{ color: job.materialsLocked ? '#10b981' : '#d1d5db' }}>
                        {job.materialsLocked ? '✅' : '⬜'} Materials (T-48)
                      </span>
                      <span style={{ color: job.loadConfirmed ? '#10b981' : '#d1d5db' }}>
                        {job.loadConfirmed ? '✅' : '⬜'} Load (T-24)
                      </span>
                    </div>

                    {/* Schedule entries */}
                    {job.schedule.length > 0 && (
                      <div style={S.section}>
                        <div style={S.sectionTitle}>Schedule</div>
                        {job.schedule.map((se) => (
                          <div key={se.id} style={S.scheduleRow}>
                            <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                              <span style={{ fontWeight: 600 }}>{se.type}</span>
                              <span>{se.title}</span>
                              {se.crew && <span style={{ color: '#6b7280' }}>({se.crew})</span>}
                            </div>
                            <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                              <span>{fmtDate(se.date)}</span>
                              {se.time && <span style={{ color: '#6b7280' }}>{se.time}</span>}
                              <span style={S.badge(
                                se.status === 'COMPLETED' ? '#d1fae5' : se.status === 'IN_PROGRESS' ? '#fef3c7' : '#e0e7ff',
                                se.status === 'COMPLETED' ? '#065f46' : se.status === 'IN_PROGRESS' ? '#92400e' : '#3730a3'
                              )}>{se.status}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Deliveries */}
                    {job.deliveries.length > 0 && (
                      <div style={S.section}>
                        <div style={S.sectionTitle}>Deliveries</div>
                        {job.deliveries.map((d) => {
                          const ds = DELIVERY_STATUS[d.status] || { color: '#6b7280', label: d.status }
                          return (
                            <div key={d.id} style={S.deliveryRow}>
                              <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                                <span style={{ fontSize: 18 }}>🚚</span>
                                <div>
                                  <div style={{ fontWeight: 600 }}>{d.deliveryNumber}</div>
                                  <div style={{ fontSize: 12, color: '#6b7280' }}>{d.address || job.address}</div>
                                </div>
                              </div>
                              <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                                {d.crew && <span style={{ fontSize: 12, color: '#6b7280' }}>{d.crew} {d.vehicle ? `(${d.vehicle})` : ''}</span>}
                                <span style={{ ...S.badge(ds.color + '20', ds.color), borderLeft: `3px solid ${ds.color}` }}>
                                  {ds.label}
                                </span>
                                {d.hasPhotos && <span title="Photos available">📷</span>}
                                {d.signedBy && <span title={`Signed by ${d.signedBy}`}>✍️</span>}
                                <Link
                                  href={`/dashboard/deliveries`}
                                  style={{ ...S.link, fontSize: 12 }}
                                >
                                  Track →
                                </Link>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    )}

                    {/* No schedule/delivery */}
                    {job.schedule.length === 0 && job.deliveries.length === 0 && (
                      <div style={{ fontSize: 13, color: '#9ca3af', padding: '12px 0' }}>
                        No schedule entries or deliveries yet for this job.
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
