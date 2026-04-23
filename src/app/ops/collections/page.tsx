'use client'

// ──────────────────────────────────────────────────────────────────────────
// Collections Action Center — /ops/collections
//
// For Dawn: one screen, one question — "what do I need to do right now?".
// Pulls from /api/ops/collections/today, which already decides each row's
// next action (REMINDER, PAST_DUE, FINAL_NOTICE, ACCOUNT_HOLD, or FOLLOW_UP).
// Quick-action buttons POST to /api/ops/collections/[invoiceId]/action and
// reload in place.
// ──────────────────────────────────────────────────────────────────────────

import { useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  Send, Phone, AlertTriangle, Ban, CheckSquare, MessageSquare,
  RefreshCw, Clock, Mail, ExternalLink, Filter,
} from 'lucide-react'
import {
  PageHeader, KPICard, Badge, StatusBadge, Card, CardHeader, CardTitle,
  CardDescription, CardBody, EmptyState, LiveDataIndicator,
} from '@/components/ui'
import { useToast } from '@/contexts/ToastContext'
import { cn } from '@/lib/utils'

interface QueueRow {
  invoice: {
    id: string
    invoiceNumber: string
    total: number
    amountPaid: number
    balanceDue: number
    status: string
    dueDate: string | null
    issuedAt: string | null
    daysPastDue: number
  }
  builder: {
    id: string
    name: string
    contactName: string | null
    email: string | null
    phone: string | null
  }
  nextAction: {
    ruleId: string | null
    ruleName: string
    actionType: string
    channel: string
    triggerDays: number | null
  }
  lastContact: {
    actionType: string
    channel: string
    sentAt: string
    sentBy: string | null
    notes: string | null
  } | null
  priorActionCount: number
  priorActions: Array<{
    id: string
    actionType: string
    channel: string
    sentAt: string
    sentBy: string | null
    notes: string | null
  }>
}

interface QueueData {
  asOf: string
  total: number
  totalOutstanding: number
  queue: QueueRow[]
}

const MONO_STYLE = { fontFamily: '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace' } as const

const fmtMoney = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n)

const fmtMoneyExact = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)

