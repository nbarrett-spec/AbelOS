'use client'

import { useEffect, useState, useCallback } from 'react'
import { formatCurrency } from '@/lib/utils'

// ─── TYPE DEFINITIONS ──────────────────────────────────────────────

interface CollectionAction {
  invoiceId: string
  invoiceNumber: string
  builderId: string
  builderName: string
  amountDue: number
  daysOverdue: number
  urgency: string
  priority: number
  suggestedAction: string
  paymentTerm: string
  dueDate: string
}

interface AgingBuckets {
  current: { count: number; amount: number }
  '1-30': { count: number; amount: number }
  '31-60': { count: number; amount: number }
  '61-90': { count: number; amount: number }
  '90+': { count: number; amount: number }
}

interface CollectionSummary {
  totalAccountsReceivable: number
  totalOverdue: number
  averageDSO: number
  invoiceCount: number
  criticalCount: number
  highCount: number
}

interface WorkingCapitalPosition {
  totalAR: number
  totalAP: number
  inventoryValue: number
  cashOnHand: number
  workingCapital: number
}

interface WorkingCapitalMetrics {
  dso: number
  dpo: number
  ccc: number
  currentRatio: number
  quickRatio: number
}

interface ForecastDay {
  date: string
  day: number
  projectedInflows: number
  projectedOutflows: number
  netCashFlow: number
  runningBalance: number
}

interface CashGap {
  startDay: number
  endDay: number
  lowestBalance: number
  shortfall: number
}

interface WCRecommendation {
  type: string
  title: string
  description: string
  impact: number
  priority: string
}

interface PaymentTermRec {
  builderId: string
  builderName: string
  currentTerm: string
  recommendedTerm: string
  avgPaymentDays: number
  onTimeRate: number
  estimatedCashImpact: number
  reasoning: string
}

// ─── MAIN COMPONENT ────────────────────────────────────────────────

