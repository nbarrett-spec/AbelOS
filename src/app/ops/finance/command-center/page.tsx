'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { LineChart } from 'lucide-react'
import {
  BarChart,
  DonutChart,
  HBarChart,
  MiniStat,
  ProgressRing,
  Sparkline,
} from '@/app/ops/components/Charts'
import { PageHeader, EmptyState } from '@/components/ui'

interface CommandCenterData {
  snapshot: {
    cashOnHand: number
    arTotal: number
    apTotal: number
    netCashPosition: number
    arCurrent: number
    ar30: number
    ar60: number
    ar90Plus: number
    dso: number
    revenueMonth: number
    openPOTotal: number
    overdueARPct: number
  } | null
  priorSnapshot: {
    dso: number
    revenueMonth: number
    netCashPosition: number
  } | null
  arByBuilder: Array<{
    builderId: string
    builderName: string
    current: number
    days30: number
    days60: number
    days90plus: number
    total: number
  }>
  overdueInvoices: Array<{
    invoiceId: string
    invoiceNumber: string
    builderName: string
    amount: number
    daysOverdue: number
    dueDate: Date
  }>
  revenueTrend: Array<{ month: string; revenue: number }>
  dsoTrend: Array<{ snapshotDate: Date; dso: number }>
  poPipeline: Array<{
    vendorId: string
    vendorName: string
    count: number
    totalAmount: number
    expectedDate: Date | null
  }>
  creditExposure: Array<{
    builderId: string
    builderName: string
    creditLimit: number
    arOutstanding: number
    utilization: number
  }>
  alerts: Array<{
    type: string
    severity: string
    title: string
    message: string
    count: number
    value: number
  }>
  collectionsInProgress: number
}

const formatCurrency = (value: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value)

const calculateTrend = (current: number, prior: number) => {
  if (prior === 0) return null
  return ((current - prior) / prior) * 100
}

