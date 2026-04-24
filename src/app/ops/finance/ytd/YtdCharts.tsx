'use client'

// ──────────────────────────────────────────────────────────────────────────
// YTD Financial Summary — client-side charts + KPI cards + tables.
// Consumes the /api/ops/finance/ytd payload. Pure SVG charts (no chart lib).
// Uses the Blueprint palette via --c1..--c4 CSS variables, so it picks up
// whatever globals.css has set (currently indigo / blue / sky / cyan).
// ──────────────────────────────────────────────────────────────────────────

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'

// ── Types match /api/ops/finance/ytd response ─────────────────────────────

interface YtdMonthRow {
  month: number
  monthLabel: string
  revenue: number
  cogs: number
  gm: number
  gmPct: number
}
interface YtdCompareYear {
  year: number
  revenue: number
  cogs: number
  gm: number
  gmPct: number
  cumulativeByMonth: number[]
  sameWindowRevenue: number
  sameWindowCogs: number
  sameWindowGm: number
}
interface YtdTopBuilder {
  builderId: string
  builderName: string
  revenue: number
  cogs: number
  gmDollar: number
  gmPct: number
  orderCount: number
}
interface YtdResponse {
  year: number
  asOf: string
  asOfMonth: number
  revenue: number
  cogs: number
  gm: number
  gmPct: number
  opex: number
  byMonth: YtdMonthRow[]
  compare: Record<string, YtdCompareYear>
  yoy: {
    revenueDelta: number
    revenueDeltaPct: number
    cogsDelta: number
    cogsDeltaPct: number
    gmDelta: number
    gmDeltaPct: number
  }
  topBuilders: YtdTopBuilder[]
  topByGmPct: YtdTopBuilder[]
}

// ── Formatters ────────────────────────────────────────────────────────────

const fmtUSD0 = (n: number) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(n || 0)

const fmtUSDCompact = (n: number) => {
  const v = n || 0
  if (Math.abs(v) >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`
  if (Math.abs(v) >= 10_000) return `$${Math.round(v / 1000)}K`
  if (Math.abs(v) >= 1_000) return `$${(v / 1000).toFixed(1)}K`
  return fmtUSD0(v)
}

const fmtPct = (n: number, decimals = 1) => `${(n || 0).toFixed(decimals)}%`

const fmtInt = (n: number) => new Intl.NumberFormat('en-US').format(Math.round(n || 0))

// ── Top-level component ───────────────────────────────────────────────────

export default function YtdCharts({
  initialYear,
  asOfMonth,
}: {
  initialYear: number
  asOfMonth: number
}) {
  const [year, setYear] = useState(initialYear)
  const [data, setData] = useState<YtdResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    fetch(`/api/ops/finance/ytd?year=${year}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d) => {
        if (cancelled) return
        if (d.error) setError(d.error)
        else setData(d as YtdResponse)
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [year])

  const currentYear = new Date().getUTCFullYear()
  const yearChoices = [currentYear, currentYear - 1, currentYear - 2, currentYear - 3]

  return (
    <div className="space-y-6 ytd-report">
      {/* Header with year toggle + Print */}
      <div className="flex items-start justify-between flex-wrap gap-3 print:hidden">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">YTD Financial Summary</h1>
          <p className="text-gray-500 mt-1 text-sm">
            Year-to-{' '}
            {data
              ? new Date(data.asOf).toLocaleDateString('en-US', {
                  month: 'long',
                  day: 'numeric',
                  year: 'numeric',
                })
              : '…'}{' '}
            · Revenue · COGS · Gross Margin · Operating Expense
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Year</label>
          <select
            value={year}
            onChange={(e) => setYear(parseInt(e.target.value, 10))}
            className="border border-gray-300 rounded-md px-2 py-1 text-sm font-medium"
            aria-label="Year"
          >
            {yearChoices.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => typeof window !== 'undefined' && window.print()}
            className="px-3 py-1.5 text-sm font-medium rounded-md border border-gray-300 bg-white hover:bg-gray-50 transition-colors"
            title="Print or save as PDF"
          >
            Download PDF
          </button>
        </div>
      </div>

      {/* Print header — only visible in print */}
      <div className="hidden print:block mb-4">
        <h1 className="text-2xl font-bold text-gray-900">
          YTD Financial Summary · {year}
          {data ? ` · as of ${new Date(data.asOf).toLocaleDateString('en-US')}` : ''}
        </h1>
      </div>

      {loading && !data && (
        <div className="bg-white rounded-lg border border-gray-200 p-8 text-center text-gray-500 text-sm">
          Loading YTD rollup…
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">
          Couldn't load YTD data: {error}
        </div>
      )}

      {data && (
        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_260px] gap-6">
          <div className="space-y-6 min-w-0">
            <KpiRow data={data} />
            <MonthlyBarChart months={data.byMonth} asOfMonth={asOfMonth} />
            <ThreeYearCompareChart compare={data.compare} primaryYear={data.year} />
            <TopBuilderTables top={data.topBuilders} topGm={data.topByGmPct} />
          </div>
          <aside className="print:hidden">
            <RightRail />
          </aside>
        </div>
      )}

      {/* Print-only stylesheet */}
      <style jsx global>{`
        @media print {
          @page {
            margin: 0.5in;
            size: letter portrait;
          }
          body {
            background: white !important;
          }
          .ytd-report {
            color-adjust: exact;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
          .ytd-report svg {
            max-width: 100%;
          }
          .print-break-inside-avoid {
            break-inside: avoid;
            page-break-inside: avoid;
          }
        }
      `}</style>
    </div>
  )
}

