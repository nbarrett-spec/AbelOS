'use client'

import { useState, useEffect } from 'react'

const SEVERITY_COLORS: Record<string, string> = { CRITICAL: '#e74c3c', HIGH: '#e74c3c', WARNING: '#C6A24E', MEDIUM: '#C6A24E', LOW: '#3498db', INFO: '#27ae60' }
const CATEGORY_COLORS: Record<string, string> = { COLLECTIONS: '#e74c3c', PURCHASING: '#8e44ad', SALES: '#C6A24E', OPERATIONS: '#3498db' }
const GRADE_COLORS: Record<string, string> = { A: '#27ae60', B: '#2ecc71', C: '#D4B96A', D: '#C6A24E', F: '#e74c3c' }

function KPICard({ label, value, sub, color }: { label: string; value: string | number; sub?: string; color?: string }) {
  return (
    <div style={{ background: '#fff', borderRadius: 10, padding: '18px 22px', boxShadow: '0 1px 4px rgba(0,0,0,0.07)', borderLeft: `4px solid ${color || '#0f2a3e'}` }}>
      <div style={{ fontSize: 13, color: '#666', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 700, color: color || '#0f2a3e' }}>{value}</div>
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

function HealthGauge({ score, grade }: { score: number; grade: string }) {
  const color = GRADE_COLORS[grade] || '#999'
  const circumference = 2 * Math.PI * 70
  const offset = circumference - (score / 100) * circumference

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: 20 }}>
      <svg width="180" height="180" viewBox="0 0 180 180">
        <circle cx="90" cy="90" r="70" fill="none" stroke="#f0f0f0" strokeWidth="14" />
        <circle cx="90" cy="90" r="70" fill="none" stroke={color} strokeWidth="14"
          strokeDasharray={circumference} strokeDashoffset={offset}
          strokeLinecap="round" transform="rotate(-90 90 90)" />
        <text x="90" y="78" textAnchor="middle" fontSize="36" fontWeight="700" fill={color}>{score}</text>
        <text x="90" y="105" textAnchor="middle" fontSize="22" fontWeight="600" fill={color}>{grade}</text>
        <text x="90" y="125" textAnchor="middle" fontSize="11" fill="#999">/ 100</text>
      </svg>
    </div>
  )
}

function ComponentBar({ label, score, max }: { label: string; score: number; max: number }) {
  const pct = (score / max) * 100
  const color = pct >= 75 ? '#27ae60' : pct >= 50 ? '#D4B96A' : pct >= 25 ? '#C6A24E' : '#e74c3c'
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
      <div style={{ width: 160, fontSize: 13, fontWeight: 600, textAlign: 'right' }}>{label}</div>
      <div style={{ flex: 1, height: 24, background: '#f0f0f0', borderRadius: 6, overflow: 'hidden', position: 'relative' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', paddingRight: 8, minWidth: 40 }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: '#fff' }}>{score}/{max}</span>
        </div>
      </div>
    </div>
  )
}

export default function HealthMonitorPage() {
  const [tab, setTab] = useState('dashboard')
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    fetch(`/api/ops/ai/health?report=${tab}`)
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [tab])

  const tabs = [
    { id: 'dashboard', label: 'Health Score' },
    { id: 'scorecards', label: 'Dept Scorecards' },
    { id: 'anomalies', label: 'Anomalies' },
    { id: 'kpi-trends', label: 'KPI Trends' },
    { id: 'action-items', label: 'Action Items' },
  ]

  return (
    <div style={{ padding: '24px 32px', maxWidth: 1400 }}>
      <h1 style={{ fontSize: 24, fontWeight: 600, color: '#0f2a3e', marginBottom: 4 }}>Business Health Monitor</h1>
      <p style={{ color: '#666', fontSize: 14, marginBottom: 20 }}>AI-powered business health scoring, anomaly detection, and actionable intelligence</p>

      <div style={{ display: 'flex', gap: 4, marginBottom: 24, flexWrap: 'wrap' }}>
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            style={{ padding: '8px 18px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: tab === t.id ? 700 : 500, background: tab === t.id ? '#0f2a3e' : '#f0f0f0', color: tab === t.id ? '#fff' : '#444' }}>
            {t.label}
          </button>
        ))}
      </div>

      {loading ? <div style={{ textAlign: 'center', padding: 60, color: '#999' }}>Computing health score...</div> : (
        <>
          {tab === 'dashboard' && data && <HealthDashboard data={data} />}
          {tab === 'scorecards' && data && <ScorecardsView data={data} />}
          {tab === 'anomalies' && data && <AnomaliesView data={data} />}
          {tab === 'kpi-trends' && data && <KPITrendsView data={data} />}
          {tab === 'action-items' && data && <ActionItemsView data={data} />}
        </>
      )}
    </div>
  )
}