export default function CommandCenterPage() {
  const [data, setData] = useState<CommandCenterData | null>(null)
  const [loading, setLoading] = useState(true)
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date())
  const [autoRefresh, setAutoRefresh] = useState(true)

  const fetchData = async () => {
    try {
      const res = await fetch('/api/ops/finance/command-center')
      if (res.ok) {
        setData(await res.json())
        setLastRefresh(new Date())
      }
    } catch (e) {
      console.error('Failed to fetch command center data:', e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchData()
  }, [])

  // Auto-refresh every 5 minutes
  useEffect(() => {
    if (!autoRefresh) return
    const interval = setInterval(() => {
      fetchData()
    }, 5 * 60 * 1000)
    return () => clearInterval(interval)
  }, [autoRefresh])

  if (loading) {
    return (
      <div className="p-8 text-center text-fg-subtle">
        Loading Financial Command Center...
      </div>
    )
  }

  if (!data?.snapshot) {
    return (
      <div className="p-8">
        <EmptyState
          icon={<LineChart className="w-8 h-8 text-fg-subtle" />}
          title="No financial data yet"
          description="The daily snapshot runs at 6am UTC."
        />
      </div>
    )
  }

  const snap = data.snapshot
  const prior = data.priorSnapshot
  const dsoTrend = data.dsoTrend.map((d) => d.dso)
  const revenueTrendChart = data.revenueTrend.map((r) => r.revenue)
  const arTrendSparkline = data.arByBuilder.slice(0, 5).map((b) => b.total)

  // Calculate metrics for KPI cards
  const dsoTrend_pct = prior ? calculateTrend(snap.dso, prior.dso) : null
  const revenueTrend_pct = prior ? calculateTrend(snap.revenueMonth, prior.revenueMonth) : null
  const arTrend_pct = null // Calculated from aging

  const colors = {
    walnut: '#0f2a3e',
    amber: '#C6A24E',
    green: '#27AE60',
    red: '#dc2626',
    blue: '#3b82f6',
  }

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'critical':
        return colors.red
      case 'high':
        return '#ea580c'
      case 'warning':
        return colors.amber
      default:
        return colors.blue
    }
  }

  return (
    <div className="bg-canvas min-h-screen">
      {/* Header */}
      <div className="bg-surface border-b border-border px-8 py-5">
        <PageHeader
          eyebrow="Finance"
          title="Financial Command Center"
          description={`Last updated: ${lastRefresh.toLocaleTimeString()} | Generated ${new Date().toLocaleDateString()}`}
          actions={
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-1.5 text-xs text-fg-muted cursor-pointer">
                <input
                  type="checkbox"
                  checked={autoRefresh}
                  onChange={(e) => setAutoRefresh(e.target.checked)}
                  className="cursor-pointer"
                />
                Auto-refresh (5 min)
              </label>
              <button
                onClick={fetchData}
                className="px-4 py-2 bg-[#0f2a3e] text-white border-none rounded-md cursor-pointer text-xs font-semibold"
              >
                Refresh Now
              </button>
              <button
                onClick={() => window.print()}
                className="px-4 py-2 bg-surface-muted text-fg border border-border rounded-md cursor-pointer text-xs font-semibold"
              >
                Print
              </button>
            </div>
          }
        />
      </div>

      <div className="p-8 max-w-full">
        {/* ─── ZONE 1: VITAL SIGNS ─────────────────────────────────────── */}
        <div style={{ marginBottom: 32 }}>
          <h2 className="text-base font-semibold text-fg mb-4">Vital Signs</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16 }}>
            {/* Cash Position */}
            <MiniStat
              label="Net Cash Position"
              value={formatCurrency(snap.netCashPosition)}
              trend={prior ? calculateTrend(snap.netCashPosition, prior.netCashPosition) ?? undefined : undefined}
              trendLabel={prior ? 'vs prior' : ''}
              color={colors.green}
            />

            {/* AR Total with Aging Bar */}
            <div
              style={{
                padding: 16,
                backgroundColor: 'white',
                borderRadius: 12,
                border: '1px solid #e5e7eb',
              }}
            >
              <p style={{ fontSize: 12, color: '#9ca3af', marginBottom: 8, margin: 0 }}>AR Total</p>
              <p style={{ fontSize: 24, fontWeight: 700, color: '#1f2937', margin: 0 }}>
                {formatCurrency(snap.arTotal)}
              </p>
              <div style={{ display: 'flex', gap: 2, marginTop: 12, height: 8, borderRadius: 4, overflow: 'hidden' }}>
                <div
                  style={{
                    flex: snap.arCurrent,
                    backgroundColor: colors.green,
                  }}
                  title={`Current: ${formatCurrency(snap.arCurrent)}`}
                />
                <div
                  style={{
                    flex: snap.ar30,
                    backgroundColor: colors.amber,
                  }}
                  title={`30 days: ${formatCurrency(snap.ar30)}`}
                />
                <div
                  style={{
                    flex: snap.ar60,
                    backgroundColor: '#ea580c',
                  }}
                  title={`60 days: ${formatCurrency(snap.ar60)}`}
                />
                <div
                  style={{
                    flex: snap.ar90Plus,
                    backgroundColor: colors.red,
                  }}
                  title={`90+ days: ${formatCurrency(snap.ar90Plus)}`}
                />
              </div>
              <div style={{ display: 'flex', gap: 16, marginTop: 8, fontSize: 10, color: '#6b7280' }}>
                <div>
                  <span style={{ display: 'inline-block', width: 8, height: 8, backgroundColor: colors.green, borderRadius: 1, marginRight: 4 }}></span>
                  Current
                </div>
                <div>
                  <span style={{ display: 'inline-block', width: 8, height: 8, backgroundColor: colors.amber, borderRadius: 1, marginRight: 4 }}></span>
                  30d
                </div>
                <div>
                  <span style={{ display: 'inline-block', width: 8, height: 8, backgroundColor: '#ea580c', borderRadius: 1, marginRight: 4 }}></span>
                  60d
                </div>
                <div>
                  <span style={{ display: 'inline-block', width: 8, height: 8, backgroundColor: colors.red, borderRadius: 1, marginRight: 4 }}></span>
                  90+d
                </div>
              </div>
            </div>

            {/* AP Total */}
            <MiniStat
              label="Accounts Payable"
              value={formatCurrency(snap.apTotal)}
              color={colors.amber}
            />

            {/* DSO with Trend */}
            <MiniStat
              label="Days Sales Outstanding (DSO)"
              value={Math.round(snap.dso)}
              trend={dsoTrend_pct ?? undefined}
              trendLabel="vs prior month"
              sparkData={dsoTrend}
              color={colors.walnut}
            />

            {/* Revenue MTD */}
            <MiniStat
              label="Revenue This Month"
              value={formatCurrency(snap.revenueMonth)}
              trend={revenueTrend_pct ?? undefined}
              trendLabel="vs prior month"
              color={colors.green}
            />

            {/* Open POs */}
            <MiniStat
              label="Open PO Commitments"
              value={formatCurrency(snap.openPOTotal)}
              color={colors.blue}
            />
          </div>
        </div>

        {/* ─── ZONE 2: CHARTS ──────────────────────────────────────────── */}
        <div style={{ marginBottom: 32 }}>
          <h2 className="text-base font-semibold text-fg mb-4">Trends & Analysis</h2>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(500px, 1fr))',
              gap: 24,
            }}
          >
            {/* AR Aging Waterfall */}
            <div
              style={{
                padding: 20,
                backgroundColor: 'white',
                borderRadius: 12,
                border: '1px solid #e5e7eb',
              }}
            >
              <h3 style={{ fontSize: 14, fontWeight: 600, color: '#374151', marginBottom: 16, margin: 0 }}>
                AR Aging by Top Builders
              </h3>
              <div style={{ overflowX: 'auto' }}>
                <BarChart
                  data={data.arByBuilder.slice(0, 8).map((b) => ({
                    label: b.builderName.substring(0, 12),
                    value: b.total,
                    color: colors.walnut,
                  }))}
                  height={250}
                  formatValue={(v) => '$' + (v / 1000).toFixed(0) + 'k'}
                />
              </div>
            </div>

            {/* 12-Month Revenue Trend */}
            <div
              style={{
                padding: 20,
                backgroundColor: 'white',
                borderRadius: 12,
                border: '1px solid #e5e7eb',
              }}
            >
              <h3 style={{ fontSize: 14, fontWeight: 600, color: '#374151', marginBottom: 16, margin: 0 }}>
                12-Month Revenue Trend
              </h3>
              <div style={{ overflowX: 'auto' }}>
                <BarChart
                  data={data.revenueTrend.map((r) => ({
                    label: r.month.substring(5),
                    value: r.revenue,
                    color: colors.green,
                  }))}
                  height={250}
                  formatValue={(v) => '$' + (v / 1000).toFixed(0) + 'k'}
                />
              </div>
            </div>

            {/* DSO Trend */}
            <div
              style={{
                padding: 20,
                backgroundColor: 'white',
                borderRadius: 12,
                border: '1px solid #e5e7eb',
              }}
            >
              <h3 style={{ fontSize: 14, fontWeight: 600, color: '#374151', marginBottom: 16, margin: 0 }}>
                DSO Trend (Last 12 Snapshots)
              </h3>
              <svg
                width="100%"
                height={200}
                viewBox="0 0 500 200"
                style={{ display: 'block', margin: '0 auto' }}
              >
                {/* Grid */}
                {[0, 25, 50, 75, 100].map((v) => (
                  <line
                    key={`grid-${v}`}
                    x1="40"
                    y1={200 - (v / 100) * 160}
                    x2="480"
                    y2={200 - (v / 100) * 160}
                    stroke="#f0f0f0"
                    strokeWidth="1"
                  />
                ))}
                {/* Target line at 45 days */}
                <line x1="40" y1={200 - (45 / 100) * 160} x2="480" y2={200 - (45 / 100) * 160} stroke="#C6A24E" strokeWidth="2" strokeDasharray="5,5" />

                {/* Line chart */}
                {dsoTrend.length > 1 && (
                  <polyline
                    points={dsoTrend
                      .map((d, i) => `${40 + (i / (dsoTrend.length - 1)) * 440},${200 - (d / 100) * 160}`)
                      .join(' ')}
                    fill="none"
                    stroke={colors.walnut}
                    strokeWidth="2"
                  />
                )}
                {/* Dots */}
                {dsoTrend.map((d, i) => (
                  <circle
                    key={`dot-${i}`}
                    cx={40 + (i / (dsoTrend.length - 1)) * 440}
                    cy={200 - (d / 100) * 160}
                    r="3"
                    fill={colors.walnut}
                  />
                ))}
                {/* Axes */}
                <line x1="40" y1="200" x2="480" y2="200" stroke="#d1d5db" strokeWidth="2" />
                <line x1="40" y1="40" x2="40" y2="200" stroke="#d1d5db" strokeWidth="2" />
              </svg>
              <p style={{ fontSize: 10, color: '#9ca3af', textAlign: 'center', marginTop: 8, margin: 0 }}>
                Target: 45 days (amber line)
              </p>
            </div>

            {/* PO Pipeline */}
            <div
              style={{
                padding: 20,
                backgroundColor: 'white',
                borderRadius: 12,
                border: '1px solid #e5e7eb',
              }}
            >
              <h3 style={{ fontSize: 14, fontWeight: 600, color: '#374151', marginBottom: 16, margin: 0 }}>
                Open PO Pipeline by Vendor
              </h3>
              <HBarChart
                data={data.poPipeline.slice(0, 6).map((v) => ({
                  label: v.vendorName,
                  value: v.totalAmount,
                  color: colors.amber,
                }))}
                formatValue={(v) => '$' + (v / 1000).toFixed(0) + 'k'}
              />
            </div>

            {/* Credit Utilization */}
            <div
              style={{
                padding: 20,
                backgroundColor: 'white',
                borderRadius: 12,
                border: '1px solid #e5e7eb',
              }}
            >
              <h3 style={{ fontSize: 14, fontWeight: 600, color: '#374151', marginBottom: 16, margin: 0 }}>
                Top Builder Credit Utilization
              </h3>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 16 }}>
                {data.creditExposure.slice(0, 6).map((b) => (
                  <div key={b.builderId} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                    <ProgressRing
                      value={Math.min(b.utilization, 100)}
                      color={
                        b.utilization > 100
                          ? colors.red
                          : b.utilization > 75
                            ? colors.amber
                            : colors.green
                      }
                      label={b.builderName.substring(0, 10)}
                    />
                    <p style={{ fontSize: 10, color: '#6b7280', marginTop: 8, margin: 0 }}>
                      {formatCurrency(b.arOutstanding)} / {formatCurrency(b.creditLimit)}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* ─── ZONE 3: ACTION ITEMS ───────────────────────────────────── */}
        <div style={{ marginBottom: 32 }}>
          <h2 className="text-base font-semibold text-fg mb-4">Action Items & Alerts</h2>

          {/* Alerts */}
          {data.alerts.length > 0 && (
            <div style={{ marginBottom: 24 }}>
              <h3 className="text-[13px] font-semibold text-fg mb-3">Active Alerts</h3>
              <div style={{ display: 'grid', gap: 12 }}>
                {data.alerts.map((alert, i) => (
                  <div
                    key={i}
                    style={{
                      padding: 16,
                      backgroundColor: 'white',
                      border: `2px solid ${getSeverityColor(alert.severity)}`,
                      borderRadius: 8,
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                    }}
                  >
                    <div>
                      <p
                        style={{
                          fontSize: 13,
                          fontWeight: 600,
                          color: getSeverityColor(alert.severity),
                          margin: 0,
                        }}
                      >
                        {alert.title}
                      </p>
                      <p style={{ fontSize: 12, color: '#6b7280', margin: '4px 0 0 0' }}>
                        {alert.message} — {formatCurrency(alert.value)}
                      </p>
                    </div>
                    {alert.type === 'overdue' && (
                      <Link
                        href="/ops/finance/ar"
                        style={{
                          padding: '6px 12px',
                          backgroundColor: getSeverityColor(alert.severity),
                          color: 'white',
                          borderRadius: 4,
                          fontSize: 11,
                          fontWeight: 600,
                          textDecoration: 'none',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        View AR
                      </Link>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Overdue Invoices Table */}
          <div
            style={{
              padding: 20,
              backgroundColor: 'white',
              borderRadius: 12,
              border: '1px solid #e5e7eb',
              marginBottom: 24,
              overflowX: 'auto',
            }}
          >
            <h3 style={{ fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 12, margin: 0 }}>
              Overdue Invoices ({data.overdueInvoices.length})
            </h3>
            <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse', marginTop: 12 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #e5e7eb' }}>
                  <th style={{ textAlign: 'left', padding: '8px 0', fontWeight: 600, color: '#6b7280' }}>
                    Invoice
                  </th>
                  <th style={{ textAlign: 'left', padding: '8px 0', fontWeight: 600, color: '#6b7280' }}>
                    Builder
                  </th>
                  <th style={{ textAlign: 'right', padding: '8px 0', fontWeight: 600, color: '#6b7280' }}>
                    Amount
                  </th>
                  <th style={{ textAlign: 'right', padding: '8px 0', fontWeight: 600, color: '#6b7280' }}>
                    Days Overdue
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.overdueInvoices.map((inv) => (
                  <tr key={inv.invoiceId} style={{ borderBottom: '1px solid #f3f4f6' }}>
                    <td style={{ padding: '12px 0', color: '#1f2937' }}>{inv.invoiceNumber}</td>
                    <td style={{ padding: '12px 0', color: '#1f2937' }}>{inv.builderName}</td>
                    <td style={{ textAlign: 'right', padding: '12px 0', color: '#1f2937' }}>
                      {formatCurrency(inv.amount)}
                    </td>
                    <td
                      style={{
                        textAlign: 'right',
                        padding: '12px 0',
                        color: inv.daysOverdue > 60 ? colors.red : inv.daysOverdue > 30 ? colors.amber : '#6b7280',
                        fontWeight: 600,
                      }}
                    >
                      {inv.daysOverdue} days
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {data.overdueInvoices.length === 0 && (
              <p style={{ fontSize: 12, color: '#9ca3af', padding: '16px 0', margin: 0 }}>No overdue invoices</p>
            )}
          </div>

          {/* Credit Exposure Table */}
          <div
            style={{
              padding: 20,
              backgroundColor: 'white',
              borderRadius: 12,
              border: '1px solid #e5e7eb',
              overflowX: 'auto',
            }}
          >
            <h3 style={{ fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 12, margin: 0 }}>
              Top 10 Builder Exposures
            </h3>
            <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse', marginTop: 12 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #e5e7eb' }}>
                  <th style={{ textAlign: 'left', padding: '8px 0', fontWeight: 600, color: '#6b7280' }}>
                    Builder
                  </th>
                  <th style={{ textAlign: 'right', padding: '8px 0', fontWeight: 600, color: '#6b7280' }}>
                    Credit Limit
                  </th>
                  <th style={{ textAlign: 'right', padding: '8px 0', fontWeight: 600, color: '#6b7280' }}>
                    Outstanding
                  </th>
                  <th style={{ textAlign: 'center', padding: '8px 0', fontWeight: 600, color: '#6b7280' }}>
                    Utilization
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.creditExposure.map((b) => (
                  <tr key={b.builderId} style={{ borderBottom: '1px solid #f3f4f6' }}>
                    <td style={{ padding: '12px 0', color: '#1f2937' }}>{b.builderName}</td>
                    <td style={{ textAlign: 'right', padding: '12px 0', color: '#1f2937' }}>
                      {formatCurrency(b.creditLimit)}
                    </td>
                    <td style={{ textAlign: 'right', padding: '12px 0', color: '#1f2937' }}>
                      {formatCurrency(b.arOutstanding)}
                    </td>
                    <td
                      style={{
                        textAlign: 'center',
                        padding: '12px 0',
                        color:
                          b.utilization > 100
                            ? colors.red
                            : b.utilization > 75
                              ? colors.amber
                              : colors.green,
                        fontWeight: 600,
                      }}
                    >
                      {b.utilization.toFixed(1)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Quick Action Buttons */}
        <div style={{ display: 'flex', gap: 12, marginTop: 32 }}>
          <Link
            href="/ops/finance/ar"
            style={{
              padding: '12px 20px',
              backgroundColor: colors.walnut,
              color: 'white',
              borderRadius: 6,
              fontSize: 12,
              fontWeight: 600,
              textDecoration: 'none',
              cursor: 'pointer',
            }}
          >
            Go to AR
          </Link>
          <Link
            href="/ops/finance/ap"
            style={{
              padding: '12px 20px',
              backgroundColor: colors.amber,
              color: 'white',
              borderRadius: 6,
              fontSize: 12,
              fontWeight: 600,
              textDecoration: 'none',
              cursor: 'pointer',
            }}
          >
            Go to AP
          </Link>
          <Link
            href="/ops/finance"
            style={{
              padding: '12px 20px',
              backgroundColor: '#f3f4f6',
              color: '#374151',
              border: '1px solid #d1d5db',
              borderRadius: 6,
              fontSize: 12,
              fontWeight: 600,
              textDecoration: 'none',
              cursor: 'pointer',
            }}
          >
            Back to Finance Dashboard
          </Link>
        </div>
      </div>

      {/* Print Styles */}
      <style>{`
        @media print {
          body {
            background: white;
          }
          button, input[type="checkbox"], label {
            display: none;
          }
          div {
            page-break-inside: avoid;
          }
        }
      `}</style>
    </div>
  )
}
