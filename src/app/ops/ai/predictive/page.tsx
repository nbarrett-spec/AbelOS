'use client'

import { useState, useEffect } from 'react'

const TREND_COLORS: Record<string, string> = {
  GROWING: '#27ae60',
  DECLINING: '#e74c3c',
  STABLE: '#3498db',
  INCREASING: '#27ae60',
  DECREASING: '#e74c3c',
}

const BUCKET_COLORS: Record<string, string> = {
  OVERDUE: '#e74c3c',
  DUE_THIS_WEEK: '#C6A24E',
  DUE_2_WEEKS: '#D4B96A',
  DUE_30_DAYS: '#3498db',
  DUE_60_DAYS: '#8e44ad',
  DUE_60_PLUS: '#95a5a6',
  DUE_30_PLUS: '#95a5a6',
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

function MiniBar({ value, max, color, height = 20 }: { value: number; max: number; color: string; height?: number }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0
  return (
    <div style={{ height, background: '#f0f0f0', borderRadius: 4, overflow: 'hidden', minWidth: 80 }}>
      <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 4, minWidth: value > 0 ? 20 : 0 }} />
    </div>
  )
}

export default function PredictiveAnalyticsPage() {
  const [tab, setTab] = useState('dashboard')
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    fetch(`/api/ops/ai/predictive?report=${tab}`)
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [tab])

  const tabs = [
    { id: 'dashboard', label: 'Overview' },
    { id: 'revenue-forecast', label: 'Revenue Forecast' },
    { id: 'demand-prediction', label: 'Demand Prediction' },
    { id: 'seasonal-patterns', label: 'Seasonal Patterns' },
    { id: 'builder-predictions', label: 'Builder Predictions' },
    { id: 'cash-flow', label: 'Cash Flow' },
  ]

  return (
    <div style={{ padding: '24px 32px', maxWidth: 1400 }}>
      <h1 style={{ fontSize: 24, fontWeight: 600, color: '#0f2a3e', marginBottom: 4 }}>AI Predictive Analytics</h1>
      <p style={{ color: '#666', fontSize: 14, marginBottom: 20 }}>Revenue forecasting, demand prediction, behavioral models, and cash flow projections</p>

      <div style={{ display: 'flex', gap: 4, marginBottom: 24, flexWrap: 'wrap' }}>
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            style={{ padding: '8px 18px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: tab === t.id ? 700 : 500, background: tab === t.id ? '#0f2a3e' : '#f0f0f0', color: tab === t.id ? '#fff' : '#444' }}>
            {t.label}
          </button>
        ))}
      </div>

      {loading ? <div style={{ textAlign: 'center', padding: 60, color: '#999' }}>Analyzing data...</div> : (
        <>
          {tab === 'dashboard' && data && <DashboardView data={data} />}
          {tab === 'revenue-forecast' && data && <RevenueForecastView data={data} />}
          {tab === 'demand-prediction' && data && <DemandView data={data} />}
          {tab === 'seasonal-patterns' && data && <SeasonalView data={data} />}
          {tab === 'builder-predictions' && data && <BuilderPredView data={data} />}
          {tab === 'cash-flow' && data && <CashFlowView data={data} />}
        </>
      )}
    </div>
  )
}