function HealthDashboard({ data }: { data: any }) {
  const c = data.components || {}
  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: '260px 1fr', gap: 24, marginBottom: 24 }}>
        <div style={{ background: '#fff', borderRadius: 12, boxShadow: '0 1px 4px rgba(0,0,0,0.07)' }}>
          <HealthGauge score={data.healthScore || 0} grade={data.healthGrade || '?'} />
        </div>

        <div style={{ background: '#fff', borderRadius: 12, padding: 24, boxShadow: '0 1px 4px rgba(0,0,0,0.07)' }}>
          <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16, color: '#0f2a3e' }}>Health Components</h3>
          <ComponentBar label="Revenue" score={c.revenue?.score || 0} max={20} />
          <ComponentBar label="Accounts Receivable" score={c.accountsReceivable?.score || 0} max={20} />
          <ComponentBar label="Inventory" score={c.inventory?.score || 0} max={20} />
          <ComponentBar label="Operations" score={c.operations?.score || 0} max={20} />
          <ComponentBar label="Customer Health" score={c.customer?.score || 0} max={20} />
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: 16 }}>
        <div style={{ background: '#fff', borderRadius: 10, padding: 18, boxShadow: '0 1px 4px rgba(0,0,0,0.07)' }}>
          <h4 style={{ margin: '0 0 12px', color: '#0f2a3e' }}>Revenue</h4>
          <div style={{ fontSize: 13 }}>This month: <strong>${Number(c.revenue?.thisMonth || 0).toLocaleString()}</strong></div>
          <div style={{ fontSize: 13 }}>Last month: <strong>${Number(c.revenue?.lastMonth || 0).toLocaleString()}</strong></div>
          <div style={{ fontSize: 13, color: Number(c.revenue?.growth || 0) >= 0 ? '#27ae60' : '#e74c3c', fontWeight: 700, marginTop: 4 }}>
            {Number(c.revenue?.growth || 0) >= 0 ? '+' : ''}{c.revenue?.growth}% growth
          </div>
        </div>

        <div style={{ background: '#fff', borderRadius: 10, padding: 18, boxShadow: '0 1px 4px rgba(0,0,0,0.07)' }}>
          <h4 style={{ margin: '0 0 12px', color: '#0f2a3e' }}>Accounts Receivable</h4>
          <div style={{ fontSize: 13 }}>Unpaid: <strong>${Number(c.accountsReceivable?.totalUnpaidAmount || 0).toLocaleString()}</strong></div>
          <div style={{ fontSize: 13, color: '#e74c3c' }}>Overdue: <strong>${Number(c.accountsReceivable?.overdueAmount || 0).toLocaleString()}</strong> ({c.accountsReceivable?.overdueInvoices} invoices)</div>
        </div>

        <div style={{ background: '#fff', borderRadius: 10, padding: 18, boxShadow: '0 1px 4px rgba(0,0,0,0.07)' }}>
          <h4 style={{ margin: '0 0 12px', color: '#0f2a3e' }}>Inventory</h4>
          <div style={{ fontSize: 13 }}>Tracked: <strong>{Number(c.inventory?.totalTracked || 0)}</strong> SKUs</div>
          <div style={{ fontSize: 13, color: '#e74c3c' }}>Out of stock: <strong>{Number(c.inventory?.outOfStock || 0)}</strong></div>
          <div style={{ fontSize: 13, color: '#C6A24E' }}>Low stock: <strong>{Number(c.inventory?.lowStock || 0)}</strong></div>
        </div>

        <div style={{ background: '#fff', borderRadius: 10, padding: 18, boxShadow: '0 1px 4px rgba(0,0,0,0.07)' }}>
          <h4 style={{ margin: '0 0 12px', color: '#0f2a3e' }}>Operations</h4>
          <div style={{ fontSize: 13 }}>Completion rate: <strong>{c.operations?.completionRate}%</strong></div>
          <div style={{ fontSize: 13, color: Number(c.operations?.overdue) > 0 ? '#e74c3c' : '#27ae60' }}>Overdue: <strong>{c.operations?.overdue}</strong></div>
        </div>

        <div style={{ background: '#fff', borderRadius: 10, padding: 18, boxShadow: '0 1px 4px rgba(0,0,0,0.07)' }}>
          <h4 style={{ margin: '0 0 12px', color: '#0f2a3e' }}>Customer</h4>
          <div style={{ fontSize: 13 }}>Active: <strong>{Number(c.customer?.activeBuilders || 0)}</strong> / {Number(c.customer?.totalBuilders || 0)}</div>
          <div style={{ fontSize: 13 }}>New (30d): <strong>{Number(c.customer?.newBuilders || 0)}</strong></div>
          <div style={{ fontSize: 13 }}>Quote conv: <strong>{c.customer?.conversionRate}%</strong></div>
        </div>
      </div>
    </div>
  )
}

