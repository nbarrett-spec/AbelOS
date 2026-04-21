'use client'

import { useEffect, useRef, useState, memo } from 'react'
import { cn } from '@/lib/utils'

// ── Types ─────────────────────────────────────────────────────────────────

export interface AnimatedNumberProps {
  /** The target numeric value */
  value: number
  /** Optional formatter — receives the current (interpolated) numeric value.
   *  Defaults to integer localized formatting. */
  format?: (n: number) => string
  /** Animation duration in ms. Defaults to 400ms. */
  duration?: number
  /** Easing function (t in [0,1]) → [0,1]. Defaults to easeOutCubic. */
  easing?: (t: number) => number
  /** className applied to the wrapper span */
  className?: string
  /** If true, show a brief highlight flash when the value changes */
  highlight?: boolean
  /** Accent color when flashing — 'up' | 'down' | 'neutral' */
  highlightTone?: 'up' | 'down' | 'neutral'
}

// Default easing — eases out cubic, feels snappy without whiplash.
const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3)

// Default formatter — integer, locale-aware, tabular-nums friendly.
const defaultFormat = (n: number) => new Intl.NumberFormat('en-US').format(Math.round(n))

// Cheap check for reduced motion.
function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return false
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
}

// ── Component ─────────────────────────────────────────────────────────────

/**
 * AnimatedNumber — smoothly transitions between values over ~400ms using
 * requestAnimationFrame. Respects prefers-reduced-motion (jumps directly).
 *
 * Numeric-tabular by default so width stays stable as digits change.
 */
function AnimatedNumberBase({
  value,
  format = defaultFormat,
  duration = 400,
  easing = easeOutCubic,
  className,
  highlight = false,
  highlightTone,
}: AnimatedNumberProps) {
  const [display, setDisplay] = useState(value)
  const [flashing, setFlashing] = useState(false)
  const fromRef = useRef(value)
  const rafRef = useRef<number | null>(null)
  const firstRun = useRef(true)

  useEffect(() => {
    // Skip animation for the very first mount — just set the value.
    if (firstRun.current) {
      firstRun.current = false
      fromRef.current = value
      setDisplay(value)
      return
    }

    // If reduced motion or value unchanged, snap instantly.
    if (prefersReducedMotion() || fromRef.current === value) {
      fromRef.current = value
      setDisplay(value)
      return
    }

    const from = fromRef.current
    const to = value
    const start = performance.now()

    if (highlight) {
      setFlashing(true)
      const t = setTimeout(() => setFlashing(false), 600)
      // cleanup below
      const cleanupFlash = () => clearTimeout(t)
      ;(rafRef as any).__cleanupFlash = cleanupFlash
    }

    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration)
      const eased = easing(t)
      const current = from + (to - from) * eased
      setDisplay(current)
      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick)
      } else {
        fromRef.current = to
        rafRef.current = null
      }
    }

    rafRef.current = requestAnimationFrame(tick)

    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
      const c = (rafRef as any).__cleanupFlash
      if (typeof c === 'function') c()
    }
  }, [value, duration, easing, highlight])

  const toneClass =
    highlightTone === 'up'
      ? 'text-data-positive'
      : highlightTone === 'down'
        ? 'text-data-negative'
        : ''

  return (
    <span
      className={cn(
        'tabular-nums font-numeric inline-block transition-colors duration-300',
        flashing && toneClass,
        className,
      )}
      aria-live="polite"
    >
      {format(display)}
    </span>
  )
}

export const AnimatedNumber = memo(AnimatedNumberBase)
export default AnimatedNumber
