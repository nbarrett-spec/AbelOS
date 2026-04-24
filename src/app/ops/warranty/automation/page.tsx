'use client'

import { useState, useEffect } from 'react'
import { ShieldCheck } from 'lucide-react'
import PageHeader from '@/components/ui/PageHeader'
import EmptyState from '@/components/ui/EmptyState'

const URGENCY_COLORS: Record<string, string> = { URGENT: '#e74c3c', SOON: '#C6A24E', UPCOMING: '#3498db' }
const STATUS_COLORS: Record<string, string> = { OPEN: '#3498db', IN_PROGRESS: '#C6A24E', RESOLVED: '#27ae60', DENIED: '#e74c3c', ACTIVE: '#27ae60', EXPIRED: '#95a5a6' }

function KPICard({ label, value, sub, color }: { label: string; value: string | number; sub?: string; color?: string }) {
  return (
    <div style={{ background: '#fff', borderRadius: 10, padding: '18px 22px', boxShadow: '0 1px 4px rgba(0,0,0,0.07)', borderLeft: `4px solid ${color || '#0f2a3e'}` }}>
      <div style={{ fontSize: 13, color: '#666', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 600, color: color || '#0f2a3e' }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: '#999', marginTop: 2 }}>{sub}</div>}
    </div>
  )
}

function Badge({ text, color }: { text: string; color: string }) {
  return <span style={{ display: 'inline-block', padding: '2px 10px', borderRadius: 12, fontSize: 11, fontWeight: 600, background: color + '22', color, border: `1px solid ${color}44` }}>{text}</span>
}

export default function WarrantyAutomationPage() {
  const [tab, setTab] = useState('dashboard')
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    fetch(`/api/ops/warranty/automation?report=${tab}`)
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [tab])

  const tabs = [
    { id: 'dashboard', label: 'Overview' },
    { id: 'expiring', label: 'Expiring' },
    { id: 'claim-patterns', label: 'Claim Patterns' },
    { id: 'cost-analysis', label: 'Cost Analysis' },
    { id: 'builder-warranties', label: 'By Builder' },
  ]

  return (
    <div style={{ padding: '24px 32px', maxWidth: 1400 }}>
      <PageHeader
        title="Warranty Automation"
        description="Automated warranty tracking, expiration alerts, claim analysis, and cost management"
      >
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {tabs.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              style={{ padding: '8px 18px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: tab === t.id ? 600 : 500, background: tab === t.id ? '#0f2a3e' : '#f0f0f0', color: tab === t.id ? '#fff' : '#444' }}>
              {t.label}
            </button>
          ))}
        </div>
      </PageHeader>

      {loading ? <div style={{ textAlign: 'center', padding: 60, color: '#999' }}>Loading warranty data...</div> : (
        <>
          {tab === 'dashboard' && data && <DashView data={data} />}
          {tab === 'expiring' && data && <ExpiringView data={data} />}
          {tab === 'claim-patterns' && data && <PatternsView data={data} />}
          {tab === 'cost-analysis' && data && <CostView data={data} />}
          {tab === 'builder-warranties' && data && <BuilderView data={data} />}
        </>
      )}
    </div>
  )
}

