'use client'

import { useState, useEffect } from 'react'

interface SavingsData {
  currentTier: string
  currentTierIcon: string
  currentDiscountPercent: number
  monthTotal: number
  quarterTotal: number
  yearTotal: number
  orderCount: number
  nextTier: string | null
  nextTierThreshold: number | null
  amountToNextTier: number | null
  nextTierDiscountPercent: number | null
  savingsAtCurrentTier: number
  estimatedSavingsAtEachTier: Array<{
    tier: string
    discountPercent: number
    estimatedSavings: number
  }>
}

interface SavingsHistoryItem {
  month: string
  spend: number
  discountPercent: number
  savings: number
}

export default function SavingsPage() {
  const [data, setData] = useState<SavingsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [projectedSpend, setProjectedSpend] = useState(0)
  const [savingsHistory, setSavingsHistory] = useState<SavingsHistoryItem[]>([])

  useEffect(() => {
    fetchSavingsData()
  }, [])

  const fetchSavingsData = async () => {
    try {
      setLoading(true)
      setError(null)
      const res = await fetch('/api/builder/volume-savings')
      if (!res.ok) throw new Error('Failed to fetch savings data')
      const json = await res.json()
      setData(json)
      setProjectedSpend(json.yearTotal)
      generateSavingsHistory(json)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const generateSavingsHistory = (data: SavingsData) => {
    // Generate mock historical data for last 6 months
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun']
    const currentMonth = new Date().getMonth()
    const history: SavingsHistoryItem[] = []

    for (let i = 5; i >= 0; i--) {
      const monthIdx = (currentMonth - i + 12) % 12
      const monthName = months[monthIdx]
      const spend = Math.random() * 20000 + 5000 // $5k-$25k range
      const discountPercent = spend < 25000 ? 0 : spend < 75000 ? 3 : spend < 200000 ? 5 : 8
      const savings = spend * (discountPercent / 100)

      history.push({
        month: monthName,
        spend,
        discountPercent,
        savings,
      })
    }

    setSavingsHistory(history)
  }

  const getTierForAmount = (amount: number) => {
    if (amount < 25000) return { tier: 'Bronze', discount: 0, icon: '🥉' }
    if (amount < 75000) return { tier: 'Silver', discount: 3, icon: '🥈' }
    if (amount < 200000) return { tier: 'Gold', discount: 5, icon: '🥇' }
    return { tier: 'Platinum', discount: 8, icon: '💎' }
  }

  const projectedTier = getTierForAmount(projectedSpend)
  const projectedSavings = projectedSpend * (projectedTier.discount / 100)
  const ytdSavings = savingsHistory.reduce((sum, item) => sum + item.savings, 0)

  const fmtCurrency = (n: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(n)
  }

  const styles = {
    container: { maxWidth: '1200px', margin: '0 auto', padding: '2rem' },
    grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '2rem', marginBottom: '2rem' },
    card: {
      backgroundColor: '#fff',
      border: '1px solid #e0e0e0',
      borderRadius: '12px',
      padding: '2rem',
      boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
    },
    cardHighlight: {
      backgroundColor: '#FFF9F0',
      borderColor: '#C9822B',
    },
    tierBadge: {
      display: 'flex',
      alignItems: 'center',
      gap: '0.5rem',
      fontSize: '2rem',
      marginBottom: '1rem',
    },
    tierIcon: { fontSize: '3rem' },
    tierName: { fontSize: '1.5rem', fontWeight: '600', color: '#3E2A1E' },
    headline: { fontSize: '1.3rem', fontWeight: '600', color: '#333', marginBottom: '0.5rem' },
    subtext: { color: '#666', fontSize: '0.95rem', marginBottom: '1rem' },
    progressBar: {
      width: '100%',
      height: '12px',
      backgroundColor: '#e0e0e0',
      borderRadius: '6px',
      overflow: 'hidden',
      marginTop: '1rem',
    },
    progressFill: {
      height: '100%',
      backgroundColor: '#C9822B',
      transition: 'width 0.3s ease',
    },
    label: { fontSize: '0.85rem', color: '#666', marginTop: '0.5rem' },
    metric: { display: 'flex', justifyContent: 'space-between', marginBottom: '1rem', fontSize: '0.95rem' },
    metricValue: { fontWeight: '600', color: '#3E2A1E' },
    sliderContainer: { marginTop: '1.5rem' },
    slider: { width: '100%', marginTop: '0.5rem' },
    table: {
      width: '100%',
      borderCollapse: 'collapse' as const,
      marginTop: '1rem',
    },
    th: { textAlign: 'left' as const, padding: '0.75rem', borderBottom: '2px solid #e0e0e0', fontWeight: '600', color: '#333' },
    td: { padding: '0.75rem', borderBottom: '1px solid #f0f0f0' },
  }

  if (loading) {
    return (
      <div style={styles.container}>
        <div style={{ textAlign: 'center', padding: '3rem', color: '#666' }}>
          Loading savings data...
        </div>
      </div>
    )
  }

  if (error || !data) {
    return (
      <div style={styles.container}>
        <div style={{ textAlign: 'center', padding: '3rem', color: '#d32f2f' }}>
          Error: {error || 'Failed to load data'}
        </div>
      </div>
    )
  }

  return (
    <div style={styles.container}>
      <h1 style={{ fontSize: '2rem', fontWeight: '700', color: '#3E2A1E', marginBottom: '2rem' }}>Volume Savings</h1>

      {/* Current Tier Card */}
      <div style={{ ...styles.card, ...styles.cardHighlight } as any}>
        <div style={styles.tierBadge}>
          <span style={styles.tierIcon}>{data.currentTierIcon}</span>
        </div>
        <h2 style={styles.headline}>You're a {data.currentTier} Member</h2>
        <p style={styles.subtext}>
          You're saving <strong>{data.currentDiscountPercent}%</strong> on all purchases
        </p>

        <div style={styles.metric}>
          <span>Current Annual Spend (YTD)</span>
          <span style={styles.metricValue}>{fmtCurrency(data.yearTotal)}</span>
        </div>

        <div style={styles.metric}>
          <span>Your Current Discount</span>
          <span style={styles.metricValue}>{data.currentDiscountPercent}%</span>
        </div>

        <div style={styles.metric}>
          <span>Savings This Year</span>
          <span style={{ ...styles.metricValue, color: '#2e7d32' }}>
            {fmtCurrency(data.savingsAtCurrentTier)}
          </span>
        </div>

        {data.nextTier && data.amountToNextTier !== null && data.amountToNextTier > 0 && (
          <>
            <div style={styles.metric}>
              <span>To reach {data.nextTier}:</span>
              <span style={styles.metricValue}>{fmtCurrency(data.amountToNextTier)}</span>
            </div>
            <div style={styles.progressBar}>
              <div
                style={{
                  ...styles.progressFill,
                  width: `${Math.min(100, (data.yearTotal / (data.nextTierThreshold || 100000)) * 100)}%`,
                }}
              />
            </div>
            <p style={styles.label}>
              {fmtCurrency(data.amountToNextTier)} away from {data.nextTier} (save {data.nextTierDiscountPercent}%)
            </p>
          </>
        )}
      </div>

      {/* Savings Calculator */}
      <div style={styles.grid}>
        <div style={styles.card}>
          <h3 style={{ fontSize: '1.1rem', fontWeight: '600', color: '#3E2A1E', marginBottom: '1rem' }}>
            Savings Calculator
          </h3>
          <p style={styles.subtext}>How much could you save?</p>

          <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '500', color: '#333' }}>
            Projected Annual Spend
          </label>
          <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
            <input
              type="range"
              min="0"
              max="300000"
              step="5000"
              value={projectedSpend}
              onChange={(e) => setProjectedSpend(Number(e.target.value))}
              style={{ ...styles.slider, flex: 1 }}
            />
            <input
              type="number"
              value={projectedSpend}
              onChange={(e) => setProjectedSpend(Number(e.target.value))}
              style={{
                width: '120px',
                padding: '0.5rem',
                border: '1px solid #ddd',
                borderRadius: '4px',
                textAlign: 'right',
              }}
            />
          </div>

          <div style={{ marginTop: '1.5rem', padding: '1rem', backgroundColor: '#f5f5f5', borderRadius: '8px' }}>
            <p style={styles.subtext}>Projected Tier</p>
            <div style={styles.tierBadge}>
              <span style={styles.tierIcon}>{projectedTier.icon}</span>
              <span style={styles.tierName}>{projectedTier.tier}</span>
            </div>

            <div style={styles.metric}>
              <span>Projected Discount</span>
              <span style={styles.metricValue}>{projectedTier.discount}%</span>
            </div>

            <div style={styles.metric}>
              <span>Estimated Savings</span>
              <span style={{ ...styles.metricValue, color: '#2e7d32', fontSize: '1.2rem' }}>
                {fmtCurrency(projectedSavings)}
              </span>
            </div>
          </div>
        </div>

        {/* All Tiers Comparison */}
        <div style={styles.card}>
          <h3 style={{ fontSize: '1.1rem', fontWeight: '600', color: '#3E2A1E', marginBottom: '1rem' }}>
            All Tiers
          </h3>
          <p style={styles.subtext}>Potential savings at each tier level</p>

          <div style={{ display: 'grid', gap: '1rem' }}>
            {data.estimatedSavingsAtEachTier.map((tier) => (
              <div
                key={tier.tier}
                style={{
                  padding: '1rem',
                  backgroundColor: tier.tier === data.currentTier ? '#C9822B20' : '#f9f9f9',
                  borderRadius: '8px',
                  border: tier.tier === data.currentTier ? '1px solid #C9822B' : '1px solid #e0e0e0',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <p style={{ fontWeight: '600', color: '#333' }}>{tier.tier}</p>
                    <p style={{ fontSize: '0.85rem', color: '#666' }}>
                      {tier.discountPercent}% discount
                    </p>
                  </div>
                  <p style={{ fontWeight: '700', color: '#2e7d32', fontSize: '1.1rem' }}>
                    {fmtCurrency(tier.estimatedSavings)}
                  </p>
                </div>
                {tier.tier === data.currentTier && (
                  <p style={{ fontSize: '0.75rem', color: '#C9822B', marginTop: '0.5rem', fontWeight: '600' }}>
                    ✓ Your current tier
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Savings History */}
      <div style={styles.card}>
        <h3 style={{ fontSize: '1.1rem', fontWeight: '600', color: '#3E2A1E', marginBottom: '1rem' }}>
          Savings History (Last 6 Months)
        </h3>

        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>Month</th>
              <th style={styles.th}>Spend</th>
              <th style={styles.th}>Discount</th>
              <th style={styles.th}>Savings</th>
            </tr>
          </thead>
          <tbody>
            {savingsHistory.map((item) => (
              <tr key={item.month}>
                <td style={styles.td}>{item.month}</td>
                <td style={styles.td}>{fmtCurrency(item.spend)}</td>
                <td style={styles.td}>{item.discountPercent}%</td>
                <td style={{ ...styles.td, fontWeight: '600', color: '#2e7d32' }}>
                  {fmtCurrency(item.savings)}
                </td>
              </tr>
            ))}
            <tr style={{ backgroundColor: '#f5f5f5', fontWeight: '600' }}>
              <td style={styles.td}>YTD Total</td>
              <td style={styles.td}>{fmtCurrency(savingsHistory.reduce((s, i) => s + i.spend, 0))}</td>
              <td style={styles.td}>–</td>
              <td style={{ ...styles.td, color: '#2e7d32' }}>
                {fmtCurrency(ytdSavings)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}
