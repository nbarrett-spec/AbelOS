'use client'

/**
 * InboxQueue — reusable inbox triage component
 *
 * Used by:
 *   - /ops/inbox page (full 3-column triage UI)
 *   - Dashboard widgets (compact mode: list only, no sidebar / no detail pane)
 *
 * Props let the caller decide how much surface to render:
 *   variant="full"    — 3-column: sidebar + list + detail pane
 *   variant="compact" — middle column only, capped to `limit` rows,
 *                       clicking an item opens detail pane inline
 *
 * Backed by GET /api/ops/inbox/scoped. All action mutations go through the
 * per-item endpoints (resolve / snooze / escalate / take-action).
 */

import {
  useCallback, useEffect, useMemo, useRef, useState,
} from 'react'
import Badge from './Badge'
import Button from './Button'
import { Dialog } from './Dialog'
import Kbd from './Kbd'

// ──────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────
export interface InboxItemData {
  id: string
  type: string
  source: string
  title: string
  description?: string | null
  priority: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | string
  status: string
  entityType?: string | null
  entityId?: string | null
  financialImpact?: number | null
  assignedTo?: string | null
  actionData?: any
  result?: any
  dueBy?: string | null
  snoozedUntil?: string | null
  resolvedAt?: string | null
  resolvedBy?: string | null
  createdAt: string
  updatedAt: string
}

export interface InboxQueueProps {
  variant?: 'full' | 'compact'
  /** Cap on items fetched per page (default 50, max 200) */
  limit?: number
  /** Override default status filter. Default "PENDING". */
  initialStatus?: string
  /** Caller can preset a type filter (comma-separated) */
  initialType?: string
  /** Auto-refresh interval in ms. Default 30000. Pass 0 to disable. */
  refreshMs?: number
  /** Called after a list is loaded — lets parent react to counts */
  onCountsChange?: (totalPending: number, countsByType: Record<string, number>) => void
  /** Title shown above the list (compact mode only) */
  title?: string
  className?: string
}

// ──────────────────────────────────────────────────────────────────────────
// Presentation helpers
// ──────────────────────────────────────────────────────────────────────────
const PRIORITY_ORDER: Record<string, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 }

const PRIORITY_VARIANT: Record<string, 'danger' | 'warning' | 'info' | 'neutral'> = {
  CRITICAL: 'danger',
  HIGH: 'warning',
  MEDIUM: 'info',
  LOW: 'neutral',
}

const TYPE_LABELS: Record<string, string> = {
  MRP_RECOMMENDATION: 'MRP',
  COLLECTION_ACTION: 'Collections',
  DEAL_FOLLOWUP: 'Deal Follow-up',
  AGENT_TASK: 'Agent Task',
  MATERIAL_ARRIVAL: 'Material',
  QC_ALERT: 'QC Alert',
  PO_APPROVAL: 'PO Approval',
  OUTREACH_REVIEW: 'Outreach',
  SCHEDULE_CHANGE: 'Schedule',
  ACTION_REQUIRED: 'Action Required',
  CREDIT_ALERT: 'Credit Alert',
  SYSTEM: 'System',
  SYSTEM_AUDIT_FINDING: 'Audit Finding',
  IMPROVEMENT_REVENUE: 'Revenue Ideas',
  IMPROVEMENT_COST: 'Cost Ideas',
  IMPROVEMENT_CASHFLOW: 'Cash Flow',
  IMPROVEMENT_PRICING: 'Pricing',
  IMPROVEMENT_SUPPLIER: 'Supplier',
  IMPROVEMENT_INVENTORY: 'Inventory',
  IMPROVEMENT_SCHEDULING: 'Scheduling',
  IMPROVEMENT_QUALITY: 'Quality',
  IMPROVEMENT_DELIVERY: 'Delivery',
  FINANCIAL_IMPROVEMENT: 'Financial',
}

function typeLabel(type: string): string {
  return TYPE_LABELS[type] || type.replace(/_/g, ' ')
}

function fmtAge(iso: string | null | undefined): string {
  if (!iso) return ''
  try {
    const d = new Date(iso)
    const diffMin = Math.floor((Date.now() - d.getTime()) / 60000)
    if (diffMin < 1) return 'just now'
    if (diffMin < 60) return `${diffMin}m ago`
    if (diffMin < 1440) return `${Math.floor(diffMin / 60)}h ago`
    if (diffMin < 10080) return `${Math.floor(diffMin / 1440)}d ago`
    return d.toLocaleDateString()
  } catch {
    return ''
  }
}

