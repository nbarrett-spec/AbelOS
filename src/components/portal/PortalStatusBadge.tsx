/**
 * Status badge for portal order statuses.
 *
 * Single source of truth for the colored pill we render for an order's
 * lifecycle stage. Lives here (not inline in DashboardClient) so the orders
 * list, order detail header, and recent-orders table all share one mapping.
 */

import type { PortalOrderStatus } from '@/types/portal'

export const PORTAL_STATUS_BADGE: Record<
  PortalOrderStatus | string,
  { bg: string; fg: string; label: string }
> = {
  DRAFT:         { bg: 'rgba(107,96,86,0.12)', fg: '#5A4F46', label: 'Draft' },
  CONFIRMED:     { bg: 'rgba(201,130,43,0.14)', fg: '#7A4E0F', label: 'Confirmed' },
  IN_PRODUCTION: { bg: 'rgba(140,168,184,0.16)', fg: '#3D5A6A', label: 'In Production' },
  SHIPPED:       { bg: 'rgba(140,168,184,0.16)', fg: '#3D5A6A', label: 'Shipped' },
  DELIVERED:     { bg: 'rgba(56,128,77,0.12)', fg: '#1A4B21', label: 'Delivered' },
  CANCELLED:     { bg: 'rgba(110,42,36,0.10)', fg: '#7E2417', label: 'Cancelled' },
  ON_HOLD:       { bg: 'rgba(212,165,74,0.16)', fg: '#7A5413', label: 'On Hold' },
  // Platform statuses the orders endpoint may pass through unchanged.
  RECEIVED:        { bg: 'rgba(140,168,184,0.16)', fg: '#3D5A6A', label: 'Received' },
  PARTIAL_SHIPPED: { bg: 'rgba(140,168,184,0.16)', fg: '#3D5A6A', label: 'Partial' },
}

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
  const badge = PORTAL_STATUS_BADGE[status] || PORTAL_STATUS_BADGE.DRAFT
  const dims =
    size === 'md'
      ? 'px-2.5 py-1 text-[12px]'
      : 'px-2 py-0.5 text-[11px]'
  return (
    <span
      className={`inline-flex items-center rounded-full font-medium ${dims}${
        className ? ` ${className}` : ''
      }`}
      style={{ background: badge.bg, color: badge.fg }}
    >
      {badge.label}
    </span>
  )
}
