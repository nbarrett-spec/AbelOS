'use client'

import { clsx } from 'clsx'

// ── Types ─────────────────────────────────────────────────────────────────

export interface SkeletonProps {
  /** Width class (e.g. 'w-32', 'w-full') */
  width?: string
  /** Height class (e.g. 'h-4', 'h-8') */
  height?: string
  /** Rounding: 'sm' | 'md' | 'lg' | 'xl' | 'full' */
  rounded?: 'sm' | 'md' | 'lg' | 'xl' | 'full'
  className?: string
}

export interface SkeletonTextProps {
  lines?: number
  className?: string
}

export interface SkeletonCardProps {
  lines?: number
  hasImage?: boolean
  className?: string
}

// ── Base Skeleton ─────────────────────────────────────────────────────────

export default function Skeleton({
  width = 'w-full',
  height = 'h-4',
  rounded = 'md',
  className,
}: SkeletonProps) {
  return (
    <div
      className={clsx(
        'animate-pulse bg-gray-200 dark:bg-gray-800',
        `rounded-${rounded}`,
        width,
        height,
        className
      )}
    />
  )
}

// ── Skeleton Text Block ───────────────────────────────────────────────────

export function SkeletonText({ lines = 3, className }: SkeletonTextProps) {
  return (
    <div className={clsx('space-y-2.5', className)}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton
          key={i}
          height="h-3.5"
          width={i === lines - 1 ? 'w-3/4' : 'w-full'}
        />
      ))}
    </div>
  )
}

// ── Skeleton Card ─────────────────────────────────────────────────────────

export function SkeletonCard({ lines = 2, hasImage = false, className }: SkeletonCardProps) {
  return (
    <div
      className={clsx(
        'bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5 animate-pulse',
        className
      )}
    >
      {hasImage && <Skeleton height="h-36" rounded="lg" className="mb-4" />}
      <Skeleton width="w-2/3" height="h-5" className="mb-3" />
      <SkeletonText lines={lines} />
    </div>
  )
}

// ── Skeleton Table Row ────────────────────────────────────────────────────

export function SkeletonTableRow({ columns = 4, className }: { columns?: number; className?: string }) {
  return (
    <div className={clsx('flex items-center gap-4 py-3 animate-pulse', className)}>
      {Array.from({ length: columns }).map((_, i) => (
        <Skeleton
          key={i}
          width={i === 0 ? 'w-10' : i === 1 ? 'flex-1' : 'w-20'}
          height="h-4"
        />
      ))}
    </div>
  )
}

// ── Skeleton KPI Row ──────────────────────────────────────────────────────

export function SkeletonKPIRow({ count = 4, className }: { count?: number; className?: string }) {
  return (
    <div className={clsx('grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4', className)}>
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 border-l-4 border-l-gray-200 dark:border-l-gray-700 p-5 animate-pulse"
        >
          <Skeleton width="w-24" height="h-3" className="mb-3" />
          <Skeleton width="w-32" height="h-7" className="mb-2" />
          <Skeleton width="w-16" height="h-3" />
        </div>
      ))}
    </div>
  )
}
