'use client'

import { useCallback, useEffect, useState } from 'react'

interface Credential {
  id: string
  clientId: string
  label: string
  scope: string | null
  status: string
  createdAt: string
  lastUsedAt: string | null
  revokedAt: string | null
}

interface MintedCredential {
  id: string
  clientId: string
  clientSecret: string
  label: string
  scope: string | null
}

interface HyphenEvent {
  id: string
  credentialId: string | null
  kind: string
  externalId: string | null
  builderOrderNumber: string | null
  status: string
  error: string | null
  mappedOrderId: string | null
  receivedAt: string
  processedAt: string | null
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

function statusBadge(status: string): JSX.Element {
  const map: Record<string, string> = {
    ACTIVE: 'bg-green-100 text-green-800',
    REVOKED: 'bg-gray-200 text-gray-700',
    RECEIVED: 'bg-blue-100 text-blue-800',
    PROCESSED: 'bg-green-100 text-green-800',
    FAILED: 'bg-red-100 text-red-800',
  }
  const cls = map[status] || 'bg-gray-100 text-gray-700'
  return <span className={`inline-flex px-2 py-0.5 text-xs font-medium rounded ${cls}`}>{status}</span>
}

export default function HyphenAdminPage() {
  const [credentials, setCredentials] = useState<Credential[]>([])
  const [events, setEvents] = useState<HyphenEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showMintForm, setShowMintForm] = useState(false)
  const [mintLabel, setMintLabel] = useState('')
  const [mintScope, setMintScope] = useState('spconnect')
  const [minting, setMinting] = useState(false)
  const [justMinted, setJustMinted] = useState<MintedCredential | null>(null)

