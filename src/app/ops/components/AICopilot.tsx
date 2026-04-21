'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { usePathname } from 'next/navigation'

interface ActionableRecommendation {
  type: 'approve_po' | 'send_reminder' | 'adjust_price' | 'schedule_delivery' | 'flag_review'
  label: string
  description: string
  endpoint: string
  payload: any
  status: 'pending' | 'approved' | 'rejected'
  id: string
}

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  toolsUsed?: Array<{ tool: string; summary: string }>
  actions?: ActionableRecommendation[]
  timestamp: Date
  isLoading?: boolean
}

// Quick action suggestions based on common tasks
const QUICK_ACTIONS = [
  { label: 'Overdue invoices', prompt: 'Show me all overdue invoices and their total value' },
  { label: 'Job pipeline', prompt: 'Give me a summary of the current job pipeline' },
  { label: 'Draft an email', prompt: 'Help me draft a professional email' },
  { label: 'Inventory check', prompt: 'Check inventory levels for low-stock items' },
  { label: 'Financial summary', prompt: 'Give me a quick financial summary' },
  { label: 'Find a builder', prompt: 'Search for a builder account' },
]

export default function AICopilot() {
  const [isOpen, setIsOpen] = useState(false)
  const [isMinimized, setIsMinimized] = useState(false)
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [approvedActions, setApprovedActions] = useState<Set<string>>(new Set())
  const [actionErrors, setActionErrors] = useState<Record<string, string>>({})
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const pathname = usePathname()

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Focus input when panel opens
  useEffect(() => {
    if (isOpen && !isMinimized) {
      setTimeout(() => inputRef.current?.focus(), 100)
    }
  }, [isOpen, isMinimized])

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || isLoading) return

    const userMessage: Message = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: text.trim(),
      timestamp: new Date(),
    }

    const loadingMessage: Message = {
      id: `loading-${Date.now()}`,
      role: 'assistant',
      content: '',
      timestamp: new Date(),
      isLoading: true,
    }

    setMessages(prev => [...prev, userMessage, loadingMessage])
    setInput('')
    setIsLoading(true)

    try {
      // Build conversation history (last 20 messages for context)
      const history = [...messages, userMessage]
        .filter(m => !m.isLoading)
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

      // Parse actions from response
      const actions: ActionableRecommendation[] = data.actions ? data.actions.map((action: any, idx: number) => ({
        ...action,
        id: action.id || `action-${Date.now()}-${idx}`,
        status: 'pending' as const
      })) : []

      const assistantMessage: Message = {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        content: data.message || data.error || 'No response received.',
        toolsUsed: data.toolsUsed,
        actions: actions.length > 0 ? actions : undefined,
        timestamp: new Date(),
      }

      setMessages(prev => prev.filter(m => !m.isLoading).concat(assistantMessage))
    } catch (err) {
      const errorMessage: Message = {
        id: `error-${Date.now()}`,
        role: 'assistant',
        content: 'Sorry, I could not connect to the AI service. Please check your connection and try again.',
        timestamp: new Date(),
      }
      setMessages(prev => prev.filter(m => !m.isLoading).concat(errorMessage))
    } finally {
      setIsLoading(false)
    }
  }, [messages, isLoading, pathname])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage(input)
    }
  }

  const clearChat = () => {
    setMessages([])
  }

  // Handle approve action
  const handleApprove = useCallback(async (action: ActionableRecommendation) => {
    try {
      const res = await fetch(action.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(action.payload),
      })

      if (res.ok) {
        setApprovedActions(prev => new Set([...prev, action.id]))
        setActionErrors(prev => {
          const updated = { ...prev }
          delete updated[action.id]
          return updated
        })

        // Update message with approved status
        setMessages(prev => prev.map(msg => {
          if (msg.actions) {
            return {
              ...msg,
              actions: msg.actions.map(a =>
                a.id === action.id ? { ...a, status: 'approved' as const } : a
              )
            }
          }
          return msg
        }))
      } else {
        const errorData = await res.json()
        setActionErrors(prev => ({
          ...prev,
          [action.id]: errorData.error || 'Failed to process action'
        }))
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Unknown error occurred'
      setActionErrors(prev => ({
        ...prev,
        [action.id]: errorMsg
      }))
    }
  }, [])

  // Handle dismiss action
  const handleDismiss = useCallback((action: ActionableRecommendation) => {
    setMessages(prev => prev.map(msg => {
      if (msg.actions) {
        return {
          ...msg,
          actions: msg.actions.map(a =>
            a.id === action.id ? { ...a, status: 'rejected' as const } : a
          )
        }
      }
      return msg
    }))
  }, [])

  // Render markdown-light formatting (bold, bullet lists, line breaks).
  // XSS-safe: escape HTML first, then apply a small whitelist of markdown -> tag conversions.
  const formatContent = (text: string) => {
    const lines = text.split('\n')
    return lines.map((line, i) => {
      // 1) Escape all HTML-significant characters from the source text.
      let safe = line
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
      // 2) Apply bold markdown on the escaped string.
      safe = safe.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      // 3) Indent bullet-style lines.
      if (safe.startsWith('&bull; ') || safe.startsWith('• ') || safe.startsWith('- ')) {
        safe = `<span class="ml-2">${safe}</span>`
      }
      return (
        <span key={i}>
          <span dangerouslySetInnerHTML={{ __html: safe }} />
          {i < lines.length - 1 && <br />}
        </span>
      )
    })
  }

  // Render action cards for actionable recommendations
  const renderActionCards = (actions: ActionableRecommendation[]) => {
    return actions
      .filter(action => action.status === 'pending')
      .map(action => {
        const error = actionErrors[action.id]
        const isApproved = approvedActions.has(action.id)

        return (
          <div
            key={action.id}
            className="mt-3 p-3 bg-green-50 border border-green-200 rounded-lg"
          >
            <div className="flex items-start justify-between mb-2">
              <div className="flex-1">
                <div className="font-medium text-gray-800 text-sm">{action.label}</div>
                {action.description && (
                  <div className="text-xs text-gray-600 mt-1">{action.description}</div>
                )}
              </div>
              {isApproved && (
                <div className="ml-2 flex items-center gap-1 text-green-700 text-xs font-medium">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  Approved
                </div>
              )}
            </div>

            {error && (
              <div className="text-xs text-red-600 mb-2 bg-red-50 p-1.5 rounded">
                Error: {error}
              </div>
            )}

            {!isApproved && (
              <div className="flex gap-2 mt-3">
                <button
                  onClick={() => handleApprove(action)}
                  className="flex-1 px-3 py-1.5 bg-[#27AE60] hover:bg-[#229954] text-white text-xs font-medium rounded transition"
                >
                  Approve
                </button>
                <button
                  onClick={() => handleDismiss(action)}
                  className="flex-1 px-3 py-1.5 bg-red-500 hover:bg-red-600 text-white text-xs font-medium rounded transition"
                >
                  Dismiss
                </button>
              </div>
            )}
          </div>
        )
      })
  }

  // Floating trigger button
  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-6 right-6 z-50 w-14 h-14 bg-[#0f2a3e] hover:bg-[#163d5a] text-white rounded-full shadow-xl flex items-center justify-center transition-all hover:scale-110 group"
        title="Open Abel AI Assistant"
      >
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 2a8 8 0 0 0-8 8c0 3.4 2.1 6.3 5 7.5V20a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1v-2.5c2.9-1.2 5-4.1 5-7.5a8 8 0 0 0-8-8z" />
          <path d="M10 22h4" />
          <circle cx="10" cy="9" r="1" fill="currentColor" />
          <circle cx="14" cy="9" r="1" fill="currentColor" />
          <path d="M10 13c0 1 .5 2 2 2s2-1 2-2" />
        </svg>
        <span className="absolute -top-1 -right-1 w-4 h-4 bg-[#C6A24E] rounded-full text-[10px] flex items-center justify-center font-bold">
          AI
        </span>
      </button>
    )
  }

  // Minimized state
  if (isMinimized) {
    return (
      <div className="fixed bottom-6 right-6 z-50 bg-[#0f2a3e] text-white rounded-xl shadow-xl px-4 py-2 flex items-center gap-3 cursor-pointer hover:bg-[#163d5a] transition"
           onClick={() => setIsMinimized(false)}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12 2a8 8 0 0 0-8 8c0 3.4 2.1 6.3 5 7.5V20a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1v-2.5c2.9-1.2 5-4.1 5-7.5a8 8 0 0 0-8-8z" />
        </svg>
        <span className="text-sm font-medium">Abel AI</span>
        {messages.length > 0 && (
          <span className="bg-[#C6A24E] text-white text-xs rounded-full px-1.5 py-0.5 font-bold">
            {messages.filter(m => m.role === 'assistant' && !m.isLoading).length}
          </span>
        )}
      </div>
    )
  }

  // Full chat panel
  return (
    <div className="fixed bottom-6 right-6 z-50 w-[420px] h-[600px] max-h-[80vh] bg-white rounded-2xl shadow-2xl border border-gray-200 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="bg-[#0f2a3e] text-white px-4 py-3 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-2">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2a8 8 0 0 0-8 8c0 3.4 2.1 6.3 5 7.5V20a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1v-2.5c2.9-1.2 5-4.1 5-7.5a8 8 0 0 0-8-8z" />
            <circle cx="10" cy="9" r="1" fill="currentColor" />
            <circle cx="14" cy="9" r="1" fill="currentColor" />
          </svg>
          <div>
            <div className="text-sm font-semibold">Abel AI</div>
            <div className="text-[10px] text-white/60">Powered by Claude</div>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {messages.length > 0 && (
            <button
              onClick={clearChat}
              className="p-1.5 hover:bg-white/10 rounded-lg transition text-xs text-white/70 hover:text-white"
              title="Clear chat"
            >
              Clear
            </button>
          )}
          <button
            onClick={() => setIsMinimized(true)}
            className="p-1.5 hover:bg-white/10 rounded-lg transition"
            title="Minimize"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M5 12h14" />
            </svg>
          </button>
          <button
            onClick={() => setIsOpen(false)}
            className="p-1.5 hover:bg-white/10 rounded-lg transition"
            title="Close"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center px-4">
            <div className="w-16 h-16 bg-blue-50 rounded-full flex items-center justify-center mb-4">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#0f2a3e" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2a8 8 0 0 0-8 8c0 3.4 2.1 6.3 5 7.5V20a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1v-2.5c2.9-1.2 5-4.1 5-7.5a8 8 0 0 0-8-8z" />
                <circle cx="10" cy="9" r="1" fill="#0f2a3e" />
                <circle cx="14" cy="9" r="1" fill="#0f2a3e" />
                <path d="M10 13c0 1 .5 2 2 2s2-1 2-2" />
              </svg>
            </div>
            <h3 className="text-base font-semibold text-gray-800 mb-1">Abel AI Assistant</h3>
            <p className="text-xs text-gray-500 mb-4">
              I can help you look up orders, check inventory, draft emails, analyze financials, and more. What do you need?
            </p>
            <div className="grid grid-cols-2 gap-2 w-full">
              {QUICK_ACTIONS.map((action) => (
                <button
                  key={action.label}
                  onClick={() => sendMessage(action.prompt)}
                  className="text-left px-3 py-2 bg-gray-50 hover:bg-blue-50 border border-gray-200 hover:border-[#0f2a3e]/30 rounded-lg transition text-xs text-gray-700 hover:text-[#0f2a3e]"
                >
                  {action.label}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[85%] rounded-xl px-3 py-2 text-sm leading-relaxed ${
                  msg.role === 'user'
                    ? 'bg-[#0f2a3e] text-white'
                    : 'bg-gray-100 text-gray-800'
                }`}
              >
                {msg.isLoading ? (
                  <div className="flex items-center gap-2">
                    <div className="flex gap-1">
                      <div className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                      <div className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                      <div className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                    </div>
                    <span className="text-xs text-gray-500">Thinking...</span>
                  </div>
                ) : (
                  <>
                    <div className="whitespace-pre-wrap">{formatContent(msg.content)}</div>
                    {msg.toolsUsed && msg.toolsUsed.length > 0 && (
                      <div className="mt-2 pt-2 border-t border-gray-200/50">
                        <div className="flex flex-wrap gap-1">
                          {msg.toolsUsed.map((tool, i) => (
                            <span
                              key={i}
                              className="inline-flex items-center gap-1 px-2 py-0.5 bg-blue-50 text-[10px] text-[#0f2a3e] rounded-full font-medium"
                            >
                              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
                              </svg>
                              {tool.summary}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                    {msg.actions && msg.actions.length > 0 && (
                      <div className="mt-2">
                        {renderActionCards(msg.actions)}
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input area */}
      <div className="border-t border-gray-200 p-3 flex-shrink-0">
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask Abel AI anything..."
            rows={1}
            className="flex-1 resize-none border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-[#0f2a3e] focus:ring-1 focus:ring-[#0f2a3e]/20 max-h-20 overflow-y-auto"
            style={{ minHeight: '38px' }}
            disabled={isLoading}
          />
          <button
            onClick={() => sendMessage(input)}
            disabled={!input.trim() || isLoading}
            className="w-9 h-9 bg-[#0f2a3e] hover:bg-[#163d5a] disabled:bg-gray-300 text-white rounded-xl flex items-center justify-center transition flex-shrink-0"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" />
            </svg>
          </button>
        </div>
        <div className="mt-1.5 text-[10px] text-gray-400 text-center">
          Press Enter to send &middot; Shift+Enter for new line
        </div>
      </div>
    </div>
  )
}
