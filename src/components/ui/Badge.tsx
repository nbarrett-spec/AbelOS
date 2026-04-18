'use client'

import { type HTMLAttributes, type ReactNode } from 'react'
import { clsx } from 'clsx'

const variants = {
  neutral: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
  success: 'bg-success-50 text-success-700 dark:bg-success-900/30 dark:text-success-400',
  warning: 'bg-warning-50 text-warning-700 dark:bg-warning-900/30 dark:text-warning-400',
  danger: 'bg-danger-50 text-danger-700 dark:bg-danger-900/30 dark:text-danger-400',
  info: 'bg-info-50 text-info-700 dark:bg-info-900/30 dark:text-info-400',
  brand: 'bg-abel-navy/8 text-abel-navy dark:bg-abel-navy/20 dark:text-abel-navy-light',
  orange: 'bg-abel-orange/10 text-abel-orange-dark dark:bg-abel-orange/20 dark:text-abel-orange-light',
  // Solid variants for high-contrast use
  'success-solid': 'bg-success-600 text-white',
  'danger-solid': 'bg-danger-600 text-white',
  'warning-solid': 'bg-warning-500 text-white',
  'brand-solid': 'bg-abel-navy text-white',
} as const

const sizes = {
  xs: 'px-1.5 py-0.5 text-[10px]',
  sm: 'px-2 py-0.5 text-xs',
  md: 'px-2.5 py-1 text-xs',
  lg: 'px-3 py-1 text-sm',
} as const

export type BadgeVariant = keyof typeof variants
export type BadgeSize = keyof typeof sizes

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant
  size?: BadgeSize
  dot?: boolean
  icon?: ReactNode
  pill?: boolean
}

export default function Badge({
  variant = 'neutral',
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
      className={clsx(
        'inline-flex items-center gap-1 font-medium leading-none',
        pill ? 'rounded-full' : 'rounded-md',
        variants[variant],
        sizes[size],
        className
      )}
      {...props}
    >
      {dot && (
        <span
          className={clsx('w-1.5 h-1.5 rounded-full', {
            'bg-gray-500': variant === 'neutral',
            'bg-success-500': variant === 'success' || variant === 'success-solid',
            'bg-warning-500': variant === 'warning' || variant === 'warning-solid',
            'bg-danger-500': variant === 'danger' || variant === 'danger-solid',
            'bg-info-500': variant === 'info',
            'bg-abel-navy': variant === 'brand' || variant === 'brand-solid',
            'bg-abel-orange': variant === 'orange',
          })}
        />
      )}
      {icon && <span className="shrink-0 -ml-0.5">{icon}</span>}
      {children}
    </span>
  )
}
