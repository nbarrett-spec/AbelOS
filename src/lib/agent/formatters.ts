// ── Shared formatting utilities for agent responses ─────────────────────

export function formatDate(d: string | Date | null): string {
  if (!d) return 'Not set'
  return new Date(d).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

export function formatCurrency(n: number | string): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(n))
}

export function statusEmoji(status: string): string {
  const map: Record<string, string> = {
    SCHEDULED: '\uD83D\uDCC5', LOADING: '\uD83D\uDCE6', IN_TRANSIT: '\uD83D\uDE9A', ARRIVED: '\uD83D\uDCCD',
    UNLOADING: '\u2B07\uFE0F', COMPLETE: '\u2705', RESCHEDULED: '\uD83D\uDD04',
    RECEIVED: '\uD83D\uDCE5', CONFIRMED: '\u2714\uFE0F', IN_PRODUCTION: '\uD83C\uDFED', READY_TO_SHIP: '\uD83D\uDCE6',
    SHIPPED: '\uD83D\uDE9A', DELIVERED: '\u2705', CANCELLED: '\u274C',
    PENDING: '\u23F3', INVOICED: '\uD83D\uDCC4', PAID: '\uD83D\uDCB0', OVERDUE: '\uD83D\uDD34',
    TENTATIVE: '\u2753', FIRM: '\u2705', IN_PROGRESS: '\uD83D\uDD04',
    DRAFT: '\uD83D\uDCDD', ISSUED: '\uD83D\uDCE8', SENT: '\u2709\uFE0F', PARTIALLY_PAID: '\uD83D\uDCB3',
  }
  return map[status] || '\uD83D\uDCCB'
}

/**
 * Strip markdown formatting for SMS/plain text channels.
 */
export function stripMarkdown(text: string): string {
  return text
    .replace(/\*\*(.*?)\*\*/g, '$1')  // bold
    .replace(/\*(.*?)\*/g, '$1')      // italic
    .replace(/\u2022 /g, '- ')        // bullets
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')  // links
    .replace(/\|[^\n]+\|/g, '')       // table rows
    .replace(/\n{3,}/g, '\n\n')       // collapse extra newlines
}

/**
 * Sanitize HTML to prevent XSS in dangerouslySetInnerHTML.
 * Only allows safe formatting tags.
 */
export function sanitizeForDisplay(text: string): string {
  return text
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/&lt;br\/?&gt;/gi, '<br/>')
    .replace(/&lt;strong&gt;(.*?)&lt;\/strong&gt;/gi, '<strong>$1</strong>')
    .replace(/&lt;em&gt;(.*?)&lt;\/em&gt;/gi, '<em>$1</em>')
}

/**
 * Format markdown-like agent response to safe HTML for chat display.
 */
export function formatForChat(text: string): string {
  // First escape any raw HTML
  let safe = text.replace(/</g, '&lt;').replace(/>/g, '&gt;')
  // Then apply markdown formatting
  safe = safe
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/\n/g, '<br/>')
    .replace(/\u2022 /g, '&bull; ')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" style="color:#C9822B;text-decoration:underline" target="_blank" rel="noopener">$1</a>')
  return safe
}
