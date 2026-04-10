'use client'

import { useState, useEffect } from 'react'

const HEALTH_COLORS: Record<string, string> = { THRIVING: '#27ae60', HEALTHY: '#2ecc71', AT_RISK: '#e67e22', CRITICAL: '#e74c3c', DORMANT: '#95a5a6', NEW: '#3498db' }

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
  return <span style={{ display: 'inline-block', padding: '2px 10px', borderRadius: 12, fontSize: 11, fontWeight: 600, background: color + '22', color, border: `1px solid ${color}44` }}>{text}</span>
}

function ScoreBar({ score, max = 100 }: { score: number; max?: number }) {
  const pct = Math.min(100, (score / max) * 100)
  const color = pct >= 75 ? '#27ae60' : pct >= 50 ? '#2ecc71' : pct >= 25 ? '#e67e22' : '#e74c3c'
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{ flex: 1, height: 8, background: '#f0f0f0', borderRadius: 4, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 4 }} />
      </div>
      <span style={{ fontSize: 12, fontWeight: 600, color, minWidth: 28 }}>{score}</span>
    </div>
  )
}

export default function BuilderIntelPage() {
  const [tab, setTab] = useState('overview')
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [selectedBuilder, setSelectedBuilder] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    const params = new URLSearchParams({ report: tab })
    if (selectedBuilder && (tab === 'profile' || tab === 'purchase-dna')) params.set('builderId', selectedBuilder)
    fetch(`/api/ops/portal/builder-intel?${params}`)
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [tab, selectedBuilder])

  const tabs = [
    { id: 'overview', label: 'Overview' },
    { id: 'relationship-health', label: 'Relationship Health' },
    { id: 'profitability', label: 'Profitability' },
    { id: 'product-affinity', label: 'Product Affinity' },
    { id: 'profile', label: 'Builder Profile' },
  ]

  return (
    <div style={{ padding: '24px 32px', maxWidth: 1400 }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, color: '#1B4F72', marginBottom: 4 }}>Builder Intelligence Portal</h1>
      <p style={{ color: '#666', fontSize: 14, marginBottom: 20 }}>360° builder insights: purchase DNA, profitability, relationship health, and product affinity</p>

      <div style={{ display: 'flex', gap: 4, marginBottom: 24, flexWrap: 'wrap' }}>
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            style={{ padding: '8px 18px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: tab === t.id ? 700 : 500, background: tab === t.id ? '#1B4F72' : '#f0f0f0', color: tab === t.id ? '#fff' : '#444' }}>
            {t.label}
          </button>
        ))}
      </div>

      {loading ? <div style={{ textAlign: 'center', padding: 60, color: '#999' }}>Analyzing builder data...</div> : (
        <>
          {tab === 'overview' && data && <OverviewView data={data} onSelectBuilder={(id: string) => { setSelectedBuilder(id); setTab('profile') }} />}
          {tab === 'relationship-health' && data && <HealthView data={data} onSelectBuilder={(id: string) => { setSelectedBuilder(id); setTab('profile') }} />}
          {tab === 'profitability' && data && <ProfitView data={data} />}
          {tab === 'product-affinity' && data && <AffinityView data={data} />}
          {tab === 'profile' && data && <ProfileView data={data} builderId={selectedBuilder} onSelectBuilder={setSelectedBuilder} />}
        </>
      )}
    </div>
  )
}

