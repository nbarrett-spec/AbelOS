'use client'

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

// ── Aegis v2 "Drafting Room" Button ───────────────────────────────────────
// Primary: gold gradient + navy-deep text + signal bloom + light-band sweep
// Ghost:   transparent + 1px border + signal hover
// Danger:  ember gradient
// ─────────────────────────────────────────────────────────────────────────

export type ButtonVariant =
  | 'primary'
  | 'ghost'
  | 'danger'
  | 'secondary'
  // Legacy aliases (retained to avoid breaking existing callers)
  | 'accent'
  | 'outline'
  | 'success'
  | 'navy-outline'
export type ButtonSize = 'sm' | 'md' | 'lg' | 'xs' | 'xl'

// Map legacy variants to new canonical names
const VARIANT_ALIAS: Record<ButtonVariant, 'primary' | 'ghost' | 'danger' | 'secondary'> = {
  primary: 'primary',
  ghost: 'ghost',
  danger: 'danger',
  secondary: 'secondary',
  accent: 'primary',
  outline: 'ghost',
  success: 'primary',
  'navy-outline': 'ghost',
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  loading?: boolean
  /** Leading icon */
  icon?: ReactNode
  /** Trailing icon */
  iconRight?: ReactNode
  /** Icon-only button: square, same width = height */
  iconOnly?: boolean
  fullWidth?: boolean
}

const sizes: Record<ButtonSize, string> = {
  xs: 'h-7 px-2.5 text-[11.5px] gap-1',
  sm: 'h-8 px-3 text-[12.5px] gap-1.5',
  md: 'h-10 px-4 text-[13px] gap-2',
  lg: 'h-12 px-5 text-[14px] gap-2.5',
  xl: 'h-14 px-6 text-[15px] gap-3',
}

const iconOnlySizes: Record<ButtonSize, string> = {
  xs: 'h-7 w-7',
  sm: 'h-8 w-8',
  md: 'h-10 w-10',
  lg: 'h-12 w-12',
  xl: 'h-14 w-14',
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'primary',
    size = 'md',
    loading = false,
    icon,
    iconRight,
    iconOnly = false,
    fullWidth = false,
    disabled,
    className,
    children,
    ...props
  },
  ref,
) {
  const isDisabled = disabled || loading
  const resolvedVariant = VARIANT_ALIAS[variant] ?? 'primary'

  return (
    <button
      ref={ref}
      disabled={isDisabled}
      data-variant={resolvedVariant}
      className={cn(
        'aegis-btn',
        `aegis-btn--${resolvedVariant}`,
        iconOnly ? iconOnlySizes[size] : sizes[size],
        fullWidth && 'w-full',
        className,
      )}
      {...props}
    >
      {loading ? (
        <svg
          className="animate-spin h-4 w-4 shrink-0"
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
          <path
            d="M22 12a10 10 0 01-10 10"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
          />
        </svg>
      ) : (
        icon && <span className="aegis-btn__icon shrink-0" aria-hidden="true">{icon}</span>
      )}
      {children && <span className="aegis-btn__label">{children}</span>}
      {iconRight && !loading && (
        <span className="aegis-btn__icon shrink-0" aria-hidden="true">{iconRight}</span>
      )}

      {/* Inline styles — Drafting Room gold gradient + light-band sweep */}
      <style jsx>{`
        .aegis-btn {
          position: relative;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          font-family: var(--font-sans, system-ui);
          font-weight: 600;
          letter-spacing: -0.005em;
          border-radius: var(--radius-md);
          border: 1px solid transparent;
          cursor: pointer;
          user-select: none;
          white-space: nowrap;
          overflow: hidden;
          transition:
            transform 180ms var(--ease),
            box-shadow 180ms var(--ease),
            background-color 180ms var(--ease),
            border-color 180ms var(--ease),
            color 180ms var(--ease),
            opacity 180ms var(--ease);
          outline: none;
        }
        .aegis-btn:focus-visible {
          outline: 2px solid var(--signal);
          outline-offset: 2px;
        }
        .aegis-btn:disabled {
          opacity: 0.4;
          cursor: not-allowed;
          pointer-events: none;
        }
        .aegis-btn:active:not(:disabled) {
          transform: translateY(0) scale(0.98);
          transition-timing-function: var(--ease-press);
        }

        /* ── Primary: 4-stop glass gradient + white text + bloom ──────── */
        .aegis-btn--primary {
          background: var(--grad, linear-gradient(135deg, var(--c1), var(--c2), var(--c3)));
          color: #fff;
          box-shadow:
            0 1px 3px rgba(0, 0, 0, 0.25),
            0 0 16px color-mix(in srgb, var(--c1) 25%, transparent);
        }
        .aegis-btn--primary:hover:not(:disabled) {
          transform: translateY(-1px);
          box-shadow:
            0 2px 6px rgba(0, 0, 0, 0.3),
            0 0 24px color-mix(in srgb, var(--c1) 35%, transparent);
        }
        /* Light-band sweep on hover */
        .aegis-btn--primary::before {
          content: '';
          position: absolute;
          top: 0;
          left: -40%;
          width: 40%;
          height: 100%;
          background: linear-gradient(
            100deg,
            transparent 0%,
            rgba(255, 255, 255, 0.15) 50%,
            transparent 100%
          );
          pointer-events: none;
          transform: translateX(0);
          transition: transform 600ms var(--ease);
        }
        .aegis-btn--primary:hover::before {
          transform: translateX(350%);
        }

        /* ── Ghost ─────────────────────────────────────────────────────── */
        .aegis-btn--ghost {
          background: transparent;
          color: var(--fg);
          border-color: var(--border-strong);
        }
        .aegis-btn--ghost:hover:not(:disabled) {
          background: var(--signal-subtle);
          border-color: var(--signal);
          color: var(--fg);
        }
        .aegis-btn--ghost:active:not(:disabled) {
          background: var(--signal-glow);
        }

        /* ── Secondary (legacy-adjacent, subdued) ──────────────────────── */
        .aegis-btn--secondary {
          background: var(--surface);
          color: var(--fg);
          border-color: var(--border-strong);
        }
        .aegis-btn--secondary:hover:not(:disabled) {
          background: var(--surface-muted);
          border-color: var(--fg-muted);
        }

        /* ── Danger: ember gradient ────────────────────────────────────── */
        .aegis-btn--danger {
          background: linear-gradient(3deg, #c6604f, #9b3826);
          color: #fff;
          box-shadow:
            0 1px 3px rgba(0, 0, 0, 0.3),
            0 0 16px rgba(182, 78, 61, 0.18);
        }
        .aegis-btn--danger:hover:not(:disabled) {
          transform: translateY(-1px);
          filter: brightness(1.1);
          box-shadow:
            0 2px 4px rgba(0, 0, 0, 0.3),
            0 0 20px rgba(182, 78, 61, 0.28);
        }

        @media (prefers-reduced-motion: reduce) {
          .aegis-btn,
          .aegis-btn::before {
            transition-duration: 120ms !important;
          }
          .aegis-btn:hover {
            transform: none !important;
          }
          .aegis-btn--primary::before {
            display: none;
          }
        }
      `}</style>
    </button>
  )
})

export { Button }
export default Button
