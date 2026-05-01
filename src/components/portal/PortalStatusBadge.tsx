/**
 * Status badge for portal order statuses.
 *
 * Mockup-3 .jc-status pattern — Azeret Mono uppercase pill with a 6px
 * status dot that pulses ("pulse-live" 2s ease-in-out infinite). Single
 * source of truth for the colored pill we render across the orders list,
 * order detail header, recent-orders table, and dashboard activity feed.
 *
 * Color scheme: green = on-track, amber = at-risk, red = blocked, neutral
 * = informational. Reduces the v1 walnut/sky palette to the four canonical
 * Mockup-3 statuses for visual consistency.
 */

import type { PortalOrderStatus } from '@/types/portal'

type Tone = 'green' | 'amber' | 'red' | 'neutral'

const TONE_STYLE: Record<
  Tone,
  { bg: string; fg: string; dotBg: string }
> = {
  green: {
    bg: 'var(--data-positive-bg)',
    fg: 'var(--data-positive)',
    dotBg: 'var(--data-positive)',
  },
  amber: {
    bg: 'var(--data-warning-bg)',
    fg: 'var(--data-warning)',
    dotBg: 'var(--data-warning)',
  },
  red: {
    bg: 'var(--data-negative-bg)',
    fg: 'var(--data-negative)',
    dotBg: 'var(--data-negative)',
  },
  neutral: {
    bg: 'rgba(79, 70, 229, 0.08)',
    fg: 'var(--c1)',
    dotBg: 'var(--c1)',
  },
}

interface BadgeMeta {
  tone: Tone
  label: string
}

const STATUS_TO_TONE: Record<PortalOrderStatus | string, BadgeMeta> = {
  DRAFT:           { tone: 'neutral', label: 'Draft' },
  CONFIRMED:       { tone: 'amber',   label: 'Confirmed' },
  IN_PRODUCTION:   { tone: 'amber',   label: 'In Production' },
  SHIPPED:         { tone: 'amber',   label: 'Shipped' },
  DELIVERED:       { tone: 'green',   label: 'Delivered' },
  CANCELLED:       { tone: 'red',     label: 'Cancelled' },
  ON_HOLD:         { tone: 'red',     label: 'On Hold' },
  RECEIVED:        { tone: 'neutral', label: 'Received' },
  PARTIAL_SHIPPED: { tone: 'amber',   label: 'Partial' },
}

/** Legacy shape exported for components that still reach in by status key
 *  to grab raw bg/fg values. Computed from the unified tone map so
 *  changes here propagate everywhere. */
export const PORTAL_STATUS_BADGE: Record<
  PortalOrderStatus | string,
  { bg: string; fg: string; label: string }
> = Object.fromEntries(
  Object.entries(STATUS_TO_TONE).map(([k, meta]) => {
    const t = TONE_STYLE[meta.tone]
    return [k, { bg: t.bg, fg: t.fg, label: meta.label }]
  }),
) as Record<PortalOrderStatus | string, { bg: string; fg: string; label: string }>

interface PortalStatusBadgeProps {
  status: string
  size?: 'sm' | 'md'
  className?: string
}

export function PortalStatusBadge({
  status,
  size = 'sm',
  className,
}: PortalStatusBadgeProps) {
  const meta =
    STATUS_TO_TONE[status] ||
    STATUS_TO_TONE.DRAFT
  const tone = TONE_STYLE[meta.tone]
  const padding =
    size === 'md'
      ? 'px-3 py-1 text-[12px] gap-2'
      : 'px-2.5 py-[3px] text-[11px] gap-1.5'

  return (
    <span
      className={`inline-flex items-center rounded-full uppercase ${padding}${
        className ? ` ${className}` : ''
      }`}
      style={{
        background: tone.bg,
        color: tone.fg,
        fontFamily: 'var(--font-portal-mono)',
        fontWeight: 600,
        letterSpacing: '0.12em',
      }}
    >
      <span
        aria-hidden="true"
        className="rounded-full"
        style={{
          width: 6,
          height: 6,
          background: tone.dotBg,
          // Mockup-3 pulse-live keyframe lives in globals.css under
          // [data-portal] (defined as @keyframes portal-pulse-live).
          animation: 'portal-pulse-live 2s ease-in-out infinite',
        }}
      />
      {meta.label}
    </span>
  )
}
