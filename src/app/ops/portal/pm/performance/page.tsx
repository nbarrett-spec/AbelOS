'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'

interface KPIs {
  activeJobs: number
  completedLast30: number
  atRiskCount: number
  onTimeDeliveryRate: number
  avgCycleDays: number
  deliveriesThisWeek: number
}

interface AtRiskJob {
  id: string
  jobNumber: string
  status: string
  builderName: string
  communityName: string
  address: string
  daysOpen: number
  riskReason: string
}

interface Delivery {
  id: string
  scheduledDate: string
  type: string
  status: string
  jobNumber: string
  address: string
  builderName: string
  crewName: string | null
}

interface CrewUtil {
  id: string
  name: string
  type: string
  scheduledEntries: number
  completedEntries: number
}

interface DashboardData {
  kpis: KPIs
  jobsByStatus: Record<string, number>
  atRiskJobs: AtRiskJob[]
  upcomingDeliveries: Delivery[]
  crewUtilization: CrewUtil[]
}

const STATUS_COLORS: Record<string, string> = {
  CREATED: '#94a3b8',
  READINESS_CHECK: '#f59e0b',
  MATERIALS_LOCKED: '#3b82f6',
  IN_PRODUCTION: '#8b5cf6',
  STAGED: '#06b6d4',
  READY_TO_DELIVER: '#10b981',
  DELIVERED: '#22c55e',
  INSTALLED: '#14b8a6',
  QC_PASSED: '#0ea5e9',
  PUNCH: '#ef4444',
  INVOICED: '#6366f1',
}

