'use client'

// ──────────────────────────────────────────────────────────────────────────
// Financial dashboard widgets — YTD KPI strip, per-month table, line chart.
// Pure presentational: accepts a MonthlyRollup and a selected quarter/year
// filter, renders all three. Used by finance/executive/reports/kpis pages.
//
// Chart: inline SVG (no recharts dep). Same-day-shippable > library-perfect.
// ──────────────────────────────────────────────────────────────────────────

import { useMemo } from 'react'
import type { MonthlyRollup, MonthlyFinancialRow, YtdTotals } from '@/lib/finance/monthly-rollup'

// ── Formatters ─────────────────────────────────────────────────────────────

const fmtMoney = (n: number) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(n)

const fmtMoneyCompact = (n: number) => {
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`
  if (Math.abs(n) >= 10_000) return `$${Math.round(n / 1000)}K`
  if (Math.abs(n) >= 1_000) return `$${(n / 1000).toFixed(1)}K`
  return fmtMoney(n)
}

const fmtInt = (n: number) => new Intl.NumberFormat('en-US').format(Math.round(n))
const fmtPct = (n: number, decimals = 1) => `${n.toFixed(decimals)}%`

// ── Types ──────────────────────────────────────────────────────────────────

export type QuarterFilter = 'Q1' | 'Q2' | 'Q3' | 'Q4' | 'YTD' | 'ALL'

export interface FinancialYtdBundleProps {
  data: MonthlyRollup
  /** Current month (1-12) for highlighting. Defaults to today's month. */
  currentMonth?: number
  /** Active quarter filter. Default "YTD". */
  quarter?: QuarterFilter
  onQuarterChange?: (q: QuarterFilter) => void
  /** Year selector */
  year?: number
  availableYears?: number[]
  onYearChange?: (y: number) => void
  /** Mask $ values when user lacks permission */
  restricted?: boolean
  /** Optional compact mode — smaller type, denser spacing. */
  compact?: boolean
}

// ── YTD KPI Strip ──────────────────────────────────────────────────────────

export function FinancialYtdStrip({
  ytd,
  restricted = false,
  compact = false,
}: {
  ytd: YtdTotals
  restricted?: boolean
  compact?: boolean
}) {
  const mask = '••••••'
  const val = (n: number, compactFmt = true) => {
    if (restricted) return mask
    return compactFmt ? fmtMoneyCompact(n) : fmtMoney(n)
  }

  const tiles = [
    { label: 'Revenue YTD', value: val(ytd.revenue), sub: `${fmtInt(ytd.orderCount)} orders`, tone: 'brand' as const },
    { label: 'COGS YTD', value: val(ytd.cogs), sub: 'Vendor PO spend', tone: 'neutral' as const },
    {
      label: 'Gross Profit YTD',
      value: val(ytd.gp),
      sub: restricted ? 'Admin only' : `${fmtPct(ytd.gpPct)} margin`,
      tone: ytd.gp >= 0 ? ('positive' as const) : ('negative' as const),
    },
    {
      label: 'Net Income YTD',
      value: val(ytd.ni),
      sub: 'GP proxy (opex TBD)',
      tone: ytd.ni >= 0 ? ('positive' as const) : ('negative' as const),
    },
    { label: 'Total Invoiced YTD', value: val(ytd.totalInvoiced), sub: `${fmtInt(ytd.invoiceCount)} invoices`, tone: 'accent' as const },
    { label: 'Total Collected YTD', value: val(ytd.totalCollected), sub: `${fmtInt(ytd.paymentCount)} payments`, tone: 'positive' as const },
    { label: 'AR Outstanding', value: val(ytd.arOutstanding), sub: 'Current — all open', tone: ytd.arOutstanding > 500_000 ? ('negative' as const) : ('accent' as const) },
    { label: 'Avg DSO', value: restricted ? mask : `${ytd.avgDso || 0}d`, sub: 'Issued → paid', tone: 'neutral' as const },
  ]

  const toneClass: Record<string, string> = {
    brand: 'text-[#0f2a3e]',
    accent: 'text-[#C6A24E]',
    positive: 'text-[#27AE60]',
    negative: 'text-red-600',
    neutral: 'text-gray-900',
  }

  return (
    <div
      className={`grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-${compact ? '2' : '3'}`}
      data-testid="ytd-strip"
    >
      {tiles.map((t) => (
        <div
          key={t.label}
          className={`bg-white rounded-lg border border-gray-200 ${compact ? 'p-3' : 'p-4'} shadow-sm`}
        >
          <div className={`text-[10px] uppercase tracking-wide font-semibold text-gray-500 ${compact ? '' : 'mb-1'}`}>
            {t.label}
          </div>
          <div
            className={`${compact ? 'text-lg' : 'text-2xl'} font-bold font-mono tabular-nums ${toneClass[t.tone]}`}
            style={{ fontFamily: 'ui-monospace, "JetBrains Mono", SFMono-Regular, Menlo, monospace' }}
          >
            {t.value}
          </div>
          <div className="text-[10px] text-gray-400 mt-1 truncate">{t.sub}</div>
        </div>
      ))}
    </div>
  )
}

// ── Year / Quarter controls ────────────────────────────────────────────────

export function YearQuarterControls({
  year,
  availableYears,
  onYearChange,
  quarter,
  onQuarterChange,
}: {
  year?: number
  availableYears?: number[]
  onYearChange?: (y: number) => void
  quarter: QuarterFilter
  onQuarterChange: (q: QuarterFilter) => void
}) {
  const years = availableYears ?? [new Date().getUTCFullYear()]
  const quarters: QuarterFilter[] = ['Q1', 'Q2', 'Q3', 'Q4', 'YTD', 'ALL']
  return (
    <div className="flex flex-wrap items-center gap-2">
      {year && onYearChange && (
        <select
          value={year}
          onChange={(e) => onYearChange(parseInt(e.target.value, 10))}
          className="border border-gray-300 rounded-md px-2 py-1 text-sm font-medium"
          aria-label="Year"
        >
          {years.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
      )}
      <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1">
        {quarters.map((q) => (
          <button
            key={q}
            type="button"
            onClick={() => onQuarterChange(q)}
            className={`px-2.5 py-1 text-xs font-semibold rounded-md transition ${
              quarter === q ? 'bg-white shadow text-[#0f2a3e]' : 'text-gray-500 hover:text-gray-800'
            }`}
          >
            {q}
          </button>
        ))}
      </div>
    </div>
  )
}

// ── Helper: resolve which months are "active" for a quarter ────────────────

export function monthsForQuarter(q: QuarterFilter, currentMonth: number): Set<number> {
  if (q === 'Q1') return new Set([1, 2, 3])
  if (q === 'Q2') return new Set([4, 5, 6])
  if (q === 'Q3') return new Set([7, 8, 9])
  if (q === 'Q4') return new Set([10, 11, 12])
  if (q === 'YTD') return new Set(Array.from({ length: currentMonth }, (_, i) => i + 1))
  return new Set(Array.from({ length: 12 }, (_, i) => i + 1)) // ALL
}

// ── Per-month table ────────────────────────────────────────────────────────

export function FinancialMonthTable({
  months,
  currentMonth,
  quarter,
  restricted = false,
}: {
  months: MonthlyFinancialRow[]
  currentMonth: number
  quarter: QuarterFilter
  restricted?: boolean
}) {
  const activeMonths = useMemo(() => monthsForQuarter(quarter, currentMonth), [quarter, currentMonth])
  const mask = '••••'
  const val = (n: number) => (restricted ? mask : fmtMoneyCompact(n))

  const rows: Array<{ label: string; get: (m: MonthlyFinancialRow) => string; tone: (m: MonthlyFinancialRow) => string }> = [
    { label: 'Revenue', get: (m) => val(m.revenue), tone: () => 'text-gray-900' },
    { label: 'COGS', get: (m) => val(m.cogs), tone: () => 'text-gray-700' },
    {
      label: 'Gross Profit',
      get: (m) => val(m.gp),
      tone: (m) => (m.gp > 0 ? 'text-[#27AE60]' : m.gp < 0 ? 'text-red-600' : 'text-gray-500'),
    },
    {
      label: 'Gross Margin %',
      get: (m) => (m.revenue > 0 ? `${m.gpPct.toFixed(1)}%` : '—'),
      tone: (m) => (m.gpPct >= 20 ? 'text-[#27AE60]' : m.gpPct >= 10 ? 'text-[#C6A24E]' : m.gpPct > 0 ? 'text-orange-600' : m.revenue === 0 ? 'text-gray-300' : 'text-red-600'),
    },
    {
      label: 'Net Income',
      get: (m) => val(m.ni),
      tone: (m) => (m.ni > 0 ? 'text-[#27AE60]' : m.ni < 0 ? 'text-red-600' : 'text-gray-500'),
    },
    { label: 'Invoices Sent', get: (m) => fmtInt(m.invoicesSent), tone: () => 'text-gray-700' },
    { label: 'Payments Received', get: (m) => fmtInt(m.paymentsReceived), tone: () => 'text-gray-700' },
  ]

  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
      <table className="w-full text-xs font-mono tabular-nums" style={{ fontFamily: 'ui-monospace, "JetBrains Mono", SFMono-Regular, Menlo, monospace' }}>
        <thead className="bg-gray-50 border-b border-gray-200">
          <tr>
            <th className="text-left px-3 py-2 font-semibold text-gray-600 sticky left-0 bg-gray-50 z-10" style={{ minWidth: 140 }}>
              Metric
            </th>
            {months.map((m) => {
              const isCurrent = m.month === currentMonth
              const isActive = activeMonths.has(m.month)
              return (
                <th
                  key={m.month}
                  className={`text-right px-2 py-2 font-semibold ${
                    isCurrent
                      ? 'bg-[#0f2a3e] text-white'
                      : isActive
                      ? 'text-[#0f2a3e] bg-[#0f2a3e]/5'
                      : 'text-gray-400'
                  }`}
                >
                  {m.monthLabel}
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, idx) => (
            <tr key={row.label} className={idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'}>
              <td className="px-3 py-2 font-medium text-gray-700 sticky left-0 z-10" style={{ backgroundColor: idx % 2 === 0 ? '#ffffff' : '#fafafa' }}>
                {row.label}
              </td>
              {months.map((m) => {
                const isCurrent = m.month === currentMonth
                const isActive = activeMonths.has(m.month)
                return (
                  <td
                    key={m.month}
                    className={`text-right px-2 py-2 ${row.tone(m)} ${
                      isCurrent
                        ? 'ring-2 ring-[#0f2a3e]/30 ring-inset font-semibold'
                        : isActive
                        ? ''
                        : 'opacity-50'
                    }`}
                  >
                    {row.get(m)}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── Inline SVG line chart ──────────────────────────────────────────────────

export function FinancialLineChart({
  months,
  currentMonth,
  height = 220,
  restricted = false,
  showGrid = true,
}: {
  months: MonthlyFinancialRow[]
  currentMonth: number
  height?: number
  restricted?: boolean
  showGrid?: boolean
}) {
  const padding = { top: 20, right: 16, bottom: 32, left: 56 }
  const width = 900 // viewBox width — scales via CSS

  const revenue = months.map((m) => m.revenue)
  const cogs = months.map((m) => m.cogs)
  const gp = months.map((m) => m.gp)

  const allValues = [...revenue, ...cogs, ...gp]
  const dataMax = Math.max(...allValues, 1)
  const dataMin = Math.min(...allValues, 0)
  const max = Math.ceil(dataMax / 50_000) * 50_000 || 50_000
  const min = Math.floor(dataMin / 50_000) * 50_000 || 0
  const range = max - min || 1

  const innerW = width - padding.left - padding.right
  const innerH = height - padding.top - padding.bottom

  const xAt = (i: number) => padding.left + (i / (months.length - 1)) * innerW
  const yAt = (v: number) => padding.top + innerH - ((v - min) / range) * innerH

  const path = (series: number[]) =>
    series.map((v, i) => `${i === 0 ? 'M' : 'L'} ${xAt(i).toFixed(2)} ${yAt(v).toFixed(2)}`).join(' ')

  // y-axis tick values — 5 ticks
  const ticks = Array.from({ length: 5 }, (_, i) => min + (range * i) / 4)

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4">
      <div className="flex items-center justify-between mb-2">
        <div>
          <div className="text-sm font-semibold text-gray-900">Revenue / COGS / Gross Profit</div>
          <div className="text-xs text-gray-500">Monthly trend, {months[0]?.monthLabel}–{months[11]?.monthLabel}</div>
        </div>
        <div className="flex items-center gap-3 text-[11px] font-medium">
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-3 h-0.5 bg-[#0f2a3e]" /> Revenue
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-3 h-0.5 bg-[#C6A24E]" /> COGS
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-3 h-0.5 bg-[#27AE60]" /> GP
          </span>
        </div>
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full"
        style={{ height }}
        role="img"
        aria-label="Monthly financial trend"
      >
        {/* grid */}
        {showGrid &&
          ticks.map((t, i) => (
            <g key={i}>
              <line
                x1={padding.left}
                x2={width - padding.right}
                y1={yAt(t)}
                y2={yAt(t)}
                stroke="#e5e7eb"
                strokeWidth={1}
                strokeDasharray={i === 0 ? '0' : '2 3'}
              />
              <text
                x={padding.left - 8}
                y={yAt(t) + 4}
                fontSize="10"
                textAnchor="end"
                fill="#9ca3af"
                fontFamily="ui-monospace, monospace"
              >
                {restricted ? '•••' : fmtMoneyCompact(t)}
              </text>
            </g>
          ))}

        {/* x-axis month labels */}
        {months.map((m, i) => {
          const isCurrent = m.month === currentMonth
          return (
            <text
              key={m.month}
              x={xAt(i)}
              y={height - padding.bottom + 16}
              fontSize="10"
              textAnchor="middle"
              fill={isCurrent ? '#0f2a3e' : '#6b7280'}
              fontWeight={isCurrent ? 700 : 500}
            >
              {m.monthLabel}
            </text>
          )
        })}

        {/* current month vertical highlight */}
        {currentMonth >= 1 && currentMonth <= 12 && (
          <line
            x1={xAt(currentMonth - 1)}
            x2={xAt(currentMonth - 1)}
            y1={padding.top}
            y2={height - padding.bottom}
            stroke="#0f2a3e"
            strokeWidth={1}
            strokeDasharray="3 3"
            opacity={0.3}
          />
        )}

        {/* COGS area + line */}
        <path
          d={`${path(cogs)} L ${xAt(months.length - 1)} ${yAt(min)} L ${xAt(0)} ${yAt(min)} Z`}
          fill="#C6A24E"
          opacity={0.08}
        />
        <path d={path(cogs)} fill="none" stroke="#C6A24E" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />

        {/* GP line */}
        <path d={path(gp)} fill="none" stroke="#27AE60" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />

        {/* Revenue area + line (on top) */}
        <path
          d={`${path(revenue)} L ${xAt(months.length - 1)} ${yAt(min)} L ${xAt(0)} ${yAt(min)} Z`}
          fill="#0f2a3e"
          opacity={0.08}
        />
        <path d={path(revenue)} fill="none" stroke="#0f2a3e" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />

        {/* revenue point dots */}
        {months.map((m, i) => {
          if (m.revenue === 0) return null
          return (
            <circle
              key={m.month}
              cx={xAt(i)}
              cy={yAt(m.revenue)}
              r={m.month === currentMonth ? 4 : 2.5}
              fill="#0f2a3e"
            />
          )
        })}
      </svg>
    </div>
  )
}

// ── Combined bundle — the whole YTD+per-month+chart block in one ──────────

export function FinancialYtdBundle(props: FinancialYtdBundleProps) {
  const {
    data,
    currentMonth,
    quarter = 'YTD',
    onQuarterChange,
    year,
    availableYears,
    onYearChange,
    restricted = false,
  } = props

  const nowMonth = currentMonth ?? new Date().getUTCMonth() + 1

  return (
    <div className="space-y-4">
      {/* Controls row */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <div className="text-xs uppercase tracking-wide font-semibold text-gray-500">Year to date</div>
          <div className="text-sm text-gray-600">{data.year} · live from Orders / Invoices / Payments / POs</div>
        </div>
        {onQuarterChange && (
          <YearQuarterControls
            year={year}
            availableYears={availableYears}
            onYearChange={onYearChange}
            quarter={quarter}
            onQuarterChange={onQuarterChange}
          />
        )}
      </div>

      {/* YTD KPI strip */}
      <FinancialYtdStrip ytd={data.ytd} restricted={restricted} />

      {/* Per-month table */}
      <FinancialMonthTable
        months={data.months}
        currentMonth={nowMonth}
        quarter={quarter}
        restricted={restricted}
      />

      {/* Chart */}
      <FinancialLineChart months={data.months} currentMonth={nowMonth} restricted={restricted} />
    </div>
  )
}

export default FinancialYtdBundle
