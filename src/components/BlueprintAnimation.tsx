'use client'

/**
 * BlueprintAnimation — the Drafting Room fingerprint for the login page
 * and empty states.
 *
 * Picks one of 12 door-plan SVGs from src/lib/blueprints/, then draws it
 * in over ~9 seconds using per-path stroke-dashoffset transitions. After
 * the full reveal, the fill breathes on an 8s opacity cycle (±0.03)
 * unless `loop={false}` or `prefers-reduced-motion` is set.
 *
 * Respects reduced motion — collapses to an instant render.
 */

import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { blueprintForSeed, blueprintById, type Blueprint } from '@/lib/blueprints'

export interface BlueprintAnimationProps {
  /** Picks a blueprint — seed mod 12. Day-of-year is a good default. */
  seed?: number
  /** Force a specific blueprint by id, bypassing the seed. */
  id?: string
  /** If false, skip the idle breathing pulse after the draw completes. */
  loop?: boolean
  /** Total draw duration in ms (per brief: 9000). */
  duration?: number
  /** Stroke width in viewBox units. */
  strokeWidth?: number
  /** Color override — defaults to currentColor so the parent tints. */
  stroke?: string
  /** Aria label for screen readers. */
  ariaLabel?: string
  className?: string
  style?: React.CSSProperties
  /** Called once the full reveal is done — useful for on-enter transitions. */
  onComplete?: () => void
}

function prefersReducedMotion() {
  if (typeof window === 'undefined') return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function BlueprintAnimationImpl({
  seed,
  id,
  loop = true,
  duration = 9000,
  strokeWidth = 1.2,
  stroke,
  ariaLabel,
  className,
  style,
  onComplete,
}: BlueprintAnimationProps) {
  // Resolve blueprint once
  const blueprint: Blueprint = useMemo(() => {
    if (id) {
      const found = blueprintById(id)
      if (found) return found
    }
    return blueprintForSeed(seed ?? 0)
  }, [id, seed])

  const [complete, setComplete] = useState(false)
  const [reduced, setReduced] = useState(false)
  const onCompleteRef = useRef(onComplete)
  onCompleteRef.current = onComplete

  useEffect(() => {
    setReduced(prefersReducedMotion())
  }, [])

  // Sum lengths for timing allocation — each path draws proportional to its length.
  const totalLength = useMemo(
    () => blueprint.paths.reduce((n, p) => n + p.length, 0),
    [blueprint],
  )

  // Fire onComplete after duration
  useEffect(() => {
    if (reduced) {
      setComplete(true)
      onCompleteRef.current?.()
      return
    }
    setComplete(false)
    const t = window.setTimeout(() => {
      setComplete(true)
      onCompleteRef.current?.()
    }, duration + 120)
    return () => window.clearTimeout(t)
  }, [blueprint.id, duration, reduced])

  // Pre-compute per-path delay + dur so the whole thing lands at `duration`.
  const timing = useMemo(() => {
    let cursor = 0
    return blueprint.paths.map((p) => {
      const share = p.length / Math.max(totalLength, 1)
      const dur = Math.max(260, Math.round(share * duration * 0.92))
      const delay = Math.round((cursor / Math.max(totalLength, 1)) * duration * 0.92)
      cursor += p.length
      return { delay, dur }
    })
  }, [blueprint, totalLength, duration])

  const shouldBreathe = !reduced && loop && complete

  return (
    <svg
      viewBox={blueprint.viewBox}
      xmlns="http://www.w3.org/2000/svg"
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label={ariaLabel ?? `${blueprint.name} architectural blueprint`}
      className={className}
      style={{
        color: stroke ?? 'currentColor',
        ...style,
      }}
    >
      <g
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{
          opacity: shouldBreathe ? undefined : 1,
          animation: shouldBreathe ? 'aegis-blueprint-breathe 8s ease-in-out infinite' : undefined,
        }}
      >
        {blueprint.paths.map((p, i) => {
          const { delay, dur } = timing[i]
          if (reduced) {
            return (
              <path
                key={i}
                d={p.d}
                strokeWidth={p.width ?? strokeWidth}
              />
            )
          }
          return (
            <path
              key={i}
              d={p.d}
              strokeWidth={p.width ?? strokeWidth}
              style={{
                strokeDasharray: p.length,
                strokeDashoffset: p.length,
                animation: `aegis-blueprint-draw ${dur}ms var(--ease-draft, cubic-bezier(0.6,0.1,0.2,1)) ${delay}ms forwards`,
              }}
            />
          )
        })}
      </g>

      {/* Scoped keyframes — scheduled inside the SVG so they apply once mounted.
          Reduced-motion users skip these entirely (we render the paths fully
          drawn above). */}
      <style>{`
        @keyframes aegis-blueprint-draw {
          to { stroke-dashoffset: 0; }
        }
        @keyframes aegis-blueprint-breathe {
          0%, 100% { opacity: 1; }
          50%      { opacity: 0.97; }
        }
        @media (prefers-reduced-motion: reduce) {
          @keyframes aegis-blueprint-draw { to { stroke-dashoffset: 0; } }
          @keyframes aegis-blueprint-breathe { 0%, 100% { opacity: 1; } }
        }
      `}</style>
    </svg>
  )
}

const BlueprintAnimation = memo(BlueprintAnimationImpl)
export default BlueprintAnimation
export { BlueprintAnimation }