function OverviewView({ data, onSelectBuilder }: { data: any; onSelectBuilder: (id: string) => void }) {
  return (
    <div>
      <KPICard label="Total Active Revenue" value={`$${Number(data.totalRevenue || 0).toLocaleString()}`} color="#1B4F72" />

      <h3 style={{ fontSize: 16, fontWeight: 600, margin: '20px 0 12px', color: '#1B4F72' }}>Revenue Concentration</h3>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginBottom: 24 }}>
        {(data.revenueConcentration || []).map((r: any) => (
          <div key={r.tier} style={{ background: '#fff', borderRadius: 10, padding: 16, boxShadow: '0 1px 4px rgba(0,0,0,0.07)' }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#1B4F72' }}>{r.tier}</div>
            <div style={{ fontSize: 20, fontWeight: 700, marginTop: 4 }}>{Number(r.builderCount)} builders</div>
            <div style={{ fontSize: 13, color: '#666' }}>${Number(r.tierRevenue || 0).toLocaleString()} ({r.pctOfTotal}%)</div>
          </div>
        ))}
      </div>

      <h3 style={{ fontSize: 16, fontWeight: 600, margin: '20px 0 12px', color: '#1B4F72' }}>Account Health Distribution</h3>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 24 }}>
        {(data.healthDistribution || []).map((h: any) => (
          <div key={h.health} style={{ background: '#fff', borderRadius: 8, padding: 14, textAlign: 'center', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', borderTop: `3px solid ${HEALTH_COLORS[h.health] || '#999'}` }}>
            <div style={{ fontSize: 22, fontWeight: 700, color: HEALTH_COLORS[h.health] || '#999' }}>{Number(h.count)}</div>
            <div style={{ fontSize: 12, color: '#666' }}>{h.health?.replace('_', ' ')}</div>
            <div style={{ fontSize: 11, color: '#999' }}>${Number(h.revenue || 0).toLocaleString()}</div>
          </div>
        ))}
      </div>

      <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12, color: '#1B4F72' }}>Top Builders by Revenue</h3>
      <div style={{ background: '#fff', borderRadius: 10, overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.07)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead><tr style={{ background: '#f8f9fa' }}>
            <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600 }}>Builder</th>
            <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600 }}>Revenue</th>
            <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600 }}>Orders</th>
            <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600 }}>Avg Order</th>
            <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600 }}>Tenure</th>
            <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600 }}>Last Order</th>
          </tr></thead>
          <tbody>
            {(data.topByRevenue || []).map((b: any, i: number) => (
              <tr key={b.id} onClick={() => onSelectBuilder(b.id)} style={{ borderTop: '1px solid #eee', background: i % 2 ? '#fafafa' : '#fff', cursor: 'pointer' }}>
                <td style={{ padding: '10px 14px' }}>
                  <div style={{ fontWeight: 600, color: '#1B4F72' }}>{b.companyName}</div>
                  <div style={{ fontSize: 11, color: '#999' }}>{b.contactName}</div>
                </td>
                <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 700 }}>${Number(b.totalRevenue || 0).toLocaleString()}</td>
                <td style={{ padding: '10px 14px', textAlign: 'right' }}>{Number(b.orderCount)}</td>
                <td style={{ padding: '10px 14px', textAlign: 'right' }}>${Number(b.avgOrder || 0).toLocaleString()}</td>
                <td style={{ padding: '10px 14px', textAlign: 'right' }}>{b.tenure}mo</td>
                <td style={{ padding: '10px 14px', fontSize: 12 }}>{b.lastOrder ? new Date(b.lastOrder).toLocaleDateString() : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function HealthView({ data, onSelectBuilder }: { data: any; onSelectBuilder: (id: string) => void }) {
  const s = data.summary || {}
  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 24 }}>
        <KPICard label="Thriving" value={s.thriving || 0} color="#27ae60" />
        <KPICard label="Healthy" value={s.healthy || 0} color="#2ecc71" />
        <KPICard label="At Risk" value={s.atRisk || 0} color="#e67e22" />
        <KPICard label="Critical" value={s.critical || 0} color="#e74c3c" />
      </div>
      <div style={{ background: '#fff', borderRadius: 10, overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.07)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead><tr style={{ background: '#f8f9fa' }}>
            <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600 }}>Builder</th>
            <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600 }}>Grade</th>
            <th style={{ padding: '10px 14px', fontWeight: 600, width: 140 }}>Score</th>
            <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600 }}>Revenue</th>
            <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600 }}>Orders</th>
            <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600 }}>Tenure</th>
            <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600 }}>Last Order</th>
          </tr></thead>
          <tbody>
            {(data.builders || []).slice(0, 50).map((b: any, i: number) => (
              <tr key={b.id} onClick={() => onSelectBuilder(b.id)} style={{ borderTop: '1px solid #eee', cursor: 'pointer', background: b.healthGrade === 'CRITICAL' ? '#fdf2f2' : (i % 2 ? '#fafafa' : '#fff') }}>
                <td style={{ padding: '10px 14px' }}>
                  <div style={{ fontWeight: 600 }}>{b.companyName}</div>
                  <div style={{ fontSize: 11, color: '#999' }}>{b.email}</div>
                </td>
                <td style={{ padding: '10px 14px' }}><Badge text={b.healthGrade?.replace('_', ' ')} color={HEALTH_COLORS[b.healthGrade] || '#999'} /></td>
                <td style={{ padding: '10px 14px' }}><ScoreBar score={Number(b.healthScore)} /></td>
                <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600 }}>${Number(b.totalSpend || 0).toLocaleString()}</td>
                <td style={{ padding: '10px 14px', textAlign: 'right' }}>{Number(b.orderCount)}</td>
                <td style={{ padding: '10px 14px', textAlign: 'right' }}>{b.tenureMonths}mo</td>
                <td style={{ padding: '10px 14px', fontSize: 12 }}>{b.lastOrder ? new Date(b.lastOrder).toLocaleDateString() : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function ProfitView({ data }: { data: any }) {
  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 24 }}>
        <KPICard label="Total Est. Margin" value={`$${Number(data.totalEstimatedMargin || 0).toLocaleString()}`} color="#27ae60" />
        <KPICard label="Avg Margin/Builder" value={`$${Number(data.avgMarginPerBuilder || 0).toLocaleString()}`} color="#1B4F72" />
      </div>
      <div style={{ background: '#fff', borderRadius: 10, overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.07)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead><tr style={{ background: '#f8f9fa' }}>
            <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600 }}>Builder</th>
            <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600 }}>Revenue</th>
            <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600 }}>Est. Margin</th>
            <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600 }}>Margin %</th>
            <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600 }}>Orders</th>
            <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600 }}>Cost to Serve</th>
            <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600 }}>Credit Util %</th>
          </tr></thead>
          <tbody>
            {(data.builders || []).slice(0, 40).map((b: any, i: number) => (
              <tr key={b.id} style={{ borderTop: '1px solid #eee', background: i % 2 ? '#fafafa' : '#fff' }}>
                <td style={{ padding: '10px 14px' }}>
                  <div style={{ fontWeight: 600 }}>{b.companyName}</div>
                  <div style={{ fontSize: 11, color: '#999' }}>{b.contactName}</div>
                </td>
                <td style={{ padding: '10px 14px', textAlign: 'right' }}>${Number(b.totalRevenue || 0).toLocaleString()}</td>
                <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 700, color: '#27ae60' }}>${Number(b.estimatedMargin || 0).toLocaleString()}</td>
                <td style={{ padding: '10px 14px', textAlign: 'right' }}>{b.marginPct}%</td>
                <td style={{ padding: '10px 14px', textAlign: 'right' }}>{Number(b.orderCount)}</td>
                <td style={{ padding: '10px 14px' }}>
                  <Badge text={b.costToServe} color={b.costToServe === 'LOW' ? '#27ae60' : b.costToServe === 'HIGH' ? '#e74c3c' : '#e67e22'} />
                </td>
                <td style={{ padding: '10px 14px', textAlign: 'right', color: Number(b.creditUtilization) > 80 ? '#e74c3c' : '#333' }}>{b.creditUtilization}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function AffinityView({ data }: { data: any }) {
  return (
    <div>
      <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12, color: '#1B4F72' }}>Category Co-Purchase Patterns</h3>
      <p style={{ fontSize: 13, color: '#666', marginBottom: 12 }}>Categories frequently bought together in the same order</p>
      <div style={{ background: '#fff', borderRadius: 10, overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.07)', marginBottom: 24 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead><tr style={{ background: '#f8f9fa' }}>
            <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600 }}>Category 1</th>
            <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600 }}>Category 2</th>
            <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600 }}>Co-Occurrences</th>
          </tr></thead>
          <tbody>
            {(data.categoryPairs || []).map((p: any, i: number) => (
              <tr key={i} style={{ borderTop: '1px solid #eee', background: i % 2 ? '#fafafa' : '#fff' }}>
                <td style={{ padding: '10px 14px', fontWeight: 600 }}>{p.category1}</td>
                <td style={{ padding: '10px 14px', fontWeight: 600 }}>{p.category2}</td>
                <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 700, color: '#8e44ad' }}>{Number(p.coOccurrences)}</td>
              </tr>
            ))}
            {(data.categoryPairs || []).length === 0 && <tr><td colSpan={3} style={{ padding: 30, textAlign: 'center', color: '#999' }}>Not enough data for category affinity analysis yet.</td></tr>}
          </tbody>
        </table>
      </div>

      <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12, color: '#1B4F72' }}>Product Pair Affinity</h3>
      <p style={{ fontSize: 13, color: '#666', marginBottom: 12 }}>Specific products frequently ordered together</p>
      <div style={{ background: '#fff', borderRadius: 10, overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.07)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead><tr style={{ background: '#f8f9fa' }}>
            <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600 }}>Product 1</th>
            <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600 }}>Product 2</th>
            <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600 }}>Orders Together</th>
          </tr></thead>
          <tbody>
            {(data.productPairs || []).map((p: any, i: number) => (
              <tr key={i} style={{ borderTop: '1px solid #eee', background: i % 2 ? '#fafafa' : '#fff' }}>
                <td style={{ padding: '10px 14px' }}>
                  <div style={{ fontWeight: 600 }}>{p.product1}</div>
                  <div style={{ fontSize: 11, color: '#999' }}>{p.category1}</div>
                </td>
                <td style={{ padding: '10px 14px' }}>
                  <div style={{ fontWeight: 600 }}>{p.product2}</div>
                  <div style={{ fontSize: 11, color: '#999' }}>{p.category2}</div>
                </td>
                <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 700, color: '#8e44ad' }}>{Number(p.coOccurrences)}</td>
              </tr>
            ))}
            {(data.productPairs || []).length === 0 && <tr><td colSpan={3} style={{ padding: 30, textAlign: 'center', color: '#999' }}>Not enough data for product affinity analysis yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function ProfileView({ data, builderId, onSelectBuilder }: { data: any; builderId: string | null; onSelectBuilder: (id: string) => void }) {
  if (!builderId || data.error) {
    return <div style={{ textAlign: 'center', padding: 40, color: '#999' }}>Select a builder from the Overview or Relationship Health tab to view their full profile.</div>
  }

  const b = data.builder || {}
  const os = data.orderSummary || {}
  const qs = data.quoteSummary || {}

  return (
    <div>
      <div style={{ background: '#fff', borderRadius: 12, padding: 24, boxShadow: '0 1px 4px rgba(0,0,0,0.07)', marginBottom: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 22, color: '#1B4F72' }}>{b.companyName}</h2>
            <div style={{ fontSize: 14, color: '#666', marginTop: 4 }}>{b.contactName} — {b.email} — {b.phone}</div>
            <div style={{ fontSize: 13, color: '#999', marginTop: 2 }}>{[b.address, b.city, b.state, b.zip].filter(Boolean).join(', ')}</div>
          </div>
          <Badge text={b.status} color={b.status === 'ACTIVE' ? '#27ae60' : '#e74c3c'} />
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16, marginBottom: 24 }}>
        <KPICard label="Total Revenue" value={`$${Number(os.totalSpend || 0).toLocaleString()}`} color="#1B4F72" />
        <KPICard label="Orders" value={Number(os.totalOrders || 0)} sub={`Avg: $${Number(os.avgOrderValue || 0).toLocaleString()}`} />
        <KPICard label="Outstanding" value={`$${Number(os.outstandingBalance || 0).toLocaleString()}`} color={Number(os.overdueOrders) > 0 ? '#e74c3c' : '#27ae60'} sub={`${os.overdueOrders || 0} overdue`} />
        <KPICard label="Quotes" value={Number(qs.totalQuotes || 0)} sub={`${qs.accepted || 0} accepted, ${qs.pending || 0} pending`} color="#8e44ad" />
        <KPICard label="Credit Limit" value={b.creditLimit ? `$${Number(b.creditLimit).toLocaleString()}` : 'N/A'} color="#3498db" sub={`Balance: $${Number(b.accountBalance || 0).toLocaleString()}`} />
        <KPICard label="Largest Order" value={`$${Number(os.largestOrder || 0).toLocaleString()}`} color="#E67E22" />
      </div>

      {(data.topProducts || []).length > 0 && (
        <>
          <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12, color: '#1B4F72' }}>Top Products Purchased</h3>
          <div style={{ background: '#fff', borderRadius: 10, overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.07)', marginBottom: 24 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead><tr style={{ background: '#f8f9fa' }}>
                <th style={{ padding: '8px 14px', textAlign: 'left', fontWeight: 600 }}>Product</th>
                <th style={{ padding: '8px 14px', textAlign: 'left', fontWeight: 600 }}>Category</th>
                <th style={{ padding: '8px 14px', textAlign: 'right', fontWeight: 600 }}>Qty</th>
                <th style={{ padding: '8px 14px', textAlign: 'right', fontWeight: 600 }}>Spend</th>
                <th style={{ padding: '8px 14px', textAlign: 'right', fontWeight: 600 }}>Orders</th>
              </tr></thead>
              <tbody>
                {(data.topProducts || []).map((p: any, i: number) => (
                  <tr key={p.id} style={{ borderTop: '1px solid #eee', background: i % 2 ? '#fafafa' : '#fff' }}>
                    <td style={{ padding: '8px 14px', fontWeight: 600 }}>{p.name}<br/><span style={{ fontSize: 11, color: '#999' }}>{p.sku}</span></td>
                    <td style={{ padding: '8px 14px', fontSize: 12 }}>{p.category}</td>
                    <td style={{ padding: '8px 14px', textAlign: 'right' }}>{Number(p.totalQty)}</td>
                    <td style={{ padding: '8px 14px', textAlign: 'right', fontWeight: 600 }}>${Number(p.totalSpend || 0).toLocaleString()}</td>
                    <td style={{ padding: '8px 14px', textAlign: 'right' }}>{Number(p.orderCount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {(data.spendTrend || []).length > 0 && (
        <>
          <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12, color: '#1B4F72' }}>Monthly Spend Trend</h3>
          <div style={{ background: '#fff', borderRadius: 10, overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.07)', marginBottom: 24 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead><tr style={{ background: '#f8f9fa' }}>
                <th style={{ padding: '8px 14px', textAlign: 'left', fontWeight: 600 }}>Month</th>
                <th style={{ padding: '8px 14px', textAlign: 'right', fontWeight: 600 }}>Revenue</th>
                <th style={{ padding: '8px 14px', textAlign: 'right', fontWeight: 600 }}>Orders</th>
                <th style={{ padding: '8px 14px', fontWeight: 600, width: 200 }}></th>
              </tr></thead>
              <tbody>
                {(() => { const maxR = Math.max(1, ...(data.spendTrend || []).map((t: any) => Number(t.revenue || 0))); return (data.spendTrend || []).map((t: any, i: number) => (
                  <tr key={i} style={{ borderTop: '1px solid #eee' }}>
                    <td style={{ padding: '8px 14px', fontWeight: 600 }}>{new Date(t.month).toLocaleDateString('en-US', { year: 'numeric', month: 'short' })}</td>
                    <td style={{ padding: '8px 14px', textAlign: 'right', fontWeight: 600 }}>${Number(t.revenue || 0).toLocaleString()}</td>
                    <td style={{ padding: '8px 14px', textAlign: 'right' }}>{Number(t.orders)}</td>
                    <td style={{ padding: '8px 14px' }}>
                      <div style={{ height: 14, background: '#f0f0f0', borderRadius: 4, overflow: 'hidden' }}>
                        <div style={{ width: `${(Number(t.revenue || 0) / maxR) * 100}%`, height: '100%', background: '#1B4F72', borderRadius: 4 }} />
                      </div>
                    </td>
                  </tr>
                )) })()}
              </tbody>
            </table>
          </div>
        </>
      )}

      {(data.customPricing || []).length > 0 && (
        <>
          <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12, color: '#1B4F72' }}>Custom Pricing</h3>
          <div style={{ background: '#fff', borderRadius: 10, overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.07)' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead><tr style={{ background: '#f8f9fa' }}>
                <th style={{ padding: '8px 14px', textAlign: 'left', fontWeight: 600 }}>Product</th>
                <th style={{ padding: '8px 14px', textAlign: 'right', fontWeight: 600 }}>Base Price</th>
                <th style={{ padding: '8px 14px', textAlign: 'right', fontWeight: 600 }}>Custom Price</th>
                <th style={{ padding: '8px 14px', textAlign: 'right', fontWeight: 600 }}>Margin</th>
              </tr></thead>
              <tbody>
                {(data.customPricing || []).map((p: any, i: number) => (
                  <tr key={p.id} style={{ borderTop: '1px solid #eee' }}>
                    <td style={{ padding: '8px 14px', fontWeight: 600 }}>{p.name}<br/><span style={{ fontSize: 11, color: '#999' }}>{p.sku}</span></td>
                    <td style={{ padding: '8px 14px', textAlign: 'right' }}>${Number(p.basePrice || 0).toFixed(2)}</td>
                    <td style={{ padding: '8px 14px', textAlign: 'right', fontWeight: 600, color: '#E67E22' }}>${Number(p.customPrice || 0).toFixed(2)}</td>
                    <td style={{ padding: '8px 14px', textAlign: 'right' }}>{p.margin ? `${(Number(p.margin) * 100).toFixed(0)}%` : '—'}</td>
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
