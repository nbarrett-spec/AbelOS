'use client'

import { useEffect, useState, type HTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

// ── Aegis v2 "Drafting Room" Skeleton ────────────────────────────────────
// Base skeleton: rectangle bg-sunken + 80ms fade-out on load.
// No decorative shimmer for daily-use pages — use <ContentFade/> wrapper.
// For first-time empty states: <BlueprintReveal sectionId="..."/> plays ONCE.
// ─────────────────────────────────────────────────────────────────────────

export interface SkeletonProps extends HTMLAttributes<HTMLDivElement> {
  /** Tailwind width (default w-full) */
  width?: string
  /** Tailwind height (default h-4) */
  height?: string
  /** Rounding: 'xs' | 'sm' | 'md' | 'lg' | 'xl' | 'full' */
  rounded?: 'xs' | 'sm' | 'md' | 'lg' | 'xl' | 'full'
  /** When true, fade out 80ms (use when content is ready). */
  ready?: boolean
  /**
   * Visual style:
   *  - 'default'   → shimmer-capable filled rectangle (uses `.skeleton` class from globals.css)
   *  - 'blueprint' → dashed blue drafting-tint border, transparent fill, pulsing edge
   */
  variant?: 'default' | 'blueprint'
}

export function Skeleton({
  width = 'w-full',
  height = 'h-4',
  rounded = 'sm',
  ready = false,
  variant = 'default',
  className,
  style,
  ...props
}: SkeletonProps) {
  const roundClass =
    rounded === 'full' ? 'rounded-full' : `rounded-${rounded === 'xs' ? '[2px]' : rounded}`

  // Blueprint variant: dashed drafting-blue border, transparent fill, pulsing edge.
  // `animate-pulse` is wrapped by Tailwind's motion-safe (disabled under prefers-reduced-motion).
  if (variant === 'blueprint') {
    return (
      <div
        {...props}
        aria-hidden
        className={cn(
          'block transition-opacity border border-dashed border-[rgba(100,160,220,0.2)] bg-transparent motion-safe:animate-pulse',
          width,
          height,
          roundClass,
          ready ? 'opacity-0' : 'opacity-100',
          className,
        )}
        style={{
          transitionDuration: '80ms',
          transitionTimingFunction: 'var(--ease)',
          ...style,
        }}
      />
    )
  }

  // Default variant: apply the global `.skeleton` shimmer class.
  // Shimmer keyframes + prefers-reduced-motion handling live in globals.css.
  return (
    <div
      {...props}
      aria-hidden
      className={cn(
        'skeleton block transition-opacity',
        width,
        height,
        roundClass,
        ready ? 'opacity-0' : 'opacity-100',
        className,
      )}
      style={{
        transitionDuration: '80ms',
        transitionTimingFunction: 'var(--ease)',
        ...style,
      }}
    />
  )
}

// ── Legacy helpers (text/card/row) ───────────────────────────────────────

export interface SkeletonTextProps {
  lines?: number
  className?: string
  ready?: boolean
}

export function SkeletonText({ lines = 3, className, ready }: SkeletonTextProps) {
  return (
    <div className={cn('space-y-2', className)}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton
          key={i}
          height="h-3.5"
          width={i === lines - 1 ? 'w-3/4' : 'w-full'}
          ready={ready}
        />
      ))}
    </div>
  )
}

export interface SkeletonCardProps {
  lines?: number
  hasImage?: boolean
  className?: string
  ready?: boolean
}

export function SkeletonCard({ lines = 2, hasImage = false, className, ready }: SkeletonCardProps) {
  return (
    <div className={cn('panel p-4 space-y-3', className)}>
      {hasImage && <Skeleton height="h-24" rounded="md" ready={ready} />}
      <Skeleton width="w-2/3" height="h-4" ready={ready} />
      <SkeletonText lines={lines} ready={ready} />
    </div>
  )
}

