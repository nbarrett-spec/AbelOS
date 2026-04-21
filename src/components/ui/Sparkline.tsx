'use client'

import { useId } from 'react'
import { cn } from '@/lib/utils'

export interface SparklineProps {
  data: number[]
  color?: string
  width?: number
  height?: number
  /** Show the area fill gradient below the line */
  showArea?: boolean
  /** Show a dot at the final data point */
  showDot?: boolean
  /** Optional data point to mark with a different style (e.g. start of forecast) */
  forecastFromIndex?: number
  /** Color for forecast portion — defaults to the forecast semantic token */
  forecastColor?: string
  className?: string
  /** a11y label */
  label?: string
}

/**
 * Lightweight SVG sparkline — no chart lib. Tabular-safe.
 * Supports forecast overlay: pass forecastFromIndex to style points past that
 * index with a dashed line in the forecast color.
 */
export default function Sparkline({
  data,
  color = 'var(--accent)',
  width = 80,
  height = 28,
  showArea = true,
  showDot = true,
  forecastFromIndex,
  forecastColor = 'var(--forecast)',
  className,
  label,
}: SparklineProps) {
  const gradId = useId().replace(/:/g, '')
  if (!data || data.length < 2) {
    return <span aria-hidden className={cn('inline-block', className)} style={{ width, height }} />
  }

  const max = Math.max(...data)
  const min = Math.min(...data)
  const range = max - min || 1
  const pad = 2

  const points = data.map((v, i) => {
    const x = pad + (i / (data.length - 1)) * (width - pad * 2)
    const y = pad + (1 - (v - min) / range) * (height - pad * 2)
    return [x, y] as const
  })

  const actualCutoff = typeof forecastFromIndex === 'number' ? Math.max(0, Math.min(forecastFromIndex, points.length)) : points.length
  const actualPoints = points.slice(0, actualCutoff)
  const forecastPoints = points.slice(Math.max(0, actualCutoff - 1)) // overlap 1 point to join

  const pointsStr = (arr: readonly (readonly [number, number])[]) => arr.map(([x, y]) => `${x},${y}`).join(' ')
  const lastPoint = points[points.length - 1]

  const areaPoints = [
    ...actualPoints.map(([x, y]) => [x, y] as [number, number]),
    [actualPoints[actualPoints.length - 1]?.[0] ?? pad, height - pad] as [number, number],
    [pad, height - pad] as [number, number],
  ]

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={cn('shrink-0', className)}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      {showArea && actualPoints.length > 1 && (
        <>
          <defs>
            <linearGradient id={`spark-${gradId}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.22} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <polygon
            points={areaPoints.map(([x, y]) => `${x},${y}`).join(' ')}
            fill={`url(#spark-${gradId})`}
          />
        </>
      )}
      {actualPoints.length > 1 && (
        <polyline
          points={pointsStr(actualPoints)}
          fill="none"
          stroke={color}
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
      {forecastPoints.length > 1 && (
        <polyline
          points={pointsStr(forecastPoints)}
          fill="none"
          stroke={forecastColor}
          strokeWidth={1.5}
          strokeDasharray="3 2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
      {showDot && (
        <circle
          cx={lastPoint[0]}
          cy={lastPoint[1]}
          r={2}
          fill={forecastPoints.length > 1 ? forecastColor : color}
        />
      )}
    </svg>
  )
}
