'use client'

import { useEffect, useState, useCallback, useRef } from 'react'

// ──────────────────────────────────────────────────────────────────────────
// Unified Operator Queue
//
// A true action-oriented inbox for Nate. Aggregates actionable items from:
//   - MRP recommendations (auto-generated POs)
//   - Collection actions (overdue invoices, payment escalations)
//   - Deal follow-ups (stale quotes)
//   - Agent tasks (AI-generated actions needing approval)
//   - Material arrivals (inbound shipments)
//
// Features:
//   - Priority-based sorting (CRITICAL → HIGH → MEDIUM → LOW)
//   - Financial impact badges
//   - Approve/Reject/Snooze workflow with optimistic UI
//   - Real-time updates (auto-refresh every 30s)
//   - Sound/visual alerts for CRITICAL items
//   - Filter by type, priority, status, assigned-to
// ──────────────────────────────────────────────────────────────────────────

interface InboxItemData {
  id: string
  type: string // MRP_RECOMMENDATION | COLLECTION_ACTION | DEAL_FOLLOWUP | AGENT_TASK | MATERIAL_ARRIVAL
  source: string
  title: string
  description?: string
  priority: string // CRITICAL | HIGH | MEDIUM | LOW
  status: string // PENDING | APPROVED | REJECTED | SNOOZED | EXPIRED | COMPLETED
  entityType?: string
  entityId?: string
  financialImpact?: number
  assignedTo?: string
  dueBy?: string
  snoozedUntil?: string
  createdAt: string
  updatedAt: string
}

const PRIORITY_ORDER: Record<string, number> = {
  CRITICAL: 0,
  HIGH: 1,
  MEDIUM: 2,
  LOW: 3,
}

const PRIORITY_STYLES: Record<string, { color: string; bg: string; badge: string }> = {
  CRITICAL: { color: '#DC2626', bg: '#FEE2E2', badge: '#991B1B' },
  HIGH: { color: '#EA580C', bg: '#FFEDD5', badge: '#92400E' },
  MEDIUM: { color: '#2563EB', bg: '#DBEAFE', badge: '#1E40AF' },
  LOW: { color: '#6B7280', bg: '#F3F4F6', badge: '#374151' },
}

const TYPE_LABELS: Record<string, { label: string; emoji: string }> = {
  MRP_RECOMMENDATION: { label: 'MRP', emoji: '📦' },
  COLLECTION_ACTION: { label: 'Collection', emoji: '💰' },
  DEAL_FOLLOWUP: { label: 'Followup', emoji: '📞' },
  AGENT_TASK: { label: 'AI Task', emoji: '🤖' },
  MATERIAL_ARRIVAL: { label: 'Material', emoji: '🚚' },
  QC_ALERT: { label: 'QC', emoji: '⚠️' },
  PO_APPROVAL: { label: 'Approval', emoji: '✅' },
  SCHEDULE_CHANGE: { label: 'Schedule', emoji: '📅' },
}

const ABEL_COLORS = {
  walnut: '#3E2A1E',
  amber: '#C9822B',
  green: '#27AE60',
  cream: '#F3EAD8',
}

function fmtDate(iso: string): string {
  try {
    const d = new Date(iso)
    const now = Date.now()
    const diffMin = Math.floor((now - d.getTime()) / 60000)
    if (diffMin < 1) return 'just now'
    if (diffMin < 60) return `${diffMin}m ago`
    if (diffMin < 1440) return `${Math.floor(diffMin / 60)}h ago`
    if (diffMin < 10080) return `${Math.floor(diffMin / 1440)}d ago`
    return d.toLocaleDateString()
  } catch {
    return iso
  }
}

