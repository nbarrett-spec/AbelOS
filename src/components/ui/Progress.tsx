'use client'

import { clsx } from 'clsx'

const colorMap = {
  navy: 'bg-abel-walnut',
  orange: 'bg-abel-amber',
  green: 'bg-success-500',
  danger: 'bg-danger-500',
  info: 'bg-info-500',
  warning: 'bg-warning-500',
} as const

export interface ProgressProps {
  value: number
  max?: number
  color?: keyof typeof colorMap
  size?: 'xs' | 'sm' | 'md' | 'lg'
  label?: string
  showValue?: boolean
  animated?: boolean
  className?: string
}

const sizeMap = {
  xs: 'h-1',
  sm: 'h-1.5',
  md: 'h-2.5',
  lg: 'h-4',
}

export default function Progress({
  value,
  max = 100,
  color = 'navy',
  size = 'md',
  label,
  showValue = false,
  animated = true,
  className,
}: ProgressProps) {
  const pct = Math.min(100, Math.max(0, (value / max) * 100))

  return (
    <div className={clsx('w-full', className)}>
      {(label || showValue) && (
        <div className="flex items-center justify-between mb-1.5">
          {label && (
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">{label}</span>
          )}
          {showValue && (
            <span className="text-sm font-medium text-gray-500 dark:text-gray-400 tabular-nums">
              {Math.round(pct)}%
            </span>
          )}
        </div>
      )}
      <div
        className={clsx(
          'w-full rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden',
          sizeMap[size]
        )}
        role="progressbar"
        aria-valuenow={value}
        aria-valuemin={0}
        aria-valuemax={max}
      >
        <div
          className={clsx(
            'h-full rounded-full transition-all',
            animated ? 'duration-700 ease-out' : 'duration-0',
            colorMap[color],
            // Subtle shimmer on active progress
            pct > 0 && pct < 100 && 'relative overflow-hidden after:absolute after:inset-0 after:bg-gradient-to-r after:from-transparent after:via-white/20 after:to-transparent after:animate-shimmer'
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}

// ── Step progress (for multi-step flows) ──────────────────────────────────

export interface StepProgressProps {
  steps: string[]
  currentStep: number
  className?: string
}

export function StepProgress({ steps, currentStep, className }: StepProgressProps) {
  return (
    <div className={clsx('flex items-center w-full', className)}>
      {steps.map((step, i) => {
        const isComplete = i < currentStep
        const isCurrent = i === currentStep
        const isLast = i === steps.length - 1

        return (
          <div key={step} className={clsx('flex items-center', !isLast && 'flex-1')}>
            <div className="flex flex-col items-center">
              <div
                className={clsx(
                  'w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold transition-all duration-300',
                  isComplete && 'bg-abel-walnut text-white',
                  isCurrent && 'bg-abel-amber text-white ring-4 ring-abel-amber/20',
                  !isComplete && !isCurrent && 'bg-gray-200 dark:bg-gray-700 text-gray-500 dark:text-gray-400'
                )}
              >
                {isComplete ? (
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                ) : (
                  i + 1
                )}
              </div>
              <span
                className={clsx(
                  'mt-1.5 text-xs font-medium whitespace-nowrap',
                  isCurrent ? 'text-abel-walnut dark:text-abel-walnut-light' : 'text-gray-500 dark:text-gray-400'
                )}
              >
                {step}
              </span>
            </div>
            {!isLast && (
              <div
                className={clsx(
                  'flex-1 h-0.5 mx-3 mt-[-18px] rounded-full transition-colors duration-500',
                  isComplete ? 'bg-abel-walnut' : 'bg-gray-200 dark:bg-gray-700'
                )}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}