const fmtMoneyCompact = (n: number) => {
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`
  if (Math.abs(n) >= 10_000) return `$${Math.round(n / 1000)}K`
  if (Math.abs(n) >= 1_000) return `$${(n / 1000).toFixed(1)}K`
  return fmtMoney(n)
}

const fmtShortDate = (s: string | null) => {
  if (!s) return '—'
  return new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

const fmtRelative = (s: string | null) => {
  if (!s) return '—'
  const ms = Date.now() - new Date(s).getTime()
  const days = Math.floor(ms / 86_400_000)
  if (days === 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 7) return `${days}d ago`
  if (days < 30) return `${Math.floor(days / 7)}w ago`
  return `${Math.floor(days / 30)}mo ago`
}

const ACTION_LABEL: Record<string, string> = {
  REMINDER: 'Send reminder',
  PAST_DUE: 'Send past-due notice',
  FINAL_NOTICE: 'Send FINAL NOTICE',
  ACCOUNT_HOLD: 'Place account hold',
  PHONE_CALL: 'Log call',
  PAYMENT_PLAN: 'Mark payment plan',
  FOLLOW_UP: 'Needs follow-up',
  NOTE: 'Add note',
  PROMISED: 'Mark promised',
}

const ACTION_ACCENT: Record<string, 'brand' | 'accent' | 'negative' | 'neutral'> = {
  REMINDER: 'brand',
  PAST_DUE: 'accent',
  FINAL_NOTICE: 'negative',
  ACCOUNT_HOLD: 'negative',
  FOLLOW_UP: 'neutral',
  PHONE_CALL: 'brand',
  PAYMENT_PLAN: 'brand',
  NOTE: 'neutral',
  PROMISED: 'brand',
}

export default function CollectionsActionCenter() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { addToast } = useToast()

  const builderFilter = searchParams.get('builder')
  const invoiceFilter = searchParams.get('invoice')

  const [data, setData] = useState<QueueData | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [pendingAction, setPendingAction] = useState<string | null>(null)
  const [refreshTick, setRefreshTick] = useState<number | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  useEffect(() => { fetchData() }, [])

  async function fetchData() {
    setRefreshing(true)
    try {
      const res = await fetch('/api/ops/collections/today')
      if (!res.ok) throw new Error('Failed to load collections queue')
      setData(await res.json())
      setRefreshTick(Date.now())
    } catch (err) {
      console.error('Collections fetch error:', err)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  async function logAction(
    invoiceId: string,
    actionType: string,
    channel: string,
    opts: { sendEmail?: boolean; notes?: string } = {},
  ) {
    setPendingAction(`${invoiceId}:${actionType}`)
    try {
      const res = await fetch(`/api/ops/collections/${invoiceId}/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          actionType,
          channel,
          sendEmail: opts.sendEmail ?? false,
          notes: opts.notes || null,
        }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        addToast({ type: 'error', title: 'Action failed', message: body?.error || 'Unknown error' })
        return
      }
      const emailNote =
        body?.email?.attempted && body?.email?.success
          ? ' (email sent)'
          : body?.email?.attempted
            ? ` (email failed: ${body.email.error || 'unknown'})`
            : ''
      addToast({
        type: 'success',
        title: ACTION_LABEL[actionType] || actionType,
        message: `Logged${emailNote}`,
      })
      await fetchData()
    } catch (err: any) {
      addToast({ type: 'error', title: 'Action failed', message: err?.message || String(err) })
    } finally {
      setPendingAction(null)
    }
  }

  const filteredQueue = useMemo(() => {
    if (!data) return []
    return data.queue.filter((r) => {
      if (builderFilter && r.builder.id !== builderFilter) return false
      if (invoiceFilter && r.invoice.id !== invoiceFilter) return false
      return true
    })
  }, [data, builderFilter, invoiceFilter])

  const kpi = useMemo(() => {
    if (!data) return { count: 0, total: 0, critical: 0, criticalTotal: 0 }
    const critical = data.queue.filter((r) => r.invoice.daysPastDue >= 45)
    return {
      count: data.queue.length,
      total: data.queue.reduce((s, r) => s + r.invoice.balanceDue, 0),
      critical: critical.length,
      criticalTotal: critical.reduce((s, r) => s + r.invoice.balanceDue, 0),
    }
  }, [data])

  if (loading || !data) {
    return (
      <div className="space-y-5">
        <PageHeader eyebrow="Finance" title="Collections" description="Accounts needing action today." />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[0, 1, 2, 3].map((i) => <KPICard key={i} title="" value="" loading />)}
        </div>
        <div className="h-64 skeleton rounded-lg" />
      </div>
    )
  }

  return (
    <div className="space-y-5 animate-enter">
      <LiveDataIndicator trigger={refreshTick} />

      <PageHeader
        eyebrow="Finance"
        title="Collections"
        description="Accounts needing action today · ladder-driven queue · one-click actions."
        actions={
          <button onClick={fetchData} className="btn btn-secondary btn-sm" disabled={refreshing}>
            <RefreshCw className={cn('w-3.5 h-3.5', refreshing && 'animate-spin')} />
            Refresh
          </button>
        }
      />

      {/* KPI strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KPICard
          title="Accounts Needing Action"
          value={<span style={MONO_STYLE}>{kpi.count}</span>}
          subtitle="open in queue"
          icon={<Clock className="w-3.5 h-3.5" />}
          accent="brand"
        />
        <KPICard
          title="Outstanding (Queue)"
          value={<span style={MONO_STYLE}>{fmtMoneyCompact(kpi.total)}</span>}
          subtitle="total past due"
          icon={<AlertTriangle className="w-3.5 h-3.5" />}
          accent={kpi.total > 50_000 ? 'negative' : 'accent'}
        />
        <KPICard
          title="Critical (45d+)"
          value={<span style={MONO_STYLE}>{kpi.critical}</span>}
          subtitle={fmtMoneyCompact(kpi.criticalTotal)}
          icon={<Ban className="w-3.5 h-3.5" />}
          accent={kpi.critical > 0 ? 'negative' : 'positive'}
        />
        <KPICard
          title="Snapshot Time"
          value={<span style={MONO_STYLE}>{new Date(data.asOf).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>}
          subtitle={new Date(data.asOf).toLocaleDateString()}
          icon={<RefreshCw className="w-3.5 h-3.5" />}
          accent="neutral"
        />
      </div>

      {(builderFilter || invoiceFilter) && (
        <Card variant="default">
          <CardBody className="py-2 flex items-center gap-3">
            <Filter className="w-3.5 h-3.5 text-fg-muted" />
            <span className="text-[12px] text-fg-muted">Filter active:</span>
            {builderFilter && <Badge variant="neutral" size="xs">builder={builderFilter.slice(0, 8)}</Badge>}
            {invoiceFilter && <Badge variant="neutral" size="xs">invoice={invoiceFilter.slice(0, 8)}</Badge>}
            <button onClick={() => router.push('/ops/collections')} className="btn btn-ghost btn-xs">
              Clear
            </button>
          </CardBody>
        </Card>
      )}

      {/* Action queue */}
      <Card variant="default" padding="none">
        <CardHeader>
          <div>
            <CardTitle>Accounts Needing Action Today</CardTitle>
            <CardDescription>
              Each row shows the next ladder step based on days-past-due and prior CollectionActions.
              Click "Send email" to fire the templated email through Resend; "Log call" and "Mark promised"
              just record the action without sending.
            </CardDescription>
          </div>
        </CardHeader>
        <CardBody>
          {filteredQueue.length === 0 ? (
            <EmptyState
              icon="check"
              size="compact"
              title="Nothing due right now"
              description="No invoices past any active collection rule threshold. Monday inbox zero."
            />
          ) : (
            <div className="space-y-2">
              {filteredQueue.map((row) => {
                const isExpanded = expandedId === row.invoice.id
                const actionKey = `${row.invoice.id}:${row.nextAction.actionType}`
                const isPending = pendingAction === actionKey
                const severity =
                  row.invoice.daysPastDue >= 60 ? 'critical' :
                    row.invoice.daysPastDue >= 45 ? 'warning' :
                      row.invoice.daysPastDue >= 15 ? 'notice' : 'neutral'
                const severityBorder =
                  severity === 'critical' ? 'border-l-data-negative' :
                    severity === 'warning' ? 'border-l-accent' :
                      severity === 'notice' ? 'border-l-brand' : 'border-l-border-subtle'

                return (
                  <div
                    key={row.invoice.id}
                    className={cn(
                      'border border-border-subtle rounded-md overflow-hidden bg-surface transition-all',
                      'border-l-4', severityBorder,
                      isExpanded && 'shadow-sm',
                    )}
                  >
                    {/* Row summary */}
                    <div
                      className="grid grid-cols-[1fr_auto_auto_auto] gap-3 items-center px-4 py-3 cursor-pointer hover:bg-surface-muted/40"
                      onClick={() => setExpandedId(isExpanded ? null : row.invoice.id)}
                    >
                      {/* Builder + invoice */}
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-fg text-[13px] truncate">{row.builder.name}</span>
                          <span className="text-fg-subtle text-[12px] font-mono" style={MONO_STYLE}>
                            {row.invoice.invoiceNumber}
                          </span>
                          <StatusBadge status={row.invoice.status} size="sm" />
                          {row.priorActionCount > 0 && (
                            <Badge variant="neutral" size="xs">
                              {row.priorActionCount} prior
                            </Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-3 mt-1 text-[11px] text-fg-muted">
                          {row.builder.contactName && <span>{row.builder.contactName}</span>}
                          {row.builder.email && (
                            <span className="flex items-center gap-1">
                              <Mail className="w-3 h-3" />{row.builder.email}
                            </span>
                          )}
                          {row.builder.phone && (
                            <span className="flex items-center gap-1">
                              <Phone className="w-3 h-3" />{row.builder.phone}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Days past due */}
                      <div className="text-right">
                        <div
                          className={cn(
                            'text-[18px] font-bold tabular-nums',
                            severity === 'critical' && 'text-data-negative',
                            severity === 'warning' && 'text-accent',
                            severity === 'notice' && 'text-fg',
                            severity === 'neutral' && 'text-fg-muted',
                          )}
                          style={MONO_STYLE}
                        >
                          {row.invoice.daysPastDue}d
                        </div>
                        <div className="text-[10px] text-fg-subtle eyebrow">past due</div>
                      </div>

                      {/* Amount */}
                      <div className="text-right">
                        <div className="text-[15px] font-bold tabular-nums" style={MONO_STYLE}>
                          {fmtMoneyExact(row.invoice.balanceDue)}
                        </div>
                        <div className="text-[10px] text-fg-subtle">
                          due {fmtShortDate(row.invoice.dueDate)}
                        </div>
                      </div>

                      {/* Last contact */}
                      <div className="text-right min-w-[110px]">
                        {row.lastContact ? (
                          <>
                            <div className="text-[12px] text-fg">{row.lastContact.actionType}</div>
                            <div className="text-[10px] text-fg-subtle">
                              {fmtRelative(row.lastContact.sentAt)}
                            </div>
                          </>
                        ) : (
                          <span className="text-[11px] text-fg-subtle">No prior contact</span>
                        )}
                      </div>
                    </div>

                    {/* Next-action + buttons bar */}
                    <div className="px-4 py-2 bg-surface-muted/30 border-t border-border-subtle flex flex-wrap items-center gap-2">
                      <span className="text-[11px] text-fg-muted">Next:</span>
                      <Badge
                        variant={ACTION_ACCENT[row.nextAction.actionType] === 'negative' ? 'danger' : ACTION_ACCENT[row.nextAction.actionType] === 'accent' ? 'warning' : 'neutral'}
                        size="xs"
                      >
                        {ACTION_LABEL[row.nextAction.actionType] || row.nextAction.actionType}
                      </Badge>
                      <span className="text-[10px] text-fg-subtle">
                        {row.nextAction.triggerDays !== null
                          ? `rule: ${row.nextAction.ruleName} (${row.nextAction.triggerDays}+d)`
                          : 'no remaining automated steps'}
                      </span>

                      <div className="ml-auto flex items-center gap-1.5 flex-wrap">
                        {/* Send email now — only if nextAction maps to an email template */}
                        {['REMINDER', 'PAST_DUE', 'FINAL_NOTICE', 'ACCOUNT_HOLD'].includes(row.nextAction.actionType) && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              logAction(row.invoice.id, row.nextAction.actionType, 'EMAIL', { sendEmail: true })
                            }}
                            disabled={isPending || !row.builder.email}
                            className={cn(
                              'btn btn-primary btn-xs',
                              (!row.builder.email) && 'opacity-50 cursor-not-allowed',
                            )}
                            title={!row.builder.email ? 'No email on file' : 'Fire the templated email now'}
                          >
                            <Send className="w-3 h-3" />
                            Send email now
                          </button>
                        )}
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            const noteText = typeof window !== 'undefined'
                              ? window.prompt('Call notes (optional):', '')
                              : null
                            if (noteText === null) return // cancelled
                            logAction(row.invoice.id, 'PHONE_CALL', 'PHONE', { notes: noteText || 'Call logged' })
                          }}
                          disabled={isPending}
                          className="btn btn-secondary btn-xs"
                        >
                          <Phone className="w-3 h-3" />
                          Log call
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            const promiseDate = typeof window !== 'undefined'
                              ? window.prompt('Promised payment date (e.g. 2026-05-01):', '')
                              : null
                            if (promiseDate === null) return
                            logAction(row.invoice.id, 'PROMISED', 'NOTE', {
                              notes: promiseDate ? `Promised pay by ${promiseDate}` : 'Payment promised (no date)',
                            })
                          }}
                          disabled={isPending}
                          className="btn btn-secondary btn-xs"
                        >
                          <CheckSquare className="w-3 h-3" />
                          Mark promised
                        </button>
                        {row.invoice.daysPastDue >= 45 && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              if (typeof window !== 'undefined' &&
                                !window.confirm(`Escalate ${row.builder.name} to ACCOUNT_HOLD? This suspends the builder and emails them + Nate.`)) return
                              logAction(row.invoice.id, 'ACCOUNT_HOLD', 'EMAIL', {
                                sendEmail: true,
                                notes: 'Manually escalated to account hold from collections action center',
                              })
                            }}
                            disabled={isPending}
                            className="btn btn-xs bg-data-negative text-white hover:opacity-90"
                          >
                            <Ban className="w-3 h-3" />
                            Escalate
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Activity history — expanded view */}
                    {isExpanded && (
                      <div className="px-4 py-3 border-t border-border-subtle bg-canvas">
                        <div className="flex items-center justify-between mb-2">
                          <div className="eyebrow text-[10px] text-fg-muted">Activity history</div>
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              router.push(`/ops/invoices/${row.invoice.id}`)
                            }}
                            className="btn btn-ghost btn-xs"
                          >
                            <ExternalLink className="w-3 h-3" />
                            Open invoice
                          </button>
                        </div>
                        {row.priorActions.length === 0 ? (
                          <p className="text-[12px] text-fg-subtle">No prior actions on this invoice.</p>
                        ) : (
                          <ul className="space-y-1.5">
                            {row.priorActions.map((a) => (
                              <li
                                key={a.id}
                                className="flex items-start gap-2 text-[12px] border-l-2 border-border-subtle pl-2"
                              >
                                <MessageSquare className="w-3 h-3 mt-[3px] text-fg-muted flex-shrink-0" />
                                <div className="min-w-0">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <span className="font-medium text-fg">{a.actionType}</span>
                                    <span className="text-fg-subtle text-[11px]">{a.channel}</span>
                                    <span className="text-fg-subtle text-[11px]">
                                      {new Date(a.sentAt).toLocaleString()}
                                    </span>
                                    {a.sentBy && (
                                      <span className="text-fg-subtle text-[11px]">by {a.sentBy}</span>
                                    )}
                                  </div>
                                  {a.notes && (
                                    <p className="text-fg-muted text-[11px] mt-0.5 whitespace-pre-wrap">
                                      {a.notes}
                                    </p>
                                  )}
                                </div>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  )
}
