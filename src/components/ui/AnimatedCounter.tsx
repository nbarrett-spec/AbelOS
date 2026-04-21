'use client'

/**
 * AnimatedCounter — KPI numbers that count up from 0 on first render (#17).
 * Uses requestAnimationFrame for smooth 60fps counting.
 */

import { useEffect, useRef, useState, memo } from 'react'

interface AnimatedCounterProps {
  value: number
  /** Duration in ms (default 800) */
  duration?: number
  /** Format function — defaults to toLocaleString */
  format?: (n: number) => string
  /** Optional prefix (e.g. "$") */
  prefix?: string
  /** Optional suffix (e.g. "%") */
  suffix?: string
  className?: string
}

function AnimatedCounterImpl({
  value,
  duration = 800,
  format,
  prefix = '',
  suffix = '',
  className = '',
}: AnimatedCounterProps) {
  const [display, setDisplay] = useState(0)
  const prevValue = useRef(0)
  const frameRef = useRef<number>(0)

  useEffect(() => {
    const start = prevValue.current
    const diff = value - start
    const startTime = performance.now()

    function tick(now: number) {
      const elapsed = now - startTime
      const progress = Math.min(elapsed / duration, 1)
      // Ease out cubic
      const eased = 1 - Math.pow(1 - progress, 3)
      const current = start + diff * eased
      setDisplay(current)

      if (progress < 1) {
        frameRef.current = requestAnimationFrame(tick)
      } else {
        prevValue.current = value
      }
    }

    frameRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frameRef.current)
  }, [value, duration])

  const formatted = format
    ? format(display)
    : Number.isInteger(value)
      ? Math.round(display).toLocaleString()
      : display.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })

  return (
    <span className={`tabular-nums ${className}`}>
      {prefix}{formatted}{suffix}
    </span>
  )
}

export default memo(AnimatedCounterImpl)
