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
    // Mockup-3 .summary-card — glass treatment + 2px colored left bar
    // (replaces v1's top accent bar to match the mockup) + Instrument
    // Serif 56px big number + Outfit label + Azeret Mono dashed footer.
    <div
      className="relative overflow-hidden rounded-[14px]"
      style={{
        background: 'var(--glass)',
        backdropFilter: 'var(--glass-blur)',
        WebkitBackdropFilter: 'var(--glass-blur)',
        border: '1px solid var(--glass-border)',
        boxShadow: 'var(--glass-shadow)',
        minHeight: 140,
        transition: 'transform 250ms var(--ease-out), box-shadow 250ms var(--ease-out)',
      }}
    >
      {/* Left accent bar (2px) */}
      <div
        aria-hidden="true"
        style={{
          position: 'absolute',
          top: 0,
          bottom: 0,
          left: 0,
          width: 2,
          background: accentColor,
        }}
      />

      <div className="px-6 pt-5 pb-5">
        {/* Big number — Instrument Serif 48px (slightly smaller than the
            mockup's 56px so it fits a 4-up grid on tablet without truncating) */}
        <div
          className="flex items-baseline gap-1 mb-1.5"
          style={{
            fontFamily: 'var(--font-portal-display)',
            fontSize: '3rem',
            fontWeight: 400,
            lineHeight: 1,
            color: 'var(--portal-text-strong)',
            fontVariantNumeric: 'tabular-nums',
            letterSpacing: '-0.01em',
          }}
        >
          {prefix && (
            <span
              className="opacity-80 mr-0.5"
              style={{ fontSize: '1.75rem' }}
            >
              {prefix}
            </span>
          )}
          <NumberTicker
            value={value}
            decimalPlaces={decimals}
            className="tabular-nums"
          />
          {suffix && (
            <span
              className="opacity-80 ml-0.5"
              style={{ fontSize: '1.75rem' }}
            >
              {suffix}
            </span>
          )}
        </div>

        {/* Label — Outfit 14px, --fg-muted (Mockup-3 .summary-label) */}
        <div
          style={{
            fontFamily: 'var(--font-portal-body)',
            fontSize: 14,
            color: 'var(--portal-text-muted)',
          }}
        >
          {label}
        </div>

        {/* Footer — delta indicator OR mono separator */}
        {delta ? (
          <div
            className="inline-flex items-center gap-1 mt-3 pt-3 text-[11px] uppercase"
            style={{
              borderTop: '1px dashed var(--bp-annotation)',
              fontFamily: 'var(--font-portal-mono)',
              letterSpacing: '0.1em',
              color:
                direction === 'up'
                  ? 'var(--data-positive)'
                  : direction === 'down'
                    ? 'var(--data-negative)'
                    : 'var(--portal-text-subtle)',
              fontWeight: 600,
              width: '100%',
            }}
          >
            {direction === 'up' && <TrendingUp className="w-3 h-3" />}
            {direction === 'down' && <TrendingDown className="w-3 h-3" />}
            <span>{delta.label}</span>
          </div>
        ) : null}
      </div>

      {/* Sparkline pinned bottom-right at low opacity */}
      {sparklineData && sparklineData.length > 1 && (
        <div
          aria-hidden="true"
          style={{
            position: 'absolute',
            right: 10,
            bottom: 10,
            opacity: 0.22,
            pointerEvents: 'none',
          }}
        >
          <PortalSparkline data={sparklineData} color={accentColor} opacity={1} />
        </div>
      )}
    </div>
  )
}
