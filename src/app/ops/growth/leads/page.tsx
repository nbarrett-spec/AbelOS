'use client'

import { useState, useEffect } from 'react'

const TIER_COLORS: Record<string, string> = {
  HOT: '#e74c3c',
  WARM: '#e67e22',
  COOL: '#3498db',
  COLD: '#95a5a6',
}

const RISK_COLORS: Record<string, string> = {
  HIGH_RISK: '#e74c3c',
  MEDIUM_RISK: '#e67e22',
  LOW_RISK: '#f39c12',
  HEALTHY: '#27ae60',
  NEVER_ORDERED: '#95a5a6',
}

const SEGMENT_COLORS: Record<string, string> = {
  PLATINUM: '#8e44ad',
  GOLD: '#f1c40f',
  SILVER: '#bdc3c7',
  BRONZE: '#e67e22',
  PROSPECT: '#95a5a6',
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

function ScoreBar({ score, max = 100 }: { score: number; max?: number }) {
  const pct = Math.min(100, (score / max) * 100)
  const color = pct >= 75 ? '#e74c3c' : pct >= 50 ? '#e67e22' : pct >= 25 ? '#3498db' : '#95a5a6'
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{ flex: 1, height: 8, background: '#f0f0f0', borderRadius: 4, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 4 }} />
      </div>
      <span style={{ fontSize: 12, fontWeight: 600, color, minWidth: 28 }}>{score}</span>
    </div>
  )
}

export default function LeadScoringPage() {
  const [tab, setTab] = useState('dashboard')
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    fetch(`/api/ops/growth/leads?report=${tab}`)
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [tab])

  const tabs = [
    { id: 'dashboard', label: 'Overview' },
    { id: 'lead-scores', label: 'Lead Scores' },
    { id: 'clv-analysis', label: 'Customer LTV' },
    { id: 'churn-risk', label: 'Churn Risk' },
    { id: 'growth-opportunities', label: 'Growth Opps' },
    { id: 'engagement-timeline', label: 'Engagement' },
  ]

  return (
    <div style={{ padding: '24px 32px', maxWidth: 1400 }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, color: '#1B4F72', marginBottom: 4 }}>Lead Scoring & Customer Intelligence</h1>
      <p style={{ color: '#666', fontSize: 14, marginBottom: 20 }}>RFM-based scoring, lifetime value analysis, churn prediction, and growth opportunities</p>

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
          {tab === 'lead-scores' && data && <LeadScoresView data={data} />}
          {tab === 'clv-analysis' && data && <CLVView data={data} />}
          {tab === 'churn-risk' && data && <ChurnView data={data} />}
          {tab === 'growth-opportunities' && data && <GrowthView data={data} />}
          {tab === 'engagement-timeline' && data && <EngagementView data={data} />}
        </>
      )}
    </div>
  )
}

