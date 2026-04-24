'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { Inbox } from 'lucide-react'
import EmptyState from '@/components/ui/EmptyState'

// ──────────────────────────────────────────────────────────────────────────
// Customer Communication Log
//
// Unified view of all builder/supplier communications:
//   • Gmail auto-sync (pulls emails via API → CommunicationLog table)
//   • Manual entry for calls, texts, in-person meetings
//   • Channel filtering, search, builder association
//   • Expandable detail view with AI summary
// ──────────────────────────────────────────────────────────────────────────

interface CommLog {
  id: string
  channel: string
  direction: string
  subject?: string
  body?: string
  fromAddress?: string
  toAddresses: string[]
  ccAddresses?: string[]
  sentAt?: string
  duration?: number
  hasAttachments: boolean
  attachmentCount: number
  status: string
  aiSummary?: string
  gmailMessageId?: string
  gmailThreadId?: string
  builder?: { id: string; companyName: string; contactName: string }
  organization?: { id: string; name: string }
  attachments: { id: string; fileName: string; fileType: string; fileSize?: number }[]
}

const CHANNEL_CONFIG: Record<string, { icon: string; label: string; color: string; bg: string }> = {
  EMAIL: { icon: '📧', label: 'Email', color: '#3B82F6', bg: '#EFF6FF' },
  PHONE: { icon: '📞', label: 'Phone', color: '#10B981', bg: '#ECFDF5' },
  TEXT: { icon: '💬', label: 'Text', color: '#8B5CF6', bg: '#F5F3FF' },
  IN_PERSON: { icon: '🤝', label: 'In Person', color: '#F59E0B', bg: '#FFFBEB' },
  VIDEO_CALL: { icon: '📹', label: 'Video Call', color: '#EC4899', bg: '#FDF2F8' },
  HYPHEN_NOTIFICATION: { icon: '🔗', label: 'Hyphen', color: '#C6A24E', bg: '#FFF7ED' },
  SYSTEM: { icon: '🤖', label: 'System', color: '#6B7280', bg: '#F3F4F6' },
}

const DIRECTION_CONFIG: Record<string, { icon: string; label: string }> = {
  INBOUND: { icon: '↙️', label: 'Inbound' },
  OUTBOUND: { icon: '↗️', label: 'Outbound' },
  INTERNAL: { icon: '🔄', label: 'Internal' },
}

// Abel Lumber Gmail accounts
const GMAIL_ACCOUNTS = [
  'n.barrett@abellumber.com',
  'c.vinson@abellumber.com',
  'dalton@abellumber.com',
  'thomas.robinson@abellumber.com',
  'brittney.werner@abellumber.com',
  'dawn.meehan@abellumber.com',
  'clint@abellumber.com',
]

