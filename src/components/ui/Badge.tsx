'use client'

import { type HTMLAttributes, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

// ── Semantic variants (token-driven) ──────────────────────────────────────
const variants = {
  neutral:  'bg-surface-muted text-fg-muted border-border',
  success:  'bg-data-positive-bg text-data-positive-fg border-transparent',
  warning:  'bg-data-warning-bg text-data-warning-fg border-transparent',
  danger:   'bg-data-negative-bg text-data-negative-fg border-transparent',
  info:     'bg-data-info-bg text-data-info-fg border-transparent',
  brand:    'bg-brand-subtle text-accent-fg border-transparent',
  orange:   'bg-accent-subtle text-accent-fg border-transparent',
  forecast: 'bg-forecast-bg text-forecast-fg border border-dashed border-forecast',
  // Solid variants (high contrast)
  'success-solid': 'bg-data-positive text-white border-transparent',
  'danger-solid':  'bg-data-negative text-white border-transparent',
  'warning-solid': 'bg-accent text-fg-on-accent border-transparent',
  'brand-solid':   'bg-brand text-fg-on-accent border-transparent',
} as const

const sizes = {
  xs: 'px-1.5 py-0.5 text-[10px] gap-0.5',
  sm: 'px-1.5 py-0.5 text-[11px] gap-1',
  md: 'px-2 py-0.5 text-[11px] gap-1',
  lg: 'px-2.5 py-1 text-xs gap-1.5',
} as const

const DOT_COLORS: Record<keyof typeof variants, string> = {
  neutral:          'bg-fg-subtle',
  success:          'bg-data-positive',
  warning:          'bg-data-warning',
  danger:           'bg-data-negative',
  info:             'bg-data-info',
  brand:            'bg-brand',
  orange:           'bg-accent',
  forecast:         'bg-forecast',
  'success-solid':  'bg-white',
  'danger-solid':   'bg-white',
  'warning-solid':  'bg-white',
  'brand-solid':    'bg-white',
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

export default function Badge({
  variant = 'neutral',
  size = 'md',
  dot = false,
  icon,
  pill = false,
  className,
  children,
  ...props
}: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center font-medium leading-none border tabular-nums',
        pill ? 'rounded-full' : 'rounded-sm',
        variants[variant],
        sizes[size],
        className
      )}
      {...props}
    >
      {dot && (
        <span
          className={cn('w-1.5 h-1.5 rounded-full shrink-0', DOT_COLORS[variant])}
          aria-hidden
        />
      )}
      {icon && <span className="shrink-0 -ml-0.5">{icon}</span>}
      {children}
    </span>
  )
}

// ── Status badge — maps Abel OS order statuses to semantic colors ─────────

const STATUS_MAP: Record<string, { variant: BadgeVariant; label: string }> = {
  // Orders
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
  // Payment
  UNPAID:         { variant: 'warning',  label: 'Unpaid' },
  PARTIAL:        { variant: 'warning',  label: 'Partial' },
  PAID:           { variant: 'success',  label: 'Paid' },
  REFUNDED:       { variant: 'neutral',  label: 'Refunded' },
  // PO
  OPEN:           { variant: 'brand',    label: 'Open' },
  ORDERED:        { variant: 'info',     label: 'Ordered' },
  PARTIAL_RECEIVED: { variant: 'warning',label: 'Partial' },
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
