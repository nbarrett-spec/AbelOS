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
    // Mockup-3 .glass-card pattern — semi-transparent white + 24px blur
    // + saturate + indigo-tinted border + glass-shadow that lifts on hover.
    <div
      className={`portal-glass-card rounded-[14px] ${className || ''}`}
      style={{
        background: 'var(--glass)',
        backdropFilter: 'var(--glass-blur)',
        WebkitBackdropFilter: 'var(--glass-blur)',
        border: '1px solid var(--glass-border)',
        boxShadow: 'var(--glass-shadow)',
        transition: 'transform 250ms var(--ease-out), box-shadow 250ms var(--ease-out)',
      }}
    >
      {(title || action) && (
        <div className="flex items-start justify-between px-6 pt-5 pb-3 gap-3">
          <div className="min-w-0">
            {title && (
              <h3
                className="text-[20px] truncate"
                style={{
                  fontFamily: 'var(--font-portal-display)',
                  color: 'var(--portal-text-strong)',
                  letterSpacing: '-0.015em',
                  fontWeight: 400,
                  lineHeight: 1.2,
                }}
              >
                {title}
              </h3>
            )}
            {subtitle && (
              <p
                className="text-[11px] uppercase mt-1"
                style={{
                  fontFamily: 'var(--font-portal-mono)',
                  color: 'var(--portal-text-subtle)',
                  letterSpacing: '0.1em',
                }}
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
