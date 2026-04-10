'use client'

import { useEffect, useState } from 'react'

const NAVY = '#1B4F72'
const ORANGE = '#E67E22'

interface BuilderHealth {
  builderId: string
  companyName: string
  contactName: string
  healthScore: number
  orderTrend: string
  paymentTrend: string
  totalLifetimeValue: number
  avgOrderValue: number
  daysSinceLastOrder: number
  creditRiskScore: number
  crossSellScore: number
  onTimePaymentRate: number
  orderFrequencyDays: number
}

export default function BuilderHealthPage() {
  const [builders, setBuilders] = useState<BuilderHealth[]>([])
  const [summary, setSummary] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [segment, setSegment] = useState<string>('all')
  const [sortBy, setSortBy] = useState<string>('healthScore')

  useEffect(() => { loadData() }, [segment, sortBy])

  const loadData = async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (segment !== 'all') params.append('segment', segment)
      params.append('sortBy', sortBy)
      params.append('limit', '100')

      const res = await fetch(`/api/agent-hub/intelligence/builders?${params}`)
      if (res.ok) {
        const data = await res.json()
        setBuilders(data.data || [])
        setSummary(data.segments || null)
      }
    } catch (err) { console.error(err) }
    finally { setLoading(false) }
  }

  const healthColor = (score: number) => {
    if (score >= 80) return '#27ae60'
    if (score >= 60) return '#2ecc71'
    if (score >= 40) return ORANGE
    if (score >= 20) return '#e74c3c'
    return '#c0392b'
  }

  const trendIcon = (trend: string) => {
    switch (trend) {
      case 'GROWING': return '↗'
      case 'STABLE': return '→'
      case 'DECLINING': return '↘'
      case 'CHURNING': return '↓'
      case 'IMPROVING': return '↗'
      default: return '—'
    }
  }

  const trendColor = (trend: string) => {
    switch (trend) {
      case 'GROWING': case 'IMPROVING': return '#27ae60'
      case 'STABLE': return '#666'
      case 'DECLINING': return ORANGE
      case 'CHURNING': return '#c0392b'
      default: return '#999'
    }
  }

  // Distribution for heat map
  const distribution = {
    excellent: builders.filter(b => b.healthScore >= 80).length,
    good: builders.filter(b => b.healthScore >= 60 && b.healthScore < 80).length,
    fair: builders.filter(b => b.healthScore >= 40 && b.healthScore < 60).length,
    poor: builders.filter(b => b.healthScore >= 20 && b.healthScore < 40).length,
    critical: builders.filter(b => b.healthScore < 20).length,
  }

  const totalLTV = builders.reduce((s, b) => s + (b.totalLifetimeValue || 0), 0)
  const avgHealth = builders.length > 0
    ? Math.round(builders.reduce((s, b) => s + b.healthScore, 0) / builders.length)
    : 0

  return (
    <div style={{ padding: 0, minHeight: '100vh', backgroundColor: '#f5f5f5' }}>
      <div style={{ backgroundColor: NAVY, color: 'white', padding: '30px 40px', marginBottom: '20px' }}>
        <h1 style={{ fontSize: '28px', fontWeight: 'bold', margin: '0 0 8px 0' }}>Builder Health Dashboard</h1>
        <p style={{ fontSize: '14px', color: '#ccc', margin: 0 }}>
          Relationship health scores, churn risk, expansion opportunities, and revenue concentration
        </p>
      </div>

      {/* Top Summary */}
      <div style={{ padding: '0 40px 20px', display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '12px' }}>
        {[
          { label: 'Total Builders', value: builders.length, color: NAVY },
          { label: 'Avg Health Score', value: `${avgHealth}/100`, color: healthColor(avgHealth) },
          { label: 'Total LTV', value: `$${Math.round(totalLTV).toLocaleString()}`, color: NAVY },
          { label: 'At Risk', value: (summary?.['at-risk'] || distribution.poor + distribution.critical), color: '#c0392b' },
          { label: 'Expansion Ready', value: summary?.['expansion-ready'] || 0, color: '#27ae60' },
        ].map((c, i) => (
          <div key={i} style={{ backgroundColor: 'white', border: '1px solid #ddd', borderRadius: '4px', padding: '15px' }}>
            <div style={{ fontSize: '11px', color: '#666', textTransform: 'uppercase', marginBottom: '6px' }}>{c.label}</div>
            <div style={{ fontSize: '22px', fontWeight: 'bold', color: c.color }}>{c.value}</div>
          </div>
        ))}
      </div>

      {/* Health Distribution Bar */}
      <div style={{ padding: '0 40px 20px' }}>
        <div style={{ backgroundColor: 'white', border: '1px solid #ddd', borderRadius: '4px', padding: '20px' }}>
          <h3 style={{ fontSize: '14px', fontWeight: '600', color: NAVY, margin: '0 0 12px' }}>Health Score Distribution</h3>
          <div style={{ display: 'flex', height: '30px', borderRadius: '4px', overflow: 'hidden' }}>
            {builders.length > 0 && [
              { count: distribution.excellent, color: '#27ae60', label: '80-100' },
              { count: distribution.good, color: '#2ecc71', label: '60-79' },
              { count: distribution.fair, color: ORANGE, label: '40-59' },
              { count: distribution.poor, color: '#e74c3c', label: '20-39' },
              { count: distribution.critical, color: '#c0392b', label: '0-19' },
            ].filter(s => s.count > 0).map((s, i) => (
              <div key={i} style={{
                width: `${(s.count / builders.length) * 100}%`, backgroundColor: s.color,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: 'white', fontSize: '11px', fontWeight: '600',
              }}>
                {s.count > 0 && `${s.count}`}
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '6px', fontSize: '11px', color: '#666' }}>
            <span>Excellent (80+)</span><span>Good (60-79)</span><span>Fair (40-59)</span><span>Poor (20-39)</span><span>Critical (&lt;20)</span>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div style={{ padding: '0 40px 15px', display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ fontSize: '13px', color: '#666', marginRight: '8px' }}>Segment:</span>
        {['all', 'high-value', 'at-risk', 'expansion-ready', 'churning', 'new', 'credit-risk'].map(s => (
          <button key={s} onClick={() => setSegment(s)} style={{
            padding: '6px 14px', borderRadius: '4px', border: '1px solid #ddd',
            backgroundColor: segment === s ? NAVY : 'white', color: segment === s ? 'white' : '#333',
            cursor: 'pointer', fontSize: '12px', textTransform: 'capitalize',
          }}>
            {s.replace('-', ' ')}
          </button>
        ))}
        <span style={{ fontSize: '13px', color: '#666', marginLeft: '16px', marginRight: '8px' }}>Sort:</span>
        <select value={sortBy} onChange={e => setSortBy(e.target.value)} style={{ padding: '6px 10px', borderRadius: '4px', border: '1px solid #ddd', fontSize: '12px' }}>
          <option value="healthScore">Health Score</option>
          <option value="totalLifetimeValue">Lifetime Value</option>
          <option value="creditRiskScore">Credit Risk</option>
          <option value="crossSellScore">Cross-Sell Score</option>
          <option value="daysSinceLastOrder">Days Since Order</option>
        </select>
      </div>

      {/* Builder Table */}
      <div style={{ padding: '0 40px 40px' }}>
        <div style={{ backgroundColor: 'white', border: '1px solid #ddd', borderRadius: '4px', overflow: 'hidden' }}>
          {loading ? (
            <div style={{ padding: '40px', textAlign: 'center', color: '#999' }}>Loading...</div>
          ) : builders.length === 0 ? (
            <div style={{ padding: '40px', textAlign: 'center', color: '#999' }}>
              No builder intelligence data. Run the intelligence refresh first.
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ backgroundColor: '#f9f9f9', borderBottom: '2px solid #ddd' }}>
                    {['Health', 'Builder', 'LTV', 'Avg Order', 'Order Trend', 'Payment', 'Days Since', 'Credit Risk', 'Cross-Sell'].map(h => (
                      <th key={h} style={{ padding: '12px 10px', textAlign: 'left', fontSize: '12px', fontWeight: '600', color: '#666' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {builders.map(b => (
                    <tr key={b.builderId} style={{ borderBottom: '1px solid #eee' }}>
                      <td style={{ padding: '10px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <div style={{
                            width: '36px', height: '36px', borderRadius: '50%',
                            backgroundColor: healthColor(b.healthScore),
                            color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontSize: '13px', fontWeight: 'bold',
                          }}>
                            {b.healthScore}
                          </div>
                        </div>
                      </td>
                      <td style={{ padding: '10px' }}>
                        <div style={{ fontSize: '13px', fontWeight: '500', color: NAVY }}>{b.companyName}</div>
                        <div style={{ fontSize: '11px', color: '#999' }}>{b.contactName}</div>
                      </td>
                      <td style={{ padding: '10px', fontSize: '13px', fontWeight: '600' }}>
                        ${Math.round(b.totalLifetimeValue).toLocaleString()}
                      </td>
                      <td style={{ padding: '10px', fontSize: '13px' }}>
                        ${Math.round(b.avgOrderValue).toLocaleString()}
                      </td>
                      <td style={{ padding: '10px' }}>
                        <span style={{ color: trendColor(b.orderTrend), fontWeight: '600', fontSize: '13px' }}>
                          {trendIcon(b.orderTrend)} {b.orderTrend}
                        </span>
                      </td>
                      <td style={{ padding: '10px' }}>
                        <span style={{ color: trendColor(b.paymentTrend), fontWeight: '500', fontSize: '12px' }}>
                          {trendIcon(b.paymentTrend)} {Math.round((b.onTimePaymentRate || 0) * 100)}%
                        </span>
                      </td>
                      <td style={{
                        padding: '10px', fontSize: '13px', fontWeight: '600',
                        color: b.daysSinceLastOrder > 90 ? '#c0392b' : b.daysSinceLastOrder > 60 ? ORANGE : '#666',
                      }}>
                        {b.daysSinceLastOrder || '—'}
                      </td>
                      <td style={{ padding: '10px' }}>
                        <div style={{
                          width: '40px', height: '6px', backgroundColor: '#eee', borderRadius: '3px', overflow: 'hidden',
                        }}>
                          <div style={{
                            width: `${b.creditRiskScore}%`, height: '100%',
                            backgroundColor: b.creditRiskScore > 70 ? '#c0392b' : b.creditRiskScore > 40 ? ORANGE : '#27ae60',
                          }} />
                        </div>
                        <span style={{ fontSize: '11px', color: '#666' }}>{b.creditRiskScore}</span>
                      </td>
                      <td style={{ padding: '10px', fontSize: '13px', fontWeight: '500', color: b.crossSellScore > 60 ? '#27ae60' : '#666' }}>
                        {b.crossSellScore}
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
