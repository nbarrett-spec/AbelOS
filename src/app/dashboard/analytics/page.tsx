'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/hooks/useAuth'

interface AnalyticsData {
  monthly: Array<{ month: string; orders: number; spend: number }>
  topProducts: Array<{
    name: string
    sku: string
    category: string
    quantity: number
    spend: number
  }>
  spendByCategory: Array<{
    category: string
    orders: number
    spend: number
  }>
  keyMetrics: {
    ytdSpend: number
    ytdOrders: number
    avgOrderValue: number
    approvalRate: number
  }
  quoteStats: {
    total: number
    approved: number
    avgDaysToApprove: number
  }
  paymentStats: {
    totalInvoices: number
    paid: number
    overdue: number
  }
}

function formatCurrency(n: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n)
}

function formatCurrencyFull(n: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(n)
}

function getMonthLabel(monthStr: string): string {
  const [year, month] = monthStr.split('-')
  const date = new Date(parseInt(year), parseInt(month) - 1, 1)
  return date.toLocaleDateString('en-US', { month: 'short' })
}

export default function AnalyticsPage() {
  const { builder, loading: authLoading } = useAuth()
  const router = useRouter()
  const [data, setData] = useState<AnalyticsData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (builder) {
      fetchAnalytics()
    }
  }, [builder])

  async function fetchAnalytics() {
    try {
      setLoading(true)
      const res = await fetch('/api/builder/analytics')
      if (res.ok) {
        const analyticsData = await res.json()
        setData(analyticsData)
      }
    } catch (error) {
      console.error('Failed to fetch analytics:', error)
    } finally {
      setLoading(false)
    }
  }

  if (authLoading) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '60vh',
        }}
      >
        <div
          style={{
            width: '32px',
            height: '32px',
            border: '4px solid #0f2a3e',
            borderTop: 'transparent',
            borderRadius: '50%',
            animation: 'spin 0.8s linear infinite',
          }}
        />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    )
  }

  if (!builder) {
    return (
      <div style={{ textAlign: 'center', paddingTop: '80px' }}>
        <p style={{ color: '#999', marginBottom: '16px' }}>
          Please sign in to access analytics.
        </p>
        <Link
          href="/login"
          style={{
            display: 'inline-block',
            paddingLeft: '24px',
            paddingRight: '24px',
            paddingTop: '8px',
            paddingBottom: '8px',
            backgroundColor: '#C6A24E',
            color: 'white',
            borderRadius: '8px',
            fontWeight: '600',
            textDecoration: 'none',
            marginTop: '16px',
          }}
        >
          Sign In
        </Link>
      </div>
    )
  }

  if (loading || !data) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '60vh',
        }}
      >
        <div
          style={{
            width: '32px',
            height: '32px',
            border: '4px solid #0f2a3e',
            borderTop: 'transparent',
            borderRadius: '50%',
            animation: 'spin 0.8s linear infinite',
          }}
        />
      </div>
    )
  }

  const maxMonthlySpend = Math.max(
    ...data.monthly.map((m) => m.spend),
    1
  )
  const currentMonth = new Date().toISOString().substring(0, 7)
  const colors = {
    navy: '#0f2a3e',
    orange: '#C6A24E',
    lightGray: '#f5f5f5',
    borderGray: '#e0e0e0',
    darkGray: '#333',
    mediumGray: '#666',
  }

  const sortedCategories = [...data.spendByCategory].sort(
    (a, b) => b.spend - a.spend
  )
  const topCategories = sortedCategories.slice(0, 5)
  const otherSpend = sortedCategories
    .slice(5)
    .reduce((sum, c) => sum + c.spend, 0)
  const chartCategories =
    otherSpend > 0
      ? [...topCategories, { category: 'Other', orders: 0, spend: otherSpend }]
      : topCategories

  const totalCategorySpend = chartCategories.reduce((sum, c) => sum + c.spend, 0)

  let gradientStops: string[] = []
  let currentAngle = 0
  const chartColors = ['#0f2a3e', '#C6A24E', '#2E86AB', '#A23B72', '#F18F01']

  chartCategories.forEach((cat, idx) => {
    const percentage = (cat.spend / totalCategorySpend) * 100
    const nextAngle = currentAngle + (percentage / 100) * 360
    gradientStops.push(`${chartColors[idx % chartColors.length]} ${currentAngle}deg`)
    gradientStops.push(
      `${chartColors[idx % chartColors.length]} ${nextAngle}deg`
    )
    currentAngle = nextAngle
  })

  return (
    <div style={{ padding: '24px', maxWidth: '1400px', margin: '0 auto' }}>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>

      <div style={{ marginBottom: '32px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 style={{ fontSize: '28px', fontWeight: 'bold', color: colors.darkGray, margin: '0 0 8px 0' }}>
            Analytics & Spend
          </h1>
          <p style={{ color: colors.mediumGray, fontSize: '14px', margin: 0 }}>
            Year-to-date performance and order history
          </p>
        </div>
        <button
          onClick={fetchAnalytics}
          style={{
            padding: '10px 16px',
            backgroundColor: colors.navy,
            color: 'white',
            border: 'none',
            borderRadius: '6px',
            fontSize: '14px',
            fontWeight: '500',
            cursor: 'pointer',
            transition: 'background-color 0.2s',
          }}
          onMouseOver={(e) => (e.currentTarget.style.backgroundColor = '#0f3855')}
          onMouseOut={(e) => (e.currentTarget.style.backgroundColor = colors.navy)}
        >
          Refresh
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '20px', marginBottom: '32px' }}>
        <div style={{ backgroundColor: 'white', border: `1px solid ${colors.borderGray}`, borderRadius: '12px', padding: '20px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
          <p style={{ fontSize: '12px', color: colors.mediumGray, textTransform: 'uppercase', letterSpacing: '0.5px', fontWeight: '600', margin: '0 0 8px 0' }}>YTD Spend</p>
          <p style={{ fontSize: '32px', fontWeight: 'bold', color: colors.navy, margin: '0 0 12px 0' }}>
            {formatCurrency(data.keyMetrics.ytdSpend)}
          </p>
          <div style={{ height: '20px', backgroundColor: colors.lightGray, borderRadius: '4px', overflow: 'hidden' }}>
            <div style={{ height: '100%', backgroundColor: colors.orange, width: '100%' }} />
          </div>
        </div>

        <div style={{ backgroundColor: 'white', border: `1px solid ${colors.borderGray}`, borderRadius: '12px', padding: '20px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
          <p style={{ fontSize: '12px', color: colors.mediumGray, textTransform: 'uppercase', letterSpacing: '0.5px', fontWeight: '600', margin: '0 0 8px 0' }}>YTD Orders</p>
          <p style={{ fontSize: '32px', fontWeight: 'bold', color: colors.navy, margin: 0 }}>{data.keyMetrics.ytdOrders}</p>
        </div>

        <div style={{ backgroundColor: 'white', border: `1px solid ${colors.borderGray}`, borderRadius: '12px', padding: '20px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
          <p style={{ fontSize: '12px', color: colors.mediumGray, textTransform: 'uppercase', letterSpacing: '0.5px', fontWeight: '600', margin: '0 0 8px 0' }}>Avg Order Value</p>
          <p style={{ fontSize: '32px', fontWeight: 'bold', color: colors.navy, margin: 0 }}>{formatCurrency(data.keyMetrics.avgOrderValue)}</p>
        </div>

        <div style={{ backgroundColor: 'white', border: `1px solid ${colors.borderGray}`, borderRadius: '12px', padding: '20px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
          <p style={{ fontSize: '12px', color: colors.mediumGray, textTransform: 'uppercase', letterSpacing: '0.5px', fontWeight: '600', margin: '0 0 8px 0' }}>Quote Approval Rate</p>
          <p style={{ fontSize: '32px', fontWeight: 'bold', color: colors.navy, margin: 0 }}>
            {data.quoteStats.total > 0 ? Math.round(data.keyMetrics.approvalRate) : 0}%
          </p>
        </div>
      </div>

      <div style={{ backgroundColor: 'white', border: `1px solid ${colors.borderGray}`, borderRadius: '12px', padding: '24px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)', marginBottom: '32px' }}>
        <h2 style={{ fontSize: '18px', fontWeight: '600', color: colors.darkGray, margin: '0 0 20px 0' }}>Monthly Spend (Last 12 Months)</h2>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: '12px', height: '240px', paddingLeft: '60px', paddingRight: '20px', position: 'relative' }}>
          <div style={{ position: 'absolute', left: 0, width: '55px', height: '240px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', fontSize: '12px', color: colors.mediumGray, paddingTop: '4px' }}>
            {[formatCurrency(maxMonthlySpend), formatCurrency((maxMonthlySpend * 3) / 4), formatCurrency((maxMonthlySpend * 2) / 4), formatCurrency(maxMonthlySpend / 4), '$0'].reverse().map((label, idx) => (
              <div key={idx} style={{ textAlign: 'right' }}>{label}</div>
            ))}
          </div>
          {data.monthly.map((month, idx) => (
            <div key={idx} style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
              <div style={{ flex: 1, display: 'flex', alignItems: 'flex-end' }}>
                <div style={{ width: '100%', height: `${(month.spend / maxMonthlySpend) * 100}%`, backgroundColor: month.month === currentMonth ? colors.orange : colors.navy, borderRadius: '4px 4px 0 0', transition: 'background-color 0.2s', cursor: 'pointer' }} onMouseOver={(e) => { e.currentTarget.style.opacity = '0.8' }} onMouseOut={(e) => { e.currentTarget.style.opacity = '1' }} />
              </div>
              <div style={{ textAlign: 'center', fontSize: '11px', color: colors.mediumGray, marginTop: '8px', fontWeight: '500' }}>{getMonthLabel(month.month)}</div>
              <div style={{ textAlign: 'center', fontSize: '10px', color: colors.mediumGray, marginTop: '2px' }}>{formatCurrency(month.spend)}</div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '32px', marginBottom: '32px' }}>
        <div style={{ backgroundColor: 'white', border: `1px solid ${colors.borderGray}`, borderRadius: '12px', padding: '24px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
          <h2 style={{ fontSize: '18px', fontWeight: '600', color: colors.darkGray, margin: '0 0 16px 0' }}>Top 10 Products</h2>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${colors.borderGray}`, backgroundColor: colors.lightGray }}>
                <th style={{ textAlign: 'left', padding: '12px', fontWeight: '600', color: colors.mediumGray, fontSize: '12px' }}>Product</th>
                <th style={{ textAlign: 'center', padding: '12px', fontWeight: '600', color: colors.mediumGray, fontSize: '12px' }}>SKU</th>
                <th style={{ textAlign: 'center', padding: '12px', fontWeight: '600', color: colors.mediumGray, fontSize: '12px' }}>Category</th>
                <th style={{ textAlign: 'center', padding: '12px', fontWeight: '600', color: colors.mediumGray, fontSize: '12px' }}>Qty</th>
                <th style={{ textAlign: 'right', padding: '12px', fontWeight: '600', color: colors.mediumGray, fontSize: '12px' }}>Spend</th>
              </tr>
            </thead>
            <tbody>
              {data.topProducts.map((product, idx) => (
                <tr key={idx} style={{ borderBottom: `1px solid ${colors.borderGray}`, backgroundColor: idx % 2 === 0 ? 'white' : colors.lightGray }}>
                  <td style={{ padding: '12px', color: colors.darkGray, fontWeight: '500' }}>{product.name}</td>
                  <td style={{ padding: '12px', textAlign: 'center', color: colors.mediumGray, fontFamily: 'monospace', fontSize: '13px' }}>{product.sku}</td>
                  <td style={{ padding: '12px', textAlign: 'center', color: colors.mediumGray, fontSize: '13px' }}>{product.category}</td>
                  <td style={{ padding: '12px', textAlign: 'center', color: colors.darkGray, fontWeight: '500' }}>{product.quantity}</td>
                  <td style={{ padding: '12px', textAlign: 'right', color: colors.navy, fontWeight: '600' }}>{formatCurrencyFull(product.spend)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div style={{ backgroundColor: 'white', border: `1px solid ${colors.borderGray}`, borderRadius: '12px', padding: '24px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
          <h2 style={{ fontSize: '18px', fontWeight: '600', color: colors.darkGray, margin: '0 0 20px 0' }}>Spend by Category</h2>
          <div style={{ display: 'flex', gap: '32px', alignItems: 'center' }}>
            <div style={{ flex: '0 0 160px' }}>
              <div style={{ width: '160px', height: '160px', borderRadius: '50%', background: `conic-gradient(${gradientStops.join(', ')})`, position: 'relative', boxShadow: '0 2px 8px rgba(0,0,0,0.1)' }}>
                <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', width: '80px', height: '80px', borderRadius: '50%', backgroundColor: 'white' }} />
              </div>
            </div>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {chartCategories.map((cat, idx) => (
                <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '13px' }}>
                  <div style={{ width: '12px', height: '12px', borderRadius: '2px', backgroundColor: chartColors[idx % chartColors.length], flexShrink: 0 }} />
                  <span style={{ color: colors.mediumGray, flex: 1 }}>{cat.category}</span>
                  <span style={{ color: colors.navy, fontWeight: '600', whiteSpace: 'nowrap' }}>{formatCurrencyFull(cat.spend)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div style={{ backgroundColor: 'white', border: `1px solid ${colors.borderGray}`, borderRadius: '12px', padding: '24px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <h2 style={{ fontSize: '18px', fontWeight: '600', color: colors.darkGray, margin: 0 }}>Payment Health</h2>
          <Link href="/dashboard/payments" style={{ fontSize: '13px', color: colors.navy, textDecoration: 'none', fontWeight: '500', transition: 'color 0.2s' }} onMouseOver={(e) => (e.currentTarget.style.color = colors.orange)} onMouseOut={(e) => (e.currentTarget.style.color = colors.navy)}>View Payments →</Link>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '24px' }}>
          <div>
            <p style={{ fontSize: '12px', color: colors.mediumGray, textTransform: 'uppercase', letterSpacing: '0.5px', fontWeight: '600', margin: '0 0 8px 0' }}>Total Invoices</p>
            <p style={{ fontSize: '28px', fontWeight: 'bold', color: colors.navy, margin: 0 }}>{data.paymentStats.totalInvoices}</p>
          </div>
          <div>
            <p style={{ fontSize: '12px', color: colors.mediumGray, textTransform: 'uppercase', letterSpacing: '0.5px', fontWeight: '600', margin: '0 0 8px 0' }}>Paid</p>
            <p style={{ fontSize: '28px', fontWeight: 'bold', color: '#27ae60', margin: 0 }}>{data.paymentStats.paid}</p>
          </div>
          <div>
            <p style={{ fontSize: '12px', color: colors.mediumGray, textTransform: 'uppercase', letterSpacing: '0.5px', fontWeight: '600', margin: '0 0 8px 0' }}>Outstanding</p>
            <p style={{ fontSize: '28px', fontWeight: 'bold', color: colors.orange, margin: 0 }}>{data.paymentStats.totalInvoices - data.paymentStats.paid - data.paymentStats.overdue}</p>
          </div>
          <div>
            <p style={{ fontSize: '12px', color: colors.mediumGray, textTransform: 'uppercase', letterSpacing: '0.5px', fontWeight: '600', margin: '0 0 8px 0' }}>Overdue</p>
            <p style={{ fontSize: '28px', fontWeight: 'bold', color: '#e74c3c', margin: 0 }}>{data.paymentStats.overdue}</p>
          </div>
        </div>
        {data.paymentStats.totalInvoices > 0 && (
          <div style={{ marginTop: '24px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: colors.mediumGray, marginBottom: '8px' }}>
              <span>Payment Progress</span>
              <span>{Math.round((data.paymentStats.paid / data.paymentStats.totalInvoices) * 100)}% paid</span>
            </div>
            <div style={{ width: '100%', height: '8px', backgroundColor: colors.lightGray, borderRadius: '4px', overflow: 'hidden' }}>
              <div style={{ height: '100%', backgroundColor: colors.navy, width: `${(data.paymentStats.paid / data.paymentStats.totalInvoices) * 100}%`, transition: 'width 0.3s ease' }} />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
