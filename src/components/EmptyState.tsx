'use client'

import React, { type ReactNode } from 'react'
import { cn } from '@/lib/utils'
import BlueprintAnimation from '@/components/BlueprintAnimation'

// ── Aegis v3 Empty State ────────────────────────────────────────────────
// Glass card + BlueprintAnimation watermark. Turns every blank void into
// a branded moment. The door blueprint draws in over ~6s behind the text.
// ─────────────────────────────────────────────────────────────────────────

export interface EmptyStateProps {
  icon?: ReactNode
  title: string
  description: string
  actionLabel?: string
  actionHref?: string
  onAction?: () => void
  /** Show a door blueprint drawing animation behind the content */
  blueprint?: boolean
  /** Seed for which door blueprint to show (default: day-of-year) */
  blueprintSeed?: number
  className?: string
  children?: ReactNode
}

export default function EmptyState({
  icon = '📭',
  title,
  description,
  actionLabel,
  actionHref,
  onAction,
  blueprint = true,
  blueprintSeed,
  className,
  children,
}: EmptyStateProps) {
  const seed = blueprintSeed ?? new Date().getDate()

  const actionElement = actionLabel && (actionHref || onAction) ? (
    actionHref ? (
      <a
        href={actionHref}
        className="btn bg-grad text-white hover:opacity-90 px-5 py-2.5 text-sm font-semibold rounded-lg transition-opacity"
      >
        {actionLabel}
      </a>
    ) : (
      <button
        onClick={onAction}
        className="btn bg-grad text-white hover:opacity-90 px-5 py-2.5 text-sm font-semibold rounded-lg transition-opacity"
      >
        {actionLabel}
      </button>
    )
  ) : null

  return (
    <div
      className={cn(
        'glass-card relative flex flex-col items-center justify-center',
        'px-8 py-12 min-h-[300px] overflow-hidden text-center',
        className,
      )}
    >
      {/* Blueprint watermark */}
      {blueprint && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <BlueprintAnimation
            seed={seed}
            duration={6000}
            strokeWidth={0.8}
            className="w-[280px] h-[280px] text-c1/[0.06] dark:text-c1/[0.08]"
          />
        </div>
      )}

      {/* Content */}
      <div className="relative z-[1] flex flex-col items-center gap-4">
        {icon && (
          <div className="text-[48px] leading-none" aria-hidden>
            {typeof icon === 'string' ? icon : icon}
          </div>
        )}

        <div className="space-y-2">
          <h3 className="text-lg font-semibold text-fg tracking-tight">
            {title}
          </h3>
          <p className="text-sm text-fg-muted max-w-[400px] leading-relaxed">
            {description}
          </p>
        </div>

        {actionElement}
        {children}
      </div>
    </div>
  )
}
