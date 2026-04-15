'use client'

import { useEffect, useState, useCallback } from 'react'

interface ClientErrorRow {
  id: string
  digest: string | null
  scope: string | null
  path: string | null
  message: string | null
  userAgent: string | null
  ipAddress: string | null
  requestId: string | null
  createdAt: string
}

interface ScopeStat {
  scope: string | null
  count: number
}

interface TopDigest {
  digest: string
  scope: string | null
  count: number
  lastSeen: string
  sampleMessage: string | null
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  try {
    const d = new Date(iso)
    const diffMin = Math.floor((Date.now() - d.getTime()) / 60000)
    if (diffMin < 1) return 'just now'
    if (diffMin < 60) return `${diffMin}m ago`
    if (diffMin < 1440) return `${Math.floor(diffMin / 60)}h ago`
    return d.toLocaleString()
  } catch {
    return iso
  }
}

function scopeBadge(scope: string | null): JSX.Element {
  const map: Record<string, string> = {
    root: 'bg-gray-100 text-gray-800',
    global: 'bg-red-100 text-red-800',
    admin: 'bg-purple-100 text-purple-800',
    ops: 'bg-blue-100 text-blue-800',
    crew: 'bg-amber-100 text-amber-800',
    dashboard: 'bg-green-100 text-green-800',
    homeowner: 'bg-teal-100 text-teal-800',
    sales: 'bg-indigo-100 text-indigo-800',
    orders: 'bg-pink-100 text-pink-800',
    projects: 'bg-cyan-100 text-cyan-800',
    catalog: 'bg-emerald-100 text-emerald-800',
    portal: 'bg-slate-100 text-slate-800',
    'sign in': 'bg-yellow-100 text-yellow-800',
  }
  const key = (scope || 'unknown').toLowerCase()
  const cls = map[key] || 'bg-gray-100 text-gray-800'
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-xs font-semibold ${cls}`}>
      {scope || 'unknown'}
    </span>
  )
}

export default function AdminErrorsPage() {
  const [errors, setErrors] = useState<ClientErrorRow[]>([])
  const [stats, setStats] = useState<ScopeStat[]>([])
  const [topDigests, setTopDigests] = useState<TopDigest[]>([])
  const [loading, setLoading] = useState(true)
  const [scopeFilter, setScopeFilter] = useState<string>('')
  const [sinceHours, setSinceHours] = useState<number>(24)
  const [selected, setSelected] = useState<ClientErrorRow | null>(null)
  const [note, setNote] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (scopeFilter) params.set('scope', scopeFilter)
      params.set('since', String(sinceHours))
      const res = await fetch(`/api/admin/errors?${params.toString()}`)
      if (res.ok) {
        const data = await res.json()
        setErrors(data.errors || [])
        setStats(data.stats || [])
        setTopDigests(data.topDigests || [])
        setNote(data.note || null)
      }
    } finally {
      setLoading(false)
    }
  }, [scopeFilter, sinceHours])

  useEffect(() => {
    load()
  }, [load])

  async function dismiss(id: string) {
    if (!confirm('Dismiss this error row?')) return
    await fetch(`/api/admin/errors?id=${id}`, { method: 'DELETE' })
    await load()
  }

  async function dismissDigest(digest: string) {
    if (!confirm(`Dismiss ALL errors with digest ${digest}?`)) return
    await fetch(`/api/admin/errors?digest=${digest}`, { method: 'DELETE' })
    await load()
  }

  const totalCount = stats.reduce((sum, s) => sum + s.count, 0)

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Client Errors</h1>
          <p className="text-sm text-gray-600 mt-1">
            Unhandled React errors reported by the browser via the /api/client-errors beacon.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <select
            value={sinceHours}
            onChange={(e) => setSinceHours(parseInt(e.target.value))}
            className="px-3 py-2 text-sm border border-gray-300 rounded"
          >
            <option value={1}>Last 1 hour</option>
            <option value={24}>Last 24 hours</option>
            <option value={72}>Last 3 days</option>
            <option value={168}>Last 7 days</option>
            <option value={720}>Last 30 days</option>
          </select>
          <button
            onClick={load}
            className="px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            Refresh
          </button>
        </div>
      </div>

      {note && (
        <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded text-sm text-blue-800">
          {note}
        </div>
      )}

      {/* Summary by scope */}
      <div className="bg-white border border-gray-200 rounded-lg p-4 mb-6">
        <div className="text-xs uppercase text-gray-500 font-semibold mb-3">
          {totalCount} errors in the selected window
        </div>
        {stats.length === 0 ? (
          <p className="text-sm text-gray-400">No errors reported. Nothing is on fire.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {stats.map((s) => (
              <button
                key={s.scope || 'unknown'}
                onClick={() => setScopeFilter(scopeFilter === s.scope ? '' : s.scope || '')}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-full border text-sm ${
                  scopeFilter === s.scope
                    ? 'border-blue-500 bg-blue-50 text-blue-800 font-semibold'
                    : 'border-gray-200 hover:border-gray-300 text-gray-700'
                }`}
              >
                {scopeBadge(s.scope)}
                <span className="font-bold">{s.count}</span>
              </button>
            ))}
            {scopeFilter && (
              <button
                onClick={() => setScopeFilter('')}
                className="text-xs text-gray-500 hover:text-gray-700 underline self-center ml-2"
              >
                Clear filter
              </button>
            )}
          </div>
        )}
      </div>

      {/* Top recurring digests */}
      {topDigests.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-lg p-4 mb-6">
          <div className="text-xs uppercase text-gray-500 font-semibold mb-3">
            Top recurring errors (fix these first)
          </div>
          <div className="space-y-2">
            {topDigests.map((d) => (
              <div
                key={d.digest}
                className="flex items-start justify-between gap-3 p-3 bg-gray-50 border border-gray-200 rounded"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    {scopeBadge(d.scope)}
                    <code className="text-xs text-gray-500 font-mono">{d.digest}</code>
                    <span className="text-xs text-gray-400">· last seen {fmtDate(d.lastSeen)}</span>
                  </div>
                  <div className="text-sm text-gray-700 truncate" title={d.sampleMessage || ''}>
                    {d.sampleMessage || '(no message)'}
                  </div>
                </div>
                <div className="flex items-center gap-3 flex-shrink-0">
                  <span className="text-2xl font-bold text-red-600">{d.count}×</span>
                  <button
                    onClick={() => dismissDigest(d.digest)}
                    className="text-xs text-gray-500 hover:text-red-600 underline"
                  >
                    Dismiss all
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Events table */}
      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Scope</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Path</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Message</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">When</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Digest</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {loading && errors.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-gray-500">
                  Loading...
                </td>
              </tr>
            )}
            {!loading && errors.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-gray-400">
                  No errors in this window.
                </td>
              </tr>
            )}
            {errors.map((e) => (
              <tr key={e.id} className="hover:bg-gray-50">
                <td className="px-4 py-3">{scopeBadge(e.scope)}</td>
                <td
                  className="px-4 py-3 text-xs text-gray-600 font-mono max-w-xs truncate"
                  title={e.path || ''}
                >
                  {e.path || '—'}
                </td>
                <td
                  className="px-4 py-3 text-sm text-gray-700 max-w-md truncate"
                  title={e.message || ''}
                >
                  {e.message || '(no message)'}
                </td>
                <td className="px-4 py-3 text-sm text-gray-500 whitespace-nowrap">
                  {fmtDate(e.createdAt)}
                </td>
                <td className="px-4 py-3 text-xs text-gray-500 font-mono">{e.digest || '—'}</td>
                <td className="px-4 py-3 text-sm">
                  <div className="flex gap-2">
                    <button
                      onClick={() => setSelected(e)}
                      className="text-blue-600 hover:underline"
                    >
                      View
                    </button>
                    <button
                      onClick={() => dismiss(e.id)}
                      className="text-gray-400 hover:text-red-600"
                    >
                      Dismiss
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Detail modal */}
      {selected && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50"
          onClick={() => setSelected(null)}
        >
          <div
            className="bg-white rounded-lg max-w-3xl w-full max-h-[90vh] overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">
                  Error in {selected.scope || 'unknown scope'}
                </h2>
                <div className="text-xs text-gray-500 font-mono mt-1">{selected.id}</div>
              </div>
              <button
                onClick={() => setSelected(null)}
                className="text-gray-400 hover:text-gray-600 text-2xl leading-none"
              >
                ×
              </button>
            </div>
            <div className="flex-1 overflow-auto p-6 space-y-4">
              <Field label="Path" value={selected.path} mono />
              <Field label="Digest" value={selected.digest} mono />
              <Field label="Request ID" value={selected.requestId} mono />
              <Field label="Message" value={selected.message} />
              <Field label="User Agent" value={selected.userAgent} mono small />
              <Field label="IP" value={selected.ipAddress} mono />
              <Field label="When" value={new Date(selected.createdAt).toLocaleString()} />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function Field({
  label,
  value,
  mono = false,
  small = false,
}: {
  label: string
  value: string | null
  mono?: boolean
  small?: boolean
}) {
  return (
    <div>
      <div className="text-xs uppercase text-gray-500 font-semibold mb-1">{label}</div>
      <div
        className={`${mono ? 'font-mono' : ''} ${
          small ? 'text-xs' : 'text-sm'
        } text-gray-800 bg-gray-50 p-3 rounded border border-gray-200 break-all`}
      >
        {value || '—'}
      </div>
    </div>
  )
}
