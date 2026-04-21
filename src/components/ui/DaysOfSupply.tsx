'use client'

import { type HTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

// ── Aegis v2 "Drafting Room" DaysOfSupply ────────────────────────────────
// Horizontal bar. Segment tint by days: >14 gold, 7-14 warn, <7 ember.
// Pulsing ember when projected stockout before next delivery.
// ─────────────────────────────────────────────────────────────────────────

export interface DaysOfSupplyProps extends HTMLAttributes<HTMLDivElement> {
  /** Days of supply on hand */
  days: number
  /** Days until the next scheduled delivery (for stockout detection) */
  daysUntilDelivery?: number
  /** Max days shown at full bar width (default 30) */
  max?: number
  /** Show numeric "X days" label on the right */
  showLabel?: boolean
  /** Override label text */
  label?: string
}

function tintFor(days: number): 'healthy' | 'warn' | 'critical' {
  if (days < 7) return 'critical'
  if (days <= 14) return 'warn'
  return 'healthy'
}

export function DaysOfSupply({
  days,
  daysUntilDelivery,
  max = 30,
  showLabel = true,
  label,
  className,
  ...props
}: DaysOfSupplyProps) {
  const tint = tintFor(days)
  const pct = Math.max(0, Math.min(100, (days / max) * 100))
  const willStockout =
    typeof daysUntilDelivery === 'number' && days < daysUntilDelivery

  const color =
    tint === 'healthy'
      ? 'var(--signal, var(--gold))'
      : tint === 'warn'
      ? 'var(--gold-dark, #a88a3a)'
      : 'var(--ember, #b64e3d)'

  return (
    <div
      {...props}
      className={cn('flex items-center gap-2 w-full', className)}
      style={{ height: showLabel ? 20 : 8, ...(props.style ?? {}) }}
      role="meter"
      aria-valuenow={days}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-label={label ?? `${days} days of supply`}
    >
      <div
        className="relative flex-1 overflow-hidden"
        style={{
          height: 8,
          background: 'var(--surface-muted)',
          borderRadius: 999,
        }}
      >
        <div
          className={cn(willStockout && 'aegis-dos-pulse')}
          style={{
            position: 'absolute',
            inset: 0,
            width: `${pct}%`,
            background: color,
            borderRadius: 999,
            transition: 'width 240ms var(--ease), background-color 240ms var(--ease)',
            boxShadow: willStockout ? `0 0 8px ${color}` : undefined,
          }}
        />
      </div>
      {showLabel && (
        <span
          className="shrink-0 font-mono text-[11px] tabular-nums"
          style={{ color }}
        >
          {label ?? `${Math.round(days)} days`}
        </span>
      )}
      <style jsx>{`
        @keyframes aegis-dos-pulse {
          0%, 100% { opacity: 1; }
          50%      { opacity: 0.45; }
        }
        .aegis-dos-pulse {
          animation: aegis-dos-pulse 1.4s cubic-bezier(.2,.8,.2,1) infinite;
        }
        @media (prefers-reduced-motion: reduce) {
          .aegis-dos-pulse { animation: none !important; }
        }
      `}</style>
    </div>
  )
}

export default DaysOfSupply
