'use client'

import { useState, useEffect } from 'react'

const STATUS_COLORS: Record<string, string> = {
  DRAFT: '#95a5a6',
  SCHEDULED: '#3498db',
  ACTIVE: '#27ae60',
  SENT: '#8e44ad',
  PAUSED: '#f39c12',
}

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

export default function MarketingCampaignsPage() {
  const [tab, setTab] = useState('dashboard')
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    fetch(`/api/ops/marketing/campaigns?report=${tab}`)
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [tab])

  const tabs = [
    { id: 'dashboard', label: 'Overview' },
    { id: 'campaigns', label: 'Campaigns' },
    { id: 'segments', label: 'Segments' },
    { id: 'templates', label: 'Templates' },
    { id: 'performance', label: 'Performance' },
  ]

  return (
    <div style={{ padding: '24px 32px', maxWidth: 1400 }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, color: '#1B4F72', marginBottom: 4 }}>Marketing Automation</h1>
      <p style={{ color: '#666', fontSize: 14, marginBottom: 20 }}>Campaign management, builder segmentation, drip sequences, and engagement tracking</p>

      <div style={{ display: 'flex', gap: 4, marginBottom: 24, flexWrap: 'wrap' }}>
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            style={{ padding: '8px 18px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: tab === t.id ? 700 : 500, background: tab === t.id ? '#1B4F72' : '#f0f0f0', color: tab === t.id ? '#fff' : '#444' }}>
            {t.label}
          </button>
        ))}
      </div>

      {loading ? <div style={{ textAlign: 'center', padding: 60, color: '#999' }}>Loading...</div> : (
        <>
          {tab === 'dashboard' && data && <DashboardView data={data} />}
          {tab === 'campaigns' && data && <CampaignsView data={data} />}
          {tab === 'segments' && data && <SegmentsView data={data} />}
          {tab === 'templates' && data && <TemplatesView data={data} />}
          {tab === 'performance' && data && <PerformanceView data={data} />}
        </>
      )}
    </div>
  )
}

