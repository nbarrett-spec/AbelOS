'use client'

import { useEffect, useState, type KeyboardEvent, type ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { ArrowUpRight, ArrowDownRight, Minus } from 'lucide-react'
import Sparkline from './Sparkline'
import NumberFlow from './NumberFlow'
import AnimatedCounter from './AnimatedCounter'

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
  /** Click handler — when set, card renders as button with keyboard support */
  onClick?: () => void
  className?: string
  /** Extra badge slot (top-right) — e.g. "LIVE" or time-window */
  badge?: ReactNode
  /**
   * Count-up animation on mount (Tier 5.1). Default true.
   * When false, the value is rendered raw (no count-up) — useful for legacy
   * callers or values that are already animated upstream.
   */
  animateValue?: boolean
  /**
   * Delay (ms) before count-up begins. Default 0. Consumers stagger this
   * across a row of KPICards (0 / 100 / 200 / 300) to get a wave effect.
   */
  animateDelay?: number
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

// ── Delayed-start count-up wrapper ────────────────────────────────────────
// Renders the raw-formatted string until `delay` ms have elapsed, then
// swaps to AnimatedCounter which counts 0 → target with an ease-out curve.
// This gives a staggered "wave" when several KPICards mount together.
function DelayedCounter({
  value,
  delay,
  format,
  prefix,
  suffix,
  placeholder,
}: {
  value: number
  delay: number
  format?: (n: number) => string
  prefix?: string
  suffix?: string
  /** What to show before the counter starts — defaults to "0" / formatted zero. */
  placeholder?: ReactNode
}) {
  const [armed, setArmed] = useState(delay <= 0)

  useEffect(() => {
    if (delay <= 0) return
    const id = setTimeout(() => setArmed(true), delay)
    return () => clearTimeout(id)
  }, [delay])

  if (!armed) {
    // Hold at zero (or the caller-provided placeholder) until the delay fires.
    // Using the same formatter keeps the character width stable to avoid layout shift.
    const zeroText = format ? format(0) : '0'
    return (
      <span className="tabular-nums">
        {placeholder ?? `${prefix ?? ''}${zeroText}${suffix ?? ''}`}
      </span>
    )
  }

  return (
    <AnimatedCounter
      value={value}
      format={format}
      prefix={prefix}
      suffix={suffix}
    />
  )
}

// ── Smart value renderer ──────────────────────────────────────────────────
// If `animate` is false, fall back to the legacy NumberFlow-based renderer
// (which also animates digit rolls, but doesn't count up from zero on mount).
// If `animate` is true, parse the value and wrap the numeric part in
// AnimatedCounter (via DelayedCounter) so it counts up from 0 on first render.
// Non-numeric values (ReactNodes, "—", "N/A") pass through unchanged.
function renderValue(
  value: string | number | ReactNode,
  animate: boolean,
  delay: number,
): ReactNode {
  // Non-animated path = existing behavior (NumberFlow digit-roll, no count-up)
  if (!animate) {
    return renderValueLegacy(value)
  }

  if (typeof value === 'number') {
    return <DelayedCounter value={value} delay={delay} />
  }
  if (typeof value !== 'string') {
    return value
  }

  const s = value.trim()
  if (!s || s === '—' || s === 'N/A' || /^[•]+$/.test(s)) return value

  // Currency compact: $1.2M / $42K / $4.2K
  const compactCurrency = s.match(/^\$(-?\d+(?:\.\d+)?)([MKB])$/i)
  if (compactCurrency) {
    const num = parseFloat(compactCurrency[1])
    const unit = compactCurrency[2].toUpperCase()
    const multiplier = unit === 'M' ? 1_000_000 : unit === 'K' ? 1_000 : 1_000_000_000
    const target = num * multiplier
    const fmt = (n: number) =>
      new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        notation: 'compact',
        maximumFractionDigits: 1,
      }).format(n)
    return <DelayedCounter value={target} delay={delay} format={fmt} />
  }

  // Currency full: $1,234.56 / $1234
  const fullCurrency = s.match(/^\$(-?[\d,]+(?:\.\d+)?)$/)
  if (fullCurrency) {
    const num = parseFloat(fullCurrency[1].replace(/,/g, ''))
    if (Number.isFinite(num)) {
      const fmt = (n: number) =>
        new Intl.NumberFormat('en-US', {
          style: 'currency',
          currency: 'USD',
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        }).format(n)
      return <DelayedCounter value={num} delay={delay} format={fmt} />
    }
  }

  // Percentage: 23.4% / +12.5% / -3.2%
  const pct = s.match(/^([+\-]?\d+(?:\.\d+)?)%$/)
  if (pct) {
    const num = parseFloat(pct[1])
    if (Number.isFinite(num)) {
      const fmt = (n: number) =>
        new Intl.NumberFormat('en-US', {
          minimumFractionDigits: 0,
          maximumFractionDigits: 1,
        }).format(n)
      return <DelayedCounter value={num} delay={delay} format={fmt} suffix="%" />
    }
  }

  // Plain integer or comma-int: 1,847 / 42
  const plainInt = s.match(/^(-?[\d,]+)$/)
  if (plainInt) {
    const num = parseFloat(plainInt[1].replace(/,/g, ''))
    if (Number.isFinite(num)) {
      return <DelayedCounter value={num} delay={delay} />
    }
  }

  // Decimal with suffix unit: "4.2 days" / "120 units"
  const numWithUnit = s.match(/^(-?\d+(?:\.\d+)?)\s+(.+)$/)
  if (numWithUnit) {
    const num = parseFloat(numWithUnit[1])
    if (Number.isFinite(num)) {
      const fmt = (n: number) =>
        new Intl.NumberFormat('en-US', {
          minimumFractionDigits: 0,
          maximumFractionDigits: 1,
        }).format(n)
      return <DelayedCounter value={num} delay={delay} format={fmt} suffix={` ${numWithUnit[2]}`} />
    }
  }

  return value
}

