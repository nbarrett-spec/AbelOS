'use client'

import { useState, useEffect } from 'react'

const BLUE = '#1B4F72'
const ORANGE = '#E67E22'
const WHITE = '#FFFFFF'
const LIGHT_GRAY = '#f8f9fa'
const BORDER_GRAY = '#ddd'

interface ForecastData {
  weightedPipeline: number
  projectedRevenue: { month1: number; month2: number; month3: number }
  avgDealSize: number
  avgDaysToClose: number
}

interface WinLossData {
  winRate: number
  avgWinValue: number
  avgLossValue: number
  totalWon: number
  totalLost: number
  bySource: Array<{ source: string; won: number; lost: number; total: number; winRate: number }>
  byRep: Array<{ repName: string; won: number; lost: number; winRate: number }>
  byQuarter: Array<{ quarter: string; won: number; lost: number; winRate: number }>
  topLossReasons: Array<{ reason: string; count: number }>
}

interface RepScorecard {
  repName: string
  totalDeals: number
  wonDeals: number
  winRate: number
  pipelineValue: number
  wonValue: number
  activityCountLast30: number
}

interface VelocityData {
  currentMonth: {
    month: string
    opportunities: number
    avgDealValue: number
    winRate: number
    avgCycleLength: number
    salesVelocity: number
  }
  monthlyTrend: Array<{
    month: string
    opportunities: number
    avgDealValue: number
    winRate: number
    avgCycleLength: number
    salesVelocity: number
  }>
}