function fmtCurrency(num?: number | null): string {
  if (!num || !isFinite(num)) return ''
  const abs = Math.abs(num)
  if (abs >= 1000) return `$${(num / 1000).toFixed(1)}k`
  return `$${Math.round(num).toLocaleString('en-US')}`
}

// ──────────────────────────────────────────────────────────────────────────
// Main component
// ──────────────────────────────────────────────────────────────────────────
export default function InboxQueue({
  variant = 'full',
  limit = 50,
  initialStatus = 'PENDING',
  initialType,
  refreshMs = 30_000,
  onCountsChange,
  title,
  className,
}: InboxQueueProps) {
  const [items, setItems] = useState<InboxItemData[]>([])
  const [countsByType, setCountsByType] = useState<Record<string, number>>({})
  const [totalPending, setTotalPending] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [typeFilter, setTypeFilter] = useState<string>(initialType || 'all')
  const [status, setStatus] = useState<string>(initialStatus)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [acting, setActing] = useState(false)
  const [escalateDialog, setEscalateDialog] = useState(false)
  const [snoozeDialog, setSnoozeDialog] = useState(false)
  const [resolveDialog, setResolveDialog] = useState(false)
  const [escalateTo, setEscalateTo] = useState('')
  const [escalateReason, setEscalateReason] = useState('')
  const [snoozeDuration, setSnoozeDuration] = useState<'1h' | '4h' | '1d' | '3d'>('1h')
  const [resolveNotes, setResolveNotes] = useState('')
  const listRef = useRef<HTMLDivElement>(null)
  const onCountsChangeRef = useRef(onCountsChange)
  useEffect(() => { onCountsChangeRef.current = onCountsChange }, [onCountsChange])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const sp = new URLSearchParams()
      sp.set('status', status)
      sp.set('limit', String(limit))
      if (typeFilter && typeFilter !== 'all') sp.set('type', typeFilter)
      const res = await fetch(`/api/ops/inbox/scoped?${sp.toString()}`, {
        credentials: 'include',
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setItems(data.items || [])
      setCountsByType(data.countsByType || {})
      setTotalPending(data.totalPending || 0)
      onCountsChangeRef.current?.(data.totalPending || 0, data.countsByType || {})
      // Preserve selection if still present; else select first
      if (data.items?.length) {
        setSelectedId(prev => {
          if (prev && data.items.find((i: InboxItemData) => i.id === prev)) return prev
          return data.items[0].id
        })
      } else {
        setSelectedId(null)
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to load inbox')
    } finally {
      setLoading(false)
    }
  }, [limit, status, typeFilter])

  useEffect(() => {
    load()
    if (!refreshMs) return
    const i = setInterval(load, refreshMs)
    return () => clearInterval(i)
  }, [load, refreshMs])

  // Sorted by priority then age
  const sorted = useMemo(() => {
    return [...items].sort((a, b) => {
      const pd = (PRIORITY_ORDER[a.priority] ?? 9) - (PRIORITY_ORDER[b.priority] ?? 9)
      if (pd !== 0) return pd
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    })
  }, [items])

  const selected = sorted.find(i => i.id === selectedId) || null

  // ── Actions ─────────────────────────────────────────────────────────────
  const resolve = useCallback(async (id: string, notes?: string) => {
    setActing(true)
    try {
      const res = await fetch(`/api/ops/inbox/${id}/resolve`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resolution: 'resolved', notes: notes || '' }),
      })
      if (!res.ok) throw new Error(await res.text())
      setItems(prev => prev.filter(x => x.id !== id))
      setResolveDialog(false)
      setResolveNotes('')
    } catch (err) {
      console.error('resolve failed', err)
      load()
    } finally {
      setActing(false)
    }
  }, [load])

  const snooze = useCallback(async (id: string, duration: string) => {
    setActing(true)
    try {
      const minutes = duration === '1h' ? 60 : duration === '4h' ? 240 : duration === '1d' ? 1440 : 4320
      const until = new Date(Date.now() + minutes * 60_000).toISOString()
      const res = await fetch(`/api/ops/inbox/${id}/snooze`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ until }),
      })
      if (!res.ok) throw new Error(await res.text())
      setItems(prev => prev.filter(x => x.id !== id))
      setSnoozeDialog(false)
    } catch (err) {
      console.error('snooze failed', err)
      load()
    } finally {
      setActing(false)
    }
  }, [load])

  const escalate = useCallback(async (id: string, toStaffId: string, reason?: string) => {
    if (!toStaffId.trim()) return
    setActing(true)
    try {
      const res = await fetch(`/api/ops/inbox/${id}/escalate`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ toStaffId: toStaffId.trim(), reason }),
      })
      if (!res.ok) throw new Error(await res.text())
      setItems(prev => prev.filter(x => x.id !== id))
      setEscalateDialog(false)
      setEscalateTo('')
      setEscalateReason('')
    } catch (err) {
      console.error('escalate failed', err)
      load()
    } finally {
      setActing(false)
    }
  }, [load])

  const takeAction = useCallback(async (id: string) => {
    setActing(true)
    try {
      const res = await fetch(`/api/ops/inbox/${id}/take-action`, {
        method: 'POST',
        credentials: 'include',
      })
      if (!res.ok) throw new Error(await res.text())
      const data = await res.json()
      if (data.redirectTo && typeof window !== 'undefined') {
        window.location.href = data.redirectTo
      }
    } catch (err) {
      console.error('take-action failed', err)
    } finally {
      setActing(false)
    }
  }, [])

  // ── Keyboard shortcuts (full variant only) ──────────────────────────────
  useEffect(() => {
    if (variant !== 'full') return
    function onKey(e: KeyboardEvent) {
      // ignore when typing in inputs/textareas or with modifier keys
      const t = e.target as HTMLElement | null
      const isTextInput =
        t?.tagName === 'INPUT' || t?.tagName === 'TEXTAREA' || t?.isContentEditable
      if (isTextInput) return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (escalateDialog || snoozeDialog || resolveDialog) return
      if (!sorted.length) return

      const idx = Math.max(0, sorted.findIndex(i => i.id === selectedId))

      if (e.key === 'j' || e.key === 'ArrowDown') {
        e.preventDefault()
        const next = sorted[Math.min(sorted.length - 1, idx + 1)]
        if (next) setSelectedId(next.id)
      } else if (e.key === 'k' || e.key === 'ArrowUp') {
        e.preventDefault()
        const prev = sorted[Math.max(0, idx - 1)]
        if (prev) setSelectedId(prev.id)
      } else if (e.key === 'r') {
        if (selected && selected.status === 'PENDING') {
          e.preventDefault()
          setResolveDialog(true)
        }
      } else if (e.key === 's') {
        if (selected && selected.status === 'PENDING') {
          e.preventDefault()
          setSnoozeDialog(true)
        }
      } else if (e.key === 'e') {
        if (selected && selected.status === 'PENDING') {
          e.preventDefault()
          setEscalateDialog(true)
        }
      } else if (e.key === 'Enter') {
        if (selected) {
          e.preventDefault()
          takeAction(selected.id)
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [variant, sorted, selectedId, selected, escalateDialog, snoozeDialog, resolveDialog, takeAction])

  // ── Compact variant ─────────────────────────────────────────────────────
  if (variant === 'compact') {
    return (
      <div className={`panel p-4 ${className || ''}`}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-fg">{title || 'Your Inbox'}</h3>
          <Badge variant="neutral" size="sm">{totalPending}</Badge>
        </div>
        {loading && !items.length && (
          <p className="text-xs text-fg-subtle">Loading…</p>
        )}
        {error && <p className="text-xs text-data-negative">{error}</p>}
        {!loading && !items.length && (
          <p className="text-xs text-fg-subtle">Inbox clear.</p>
        )}
        <div className="space-y-1.5">
          {sorted.slice(0, 8).map(item => (
            <a
              key={item.id}
              href="/ops/inbox"
              className="block p-2 rounded-md hover:bg-surface-muted transition-colors"
            >
              <div className="flex items-start gap-2">
                <Badge variant={PRIORITY_VARIANT[item.priority] || 'neutral'} size="xs">
                  {item.priority}
                </Badge>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-fg truncate">{item.title}</p>
                  <p className="text-[10px] text-fg-subtle">
                    {typeLabel(item.type)} · {fmtAge(item.createdAt)}
                    {item.financialImpact ? ` · ${fmtCurrency(item.financialImpact)}` : ''}
                  </p>
                </div>
              </div>
            </a>
          ))}
        </div>
      </div>
    )
  }

  // ──────────────────────────────────────────────────────────────────────
  // Full variant — 3-column layout
  // ──────────────────────────────────────────────────────────────────────
  const sortedTypeCounts = Object.entries(countsByType).sort((a, b) => b[1] - a[1])

  return (
    <div className={`grid grid-cols-[200px_minmax(0,1fr)_380px] gap-4 h-[calc(100vh-12rem)] ${className || ''}`}>
      {/* ── Left: Type sidebar ─────────────────────────────────────────── */}
      <aside className="panel p-3 overflow-y-auto">
        <div className="mb-3">
          <p className="text-[10px] font-bold text-fg-subtle uppercase tracking-wider">Filter by type</p>
          <div className="text-[11px] text-fg-muted mt-1">
            {totalPending} {status.toLowerCase()}
          </div>
        </div>
        <button
          onClick={() => setTypeFilter('all')}
          className={`w-full flex items-center justify-between px-2 py-1.5 rounded text-xs transition-colors ${
            typeFilter === 'all'
              ? 'bg-signal/10 text-fg border-l-2 border-c1'
              : 'text-fg-subtle hover:bg-surface-muted'
          }`}
        >
          <span>All types</span>
          <span className="text-[10px] font-mono">{totalPending}</span>
        </button>
        <div className="mt-2 space-y-0.5">
          {sortedTypeCounts.map(([t, n]) => (
            <button
              key={t}
              onClick={() => setTypeFilter(t)}
              className={`w-full flex items-center justify-between px-2 py-1.5 rounded text-xs transition-colors ${
                typeFilter === t
                  ? 'bg-signal/10 text-fg border-l-2 border-c1'
                  : 'text-fg-subtle hover:bg-surface-muted'
              }`}
              title={t}
            >
              <span className="truncate">{typeLabel(t)}</span>
              <span className="text-[10px] font-mono ml-2">{n}</span>
            </button>
          ))}
        </div>

        <div className="mt-4 pt-3 border-t border-border">
          <p className="text-[10px] font-bold text-fg-subtle uppercase tracking-wider mb-2">Status</p>
          <select
            value={status}
            onChange={e => setStatus(e.target.value)}
            className="w-full px-2 py-1 rounded border border-border bg-surface text-xs"
          >
            <option value="PENDING">Pending</option>
            <option value="SNOOZED">Snoozed</option>
            <option value="COMPLETED">Completed</option>
            <option value="all">All</option>
          </select>
        </div>

        <div className="mt-4 pt-3 border-t border-border">
          <p className="text-[10px] font-bold text-fg-subtle uppercase tracking-wider mb-2">Shortcuts</p>
          <ul className="space-y-1 text-[10px] text-fg-subtle">
            <li><Kbd>J</Kbd>/<Kbd>K</Kbd> navigate</li>
            <li><Kbd>R</Kbd> resolve</li>
            <li><Kbd>S</Kbd> snooze</li>
            <li><Kbd>E</Kbd> escalate</li>
            <li><Kbd>Enter</Kbd> take action</li>
          </ul>
        </div>
      </aside>

      {/* ── Middle: Item list ──────────────────────────────────────────── */}
      <section ref={listRef} className="panel overflow-y-auto">
        <header className="sticky top-0 z-10 bg-surface border-b border-border px-4 py-2 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-fg">
              {typeFilter === 'all' ? 'All items' : typeLabel(typeFilter)}
            </h2>
            <p className="text-[11px] text-fg-subtle">
              {sorted.length} shown · priority sorted
            </p>
          </div>
          <Button size="xs" variant="ghost" onClick={load} loading={loading}>
            Refresh
          </Button>
        </header>

        {error && (
          <div className="m-3 p-3 rounded bg-data-negative-bg text-data-negative-fg text-xs">
            {error}
          </div>
        )}

        {!loading && !sorted.length && (
          <div className="p-8 text-center text-fg-subtle text-sm">
            <p className="font-medium mb-1">Inbox clear.</p>
            <p className="text-xs">No {status.toLowerCase()} items in your queue.</p>
          </div>
        )}

        <ul className="divide-y divide-border">
          {sorted.map(item => {
            const isSelected = item.id === selectedId
            return (
              <li key={item.id}>
                <button
                  onClick={() => setSelectedId(item.id)}
                  className={`w-full text-left px-4 py-3 transition-colors ${
                    isSelected ? 'bg-signal/5' : 'hover:bg-surface-muted'
                  }`}
                  style={{
                    borderLeft: isSelected ? '3px solid var(--c1)' : '3px solid transparent',
                  }}
                >
                  <div className="flex items-start gap-3">
                    <Badge variant={PRIORITY_VARIANT[item.priority] || 'neutral'} size="xs">
                      {item.priority}
                    </Badge>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-xs font-semibold text-fg line-clamp-1">{item.title}</p>
                        <span className="text-[10px] text-fg-subtle whitespace-nowrap">
                          {fmtAge(item.createdAt)}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 mt-1 text-[10px] text-fg-subtle">
                        <span>{typeLabel(item.type)}</span>
                        <span>·</span>
                        <span className="truncate">{item.source}</span>
                        {item.financialImpact ? (
                          <>
                            <span>·</span>
                            <span className="font-mono text-accent-fg">
                              {fmtCurrency(item.financialImpact)}
                            </span>
                          </>
                        ) : null}
                      </div>
                    </div>
                  </div>
                </button>
              </li>
            )
          })}
        </ul>
      </section>

      {/* ── Right: Detail pane ─────────────────────────────────────────── */}
      <aside className="panel overflow-y-auto">
        {!selected ? (
          <div className="p-6 text-center text-fg-subtle text-sm">
            <p>Select an item to view details.</p>
          </div>
        ) : (
          <div className="flex flex-col h-full">
            <header className="border-b border-border p-4">
              <div className="flex items-center gap-2 mb-2">
                <Badge variant={PRIORITY_VARIANT[selected.priority] || 'neutral'} size="sm">
                  {selected.priority}
                </Badge>
                <Badge variant="neutral" size="sm">{typeLabel(selected.type)}</Badge>
                <span className="text-[10px] text-fg-subtle ml-auto">
                  {fmtAge(selected.createdAt)}
                </span>
              </div>
              <h3 className="text-sm font-semibold text-fg">{selected.title}</h3>
              {selected.description && (
                <p className="text-xs text-fg-muted mt-2 whitespace-pre-wrap">
                  {selected.description}
                </p>
              )}
            </header>

            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              <DetailField label="Source" value={selected.source} />
              {selected.entityType && (
                <DetailField label="Linked entity" value={`${selected.entityType}${selected.entityId ? ` · ${selected.entityId}` : ''}`} />
              )}
              {selected.financialImpact ? (
                <DetailField label="Financial impact" value={fmtCurrency(selected.financialImpact)} mono />
              ) : null}
              {selected.dueBy && (
                <DetailField label="Due by" value={new Date(selected.dueBy).toLocaleString()} />
              )}
              {selected.assignedTo && (
                <DetailField label="Assigned to" value={selected.assignedTo} mono />
              )}
              <DetailField label="Status" value={selected.status} />

              {selected.actionData ? (
                <details className="rounded border border-border">
                  <summary className="cursor-pointer px-3 py-2 text-[11px] font-semibold text-fg-muted">
                    Action payload
                  </summary>
                  <pre className="px-3 pb-3 text-[10px] font-mono text-fg-subtle whitespace-pre-wrap break-all max-h-48 overflow-auto">
                    {JSON.stringify(selected.actionData, null, 2)}
                  </pre>
                </details>
              ) : null}
            </div>

            <footer className="border-t border-border p-3 space-y-2 bg-surface-muted">
              {selected.status === 'PENDING' ? (
                <>
                  <Button
                    variant="primary"
                    size="sm"
                    fullWidth
                    loading={acting}
                    onClick={() => takeAction(selected.id)}
                  >
                    Take Action <Kbd className="ml-2">Enter</Kbd>
                  </Button>
                  <div className="grid grid-cols-3 gap-2">
                    <Button variant="ghost" size="sm" onClick={() => setResolveDialog(true)}>
                      Resolve <Kbd>R</Kbd>
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setSnoozeDialog(true)}>
                      Snooze <Kbd>S</Kbd>
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setEscalateDialog(true)}>
                      Escalate <Kbd>E</Kbd>
                    </Button>
                  </div>
                </>
              ) : (
                <p className="text-center text-[11px] text-fg-subtle">
                  Item is {selected.status.toLowerCase()}.
                </p>
              )}
            </footer>
          </div>
        )}
      </aside>

      {/* ── Resolve dialog ─────────────────────────────────────────────── */}
      <Dialog
        open={resolveDialog}
        onClose={() => setResolveDialog(false)}
        title="Resolve item"
        size="sm"
        footer={
          <div className="flex gap-2 justify-end">
            <Button variant="ghost" size="sm" onClick={() => setResolveDialog(false)}>Cancel</Button>
            <Button
              variant="primary"
              size="sm"
              loading={acting}
              onClick={() => selected && resolve(selected.id, resolveNotes)}
            >
              Mark resolved
            </Button>
          </div>
        }
      >
        <p className="text-xs text-fg-muted mb-2">
          Add a note explaining how this was resolved (optional).
        </p>
        <textarea
          value={resolveNotes}
          onChange={e => setResolveNotes(e.target.value)}
          rows={3}
          placeholder="e.g. Approved PO #1234 via phone confirmation with vendor"
          className="w-full px-3 py-2 rounded border border-border bg-surface text-sm"
        />
      </Dialog>

      {/* ── Snooze dialog ──────────────────────────────────────────────── */}
      <Dialog
        open={snoozeDialog}
        onClose={() => setSnoozeDialog(false)}
        title="Snooze item"
        size="sm"
        footer={
          <div className="flex gap-2 justify-end">
            <Button variant="ghost" size="sm" onClick={() => setSnoozeDialog(false)}>Cancel</Button>
            <Button
              variant="primary"
              size="sm"
              loading={acting}
              onClick={() => selected && snooze(selected.id, snoozeDuration)}
            >
              Snooze
            </Button>
          </div>
        }
      >
        <p className="text-xs text-fg-muted mb-3">Hide this item until later.</p>
        <div className="grid grid-cols-4 gap-2">
          {(['1h', '4h', '1d', '3d'] as const).map(d => (
            <button
              key={d}
              onClick={() => setSnoozeDuration(d)}
              className={`px-3 py-2 rounded border text-xs font-semibold transition-colors ${
                snoozeDuration === d
                  ? 'border-c1 bg-signal/10 text-fg'
                  : 'border-border text-fg-subtle hover:bg-surface-muted'
              }`}
            >
              {d === '1h' ? '1 hour' : d === '4h' ? '4 hours' : d === '1d' ? '1 day' : '3 days'}
            </button>
          ))}
        </div>
      </Dialog>

      {/* ── Escalate dialog ────────────────────────────────────────────── */}
      <Dialog
        open={escalateDialog}
        onClose={() => setEscalateDialog(false)}
        title="Escalate item"
        size="sm"
        footer={
          <div className="flex gap-2 justify-end">
            <Button variant="ghost" size="sm" onClick={() => setEscalateDialog(false)}>Cancel</Button>
            <Button
              variant="primary"
              size="sm"
              loading={acting}
              disabled={!escalateTo.trim()}
              onClick={() => selected && escalate(selected.id, escalateTo, escalateReason)}
            >
              Reassign
            </Button>
          </div>
        }
      >
        <label className="block">
          <span className="text-xs font-semibold text-fg-muted">Assign to (staff ID or email)</span>
          <input
            value={escalateTo}
            onChange={e => setEscalateTo(e.target.value)}
            placeholder="name@abellumber.com"
            className="mt-1 w-full px-3 py-2 rounded border border-border bg-surface text-sm"
          />
        </label>
        <label className="block mt-3">
          <span className="text-xs font-semibold text-fg-muted">Reason (optional)</span>
          <textarea
            value={escalateReason}
            onChange={e => setEscalateReason(e.target.value)}
            rows={2}
            placeholder="Why are you escalating?"
            className="mt-1 w-full px-3 py-2 rounded border border-border bg-surface text-sm"
          />
        </label>
      </Dialog>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────────
function DetailField({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <p className="text-[10px] font-bold text-fg-subtle uppercase tracking-wider">{label}</p>
      <p className={`text-xs text-fg mt-0.5 ${mono ? 'font-mono' : ''}`}>{value}</p>
    </div>
  )
}
