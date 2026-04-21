'use client'

import {
  forwardRef,
  useId,
  useState,
  type InputHTMLAttributes,
  type ReactNode,
} from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { cn } from '@/lib/utils'

// ── Aegis v2 "Drafting Room" Input ───────────────────────────────────────
// 40px default, 1px hairline, gold focus ring + bloom, floating label,
// trailing slot for unit/kbd, error = ember ring.
// ─────────────────────────────────────────────────────────────────────────

export interface InputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  label?: string
  hint?: string
  error?: string
  size?: 'sm' | 'md' | 'lg'
  /** Leading icon (left side) */
  icon?: ReactNode
  /** Trailing icon (right side) */
  iconRight?: ReactNode
  /** Trailing slot for unit ("sq ft", "$") or keyboard shortcut */
  trailing?: ReactNode
  /** Use floating label animation (default true when `label` is provided) */
  floating?: boolean
  fullWidth?: boolean
}

const HEIGHTS: Record<NonNullable<InputProps['size']>, string> = {
  sm: 'h-8 text-[12.5px]',
  md: 'h-10 text-[13px]',
  lg: 'h-12 text-[14px]',
}

const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  {
    label,
    hint,
    error,
    size = 'md',
    icon,
    iconRight,
    trailing,
    floating = true,
    fullWidth = true,
    type,
    className,
    id,
    placeholder,
    onFocus,
    onBlur,
    onChange,
    value,
    defaultValue,
    disabled,
    ...props
  },
  ref,
) {
  const reactId = useId()
  const inputId = id ?? `input-${reactId.replace(/:/g, '')}`
  const [showPassword, setShowPassword] = useState(false)
  const [isFocused, setIsFocused] = useState(false)
  const [hasValue, setHasValue] = useState(() => {
    if (value != null && value !== '') return true
    if (defaultValue != null && defaultValue !== '') return true
    return false
  })

  const isPassword = type === 'password'
  const resolvedType = isPassword && showPassword ? 'text' : type
  const hasFloatingLabel = floating && !!label
  const labelFloated = isFocused || hasValue

  return (
    <div
      className={cn(
        'aegis-field',
        fullWidth ? 'w-full' : 'inline-flex flex-col',
        disabled && 'opacity-60',
      )}
    >
      {/* Static label (non-floating) */}
      {label && !hasFloatingLabel && (
        <label
          htmlFor={inputId}
          className="block text-[12px] font-medium text-fg-muted mb-1.5"
        >
          {label}
        </label>
      )}

      <div
        className={cn(
          'aegis-field__shell relative flex items-stretch',
          HEIGHTS[size],
        )}
        data-focused={isFocused || undefined}
        data-error={!!error || undefined}
        data-disabled={disabled || undefined}
      >
        {icon && (
          <span className="aegis-field__icon pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-fg-subtle">
            {icon}
          </span>
        )}

        {hasFloatingLabel && (
          <label
            htmlFor={inputId}
            className={cn('aegis-field__floating', labelFloated && 'is-floated')}
            style={{ left: icon ? 36 : 12 }}
          >
            {label}
          </label>
        )}

        <input
          {...props}
          ref={ref}
          id={inputId}
          type={resolvedType}
          value={value}
          defaultValue={defaultValue}
          disabled={disabled}
          placeholder={hasFloatingLabel && !labelFloated ? undefined : placeholder}
          onFocus={(e) => {
            setIsFocused(true)
            onFocus?.(e)
          }}
          onBlur={(e) => {
            setIsFocused(false)
            setHasValue(!!e.target.value)
            onBlur?.(e)
          }}
          onChange={(e) => {
            setHasValue(!!e.target.value)
            onChange?.(e)
          }}
          aria-invalid={!!error || undefined}
          aria-describedby={
            error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined
          }
          className={cn(
            'aegis-field__input flex-1 bg-transparent border-0 outline-none',
            'text-fg placeholder:text-fg-subtle',
            'font-sans tabular-nums',
            icon ? 'pl-10' : 'pl-3',
            iconRight || trailing || isPassword ? 'pr-10' : 'pr-3',
            hasFloatingLabel && 'pt-[14px]',
            className,
          )}
        />

        {isPassword && (
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            className="absolute inset-y-0 right-0 flex items-center pr-3 text-fg-subtle hover:text-fg transition-colors"
            tabIndex={-1}
            aria-label={showPassword ? 'Hide password' : 'Show password'}
          >
            {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        )}
        {!isPassword && trailing && (
          <span className="aegis-field__trailing absolute inset-y-0 right-0 flex items-center pr-3 text-fg-subtle text-[11px] font-mono">
            {trailing}
          </span>
        )}
        {!isPassword && !trailing && iconRight && (
          <span className="absolute inset-y-0 right-0 flex items-center pr-3 text-fg-subtle">
            {iconRight}
          </span>
        )}
      </div>

      {error && (
        <p
          id={`${inputId}-error`}
          className="mt-1.5 text-[11.5px] text-data-negative-fg"
          style={{ color: 'var(--ember)' }}
        >
          {error}
        </p>
      )}
      {hint && !error && (
        <p id={`${inputId}-hint`} className="mt-1.5 text-[11.5px] text-fg-subtle">
          {hint}
        </p>
      )}

      <style jsx>{`
        .aegis-field__shell {
          background: var(--bg-surface, var(--surface));
          border: 1px solid var(--border);
          border-radius: var(--radius-md);
          transition:
            border-color 180ms var(--ease),
            box-shadow 180ms var(--ease);
        }
        /* Subtle gold-tinted grain */
        .aegis-field__shell::before {
          content: '';
          position: absolute;
          inset: 0;
          border-radius: var(--radius-md);
          pointer-events: none;
          opacity: 0.04;
          mix-blend-mode: overlay;
          background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='g'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' seed='4' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0.9 0.1 0 0 0.05 0.1 0.85 0.05 0 0.02 0 0.05 0.6 0 0 0 0 0 0.5 0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23g)'/%3E%3C/svg%3E");
        }
        .aegis-field__shell[data-focused='true'] {
          border-color: var(--signal);
          box-shadow:
            0 0 0 1.5px var(--signal),
            0 0 8px var(--signal-subtle);
        }
        .aegis-field__shell[data-error='true'] {
          border-color: var(--ember, #b64e3d);
          box-shadow: 0 0 0 1.5px var(--ember, #b64e3d);
        }
        .aegis-field__shell[data-disabled='true'] {
          cursor: not-allowed;
          opacity: 0.6;
        }

        .aegis-field__input {
          font-family: var(--font-sans);
          width: 100%;
          height: 100%;
          outline: none;
        }

        .aegis-field__floating {
          position: absolute;
          top: 50%;
          transform: translateY(-50%);
          font-size: 13px;
          color: var(--fg-subtle);
          pointer-events: none;
          transition: all 180ms var(--ease);
          transform-origin: left center;
          line-height: 1;
          background: transparent;
        }
        .aegis-field__floating.is-floated {
          top: 8px;
          transform: translateY(0) scale(0.8);
          color: var(--fg-muted);
        }
        .aegis-field__shell[data-focused='true'] .aegis-field__floating {
          color: var(--signal);
        }
        .aegis-field__shell[data-error='true'] .aegis-field__floating {
          color: var(--ember, #b64e3d);
        }

        @media (prefers-reduced-motion: reduce) {
          .aegis-field__shell,
          .aegis-field__floating {
            transition-duration: 120ms !important;
          }
        }
      `}</style>
    </div>
  )
})

export { Input }
export default Input