function ScorecardsView({ data }: { data: any }) {
  const d = data.departments || {}
  const CardSection = ({ title, color, items }: { title: string; color: string; items: { label: string; value: any }[] }) => (
    <div style={{ background: '#fff', borderRadius: 12, padding: 24, boxShadow: '0 1px 4px rgba(0,0,0,0.07)', borderTop: `4px solid ${color}` }}>
      <h3 style={{ margin: '0 0 16px', fontSize: 18, fontWeight: 600, color }}>{title}</h3>
      {items.map(item => (
        <div key={item.label} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid #f0f0f0', fontSize: 14 }}>
          <span style={{ color: '#555' }}>{item.label}</span>
          <span style={{ fontWeight: 700 }}>{item.value}</span>
        </div>
      ))}
    </div>
  )

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 20 }}>
      <CardSection title="Sales" color="#C6A24E" items={[
        { label: 'Active Deals', value: Number(d.sales?.activeDeals || 0) },
        { label: 'Pipeline Value', value: `$${Number(d.sales?.pipelineValue || 0).toLocaleString()}` },
        { label: 'Won This Month', value: Number(d.sales?.wonThisMonth || 0) },
        { label: 'Lost This Month', value: Number(d.sales?.lostThisMonth || 0) },
        { label: 'Quotes Created (30d)', value: Number(d.sales?.quotesThisMonth || 0) },
        { label: 'Quotes Sent (30d)', value: Number(d.sales?.quotesSent || 0) },
      ]} />

      <CardSection title="Operations" color="#3498db" items={[
        { label: 'Jobs Completed (30d)', value: Number(d.operations?.jobsCompleted || 0) },
        { label: 'Jobs This Week', value: Number(d.operations?.jobsThisWeek || 0) },
        { label: 'Deliveries Completed (30d)', value: Number(d.operations?.deliveriesCompleted || 0) },
        { label: 'Deliveries Failed', value: Number(d.operations?.deliveriesFailed || 0) },
      ]} />

      <CardSection title="Purchasing" color="#8e44ad" items={[
        { label: 'Active POs', value: Number(d.purchasing?.activePOs || 0) },
        { label: 'PO Value', value: `$${Number(d.purchasing?.poValue || 0).toLocaleString()}` },
        { label: 'Received (30d)', value: Number(d.purchasing?.receivedThisMonth || 0) },
        { label: 'Late POs', value: Number(d.purchasing?.latePOs || 0) },
      ]} />

      <CardSection title="Finance" color="#27ae60" items={[
        { label: 'Collected (30d)', value: `$${Number(d.finance?.collectedThisMonth || 0).toLocaleString()}` },
        { label: 'Overdue AR', value: `$${Number(d.finance?.overdueAR || 0).toLocaleString()}` },
        { label: '90d+ Severe Overdue', value: Number(d.finance?.severe90dOverdue || 0) },
      ]} />
    </div>
  )
}

function AnomaliesView({ data }: { data: any }) {
  const s = data.summary || {}
  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 24 }}>
        <KPICard label="Critical" value={s.critical || 0} color="#e74c3c" />
        <KPICard label="Warnings" value={s.warning || 0} color="#C6A24E" />
        <KPICard label="Info" value={s.info || 0} color="#27ae60" />
      </div>

      <div style={{ display: 'grid', gap: 16 }}>
        {(data.anomalies || []).map((a: any, i: number) => (
          <div key={i} style={{
            background: '#fff', borderRadius: 12, padding: 20, boxShadow: '0 1px 4px rgba(0,0,0,0.07)',
            borderLeft: `5px solid ${SEVERITY_COLORS[a.severity] || '#999'}`
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <Badge text={a.severity} color={SEVERITY_COLORS[a.severity] || '#999'} />
              <span style={{ fontSize: 12, color: '#999' }}>{a.type?.replace(/_/g, ' ')}</span>
            </div>
            <p style={{ fontSize: 15, fontWeight: 600, margin: '4px 0', color: '#333' }}>{a.message}</p>
            {a.expected && (
              <div style={{ fontSize: 12, color: '#666', marginTop: 4 }}>Expected: {typeof a.expected === 'number' ? a.expected.toLocaleString() : a.expected}</div>
            )}
          </div>
        ))}

        {(data.anomalies || []).length === 0 && (
          <div style={{ textAlign: 'center', padding: 40, color: '#27ae60', fontSize: 18, fontWeight: 600 }}>
            No anomalies detected. Business metrics are within normal ranges.
          </div>
        )}
      </div>
    </div>
  )
}

