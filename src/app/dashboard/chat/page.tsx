'use client'

import { useState, useEffect, useRef, useCallback } from 'react'

// ─── Types ──────────────────────────────────────────────────────
interface ChatConversation {
  id: string
  subject: string | null
  lastMessageAt: string | null
  lastMessagePreview: string | null
  unreadCount: number
  createdAt: string
}

interface ChatMessage {
  id: string
  body: string
  senderType: string
  createdAt: string
  sender?: {
    staffId?: string
    builderId?: string
    firstName?: string
    lastName?: string
    title?: string
    avatar?: string
    companyName?: string
  }
}

const CATEGORY_OPTIONS = [
  { value: 'GENERAL', label: 'General' },
  { value: 'ORDER_INQUIRY', label: 'Order Question' },
  { value: 'BILLING', label: 'Billing' },
  { value: 'WARRANTY', label: 'Warranty' },
  { value: 'DELIVERY', label: 'Delivery' },
  { value: 'PRODUCT', label: 'Product Info' },
]

// ─── Component ──────────────────────────────────────────────────
export default function BuilderChatPage() {
  const [conversations, setConversations] = useState<ChatConversation[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [messageBody, setMessageBody] = useState('')
  const [loading, setLoading] = useState(true)
  const [loadingMessages, setLoadingMessages] = useState(false)
  const [sending, setSending] = useState(false)
  const [showNew, setShowNew] = useState(false)
  const [newSubject, setNewSubject] = useState('')
  const [newBody, setNewBody] = useState('')
  const [newCategory, setNewCategory] = useState('GENERAL')
  const [toast, setToast] = useState('')
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const msgPollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const showToast = (msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(''), 3000)
  }

  // ─── Data fetching ──────────────────────────────────────────
  const fetchConversations = useCallback((silent = false) => {
    if (!silent) setLoading(true)
    fetch('/api/builder/chat')
      .then(r => r.json())
      .then(data => {
        if (data.conversations) setConversations(data.conversations)
      })
      .catch(() => {})
      .finally(() => { if (!silent) setLoading(false) })
  }, [])

  const fetchMessages = useCallback((convId: string, silent = false) => {
    if (!silent) setLoadingMessages(true)
    fetch(`/api/builder/chat/${convId}`)
      .then(r => r.json())
      .then(data => {
        if (data.messages) setMessages(data.messages)
      })
      .catch(() => {})
      .finally(() => { if (!silent) setLoadingMessages(false) })
  }, [])

  // Initial load
  useEffect(() => {
    fetchConversations()
    pollRef.current = setInterval(() => fetchConversations(true), 10000)
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [fetchConversations])

  // Load messages when conversation selected
  useEffect(() => {
    if (msgPollRef.current) clearInterval(msgPollRef.current)
    if (selectedId) {
      fetchMessages(selectedId)
      msgPollRef.current = setInterval(() => fetchMessages(selectedId, true), 5000)
    } else {
      setMessages([])
    }
    return () => { if (msgPollRef.current) clearInterval(msgPollRef.current) }
  }, [selectedId, fetchMessages])

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // ─── Actions ────────────────────────────────────────────────
  const sendMessage = async () => {
    if (!messageBody.trim() || !selectedId) return
    setSending(true)
    try {
      const res = await fetch(`/api/builder/chat/${selectedId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: messageBody.trim() }),
      })
      if (res.ok) {
        setMessageBody('')
        fetchMessages(selectedId, true)
        fetchConversations(true)
      } else {
        showToast('Failed to send')
      }
    } catch {
      showToast('Failed to send')
    }
    setSending(false)
  }

  const createConversation = async () => {
    if (!newSubject.trim() || !newBody.trim()) {
      showToast('Subject and message are required')
      return
    }
    setSending(true)
    try {
      const res = await fetch('/api/builder/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subject: newSubject.trim(),
          message: newBody.trim(),
          category: newCategory,
        }),
      })
      if (res.ok) {
        const data = await res.json()
        setShowNew(false)
        setNewSubject('')
        setNewBody('')
        setNewCategory('GENERAL')
        fetchConversations()
        if (data.conversationId) setSelectedId(data.conversationId)
      } else {
        showToast('Failed to create conversation')
      }
    } catch {
      showToast('Failed to create conversation')
    }
    setSending(false)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  // ─── Helpers ────────────────────────────────────────────────
  const timeAgo = (dateStr: string) => {
    const now = new Date()
    const date = new Date(dateStr)
    const diffMs = now.getTime() - date.getTime()
    const mins = Math.floor(diffMs / 60000)
    if (mins < 1) return 'just now'
    if (mins < 60) return `${mins}m ago`
    const hours = Math.floor(mins / 60)
    if (hours < 24) return `${hours}h ago`
    const days = Math.floor(hours / 24)
    if (days < 7) return `${days}d ago`
    return date.toLocaleDateString()
  }

  const formatTime = (dateStr: string) => {
    const d = new Date(dateStr)
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr)
    const today = new Date()
    if (d.toDateString() === today.toDateString()) return 'Today'
    const yesterday = new Date(today)
    yesterday.setDate(yesterday.getDate() - 1)
    if (d.toDateString() === yesterday.toDateString()) return 'Yesterday'
    return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
  }

  // Group messages by date
  const groupedMessages: { date: string; messages: ChatMessage[] }[] = []
  let currentDate = ''
  for (const msg of messages) {
    const d = formatDate(msg.createdAt)
    if (d !== currentDate) {
      currentDate = d
      groupedMessages.push({ date: d, messages: [] })
    }
    groupedMessages[groupedMessages.length - 1].messages.push(msg)
  }

  const totalUnread = conversations.reduce((sum, c) => sum + c.unreadCount, 0)

  // ─── Render ─────────────────────────────────────────────────
  return (
    <div className="flex h-[calc(100vh-80px)] -m-6">
      {/* Toast */}
      {toast && (
        <div className="fixed top-4 right-4 z-50 bg-[#0f2a3e] text-white px-4 py-2 rounded-lg shadow-lg text-sm">
          {toast}
        </div>
      )}

      {/* ── Sidebar ── */}
      <div className="w-80 border-r bg-white flex flex-col">
        <div className="p-4 border-b">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-bold text-[#1B2A4A]">Chat</h2>
            {totalUnread > 0 && (
              <span className="bg-[#C6A24E] text-white text-xs font-bold px-2 py-0.5 rounded-full">
                {totalUnread}
              </span>
            )}
          </div>
          <button
            onClick={() => { setShowNew(true); setSelectedId(null) }}
            className="w-full bg-[#C6A24E] text-white px-3 py-2 rounded-lg text-sm font-medium hover:bg-[#A8882A] transition"
          >
            + New Conversation
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading && conversations.length === 0 ? (
            <div className="p-4 text-center text-gray-400 text-sm">Loading...</div>
          ) : conversations.length === 0 ? (
            <div className="p-6 text-center">
              <div className="text-gray-400 text-3xl mb-2">💬</div>
              <p className="text-gray-500 text-sm">No conversations yet</p>
              <p className="text-gray-400 text-xs mt-1">Start one to chat with Abel Lumber</p>
            </div>
          ) : (
            conversations.map(conv => (
              <button
                key={conv.id}
                onClick={() => { setSelectedId(conv.id); setShowNew(false) }}
                className={`w-full text-left p-4 border-b hover:bg-gray-50 transition ${
                  selectedId === conv.id ? 'bg-blue-50 border-l-4 border-l-[#0f2a3e]' : ''
                }`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm text-[#1B2A4A] truncate">
                        {conv.subject || 'Support Thread'}
                      </span>
                      {conv.unreadCount > 0 && (
                        <span className="bg-[#C6A24E] text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full shrink-0">
                          {conv.unreadCount}
                        </span>
                      )}
                    </div>
                    {conv.lastMessagePreview && (
                      <p className="text-xs text-gray-500 truncate mt-1">
                        {conv.lastMessagePreview}
                      </p>
                    )}
                  </div>
                  {conv.lastMessageAt && (
                    <span className="text-[10px] text-gray-400 ml-2 shrink-0">
                      {timeAgo(conv.lastMessageAt)}
                    </span>
                  )}
                </div>
              </button>
            ))
          )}
        </div>
      </div>

      {/* ── Main Area ── */}
      <div className="flex-1 flex flex-col bg-gray-50">
        {showNew ? (
          /* ── New Conversation Form ── */
          <div className="flex-1 flex items-start justify-center p-8">
            <div className="bg-white rounded-xl border shadow-sm p-6 w-full max-w-lg">
              <h3 className="text-lg font-bold text-[#1B2A4A] mb-4">New Conversation</h3>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-600 mb-1">Subject</label>
                  <input
                    type="text"
                    value={newSubject}
                    onChange={e => setNewSubject(e.target.value)}
                    className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-[#0f2a3e] focus:border-transparent outline-none"
                    placeholder="What do you need help with?"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-600 mb-1">Category</label>
                  <select
                    value={newCategory}
                    onChange={e => setNewCategory(e.target.value)}
                    className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-[#0f2a3e] focus:border-transparent outline-none"
                  >
                    {CATEGORY_OPTIONS.map(o => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-600 mb-1">Message</label>
                  <textarea
                    value={newBody}
                    onChange={e => setNewBody(e.target.value)}
                    className="w-full border rounded-lg px-3 py-2 text-sm h-32 resize-none focus:ring-2 focus:ring-[#0f2a3e] focus:border-transparent outline-none"
                    placeholder="Describe your question or request..."
                  />
                </div>
                <div className="flex gap-3 pt-2">
                  <button
                    onClick={() => setShowNew(false)}
                    className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={createConversation}
                    disabled={sending || !newSubject.trim() || !newBody.trim()}
                    className="flex-1 bg-[#C6A24E] text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-[#A8882A] transition disabled:opacity-50"
                  >
                    {sending ? 'Sending...' : 'Start Conversation'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : selectedId ? (
          /* ── Message Thread ── */
          <>
            {/* Thread Header */}
            <div className="bg-white border-b px-6 py-3 flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-[#1B2A4A]">
                  {conversations.find(c => c.id === selectedId)?.subject || 'Support Thread'}
                </h3>
                <p className="text-xs text-gray-400">Abel Lumber Support</p>
              </div>
              <button
                onClick={() => setSelectedId(null)}
                className="text-gray-400 hover:text-gray-600 text-lg sm:hidden"
              >
                &times;
              </button>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-6 py-4">
              {loadingMessages ? (
                <div className="flex items-center justify-center h-full text-gray-400 text-sm">
                  Loading messages...
                </div>
              ) : messages.length === 0 ? (
                <div className="flex items-center justify-center h-full text-gray-400 text-sm">
                  No messages yet
                </div>
              ) : (
                groupedMessages.map((group, gi) => (
                  <div key={gi}>
                    {/* Date separator */}
                    <div className="flex items-center gap-3 my-4">
                      <div className="flex-1 h-px bg-gray-200" />
                      <span className="text-xs text-gray-400 font-medium">{group.date}</span>
                      <div className="flex-1 h-px bg-gray-200" />
                    </div>

                    {group.messages.map(msg => {
                      const isBuilder = msg.senderType === 'BUILDER'
                      return (
                        <div
                          key={msg.id}
                          className={`flex mb-3 ${isBuilder ? 'justify-end' : 'justify-start'}`}
                        >
                          <div className={`max-w-[75%] ${isBuilder ? 'order-2' : ''}`}>
                            {/* Sender name */}
                            {!isBuilder && msg.sender && msg.sender.firstName && (
                              <p className="text-xs text-gray-500 mb-1 ml-1">
                                {msg.sender.firstName} {msg.sender.lastName}
                                {msg.sender.title && (
                                  <span className="text-gray-400"> · {msg.sender.title}</span>
                                )}
                              </p>
                            )}

                            {/* Bubble */}
                            <div
                              className={`px-4 py-2.5 rounded-2xl text-sm leading-relaxed ${
                                isBuilder
                                  ? 'bg-[#0f2a3e] text-white rounded-br-sm'
                                  : 'bg-white border text-gray-800 rounded-bl-sm shadow-sm'
                              }`}
                            >
                              <p className="whitespace-pre-wrap">{msg.body}</p>
                            </div>

                            {/* Timestamp */}
                            <p className={`text-[10px] text-gray-400 mt-1 ${isBuilder ? 'text-right mr-1' : 'ml-1'}`}>
                              {formatTime(msg.createdAt)}
                            </p>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                ))
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Input */}
            <div className="bg-white border-t px-4 py-3">
              <div className="flex items-end gap-3">
                <textarea
                  value={messageBody}
                  onChange={e => setMessageBody(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Type a message..."
                  rows={1}
                  className="flex-1 border rounded-xl px-4 py-2.5 text-sm resize-none focus:ring-2 focus:ring-[#0f2a3e] focus:border-transparent outline-none max-h-32"
                  style={{ minHeight: '42px' }}
                />
                <button
                  onClick={sendMessage}
                  disabled={sending || !messageBody.trim()}
                  className="bg-[#C6A24E] text-white px-5 py-2.5 rounded-xl text-sm font-medium hover:bg-[#A8882A] transition disabled:opacity-50 shrink-0"
                >
                  {sending ? '...' : 'Send'}
                </button>
              </div>
              <p className="text-[10px] text-gray-400 mt-1 ml-1">Press Enter to send, Shift+Enter for new line</p>
            </div>
          </>
        ) : (
          /* ── Empty State ── */
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
              </div>
              <h3 className="text-lg font-semibold text-[#1B2A4A] mb-1">Chat with Abel Lumber</h3>
              <p className="text-sm text-gray-500 mb-4">Select a conversation or start a new one</p>
              <button
                onClick={() => setShowNew(true)}
                className="bg-[#C6A24E] text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-[#A8882A] transition"
              >
                Start a Conversation
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
