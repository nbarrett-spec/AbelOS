'use client'

import { useState, useEffect } from 'react'

const PRIORITY_COLORS: Record<string, string> = { HIGH: '#e74c3c', MEDIUM: '#e67e22', LOW: '#3498db' }
const STATUS_COLORS: Record<string, string> = { OVERLOADED: '#e74c3c', UNDERUTILIZED: '#f39c12', BALANCED: '#27ae60' }
const SUGGESTION_ICONS: Record<string, string> = { REBALANCE: '⚖️', UTILIZE: '📈', SCHEDULE: '📅', BATCH: '📦', REVIEW: '🔍' }

function KPICard({ label, value, sub, color }: { label: string; value: string | number; sub?: string; color?: string }) {
  return (
    <div style={{ background: '#fff', borderRadius: 10, padding: '18px 22px', boxShadow: '0 1px 4px rgba(0,0,0,0.07)', borderLeft: `4px solid ${color || '#1B4F72'}` }}>
      <div style={{ fontSize: 13, color: '#666', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 700, color: color || '#1B4F72' }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: '#999', marginTop: 2 }}>{sub}</div>}
    </div>
  )
}

function Badge({ text, color }: { text: string; color: string }) {
  return (
    <span style={{ display: 'inline-block', padding: '2px 10px', borderRadius: 12, fontSize: 11, fontWeight: 600, background: color + '22', color, border: `1px solid ${color}44` }}>
      {text}
    </span>
  )
}

function UtilizationBar({ pct }: { pct: number }) {
  const color = pct > 90 ? '#e74c3c' : pct > 70 ? '#e67e22' : pct > 40 ? '#27ae60' : '#3498db'
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{ flex: 1, height: 12, background: '#f0f0f0', borderRadius: 6, overflow: 'hidden' }}>
        <div style={{ width: `${Math.min(100, pct)}%`, height: '100%', background: color, borderRadius: 6 }} />
      </div>
      <span style={{ fontSize: 12, fontWeight: 600, color, minWidth: 36 }}>{Math.round(pct)}%</span>
    </div>
  )
}

export default function SchedulingOptimizerPage() {
  const [tab, setTab] = useState('dashboard')
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    fetch(`/api/ops/ai/scheduling?report=${tab}`)
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [tab])

  const tabs = [
    { id: 'dashboard', label: 'Overview' },
    { id: 'workload', label: 'Workload Balance' },
    { id: 'conflicts', label: 'Conflicts' },
    { id: 'capacity', label: 'Capacity Planning' },
    { id: 'optimization', label: 'AI Suggestions' },
  ]

  return (
    <div style={{ padding: '24px 32px', maxWidth: 1400 }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, color: '#1B4F72', marginBottom: 4 }}>AI Scheduling Optimizer</h1>
      <p style={{ color: '#666', fontSize: 14, marginBottom: 20 }}>Intelligent crew scheduling, workload balancing, conflict detection, and capacity planning</p>

      <div style={{ display: 'flex', gap: 4, marginBottom: 24, flexWrap: 'wrap' }}>
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            style={{ padding: '8px 18px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: tab === t.id ? 700 : 500, background: tab === t.id ? '#1B4F72' : '#f0f0f0', color: tab === t.id ? '#fff' : '#444' }}>
            {t.label}
          </button>
        ))}
      </div>

      {loading ? <div style={{ textAlign: 'center', padding: 60, color: '#999' }}>Analyzing schedule...</div> : (
        <>
          {tab === 'dashboard' && data && <DashboardView data={data} />}
          {tab === 'workload' && data && <WorkloadView data={data} />}
          {tab === 'conflicts' && data && <ConflictsView data={data} />}
          {tab === 'capacity' && data && <CapacityView data={data} />}
          {tab === 'optimization' && data && <OptimizationView data={data} />}
        </>
      )}
    </div>
  )
}