function fmtDueDate(iso?: string): { text: string; isOverdue: boolean; daysLeft: number } {
  if (!iso) return { text: '', isOverdue: false, daysLeft: 0 }
  try {
    const d = new Date(iso)
    const now = new Date()
    const daysLeft = Math.ceil((d.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
    const isOverdue = daysLeft < 0
    const absdays = Math.abs(daysLeft)
    const text = isOverdue ? `${absdays}d overdue` : `Due in ${daysLeft}d`
    return { text, isOverdue, daysLeft }
  } catch {
    return { text: '', isOverdue: false, daysLeft: 0 }
  }
}

function fmtCurrency(num?: number): string {
  if (!num) return '$0'
  return '$' + num.toLocaleString('en-US', { maximumFractionDigits: 0 })
}

export default function InboxPage() {
  const [items, setItems] = useState<InboxItemData[]>([])
  const [loading, setLoading] = useState(true)
  const [actingItemId, setActingItemId] = useState<string | null>(null)
  const [action, setAction] = useState<'approve' | 'reject' | null>(null)
  const [rejectReason, setRejectReason] = useState('')
  const [snoozeDuration, setSnoozeDuration] = useState('1h')
  const [showingRejectDialog, setShowingRejectDialog] = useState<string | null>(null)
  const [showingSnoozeDialog, setShowingSnoozeDialog] = useState<string | null>(null)

  // Filters
  const [typeFilter, setTypeFilter] = useState<string>('all')
  const [priorityFilter, setPriorityFilter] = useState<string>('all')
  const [statusFilter, setStatusFilter] = useState<string>('PENDING')
  const audioRef = useRef<HTMLAudioElement>(null)

  const loadInbox = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (statusFilter && statusFilter !== 'all') params.append('status', statusFilter)
      if (typeFilter && typeFilter !== 'all') params.append('type', typeFilter)
      params.append('limit', '100')

      const res = await fetch(`/api/ops/inbox?${params.toString()}`)
      if (!res.ok) throw new Error('Failed to fetch inbox')

      const data = await res.json()
      setItems(data.items || [])
    } catch (err) {
      console.error('[Inbox] Failed to load:', err)
    } finally {
      setLoading(false)
    }
  }, [statusFilter, typeFilter])

  useEffect(() => {
    loadInbox()
    const interval = setInterval(loadInbox, 30_000) // Auto-refresh every 30s
    return () => clearInterval(interval)
  }, [loadInbox])

  // Sound alert for CRITICAL items
  useEffect(() => {
    const criticalCount = items.filter(i => i.priority === 'CRITICAL' && i.status === 'PENDING').length
    if (criticalCount > 0 && audioRef.current) {
      audioRef.current.play().catch(() => {}) // Silent fail if audio not allowed
    }
  }, [items])

  const handleAction = async (
    itemId: string,
    actionType: 'APPROVE' | 'REJECT' | 'SNOOZE',
    details?: { reason?: string; duration?: string }
  ) => {
    setActingItemId(itemId)
    try {
      let body: any = { itemId, action: actionType }

      if (actionType === 'REJECT') {
        body.notes = details?.reason || ''
      } else if (actionType === 'SNOOZE') {
        const duration = details?.duration || '1h'
        const minutes = duration === '1h' ? 60 : duration === '4h' ? 240 : duration === '1d' ? 1440 : 60
        body.snoozedUntil = new Date(Date.now() + minutes * 60000).toISOString()
      }

      // Optimistic update
      setItems(items.map(item => {
        if (item.id !== itemId) return item
        if (actionType === 'SNOOZE') {
          return { ...item, status: 'SNOOZED' }
        } else {
          return { ...item, status: actionType === 'APPROVE' ? 'APPROVED' : 'REJECTED' }
        }
      }))

      const res = await fetch('/api/ops/inbox', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      if (!res.ok) {
        console.error('Action failed:', await res.text())
        // Reload to revert optimistic update
        loadInbox()
      }
    } catch (err) {
      console.error('[Inbox] Action failed:', err)
      loadInbox()
    } finally {
      setActingItemId(null)
      setShowingRejectDialog(null)
      setShowingSnoozeDialog(null)
    }
  }

  // Aggregate stats
  const allItems = items
  const pendingCount = items.filter(i => i.status === 'PENDING').length
  const criticalCount = items.filter(i => i.priority === 'CRITICAL' && i.status === 'PENDING').length
  const highCount = items.filter(i => i.priority === 'HIGH' && i.status === 'PENDING').length
  const totalFinancialImpact = items
    .filter(i => i.status === 'PENDING')
    .reduce((sum, i) => sum + (i.financialImpact || 0), 0)

  // Filter displayed items
  const displayed = items.filter(item => {
    if (statusFilter !== 'all' && item.status !== statusFilter) return false
    if (typeFilter !== 'all' && item.type !== typeFilter) return false
    if (priorityFilter !== 'all' && item.priority !== priorityFilter) return false
    return true
  })

  // Sorted by priority then age
  displayed.sort((a, b) => {
    const paDiff = (PRIORITY_ORDER[a.priority] || 999) - (PRIORITY_ORDER[b.priority] || 999)
    if (paDiff !== 0) return paDiff
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  })

  return (
    <div className="min-h-screen" style={{ backgroundColor: ABEL_COLORS.cream }}>
      {/* Hidden audio element for CRITICAL alerts */}
      <audio ref={audioRef} src="data:audio/wav;base64,UklGRiYAAABXQVZFZm10IBAAAAABAAEAQB8AAAB9AAACABAAZGF0YQIAAAAAAA==" />

      <div className="max-w-7xl mx-auto px-6 py-8">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-2">
            <h1 className="text-3xl font-bold" style={{ color: ABEL_COLORS.walnut }}>
              Operator Queue
            </h1>
            <button
              onClick={loadInbox}
              disabled={loading}
              className="px-4 py-2 rounded-lg font-medium text-white transition"
              style={{
                backgroundColor: ABEL_COLORS.walnut,
                opacity: loading ? 0.7 : 1,
              }}
            >
              {loading ? 'Loading...' : 'Refresh'}
            </button>
          </div>
          <p className="text-sm text-gray-600">
            {pendingCount} pending • {criticalCount} critical • {fmtCurrency(totalFinancialImpact)} at stake
          </p>
        </div>

        {/* Priority summary strip */}
        <div className="grid grid-cols-4 gap-3 mb-8">
          {['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'].map(prio => {
            const count = items.filter(i => i.priority === prio && i.status === 'PENDING').length
            const styles = PRIORITY_STYLES[prio]
            return (
              <div
                key={prio}
                className="rounded-lg p-4 text-center border-2"
                style={{
                  backgroundColor: styles.bg,
                  borderColor: styles.color,
                }}
              >
                <div className="text-2xl font-bold" style={{ color: styles.color }}>
                  {count}
                </div>
                <div className="text-xs text-gray-600 mt-1">{prio}</div>
              </div>
            )
          })}
        </div>

        {/* Filters */}
        <div className="bg-white rounded-lg p-4 border border-gray-200 mb-6">
          <div className="flex flex-wrap gap-4 items-center">
            <div className="flex items-center gap-2">
              <label className="text-xs font-semibold text-gray-600">Status:</label>
              <select
                value={statusFilter}
                onChange={e => setStatusFilter(e.target.value)}
                className="px-3 py-1.5 rounded border border-gray-300 text-sm"
              >
                <option value="all">All</option>
                <option value="PENDING">Pending</option>
                <option value="APPROVED">Approved</option>
                <option value="REJECTED">Rejected</option>
                <option value="SNOOZED">Snoozed</option>
              </select>
            </div>

            <div className="flex items-center gap-2">
              <label className="text-xs font-semibold text-gray-600">Type:</label>
              <select
                value={typeFilter}
                onChange={e => setTypeFilter(e.target.value)}
                className="px-3 py-1.5 rounded border border-gray-300 text-sm"
              >
                <option value="all">All Types</option>
                {Object.keys(TYPE_LABELS).map(type => (
                  <option key={type} value={type}>
                    {TYPE_LABELS[type].label}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-center gap-2">
              <label className="text-xs font-semibold text-gray-600">Priority:</label>
              <select
                value={priorityFilter}
                onChange={e => setPriorityFilter(e.target.value)}
                className="px-3 py-1.5 rounded border border-gray-300 text-sm"
              >
                <option value="all">All Priorities</option>
                {['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'].map(p => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Item list */}
        <div className="space-y-3">
          {loading && displayed.length === 0 && (
            <div className="text-center py-12 text-gray-500">
              <div className="animate-pulse">Loading items...</div>
            </div>
          )}

          {!loading && displayed.length === 0 && (
            <div className="text-center py-12 text-gray-500">
              <p>No items match your filters</p>
              <p className="text-xs mt-2">
                {items.length === 0 ? 'Inbox is empty — all caught up!' : 'Try adjusting filters'}
              </p>
            </div>
          )}

          {displayed.map(item => {
            const typeInfo = TYPE_LABELS[item.type] || { label: item.type, emoji: '📌' }
            const priorityStyle = PRIORITY_STYLES[item.priority] || PRIORITY_STYLES.MEDIUM
            const dueDateInfo = fmtDueDate(item.dueBy)
            const isActing = actingItemId === item.id
            const isLoading = isActing && (action === 'approve' || action === 'reject')

            return (
              <div
                key={item.id}
                className="rounded-lg border-l-4 bg-white p-4 shadow-sm hover:shadow-md transition"
                style={{ borderLeftColor: priorityStyle.color }}
              >
                <div className="flex items-start gap-4">
                  {/* Left: Priority indicator + Type */}
                  <div className="flex-shrink-0 flex flex-col items-center gap-2">
                    <div
                      className="w-3 h-3 rounded-full"
                      style={{ backgroundColor: priorityStyle.color }}
                    />
                    <span className="text-2xl">{typeInfo.emoji}</span>
                  </div>

                  {/* Center: Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <h3 className="text-sm font-semibold text-gray-900 truncate">{item.title}</h3>
                        <span
                          className="px-2 py-0.5 text-xs font-semibold rounded-full text-white"
                          style={{ backgroundColor: priorityStyle.color }}
                        >
                          {item.priority}
                        </span>
                        {item.financialImpact && item.financialImpact > 0 && (
                          <span
                            className="px-2 py-0.5 text-xs font-bold rounded-full text-white"
                            style={{ backgroundColor: ABEL_COLORS.amber }}
                          >
                            {fmtCurrency(item.financialImpact)}
                          </span>
                        )}
                      </div>
                      <span className="text-xs text-gray-500 flex-shrink-0 ml-2">
                        {fmtDate(item.createdAt)}
                      </span>
                    </div>

                    {item.description && (
                      <p className="text-xs text-gray-600 mb-2 line-clamp-2">{item.description}</p>
                    )}

                    <div className="flex items-center gap-3 text-xs text-gray-500">
                      <span>{typeInfo.label}</span>
                      <span>•</span>
                      <span>From {item.source}</span>
                      {dueDateInfo.text && (
                        <>
                          <span>•</span>
                          <span
                            style={{
                              color: dueDateInfo.isOverdue ? '#DC2626' : '#6B7280',
                              fontWeight: dueDateInfo.isOverdue ? 600 : 400,
                            }}
                          >
                            {dueDateInfo.text}
                          </span>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Right: Actions */}
                  <div className="flex-shrink-0 flex flex-col gap-2">
                    {item.status === 'PENDING' && (
                      <>
                        <button
                          onClick={() => handleAction(item.id, 'APPROVE')}
                          disabled={isLoading}
                          className="px-3 py-1.5 rounded text-xs font-semibold text-white transition disabled:opacity-50"
                          style={{ backgroundColor: ABEL_COLORS.green }}
                        >
                          {isLoading && action === 'approve' ? '...' : '✓ Approve'}
                        </button>
                        <button
                          onClick={() => setShowingRejectDialog(item.id)}
                          disabled={isLoading}
                          className="px-3 py-1.5 rounded text-xs font-semibold text-white bg-red-600 hover:bg-red-700 transition disabled:opacity-50"
                        >
                          ✗ Reject
                        </button>
                        <button
                          onClick={() => setShowingSnoozeDialog(item.id)}
                          disabled={isLoading}
                          className="px-3 py-1.5 rounded text-xs font-semibold text-gray-700 bg-gray-200 hover:bg-gray-300 transition disabled:opacity-50"
                        >
                          💤 Snooze
                        </button>
                      </>
                    )}

                    {item.status === 'APPROVED' && (
                      <span className="px-2 py-1 rounded-full bg-green-100 text-green-700 text-xs font-semibold">
                        ✓ Approved
                      </span>
                    )}

                    {item.status === 'REJECTED' && (
                      <span className="px-2 py-1 rounded-full bg-red-100 text-red-700 text-xs font-semibold">
                        ✗ Rejected
                      </span>
                    )}

                    {item.status === 'SNOOZED' && (
                      <span className="px-2 py-1 rounded-full bg-gray-100 text-gray-700 text-xs font-semibold">
                        💤 Snoozed
                      </span>
                    )}
                  </div>
                </div>

                {/* Reject dialog */}
                {showingRejectDialog === item.id && (
                  <div className="mt-4 border-t pt-4">
                    <p className="text-xs font-semibold text-gray-700 mb-2">Reason for rejection:</p>
                    <textarea
                      value={rejectReason}
                      onChange={e => setRejectReason(e.target.value)}
                      placeholder="Optional reason..."
                      className="w-full px-3 py-2 text-sm border border-gray-300 rounded mb-3 resize-none"
                      rows={2}
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleAction(item.id, 'REJECT', { reason: rejectReason })}
                        className="flex-1 px-3 py-1.5 rounded text-xs font-semibold text-white bg-red-600 hover:bg-red-700 transition"
                      >
                        Confirm Rejection
                      </button>
                      <button
                        onClick={() => {
                          setShowingRejectDialog(null)
                          setRejectReason('')
                        }}
                        className="flex-1 px-3 py-1.5 rounded text-xs font-semibold text-gray-700 bg-gray-200 hover:bg-gray-300 transition"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}

                {/* Snooze dialog */}
                {showingSnoozeDialog === item.id && (
                  <div className="mt-4 border-t pt-4">
                    <p className="text-xs font-semibold text-gray-700 mb-2">Snooze until:</p>
                    <select
                      value={snoozeDuration}
                      onChange={e => setSnoozeDuration(e.target.value)}
                      className="w-full px-3 py-2 text-sm border border-gray-300 rounded mb-3"
                    >
                      <option value="1h">1 hour</option>
                      <option value="4h">4 hours</option>
                      <option value="1d">1 day</option>
                    </select>
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleAction(item.id, 'SNOOZE', { duration: snoozeDuration })}
                        className="flex-1 px-3 py-1.5 rounded text-xs font-semibold text-white bg-gray-600 hover:bg-gray-700 transition"
                      >
                        Snooze
                      </button>
                      <button
                        onClick={() => {
                          setShowingSnoozeDialog(null)
                          setSnoozeDuration('1h')
                        }}
                        className="flex-1 px-3 py-1.5 rounded text-xs font-semibold text-gray-700 bg-gray-200 hover:bg-gray-300 transition"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
