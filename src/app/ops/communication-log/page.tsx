'use client'

import { useState, useEffect } from 'react'

interface CommLog {
  id: string
  channel: string
  direction: string
  subject?: string
  body?: string
  fromAddress?: string
  toAddresses: string[]
  sentAt?: string
  duration?: number
  hasAttachments: boolean
  attachmentCount: number
  status: string
  aiSummary?: string
  builder?: { id: string; companyName: string; contactName: string }
  organization?: { id: string; name: string }
  attachments: { id: string; fileName: string; fileType: string; fileSize?: number }[]
}

const CHANNEL_CONFIG: Record<string, { icon: string; label: string; color: string }> = {
  EMAIL: { icon: '📧', label: 'Email', color: '#3B82F6' },
  PHONE: { icon: '📞', label: 'Phone', color: '#10B981' },
  TEXT: { icon: '💬', label: 'Text', color: '#8B5CF6' },
  IN_PERSON: { icon: '🤝', label: 'In Person', color: '#F59E0B' },
  VIDEO_CALL: { icon: '📹', label: 'Video Call', color: '#EC4899' },
  HYPHEN_NOTIFICATION: { icon: '🔗', label: 'Hyphen', color: '#E67E22' },
  SYSTEM: { icon: '🤖', label: 'System', color: '#6B7280' },
}

const DIRECTION_ICONS: Record<string, string> = {
  INBOUND: '↙️',
  OUTBOUND: '↗️',
  INTERNAL: '🔄',
}

