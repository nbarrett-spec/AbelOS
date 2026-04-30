/**
 * Builder Portal — base card wrapper.
 *
 * §2 Card System. Used by section panels (recent orders, activity, charts).
 * Server-renderable (no client hooks).
 */

import type { ReactNode } from 'react'

interface PortalCardProps {
  title?: string
  /** Right-aligned action slot inside the header (e.g. "View all" link). */
  action?: ReactNode
  /** Optional descriptor under the title. */
  subtitle?: string
  children: ReactNode
  className?: string
  /** When true, removes the default body padding (useful for full-bleed tables). */
  noBodyPadding?: boolean
}

export function PortalCard({
  title,
  action,
  subtitle,
  children,
  className,
  noBodyPadding = false,
}: PortalCardProps) {
  return (
    <div
      className={`rounded-[14px] transition-shadow ${className || ''}`}
      style={{
        background: 'var(--portal-bg-card, #FFFFFF)',
        border: '1px solid var(--portal-border-light, #F0E8DA)',
        boxShadow: 'var(--shadow-sm)',
      }}
    >
      {(title || action) && (
        <div className="flex items-start justify-between px-6 pt-5 pb-3 gap-3">
          <div className="min-w-0">
            {title && (
              <h3
                className="text-[1.05rem] font-medium truncate"
                style={{
                  fontFamily: 'var(--font-portal-display, Georgia)',
                  color: 'var(--portal-text-strong, #3E2A1E)',
                  letterSpacing: '-0.01em',
                }}
              >
                {title}
              </h3>
            )}
            {subtitle && (
              <p
                className="text-xs mt-0.5"
                style={{ color: 'var(--portal-text-muted, #6B6056)' }}
              >
                {subtitle}
              </p>
            )}
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </div>
      )}
      <div className={noBodyPadding ? '' : 'px-6 pb-6 pt-1'}>{children}</div>
    </div>
  )
}
