'use client'

import { useState, useEffect } from 'react'

const STAGE_COLORS: Record<string, string> = {
  NEW: '#95a5a6',
  CONTACTED: '#3498db',
  INTERESTED: '#2ecc71',
  MEETING_SCHEDULED: '#8e44ad',
  PROPOSAL_SENT: '#C6A24E',
  CONVERTED: '#27ae60',
  LOST: '#e74c3c',
  NOT_INTERESTED: '#7f8c8d',
}

const TYPE_ICONS: Record<string, string> = {
  CALL: 'tel',
  EMAIL: 'email',
  MEETING: 'mtg',
  SITE_VISIT: 'site',
  SMS: 'sms',
  OTHER: 'other',
}

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

function FunnelBar({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  const pct = max > 0 ? (value / max) * 100 : 0
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
      <div style={{ width: 130, fontSize: 13, fontWeight: 600, textAlign: 'right' }}>{label}</div>
      <div style={{ flex: 1, height: 28, background: '#f0f0f0', borderRadius: 6, overflow: 'hidden', position: 'relative' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 6, minWidth: value > 0 ? 30 : 0, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', paddingRight: 8 }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: '#fff' }}>{value}</span>
        </div>
      </div>
      <div style={{ width: 50, fontSize: 12, color: '#666' }}>{pct.toFixed(0)}%</div>
    </div>
  )
}

export default function OutreachTrackerPage() {
  const [tab, setTab] = useState('dashboard')
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    fetch(`/api/ops/outreach/tracker?report=${tab}`)
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [tab])

  const tabs = [
    { id: 'dashboard', label: 'Overview' },
    { id: 'prospects', label: 'Prospects' },
    { id: 'pipeline', label: 'Pipeline' },
    { id: 'activity-log', label: 'Activity Log' },
    { id: 'effectiveness', label: 'Effectiveness' },
  ]

  return (
    <div style={{ padding: '24px 32px', maxWidth: 1400 }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, color: '#0f2a3e', marginBottom: 4 }}>Cold Outreach & Prospecting</h1>
      <p style={{ color: '#666', fontSize: 14, marginBottom: 20 }}>Track prospecting efforts, manage outreach pipeline, and measure conversion effectiveness</p>

      <div style={{ display: 'flex', gap: 4, marginBottom: 24, flexWrap: 'wrap' }}>
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            style={{ padding: '8px 18px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: tab === t.id ? 700 : 500, background: tab === t.id ? '#0f2a3e' : '#f0f0f0', color: tab === t.id ? '#fff' : '#444' }}>
            {t.label}
          </button>
        ))}
      </div>

      {loading ? <div style={{ textAlign: 'center', padding: 60, color: '#999' }}>Loading...</div> : (
        <>
          {tab === 'dashboard' && data && <DashboardView data={data} />}
          {tab === 'prospects' && data && <ProspectsView data={data} />}
          {tab === 'pipeline' && data && <PipelineView data={data} />}
          {tab === 'activity-log' && data && <ActivityView data={data} />}
          {tab === 'effectiveness' && data && <EffectivenessView data={data} />}
        </>
      )}
    </div>
  )
}

