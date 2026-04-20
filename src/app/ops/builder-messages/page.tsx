'use client'

import { useState, useEffect } from 'react'

interface BuilderMessage {
  id: string
  builderId: string
  builderName: string
  builderEmail: string
  subject: string
  body: string
  category: string
  status: string
  staffReply?: string
  repliedByName?: string
  staffReplyAt?: string
  readByStaff: boolean
  createdAt: string
  updatedAt: string
}

const CATEGORY_LABELS: Record<string, string> = {
  GENERAL: 'General',
  ORDER_INQUIRY: 'Order',
  BILLING: 'Billing',
  WARRANTY: 'Warranty',
  DELIVERY: 'Delivery',
  PRODUCT: 'Product',
  QUESTION: 'Question',
  ISSUE: 'Issue',
  CHANGE: 'Change Request',
}

const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  OPEN: { bg: 'bg-red-100', text: 'text-red-700' },
  REPLIED: { bg: 'bg-green-100', text: 'text-green-700' },
  CLOSED: { bg: 'bg-gray-100', text: 'text-gray-600' },
}

export default function BuilderMessagesOpsPage() {
  const [messages, setMessages] = useState<BuilderMessage[]>([])
  const [statusCounts, setStatusCounts] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('ALL')
  const [selectedMessage, setSelectedMessage] = useState<BuilderMessage | null>(null)
  const [replyText, setReplyText] = useState('')
  const [sending, setSending] = useState(false)
  const [toast, setToast] = useState('')
  const [toastType, setToastType] = useState<'success' | 'error'>('success')

  const showToast = (msg: string, type: 'success' | 'error' = 'success') => {
    setToast(msg); setToastType(type); setTimeout(() => setToast(''), 3500)
  }

  const fetchMessages = async () => {
    try {
      const params = new URLSearchParams()
      if (filter !== 'ALL') params.set('status', filter)
      const res = await fetch(`/api/ops/builder-messages?${params}`)
      if (res.ok) {
        const data = await res.json()
        setMessages(data.messages || [])
        setStatusCounts(data.statusCounts || {})
      }
    } catch (err) {
      console.error('Failed to fetch messages:', err)
      showToast('Failed to load messages', 'error')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchMessages()
  }, [filter])

  const handleReply = async () => {
    if (!selectedMessage || !replyText.trim()) return
    setSending(true)
    try {
      const res = await fetch('/api/ops/builder-messages', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messageId: selectedMessage.id,
          reply: replyText,
        }),
      })
      if (res.ok) {
        showToast('Reply sent to builder!')
        setReplyText('')
        setSelectedMessage(null)
        fetchMessages()
      } else {
        showToast('Failed to send reply', 'error')
      }
    } catch {
      showToast('Failed to send reply', 'error')
    } finally {
      setSending(false)
    }
  }

  const handleClose = async (msgId: string) => {
    try {
      const res = await fetch('/api/ops/builder-messages', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messageId: msgId, status: 'CLOSED' }),
      })
      if (res.ok) {
        showToast('Message closed')
        fetchMessages()
      }
    } catch {
      showToast('Failed to close message', 'error')
    }
  }

  const totalOpen = statusCounts['OPEN'] || 0
  const totalReplied = statusCounts['REPLIED'] || 0
  const totalClosed = statusCounts['CLOSED'] || 0

  return (
    <div className="space-y-6">
      {toast && (
        <div className={`fixed top-4 right-4 z-50 px-5 py-3 rounded-lg shadow-lg text-white text-sm font-medium ${toastType === 'success' ? 'bg-green-600' : 'bg-red-600'}`}>
          {toast}
        </div>
      )}

      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Builder Messages</h1>
        <p className="text-sm text-gray-500 mt-1">View and reply to messages from builders</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <button onClick={() => setFilter('ALL')} className={`bg-white rounded-lg shadow-sm border p-4 text-left transition hover:shadow ${filter === 'ALL' ? 'ring-2 ring-[#C9822B]' : ''}`}>
          <div className="text-2xl font-bold text-gray-900">{totalOpen + totalReplied + totalClosed}</div>
          <div className="text-xs text-gray-500 uppercase tracking-wide mt-1">Total Messages</div>
        </button>
        <button onClick={() => setFilter('OPEN')} className={`bg-white rounded-lg shadow-sm border p-4 text-left transition hover:shadow ${filter === 'OPEN' ? 'ring-2 ring-red-400' : ''}`}>
          <div className="text-2xl font-bold text-red-600">{totalOpen}</div>
          <div className="text-xs text-gray-500 uppercase tracking-wide mt-1">Needs Reply</div>
        </button>
        <button onClick={() => setFilter('REPLIED')} className={`bg-white rounded-lg shadow-sm border p-4 text-left transition hover:shadow ${filter === 'REPLIED' ? 'ring-2 ring-green-400' : ''}`}>
          <div className="text-2xl font-bold text-green-600">{totalReplied}</div>
          <div className="text-xs text-gray-500 uppercase tracking-wide mt-1">Replied</div>
        </button>
        <button onClick={() => setFilter('CLOSED')} className={`bg-white rounded-lg shadow-sm border p-4 text-left transition hover:shadow ${filter === 'CLOSED' ? 'ring-2 ring-gray-400' : ''}`}>
          <div className="text-2xl font-bold text-gray-600">{totalClosed}</div>
          <div className="text-xs text-gray-500 uppercase tracking-wide mt-1">Closed</div>
        </button>
      </div>

      {/* Messages List */}
      <div className="bg-white rounded-lg shadow-sm border">
        {loading ? (
          <div className="p-8 text-center text-gray-500">Loading messages...</div>
        ) : messages.length === 0 ? (
          <div className="p-8 text-center text-gray-500">
            {filter === 'ALL' ? 'No builder messages yet' : `No ${filter.toLowerCase()} messages`}
          </div>
        ) : (
          <div className="divide-y">
            {messages.map(msg => {
              const statusColor = STATUS_COLORS[msg.status] || STATUS_COLORS.OPEN
              return (
                <div key={msg.id} className={`p-4 hover:bg-gray-50 transition ${!msg.readByStaff ? 'bg-blue-50/50' : ''}`}>
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        {!msg.readByStaff && <span className="w-2 h-2 bg-blue-500 rounded-full flex-shrink-0" />}
                        <span className="font-semibold text-gray-900 text-sm">{msg.builderName || 'Unknown Builder'}</span>
                        <span className={`px-2 py-0.5 rounded text-[10px] font-semibold ${statusColor.bg} ${statusColor.text}`}>
                          {msg.status}
                        </span>
                        <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-gray-100 text-gray-600">
                          {CATEGORY_LABELS[msg.category] || msg.category}
                        </span>
                      </div>
                      <h3 className="font-medium text-gray-900 text-sm">{msg.subject}</h3>
                      <p className="text-sm text-gray-600 mt-1 line-clamp-2">{msg.body}</p>
                      {msg.staffReply && (
                        <div className="mt-2 p-2 bg-green-50 border border-green-200 rounded text-sm">
                          <p className="text-xs text-green-700 font-medium mb-1">Reply by {msg.repliedByName}:</p>
                          <p className="text-gray-700 text-sm">{msg.staffReply}</p>
                        </div>
                      )}
                    </div>
                    <div className="flex flex-col items-end gap-2 flex-shrink-0">
                      <span className="text-xs text-gray-400">
                        {new Date(msg.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                      </span>
                      <div className="flex gap-1">
                        {msg.status === 'OPEN' && (
                          <button
                            onClick={() => { setSelectedMessage(msg); setReplyText('') }}
                            className="px-3 py-1 bg-[#C9822B] text-white text-xs font-medium rounded hover:bg-[#A86B1F] transition"
                          >
                            Reply
                          </button>
                        )}
                        {msg.status === 'REPLIED' && (
                          <button
                            onClick={() => { setSelectedMessage(msg); setReplyText('') }}
                            className="px-3 py-1 bg-[#3E2A1E] text-white text-xs font-medium rounded hover:bg-[#1a2f4e] transition"
                          >
                            Update Reply
                          </button>
                        )}
                        {msg.status !== 'CLOSED' && (
                          <button
                            onClick={() => handleClose(msg.id)}
                            className="px-3 py-1 border border-gray-300 text-gray-600 text-xs font-medium rounded hover:bg-gray-50 transition"
                          >
                            Close
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Reply Modal */}
      {selectedMessage && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl w-full max-w-xl p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-gray-900">Reply to Builder Message</h3>
              <button onClick={() => setSelectedMessage(null)} className="text-gray-400 hover:text-gray-600 text-xl">&times;</button>
            </div>

            {/* Original message */}
            <div className="bg-gray-50 rounded-lg p-4 mb-4">
              <div className="flex items-center gap-2 mb-2">
                <span className="font-semibold text-sm text-gray-900">{selectedMessage.builderName}</span>
                <span className="text-xs text-gray-400">{new Date(selectedMessage.createdAt).toLocaleString()}</span>
              </div>
              <h4 className="font-medium text-gray-900 text-sm">{selectedMessage.subject}</h4>
              <p className="text-sm text-gray-700 mt-2 whitespace-pre-wrap">{selectedMessage.body}</p>
            </div>

            {/* Existing reply */}
            {selectedMessage.staffReply && (
              <div className="bg-green-50 border border-green-200 rounded-lg p-3 mb-4">
                <p className="text-xs text-green-700 font-medium mb-1">Previous reply by {selectedMessage.repliedByName}:</p>
                <p className="text-sm text-gray-700">{selectedMessage.staffReply}</p>
              </div>
            )}

            {/* Reply input */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">Your Reply</label>
              <textarea
                value={replyText}
                onChange={(e) => setReplyText(e.target.value)}
                rows={4}
                placeholder="Type your reply to the builder..."
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#C9822B] focus:border-transparent"
              />
            </div>

            <div className="flex gap-3 justify-end">
              <button onClick={() => setSelectedMessage(null)} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">Cancel</button>
              <button
                onClick={handleReply}
                disabled={sending || !replyText.trim()}
                className="px-4 py-2 bg-[#C9822B] text-white text-sm font-medium rounded-lg hover:bg-[#A86B1F] disabled:opacity-50 transition"
              >
                {sending ? 'Sending...' : 'Send Reply'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
