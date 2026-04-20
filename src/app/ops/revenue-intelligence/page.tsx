'use client'

import { useEffect, useState, useCallback } from 'react'
import { formatCurrency } from '@/lib/utils'

// ─── TYPE DEFINITIONS ──────────────────────────────────────────────

interface BuilderProfile {
  id: string
  companyName: string
  email: string
  lifetimeRevenue: number
  orderCount: number
  avgOrderValue: number
  quoteToOrderRate: number
  daysSinceLastOrder: number
  lastOrderDate: string | null
  lifetimeValueScore: number
  churnRisk: 'LOW' | 'MEDIUM' | 'HIGH'
  growthTrend: 'GROWING' | 'STABLE' | 'DECLINING'
  predictedAnnualRevenue: number
  segmentTag: 'PLATINUM' | 'GOLD' | 'SILVER' | 'STANDARD'
}

interface SegmentSummary {
  count: number
  totalRevenue: number
  avgLTV: number
}

interface RetentionData {
  atRiskBuilders: number
  revenueAtRisk: number
  recentChurned: number
  churnedRevenue: number
}

interface PricingRule {
  id: string
  name: string
  description: string
  ruleType: string
  condition: any
  adjustment: any
  priority: number
  isActive: boolean
  appliedCount: number
  totalRevenueImpact: number
}

interface MarginCategory {
  category: string
  avgMargin: number
  marginPercent: number
  productCount: number
}

interface PricingRecommendation {
  type: string
  description: string
  estimatedImpact: number
}

// ─── MAIN COMPONENT ────────────────────────────────────────────────