function DashboardView({ data }: { data: any }) {
  const s = data.stats || {}
  const a = data.activityStats || {}
  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16, marginBottom: 24 }}>
        <KPICard label="Total Prospects" value={Number(s.totalProspects || 0)} sub={`${s.newThisMonth || 0} new this month`} />
        <KPICard label="Active Pipeline" value={`$${Number(s.activePipelineValue || 0).toLocaleString()}`} color="#8e44ad" sub="Interested + Meeting + Proposal" />
        <KPICard label="Converted" value={Number(s.converted || 0)} color="#27ae60" />
        <KPICard label="Activities (30d)" value={Number(a.thisMonth || 0)} sub={`${a.thisWeek || 0} this week`} color="#C6A24E" />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12, marginBottom: 24 }}>
        {[
          { label: 'New', value: s.newProspects, color: STAGE_COLORS.NEW },
          { label: 'Contacted', value: s.contacted, color: STAGE_COLORS.CONTACTED },
          { label: 'Interested', value: s.interested, color: STAGE_COLORS.INTERESTED },
          { label: 'Meeting Set', value: s.meetingScheduled, color: STAGE_COLORS.MEETING_SCHEDULED },
          { label: 'Proposal Sent', value: s.proposalSent, color: STAGE_COLORS.PROPOSAL_SENT },
          { label: 'Converted', value: s.converted, color: STAGE_COLORS.CONVERTED },
        ].map(item => (
          <div key={item.label} style={{ background: '#fff', borderRadius: 8, padding: 14, textAlign: 'center', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', borderTop: `3px solid ${item.color}` }}>
            <div style={{ fontSize: 24, fontWeight: 700, color: item.color }}>{Number(item.value || 0)}</div>
            <div style={{ fontSize: 12, color: '#666' }}>{item.label}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
        <div>
          <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12, color: '#0f2a3e' }}>Activity Breakdown</h3>
          <div style={{ background: '#fff', borderRadius: 10, padding: 18, boxShadow: '0 1px 4px rgba(0,0,0,0.07)' }}>
            {[
              { label: 'Calls', value: Number(a.calls || 0), color: '#e74c3c' },
              { label: 'Emails', value: Number(a.emails || 0), color: '#3498db' },
              { label: 'Meetings', value: Number(a.meetings || 0), color: '#8e44ad' },
              { label: 'Site Visits', value: Number(a.siteVisits || 0), color: '#27ae60' },
            ].map(item => (
              <div key={item.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid #f0f0f0' }}>
                <span style={{ fontSize: 13, fontWeight: 600 }}>{item.label}</span>
                <span style={{ fontSize: 18, fontWeight: 700, color: item.color }}>{item.value}</span>
              </div>
            ))}
          </div>
        </div>

        <div>
          <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12, color: '#0f2a3e' }}>Upcoming Follow-Ups</h3>
          <div style={{ background: '#fff', borderRadius: 10, padding: 18, boxShadow: '0 1px 4px rgba(0,0,0,0.07)', maxHeight: 300, overflowY: 'auto' }}>
            {(data.upcomingFollowUps || []).length === 0 ? (
              <div style={{ textAlign: 'center', color: '#999', padding: 20 }}>No upcoming follow-ups</div>
            ) : (data.upcomingFollowUps || []).map((f: any) => (
              <div key={f.id} style={{ padding: '8px 0', borderBottom: '1px solid #f0f0f0' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ fontWeight: 600, fontSize: 13 }}>{f.companyName}</span>
                  <span style={{ fontSize: 12, color: '#C6A24E', fontWeight: 600 }}>{new Date(f.followUpDate).toLocaleDateString()}</span>
                </div>
                <div style={{ fontSize: 12, color: '#666' }}>{f.contactName} — {f.type} {f.subject ? `: ${f.subject}` : ''}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function ProspectsView({ data }: { data: any }) {
  return (
    <div>
      <div style={{ background: '#fff', borderRadius: 10, overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.07)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: '#f8f9fa' }}>
              <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600 }}>Company</th>
              <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600 }}>Status</th>
              <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600 }}>Contact</th>
              <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600 }}>Location</th>
              <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600 }}>Est. Volume</th>
              <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600 }}>Touches</th>
              <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600 }}>Days Idle</th>
              <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600 }}>Source</th>
            </tr>
          </thead>
          <tbody>
            {(data.prospects || []).map((p: any, i: number) => (
              <tr key={p.id} style={{ borderTop: '1px solid #eee', background: i % 2 ? '#fafafa' : '#fff' }}>
                <td style={{ padding: '10px 14px' }}>
                  <div style={{ fontWeight: 600 }}>{p.companyName}</div>
                  {p.licenseNumber && <div style={{ fontSize: 11, color: '#999' }}>Lic: {p.licenseNumber}</div>}
                </td>
                <td style={{ padding: '10px 14px' }}><Badge text={p.status?.replace('_', ' ')} color={STAGE_COLORS[p.status] || '#999'} /></td>
                <td style={{ padding: '10px 14px' }}>
                  <div style={{ fontSize: 12 }}>{p.contactName}</div>
                  <div style={{ fontSize: 11, color: '#999' }}>{p.email}</div>
                  <div style={{ fontSize: 11, color: '#999' }}>{p.phone}</div>
                </td>
                <td style={{ padding: '10px 14px', fontSize: 12 }}>{[p.city, p.state].filter(Boolean).join(', ') || '—'}</td>
                <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600 }}>
                  {p.estimatedAnnualVolume ? `$${Number(p.estimatedAnnualVolume).toLocaleString()}` : '—'}
                </td>
                <td style={{ padding: '10px 14px', textAlign: 'right' }}>{Number(p.activityCount || 0)}</td>
                <td style={{ padding: '10px 14px', textAlign: 'right', color: Number(p.daysSinceActivity) > 14 ? '#e74c3c' : '#27ae60', fontWeight: 600 }}>
                  {p.daysSinceActivity ?? '—'}
                </td>
                <td style={{ padding: '10px 14px', fontSize: 12 }}>{p.source || '—'}</td>
              </tr>
            ))}
            {(data.prospects || []).length === 0 && (
              <tr><td colSpan={8} style={{ padding: 30, textAlign: 'center', color: '#999' }}>No active prospects. Add prospects via the API to start tracking outreach.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function PipelineView({ data }: { data: any }) {
  const funnel = data.funnel || {}
  const maxFunnel = Number(funnel.totalProspects || 1)
  return (
    <div>
      <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16, color: '#0f2a3e' }}>Conversion Funnel</h3>
      <div style={{ background: '#fff', borderRadius: 10, padding: 24, boxShadow: '0 1px 4px rgba(0,0,0,0.07)', marginBottom: 24 }}>
        <FunnelBar label="Total Prospects" value={Number(funnel.totalProspects || 0)} max={maxFunnel} color="#95a5a6" />
        <FunnelBar label="Contacted" value={Number(funnel.contacted || 0)} max={maxFunnel} color="#3498db" />
        <FunnelBar label="Interested" value={Number(funnel.interested || 0)} max={maxFunnel} color="#2ecc71" />
        <FunnelBar label="Meeting Held" value={Number(funnel.meetingHeld || 0)} max={maxFunnel} color="#8e44ad" />
        <FunnelBar label="Proposal Sent" value={Number(funnel.proposalSent || 0)} max={maxFunnel} color="#C6A24E" />
        <FunnelBar label="Converted" value={Number(funnel.converted || 0)} max={maxFunnel} color="#27ae60" />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
        <div>
          <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12, color: '#0f2a3e' }}>Pipeline Stages</h3>
          <div style={{ background: '#fff', borderRadius: 10, overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.07)' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: '#f8f9fa' }}>
                  <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600 }}>Stage</th>
                  <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600 }}>Count</th>
                  <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600 }}>Total Value</th>
                  <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600 }}>Avg Value</th>
                </tr>
              </thead>
              <tbody>
                {(data.stages || []).map((s: any, i: number) => (
                  <tr key={s.stage} style={{ borderTop: '1px solid #eee', background: i % 2 ? '#fafafa' : '#fff' }}>
                    <td style={{ padding: '10px 14px' }}><Badge text={s.stage?.replace('_', ' ')} color={STAGE_COLORS[s.stage] || '#999'} /></td>
                    <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600 }}>{Number(s.count)}</td>
                    <td style={{ padding: '10px 14px', textAlign: 'right' }}>${Number(s.totalValue || 0).toLocaleString()}</td>
                    <td style={{ padding: '10px 14px', textAlign: 'right' }}>${Number(s.avgValue || 0).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div>
          <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12, color: '#0f2a3e' }}>Source Effectiveness</h3>
          <div style={{ background: '#fff', borderRadius: 10, overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.07)' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: '#f8f9fa' }}>
                  <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600 }}>Source</th>
                  <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600 }}>Prospects</th>
                  <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600 }}>Converted</th>
                  <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600 }}>Conv %</th>
                </tr>
              </thead>
              <tbody>
                {(data.sources || []).map((s: any, i: number) => (
                  <tr key={s.source} style={{ borderTop: '1px solid #eee', background: i % 2 ? '#fafafa' : '#fff' }}>
                    <td style={{ padding: '10px 14px', fontWeight: 600 }}>{s.source}</td>
                    <td style={{ padding: '10px 14px', textAlign: 'right' }}>{Number(s.totalProspects)}</td>
                    <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600, color: '#27ae60' }}>{Number(s.conversions)}</td>
                    <td style={{ padding: '10px 14px', textAlign: 'right' }}>{s.conversionRate}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}