function DashView({ data }: { data: any }) {
  const o = data.overview || {}
  const c = data.claimStats || {}
  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16, marginBottom: 24 }}>
        <KPICard label="Active Warranties" value={Number(o.activeWarranties || 0)} color="#27ae60" />
        <KPICard label="Expiring (30d)" value={Number(o.expiring30d || 0)} color="#e74c3c" />
        <KPICard label="Expiring (90d)" value={Number(o.expiring90d || 0)} color="#C6A24E" />
        <KPICard label="Open Claims" value={Number(c.openClaims || 0)} color="#3498db" sub={`${c.inProgressClaims || 0} in progress`} />
        <KPICard label="Claims (30d)" value={Number(c.newThisMonth || 0)} color="#8e44ad" />
        <KPICard label="Total Resolved" value={Number(c.resolvedClaims || 0)} color="#27ae60" />
      </div>

      <h3 className="text-fg" style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>Recent Claims</h3>
      <div style={{ background: '#fff', borderRadius: 10, overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.07)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead><tr style={{ background: '#f8f9fa' }}>
            <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600 }}>Claim #</th>
            <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600 }}>Builder</th>
            <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600 }}>Status</th>
            <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600 }}>Description</th>
            <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600 }}>Date</th>
          </tr></thead>
          <tbody>
            {(data.recentClaims || []).map((c: any, i: number) => (
              <tr key={c.id} style={{ borderTop: '1px solid #eee', background: i % 2 ? '#fafafa' : '#fff' }}>
                <td style={{ padding: '10px 14px', fontWeight: 600 }}>{c.claimNumber}</td>
                <td style={{ padding: '10px 14px' }}>{c.companyName}</td>
                <td style={{ padding: '10px 14px' }}><Badge text={c.status} color={STATUS_COLORS[c.status] || '#999'} /></td>
                <td style={{ padding: '10px 14px', fontSize: 12, maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.description}</td>
                <td style={{ padding: '10px 14px', fontSize: 12 }}>{new Date(c.createdAt).toLocaleDateString()}</td>
              </tr>
            ))}
            {(data.recentClaims || []).length === 0 && <tr><td colSpan={5}><EmptyState icon={<ShieldCheck className="w-8 h-8 text-fg-subtle" />} title="No warranty claims yet" size="compact" /></td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function ExpiringView({ data }: { data: any }) {
  const s = data.summary || {}
  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 24 }}>
        <KPICard label="Urgent (30d)" value={s.urgent || 0} color="#e74c3c" />
        <KPICard label="Soon (60d)" value={s.soon || 0} color="#C6A24E" />
        <KPICard label="Upcoming (90d)" value={s.upcoming || 0} color="#3498db" />
      </div>

      <h3 className="text-fg" style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>Warranties Expiring Soon</h3>
      <div style={{ background: '#fff', borderRadius: 10, overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.07)', marginBottom: 24 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead><tr style={{ background: '#f8f9fa' }}>
            <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600 }}>Product</th>
            <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600 }}>Builder</th>
            <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600 }}>Urgency</th>
            <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600 }}>Days Left</th>
            <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600 }}>Expires</th>
            <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600 }}>Claims</th>
            <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600 }}>Contact</th>
          </tr></thead>
          <tbody>
            {(data.expiring || []).map((w: any, i: number) => (
              <tr key={w.id} style={{ borderTop: '1px solid #eee', background: w.urgency === 'URGENT' ? '#fdf2f2' : (i % 2 ? '#fafafa' : '#fff') }}>
                <td style={{ padding: '10px 14px', fontWeight: 600 }}>{w.productName}</td>
                <td style={{ padding: '10px 14px' }}>{w.companyName}</td>
                <td style={{ padding: '10px 14px' }}><Badge text={w.urgency} color={URGENCY_COLORS[w.urgency] || '#999'} /></td>
                <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 700, color: URGENCY_COLORS[w.urgency] }}>{w.daysRemaining}</td>
                <td style={{ padding: '10px 14px', fontSize: 12 }}>{new Date(w.endDate).toLocaleDateString()}</td>
                <td style={{ padding: '10px 14px', textAlign: 'right' }}>{Number(w.claimCount)}</td>
                <td style={{ padding: '10px 14px', fontSize: 12 }}>{w.email}</td>
              </tr>
            ))}
            {(data.expiring || []).length === 0 && <tr><td colSpan={7}><EmptyState icon={<ShieldCheck className="w-8 h-8 text-fg-subtle" />} title="Nothing expiring soon" description="No warranties expiring in the next 90 days." size="compact" /></td></tr>}
          </tbody>
        </table>
      </div>

      {(data.recentlyExpired || []).length > 0 && (
        <>
          <h3 className="text-signal" style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>Recently Expired — Extended Warranty Opportunity</h3>
          <div style={{ background: '#fff', borderRadius: 10, overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.07)' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead><tr style={{ background: '#f8f9fa' }}>
                <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600 }}>Product</th>
                <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600 }}>Builder</th>
                <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600 }}>Days Since Expired</th>
                <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600 }}>Contact</th>
              </tr></thead>
              <tbody>
                {(data.recentlyExpired || []).map((w: any, i: number) => (
                  <tr key={w.id} style={{ borderTop: '1px solid #eee' }}>
                    <td style={{ padding: '10px 14px', fontWeight: 600 }}>{w.productName}</td>
                    <td style={{ padding: '10px 14px' }}>{w.companyName}</td>
                    <td style={{ padding: '10px 14px', textAlign: 'right' }}>{w.daysSinceExpired}</td>
                    <td style={{ padding: '10px 14px', fontSize: 12 }}>{w.email} / {w.phone}</td>
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

function PatternsView({ data }: { data: any }) {
  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 24 }}>
        <div>
          <h3 className="text-fg" style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>Claims by Category</h3>
          <div style={{ background: '#fff', borderRadius: 10, overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.07)' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead><tr style={{ background: '#f8f9fa' }}>
                <th style={{ padding: '8px 14px', textAlign: 'left', fontWeight: 600 }}>Category</th>
                <th style={{ padding: '8px 14px', textAlign: 'right', fontWeight: 600 }}>Claims</th>
                <th style={{ padding: '8px 14px', textAlign: 'right', fontWeight: 600 }}>Resolved</th>
                <th style={{ padding: '8px 14px', textAlign: 'right', fontWeight: 600 }}>Denied</th>
              </tr></thead>
              <tbody>
                {(data.byCategory || []).map((c: any, i: number) => (
                  <tr key={i} style={{ borderTop: '1px solid #eee' }}>
                    <td style={{ padding: '8px 14px', fontWeight: 600 }}>{c.category}</td>
                    <td style={{ padding: '8px 14px', textAlign: 'right', fontWeight: 700 }}>{Number(c.claimCount)}</td>
                    <td style={{ padding: '8px 14px', textAlign: 'right', color: '#27ae60' }}>{Number(c.resolved)}</td>
                    <td style={{ padding: '8px 14px', textAlign: 'right', color: '#e74c3c' }}>{Number(c.denied)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div>
          <h3 className="text-fg" style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>Repeat Claimers</h3>
          <div style={{ background: '#fff', borderRadius: 10, overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.07)' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead><tr style={{ background: '#f8f9fa' }}>
                <th style={{ padding: '8px 14px', textAlign: 'left', fontWeight: 600 }}>Builder</th>
                <th style={{ padding: '8px 14px', textAlign: 'right', fontWeight: 600 }}>Claims</th>
                <th style={{ padding: '8px 14px', textAlign: 'right', fontWeight: 600 }}>Active</th>
              </tr></thead>
              <tbody>
                {(data.byBuilder || []).map((b: any, i: number) => (
                  <tr key={i} style={{ borderTop: '1px solid #eee' }}>
                    <td style={{ padding: '8px 14px', fontWeight: 600 }}>{b.companyName}</td>
                    <td style={{ padding: '8px 14px', textAlign: 'right', fontWeight: 700, color: '#e74c3c' }}>{Number(b.claimCount)}</td>
                    <td style={{ padding: '8px 14px', textAlign: 'right' }}>{Number(b.activeClaims)}</td>
                  </tr>
                ))}
                {(data.byBuilder || []).length === 0 && <tr><td colSpan={3}><EmptyState icon={<ShieldCheck className="w-8 h-8 text-fg-subtle" />} title="No repeat claimers" size="compact" /></td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {(data.monthly || []).length > 0 && (
        <>
          <h3 className="text-fg" style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>Monthly Claim Volume</h3>
          <div style={{ background: '#fff', borderRadius: 10, overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.07)' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead><tr style={{ background: '#f8f9fa' }}>
                <th style={{ padding: '8px 14px', textAlign: 'left', fontWeight: 600 }}>Month</th>
                <th style={{ padding: '8px 14px', textAlign: 'right', fontWeight: 600 }}>Claims</th>
                <th style={{ padding: '8px 14px', textAlign: 'right', fontWeight: 600 }}>Resolved</th>
                <th style={{ padding: '8px 14px', textAlign: 'right', fontWeight: 600 }}>Denied</th>
              </tr></thead>
              <tbody>
                {(data.monthly || []).map((m: any, i: number) => (
                  <tr key={i} style={{ borderTop: '1px solid #eee' }}>
                    <td style={{ padding: '8px 14px', fontWeight: 600 }}>{new Date(m.month).toLocaleDateString('en-US', { year: 'numeric', month: 'short' })}</td>
                    <td style={{ padding: '8px 14px', textAlign: 'right', fontWeight: 700 }}>{Number(m.claims)}</td>
                    <td style={{ padding: '8px 14px', textAlign: 'right', color: '#27ae60' }}>{Number(m.resolved)}</td>
                    <td style={{ padding: '8px 14px', textAlign: 'right', color: '#e74c3c' }}>{Number(m.denied)}</td>
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

function CostView({ data }: { data: any }) {
  const l = data.liability || {}
  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16, marginBottom: 24 }}>
        <KPICard label="Total Replacement Cost" value={`$${Number(data.totalReplacementCost || 0).toLocaleString()}`} color="#e74c3c" />
        <KPICard label="Active Warranties" value={Number(l.activeWarranties || 0)} color="#27ae60" />
        <KPICard label="Est. Liability" value={`$${Number(l.estimatedLiability || 0).toLocaleString()}`} color="#8e44ad" sub="Based on claim rate" />
      </div>

      <div style={{ background: '#fff', borderRadius: 10, overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.07)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead><tr style={{ background: '#f8f9fa' }}>
            <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600 }}>Category</th>
            <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600 }}>Total Claims</th>
            <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600 }}>Resolved</th>
            <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600 }}>Est. Replacement Cost</th>
            <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600 }}>Avg Claim Cost</th>
          </tr></thead>
          <tbody>
            {(data.costByCategory || []).map((c: any, i: number) => (
              <tr key={i} style={{ borderTop: '1px solid #eee', background: i % 2 ? '#fafafa' : '#fff' }}>
                <td style={{ padding: '10px 14px', fontWeight: 600 }}>{c.category}</td>
                <td style={{ padding: '10px 14px', textAlign: 'right' }}>{Number(c.totalClaims)}</td>
                <td style={{ padding: '10px 14px', textAlign: 'right' }}>{Number(c.resolvedClaims)}</td>
                <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 700, color: '#e74c3c' }}>${Number(c.estimatedReplacementCost || 0).toLocaleString()}</td>
                <td style={{ padding: '10px 14px', textAlign: 'right' }}>${Number(c.avgClaimCost || 0).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function BuilderView({ data }: { data: any }) {
  return (
    <div>
      <div style={{ background: '#fff', borderRadius: 10, overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.07)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead><tr style={{ background: '#f8f9fa' }}>
            <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600 }}>Builder</th>
            <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600 }}>Warranties</th>
            <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600 }}>Active</th>
            <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600 }}>Expired</th>
            <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600 }}>Expiring Soon</th>
            <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600 }}>Claims</th>
            <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600 }}>Latest Expiry</th>
          </tr></thead>
          <tbody>
            {(data.builders || []).map((b: any, i: number) => (
              <tr key={b.id} style={{ borderTop: '1px solid #eee', background: i % 2 ? '#fafafa' : '#fff' }}>
                <td style={{ padding: '10px 14px' }}>
                  <div style={{ fontWeight: 600 }}>{b.companyName}</div>
                  <div style={{ fontSize: 11, color: '#999' }}>{b.email}</div>
                </td>
                <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 700 }}>{Number(b.warrantyCount)}</td>
                <td style={{ padding: '10px 14px', textAlign: 'right', color: '#27ae60' }}>{Number(b.activeCount)}</td>
                <td style={{ padding: '10px 14px', textAlign: 'right', color: '#95a5a6' }}>{Number(b.expiredCount)}</td>
                <td style={{ padding: '10px 14px', textAlign: 'right', color: Number(b.expiringSoon) > 0 ? '#C6A24E' : '#333', fontWeight: Number(b.expiringSoon) > 0 ? 700 : 400 }}>{Number(b.expiringSoon)}</td>
                <td style={{ padding: '10px 14px', textAlign: 'right' }}>{Number(b.totalClaims)}</td>
                <td style={{ padding: '10px 14px', fontSize: 12 }}>{b.latestExpiry ? new Date(b.latestExpiry).toLocaleDateString() : '—'}</td>
              </tr>
            ))}
            {(data.builders || []).length === 0 && <tr><td colSpan={7}><EmptyState icon={<ShieldCheck className="w-8 h-8 text-fg-subtle" />} title="No warranty records" description="Use Auto-Generate to create warranties from delivered orders." size="compact" /></td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  )
}
