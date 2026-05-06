'use client'

import { useState } from 'react'
import Link from 'next/link'

// ──────────────────────────────────────────────────────────────────────────
// CommunicationLogRow
//
// Drop-in replacement for the inline <li> rows used on the builder profile
// (and other) Communications tabs. Each row:
//   • Click anywhere → expand inline to show full body, addresses,
//     attachments, AI summary, and a "Open in Gmail" link when available.
//   • Click again → collapse.
//
// Mirrors the UX of /ops/communication-log/page.tsx so users see the same
// drill-in pattern wherever a comms list shows up.
//
// BUG-20 (Sarah Knighton, 2026-05-06): rows on the builder profile were
// read-only — you could see a snippet but not the body. The fix is this
// expand-on-click component.
// ──────────────────────────────────────────────────────────────────────────

export interface CommunicationLogEntry {
  id: string
  channel: string
  subject?: string | null
  body?: string | null
  bodyHtml?: string | null
  fromAddress?: string | null
  toAddresses?: string[] | null
  ccAddresses?: string[] | null
  direction: string
  sentAt?: string | null
  createdAt: string
  hasAttachments?: boolean | null
  attachmentCount?: number | null
  aiSummary?: string | null
  gmailMessageId?: string | null
  gmailThreadId?: string | null
  duration?: number | null
  attachments?: Array<{
    id: string
    fileName: string
    fileType?: string | null
    fileSize?: number | null
  }>
}

interface Props {
  log: CommunicationLogEntry
  /**
   * Optional: render the date in the parent's preferred format. If omitted,
   * we use a sensible default ("Mon, May 5").
   */
  formatDate?: (iso: string) => string
}

const DEFAULT_FMT = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })

export function CommunicationLogRow({ log, formatDate = DEFAULT_FMT }: Props) {
  const [expanded, setExpanded] = useState(false)

  const dateIso = log.sentAt || log.createdAt
  const isEmail = log.channel === 'EMAIL'
  const gmailHref = log.gmailThreadId
    ? `https://mail.google.com/mail/u/0/#all/${log.gmailThreadId}`
    : log.gmailMessageId
    ? `https://mail.google.com/mail/u/0/#all/${log.gmailMessageId}`
    : null

  return (
    <li className="panel p-0 overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        aria-controls={`comm-detail-${log.id}`}
        className="w-full text-left p-3 cursor-pointer hover:bg-surface-muted/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal/40 transition-colors"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 mb-0.5 flex-wrap">
              <span className="text-[13px] font-medium text-fg truncate max-w-full">
                {log.subject || (isEmail ? '(no subject)' : log.channel)}
              </span>
              <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-surface-muted text-fg-subtle">
                {log.channel}
              </span>
              <span className="text-[11px] text-fg-subtle">
                {log.direction === 'INBOUND' ? '← Inbound' : log.direction === 'OUTBOUND' ? '→ Outbound' : log.direction}
              </span>
              {log.hasAttachments && (log.attachmentCount ?? 0) > 0 && (
                <span className="text-[10px] text-fg-subtle">
                  📎 {log.attachmentCount}
                </span>
              )}
            </div>
            {log.body && !expanded && (
              <p className="text-[12px] text-fg-muted line-clamp-2">{log.body}</p>
            )}
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <span className="text-[11px] text-fg-subtle whitespace-nowrap">
              {formatDate(dateIso)}
            </span>
            <span
              className={`text-fg-subtle text-[11px] transition-transform ${expanded ? 'rotate-180' : ''}`}
              aria-hidden
            >
              ▾
            </span>
          </div>
        </div>
      </button>

      {/* Expanded detail */}
      <div
        id={`comm-detail-${log.id}`}
        className="grid motion-safe:transition-[grid-template-rows] motion-safe:duration-200 motion-safe:ease-out"
        style={{ gridTemplateRows: expanded ? '1fr' : '0fr' }}
      >
        <div className="overflow-hidden min-h-0">
          <div className="px-4 pb-4 pt-0 border-t border-border">
            <dl className="grid grid-cols-1 sm:grid-cols-[6rem_1fr] gap-x-3 gap-y-1 text-[12px] mt-3 mb-3">
              {log.fromAddress && (
                <>
                  <dt className="text-fg-subtle font-medium">From</dt>
                  <dd className="text-fg-muted truncate">{log.fromAddress}</dd>
                </>
              )}
              {log.toAddresses && log.toAddresses.length > 0 && (
                <>
                  <dt className="text-fg-subtle font-medium">To</dt>
                  <dd className="text-fg-muted truncate">{log.toAddresses.join(', ')}</dd>
                </>
              )}
              {log.ccAddresses && log.ccAddresses.length > 0 && (
                <>
                  <dt className="text-fg-subtle font-medium">Cc</dt>
                  <dd className="text-fg-muted truncate">{log.ccAddresses.join(', ')}</dd>
                </>
              )}
              {typeof log.duration === 'number' && log.duration > 0 && (
                <>
                  <dt className="text-fg-subtle font-medium">Duration</dt>
                  <dd className="text-fg-muted">{log.duration} min</dd>
                </>
              )}
            </dl>

            {log.body ? (
              <div className="text-[13px] text-fg leading-relaxed whitespace-pre-wrap bg-surface-muted/60 rounded-md p-3 max-h-80 overflow-y-auto">
                {log.body}
              </div>
            ) : (
              <p className="text-[12px] text-fg-subtle italic">
                No body stored for this entry.
              </p>
            )}

            {log.aiSummary && (
              <div className="mt-3 rounded-md p-3 text-[12px]" style={{ background: 'var(--data-info-bg, rgba(59,130,246,0.08))' }}>
                <span className="font-semibold mr-1">AI summary:</span>
                <span className="text-fg-muted">{log.aiSummary}</span>
              </div>
            )}

            {log.attachments && log.attachments.length > 0 && (
              <div className="mt-3">
                <p className="text-[11px] font-semibold text-fg-subtle mb-1 uppercase tracking-wider">
                  Attachments
                </p>
                <div className="flex flex-wrap gap-2">
                  {log.attachments.map((att) => (
                    <span
                      key={att.id}
                      className="bg-surface-muted text-fg-muted px-2 py-1 rounded text-[11px]"
                    >
                      📎 {att.fileName}
                      {att.fileSize ? ` (${(att.fileSize / 1024).toFixed(0)} KB)` : ''}
                    </span>
                  ))}
                </div>
              </div>
            )}

            <div className="mt-3 flex items-center gap-3">
              <Link
                href={`/ops/communication-log?builderId=${encodeURIComponent(
                  // Caller may include a builder pointer on the log; we
                  // don't require it. Fallback to no filter.
                  '',
                )}`}
                className="text-[11px] text-signal hover:underline font-medium"
                onClick={(e) => e.stopPropagation()}
              >
                Open in full log →
              </Link>
              {gmailHref && (
                <a
                  href={gmailHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[11px] text-signal hover:underline font-medium"
                  onClick={(e) => e.stopPropagation()}
                >
                  View in Gmail ↗
                </a>
              )}
            </div>
          </div>
        </div>
      </div>
    </li>
  )
}

export default CommunicationLogRow