function DashboardView({ data }: { data: any }) {
  const s = data.stats || {}
  const r = data.reachability || {}
  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16, marginBottom: 24 }}>
        <KPICard label="Total Campaigns" value={Number(s.totalCampaigns || 0)} sub={`${s.activeCampaigns || 0} active, ${s.draftCampaigns || 0} drafts`} />
        <KPICard label="Emails Sent" value={Number(s.totalSent || 0).toLocaleString()} color="#8e44ad" />
        <KPICard label="Avg Open Rate" value={`${s.avgOpenRate || 0}%`} color="#27ae60" />
        <KPICard label="Avg Click Rate" value={`${s.avgClickRate || 0}%`} color="#E67E22" />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16, marginBottom: 24 }}>
        <KPICard label="Reachable Builders" value={Number(r.activeReachable || 0)} sub={`of ${r.totalBuilders || 0} total`} color="#3498db" />
        <KPICard label="With Email" value={Number(r.withEmail || 0)} color="#27ae60" />
        <KPICard label="With Phone" value={Number(r.withPhone || 0)} sub="SMS capable" color="#f39c12" />
        <KPICard label="Conversions" value={Number(s.totalConversions || 0)} color="#e74c3c" />
      </div>

      <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12, color: '#1B4F72' }}>Recent Campaigns</h3>
      <div style={{ background: '#fff', borderRadius: 10, overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.07)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: '#f8f9fa' }}>
              <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600 }}>Campaign</th>
              <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600 }}>Status</th>
              <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600 }}>Segment</th>
              <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600 }}>Recipients</th>
              <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600 }}>Sent</th>
              <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600 }}>Opens</th>
              <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600 }}>Date</th>
            </tr>
          </thead>
          <tbody>
            {(data.recentCampaigns || []).map((c: any, i: number) => (
              <tr key={c.id} style={{ borderTop: '1px solid #eee', background: i % 2 ? '#fafafa' : '#fff' }}>
                <td style={{ padding: '10px 14px' }}>
                  <div style={{ fontWeight: 600 }}>{c.name}</div>
                  <div style={{ fontSize: 11, color: '#999' }}>{c.subject}</div>
                </td>
                <td style={{ padding: '10px 14px' }}><Badge text={c.status} color={STATUS_COLORS[c.status] || '#999'} /></td>
                <td style={{ padding: '10px 14px', fontSize: 12 }}>{c.targetSegment || '—'}</td>
                <td style={{ padding: '10px 14px', textAlign: 'right' }}>{Number(c.recipientCount || 0)}</td>
                <td style={{ padding: '10px 14px', textAlign: 'right' }}>{Number(c.sentCount || 0)}</td>
                <td style={{ padding: '10px 14px', textAlign: 'right' }}>{Number(c.openCount || 0)}</td>
                <td style={{ padding: '10px 14px', fontSize: 12 }}>{c.sentAt ? new Date(c.sentAt).toLocaleDateString() : c.createdAt ? new Date(c.createdAt).toLocaleDateString() : '—'}</td>
              </tr>
            ))}
            {(data.recentCampaigns || []).length === 0 && (
              <tr><td colSpan={7} style={{ padding: 30, textAlign: 'center', color: '#999' }}>No campaigns yet. Use Templates to create your first campaign.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function CampaignsView({ data }: { data: any }) {
  return (
    <div>
      <div style={{ background: '#fff', borderRadius: 10, overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.07)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: '#f8f9fa' }}>
              <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600 }}>Campaign</th>
              <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600 }}>Type</th>
              <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600 }}>Status</th>
              <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600 }}>Recipients</th>
              <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600 }}>Open %</th>
              <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600 }}>Click %</th>
              <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600 }}>Conv %</th>
              <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600 }}>Sent</th>
            </tr>
          </thead>
          <tbody>
            {(data.campaigns || []).map((c: any, i: number) => (
              <tr key={c.id} style={{ borderTop: '1px solid #eee', background: i % 2 ? '#fafafa' : '#fff' }}>
                <td style={{ padding: '10px 14px' }}>
                  <div style={{ fontWeight: 600 }}>{c.name}</div>
                  <div style={{ fontSize: 11, color: '#999' }}>{c.subject}</div>
                </td>
                <td style={{ padding: '10px 14px' }}>{c.type}</td>
                <td style={{ padding: '10px 14px' }}><Badge text={c.status} color={STATUS_COLORS[c.status] || '#999'} /></td>
                <td style={{ padding: '10px 14px', textAlign: 'right' }}>{Number(c.recipientCount || 0)}</td>
                <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600, color: Number(c.openRate) > 25 ? '#27ae60' : '#e74c3c' }}>{c.openRate}%</td>
                <td style={{ padding: '10px 14px', textAlign: 'right' }}>{c.clickRate}%</td>
                <td style={{ padding: '10px 14px', textAlign: 'right' }}>{c.conversionRate}%</td>
                <td style={{ padding: '10px 14px', fontSize: 12 }}>{c.sentAt ? new Date(c.sentAt).toLocaleDateString() : '—'}</td>
              </tr>
            ))}
            {(data.campaigns || []).length === 0 && (
              <tr><td colSpan={8} style={{ padding: 30, textAlign: 'center', color: '#999' }}>No campaigns created yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function SegmentsView({ data }: { data: any }) {
  const SEGMENT_COLORS: Record<string, string> = {
    'high-value': '#8e44ad',
    'new-90d': '#27ae60',
    'at-risk': '#e74c3c',
    'never-ordered': '#f39c12',
    'quote-pending': '#3498db',
  }
  return (
    <div>
      <p style={{ fontSize: 14, color: '#666', marginBottom: 20 }}>Pre-built audience segments for targeted campaigns. Click a segment to use it when creating a campaign.</p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 20 }}>
        {(data.segments || []).map((s: any) => (
          <div key={s.key} style={{ background: '#fff', borderRadius: 12, padding: 20, boxShadow: '0 1px 4px rgba(0,0,0,0.07)', borderTop: `4px solid ${SEGMENT_COLORS[s.key] || '#999'}` }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <h3 style={{ fontSize: 16, fontWeight: 700, margin: 0, color: '#1B4F72' }}>{s.name}</h3>
              <span style={{ fontSize: 24, fontWeight: 700, color: SEGMENT_COLORS[s.key] || '#999' }}>{s.count}</span>
            </div>
            <p style={{ fontSize: 13, color: '#666', marginBottom: 12 }}>{s.description}</p>

            {s.builders && s.builders.length > 0 && (
              <div style={{ maxHeight: 150, overflowY: 'auto', fontSize: 12, borderTop: '1px solid #eee', paddingTop: 8 }}>
                {s.builders.slice(0, 8).map((b: any) => (
                  <div key={b.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', borderBottom: '1px solid #f5f5f5' }}>
                    <span style={{ fontWeight: 600 }}>{b.companyName}</span>
                    <span style={{ color: '#999' }}>{b.email}</span>
                  </div>
                ))}
                {s.builders.length > 8 && <div style={{ color: '#999', paddingTop: 4 }}>+{s.count - 8} more...</div>}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

function TemplatesView({ data }: { data: any }) {
  const TYPE_COLORS: Record<string, string> = { DRIP: '#8e44ad', EMAIL: '#3498db', SMS: '#27ae60' }

  return (
    <div>
      <p style={{ fontSize: 14, color: '#666', marginBottom: 20 }}>Ready-to-launch campaign templates. Configure and deploy to your target segments.</p>

      <div style={{ display: 'grid', gap: 20 }}>
        {(data.templates || []).map((t: any) => (
          <div key={t.id} style={{ background: '#fff', borderRadius: 12, padding: 24, boxShadow: '0 1px 4px rgba(0,0,0,0.07)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
              <div>
                <h3 style={{ fontSize: 18, fontWeight: 700, margin: 0, color: '#1B4F72' }}>{t.name}</h3>
                <p style={{ fontSize: 13, color: '#666', margin: '4px 0' }}>{t.description}</p>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <Badge text={t.type} color={TYPE_COLORS[t.type] || '#999'} />
                <Badge text={`Target: ${t.targetSegment}`} color="#1B4F72" />
              </div>
            </div>

            <div style={{ display: 'grid', gap: 8 }}>
              {(t.emails || []).map((e: any, i: number) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', background: '#f8f9fa', borderRadius: 8 }}>
                  <div style={{ minWidth: 50, fontSize: 12, fontWeight: 700, color: '#8e44ad' }}>Day {e.day}</div>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{e.subject}</div>
                    <div style={{ fontSize: 12, color: '#999' }}>{e.preview}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function PerformanceView({ data }: { data: any }) {
  return (
    <div>
      {(data.byType || []).length > 0 && (
        <>
          <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12, color: '#1B4F72' }}>Performance by Type</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: 16, marginBottom: 24 }}>
            {(data.byType || []).map((t: any) => (
              <div key={t.type} style={{ background: '#fff', borderRadius: 10, padding: 18, boxShadow: '0 1px 4px rgba(0,0,0,0.07)' }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: '#1B4F72', marginBottom: 8 }}>{t.type}</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 13 }}>
                  <div>Campaigns: <strong>{Number(t.campaignCount)}</strong></div>
                  <div>Sent: <strong>{Number(t.totalSent).toLocaleString()}</strong></div>
                  <div>Open Rate: <strong style={{ color: '#27ae60' }}>{t.avgOpenRate}%</strong></div>
                  <div>Click Rate: <strong style={{ color: '#E67E22' }}>{t.avgClickRate}%</strong></div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12, color: '#1B4F72' }}>Campaign Results</h3>
      <div style={{ background: '#fff', borderRadius: 10, overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.07)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: '#f8f9fa' }}>
              <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600 }}>Campaign</th>
              <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600 }}>Sent</th>
              <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600 }}>Opens</th>
              <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600 }}>Open %</th>
              <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600 }}>Clicks</th>
              <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600 }}>Click %</th>
              <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600 }}>Conversions</th>
              <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600 }}>Conv %</th>
            </tr>
          </thead>
          <tbody>
            {(data.campaigns || []).map((c: any, i: number) => (
              <tr key={c.id} style={{ borderTop: '1px solid #eee', background: i % 2 ? '#fafafa' : '#fff' }}>
                <td style={{ padding: '10px 14px', fontWeight: 600 }}>{c.name}</td>
                <td style={{ padding: '10px 14px', textAlign: 'right' }}>{Number(c.sentCount || 0).toLocaleString()}</td>
                <td style={{ padding: '10px 14px', textAlign: 'right' }}>{Number(c.openCount || 0).toLocaleString()}</td>
                <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600, color: Number(c.openRate) > 25 ? '#27ae60' : '#e74c3c' }}>{c.openRate}%</td>
                <td style={{ padding: '10px 14px', textAlign: 'right' }}>{Number(c.clickCount || 0).toLocaleString()}</td>
                <td style={{ padding: '10px 14px', textAlign: 'right' }}>{c.clickRate}%</td>
                <td style={{ padding: '10px 14px', textAlign: 'right' }}>{Number(c.convertCount || 0)}</td>
                <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600, color: '#8e44ad' }}>{c.conversionRate}%</td>
              </tr>
            ))}
            {(data.campaigns || []).length === 0 && (
              <tr><td colSpan={8} style={{ padding: 30, textAlign: 'center', color: '#999' }}>No sent campaigns yet. Performance data will appear here after campaigns are sent.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
