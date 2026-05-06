'use client'

/**
 * Ops Inbox — internal staff inbox for BUILDER_SUPPORT threads.
 *
 * Two-column layout:
 *   - Left:  thread list (filter: All / Unread / Mine), 30s poll
 *   - Right: message detail with reply composer; infinite-scroll older messages
 *
 * Compose: pick builder + subject + first message → POST /api/ops/builder-chat/start.
 */

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { Inbox, MessageSquare, Plus, Send, X, Search } from 'lucide-react'
import { useStaffAuth } from '@/hooks/useStaffAuth'
import EmptyState from '@/components/ui/EmptyState'
import PageHeader from '@/components/ui/PageHeader'
import Badge from '@/components/ui/Badge'
import Button from '@/components/ui/Button'

// ── Types ────────────────────────────────────────────────────────────────

interface Thread {
  id: string
  builderId: string | null
  subject: string | null
  type: string
  lastMessageAt: string | null
  lastMessagePreview: string | null
  companyName: string | null
  contactName: string | null
  participantCount: number
  unreadCount: number
}

interface ThreadMessage {
  id: string
  body: string
  createdAt: string
  readBy: string[]
  senderType: 'STAFF' | 'BUILDER'
  builderSenderId: string | null
  builderSenderName: string | null
  sender: {
    id: string
    firstName: string
    lastName: string
    role: string
    department: string
  } | null
}

interface BuilderOption {
  id: string
  companyName: string
  contactName: string
}

type FilterTab = 'all' | 'unread' | 'mine'

const POLL_MS = 30_000
const PAGE_SIZE = 50

// ── Helpers ──────────────────────────────────────────────────────────────

