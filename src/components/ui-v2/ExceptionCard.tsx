import { type ReactNode } from 'react'
import { ArrowRight } from 'lucide-react'

export type ExceptionTone = 'neutral' | 'negative' | 'warning' | 'info'

/**
 * ExceptionCard — Aegis's signature anomaly surface.
 * Wraps an anomaly (late delivery / overdue invoice / unapproved PO /
 * redlined takeoff) with: WHY, WHEN, NEXT ACTION. Never a red row.
 * See AEGIS_DESIGN_SYSTEM.md §5.4 and §16.1.
 */
export function ExceptionCard({
  glyph,
  title,
  why,
  meta,
  tone = 'neutral',
  actionLabel,
  onAction,
  actionHref,
  secondaryLabel,
  onSecondary,
  className = '',
}: {
  glyph: ReactNode
  title: ReactNode
  why: ReactNode
  meta?: Array<{ label: string; value: ReactNode }>
  tone?: ExceptionTone
  actionLabel?: string
  onAction?: () => void
  actionHref?: string
  secondaryLabel?: string
  onSecondary?: () => void
  className?: string
}) {
  const toneClass = tone === 'neutral' ? '' : `v4-exception--${tone}`

  const PrimaryTag: any = actionHref ? 'a' : 'button'
  return (
    <div className={`v4-exception ${toneClass} ${className}`}>
      <div className="v4-exception__glyph" aria-hidden>
        {glyph}
      </div>
      <div>
        <div className="v4-exception__title">{title}</div>
        <div className="v4-exception__why">{why}</div>
        {meta && meta.length > 0 && (
          <div className="v4-exception__meta">
            {meta.map((m, i) => (
              <span key={i}>
                <strong>{m.label}</strong> {m.value}
              </span>
            ))}
          </div>
        )}
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
        {secondaryLabel && (
          <button
            type="button"
            className="v4-btn v4-btn--ghost v4-btn--sm"
            onClick={onSecondary}
          >
            {secondaryLabel}
          </button>
        )}
        {actionLabel && (
          <PrimaryTag
            className="v4-btn v4-btn--primary v4-btn--sm"
            {...(actionHref ? { href: actionHref } : { type: 'button', onClick: onAction })}
          >
            {actionLabel}
            <ArrowRight size={13} />
          </PrimaryTag>
        )}
      </div>
    </div>
  )
}

export default ExceptionCard
