'use client'

import { type ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { ArrowUpRight, ArrowDownRight, Minus } from 'lucide-react'
import Sparkline from './Sparkline'

// ── Types ─────────────────────────────────────────────────────────────────

export interface KPICardProps {
  title: string
  /** Can be a primitive string/number OR a ReactNode (for AnimatedNumber, etc.) */
  value: string | number | ReactNode
  /** e.g. "+12.5%" or "-3.2%" or "0%" */
  delta?: string
  deltaDirection?: 'up' | 'down' | 'flat'
  /** Semantic accent — maps to data-positive / data-negative / forecast / accent / brand / neutral */
  accent?: 'brand' | 'accent' | 'positive' | 'negative' | 'forecast' | 'neutral' | 'navy' | 'orange' | 'green' | 'slate' | 'danger' | 'info'
  icon?: ReactNode
  /** Sparkline data (array of numbers) rendered as mini SVG */
  sparkline?: number[]
  /** Subtitle or footnote — shown below delta */
  subtitle?: string
  /** Indicates this KPI is a forecast/projected value (shows dashed border hint) */
  forecast?: boolean
  loading?: boolean
  onClick?: () => void
  className?: string
  /** Extra badge slot (top-right) — e.g. "LIVE" or time-window */
  badge?: ReactNode
}

// Legacy accent names map to semantic ones
function normalizeAccent(a: KPICardProps['accent']): 'brand' | 'accent' | 'positive' | 'negative' | 'forecast' | 'neutral' {
  switch (a) {
    case 'navy':     return 'brand'
    case 'orange':   return 'accent'
    case 'green':    return 'positive'
    case 'danger':   return 'negative'
    case 'info':     return 'forecast'
    case 'slate':    return 'neutral'
    default:         return a ?? 'neutral'
  }
}

const ACCENT_STROKE: Record<string, string> = {
  brand:    'var(--brand)',
  accent:   'var(--accent)',
  positive: 'var(--data-positive)',
  negative: 'var(--data-negative)',
  forecast: 'var(--forecast)',
  neutral:  'var(--fg-muted)',
}

const ACCENT_RAIL: Record<string, string> = {
  brand:    'bg-brand',
  accent:   'bg-accent',
  positive: 'bg-data-positive',
  negative: 'bg-data-negative',
  forecast: 'bg-forecast',
  neutral:  'bg-border-strong',
}

const ACCENT_ICON_BG: Record<string, string> = {
  brand:    'bg-brand-subtle text-accent-fg',
  accent:   'bg-accent-subtle text-accent-fg',
  positive: 'bg-data-positive-bg text-data-positive-fg',
  negative: 'bg-data-negative-bg text-data-negative-fg',
  forecast: 'bg-forecast-bg text-forecast-fg',
  neutral:  'bg-surface-muted text-fg-muted',
}

// ── Skeleton ──────────────────────────────────────────────────────────────

function KPICardSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn('panel p-4 flex flex-col gap-3 animate-pulse', className)}>
      <div className="h-2.5 w-24 skeleton" />
      <div className="h-8 w-32 skeleton" />
      <div className="h-2.5 w-16 skeleton" />
    </div>
  )
}

// ── Component ─────────────────────────────────────────────────────────────

export default function KPICard({
  title,
  value,
  delta,
  deltaDirection,
  accent = 'neutral',
  icon,
  sparkline,
  subtitle,
  forecast = false,
  loading = false,
  onClick,
  className,
  badge,
}: KPICardProps) {
  if (loading) return <KPICardSkeleton className={className} />

  const semAccent = normalizeAccent(accent)
  const strokeColor = ACCENT_STROKE[semAccent]
  const rail = ACCENT_RAIL[semAccent]
  const iconBg = ACCENT_ICON_BG[semAccent]

  // Auto-detect direction from delta string
  const dir = deltaDirection || (delta?.startsWith('+') ? 'up' : delta?.startsWith('-') ? 'down' : 'flat')

  const interactive = !!onClick
  const Tag = interactive ? 'button' : 'div'

  return (
    <Tag
      onClick={onClick}
      className={cn(
        'relative panel overflow-hidden text-left w-full',
        'px-4 pt-4 pb-4',
        'flex flex-col gap-1',
        'transition-[border-color,box-shadow] duration-fast ease-out',
        interactive && 'cursor-pointer hover:border-border-strong hover:shadow-elevation-2',
        forecast && 'border-dashed',
        className
      )}
    >
      {/* Left accent rail */}
      <span aria-hidden className={cn('absolute left-0 top-0 bottom-0 w-[2px]', rail)} />

      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <span className="eyebrow">{title}</span>
        <div className="flex items-center gap-1.5 -mt-0.5">
          {badge}
          {icon && (
            <span className={cn('w-7 h-7 rounded-md flex items-center justify-center', iconBg)}>
              {icon}
            </span>
          )}
        </div>
      </div>

      {/* Value + sparkline */}
      <div className="flex items-end justify-between gap-3 mt-1">
        <div className="min-w-0">
          <div className="metric metric-lg truncate">{value}</div>
          {(delta || subtitle) && (
            <div className="flex items-center gap-2 mt-1.5 min-w-0">
              {delta && (
                <span
                  className={cn('delta shrink-0', {
                    'delta-up':   dir === 'up',
                    'delta-down': dir === 'down',
                    'delta-flat': dir === 'flat',
                  })}
                >
                  {dir === 'up' && <ArrowUpRight className="w-3 h-3" />}
                  {dir === 'down' && <ArrowDownRight className="w-3 h-3" />}
                  {dir === 'flat' && <Minus className="w-3 h-3" />}
                  <span className="font-numeric">{delta}</span>
                </span>
              )}
              {subtitle && (
                <span className="text-[11px] text-fg-subtle truncate">{subtitle}</span>
              )}
            </div>
          )}
        </div>
        {sparkline && sparkline.length > 1 && (
          <Sparkline data={sparkline} color={strokeColor} width={72} height={28} />
        )}
      </div>
    </Tag>
  )
}
