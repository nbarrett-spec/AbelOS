'use client'

import { useState, useEffect, useRef } from 'react'

interface Message {
  id?: string
  role: 'user' | 'assistant'
  content: string
  intent?: string
  createdAt?: string
}

export default function AgentChat() {
  const [isOpen, setIsOpen] = useState(false)
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [unread, setUnread] = useState(0)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 100)
      setUnread(0)
    }
  }, [isOpen])

  useEffect(() => {
    if (isOpen && messages.length === 0 && !conversationId) {
      setMessages([{
        role: 'assistant',
        content: 'Hi! I\'m your Abel Lumber assistant. I can help you with:\n\n\u2022 **Delivery tracking** \u2014 "Where is my delivery?"\n\u2022 **Schedule changes** \u2014 "Can I reschedule?"\n\u2022 **Order status** \u2014 "What\'s my order status?"\n\u2022 **Invoices & billing** \u2014 "What do I owe?"\n\u2022 **Product pricing** \u2014 "How much is a 2068 door?"\n\u2022 **Warranty claims** \u2014 "Check warranty status"\n\nWhat can I help you with?',
      }])
    }
  }, [isOpen, messages.length, conversationId])

  // Load conversation history when resuming an existing conversation
  useEffect(() => {
    if (isOpen && conversationId && messages.length === 0) {
      (async () => {
        try {
          const res = await fetch(`/api/agent/chat?conversationId=${conversationId}`)
          if (res.ok) {
            const data = await res.json()
            if (data.messages && data.messages.length > 0) {
              setMessages(data.messages.map((m: any) => ({
                id: m.id,
                role: m.role,
                content: m.content,
                intent: m.intent,
                createdAt: m.createdAt,
              })))
            }
          }
        } catch { /* will show welcome message on next open */ }
      })()
    }
  }, [isOpen, conversationId])

  async function callAgentAPI(userMessage: string) {
    try {
      const res = await fetch('/api/agent/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: userMessage, conversationId }),
      })

      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || 'Failed to send message')
      }

      const data = await res.json()
      setConversationId(data.conversationId)
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: data.message,
        intent: data.intent,
      }])
    } catch (err: any) {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: 'Sorry, I encountered an error: ' + err.message + '. Please try again or contact support.',
      }])
    } finally {
      setLoading(false)
    }
  }

  async function sendMessage(e: React.FormEvent) {
    e.preventDefault()
    if (!input.trim() || loading) return

    const userMessage = input.trim()
    setInput('')
    setMessages(prev => [...prev, { role: 'user', content: userMessage }])
    setLoading(true)
    await callAgentAPI(userMessage)
  }

  async function sendQuickAction(msg: string) {
    if (loading) return
    setMessages(prev => [...prev, { role: 'user', content: msg }])
    setLoading(true)
    await callAgentAPI(msg)
  }

  function formatContent(text: string) {
    // Escape HTML first to prevent XSS, then apply markdown formatting
    let safe = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    safe = safe
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      .replace(/\n/g, '<br/>')
      .replace(/\u2022 /g, '&bull; ')
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" style="color:#E67E22;text-decoration:underline" target="_blank" rel="noopener">$1</a>')
    return safe
  }

  const quickActions = [
    { label: '\uD83D\uDCE6 Deliveries', msg: 'Show my deliveries' },
    { label: '\uD83D\uDCCB Orders', msg: "What's my order status?" },
    { label: '\uD83D\uDCB0 Invoices', msg: 'What do I owe?' },
    { label: '\uD83D\uDCC5 Schedule', msg: "What's on my schedule?" },
  ]

  return (
    <>
      <button
        onClick={() => setIsOpen(!isOpen)}
        style={{
          position: 'fixed',
          bottom: '24px',
          right: '24px',
          width: '60px',
          height: '60px',
          borderRadius: '50%',
          background: 'linear-gradient(135deg, #1B4F72 0%, #2E86C1 100%)',
          color: 'white',
          border: 'none',
          cursor: 'pointer',
          boxShadow: '0 4px 20px rgba(27,79,114,0.4)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transition: 'all 0.3s ease',
          zIndex: 9999,
          transform: isOpen ? 'scale(0.9)' : 'scale(1)',
        }}
        title="Abel Assistant"
      >
        {isOpen ? (
          <svg width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path d="M6 18L18 6M6 6l12 12" />
          </svg>
        ) : (
          <svg width="28" height="28" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
          </svg>
        )}
        {unread > 0 && !isOpen && (
          <span style={{
            position: 'absolute',
            top: '-4px',
            right: '-4px',
            background: '#E67E22',
            color: 'white',
            borderRadius: '50%',
            width: '22px',
            height: '22px',
            fontSize: '12px',
            fontWeight: '700',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}>
            {unread}
          </span>
        )}
      </button>

      {isOpen && (
        <div style={{
          position: 'fixed',
          bottom: window.innerWidth < 640 ? '0' : '96px',
          right: window.innerWidth < 640 ? '0' : '24px',
          left: window.innerWidth < 640 ? '0' : 'auto',
          top: window.innerWidth < 640 ? '0' : 'auto',
          width: window.innerWidth < 640 ? '100%' : '400px',
          maxWidth: window.innerWidth < 640 ? '100%' : 'calc(100vw - 48px)',
          height: window.innerWidth < 640 ? '100%' : '560px',
          maxHeight: window.innerWidth < 640 ? '100%' : 'calc(100vh - 140px)',
          borderRadius: window.innerWidth < 640 ? '0' : '16px',
          overflow: 'hidden',
          boxShadow: '0 8px 40px rgba(0,0,0,0.2)',
          display: 'flex',
          flexDirection: 'column',
          zIndex: 9998,
          background: '#fff',
          border: window.innerWidth < 640 ? 'none' : '1px solid #e5e7eb',
        }}>
          <div style={{
            background: 'linear-gradient(135deg, #1B4F72 0%, #2E86C1 100%)',
            padding: '16px 20px',
            color: 'white',
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            flexShrink: 0,
          }}>
            <div style={{
              width: '36px',
              height: '36px',
              borderRadius: '50%',
              background: 'rgba(255,255,255,0.2)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '18px',
            }}>
              {'\uD83E\uDEB5'}
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: '700', fontSize: '15px' }}>Abel Assistant</div>
              <div style={{ fontSize: '12px', opacity: 0.85 }}>
                {loading ? 'Typing...' : 'Online \u2014 Ask me anything'}
              </div>
            </div>
            <button
              onClick={() => {
                setMessages([])
                setConversationId(null)
              }}
              style={{
                background: 'rgba(255,255,255,0.15)',
                border: 'none',
                color: 'white',
                borderRadius: '8px',
                padding: '6px 10px',
                fontSize: '12px',
                cursor: 'pointer',
              }}
              title="New conversation"
            >
              New Chat
            </button>
          </div>

          <div style={{
            flex: 1,
            overflowY: 'auto',
            padding: '16px',
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
            background: '#f8f9fa',
          }}>
            {messages.map((msg, idx) => (
              <div key={idx} style={{
                display: 'flex',
                justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start',
              }}>
                <div style={{
                  maxWidth: '85%',
                  padding: '10px 14px',
                  borderRadius: msg.role === 'user'
                    ? '14px 14px 4px 14px'
                    : '14px 14px 14px 4px',
                  background: msg.role === 'user'
                    ? 'linear-gradient(135deg, #1B4F72 0%, #2E86C1 100%)'
                    : 'white',
                  color: msg.role === 'user' ? 'white' : '#1f2937',
                  fontSize: '13.5px',
                  lineHeight: '1.5',
                  boxShadow: msg.role === 'user'
                    ? 'none'
                    : '0 1px 3px rgba(0,0,0,0.08)',
                  border: msg.role === 'user' ? 'none' : '1px solid #e5e7eb',
                }}>
                  <div dangerouslySetInnerHTML={{ __html: formatContent(msg.content) }} />
                  {msg.intent && msg.role === 'assistant' && msg.intent !== 'GREETING' && msg.intent !== 'GENERAL' && (
                    <div style={{
                      marginTop: '6px',
                      fontSize: '10px',
                      color: '#9ca3af',
                      textTransform: 'uppercase',
                      letterSpacing: '0.5px',
                    }}>
                      {msg.intent.replace(/_/g, ' ')}
                    </div>
                  )}
                </div>
              </div>
            ))}

            {loading && (
              <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
                <div style={{
                  background: 'white',
                  borderRadius: '14px 14px 14px 4px',
                  padding: '12px 18px',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
                  border: '1px solid #e5e7eb',
                  display: 'flex',
                  gap: '4px',
                }}>
                  <span style={{ animation: 'bounce 1.4s infinite ease-in-out', animationDelay: '0s', width: '8px', height: '8px', borderRadius: '50%', background: '#9ca3af', display: 'inline-block' }} />
                  <span style={{ animation: 'bounce 1.4s infinite ease-in-out', animationDelay: '0.2s', width: '8px', height: '8px', borderRadius: '50%', background: '#9ca3af', display: 'inline-block' }} />
                  <span style={{ animation: 'bounce 1.4s infinite ease-in-out', animationDelay: '0.4s', width: '8px', height: '8px', borderRadius: '50%', background: '#9ca3af', display: 'inline-block' }} />
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {messages.length <= 1 && (
            <div style={{
              padding: '8px 16px',
              display: 'flex',
              gap: '6px',
              flexWrap: 'wrap',
              background: '#f8f9fa',
              borderTop: '1px solid #e5e7eb',
            }}>
              {quickActions.map((qa, i) => (
                <button
                  key={i}
                  onClick={() => sendQuickAction(qa.msg)}
                  style={{
                    background: 'white',
                    border: '1px solid #d1d5db',
                    borderRadius: '20px',
                    padding: '6px 12px',
                    fontSize: '12px',
                    cursor: 'pointer',
                    color: '#374151',
                    transition: 'all 0.2s',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = '#1B4F72'
                    e.currentTarget.style.color = 'white'
                    e.currentTarget.style.borderColor = '#1B4F72'
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'white'
                    e.currentTarget.style.color = '#374151'
                    e.currentTarget.style.borderColor = '#d1d5db'
                  }}
                >
                  {qa.label}
                </button>
              ))}
            </div>
          )}

          <form
            id="agent-chat-form"
            onSubmit={sendMessage}
            style={{
              padding: '12px 16px',
              borderTop: '1px solid #e5e7eb',
              display: 'flex',
              gap: '8px',
              background: 'white',
              flexShrink: 0,
            }}
          >
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask about orders, deliveries, pricing..."
              disabled={loading}
              style={{
                flex: 1,
                padding: '10px 14px',
                borderRadius: '24px',
                border: '1px solid #d1d5db',
                fontSize: '14px',
                outline: 'none',
                transition: 'border-color 0.2s',
                background: loading ? '#f9fafb' : 'white',
              }}
              onFocus={(e) => { e.currentTarget.style.borderColor = '#1B4F72' }}
              onBlur={(e) => { e.currentTarget.style.borderColor = '#d1d5db' }}
            />
            <button
              type="submit"
              disabled={loading || !input.trim()}
              style={{
                width: '40px',
                height: '40px',
                borderRadius: '50%',
                background: input.trim() ? 'linear-gradient(135deg, #1B4F72 0%, #2E86C1 100%)' : '#e5e7eb',
                color: 'white',
                border: 'none',
                cursor: input.trim() ? 'pointer' : 'default',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'all 0.2s',
                flexShrink: 0,
              }}
            >
              <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" />
              </svg>
            </button>
          </form>
        </div>
      )}

      <style dangerouslySetInnerHTML={{ __html: '@keyframes bounce { 0%, 80%, 100% { transform: scale(0); } 40% { transform: scale(1); } }' }} />
    </>
  )
}
