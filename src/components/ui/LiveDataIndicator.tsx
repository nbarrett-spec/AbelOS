'use client'

import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'

// ── Types ─────────────────────────────────────────────────────────────────

export interface LiveDataIndicatorProps {
  /** When this changes, the bar pulses once. Usually pass the refresh timestamp or a tick counter. */
  trigger: number | string | null
  /** Duration of the pulse in ms. Default 1400. */
  duration?: number
  /** 'accent' | 'positive' | 'forecast' — color of the bar. Default 'accent'. */
  tone?: 'accent' | 'positive' | 'forecast'
  className?: string
}

// ── Component ─────────────────────────────────────────────────────────────

/**
 * LiveDataIndicator — a 4px accent bar that slides + pulses briefly when
 * backing data refreshes. Signals "this just synced" without a spinner.
 *
 * Place at the very top of a page, usually right below the sticky header.
 */
export default function LiveDataIndicator({
  trigger,
  duration = 1400,
  tone = 'accent',
  className,
}: LiveDataIndicatorProps) {
  const [active, setActive] = useState(false)
  const [mounted, setMounted] = useState(false)

  useEffect(() => { setMounted(true) }, [])

  useEffect(() => {
    if (!mounted || trigger === null) return
    setActive(true)
    const t = setTimeout(() => setActive(false), duration)
    return () => clearTimeout(t)
  }, [trigger, duration, mounted])

  const toneClass =
    tone === 'positive' ? 'bg-data-positive'
    : tone === 'forecast' ? 'bg-forecast'
    : 'bg-accent'

  return (
    <div
      aria-hidden
      className={cn(
        'relative h-[3px] w-full overflow-hidden pointer-events-none',
        className,
      )}
    >
      <div
        className={cn(
          'absolute inset-y-0 left-0 w-full origin-left transition-all duration-500 ease-out',
          toneClass,
          active
            ? 'scale-x-100 opacity-100'
            : 'scale-x-0 opacity-0',
        )}
        style={{
          boxShadow: active ? '0 0 16px var(--accent)' : undefined,
        }}
      />
    </div>
  )
}