function DashboardView({ data }: { data: any }) {
  const cp = data.currentPeriod || {}
  const pl = data.pipeline || {}
  const gr = data.growthRate || 0

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16, marginBottom: 24 }}>
        <KPICard label="This Month" value={`$${Number(cp.thisMonthRevenue || 0).toLocaleString()}`} sub={`${cp.thisMonthOrders || 0} orders`} />
        <KPICard label="Projected Month-End" value={`$${Number(data.projectedMonthEnd || 0).toLocaleString()}`} color="#8e44ad" sub="Linear projection" />
        <KPICard label="Growth Rate" value={`${gr > 0 ? '+' : ''}${gr}%`} color={gr >= 0 ? '#27ae60' : '#e74c3c'} sub="Month over month" />
        <KPICard label="Weighted Pipeline" value={`$${Number(pl.weightedPipeline || 0).toLocaleString()}`} color="#C6A24E" sub={`${pl.conversionRate || 0}% conv rate`} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 24 }}>
        <KPICard label="YTD Revenue" value={`$${Number(cp.ytdRevenue || 0).toLocaleString()}`} sub={`vs $${Number(cp.lastYearSamePeriod || 0).toLocaleString()} last year`} color="#0f2a3e" />
        <KPICard label="This Quarter" value={`$${Number(cp.thisQuarterRevenue || 0).toLocaleString()}`} sub={`vs $${Number(cp.lastQuarterRevenue || 0).toLocaleString()} last quarter`} color="#3498db" />
      </div>

      <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12, color: '#0f2a3e' }}>6-Month Trajectory</h3>
      <div style={{ background: '#fff', borderRadius: 10, overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.07)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: '#f8f9fa' }}>
              <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600 }}>Month</th>
              <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600 }}>Revenue</th>
              <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600 }}>Orders</th>
              <th style={{ padding: '10px 14px', fontWeight: 600, width: 200 }}>Revenue</th>
            </tr>
          </thead>
          <tbody>
            {(data.trajectory || []).map((t: any, i: number) => {
              const maxRev = Math.max(1, ...((data.trajectory || []).map((x: any) => Number(x.revenue || 0))))
              return (
                <tr key={i} style={{ borderTop: '1px solid #eee', background: i % 2 ? '#fafafa' : '#fff' }}>
                  <td style={{ padding: '10px 14px', fontWeight: 600 }}>{new Date(t.month).toLocaleDateString('en-US', { year: 'numeric', month: 'short' })}</td>
                  <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600 }}>${Number(t.revenue || 0).toLocaleString()}</td>
                  <td style={{ padding: '10px 14px', textAlign: 'right' }}>{Number(t.orders)}</td>
                  <td style={{ padding: '10px 14px' }}><MiniBar value={Number(t.revenue || 0)} max={maxRev} color="#0f2a3e" /></td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function RevenueForecastView({ data }: { data: any }) {
  const all = [...(data.historical || []), ...(data.forecast || [])]
  const maxRev = Math.max(1, ...all.map((r: any) => Number(r.optimistic || r.revenue || 0)))

  return (
    <div>
      <div style={{ background: '#fffbe6', borderRadius: 8, padding: '12px 16px', marginBottom: 20, fontSize: 13, color: '#856404', border: '1px solid #ffc107' }}>
        Model: {data.model?.type} — Confidence: {data.model?.confidence} — Based on: {data.model?.basedOn}
      </div>

      <div style={{ background: '#fff', borderRadius: 10, overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.07)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: '#f8f9fa' }}>
              <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600 }}>Month</th>
              <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600 }}>Type</th>
              <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600 }}>Revenue</th>
              <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600 }}>Optimistic</th>
              <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600 }}>Pessimistic</th>
              <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600 }}>Orders</th>
              <th style={{ padding: '10px 14px', fontWeight: 600, width: 200 }}>Range</th>
            </tr>
          </thead>
          <tbody>
            {all.map((r: any, i: number) => {
              const isForecast = r.type === 'forecast'
              return (
                <tr key={i} style={{ borderTop: '1px solid #eee', background: isForecast ? '#f0f7ff' : (i % 2 ? '#fafafa' : '#fff') }}>
                  <td style={{ padding: '10px 14px', fontWeight: 600 }}>{new Date(r.month).toLocaleDateString('en-US', { year: 'numeric', month: 'short' })}</td>
                  <td style={{ padding: '10px 14px' }}><Badge text={isForecast ? 'FORECAST' : 'ACTUAL'} color={isForecast ? '#8e44ad' : '#27ae60'} /></td>
                  <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 700, color: isForecast ? '#8e44ad' : '#0f2a3e' }}>
                    ${Number(isForecast ? r.projected : r.revenue || 0).toLocaleString()}
                  </td>
                  <td style={{ padding: '10px 14px', textAlign: 'right', color: '#27ae60' }}>{isForecast ? `$${Number(r.optimistic).toLocaleString()}` : '—'}</td>
                  <td style={{ padding: '10px 14px', textAlign: 'right', color: '#e74c3c' }}>{isForecast ? `$${Number(r.pessimistic).toLocaleString()}` : '—'}</td>
                  <td style={{ padding: '10px 14px', textAlign: 'right' }}>{r.orders || '—'}</td>
                  <td style={{ padding: '10px 14px' }}>
                    <MiniBar value={Number(isForecast ? r.projected : r.revenue || 0)} max={maxRev} color={isForecast ? '#8e44ad' : '#0f2a3e'} />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function DemandView({ data }: { data: any }) {
  return (
    <div>
      <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12, color: '#0f2a3e' }}>Category Demand Trends</h3>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16, marginBottom: 24 }}>
        {(data.categoryForecasts || []).slice(0, 12).map((c: any) => (
          <div key={c.category} style={{ background: '#fff', borderRadius: 10, padding: 18, boxShadow: '0 1px 4px rgba(0,0,0,0.07)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <h4 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>{c.category}</h4>
              <Badge text={c.direction} color={TREND_COLORS[c.direction] || '#999'} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 13 }}>
              <div>Avg/mo: <strong>{c.avgMonthlyUnits} units</strong></div>
              <div>Rev/mo: <strong>${c.avgMonthlyRevenue.toLocaleString()}</strong></div>
              <div>Trend: <strong style={{ color: TREND_COLORS[c.direction] || '#999' }}>{c.trend > 0 ? '+' : ''}{c.trend}%</strong></div>
            </div>
          </div>
        ))}
      </div>

      <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12, color: '#0f2a3e' }}>Top Products by Demand</h3>
      <div style={{ background: '#fff', borderRadius: 10, overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.07)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: '#f8f9fa' }}>
              <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600 }}>Product</th>
              <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600 }}>Category</th>
              <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600 }}>Units Sold</th>
              <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600 }}>Revenue</th>
              <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600 }}>Buyers</th>
              <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600 }}>Avg/mo</th>
            </tr>
          </thead>
          <tbody>
            {(data.topProducts || []).map((p: any, i: number) => (
              <tr key={p.id} style={{ borderTop: '1px solid #eee', background: i % 2 ? '#fafafa' : '#fff' }}>
                <td style={{ padding: '10px 14px' }}>
                  <div style={{ fontWeight: 600 }}>{p.name}</div>
                  <div style={{ fontSize: 11, color: '#999' }}>{p.sku}</div>
                </td>
                <td style={{ padding: '10px 14px', fontSize: 12 }}>{p.category}</td>
                <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600 }}>{Number(p.totalSold)}</td>
                <td style={{ padding: '10px 14px', textAlign: 'right' }}>${Number(p.totalRevenue || 0).toLocaleString()}</td>
                <td style={{ padding: '10px 14px', textAlign: 'right' }}>{Number(p.uniqueBuyers)}</td>
                <td style={{ padding: '10px 14px', textAlign: 'right' }}>{p.avgMonthlyUnits}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function SeasonalView({ data }: { data: any }) {
  const qt = data.quoteTiming || {}
  const maxDow = Math.max(1, ...(data.dayOfWeek || []).map((d: any) => Number(d.revenue || 0)))
  const maxMonth = Math.max(1, ...(data.monthlyPattern || []).map((m: any) => Number(m.revenue || 0)))

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 24 }}>
        <KPICard label="Avg Quote→Order" value={`${qt.avgDaysQuoteToOrder || '—'} days`} color="#8e44ad" />
        <KPICard label="Median" value={`${qt.medianDays || '—'} days`} color="#3498db" />
        <KPICard label="Fastest" value={`${qt.minDays || '—'} days`} color="#27ae60" />
        <KPICard label="Slowest" value={`${qt.maxDays || '—'} days`} color="#e74c3c" />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 24 }}>
        <div>
          <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12, color: '#0f2a3e' }}>Day of Week</h3>
          <div style={{ background: '#fff', borderRadius: 10, overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.07)' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead><tr style={{ background: '#f8f9fa' }}>
                <th style={{ padding: '8px 14px', textAlign: 'left', fontWeight: 600 }}>Day</th>
                <th style={{ padding: '8px 14px', textAlign: 'right', fontWeight: 600 }}>Orders</th>
                <th style={{ padding: '8px 14px', textAlign: 'right', fontWeight: 600 }}>Revenue</th>
                <th style={{ padding: '8px 14px', fontWeight: 600, width: 100 }}></th>
              </tr></thead>
              <tbody>
                {(data.dayOfWeek || []).map((d: any, i: number) => (
                  <tr key={i} style={{ borderTop: '1px solid #eee' }}>
                    <td style={{ padding: '8px 14px', fontWeight: 600 }}>{(d.dayName || '').trim()}</td>
                    <td style={{ padding: '8px 14px', textAlign: 'right' }}>{Number(d.orders)}</td>
                    <td style={{ padding: '8px 14px', textAlign: 'right', fontWeight: 600 }}>${Number(d.revenue || 0).toLocaleString()}</td>
                    <td style={{ padding: '8px 14px' }}><MiniBar value={Number(d.revenue || 0)} max={maxDow} color="#C6A24E" height={14} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div>
          <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12, color: '#0f2a3e' }}>Monthly Seasonality</h3>
          <div style={{ background: '#fff', borderRadius: 10, overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.07)' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead><tr style={{ background: '#f8f9fa' }}>
                <th style={{ padding: '8px 14px', textAlign: 'left', fontWeight: 600 }}>Month</th>
                <th style={{ padding: '8px 14px', textAlign: 'right', fontWeight: 600 }}>Orders</th>
                <th style={{ padding: '8px 14px', textAlign: 'right', fontWeight: 600 }}>Revenue</th>
                <th style={{ padding: '8px 14px', fontWeight: 600, width: 100 }}></th>
              </tr></thead>
              <tbody>
                {(data.monthlyPattern || []).map((m: any, i: number) => (
                  <tr key={i} style={{ borderTop: '1px solid #eee' }}>
                    <td style={{ padding: '8px 14px', fontWeight: 600 }}>{(m.monthName || '').trim()}</td>
                    <td style={{ padding: '8px 14px', textAlign: 'right' }}>{Number(m.orders)}</td>
                    <td style={{ padding: '8px 14px', textAlign: 'right', fontWeight: 600 }}>${Number(m.revenue || 0).toLocaleString()}</td>
                    <td style={{ padding: '8px 14px' }}><MiniBar value={Number(m.revenue || 0)} max={maxMonth} color="#0f2a3e" height={14} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {(data.hourOfDay || []).length > 0 && (
        <>
          <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12, color: '#0f2a3e' }}>Hour of Day Activity</h3>
          <div style={{ background: '#fff', borderRadius: 10, padding: 20, boxShadow: '0 1px 4px rgba(0,0,0,0.07)', display: 'flex', gap: 4, alignItems: 'flex-end', height: 160 }}>
            {(data.hourOfDay || []).map((h: any) => {
              const maxH = Math.max(1, ...(data.hourOfDay || []).map((x: any) => Number(x.orders || 0)))
              const pct = (Number(h.orders) / maxH) * 100
              return (
                <div key={h.hour} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                  <div style={{ width: '100%', background: '#0f2a3e', borderRadius: '4px 4px 0 0', height: `${pct}%`, minHeight: Number(h.orders) > 0 ? 4 : 0 }} />
                  <span style={{ fontSize: 10, color: '#999' }}>{h.hour}</span>
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}

function BuilderPredView({ data }: { data: any }) {
  const s = data.summary || {}
  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16, marginBottom: 24 }}>
        <KPICard label="Tracked Builders" value={s.total || 0} sub="2+ orders" />
        <KPICard label="Order Overdue" value={s.overdue || 0} color="#e74c3c" sub="Past predicted date" />
        <KPICard label="Spend Increasing" value={s.increasing || 0} color="#27ae60" />
        <KPICard label="Spend Decreasing" value={s.decreasing || 0} color="#e74c3c" />
      </div>

      <div style={{ background: '#fff', borderRadius: 10, overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.07)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: '#f8f9fa' }}>
              <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600 }}>Builder</th>
              <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600 }}>Trend</th>
              <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600 }}>Orders</th>
              <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600 }}>Avg Interval</th>
              <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600 }}>Last Order</th>
              <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600 }}>Predicted Next</th>
              <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600 }}>Predicted Value</th>
              <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600 }}>Total Spend</th>
            </tr>
          </thead>
          <tbody>
            {(data.predictions || []).slice(0, 40).map((p: any, i: number) => (
              <tr key={p.id} style={{ borderTop: '1px solid #eee', background: p.orderOverdue ? '#fdf2f2' : (i % 2 ? '#fafafa' : '#fff') }}>
                <td style={{ padding: '10px 14px' }}>
                  <div style={{ fontWeight: 600 }}>{p.companyName}</div>
                  <div style={{ fontSize: 11, color: '#999' }}>{p.contactName}</div>
                </td>
                <td style={{ padding: '10px 14px' }}><Badge text={p.spendTrend} color={TREND_COLORS[p.spendTrend] || '#999'} /></td>
                <td style={{ padding: '10px 14px', textAlign: 'right' }}>{Number(p.orderCount)}</td>
                <td style={{ padding: '10px 14px', textAlign: 'right' }}>{Number(p.avgDaysBetweenOrders)} days</td>
                <td style={{ padding: '10px 14px', fontSize: 12 }}>{p.lastOrderDate ? new Date(p.lastOrderDate).toLocaleDateString() : '—'}</td>
                <td style={{ padding: '10px 14px', fontSize: 12 }}>
                  {p.predictedNextOrder ? (
                    <span style={{ color: p.orderOverdue ? '#e74c3c' : '#27ae60', fontWeight: 600 }}>
                      {new Date(p.predictedNextOrder).toLocaleDateString()}
                      {p.orderOverdue && ' (OVERDUE)'}
                    </span>
                  ) : '—'}
                </td>
                <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600, color: '#8e44ad' }}>
                  ${Number(p.predictedOrderValue || 0).toLocaleString()}
                </td>
                <td style={{ padding: '10px 14px', textAlign: 'right' }}>${Number(p.totalSpend || 0).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function CashFlowView({ data }: { data: any }) {
  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 24 }}>
        <KPICard label="Total AR Outstanding" value={`$${Number(data.totalAR || 0).toLocaleString()}`} color="#27ae60" sub="Expected incoming" />
        <KPICard label="Total AP Outstanding" value={`$${Number(data.totalAP || 0).toLocaleString()}`} color="#e74c3c" sub="Expected outgoing" />
      </div>

      <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12, color: '#0f2a3e' }}>8-Week Cash Flow Projection</h3>
      <div style={{ background: '#fff', borderRadius: 10, overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.07)', marginBottom: 24 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: '#f8f9fa' }}>
              <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600 }}>Week Of</th>
              <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600 }}>Incoming (AR)</th>
              <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600 }}>Outgoing (AP)</th>
              <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600 }}>Net Cash Flow</th>
            </tr>
          </thead>
          <tbody>
            {(data.weeklyProjection || []).map((w: any, i: number) => {
              const net = Number(w.netCashFlow || 0)
              return (
                <tr key={i} style={{ borderTop: '1px solid #eee', background: i % 2 ? '#fafafa' : '#fff' }}>
                  <td style={{ padding: '10px 14px', fontWeight: 600 }}>{new Date(w.week_start).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</td>
                  <td style={{ padding: '10px 14px', textAlign: 'right', color: '#27ae60', fontWeight: 600 }}>${Number(w.projectedIncoming || 0).toLocaleString()}</td>
                  <td style={{ padding: '10px 14px', textAlign: 'right', color: '#e74c3c', fontWeight: 600 }}>${Number(w.projectedOutgoing || 0).toLocaleString()}</td>
                  <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 700, color: net >= 0 ? '#27ae60' : '#e74c3c' }}>
                    {net >= 0 ? '+' : ''}${net.toLocaleString()}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
        <div>
          <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12, color: '#27ae60' }}>Accounts Receivable Buckets</h3>
          <div style={{ background: '#fff', borderRadius: 10, overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.07)' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead><tr style={{ background: '#f8f9fa' }}>
                <th style={{ padding: '8px 14px', textAlign: 'left', fontWeight: 600 }}>Bucket</th>
                <th style={{ padding: '8px 14px', textAlign: 'right', fontWeight: 600 }}>Invoices</th>
                <th style={{ padding: '8px 14px', textAlign: 'right', fontWeight: 600 }}>Amount</th>
              </tr></thead>
              <tbody>
                {(data.arProjection || []).map((b: any, i: number) => (
                  <tr key={i} style={{ borderTop: '1px solid #eee' }}>
                    <td style={{ padding: '8px 14px' }}><Badge text={b.bucket?.replace(/_/g, ' ')} color={BUCKET_COLORS[b.bucket] || '#999'} /></td>
                    <td style={{ padding: '8px 14px', textAlign: 'right' }}>{Number(b.invoiceCount)}</td>
                    <td style={{ padding: '8px 14px', textAlign: 'right', fontWeight: 600 }}>${Number(b.totalAmount || 0).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div>
          <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12, color: '#e74c3c' }}>Accounts Payable Buckets</h3>
          <div style={{ background: '#fff', borderRadius: 10, overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.07)' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead><tr style={{ background: '#f8f9fa' }}>
                <th style={{ padding: '8px 14px', textAlign: 'left', fontWeight: 600 }}>Bucket</th>
                <th style={{ padding: '8px 14px', textAlign: 'right', fontWeight: 600 }}>POs</th>
                <th style={{ padding: '8px 14px', textAlign: 'right', fontWeight: 600 }}>Amount</th>
              </tr></thead>
              <tbody>
                {(data.apProjection || []).map((b: any, i: number) => (
                  <tr key={i} style={{ borderTop: '1px solid #eee' }}>
                    <td style={{ padding: '8px 14px' }}><Badge text={b.bucket?.replace(/_/g, ' ')} color={BUCKET_COLORS[b.bucket] || '#999'} /></td>
                    <td style={{ padding: '8px 14px', textAlign: 'right' }}>{Number(b.poCount)}</td>
                    <td style={{ padding: '8px 14px', textAlign: 'right', fontWeight: 600 }}>${Number(b.totalAmount || 0).toLocaleString()}</td>
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