function ActivityView({ data }: { data: any }) {
  const OUTCOME_COLORS: Record<string, string> = {
    POSITIVE: '#27ae60',
    NEGATIVE: '#e74c3c',
    NEUTRAL: '#D4B96A',
    NO_RESPONSE: '#95a5a6',
    PENDING: '#3498db',
  }
  return (
    <div>
      {(data.byType || []).length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16, marginBottom: 24 }}>
          {(data.byType || []).map((t: any) => (
            <div key={t.type} style={{ background: '#fff', borderRadius: 10, padding: 16, boxShadow: '0 1px 4px rgba(0,0,0,0.07)' }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#0f2a3e', marginBottom: 8 }}>{t.type} (30d)</div>
              <div style={{ fontSize: 24, fontWeight: 700 }}>{Number(t.count)}</div>
              <div style={{ fontSize: 12, color: '#27ae60' }}>+{Number(t.positive || 0)} positive</div>
              <div style={{ fontSize: 12, color: '#95a5a6' }}>{Number(t.noResponse || 0)} no response</div>
            </div>
          ))}
        </div>
      )}

      <div style={{ background: '#fff', borderRadius: 10, overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.07)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: '#f8f9fa' }}>
              <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600 }}>Date</th>
              <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600 }}>Prospect</th>
              <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600 }}>Type</th>
              <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600 }}>Subject</th>
              <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600 }}>Outcome</th>
              <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600 }}>Follow-Up</th>
            </tr>
          </thead>
          <tbody>
            {(data.activities || []).map((a: any, i: number) => (
              <tr key={a.id} style={{ borderTop: '1px solid #eee', background: i % 2 ? '#fafafa' : '#fff' }}>
                <td style={{ padding: '10px 14px', fontSize: 12 }}>{new Date(a.performedAt).toLocaleDateString()}</td>
                <td style={{ padding: '10px 14px' }}>
                  <div style={{ fontWeight: 600 }}>{a.companyName}</div>
                  <div style={{ fontSize: 11, color: '#999' }}>{a.contactName}</div>
                </td>
                <td style={{ padding: '10px 14px' }}><Badge text={a.type} color="#0f2a3e" /></td>
                <td style={{ padding: '10px 14px' }}>{a.subject || '—'}</td>
                <td style={{ padding: '10px 14px' }}><Badge text={a.outcome || 'PENDING'} color={OUTCOME_COLORS[a.outcome] || '#999'} /></td>
                <td style={{ padding: '10px 14px', fontSize: 12 }}>{a.followUpDate ? new Date(a.followUpDate).toLocaleDateString() : '—'}</td>
              </tr>
            ))}
            {(data.activities || []).length === 0 && (
              <tr><td colSpan={6} style={{ padding: 30, textAlign: 'center', color: '#999' }}>No activities logged yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function EffectivenessView({ data }: { data: any }) {
  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16, marginBottom: 24 }}>
        <KPICard label="Avg Days to Convert" value={data.avgDaysToConvert || '—'} color="#8e44ad" />
        <KPICard label="Converted Prospects" value={(data.touchesToConvert || []).length} color="#27ae60" />
      </div>

      <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12, color: '#0f2a3e' }}>Avg Touches by Outcome</h3>
      <div style={{ background: '#fff', borderRadius: 10, overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.07)', marginBottom: 24 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: '#f8f9fa' }}>
              <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600 }}>Status</th>
              <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600 }}>Prospects</th>
              <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600 }}>Avg Touches</th>
            </tr>
          </thead>
          <tbody>
            {(data.avgTouches || []).map((t: any, i: number) => (
              <tr key={t.status} style={{ borderTop: '1px solid #eee', background: i % 2 ? '#fafafa' : '#fff' }}>
                <td style={{ padding: '10px 14px' }}><Badge text={t.status?.replace('_', ' ')} color={STAGE_COLORS[t.status] || '#999'} /></td>
                <td style={{ padding: '10px 14px', textAlign: 'right' }}>{Number(t.prospectCount)}</td>
                <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 700 }}>{t.avgTouches}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {(data.touchesToConvert || []).length > 0 && (
        <>
          <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12, color: '#0f2a3e' }}>Conversion Details</h3>
          <div style={{ background: '#fff', borderRadius: 10, overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.07)', marginBottom: 24 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: '#f8f9fa' }}>
                  <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600 }}>Company</th>
                  <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600 }}>Touches</th>
                  <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600 }}>Days to Convert</th>
                  <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600 }}>First Touch</th>
                  <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600 }}>Last Touch</th>
                </tr>
              </thead>
              <tbody>
                {(data.touchesToConvert || []).map((t: any, i: number) => (
                  <tr key={t.id} style={{ borderTop: '1px solid #eee', background: i % 2 ? '#fafafa' : '#fff' }}>
                    <td style={{ padding: '10px 14px', fontWeight: 600 }}>{t.companyName}</td>
                    <td style={{ padding: '10px 14px', textAlign: 'right' }}>{Number(t.touchCount)}</td>
                    <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 700, color: '#8e44ad' }}>{t.daysToConvert ?? '—'}</td>
                    <td style={{ padding: '10px 14px', fontSize: 12 }}>{t.firstTouch ? new Date(t.firstTouch).toLocaleDateString() : '—'}</td>
                    <td style={{ padding: '10px 14px', fontSize: 12 }}>{t.lastTouch ? new Date(t.lastTouch).toLocaleDateString() : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {(data.monthlyVolume || []).length > 0 && (
        <>
          <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12, color: '#0f2a3e' }}>Monthly Outreach Volume</h3>
          <div style={{ background: '#fff', borderRadius: 10, overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.07)' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: '#f8f9fa' }}>
                  <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600 }}>Month</th>
                  <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600 }}>Activities</th>
                  <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600 }}>Positive</th>
                </tr>
              </thead>
              <tbody>
                {(data.monthlyVolume || []).map((m: any, i: number) => (
                  <tr key={i} style={{ borderTop: '1px solid #eee', background: i % 2 ? '#fafafa' : '#fff' }}>
                    <td style={{ padding: '10px 14px', fontWeight: 600 }}>{new Date(m.month).toLocaleDateString('en-US', { year: 'numeric', month: 'short' })}</td>
                    <td style={{ padding: '10px 14px', textAlign: 'right' }}>{Number(m.activities)}</td>
                    <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600, color: '#27ae60' }}>{Number(m.positive)}</td>
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
