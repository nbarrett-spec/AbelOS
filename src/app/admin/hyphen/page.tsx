'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'

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

interface BuilderAlias {
  id: string
  aliasType: string
  aliasValue: string
  builderId: string
  builderCompanyName: string | null
  note: string | null
  createdAt: string
}

interface ProductAlias {
  id: string
  aliasType: string
  aliasValue: string
  productId: string
  productSku: string | null
  productName: string | null
  note: string | null
  createdAt: string
}

interface BuilderLite {
  id: string
  companyName: string
}

interface ProductLite {
  id: string
  sku: string
  name: string
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
  const [builderAliases, setBuilderAliases] = useState<BuilderAlias[]>([])
  const [productAliases, setProductAliases] = useState<ProductAlias[]>([])
  const [builders, setBuilders] = useState<BuilderLite[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showMintForm, setShowMintForm] = useState(false)
  const [mintLabel, setMintLabel] = useState('')
  const [mintScope, setMintScope] = useState('spconnect')
  const [minting, setMinting] = useState(false)
  const [justMinted, setJustMinted] = useState<MintedCredential | null>(null)

  // Payload modal
  const [payloadEvent, setPayloadEvent] = useState<{
    id: string
    kind: string
    status: string
    error: string | null
    rawPayload: any
  } | null>(null)
  const [payloadLoading, setPayloadLoading] = useState(false)

  // Alias form state
  const [showBuilderAliasForm, setShowBuilderAliasForm] = useState(false)
  const [baType, setBaType] = useState<'hyphenBuilderId' | 'accountCode'>('hyphenBuilderId')
  const [baValue, setBaValue] = useState('')
  const [baBuilderId, setBaBuilderId] = useState('')
  const [baNote, setBaNote] = useState('')

  const [showProductAliasForm, setShowProductAliasForm] = useState(false)
  const [paType, setPaType] = useState<'builderSupplierSKU' | 'builderAltItemID'>('builderSupplierSKU')
  const [paValue, setPaValue] = useState('')
  const [paProductSearch, setPaProductSearch] = useState('')
  const [paProductResults, setPaProductResults] = useState<ProductLite[]>([])
  const [paProductId, setPaProductId] = useState('')
  const [paNote, setPaNote] = useState('')