function DashboardView({ data }: { data: any }) {
  const e = data.engagement || {}
  const g = data.growth || {}
  const p = data.pipeline || {}
  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16, marginBottom: 24 }}>
        <KPICard label="Total Builders" value={Number(e.totalBuilders || 0)} sub={`${e.activeBuilders} active`} />
        <KPICard label="New (30d)" value={Number(g.newBuilders30d || 0)} sub={`${g.newBuilders7d || 0} this week`} color="#27ae60" />
        <KPICard label="Pipeline Value" value={`$${Number(p.pipelineValue || 0).toLocaleString()}`} sub={`${p.activeQuotes || 0} quotes`} color="#E67E22" />
        <KPICard label="Active Deals" value={Number(p.activeDeals || 0)} sub={`$${Number(p.dealPipelineValue || 0).toLocaleString()}`} color="#8e44ad" />
      </div>

      <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12, color: '#1B4F72' }}>Revenue Segments</h3>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 24 }}>
        {(data.segments || []).map((s: any) => (
          <div key={s.segment} style={{ background: '#fff', borderRadius: 10, padding: 16, boxShadow: '0 1px 4px rgba(0,0,0,0.06)', borderTop: `3px solid ${SEGMENT_COLORS[s.segment] || '#999'}` }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: SEGMENT_COLORS[s.segment] || '#999' }}>{s.segment}</div>
            <div style={{ fontSize: 22, fontWeight: 700, marginTop: 4 }}>{Number(s.builderCount)}</div>
            <div style={{ fontSize: 12, color: '#666' }}>Revenue: ${Number(s.segmentRevenue || 0).toLocaleString()}</div>
            <div style={{ fontSize: 12, color: '#999' }}>Avg: ${Number(s.avgSpend || 0).toLocaleString()}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

function LeadScoresView({ data }: { data: any }) {
  const summary = data.summary || {}
  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 24 }}>
        <KPICard label="Hot Leads" value={summary.hot || 0} color="#e74c3c" />
        <KPICard label="Warm Leads" value={summary.warm || 0} color="#e67e22" />
        <KPICard label="Cool Leads" value={summary.cool || 0} color="#3498db" />
        <KPICard label="Cold Leads" value={summary.cold || 0} color="#95a5a6" />
      </div>

      <div style={{ background: '#fff', borderRadius: 10, overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.07)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: '#f8f9fa' }}>
              <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600 }}>Builder</th>
              <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600 }}>Tier</th>
              <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600 }}>Score</th>
              <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600 }}>Orders</th>
              <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600 }}>Total Spend</th>
              <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600 }}>Avg Order</th>
              <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600 }}>Last Order</th>
              <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600 }}>Quotes</th>
              <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600 }}>Conv %</th>
            </tr>
          </thead>
          <tbody>
            {(data.builders || []).slice(0, 50).map((b: any, i: number) => (
              <tr key={b.id} style={{ borderTop: '1px solid #eee', background: i % 2 ? '#fafafa' : '#fff' }}>
                <td style={{ padding: '10px 14px' }}>
                  <div style={{ fontWeight: 600 }}>{b.companyName}</div>
                  <div style={{ fontSize: 11, color: '#999' }}>{b.contactName}</div>
                </td>
                <td style={{ padding: '10px 14px' }}><Badge text={b.leadTier} color={TIER_COLORS[b.leadTier] || '#999'} /></td>
                <td style={{ padding: '10px 14px', width: 140 }}><ScoreBar score={Number(b.leadScore)} /></td>
                <td style={{ padding: '10px 14px', textAlign: 'right' }}>{Number(b.orderCount)}</td>
                <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600 }}>${Number(b.totalSpend || 0).toLocaleString()}</td>
                <td style={{ padding: '10px 14px', textAlign: 'right' }}>${Number(b.avgOrderValue || 0).toLocaleString()}</td>
                <td style={{ padding: '10px 14px', fontSize: 12 }}>{b.lastOrderDate ? new Date(b.lastOrderDate).toLocaleDateString() : '—'}</td>
                <td style={{ padding: '10px 14px', textAlign: 'right' }}>{Number(b.quoteCount)}</td>
                <td style={{ padding: '10px 14px', textAlign: 'right' }}>{Number(b.quoteConversionRate || 0).toFixed(0)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function CLVView({ data }: { data: any }) {
  const dist = data.distribution || {}
  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16, marginBottom: 24 }}>
        <KPICard label="Total 3yr CLV" value={`$${Number(data.totalCLV || 0).toLocaleString()}`} color="#8e44ad" />
        <KPICard label="Avg CLV" value={`$${Number(data.avgCLV || 0).toLocaleString()}`} color="#1B4F72" />
        <KPICard label="$100K+ Accounts" value={dist.over100k || 0} color="#e74c3c" />
        <KPICard label="$50-100K Accounts" value={dist['50k_100k'] || 0} color="#e67e22" />
      </div>

      <div style={{ background: '#fff', borderRadius: 10, overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.07)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: '#f8f9fa' }}>
              <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600 }}>Builder</th>
              <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600 }}>3yr CLV</th>
              <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600 }}>Annual Rate</th>
              <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600 }}>Monthly Rate</th>
              <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600 }}>Total Revenue</th>
              <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600 }}>Orders</th>
              <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600 }}>Avg Order</th>
              <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600 }}>Months</th>
            </tr>
          </thead>
          <tbody>
            {(data.builders || []).slice(0, 40).map((b: any, i: number) => (
              <tr key={b.id} style={{ borderTop: '1px solid #eee', background: i % 2 ? '#fafafa' : '#fff' }}>
                <td style={{ padding: '10px 14px' }}>
                  <div style={{ fontWeight: 600 }}>{b.companyName}</div>
                  <div style={{ fontSize: 11, color: '#999' }}>{b.contactName}</div>
                </td>
                <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 700, color: '#8e44ad' }}>${Number(b.clv3Year || 0).toLocaleString()}</td>
                <td style={{ padding: '10px 14px', textAlign: 'right' }}>${Number(b.projectedAnnualValue || 0).toLocaleString()}</td>
                <td style={{ padding: '10px 14px', textAlign: 'right' }}>${Number(b.monthlyRevenueRate || 0).toLocaleString()}</td>
                <td style={{ padding: '10px 14px', textAlign: 'right' }}>${Number(b.totalRevenue || 0).toLocaleString()}</td>
                <td style={{ padding: '10px 14px', textAlign: 'right' }}>{Number(b.orderCount)}</td>
                <td style={{ padding: '10px 14px', textAlign: 'right' }}>${Number(b.avgOrderValue || 0).toLocaleString()}</td>
                <td style={{ padding: '10px 14px', textAlign: 'right' }}>{Number(b.monthsAsCustomer || 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function ChurnView({ data }: { data: any }) {
  const s = data.summary || {}
  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16, marginBottom: 24 }}>
        <KPICard label="High Risk" value={s.highRisk || 0} color="#e74c3c" sub="180+ days inactive" />
        <KPICard label="Medium Risk" value={s.mediumRisk || 0} color="#e67e22" sub="90-180 days inactive" />
        <KPICard label="Low Risk" value={s.lowRisk || 0} color="#f39c12" sub="45-90 days inactive" />
        <KPICard label="Healthy" value={s.healthy || 0} color="#27ae60" sub="Active recent" />
        <KPICard label="At-Risk Revenue" value={`$${Number(data.atRiskRevenue || 0).toLocaleString()}`} color="#e74c3c" sub="High + Medium risk" />
      </div>

      <div style={{ background: '#fff', borderRadius: 10, overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.07)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: '#f8f9fa' }}>
              <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600 }}>Builder</th>
              <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600 }}>Risk</th>
              <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600 }}>Risk Score</th>
              <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600 }}>Days Since Order</th>
              <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600 }}>Past Spend</th>
              <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600 }}>Orders</th>
              <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600 }}>Contact</th>
            </tr>
          </thead>
          <tbody>
            {(data.builders || []).filter((b: any) => b.churnRisk !== 'HEALTHY').slice(0, 40).map((b: any, i: number) => (
              <tr key={b.id} style={{ borderTop: '1px solid #eee', background: i % 2 ? '#fafafa' : '#fff' }}>
                <td style={{ padding: '10px 14px' }}>
                  <div style={{ fontWeight: 600 }}>{b.companyName}</div>
                  <div style={{ fontSize: 11, color: '#999' }}>{b.contactName}</div>
                </td>
                <td style={{ padding: '10px 14px' }}><Badge text={b.churnRisk?.replace('_', ' ')} color={RISK_COLORS[b.churnRisk] || '#999'} /></td>
                <td style={{ padding: '10px 14px', width: 130 }}><ScoreBar score={Number(b.riskScore)} /></td>
                <td style={{ padding: '10px 14px', textAlign: 'right', color: Number(b.daysSinceLastOrder) > 90 ? '#e74c3c' : '#333' }}>
                  {b.daysSinceLastOrder ?? '—'}
                </td>
                <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600 }}>${Number(b.totalSpend || 0).toLocaleString()}</td>
                <td style={{ padding: '10px 14px', textAlign: 'right' }}>{Number(b.orderCount || 0)}</td>
                <td style={{ padding: '10px 14px', fontSize: 12 }}>
                  <div>{b.email}</div>
                  <div style={{ color: '#999' }}>{b.phone}</div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function GrowthView({ data }: { data: any }) {
  return (
    <div>
      <KPICard label="Total Upsell Potential" value={`$${Number(data.totalPotentialRevenue || 0).toLocaleString()}`} color="#27ae60" />

      <h3 style={{ fontSize: 16, fontWeight: 600, margin: '24px 0 12px', color: '#1B4F72' }}>Win-Back Targets</h3>
      <p style={{ fontSize: 13, color: '#666', marginBottom: 12 }}>Inactive builders with $5K+ past spend — prime for re-engagement</p>
      <div style={{ background: '#fff', borderRadius: 10, overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.07)', marginBottom: 24 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: '#f8f9fa' }}>
              <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600 }}>Builder</th>
              <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600 }}>Past Spend</th>
              <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600 }}>Past Orders</th>
              <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600 }}>Days Inactive</th>
              <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600 }}>Contact</th>
            </tr>
          </thead>
          <tbody>
            {(data.winBack || []).map((b: any, i: number) => (
              <tr key={b.id} style={{ borderTop: '1px solid #eee', background: i % 2 ? '#fafafa' : '#fff' }}>
                <td style={{ padding: '10px 14px', fontWeight: 600 }}>{b.companyName}</td>
                <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 700, color: '#e74c3c' }}>${Number(b.pastSpend || 0).toLocaleString()}</td>
                <td style={{ padding: '10px 14px', textAlign: 'right' }}>{Number(b.pastOrders)}</td>
                <td style={{ padding: '10px 14px', textAlign: 'right' }}>{b.daysSinceLastOrder}</td>
                <td style={{ padding: '10px 14px', fontSize: 12 }}>{b.email}<br/><span style={{ color: '#999' }}>{b.phone}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h3 style={{ fontSize: 16, fontWeight: 600, margin: '24px 0 12px', color: '#1B4F72' }}>Upsell Opportunities</h3>
      <p style={{ fontSize: 13, color: '#666', marginBottom: 12 }}>Builders ordering below segment average — room to grow order value</p>
      <div style={{ background: '#fff', borderRadius: 10, overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.07)', marginBottom: 24 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: '#f8f9fa' }}>
              <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600 }}>Builder</th>
              <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600 }}>Avg Order</th>
              <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600 }}>Segment Avg</th>
              <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600 }}>Gap</th>
              <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600 }}>Potential Revenue</th>
              <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600 }}>Orders</th>
            </tr>
          </thead>
          <tbody>
            {(data.upsell || []).map((b: any, i: number) => (
              <tr key={b.id} style={{ borderTop: '1px solid #eee', background: i % 2 ? '#fafafa' : '#fff' }}>
                <td style={{ padding: '10px 14px', fontWeight: 600 }}>{b.companyName}</td>
                <td style={{ padding: '10px 14px', textAlign: 'right' }}>${Number(b.avgOrderValue || 0).toLocaleString()}</td>
                <td style={{ padding: '10px 14px', textAlign: 'right', color: '#999' }}>${Number(b.segmentAvg || 0).toLocaleString()}</td>
                <td style={{ padding: '10px 14px', textAlign: 'right', color: '#e67e22' }}>${Number(b.upsellGap || 0).toLocaleString()}</td>
                <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 700, color: '#27ae60' }}>${Number(b.potentialRevenue || 0).toLocaleString()}</td>
                <td style={{ padding: '10px 14px', textAlign: 'right' }}>{Number(b.orderCount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h3 style={{ fontSize: 16, fontWeight: 600, margin: '24px 0 12px', color: '#1B4F72' }}>Cross-Sell Gaps</h3>
      <p style={{ fontSize: 13, color: '#666', marginBottom: 12 }}>Builders buying from 1-3 categories — opportunity to expand product mix</p>
      <div style={{ background: '#fff', borderRadius: 10, overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.07)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: '#f8f9fa' }}>
              <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600 }}>Builder</th>
              <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600 }}>Spend</th>
              <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600 }}>Categories</th>
              <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600 }}>Purchased Categories</th>
            </tr>
          </thead>
          <tbody>
            {(data.crossSell || []).map((b: any, i: number) => (
              <tr key={b.id} style={{ borderTop: '1px solid #eee', background: i % 2 ? '#fafafa' : '#fff' }}>
                <td style={{ padding: '10px 14px', fontWeight: 600 }}>{b.companyName}</td>
                <td style={{ padding: '10px 14px', textAlign: 'right' }}>${Number(b.totalSpend || 0).toLocaleString()}</td>
                <td style={{ padding: '10px 14px', textAlign: 'right' }}>{Number(b.categoryCount)}</td>
                <td style={{ padding: '10px 14px', fontSize: 12 }}>{(b.purchasedCategories || []).join(', ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function EngagementView({ data }: { data: any }) {
  const timeline = data.timeline || []
  const maxRev = Math.max(1, ...timeline.map((t: any) => Number(t.revenue || 0)))
  return (
    <div>
      <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16, color: '#1B4F72' }}>12-Month Engagement Timeline</h3>
      <div style={{ background: '#fff', borderRadius: 10, overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.07)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: '#f8f9fa' }}>
              <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600 }}>Month</th>
              <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600 }}>New Builders</th>
              <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600 }}>First Orders</th>
              <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600 }}>Total Orders</th>
              <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600 }}>Revenue</th>
              <th style={{ padding: '10px 14px', fontWeight: 600, width: 200 }}>Revenue Bar</th>
            </tr>
          </thead>
          <tbody>
            {timeline.map((t: any, i: number) => (
              <tr key={i} style={{ borderTop: '1px solid #eee', background: i % 2 ? '#fafafa' : '#fff' }}>
                <td style={{ padding: '10px 14px', fontWeight: 600 }}>{new Date(t.month).toLocaleDateString('en-US', { year: 'numeric', month: 'short' })}</td>
                <td style={{ padding: '10px 14px', textAlign: 'right' }}>{Number(t.newBuilders)}</td>
                <td style={{ padding: '10px 14px', textAlign: 'right' }}>{Number(t.firstOrders)}</td>
                <td style={{ padding: '10px 14px', textAlign: 'right' }}>{Number(t.totalOrders)}</td>
                <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600 }}>${Number(t.revenue || 0).toLocaleString()}</td>
                <td style={{ padding: '10px 14px' }}>
                  <div style={{ height: 16, background: '#f0f0f0', borderRadius: 4, overflow: 'hidden' }}>
                    <div style={{ width: `${(Number(t.revenue || 0) / maxRev) * 100}%`, height: '100%', background: '#1B4F72', borderRadius: 4 }} />
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
