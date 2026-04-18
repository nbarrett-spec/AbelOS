'use client'

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { clsx } from 'clsx'

// ── Variant maps ──────────────────────────────────────────────────────────

const variants = {
  primary:
    'bg-abel-navy text-white hover:bg-abel-navy-dark active:bg-[#0f3348] shadow-sm hover:shadow-md',
  accent:
    'bg-abel-orange text-white hover:bg-abel-orange-dark active:bg-[#b85c00] shadow-sm hover:shadow-md',
  outline:
    'border border-gray-300 text-gray-700 hover:bg-gray-50 active:bg-gray-100 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-800',
  ghost:
    'text-gray-600 hover:bg-gray-100 active:bg-gray-200 dark:text-gray-300 dark:hover:bg-gray-800',
  danger:
    'bg-danger-600 text-white hover:bg-danger-700 active:bg-danger-800 shadow-sm hover:shadow-md',
  success:
    'bg-success-600 text-white hover:bg-success-700 active:bg-success-800 shadow-sm hover:shadow-md',
  'navy-outline':
    'border border-abel-navy/30 text-abel-navy hover:bg-abel-navy/5 active:bg-abel-navy/10 dark:text-abel-navy-light',
} as const

const sizes = {
  xs: 'px-2.5 py-1 text-xs gap-1 rounded-lg',
  sm: 'px-3 py-1.5 text-sm gap-1.5 rounded-lg',
  md: 'px-5 py-2.5 text-sm gap-2 rounded-xl',
  lg: 'px-6 py-3 text-base gap-2 rounded-xl',
  xl: 'px-8 py-3.5 text-lg gap-2.5 rounded-2xl',
} as const

// ── Types ─────────────────────────────────────────────────────────────────

export type ButtonVariant = keyof typeof variants
export type ButtonSize = keyof typeof sizes

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  loading?: boolean
  icon?: ReactNode
  iconRight?: ReactNode
  fullWidth?: boolean
}

// ── Component ─────────────────────────────────────────────────────────────

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant = 'primary',
      size = 'md',
      loading = false,
      icon,
      iconRight,
      fullWidth = false,
      disabled,
      className,
      children,
      ...props
    },
    ref
  ) => {
    const isDisabled = disabled || loading

    return (
      <button
        ref={ref}
        disabled={isDisabled}
        className={clsx(
          // Base
          'relative inline-flex items-center justify-center font-medium',
          'transition-all duration-150 ease-out',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-abel-navy/40 focus-visible:ring-offset-2',
          'select-none whitespace-nowrap',
          // Variant + Size
          variants[variant],
          sizes[size],
          // States
          isDisabled && 'opacity-50 cursor-not-allowed pointer-events-none',
          fullWidth && 'w-full',
          className
        )}
        {...props}
      >
        {loading && (
          <svg
            className="animate-spin -ml-0.5 mr-1.5 h-4 w-4"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
            />
          </svg>
        )}
        {!loading && icon && <span className="shrink-0">{icon}</span>}
        {children}
        {iconRight && <span className="shrink-0">{iconRight}</span>}
      </button>
    )
  }
)

Button.displayName = 'Button'
export default Button
