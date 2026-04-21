'use client'

import { useState, useRef, useEffect } from 'react'

interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: Date
  isTyping?: boolean
}

interface AssistantResponse {
  text: string
  data?: {
    type: string
    content: string
  }
  suggestions?: string[]
}

export default function AIAssistantPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: '0',
      role: 'assistant',
      content: 'Hello! I\'m the Abel Lumber AI Assistant. I can help you with scheduling, communications, and workflow decisions. What would you like assistance with today?',
      timestamp: new Date(),
    },
  ])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  // Quick action buttons
  const quickActions = [
    { text: 'Draft email to builder', emoji: '✉️' },
    { text: 'Suggest schedule for next week', emoji: '📅' },
    { text: 'Analyze overdue invoices', emoji: '💰' },
    { text: 'Generate job status report', emoji: '📊' },
    { text: 'Check material availability', emoji: '📦' },
  ]

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  const handleSendMessage = async (text?: string) => {
    const messageText = text || input.trim()
    if (!messageText) return

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
      const response = await fetch('/api/ops/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: messageText }),
      })

      const data: AssistantResponse = await response.json()

      // Remove typing indicator and add response
      setMessages((prev) => {
        const filtered = prev.filter((m) => m.id !== typingId)
        return [
          ...filtered,
          {
            id: (Date.now() + 2).toString(),
            role: 'assistant',
            content: data.text,
            timestamp: new Date(),
          },
        ]
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
            content: 'Sorry, I encountered an error processing your request. Please try again.',
            timestamp: new Date(),
          },
        ]
      })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="h-full flex flex-col bg-white rounded-xl border overflow-hidden">
      {/* Header */}
      <div className="bg-gradient-to-r from-[#0f2a3e] to-[#0a1a28] px-6 py-4 text-white">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <span className="text-2xl">🤖</span>
          AI Assistant
        </h1>
        <p className="text-sm text-blue-100 mt-1">
          Scheduling, communications, and workflow insights powered by AI
        </p>
      </div>

      {/* Chat container */}
      <div className="flex-1 overflow-y-auto p-6 space-y-4 bg-gray-50">
        {messages.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <p className="text-4xl mb-2">🤖</p>
              <p className="text-gray-500">No messages yet. Start by clicking a quick action or typing a question.</p>
            </div>
          </div>
        ) : (
          messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-md lg:max-w-lg px-4 py-3 rounded-lg ${
                  msg.role === 'user'
                    ? 'bg-[#0f2a3e] text-white rounded-br-none'
                    : 'bg-gray-200 text-gray-900 rounded-bl-none'
                }`}
              >
                {msg.isTyping ? (
                  <div className="flex gap-1">
                    <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" />
                    <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }} />
                    <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }} />
                  </div>
                ) : (
                  <div className="text-sm whitespace-pre-wrap">{msg.content}</div>
                )}
              </div>
            </div>
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Quick actions (only show when there's just the initial message) */}
      {messages.length === 1 && (
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
