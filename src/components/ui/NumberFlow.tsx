'use client'

import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react'
import RawNumberFlow from '@number-flow/react'
import { ArrowDown, ArrowUp, Minus } from 'lucide-react'
import { cn } from '@/lib/utils'

// ── Aegis v2 "Drafting Room" NumberFlow ──────────────────────────────────
// Slot-machine digit-roll via @number-flow/react, JetBrains Mono + tabular,
// 180ms gold flash behind digits on value change.
//
// Format presets:
//   integer:   1,847
//   decimal:   42.50
//   currency:  $42,150.00
//   percent:   23.4%
//   percentage: (alias of percent, retained for back-compat)
//   compact:   1.2M
// ─────────────────────────────────────────────────────────────────────────

export type NumberFlowFormat =
  | 'integer'
  | 'decimal'
  | 'currency'
  | 'percent'
  | 'percentage' // alias, back-compat
  | 'compact'

export type NumberFlowSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl'

export interface NumberFlowProps {
  /** Target numeric value */
  value: number | null | undefined
  /** Preset format (maps to Intl.NumberFormat options). Defaults to 'integer'. */
  format?: NumberFlowFormat
  /** Currency code (for format='currency'). Defaults to 'USD'. */
  currency?: string
  /** Override: full Intl.NumberFormat options — takes precedence over `format`. */
  formatOptions?: Intl.NumberFormatOptions
  /** Locale override. Defaults to 'en-US'. */
  locale?: string
  /** Size variant */
  size?: NumberFlowSize
  /** Prefix slot (symbol or label) */
  prefix?: ReactNode
  /** Suffix slot ("%", "days", etc.) */
  suffix?: ReactNode
  /** Number of decimals (overrides preset) */
  decimals?: number
  /** Fallback when value is nullish / NaN */
  fallback?: string
  /** Direction arrow: 'auto' infers from prev vs current */
  direction?: 'auto' | 'up' | 'down' | 'flat' | 'none'
  /** Disable the gold flash on change */
  noFlash?: boolean
  /** Legacy: pass through to library (number-flow trend) */
  trend?: 0 | 1 | -1
  /** Wrapper className */
  className?: string
  /** Respect prefers-reduced-motion (default true) */
  respectMotionPreference?: boolean
  /** Accessible label */
  'aria-label'?: string
  style?: CSSProperties
}

const SIZE_CLASS: Record<NumberFlowSize, string> = {
  xs: 'text-[12px]',
  sm: 'text-[14px]',   // 0.875rem
  md: 'text-[16px]',   // 1rem
  lg: 'text-[28px]',   // 1.75rem
  xl: 'text-[36px]',   // 2.25rem
}

function resolveFormat(
  format: NumberFlowFormat,
  currency: string,
  decimals: number | undefined,
): Intl.NumberFormatOptions {
  switch (format) {
    case 'currency':
      return {
        style: 'currency',
        currency,
        minimumFractionDigits: decimals ?? 2,
        maximumFractionDigits: decimals ?? 2,
      }
    case 'percent':
    case 'percentage':
      return {
        style: 'percent',
        minimumFractionDigits: decimals ?? 1,
        maximumFractionDigits: decimals ?? 1,
      }
    case 'decimal':
      return {
        style: 'decimal',
        minimumFractionDigits: decimals ?? 0,
        maximumFractionDigits: decimals ?? 2,
      }
    case 'compact':
      return {
        notation: 'compact',
        maximumFractionDigits: decimals ?? 1,
      }
    case 'integer':
    default:
      return { maximumFractionDigits: decimals ?? 0 }
  }
}

