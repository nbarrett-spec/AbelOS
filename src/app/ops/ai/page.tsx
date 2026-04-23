'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { usePathname } from 'next/navigation'

interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: Date
  isTyping?: boolean
  toolsUsed?: Array<{ tool: string; summary: string }>
  actions?: Array<{
    type: string
    label: string
    description: string
    endpoint: string
    payload: any
  }>
}

export default function AIAssistantPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: '0',
      role: 'assistant',
      content: 'I\'m the Abel Lumber AI — powered by Claude with full access to your operations data. I can look up jobs, invoices, builders, inventory, pricing, and more. I can also draft emails, analyze trends, and recommend actions.\n\nWhat do you need?',
      timestamp: new Date(),
    },
  ])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const pathname = usePathname()

  // Quick action buttons
  const quickActions = [
    { text: 'Show me overdue invoices and total exposure', emoji: '💰' },
    { text: 'Job pipeline summary — what needs attention?', emoji: '📊' },
    { text: 'Which builders have the most open orders?', emoji: '🏗️' },
    { text: 'Low stock items that need reorder', emoji: '📦' },
    { text: 'Draft a follow-up email for a stale quote', emoji: '✉️' },
    { text: 'Daily briefing — what happened today?', emoji: '📅' },
  ]

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  const handleSendMessage = useCallback(async (text?: string) => {
    const messageText = text || input.trim()
    if (!messageText || loading) return

    // Add user message
    const userMessage: ChatMessage = {
      id: Date.now().toString(),
      role: 'user',
      content: messageText,
      timestamp: new Date(),
    }

    setMessages((prev) => [...prev, userMessage])
    setInput('')
    setLoading(true)

    // Add typing indicator
    const typingId = (Date.now() + 1).toString()
    setMessages((prev) => [
      ...prev,
      {
        id: typingId,
        role: 'assistant',
        content: '',
        timestamp: new Date(),
        isTyping: true,
      },
    ])

    try {
      // Build conversation history for Claude context (last 20 messages)
      const history = [...messages, userMessage]
        .filter(m => !m.isTyping)
        .slice(-20)
        .map(m => ({ role: m.role, content: m.content }))

      const response = await fetch('/api/ops/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: history,
          context: `Currently on page: ${pathname}`,
        }),
      })

      const data = await response.json()

      // Remove typing indicator and add response (cap at 50 messages)
      setMessages((prev) => {
        const filtered = prev.filter((m) => m.id !== typingId)
        const updated = [
          ...filtered,
          {
            id: (Date.now() + 2).toString(),
            role: 'assistant' as const,
            content: data.message || data.error || 'No response received.',
            timestamp: new Date(),
            toolsUsed: data.toolsUsed,
            actions: data.actions,
          },
        ]
        return updated.length > 50 ? updated.slice(-50) : updated
      })
    } catch (error) {
      console.error('Failed to send message:', error)
      setMessages((prev) => {
        const filtered = prev.filter((m) => m.id !== typingId)
        return [
          ...filtered,
          {
            id: (Date.now() + 2).toString(),
            role: 'assistant',
            content: 'Connection error — could not reach the AI service. Please try again.',
            timestamp: new Date(),
          },
        ]
      })
    } finally {
      setLoading(false)
    }
  }, [input, loading, messages, pathname])

  return (
    <div className="h-full flex flex-col bg-white rounded-xl border overflow-hidden">
      {/* Header */}
      <div className="bg-gradient-to-r from-[#0f2a3e] to-[#0a1a28] px-6 py-4 text-white">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <span className="text-2xl">🤖</span>
          Abel AI
        </h1>
        <p className="text-sm text-blue-100 mt-1">
          Claude-powered assistant with full access to jobs, orders, inventory, invoicing, and builder data
        </p>
      </div>

      {/* Chat container */}
      <div className="flex-1 overflow-y-auto p-6 space-y-4 bg-gray-50">
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-2xl px-4 py-3 rounded-lg ${
                msg.role === 'user'
                  ? 'bg-[#0f2a3e] text-white rounded-br-none'
                  : 'bg-gray-200 text-gray-900 rounded-bl-none'
              }`}
            >
              {msg.isTyping ? (
                <div className="flex gap-1 py-1">
                  <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" />
                  <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }} />
                  <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }} />
                </div>
              ) : (
                <>
                  <div className="text-sm whitespace-pre-wrap">{msg.content}</div>
                  {/* Show tools Claude used */}
                  {msg.toolsUsed && msg.toolsUsed.length > 0 && (
                    <div className="mt-2 pt-2 border-t border-gray-300/50">
                      <p className="text-xs text-gray-500 font-medium mb-1">Tools used:</p>
                      <div className="flex flex-wrap gap-1">
                        {msg.toolsUsed.map((t, i) => (
                          <span key={i} className="text-xs px-2 py-0.5 bg-blue-100 text-blue-700 rounded-full">
                            {t.summary}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  {/* Show actionable recommendations */}
                  {msg.actions && msg.actions.length > 0 && (
                    <div className="mt-2 pt-2 border-t border-gray-300/50 space-y-2">
                      <p className="text-xs text-gray-500 font-medium">Recommended actions:</p>
                      {msg.actions.map((action, i) => (
                        <div key={i} className="flex items-center gap-2 text-xs bg-amber-50 border border-amber-200 rounded px-2 py-1.5">
                          <span className="font-medium text-amber-800">{action.label}</span>
                          <span className="text-amber-600">{action.description}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Quick actions (only show when there's just the initial message) */}
      {messages.filter(m => m.role === 'user').length === 0 && (
        <div className="px-6 py-4 bg-white border-t">
          <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-3">
            Quick Actions
          </p>
          <div className="flex flex-wrap gap-2">
            {quickActions.map((action) => (
              <button
                key={action.text}
                onClick={() => handleSendMessage(action.text)}
                disabled={loading}
                className="px-3 py-2 text-sm rounded-full bg-blue-50 text-[#0f2a3e] border border-blue-200 hover:bg-blue-100 hover:border-blue-300 transition-all disabled:opacity-50"
              >
                <span>{action.emoji}</span> {action.text}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Input area */}
      <div className="bg-white border-t px-6 py-4">
        <form
          onSubmit={(e) => {
            e.preventDefault()
            handleSendMessage()
          }}
          className="flex gap-3"
        >
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask me anything about scheduling, invoices, jobs, materials..."
            disabled={loading}
            className="flex-1 px-4 py-2 rounded-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-[#0f2a3e] disabled:bg-gray-100"
          />
          <button
            type="submit"
            disabled={loading || !input.trim()}
            className="px-4 py-2 bg-[#0f2a3e] text-white rounded-lg hover:bg-[#0a1a28] transition-colors disabled:bg-gray-300 font-medium"
          >
            Send
          </button>
        </form>
        <p className="text-xs text-gray-400 mt-2">
          The AI Assistant uses real data from your operations database to provide accurate insights.
        </p>
      </div>
    </div>
  )
}