function relTime(iso: string | null): string {
  if (!iso) return ''
  const ms = Date.now() - new Date(iso).getTime()
  const min = Math.floor(ms / 60_000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min}m`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h`
  const d = Math.floor(hr / 24)
  if (d < 7) return `${d}d`
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function fullTime(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function senderLabel(m: ThreadMessage): string {
  if (m.senderType === 'BUILDER') return m.builderSenderName || 'Builder'
  if (m.sender) return `${m.sender.firstName} ${m.sender.lastName}`
  return 'Unknown'
}

function getInitials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(w => w[0])
    .join('')
    .toUpperCase()
}

// ── Page ─────────────────────────────────────────────────────────────────

export default function OpsInboxPage() {
  const { staff, loading: authLoading } = useStaffAuth()
  const staffId = staff?.id || ''

  const [threads, setThreads] = useState<Thread[]>([])
  const [threadsLoading, setThreadsLoading] = useState(true)
  const [threadsError, setThreadsError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [filter, setFilter] = useState<FilterTab>('all')
  const [searchQuery, setSearchQuery] = useState('')

  const [messages, setMessages] = useState<ThreadMessage[]>([])
  const [messagesLoading, setMessagesLoading] = useState(false)
  const [messagesError, setMessagesError] = useState<string | null>(null)
  const [hasMoreOlder, setHasMoreOlder] = useState(false)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [totalMessages, setTotalMessages] = useState(0)

  const [replyText, setReplyText] = useState('')
  const [sending, setSending] = useState(false)
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null)

  const [composeOpen, setComposeOpen] = useState(false)

  const composerRef = useRef<HTMLTextAreaElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const skipLoadedRef = useRef(0)

  // ── Toasts ────────────────────────────────────────────────────────────
  const showToast = useCallback((msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 3500)
  }, [])

  // ── Fetch threads (with 30s polling) ──────────────────────────────────
  const fetchThreads = useCallback(async () => {
    if (!staffId) return
    try {
      setThreadsError(null)
      const params = new URLSearchParams({ staffId })
      if (searchQuery.trim()) params.set('search', searchQuery.trim())
      if (filter === 'mine') params.set('mine', 'true')
      const res = await fetch(`/api/ops/builder-chat?${params}`, { credentials: 'include' })
      if (!res.ok) {
        throw new Error(`Failed to load threads (${res.status})`)
      }
      const data = await res.json()
      setThreads(data.conversations || [])
    } catch (e: any) {
      setThreadsError(e?.message || 'Failed to load threads')
    } finally {
      setThreadsLoading(false)
    }
  }, [staffId, searchQuery, filter])

  useEffect(() => {
    if (!staffId) return
    fetchThreads()
    const t = setInterval(fetchThreads, POLL_MS)
    return () => clearInterval(t)
  }, [staffId, fetchThreads])

  // ── Filter threads client-side ────────────────────────────────────────
  // 'mine' is server-side via ?mine=true. 'unread' is local for snappy toggling
  // (the server already returns the data; client-filter avoids a roundtrip).
  const visibleThreads = useMemo(() => {
    if (filter === 'unread') return threads.filter(t => t.unreadCount > 0)
    return threads
  }, [threads, filter])

  const unreadTabCount = useMemo(
    () => threads.filter(t => t.unreadCount > 0).length,
    [threads]
  )

  // ── Selected thread ──────────────────────────────────────────────────
  const selected = useMemo(
    () => threads.find(t => t.id === selectedId) || null,
    [threads, selectedId]
  )

  // ── Load messages for selected thread ─────────────────────────────────
  const loadMessages = useCallback(
    async (conversationId: string, opts?: { older?: boolean }) => {
      if (!staffId) return
      try {
        if (opts?.older) {
          setLoadingOlder(true)
        } else {
          setMessagesLoading(true)
          setMessagesError(null)
          skipLoadedRef.current = 0
        }
        const skip = opts?.older ? skipLoadedRef.current : 0
        const params = new URLSearchParams({
          staffId,
          skip: String(skip),
          take: String(PAGE_SIZE),
        })
        const res = await fetch(
          `/api/ops/messages/${conversationId}?${params}`,
          { credentials: 'include' }
        )
        if (!res.ok) throw new Error(`Failed to load messages (${res.status})`)
        const data = await res.json()
        const incoming: ThreadMessage[] = (data.messages || []).map((m: any) => ({
          id: m.id,
          body: m.body,
          createdAt: m.createdAt,
          readBy: m.readBy || [],
          senderType: m.senderType || 'STAFF',
          builderSenderId: m.builderSenderId || null,
          builderSenderName: m.builderSenderName || null,
          sender: m.sender || null,
        }))
        setTotalMessages(data.pagination?.total || incoming.length)
        if (opts?.older) {
          setMessages(prev => [...incoming, ...prev])
        } else {
          setMessages(incoming)
          // After initial load, scroll to bottom
          requestAnimationFrame(() => {
            const el = scrollRef.current
            if (el) el.scrollTop = el.scrollHeight
          })
        }
        skipLoadedRef.current += incoming.length
        setHasMoreOlder(skipLoadedRef.current < (data.pagination?.total || 0))

        // Reading messages decrements unread — refresh thread list
        if (!opts?.older) {
          fetchThreads()
        }
      } catch (e: any) {
        setMessagesError(e?.message || 'Failed to load messages')
      } finally {
        setMessagesLoading(false)
        setLoadingOlder(false)
      }
    },
    [staffId, fetchThreads]
  )

  // When user picks a thread → load + autofocus composer
  useEffect(() => {
    if (!selectedId) {
      setMessages([])
      return
    }
    loadMessages(selectedId)
    // autofocus composer
    requestAnimationFrame(() => composerRef.current?.focus())
  }, [selectedId, loadMessages])

  // Poll messages for selected thread every 30s
  useEffect(() => {
    if (!selectedId) return
    const t = setInterval(() => {
      loadMessages(selectedId)
    }, POLL_MS)
    return () => clearInterval(t)
  }, [selectedId, loadMessages])

  // Infinite-scroll older: when user scrolls near the top, load older
  useEffect(() => {
    const el = scrollRef.current
    if (!el || !selectedId) return
    function onScroll() {
      if (!el || loadingOlder || !hasMoreOlder) return
      if (el.scrollTop < 100) {
        const prevHeight = el.scrollHeight
        loadMessages(selectedId!, { older: true }).then(() => {
          // Preserve scroll position after older-prepend
          requestAnimationFrame(() => {
            const newHeight = el.scrollHeight
            el.scrollTop = newHeight - prevHeight
          })
        })
      }
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [selectedId, hasMoreOlder, loadingOlder, loadMessages])

  // ── Send reply ───────────────────────────────────────────────────────
  const handleSend = useCallback(async () => {
    if (!selectedId || !staffId || !replyText.trim() || sending) return
    setSending(true)
    const text = replyText.trim()
    try {
      const res = await fetch('/api/ops/builder-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          conversationId: selectedId,
          staffId,
          message: text,
        }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err?.error || 'Failed to send')
      }
      setReplyText('')
      // Reload thread + threads list
      await loadMessages(selectedId)
      composerRef.current?.focus()
    } catch (e: any) {
      showToast(e?.message || 'Failed to send', 'error')
    } finally {
      setSending(false)
    }
  }, [selectedId, staffId, replyText, sending, loadMessages, showToast])

  const onComposerKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  // ── Render ───────────────────────────────────────────────────────────
  if (authLoading) {
    return <div className="text-fg-muted text-sm p-8">Loading...</div>
  }
  if (!staff) {
    return <div className="text-fg-muted text-sm p-8">Sign in to use the inbox.</div>
  }

  const totalUnread = threads.reduce((s, t) => s + t.unreadCount, 0)

  return (
    <div className="h-[calc(100vh-9rem)] flex flex-col">
      {toast && (
        <div
          className={`fixed top-4 right-4 z-50 px-5 py-3 rounded-lg shadow-lg text-white text-sm font-medium ${
            toast.type === 'success' ? 'bg-green-600' : 'bg-red-600'
          }`}
        >
          {toast.msg}
        </div>
      )}

      <PageHeader
        title="Inbox"
        description="Builder support threads. Reply, assign, and follow up."
        actions={
          <>
            {totalUnread > 0 && (
              <Badge variant="danger" size="md">{totalUnread} unread</Badge>
            )}
            <Button onClick={() => setComposeOpen(true)} size="sm">
              <Plus className="w-3.5 h-3.5" />
              New Message
            </Button>
          </>
        }
      />

      {/* ── Two-column layout ─────────────────────────────────────────── */}
      <div className="flex gap-4 flex-1 min-h-0">
        {/* Left: thread list */}
        <div className="w-96 bg-surface-elev rounded-lg border border-border flex flex-col min-h-0">
          {/* Filter tabs */}
          <div className="flex border-b border-border">
            {(['all', 'unread', 'mine'] as FilterTab[]).map(tab => (
              <button
                key={tab}
                onClick={() => setFilter(tab)}
                className={`flex-1 py-2.5 px-3 text-xs font-semibold uppercase tracking-wide transition-colors border-b-2 ${
                  filter === tab
                    ? 'border-signal text-signal'
                    : 'border-transparent text-fg-muted hover:text-fg'
                }`}
              >
                {tab} {tab === 'unread' && unreadTabCount > 0 && (
                  <span className="ml-1 text-data-negative">({unreadTabCount})</span>
                )}
              </button>
            ))}
          </div>

          {/* Search */}
          <div className="p-3 border-b border-border">
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-subtle" />
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Search builder or subject…"
                className="w-full pl-8 pr-3 py-1.5 text-sm border border-border rounded-md bg-surface-elev focus:outline-none focus:ring-2 focus:ring-signal/30 focus:border-signal"
              />
            </div>
          </div>

          {/* Thread list */}
          <div className="flex-1 overflow-y-auto">
            {threadsLoading ? (
              <div className="p-6 text-center text-fg-muted text-sm">Loading threads…</div>
            ) : threadsError ? (
              <div className="p-4 m-3 rounded border border-data-negative-bg bg-data-negative-bg/30 text-data-negative-fg text-xs">
                {threadsError}
                <button
                  onClick={fetchThreads}
                  className="block mt-2 text-data-negative underline"
                >
                  Retry
                </button>
              </div>
            ) : visibleThreads.length === 0 ? (
              <EmptyState
                size="compact"
                icon={<Inbox className="w-6 h-6 text-fg-subtle" />}
                title={filter === 'unread' ? 'No unread threads' : 'No threads'}
                description={
                  filter === 'unread'
                    ? 'You are all caught up.'
                    : 'Builder support conversations will appear here.'
                }
              />
            ) : (
              visibleThreads.map(t => {
                const name = t.companyName || 'Unknown Builder'
                const isActive = selectedId === t.id
                const isUnread = t.unreadCount > 0
                return (
                  <button
                    key={t.id}
                    onClick={() => setSelectedId(t.id)}
                    className={`w-full text-left p-3 border-b border-border transition-colors ${
                      isActive
                        ? 'bg-signal-subtle'
                        : 'hover:bg-row-hover'
                    } ${isUnread && !isActive ? 'bg-data-info-bg/40' : ''}`}
                  >
                    <div className="flex items-start gap-2">
                      {isUnread && (
                        <span
                          className="w-2 h-2 mt-2 rounded-full bg-signal flex-shrink-0"
                          aria-label="unread"
                        />
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-baseline justify-between gap-2">
                          <h3 className={`text-sm truncate ${isUnread ? 'font-bold text-fg' : 'font-medium text-fg'}`}>
                            {name}
                          </h3>
                          <span className="text-xs text-fg-subtle flex-shrink-0">
                            {relTime(t.lastMessageAt)}
                          </span>
                        </div>
                        {t.subject && (
                          <p className={`text-xs mt-0.5 truncate ${isUnread ? 'text-fg' : 'text-fg-muted'}`}>
                            {t.subject}
                          </p>
                        )}
                        {t.lastMessagePreview && (
                          <p className="text-xs text-fg-subtle mt-0.5 line-clamp-1">
                            {t.lastMessagePreview}
                          </p>
                        )}
                      </div>
                      {t.unreadCount > 0 && (
                        <Badge variant="danger" size="xs">
                          {t.unreadCount > 99 ? '99+' : t.unreadCount}
                        </Badge>
                      )}
                    </div>
                  </button>
                )
              })
            )}
          </div>
        </div>

        {/* Right: detail pane */}
        <div className="flex-1 bg-surface-elev rounded-lg border border-border flex flex-col min-h-0">
          {!selected ? (
            <div className="flex items-center justify-center h-full text-fg-muted">
              <div className="text-center">
                <MessageSquare className="w-10 h-10 mx-auto text-fg-subtle mb-3" />
                <p className="text-sm font-medium">Select a thread</p>
                <p className="text-xs mt-1 text-fg-subtle">
                  Pick a builder support conversation from the list to view and reply.
                </p>
              </div>
            </div>
          ) : (
            <>
              {/* Thread header */}
              <div className="px-5 py-3 border-b border-border flex items-center justify-between">
                <div className="min-w-0 flex-1">
                  <h2 className="font-semibold text-fg truncate">
                    {selected.companyName || 'Unknown Builder'}
                  </h2>
                  <p className="text-xs text-fg-muted truncate">
                    {selected.subject || 'No subject'}
                    {selected.contactName && (
                      <span className="text-fg-subtle"> &middot; {selected.contactName}</span>
                    )}
                  </p>
                </div>
                <Badge variant="neutral" size="sm">
                  {totalMessages} {totalMessages === 1 ? 'message' : 'messages'}
                </Badge>
              </div>

              {/* Messages */}
              <div ref={scrollRef} className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
                {hasMoreOlder && (
                  <div className="text-center py-2">
                    {loadingOlder ? (
                      <span className="text-xs text-fg-subtle">Loading older…</span>
                    ) : (
                      <button
                        onClick={() => selectedId && loadMessages(selectedId, { older: true })}
                        className="text-xs text-fg-muted hover:text-fg underline"
                      >
                        Load older messages
                      </button>
                    )}
                  </div>
                )}

                {messagesLoading && messages.length === 0 ? (
                  <div className="text-center text-fg-muted text-sm py-8">Loading…</div>
                ) : messagesError ? (
                  <div className="p-4 rounded border border-data-negative-bg bg-data-negative-bg/30 text-data-negative-fg text-sm">
                    {messagesError}
                    <button
                      onClick={() => selectedId && loadMessages(selectedId)}
                      className="ml-2 underline"
                    >
                      Retry
                    </button>
                  </div>
                ) : messages.length === 0 ? (
                  <EmptyState
                    size="compact"
                    icon={<MessageSquare className="w-6 h-6 text-fg-subtle" />}
                    title="No messages yet"
                    description="Send the first reply to start the conversation."
                  />
                ) : (
                  messages.map(m => {
                    const isStaff = m.senderType === 'STAFF'
                    const name = senderLabel(m)
                    return (
                      <div key={m.id} className="flex gap-3">
                        <div
                          className={`w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 text-white text-xs font-semibold ${
                            isStaff ? 'bg-signal' : 'bg-data-info'
                          }`}
                          aria-hidden
                        >
                          {getInitials(name)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-baseline gap-2 flex-wrap">
                            <span className="text-sm font-semibold text-fg">{name}</span>
                            <Badge variant={isStaff ? 'neutral' : 'info'} size="xs">
                              {isStaff ? 'Staff' : 'Builder'}
                            </Badge>
                            {isStaff && m.sender?.role && (
                              <span className="text-xs text-fg-subtle">{m.sender.role}</span>
                            )}
                            <span className="text-xs text-fg-subtle">{fullTime(m.createdAt)}</span>
                          </div>
                          <p className="text-sm text-fg mt-1 whitespace-pre-wrap break-words">
                            {m.body}
                          </p>
                        </div>
                      </div>
                    )
                  })
                )}
              </div>

              {/* Composer */}
              <div className="border-t border-border p-3">
                <div className="flex items-end gap-2">
                  <textarea
                    ref={composerRef}
                    value={replyText}
                    onChange={e => setReplyText(e.target.value)}
                    onKeyDown={onComposerKeyDown}
                    placeholder="Reply to builder… (Enter to send, Shift+Enter for newline)"
                    rows={2}
                    className="flex-1 px-3 py-2 text-sm border border-border rounded-md bg-surface-elev focus:outline-none focus:ring-2 focus:ring-signal/30 focus:border-signal resize-none"
                  />
                  <Button
                    onClick={handleSend}
                    disabled={!replyText.trim() || sending}
                    size="sm"
                  >
                    <Send className="w-3.5 h-3.5" />
                    {sending ? 'Sending…' : 'Send'}
                  </Button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Compose new message modal */}
      {composeOpen && (
        <ComposeModal
          staffId={staffId}
          onClose={() => setComposeOpen(false)}
          onCreated={(conversationId) => {
            setComposeOpen(false)
            fetchThreads()
            setSelectedId(conversationId)
            showToast('Thread started')
          }}
          showToast={showToast}
        />
      )}
    </div>
  )
}

// ── Compose Modal ────────────────────────────────────────────────────────

function ComposeModal({
  staffId,
  onClose,
  onCreated,
  showToast,
}: {
  staffId: string
  onClose: () => void
  onCreated: (conversationId: string) => void
  showToast: (msg: string, type?: 'success' | 'error') => void
}) {
  const [builders, setBuilders] = useState<BuilderOption[]>([])
  const [builderQuery, setBuilderQuery] = useState('')
  const [selectedBuilder, setSelectedBuilder] = useState<BuilderOption | null>(null)
  const [subject, setSubject] = useState('')
  const [message, setMessage] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [loadingBuilders, setLoadingBuilders] = useState(false)
  const messageRef = useRef<HTMLTextAreaElement>(null)

  // Load builders
  useEffect(() => {
    let active = true
    async function loadBuilders() {
      setLoadingBuilders(true)
      try {
        const params = new URLSearchParams({ limit: '50' })
        if (builderQuery.trim()) params.set('search', builderQuery.trim())
        const res = await fetch(`/api/ops/builders?${params}`, { credentials: 'include' })
        if (!res.ok) throw new Error()
        const data = await res.json()
        const list = (data.builders || data || []).map((b: any) => ({
          id: b.id,
          companyName: b.companyName || 'Unnamed',
          contactName: b.contactName || '',
        }))
        if (active) setBuilders(list)
      } catch {
        if (active) setBuilders([])
      } finally {
        if (active) setLoadingBuilders(false)
      }
    }
    const t = setTimeout(loadBuilders, 200)
    return () => {
      active = false
      clearTimeout(t)
    }
  }, [builderQuery])

  // Autofocus message after picking a builder
  useEffect(() => {
    if (selectedBuilder && messageRef.current) {
      requestAnimationFrame(() => messageRef.current?.focus())
    }
  }, [selectedBuilder])

  const handleSubmit = async () => {
    if (!selectedBuilder || !subject.trim() || !message.trim() || submitting || !staffId) return
    setSubmitting(true)
    try {
      const res = await fetch('/api/ops/builder-chat/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          builderId: selectedBuilder.id,
          subject: subject.trim(),
          message: message.trim(),
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data?.conversationId) {
        throw new Error(data?.error || 'Failed to start thread')
      }
      onCreated(data.conversationId)
    } catch (e: any) {
      showToast(e?.message || 'Failed to start thread', 'error')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-surface-elev rounded-xl border border-border w-full max-w-lg p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-fg">New Builder Thread</h3>
          <button
            onClick={onClose}
            className="text-fg-subtle hover:text-fg p-1"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-4">
          {/* Builder picker */}
          <div>
            <label className="block text-xs font-medium text-fg-muted mb-1.5">Builder</label>
            {selectedBuilder ? (
              <div className="flex items-center justify-between p-2.5 rounded-md border border-border bg-surface-muted">
                <div>
                  <p className="text-sm font-medium text-fg">{selectedBuilder.companyName}</p>
                  {selectedBuilder.contactName && (
                    <p className="text-xs text-fg-subtle">{selectedBuilder.contactName}</p>
                  )}
                </div>
                <button
                  onClick={() => setSelectedBuilder(null)}
                  className="text-xs text-fg-muted hover:text-fg underline"
                >
                  Change
                </button>
              </div>
            ) : (
              <>
                <input
                  type="text"
                  value={builderQuery}
                  onChange={e => setBuilderQuery(e.target.value)}
                  placeholder="Search builder by name or contact…"
                  className="w-full px-3 py-2 text-sm border border-border rounded-md bg-surface-elev focus:outline-none focus:ring-2 focus:ring-signal/30 focus:border-signal"
                  autoFocus
                />
                <div className="mt-2 max-h-44 overflow-y-auto border border-border rounded-md">
                  {loadingBuilders ? (
                    <div className="p-3 text-xs text-fg-muted text-center">Loading…</div>
                  ) : builders.length === 0 ? (
                    <div className="p-3 text-xs text-fg-muted text-center">No builders found</div>
                  ) : (
                    builders.map(b => (
                      <button
                        key={b.id}
                        onClick={() => setSelectedBuilder(b)}
                        className="w-full text-left px-3 py-2 hover:bg-row-hover border-b border-border last:border-b-0"
                      >
                        <p className="text-sm font-medium text-fg">{b.companyName}</p>
                        {b.contactName && (
                          <p className="text-xs text-fg-subtle">{b.contactName}</p>
                        )}
                      </button>
                    ))
                  )}
                </div>
              </>
            )}
          </div>

          {/* Subject */}
          <div>
            <label className="block text-xs font-medium text-fg-muted mb-1.5">Subject</label>
            <input
              type="text"
              value={subject}
              onChange={e => setSubject(e.target.value)}
              placeholder="What's this about?"
              className="w-full px-3 py-2 text-sm border border-border rounded-md bg-surface-elev focus:outline-none focus:ring-2 focus:ring-signal/30 focus:border-signal"
            />
          </div>

          {/* Message */}
          <div>
            <label className="block text-xs font-medium text-fg-muted mb-1.5">Message</label>
            <textarea
              ref={messageRef}
              value={message}
              onChange={e => setMessage(e.target.value)}
              placeholder="Write your message…"
              rows={4}
              className="w-full px-3 py-2 text-sm border border-border rounded-md bg-surface-elev focus:outline-none focus:ring-2 focus:ring-signal/30 focus:border-signal resize-y"
            />
          </div>
        </div>

        <div className="flex justify-end gap-2 mt-5">
          <Button variant="ghost" onClick={onClose} size="sm">
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!selectedBuilder || !subject.trim() || !message.trim() || submitting}
            size="sm"
          >
            {submitting ? 'Starting…' : 'Send'}
          </Button>
        </div>
      </div>
    </div>
  )
}