// ── KPI Cards Row ─────────────────────────────────────────────────────────

function KpiRow({ data }: { data: YtdResponse }) {
  const tiles = [
    {
      label: 'Revenue YTD',
      value: fmtUSD0(data.revenue),
      delta: data.yoy.revenueDeltaPct,
      deltaDollar: data.yoy.revenueDelta,
      positiveIsGood: true,
      accent: 'var(--c1, #4F46E5)',
    },
    {
      label: 'COGS YTD',
      value: fmtUSD0(data.cogs),
      delta: data.yoy.cogsDeltaPct,
      deltaDollar: data.yoy.cogsDelta,
      positiveIsGood: false, // COGS up = bad
      accent: 'var(--c2, #2563EB)',
    },
    {
      label: 'Gross Margin',
      value: fmtPct(data.gmPct),
      sub: `${fmtUSD0(data.gm)} GP`,
      delta: data.yoy.gmDeltaPct,
      deltaDollar: data.yoy.gmDelta,
      positiveIsGood: true,
      accent: 'var(--c3, #0EA5E9)',
    },
    {
      label: 'Operating Expense',
      value: fmtUSD0(data.opex),
      sub: 'General-category PO spend',
      delta: 0,
      deltaDollar: 0,
      positiveIsGood: false,
      accent: 'var(--c4, #06B6D4)',
      noDelta: true as const,
    },
  ]

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 print-break-inside-avoid">
      {tiles.map((t) => {
        const isPos = (t.delta ?? 0) >= 0
        const good = t.positiveIsGood ? isPos : !isPos
        const deltaColor = t.noDelta
          ? 'text-gray-400'
          : good
            ? 'text-[#15803d]'
            : 'text-[#b91c1c]'
        const arrow = t.noDelta ? '·' : isPos ? '▲' : '▼'
        return (
          <div
            key={t.label}
            className="bg-white rounded-lg border border-gray-200 shadow-sm p-5 relative overflow-hidden"
          >
            <div
              className="absolute top-0 left-0 right-0 h-1"
              style={{ background: t.accent }}
            />
            <div className="text-[11px] uppercase tracking-wide font-semibold text-gray-500">
              {t.label}
            </div>
            <div
              className="text-3xl font-bold text-gray-900 mt-2 font-mono tabular-nums"
              style={{ fontFamily: 'ui-monospace, "JetBrains Mono", SFMono-Regular, Menlo, monospace' }}
            >
              {t.value}
            </div>
            {t.sub && <div className="text-xs text-gray-500 mt-1">{t.sub}</div>}
            <div className={`mt-2 text-xs font-semibold ${deltaColor}`}>
              <span className="mr-1">{arrow}</span>
              {t.noDelta ? (
                'No YoY baseline'
              ) : (
                <>
                  {isPos ? '+' : ''}
                  {(t.delta ?? 0).toFixed(1)}% vs last year
                  <span className="text-gray-400 font-normal ml-1">
                    ({isPos ? '+' : ''}
                    {fmtUSDCompact(t.deltaDollar ?? 0)})
                  </span>
                </>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── Monthly stacked bar chart — Revenue vs COGS per month ─────────────────

function MonthlyBarChart({
  months,
  asOfMonth,
}: {
  months: YtdMonthRow[]
  asOfMonth: number
}) {
  const width = 900
  const height = 260
  const padding = { top: 20, right: 16, bottom: 36, left: 64 }
  const innerW = width - padding.left - padding.right
  const innerH = height - padding.top - padding.bottom

  const maxBar = useMemo(() => {
    const peak = Math.max(
      ...months.map((m) => Math.max(m.revenue, m.cogs)),
      1
    )
    return Math.ceil(peak / 50_000) * 50_000 || 50_000
  }, [months])

  const bandW = innerW / months.length
  const barW = Math.max(6, Math.min(22, bandW * 0.35))

  const xBand = (i: number) => padding.left + i * bandW + bandW / 2
  const yAt = (v: number) => padding.top + innerH - (v / maxBar) * innerH

  const ticks = Array.from({ length: 5 }, (_, i) => (maxBar * i) / 4)

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4 print-break-inside-avoid">
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="text-sm font-semibold text-gray-900">Monthly Revenue vs COGS</div>
          <div className="text-xs text-gray-500">
            Jan through {months[asOfMonth - 1]?.monthLabel ?? 'current'} · side-by-side bars
          </div>
        </div>
        <div className="flex items-center gap-4 text-[11px] font-medium">
          <span className="flex items-center gap-1.5">
            <span
              className="inline-block w-3 h-3 rounded-sm"
              style={{ background: 'var(--c1, #4F46E5)' }}
            />
            Revenue
          </span>
          <span className="flex items-center gap-1.5">
            <span
              className="inline-block w-3 h-3 rounded-sm"
              style={{ background: 'var(--c3, #0EA5E9)' }}
            />
            COGS
          </span>
        </div>
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full"
        style={{ height }}
        role="img"
        aria-label="Monthly revenue vs COGS"
      >
        {/* gridlines + y labels */}
        {ticks.map((t, i) => (
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
              {fmtUSDCompact(t)}
            </text>
          </g>
        ))}

        {/* bars */}
        {months.map((m, i) => {
          const cx = xBand(i)
          const isFuture = m.month > asOfMonth
          const revH = Math.max(0, yAt(0) - yAt(m.revenue))
          const cogsH = Math.max(0, yAt(0) - yAt(m.cogs))
          const baseY = yAt(0)
          return (
            <g key={m.month} opacity={isFuture ? 0.35 : 1}>
              {/* Revenue bar — left */}
              <rect
                x={cx - barW - 1}
                y={baseY - revH}
                width={barW}
                height={revH}
                fill="var(--c1, #4F46E5)"
                rx={2}
              >
                <title>
                  {m.monthLabel}: Rev {fmtUSD0(m.revenue)} · COGS {fmtUSD0(m.cogs)} · GM{' '}
                  {fmtPct(m.gmPct)}
                </title>
              </rect>
              {/* COGS bar — right */}
              <rect
                x={cx + 1}
                y={baseY - cogsH}
                width={barW}
                height={cogsH}
                fill="var(--c3, #0EA5E9)"
                rx={2}
              >
                <title>
                  {m.monthLabel}: Rev {fmtUSD0(m.revenue)} · COGS {fmtUSD0(m.cogs)} · GM{' '}
                  {fmtPct(m.gmPct)}
                </title>
              </rect>
              {/* month label */}
              <text
                x={cx}
                y={height - padding.bottom + 16}
                fontSize="10"
                textAnchor="middle"
                fill={m.month === asOfMonth ? 'var(--c1, #4F46E5)' : '#6b7280'}
                fontWeight={m.month === asOfMonth ? 700 : 500}
              >
                {m.monthLabel}
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}

// ── 3-year compare — cumulative revenue YTD, this year vs priors ──────────

function ThreeYearCompareChart({
  compare,
  primaryYear,
}: {
  compare: Record<string, YtdCompareYear>
  primaryYear: number
}) {
  const width = 900
  const height = 280
  const padding = { top: 20, right: 80, bottom: 36, left: 64 }
  const innerW = width - padding.left - padding.right
  const innerH = height - padding.top - padding.bottom

  // Ordered years: primary first (so it paints on top), then priors desc
  const sortedYears = useMemo(() => {
    const keys = Object.keys(compare).map((k) => parseInt(k, 10))
    keys.sort((a, b) => b - a)
    return keys
  }, [compare])

  const max = useMemo(() => {
    const all = sortedYears.flatMap((y) => compare[String(y)]?.cumulativeByMonth ?? [])
    const peak = Math.max(...all, 1)
    return Math.ceil(peak / 100_000) * 100_000 || 100_000
  }, [sortedYears, compare])

  const xAt = (i: number) => padding.left + (i / 11) * innerW
  const yAt = (v: number) => padding.top + innerH - (v / max) * innerH

  const pathFor = (series: number[]) =>
    series.map((v, i) => `${i === 0 ? 'M' : 'L'} ${xAt(i).toFixed(2)} ${yAt(v).toFixed(2)}`).join(' ')

  // Assign palette slot per year: primary => c1, prior-1 => c3, prior-2 => c4
  const palette: Record<number, string> = {}
  sortedYears.forEach((y, idx) => {
    if (y === primaryYear) palette[y] = 'var(--c1, #4F46E5)'
    else if (idx === 0 && y !== primaryYear) palette[y] = 'var(--c3, #0EA5E9)'
    else if (idx === 1 && y !== primaryYear) palette[y] = 'var(--c4, #06B6D4)'
    else palette[y] = 'var(--c2, #2563EB)'
  })
  // Ensure primary always maps to c1
  palette[primaryYear] = 'var(--c1, #4F46E5)'

  const ticks = Array.from({ length: 5 }, (_, i) => (max * i) / 4)
  const monthLabels = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4 print-break-inside-avoid">
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="text-sm font-semibold text-gray-900">3-Year Cumulative Revenue</div>
          <div className="text-xs text-gray-500">YTD build Jan → Dec, compared across years</div>
        </div>
        <div className="flex items-center gap-4 text-[11px] font-medium">
          {sortedYears.map((y) => (
            <span key={y} className="flex items-center gap-1.5">
              <span
                className="inline-block w-3 h-0.5"
                style={{
                  background: palette[y],
                  height: y === primaryYear ? 3 : 2,
                }}
              />
              {y}
              {y === primaryYear ? ' (current)' : ''}
            </span>
          ))}
        </div>
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full"
        style={{ height }}
        role="img"
        aria-label={`Cumulative revenue ${sortedYears.join(' vs ')}`}
      >
        {/* gridlines */}
        {ticks.map((t, i) => (
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
              {fmtUSDCompact(t)}
            </text>
          </g>
        ))}

        {/* x-axis month labels */}
        {monthLabels.map((lbl, i) => (
          <text
            key={lbl}
            x={xAt(i)}
            y={height - padding.bottom + 16}
            fontSize="10"
            textAnchor="middle"
            fill="#6b7280"
          >
            {lbl}
          </text>
        ))}

        {/* lines — paint priors first, current on top */}
        {sortedYears
          .filter((y) => y !== primaryYear)
          .map((y) => {
            const c = compare[String(y)]
            if (!c) return null
            return (
              <path
                key={y}
                d={pathFor(c.cumulativeByMonth)}
                fill="none"
                stroke={palette[y]}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeDasharray="4 4"
                opacity={0.85}
              />
            )
          })}
        {(() => {
          const c = compare[String(primaryYear)]
          if (!c) return null
          return (
            <>
              <path
                d={pathFor(c.cumulativeByMonth)}
                fill="none"
                stroke={palette[primaryYear]}
                strokeWidth={3}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              {/* dots on primary */}
              {c.cumulativeByMonth.map((v, i) => (
                <circle
                  key={i}
                  cx={xAt(i)}
                  cy={yAt(v)}
                  r={3}
                  fill={palette[primaryYear]}
                />
              ))}
            </>
          )
        })()}

        {/* End-of-year labels */}
        {sortedYears.map((y) => {
          const c = compare[String(y)]
          if (!c) return null
          const last = c.cumulativeByMonth[c.cumulativeByMonth.length - 1] ?? 0
          if (last <= 0) return null
          return (
            <text
              key={y}
              x={xAt(11) + 6}
              y={yAt(last) + 3}
              fontSize="10"
              fontWeight={y === primaryYear ? 700 : 500}
              fill={palette[y]}
            >
              {y} · {fmtUSDCompact(last)}
            </text>
          )
        })}
      </svg>
    </div>
  )
}

// ── Top-10 tables ─────────────────────────────────────────────────────────

function TopBuilderTables({
  top,
  topGm,
}: {
  top: YtdTopBuilder[]
  topGm: YtdTopBuilder[]
}) {
  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 print-break-inside-avoid">
      <TopTable
        title="Top 10 Builders — YTD Revenue"
        rows={top}
        primary="revenue"
        secondaryLabel="GM %"
        secondary={(r) => fmtPct(r.gmPct)}
      />
      <TopTable
        title="Top 10 Builders — YTD Gross Margin %"
        rows={topGm}
        primary="gmPct"
        primaryFormat="pct"
        secondaryLabel="Revenue"
        secondary={(r) => fmtUSDCompact(r.revenue)}
      />
    </div>
  )
}

function TopTable({
  title,
  rows,
  primary,
  primaryFormat = 'usd',
  secondaryLabel,
  secondary,
}: {
  title: string
  rows: YtdTopBuilder[]
  primary: 'revenue' | 'gmPct' | 'gmDollar'
  primaryFormat?: 'usd' | 'pct'
  secondaryLabel: string
  secondary: (r: YtdTopBuilder) => string
}) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-200 bg-gray-50">
        <div className="text-sm font-semibold text-gray-900">{title}</div>
      </div>
      {rows.length === 0 ? (
        <div className="p-6 text-sm text-gray-500 text-center">No builders with YTD revenue yet.</div>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-xs uppercase text-gray-500 bg-gray-50">
            <tr>
              <th className="text-left px-4 py-2 font-semibold w-8">#</th>
              <th className="text-left px-4 py-2 font-semibold">Builder</th>
              <th className="text-right px-4 py-2 font-semibold">
                {primary === 'gmPct' ? 'GM %' : primary === 'gmDollar' ? 'GM $' : 'Revenue'}
              </th>
              <th className="text-right px-4 py-2 font-semibold hidden sm:table-cell">
                {secondaryLabel}
              </th>
              <th className="text-right px-4 py-2 font-semibold hidden md:table-cell">Orders</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const primaryVal = r[primary]
              const primaryText =
                primaryFormat === 'pct' ? fmtPct(primaryVal as number) : fmtUSD0(primaryVal as number)
              return (
                <tr
                  key={r.builderId}
                  className={`${i % 2 === 0 ? 'bg-white' : 'bg-gray-50/40'} hover:bg-gray-50`}
                >
                  <td className="px-4 py-2 text-gray-400 text-xs">{i + 1}</td>
                  <td className="px-4 py-2 text-gray-900">
                    <Link
                      href={`/ops/accounts/${r.builderId}`}
                      className="hover:underline"
                    >
                      {r.builderName}
                    </Link>
                  </td>
                  <td
                    className="px-4 py-2 text-right font-mono tabular-nums font-semibold text-gray-900"
                    style={{ fontFamily: 'ui-monospace, "JetBrains Mono", SFMono-Regular, Menlo, monospace' }}
                  >
                    {primaryText}
                  </td>
                  <td
                    className="px-4 py-2 text-right font-mono tabular-nums text-gray-700 hidden sm:table-cell"
                    style={{ fontFamily: 'ui-monospace, "JetBrains Mono", SFMono-Regular, Menlo, monospace' }}
                  >
                    {secondary(r)}
                  </td>
                  <td className="px-4 py-2 text-right text-gray-500 hidden md:table-cell">
                    {fmtInt(r.orderCount)}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </div>
  )
}

// ── Right-side drill-down rail ────────────────────────────────────────────

function RightRail() {
  const links = [
    { href: '/ops/finance', label: 'Finance Dashboard', hint: 'KPIs + alerts' },
    { href: '/ops/finance/ar', label: 'Accounts Receivable', hint: 'Aging + overdue' },
    { href: '/ops/finance/ap', label: 'Accounts Payable', hint: 'Open POs' },
    { href: '/ops/finance/cash', label: 'Cash Command Center', hint: 'Runway + forecast' },
    { href: '/ops/finance/bank', label: 'Bank Position', hint: 'Ending balance' },
    { href: '/ops/finance/health', label: 'Financial Health', hint: 'Overall grade' },
    { href: '/ops/finance/modeler', label: 'Scenario Modeler', hint: 'What-if sims' },
    { href: '/ops/finance/optimization', label: 'Cash Optimization', hint: 'Working-capital wins' },
    { href: '/ops/finance/patterns', label: 'Payment Patterns', hint: 'Builder behavior' },
    { href: '/ops/finance/command-center', label: 'Full Command Center', hint: 'All finance tools' },
  ]
  return (
    <div className="bg-white rounded-lg border border-gray-200 sticky top-4">
      <div className="px-4 py-3 border-b border-gray-200">
        <div className="text-xs uppercase tracking-wide font-semibold text-gray-500">Drill down</div>
        <div className="text-sm text-gray-700 mt-0.5">Jump to finance detail</div>
      </div>
      <nav className="p-2 space-y-1">
        {links.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className="block px-3 py-2 rounded-md hover:bg-gray-50 group"
          >
            <div className="text-sm font-medium text-gray-900 group-hover:text-[color:var(--c1,#4F46E5)]">
              {l.label}
            </div>
            <div className="text-xs text-gray-500">{l.hint}</div>
          </Link>
        ))}
      </nav>
    </div>
  )
}