export default function RevenueIntelligencePage() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'overview' | 'builders' | 'pricing' | 'margins'>('overview')

  // Builder Value data
  const [builders, setBuilders] = useState<BuilderProfile[]>([])
  const [segments, setSegments] = useState<Record<string, SegmentSummary>>({})
  const [retention, setRetention] = useState<RetentionData>({ atRiskBuilders: 0, revenueAtRisk: 0, recentChurned: 0, churnedRevenue: 0 })
  const [builderSummary, setBuilderSummary] = useState({ totalActiveBuilders: 0, totalRevenue: 0, avgLTV: 0, topBuilderRevenue: 0, avgChurnRisk: 0 })

  // Pricing Engine data
  const [pricingRules, setPricingRules] = useState<PricingRule[]>([])
  const [marginAnalysis, setMarginAnalysis] = useState<MarginCategory[]>([])
  const [pricingRecommendations, setPricingRecommendations] = useState<PricingRecommendation[]>([])
  const [pricingStats, setPricingStats] = useState({ quotesOptimized: 0, avgMarginImprovement: 0, totalRevenueImpact: 0, avgAIConfidence: 0 })

  // Builder list filters
  const [segmentFilter, setSegmentFilter] = useState<string>('ALL')
  const [riskFilter, setRiskFilter] = useState<string>('ALL')
  const [builderSearch, setBuilderSearch] = useState('')

  const fetchData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [bvRes, peRes] = await Promise.all([
        fetch('/api/ops/revenue-intelligence/builder-value'),
        fetch('/api/ops/revenue-intelligence/pricing-engine'),
      ])

      if (!bvRes.ok) throw new Error(`Builder value API: ${bvRes.status}`)
      if (!peRes.ok) throw new Error(`Pricing engine API: ${peRes.status}`)

      const bvData = await bvRes.json()
      const peData = await peRes.json()

      // Map builder data
      const mappedBuilders = (bvData.builders || []).map((b: any) => ({
        id: b.id,
        companyName: b.companyName || 'Unknown',
        email: b.email || '',
        lifetimeRevenue: Number(b.lifetimeRevenue || 0),
        orderCount: b.orderCount || 0,
        avgOrderValue: Number(b.avgOrderValue || 0),
        quoteToOrderRate: Number(b.quoteToOrderRate || 0),
        daysSinceLastOrder: b.daysSinceLastOrder || 0,
        lastOrderDate: b.lastOrderDate,
        lifetimeValueScore: Number(b.lifetimeValueScore || 0),
        churnRisk: b.churnRisk || 'LOW',
        growthTrend: b.growthTrend || 'STABLE',
        predictedAnnualRevenue: Number(b.predictedAnnualRevenue || 0),
        segmentTag: b.segmentTag || 'STANDARD',
      }))

      setBuilders(mappedBuilders)
      setSegments(bvData.segments || {})
      setRetention(bvData.retention || { atRiskBuilders: 0, revenueAtRisk: 0, recentChurned: 0, churnedRevenue: 0 })
      setBuilderSummary(bvData.summary || { totalActiveBuilders: 0, totalRevenue: 0, avgLTV: 0, topBuilderRevenue: 0, avgChurnRisk: 0 })

      // Map pricing data
      setPricingRules(peData.rules || [])
      setMarginAnalysis(peData.marginAnalysis || [])
      setPricingRecommendations(peData.recommendations || [])
      setPricingStats(peData.recentStats || { quotesOptimized: 0, avgMarginImprovement: 0, totalRevenueImpact: 0, avgAIConfidence: 0 })
    } catch (err: any) {
      setError(err.message || 'Failed to load data')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  // Filtered builders
  const filteredBuilders = builders.filter(b => {
    if (segmentFilter !== 'ALL' && b.segmentTag !== segmentFilter) return false
    if (riskFilter !== 'ALL' && b.churnRisk !== riskFilter) return false
    if (builderSearch && !b.companyName.toLowerCase().includes(builderSearch.toLowerCase())) return false
    return true
  })

  // Computed KPIs
  const totalRevenue = builderSummary.totalRevenue
  const avgMarginPct = marginAnalysis.length > 0
    ? marginAnalysis.reduce((s, m) => s + m.marginPercent, 0) / marginAnalysis.length
    : 0
  const atRiskRevenue = retention.revenueAtRisk
  const platinumCount = segments?.PLATINUM?.count || 0
  const goldCount = segments?.GOLD?.count || 0

  if (loading) {
    return (
      <div style={{ padding: 32, textAlign: 'center' }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>💰</div>
        <h2 style={{ color: '#3E2A1E', marginBottom: 8 }}>Loading Revenue Intelligence...</h2>
        <p style={{ color: '#666' }}>Analyzing builder value, pricing optimization, and margin intelligence</p>
      </div>
    )
  }

  if (error) {
    return (
      <div style={{ padding: 32, textAlign: 'center' }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>⚠️</div>
        <h2 style={{ color: '#c0392b', marginBottom: 8 }}>Error Loading Data</h2>
        <p style={{ color: '#666', marginBottom: 16 }}>{error}</p>
        <button onClick={fetchData} style={{ padding: '8px 24px', background: '#3E2A1E', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer' }}>
          Retry
        </button>
      </div>
    )
  }

  return (
    <div style={{ padding: '24px 32px', maxWidth: 1400, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 28, fontWeight: 700, color: '#3E2A1E', margin: 0 }}>
            💰 AI Revenue Command Center
          </h1>
          <p style={{ color: '#666', margin: '4px 0 0' }}>
            Dynamic pricing, builder lifetime value, margin intelligence &amp; retention
          </p>
        </div>
        <button
          onClick={fetchData}
          style={{ padding: '10px 20px', background: '#3E2A1E', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 600, fontSize: 14 }}
        >
          🔄 Refresh Data
        </button>
      </div>

      {/* KPI Strip */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 16, marginBottom: 24 }}>
        <KPICard label="Total Lifetime Revenue" value={formatCurrency(totalRevenue)} icon="💵" color="#27ae60" />
        <KPICard label="Active Builders" value={builderSummary.totalActiveBuilders.toString()} icon="👷" color="#3E2A1E" />
        <KPICard label="Avg Margin" value={`${avgMarginPct.toFixed(1)}%`} icon="📊" color="#C9822B" />
        <KPICard label="Elite Builders" value={`${platinumCount + goldCount}`} subtitle={`${platinumCount} Platinum · ${goldCount} Gold`} icon="⭐" color="#D9993F" />
        <KPICard label="Revenue at Risk" value={formatCurrency(atRiskRevenue)} subtitle={`${retention.atRiskBuilders} builders`} icon="⚠️" color="#e74c3c" />
      </div>

      {/* Tab Navigation */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 24, borderBottom: '2px solid #eee', paddingBottom: 0 }}>
        {[
          { key: 'overview' as const, label: '📈 Overview', },
          { key: 'builders' as const, label: '👷 Builder Intelligence' },
          { key: 'pricing' as const, label: '🏷️ Pricing Engine' },
          { key: 'margins' as const, label: '📊 Margin Analysis' },
        ].map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            style={{
              padding: '10px 20px',
              background: activeTab === tab.key ? '#3E2A1E' : 'transparent',
              color: activeTab === tab.key ? '#fff' : '#666',
              border: 'none',
              borderRadius: '8px 8px 0 0',
              cursor: 'pointer',
              fontWeight: activeTab === tab.key ? 700 : 500,
              fontSize: 14,
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {activeTab === 'overview' && (
        <OverviewTab
          builders={builders}
          segments={segments}
          retention={retention}
          pricingRules={pricingRules}
          pricingStats={pricingStats}
          marginAnalysis={marginAnalysis}
          pricingRecommendations={pricingRecommendations}
        />
      )}
      {activeTab === 'builders' && (
        <BuildersTab
          builders={filteredBuilders}
          segmentFilter={segmentFilter}
          setSegmentFilter={setSegmentFilter}
          riskFilter={riskFilter}
          setRiskFilter={setRiskFilter}
          builderSearch={builderSearch}
          setBuilderSearch={setBuilderSearch}
          totalCount={builders.length}
        />
      )}
      {activeTab === 'pricing' && (
        <PricingTab rules={pricingRules} stats={pricingStats} recommendations={pricingRecommendations} />
      )}
      {activeTab === 'margins' && (
        <MarginsTab marginAnalysis={marginAnalysis} />
      )}
    </div>
  )
}

// ─── KPI CARD ──────────────────────────────────────────────────────

function KPICard({ label, value, subtitle, icon, color }: { label: string; value: string; subtitle?: string; icon: string; color: string }) {
  return (
    <div style={{ background: '#fff', borderRadius: 12, padding: '20px 16px', border: '1px solid #e8e8e8', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span style={{ fontSize: 20 }}>{icon}</span>
        <span style={{ fontSize: 12, color: '#888', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</span>
      </div>
      <div style={{ fontSize: 24, fontWeight: 700, color }}>{value}</div>
      {subtitle && <div style={{ fontSize: 12, color: '#999', marginTop: 4 }}>{subtitle}</div>}
    </div>
  )
}

// ─── OVERVIEW TAB ──────────────────────────────────────────────────

function OverviewTab({ builders, segments, retention, pricingRules, pricingStats, marginAnalysis, pricingRecommendations }: {
  builders: BuilderProfile[]
  segments: Record<string, SegmentSummary>
  retention: RetentionData
  pricingRules: PricingRule[]
  pricingStats: any
  marginAnalysis: MarginCategory[]
  pricingRecommendations: PricingRecommendation[]
}) {
  const topBuilders = builders.slice(0, 10)
  const atRiskBuilders = builders.filter(b => b.churnRisk === 'HIGH').slice(0, 5)
  const growingBuilders = builders.filter(b => b.growthTrend === 'GROWING').slice(0, 5)

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
      {/* Segment Distribution */}
      <div style={{ background: '#fff', borderRadius: 12, padding: 20, border: '1px solid #e8e8e8' }}>
        <h3 style={{ margin: '0 0 16px', color: '#3E2A1E', fontSize: 16 }}>🏆 Builder Segments</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {(['PLATINUM', 'GOLD', 'SILVER', 'STANDARD'] as const).map(seg => {
            const data = segments[seg] || { count: 0, totalRevenue: 0, avgLTV: 0 }
            const colors: Record<string, string> = { PLATINUM: '#8e44ad', GOLD: '#D9993F', SILVER: '#95a5a6', STANDARD: '#3498db' }
            const totalCount = builders.length || 1
            const pct = (data.count / totalCount * 100)
            return (
              <div key={seg}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ fontWeight: 600, color: colors[seg], fontSize: 14 }}>
                    {seg === 'PLATINUM' ? '💎' : seg === 'GOLD' ? '🥇' : seg === 'SILVER' ? '🥈' : '🔵'} {seg}
                  </span>
                  <span style={{ fontSize: 13, color: '#666' }}>{data.count} builders · {formatCurrency(data.totalRevenue)}</span>
                </div>
                <div style={{ height: 8, background: '#f0f0f0', borderRadius: 4, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${pct}%`, background: colors[seg], borderRadius: 4, transition: 'width 0.5s' }} />
                </div>
                <div style={{ fontSize: 11, color: '#999', marginTop: 2 }}>Avg LTV: {formatCurrency(data.avgLTV)}</div>
              </div>
            )
          })}
        </div>
      </div>

      {/* At-Risk Builders */}
      <div style={{ background: '#fff', borderRadius: 12, padding: 20, border: '1px solid #e8e8e8' }}>
        <h3 style={{ margin: '0 0 16px', color: '#e74c3c', fontSize: 16 }}>🚨 Retention Alerts</h3>
        <div style={{ background: '#fdf2f2', borderRadius: 8, padding: 12, marginBottom: 16 }}>
          <div style={{ fontSize: 22, fontWeight: 700, color: '#e74c3c' }}>{formatCurrency(retention.revenueAtRisk)}</div>
          <div style={{ fontSize: 12, color: '#c0392b' }}>revenue at risk from {retention.atRiskBuilders} at-risk builders</div>
        </div>
        {atRiskBuilders.length === 0 ? (
          <p style={{ color: '#999', fontSize: 13, textAlign: 'center', padding: 16 }}>No high-risk builders detected</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {atRiskBuilders.map(b => (
              <div key={b.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', background: '#fef9f9', borderRadius: 6, border: '1px solid #fde2e2' }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{b.companyName}</div>
                  <div style={{ fontSize: 11, color: '#e74c3c' }}>{b.daysSinceLastOrder} days since last order</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontWeight: 700, fontSize: 13 }}>{formatCurrency(b.lifetimeRevenue)}</div>
                  <div style={{ fontSize: 11, color: '#999' }}>lifetime</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Top Builders */}
      <div style={{ background: '#fff', borderRadius: 12, padding: 20, border: '1px solid #e8e8e8' }}>
        <h3 style={{ margin: '0 0 16px', color: '#3E2A1E', fontSize: 16 }}>🏅 Top 10 Builders by LTV</h3>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #eee' }}>
              <th style={{ textAlign: 'left', padding: '6px 8px', color: '#888', fontWeight: 600 }}>Builder</th>
              <th style={{ textAlign: 'right', padding: '6px 8px', color: '#888', fontWeight: 600 }}>Revenue</th>
              <th style={{ textAlign: 'center', padding: '6px 8px', color: '#888', fontWeight: 600 }}>Score</th>
              <th style={{ textAlign: 'center', padding: '6px 8px', color: '#888', fontWeight: 600 }}>Trend</th>
            </tr>
          </thead>
          <tbody>
            {topBuilders.map((b, i) => (
              <tr key={b.id} style={{ borderBottom: '1px solid #f5f5f5' }}>
                <td style={{ padding: '8px 8px' }}>
                  <div style={{ fontWeight: 600 }}>{i + 1}. {b.companyName}</div>
                  <SegmentBadge segment={b.segmentTag} />
                </td>
                <td style={{ textAlign: 'right', padding: '8px', fontWeight: 600 }}>{formatCurrency(b.lifetimeRevenue)}</td>
                <td style={{ textAlign: 'center', padding: '8px' }}>
                  <ScoreBadge score={b.lifetimeValueScore} />
                </td>
                <td style={{ textAlign: 'center', padding: '8px' }}>
                  <TrendIndicator trend={b.growthTrend} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Growing Builders */}
      <div style={{ background: '#fff', borderRadius: 12, padding: 20, border: '1px solid #e8e8e8' }}>
        <h3 style={{ margin: '0 0 16px', color: '#27ae60', fontSize: 16 }}>📈 Growing Builders</h3>
        {growingBuilders.length === 0 ? (
          <p style={{ color: '#999', fontSize: 13, textAlign: 'center', padding: 16 }}>No growing builders detected in this period</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {growingBuilders.map(b => (
              <div key={b.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 12px', background: '#f0fdf4', borderRadius: 6, border: '1px solid #d1fae5' }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{b.companyName}</div>
                  <div style={{ fontSize: 11, color: '#27ae60' }}>
                    {b.orderCount} orders · Score: {b.lifetimeValueScore}/100
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontWeight: 700, fontSize: 14, color: '#27ae60' }}>{formatCurrency(b.predictedAnnualRevenue)}</div>
                  <div style={{ fontSize: 11, color: '#999' }}>predicted annual</div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Pricing Rules Summary */}
        <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid #eee' }}>
          <h4 style={{ margin: '0 0 12px', color: '#3E2A1E', fontSize: 14 }}>🏷️ Active Pricing Rules</h4>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {pricingRules.slice(0, 5).map(rule => (
              <div key={rule.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 10px', background: '#f8f9fa', borderRadius: 4 }}>
                <span style={{ fontSize: 12, fontWeight: 600 }}>{rule.name}</span>
                <span style={{ fontSize: 11, color: '#888' }}>Priority: {rule.priority}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── BUILDERS TAB ──────────────────────────────────────────────────

function BuildersTab({ builders, segmentFilter, setSegmentFilter, riskFilter, setRiskFilter, builderSearch, setBuilderSearch, totalCount }: {
  builders: BuilderProfile[]
  segmentFilter: string
  setSegmentFilter: (v: string) => void
  riskFilter: string
  setRiskFilter: (v: string) => void
  builderSearch: string
  setBuilderSearch: (v: string) => void
  totalCount: number
}) {
  return (
    <div>
      {/* Filters */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        <input
          type="text"
          placeholder="Search builders..."
          value={builderSearch}
          onChange={e => setBuilderSearch(e.target.value)}
          style={{ padding: '8px 14px', border: '1px solid #ddd', borderRadius: 6, fontSize: 13, width: 220 }}
        />
        <select value={segmentFilter} onChange={e => setSegmentFilter(e.target.value)} style={{ padding: '8px 12px', border: '1px solid #ddd', borderRadius: 6, fontSize: 13 }}>
          <option value="ALL">All Segments</option>
          <option value="PLATINUM">💎 Platinum</option>
          <option value="GOLD">🥇 Gold</option>
          <option value="SILVER">🥈 Silver</option>
          <option value="STANDARD">🔵 Standard</option>
        </select>
        <select value={riskFilter} onChange={e => setRiskFilter(e.target.value)} style={{ padding: '8px 12px', border: '1px solid #ddd', borderRadius: 6, fontSize: 13 }}>
          <option value="ALL">All Risk Levels</option>
          <option value="HIGH">🔴 High Risk</option>
          <option value="MEDIUM">🟡 Medium Risk</option>
          <option value="LOW">🟢 Low Risk</option>
        </select>
        <span style={{ fontSize: 12, color: '#888' }}>Showing {builders.length} of {totalCount} builders</span>
      </div>

      {/* Builder Table */}
      <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e8e8e8', overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: '#f8f9fa', borderBottom: '2px solid #eee' }}>
              <th style={{ textAlign: 'left', padding: '10px 12px', color: '#666', fontWeight: 600 }}>Builder</th>
              <th style={{ textAlign: 'center', padding: '10px 8px', color: '#666', fontWeight: 600 }}>Segment</th>
              <th style={{ textAlign: 'right', padding: '10px 8px', color: '#666', fontWeight: 600 }}>Lifetime Revenue</th>
              <th style={{ textAlign: 'center', padding: '10px 8px', color: '#666', fontWeight: 600 }}>Orders</th>
              <th style={{ textAlign: 'right', padding: '10px 8px', color: '#666', fontWeight: 600 }}>Avg Order</th>
              <th style={{ textAlign: 'center', padding: '10px 8px', color: '#666', fontWeight: 600 }}>LTV Score</th>
              <th style={{ textAlign: 'center', padding: '10px 8px', color: '#666', fontWeight: 600 }}>Risk</th>
              <th style={{ textAlign: 'center', padding: '10px 8px', color: '#666', fontWeight: 600 }}>Trend</th>
              <th style={{ textAlign: 'center', padding: '10px 8px', color: '#666', fontWeight: 600 }}>Last Order</th>
            </tr>
          </thead>
          <tbody>
            {builders.slice(0, 50).map(b => (
              <tr key={b.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                <td style={{ padding: '10px 12px' }}>
                  <div style={{ fontWeight: 600 }}>{b.companyName}</div>
                  <div style={{ fontSize: 11, color: '#999' }}>{b.email}</div>
                </td>
                <td style={{ textAlign: 'center', padding: '10px 8px' }}><SegmentBadge segment={b.segmentTag} /></td>
                <td style={{ textAlign: 'right', padding: '10px 8px', fontWeight: 600 }}>{formatCurrency(b.lifetimeRevenue)}</td>
                <td style={{ textAlign: 'center', padding: '10px 8px' }}>{b.orderCount}</td>
                <td style={{ textAlign: 'right', padding: '10px 8px' }}>{formatCurrency(b.avgOrderValue)}</td>
                <td style={{ textAlign: 'center', padding: '10px 8px' }}><ScoreBadge score={b.lifetimeValueScore} /></td>
                <td style={{ textAlign: 'center', padding: '10px 8px' }}><RiskBadge risk={b.churnRisk} /></td>
                <td style={{ textAlign: 'center', padding: '10px 8px' }}><TrendIndicator trend={b.growthTrend} /></td>
                <td style={{ textAlign: 'center', padding: '10px 8px', fontSize: 12, color: '#666' }}>
                  {b.daysSinceLastOrder > 0 ? `${b.daysSinceLastOrder}d ago` : 'N/A'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {builders.length > 50 && (
          <div style={{ padding: 12, textAlign: 'center', color: '#888', fontSize: 12, background: '#f8f9fa' }}>
            Showing top 50 of {builders.length} builders
          </div>
        )}
      </div>
    </div>
  )
}

// ─── PRICING TAB ───────────────────────────────────────────────────

function PricingTab({ rules, stats, recommendations }: { rules: PricingRule[]; stats: any; recommendations: PricingRecommendation[] }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
      {/* Active Rules */}
      <div style={{ background: '#fff', borderRadius: 12, padding: 20, border: '1px solid #e8e8e8' }}>
        <h3 style={{ margin: '0 0 16px', color: '#3E2A1E', fontSize: 16 }}>🏷️ Active Pricing Rules</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {rules.map(rule => {
            const adj = rule.adjustment || {}
            return (
              <div key={rule.id} style={{ padding: 14, background: '#f8f9fa', borderRadius: 8, border: '1px solid #eee' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                  <span style={{ fontWeight: 700, fontSize: 14 }}>{rule.name}</span>
                  <span style={{ fontSize: 11, background: '#e8f5e9', color: '#27ae60', padding: '2px 8px', borderRadius: 10, fontWeight: 600 }}>
                    Priority: {rule.priority}
                  </span>
                </div>
                <div style={{ fontSize: 12, color: '#666', marginBottom: 6 }}>{rule.description}</div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <span style={{ fontSize: 11, background: '#e3f2fd', padding: '2px 8px', borderRadius: 4 }}>{rule.ruleType}</span>
                  {adj.discountPercent > 0 && <span style={{ fontSize: 11, background: '#fff3e0', padding: '2px 8px', borderRadius: 4 }}>-{adj.discountPercent}%</span>}
                  {adj.markupPercent > 0 && <span style={{ fontSize: 11, background: '#fce4ec', padding: '2px 8px', borderRadius: 4 }}>+{adj.markupPercent}%</span>}
                  {adj.minMarginPercent > 0 && <span style={{ fontSize: 11, background: '#e8f5e9', padding: '2px 8px', borderRadius: 4 }}>Min {adj.minMarginPercent}%</span>}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Optimization Stats & Recommendations */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        {/* Stats */}
        <div style={{ background: '#fff', borderRadius: 12, padding: 20, border: '1px solid #e8e8e8' }}>
          <h3 style={{ margin: '0 0 16px', color: '#3E2A1E', fontSize: 16 }}>📊 Optimization Performance (30 Days)</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div style={{ padding: 12, background: '#f0f8ff', borderRadius: 8, textAlign: 'center' }}>
              <div style={{ fontSize: 24, fontWeight: 700, color: '#3E2A1E' }}>{stats.quotesOptimized}</div>
              <div style={{ fontSize: 11, color: '#888' }}>Quotes Optimized</div>
            </div>
            <div style={{ padding: 12, background: '#f0fdf4', borderRadius: 8, textAlign: 'center' }}>
              <div style={{ fontSize: 24, fontWeight: 700, color: '#27ae60' }}>{stats.avgMarginImprovement.toFixed(1)}%</div>
              <div style={{ fontSize: 11, color: '#888' }}>Avg Margin Improvement</div>
            </div>
            <div style={{ padding: 12, background: '#fef9f0', borderRadius: 8, textAlign: 'center' }}>
              <div style={{ fontSize: 24, fontWeight: 700, color: '#C9822B' }}>{formatCurrency(stats.totalRevenueImpact)}</div>
              <div style={{ fontSize: 11, color: '#888' }}>Revenue Impact</div>
            </div>
            <div style={{ padding: 12, background: '#f5f0ff', borderRadius: 8, textAlign: 'center' }}>
              <div style={{ fontSize: 24, fontWeight: 700, color: '#8e44ad' }}>{(stats.avgAIConfidence * 100).toFixed(0)}%</div>
              <div style={{ fontSize: 11, color: '#888' }}>AI Confidence</div>
            </div>
          </div>
        </div>

        {/* Recommendations */}
        {recommendations.length > 0 && (
          <div style={{ background: '#fff', borderRadius: 12, padding: 20, border: '1px solid #e8e8e8' }}>
            <h3 style={{ margin: '0 0 16px', color: '#C9822B', fontSize: 16 }}>💡 AI Recommendations</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {recommendations.map((rec, i) => (
                <div key={i} style={{ padding: 12, background: '#fff8f0', borderRadius: 8, border: '1px solid #fde8d0' }}>
                  <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>{rec.description}</div>
                  <div style={{ fontSize: 12, color: '#C9822B' }}>
                    Est. impact: {formatCurrency(rec.estimatedImpact)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── MARGINS TAB ───────────────────────────────────────────────────

function MarginsTab({ marginAnalysis }: { marginAnalysis: MarginCategory[] }) {
  const sortedMargins = [...marginAnalysis].sort((a, b) => b.marginPercent - a.marginPercent)
  const avgMargin = marginAnalysis.length > 0 ? marginAnalysis.reduce((s, m) => s + m.marginPercent, 0) / marginAnalysis.length : 0

  return (
    <div>
      {/* Summary Bar */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 20 }}>
        <div style={{ background: '#fff', borderRadius: 12, padding: 16, border: '1px solid #e8e8e8', textAlign: 'center' }}>
          <div style={{ fontSize: 28, fontWeight: 700, color: '#3E2A1E' }}>{marginAnalysis.length}</div>
          <div style={{ fontSize: 12, color: '#888' }}>Product Categories</div>
        </div>
        <div style={{ background: '#fff', borderRadius: 12, padding: 16, border: '1px solid #e8e8e8', textAlign: 'center' }}>
          <div style={{ fontSize: 28, fontWeight: 700, color: avgMargin >= 25 ? '#27ae60' : '#C9822B' }}>{avgMargin.toFixed(1)}%</div>
          <div style={{ fontSize: 12, color: '#888' }}>Average Margin</div>
        </div>
        <div style={{ background: '#fff', borderRadius: 12, padding: 16, border: '1px solid #e8e8e8', textAlign: 'center' }}>
          <div style={{ fontSize: 28, fontWeight: 700, color: '#e74c3c' }}>{marginAnalysis.filter(m => m.marginPercent < 20).length}</div>
          <div style={{ fontSize: 12, color: '#888' }}>Below 20% Margin</div>
        </div>
      </div>

      {/* Margin Bars */}
      <div style={{ background: '#fff', borderRadius: 12, padding: 20, border: '1px solid #e8e8e8' }}>
        <h3 style={{ margin: '0 0 16px', color: '#3E2A1E', fontSize: 16 }}>📊 Margin by Product Category</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {sortedMargins.map(m => {
            const pct = m.marginPercent
            const barColor = pct >= 30 ? '#27ae60' : pct >= 20 ? '#C9822B' : '#e74c3c'
            return (
              <div key={m.category}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ fontWeight: 600, fontSize: 13 }}>{m.category}</span>
                  <span style={{ fontSize: 12 }}>
                    <span style={{ fontWeight: 700, color: barColor }}>{pct.toFixed(1)}%</span>
                    <span style={{ color: '#999', marginLeft: 8 }}>{m.productCount} products · Avg {formatCurrency(m.avgMargin)}/unit</span>
                  </span>
                </div>
                <div style={{ height: 10, background: '#f0f0f0', borderRadius: 5, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${Math.min(100, pct * 2)}%`, background: barColor, borderRadius: 5, transition: 'width 0.5s' }} />
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ─── SHARED COMPONENTS ─────────────────────────────────────────────

function SegmentBadge({ segment }: { segment: string }) {
  const config: Record<string, { bg: string; color: string; icon: string }> = {
    PLATINUM: { bg: '#f3e5f5', color: '#8e44ad', icon: '💎' },
    GOLD: { bg: '#fff8e1', color: '#D9993F', icon: '🥇' },
    SILVER: { bg: '#eceff1', color: '#607d8b', icon: '🥈' },
    STANDARD: { bg: '#e3f2fd', color: '#1976d2', icon: '🔵' },
  }
  const c = config[segment] || config.STANDARD
  return (
    <span style={{ fontSize: 11, background: c.bg, color: c.color, padding: '2px 8px', borderRadius: 10, fontWeight: 600 }}>
      {c.icon} {segment}
    </span>
  )
}

function ScoreBadge({ score }: { score: number }) {
  const color = score >= 70 ? '#27ae60' : score >= 40 ? '#C9822B' : '#e74c3c'
  return (
    <span style={{ fontWeight: 700, color, fontSize: 14 }}>{score}</span>
  )
}

function RiskBadge({ risk }: { risk: string }) {
  const config: Record<string, { bg: string; color: string; label: string }> = {
    HIGH: { bg: '#fde2e2', color: '#e74c3c', label: '🔴 High' },
    MEDIUM: { bg: '#fef3cd', color: '#D9993F', label: '🟡 Med' },
    LOW: { bg: '#d4edda', color: '#27ae60', label: '🟢 Low' },
  }
  const c = config[risk] || config.LOW
  return (
    <span style={{ fontSize: 11, background: c.bg, color: c.color, padding: '2px 8px', borderRadius: 10, fontWeight: 600 }}>{c.label}</span>
  )
}

function TrendIndicator({ trend }: { trend: string }) {
  const config: Record<string, { icon: string; color: string }> = {
    GROWING: { icon: '📈', color: '#27ae60' },
    STABLE: { icon: '➡️', color: '#888' },
    DECLINING: { icon: '📉', color: '#e74c3c' },
  }
  const c = config[trend] || config.STABLE
  return <span style={{ color: c.color }}>{c.icon}</span>
}