export function SkeletonTableRow({
  columns = 4,
  className,
  ready,
}: { columns?: number; className?: string; ready?: boolean }) {
  return (
    <div className={cn('flex items-center gap-4 py-3', className)}>
      {Array.from({ length: columns }).map((_, i) => (
        <Skeleton
          key={i}
          width={i === 0 ? 'w-10' : i === 1 ? 'flex-1' : 'w-20'}
          height="h-4"
          ready={ready}
        />
      ))}
    </div>
  )
}

export function SkeletonKPIRow({
  count = 4,
  className,
  ready,
}: { count?: number; className?: string; ready?: boolean }) {
  return (
    <div className={cn('grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4', className)}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="panel p-4 space-y-3">
          <Skeleton width="w-24" height="h-3" ready={ready} />
          <Skeleton width="w-32" height="h-7" ready={ready} />
          <Skeleton width="w-16" height="h-3" ready={ready} />
        </div>
      ))}
    </div>
  )
}

// ── ContentFade — the 80ms daily-page "loader" ───────────────────────────

export function ContentFade({
  loading,
  children,
  className,
}: {
  loading: boolean
  children: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={cn('transition-opacity', className)}
      style={{
        opacity: loading ? 0 : 1,
        transitionDuration: '80ms',
        transitionTimingFunction: 'var(--ease)',
      }}
    >
      {children}
    </div>
  )
}

// ── BlueprintReveal — first-visit stroke-draw (runs ONCE per section) ────

const STORAGE_PREFIX = 'aegis_has_seen_'

export function BlueprintReveal({
  sectionId,
  width = 320,
  height = 120,
  children,
  className,
}: {
  sectionId: string
  width?: number
  height?: number
  children?: React.ReactNode
  className?: string
}) {
  const [seen, setSeen] = useState<boolean>(true)

  useEffect(() => {
    if (typeof window === 'undefined') return
    const key = `${STORAGE_PREFIX}${sectionId}`
    try {
      const has = window.localStorage.getItem(key)
      if (!has) {
        setSeen(false)
        window.localStorage.setItem(key, '1')
      }
    } catch {
      // ignore — private mode etc.
    }
  }, [sectionId])

  return (
    <div
      className={cn('relative flex flex-col items-center justify-center py-10', className)}
    >
      {children ? (
        <div className={seen ? 'opacity-100' : 'opacity-0 animate-[fadeIn_400ms_200ms_var(--ease)_forwards]'}>
          {children}
        </div>
      ) : (
        <svg
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          aria-hidden
          className="text-[var(--signal)]"
        >
          <defs>
            <pattern
              id={`aegis-grid-${sectionId}`}
              x="0"
              y="0"
              width="16"
              height="16"
              patternUnits="userSpaceOnUse"
            >
              <path
                d="M 16 0 L 0 0 0 16"
                fill="none"
                stroke="currentColor"
                strokeOpacity="0.08"
                strokeWidth="0.5"
              />
            </pattern>
          </defs>
          <rect width={width} height={height} fill={`url(#aegis-grid-${sectionId})`} />
          <path
            d={`M 24 ${height - 24} L ${width / 2 - 40} 40 L ${width / 2 + 40} 40 L ${width - 24} ${height - 24} Z`}
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinejoin="round"
            strokeDasharray={seen ? undefined : '1200'}
            strokeDashoffset={seen ? undefined : '1200'}
            style={
              seen
                ? undefined
                : {
                    animation: 'aegis-stroke 1400ms var(--ease-draft, var(--ease)) forwards',
                  }
            }
          />
          <circle
            cx={width / 2}
            cy={height / 2 + 4}
            r="3"
            fill="currentColor"
            opacity={seen ? 1 : 0}
            style={seen ? undefined : { animation: 'aegis-dot-in 400ms 1200ms forwards' }}
          />
        </svg>
      )}
      <style jsx>{`
        @keyframes aegis-stroke {
          to { stroke-dashoffset: 0; }
        }
        @keyframes aegis-dot-in {
          from { opacity: 0; transform: scale(0); }
          to   { opacity: 1; transform: scale(1); }
        }
        @media (prefers-reduced-motion: reduce) {
          path, circle { animation: none !important; stroke-dashoffset: 0 !important; opacity: 1 !important; }
        }
      `}</style>
    </div>
  )
}

export default Skeleton
