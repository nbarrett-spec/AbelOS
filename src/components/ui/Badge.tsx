'use client'

import { type HTMLAttributes, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

// ── Aegis v2 "Drafting Room" Badge ───────────────────────────────────────
// Pill shape, 10px JetBrains Mono uppercase, leading 6px colored dot.
// ─────────────────────────────────────────────────────────────────────────

// Variants (canonical) + legacy aliases for back-compat
const variants = {
  default:  'bg-signal-subtle  text-accent-fg    border-transparent',
  success:  'bg-data-positive-bg text-data-positive-fg border-transparent',
  danger:   'bg-data-negative-bg text-data-negative-fg border-transparent',
  warning:  'bg-data-warning-bg  text-data-warning-fg  border-transparent',
  info:     'bg-data-info-bg     text-data-info-fg     border-transparent',
  neutral:  'bg-surface-muted    text-fg-muted         border-border',
  // Legacy aliases retained
  brand:    'bg-brand-subtle     text-accent-fg        border-transparent',
  orange:   'bg-signal-subtle    text-accent-fg        border-transparent',
  forecast: 'bg-forecast-bg      text-forecast-fg      border border-dashed border-forecast',
  'success-solid': 'bg-data-positive text-white border-transparent',
  'danger-solid':  'bg-data-negative text-white border-transparent',
  'warning-solid': 'bg-accent text-fg-on-accent border-transparent',
  'brand-solid':   'bg-brand text-fg-on-accent border-transparent',
} as const

const sizes = {
  xs: 'h-[16px] px-1.5  text-[9px]  gap-1',
  sm: 'h-[18px] px-2    text-[10px] gap-1',
  md: 'h-[20px] px-2.5  text-[10px] gap-1.5',
  lg: 'h-[24px] px-3    text-[11px] gap-1.5',
} as const

const DOT_COLORS: Record<keyof typeof variants, string> = {
  default:  'bg-signal',
  success:  'bg-data-positive',
  danger:   'bg-data-negative',
  warning:  'bg-signal',
  info:     'bg-data-info',
  neutral:  'bg-fg-subtle',
  brand:    'bg-brand',
  orange:   'bg-signal',
  forecast: 'bg-forecast',
  'success-solid': 'bg-white',
  'danger-solid':  'bg-white',
  'warning-solid': 'bg-white',
  'brand-solid':   'bg-white',
}

export type BadgeVariant = keyof typeof variants
export type BadgeSize = keyof typeof sizes

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant
  size?: BadgeSize
  dot?: boolean
  icon?: ReactNode
  /** Pill-shaped (default) vs. squared */
  pill?: boolean
}

export function Badge({
  variant = 'default',
  size = 'md',
  dot = false,
  icon,
  pill = true,
  className,
  children,
  ...props
}: BadgeProps) {
  return (
    <span
      {...props}
      className={cn(
        'inline-flex items-center justify-center font-mono font-semibold uppercase leading-none',
        'tabular-nums whitespace-nowrap',
        pill ? 'rounded-full' : 'rounded-sm',
        'border',
        variants[variant],
        sizes[size],
        className,
      )}
      style={{
        letterSpacing: '0.06em',
        ...(props.style ?? {}),
      }}
    >
      {dot && (
        <span
          aria-hidden
          className={cn('shrink-0 rounded-full', DOT_COLORS[variant])}
          style={{ width: 6, height: 6 }}
        />
      )}
      {icon && <span className="shrink-0 -ml-0.5">{icon}</span>}
      {children}
    </span>
  )
}

// ── Status badge — maps Abel OS order statuses to semantic colors ─────────
const STATUS_MAP: Record<string, { variant: BadgeVariant; label: string }> = {
  RECEIVED:       { variant: 'info',     label: 'Received' },
  CONFIRMED:      { variant: 'brand',    label: 'Confirmed' },
  IN_PRODUCTION:  { variant: 'warning',  label: 'In Production' },
  READY_TO_SHIP:  { variant: 'orange',   label: 'Ready to Ship' },
  SHIPPED:        { variant: 'info',     label: 'Shipped' },
  DELIVERED:      { variant: 'success',  label: 'Delivered' },
  COMPLETE:       { variant: 'success',  label: 'Complete' },
  CANCELLED:      { variant: 'neutral',  label: 'Cancelled' },
  STALLED:        { variant: 'danger',   label: 'Stalled' },
  OVERDUE:        { variant: 'danger',   label: 'Overdue' },
  FORECAST:       { variant: 'forecast', label: 'Forecast' },
  UNPAID:         { variant: 'warning',  label: 'Unpaid' },
  PARTIAL:        { variant: 'warning',  label: 'Partial' },
  PAID:           { variant: 'success',  label: 'Paid' },
  REFUNDED:       { variant: 'neutral',  label: 'Refunded' },
  OPEN:           { variant: 'brand',    label: 'Open' },
  ORDERED:        { variant: 'info',     label: 'Ordered' },
  PARTIAL_RECEIVED: { variant: 'warning', label: 'Partial' },
  CLOSED:         { variant: 'neutral',  label: 'Closed' },
}

export interface StatusBadgeProps {
  status: string
  size?: BadgeSize
  label?: string
  className?: string
}

export function StatusBadge({ status, size = 'sm', label, className }: StatusBadgeProps) {
  const config = STATUS_MAP[status] ?? { variant: 'neutral' as BadgeVariant, label: status }
  return (
    <Badge variant={config.variant} size={size} dot className={className}>
      {label ?? config.label}
    </Badge>
  )
}

export default Badge
