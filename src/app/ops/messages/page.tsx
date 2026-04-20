'use client'

import { useEffect, useState, useRef } from 'react'
import { useStaffAuth } from '@/hooks/useStaffAuth'

interface Message {
  id: string
  senderId: string
  senderName: string
  senderRole: string
  senderDepartment: string
  body: string
  timestamp: string
  conversationId: string
}

interface Conversation {
  id: string
  name: string
  participantCount: number
  type: string
  departmentScope?: string
  lastMessage?: string
  lastMessageTime?: string
  unreadCount: number
  lastMessageSender?: string
}

interface DepartmentChannel {
  id: string
  name: string
  departmentScope: string
  memberCount: number
  lastMessage?: string
  lastMessageTime?: string
  unreadCount: number
}

interface StaffMember {
  id: string
  firstName: string
  lastName: string
  role: string
  department: string
}

const DEPARTMENT_COLORS: Record<string, string> = {
  'SALES': 'bg-blue-500',
  'OPERATIONS': 'bg-green-500',
  'MANUFACTURING': 'bg-orange-500',
  'ACCOUNTING': 'bg-purple-500',
  'DELIVERY': 'bg-teal-500',
  'WAREHOUSE': 'bg-amber-500',
  'INSTALLATION': 'bg-red-500',
  'EXECUTIVE': 'bg-slate-700',
  'ESTIMATING': 'bg-cyan-500',
  'PURCHASING': 'bg-indigo-500',
}

