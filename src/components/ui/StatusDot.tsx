'use client'

import { type HTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

// ── Aegis v2 "Drafting Room" StatusDot ───────────────────────────────────
// 6px circle; pulse animates ONLY when status === 'live'.
// ─────────────────────────────────────────────────────────────────────────

export type StatusDotTone =
  | 'active'   // gold
  | 'success'  // sage
  | 'alert'    // ember
  | 'info'     // sky
  | 'offline'  // fg-subtle
  | 'live'     // gold, pulsing

export interface StatusDotProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: StatusDotTone
  size?: number
  /** Accessible label */
  label?: string
}

const TONE_COLOR: Record<StatusDotTone, string> = {
  active: 'var(--signal, var(--gold))',
  success: 'var(--sage, #5caa68)',
  alert: 'var(--ember, #b64e3d)',
  info: 'var(--sky, #8CA8B8)',
  offline: 'var(--fg-subtle, #6b7280)',
  live: 'var(--signal, var(--gold))',
}

export function StatusDot({
  tone = 'active',
  size = 6,
  label,
  className,
  ...props
}: StatusDotProps) {
  const color = TONE_COLOR[tone]
  const isLive = tone === 'live'
  return (
    <span
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={!label || undefined}
      {...props}
      className={cn('relative inline-flex shrink-0', className)}
      style={{ width: size, height: size, ...(props.style ?? {}) }}
    >
      <span
        className="relative inline-block rounded-full"
        style={{
          width: size,
          height: size,
          background: color,
          boxShadow: isLive ? `0 0 6px ${color}` : undefined,
        }}
      />
      {isLive && (
        <span
          aria-hidden
          className="absolute inset-0 rounded-full"
          style={{
            background: color,
            animation: 'aegis-pulse 1.6s cubic-bezier(.2,.8,.2,1) infinite',
          }}
        />
      )}
      <style jsx>{`
        @keyframes aegis-pulse {
          0%   { transform: scale(1);   opacity: 0.55; }
          80%  { transform: scale(2.4); opacity: 0; }
          100% { transform: scale(2.4); opacity: 0; }
        }
        @media (prefers-reduced-motion: reduce) {
          span { animation: none !important; }
        }
      `}</style>
    </span>
  )
}

export default StatusDot
