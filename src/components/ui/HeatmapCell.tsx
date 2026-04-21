'use client'

import { useState, type HTMLAttributes, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

// ── Aegis v2 "Drafting Room" HeatmapCell ─────────────────────────────────
// Colored rect; gradient navy (zero) → gold (mid) → ember (hot).
// Hover tooltip with value + label.
// ─────────────────────────────────────────────────────────────────────────

export interface HeatmapCellProps extends HTMLAttributes<HTMLDivElement> {
  /** Normalized 0..1 intensity */
  value: number
  /** Actual display value for tooltip (e.g. "87%", "42 min") */
  displayValue?: ReactNode
  /** Tooltip label */
  label?: ReactNode
  size?: number
  /** Override the scale (0..1 → color). Default navy → gold → ember */
  getColor?: (v: number) => string
}

function defaultColor(v: number): string {
  const t = Math.max(0, Math.min(1, v))
  // navy (zero) → gold (mid) → ember (hot)
  if (t < 0.5) {
    // navy -> gold
    const k = t / 0.5
    // navy-mid 19,45,66 -> gold 198,162,78
    const r = Math.round(19 + (198 - 19) * k)
    const g = Math.round(45 + (162 - 45) * k)
    const b = Math.round(66 + (78 - 66) * k)
    return `rgb(${r},${g},${b})`
  }
  // gold -> ember
  const k = (t - 0.5) / 0.5
  const r = Math.round(198 + (182 - 198) * k)
  const g = Math.round(162 + (78 - 162) * k)
  const b = Math.round(78 + (61 - 78) * k)
  return `rgb(${r},${g},${b})`
}

export function HeatmapCell({
  value,
  displayValue,
  label,
  size = 32,
  getColor = defaultColor,
  className,
  style,
  ...props
}: HeatmapCellProps) {
  const [hover, setHover] = useState(false)
  const bg = getColor(Math.max(0, Math.min(1, value)))
  return (
    <div
      {...props}
      className={cn('relative inline-block rounded-[2px]', className)}
      style={{ width: size, height: size, background: bg, ...style }}
      role="img"
      aria-label={
        typeof label === 'string' && typeof displayValue === 'string'
          ? `${label}: ${displayValue}`
          : undefined
      }
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      {hover && (displayValue != null || label != null) && (
        <span
          className="pointer-events-none absolute z-10 left-1/2 -translate-x-1/2 rounded-sm border border-border bg-surface px-2 py-1 font-mono text-[10px] text-fg whitespace-nowrap shadow-[var(--elev-2)]"
          style={{ bottom: size + 6 }}
        >
          {label && <span className="text-fg-muted mr-1">{label}</span>}
          {displayValue != null && <span className="tabular-nums">{displayValue}</span>}
        </span>
      )}
    </div>
  )
}

export default HeatmapCell
