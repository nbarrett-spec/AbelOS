'use client'

import { forwardRef, type HTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

// ── Variants ──────────────────────────────────────────────────────────────

const variants = {
  default:     'panel',
  elevated:    'panel panel-elevated',
  interactive: 'panel panel-interactive',
  live:        'panel panel-live',
  glass:       'card-glass',
  ghost:       'bg-transparent',
  filled:      '',
} as const

const paddings = {
  none: '',
  xs:   'p-3',
  sm:   'p-4',
  md:   'p-5',
  lg:   'p-6',
} as const

// Corner-radius variants. The panel/glass styles already set a default
// radius; `rounded` overrides it for callers that want a tighter or looser
// shape (dashboards use `xl` for the hero cards, `none` for flush strips).
const roundeds = {
  none: 'rounded-none',
  sm:   'rounded-sm',
  md:   'rounded-md',
  lg:   'rounded-lg',
  xl:   'rounded-xl',
  '2xl':'rounded-2xl',
  full: 'rounded-full',
} as const

export type CardVariant = keyof typeof variants
export type CardPadding = keyof typeof paddings
export type CardRounded = keyof typeof roundeds

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  variant?: CardVariant
  padding?: CardPadding
  /** Override the default corner radius from the variant */
  rounded?: CardRounded
  /** Mark as containing forecast/projected data — shows dashed border */
  forecast?: boolean
}

const Card = forwardRef<HTMLDivElement, CardProps>(
  ({ variant = 'default', padding = 'md', rounded, forecast = false, className, children, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        variants[variant],
        paddings[padding],
        rounded && roundeds[rounded],
        forecast && 'border-dashed',
        'shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]',
        className
      )}
      {...props}
    >
      {children}
    </div>
  )
)

Card.displayName = 'Card'

// ── Sub-components ────────────────────────────────────────────────────────

interface CardSectionProps extends HTMLAttributes<HTMLDivElement> {
  border?: boolean
}

export function CardHeader({ className, children, border = true, ...props }: CardSectionProps) {
  return (
    <div
      className={cn(
        'px-5 py-3.5 flex items-center justify-between gap-3',
        border && 'border-b border-border',
        className
      )}
      {...props}
    >
      {children}
    </div>
  )
}

export function CardTitle({ className, children, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3
      className={cn('text-[13px] font-semibold text-fg tracking-tight', className)}
      {...props}
    >
      {children}
    </h3>
  )
}

export function CardDescription({ className, children, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p className={cn('text-xs text-fg-muted mt-0.5', className)} {...props}>
      {children}
    </p>
  )
}

export function CardBody({ className, children, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('px-5 py-4', className)} {...props}>
      {children}
    </div>
  )
}

export function CardFooter({ className, children, border = true, ...props }: CardSectionProps) {
  return (
    <div
      className={cn(
        'px-5 py-3',
        border && 'border-t border-border',
        className
      )}
      {...props}
    >
      {children}
    </div>
  )
}

export default Card
