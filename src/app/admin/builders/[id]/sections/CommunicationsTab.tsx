'use client'

// CommunicationsTab — BUG-15. Server filter via /api/ops/communication-logs
// scoped to the current builder. Was previously rendering all comms across
// the entire system because the API call was being made without builderId.
//
// We always pass `?builderId=<id>` here so two different builder profiles
// each see only their own. The API already had that filter; the missing
// piece was actually using it from the page.
//
// Inline expand: clicking a row toggles a body preview underneath. We don't
// drill to a separate detail page — Sarah's BUG-20 wants the body visible
// without an extra navigation step.

import { useEffect, useState } from 'react'
import { Card, CardBody, EmptyState, Badge } from '@/components/ui'
import { ChevronDown, ChevronUp, Mail, Phone, MessageSquare, AlertTriangle, Loader2 } from 'lucide-react'

interface CommLogRow {
  id: string
  channel: string
  direction: string
  subject: string | null
  body: string | null
  fromAddress: string | null
  toAddresses: string[] | null
  sentAt: string | null
  createdAt: string
  status: string
  duration: number | null
  hasAttachments: boolean
  attachmentCount: number | null
  builder?: { id: string; companyName: string; contactName: string } | null
}

function formatTs(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function channelIcon(channel: string) {
  switch (channel) {
    case 'EMAIL':
      return <Mail className="w-3.5 h-3.5" />
    case 'CALL':
    case 'PHONE':
      return <Phone className="w-3.5 h-3.5" />
    case 'SMS':
    case 'TEXT':
      return <MessageSquare className="w-3.5 h-3.5" />
    default:
      return <Mail className="w-3.5 h-3.5" />
  }
}

export default function CommunicationsTab({
  builderId,
}: {
  builderId: string
}) {
  const [logs, setLogs] = useState<CommLogRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      setLoading(true)
      setError(null)
      try {
        const res = await fetch(
          `/api/ops/communication-logs?builderId=${encodeURIComponent(
            builderId,
          )}&limit=100`,
        )
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          throw new Error(body.error || `HTTP ${res.status}`)
        }
        const data = await res.json()
        if (cancelled) return
        setLogs(data.logs || [])
      } catch (e: any) {
        if (!cancelled) setError(e?.message || 'Failed to load communications')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [builderId])

  return (
    <Card>
      <CardBody>
        <div className="flex items-center justify-between mb-3">
          <div>
            <div className="text-xs uppercase tracking-wide text-fg-muted">
              Communications
            </div>
            <div className="text-lg font-semibold text-fg">
              {loading ? '…' : `${logs.length} logged`}
            </div>
          </div>
        </div>

        {error && (
          <div className="flex items-start gap-2 px-3 py-2 rounded-md bg-data-negative-bg text-xs text-data-negative mb-3">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-fg-muted py-6 justify-center">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading…
          </div>
        ) : logs.length === 0 ? (
          <EmptyState
            title="No communications on file"
            description="Email, calls, and SMS logged for this builder will appear here."
          />
        ) : (
          <ul className="divide-y divide-border">
            {logs.map((log) => {
              const isExpanded = expanded === log.id
              const ts = log.sentAt || log.createdAt
              return (
                <li key={log.id} className="py-2">
                  <button
                    type="button"
                    onClick={() =>
                      setExpanded(isExpanded ? null : log.id)
                    }
                    className="w-full flex items-start gap-3 text-left hover:bg-row-hover -mx-2 px-2 py-1.5 rounded transition-colors"
                  >
                    <span
                      className="inline-flex items-center justify-center w-7 h-7 rounded-md text-fg-muted shrink-0 mt-0.5"
                      style={{
                        background: 'color-mix(in srgb, var(--brand) 8%, transparent)',
                      }}
                      aria-hidden
                    >
                      {channelIcon(log.channel)}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <Badge variant="neutral" size="sm">
                          {log.channel}
                        </Badge>
                        <Badge
                          variant={
                            log.direction === 'OUTBOUND' ? 'info' : 'brand'
                          }
                          size="sm"
                        >
                          {log.direction}
                        </Badge>
                        {log.hasAttachments && (
                          <span className="text-[11px] text-fg-muted">
                            {log.attachmentCount || 0} attachment
                            {(log.attachmentCount || 0) === 1 ? '' : 's'}
                          </span>
                        )}
                      </div>
                      <div className="text-sm text-fg truncate mt-0.5">
                        {log.subject || '(no subject)'}
                      </div>
                      <div className="text-xs text-fg-muted truncate">
                        {log.fromAddress || '—'}
                        {log.toAddresses && log.toAddresses.length > 0
                          ? ` → ${log.toAddresses.slice(0, 2).join(', ')}`
                          : ''}
                      </div>
                    </div>
                    <div className="text-xs text-fg-muted whitespace-nowrap shrink-0">
                      {formatTs(ts)}
                    </div>
                    {isExpanded ? (
                      <ChevronUp className="w-4 h-4 text-fg-muted shrink-0 mt-1" />
                    ) : (
                      <ChevronDown className="w-4 h-4 text-fg-muted shrink-0 mt-1" />
                    )}
                  </button>
                  {isExpanded && (
                    <div className="ml-10 mt-1 mb-2 px-3 py-2 rounded-md bg-surface-muted text-sm whitespace-pre-wrap text-fg">
                      {log.body || (
                        <span className="text-fg-muted italic">
                          No body captured for this entry.
                        </span>
                      )}
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </CardBody>
    </Card>
  )
}
