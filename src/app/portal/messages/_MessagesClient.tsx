'use client'

/**
 * Builder Portal — Messages client.
 *
 * §4.8 Messages. Two-panel layout:
 *   - Left (320px): conversation list with subject, last preview,
 *     timestamp, unread badge.
 *   - Right: message thread + composer.
 *
 * Polling per spec (§4.8): conversation list refreshes every 30s, the
 * active thread refreshes every 10s. setInterval inside useEffect, no
 * WebSocket. New thread is created via "New Conversation" button →
 * inline subject form → POST /api/builder/chat.
 *
 * Builder messages render right-aligned with walnut bg + cream text.
 * Staff messages render left-aligned with elevated bg + walnut text and
 * a small avatar bubble.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  ChevronLeft,
  Inbox,
  Plus,
  Send,
  X,
} from 'lucide-react'
import { PortalCard } from '@/components/portal/PortalCard'
import { usePortal } from '@/components/portal/PortalContext'

export interface ConversationRow {
  id: string
  type: string
  subject: string | null
  lastMessageAt: string | null
  lastMessagePreview: string | null
  createdAt: string
  unreadCount: number
}

interface MessageRow {
  id: string
  conversationId: string
  senderType: 'BUILDER' | 'STAFF' | string
  body: string
  readByBuilder: boolean
  createdAt: string
  sender?: {
    staffId?: string
    builderId?: string
    firstName?: string
    lastName?: string
    title?: string | null
    avatar?: string | null
    companyName?: string
  }
}

interface ThreadResponse {
  conversation: { id: string; subject: string | null }
  messages: MessageRow[]
  total: number
}

function fmtRelative(iso: string | null): string {
  if (!iso) return ''
  const t = new Date(iso).getTime()
  const diff = Date.now() - t
  if (diff < 60_000) return 'just now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h`
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)}d`
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
    })
  } catch {
    return ''
  }
}

function fmtTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString(undefined, {
      hour: 'numeric',
      minute: '2-digit',
    })
  } catch {
    return ''
  }
}

function initialsFor(name: string | null | undefined, fallback = '??'): string {
  if (!name) return fallback
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return fallback
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

interface MessagesClientProps {
  initialConversations: ConversationRow[]
}

export function MessagesClient({
  initialConversations,
}: MessagesClientProps) {
  const { builder } = usePortal()
  const [conversations, setConversations] =
    useState<ConversationRow[]>(initialConversations)
  const [activeId, setActiveId] = useState<string | null>(
    initialConversations[0]?.id ?? null,
  )
  const [thread, setThread] = useState<ThreadResponse | null>(null)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [showNewThread, setShowNewThread] = useState(
    initialConversations.length === 0,
  )
  const [newSubject, setNewSubject] = useState('')
  const [newBody, setNewBody] = useState('')
  const [error, setError] = useState<string | null>(null)
  const threadEndRef = useRef<HTMLDivElement | null>(null)

  // ── Polling: conversation list every 30s ────────────────────────────
  const refreshConversations = useCallback(async () => {
    try {
      const res = await fetch('/api/builder/chat?take=40', {
        credentials: 'include',
      })
      if (!res.ok) return
      const data = (await res.json()) as { conversations: ConversationRow[] }
      setConversations(data.conversations ?? [])
    } catch {
      // noop
    }
  }, [])

  useEffect(() => {
    const id = setInterval(refreshConversations, 30_000)
    return () => clearInterval(id)
  }, [refreshConversations])

  // ── Polling: active thread every 10s ─────────────────────────────────
  const refreshThread = useCallback(
    async (id: string) => {
      try {
        const res = await fetch(`/api/builder/chat/${id}?take=200`, {
          credentials: 'include',
        })
        if (!res.ok) return
        const data = (await res.json()) as ThreadResponse
        setThread(data)
      } catch {
        // noop
      }
    },
    [],
  )

  useEffect(() => {
    if (!activeId) {
      setThread(null)
      return
    }
    refreshThread(activeId)
    const id = setInterval(() => refreshThread(activeId), 10_000)
    return () => clearInterval(id)
  }, [activeId, refreshThread])

  // Auto-scroll to bottom on new message
  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [thread?.messages.length, activeId])

  async function handleSend(e?: React.FormEvent) {
    e?.preventDefault()
    if (sending || !draft.trim() || !activeId) return
    setSending(true)
    setError(null)
    const body = draft.trim()
    setDraft('')
    try {
      const res = await fetch(`/api/builder/chat/${activeId}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: body }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        throw new Error(data?.error || 'Failed to send')
      }
      await refreshThread(activeId)
      await refreshConversations()
    } catch (err: any) {
      setError(err?.message || 'Send failed')
      setDraft(body)
    } finally {
      setSending(false)
    }
  }

  async function handleStartConversation(e: React.FormEvent) {
    e.preventDefault()
    if (sending || !newSubject.trim() || !newBody.trim()) return
    setSending(true)
    setError(null)
    try {
      const res = await fetch('/api/builder/chat', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subject: newSubject.trim(),
          message: newBody.trim(),
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        throw new Error(data?.error || 'Failed to start conversation')
      }
      const data = (await res.json()) as { conversationId: string }
      await refreshConversations()
      setActiveId(data.conversationId)
      setShowNewThread(false)
      setNewSubject('')
      setNewBody('')
    } catch (err: any) {
      setError(err?.message || 'Start failed')
    } finally {
      setSending(false)
    }
  }

  const activeConv = useMemo(
    () => conversations.find((c) => c.id === activeId) ?? null,
    [conversations, activeId],
  )

  return (
    <div className="flex flex-col h-[calc(100vh-180px)] min-h-[520px]">
      {/* Header */}
      <div className="mb-4 flex items-end justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <div className="portal-eyebrow mb-2">Direct Chat</div>
          <h1 className="portal-page-title">Messages</h1>
          <p
            className="text-[15px] mt-2"
            style={{
              color: 'var(--portal-text-muted)',
              fontFamily: 'var(--font-portal-body)',
            }}
          >
            Chat with your {builder.companyName} team at Abel.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setShowNewThread(true)
            setActiveId(null)
          }}
          className="inline-flex items-center gap-1.5 px-4 h-9 rounded-md text-sm font-medium transition-shadow"
          style={{
            background:
              'var(--grad)',
            color: 'white',
            boxShadow: 'var(--shadow-md)',
          }}
        >
          <Plus className="w-3.5 h-3.5" />
          New Conversation
        </button>
      </div>

      <div
        className="flex-1 grid grid-cols-1 md:grid-cols-[320px_1fr] gap-4 min-h-0"
      >
        {/* Conversation list */}
        <div
          className="rounded-[14px] flex flex-col min-h-0 overflow-hidden"
          style={{
            background: 'var(--portal-bg-card, #FFFFFF)',
            border: '1px solid var(--portal-border-light, #F0E8DA)',
          }}
        >
          <div
            className="px-4 py-3 text-[10px] uppercase tracking-wider font-semibold flex items-center justify-between"
            style={{
              color: 'var(--portal-text-subtle)',
              borderBottom: '1px solid var(--portal-border-light, #F0E8DA)',
            }}
          >
            <span>{conversations.length} threads</span>
            {conversations.some((c) => c.unreadCount > 0) && (
              <span
                className="text-[10px] px-1.5 rounded-full"
                style={{
                  background: 'var(--c1)',
                  color: 'white',
                }}
              >
                {conversations.reduce((s, c) => s + c.unreadCount, 0)} new
              </span>
            )}
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto">
            {conversations.length === 0 ? (
              <div
                className="px-4 py-10 text-center text-sm"
                style={{ color: 'var(--portal-text-muted, #6B6056)' }}
              >
                <Inbox
                  className="w-8 h-8 mx-auto mb-2 opacity-30"
                  aria-hidden="true"
                />
                No conversations yet.
              </div>
            ) : (
              <ul>
                {conversations.map((c) => {
                  const active = c.id === activeId
                  return (
                    <li key={c.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setActiveId(c.id)
                          setShowNewThread(false)
                        }}
                        className="w-full text-left px-4 py-3 flex flex-col gap-0.5 transition-colors"
                        style={{
                          background: active
                            ? 'var(--portal-bg-elevated, #FAF5E8)'
                            : 'transparent',
                          borderLeft: active
                            ? '3px solid var(--c1)'
                            : '3px solid transparent',
                          borderBottom:
                            '1px solid var(--portal-border-light, #F0E8DA)',
                        }}
                      >
                        <div className="flex items-baseline justify-between gap-2">
                          <span
                            className="text-xs font-medium truncate"
                            style={{
                              color: 'var(--portal-text-strong, #3E2A1E)',
                              fontWeight: c.unreadCount > 0 ? 600 : 500,
                            }}
                          >
                            {c.subject || 'Untitled thread'}
                          </span>
                          <span
                            className="text-[10px] tabular-nums shrink-0"
                            style={{
                              color: 'var(--portal-text-muted, #6B6056)',
                            }}
                          >
                            {fmtRelative(c.lastMessageAt)}
                          </span>
                        </div>
                        <div className="flex items-baseline gap-1.5">
                          <p
                            className="text-[11px] truncate flex-1"
                            style={{
                              color: 'var(--portal-text-muted, #6B6056)',
                            }}
                          >
                            {c.lastMessagePreview || 'No messages yet'}
                          </p>
                          {c.unreadCount > 0 && (
                            <span
                              className="text-[9px] font-mono tabular-nums px-1.5 rounded-full shrink-0"
                              style={{
                                background: 'var(--c1)',
                                color: 'white',
                                lineHeight: '14px',
                              }}
                            >
                              {c.unreadCount}
                            </span>
                          )}
                        </div>
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </div>

        {/* Thread / new conversation form */}
        <div
          className="rounded-[14px] flex flex-col min-h-0 overflow-hidden"
          style={{
            background: 'var(--portal-bg-card, #FFFFFF)',
            border: '1px solid var(--portal-border-light, #F0E8DA)',
          }}
        >
          {showNewThread ? (
            <NewThreadForm
              subject={newSubject}
              setSubject={setNewSubject}
              body={newBody}
              setBody={setNewBody}
              onSubmit={handleStartConversation}
              onCancel={() => setShowNewThread(false)}
              sending={sending}
              error={error}
              hasConversations={conversations.length > 0}
            />
          ) : !activeConv ? (
            <div
              className="flex-1 flex items-center justify-center text-center px-6"
              style={{ color: 'var(--portal-text-muted, #6B6056)' }}
            >
              <div>
                <Inbox
                  className="w-10 h-10 mx-auto mb-3 opacity-30"
                  aria-hidden="true"
                />
                <p
                  className="text-base font-medium"
                  style={{ color: 'var(--portal-text-strong, #3E2A1E)' }}
                >
                  Select a conversation
                </p>
                <p className="text-sm mt-1">
                  Or start a new one to message your Abel team.
                </p>
              </div>
            </div>
          ) : (
            <>
              {/* Thread header */}
              <div
                className="px-5 py-3 flex items-center gap-2"
                style={{
                  borderBottom: '1px solid var(--portal-border-light, #F0E8DA)',
                }}
              >
                <button
                  type="button"
                  onClick={() => setActiveId(null)}
                  className="md:hidden p-1 rounded hover:bg-[var(--portal-bg-elevated)]"
                  aria-label="Back"
                >
                  <ChevronLeft
                    className="w-4 h-4"
                    style={{ color: 'var(--c1)' }}
                  />
                </button>
                <div className="min-w-0 flex-1">
                  <h3
                    className="text-sm font-medium truncate"
                    style={{ color: 'var(--portal-text-strong, #3E2A1E)' }}
                  >
                    {activeConv.subject || 'Untitled thread'}
                  </h3>
                  <p
                    className="text-[11px]"
                    style={{ color: 'var(--portal-text-muted, #6B6056)' }}
                  >
                    Started {fmtRelative(activeConv.createdAt)}
                  </p>
                </div>
              </div>

              {/* Messages */}
              <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 space-y-3">
                {!thread ? (
                  <p
                    className="text-sm text-center"
                    style={{ color: 'var(--portal-text-muted, #6B6056)' }}
                  >
                    Loading messages…
                  </p>
                ) : thread.messages.length === 0 ? (
                  <p
                    className="text-sm text-center"
                    style={{ color: 'var(--portal-text-muted, #6B6056)' }}
                  >
                    No messages yet.
                  </p>
                ) : (
                  thread.messages.map((m) => (
                    <MessageBubble key={m.id} message={m} />
                  ))
                )}
                <div ref={threadEndRef} />
              </div>

              {/* Composer */}
              <form
                onSubmit={handleSend}
                className="px-4 py-3 flex items-end gap-2"
                style={{
                  borderTop: '1px solid var(--portal-border-light, #F0E8DA)',
                }}
              >
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      handleSend()
                    }
                  }}
                  placeholder="Type a message… (Enter to send, Shift+Enter for new line)"
                  rows={2}
                  className="flex-1 px-3 py-2 text-sm rounded-md focus:outline-none focus:ring-2 focus:ring-[var(--portal-amber,#C9822B)]/30 resize-none"
                  style={{
                    background: 'var(--portal-bg-card, #FFFFFF)',
                    border: '1px solid var(--portal-border, #E8DFD0)',
                    color: 'var(--portal-text-strong, #3E2A1E)',
                  }}
                />
                <button
                  type="submit"
                  disabled={sending || !draft.trim()}
                  className="inline-flex items-center justify-center w-10 h-10 rounded-md transition-shadow disabled:opacity-40 disabled:cursor-not-allowed"
                  style={{
                    background:
                      'var(--grad)',
                    color: 'white',
                    boxShadow: 'var(--shadow-md)',
                  }}
                  aria-label="Send"
                >
                  <Send className="w-4 h-4" />
                </button>
              </form>
              {error && (
                <div
                  className="px-4 pb-2 text-[11px]"
                  style={{ color: '#7E2417' }}
                >
                  {error}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function MessageBubble({ message }: { message: MessageRow }) {
  const isBuilder = message.senderType === 'BUILDER'
  const senderName =
    message.sender?.firstName && message.sender?.lastName
      ? `${message.sender.firstName} ${message.sender.lastName}`
      : message.sender?.companyName || (isBuilder ? 'You' : 'Abel team')
  const initials = initialsFor(
    message.sender?.firstName && message.sender?.lastName
      ? `${message.sender.firstName} ${message.sender.lastName}`
      : message.sender?.companyName,
    isBuilder ? 'YO' : 'AB',
  )
  return (
    <div
      className={`flex items-start gap-2 ${
        isBuilder ? 'flex-row-reverse' : ''
      }`}
    >
      <div
        className="w-7 h-7 shrink-0 rounded-full flex items-center justify-center text-[10px] font-semibold"
        style={{
          background: isBuilder
            ? 'var(--c1)'
            : 'var(--c1)',
          color: 'white',
        }}
        aria-hidden="true"
      >
        {initials}
      </div>
      <div className={`max-w-[75%] ${isBuilder ? 'text-right' : 'text-left'}`}>
        <div
          className="px-3 py-2 rounded-[12px] text-sm leading-relaxed inline-block whitespace-pre-line"
          style={
            isBuilder
              ? {
                  background: 'var(--c1)',
                  color: 'var(--portal-cream, #F3EAD8)',
                  borderTopRightRadius: 4,
                }
              : {
                  background: 'var(--portal-bg-elevated, #FAF5E8)',
                  color: 'var(--portal-text-strong, #3E2A1E)',
                  border: '1px solid var(--portal-border-light, #F0E8DA)',
                  borderTopLeftRadius: 4,
                }
          }
        >
          {message.body}
        </div>
        <div
          className="text-[10px] mt-1 px-1"
          style={{ color: 'var(--portal-text-muted, #6B6056)' }}
        >
          {senderName} · {fmtTime(message.createdAt)}
        </div>
      </div>
    </div>
  )
}

function NewThreadForm({
  subject,
  setSubject,
  body,
  setBody,
  onSubmit,
  onCancel,
  sending,
  error,
  hasConversations,
}: {
  subject: string
  setSubject: (s: string) => void
  body: string
  setBody: (s: string) => void
  onSubmit: (e: React.FormEvent) => void
  onCancel: () => void
  sending: boolean
  error: string | null
  hasConversations: boolean
}) {
  return (
    <form onSubmit={onSubmit} className="flex flex-col h-full p-5">
      <div className="flex items-center justify-between mb-3">
        <h3
          className="text-sm font-medium"
          style={{
            fontFamily: 'var(--font-portal-display)',
            color: 'var(--portal-text-strong, #3E2A1E)',
          }}
        >
          Start a new conversation
        </h3>
        {hasConversations && (
          <button
            type="button"
            onClick={onCancel}
            className="p-1 rounded hover:bg-[var(--portal-bg-elevated)]"
            aria-label="Cancel"
          >
            <X
              className="w-4 h-4"
              style={{ color: 'var(--portal-text-muted, #6B6056)' }}
            />
          </button>
        )}
      </div>
      <div className="space-y-3 flex-1 min-h-0 flex flex-col">
        <div>
          <label
            className="block text-[10px] uppercase tracking-wider font-semibold mb-1.5"
            style={{ color: 'var(--portal-text-subtle)' }}
          >
            Subject
          </label>
          <input
            type="text"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="What's this about?"
            className="h-10 w-full px-3 text-sm rounded-md focus:outline-none focus:ring-2 focus:ring-[var(--portal-amber,#C9822B)]/30"
            style={{
              background: 'var(--portal-bg-card, #FFFFFF)',
              border: '1px solid var(--portal-border, #E8DFD0)',
              color: 'var(--portal-text-strong, #3E2A1E)',
            }}
            autoFocus
          />
        </div>
        <div className="flex-1 min-h-0 flex flex-col">
          <label
            className="block text-[10px] uppercase tracking-wider font-semibold mb-1.5"
            style={{ color: 'var(--portal-text-subtle)' }}
          >
            Message
          </label>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Type your message…"
            className="flex-1 min-h-[160px] px-3 py-2 text-sm rounded-md focus:outline-none focus:ring-2 focus:ring-[var(--portal-amber,#C9822B)]/30 resize-none"
            style={{
              background: 'var(--portal-bg-card, #FFFFFF)',
              border: '1px solid var(--portal-border, #E8DFD0)',
              color: 'var(--portal-text-strong, #3E2A1E)',
            }}
          />
        </div>
      </div>
      {error && (
        <p className="mt-2 text-xs" style={{ color: '#7E2417' }}>
          {error}
        </p>
      )}
      <div className="mt-3 flex items-center justify-end gap-2">
        {hasConversations && (
          <button
            type="button"
            onClick={onCancel}
            className="inline-flex items-center gap-1.5 px-4 h-9 rounded-md text-sm font-medium transition-colors"
            style={{
              background: 'var(--portal-bg-card, #FFFFFF)',
              color: 'var(--portal-text-strong, #3E2A1E)',
              border: '1px solid var(--portal-border, #E8DFD0)',
            }}
          >
            Cancel
          </button>
        )}
        <button
          type="submit"
          disabled={sending || !subject.trim() || !body.trim()}
          className="inline-flex items-center gap-1.5 px-4 h-9 rounded-md text-sm font-medium transition-shadow disabled:opacity-60"
          style={{
            background:
              'var(--grad)',
            color: 'white',
            boxShadow: 'var(--shadow-md)',
          }}
        >
          {sending ? 'Sending…' : 'Send'}
          <Send className="w-3.5 h-3.5" />
        </button>
      </div>
    </form>
  )
}

// PortalCard isn't used here but is imported for typed API stability.
void PortalCard