export default function AnalyticsDashboard() {
  const [activeTab, setActiveTab] = useState<'forecast' | 'win_loss' | 'rep_scorecard' | 'velocity'>('forecast')
  const [loading, setLoading] = useState(false)
  const [forecastData, setForecastData] = useState<ForecastData | null>(null)
  const [winLossData, setWinLossData] = useState<WinLossData | null>(null)
  const [scorecardsData, setScorecards] = useState<RepScorecard[]>([])
  const [velocityData, setVelocityData] = useState<VelocityData | null>(null)

  useEffect(() => {
    fetchData(activeTab)
  }, [activeTab])

  const fetchData = async (report: string) => {
    try {
      setLoading(true)
      const res = await fetch(`/api/ops/sales/analytics?report=${report}`)
      const data = await res.json()

      if (report === 'forecast') {
        setForecastData(data)
      } else if (report === 'win_loss') {
        setWinLossData(data)
      } else if (report === 'rep_scorecard') {
        setScorecards(data.scorecards || [])
      } else if (report === 'velocity') {
        setVelocityData(data)
      }
    } catch (err) {
      console.error('Failed to fetch analytics:', err)
    } finally {
      setLoading(false)
    }
  }

  const formatCurrency = (val: number) => {
    return `$${Math.round(val).toLocaleString()}`
  }

  const TabButton = ({ tab, label }: { tab: typeof activeTab; label: string }) => (
    <button
      onClick={() => setActiveTab(tab)}
      style={{
        padding: '0.75rem 1.5rem',
        border: 'none',
        borderBottom: activeTab === tab ? `3px solid ${ORANGE}` : `3px solid transparent`,
        backgroundColor: 'transparent',
        color: activeTab === tab ? BLUE : '#666',
        fontWeight: activeTab === tab ? '600' : '500',
        cursor: 'pointer',
        fontSize: '0.95rem',
        transition: 'all 0.2s',
      }}
    >
      {label}
    </button>
  )

  const StatCard = ({ label, value, subtext }: { label: string; value: string; subtext?: string }) => (
    <div style={{ backgroundColor: WHITE, borderRadius: '8px', padding: '1.25rem', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
      <p style={{ margin: 0, fontSize: '0.85rem', fontWeight: '500', color: '#666', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{label}</p>
      <p style={{ margin: '0.5rem 0 0 0', fontSize: '1.75rem', fontWeight: 'bold', color: BLUE }}>{value}</p>
      {subtext && <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.8rem', color: '#999' }}>{subtext}</p>}
    </div>
  )

  // ─── FORECAST TAB ──────────────────────────────────────────────

  const renderForecast = () => {
    if (!forecastData) return null

    return (
      <div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1.5rem', marginBottom: '2rem' }}>
          <StatCard label="Weighted Pipeline" value={formatCurrency(forecastData.weightedPipeline)} />
          <StatCard label="Avg Deal Size" value={formatCurrency(forecastData.avgDealSize)} />
          <StatCard label="Avg Days to Close" value={`${forecastData.avgDaysToClose}d`} />
          <StatCard label="Total Projected (3mo)" value={formatCurrency(forecastData.projectedRevenue.month1 + forecastData.projectedRevenue.month2 + forecastData.projectedRevenue.month3)} />
        </div>

        <div style={{ backgroundColor: WHITE, borderRadius: '8px', padding: '1.5rem', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
          <h3 style={{ margin: '0 0 1.5rem 0', color: BLUE, fontSize: '1.1rem' }}>3-Month Revenue Projection</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1.5rem' }}>
            <div
              style={{
                backgroundColor: LIGHT_GRAY,
                borderRadius: '8px',
                padding: '1.5rem',
                textAlign: 'center',
                borderLeft: `4px solid ${ORANGE}`,
              }}
            >
              <p style={{ margin: 0, fontSize: '0.85rem', color: '#666', fontWeight: '500' }}>Month 1</p>
              <p style={{ margin: '0.5rem 0 0 0', fontSize: '1.5rem', fontWeight: 'bold', color: BLUE }}>
                {formatCurrency(forecastData.projectedRevenue.month1)}
              </p>
            </div>
            <div
              style={{
                backgroundColor: LIGHT_GRAY,
                borderRadius: '8px',
                padding: '1.5rem',
                textAlign: 'center',
                borderLeft: `4px solid ${ORANGE}`,
              }}
            >
              <p style={{ margin: 0, fontSize: '0.85rem', color: '#666', fontWeight: '500' }}>Month 2</p>
              <p style={{ margin: '0.5rem 0 0 0', fontSize: '1.5rem', fontWeight: 'bold', color: BLUE }}>
                {formatCurrency(forecastData.projectedRevenue.month2)}
              </p>
            </div>
            <div
              style={{
                backgroundColor: LIGHT_GRAY,
                borderRadius: '8px',
                padding: '1.5rem',
                textAlign: 'center',
                borderLeft: `4px solid ${ORANGE}`,
              }}
            >
              <p style={{ margin: 0, fontSize: '0.85rem', color: '#666', fontWeight: '500' }}>Month 3</p>
              <p style={{ margin: '0.5rem 0 0 0', fontSize: '1.5rem', fontWeight: 'bold', color: BLUE }}>
                {formatCurrency(forecastData.projectedRevenue.month3)}
              </p>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // ─── WIN/LOSS TAB ──────────────────────────────────────────────

  const renderWinLoss = () => {
    if (!winLossData) return null

    return (
      <div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem', marginBottom: '2rem' }}>
          {/* Win Rate Donut */}
          <div style={{ backgroundColor: WHITE, borderRadius: '8px', padding: '1.5rem', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
            <h3 style={{ margin: '0 0 1.5rem 0', color: BLUE, fontSize: '1.1rem' }}>Win Rate</h3>
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '200px' }}>
              <div style={{ position: 'relative', width: '150px', height: '150px' }}>
                <svg viewBox="0 0 100 100" style={{ transform: 'rotate(-90deg)' }}>
                  <circle cx="50" cy="50" r="45" fill="none" stroke={LIGHT_GRAY} strokeWidth="10" />
                  <circle
                    cx="50"
                    cy="50"
                    r="45"
                    fill="none"
                    stroke={ORANGE}
                    strokeWidth="10"
                    strokeDasharray={`${winLossData.winRate * 2.827} 282.7`}
                  />
                </svg>
                <div
                  style={{
                    position: 'absolute',
                    top: '50%',
                    left: '50%',
                    transform: 'translate(-50%, -50%)',
                    textAlign: 'center',
                  }}
                >
                  <p style={{ margin: 0, fontSize: '2rem', fontWeight: 'bold', color: BLUE }}>{winLossData.winRate}%</p>
                  <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.85rem', color: '#666' }}>Win Rate</p>
                </div>
              </div>
            </div>
          </div>

          {/* Summary Stats */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <StatCard label="Total Won" value={winLossData.totalWon.toString()} subtext={`Avg: ${formatCurrency(winLossData.avgWinValue)}`} />
            <StatCard label="Total Lost" value={winLossData.totalLost.toString()} subtext={`Avg: ${formatCurrency(winLossData.avgLossValue)}`} />
            <div style={{ backgroundColor: WHITE, borderRadius: '8px', padding: '1.25rem', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
              <p style={{ margin: 0, fontSize: '0.85rem', fontWeight: '500', color: '#666', textTransform: 'uppercase' }}>Avg Win vs Loss</p>
              <div style={{ marginTop: '0.75rem', display: 'flex', gap: '1rem' }}>
                <div style={{ flex: 1 }}>
                  <p style={{ margin: 0, fontSize: '0.75rem', color: '#666' }}>Win</p>
                  <p style={{ margin: '0.25rem 0 0 0', fontSize: '1.3rem', fontWeight: 'bold', color: '#27ae60' }}>
                    {formatCurrency(winLossData.avgWinValue)}
                  </p>
                </div>
                <div style={{ flex: 1 }}>
                  <p style={{ margin: 0, fontSize: '0.75rem', color: '#666' }}>Loss</p>
                  <p style={{ margin: '0.25rem 0 0 0', fontSize: '1.3rem', fontWeight: 'bold', color: '#e74c3c' }}>
                    {formatCurrency(winLossData.avgLossValue)}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Win/Loss by Source */}
        <div style={{ backgroundColor: WHITE, borderRadius: '8px', padding: '1.5rem', boxShadow: '0 1px 3px rgba(0,0,0,0.1)', marginBottom: '1.5rem' }}>
          <h3 style={{ margin: '0 0 1.5rem 0', color: BLUE, fontSize: '1.1rem' }}>Win/Loss by Source</h3>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: `2px solid ${BORDER_GRAY}` }}>
                  <th style={{ textAlign: 'left', padding: '1rem', color: '#666', fontWeight: '600', fontSize: '0.9rem' }}>Source</th>
                  <th style={{ textAlign: 'center', padding: '1rem', color: '#666', fontWeight: '600', fontSize: '0.9rem' }}>Won</th>
                  <th style={{ textAlign: 'center', padding: '1rem', color: '#666', fontWeight: '600', fontSize: '0.9rem' }}>Lost</th>
                  <th style={{ textAlign: 'center', padding: '1rem', color: '#666', fontWeight: '600', fontSize: '0.9rem' }}>Total</th>
                  <th style={{ textAlign: 'center', padding: '1rem', color: '#666', fontWeight: '600', fontSize: '0.9rem' }}>Win Rate</th>
                </tr>
              </thead>
              <tbody>
                {winLossData.bySource.map((row, idx) => (
                  <tr key={idx} style={{ borderBottom: `1px solid ${BORDER_GRAY}` }}>
                    <td style={{ padding: '1rem', color: BLUE }}>{row.source}</td>
                    <td style={{ textAlign: 'center', padding: '1rem', color: '#27ae60', fontWeight: '600' }}>{row.won}</td>
                    <td style={{ textAlign: 'center', padding: '1rem', color: '#e74c3c', fontWeight: '600' }}>{row.lost}</td>
                    <td style={{ textAlign: 'center', padding: '1rem', color: '#666' }}>{row.total}</td>
                    <td
                      style={{
                        textAlign: 'center',
                        padding: '1rem',
                        color: BLUE,
                        fontWeight: '600',
                        backgroundColor: row.winRate > 50 ? '#d4edda' : '#f8d7da',
                        borderRadius: '4px',
                      }}
                    >
                      {row.winRate}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Top Loss Reasons */}
        <div style={{ backgroundColor: WHITE, borderRadius: '8px', padding: '1.5rem', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
          <h3 style={{ margin: '0 0 1.5rem 0', color: BLUE, fontSize: '1.1rem' }}>Top Loss Reasons</h3>
          {winLossData.topLossReasons.length === 0 ? (
            <p style={{ color: '#999', textAlign: 'center' }}>No losses recorded yet</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {winLossData.topLossReasons.map((reason, idx) => (
                <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: '1rem', borderBottom: '1px solid #eee' }}>
                  <span style={{ color: BLUE }}>{reason.reason}</span>
                  <span
                    style={{
                      backgroundColor: '#f8d7da',
                      color: '#721c24',
                      padding: '0.4rem 0.8rem',
                      borderRadius: '4px',
                      fontWeight: '600',
                      fontSize: '0.85rem',
                    }}
                  >
                    {reason.count}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    )
  }

  // ─── REP SCORECARD TAB ──────────────────────────────────────────

  const rankBadges = (won: number, allWon: number[]) => {
    const sorted = [...allWon].sort((a, b) => b - a)
    const rank = sorted.findIndex(w => w === won)
    if (rank === 0) return { badge: '🥇', color: '#f39c12' }
    if (rank === 1) return { badge: '🥈', color: '#95a5a6' }
    if (rank === 2) return { badge: '🥉', color: '#cd7f32' }
    return { badge: '', color: '' }
  }

  const renderRepScorecard = () => {
    if (scorecardsData.length === 0) return <p style={{ color: '#999' }}>No sales reps found</p>

    const allWonValues = scorecardsData.map(s => s.wonValue)

    return (
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '1.5rem' }}>
        {scorecardsData.map((rep, idx) => {
          const { badge } = rankBadges(rep.wonValue, allWonValues)
          return (
            <div
              key={idx}
              style={{
                backgroundColor: WHITE,
                borderRadius: '8px',
                padding: '1.5rem',
                boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
                borderTop: `4px solid ${ORANGE}`,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: '1rem' }}>
                <div>
                  <h4 style={{ margin: 0, color: BLUE, fontSize: '1.1rem' }}>{rep.repName}</h4>
                  <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.85rem', color: '#666' }}>Sales Rep</p>
                </div>
                {badge && <span style={{ fontSize: '1.5rem' }}>{badge}</span>}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem', paddingBottom: '1rem', borderBottom: '1px solid #eee' }}>
                <div>
                  <p style={{ margin: 0, fontSize: '0.75rem', color: '#666', fontWeight: '500', textTransform: 'uppercase' }}>Total Deals</p>
                  <p style={{ margin: '0.25rem 0 0 0', fontSize: '1.5rem', fontWeight: 'bold', color: BLUE }}>{rep.totalDeals}</p>
                </div>
                <div>
                  <p style={{ margin: 0, fontSize: '0.75rem', color: '#666', fontWeight: '500', textTransform: 'uppercase' }}>Won</p>
                  <p style={{ margin: '0.25rem 0 0 0', fontSize: '1.5rem', fontWeight: 'bold', color: '#27ae60' }}>{rep.wonDeals}</p>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem', paddingBottom: '1rem', borderBottom: '1px solid #eee' }}>
                <div>
                  <p style={{ margin: 0, fontSize: '0.75rem', color: '#666', fontWeight: '500', textTransform: 'uppercase' }}>Win Rate</p>
                  <p
                    style={{
                      margin: '0.25rem 0 0 0',
                      fontSize: '1.5rem',
                      fontWeight: 'bold',
                      color: rep.winRate > 50 ? '#27ae60' : '#e74c3c',
                    }}
                  >
                    {rep.winRate}%
                  </p>
                </div>
                <div>
                  <p style={{ margin: 0, fontSize: '0.75rem', color: '#666', fontWeight: '500', textTransform: 'uppercase' }}>Activity</p>
                  <p style={{ margin: '0.25rem 0 0 0', fontSize: '1.5rem', fontWeight: 'bold', color: BLUE }}>{rep.activityCountLast30}</p>
                </div>
              </div>

              <div>
                <p style={{ margin: 0, fontSize: '0.75rem', color: '#666', fontWeight: '500', textTransform: 'uppercase', marginBottom: '0.5rem' }}>Pipeline</p>
                <p style={{ margin: 0, fontSize: '1rem', fontWeight: '600', color: BLUE }}>{formatCurrency(rep.pipelineValue)}</p>
              </div>

              <div style={{ marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid #eee' }}>
                <p style={{ margin: 0, fontSize: '0.75rem', color: '#666', fontWeight: '500', textTransform: 'uppercase', marginBottom: '0.5rem' }}>Won Value</p>
                <p style={{ margin: 0, fontSize: '1.3rem', fontWeight: 'bold', color: ORANGE }}>{formatCurrency(rep.wonValue)}</p>
              </div>
            </div>
          )
        })}
      </div>
    )
  }

  // ─── VELOCITY TAB ──────────────────────────────────────────────

  const renderVelocity = () => {
    if (!velocityData) return null

    const curr = velocityData.currentMonth

    return (
      <div>
        <div style={{ backgroundColor: WHITE, borderRadius: '8px', padding: '2rem', boxShadow: '0 1px 3px rgba(0,0,0,0.1)', marginBottom: '2rem', textAlign: 'center' }}>
          <p style={{ margin: 0, fontSize: '0.9rem', color: '#666', textTransform: 'uppercase', fontWeight: '500', letterSpacing: '0.5px' }}>
            Current Month Sales Velocity
          </p>
          <p style={{ margin: '1rem 0 0 0', fontSize: '3rem', fontWeight: 'bold', color: ORANGE }}>
            {Math.round(curr.salesVelocity * 100) / 100}
          </p>
          <p style={{ margin: '0.5rem 0 0 0', fontSize: '0.9rem', color: '#666' }}>Monthly velocity index</p>
        </div>

        <div style={{ backgroundColor: WHITE, borderRadius: '8px', padding: '1.5rem', boxShadow: '0 1px 3px rgba(0,0,0,0.1)', marginBottom: '2rem' }}>
          <h3 style={{ margin: '0 0 1.5rem 0', color: BLUE, fontSize: '1.1rem' }}>Velocity Components</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '1.5rem' }}>
            <StatCard label="Opportunities" value={curr.opportunities.toString()} subtext="Deals created" />
            <StatCard label="Avg Deal Value" value={formatCurrency(curr.avgDealValue)} />
            <StatCard label="Win Rate" value={`${Math.round(curr.winRate * 100)}%`} />
            <StatCard label="Avg Cycle" value={`${Math.round(curr.avgCycleLength)}d`} subtext="Days to close" />
          </div>
        </div>

        <div style={{ backgroundColor: WHITE, borderRadius: '8px', padding: '1.5rem', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
          <h3 style={{ margin: '0 0 1.5rem 0', color: BLUE, fontSize: '1.1rem' }}>12-Month Trend</h3>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '600px' }}>
              <thead>
                <tr style={{ borderBottom: `2px solid ${BORDER_GRAY}` }}>
                  <th style={{ textAlign: 'left', padding: '1rem', color: '#666', fontWeight: '600', fontSize: '0.9rem' }}>Month</th>
                  <th style={{ textAlign: 'center', padding: '1rem', color: '#666', fontWeight: '600', fontSize: '0.9rem' }}>Opps</th>
                  <th style={{ textAlign: 'center', padding: '1rem', color: '#666', fontWeight: '600', fontSize: '0.9rem' }}>Avg Value</th>
                  <th style={{ textAlign: 'center', padding: '1rem', color: '#666', fontWeight: '600', fontSize: '0.9rem' }}>Win Rate</th>
                  <th style={{ textAlign: 'center', padding: '1rem', color: '#666', fontWeight: '600', fontSize: '0.9rem' }}>Cycle</th>
                  <th style={{ textAlign: 'center', padding: '1rem', color: '#666', fontWeight: '600', fontSize: '0.9rem' }}>Velocity</th>
                </tr>
              </thead>
              <tbody>
                {velocityData.monthlyTrend.map((row, idx) => (
                  <tr key={idx} style={{ borderBottom: `1px solid ${BORDER_GRAY}` }}>
                    <td style={{ padding: '1rem', color: BLUE, fontWeight: '500' }}>{row.month}</td>
                    <td style={{ textAlign: 'center', padding: '1rem', color: '#666' }}>{row.opportunities}</td>
                    <td style={{ textAlign: 'center', padding: '1rem', color: '#666' }}>{formatCurrency(row.avgDealValue)}</td>
                    <td style={{ textAlign: 'center', padding: '1rem', color: '#666' }}>{Math.round(row.winRate * 100)}%</td>
                    <td style={{ textAlign: 'center', padding: '1rem', color: '#666' }}>{Math.round(row.avgCycleLength)}d</td>
                    <td style={{ textAlign: 'center', padding: '1rem', color: ORANGE, fontWeight: '600' }}>
                      {Math.round(row.salesVelocity * 100) / 100}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div style={{ backgroundColor: LIGHT_GRAY, minHeight: '100vh', padding: '2rem' }}>
      <div style={{ maxWidth: '1400px', margin: '0 auto' }}>
        {/* Header */}
        <div style={{ marginBottom: '2rem' }}>
          <h1 style={{ fontSize: '2rem', fontWeight: 'bold', color: BLUE, margin: 0 }}>Sales Analytics</h1>
          <p style={{ color: '#666', marginTop: '0.5rem', fontSize: '0.95rem' }}>Advanced pipeline, performance, and velocity insights</p>
        </div>

        {/* Tab Navigation */}
        <div style={{ backgroundColor: WHITE, borderRadius: '8px 8px 0 0', padding: '0 1.5rem', boxShadow: '0 1px 3px rgba(0,0,0,0.1)', display: 'flex', borderBottom: `1px solid ${BORDER_GRAY}` }}>
          <TabButton tab="forecast" label="Forecast" />
          <TabButton tab="win_loss" label="Win/Loss" />
          <TabButton tab="rep_scorecard" label="Rep Scorecards" />
          <TabButton tab="velocity" label="Velocity" />
        </div>

        {/* Tab Content */}
        <div style={{ backgroundColor: WHITE, padding: '2rem', borderRadius: '0 0 8px 8px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
          {loading && <p style={{ textAlign: 'center', color: '#999' }}>Loading...</p>}
          {!loading && activeTab === 'forecast' && renderForecast()}
          {!loading && activeTab === 'win_loss' && renderWinLoss()}
          {!loading && activeTab === 'rep_scorecard' && renderRepScorecard()}
          {!loading && activeTab === 'velocity' && renderVelocity()}
        </div>
      </div>
    </div>
  )
}