export function NumberFlow({
  value,
  format = 'integer',
  currency = 'USD',
  formatOptions,
  locale = 'en-US',
  size = 'md',
  prefix,
  suffix,
  decimals,
  fallback = '—',
  direction = 'none',
  noFlash = false,
  trend,
  className,
  respectMotionPreference = true,
  'aria-label': ariaLabel,
  style,
}: NumberFlowProps) {
  const prevRef = useRef<number | null | undefined>(value)
  const [flash, setFlash] = useState(false)

  useEffect(() => {
    if (prevRef.current === value) return
    if (!noFlash && value != null && Number.isFinite(value)) {
      setFlash(true)
      const t = setTimeout(() => setFlash(false), 180)
      prevRef.current = value
      return () => clearTimeout(t)
    }
    prevRef.current = value
    return
  }, [value, noFlash])

  if (value == null || !Number.isFinite(value)) {
    return (
      <span
        className={cn(
          'tabular-nums font-mono inline-block',
          SIZE_CLASS[size],
          className,
        )}
        aria-label={ariaLabel}
        style={style}
      >
        {fallback}
      </span>
    )
  }

  // Percentage: accept both ratios (0.234) and whole percents (23.4).
  let displayValue = value
  const options = formatOptions ?? resolveFormat(format, currency, decimals)
  if (
    (format === 'percent' || format === 'percentage') &&
    !formatOptions &&
    Math.abs(value) > 1
  ) {
    displayValue = value / 100
  }

  const prev = prevRef.current ?? value
  const arrow =
    direction === 'up'
      ? ArrowUp
      : direction === 'down'
      ? ArrowDown
      : direction === 'flat'
      ? Minus
      : direction === 'auto'
      ? value > prev
        ? ArrowUp
        : value < prev
        ? ArrowDown
        : Minus
      : null

  const arrowColor =
    direction === 'up' || (direction === 'auto' && value > prev)
      ? 'var(--sage, var(--data-positive))'
      : direction === 'down' || (direction === 'auto' && value < prev)
      ? 'var(--ember, var(--data-negative))'
      : 'var(--fg-muted)'

  const Arrow = arrow

  return (
    <span
      className={cn(
        'aegis-number-flow inline-flex items-baseline gap-1 font-mono tabular-nums',
        SIZE_CLASS[size],
        flash && 'aegis-number-flow--flash',
        className,
      )}
      style={{
        fontFeatureSettings: "'tnum' on, 'lnum' on, 'zero' on",
        letterSpacing: '-0.01em',
        ...style,
      }}
      aria-label={ariaLabel}
    >
      {prefix && <span className="aegis-nf__affix">{prefix}</span>}
      <RawNumberFlow
        value={displayValue}
        format={options as any}
        locales={locale}
        respectMotionPreference={respectMotionPreference}
        transformTiming={{ duration: 180, easing: 'cubic-bezier(.2,.8,.2,1)' }}
        spinTiming={{ duration: 180, easing: 'cubic-bezier(.2,.8,.2,1)' }}
        {...(trend !== undefined ? { trend } : {})}
      />
      {suffix && <span className="aegis-nf__affix">{suffix}</span>}
      {Arrow && (
        <Arrow
          className="w-3.5 h-3.5 shrink-0 self-center"
          style={{ color: arrowColor }}
          aria-hidden
        />
      )}

      <style jsx>{`
        .aegis-number-flow {
          font-family: var(--font-mono, 'JetBrains Mono', monospace);
          line-height: 1;
          white-space: nowrap;
        }
        .aegis-number-flow--flash :global(number-flow-react) {
          background: var(--signal-subtle);
          animation: aegis-gold-flash 180ms var(--ease) both;
          border-radius: var(--radius-xs);
          padding: 0 2px;
          margin: 0 -2px;
        }
        @keyframes aegis-gold-flash {
          0%   { background: var(--signal-subtle); }
          100% { background: transparent; }
        }
        @media (prefers-reduced-motion: reduce) {
          .aegis-number-flow :global(*) {
            animation-duration: 0.01ms !important;
            transition-duration: 120ms !important;
          }
        }
      `}</style>
    </span>
  )
}

export default NumberFlow