export default function PMPerformancePage() {
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/ops/pm-dashboard')
      .then(res => {
        if (!res.ok) throw new Error('Failed to load')
        return res.json()
      })
      .then(setData)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return (
    <div style={{ padding: 32, textAlign: 'center', color: '#666' }}>Loading performance data...</div>
  )
  if (error) return (
    <div style={{ padding: 32, textAlign: 'center', color: '#ef4444' }}>Error: {error}</div>
  )
  if (!data) return null

  const { kpis, jobsByStatus, atRiskJobs, upcomingDeliveries, crewUtilization } = data

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#f8f9fa' }}>
      {/* Header */}
      <div style={{ backgroundColor: '#fff', borderBottom: '1px solid #e5e7eb', padding: '16px 24px' }}>
        <div style={{ maxWidth: 1400, margin: '0 auto' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, marginBottom: 12 }}>
            <Link href="/ops/portal/pm" style={{ color: '#C9822B', textDecoration: 'none', fontWeight: 500 }}>
              PM Portal
            </Link>
            <span style={{ color: '#999' }}>/</span>
            <span style={{ color: '#666', fontWeight: 500 }}>Performance</span>
          </div>
          <h1 style={{ margin: 0, fontSize: 28, fontWeight: 700, color: '#1a1a1a' }}>
            My Performance Dashboard
          </h1>
          <p style={{ margin: '6px 0 0', color: '#666', fontSize: 14 }}>
            Personal KPIs, at-risk jobs, and crew utilization
          </p>
        </div>
      </div>

      <div style={{ maxWidth: 1400, margin: '0 auto', padding: '24px' }}>
        {/* KPI Cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16, marginBottom: 32 }}>
          <KPICard
            label="Active Jobs"
            value={kpis.activeJobs}
            icon="🔧"
            color="#3b82f6"
          />
          <KPICard
            label="Completed (30d)"
            value={kpis.completedLast30}
            icon="✅"
            color="#22c55e"
          />
          <KPICard
            label="At Risk"
            value={kpis.atRiskCount}
            icon="⚠️"
            color={kpis.atRiskCount > 0 ? '#ef4444' : '#22c55e'}
          />
          <KPICard
            label="On-Time Delivery"
            value={`${kpis.onTimeDeliveryRate}%`}
            icon="🚚"
            color={kpis.onTimeDeliveryRate >= 90 ? '#22c55e' : kpis.onTimeDeliveryRate >= 75 ? '#f59e0b' : '#ef4444'}
          />
          <KPICard
            label="Avg Cycle (days)"
            value={kpis.avgCycleDays || '—'}
            icon="⏱️"
            color="#8b5cf6"
          />
          <KPICard
            label="Deliveries This Week"
            value={kpis.deliveriesThisWeek}
            icon="📦"
            color="#06b6d4"
          />
        </div>

        {/* Two-column layout */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, marginBottom: 32 }}>
          {/* Jobs by Status */}
          <div style={{ backgroundColor: '#fff', borderRadius: 8, border: '1px solid #e5e7eb', padding: 20 }}>
            <h2 style={{ margin: '0 0 16px', fontSize: 16, fontWeight: 600, color: '#1a1a1a' }}>My Jobs by Status</h2>
            {Object.entries(jobsByStatus).length === 0 ? (
              <p style={{ color: '#999', fontSize: 14 }}>No active jobs assigned</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {Object.entries(jobsByStatus)
                  .sort((a, b) => b[1] - a[1])
                  .map(([status, count]) => (
                  <div key={status} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{
                      width: 10, height: 10, borderRadius: '50%',
                      backgroundColor: STATUS_COLORS[status] || '#94a3b8',
                      flexShrink: 0,
                    }} />
                    <span style={{ flex: 1, fontSize: 13, color: '#444' }}>
                      {status.replace(/_/g, ' ')}
                    </span>
                    <span style={{ fontWeight: 600, fontSize: 14, color: '#1a1a1a' }}>{count}</span>
                    <div style={{
                      width: Math.min(count / kpis.activeJobs * 100, 100) + '%',
                      maxWidth: 120,
                      height: 6,
                      borderRadius: 3,
                      backgroundColor: STATUS_COLORS[status] || '#94a3b8',
                      opacity: 0.3,
                    }} />
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Crew Utilization */}
          <div style={{ backgroundColor: '#fff', borderRadius: 8, border: '1px solid #e5e7eb', padding: 20 }}>
            <h2 style={{ margin: '0 0 16px', fontSize: 16, fontWeight: 600, color: '#1a1a1a' }}>Crew Utilization (30d)</h2>
            {crewUtilization.length === 0 ? (
              <p style={{ color: '#999', fontSize: 14 }}>No crew data available</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {crewUtilization.map(crew => {
                  const completionRate = crew.scheduledEntries > 0
                    ? Math.round((crew.completedEntries / crew.scheduledEntries) * 100)
                    : 0
                  return (
                    <div key={crew.id}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                        <span style={{ fontSize: 13, fontWeight: 500, color: '#1a1a1a' }}>{crew.name}</span>
                        <span style={{ fontSize: 12, color: '#666' }}>
                          {crew.completedEntries}/{crew.scheduledEntries} ({completionRate}%)
                        </span>
                      </div>
                      <div style={{ height: 6, backgroundColor: '#f3f4f6', borderRadius: 3, overflow: 'hidden' }}>
                        <div style={{
                          width: `${completionRate}%`,
                          height: '100%',
                          borderRadius: 3,
                          backgroundColor: completionRate >= 80 ? '#22c55e' : completionRate >= 50 ? '#f59e0b' : '#ef4444',
                          transition: 'width 0.3s',
                        }} />
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>

        {/* At-Risk Jobs */}
        {atRiskJobs.length > 0 && (
          <div style={{ backgroundColor: '#fff', borderRadius: 8, border: '1px solid #fecaca', padding: 20, marginBottom: 24 }}>
            <h2 style={{ margin: '0 0 16px', fontSize: 16, fontWeight: 600, color: '#ef4444', display: 'flex', alignItems: 'center', gap: 8 }}>
              ⚠️ At-Risk Jobs ({atRiskJobs.length})
            </h2>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid #fee2e2' }}>
                    <th style={{ textAlign: 'left', padding: '8px 12px', color: '#666', fontWeight: 600 }}>Job #</th>
                    <th style={{ textAlign: 'left', padding: '8px 12px', color: '#666', fontWeight: 600 }}>Builder</th>
                    <th style={{ textAlign: 'left', padding: '8px 12px', color: '#666', fontWeight: 600 }}>Status</th>
                    <th style={{ textAlign: 'left', padding: '8px 12px', color: '#666', fontWeight: 600 }}>Days Open</th>
                    <th style={{ textAlign: 'left', padding: '8px 12px', color: '#666', fontWeight: 600 }}>Risk</th>
                  </tr>
                </thead>
                <tbody>
                  {atRiskJobs.map(job => (
                    <tr key={job.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                      <td style={{ padding: '10px 12px' }}>
                        <Link href={`/ops/jobs/${job.id}`} style={{ color: '#C9822B', textDecoration: 'none', fontWeight: 600 }}>
                          {job.jobNumber}
                        </Link>
                      </td>
                      <td style={{ padding: '10px 12px', color: '#1a1a1a' }}>{job.builderName}</td>
                      <td style={{ padding: '10px 12px' }}>
                        <span style={{
                          padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600,
                          backgroundColor: `${STATUS_COLORS[job.status] || '#94a3b8'}20`,
                          color: STATUS_COLORS[job.status] || '#94a3b8',
                        }}>
                          {job.status.replace(/_/g, ' ')}
                        </span>
                      </td>
                      <td style={{ padding: '10px 12px', color: '#666' }}>{job.daysOpen}d</td>
                      <td style={{ padding: '10px 12px', color: '#ef4444', fontWeight: 500, fontSize: 12 }}>
                        {job.riskReason}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Upcoming Deliveries */}
        <div style={{ backgroundColor: '#fff', borderRadius: 8, border: '1px solid #e5e7eb', padding: 20 }}>
          <h2 style={{ margin: '0 0 16px', fontSize: 16, fontWeight: 600, color: '#1a1a1a' }}>
            Upcoming Deliveries & Installs (7 days)
          </h2>
          {upcomingDeliveries.length === 0 ? (
            <p style={{ color: '#999', fontSize: 14 }}>No upcoming deliveries scheduled</p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid #e5e7eb' }}>
                    <th style={{ textAlign: 'left', padding: '8px 12px', color: '#666', fontWeight: 600 }}>Date</th>
                    <th style={{ textAlign: 'left', padding: '8px 12px', color: '#666', fontWeight: 600 }}>Type</th>
                    <th style={{ textAlign: 'left', padding: '8px 12px', color: '#666', fontWeight: 600 }}>Job #</th>
                    <th style={{ textAlign: 'left', padding: '8px 12px', color: '#666', fontWeight: 600 }}>Builder</th>
                    <th style={{ textAlign: 'left', padding: '8px 12px', color: '#666', fontWeight: 600 }}>Address</th>
                    <th style={{ textAlign: 'left', padding: '8px 12px', color: '#666', fontWeight: 600 }}>Crew</th>
                    <th style={{ textAlign: 'left', padding: '8px 12px', color: '#666', fontWeight: 600 }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {upcomingDeliveries.map(d => (
                    <tr key={d.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                      <td style={{ padding: '10px 12px', fontWeight: 500 }}>
                        {new Date(d.scheduledDate).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                      </td>
                      <td style={{ padding: '10px 12px' }}>
                        <span style={{ fontSize: 11, fontWeight: 600, color: d.type === 'DELIVERY' ? '#3b82f6' : '#8b5cf6' }}>
                          {d.type}
                        </span>
                      </td>
                      <td style={{ padding: '10px 12px' }}>
                        <Link href={`/ops/jobs`} style={{ color: '#C9822B', textDecoration: 'none', fontWeight: 500 }}>
                          {d.jobNumber}
                        </Link>
                      </td>
                      <td style={{ padding: '10px 12px', color: '#1a1a1a' }}>{d.builderName}</td>
                      <td style={{ padding: '10px 12px', color: '#666', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {d.address}
                      </td>
                      <td style={{ padding: '10px 12px', color: '#666' }}>{d.crewName || '—'}</td>
                      <td style={{ padding: '10px 12px' }}>
                        <span style={{
                          padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600,
                          backgroundColor: d.status === 'FIRM' ? '#dcfce7' : d.status === 'TENTATIVE' ? '#fef3c7' : '#e0e7ff',
                          color: d.status === 'FIRM' ? '#166534' : d.status === 'TENTATIVE' ? '#92400e' : '#3730a3',
                        }}>
                          {d.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function KPICard({ label, value, icon, color }: { label: string; value: string | number; icon: string; color: string }) {
  return (
    <div style={{
      backgroundColor: '#fff',
      borderRadius: 8,
      border: '1px solid #e5e7eb',
      padding: '16px 20px',
      display: 'flex',
      alignItems: 'center',
      gap: 14,
    }}>
      <div style={{
        width: 44, height: 44, borderRadius: 8,
        backgroundColor: `${color}15`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 20,
      }}>
        {icon}
      </div>
      <div>
        <div style={{ fontSize: 22, fontWeight: 700, color }}>{value}</div>
        <div style={{ fontSize: 12, color: '#666', marginTop: 2 }}>{label}</div>
      </div>
    </div>
  )
}
