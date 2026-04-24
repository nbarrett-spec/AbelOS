'use client'

import { type ReactNode } from 'react'
import { ArrowUpRight, ArrowDownRight, Minus } from 'lucide-react'

export type KpiTrend = 'up' | 'down' | 'flat'

/**
 * KpiTile — the large-value-first tile for Aegis Home and other
 * exec-facing surfaces. Always shows:
 *   · A 10px mono caps label
 *   · A large tabular mono value
 *   · An optional 7-point sparkline (rendered below a sub line)
 *   · An optional semantic delta chip
 * See AEGIS_DESIGN_SYSTEM.md §15.6 + §16.1.
 */
export function KpiTile({
  label,
  value,
  sub,
  delta,
  trend,
  sparkline,
  accent = 'brand',
  href,
  onClick,
  className = '',
}: {
  label: string
  value: string | number | ReactNode
  sub?: string
  delta?: string
  trend?: KpiTrend
  sparkline?: number[]
  accent?: 'brand' | 'positive' | 'negative' | 'warning' | 'info'
  href?: string
  onClick?: () => void
  className?: string
}) {
  const Tag: any = href ? 'a' : onClick ? 'button' : 'div'
  const deltaClass =
    trend === 'up' ? 'v4-kpi__delta--up' : trend === 'down' ? 'v4-kpi__delta--down' : 'v4-kpi__delta--flat'

  return (
    <Tag
      className={`v4-kpi ${className}`}
      {...(href ? { href } : {})}
      {...(onClick ? { onClick, type: 'button' } : {})}
      style={{ textAlign: 'left', display: 'block', width: '100%' }}
    >
      <span aria-hidden className="v4-kpi__rule" />
      <div className="v4-kpi__label">{label}</div>
      <div className="v4-kpi__value">
        {typeof value === 'number'
          ? new Intl.NumberFormat('en-US').format(value)
          : value}
      </div>
      {(sub || delta) && (
        <div className="v4-kpi__sub">
          {delta && (
            <span className={`v4-kpi__delta ${deltaClass}`}>
              {trend === 'up' ? (
                <ArrowUpRight size={11} />
              ) : trend === 'down' ? (
                <ArrowDownRight size={11} />
              ) : (
                <Minus size={11} />
              )}
              {delta}
            </span>
          )}
          {sub && <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sub}</span>}
        </div>
      )}
      {sparkline && sparkline.length > 1 && (
        <InlineSparkline data={sparkline} accent={accent} />
      )}
    </Tag>
  )
}

function InlineSparkline({
  data,
  accent,
}: {
  data: number[]
  accent: 'brand' | 'positive' | 'negative' | 'warning' | 'info'
}) {
  const w = 160
  const h = 36
  const pad = 2
  const min = Math.min(...data)
  const max = Math.max(...data)
  const range = max - min || 1
  const stepX = (w - pad * 2) / (data.length - 1)
  const points = data.map((v, i) => {
    const x = pad + i * stepX
    const y = pad + (h - pad * 2) * (1 - (v - min) / range)
    return `${x.toFixed(1)},${y.toFixed(1)}`
  }).join(' ')
  const stroke =
    accent === 'positive' ? 'var(--data-positive)'
    : accent === 'negative' ? 'var(--data-negative)'
    : accent === 'warning' ? 'var(--data-warning)'
    : accent === 'info' ? 'var(--data-info)'
    : 'var(--v4-brass-500)'

  const areaPoints = `${pad},${h - pad} ${points} ${w - pad},${h - pad}`
  return (
    <svg
      aria-hidden="true"
      width="100%"
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      style={{ display: 'block', marginTop: 10 }}
    >
      <defs>
        <linearGradient id={`kpi-spark-fade-${accent}`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.22" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={areaPoints} fill={`url(#kpi-spark-fade-${accent})`} />
      <polyline
        points={points}
        fill="none"
        stroke={stroke}
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export default KpiTile