export default function MessagesPage() {
  const { staff } = useStaffAuth()
  const currentUserId = staff?.id || ''
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [departmentChannels, setDepartmentChannels] = useState<DepartmentChannel[]>([])
  const [selectedConversation, setSelectedConversation] = useState<string | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [messageBody, setMessageBody] = useState('')
  const [activeTab, setActiveTab] = useState<'dms' | 'groups' | 'channels' | 'builders'>('channels')
  const [showNewConversation, setShowNewConversation] = useState(false)
  const [builderConversations, setBuilderConversations] = useState<Conversation[]>([])
  const [isBuilderThread, setIsBuilderThread] = useState(false)
  const [staffList, setStaffList] = useState<StaffMember[]>([])
  const [selectedRecipients, setSelectedRecipients] = useState<string[]>([])
  const [newConversationName, setNewConversationName] = useState('')
  const [loading, setLoading] = useState(true)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null)

  // Scroll to bottom on new messages
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  // Load conversations
  useEffect(() => {
    if (!currentUserId) return

    async function loadConversations() {
      try {
        const response = await fetch(`/api/ops/messages?staffId=${currentUserId}`)
        if (response.ok) {
          const data = await response.json()
          // Map API shape to page shape
          const mapped = (data.conversations || []).map((c: any) => ({
            id: c.id,
            name: c.name || 'Unnamed',
            participantCount: c.participantCount || 0,
            type: c.type,
            departmentScope: c.departmentScope,
            lastMessage: c.lastMessage?.body || null,
            lastMessageTime: c.lastMessage?.createdAt || c.lastMessageAt || null,
            unreadCount: c.unreadCount || 0,
            lastMessageSender: c.lastMessage?.sender
              ? `${c.lastMessage.sender.firstName} ${c.lastMessage.sender.lastName}`
              : null,
          }))
          setConversations(mapped)
        }
      } catch (error) {
        console.error('Failed to load conversations:', error)
      }
    }

    loadConversations()
  }, [currentUserId])

  // Load department channels
  useEffect(() => {
    async function loadChannels() {
      try {
        const response = await fetch('/api/ops/messages/departments')
        if (response.ok) {
          const data = await response.json()
          const mapped = (data.channels || []).map((c: any) => ({
            id: c.id,
            name: c.name || c.departmentScope,
            departmentScope: c.departmentScope,
            memberCount: c._count?.participants || 0,
            unreadCount: 0,
          }))
          setDepartmentChannels(mapped)
        }
      } catch (error) {
        console.error('Failed to load department channels:', error)
      }
    }

    loadChannels()
  }, [])

  // Load builder support conversations
  useEffect(() => {
    if (!currentUserId) return
    async function loadBuilderConversations() {
      try {
        const response = await fetch(`/api/ops/builder-chat?staffId=${currentUserId}`)
        if (response.ok) {
          const data = await response.json()
          const mapped = (data.conversations || []).map((c: any) => ({
            id: c.id,
            name: c.builderName || c.name || 'Builder Thread',
            participantCount: c.participantCount || 0,
            type: 'BUILDER_SUPPORT',
            lastMessage: c.lastMessagePreview || null,
            lastMessageTime: c.lastMessageAt || null,
            unreadCount: c.unreadCount || 0,
            lastMessageSender: c.lastMessageSender || null,
          }))
          setBuilderConversations(mapped)
        }
      } catch (error) {
        console.error('Failed to load builder conversations:', error)
      }
    }
    loadBuilderConversations()
    const interval = setInterval(loadBuilderConversations, 15000)
    return () => clearInterval(interval)
  }, [currentUserId])

  // Load staff list for new conversation modal
  useEffect(() => {
    if (showNewConversation && currentUserId) {
      const loadStaff = async () => {
        try {
          const response = await fetch('/api/ops/staff')
          if (response.ok) {
            const data = await response.json()
            const staffArr = data.staff || data || []
            setStaffList(
              staffArr
                .filter((s: StaffMember) => s.id !== currentUserId)
                .map((s: any) => ({
                  id: s.id,
                  firstName: s.firstName,
                  lastName: s.lastName,
                  role: s.role,
                  department: s.department,
                }))
            )
          }
        } catch (error) {
          console.error('Failed to load staff list:', error)
        }
      }

      loadStaff()
    }
  }, [showNewConversation, currentUserId])

  // Load messages for selected conversation
  useEffect(() => {
    if (!selectedConversation || !currentUserId) return

    async function loadMessages() {
      try {
        setLoading(true)
        const response = await fetch(
          `/api/ops/messages/${selectedConversation}?staffId=${currentUserId}`
        )
        if (response.ok) {
          const data = await response.json()
          // Map API shape to page shape
          const mapped = (data.messages || []).map((m: any) => ({
            id: m.id,
            senderId: m.sender?.id || '',
            senderName: m.sender ? `${m.sender.firstName} ${m.sender.lastName}` : 'Unknown',
            senderRole: m.sender?.role || '',
            senderDepartment: m.sender?.department || '',
            body: m.body,
            timestamp: m.createdAt,
            conversationId: selectedConversation,
          }))
          setMessages(mapped)
        }
      } catch (error) {
        console.error('Failed to load messages:', error)
      } finally {
        setLoading(false)
      }
    }

    loadMessages()

    // Set up polling for new messages
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current)
    }

    pollIntervalRef.current = setInterval(loadMessages, 10000)

    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current)
      }
    }
  }, [selectedConversation, currentUserId])

  // Send message
  const handleSendMessage = async () => {
    if (!messageBody.trim() || !selectedConversation || !currentUserId) return

    try {
      // Builder thread uses different API
      if (isBuilderThread) {
        const response = await fetch('/api/ops/builder-chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            conversationId: selectedConversation,
            staffId: currentUserId,
            message: messageBody,
          }),
        })
        if (response.ok) {
          setMessageBody('')
          // Reload builder thread messages via the standard messages endpoint
          const messagesResponse = await fetch(
            `/api/ops/messages/${selectedConversation}?staffId=${currentUserId}`
          )
          if (messagesResponse.ok) {
            const data = await messagesResponse.json()
            const mapped = (data.messages || []).map((m: any) => ({
              id: m.id,
              senderId: m.sender?.id || m.builderSenderId || '',
              senderName: m.senderType === 'BUILDER'
                ? (m.builderSenderName || 'Builder')
                : (m.sender ? `${m.sender.firstName} ${m.sender.lastName}` : 'Unknown'),
              senderRole: m.senderType === 'BUILDER' ? 'BUILDER' : (m.sender?.role || ''),
              senderDepartment: m.senderType === 'BUILDER' ? '' : (m.sender?.department || ''),
              body: m.body,
              timestamp: m.createdAt,
              conversationId: selectedConversation,
            }))
            setMessages(mapped)
          }
        }
        return
      }

      const response = await fetch(
        `/api/ops/messages/${selectedConversation}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            body: messageBody,
            senderId: currentUserId,
          }),
        }
      )

      if (response.ok) {
        setMessageBody('')
        // Reload messages
        const messagesResponse = await fetch(
          `/api/ops/messages/${selectedConversation}?staffId=${currentUserId}`
        )
        if (messagesResponse.ok) {
          const data = await messagesResponse.json()
          const mapped = (data.messages || []).map((m: any) => ({
            id: m.id,
            senderId: m.sender?.id || '',
            senderName: m.sender ? `${m.sender.firstName} ${m.sender.lastName}` : 'Unknown',
            senderRole: m.sender?.role || '',
            senderDepartment: m.sender?.department || '',
            body: m.body,
            timestamp: m.createdAt,
            conversationId: selectedConversation,
          }))
          setMessages(mapped)
        }
      }
    } catch (error) {
      console.error('Failed to send message:', error)
    }
  }

  // Create new conversation
  const handleCreateConversation = async () => {
    if (selectedRecipients.length === 0 || !currentUserId) return

    try {
      const response = await fetch('/api/ops/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newConversationName || null,
          type: selectedRecipients.length === 1 ? 'DIRECT' : 'GROUP',
          participantIds: [currentUserId, ...selectedRecipients],
          createdById: currentUserId,
        }),
      })

      if (response.ok) {
        const data = await response.json()
        const conv = data.conversation
        if (conv) {
          setConversations(prev => [...prev, {
            id: conv.id,
            name: conv.name || 'New Conversation',
            participantCount: conv.participants?.length || 0,
            type: conv.type,
            departmentScope: conv.departmentScope,
            unreadCount: 0,
          }])
          setSelectedConversation(conv.id)
        }
        setSelectedRecipients([])
        setNewConversationName('')
        setShowNewConversation(false)
      }
    } catch (error) {
      console.error('Failed to create conversation:', error)
    }
  }

  // Filter conversations by tab
  const filteredConversations = conversations.filter(conv => {
    if (activeTab === 'dms') return conv.type === 'DIRECT'
    if (activeTab === 'groups') return conv.type === 'GROUP' || conv.type === 'CHANNEL'
    return false
  })

  const getInitials = (name: string) => {
    return name
      .split(' ')
      .map(word => word[0])
      .join('')
      .toUpperCase()
      .slice(0, 2)
  }

  const getDepartmentColor = (department?: string) => {
    return DEPARTMENT_COLORS[department || 'EXECUTIVE'] || 'bg-gray-500'
  }

  const selectedConvData = conversations.find(c => c.id === selectedConversation) ||
    departmentChannels.find(c => c.id === selectedConversation) ||
    builderConversations.find(c => c.id === selectedConversation)

  if (!staff) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-500">
        Loading...
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Messages</h1>
        <button
          onClick={() => setShowNewConversation(true)}
          className="px-4 py-2 bg-[#C9822B] text-white rounded-lg hover:bg-orange-600 transition-colors font-medium text-sm"
        >
          + New Message
        </button>
      </div>

      {/* Main container */}
      <div className="flex gap-4 flex-1 min-h-0">
        {/* Sidebar with conversations */}
        <div className="w-80 bg-white rounded-lg border border-gray-200 flex flex-col">
          {/* Tabs */}
          <div className="flex border-b border-gray-200">
            {[
              { id: 'dms', label: 'Direct Messages' },
              { id: 'groups', label: 'Groups' },
              { id: 'channels', label: 'Channels' },
              { id: 'builders', label: 'Builders' },
            ].map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={`flex-1 py-3 px-4 text-sm font-medium transition-colors border-b-2 ${
                  activeTab === tab.id
                    ? 'border-[#C9822B] text-[#C9822B]'
                    : 'border-transparent text-gray-600 hover:text-gray-900'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Conversations/Channels list */}
          <div className="flex-1 overflow-y-auto">
            {activeTab === 'builders' ? (
              // Builder support conversations
              builderConversations.length === 0 ? (
                <div className="p-4 text-center text-gray-500 text-sm">
                  No builder conversations
                </div>
              ) : (
                builderConversations.map(conv => (
                  <button
                    key={conv.id}
                    onClick={() => { setSelectedConversation(conv.id); setIsBuilderThread(true) }}
                    className={`w-full text-left p-3 border-b border-gray-100 hover:bg-gray-50 transition-colors ${
                      selectedConversation === conv.id ? 'bg-orange-50' : ''
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <h3 className="font-semibold text-gray-900 text-sm truncate flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full bg-[#C9822B] shrink-0" />
                          {conv.name}
                        </h3>
                        {conv.lastMessage && (
                          <p className="text-xs text-gray-600 truncate mt-1">
                            {conv.lastMessage}
                          </p>
                        )}
                      </div>
                      {conv.unreadCount > 0 && (
                        <span className="px-2 py-1 bg-[#C9822B] text-white rounded-full text-xs font-bold flex-shrink-0">
                          {conv.unreadCount}
                        </span>
                      )}
                    </div>
                    {conv.lastMessageTime && (
                      <p className="text-xs text-gray-400 mt-1">
                        {new Date(conv.lastMessageTime).toLocaleTimeString('en-US', {
                          hour: 'numeric',
                          minute: '2-digit',
                        })}
                      </p>
                    )}
                  </button>
                ))
              )
            ) : activeTab === 'channels' ? (
              // Department channels
              departmentChannels.length === 0 ? (
                <div className="p-4 text-center text-gray-500 text-sm">
                  No channels available
                </div>
              ) : (
                departmentChannels.map(channel => (
                  <button
                    key={channel.id}
                    onClick={() => { setSelectedConversation(channel.id); setIsBuilderThread(false) }}
                    className={`w-full text-left p-3 border-b border-gray-100 hover:bg-gray-50 transition-colors ${
                      selectedConversation === channel.id ? 'bg-orange-50' : ''
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <h3 className="font-semibold text-gray-900 text-sm truncate">
                          # {channel.name}
                        </h3>
                        <p className="text-xs text-gray-500 truncate">
                          {channel.departmentScope} &bull; {channel.memberCount} members
                        </p>
                      </div>
                      {channel.unreadCount > 0 && (
                        <span className="px-2 py-1 bg-[#C9822B] text-white rounded-full text-xs font-bold flex-shrink-0">
                          {channel.unreadCount}
                        </span>
                      )}
                    </div>
                  </button>
                ))
              )
            ) : (
              // Direct messages and groups
              filteredConversations.length === 0 ? (
                <div className="p-4 text-center text-gray-500 text-sm">
                  No {activeTab === 'dms' ? 'direct messages' : 'groups'} yet
                </div>
              ) : (
                filteredConversations.map(conv => (
                  <button
                    key={conv.id}
                    onClick={() => { setSelectedConversation(conv.id); setIsBuilderThread(false) }}
                    className={`w-full text-left p-3 border-b border-gray-100 hover:bg-gray-50 transition-colors ${
                      selectedConversation === conv.id ? 'bg-orange-50' : ''
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <h3 className="font-semibold text-gray-900 text-sm truncate">
                          {conv.name}
                        </h3>
                        {conv.lastMessage && (
                          <p className="text-xs text-gray-600 truncate mt-1">
                            {conv.lastMessageSender && (
                              <span className="font-semibold">{conv.lastMessageSender}: </span>
                            )}
                            {conv.lastMessage}
                          </p>
                        )}
                      </div>
                      {conv.unreadCount > 0 && (
                        <span className="px-2 py-1 bg-[#C9822B] text-white rounded-full text-xs font-bold flex-shrink-0">
                          {conv.unreadCount}
                        </span>
                      )}
                    </div>
                    {conv.lastMessageTime && (
                      <p className="text-xs text-gray-400 mt-1">
                        {new Date(conv.lastMessageTime).toLocaleTimeString('en-US', {
                          hour: 'numeric',
                          minute: '2-digit',
                        })}
                      </p>
                    )}
                  </button>
                ))
              )
            )}
          </div>
        </div>

        {/* Messages area */}
        <div className="flex-1 bg-white rounded-lg border border-gray-200 flex flex-col">
          {selectedConversation ? (
            <>
              {/* Conversation header */}
              <div className="p-4 border-b border-gray-200">
                <h2 className="font-semibold text-gray-900">
                  {selectedConvData?.name || 'Select a conversation'}
                </h2>
                {'participantCount' in (selectedConvData || {}) && (
                  <p className="text-xs text-gray-500 mt-1">
                    {(selectedConvData as any)?.participantCount || (selectedConvData as any)?.memberCount || 0} participants
                  </p>
                )}
              </div>

              {/* Messages */}
              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {loading ? (
                  <div className="flex items-center justify-center h-full text-gray-500">
                    Loading messages...
                  </div>
                ) : messages.length === 0 ? (
                  <div className="flex items-center justify-center h-full text-gray-500">
                    No messages yet. Start the conversation!
                  </div>
                ) : (
                  messages.map(message => (
                    <div key={message.id} className="flex gap-3">
                      <div
                        className={`${getDepartmentColor(
                          message.senderDepartment
                        )} text-white w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 font-semibold text-sm`}
                      >
                        {getInitials(message.senderName)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-baseline gap-2">
                          <span className="font-semibold text-gray-900 text-sm">
                            {message.senderName}
                          </span>
                          <span className="text-xs px-2 py-0.5 bg-gray-100 text-gray-700 rounded">
                            {message.senderRole}
                          </span>
                          <span className="text-xs text-gray-400">
                            {new Date(message.timestamp).toLocaleTimeString('en-US', {
                              hour: 'numeric',
                              minute: '2-digit',
                            })}
                          </span>
                        </div>
                        <p className="text-sm text-gray-800 mt-1 break-words">
                          {message.body}
                        </p>
                      </div>
                    </div>
                  ))
                )}
                <div ref={messagesEndRef} />
              </div>

              {/* Message input */}
              <div className="p-4 border-t border-gray-200">
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={messageBody}
                    onChange={e => setMessageBody(e.target.value)}
                    onKeyPress={e => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault()
                        handleSendMessage()
                      }
                    }}
                    placeholder="Type a message..."
                    className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C9822B] focus:border-transparent text-sm"
                  />
                  <button
                    onClick={handleSendMessage}
                    className="px-4 py-2 bg-[#C9822B] text-white rounded-lg hover:bg-orange-600 transition-colors font-medium text-sm"
                  >
                    Send
                  </button>
                </div>
              </div>
            </>
          ) : (
            <div className="flex items-center justify-center h-full text-gray-500">
              <div className="text-center">
                <p className="text-lg font-medium">No conversation selected</p>
                <p className="text-sm mt-2">Click on a conversation to start messaging</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* New Conversation Modal */}
      {showNewConversation && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
            <h3 className="text-lg font-bold text-gray-900 mb-4">New Message</h3>

            <div className="space-y-4">
              {/* Conversation name (optional for group) */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Group Name (optional)
                </label>
                <input
                  type="text"
                  value={newConversationName}
                  onChange={e => setNewConversationName(e.target.value)}
                  placeholder="Leave blank for direct message"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C9822B] focus:border-transparent text-sm"
                />
              </div>

              {/* Staff list */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Select Recipients
                </label>
                <div className="space-y-2 max-h-60 overflow-y-auto">
                  {staffList.map(s => (
                    <label
                      key={s.id}
                      className="flex items-center gap-3 p-2 hover:bg-gray-50 rounded cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={selectedRecipients.includes(s.id)}
                        onChange={e => {
                          if (e.target.checked) {
                            setSelectedRecipients([...selectedRecipients, s.id])
                          } else {
                            setSelectedRecipients(
                              selectedRecipients.filter(id => id !== s.id)
                            )
                          }
                        }}
                        className="w-4 h-4"
                      />
                      <div className="flex-1">
                        <p className="text-sm font-medium text-gray-900">{s.firstName} {s.lastName}</p>
                        <p className="text-xs text-gray-500">
                          {s.role} &bull; {s.department}
                        </p>
                      </div>
                    </label>
                  ))}
                </div>
              </div>

              {/* Selected count */}
              {selectedRecipients.length > 0 && (
                <p className="text-sm text-gray-600">
                  {selectedRecipients.length} recipient{selectedRecipients.length !== 1 ? 's' : ''} selected
                </p>
              )}
            </div>

            {/* Buttons */}
            <div className="flex gap-3 mt-6">
              <button
                onClick={() => {
                  setShowNewConversation(false)
                  setSelectedRecipients([])
                  setNewConversationName('')
                }}
                className="flex-1 px-4 py-2 text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors font-medium text-sm"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateConversation}
                disabled={selectedRecipients.length === 0}
                className="flex-1 px-4 py-2 bg-[#C9822B] text-white rounded-lg hover:bg-orange-600 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors font-medium text-sm"
              >
                Start Chat
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
