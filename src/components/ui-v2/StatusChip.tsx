import { type ReactNode } from 'react'

export type StatusTone = 'neutral' | 'positive' | 'negative' | 'warning' | 'info' | 'brand'

/**
 * StatusChip — monospace caps chip with a leading semantic dot.
 * 8 status vocabularies across PO / Delivery / Invoice / etc.
 * See AEGIS_DESIGN_SYSTEM.md §5.4 (v4-chip).
 */
export function StatusChip({
  children,
  tone = 'neutral',
  className = '',
}: {
  children: ReactNode
  tone?: StatusTone
  className?: string
}) {
  const toneClass = tone === 'neutral' ? '' : `v4-chip--${tone}`
  return <span className={`v4-chip ${toneClass} ${className}`}>{children}</span>
}

/**
 * Convenience mappers — keep semantic domain vocabularies in one place.
 * Replace fragile string-matching across the codebase.
 */
export const PO_STATUS: Record<string, StatusTone> = {
  DRAFT: 'neutral',
  OPEN: 'info',
  APPROVED: 'positive',
  SHIPPED: 'info',
  DELIVERED: 'positive',
  CANCELLED: 'negative',
  ON_HOLD: 'warning',
}

export const DELIVERY_STATUS: Record<string, StatusTone> = {
  SCHEDULED: 'info',
  IN_TRANSIT: 'info',
  OUT_FOR_DELIVERY: 'brand',
  DELIVERED: 'positive',
  DELAYED: 'warning',
  FAILED: 'negative',
}

export const INVOICE_STATUS: Record<string, StatusTone> = {
  DRAFT: 'neutral',
  SENT: 'info',
  PAID: 'positive',
  PARTIAL: 'warning',
  OVERDUE: 'negative',
  DISPUTED: 'warning',
}

export default StatusChip