  const loadAll = useCallback(async () => {
    try {
      setLoading(true)
      const [credRes, evtRes] = await Promise.all([
        fetch('/api/admin/hyphen/credentials', { cache: 'no-store' }),
        fetch('/api/admin/hyphen/events?limit=25', { cache: 'no-store' }),
      ])
      if (!credRes.ok) throw new Error(`Credentials: ${credRes.status}`)
      if (!evtRes.ok) throw new Error(`Events: ${evtRes.status}`)
      const credData = await credRes.json()
      const evtData = await evtRes.json()
      setCredentials(credData.credentials || [])
      setEvents(evtData.events || [])
      setError('')
    } catch (e: any) {
      setError(e?.message || 'Failed to load Hyphen data')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadAll()
    const t = setInterval(loadAll, 30_000)
    return () => clearInterval(t)
  }, [loadAll])

  const mint = async () => {
    if (!mintLabel.trim()) {
      setError('Label is required')
      return
    }
    setMinting(true)
    setError('')
    try {
      const res = await fetch('/api/admin/hyphen/credentials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: mintLabel.trim(), scope: mintScope.trim() || undefined }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || `Failed: ${res.status}`)
      setJustMinted(data.credential)
      setMintLabel('')
      setShowMintForm(false)
      loadAll()
    } catch (e: any) {
      setError(e?.message || 'Failed to mint credential')
    } finally {
      setMinting(false)
    }
  }

  const revoke = async (id: string, label: string) => {
    if (!confirm(`Revoke credential "${label}"?\n\nThis will immediately invalidate all access tokens issued from this credential. Hyphen will get 401s until you replace it.`)) {
      return
    }
    try {
      const res = await fetch(`/api/admin/hyphen/credentials?id=${encodeURIComponent(id)}`, {
        method: 'DELETE',
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || `Failed: ${res.status}`)
      }
      loadAll()
    } catch (e: any) {
      setError(e?.message || 'Failed to revoke credential')
    }
  }

  const baseUrl = typeof window !== 'undefined' ? window.location.origin : 'https://app.abellumber.com'

  return (
    <div className="max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Hyphen SPConnect</h1>
          <p className="text-sm text-gray-500 mt-1">
            OAuth 2.0 client credentials and inbound order events. Auto-refreshes every 30s.
          </p>
        </div>
        <button
          onClick={() => {
            setShowMintForm((s) => !s)
            setJustMinted(null)
            setError('')
          }}
          className="px-4 py-2 bg-abel-orange text-white rounded hover:bg-abel-orange/90 text-sm font-medium"
        >
          {showMintForm ? 'Cancel' : 'Mint New Credential'}
        </button>
      </div>

      {error && (
        <div className="mb-4 p-3 rounded bg-red-50 border border-red-200 text-red-700 text-sm">
          {error}
        </div>
      )}

      {/* Mint form */}
      {showMintForm && (
        <div className="mb-6 p-4 bg-white border border-gray-200 rounded-lg">
          <h2 className="text-sm font-semibold text-gray-900 mb-3">Mint New Hyphen Client Credential</h2>
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Label *</label>
              <input
                type="text"
                value={mintLabel}
                onChange={(e) => setMintLabel(e.target.value)}
                placeholder="e.g. Hyphen UAT, Hyphen Production"
                className="w-full px-3 py-2 border border-gray-300 rounded text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Scope (optional)</label>
              <input
                type="text"
                value={mintScope}
                onChange={(e) => setMintScope(e.target.value)}
                placeholder="spconnect"
                className="w-full px-3 py-2 border border-gray-300 rounded text-sm"
              />
            </div>
          </div>
          <button
            onClick={mint}
            disabled={minting || !mintLabel.trim()}
            className="px-4 py-2 bg-abel-navy text-white rounded text-sm font-medium disabled:opacity-50"
          >
            {minting ? 'Minting…' : 'Mint Credential'}
          </button>
          <p className="mt-2 text-xs text-gray-500">
            The client secret will be displayed exactly once. Copy it immediately and send to Hyphen securely.
          </p>
        </div>
      )}

      {/* Just-minted display */}
      {justMinted && (
        <div className="mb-6 p-4 bg-amber-50 border-2 border-amber-300 rounded-lg">
          <div className="flex items-start justify-between mb-3">
            <div>
              <h2 className="text-sm font-bold text-amber-900">⚠ New credential minted — secret will not be shown again</h2>
              <p className="text-xs text-amber-800 mt-1">Copy these values now and send them to Hyphen via a secure channel.</p>
            </div>
            <button
              onClick={() => setJustMinted(null)}
              className="text-amber-700 hover:text-amber-900 text-sm"
            >
              Dismiss
            </button>
          </div>
          <div className="space-y-2 font-mono text-xs bg-white p-3 rounded border border-amber-200">
            <div><span className="text-gray-500 inline-block w-32">Label:</span> {justMinted.label}</div>
            <div><span className="text-gray-500 inline-block w-32">Client ID:</span> <span className="select-all">{justMinted.clientId}</span></div>
            <div><span className="text-gray-500 inline-block w-32">Client Secret:</span> <span className="select-all text-red-700 font-bold">{justMinted.clientSecret}</span></div>
            <div><span className="text-gray-500 inline-block w-32">Scope:</span> {justMinted.scope || '(none)'}</div>
            <div className="pt-2 mt-2 border-t border-amber-200">
              <div className="text-gray-500">Token endpoint:</div>
              <div className="select-all">{baseUrl}/api/hyphen/oauth/token</div>
            </div>
            <div>
              <div className="text-gray-500">Order endpoint:</div>
              <div className="select-all">{baseUrl}/api/hyphen/orders</div>
            </div>
            <div>
              <div className="text-gray-500">Change order endpoint:</div>
              <div className="select-all">{baseUrl}/api/hyphen/changeOrders</div>
            </div>
          </div>
        </div>
      )}

      {/* Credentials table */}
      <div className="mb-8">
        <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-3">Client Credentials</h2>
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Label</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Client ID</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Scope</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Status</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Created</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Last Used</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {loading && credentials.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-500 text-sm">Loading…</td></tr>
              )}
              {!loading && credentials.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-500 text-sm">
                  No credentials yet. Mint one to get started.
                </td></tr>
              )}
              {credentials.map((c) => (
                <tr key={c.id}>
                  <td className="px-4 py-3 text-sm font-medium text-gray-900">{c.label}</td>
                  <td className="px-4 py-3 text-xs font-mono text-gray-600">{c.clientId}</td>
                  <td className="px-4 py-3 text-xs text-gray-600">{c.scope || '—'}</td>
                  <td className="px-4 py-3">{statusBadge(c.status)}</td>
                  <td className="px-4 py-3 text-sm text-gray-600">{fmtDate(c.createdAt)}</td>
                  <td className="px-4 py-3 text-sm text-gray-600">{fmtDate(c.lastUsedAt)}</td>
                  <td className="px-4 py-3 text-right">
                    {c.status === 'ACTIVE' && (
                      <button
                        onClick={() => revoke(c.id, c.label)}
                        className="text-red-600 hover:text-red-800 text-xs font-medium"
                      >
                        Revoke
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Events table */}
      <div>
        <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-3">Recent Inbound Events</h2>
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Received</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Kind</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Builder PO</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">External ID</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Status</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Error</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {loading && events.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-500 text-sm">Loading…</td></tr>
              )}
              {!loading && events.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-500 text-sm">
                  No inbound events yet. They'll appear here once Hyphen starts sending orders.
                </td></tr>
              )}
              {events.map((e) => (
                <tr key={e.id}>
                  <td className="px-4 py-3 text-sm text-gray-600">{fmtDate(e.receivedAt)}</td>
                  <td className="px-4 py-3 text-xs font-mono text-gray-700">{e.kind}</td>
                  <td className="px-4 py-3 text-sm text-gray-700">{e.builderOrderNumber || '—'}</td>
                  <td className="px-4 py-3 text-xs font-mono text-gray-500">{e.externalId || '—'}</td>
                  <td className="px-4 py-3">{statusBadge(e.status)}</td>
                  <td className="px-4 py-3 text-xs text-red-700 max-w-xs truncate" title={e.error || ''}>
                    {e.error || ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
