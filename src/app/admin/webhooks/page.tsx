'use client'

import { useEffect, useState, useCallback } from 'react'

interface WebhookEventRow {
  id: string
  provider: string
  eventId: string
  eventType: string | null
  status: string
  error: string | null
  payload: any | null
  retryCount: number
  maxRetries: number
  nextRetryAt: string | null
  lastAttemptAt: string | null
  receivedAt: string
  processedAt: string | null
}

interface StatBucket {
  provider: string
  status: string
  count: number
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  try {
    const d = new Date(iso)
    const now = Date.now()
    const diffMs = now - d.getTime()
    const diffMin = Math.floor(diffMs / 60000)
    if (diffMin < 0) return d.toLocaleString()
    if (diffMin < 1) return 'just now'
    if (diffMin < 60) return `${diffMin}m ago`
    if (diffMin < 1440) return `${Math.floor(diffMin / 60)}h ago`
    return d.toLocaleString()
  } catch {
    return iso
  }
}

function statusBadge(status: string): JSX.Element {
  const map: Record<string, string> = {
    RECEIVED: 'bg-blue-100 text-blue-800',
    PROCESSED: 'bg-green-100 text-green-800',
    FAILED: 'bg-amber-100 text-amber-800',
    DEAD_LETTER: 'bg-red-100 text-red-800',
  }
  const cls = map[status] || 'bg-gray-100 text-gray-800'
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-xs font-semibold ${cls}`}>
      {status}
    </span>
  )
}

export default function AdminWebhooksPage() {
  const [events, setEvents] = useState<WebhookEventRow[]>([])
  const [stats, setStats] = useState<StatBucket[]>([])
  const [loading, setLoading] = useState(true)
  const [providerFilter, setProviderFilter] = useState<string>('')
  const [statusFilter, setStatusFilter] = useState<string>('')
  const [payloadEvent, setPayloadEvent] = useState<WebhookEventRow | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (providerFilter) params.set('provider', providerFilter)
      if (statusFilter) params.set('status', statusFilter)
      const res = await fetch(`/api/admin/webhooks?${params.toString()}`)
      if (res.ok) {
        const data = await res.json()
        setEvents(data.events || [])
        setStats(data.stats || [])
      }
    } finally {
      setLoading(false)
    }
  }, [providerFilter, statusFilter])

  useEffect(() => {
    load()
  }, [load])

  async function replay(id: string) {
    if (!confirm('Replay this webhook event? It will re-run the processor with the stored payload.')) return
    setBusyId(id)
    try {
      const res = await fetch(`/api/admin/webhooks/${id}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'replay' }),
      })
      const data = await res.json()
      if (data.success) {
        alert('Replayed successfully — event marked PROCESSED')
      } else {
        alert(`Replay failed: ${data.error || 'unknown error'}`)
      }
      await load()
    } catch (e: any) {
      alert(`Replay error: ${e?.message || e}`)
    } finally {
      setBusyId(null)
    }
  }

  async function resurrect(id: string) {
    if (!confirm('Resurrect this dead-letter event? Retry count will reset to 0 and it will be retried on the next cron run.')) return
    setBusyId(id)
    try {
      const res = await fetch(`/api/admin/webhooks/${id}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'resurrect' }),
      })
      const data = await res.json()
      if (data.success) {
        alert('Resurrected — will retry on next cron run')
      } else {
        alert(`Resurrect failed: ${data.error || 'unknown error'}`)
      }
      await load()
    } catch (e: any) {
      alert(`Resurrect error: ${e?.message || e}`)
    } finally {
      setBusyId(null)
    }
  }

  // Aggregate stats by status for the summary cards
  const countByStatus = (status: string): number =>
    stats.filter((s) => s.status === status).reduce((sum, s) => sum + s.count, 0)

  const providers = Array.from(new Set(stats.map((s) => s.provider))).sort()

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Webhook Events</h1>
          <p className="text-sm text-gray-600 mt-1">
            Inbound webhook log with retry status and dead-letter queue. 30-day window.
          </p>
        </div>
        <button
          onClick={load}
          className="px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded hover:bg-blue-700"
        >
          Refresh
        </button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <div className="text-xs uppercase text-gray-500 font-semibold">Processed (30d)</div>
          <div className="text-3xl font-bold text-green-700 mt-1">{countByStatus('PROCESSED')}</div>
        </div>
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <div className="text-xs uppercase text-gray-500 font-semibold">Pending Retry</div>
          <div className={`text-3xl font-bold mt-1 ${countByStatus('FAILED') > 0 ? 'text-amber-600' : 'text-gray-400'}`}>
            {countByStatus('FAILED')}
          </div>
        </div>
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <div className="text-xs uppercase text-gray-500 font-semibold">Dead Letter</div>
          <div className={`text-3xl font-bold mt-1 ${countByStatus('DEAD_LETTER') > 0 ? 'text-red-700' : 'text-gray-400'}`}>
            {countByStatus('DEAD_LETTER')}
          </div>
        </div>
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <div className="text-xs uppercase text-gray-500 font-semibold">In Flight</div>
          <div className="text-3xl font-bold text-blue-700 mt-1">{countByStatus('RECEIVED')}</div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-3 mb-4">
        <select
          value={providerFilter}
          onChange={(e) => setProviderFilter(e.target.value)}
          className="px-3 py-2 text-sm border border-gray-300 rounded"
        >
          <option value="">All providers</option>
          {providers.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-2 text-sm border border-gray-300 rounded"
        >
          <option value="">All statuses</option>
          <option value="RECEIVED">RECEIVED</option>
          <option value="PROCESSED">PROCESSED</option>
          <option value="FAILED">FAILED (retrying)</option>
          <option value="DEAD_LETTER">DEAD_LETTER</option>
        </select>
      </div>

      {/* Events table */}
      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Provider</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Event Type</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Status</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Retries</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Received</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Next Retry</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Error</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {loading && events.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-gray-500">
                  Loading...
                </td>
              </tr>
            )}
            {!loading && events.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-gray-400">
                  No webhook events found.
                </td>
              </tr>
            )}
            {events.map((e) => (
              <tr key={e.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 text-sm font-medium text-gray-900">{e.provider}</td>
                <td className="px-4 py-3 text-sm text-gray-600 font-mono">{e.eventType || '—'}</td>
                <td className="px-4 py-3">{statusBadge(e.status)}</td>
                <td className="px-4 py-3 text-sm text-gray-600">
                  {e.retryCount} / {e.maxRetries}
                </td>
                <td className="px-4 py-3 text-sm text-gray-600">{fmtDate(e.receivedAt)}</td>
                <td className="px-4 py-3 text-sm text-gray-600">{fmtDate(e.nextRetryAt)}</td>
                <td
                  className="px-4 py-3 text-xs text-red-700 max-w-xs truncate"
                  title={e.error || ''}
                >
                  {e.error || ''}
                </td>
                <td className="px-4 py-3 text-sm">
                  <div className="flex gap-2">
                    <button
                      onClick={() => setPayloadEvent(e)}
                      className="text-blue-600 hover:underline"
                    >
                      View
                    </button>
                    {(e.status === 'FAILED' || e.status === 'DEAD_LETTER') && e.payload && (
                      <button
                        onClick={() => replay(e.id)}
                        disabled={busyId === e.id}
                        className="text-green-600 hover:underline disabled:opacity-50"
                      >
                        {busyId === e.id ? '...' : 'Replay'}
                      </button>
                    )}
                    {e.status === 'DEAD_LETTER' && (
                      <button
                        onClick={() => resurrect(e.id)}
                        disabled={busyId === e.id}
                        className="text-amber-600 hover:underline disabled:opacity-50"
                      >
                        Resurrect
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Payload modal */}
      {payloadEvent && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50"
          onClick={() => setPayloadEvent(null)}
        >
          <div
            className="bg-white rounded-lg max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">
                  {payloadEvent.provider}: {payloadEvent.eventType || 'event'}
                </h2>
                <div className="text-xs text-gray-500 font-mono mt-1">{payloadEvent.id}</div>
              </div>
              <button
                onClick={() => setPayloadEvent(null)}
                className="text-gray-400 hover:text-gray-600 text-2xl leading-none"
              >
                ×
              </button>
            </div>
            <div className="flex-1 overflow-auto p-6">
              <pre className="text-xs bg-gray-50 p-4 rounded border border-gray-200 font-mono whitespace-pre-wrap break-all">
                {payloadEvent.payload
                  ? JSON.stringify(payloadEvent.payload, null, 2)
                  : '— No stored payload (event was received before DLQ capture was enabled) —'}
              </pre>
              {payloadEvent.error && (
                <div className="mt-4">
                  <div className="text-xs uppercase text-gray-500 font-semibold mb-1">Last Error</div>
                  <div className="text-sm text-red-700 bg-red-50 p-3 rounded border border-red-200">
                    {payloadEvent.error}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
