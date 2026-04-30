'use client'

/**
 * Builder Portal — Analytics client.
 *
 * §4.7 Spend & Analytics. Renders:
 *   - Period selector (MTD / QTD / YTD) — narrows the data displayed below
 *   - 4 KPI cards (Total Spend / AOV / Orders / Approval Rate)
 *   - 2x2 chart grid (SVG, Abel palette):
 *       Spend by Category (horizontal bar)
 *       Monthly Spend Trend (line)
 *       Payment Status (donut)
 *       Top Products (horizontal bar)
 *   - [EXEC] Volume Tier Progress (donut + tier ladder)
 *
 * No Chart.js — keeps the bundle small. Charts are pure inline SVG using
 * the same patterns as DashboardClient's SpendBarChart.
 */

import { useMemo, useState } from 'react'
import { Download, FileSpreadsheet, Sparkles, TrendingUp } from 'lucide-react'
import { PortalCard } from '@/components/portal/PortalCard'
import { PortalKpiCard } from '@/components/portal/PortalKpiCard'
import { usePortal } from '@/components/portal/PortalContext'
import type { AnalyticsResponse } from '@/types/portal'

export interface VolumeSavingsResponse {
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

export interface PricingIntelligenceResponse {
  tierStatus: {
    currentTier: string
    totalSpend: number
    nextTier: string | null
    spendNeededForNextTier: number
  }
  savingsBreakdown: Array<{
    month: string
    totalSpend: number
    actualPaid: number
    savings: number
    savingsPercent: number
  }>
  categoryPricing: Array<{
    category: string
    baseAvgPrice: number
    actualAvgPrice: number
    discountPercent: number
    totalSpent: number
    itemsOrdered: number
  }>
}

const PALETTE = {
  walnut: '#3E2A1E',
  kilnOak: '#8B6F47',
  amber: '#C9822B',
  sky: '#8CA8B8',
  dust: '#B8876B',
  brass: '#8B6F2A',
  oxblood: '#6E2A24',
  success: '#1A4B21',
  border: '#E8DFD0',
  borderLight: '#F0E8DA',
}

const CATEGORY_PALETTE = [
  PALETTE.amber,
  PALETTE.walnut,
  PALETTE.kilnOak,
  PALETTE.sky,
  PALETTE.dust,
  PALETTE.brass,
]

function fmtMoney(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`
  return `${Math.round(n)}`
}

function fmtUsdShort(n: number): string {
  return `$${fmtMoney(n)}`
}

interface AnalyticsClientProps {
  analytics: AnalyticsResponse | null
  volume: VolumeSavingsResponse | null
  pricing: PricingIntelligenceResponse | null
}

type Period = 'mtd' | 'qtd' | 'ytd'

export function AnalyticsClient({
  analytics,
  volume,
  pricing,
}: AnalyticsClientProps) {
  const { canSeeExec, viewMode } = usePortal()
  const showExec = canSeeExec && viewMode === 'exec'
  const [period, setPeriod] = useState<Period>('ytd')

  const monthly = analytics?.monthly ?? []
  const ytdSpend = analytics?.keyMetrics.ytdSpend ?? 0
  const ytdOrders = analytics?.keyMetrics.ytdOrders ?? 0
  const aov = analytics?.keyMetrics.avgOrderValue ?? 0
  const approvalRate = analytics?.keyMetrics.approvalRate ?? 0

  // Compute period-narrowed totals from monthly breakdown
  const periodTotals = useMemo(() => {
    if (monthly.length === 0)
      return { spend: ytdSpend, orders: ytdOrders, label: 'Year to Date' }
    const now = new Date()
    const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
    const currentQuarterStart = Math.floor(now.getMonth() / 3) * 3
    if (period === 'mtd') {
      const m = monthly.find((x) => x.month === currentMonthKey)
      return {
        spend: m?.spend ?? 0,
        orders: m?.orders ?? 0,
        label: 'Month to Date',
      }
    }
    if (period === 'qtd') {
      const filtered = monthly.filter((x) => {
        const [y, m] = x.month.split('-').map(Number)
        if (y !== now.getFullYear()) return false
        return m - 1 >= currentQuarterStart && m - 1 <= now.getMonth()
      })
      return {
        spend: filtered.reduce((s, x) => s + x.spend, 0),
        orders: filtered.reduce((s, x) => s + x.orders, 0),
        label: 'Quarter to Date',
      }
    }
    return { spend: ytdSpend, orders: ytdOrders, label: 'Year to Date' }
  }, [monthly, period, ytdSpend, ytdOrders])

  function exportCsv() {
    const rows: string[] = ['Month,Orders,Spend']
    for (const m of monthly) {
      rows.push(`${m.month},${m.orders},${m.spend.toFixed(2)}`)
    }
    rows.push('')
    rows.push('Category,Orders,Spend')
    for (const c of analytics?.spendByCategory ?? []) {
      rows.push(
        `"${c.category.replace(/"/g, '""')}",${c.orders},${c.spend.toFixed(2)}`,
      )
    }
    const blob = new Blob([rows.join('\n')], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `abel-spend-${new Date().toISOString().slice(0, 10)}.csv`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h2
            className="text-2xl font-medium leading-tight"
            style={{
              fontFamily: 'var(--font-portal-display, Georgia)',
              color: 'var(--portal-text-strong, #3E2A1E)',
              letterSpacing: '-0.02em',
            }}
          >
            Spend & Analytics
          </h2>
          <p
            className="text-sm mt-1"
            style={{ color: 'var(--portal-text-muted, #6B6056)' }}
          >
            {periodTotals.label} · {periodTotals.orders} orders · $
            {fmtMoney(periodTotals.spend)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex gap-1">
            {(['mtd', 'qtd', 'ytd'] as Period[]).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPeriod(p)}
                className="h-8 px-3 rounded-full text-xs font-medium transition-colors"
                style={
                  period === p
                    ? {
                        background: 'var(--portal-walnut, #3E2A1E)',
                        color: 'white',
                      }
                    : {
                        background: 'var(--portal-bg-card, #FFFFFF)',
                        color: 'var(--portal-text-strong, #3E2A1E)',
                        border: '1px solid var(--portal-border, #E8DFD0)',
                      }
                }
              >
                {p.toUpperCase()}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={exportCsv}
            className="inline-flex items-center gap-1.5 px-3 h-8 rounded-md text-xs font-medium transition-colors"
            style={{
              background: 'var(--portal-bg-card, #FFFFFF)',
              color: 'var(--portal-text-strong, #3E2A1E)',
              border: '1px solid var(--portal-border, #E8DFD0)',
            }}
          >
            <FileSpreadsheet className="w-3.5 h-3.5" />
            CSV
          </button>
          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex items-center gap-1.5 px-3 h-8 rounded-md text-xs font-medium transition-colors print:hidden"
            style={{
              background: 'var(--portal-bg-card, #FFFFFF)',
              color: 'var(--portal-text-strong, #3E2A1E)',
              border: '1px solid var(--portal-border, #E8DFD0)',
            }}
          >
            <Download className="w-3.5 h-3.5" />
            PDF
          </button>
        </div>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <PortalKpiCard
          label="Total Spend"
          value={Math.round(periodTotals.spend / 1000)}
          prefix="$"
          suffix="K"
          accentColor="var(--portal-walnut, #3E2A1E)"
        />
        <PortalKpiCard
          label="Avg Order Value"
          value={Math.round(aov / 1000)}
          prefix="$"
          suffix="K"
          decimals={1}
          accentColor="var(--portal-amber, #C9822B)"
        />
        <PortalKpiCard
          label="Orders"
          value={periodTotals.orders}
          accentColor="var(--portal-sky, #8CA8B8)"
        />
        <PortalKpiCard
          label="Approval Rate"
          value={approvalRate}
          suffix="%"
          decimals={0}
          accentColor="var(--portal-kiln-oak, #8B6F47)"
        />
      </div>

      {/* 2x2 chart grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <PortalCard
          title="Spend by Category"
          subtitle={
            (analytics?.spendByCategory.length ?? 0) > 0
              ? `${analytics?.spendByCategory.length} categories`
              : 'No data yet'
          }
        >
          <CategoryBarChart data={analytics?.spendByCategory ?? []} />
        </PortalCard>

        <PortalCard
          title="Monthly Spend Trend"
          subtitle={
            monthly.length > 0
              ? `${monthly.length} months`
              : 'No data yet'
          }
        >
          <MonthlyLineChart data={monthly} />
        </PortalCard>

        <PortalCard
          title="Payment Status"
          subtitle={
            (analytics?.paymentStats.totalInvoices ?? 0) > 0
              ? `${analytics?.paymentStats.totalInvoices} invoices`
              : 'No invoices yet'
          }
        >
          <PaymentDonut stats={analytics?.paymentStats} />
        </PortalCard>

        <PortalCard
          title="Top Products by Spend"
          subtitle={
            (analytics?.topProducts.length ?? 0) > 0
              ? `Top ${analytics?.topProducts.length}`
              : 'No data yet'
          }
        >
          <TopProductsBars data={analytics?.topProducts.slice(0, 8) ?? []} />
        </PortalCard>
      </div>

      {/* EXEC: Volume tier */}
      {showExec && volume && (
        <PortalCard
          title="Volume Tier Status"
          subtitle="Earn higher tier discounts as your annual spend grows"
          action={
            <span
              className="inline-flex items-center gap-1 px-3 h-8 rounded-full text-xs font-medium"
              style={{
                background: 'rgba(201,130,43,0.12)',
                color: '#7A4E0F',
                border: '1px solid rgba(201,130,43,0.2)',
              }}
            >
              <Sparkles className="w-3 h-3" />
              {volume.currentTier} · {volume.currentDiscountPercent}%
            </span>
          }
        >
          <VolumeTierProgress volume={volume} />
        </PortalCard>
      )}

      {/* EXEC: Pricing intelligence (savings + category) */}
      {showExec && pricing && pricing.categoryPricing.length > 0 && (
        <PortalCard
          title="Category Pricing vs Base"
          subtitle="Where your tier and custom prices save you money"
        >
          <CategoryPricingTable items={pricing.categoryPricing.slice(0, 8)} />
        </PortalCard>
      )}

      <style jsx global>{`
        @media print {
          .print\\:hidden { display: none !important; }
          [data-portal] { background: #FFFFFF !important; }
        }
      `}</style>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────
// Charts (SVG)
// ──────────────────────────────────────────────────────────────────────

function CategoryBarChart({
  data,
}: {
  data: AnalyticsResponse['spendByCategory']
}) {
  if (data.length === 0) {
    return (
      <div
        className="text-center py-12 text-sm"
        style={{ color: 'var(--portal-text-muted, #6B6056)' }}
      >
        No category spend data.
      </div>
    )
  }
  const sorted = [...data].sort((a, b) => b.spend - a.spend).slice(0, 8)
  const max = Math.max(...sorted.map((d) => d.spend), 1)

  return (
    <div className="space-y-2.5">
      {sorted.map((d, i) => {
        const pct = (d.spend / max) * 100
        const color = CATEGORY_PALETTE[i % CATEGORY_PALETTE.length]
        return (
          <div key={d.category} className="grid grid-cols-[120px_1fr_auto] gap-3 items-center">
            <div
              className="text-xs truncate"
              style={{ color: 'var(--portal-text-strong, #3E2A1E)' }}
              title={d.category}
            >
              {d.category}
            </div>
            <div
              className="h-5 rounded-r-md relative"
              style={{
                background: 'var(--portal-bg-elevated, #FAF5E8)',
              }}
            >
              <div
                className="absolute left-0 top-0 bottom-0 rounded-r-md transition-all duration-700"
                style={{
                  width: `${pct}%`,
                  background: color,
                  minWidth: 2,
                }}
              />
            </div>
            <div
              className="text-xs font-mono tabular-nums text-right min-w-[60px]"
              style={{ color: 'var(--portal-text-strong, #3E2A1E)' }}
            >
              {fmtUsdShort(d.spend)}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function MonthlyLineChart({
  data,
}: {
  data: AnalyticsResponse['monthly']
}) {
  if (data.length === 0) {
    return (
      <div
        className="text-center py-12 text-sm"
        style={{ color: 'var(--portal-text-muted, #6B6056)' }}
      >
        No monthly spend yet.
      </div>
    )
  }
  const recent = data.slice(-12)
  const max = Math.max(...recent.map((m) => m.spend), 1)
  const W = 320
  const H = 160
  const pad = { top: 10, right: 10, bottom: 24, left: 36 }
  const cw = W - pad.left - pad.right
  const ch = H - pad.top - pad.bottom

  const points = recent.map((m, i) => {
    const x = pad.left + (recent.length === 1 ? cw / 2 : (i / (recent.length - 1)) * cw)
    const y = pad.top + ch - (m.spend / max) * ch
    return { x, y, m }
  })
  const path = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
    .join(' ')
  const area =
    `M ${points[0].x.toFixed(1)} ${(pad.top + ch).toFixed(1)} ` +
    points
      .map((p) => `L ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
      .join(' ') +
    ` L ${points[points.length - 1].x.toFixed(1)} ${(pad.top + ch).toFixed(1)} Z`

  // Y-axis ticks at 0/50/100% of max
  const yTicks = [0, 0.5, 1].map((t) => ({
    y: pad.top + ch - t * ch,
    label: fmtUsdShort(max * t),
  }))

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-44" role="img" aria-label="Monthly spend trend">
      <defs>
        <linearGradient id="line-area-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={PALETTE.amber} stopOpacity="0.3" />
          <stop offset="100%" stopColor={PALETTE.amber} stopOpacity="0" />
        </linearGradient>
      </defs>
      {/* Y grid */}
      {yTicks.map((t) => (
        <g key={t.y}>
          <line
            x1={pad.left}
            x2={W - pad.right}
            y1={t.y}
            y2={t.y}
            stroke={PALETTE.borderLight}
            strokeDasharray="3 3"
          />
          <text
            x={pad.left - 4}
            y={t.y + 3}
            fontSize="9"
            textAnchor="end"
            fill={PALETTE.kilnOak}
          >
            {t.label}
          </text>
        </g>
      ))}
      {/* Area + line */}
      <path d={area} fill="url(#line-area-fill)" />
      <path d={path} fill="none" stroke={PALETTE.amber} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      {/* Dots */}
      {points.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r={2.5} fill={PALETTE.amber}>
          <title>
            {p.m.month}: {fmtUsdShort(p.m.spend)} / {p.m.orders} orders
          </title>
        </circle>
      ))}
      {/* X labels (first, last, mid) */}
      {[0, Math.floor(recent.length / 2), recent.length - 1].map((i) =>
        recent[i] ? (
          <text
            key={i}
            x={points[i].x}
            y={H - 8}
            fontSize="9"
            textAnchor="middle"
            fill={PALETTE.kilnOak}
          >
            {recent[i].month.slice(2)}
          </text>
        ) : null,
      )}
    </svg>
  )
}

function PaymentDonut({
  stats,
}: {
  stats?: AnalyticsResponse['paymentStats']
}) {
  const total = stats?.totalInvoices ?? 0
  if (total === 0) {
    return (
      <div
        className="text-center py-12 text-sm"
        style={{ color: 'var(--portal-text-muted, #6B6056)' }}
      >
        No invoices yet.
      </div>
    )
  }
  const paid = stats?.paid ?? 0
  const overdue = stats?.overdue ?? 0
  const open = Math.max(0, total - paid - overdue)
  const segments = [
    { value: paid, label: 'Paid', color: PALETTE.success },
    { value: open, label: 'Open', color: PALETTE.amber },
    { value: overdue, label: 'Overdue', color: PALETTE.oxblood },
  ].filter((s) => s.value > 0)

  const W = 200
  const cx = W / 2
  const cy = W / 2
  const r = 70
  const strokeW = 24
  const c = 2 * Math.PI * r
  let acc = 0
  return (
    <div className="flex flex-col md:flex-row items-center gap-4">
      <svg viewBox={`0 0 ${W} ${W}`} className="w-40 h-40 shrink-0" role="img" aria-label="Payment status donut">
        <circle cx={cx} cy={cy} r={r} fill="none" stroke={PALETTE.borderLight} strokeWidth={strokeW} />
        {segments.map((s, i) => {
          const length = (s.value / total) * c
          const offset = c - length
          const rotation = (acc / total) * 360 - 90
          acc += s.value
          return (
            <circle
              key={i}
              cx={cx}
              cy={cy}
              r={r}
              fill="none"
              stroke={s.color}
              strokeWidth={strokeW}
              strokeDasharray={`${length} ${c}`}
              strokeDashoffset={0}
              transform={`rotate(${rotation} ${cx} ${cy})`}
            >
              <title>
                {s.label}: {s.value}
              </title>
            </circle>
          )
        })}
        <text
          x={cx}
          y={cy - 4}
          textAnchor="middle"
          fontSize="14"
          fill={PALETTE.walnut}
          fontWeight="600"
        >
          {total}
        </text>
        <text
          x={cx}
          y={cy + 12}
          textAnchor="middle"
          fontSize="9"
          fill={PALETTE.kilnOak}
        >
          invoices
        </text>
      </svg>
      <ul className="space-y-1.5 text-xs">
        {segments.map((s) => (
          <li key={s.label} className="flex items-center gap-2">
            <span
              className="inline-block w-3 h-3 rounded-sm"
              style={{ background: s.color }}
            />
            <span style={{ color: 'var(--portal-text-strong, #3E2A1E)' }}>
              {s.label}
            </span>
            <span
              className="font-mono tabular-nums"
              style={{ color: 'var(--portal-text-muted, #6B6056)' }}
            >
              {s.value} ({Math.round((s.value / total) * 100)}%)
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function TopProductsBars({
  data,
}: {
  data: AnalyticsResponse['topProducts']
}) {
  if (data.length === 0) {
    return (
      <div
        className="text-center py-12 text-sm"
        style={{ color: 'var(--portal-text-muted, #6B6056)' }}
      >
        No product spend yet.
      </div>
    )
  }
  const max = Math.max(...data.map((d) => d.spend), 1)

  return (
    <div className="space-y-2.5">
      {data.map((p) => {
        const pct = (p.spend / max) * 100
        return (
          <div key={p.sku} className="grid grid-cols-[1fr_auto] gap-3 items-center">
            <div className="min-w-0">
              <div
                className="text-xs font-medium truncate leading-tight"
                style={{ color: 'var(--portal-text-strong, #3E2A1E)' }}
                title={p.name}
              >
                {p.name}
              </div>
              <div
                className="h-2 mt-1 rounded-r-md relative"
                style={{ background: 'var(--portal-bg-elevated, #FAF5E8)' }}
              >
                <div
                  className="absolute left-0 top-0 bottom-0 rounded-r-md transition-all duration-700"
                  style={{
                    width: `${pct}%`,
                    background:
                      'var(--grad-amber, linear-gradient(90deg, #C9822B, #D4A54A))',
                    minWidth: 2,
                  }}
                />
              </div>
            </div>
            <div
              className="text-xs font-mono tabular-nums text-right min-w-[60px]"
              style={{ color: 'var(--portal-text-strong, #3E2A1E)' }}
            >
              {fmtUsdShort(p.spend)}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────
// Volume tier progress (exec)
// ──────────────────────────────────────────────────────────────────────

function VolumeTierProgress({ volume }: { volume: VolumeSavingsResponse }) {
  const TIERS = ['Bronze', 'Silver', 'Gold', 'Platinum']
  const idx = TIERS.indexOf(volume.currentTier)
  const nextThreshold = volume.nextTierThreshold ?? volume.yearTotal
  const progress = nextThreshold
    ? Math.min(100, (volume.yearTotal / nextThreshold) * 100)
    : 100

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Stat
          label="YTD Spend"
          value={fmtUsdShort(volume.yearTotal)}
          accent="var(--portal-walnut, #3E2A1E)"
        />
        <Stat
          label="Saved at Tier"
          value={fmtUsdShort(volume.savingsAtCurrentTier)}
          accent="var(--portal-success, #1A4B21)"
        />
        <Stat
          label={volume.nextTier ? `${volume.amountToNextTier ? fmtUsdShort(volume.amountToNextTier) : '—'} to ${volume.nextTier}` : 'Top tier'}
          value={
            volume.nextTier
              ? `+${volume.nextTierDiscountPercent ?? 0}%`
              : '✓'
          }
          accent="var(--portal-amber, #C9822B)"
        />
      </div>
      {/* Tier ladder */}
      <div className="space-y-2">
        {TIERS.map((t, i) => {
          const tierData = volume.estimatedSavingsAtEachTier.find(
            (e) => e.tier === t,
          )
          const isCurrent = i === idx
          const passed = i < idx
          return (
            <div
              key={t}
              className="grid grid-cols-[120px_1fr_auto] gap-3 items-center"
            >
              <div className="flex items-center gap-2">
                <span className="text-base">
                  {t === 'Bronze' && '🥉'}
                  {t === 'Silver' && '🥈'}
                  {t === 'Gold' && '🥇'}
                  {t === 'Platinum' && '💎'}
                </span>
                <span
                  className="text-xs font-medium"
                  style={{
                    color:
                      isCurrent
                        ? 'var(--portal-amber, #C9822B)'
                        : 'var(--portal-text-strong, #3E2A1E)',
                    fontWeight: isCurrent ? 700 : 500,
                  }}
                >
                  {t}
                </span>
              </div>
              <div
                className="h-3 rounded-full relative"
                style={{ background: 'var(--portal-bg-elevated, #FAF5E8)' }}
              >
                {(isCurrent || passed) && (
                  <div
                    className="absolute left-0 top-0 bottom-0 rounded-full transition-all duration-700"
                    style={{
                      width: isCurrent ? `${progress}%` : '100%',
                      background: passed
                        ? 'var(--portal-walnut, #3E2A1E)'
                        : 'var(--grad-amber, linear-gradient(90deg, #C9822B, #D4A54A))',
                    }}
                  />
                )}
              </div>
              <div
                className="text-xs font-mono tabular-nums text-right min-w-[80px]"
                style={{
                  color:
                    isCurrent || passed
                      ? 'var(--portal-text-strong, #3E2A1E)'
                      : 'var(--portal-text-muted, #6B6056)',
                }}
              >
                {tierData
                  ? `${tierData.discountPercent}%`
                  : '—'}
              </div>
            </div>
          )
        })}
      </div>
      <div
        className="flex items-start gap-2 text-xs p-3 rounded-md"
        style={{
          background: 'var(--portal-bg-elevated, #FAF5E8)',
          color: 'var(--portal-text, #2C2C2C)',
        }}
      >
        <TrendingUp
          className="w-3.5 h-3.5 shrink-0 mt-0.5"
          style={{ color: 'var(--portal-amber, #C9822B)' }}
        />
        <div>
          {volume.nextTier ? (
            <>
              You&apos;re{' '}
              <strong>
                {volume.amountToNextTier
                  ? fmtUsdShort(volume.amountToNextTier)
                  : '—'}
              </strong>{' '}
              away from <strong>{volume.nextTier}</strong>. At that tier, your
              year-to-date spend would have saved you{' '}
              <strong>
                {fmtUsdShort(
                  volume.estimatedSavingsAtEachTier.find(
                    (e) => e.tier === volume.nextTier,
                  )?.estimatedSavings ?? 0,
                )}
              </strong>
              .
            </>
          ) : (
            <>You&apos;re at the top tier. Maximum volume discount applied.</>
          )}
        </div>
      </div>
    </div>
  )
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string
  value: string
  accent: string
}) {
  return (
    <div
      className="rounded-md p-3 relative overflow-hidden"
      style={{
        background: 'var(--portal-bg-card, #FFFFFF)',
        border: '1px solid var(--portal-border-light, #F0E8DA)',
      }}
    >
      <div
        className="absolute left-0 top-0 bottom-0 w-1"
        style={{ background: accent }}
      />
      <div className="pl-1.5">
        <div
          className="text-[10px] uppercase tracking-wider"
          style={{ color: 'var(--portal-kiln-oak, #8B6F47)' }}
        >
          {label}
        </div>
        <div
          className="text-base font-semibold tabular-nums mt-0.5"
          style={{
            fontFamily: 'var(--font-portal-display, Georgia)',
            color: 'var(--portal-text-strong, #3E2A1E)',
          }}
        >
          {value}
        </div>
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────
// Category pricing table (exec)
// ──────────────────────────────────────────────────────────────────────

function CategoryPricingTable({
  items,
}: {
  items: PricingIntelligenceResponse['categoryPricing']
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr
            className="text-left text-[10px] uppercase tracking-wider"
            style={{ color: 'var(--portal-kiln-oak, #8B6F47)' }}
          >
            <th className="px-2 py-2 font-semibold">Category</th>
            <th className="px-2 py-2 font-semibold text-right">List Avg</th>
            <th className="px-2 py-2 font-semibold text-right">Your Avg</th>
            <th className="px-2 py-2 font-semibold text-right">Discount</th>
            <th className="px-2 py-2 font-semibold text-right">Spent</th>
          </tr>
        </thead>
        <tbody>
          {items.map((c) => (
            <tr
              key={c.category}
              className="border-t"
              style={{ borderColor: 'var(--portal-border-light, #F0E8DA)' }}
            >
              <td
                className="px-2 py-2"
                style={{ color: 'var(--portal-text-strong, #3E2A1E)' }}
              >
                {c.category}
              </td>
              <td
                className="px-2 py-2 text-right tabular-nums font-mono text-xs"
                style={{ color: 'var(--portal-text-muted, #6B6056)' }}
              >
                ${c.baseAvgPrice.toFixed(2)}
              </td>
              <td
                className="px-2 py-2 text-right tabular-nums font-mono"
                style={{ color: 'var(--portal-text-strong, #3E2A1E)' }}
              >
                ${c.actualAvgPrice.toFixed(2)}
              </td>
              <td
                className="px-2 py-2 text-right tabular-nums font-mono"
                style={{
                  color:
                    c.discountPercent > 0
                      ? 'var(--portal-success, #1A4B21)'
                      : 'var(--portal-text-muted, #6B6056)',
                }}
              >
                {c.discountPercent > 0 ? `-${c.discountPercent.toFixed(1)}%` : '—'}
              </td>
              <td
                className="px-2 py-2 text-right tabular-nums font-mono"
                style={{ color: 'var(--portal-text-strong, #3E2A1E)' }}
              >
                {fmtUsdShort(c.totalSpent)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
