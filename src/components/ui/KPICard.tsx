'use client'

import { type ReactNode } from 'react'
import { clsx } from 'clsx'
import { TrendingUp, TrendingDown, Minus } from 'lucide-react'

// ── Types ─────────────────────────────────────────────────────────────────

export interface KPICardProps {
  title: string
  value: string | number
  /** e.g. "+12.5%" or "-3.2%" or "0%" */
  delta?: string
  deltaDirection?: 'up' | 'down' | 'flat'
  /** Color accent for the left border / icon area */
  accent?: 'navy' | 'orange' | 'green' | 'slate' | 'danger' | 'info'
  icon?: ReactNode
  /** Optional sparkline data (array of numbers) rendered as mini SVG */
  sparkline?: number[]
  subtitle?: string
  loading?: boolean
  className?: string
}

const accentColors = {
  navy: {
    border: 'border-l-abel-navy',
    iconBg: 'bg-abel-navy/8 text-abel-navy dark:bg-abel-navy/20',
    sparkStroke: '#1B4F72',
  },
  orange: {
    border: 'border-l-abel-orange',
    iconBg: 'bg-abel-orange/8 text-abel-orange dark:bg-abel-orange/20',
    sparkStroke: '#E67E22',
  },
  green: {
    border: 'border-l-success-500',
    iconBg: 'bg-success-50 text-success-600 dark:bg-success-900/30',
    sparkStroke: '#22c55e',
  },
  slate: {
    border: 'border-l-gray-500',
    iconBg: 'bg-gray-100 text-gray-600 dark:bg-gray-800',
    sparkStroke: '#64748b',
  },
  danger: {
    border: 'border-l-danger-500',
    iconBg: 'bg-danger-50 text-danger-600 dark:bg-danger-900/30',
    sparkStroke: '#ef4444',
  },
  info: {
    border: 'border-l-info-500',
    iconBg: 'bg-info-50 text-info-600 dark:bg-info-900/30',
    sparkStroke: '#0ea5e9',
  },
}

// ── Mini sparkline SVG ────────────────────────────────────────────────────

function Sparkline({ data, color }: { data: number[]; color: string }) {
  if (data.length < 2) return null
  const max = Math.max(...data)
  const min = Math.min(...data)
  const range = max - min || 1
  const w = 80
  const h = 28
  const pad = 2

  const points = data.map((v, i) => {
    const x = pad + (i / (data.length - 1)) * (w - pad * 2)
    const y = pad + (1 - (v - min) / range) * (h - pad * 2)
    return `${x},${y}`
  })

  const fillPoints = [...points, `${w - pad},${h - pad}`, `${pad},${h - pad}`]

  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="shrink-0">
      <defs>
        <linearGradient id={`spark-fill-${color.replace('#', '')}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.15} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      <polygon
        points={fillPoints.join(' ')}
        fill={`url(#spark-fill-${color.replace('#', '')})`}
      />
      <polyline
        points={points.join(' ')}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* End dot */}
      {data.length > 0 && (
        <circle
          cx={Number(points[points.length - 1].split(',')[0])}
          cy={Number(points[points.length - 1].split(',')[1])}
          r={2.5}
          fill={color}
        />
      )}
    </svg>
  )
}

// ── Skeleton ──────────────────────────────────────────────────────────────

function KPICardSkeleton({ className }: { className?: string }) {
  return (
    <div
      className={clsx(
        'bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800',
        'border-l-4 border-l-gray-200 dark:border-l-gray-700 p-5 animate-pulse',
        className
      )}
    >
      <div className="h-3 w-24 bg-gray-200 dark:bg-gray-700 rounded mb-3" />
      <div className="h-8 w-32 bg-gray-200 dark:bg-gray-700 rounded mb-2" />
      <div className="h-3 w-16 bg-gray-100 dark:bg-gray-800 rounded" />
    </div>
  )
}

// ── Component ─────────────────────────────────────────────────────────────

export default function KPICard({
  title,
  value,
  delta,
  deltaDirection,
  accent = 'navy',
  icon,
  sparkline,
  subtitle,
  loading = false,
  className,
}: KPICardProps) {
  if (loading) return <KPICardSkeleton className={className} />

  const colors = accentColors[accent]

  // Auto-detect direction from delta string
  const dir = deltaDirection || (delta?.startsWith('+') ? 'up' : delta?.startsWith('-') ? 'down' : 'flat')

  return (
    <div
      className={clsx(
        'bg-white dark:bg-gray-900 rounded-xl',
        'border border-gray-200 dark:border-gray-800',
        'border-l-4',
        colors.border,
        'p-5 flex flex-col gap-1',
        'transition-shadow duration-200 hover:shadow-elevation-2',
        className
      )}
    >
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-gray-500 dark:text-gray-400">{title}</span>
        {icon && (
          <div className={clsx('w-9 h-9 rounded-lg flex items-center justify-center', colors.iconBg)}>
            {icon}
          </div>
        )}
      </div>

      <div className="flex items-end justify-between gap-3 mt-1">
        <div>
          <div className="text-2xl font-bold text-gray-900 dark:text-white tracking-tight">
            {value}
          </div>
          {delta && (
            <div
              className={clsx('flex items-center gap-1 text-sm font-medium mt-1', {
                'text-success-600 dark:text-success-400': dir === 'up',
                'text-danger-600 dark:text-danger-400': dir === 'down',
                'text-gray-500': dir === 'flat',
              })}
            >
              {dir === 'up' && <TrendingUp className="h-3.5 w-3.5" />}
              {dir === 'down' && <TrendingDown className="h-3.5 w-3.5" />}
              {dir === 'flat' && <Minus className="h-3.5 w-3.5" />}
              {delta}
            </div>
          )}
          {subtitle && (
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{subtitle}</p>
          )}
        </div>

        {sparkline && <Sparkline data={sparkline} color={colors.sparkStroke} />}
      </div>
    </div>
  )
}
