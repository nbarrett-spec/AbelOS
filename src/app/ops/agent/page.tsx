'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useToast } from '@/contexts/ToastContext'

interface Conversation {
  id: string; channel: string; status: string; subject: string;
  lastMessageAt: string; createdAt: string; escalatedAt: string | null;
  companyName: string; contactName: string; email: string;
  escalatedToName: string | null; messageCount: number; lastMessage: string;
}

interface ScheduleRequest {
  id: string; requestNumber: string; builderId: string; status: string;
  requestType: string; currentDate: string; requestedDate: string;
  requestedTime: string | null; reason: string | null;
  autoApproved: boolean; createdAt: string;
  companyName: string; contactName: string; phone: string; email: string;
  jobNumber: string | null; community: string | null; jobAddress: string | null;
  deliveryNumber: string | null; reviewerName: string | null; reviewedAt: string | null;
}

interface Stats {
  activeConversations: number; escalatedConversations: number;
  pendingScheduleChanges: number; todayConversations: number;
  todayMessages: number; autoApproved: number; totalScheduleRequests: number;
}

export default function AgentDashboard() {
  const { addToast } = useToast()
  const [tab, setTab] = useState<'overview' | 'conversations' | 'schedule-requests'>('overview')
  const [stats, setStats] = useState<Stats | null>(null)
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [scheduleRequests, setScheduleRequests] = useState<ScheduleRequest[]>([])
  const [statusFilter, setStatusFilter] = useState('')
  const [channelFilter, setChannelFilter] = useState('')
  const [scrStatusFilter, setScrStatusFilter] = useState('PENDING')
  const [loading, setLoading] = useState(true)
  const [selectedConv, setSelectedConv] = useState<string | null>(null)
  const [convMessages, setConvMessages] = useState<any[]>([])
  const [staffId, setStaffId] = useState<string | null>(null)
  const [staffReply, setStaffReply] = useState('')
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Fetch logged-in staff ID from cookie on mount
  useEffect(() => {
    async function fetchStaffId() {
      try {
        const res = await fetch('/api/ops/me')
        if (res.ok) {
          const data = await res.json()
          setStaffId(data.staffId || null)
        }
      } catch {
        // Fallback: staff ID will be sent from the server-side auth
        setStaffId(null)
      }
    }
    fetchStaffId()
  }, [])

  // Load data on tab/filter change
  useEffect(() => { loadData() }, [tab, statusFilter, channelFilter, scrStatusFilter])

  // 30-second polling
  useEffect(() => {
    pollRef.current = setInterval(() => { loadData() }, 30000)
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [tab, statusFilter, channelFilter, scrStatusFilter])

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      if (tab === 'overview' || tab === 'conversations') {
        const statsRes = await fetch('/api/ops/agent?view=stats')
        const statsData = await statsRes.json()
        setStats(statsData.stats)
      }
      if (tab === 'conversations' || tab === 'overview') {
        const params = new URLSearchParams()
        if (statusFilter) params.set('status', statusFilter)
        if (channelFilter) params.set('channel', channelFilter)
        const res = await fetch(`/api/ops/agent?${params}`)
        const data = await res.json()
        setConversations(data.conversations || [])
      }
      if (tab === 'schedule-requests' || tab === 'overview') {
        const res = await fetch(`/api/ops/agent?view=schedule-requests&status=${scrStatusFilter}`)
        const data = await res.json()
        setScheduleRequests(data.requests || [])
      }
    } catch (e) { console.error(e) }
    setLoading(false)
  }, [tab, statusFilter, channelFilter, scrStatusFilter])

  async function handleScheduleAction(requestId: string, action: 'approve' | 'deny', notes?: string) {
    if (!staffId) { addToast({ type: 'error', title: 'Session Error', message: 'Staff session not found. Please log in again.' }); return }
    try {
      await fetch('/api/ops/agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: action === 'approve' ? 'approve_schedule_change' : 'deny_schedule_change',
          requestId, staffId, notes,
        }),
      })
      loadData()
    } catch (e) { console.error(e) }
  }

  async function handleConvAction(conversationId: string, action: string) {
    if (!staffId) { addToast({ type: 'error', title: 'Session Error', message: 'Staff session not found. Please log in again.' }); return }
    try {
      await fetch('/api/ops/agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, conversationId, staffId }),
      })
      loadData()
    } catch (e) { console.error(e) }
  }

  async function sendStaffReply() {
    if (!selectedConv || !staffReply.trim() || !staffId) return
    try {
      await fetch('/api/ops/agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'staff_reply', conversationId: selectedConv, message: staffReply.trim(), staffId }),
      })
      setStaffReply('')
      loadConversation(selectedConv) // reload messages
    } catch (e) { console.error(e) }
  }

  async function loadConversation(convId: string) {
    setSelectedConv(convId)
    try {
      // Use ops-specific endpoint for conversation messages
      const res = await fetch(`/api/ops/agent/messages?conversationId=${convId}`)
      const data = await res.json()
      setConvMessages(data.messages || [])
    } catch (e) { console.error(e) }
  }

  function formatDate(d: string | null) {
    if (!d) return '\u2014'
    return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  }

  /** Escape HTML to prevent XSS from user-generated content */
  function escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
  }

  const channelColors: Record<string, string> = { PORTAL: '#1B4F72', SMS: '#27AE60', EMAIL: '#8E44AD' }
  const statusColors: Record<string, string> = { ACTIVE: '#27AE60', ESCALATED: '#E74C3C', RESOLVED: '#95A5A6', PENDING: '#F39C12', APPROVED: '#27AE60', DENIED: '#E74C3C' }

  return (
    <div style={{ padding: '24px', maxWidth: '1400px', margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <div>
          <h1 style={{ fontSize: '24px', fontWeight: '700', color: '#1B4F72', margin: 0 }}>AI Agent Dashboard</h1>
          <p style={{ color: '#6b7280', margin: '4px 0 0' }}>
            Monitor conversations, approve schedule changes, manage escalations
            {loading && <span style={{ marginLeft: '8px', color: '#F39C12' }}>{'\u2022'} Refreshing...</span>}
          </p>
        </div>
        <button onClick={loadData} style={{ background: '#1B4F72', color: 'white', border: 'none', borderRadius: '8px', padding: '8px 16px', cursor: 'pointer', fontSize: '14px' }}>
          Refresh
        </button>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '4px', marginBottom: '24px', borderBottom: '2px solid #e5e7eb', paddingBottom: '0' }}>
        {(['overview', 'conversations', 'schedule-requests'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            padding: '10px 20px', border: 'none', cursor: 'pointer', fontSize: '14px', fontWeight: '600',
            background: tab === t ? '#1B4F72' : 'transparent',
            color: tab === t ? 'white' : '#6b7280',
            borderRadius: '8px 8px 0 0',
            transition: 'all 0.2s',
          }}>
            {t === 'overview' ? '\uD83D\uDCCA Overview' : t === 'conversations' ? '\uD83D\uDCAC Conversations' : '\uD83D\uDCC5 Schedule Requests'}
          </button>
        ))}
      </div>

      {/* Overview Tab */}
      {tab === 'overview' && stats && (
        <div>
          {/* Stats Cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '16px', marginBottom: '32px' }}>
            {[
              { label: 'Active Chats', value: stats.activeConversations, color: '#27AE60', icon: '\uD83D\uDCAC' },
              { label: 'Escalated', value: stats.escalatedConversations, color: '#E74C3C', icon: '\uD83D\uDD34' },
              { label: 'Pending Approvals', value: stats.pendingScheduleChanges, color: '#F39C12', icon: '\u23F3' },
              { label: "Today's Chats", value: stats.todayConversations, color: '#1B4F72', icon: '\uD83D\uDCCA' },
              { label: "Today's Messages", value: stats.todayMessages, color: '#8E44AD', icon: '\u2709\uFE0F' },
              { label: 'Auto-Approved', value: stats.autoApproved, color: '#27AE60', icon: '\u2705' },
            ].map((s, i) => (
              <div key={i} style={{ background: 'white', borderRadius: '12px', padding: '20px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)', borderLeft: `4px solid ${s.color}` }}>
                <div style={{ fontSize: '12px', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{s.icon} {s.label}</div>
                <div style={{ fontSize: '28px', fontWeight: '700', color: s.color, marginTop: '4px' }}>{s.value}</div>
              </div>
            ))}
          </div>

          {/* Escalated Conversations */}
          {conversations.filter(c => c.status === 'ESCALATED').length > 0 && (
            <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: '12px', padding: '20px', marginBottom: '24px' }}>
              <h3 style={{ color: '#991B1B', margin: '0 0 12px', fontSize: '16px' }}>{'\uD83D\uDD34'} Escalated Conversations</h3>
              {conversations.filter(c => c.status === 'ESCALATED').map(c => (
                <div key={c.id} style={{ background: 'white', borderRadius: '8px', padding: '12px 16px', marginBottom: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <strong>{escapeHtml(c.companyName)}</strong> ({escapeHtml(c.contactName)}) {'\u2014'} <span style={{ color: channelColors[c.channel] || '#666', fontWeight: '600' }}>{c.channel}</span>
                    <div style={{ fontSize: '13px', color: '#6b7280', marginTop: '2px' }}>
                      {escapeHtml((c.lastMessage || '').substring(0, 80))}... {'\u2022'} {formatDate(c.escalatedAt)}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button onClick={() => handleConvAction(c.id, 'take_over')} style={{ background: '#1B4F72', color: 'white', border: 'none', borderRadius: '6px', padding: '6px 12px', cursor: 'pointer', fontSize: '12px' }}>Take Over</button>
                    <button onClick={() => handleConvAction(c.id, 'resolve')} style={{ background: '#27AE60', color: 'white', border: 'none', borderRadius: '6px', padding: '6px 12px', cursor: 'pointer', fontSize: '12px' }}>Resolve</button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Pending Schedule Requests */}
          {scheduleRequests.filter(r => r.status === 'PENDING').length > 0 && (
            <div style={{ background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: '12px', padding: '20px' }}>
              <h3 style={{ color: '#92400E', margin: '0 0 12px', fontSize: '16px' }}>{'\u23F3'} Pending Schedule Changes</h3>
              {scheduleRequests.filter(r => r.status === 'PENDING').slice(0, 5).map(r => (
                <div key={r.id} style={{ background: 'white', borderRadius: '8px', padding: '12px 16px', marginBottom: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <strong>{escapeHtml(r.requestNumber)}</strong> {'\u2014'} {escapeHtml(r.companyName)}
                    <div style={{ fontSize: '13px', color: '#6b7280', marginTop: '2px' }}>
                      {r.jobNumber && `Job ${escapeHtml(r.jobNumber)}`}{r.deliveryNumber && ` / ${escapeHtml(r.deliveryNumber)}`}
                      {' \u2192 '}{new Date(r.requestedDate).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                      {r.reason && ` \u2014 "${escapeHtml(r.reason)}"`}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button onClick={() => handleScheduleAction(r.id, 'approve')} style={{ background: '#27AE60', color: 'white', border: 'none', borderRadius: '6px', padding: '6px 12px', cursor: 'pointer', fontSize: '12px' }}>Approve</button>
                    <button onClick={() => handleScheduleAction(r.id, 'deny')} style={{ background: '#E74C3C', color: 'white', border: 'none', borderRadius: '6px', padding: '6px 12px', cursor: 'pointer', fontSize: '12px' }}>Deny</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Conversations Tab */}
      {tab === 'conversations' && (
        <div>
          {/* Filters */}
          <div style={{ display: 'flex', gap: '12px', marginBottom: '16px' }}>
            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={{ padding: '8px 12px', borderRadius: '8px', border: '1px solid #d1d5db', fontSize: '14px' }}>
              <option value="">All Status</option>
              <option value="ACTIVE">Active</option>
              <option value="ESCALATED">Escalated</option>
              <option value="RESOLVED">Resolved</option>
            </select>
            <select value={channelFilter} onChange={e => setChannelFilter(e.target.value)} style={{ padding: '8px 12px', borderRadius: '8px', border: '1px solid #d1d5db', fontSize: '14px' }}>
              <option value="">All Channels</option>
              <option value="PORTAL">Portal</option>
              <option value="SMS">SMS</option>
              <option value="EMAIL">Email</option>
            </select>
          </div>

          {/* Conversation List + Detail */}
          <div style={{ display: 'grid', gridTemplateColumns: selectedConv ? '1fr 1fr' : '1fr', gap: '16px' }}>
            <div style={{ background: 'white', borderRadius: '12px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)', overflow: 'hidden' }}>
              {conversations.length === 0 ? (
                <div style={{ padding: '40px', textAlign: 'center', color: '#9ca3af' }}>No conversations found</div>
              ) : conversations.map(c => (
                <div key={c.id} onClick={() => loadConversation(c.id)} style={{
                  padding: '14px 20px', borderBottom: '1px solid #f3f4f6', cursor: 'pointer',
                  background: selectedConv === c.id ? '#EBF5FB' : 'white',
                  transition: 'background 0.15s',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                      <span style={{ background: channelColors[c.channel] || '#666', color: 'white', padding: '2px 8px', borderRadius: '12px', fontSize: '11px', fontWeight: '600' }}>{c.channel}</span>
                      <strong style={{ fontSize: '14px' }}>{escapeHtml(c.companyName)}</strong>
                      <span style={{ fontSize: '13px', color: '#6b7280' }}>({escapeHtml(c.contactName)})</span>
                    </div>
                    <span style={{ background: statusColors[c.status] || '#999', color: 'white', padding: '2px 10px', borderRadius: '12px', fontSize: '11px', fontWeight: '600' }}>{c.status}</span>
                  </div>
                  <div style={{ fontSize: '13px', color: '#6b7280', marginTop: '4px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {escapeHtml((c.lastMessage || 'No messages').substring(0, 100))}
                  </div>
                  <div style={{ fontSize: '11px', color: '#9ca3af', marginTop: '4px' }}>
                    {c.messageCount} messages {'\u2022'} {formatDate(c.lastMessageAt)}
                  </div>
                </div>
              ))}
            </div>

            {/* Conversation Detail */}
            {selectedConv && (
              <div style={{ background: 'white', borderRadius: '12px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)', display: 'flex', flexDirection: 'column', maxHeight: '600px' }}>
                <div style={{ padding: '16px 20px', borderBottom: '1px solid #e5e7eb', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <h3 style={{ margin: 0, fontSize: '16px', color: '#1B4F72' }}>Conversation</h3>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button onClick={() => handleConvAction(selectedConv, 'take_over')} style={{ background: '#1B4F72', color: 'white', border: 'none', borderRadius: '6px', padding: '6px 12px', cursor: 'pointer', fontSize: '12px' }}>Take Over</button>
                    <button onClick={() => handleConvAction(selectedConv, 'resolve')} style={{ background: '#27AE60', color: 'white', border: 'none', borderRadius: '6px', padding: '6px 12px', cursor: 'pointer', fontSize: '12px' }}>Resolve</button>
                    <button onClick={() => setSelectedConv(null)} style={{ background: '#e5e7eb', color: '#374151', border: 'none', borderRadius: '6px', padding: '6px 12px', cursor: 'pointer', fontSize: '12px' }}>Close</button>
                  </div>
                </div>
                <div style={{ flex: 1, overflowY: 'auto', padding: '16px' }}>
                  {convMessages.map((m: any, i: number) => (
                    <div key={i} style={{ marginBottom: '12px', display: 'flex', justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start' }}>
                      <div style={{
                        maxWidth: '80%', padding: '10px 14px', borderRadius: '12px', fontSize: '13px', lineHeight: '1.5',
                        background: m.role === 'user' ? '#EBF5FB' : '#f3f4f6',
                        border: `1px solid ${m.role === 'user' ? '#BFDBFE' : '#e5e7eb'}`,
                      }}>
                        <div style={{ fontSize: '10px', color: '#9ca3af', marginBottom: '4px', textTransform: 'uppercase' }}>
                          {m.role === 'user' ? 'Builder' : 'Agent'} {'\u2022'} {m.intent || ''} {'\u2022'} {formatDate(m.createdAt)}
                        </div>
                        <div style={{ whiteSpace: 'pre-wrap' }}>{escapeHtml(m.content || '')}</div>
                      </div>
                    </div>
                  ))}
                </div>
                {/* Staff reply input */}
                <div style={{ padding: '12px 16px', borderTop: '1px solid #e5e7eb', display: 'flex', gap: '8px' }}>
                  <input
                    type="text"
                    value={staffReply}
                    onChange={e => setStaffReply(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') sendStaffReply() }}
                    placeholder="Type a staff reply..."
                    style={{ flex: 1, padding: '8px 12px', borderRadius: '8px', border: '1px solid #d1d5db', fontSize: '13px', outline: 'none' }}
                  />
                  <button onClick={sendStaffReply} disabled={!staffReply.trim()} style={{ background: '#1B4F72', color: 'white', border: 'none', borderRadius: '8px', padding: '8px 14px', cursor: 'pointer', fontSize: '13px', opacity: staffReply.trim() ? 1 : 0.5 }}>Send</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Schedule Requests Tab */}
      {tab === 'schedule-requests' && (
        <div>
          <div style={{ display: 'flex', gap: '12px', marginBottom: '16px' }}>
            <select value={scrStatusFilter} onChange={e => setScrStatusFilter(e.target.value)} style={{ padding: '8px 12px', borderRadius: '8px', border: '1px solid #d1d5db', fontSize: '14px' }}>
              <option value="PENDING">Pending</option>
              <option value="APPROVED">Approved</option>
              <option value="DENIED">Denied</option>
            </select>
          </div>

          <div style={{ background: 'white', borderRadius: '12px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)', overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
              <thead>
                <tr style={{ background: '#f9fafb', borderBottom: '2px solid #e5e7eb' }}>
                  {['Request #', 'Builder', 'Job/Delivery', 'Current Date', 'Requested Date', 'Reason', 'Status', 'Actions'].map(h => (
                    <th key={h} style={{ padding: '12px 16px', textAlign: 'left', fontWeight: '600', color: '#374151', fontSize: '12px', textTransform: 'uppercase' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {scheduleRequests.length === 0 ? (
                  <tr><td colSpan={8} style={{ padding: '40px', textAlign: 'center', color: '#9ca3af' }}>No schedule requests found</td></tr>
                ) : scheduleRequests.map(r => (
                  <tr key={r.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                    <td style={{ padding: '12px 16px', fontWeight: '600', color: '#1B4F72' }}>{escapeHtml(r.requestNumber)}</td>
                    <td style={{ padding: '12px 16px' }}>
                      <div>{escapeHtml(r.companyName)}</div>
                      <div style={{ fontSize: '12px', color: '#6b7280' }}>{escapeHtml(r.contactName)}</div>
                    </td>
                    <td style={{ padding: '12px 16px' }}>
                      {r.jobNumber && <div>Job: {escapeHtml(r.jobNumber)}</div>}
                      {r.deliveryNumber && <div>Del: {escapeHtml(r.deliveryNumber)}</div>}
                      {r.community && <div style={{ fontSize: '12px', color: '#6b7280' }}>{escapeHtml(r.community)}</div>}
                    </td>
                    <td style={{ padding: '12px 16px' }}>{r.currentDate ? new Date(r.currentDate).toLocaleDateString() : '\u2014'}</td>
                    <td style={{ padding: '12px 16px', fontWeight: '600' }}>{new Date(r.requestedDate).toLocaleDateString()}{r.requestedTime && <div style={{ fontSize: '12px', color: '#6b7280' }}>{escapeHtml(r.requestedTime)}</div>}</td>
                    <td style={{ padding: '12px 16px', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.reason ? escapeHtml(r.reason) : '\u2014'}</td>
                    <td style={{ padding: '12px 16px' }}>
                      <span style={{
                        background: statusColors[r.status] || '#999', color: 'white',
                        padding: '3px 10px', borderRadius: '12px', fontSize: '12px', fontWeight: '600',
                      }}>{r.status}{r.autoApproved ? ' (Auto)' : ''}</span>
                    </td>
                    <td style={{ padding: '12px 16px' }}>
                      {r.status === 'PENDING' && (
                        <div style={{ display: 'flex', gap: '6px' }}>
                          <button onClick={() => handleScheduleAction(r.id, 'approve')} style={{ background: '#27AE60', color: 'white', border: 'none', borderRadius: '6px', padding: '5px 10px', cursor: 'pointer', fontSize: '12px' }}>{'\u2713'}</button>
                          <button onClick={() => handleScheduleAction(r.id, 'deny')} style={{ background: '#E74C3C', color: 'white', border: 'none', borderRadius: '6px', padding: '5px 10px', cursor: 'pointer', fontSize: '12px' }}>{'\u2717'}</button>
                        </div>
                      )}
                      {r.status !== 'PENDING' && r.reviewerName && (
                        <div style={{ fontSize: '12px', color: '#6b7280' }}>By {escapeHtml(r.reviewerName)}<br />{formatDate(r.reviewedAt)}</div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