  const loadAll = useCallback(async () => {
    try {
      setLoading(true)
      const [credRes, evtRes, aliasRes, builderRes] = await Promise.all([
        fetch('/api/admin/hyphen/credentials', { cache: 'no-store' }),
        fetch('/api/admin/hyphen/events?limit=50', { cache: 'no-store' }),
        fetch('/api/admin/hyphen/aliases', { cache: 'no-store' }),
        fetch('/api/admin/builders', { cache: 'no-store' }),
      ])
      if (!credRes.ok) throw new Error(`Credentials: ${credRes.status}`)
      if (!evtRes.ok) throw new Error(`Events: ${evtRes.status}`)
      const credData = await credRes.json()
      const evtData = await evtRes.json()
      setCredentials(credData.credentials || [])
      setEvents(evtData.events || [])
      if (aliasRes.ok) {
        const aliasData = await aliasRes.json()
        setBuilderAliases(aliasData.builderAliases || [])
        setProductAliases(aliasData.productAliases || [])
      }
      if (builderRes.ok) {
        const b = await builderRes.json()
        setBuilders(
          (b.builders || []).map((r: any) => ({ id: r.id, companyName: r.companyName }))
        )
      }
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

  // Debounced product search for alias form
  useEffect(() => {
    if (!showProductAliasForm) return
    const q = paProductSearch.trim()
    const t = setTimeout(async () => {
      try {
        const url = q
          ? `/api/admin/products/search?search=${encodeURIComponent(q)}&limit=15`
          : `/api/admin/products/search?limit=15`
        const res = await fetch(url, { cache: 'no-store' })
        if (!res.ok) return
        const data = await res.json()
        setPaProductResults(
          (data.products || []).map((p: any) => ({ id: p.id, sku: p.sku, name: p.name }))
        )
      } catch {
        // ignore
      }
    }, 200)
    return () => clearTimeout(t)
  }, [paProductSearch, showProductAliasForm])

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

  const viewPayload = async (eventId: string) => {
    setPayloadLoading(true)
    setPayloadEvent(null)
    try {
      const res = await fetch(`/api/admin/hyphen/events/${encodeURIComponent(eventId)}`, {
        cache: 'no-store',
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || `Failed: ${res.status}`)
      }
      const data = await res.json()
      setPayloadEvent(data.event)
    } catch (e: any) {
      setError(e?.message || 'Failed to load payload')
    } finally {
      setPayloadLoading(false)
    }
  }

  const reprocess = async (eventId: string) => {
    if (!confirm('Reprocess this event? This will re-run the SPConnect mapper against its stored payload.')) {
      return
    }
    try {
      const res = await fetch(`/api/admin/hyphen/events/${encodeURIComponent(eventId)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reprocess' }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || `Failed: ${res.status}`)
      const r = data.result
      if (r?.ok) {
        alert(`✓ Mapped to Abel order ${r.orderNumber}`)
      } else {
        alert(`✗ ${r?.errorCode || 'FAILED'}: ${r?.errorMessage || 'Unknown error'}`)
      }
      loadAll()
    } catch (e: any) {
      setError(e?.message || 'Failed to reprocess')
    }
  }

  const saveBuilderAlias = async () => {
    if (!baValue.trim() || !baBuilderId) {
      setError('Alias value and builder are required')
      return
    }
    try {
      const res = await fetch('/api/admin/hyphen/aliases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: 'builder',
          aliasType: baType,
          aliasValue: baValue.trim(),
          builderId: baBuilderId,
          note: baNote.trim() || undefined,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || `Failed: ${res.status}`)
      setBaValue('')
      setBaNote('')
      setBaBuilderId('')
      setShowBuilderAliasForm(false)
      loadAll()
    } catch (e: any) {
      setError(e?.message || 'Failed to save builder alias')
    }
  }

  const saveProductAlias = async () => {
    if (!paValue.trim() || !paProductId) {
      setError('Alias value and product are required')
      return
    }
    try {
      const res = await fetch('/api/admin/hyphen/aliases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: 'product',
          aliasType: paType,
          aliasValue: paValue.trim(),
          productId: paProductId,
          note: paNote.trim() || undefined,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || `Failed: ${res.status}`)
      setPaValue('')
      setPaNote('')
      setPaProductId('')
      setPaProductSearch('')
      setShowProductAliasForm(false)
      loadAll()
    } catch (e: any) {
      setError(e?.message || 'Failed to save product alias')
    }
  }

  const deleteAlias = async (kind: 'builder' | 'product', id: string) => {
    if (!confirm(`Delete this ${kind} alias?`)) return
    try {
      const res = await fetch(
        `/api/admin/hyphen/aliases?id=${encodeURIComponent(id)}&kind=${kind}`,
        { method: 'DELETE' }
      )
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || `Failed: ${res.status}`)
      }
      loadAll()
    } catch (e: any) {
      setError(e?.message || 'Failed to delete alias')
    }
  }

  const baseUrl = typeof window !== 'undefined' ? window.location.origin : 'https://app.abellumber.com'

  const buildersSorted = useMemo(
    () => [...builders].sort((a, b) => a.companyName.localeCompare(b.companyName)),
    [builders]
  )

  return (
    <div className="max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Hyphen SPConnect</h1>
          <p className="text-sm text-gray-500 mt-1">
            OAuth 2.0 client credentials, inbound order events, and Hyphen ↔ Abel aliases. Auto-refreshes every 30s.
          </p>
        </div>
        <button
          onClick={() => {
            setShowMintForm((s) => !s)
            setJustMinted(null)
            setError('')
          }}
          className="px-4 py-2 bg-abel-amber text-white rounded hover:bg-abel-amber/90 text-sm font-medium"
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
            className="px-4 py-2 bg-abel-walnut text-white rounded text-sm font-medium disabled:opacity-50"
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
      <div className="mb-8">
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
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Mapped Order</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Error</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {loading && events.length === 0 && (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-500 text-sm">Loading…</td></tr>
              )}
              {!loading && events.length === 0 && (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-500 text-sm">
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
                  <td className="px-4 py-3 text-xs font-mono text-gray-500">
                    {e.mappedOrderId ? (
                      <a
                        href={`/admin/orders/${e.mappedOrderId}`}
                        className="text-abel-amber hover:underline"
                      >
                        {e.mappedOrderId.slice(0, 12)}…
                      </a>
                    ) : '—'}
                  </td>
                  <td className="px-4 py-3 text-xs text-red-700 max-w-xs truncate" title={e.error || ''}>
                    {e.error || ''}
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    <button
                      onClick={() => viewPayload(e.id)}
                      className="text-abel-walnut hover:underline text-xs font-medium mr-3"
                    >
                      View
                    </button>
                    {(e.status === 'FAILED' || e.status === 'RECEIVED') && (
                      <button
                        onClick={() => reprocess(e.id)}
                        className="text-green-700 hover:underline text-xs font-medium"
                      >
                        Reprocess
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Builder Aliases */}
      <div className="mb-8">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">
            Builder Aliases <span className="text-gray-400 normal-case">(Hyphen ID → Abel Builder)</span>
          </h2>
          <button
            onClick={() => setShowBuilderAliasForm((s) => !s)}
            className="px-3 py-1.5 bg-abel-walnut text-white rounded text-xs font-medium"
          >
            {showBuilderAliasForm ? 'Cancel' : '+ Add Builder Alias'}
          </button>
        </div>

        {showBuilderAliasForm && (
          <div className="mb-3 p-4 bg-white border border-gray-200 rounded-lg">
            <div className="grid grid-cols-4 gap-3 mb-3">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Type</label>
                <select
                  value={baType}
                  onChange={(e) => setBaType(e.target.value as any)}
                  className="w-full px-2 py-2 border border-gray-300 rounded text-sm"
                >
                  <option value="hyphenBuilderId">hyphenBuilderId (GUID)</option>
                  <option value="accountCode">accountCode</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Value *</label>
                <input
                  type="text"
                  value={baValue}
                  onChange={(e) => setBaValue(e.target.value)}
                  placeholder={baType === 'hyphenBuilderId' ? 'GUID from header.builder.id' : 'header.accountCode'}
                  className="w-full px-2 py-2 border border-gray-300 rounded text-sm font-mono"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Abel Builder *</label>
                <select
                  value={baBuilderId}
                  onChange={(e) => setBaBuilderId(e.target.value)}
                  className="w-full px-2 py-2 border border-gray-300 rounded text-sm"
                >
                  <option value="">Select…</option>
                  {buildersSorted.map((b) => (
                    <option key={b.id} value={b.id}>{b.companyName}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Note (optional)</label>
                <input
                  type="text"
                  value={baNote}
                  onChange={(e) => setBaNote(e.target.value)}
                  className="w-full px-2 py-2 border border-gray-300 rounded text-sm"
                />
              </div>
            </div>
            <button
              onClick={saveBuilderAlias}
              disabled={!baValue.trim() || !baBuilderId}
              className="px-4 py-2 bg-abel-amber text-white rounded text-sm font-medium disabled:opacity-50"
            >
              Save Alias
            </button>
          </div>
        )}

        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Type</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Hyphen Value</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Abel Builder</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Note</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Created</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {builderAliases.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-6 text-center text-gray-500 text-sm">
                  No builder aliases yet. Add one above once you know the Hyphen GUID or account code for a builder.
                </td></tr>
              )}
              {builderAliases.map((a) => (
                <tr key={a.id}>
                  <td className="px-4 py-3 text-xs font-mono text-gray-700">{a.aliasType}</td>
                  <td className="px-4 py-3 text-xs font-mono text-gray-700">{a.aliasValue}</td>
                  <td className="px-4 py-3 text-sm text-gray-700">
                    {a.builderCompanyName || <span className="text-red-600">(missing builder {a.builderId.slice(0, 10)}…)</span>}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500">{a.note || '—'}</td>
                  <td className="px-4 py-3 text-sm text-gray-600">{fmtDate(a.createdAt)}</td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => deleteAlias('builder', a.id)}
                      className="text-red-600 hover:text-red-800 text-xs font-medium"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Product Aliases */}
      <div className="mb-8">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">
            Product Aliases <span className="text-gray-400 normal-case">(Hyphen SKU → Abel Product)</span>
          </h2>
          <button
            onClick={() => setShowProductAliasForm((s) => !s)}
            className="px-3 py-1.5 bg-abel-walnut text-white rounded text-xs font-medium"
          >
            {showProductAliasForm ? 'Cancel' : '+ Add Product Alias'}
          </button>
        </div>

        {showProductAliasForm && (
          <div className="mb-3 p-4 bg-white border border-gray-200 rounded-lg">
            <div className="grid grid-cols-4 gap-3 mb-3">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Type</label>
                <select
                  value={paType}
                  onChange={(e) => setPaType(e.target.value as any)}
                  className="w-full px-2 py-2 border border-gray-300 rounded text-sm"
                >
                  <option value="builderSupplierSKU">builderSupplierSKU</option>
                  <option value="builderAltItemID">builderAltItemID</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Value *</label>
                <input
                  type="text"
                  value={paValue}
                  onChange={(e) => setPaValue(e.target.value)}
                  placeholder="Hyphen-side SKU"
                  className="w-full px-2 py-2 border border-gray-300 rounded text-sm font-mono"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Abel Product Search</label>
                <input
                  type="text"
                  value={paProductSearch}
                  onChange={(e) => setPaProductSearch(e.target.value)}
                  placeholder="Name or SKU"
                  className="w-full px-2 py-2 border border-gray-300 rounded text-sm"
                />
                {paProductResults.length > 0 && (
                  <select
                    value={paProductId}
                    onChange={(e) => setPaProductId(e.target.value)}
                    className="mt-1 w-full px-2 py-2 border border-gray-300 rounded text-sm"
                    size={Math.min(6, paProductResults.length + 1)}
                  >
                    <option value="">Select a product…</option>
                    {paProductResults.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.sku} — {p.name}
                      </option>
                    ))}
                  </select>
                )}
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Note (optional)</label>
                <input
                  type="text"
                  value={paNote}
                  onChange={(e) => setPaNote(e.target.value)}
                  className="w-full px-2 py-2 border border-gray-300 rounded text-sm"
                />
              </div>
            </div>
            <button
              onClick={saveProductAlias}
              disabled={!paValue.trim() || !paProductId}
              className="px-4 py-2 bg-abel-amber text-white rounded text-sm font-medium disabled:opacity-50"
            >
              Save Alias
            </button>
          </div>
        )}

        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Type</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Hyphen Value</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Abel Product</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Note</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Created</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {productAliases.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-6 text-center text-gray-500 text-sm">
                  No product aliases yet. When a line item fails to map, add an alias here pointing at the corresponding Abel product.
                </td></tr>
              )}
              {productAliases.map((a) => (
                <tr key={a.id}>
                  <td className="px-4 py-3 text-xs font-mono text-gray-700">{a.aliasType}</td>
                  <td className="px-4 py-3 text-xs font-mono text-gray-700">{a.aliasValue}</td>
                  <td className="px-4 py-3 text-sm text-gray-700">
                    {a.productSku ? (
                      <span>
                        <span className="font-mono text-xs text-gray-500">{a.productSku}</span> — {a.productName}
                      </span>
                    ) : (
                      <span className="text-red-600">(missing product {a.productId.slice(0, 10)}…)</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500">{a.note || '—'}</td>
                  <td className="px-4 py-3 text-sm text-gray-600">{fmtDate(a.createdAt)}</td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => deleteAlias('product', a.id)}
                      className="text-red-600 hover:text-red-800 text-xs font-medium"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Payload Modal */}
      {(payloadLoading || payloadEvent) && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center p-6 z-50"
          onClick={() => setPayloadEvent(null)}
        >
          <div
            className="bg-white rounded-lg max-w-4xl w-full max-h-[85vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between p-4 border-b border-gray-200">
              <div>
                <h3 className="text-sm font-semibold text-gray-900">Event Payload</h3>
                {payloadEvent && (
                  <div className="text-xs text-gray-500 mt-0.5 font-mono">
                    {payloadEvent.id} · {payloadEvent.kind} · {statusBadge(payloadEvent.status)}
                  </div>
                )}
              </div>
              <button
                onClick={() => setPayloadEvent(null)}
                className="text-gray-400 hover:text-gray-600 text-xl leading-none"
              >
                ×
              </button>
            </div>
            {payloadLoading && (
              <div className="p-8 text-center text-sm text-gray-500">Loading…</div>
            )}
            {payloadEvent && (
              <>
                {payloadEvent.error && (
                  <div className="p-3 mx-4 mt-4 rounded bg-red-50 border border-red-200 text-xs text-red-800">
                    <div className="font-semibold mb-1">Last Error</div>
                    <div className="whitespace-pre-wrap font-mono">{payloadEvent.error}</div>
                  </div>
                )}
                <div className="flex-1 overflow-auto p-4">
                  <pre className="text-xs font-mono text-gray-800 whitespace-pre-wrap bg-gray-50 p-3 rounded border border-gray-200">
                    {JSON.stringify(payloadEvent.rawPayload, null, 2)}
                  </pre>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