export default function CashFlowOptimizerPage() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'overview' | 'collections' | 'terms' | 'forecast'>('overview')

  // Collections
  const [actions, setActions] = useState<CollectionAction[]>([])
  const [aging, setAging] = useState<AgingBuckets>({ current: { count: 0, amount: 0 }, '1-30': { count: 0, amount: 0 }, '31-60': { count: 0, amount: 0 }, '61-90': { count: 0, amount: 0 }, '90+': { count: 0, amount: 0 } })
  const [collectionSummary, setCollectionSummary] = useState<CollectionSummary>({ totalAccountsReceivable: 0, totalOverdue: 0, averageDSO: 0, invoiceCount: 0, criticalCount: 0, highCount: 0 })

  // Working Capital
  const [position, setPosition] = useState<WorkingCapitalPosition>({ totalAR: 0, totalAP: 0, inventoryValue: 0, cashOnHand: 1000, workingCapital: 0 })
  const [metrics, setMetrics] = useState<WorkingCapitalMetrics>({ dso: 0, dpo: 0, ccc: 0, currentRatio: 0, quickRatio: 0 })
  const [forecast, setForecast] = useState<ForecastDay[]>([])
  const [cashGaps, setCashGaps] = useState<CashGap[]>([])
  const [wcRecs, setWcRecs] = useState<WCRecommendation[]>([])

  // Payment Terms
  const [termRecs, setTermRecs] = useState<PaymentTermRec[]>([])
  const [termSummary, setTermSummary] = useState<any>(null)

  const fetchData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [colRes, ptRes, wcRes] = await Promise.all([
        fetch('/api/ops/cash-flow-optimizer/collections'),
        fetch('/api/ops/cash-flow-optimizer/payment-terms'),
        fetch('/api/ops/cash-flow-optimizer/working-capital'),
      ])

      if (!colRes.ok) throw new Error(`Collections API: ${colRes.status}`)
      if (!wcRes.ok) throw new Error(`Working capital API: ${wcRes.status}`)

      const colData = await colRes.json()
      const ptData = await ptRes.json()
      const wcData = await wcRes.json()

      // Collections
      setActions(colData.prioritizedActions || [])
      setAging(colData.agingBuckets || aging)
      setCollectionSummary(colData.summary || collectionSummary)

      // Working Capital
      setPosition(wcData.currentPosition || position)
      setMetrics(wcData.metrics || metrics)
      setForecast((wcData.forecast || []).slice(0, 90))
      setCashGaps(wcData.cashGaps || [])
      setWcRecs(wcData.recommendations || [])

      // Payment Terms
      setTermRecs(ptData.recommendations || [])
      setTermSummary(ptData.summary || null)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  if (loading) {
    return (
      <div style={{ padding: 32, textAlign: 'center' }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>💸</div>
        <h2 style={{ color: '#0f2a3e', marginBottom: 8 }}>Loading Cash Flow Intelligence...</h2>
        <p style={{ color: '#666' }}>Analyzing receivables, payables, and working capital</p>
      </div>
    )
  }

  if (error) {
    return (
      <div style={{ padding: 32, textAlign: 'center' }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>⚠️</div>
        <h2 style={{ color: '#c0392b', marginBottom: 8 }}>Error</h2>
        <p style={{ color: '#666', marginBottom: 16 }}>{error}</p>
        <button onClick={fetchData} style={{ padding: '8px 24px', background: '#0f2a3e', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer' }}>Retry</button>
      </div>
    )
  }

  // Compute KPIs
  const healthScore = Math.min(100, Math.round(
    (metrics.currentRatio >= 2 ? 30 : metrics.currentRatio * 15) +
    (metrics.quickRatio >= 1 ? 20 : metrics.quickRatio * 20) +
    (collectionSummary.averageDSO <= 30 ? 25 : Math.max(0, 25 - (collectionSummary.averageDSO - 30))) +
    (metrics.ccc <= 60 ? 25 : Math.max(0, 25 - (metrics.ccc - 60) * 0.5))
  ))
  const healthColor = healthScore >= 75 ? '#27ae60' : healthScore >= 50 ? '#C6A24E' : '#e74c3c'

  return (
    <div style={{ padding: '24px 32px', maxWidth: 1400, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 28, fontWeight: 700, color: '#0f2a3e', margin: 0 }}>💸 Cash Flow Command Center</h1>
          <p style={{ color: '#666', margin: '4px 0 0' }}>Collections intelligence, payment optimization, working capital forecasting</p>
        </div>
        <button onClick={fetchData} style={{ padding: '10px 20px', background: '#0f2a3e', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 600, fontSize: 14 }}>
          🔄 Refresh
        </button>
      </div>

      {/* KPI Strip */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 14, marginBottom: 24 }}>
        <KPICard label="Cash Health" value={`${healthScore}/100`} icon="❤️" color={healthColor} />
        <KPICard label="Working Capital" value={formatCurrency(position.workingCapital)} icon="💰" color="#0f2a3e" />
        <KPICard label="Total AR" value={formatCurrency(position.totalAR)} subtitle={`${collectionSummary.invoiceCount} invoices`} icon="📥" color="#27ae60" />
        <KPICard label="Total AP" value={formatCurrency(position.totalAP)} icon="📤" color="#e74c3c" />
        <KPICard label="DSO" value={`${metrics.dso} days`} subtitle={`DPO: ${metrics.dpo}d`} icon="⏱️" color="#C6A24E" />
        <KPICard label="Cash Cycle" value={`${metrics.ccc} days`} subtitle={`Ratio: ${metrics.currentRatio.toFixed(1)}x`} icon="🔄" color="#8e44ad" />
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 24, borderBottom: '2px solid #eee' }}>
        {[
          { key: 'overview' as const, label: '📊 Overview' },
          { key: 'collections' as const, label: '📞 Collections' },
          { key: 'terms' as const, label: '📋 Payment Terms' },
          { key: 'forecast' as const, label: '📈 Cash Forecast' },
        ].map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            style={{
              padding: '10px 20px',
              background: activeTab === tab.key ? '#0f2a3e' : 'transparent',
              color: activeTab === tab.key ? '#fff' : '#666',
              border: 'none', borderRadius: '8px 8px 0 0', cursor: 'pointer',
              fontWeight: activeTab === tab.key ? 700 : 500, fontSize: 14,
            }}
          >{tab.label}</button>
        ))}
      </div>

      {activeTab === 'overview' && <OverviewTab position={position} metrics={metrics} aging={aging} collectionSummary={collectionSummary} cashGaps={cashGaps} wcRecs={wcRecs} forecast={forecast} />}
      {activeTab === 'collections' && <CollectionsTab actions={actions} aging={aging} summary={collectionSummary} />}
      {activeTab === 'terms' && <PaymentTermsTab recommendations={termRecs} summary={termSummary} />}
      {activeTab === 'forecast' && <ForecastTab forecast={forecast} cashGaps={cashGaps} position={position} metrics={metrics} />}
    </div>
  )
}