function DashboardView({ data }: { data: any }) {
  const o = data.overview || {}
  const d = data.deliveryPipeline || {}
  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16, marginBottom: 24 }}>
        <KPICard label="Today's Jobs" value={Number(o.todayEntries || 0)} color="#1B4F72" />
        <KPICard label="This Week" value={Number(o.thisWeekEntries || 0)} sub={`${o.completedThisWeek || 0} completed`} />
        <KPICard label="In Progress" value={Number(o.inProgress || 0)} color="#E67E22" />
        <KPICard label="Overdue" value={Number(o.overdueEntries || 0)} color={Number(o.overdueEntries) > 0 ? '#e74c3c' : '#27ae60'} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 24 }}>
        <div>
          <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12, color: '#1B4F72' }}>Crew Status</h3>
          <div style={{ background: '#fff', borderRadius: 10, overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.07)' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead><tr style={{ background: '#f8f9fa' }}>
                <th style={{ padding: '8px 14px', textAlign: 'left', fontWeight: 600 }}>Crew</th>
                <th style={{ padding: '8px 14px', textAlign: 'left', fontWeight: 600 }}>Type</th>
                <th style={{ padding: '8px 14px', textAlign: 'right', fontWeight: 600 }}>Today</th>
                <th style={{ padding: '8px 14px', textAlign: 'right', fontWeight: 600 }}>Week</th>
                <th style={{ padding: '8px 14px', textAlign: 'right', fontWeight: 600 }}>Active</th>
              </tr></thead>
              <tbody>
                {(data.crewStatus || []).map((c: any, i: number) => (
                  <tr key={c.id} style={{ borderTop: '1px solid #eee', background: i % 2 ? '#fafafa' : '#fff' }}>
                    <td style={{ padding: '8px 14px', fontWeight: 600 }}>{c.name}</td>
                    <td style={{ padding: '8px 14px', fontSize: 12 }}>{c.crewType}</td>
                    <td style={{ padding: '8px 14px', textAlign: 'right', fontWeight: 600 }}>{Number(c.todayJobs)}</td>
                    <td style={{ padding: '8px 14px', textAlign: 'right' }}>{Number(c.weekJobs)}</td>
                    <td style={{ padding: '8px 14px', textAlign: 'right' }}>
                      {Number(c.activeNow) > 0 ? <Badge text="BUSY" color="#e67e22" /> : <Badge text="IDLE" color="#27ae60" />}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div>
          <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12, color: '#1B4F72' }}>Delivery Pipeline</h3>
          <div style={{ background: '#fff', borderRadius: 10, padding: 18, boxShadow: '0 1px 4px rgba(0,0,0,0.07)' }}>
            {[
              { label: 'Scheduled', value: d.scheduled, color: '#3498db' },
              { label: 'In Transit', value: d.inTransit, color: '#e67e22' },
              { label: 'Delivered (7d)', value: d.deliveredThisWeek, color: '#27ae60' },
              { label: 'Failed', value: d.failed, color: '#e74c3c' },
            ].map(item => (
              <div key={item.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid #f0f0f0' }}>
                <span style={{ fontSize: 14 }}>{item.label}</span>
                <span style={{ fontSize: 22, fontWeight: 700, color: item.color }}>{Number(item.value || 0)}</span>
              </div>
            ))}
          </div>

          {(data.entryTypes || []).length > 0 && (
            <>
              <h3 style={{ fontSize: 16, fontWeight: 600, margin: '20px 0 12px', color: '#1B4F72' }}>Entry Types</h3>
              <div style={{ background: '#fff', borderRadius: 10, padding: 18, boxShadow: '0 1px 4px rgba(0,0,0,0.07)' }}>
                {(data.entryTypes || []).map((e: any) => (
                  <div key={e.entryType} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid #f0f0f0', fontSize: 13 }}>
                    <span style={{ fontWeight: 600 }}>{e.entryType}</span>
                    <span>{Number(e.count)} total / <strong>{Number(e.thisWeek)}</strong> this week</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function WorkloadView({ data }: { data: any }) {
  return (
    <div>
      <KPICard label="Avg Weekly Jobs/Crew" value={data.avgWeeklyJobsPerCrew || 0} color="#1B4F72" />

      <h3 style={{ fontSize: 16, fontWeight: 600, margin: '20px 0 12px', color: '#1B4F72' }}>Crew Workload Balance</h3>
      <div style={{ background: '#fff', borderRadius: 10, overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.07)', marginBottom: 24 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: '#f8f9fa' }}>
              <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600 }}>Crew</th>
              <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600 }}>Status</th>
              <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600 }}>This Week</th>
              <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600 }}>Next Week</th>
              <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600 }}>This Month</th>
              <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600 }}>Avg/Day</th>
              <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600 }}>Completion</th>
              <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600 }}>Deviation</th>
            </tr>
          </thead>
          <tbody>
            {(data.crewWorkload || []).map((c: any, i: number) => (
              <tr key={c.id} style={{ borderTop: '1px solid #eee', background: c.status === 'OVERLOADED' ? '#fdf2f2' : c.status === 'UNDERUTILIZED' ? '#fefce8' : (i % 2 ? '#fafafa' : '#fff') }}>
                <td style={{ padding: '10px 14px' }}>
                  <div style={{ fontWeight: 600 }}>{c.name}</div>
                  <div style={{ fontSize: 11, color: '#999' }}>{c.crewType} {c.vehiclePlate && `— ${c.vehiclePlate}`}</div>
                </td>
                <td style={{ padding: '10px 14px' }}><Badge text={c.status} color={STATUS_COLORS[c.status] || '#999'} /></td>
                <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 700 }}>{Number(c.thisWeekJobs)}</td>
                <td style={{ padding: '10px 14px', textAlign: 'right' }}>{Number(c.nextWeekJobs)}</td>
                <td style={{ padding: '10px 14px', textAlign: 'right' }}>{Number(c.thisMonthJobs)}</td>
                <td style={{ padding: '10px 14px', textAlign: 'right' }}>{c.avgPerDay}</td>
                <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600, color: Number(c.completionRate) >= 90 ? '#27ae60' : '#e74c3c' }}>{c.completionRate}%</td>
                <td style={{ padding: '10px 14px', textAlign: 'right', color: Number(c.deviation) > 0 ? '#e74c3c' : '#3498db' }}>
                  {Number(c.deviation) > 0 ? '+' : ''}{Math.round(Number(c.deviation) * 10) / 10}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {(data.dailyDistribution || []).length > 0 && (
        <>
          <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12, color: '#1B4F72' }}>Daily Distribution (This Week)</h3>
          <div style={{ background: '#fff', borderRadius: 10, overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.07)' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead><tr style={{ background: '#f8f9fa' }}>
                <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600 }}>Date</th>
                <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600 }}>Day</th>
                <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600 }}>Jobs</th>
                <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600 }}>Crews Active</th>
              </tr></thead>
              <tbody>
                {(data.dailyDistribution || []).map((d: any, i: number) => (
                  <tr key={i} style={{ borderTop: '1px solid #eee' }}>
                    <td style={{ padding: '10px 14px', fontWeight: 600 }}>{new Date(d.date).toLocaleDateString()}</td>
                    <td style={{ padding: '10px 14px' }}>{(d.dayName || '').trim()}</td>
                    <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 700 }}>{Number(d.totalJobs)}</td>
                    <td style={{ padding: '10px 14px', textAlign: 'right' }}>{Number(d.crewsActive)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}

function ConflictsView({ data }: { data: any }) {
  const s = data.summary || {}
  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 24 }}>
        <KPICard label="Total Issues" value={s.totalIssues || 0} color={Number(s.totalIssues) > 0 ? '#e74c3c' : '#27ae60'} />
        <KPICard label="Double Bookings" value={s.doubleBookingCount || 0} color="#e74c3c" />
        <KPICard label="Overdue" value={s.overdueCount || 0} color="#e67e22" />
        <KPICard label="Unassigned" value={s.unassignedCount || 0} color="#f39c12" />
      </div>

      {(data.doubleBookings || []).length > 0 && (
        <>
          <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12, color: '#e74c3c' }}>Double Bookings</h3>
          <div style={{ background: '#fff', borderRadius: 10, overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.07)', marginBottom: 24 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead><tr style={{ background: '#fdf2f2' }}>
                <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600 }}>Crew</th>
                <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600 }}>Date</th>
                <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600 }}>Entry 1</th>
                <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600 }}>Entry 2</th>
              </tr></thead>
              <tbody>
                {(data.doubleBookings || []).map((db: any, i: number) => (
                  <tr key={i} style={{ borderTop: '1px solid #eee' }}>
                    <td style={{ padding: '10px 14px', fontWeight: 600 }}>{db.crewName}</td>
                    <td style={{ padding: '10px 14px' }}>{new Date(db.date).toLocaleDateString()}</td>
                    <td style={{ padding: '10px 14px' }}>{db.entry1Title} @ {db.entry1Time}</td>
                    <td style={{ padding: '10px 14px' }}>{db.entry2Title} @ {db.entry2Time}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {(data.overdue || []).length > 0 && (
        <>
          <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12, color: '#e67e22' }}>Overdue Entries</h3>
          <div style={{ background: '#fff', borderRadius: 10, overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.07)', marginBottom: 24 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead><tr style={{ background: '#f8f9fa' }}>
                <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600 }}>Title</th>
                <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600 }}>Type</th>
                <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600 }}>Crew</th>
                <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600 }}>Date</th>
                <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600 }}>Days Overdue</th>
              </tr></thead>
              <tbody>
                {(data.overdue || []).map((o: any, i: number) => (
                  <tr key={i} style={{ borderTop: '1px solid #eee' }}>
                    <td style={{ padding: '10px 14px', fontWeight: 600 }}>{o.title}</td>
                    <td style={{ padding: '10px 14px' }}>{o.entryType}</td>
                    <td style={{ padding: '10px 14px' }}>{o.crewName || '—'}</td>
                    <td style={{ padding: '10px 14px' }}>{new Date(o.date).toLocaleDateString()}</td>
                    <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 700, color: '#e74c3c' }}>{o.daysOverdue}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {(data.unassigned || []).length > 0 && (
        <>
          <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12, color: '#f39c12' }}>Unassigned Entries</h3>
          <div style={{ background: '#fff', borderRadius: 10, overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.07)' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead><tr style={{ background: '#f8f9fa' }}>
                <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600 }}>Title</th>
                <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600 }}>Type</th>
                <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600 }}>Date</th>
                <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600 }}>Time</th>
              </tr></thead>
              <tbody>
                {(data.unassigned || []).map((u: any, i: number) => (
                  <tr key={i} style={{ borderTop: '1px solid #eee' }}>
                    <td style={{ padding: '10px 14px', fontWeight: 600 }}>{u.title}</td>
                    <td style={{ padding: '10px 14px' }}>{u.entryType}</td>
                    <td style={{ padding: '10px 14px' }}>{new Date(u.date).toLocaleDateString()}</td>
                    <td style={{ padding: '10px 14px' }}>{u.scheduledTime || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {Number(s.totalIssues) === 0 && (
        <div style={{ textAlign: 'center', padding: 40, color: '#27ae60', fontSize: 18, fontWeight: 600 }}>
          No scheduling conflicts detected. All clear!
        </div>
      )}
    </div>
  )
}

function CapacityView({ data }: { data: any }) {
  const pj = data.pendingJobs || {}
  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16, marginBottom: 24 }}>
        <KPICard label="Active Orders" value={Number(pj.activeOrders || 0)} color="#1B4F72" />
        <KPICard label="Deliveries This Week" value={Number(pj.deliveriesThisWeek || 0)} color="#E67E22" />
        <KPICard label="Next 2 Weeks" value={Number(pj.deliveriesNext2Weeks || 0)} color="#3498db" />
      </div>

      <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12, color: '#1B4F72' }}>4-Week Capacity Outlook</h3>
      <div style={{ background: '#fff', borderRadius: 10, overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.07)', marginBottom: 24 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead><tr style={{ background: '#f8f9fa' }}>
            <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600 }}>Week Of</th>
            <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600 }}>Scheduled Jobs</th>
            <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600 }}>Capacity</th>
            <th style={{ padding: '10px 14px', fontWeight: 600, width: 200 }}>Utilization</th>
          </tr></thead>
          <tbody>
            {(data.weeklyCapacity || []).map((w: any, i: number) => (
              <tr key={i} style={{ borderTop: '1px solid #eee', background: i % 2 ? '#fafafa' : '#fff' }}>
                <td style={{ padding: '10px 14px', fontWeight: 600 }}>{new Date(w.week_start).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</td>
                <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 700 }}>{Number(w.scheduledJobs)}</td>
                <td style={{ padding: '10px 14px', textAlign: 'right' }}>{Number(w.weeklyCapacity)}</td>
                <td style={{ padding: '10px 14px' }}><UtilizationBar pct={Number(w.utilizationPct || 0)} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {(data.byType || []).length > 0 && (
        <>
          <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12, color: '#1B4F72' }}>Capacity by Crew Type</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: 16 }}>
            {(data.byType || []).map((t: any) => {
              const util = Number(t.next2WeekCapacity) > 0 ? Number(t.next2WeekJobs) / Number(t.next2WeekCapacity) * 100 : 0
              return (
                <div key={t.crewType} style={{ background: '#fff', borderRadius: 10, padding: 18, boxShadow: '0 1px 4px rgba(0,0,0,0.07)' }}>
                  <div style={{ fontSize: 16, fontWeight: 700, color: '#1B4F72', marginBottom: 12 }}>{t.crewType}</div>
                  <div style={{ fontSize: 13, marginBottom: 8 }}>Crews: <strong>{Number(t.crewCount)}</strong></div>
                  <div style={{ fontSize: 13, marginBottom: 8 }}>Next 2 weeks: <strong>{Number(t.next2WeekJobs)}</strong> / {Number(t.next2WeekCapacity)} capacity</div>
                  <UtilizationBar pct={util} />
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}

function OptimizationView({ data }: { data: any }) {
  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 24 }}>
        <KPICard label="Suggestions" value={data.totalIssues || 0} color="#1B4F72" />
        <KPICard label="High Priority" value={data.highPriority || 0} color="#e74c3c" />
      </div>

      <div style={{ display: 'grid', gap: 16 }}>
        {(data.suggestions || []).map((s: any, i: number) => (
          <div key={i} style={{
            background: '#fff', borderRadius: 12, padding: 20, boxShadow: '0 1px 4px rgba(0,0,0,0.07)',
            borderLeft: `5px solid ${PRIORITY_COLORS[s.priority] || '#999'}`
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>
                <span style={{ marginRight: 8 }}>{SUGGESTION_ICONS[s.type] || '💡'}</span>
                {s.title}
              </h3>
              <Badge text={s.priority} color={PRIORITY_COLORS[s.priority] || '#999'} />
            </div>
            <p style={{ fontSize: 14, color: '#555', margin: '8px 0' }}>{s.description}</p>
            <div style={{ fontSize: 12, color: '#8e44ad', fontWeight: 600 }}>Impact: {s.impact}</div>
          </div>
        ))}

        {(data.suggestions || []).length === 0 && (
          <div style={{ textAlign: 'center', padding: 40, color: '#27ae60', fontSize: 18, fontWeight: 600 }}>
            Schedule looks optimized! No suggestions at this time.
          </div>
        )}
      </div>
    </div>
  )
}
