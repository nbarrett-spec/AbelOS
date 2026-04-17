'use client'

import { useEffect, useState, useCallback } from 'react'

// ──────────────────────────────────────────────────────────────────────────
// Unified Operator Inbox
//
// Aggregates all inbound signals an operator needs to act on:
//   1. Notifications (system alerts, approval requests, task assignments)
//   2. Builder messages (portal chat from builders)
//   3. Communication logs (synced Gmail emails, inbound SMS)
//   4. Internal messages (staff-to-staff)
//   5. Agent tasks (AI-generated actions needing approval)
//
// Each source has its own API; this page fetches them all in parallel and
// presents a unified, time-sorted stream with quick-action buttons.
// ──────────────────────────────────────────────────────────────────────────

interface InboxItem {
  id: string
  type: 'notification' | 'builder_message' | 'email' | 'sms' | 'internal' | 'agent_task'
  title: string
  preview: string
  from: string
  fromType: string
  timestamp: string
  read: boolean
  priority: 'low' | 'normal' | 'high' | 'urgent'
  actionUrl?: string
  entityId?: string
  meta?: Record<string, any>
}

const TYPE_LABELS: Record<string, { label: string; color: string; bg: string }> = {
  notification: { label: 'Alert', color: '#7C3AED', bg: '#F3E8FF' },
  builder_message: { label: 'Builder', color: '#2563EB', bg: '#DBEAFE' },
  email: { label: 'Email', color: '#059669', bg: '#D1FAE5' },
  sms: { label: 'SMS', color: '#D97706', bg: '#FEF3C7' },
  internal: { label: 'Staff', color: '#4B5563', bg: '#F3F4F6' },
  agent_task: { label: 'AI Task', color: '#DC2626', bg: '#FEE2E2' },
}

