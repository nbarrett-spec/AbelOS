// Re-export from utils and add additional formatting utilities
export { formatCurrency, formatDate } from './utils'

export function getTimeAgo(date: Date | string): string {
  const now = new Date()
  const dateObj = typeof date === 'string' ? new Date(date) : date
  const seconds = Math.floor((now.getTime() - dateObj.getTime()) / 1000)

  if (seconds < 60) return 'just now'
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`
  if (seconds < 2592000) return `${Math.floor(seconds / 604800)}w ago`

  return dateObj.toLocaleDateString()
}

export function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`
}

/**
 * Safely format a person's full name from a possibly-null Staff/Contact relation.
 * Handles SetNull foreign keys (e.g. when a Staff record is deleted, the relation
 * becomes null on the parent record). Returns the fallback when the entity is
 * missing or both name fields are empty.
 */
export function fullName(
  s: { firstName?: string | null; lastName?: string | null } | null | undefined,
  fallback = 'Unassigned'
): string {
  if (!s) return fallback
  const name = [s.firstName, s.lastName].filter(Boolean).join(' ').trim()
  return name || fallback
}