export default function CommunicationLogPage() {
  const [logs, setLogs] = useState<CommLog[]>([])
  const [loading, setLoading] = useState(true)
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [channelFilter, setChannelFilter] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [showLogForm, setShowLogForm] = useState(false)
  const [logForm, setLogForm] = useState({ channel: 'PHONE', direction: 'OUTBOUND', subject: '', body: '', fromAddress: '', toAddresses: '' })

  useEffect(() => {
    fetchLogs()
  }, [page, channelFilter])

  async function fetchLogs() {
    try {
      const params = new URLSearchParams({ page: String(page), limit: '25' })
      if (channelFilter) params.set('channel', channelFilter)
      const res = await fetch(`/api/ops/communication-logs?${params}`)
      const data = await res.json()
      setLogs(data.logs || [])
      setTotal(data.total || 0)
    } catch (err) {
      console.error('Failed to fetch logs:', err)
    } finally {
      setLoading(false)
    }
  }

  async function handleLogSubmit(e: React.FormEvent) {
    e.preventDefault()
    try {
      await fetch('/api/ops/communication-logs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...logForm,
          toAddresses: logForm.toAddresses ? logForm.toAddresses.split(',').map(a => a.trim()) : [],
        }),
      })
      setShowLogForm(false)
      setLogForm({ channel: 'PHONE', direction: 'OUTBOUND', subject: '', body: '', fromAddress: '', toAddresses: '' })
      fetchLogs()
    } catch (err) {
      console.error('Log create error:', err)
    }
  }

  return (
    <div style={{ padding: 32, maxWidth: 1200 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: '#1f2937' }}>Communication Log</h1>
          <p style={{ fontSize: 14, color: '#6b7280', marginTop: 4 }}>
            All builder and supplier communications — emails synced from Gmail, calls, texts, and Hyphen notifications
          </p>
        </div>
        <button
          onClick={() => setShowLogForm(!showLogForm)}
          style={{ padding: '10px 20px', backgroundColor: '#1B4F72', color: 'white', border: 'none', borderRadius: 8, fontWeight: 600, fontSize: 14, cursor: 'pointer' }}
        >
          + Log Communication
        </button>
      </div>

      {/* Channel Filters */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
        <button
          onClick={() => setChannelFilter('')}
          style={{
            padding: '6px 14px', borderRadius: 20, border: 'none',
            backgroundColor: !channelFilter ? '#1B4F72' : '#f3f4f6',
            color: !channelFilter ? 'white' : '#374151',
            fontSize: 12, fontWeight: 600, cursor: 'pointer',
          }}
        >
          All
        </button>
        {Object.entries(CHANNEL_CONFIG).map(([key, cfg]) => (
          <button
            key={key}
            onClick={() => setChannelFilter(channelFilter === key ? '' : key)}
            style={{
              padding: '6px 14px', borderRadius: 20, border: 'none',
              backgroundColor: channelFilter === key ? cfg.color : '#f3f4f6',
              color: channelFilter === key ? 'white' : '#374151',
              fontSize: 12, fontWeight: 600, cursor: 'pointer',
            }}
          >
            {cfg.icon} {cfg.label}
          </button>
        ))}
      </div>

      {/* Log Form */}
      {showLogForm && (
        <form onSubmit={handleLogSubmit} style={{
          padding: 20, backgroundColor: 'white', borderRadius: 12, border: '1px solid #e5e7eb', marginBottom: 16
        }}>
          <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>Log a Communication</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
            <div>
              <label style={labelStyle}>Channel</label>
              <select style={inputStyle} value={logForm.channel} onChange={e => setLogForm({...logForm, channel: e.target.value})}>
                {Object.entries(CHANNEL_CONFIG).filter(([k]) => k !== 'HYPHEN_NOTIFICATION' && k !== 'SYSTEM').map(([k, v]) => (
                  <option key={k} value={k}>{v.icon} {v.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Direction</label>
              <select style={inputStyle} value={logForm.direction} onChange={e => setLogForm({...logForm, direction: e.target.value})}>
                <option value="OUTBOUND">Outbound</option>
                <option value="INBOUND">Inbound</option>
                <option value="INTERNAL">Internal</option>
              </select>
            </div>
            <div>
              <label style={labelStyle}>Subject</label>
              <input style={inputStyle} value={logForm.subject} onChange={e => setLogForm({...logForm, subject: e.target.value})} placeholder="Call about Canyon Ridge delivery" />
            </div>
          </div>
          <div style={{ marginTop: 12 }}>
            <label style={labelStyle}>Notes / Summary</label>
            <textarea
              style={{ ...inputStyle, minHeight: 80 }}
              value={logForm.body}
              onChange={e => setLogForm({...logForm, body: e.target.value})}
              placeholder="Discussed delivery schedule for Lot 14..."
            />
          </div>
          <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
            <button type="submit" style={{ padding: '8px 20px', backgroundColor: '#1B4F72', color: 'white', border: 'none', borderRadius: 6, fontWeight: 600, cursor: 'pointer', fontSize: 13 }}>
              Save Log
            </button>
            <button type="button" onClick={() => setShowLogForm(false)} style={{ padding: '8px 20px', backgroundColor: '#f3f4f6', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13 }}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* Log Entries */}
      {loading ? (
        <p style={{ color: '#9ca3af', textAlign: 'center', padding: 40 }}>Loading communication logs...</p>
      ) : logs.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 60, color: '#9ca3af' }}>
          <p style={{ fontSize: 48 }}>📧</p>
          <p style={{ fontSize: 16, marginTop: 8 }}>No communication logs yet</p>
          <p style={{ fontSize: 13 }}>Connect Gmail to auto-sync emails, or manually log calls and meetings</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {logs.map(log => {
            const channelCfg = CHANNEL_CONFIG[log.channel] || CHANNEL_CONFIG.SYSTEM
            const isExpanded = expanded === log.id

            return (
              <div
                key={log.id}
                style={{
                  padding: '14px 20px',
                  backgroundColor: 'white',
                  borderRadius: 10,
                  border: '1px solid #e5e7eb',
                  cursor: 'pointer',
                }}
                onClick={() => setExpanded(isExpanded ? null : log.id)}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center', flex: 1, minWidth: 0 }}>
                    <span style={{ fontSize: 18 }}>{channelCfg.icon}</span>
                    <span style={{ fontSize: 14 }}>{DIRECTION_ICONS[log.direction]}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ fontSize: 14, fontWeight: 600, color: '#1f2937' }}>
                          {log.subject || `${channelCfg.label} — ${log.fromAddress || 'Unknown'}`}
                        </span>
                        {log.hasAttachments && (
                          <span style={{ fontSize: 11, color: '#9ca3af' }}>📎 {log.attachmentCount}</span>
                        )}
                      </div>
                      <p style={{ fontSize: 12, color: '#6b7280', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {log.builder ? `${log.builder.companyName} (${log.builder.contactName})` :
                         log.organization ? log.organization.name :
                         log.fromAddress || ''}
                        {log.body && !isExpanded ? ` — ${log.body.substring(0, 80)}...` : ''}
                      </p>
                    </div>
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0, marginLeft: 12 }}>
                    <span style={{
                      padding: '2px 8px',
                      borderRadius: 12,
                      backgroundColor: channelCfg.color + '15',
                      color: channelCfg.color,
                      fontSize: 11,
                      fontWeight: 600,
                    }}>
                      {channelCfg.label}
                    </span>
                    <p style={{ fontSize: 11, color: '#9ca3af', marginTop: 4 }}>
                      {log.sentAt ? new Date(log.sentAt).toLocaleString() : ''}
                    </p>
                  </div>
                </div>

                {/* Expanded Content */}
                {isExpanded && log.body && (
                  <div style={{
                    marginTop: 12,
                    paddingTop: 12,
                    borderTop: '1px solid #f3f4f6',
                    fontSize: 13,
                    color: '#374151',
                    lineHeight: 1.6,
                    whiteSpace: 'pre-wrap',
                  }}>
                    {log.fromAddress && <p style={{ fontSize: 12, color: '#6b7280', marginBottom: 4 }}>From: {log.fromAddress}</p>}
                    {log.toAddresses?.length > 0 && <p style={{ fontSize: 12, color: '#6b7280', marginBottom: 8 }}>To: {log.toAddresses.join(', ')}</p>}
                    {log.body}
                    {log.aiSummary && (
                      <div style={{ marginTop: 12, padding: 10, backgroundColor: '#f0f9ff', borderRadius: 6, fontSize: 12 }}>
                        <strong>AI Summary:</strong> {log.aiSummary}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Pagination */}
      {total > 25 && (
        <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginTop: 20 }}>
          <button
            disabled={page <= 1}
            onClick={() => setPage(p => p - 1)}
            style={{ padding: '6px 16px', borderRadius: 6, border: '1px solid #d1d5db', backgroundColor: 'white', cursor: 'pointer', fontSize: 13 }}
          >
            Previous
          </button>
          <span style={{ padding: '6px 12px', fontSize: 13, color: '#6b7280' }}>Page {page} of {Math.ceil(total / 25)}</span>
          <button
            disabled={page >= Math.ceil(total / 25)}
            onClick={() => setPage(p => p + 1)}
            style={{ padding: '6px 16px', borderRadius: 6, border: '1px solid #d1d5db', backgroundColor: 'white', cursor: 'pointer', fontSize: 13 }}
          >
            Next
          </button>
        </div>
      )}
    </div>
  )
}

const labelStyle: React.CSSProperties = { display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 4 }
const inputStyle: React.CSSProperties = { width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid #d1d5db', fontSize: 13 }
