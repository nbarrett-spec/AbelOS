'use client'

import { useState, useEffect } from 'react'
import { Megaphone } from 'lucide-react'
import PageHeader from '@/components/ui/PageHeader'
import EmptyState from '@/components/ui/EmptyState'

const STATUS_COLORS: Record<string, string> = {
  DRAFT: '#95a5a6',
  SCHEDULED: '#3498db',
  ACTIVE: '#27ae60',
  SENT: '#8e44ad',
  PAUSED: '#D4B96A',
}

function KPICard({ label, value, sub, color }: { label: string; value: string | number; sub?: string; color?: string }) {
  return (
    <div style={{ background: '#fff', borderRadius: 10, padding: '18px 22px', boxShadow: '0 1px 4px rgba(0,0,0,0.07)', borderLeft: `4px solid ${color || '#0f2a3e'}` }}>
      <div className="text-[13px] text-fg-muted mb-1">{label}</div>
      <div className="text-2xl font-semibold" style={{ color: color || '#0f2a3e' }}>{value}</div>
      {sub && <div className="text-xs text-fg-subtle mt-0.5">{sub}</div>}
    </div>
  )
}

function Badge({ text, color }: { text: string; color: string }) {
  return (
    <span className="inline-block text-[11px] font-semibold" style={{ padding: '2px 10px', borderRadius: 12, background: color + '22', color, border: `1px solid ${color}44` }}>
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
      <PageHeader
        title="Marketing Automation"
        description="Campaign management, builder segmentation, drip sequences, and engagement tracking"
      />

      <div style={{ display: 'flex', gap: 4, marginBottom: 24, flexWrap: 'wrap' }}>
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className="text-[13px] cursor-pointer"
            style={{ padding: '8px 18px', borderRadius: 8, border: 'none', fontWeight: tab === t.id ? 600 : 500, background: tab === t.id ? '#0f2a3e' : '#f0f0f0', color: tab === t.id ? '#fff' : '#444' }}>
            {t.label}
          </button>
        ))}
      </div>

      {loading ? <div className="text-center py-16 text-fg-subtle">Loading...</div> : (
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
        <KPICard label="Avg Click Rate" value={`${s.avgClickRate || 0}%`} color="#C6A24E" />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16, marginBottom: 24 }}>
        <KPICard label="Reachable Builders" value={Number(r.activeReachable || 0)} sub={`of ${r.totalBuilders || 0} total`} color="#3498db" />
        <KPICard label="With Email" value={Number(r.withEmail || 0)} color="#27ae60" />
        <KPICard label="With Phone" value={Number(r.withPhone || 0)} sub="SMS capable" color="#D4B96A" />
        <KPICard label="Conversions" value={Number(s.totalConversions || 0)} color="#e74c3c" />
      </div>

      <h3 className="text-base font-semibold mb-3" style={{ color: '#0f2a3e' }}>Recent Campaigns</h3>
      <div style={{ background: '#fff', borderRadius: 10, overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.07)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: '#f8f9fa' }}>
              <th className="font-semibold" style={{ padding: '10px 14px', textAlign: 'left' }}>Campaign</th>
              <th className="font-semibold" style={{ padding: '10px 14px', textAlign: 'left' }}>Status</th>
              <th className="font-semibold" style={{ padding: '10px 14px', textAlign: 'left' }}>Segment</th>
              <th className="font-semibold" style={{ padding: '10px 14px', textAlign: 'right' }}>Recipients</th>
              <th className="font-semibold" style={{ padding: '10px 14px', textAlign: 'right' }}>Sent</th>
              <th className="font-semibold" style={{ padding: '10px 14px', textAlign: 'right' }}>Opens</th>
              <th className="font-semibold" style={{ padding: '10px 14px', textAlign: 'left' }}>Date</th>
            </tr>
          </thead>
          <tbody>
            {(data.recentCampaigns || []).map((c: any, i: number) => (
              <tr key={c.id} className="hover:bg-row-hover" style={{ borderTop: '1px solid #eee', background: i % 2 ? '#fafafa' : '#fff' }}>
                <td style={{ padding: '10px 14px' }}>
                  <div className="font-semibold">{c.name}</div>
                  <div className="text-[11px] text-fg-subtle">{c.subject}</div>
                </td>
                <td style={{ padding: '10px 14px' }}><Badge text={c.status} color={STATUS_COLORS[c.status] || '#999'} /></td>
                <td className="text-xs" style={{ padding: '10px 14px' }}>{c.targetSegment || '—'}</td>
                <td style={{ padding: '10px 14px', textAlign: 'right' }}>{Number(c.recipientCount || 0)}</td>
                <td style={{ padding: '10px 14px', textAlign: 'right' }}>{Number(c.sentCount || 0)}</td>
                <td style={{ padding: '10px 14px', textAlign: 'right' }}>{Number(c.openCount || 0)}</td>
                <td className="text-xs" style={{ padding: '10px 14px' }}>{c.sentAt ? new Date(c.sentAt).toLocaleDateString() : c.createdAt ? new Date(c.createdAt).toLocaleDateString() : '—'}</td>
              </tr>
            ))}
            {(data.recentCampaigns || []).length === 0 && (
              <tr><td colSpan={7}><EmptyState icon={<Megaphone className="w-8 h-8 text-fg-subtle" />} title="No campaigns yet" description="Use Templates to create your first campaign." /></td></tr>
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
              <th className="font-semibold" style={{ padding: '10px 14px', textAlign: 'left' }}>Campaign</th>
              <th className="font-semibold" style={{ padding: '10px 14px', textAlign: 'left' }}>Type</th>
              <th className="font-semibold" style={{ padding: '10px 14px', textAlign: 'left' }}>Status</th>
              <th className="font-semibold" style={{ padding: '10px 14px', textAlign: 'right' }}>Recipients</th>
              <th className="font-semibold" style={{ padding: '10px 14px', textAlign: 'right' }}>Open %</th>
              <th className="font-semibold" style={{ padding: '10px 14px', textAlign: 'right' }}>Click %</th>
              <th className="font-semibold" style={{ padding: '10px 14px', textAlign: 'right' }}>Conv %</th>
              <th className="font-semibold" style={{ padding: '10px 14px', textAlign: 'left' }}>Sent</th>
            </tr>
          </thead>
          <tbody>
            {(data.campaigns || []).map((c: any, i: number) => (
              <tr key={c.id} className="hover:bg-row-hover" style={{ borderTop: '1px solid #eee', background: i % 2 ? '#fafafa' : '#fff' }}>
                <td style={{ padding: '10px 14px' }}>
                  <div className="font-semibold">{c.name}</div>
                  <div className="text-[11px] text-fg-subtle">{c.subject}</div>
                </td>
                <td style={{ padding: '10px 14px' }}>{c.type}</td>
                <td style={{ padding: '10px 14px' }}><Badge text={c.status} color={STATUS_COLORS[c.status] || '#999'} /></td>
                <td style={{ padding: '10px 14px', textAlign: 'right' }}>{Number(c.recipientCount || 0)}</td>
                <td className="font-semibold" style={{ padding: '10px 14px', textAlign: 'right', color: Number(c.openRate) > 25 ? '#27ae60' : '#e74c3c' }}>{c.openRate}%</td>
                <td style={{ padding: '10px 14px', textAlign: 'right' }}>{c.clickRate}%</td>
                <td style={{ padding: '10px 14px', textAlign: 'right' }}>{c.conversionRate}%</td>
                <td className="text-xs" style={{ padding: '10px 14px' }}>{c.sentAt ? new Date(c.sentAt).toLocaleDateString() : '—'}</td>
              </tr>
            ))}
            {(data.campaigns || []).length === 0 && (
              <tr><td colSpan={8}><EmptyState icon={<Megaphone className="w-8 h-8 text-fg-subtle" />} title="No campaigns created yet" /></td></tr>
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
    'never-ordered': '#D4B96A',
    'quote-pending': '#3498db',
  }
  return (
    <div>
      <p className="text-sm text-fg-muted mb-5">Pre-built audience segments for targeted campaigns. Click a segment to use it when creating a campaign.</p>

      {(data.segments || []).length === 0 ? (
        <EmptyState icon={<Megaphone className="w-8 h-8 text-fg-subtle" />} title="No segments yet" description="Audience segments will appear here as builders are imported." />
      ) : (
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 20 }}>
        {(data.segments || []).map((s: any) => (
          <div key={s.key} style={{ background: '#fff', borderRadius: 12, padding: 20, boxShadow: '0 1px 4px rgba(0,0,0,0.07)', borderTop: `4px solid ${SEGMENT_COLORS[s.key] || '#999'}` }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <h3 className="text-base font-semibold" style={{ margin: 0, color: '#0f2a3e' }}>{s.name}</h3>
              <span className="text-2xl font-semibold" style={{ color: SEGMENT_COLORS[s.key] || '#999' }}>{s.count}</span>
            </div>
            <p className="text-[13px] text-fg-muted mb-3">{s.description}</p>

            {s.builders && s.builders.length > 0 && (
              <div className="text-xs" style={{ maxHeight: 150, overflowY: 'auto', borderTop: '1px solid #eee', paddingTop: 8 }}>
                {s.builders.slice(0, 8).map((b: any) => (
                  <div key={b.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', borderBottom: '1px solid #f5f5f5' }}>
                    <span className="font-semibold">{b.companyName}</span>
                    <span className="text-fg-subtle">{b.email}</span>
                  </div>
                ))}
                {s.builders.length > 8 && <div className="text-fg-subtle pt-1">+{s.count - 8} more...</div>}
              </div>
            )}
          </div>
        ))}
      </div>
      )}
    </div>
  )
}

function TemplatesView({ data }: { data: any }) {
  const TYPE_COLORS: Record<string, string> = { DRIP: '#8e44ad', EMAIL: '#3498db', SMS: '#27ae60' }

  return (
    <div>
      <p className="text-sm text-fg-muted mb-5">Ready-to-launch campaign templates. Configure and deploy to your target segments.</p>

      {(data.templates || []).length === 0 ? (
        <EmptyState icon={<Megaphone className="w-8 h-8 text-fg-subtle" />} title="No templates available" description="Campaign templates will appear here." />
      ) : (
      <div style={{ display: 'grid', gap: 20 }}>
        {(data.templates || []).map((t: any) => (
          <div key={t.id} style={{ background: '#fff', borderRadius: 12, padding: 24, boxShadow: '0 1px 4px rgba(0,0,0,0.07)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
              <div>
                <h3 className="text-lg font-semibold" style={{ margin: 0, color: '#0f2a3e' }}>{t.name}</h3>
                <p className="text-[13px] text-fg-muted" style={{ margin: '4px 0' }}>{t.description}</p>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <Badge text={t.type} color={TYPE_COLORS[t.type] || '#999'} />
                <Badge text={`Target: ${t.targetSegment}`} color="#0f2a3e" />
              </div>
            </div>

            <div style={{ display: 'grid', gap: 8 }}>
              {(t.emails || []).map((e: any, i: number) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', background: '#f8f9fa', borderRadius: 8 }}>
                  <div className="text-xs font-semibold" style={{ minWidth: 50, color: '#8e44ad' }}>Day {e.day}</div>
                  <div>
                    <div className="text-[13px] font-semibold">{e.subject}</div>
                    <div className="text-xs text-fg-subtle">{e.preview}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      )}
    </div>
  )
}

function PerformanceView({ data }: { data: any }) {
  return (
    <div>
      {(data.byType || []).length > 0 && (
        <>
          <h3 className="text-base font-semibold mb-3" style={{ color: '#0f2a3e' }}>Performance by Type</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: 16, marginBottom: 24 }}>
            {(data.byType || []).map((t: any) => (
              <div key={t.type} style={{ background: '#fff', borderRadius: 10, padding: 18, boxShadow: '0 1px 4px rgba(0,0,0,0.07)' }}>
                <div className="text-sm font-semibold mb-2" style={{ color: '#0f2a3e' }}>{t.type}</div>
                <div className="text-[13px]" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <div>Campaigns: <strong>{Number(t.campaignCount)}</strong></div>
                  <div>Sent: <strong>{Number(t.totalSent).toLocaleString()}</strong></div>
                  <div>Open Rate: <strong style={{ color: '#27ae60' }}>{t.avgOpenRate}%</strong></div>
                  <div>Click Rate: <strong className="text-signal">{t.avgClickRate}%</strong></div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      <h3 className="text-base font-semibold mb-3" style={{ color: '#0f2a3e' }}>Campaign Results</h3>
      <div style={{ background: '#fff', borderRadius: 10, overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.07)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: '#f8f9fa' }}>
              <th className="font-semibold" style={{ padding: '10px 14px', textAlign: 'left' }}>Campaign</th>
              <th className="font-semibold" style={{ padding: '10px 14px', textAlign: 'right' }}>Sent</th>
              <th className="font-semibold" style={{ padding: '10px 14px', textAlign: 'right' }}>Opens</th>
              <th className="font-semibold" style={{ padding: '10px 14px', textAlign: 'right' }}>Open %</th>
              <th className="font-semibold" style={{ padding: '10px 14px', textAlign: 'right' }}>Clicks</th>
              <th className="font-semibold" style={{ padding: '10px 14px', textAlign: 'right' }}>Click %</th>
              <th className="font-semibold" style={{ padding: '10px 14px', textAlign: 'right' }}>Conversions</th>
              <th className="font-semibold" style={{ padding: '10px 14px', textAlign: 'right' }}>Conv %</th>
            </tr>
          </thead>
          <tbody>
            {(data.campaigns || []).map((c: any, i: number) => (
              <tr key={c.id} className="hover:bg-row-hover" style={{ borderTop: '1px solid #eee', background: i % 2 ? '#fafafa' : '#fff' }}>
                <td className="font-semibold" style={{ padding: '10px 14px' }}>{c.name}</td>
                <td style={{ padding: '10px 14px', textAlign: 'right' }}>{Number(c.sentCount || 0).toLocaleString()}</td>
                <td style={{ padding: '10px 14px', textAlign: 'right' }}>{Number(c.openCount || 0).toLocaleString()}</td>
                <td className="font-semibold" style={{ padding: '10px 14px', textAlign: 'right', color: Number(c.openRate) > 25 ? '#27ae60' : '#e74c3c' }}>{c.openRate}%</td>
                <td style={{ padding: '10px 14px', textAlign: 'right' }}>{Number(c.clickCount || 0).toLocaleString()}</td>
                <td style={{ padding: '10px 14px', textAlign: 'right' }}>{c.clickRate}%</td>
                <td style={{ padding: '10px 14px', textAlign: 'right' }}>{Number(c.convertCount || 0)}</td>
                <td className="font-semibold" style={{ padding: '10px 14px', textAlign: 'right', color: '#8e44ad' }}>{c.conversionRate}%</td>
              </tr>
            ))}
            {(data.campaigns || []).length === 0 && (
              <tr><td colSpan={8}><EmptyState icon={<Megaphone className="w-8 h-8 text-fg-subtle" />} title="No sent campaigns yet" description="Performance data will appear here after campaigns are sent." /></td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