// ── Legacy renderer (NumberFlow-based, no count-up) ───────────────────────
function renderValueLegacy(value: string | number | ReactNode): ReactNode {
  if (typeof value === 'number') {
    return <NumberFlow value={value} format="integer" />
  }
  if (typeof value !== 'string') {
    return value
  }

  const s = value.trim()
  if (!s || s === '—' || s === 'N/A' || /^[•]+$/.test(s)) return value

  const compactCurrency = s.match(/^\$(-?\d+(?:\.\d+)?)([MKB])$/i)
  if (compactCurrency) {
    const num = parseFloat(compactCurrency[1])
    const unit = compactCurrency[2].toUpperCase()
    const multiplier = unit === 'M' ? 1_000_000 : unit === 'K' ? 1_000 : 1_000_000_000
    return (
      <NumberFlow
        value={num * multiplier}
        format="currency"
        formatOptions={{
          style: 'currency',
          currency: 'USD',
          notation: 'compact',
          maximumFractionDigits: 1,
        }}
      />
    )
  }

  const fullCurrency = s.match(/^\$(-?[\d,]+(?:\.\d+)?)$/)
  if (fullCurrency) {
    const num = parseFloat(fullCurrency[1].replace(/,/g, ''))
    if (Number.isFinite(num)) {
      return <NumberFlow value={num} format="currency" />
    }
  }

  const pct = s.match(/^([+\-]?\d+(?:\.\d+)?)%$/)
  if (pct) {
    const num = parseFloat(pct[1])
    if (Number.isFinite(num)) {
      return (
        <NumberFlow
          value={num}
          format="decimal"
          formatOptions={{ maximumFractionDigits: 1, minimumFractionDigits: 0 }}
          suffix="%"
        />
      )
    }
  }

  const plainInt = s.match(/^(-?[\d,]+)$/)
  if (plainInt) {
    const num = parseFloat(plainInt[1].replace(/,/g, ''))
    if (Number.isFinite(num)) {
      return <NumberFlow value={num} format="integer" />
    }
  }

  const numWithUnit = s.match(/^(-?\d+(?:\.\d+)?)\s+(.+)$/)
  if (numWithUnit) {
    const num = parseFloat(numWithUnit[1])
    if (Number.isFinite(num)) {
      return (
        <NumberFlow
          value={num}
          format="decimal"
          suffix={` ${numWithUnit[2]}`}
        />
      )
    }
  }

  return value
}

// ── Skeleton ──────────────────────────────────────────────────────────────

function KPICardSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn('glass-card p-4 flex flex-col gap-3 animate-pulse', className)}>
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
  animateValue = true,
  animateDelay = 0,
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

  // Keyboard handler: fire onClick on Enter/Space when rendered as a
  // non-button element. (When Tag='button' the browser handles this natively,
  // but we still want Space to fire when the card is a div with role=button.)
  const handleKeyDown = interactive
    ? (e: KeyboardEvent<HTMLElement>) => {
        if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
          e.preventDefault()
          onClick?.()
        }
      }
    : undefined

  return (
    <Tag
      onClick={onClick}
      onKeyDown={handleKeyDown}
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      className={cn(
        'relative glass-card overflow-hidden text-left w-full',
        'px-4 pt-4 pb-4',
        'flex flex-col gap-1',
        'transition-[border-color,box-shadow,transform] duration-150 ease-out',
        'hover:scale-[1.01]',
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
          <div className="metric metric-lg truncate">{renderValue(value, animateValue, animateDelay)}</div>
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
