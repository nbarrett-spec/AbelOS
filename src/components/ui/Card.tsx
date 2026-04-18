'use client'

import { forwardRef, type HTMLAttributes, type ReactNode } from 'react'
import { clsx } from 'clsx'

// ── Variants ──────────────────────────────────────────────────────────────

const variants = {
  default: 'bg-white border border-gray-200 shadow-sm dark:bg-gray-900 dark:border-gray-800',
  elevated: 'bg-white border border-gray-200 shadow-elevation-3 dark:bg-gray-900 dark:border-gray-800',
  glass: 'bg-white/60 backdrop-blur-xl border border-white/30 shadow-glass dark:bg-gray-900/60 dark:border-gray-700/30',
  interactive:
    'bg-white border border-gray-200 shadow-sm cursor-pointer ' +
    'hover:shadow-elevation-2 hover:border-gray-300 hover:-translate-y-0.5 ' +
    'active:translate-y-0 active:shadow-sm ' +
    'dark:bg-gray-900 dark:border-gray-800 dark:hover:border-gray-700',
  ghost: 'bg-transparent',
  filled: 'shadow-sm', // Use with custom bg color
} as const

const paddings = {
  none: '',
  sm: 'p-4',
  md: 'p-6',
  lg: 'p-8',
} as const

// ── Types ─────────────────────────────────────────────────────────────────

export type CardVariant = keyof typeof variants
export type CardPadding = keyof typeof paddings

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  variant?: CardVariant
  padding?: CardPadding
  rounded?: 'md' | 'lg' | 'xl' | '2xl' | '3xl'
}

// ── Component ─────────────────────────────────────────────────────────────

const Card = forwardRef<HTMLDivElement, CardProps>(
  ({ variant = 'default', padding = 'md', rounded = 'xl', className, children, ...props }, ref) => (
    <div
      ref={ref}
      className={clsx(
        'transition-all duration-200',
        `rounded-${rounded}`,
        variants[variant],
        paddings[padding],
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
      className={clsx(
        'px-6 py-4',
        border && 'border-b border-gray-100 dark:border-gray-800',
        className
      )}
      {...props}
    >
      {children}
    </div>
  )
}

export function CardBody({ className, children, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={clsx('px-6 py-5', className)} {...props}>
      {children}
    </div>
  )
}

export function CardFooter({ className, children, border = true, ...props }: CardSectionProps) {
  return (
    <div
      className={clsx(
        'px-6 py-4',
        border && 'border-t border-gray-100 dark:border-gray-800',
        className
      )}
      {...props}
    >
      {children}
    </div>
  )
}

export default Card