export default function CommunicationLogPage() {
  const [logs, setLogs] = useState<CommLog[]>([])
  const [loading, setLoading] = useState(true)
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [channelFilter, setChannelFilter] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [showLogForm, setShowLogForm] = useState(false)
  const [showGmailSync, setShowGmailSync] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [syncStatus, setSyncStatus] = useState<{ totalSynced: number; lastSync: string | null; todaySynced: number } | null>(null)
  const [syncResult, setSyncResult] = useState<{ synced: number; skipped: number; errors: number } | null>(null)
  const [logForm, setLogForm] = useState({
    channel: 'PHONE',
    direction: 'OUTBOUND',
    subject: '',
    body: '',
    fromAddress: '',
    toAddresses: '',
    builderId: '',
    duration: '',
  })

  useEffect(() => {
    fetchLogs()
  }, [page, channelFilter])

  useEffect(() => {
    fetchSyncStatus()
  }, [])

  async function fetchLogs() {
    try {
      setLoading(true)
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

  async function fetchSyncStatus() {
    try {
      const res = await fetch('/api/ops/communication-logs/gmail-sync')
      if (res.ok) {
        const data = await res.json()
        setSyncStatus(data)
      }
    } catch {
      // Gmail sync may not be set up yet
    }
  }

  async function handleGmailSync(query: string, label: string) {
    setSyncing(true)
    setSyncResult(null)
    try {
      // Fetch emails from Gmail via our API proxy
      // The frontend calls the Gmail search, then sends results to our sync endpoint
      const gmailRes = await fetch('/api/ops/communication-logs/gmail-fetch?' + new URLSearchParams({ query }))

      // If the proxy doesn't exist yet, fall back to a message
      if (!gmailRes.ok) {
        // We'll sync via the manual approach — user can trigger from the Gmail sync panel
        setSyncResult({ synced: 0, skipped: 0, errors: 1 })
        return
      }

      const gmailData = await gmailRes.json()

      // Send to our sync endpoint
      const syncRes = await fetch('/api/ops/communication-logs/gmail-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emails: gmailData.emails || [] }),
      })

      if (syncRes.ok) {
        const result = await syncRes.json()
        setSyncResult(result)
        fetchLogs()
        fetchSyncStatus()
      }
    } catch (err) {
      console.error('Gmail sync error:', err)
      setSyncResult({ synced: 0, skipped: 0, errors: 1 })
    } finally {
      setSyncing(false)
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
          duration: logForm.duration ? parseInt(logForm.duration) : null,
        }),
      })
      setShowLogForm(false)
      setLogForm({ channel: 'PHONE', direction: 'OUTBOUND', subject: '', body: '', fromAddress: '', toAddresses: '', builderId: '', duration: '' })
      fetchLogs()
    } catch (err) {
      console.error('Log create error:', err)
    }
  }

  const filteredLogs = searchQuery
    ? logs.filter(
        (l) =>
          l.subject?.toLowerCase().includes(searchQuery.toLowerCase()) ||
          l.fromAddress?.toLowerCase().includes(searchQuery.toLowerCase()) ||
          l.body?.toLowerCase().includes(searchQuery.toLowerCase()) ||
          l.builder?.companyName?.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : logs

  return (
    <div className="min-h-screen bg-canvas">
      {/* Header */}
      <div className="bg-navy-mid text-fg-inverse px-8 py-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-semibold flex items-center gap-3">
              <span>📧</span> Communication Log
            </h1>
            <p className="text-blue-200 mt-2">
              All builder & supplier communications — Gmail auto-sync, calls, texts, meetings
              {syncStatus && (
                <span className="ml-3 text-blue-300">
                  • {syncStatus.totalSynced} emails synced
                  {syncStatus.todaySynced > 0 && ` • ${syncStatus.todaySynced} today`}
                </span>
              )}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setShowGmailSync(!showGmailSync)}
              className="bg-white/10 hover:bg-white/20 text-fg-inverse px-4 py-2 rounded-lg text-sm flex items-center gap-2"
            >
              <span>📧</span> Gmail Sync
            </button>
            <button
              onClick={() => setShowLogForm(!showLogForm)}
              className="bg-signal hover:bg-signal-hover text-fg-on-accent px-4 py-2 rounded-lg text-sm font-medium"
            >
              + Log Communication
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-8 py-6">
        {/* Gmail Sync Panel */}
        {showGmailSync && (
          <div className="bg-surface-elev rounded-xl border border-blue-200 p-6 mb-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-blue-100 flex items-center justify-center text-xl">📧</div>
                <div>
                  <h3 className="font-semibold text-fg">Gmail Sync</h3>
                  <p className="text-xs text-fg-muted">
                    Auto-import emails from Abel Lumber Gmail accounts into the communication log
                  </p>
                </div>
              </div>
              <button onClick={() => setShowGmailSync(false)} className="text-fg-subtle hover:text-fg">✕</button>
            </div>

            {/* Connected Accounts */}
            <div className="mb-4">
              <h4 className="text-xs font-semibold text-fg-muted mb-2">CONNECTED ACCOUNTS</h4>
              <div className="flex flex-wrap gap-2">
                {GMAIL_ACCOUNTS.map((email) => (
                  <span key={email} className="bg-blue-50 text-blue-700 px-3 py-1 rounded-full text-xs font-medium">
                    {email}
                  </span>
                ))}
              </div>
              <p className="text-[10px] text-fg-subtle mt-2">
                Manage accounts at{' '}
                <a
                  href="https://admin.google.com/u/2/ac/users"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-500 hover:underline"
                >
                  Google Admin Console
                </a>
              </p>
            </div>

            {/* Sync Actions */}
            <div className="grid grid-cols-4 gap-3">
              <button
                onClick={() => handleGmailSync('newer_than:1d', "Today's Emails")}
                disabled={syncing}
                className="bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-lg p-3 text-center transition-colors disabled:opacity-50"
              >
                <div className="text-lg mb-1">📥</div>
                <div className="text-xs font-semibold text-blue-700">Sync Today</div>
                <div className="text-[10px] text-fg-muted">Last 24 hours</div>
              </button>
              <button
                onClick={() => handleGmailSync('newer_than:7d', "This Week's Emails")}
                disabled={syncing}
                className="bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-lg p-3 text-center transition-colors disabled:opacity-50"
              >
                <div className="text-lg mb-1">📧</div>
                <div className="text-xs font-semibold text-blue-700">Sync Week</div>
                <div className="text-[10px] text-fg-muted">Last 7 days</div>
              </button>
              <button
                onClick={() => handleGmailSync('newer_than:30d', "This Month's Emails")}
                disabled={syncing}
                className="bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-lg p-3 text-center transition-colors disabled:opacity-50"
              >
                <div className="text-lg mb-1">📬</div>
                <div className="text-xs font-semibold text-blue-700">Sync Month</div>
                <div className="text-[10px] text-fg-muted">Last 30 days</div>
              </button>
              <button
                onClick={() => handleGmailSync('has:attachment newer_than:7d', 'Emails with Attachments')}
                disabled={syncing}
                className="bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-lg p-3 text-center transition-colors disabled:opacity-50"
              >
                <div className="text-lg mb-1">📎</div>
                <div className="text-xs font-semibold text-blue-700">With Attachments</div>
                <div className="text-[10px] text-fg-muted">Last 7 days</div>
              </button>
            </div>

            {/* Sync Status */}
            {syncing && (
              <div className="mt-4 flex items-center gap-3 bg-blue-50 rounded-lg p-3">
                <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                <span className="text-sm text-blue-700">Syncing emails from Gmail...</span>
              </div>
            )}
            {syncResult && !syncing && (
              <div className="mt-4 bg-green-50 rounded-lg p-3 flex items-center gap-3">
                <span className="text-green-600">✓</span>
                <span className="text-sm text-green-800">
                  Synced {syncResult.synced} new emails, {syncResult.skipped} already existed
                  {syncResult.errors > 0 && `, ${syncResult.errors} errors`}
                </span>
              </div>
            )}

            {syncStatus?.lastSync && (
              <p className="text-[10px] text-fg-subtle mt-3">
                Last sync: {new Date(syncStatus.lastSync).toLocaleString()}
              </p>
            )}
          </div>
        )}

        {/* Manual Log Form */}
        {showLogForm && (
          <div className="bg-surface-elev rounded-xl border border-border p-6 mb-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-fg">Log a Communication</h3>
              <button onClick={() => setShowLogForm(false)} className="text-fg-subtle hover:text-fg">✕</button>
            </div>
            <form onSubmit={handleLogSubmit}>
              <div className="grid grid-cols-4 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-fg-muted mb-1">Channel</label>
                  <select
                    value={logForm.channel}
                    onChange={(e) => setLogForm({ ...logForm, channel: e.target.value })}
                    className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-surface-elev"
                  >
                    {Object.entries(CHANNEL_CONFIG)
                      .filter(([k]) => k !== 'HYPHEN_NOTIFICATION' && k !== 'SYSTEM')
                      .map(([k, v]) => (
                        <option key={k} value={k}>
                          {v.icon} {v.label}
                        </option>
                      ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-fg-muted mb-1">Direction</label>
                  <select
                    value={logForm.direction}
                    onChange={(e) => setLogForm({ ...logForm, direction: e.target.value })}
                    className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-surface-elev"
                  >
                    <option value="OUTBOUND">↗️ Outbound</option>
                    <option value="INBOUND">↙️ Inbound</option>
                    <option value="INTERNAL">🔄 Internal</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-fg-muted mb-1">Subject</label>
                  <input
                    value={logForm.subject}
                    onChange={(e) => setLogForm({ ...logForm, subject: e.target.value })}
                    placeholder="Call about Canyon Ridge delivery"
                    className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-surface-elev"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-fg-muted mb-1">Duration (min)</label>
                  <input
                    type="number"
                    value={logForm.duration}
                    onChange={(e) => setLogForm({ ...logForm, duration: e.target.value })}
                    placeholder="15"
                    className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-surface-elev"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4 mt-3">
                <div>
                  <label className="block text-xs font-semibold text-fg-muted mb-1">From</label>
                  <input
                    value={logForm.fromAddress}
                    onChange={(e) => setLogForm({ ...logForm, fromAddress: e.target.value })}
                    placeholder="n.barrett@abellumber.com"
                    className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-surface-elev"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-fg-muted mb-1">To (comma-separated)</label>
                  <input
                    value={logForm.toAddresses}
                    onChange={(e) => setLogForm({ ...logForm, toAddresses: e.target.value })}
                    placeholder="builder@example.com, pm@example.com"
                    className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-surface-elev"
                  />
                </div>
              </div>
              <div className="mt-3">
                <label className="block text-xs font-semibold text-fg-muted mb-1">Notes / Summary</label>
                <textarea
                  value={logForm.body}
                  onChange={(e) => setLogForm({ ...logForm, body: e.target.value })}
                  placeholder="Discussed delivery schedule for Lot 14, builder confirmed Tuesday morning window..."
                  rows={3}
                  className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-surface-elev"
                />
              </div>
              <div className="mt-4 flex gap-3">
                <button
                  type="submit"
                  className="bg-navy-mid hover:bg-navy-light text-fg-inverse px-5 py-2 rounded-lg text-sm font-semibold"
                >
                  Save Communication
                </button>
                <button
                  type="button"
                  onClick={() => setShowLogForm(false)}
                  className="bg-surface-muted hover:bg-row-hover text-fg-muted px-5 py-2 rounded-lg text-sm"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Filter Bar */}
        <div className="bg-surface-elev rounded-xl border border-border p-4 mb-6">
          <div className="flex items-center gap-4">
            {/* Search */}
            <div className="relative flex-1 max-w-md">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search by subject, sender, builder, content..."
                className="w-full pl-8 pr-3 py-2 text-sm border border-border rounded-lg focus:ring-2 focus:ring-signal focus:border-transparent bg-surface-elev"
              />
              <svg className="absolute left-2.5 top-2.5 w-4 h-4 text-fg-subtle" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>

            {/* Channel Filters */}
            <div className="flex gap-1.5 flex-wrap">
              <button
                onClick={() => setChannelFilter('')}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${
                  !channelFilter ? 'bg-navy-mid text-fg-inverse' : 'bg-surface-muted text-fg-muted hover:bg-row-hover'
                }`}
              >
                All
              </button>
              {Object.entries(CHANNEL_CONFIG).map(([key, cfg]) => (
                <button
                  key={key}
                  onClick={() => setChannelFilter(channelFilter === key ? '' : key)}
                  className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${
                    channelFilter === key ? 'text-white' : 'text-fg-muted hover:bg-row-hover'
                  }`}
                  style={channelFilter === key ? { backgroundColor: cfg.color } : { backgroundColor: 'var(--surface-muted)' }}
                >
                  {cfg.icon} {cfg.label}
                </button>
              ))}
            </div>

            <span className="text-xs text-fg-subtle ml-auto">{total} total</span>
          </div>
        </div>

        {/* Communication Entries */}
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-8 h-8 border-4 border-signal border-t-transparent rounded-full animate-spin" />
          </div>
        ) : filteredLogs.length === 0 ? (
          <div className="bg-surface-elev rounded-xl border border-border">
            <EmptyState
              icon={<Inbox className="w-8 h-8 text-fg-subtle" />}
              title="Inbox empty"
              description='Click "Gmail Sync" to auto-import emails, or "Log Communication" to manually record calls, texts, and meetings.'
            />
          </div>
        ) : (
          <div className="space-y-2">
            {filteredLogs.map((log) => {
              const channelCfg = CHANNEL_CONFIG[log.channel] || CHANNEL_CONFIG.SYSTEM
              const dirCfg = DIRECTION_CONFIG[log.direction] || DIRECTION_CONFIG.OUTBOUND
              const isExpanded = expanded === log.id

              return (
                <div
                  key={log.id}
                  className={`bg-surface-elev rounded-xl border transition-all cursor-pointer ${
                    isExpanded ? 'border-signal shadow-md' : 'border-border hover:border-border-strong'
                  }`}
                  onClick={() => setExpanded(isExpanded ? null : log.id)}
                >
                  <div className="px-5 py-3.5 flex items-center gap-4">
                    {/* Channel Icon */}
                    <div
                      className="w-9 h-9 rounded-lg flex items-center justify-center text-lg flex-shrink-0"
                      style={{ backgroundColor: channelCfg.bg }}
                    >
                      {channelCfg.icon}
                    </div>

                    {/* Direction */}
                    <span className="text-sm flex-shrink-0">{dirCfg.icon}</span>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-fg truncate">
                          {log.subject || `${channelCfg.label} — ${log.fromAddress || 'Unknown'}`}
                        </span>
                        {log.hasAttachments && (
                          <span className="text-[10px] text-fg-subtle flex-shrink-0">📎 {log.attachmentCount}</span>
                        )}
                        {log.gmailMessageId && (
                          <span className="text-[9px] bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded font-medium flex-shrink-0">
                            Gmail
                          </span>
                        )}
                        {log.status === 'SYNCED' && (
                          <span className="text-[9px] bg-green-50 text-green-600 px-1.5 py-0.5 rounded font-medium flex-shrink-0">
                            Auto-synced
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-fg-muted truncate mt-0.5">
                        {log.builder
                          ? `${log.builder.companyName} (${log.builder.contactName})`
                          : log.organization
                          ? log.organization.name
                          : log.fromAddress || ''}
                        {log.body && !isExpanded ? ` — ${log.body.substring(0, 100)}` : ''}
                      </p>
                    </div>

                    {/* Right Side */}
                    <div className="text-right flex-shrink-0 ml-4">
                      <span
                        className="inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold"
                        style={{ backgroundColor: channelCfg.bg, color: channelCfg.color }}
                      >
                        {channelCfg.label}
                      </span>
                      <p className="text-[10px] text-fg-subtle mt-1">
                        {log.sentAt
                          ? new Date(log.sentAt).toLocaleDateString('en-US', {
                              month: 'short',
                              day: 'numeric',
                              hour: 'numeric',
                              minute: '2-digit',
                            })
                          : ''}
                      </p>
                    </div>
                  </div>

                  {/* Expanded Content */}
                  <div
                    className="grid motion-safe:transition-[grid-template-rows] motion-safe:duration-300 motion-safe:ease-out"
                    style={{ gridTemplateRows: isExpanded ? '1fr' : '0fr' }}
                  >
                    <div className="overflow-hidden min-h-0">
                    <div className="px-5 pb-4 border-t border-border pt-3">
                      <div className="text-xs text-fg-muted space-y-1 mb-3">
                        {log.fromAddress && (
                          <p>
                            <span className="font-semibold text-fg-muted">From:</span> {log.fromAddress}
                          </p>
                        )}
                        {log.toAddresses?.length > 0 && (
                          <p>
                            <span className="font-semibold text-fg-muted">To:</span>{' '}
                            {log.toAddresses.join(', ')}
                          </p>
                        )}
                        {log.ccAddresses && log.ccAddresses.length > 0 && (
                          <p>
                            <span className="font-semibold text-fg-muted">CC:</span>{' '}
                            {log.ccAddresses.join(', ')}
                          </p>
                        )}
                        {log.duration && (
                          <p>
                            <span className="font-semibold text-fg-muted">Duration:</span> {log.duration} min
                          </p>
                        )}
                      </div>
                      {log.body && (
                        <div className="text-sm text-fg leading-relaxed whitespace-pre-wrap bg-surface-muted rounded-lg p-4 max-h-80 overflow-y-auto">
                          {log.body}
                        </div>
                      )}
                      {log.aiSummary && (
                        <div className="mt-3 bg-blue-50 rounded-lg p-3 text-xs">
                          <span className="font-semibold text-blue-700">AI Summary:</span>{' '}
                          <span className="text-blue-800">{log.aiSummary}</span>
                        </div>
                      )}
                      {log.attachments?.length > 0 && (
                        <div className="mt-3">
                          <p className="text-xs font-semibold text-fg-muted mb-1">Attachments:</p>
                          <div className="flex flex-wrap gap-2">
                            {log.attachments.map((att) => (
                              <span key={att.id} className="bg-surface-muted text-fg-muted px-2 py-1 rounded text-xs">
                                📎 {att.fileName}
                                {att.fileSize && ` (${(att.fileSize / 1024).toFixed(0)}KB)`}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                      {log.builder && (
                        <div className="mt-3">
                          <Link
                            href={`/ops/accounts/${log.builder.id}`}
                            className="text-xs text-signal hover:underline font-medium"
                            onClick={(e) => e.stopPropagation()}
                          >
                            View Builder: {log.builder.companyName} →
                          </Link>
                        </div>
                      )}
                    </div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* Pagination */}
        {total > 25 && (
          <div className="flex items-center justify-center gap-3 mt-6">
            <button
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
              className="px-4 py-2 rounded-lg border border-border bg-surface-elev text-sm text-fg-muted hover:bg-row-hover disabled:opacity-40"
            >
              ← Previous
            </button>
            <span className="text-sm text-fg-muted">
              Page {page} of {Math.ceil(total / 25)}
            </span>
            <button
              disabled={page >= Math.ceil(total / 25)}
              onClick={() => setPage((p) => p + 1)}
              className="px-4 py-2 rounded-lg border border-border bg-surface-elev text-sm text-fg-muted hover:bg-row-hover disabled:opacity-40"
            >
              Next →
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