// ─── KPI CARD ──────────────────────────────────────────────────────

function KPICard({ label, value, subtitle, icon, color }: { label: string; value: string; subtitle?: string; icon: string; color: string }) {
  return (
    <div style={{ background: '#fff', borderRadius: 12, padding: '16px 14px', border: '1px solid #e8e8e8', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
        <span style={{ fontSize: 18 }}>{icon}</span>
        <span style={{ fontSize: 11, color: '#888', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</span>
      </div>
      <div style={{ fontSize: 20, fontWeight: 700, color }}>{value}</div>
      {subtitle && <div style={{ fontSize: 11, color: '#999', marginTop: 2 }}>{subtitle}</div>}
    </div>
  )
}

// ─── OVERVIEW TAB ──────────────────────────────────────────────────

function OverviewTab({ position, metrics, aging, collectionSummary, cashGaps, wcRecs, forecast }: {
  position: WorkingCapitalPosition; metrics: WorkingCapitalMetrics; aging: AgingBuckets; collectionSummary: CollectionSummary; cashGaps: CashGap[]; wcRecs: WCRecommendation[]; forecast: ForecastDay[]
}) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
      {/* Working Capital Waterfall */}
      <div style={{ background: '#fff', borderRadius: 12, padding: 20, border: '1px solid #e8e8e8' }}>
        <h3 style={{ margin: '0 0 16px', color: '#0f2a3e', fontSize: 16 }}>💰 Working Capital Breakdown</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <WaterfallBar label="Accounts Receivable" value={position.totalAR} color="#27ae60" max={Math.max(position.totalAR, position.totalAP, position.inventoryValue, 1)} />
          <WaterfallBar label="Inventory" value={position.inventoryValue} color="#3498db" max={Math.max(position.totalAR, position.totalAP, position.inventoryValue, 1)} />
          <WaterfallBar label="Cash on Hand" value={position.cashOnHand} color="#2ecc71" max={Math.max(position.totalAR, position.totalAP, position.inventoryValue, 1)} />
          <div style={{ borderTop: '2px solid #eee', paddingTop: 10 }}>
            <WaterfallBar label="Accounts Payable" value={position.totalAP} color="#e74c3c" max={Math.max(position.totalAR, position.totalAP, position.inventoryValue, 1)} />
          </div>
          <div style={{ borderTop: '2px dashed #0f2a3e', paddingTop: 10, display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ fontWeight: 700, color: '#0f2a3e' }}>Net Working Capital</span>
            <span style={{ fontWeight: 700, color: position.workingCapital >= 0 ? '#27ae60' : '#e74c3c', fontSize: 18 }}>{formatCurrency(position.workingCapital)}</span>
          </div>
        </div>
      </div>

      {/* AR Aging */}
      <div style={{ background: '#fff', borderRadius: 12, padding: 20, border: '1px solid #e8e8e8' }}>
        <h3 style={{ margin: '0 0 16px', color: '#0f2a3e', fontSize: 16 }}>📊 Receivables Aging</h3>
        {collectionSummary.invoiceCount === 0 ? (
          <div style={{ textAlign: 'center', padding: 40, color: '#999' }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>✅</div>
            <p style={{ fontSize: 14 }}>No outstanding invoices — AR is clean</p>
            <p style={{ fontSize: 12, color: '#bbb' }}>Invoices will appear here once issued to builders</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {Object.entries(aging).map(([bucket, data]) => {
              const colors: Record<string, string> = { current: '#27ae60', '1-30': '#D4B96A', '31-60': '#C6A24E', '61-90': '#e74c3c', '90+': '#c0392b' }
              return (
                <div key={bucket} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', background: '#f8f9fa', borderRadius: 6 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ width: 10, height: 10, borderRadius: '50%', background: colors[bucket] || '#999' }} />
                    <span style={{ fontSize: 13, fontWeight: 600 }}>{bucket === 'current' ? 'Current' : `${bucket} days`}</span>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <span style={{ fontWeight: 700, fontSize: 14 }}>{formatCurrency(data.amount)}</span>
                    <span style={{ fontSize: 11, color: '#999', marginLeft: 8 }}>{data.count} inv</span>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Key Metrics */}
      <div style={{ background: '#fff', borderRadius: 12, padding: 20, border: '1px solid #e8e8e8' }}>
        <h3 style={{ margin: '0 0 16px', color: '#0f2a3e', fontSize: 16 }}>⚙️ Financial Health Metrics</h3>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <MetricBox label="Days Sales Outstanding" value={`${metrics.dso}`} unit="days" target="< 30" good={metrics.dso <= 30} />
          <MetricBox label="Days Payable Outstanding" value={`${metrics.dpo}`} unit="days" target="> 30" good={metrics.dpo >= 30} />
          <MetricBox label="Cash Conversion Cycle" value={`${metrics.ccc}`} unit="days" target="< 60" good={metrics.ccc <= 60} />
          <MetricBox label="Current Ratio" value={metrics.currentRatio.toFixed(2)} unit="x" target="> 2.0" good={metrics.currentRatio >= 2} />
          <MetricBox label="Quick Ratio" value={metrics.quickRatio.toFixed(2)} unit="x" target="> 1.0" good={metrics.quickRatio >= 1} />
          <MetricBox label="Overdue Amount" value={formatCurrency(collectionSummary.totalOverdue)} unit="" target="$0" good={collectionSummary.totalOverdue === 0} />
        </div>
      </div>

      {/* AI Recommendations */}
      <div style={{ background: '#fff', borderRadius: 12, padding: 20, border: '1px solid #e8e8e8' }}>
        <h3 style={{ margin: '0 0 16px', color: '#C6A24E', fontSize: 16 }}>🤖 AI Recommendations</h3>
        {wcRecs.length === 0 ? (
          <p style={{ color: '#999', fontSize: 13, textAlign: 'center', padding: 20 }}>No recommendations at this time</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {wcRecs.map((rec, i) => {
              const priorityColors: Record<string, string> = { HIGH: '#e74c3c', MEDIUM: '#C6A24E', LOW: '#27ae60' }
              return (
                <div key={i} style={{ padding: 14, background: '#fff8f0', borderRadius: 8, border: '1px solid #fde8d0' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                    <span style={{ fontWeight: 700, fontSize: 13 }}>{rec.title}</span>
                    <span style={{ fontSize: 11, background: priorityColors[rec.priority] || '#888', color: '#fff', padding: '2px 8px', borderRadius: 10, fontWeight: 600 }}>
                      {rec.priority}
                    </span>
                  </div>
                  <p style={{ fontSize: 12, color: '#666', margin: 0 }}>{rec.description}</p>
                  {rec.impact !== 0 && (
                    <div style={{ fontSize: 12, color: '#C6A24E', fontWeight: 600, marginTop: 4 }}>
                      Impact: {formatCurrency(Math.abs(rec.impact))} {rec.impact > 0 ? 'saved' : 'at risk'}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── COLLECTIONS TAB ───────────────────────────────────────────────

function CollectionsTab({ actions, aging, summary }: { actions: CollectionAction[]; aging: AgingBuckets; summary: CollectionSummary }) {
  if (actions.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: 60 }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>✅</div>
        <h3 style={{ color: '#27ae60', marginBottom: 8 }}>All Clear — No Outstanding Collections</h3>
        <p style={{ color: '#888', maxWidth: 400, margin: '0 auto' }}>
          When invoices are issued and become overdue, the AI will prioritize them here with recommended actions, channels, and escalation paths.
        </p>
      </div>
    )
  }

  return (
    <div>
      {/* Summary */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 20 }}>
        <div style={{ background: '#fff', borderRadius: 12, padding: 16, border: '1px solid #e8e8e8', textAlign: 'center' }}>
          <div style={{ fontSize: 24, fontWeight: 700, color: '#0f2a3e' }}>{formatCurrency(summary.totalAccountsReceivable)}</div>
          <div style={{ fontSize: 11, color: '#888' }}>Total AR</div>
        </div>
        <div style={{ background: '#fff', borderRadius: 12, padding: 16, border: '1px solid #e8e8e8', textAlign: 'center' }}>
          <div style={{ fontSize: 24, fontWeight: 700, color: '#e74c3c' }}>{formatCurrency(summary.totalOverdue)}</div>
          <div style={{ fontSize: 11, color: '#888' }}>Overdue</div>
        </div>
        <div style={{ background: '#fde2e2', borderRadius: 12, padding: 16, border: '1px solid #fbb', textAlign: 'center' }}>
          <div style={{ fontSize: 24, fontWeight: 700, color: '#c0392b' }}>{summary.criticalCount}</div>
          <div style={{ fontSize: 11, color: '#888' }}>Critical (60+ days)</div>
        </div>
        <div style={{ background: '#fff3cd', borderRadius: 12, padding: 16, border: '1px solid #ffc107', textAlign: 'center' }}>
          <div style={{ fontSize: 24, fontWeight: 700, color: '#C6A24E' }}>{summary.highCount}</div>
          <div style={{ fontSize: 11, color: '#888' }}>High Priority</div>
        </div>
      </div>

      {/* Action List */}
      <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e8e8e8', overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: '#f8f9fa', borderBottom: '2px solid #eee' }}>
              <th style={{ textAlign: 'left', padding: '10px 12px', color: '#666', fontWeight: 600 }}>Invoice</th>
              <th style={{ textAlign: 'left', padding: '10px 8px', color: '#666', fontWeight: 600 }}>Builder</th>
              <th style={{ textAlign: 'right', padding: '10px 8px', color: '#666', fontWeight: 600 }}>Amount Due</th>
              <th style={{ textAlign: 'center', padding: '10px 8px', color: '#666', fontWeight: 600 }}>Days Over</th>
              <th style={{ textAlign: 'center', padding: '10px 8px', color: '#666', fontWeight: 600 }}>Urgency</th>
              <th style={{ textAlign: 'left', padding: '10px 8px', color: '#666', fontWeight: 600 }}>Action</th>
            </tr>
          </thead>
          <tbody>
            {actions.map((a, i) => (
              <tr key={i} style={{ borderBottom: '1px solid #f0f0f0' }}>
                <td style={{ padding: '10px 12px', fontWeight: 600 }}>{a.invoiceNumber}</td>
                <td style={{ padding: '10px 8px' }}>{a.builderName}</td>
                <td style={{ textAlign: 'right', padding: '10px 8px', fontWeight: 600 }}>{formatCurrency(a.amountDue)}</td>
                <td style={{ textAlign: 'center', padding: '10px 8px', color: a.daysOverdue > 30 ? '#e74c3c' : '#C6A24E' }}>{a.daysOverdue}d</td>
                <td style={{ textAlign: 'center', padding: '10px 8px' }}><UrgencyBadge urgency={a.urgency} /></td>
                <td style={{ padding: '10px 8px', fontSize: 12, color: '#666' }}>{a.suggestedAction}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─── PAYMENT TERMS TAB ─────────────────────────────────────────────

function PaymentTermsTab({ recommendations, summary }: { recommendations: PaymentTermRec[]; summary: any }) {
  if (recommendations.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: 60 }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>📋</div>
        <h3 style={{ color: '#0f2a3e', marginBottom: 8 }}>Payment Term Analysis</h3>
        <p style={{ color: '#888', maxWidth: 400, margin: '0 auto' }}>
          Once builders have invoice payment history, the AI will analyze their patterns and recommend optimal payment terms to improve cash flow.
        </p>
        <p style={{ color: '#bbb', fontSize: 12, marginTop: 12 }}>
          The system considers: average days to pay, on-time rate, builder lifetime value, and credit risk to generate smart term recommendations.
        </p>
      </div>
    )
  }

  return (
    <div>
      {summary && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 20 }}>
          <div style={{ background: '#fff', borderRadius: 12, padding: 16, border: '1px solid #e8e8e8', textAlign: 'center' }}>
            <div style={{ fontSize: 24, fontWeight: 700, color: '#0f2a3e' }}>{recommendations.length}</div>
            <div style={{ fontSize: 11, color: '#888' }}>Term Recommendations</div>
          </div>
          <div style={{ background: '#fff', borderRadius: 12, padding: 16, border: '1px solid #e8e8e8', textAlign: 'center' }}>
            <div style={{ fontSize: 24, fontWeight: 700, color: '#27ae60' }}>{formatCurrency(recommendations.reduce((s, r) => s + r.estimatedCashImpact, 0))}</div>
            <div style={{ fontSize: 11, color: '#888' }}>Potential Cash Impact</div>
          </div>
          <div style={{ background: '#fff', borderRadius: 12, padding: 16, border: '1px solid #e8e8e8', textAlign: 'center' }}>
            <div style={{ fontSize: 24, fontWeight: 700, color: '#C6A24E' }}>{(recommendations.reduce((s, r) => s + r.onTimeRate, 0) / recommendations.length * 100).toFixed(0)}%</div>
            <div style={{ fontSize: 11, color: '#888' }}>Avg On-Time Rate</div>
          </div>
        </div>
      )}

      <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e8e8e8', overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: '#f8f9fa', borderBottom: '2px solid #eee' }}>
              <th style={{ textAlign: 'left', padding: '10px 12px', color: '#666', fontWeight: 600 }}>Builder</th>
              <th style={{ textAlign: 'center', padding: '10px 8px', color: '#666', fontWeight: 600 }}>Current</th>
              <th style={{ textAlign: 'center', padding: '10px 8px', color: '#666', fontWeight: 600 }}>→</th>
              <th style={{ textAlign: 'center', padding: '10px 8px', color: '#666', fontWeight: 600 }}>Recommended</th>
              <th style={{ textAlign: 'center', padding: '10px 8px', color: '#666', fontWeight: 600 }}>Avg Days</th>
              <th style={{ textAlign: 'right', padding: '10px 8px', color: '#666', fontWeight: 600 }}>Cash Impact</th>
              <th style={{ textAlign: 'left', padding: '10px 8px', color: '#666', fontWeight: 600 }}>Reasoning</th>
            </tr>
          </thead>
          <tbody>
            {recommendations.map((r, i) => (
              <tr key={i} style={{ borderBottom: '1px solid #f0f0f0' }}>
                <td style={{ padding: '10px 12px', fontWeight: 600 }}>{r.builderName}</td>
                <td style={{ textAlign: 'center', padding: '10px 8px' }}><TermBadge term={r.currentTerm} /></td>
                <td style={{ textAlign: 'center', padding: '10px 8px', color: '#999' }}>→</td>
                <td style={{ textAlign: 'center', padding: '10px 8px' }}><TermBadge term={r.recommendedTerm} highlight /></td>
                <td style={{ textAlign: 'center', padding: '10px 8px' }}>{r.avgPaymentDays.toFixed(0)}d</td>
                <td style={{ textAlign: 'right', padding: '10px 8px', fontWeight: 700, color: r.estimatedCashImpact > 0 ? '#27ae60' : '#e74c3c' }}>{formatCurrency(r.estimatedCashImpact)}</td>
                <td style={{ padding: '10px 8px', fontSize: 11, color: '#666', maxWidth: 200 }}>{r.reasoning}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─── FORECAST TAB ──────────────────────────────────────────────────

function ForecastTab({ forecast, cashGaps, position, metrics }: { forecast: ForecastDay[]; cashGaps: CashGap[]; position: WorkingCapitalPosition; metrics: WorkingCapitalMetrics }) {
  const maxVal = Math.max(...forecast.map(f => Math.abs(f.runningBalance)), 1)

  return (
    <div>
      {/* Cash Gaps Alert */}
      {cashGaps.length > 0 && (
        <div style={{ background: '#fde2e2', borderRadius: 12, padding: 16, marginBottom: 20, border: '1px solid #fbb' }}>
          <h4 style={{ margin: '0 0 8px', color: '#c0392b', fontSize: 14 }}>⚠️ Cash Gap Alert — {cashGaps.length} period{cashGaps.length > 1 ? 's' : ''} of projected shortfall</h4>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            {cashGaps.map((gap, i) => (
              <div key={i} style={{ background: '#fff', padding: '8px 14px', borderRadius: 6, border: '1px solid #fbb' }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: '#c0392b' }}>Day {gap.startDay}–{gap.endDay}</div>
                <div style={{ fontSize: 11, color: '#888' }}>Low: {formatCurrency(gap.lowestBalance)} · Shortfall: {formatCurrency(gap.shortfall)}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Forecast Chart (simplified bar chart) */}
      <div style={{ background: '#fff', borderRadius: 12, padding: 20, border: '1px solid #e8e8e8', marginBottom: 20 }}>
        <h3 style={{ margin: '0 0 16px', color: '#0f2a3e', fontSize: 16 }}>📈 90-Day Cash Flow Forecast</h3>
        {forecast.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 40, color: '#999' }}>
            <p>Forecast will populate as invoices and POs are processed</p>
          </div>
        ) : (
          <div>
            <div style={{ display: 'flex', alignItems: 'end', gap: 1, height: 200, padding: '0 4px' }}>
              {forecast.slice(0, 90).map((day, i) => {
                const pct = Math.abs(day.runningBalance) / maxVal * 100
                const isNeg = day.runningBalance < 0
                return (
                  <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', height: '100%' }} title={`Day ${day.day}: ${formatCurrency(day.runningBalance)}`}>
                    <div style={{
                      width: '100%',
                      height: `${Math.max(2, pct)}%`,
                      background: isNeg ? '#e74c3c' : day.runningBalance > position.workingCapital * 0.5 ? '#27ae60' : '#C6A24E',
                      borderRadius: '2px 2px 0 0',
                      minHeight: 2,
                    }} />
                  </div>
                )
              })}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4, fontSize: 10, color: '#999' }}>
              <span>Day 1</span>
              <span>Day 30</span>
              <span>Day 60</span>
              <span>Day 90</span>
            </div>
          </div>
        )}
      </div>

      {/* Key metrics */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
        <div style={{ background: '#fff', borderRadius: 12, padding: 20, border: '1px solid #e8e8e8' }}>
          <h4 style={{ margin: '0 0 12px', color: '#0f2a3e', fontSize: 14 }}>📊 Current Position</h4>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: '#666', fontSize: 13 }}>Cash on Hand</span><span style={{ fontWeight: 700 }}>{formatCurrency(position.cashOnHand)}</span></div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: '#666', fontSize: 13 }}>Receivables</span><span style={{ fontWeight: 700, color: '#27ae60' }}>{formatCurrency(position.totalAR)}</span></div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: '#666', fontSize: 13 }}>Payables</span><span style={{ fontWeight: 700, color: '#e74c3c' }}>({formatCurrency(position.totalAP)})</span></div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: '#666', fontSize: 13 }}>Inventory</span><span style={{ fontWeight: 700 }}>{formatCurrency(position.inventoryValue)}</span></div>
          </div>
        </div>
        <div style={{ background: '#fff', borderRadius: 12, padding: 20, border: '1px solid #e8e8e8' }}>
          <h4 style={{ margin: '0 0 12px', color: '#0f2a3e', fontSize: 14 }}>🔄 Cash Conversion</h4>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: '#666', fontSize: 13 }}>DSO</span><span style={{ fontWeight: 700 }}>{metrics.dso} days</span></div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: '#666', fontSize: 13 }}>DPO</span><span style={{ fontWeight: 700 }}>{metrics.dpo} days</span></div>
            <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid #eee', paddingTop: 8 }}><span style={{ color: '#0f2a3e', fontSize: 13, fontWeight: 600 }}>Cash Cycle</span><span style={{ fontWeight: 700, color: '#0f2a3e' }}>{metrics.ccc} days</span></div>
          </div>
        </div>
        <div style={{ background: '#fff', borderRadius: 12, padding: 20, border: '1px solid #e8e8e8' }}>
          <h4 style={{ margin: '0 0 12px', color: '#0f2a3e', fontSize: 14 }}>📐 Ratios</h4>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: '#666', fontSize: 13 }}>Current Ratio</span><span style={{ fontWeight: 700, color: metrics.currentRatio >= 2 ? '#27ae60' : '#C6A24E' }}>{metrics.currentRatio.toFixed(2)}x</span></div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: '#666', fontSize: 13 }}>Quick Ratio</span><span style={{ fontWeight: 700, color: metrics.quickRatio >= 1 ? '#27ae60' : '#e74c3c' }}>{metrics.quickRatio.toFixed(2)}x</span></div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: '#666', fontSize: 13 }}>Target</span><span style={{ fontSize: 12, color: '#999' }}>Current &gt;2x, Quick &gt;1x</span></div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── SHARED COMPONENTS ─────────────────────────────────────────────

function WaterfallBar({ label, value, color, max }: { label: string; value: number; color: string; max: number }) {
  const pct = Math.min(100, (value / max) * 100)
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
        <span style={{ fontSize: 13, fontWeight: 600 }}>{label}</span>
        <span style={{ fontSize: 13, fontWeight: 700, color }}>{formatCurrency(value)}</span>
      </div>
      <div style={{ height: 8, background: '#f0f0f0', borderRadius: 4, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: 4, transition: 'width 0.5s' }} />
      </div>
    </div>
  )
}

function MetricBox({ label, value, unit, target, good }: { label: string; value: string; unit: string; target: string; good: boolean }) {
  return (
    <div style={{ padding: 12, background: good ? '#f0fdf4' : '#fef9f0', borderRadius: 8, border: `1px solid ${good ? '#d1fae5' : '#fde8d0'}` }}>
      <div style={{ fontSize: 11, color: '#888', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, color: good ? '#27ae60' : '#C6A24E' }}>{value}<span style={{ fontSize: 12, fontWeight: 400 }}> {unit}</span></div>
      <div style={{ fontSize: 10, color: '#bbb' }}>Target: {target}</div>
    </div>
  )
}

function UrgencyBadge({ urgency }: { urgency: string }) {
  const config: Record<string, { bg: string; color: string }> = {
    CRITICAL: { bg: '#fde2e2', color: '#c0392b' },
    HIGH: { bg: '#fef3cd', color: '#C6A24E' },
    MEDIUM: { bg: '#fff3e0', color: '#D4B96A' },
    LOW: { bg: '#d4edda', color: '#27ae60' },
    NOT_DUE: { bg: '#e3f2fd', color: '#1976d2' },
  }
  const c = config[urgency] || config.LOW
  return <span style={{ fontSize: 11, background: c.bg, color: c.color, padding: '2px 8px', borderRadius: 10, fontWeight: 600 }}>{urgency}</span>
}

function TermBadge({ term, highlight }: { term: string; highlight?: boolean }) {
  const labels: Record<string, string> = { PAY_AT_ORDER: 'Pay at Order', PAY_ON_DELIVERY: 'Pay on Delivery', NET_15: 'Net 15', NET_30: 'Net 30' }
  return (
    <span style={{
      fontSize: 11, padding: '2px 8px', borderRadius: 10, fontWeight: 600,
      background: highlight ? '#e8f5e9' : '#f0f0f0',
      color: highlight ? '#27ae60' : '#666',
      border: highlight ? '1px solid #c8e6c9' : '1px solid #ddd',
    }}>
      {labels[term] || term}
    </span>
  )
}
