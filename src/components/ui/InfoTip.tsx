'use client'

import { type ReactNode } from 'react'
import { Info } from 'lucide-react'
import { cn } from '@/lib/utils'
import Tooltip from './Tooltip'

// ── Types ─────────────────────────────────────────────────────────────────

export interface InfoTipProps {
  /** The explanation rendered inside the tooltip. */
  children: ReactNode
  /** Optional link URL (shown as 'Learn more →' at the end). */
  href?: string
  /** Small label to prepend, e.g. metric name */
  label?: string
  /** Placement — default 'top'. */
  side?: 'top' | 'bottom' | 'left' | 'right'
  className?: string
}

// ── Component ─────────────────────────────────────────────────────────────

/**
 * InfoTip — tiny `i` icon next to a complex metric label. On hover/focus it
 * shows a short explanation plus optional link. Purely semantic.
 *
 * Example:
 *   <div className="flex items-center gap-1.5">
 *     <span className="eyebrow">DSO</span>
 *     <InfoTip>Days Sales Outstanding — average days to collect AR.</InfoTip>
 *   </div>
 */
export default function InfoTip({ children, href, label, side = 'top', className }: InfoTipProps) {
  const tipContent = (
    <div className="max-w-[260px] space-y-1.5">
      {label && <div className="eyebrow text-[10px] text-fg-subtle">{label}</div>}
      <div className="text-[12px] leading-snug text-fg">{children}</div>
      {href && (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[11px] text-accent hover:underline inline-flex items-center gap-1"
        >
          Learn more →
        </a>
      )}
    </div>
  )

  return (
    <Tooltip content={tipContent} side={side}>
      <button
        type="button"
        tabIndex={0}
        aria-label={label ? `About ${label}` : 'More information'}
        className={cn(
          'inline-flex items-center justify-center w-3.5 h-3.5 rounded-full',
          'text-fg-subtle hover:text-accent transition-colors',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 focus-visible:ring-offset-canvas',
          className,
        )}
      >
        <Info className="w-3.5 h-3.5" />
      </button>
    </Tooltip>
  )
}
