'use client'

import { useState, useEffect, useRef, useCallback } from 'react'

interface Message {
  id: string
  subject: string
  body: string
  category: string
  status: string
  staffReply?: string
  repliedByName?: string
  staffReplyAt?: string
  readByBuilder: boolean
  createdAt: string
  updatedAt: string
}

const CATEGORY_OPTIONS = [
  { value: 'GENERAL', label: 'General Inquiry' },
  { value: 'ORDER_INQUIRY', label: 'Order Question' },
  { value: 'BILLING', label: 'Billing / Payment' },
  { value: 'WARRANTY', label: 'Warranty' },
  { value: 'DELIVERY', label: 'Delivery' },
  { value: 'PRODUCT', label: 'Product Info' },
]

const STATUS_CONFIG: Record<string, { bg: string; text: string; label: string }> = {
  OPEN: { bg: 'bg-blue-50', text: 'text-blue-700', label: 'Open' },
  REPLIED: { bg: 'bg-green-50', text: 'text-green-700', label: 'Replied' },
  CLOSED: { bg: 'bg-surface-muted', text: 'text-fg-muted', label: 'Closed' },
}

export default function BuilderMessagesPage() {
  const [messages, setMessages] = useState<Message[]>([])
  const [loading, setLoading] = useState(true)
  const [showCompose, setShowCompose] = useState(false)
  const [selected, setSelected] = useState<Message | null>(null)
  const [toast, setToast] = useState('')

  // Compose form
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [category, setCategory] = useState('GENERAL')
  const [sending, setSending] = useState(false)

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const fetchMessages = useCallback((silent = false) => {
    if (!silent) setLoading(true)
    fetch('/api/builders/messages')
      .then(r => r.json())
      .then(data => setMessages(data.messages || []))
      .catch(() => {})
      .finally(() => { if (!silent) setLoading(false) })
  }, [])

  useEffect(() => {
    fetchMessages()

    // Poll for new replies every 15 seconds
    pollRef.current = setInterval(() => fetchMessages(true), 15000)
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [fetchMessages])

  const showToast = (msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(''), 3000)
  }

  const sendMessage = async () => {
    if (!subject.trim() || !body.trim()) {
      showToast('Subject and message are required')
      return
    }
    setSending(true)
    try {
      const res = await fetch('/api/builders/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject, message: body, category }),
      })
      if (res.ok) {
        showToast('Message sent successfully')
        setShowCompose(false)
        setSubject('')
        setBody('')
        setCategory('GENERAL')
        fetchMessages()
      } else {
        const err = await res.json()
        showToast(err.error || 'Failed to send')
      }
    } catch {
      showToast('Failed to send message')
    }
    setSending(false)
  }

  const timeAgo = (dateStr: string) => {
    const now = new Date()
    const date = new Date(dateStr)
    const diffMs = now.getTime() - date.getTime()
    const mins = Math.floor(diffMs / 60000)
    if (mins < 60) return `${Math.max(1, mins)}m ago`
    const hours = Math.floor(mins / 60)
    if (hours < 24) return `${hours}h ago`
    const days = Math.floor(hours / 24)
    if (days < 7) return `${days}d ago`
    return date.toLocaleDateString()
  }

  return (
    <div className="max-w-5xl mx-auto">
      {/* Toast */}
      {toast && (
        <div className="fixed top-4 right-4 z-50 bg-brand text-white px-4 py-2 rounded-lg shadow-lg text-sm">
          {toast}
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-fg">Messages</h1>
          <p className="text-fg-muted text-sm">Communicate with Abel Lumber</p>
        </div>
        <button
          onClick={() => { setShowCompose(true); setSelected(null) }}
          className="bg-accent text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-accent-hover transition flex items-center gap-2"
        >
          <span>+</span> New Message
        </button>
      </div>

      {/* Compose Modal */}
      {showCompose && (
        <div className="bg-surface rounded-lg border p-6 mb-6 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-fg">New Message</h2>
            <button onClick={() => setShowCompose(false)} className="text-fg-subtle hover:text-fg-muted text-xl">&times;</button>
          </div>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-fg-muted mb-1">Subject</label>
                <input
                  type="text"
                  value={subject}
                  onChange={e => setSubject(e.target.value)}
                  className="w-full border rounded-lg px-3 py-2 text-sm"
                  placeholder="What's this about?"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-fg-muted mb-1">Category</label>
                <select
                  value={category}
                  onChange={e => setCategory(e.target.value)}
                  className="w-full border rounded-lg px-3 py-2 text-sm bg-surface"
                >
                  {CATEGORY_OPTIONS.map(c => (
                    <option key={c.value} value={c.value}>{c.label}</option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-fg-muted mb-1">Message</label>
              <textarea
                value={body}
                onChange={e => setBody(e.target.value)}
                rows={5}
                className="w-full border rounded-lg px-3 py-2 text-sm resize-none"
                placeholder="Type your message here..."
              />
            </div>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowCompose(false)}
                className="px-4 py-2 text-sm font-medium text-fg-muted hover:text-fg"
              >
                Cancel
              </button>
              <button
                onClick={sendMessage}
                disabled={sending || !subject.trim() || !body.trim()}
                className="bg-brand text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-[#153d5a] transition disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {sending ? 'Sending...' : 'Send Message'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Messages List */}
      <div className="flex gap-6">
        <div className={`${selected ? 'flex-1' : 'w-full'}`}>
          {loading ? (
            <div className="bg-surface rounded-lg border p-16 flex items-center justify-center">
              <div className="w-6 h-6 border-3 border-brand border-t-transparent rounded-full animate-spin" />
            </div>
          ) : messages.length === 0 ? (
            <div className="bg-surface rounded-lg border p-16 text-center">
              <div className="text-5xl mb-3">💬</div>
              <h3 className="font-semibold text-fg mb-1">No messages yet</h3>
              <p className="text-fg-muted text-sm mb-4">Send a message to Abel Lumber about orders, deliveries, billing, or anything else.</p>
              <button
                onClick={() => setShowCompose(true)}
                className="bg-accent text-white px-5 py-2 rounded-lg font-medium text-sm hover:bg-accent-hover transition"
              >
                Send Your First Message
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              {messages.map(msg => {
                const sCfg = STATUS_CONFIG[msg.status] || STATUS_CONFIG.OPEN
                return (
                  <div
                    key={msg.id}
                    onClick={() => setSelected(msg)}
                    className={`bg-surface rounded-lg border p-4 cursor-pointer hover:shadow-sm transition ${
                      selected?.id === msg.id ? 'ring-2 ring-[#0f2a3e]' : ''
                    } ${msg.status === 'REPLIED' && !msg.readByBuilder ? 'border-l-4 border-l-green-500' : ''}`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <h3 className="font-medium text-fg text-sm">{msg.subject}</h3>
                      <div className="flex items-center gap-2">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${sCfg.bg} ${sCfg.text}`}>
                          {sCfg.label}
                        </span>
                        <span className="text-xs text-fg-subtle">{timeAgo(msg.updatedAt)}</span>
                      </div>
                    </div>
                    <p className="text-sm text-fg-muted truncate">{msg.body}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-xs text-fg-subtle bg-surface-muted px-2 py-0.5 rounded">
                        {CATEGORY_OPTIONS.find(c => c.value === msg.category)?.label || msg.category}
                      </span>
                      {msg.staffReply && (
                        <span className="text-xs text-green-600">Has reply</span>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Detail Panel */}
        {selected && (
          <div className="w-96 bg-surface rounded-lg border p-5 sticky top-4 self-start">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-fg text-sm">{selected.subject}</h3>
              <button onClick={() => setSelected(null)} className="text-fg-subtle hover:text-fg-muted">&times;</button>
            </div>

            <div className="space-y-4 text-sm">
              <div className="flex items-center gap-2">
                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_CONFIG[selected.status]?.bg || ''} ${STATUS_CONFIG[selected.status]?.text || ''}`}>
                  {STATUS_CONFIG[selected.status]?.label || selected.status}
                </span>
                <span className="text-xs text-fg-subtle bg-surface-muted px-2 py-0.5 rounded">
                  {CATEGORY_OPTIONS.find(c => c.value === selected.category)?.label || selected.category}
                </span>
              </div>

              {/* Your message */}
              <div className="bg-blue-50 rounded-lg p-3">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-medium text-blue-700">You</span>
                  <span className="text-xs text-blue-400">
                    {new Date(selected.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                  </span>
                </div>
                <p className="text-fg-muted whitespace-pre-line text-sm">{selected.body}</p>
              </div>

              {/* Staff reply */}
              {selected.staffReply ? (
                <div className="bg-green-50 rounded-lg p-3">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-medium text-green-700">
                      {selected.repliedByName || 'Abel Lumber'}
                    </span>
                    {selected.staffReplyAt && (
                      <span className="text-xs text-green-400">
                        {new Date(selected.staffReplyAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                      </span>
                    )}
                  </div>
                  <p className="text-fg-muted whitespace-pre-line text-sm">{selected.staffReply}</p>
                </div>
              ) : (
                <div className="bg-surface-muted rounded-lg p-3 text-center text-fg-subtle text-xs">
                  Awaiting response from Abel Lumber
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
