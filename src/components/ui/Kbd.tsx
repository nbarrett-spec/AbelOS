'use client'

import { type HTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

// ── Aegis v2 "Drafting Room" Kbd ─────────────────────────────────────────
// Small monospace pressable chip used across cmd palette, shortcut hints.
// ─────────────────────────────────────────────────────────────────────────

export interface KbdProps extends HTMLAttributes<HTMLSpanElement> {
  size?: 'xs' | 'sm' | 'md'
}

const sizes = {
  xs: 'h-[18px] min-w-[18px] text-[10px] px-1',
  sm: 'h-[20px] min-w-[20px] text-[10.5px] px-1.5',
  md: 'h-[22px] min-w-[22px] text-[11px] px-1.5',
}

export function Kbd({ size = 'sm', className, children, ...props }: KbdProps) {
  return (
    <kbd
      {...props}
      className={cn(
        'inline-flex items-center justify-center rounded-[4px]',
        'font-mono font-medium text-fg-muted',
        'bg-surface-elev border border-border',
        // Inset pressable shadow
        'shadow-[inset_0_-1px_0_var(--border)]',
        sizes[size],
        className,
      )}
      style={{
        background: 'var(--bg-raised, var(--surface-elevated))',
        padding: '2px 6px',
        ...(props.style ?? {}),
      }}
    >
      {children}
    </kbd>
  )
}

export default Kbd