function KPITrendsView({ data }: { data: any }) {
  const kpis = data.kpis || []
  const maxRev = Math.max(1, ...kpis.map((k: any) => Number(k.revenue || 0)))
  return (
    <div>
      <div style={{ background: '#fff', borderRadius: 10, overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.07)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: '#f8f9fa' }}>
              <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600 }}>Month</th>
              <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600 }}>Revenue</th>
              <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600 }}>Orders</th>
              <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600 }}>Avg Order</th>
              <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600 }}>New Builders</th>
              <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600 }}>Quotes</th>
              <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600 }}>Conv %</th>
              <th style={{ padding: '10px 14px', fontWeight: 600, width: 150 }}>Revenue</th>
            </tr>
          </thead>
          <tbody>
            {kpis.map((k: any, i: number) => (
              <tr key={i} style={{ borderTop: '1px solid #eee', background: i % 2 ? '#fafafa' : '#fff' }}>
                <td style={{ padding: '10px 14px', fontWeight: 600 }}>{new Date(k.month).toLocaleDateString('en-US', { year: 'numeric', month: 'short' })}</td>
                <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 700 }}>${Number(k.revenue || 0).toLocaleString()}</td>
                <td style={{ padding: '10px 14px', textAlign: 'right' }}>{Number(k.orderCount)}</td>
                <td style={{ padding: '10px 14px', textAlign: 'right' }}>${Number(k.avgOrderValue || 0).toLocaleString()}</td>
                <td style={{ padding: '10px 14px', textAlign: 'right' }}>{Number(k.newBuilders)}</td>
                <td style={{ padding: '10px 14px', textAlign: 'right' }}>{Number(k.quotesCreated)}</td>
                <td style={{ padding: '10px 14px', textAlign: 'right' }}>{Number(k.conversionRate || 0)}%</td>
                <td style={{ padding: '10px 14px' }}>
                  <div style={{ height: 16, background: '#f0f0f0', borderRadius: 4, overflow: 'hidden' }}>
                    <div style={{ width: `${(Number(k.revenue || 0) / maxRev) * 100}%`, height: '100%', background: '#0f2a3e', borderRadius: 4 }} />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function ActionItemsView({ data }: { data: any }) {
  const s = data.summary || {}
  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 24 }}>
        <KPICard label="Total Actions" value={s.total || 0} color="#0f2a3e" />
        <KPICard label="Critical" value={s.critical || 0} color="#e74c3c" />
        <KPICard label="High" value={s.high || 0} color="#C6A24E" />
        <KPICard label="Medium" value={s.medium || 0} color="#D4B96A" />
      </div>

      <div style={{ display: 'grid', gap: 12 }}>
        {(data.actions || []).map((a: any, i: number) => (
          <div key={i} style={{
            background: '#fff', borderRadius: 10, padding: '16px 20px', boxShadow: '0 1px 4px rgba(0,0,0,0.07)',
            borderLeft: `4px solid ${SEVERITY_COLORS[a.priority] || '#999'}`,
            display: 'flex', justifyContent: 'space-between', alignItems: 'center'
          }}>
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4 }}>
                <Badge text={a.priority} color={SEVERITY_COLORS[a.priority] || '#999'} />
                <Badge text={a.category} color={CATEGORY_COLORS[a.category] || '#0f2a3e'} />
              </div>
              <div style={{ fontSize: 14, fontWeight: 600, color: '#333' }}>{a.action}</div>
              <div style={{ fontSize: 12, color: '#666', marginTop: 2 }}>{a.detail}</div>
            </div>
            {a.contact && <div style={{ fontSize: 12, color: '#999', textAlign: 'right' }}>{a.contact}</div>}
          </div>
        ))}

        {(data.actions || []).length === 0 && (
          <div style={{ textAlign: 'center', padding: 40, color: '#27ae60', fontSize: 18, fontWeight: 600 }}>
            No outstanding action items. Everything is running smoothly.
          </div>
        )}
      </div>
    </div>
  )
}
