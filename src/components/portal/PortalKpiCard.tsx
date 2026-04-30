'use client'

/**
 * Builder Portal — KPI card.
 *
 * §4.1 Dashboard. Top 3px accent bar, label (uppercase kiln-oak), value
 * (Playfair Display + animated NumberTicker), optional delta + sparkline
 * pinned bottom-right at 12% opacity.
 */

import { TrendingDown, TrendingUp } from 'lucide-react'
import { NumberTicker } from '@/components/magicui/number-ticker'
import { PortalSparkline } from './PortalSparkline'

export interface PortalKpiCardProps {
  label: string
  value: number
  prefix?: string
  suffix?: string
  /** Number of decimal places to render in the animated value. */
  decimals?: number
  delta?: { value: number; label: string; direction?: 'up' | 'down' | 'neutral' }
  sparklineData?: number[]
  /** CSS color or var() reference for the top accent bar. */
  accentColor: string
}

export function PortalKpiCard({
  label,
  value,
  prefix,
  suffix,
  decimals = 0,
  delta,
  sparklineData,
  accentColor,
}: PortalKpiCardProps) {
  const direction =
    delta?.direction ??
    (delta && delta.value > 0 ? 'up' : delta && delta.value < 0 ? 'down' : 'neutral')

  return (
    <div
      className="relative overflow-hidden rounded-[14px] transition-shadow"
      style={{
        background: 'var(--portal-bg-card, #FFFFFF)',
        border: '1px solid var(--portal-border-light, #F0E8DA)',
        boxShadow: 'var(--shadow-sm)',
        minHeight: 130,
      }}
    >
      {/* Accent bar */}
      <div
        aria-hidden="true"
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: 3,
          background: accentColor,
        }}
      />

      <div className="px-5 pt-5 pb-4">
        <div
          className="text-[11px] font-semibold uppercase tracking-wider"
          style={{
            color: 'var(--portal-kiln-oak, #8B6F47)',
            letterSpacing: '0.08em',
          }}
        >
          {label}
        </div>

        <div
          className="flex items-baseline gap-1 mt-2"
          style={{
            fontFamily: 'var(--font-portal-display, Georgia)',
            fontSize: '2.25rem',
            fontWeight: 600,
            lineHeight: 1.1,
            color: 'var(--portal-text-strong, #3E2A1E)',
            letterSpacing: '-0.02em',
          }}
        >
          {prefix && <span className="text-[1.25rem] opacity-80 mr-0.5">{prefix}</span>}
          <NumberTicker value={value} decimalPlaces={decimals} className="tabular-nums" />
          {suffix && <span className="text-[1.25rem] opacity-80 ml-0.5">{suffix}</span>}
        </div>

        {delta && (
          <div
            className="inline-flex items-center gap-1 mt-2 text-xs"
            style={{
              color:
                direction === 'up'
                  ? '#1A4B21'
                  : direction === 'down'
                    ? '#7E2417'
                    : 'var(--portal-text-muted, #6B6056)',
              fontWeight: 500,
            }}
          >
            {direction === 'up' && <TrendingUp className="w-3 h-3" />}
            {direction === 'down' && <TrendingDown className="w-3 h-3" />}
            <span>{delta.label}</span>
          </div>
        )}
      </div>

      {/* Sparkline pinned bottom-right at low opacity */}
      {sparklineData && sparklineData.length > 1 && (
        <div
          aria-hidden="true"
          style={{
            position: 'absolute',
            right: 8,
            bottom: 8,
            opacity: 0.18,
            pointerEvents: 'none',
          }}
        >
          <PortalSparkline data={sparklineData} color={accentColor} opacity={1} />
        </div>
      )}
    </div>
  )
}
