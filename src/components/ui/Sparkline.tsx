'use client'

import { useEffect, useId, useMemo, useRef, useState, type MouseEvent } from 'react'
import { cn } from '@/lib/utils'

// ── Aegis v2 "Drafting Room" Sparkline ───────────────────────────────────
// 48×16 default, gold/walnut stroke, 1.5px line, gradient fill 20%→0,
// 3px last-point dot, optional hover tooltip.
// Preserves forecast overlay from v1 API.
// Adds optional draw-in animation (Tier 5.3).
// ─────────────────────────────────────────────────────────────────────────

export interface SparklineProps {
  data: number[]
  /** Stroke color (override auto dark/light) */
  color?: string
  width?: number
  height?: number
  showArea?: boolean
  showDot?: boolean
  /** Show tooltip at cursor on hover */
  showTooltip?: boolean
  /** Index at which the forecast portion starts (dashed stroke past this) */
  forecastFromIndex?: number
  forecastColor?: string
  className?: string
  label?: string
  /** Format the tooltip value */
  formatValue?: (v: number) => string
  /** Animate the stroke draw-in on mount. Defaults to true. Respects prefers-reduced-motion. */
  animate?: boolean
}

export function Sparkline({
  data,
  color,
  width = 48,
  height = 16,
  showArea = true,
  showDot = true,
  showTooltip = false,
  forecastFromIndex,
  forecastColor = 'var(--forecast)',
  className,
  label,
  formatValue,
  animate = true,
}: SparklineProps) {
  const gradId = useId().replace(/:/g, '')
  const svgRef = useRef<SVGSVGElement>(null)
  const actualPathRef = useRef<SVGPolylineElement>(null)
  const [hover, setHover] = useState<{
    x: number
    y: number
    value: number
    index: number
  } | null>(null)
  const [actualLen, setActualLen] = useState<number | null>(null)
  const [drawn, setDrawn] = useState(false)
  const [reduceMotion, setReduceMotion] = useState(false)

  const lineColor = color ?? 'var(--signal, var(--gold))'

  const { points, pad } = useMemo(() => {
    const p = 2
    if (!data || data.length < 2) return { points: [] as Array<readonly [number, number]>, pad: p }
    const max = Math.max(...data)
    const min = Math.min(...data)
    const range = max - min || 1
    const pts = data.map((v, i) => {
      const x = p + (i / (data.length - 1)) * (width - p * 2)
      const y = p + (1 - (v - min) / range) * (height - p * 2)
      return [x, y] as const
    })
    return { points: pts, pad: p }
  }, [data, width, height])

  // Measure path lengths and trigger the draw-in after first paint.
  useEffect(() => {
    if (!animate) {
      setActualLen(null)
      setDrawn(true)
      return
    }

    // useEffect is client-only, but guard anyway for safety.
    if (typeof window === 'undefined') return

    const prefersReduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    setReduceMotion(prefersReduce)

    if (prefersReduce) {
      setActualLen(null)
      setDrawn(true)
      return
    }

    const aLen = actualPathRef.current?.getTotalLength?.() ?? 0
    setActualLen(aLen > 0 ? aLen : null)
    setDrawn(false)

    // Flip drawn=true on the next frame so the transition runs from offset=len → 0.
    const raf = window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => setDrawn(true))
    })
    return () => window.cancelAnimationFrame(raf)
  }, [animate, data, width, height, forecastFromIndex])

  if (!data || data.length < 2) {
    return (
      <span
        aria-hidden
        className={cn('inline-block', className)}
        style={{ width, height }}
      />
    )
  }

  const actualCutoff =
    typeof forecastFromIndex === 'number'
      ? Math.max(0, Math.min(forecastFromIndex, points.length))
      : points.length
  const actualPoints = points.slice(0, actualCutoff)
  const forecastPoints = points.slice(Math.max(0, actualCutoff - 1))

  const toStr = (arr: ReadonlyArray<readonly [number, number]>) =>
    arr.map(([x, y]) => `${x},${y}`).join(' ')

  const lastPoint = points[points.length - 1]

  const areaPoints = [
    ...actualPoints.map(([x, y]) => [x, y] as [number, number]),
    [actualPoints[actualPoints.length - 1]?.[0] ?? pad, height - pad] as [number, number],
    [pad, height - pad] as [number, number],
  ]

  function handleMove(e: MouseEvent<SVGSVGElement>) {
    if (!showTooltip) return
    const svg = svgRef.current
    if (!svg) return
    const rect = svg.getBoundingClientRect()
    const relX = ((e.clientX - rect.left) / rect.width) * width
    // nearest data index
    const idx = Math.max(
      0,
      Math.min(data.length - 1, Math.round(((relX - pad) / (width - pad * 2)) * (data.length - 1))),
    )
    const [px, py] = points[idx]
    setHover({ x: px, y: py, value: data[idx], index: idx })
  }

  // Animation styling: when animating and not reduced-motion, set dasharray to
  // the path length and offset it to hide the stroke; flip the offset to 0 to
  // draw the line in. When animate=false or prefers-reduced-motion, skip
  // dash math entirely so the stroke renders normally.
  const animateActive = animate && !reduceMotion
  const actualDashStyle: React.CSSProperties =
    animateActive && actualLen != null
      ? {
          strokeDasharray: actualLen,
          strokeDashoffset: drawn ? 0 : actualLen,
          transition: 'stroke-dashoffset 600ms ease-out',
        }
      : {}
  // The forecast polyline already uses strokeDasharray="3 2" for its dashed
  // visual; layering a dashoffset draw-in on top of that doesn't render
  // cleanly. Instead, fade the forecast in after the actual line draws.
  const forecastDashStyle: React.CSSProperties = animateActive
    ? {
        opacity: drawn ? 1 : 0,
        transition: 'opacity 300ms ease-out 500ms',
      }
    : {}

  return (
    <span className={cn('relative inline-block', className)} style={{ width, height }}>
      <svg
        ref={svgRef}
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        className="shrink-0 block"
        role={label ? 'img' : undefined}
        aria-label={label}
        aria-hidden={label ? undefined : true}
        onMouseMove={handleMove}
        onMouseLeave={() => setHover(null)}
      >
        {showArea && actualPoints.length > 1 && (
          <>
            <defs>
              <linearGradient id={`aegis-spark-${gradId}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={lineColor} stopOpacity={0.2} />
                <stop offset="100%" stopColor={lineColor} stopOpacity={0} />
              </linearGradient>
            </defs>
            <polygon
              points={areaPoints.map(([x, y]) => `${x},${y}`).join(' ')}
              fill={`url(#aegis-spark-${gradId})`}
            />
          </>
        )}
        {actualPoints.length > 1 && (
          <polyline
            ref={actualPathRef}
            points={toStr(actualPoints)}
            fill="none"
            stroke={lineColor}
            strokeWidth={1.5}
            strokeLinecap="round"
            strokeLinejoin="round"
            style={actualDashStyle}
          />
        )}
        {forecastPoints.length > 1 && (
          <polyline
            points={toStr(forecastPoints)}
            fill="none"
            stroke={forecastColor}
            strokeWidth={1.5}
            strokeDasharray="3 2"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={forecastDashStyle}
          />
        )}
        {showDot && lastPoint && (
          <circle
            cx={lastPoint[0]}
            cy={lastPoint[1]}
            r={1.5}
            fill={forecastPoints.length > 1 ? forecastColor : lineColor}
          />
        )}
        {hover && (
          <circle
            cx={hover.x}
            cy={hover.y}
            r={2}
            fill={lineColor}
            stroke="var(--canvas)"
            strokeWidth={1}
          />
        )}
      </svg>
      {hover && showTooltip && (
        <span
          className="pointer-events-none absolute z-10 rounded-sm border border-border bg-surface px-1.5 py-0.5 font-mono text-[10px] text-fg"
          style={{
            left: hover.x,
            bottom: height + 4,
            transform: 'translateX(-50%)',
          }}
        >
          {formatValue ? formatValue(hover.value) : hover.value}
        </span>
      )}
    </span>
  )
}

export default Sparkline