const PRIORITY_COLORS: Record<string, string> = {
  urgent: '#DC2626',
  high: '#EA580C',
  normal: '#6B7280',
  low: '#9CA3AF',
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

export default function InboxPage() {
  const [items, setItems] = useState<InboxItem[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<string>('all')
  const [search, setSearch] = useState('')
  const [unreadOnly, setUnreadOnly] = useState(false)

  const loadInbox = useCallback(async () => {
    setLoading(true)
    try {
      const [notifs, builderMsgs, commLogs, internalMsgs, agentTasks] = await Promise.allSettled([
        fetch('/api/ops/notifications?limit=50').then(r => r.ok ? r.json() : { notifications: [] }),
        fetch('/api/ops/builder-messages?limit=50').then(r => r.ok ? r.json() : { messages: [] }),
        fetch('/api/ops/communication-logs?limit=50&channel=EMAIL').then(r => r.ok ? r.json() : { logs: [] }),
        fetch('/api/ops/messages?limit=50').then(r => r.ok ? r.json() : { messages: [] }),
        fetch('/api/ops/ai/tasks?status=PENDING&limit=30').then(r => r.ok ? r.json() : { tasks: [] }),
      ])

      const inbox: InboxItem[] = []

      // Notifications
      const nData = notifs.status === 'fulfilled' ? notifs.value : { notifications: [] }
      for (const n of (nData.notifications || [])) {
        inbox.push({
          id: `notif-${n.id}`,
          type: 'notification',
          title: n.title || 'Notification',
          preview: n.body || n.message || '',
          from: 'System',
          fromType: n.type || 'INFO',
          timestamp: n.createdAt,
          read: n.readAt != null,
          priority: n.type === 'URGENT' ? 'urgent' : n.type === 'WARNING' ? 'high' : 'normal',
          actionUrl: n.actionUrl,
          entityId: n.id,
        })
      }

      // Builder messages
      const bmData = builderMsgs.status === 'fulfilled' ? builderMsgs.value : { messages: [] }
      for (const m of (bmData.messages || [])) {
        inbox.push({
          id: `bm-${m.id}`,
          type: 'builder_message',
          title: m.companyName || m.builderName || 'Builder',
          preview: m.message || m.content || m.body || '',
          from: m.builderName || m.companyName || 'Unknown Builder',
          fromType: 'builder',
          timestamp: m.createdAt || m.sentAt,
          read: m.readAt != null || m.status === 'READ',
          priority: 'normal',
          actionUrl: m.builderId ? `/ops/accounts/${m.builderId}` : undefined,
          entityId: m.id,
        })
      }

      // Communication logs (emails)
      const clData = commLogs.status === 'fulfilled' ? commLogs.value : { logs: [] }
      for (const l of (clData.logs || [])) {
        if (l.direction === 'OUTBOUND') continue // Only show inbound
        inbox.push({
          id: `cl-${l.id}`,
          type: l.channel === 'SMS' ? 'sms' : 'email',
          title: l.subject || '(No subject)',
          preview: (l.body || l.snippet || '').slice(0, 200),
          from: l.fromAddress || l.phoneNumber || 'Unknown',
          fromType: l.channel || 'EMAIL',
          timestamp: l.sentAt || l.createdAt,
          read: l.status === 'ARCHIVED' || l.status === 'FOLLOWED_UP',
          priority: l.status === 'NEEDS_FOLLOW_UP' ? 'high' : 'normal',
          actionUrl: l.builderId ? `/ops/accounts/${l.builderId}` : undefined,
          entityId: l.id,
          meta: { builderId: l.builderId, channel: l.channel },
        })
      }

      // Internal messages
      const imData = internalMsgs.status === 'fulfilled' ? internalMsgs.value : { messages: [] }
      for (const m of (imData.messages || [])) {
        inbox.push({
          id: `im-${m.id}`,
          type: 'internal',
          title: m.subject || 'Message',
          preview: m.body || m.content || '',
          from: m.senderName || m.senderId || 'Staff',
          fromType: 'staff',
          timestamp: m.createdAt || m.sentAt,
          read: m.readAt != null,
          priority: m.priority === 'URGENT' ? 'urgent' : m.priority === 'HIGH' ? 'high' : 'normal',
          entityId: m.id,
        })
      }

      // Agent tasks needing approval
      const atData = agentTasks.status === 'fulfilled' ? agentTasks.value : { tasks: [] }
      for (const t of (atData.tasks || [])) {
        inbox.push({
          id: `at-${t.id}`,
          type: 'agent_task',
          title: t.title || 'AI Task',
          preview: t.description || '',
          from: t.agentRole || 'AI Agent',
          fromType: 'agent',
          timestamp: t.createdAt,
          read: t.status !== 'PENDING',
          priority: t.priority === 'HIGH' || t.priority === 'CRITICAL' ? 'urgent' : 'high',
          actionUrl: '/ops/command-center',
          entityId: t.id,
          meta: { taskType: t.taskType, requiresApproval: t.requiresApproval },
        })
      }

      // Sort by timestamp descending
      inbox.sort((a, b) => {
        if (!a.timestamp) return 1
        if (!b.timestamp) return -1
        return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      })

      setItems(inbox)
    } catch (err) {
      console.error('[Inbox] Failed to load:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadInbox()
    const t = setInterval(loadInbox, 60_000) // Refresh every minute
    return () => clearInterval(t)
  }, [loadInbox])

  const filtered = items.filter(item => {
    if (filter !== 'all' && item.type !== filter) return false
    if (unreadOnly && item.read) return false
    if (search) {
      const q = search.toLowerCase()
      return (
        item.title.toLowerCase().includes(q) ||
        item.preview.toLowerCase().includes(q) ||
        item.from.toLowerCase().includes(q)
      )
    }
    return true
  })

  const unreadCount = items.filter(i => !i.read).length
  const urgentCount = items.filter(i => i.priority === 'urgent' && !i.read).length
  const typeCounts = items.reduce<Record<string, number>>((acc, i) => {
    acc[i.type] = (acc[i.type] || 0) + 1
    return acc
  }, {})

  const FILTERS = [
    { key: 'all', label: 'All' },
    { key: 'notification', label: 'Alerts' },
    { key: 'builder_message', label: 'Builders' },
    { key: 'email', label: 'Email' },
    { key: 'sms', label: 'SMS' },
    { key: 'internal', label: 'Staff' },
    { key: 'agent_task', label: 'AI Tasks' },
  ]

  return (
    <div className="max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Inbox</h1>
          <p className="text-sm text-gray-500 mt-1">
            {unreadCount > 0 ? (
              <>
                <span className="font-semibold text-blue-700">{unreadCount} unread</span>
                {urgentCount > 0 && (
                  <span className="ml-2 font-semibold text-red-700">{urgentCount} urgent</span>
                )}
              </>
            ) : (
              'All caught up'
            )}
          </p>
        </div>
        <button
          onClick={loadInbox}
          className="px-4 py-2 bg-[#1B4F72] text-white rounded-lg hover:bg-[#1B4F72]/90 text-sm font-medium"
        >
          Refresh
        </button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-6 gap-3 mb-6">
        {FILTERS.slice(1).map(f => {
          const count = typeCounts[f.key] || 0
          const meta = TYPE_LABELS[f.key]
          return (
            <button
              key={f.key}
              onClick={() => setFilter(filter === f.key ? 'all' : f.key)}
              className={`rounded-lg border p-3 text-center transition ${
                filter === f.key
                  ? 'border-blue-500 bg-blue-50'
                  : 'border-gray-200 bg-white hover:bg-gray-50'
              }`}
            >
              <div className="text-2xl font-bold" style={{ color: meta.color }}>{count}</div>
              <div className="text-xs text-gray-600 mt-1">{f.label}</div>
            </button>
          )
        })}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 mb-4">
        <input
          placeholder="Search messages..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="px-3 py-2 rounded-lg border border-gray-300 text-sm flex-1 max-w-xs"
        />
        <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
          <input
            type="checkbox"
            checked={unreadOnly}
            onChange={e => setUnreadOnly(e.target.checked)}
            className="rounded"
          />
          Unread only
        </label>
        <div className="flex gap-1 ml-auto">
          {FILTERS.map(f => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`px-3 py-1.5 rounded text-xs font-medium transition ${
                filter === f.key
                  ? 'bg-[#1B4F72] text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Message list */}
      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden divide-y divide-gray-100">
        {loading && items.length === 0 && (
          <div className="px-4 py-12 text-center text-gray-500">Loading inbox...</div>
        )}

        {!loading && filtered.length === 0 && (
          <div className="px-4 py-12 text-center text-gray-500">
            {items.length === 0 ? 'Inbox is empty' : 'No messages match your filters'}
          </div>
        )}

        {filtered.map(item => {
          const meta = TYPE_LABELS[item.type]
          return (
            <div
              key={item.id}
              className={`px-4 py-3 flex items-start gap-3 hover:bg-gray-50 transition cursor-pointer ${
                !item.read ? 'bg-blue-50/40' : ''
              }`}
              onClick={() => {
                if (item.actionUrl) window.location.href = item.actionUrl
              }}
            >
              {/* Unread dot */}
              <div className="mt-2 flex-shrink-0 w-2">
                {!item.read && (
                  <div className="w-2 h-2 rounded-full bg-blue-600" />
                )}
              </div>

              {/* Type badge */}
              <div className="flex-shrink-0 mt-0.5">
                <span
                  className="inline-flex px-2 py-0.5 text-[10px] font-semibold rounded"
                  style={{ color: meta.color, backgroundColor: meta.bg }}
                >
                  {meta.label}
                </span>
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className={`text-sm ${!item.read ? 'font-semibold text-gray-900' : 'font-medium text-gray-700'}`}>
                    {item.title}
                  </span>
                  {item.priority === 'urgent' && (
                    <span className="px-1.5 py-0.5 text-[9px] font-bold rounded bg-red-100 text-red-700">
                      URGENT
                    </span>
                  )}
                  {item.priority === 'high' && (
                    <span className="px-1.5 py-0.5 text-[9px] font-bold rounded bg-orange-100 text-orange-700">
                      HIGH
                    </span>
                  )}
                </div>
                <p className="text-xs text-gray-500 mt-0.5 truncate">{item.preview}</p>
              </div>

              {/* From + time */}
              <div className="flex-shrink-0 text-right">
                <div className="text-xs text-gray-600">{item.from}</div>
                <div className="text-[10px] text-gray-400 mt-0.5">{fmtDate(item.timestamp)}</div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
