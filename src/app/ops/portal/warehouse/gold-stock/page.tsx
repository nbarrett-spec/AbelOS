'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'

interface KitRow {
  id: string
  kitCode: string
  kitName: string
  builderId: string | null
  builderName: string | null
  planId: string | null
  planName: string | null
  reorderQty: number
  minQty: number
  currentQty: number
  status: string
  avgLeadTimeDays: number | null
  lastBuiltAt: string | null
  componentCount: number
  onHandKits: number
  allocatedKits: number
  consumedKits: number
  canBuildMax: number
}

interface KitDetail {
  kit: KitRow & { createdAt: string }
  components: Array<{
    id: string
    productId: string
    sku: string
    name: string
    quantity: number
    onHand: number
    available: number
  }>
  instances: Array<{
    id: string
    status: 'ON_HAND' | 'ALLOCATED' | 'CONSUMED'
    location: string | null
    builtAt: string
    builtByName: string | null
    allocatedJobNumber: string | null
  }>
}

const STATUS_STYLE: Record<string, string> = {
  ACTIVE: 'bg-green-100 text-green-700',
  PAUSED: 'bg-yellow-100 text-yellow-700',
  ARCHIVED: 'bg-gray-100 text-gray-600',
}

const INSTANCE_STYLE: Record<string, string> = {
  ON_HAND: 'bg-green-100 text-green-700',
  ALLOCATED: 'bg-blue-100 text-blue-700',
  CONSUMED: 'bg-gray-100 text-gray-600',
}

export default function GoldStockPage() {
  const [kits, setKits] = useState<KitRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedKitId, setSelectedKitId] = useState<string | null>(null)
  const [detail, setDetail] = useState<KitDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [buildCount, setBuildCount] = useState<number>(1)
  const [buildLocation, setBuildLocation] = useState<string>('')
  const [building, setBuilding] = useState(false)
  const [toast, setToast] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [atRiskOnly, setAtRiskOnly] = useState(false)

  const fetchList = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/ops/gold-stock')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setKits(data.kits || [])
    } catch (e: any) {
      setError(e?.message || 'Failed to load kits')
    } finally {
      setLoading(false)
    }
  }, [])

  const fetchDetail = useCallback(async (kitId: string) => {
    setDetailLoading(true)
    try {
      const res = await fetch(`/api/ops/gold-stock/${kitId}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setDetail(data)
    } catch (e: any) {
      setToast({ type: 'error', text: e?.message || 'Failed to load kit detail' })
    } finally {
      setDetailLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchList()
  }, [fetchList])

  useEffect(() => {
    if (selectedKitId) fetchDetail(selectedKitId)
    else setDetail(null)
  }, [selectedKitId, fetchDetail])

  const summary = useMemo(() => {
    const total = kits.length
    const active = kits.filter((k) => k.status === 'ACTIVE').length
    const below = kits.filter((k) => k.status === 'ACTIVE' && k.currentQty < k.minQty).length
    const onHandTotal = kits.reduce((s, k) => s + k.onHandKits, 0)
    return { total, active, below, onHandTotal }
  }, [kits])

  // Days-of-supply heuristic: lead-time proxy when current qty is at/below reorder.
  // Gold-stock rows don't carry per-SKU velocity, so we approximate using avgLeadTimeDays
  // (rebuild lead time) scaled by stock vs. min. If lacking lead time, leave null and
  // fall back to the onHand <= reorderPoint signal (per task rule #5).
  const computeDaysOfSupply = useCallback((k: KitRow): number | null => {
    if (k.avgLeadTimeDays == null || k.avgLeadTimeDays <= 0) return null
    if (k.minQty <= 0) return k.currentQty > 0 ? k.avgLeadTimeDays : 0
    // Rough cover: current stock as a fraction of min, times lead time.
    const ratio = k.currentQty / k.minQty
    return Math.max(0, Math.round(ratio * k.avgLeadTimeDays))
  }, [])

  const atRiskKits = useMemo(() => {
    return kits
      .filter((k) => k.status === 'ACTIVE')
      .map((k) => ({ kit: k, dos: computeDaysOfSupply(k) }))
      .filter(({ kit, dos }) => {
        const belowReorder = kit.currentQty <= kit.reorderQty
        const lowDos = dos != null && dos < 14
        return belowReorder || lowDos
      })
      .sort((a, b) => {
        // Sort by daysOfSupply ascending; nulls last.
        if (a.dos == null && b.dos == null) return a.kit.currentQty - b.kit.currentQty
        if (a.dos == null) return 1
        if (b.dos == null) return -1
        return a.dos - b.dos
      })
  }, [kits, computeDaysOfSupply])

  const visibleKits = useMemo(() => {
    if (!atRiskOnly) return kits
    const atRiskIds = new Set(atRiskKits.map(({ kit }) => kit.id))
    return kits.filter((k) => atRiskIds.has(k.id))
  }, [kits, atRiskKits, atRiskOnly])

  const handleBuild = useCallback(async () => {
    if (!selectedKitId) return
    const count = Math.max(1, Math.floor(Number(buildCount) || 1))
    setBuilding(true)
    try {
      const res = await fetch(`/api/ops/gold-stock/${selectedKitId}/build`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ count, location: buildLocation || null }),
      })
      const data = await res.json()
      if (!res.ok) {
        if (data.shortages) {
          const txt = data.shortages
            .map((s: any) => `${s.sku}: need ${s.need}, have ${s.have}`)
            .join('; ')
          setToast({ type: 'error', text: `Components short — ${txt}` })
        } else {
          setToast({ type: 'error', text: data.error || 'Build failed' })
        }
        return
      }
      setToast({
        type: 'success',
        text: `Built ${data.count} kit${data.count === 1 ? '' : 's'}`,
      })
      await Promise.all([fetchList(), fetchDetail(selectedKitId)])
    } catch (e: any) {
      setToast({ type: 'error', text: e?.message || 'Network error' })
    } finally {
      setBuilding(false)
    }
  }, [selectedKitId, buildCount, buildLocation, fetchList, fetchDetail])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#27AE60]" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Gold Stock Pre-Build</h1>
          <p className="text-gray-600 mt-1">
            Pre-kitted door, jamb, and trim bundles for recurring builder plans.
            Compresses lead time from 14 days to 2.
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            href="/ops/portal/warehouse"
            className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors text-sm font-medium"
          >
            Back to Warehouse
          </Link>
          <button
            onClick={fetchList}
            className="px-4 py-2 bg-[#0f2a3e] text-white rounded-lg hover:bg-[#0a1a28] transition-colors text-sm font-medium"
          >
            Refresh
          </button>
        </div>
      </div>

      {toast && (
        <div
          className={`p-3 rounded-lg text-sm font-medium ${
            toast.type === 'success'
              ? 'bg-green-50 text-green-800 border border-green-200'
              : 'bg-red-50 text-red-800 border border-red-200'
          }`}
        >
          {toast.text}
          <button onClick={() => setToast(null)} className="float-right text-lg leading-none">
            &times;
          </button>
        </div>
      )}

      {error && (
        <div className="p-3 rounded-lg bg-red-50 text-red-800 border border-red-200 text-sm">
          {error}
        </div>
      )}

      {/* KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl border border-l-4 border-l-[#C6A24E] p-4">
          <p className="text-xs text-gray-500 uppercase tracking-wide">Total Kits</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">{summary.total}</p>
          <p className="text-xs text-gray-400 mt-1">{summary.active} active</p>
        </div>
        <div className="bg-white rounded-xl border border-l-4 border-l-red-500 p-4">
          <p className="text-xs text-gray-500 uppercase tracking-wide">Below Min</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">{summary.below}</p>
          <p className="text-xs text-gray-400 mt-1">need rebuild</p>
        </div>
        <div className="bg-white rounded-xl border border-l-4 border-l-[#27AE60] p-4">
          <p className="text-xs text-gray-500 uppercase tracking-wide">On-Hand Kits</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">{summary.onHandTotal}</p>
          <p className="text-xs text-gray-400 mt-1">ready to allocate</p>
        </div>
        <div className="bg-white rounded-xl border border-l-4 border-l-blue-500 p-4">
          <p className="text-xs text-gray-500 uppercase tracking-wide">Lead Time Saved</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">12d</p>
          <p className="text-xs text-gray-400 mt-1">14d → 2d per kit</p>
        </div>
      </div>

      {/* Trending toward shortage */}
      {atRiskKits.length > 0 && (
        <div className="bg-white rounded-xl border overflow-hidden">
          <div className="p-4 border-b flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <h2 className="text-lg font-bold text-gray-900">Trending toward shortage</h2>
              <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-red-100 text-red-700">
                {atRiskKits.length} total at risk
              </span>
            </div>
            <span className="text-xs text-gray-500">
              days-of-supply &lt; 14 or on-hand &le; reorder
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b text-xs text-gray-600">
                <tr>
                  <th className="px-3 py-2 text-left font-semibold">SKU</th>
                  <th className="px-3 py-2 text-left font-semibold">Product Name</th>
                  <th className="px-3 py-2 text-right font-semibold">On-Hand</th>
                  <th className="px-3 py-2 text-right font-semibold">Days of Supply</th>
                  <th className="px-3 py-2 text-right font-semibold">Reorder Point</th>
                  <th className="px-3 py-2 text-left font-semibold">Status</th>
                </tr>
              </thead>
              <tbody>
                {atRiskKits.map(({ kit, dos }) => {
                  const critical = dos != null && dos < 7
                  const warning = dos != null && dos >= 7 && dos < 14
                  const rowClass = critical
                    ? 'bg-red-50 hover:bg-red-100'
                    : warning
                    ? 'bg-yellow-50 hover:bg-yellow-100'
                    : 'hover:bg-gray-50'
                  const statusLabel = critical
                    ? 'Critical'
                    : warning
                    ? 'Low'
                    : kit.currentQty <= kit.reorderQty
                    ? 'Below reorder'
                    : 'At risk'
                  const badgeClass = critical
                    ? 'bg-red-100 text-red-700'
                    : warning
                    ? 'bg-yellow-100 text-yellow-700'
                    : 'bg-orange-100 text-orange-700'
                  return (
                    <tr
                      key={kit.id}
                      className={`border-b cursor-pointer ${rowClass} ${
                        selectedKitId === kit.id ? 'ring-1 ring-inset ring-blue-300' : ''
                      }`}
                      onClick={() => setSelectedKitId(kit.id)}
                    >
                      <td className="px-3 py-2 font-mono text-xs text-gray-900">
                        {kit.kitCode}
                      </td>
                      <td className="px-3 py-2 text-gray-700">
                        {kit.kitName}
                        {kit.builderName && (
                          <span className="text-xs text-gray-500 ml-1">
                            · {kit.builderName}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right font-semibold text-gray-900">
                        {kit.currentQty}
                      </td>
                      <td className="px-3 py-2 text-right text-gray-700">
                        {dos == null ? (
                          <span className="text-gray-400">—</span>
                        ) : (
                          <span className={critical ? 'font-semibold text-red-700' : warning ? 'font-semibold text-yellow-700' : ''}>
                            {dos}d
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right text-gray-700">{kit.reorderQty}</td>
                      <td className="px-3 py-2">
                        <span
                          className={`px-2 py-0.5 rounded text-xs font-medium ${badgeClass}`}
                        >
                          {statusLabel}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Kit table + detail */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Kit list */}
        <div className="lg:col-span-2 bg-white rounded-xl border overflow-hidden">
          <div className="p-4 border-b flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <h2 className="text-lg font-bold text-gray-900">
                {atRiskOnly ? 'At-Risk Kits' : 'Active Kits'}
              </h2>
              {atRiskKits.length > 0 && (
                <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-red-100 text-red-700">
                  {atRiskKits.length} at risk
                </span>
              )}
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setAtRiskOnly((v) => !v)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                  atRiskOnly
                    ? 'bg-red-600 text-white border-red-600 hover:bg-red-700'
                    : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                }`}
              >
                {atRiskOnly ? 'Showing at risk' : 'At Risk'}
              </button>
              <span className="text-xs text-gray-500">click row for detail</span>
            </div>
          </div>
          {visibleKits.length === 0 ? (
            kits.length === 0 ? (
              <div className="p-8 text-center text-gray-500 text-sm">
                No gold-stock kits defined. Run{' '}
                <code className="font-mono text-xs bg-gray-100 px-1 rounded">
                  node scripts/seed-gold-stock-kits.mjs --commit
                </code>{' '}
                to seed from historical data.
              </div>
            ) : (
              <div className="p-8 text-center text-gray-500 text-sm">
                No kits match the current filter. Toggle{' '}
                <button
                  onClick={() => setAtRiskOnly(false)}
                  className="underline text-[#0f2a3e] hover:text-[#0a1a28]"
                >
                  show all
                </button>{' '}
                to see every kit.
              </div>
            )
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b text-xs text-gray-600">
                  <tr>
                    <th className="px-3 py-2 text-left font-semibold">Kit</th>
                    <th className="px-3 py-2 text-left font-semibold">Builder / Plan</th>
                    <th className="px-3 py-2 text-right font-semibold">On-Hand</th>
                    <th className="px-3 py-2 text-right font-semibold">Min / Reorder</th>
                    <th className="px-3 py-2 text-right font-semibold">Can Build</th>
                    <th className="px-3 py-2 text-left font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleKits.map((k) => {
                    const below = k.status === 'ACTIVE' && k.currentQty < k.minQty
                    return (
                      <tr
                        key={k.id}
                        className={`border-b cursor-pointer hover:bg-gray-50 ${
                          selectedKitId === k.id ? 'bg-blue-50' : ''
                        }`}
                        onClick={() => setSelectedKitId(k.id)}
                      >
                        <td className="px-3 py-2">
                          <div className="font-mono text-xs text-gray-900">{k.kitCode}</div>
                          <div className="text-xs text-gray-500">
                            {k.componentCount} components
                          </div>
                        </td>
                        <td className="px-3 py-2 text-gray-700">
                          <div>{k.builderName || '—'}</div>
                          <div className="text-xs text-gray-500">{k.planName || '—'}</div>
                        </td>
                        <td className={`px-3 py-2 text-right font-semibold ${below ? 'text-red-600' : 'text-gray-900'}`}>
                          {k.currentQty}
                          {k.allocatedKits > 0 && (
                            <span className="text-xs text-blue-600 ml-1">
                              ({k.allocatedKits} alloc)
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right text-gray-700">
                          {k.minQty} / {k.reorderQty}
                        </td>
                        <td className="px-3 py-2 text-right text-gray-700">{k.canBuildMax}</td>
                        <td className="px-3 py-2">
                          <span
                            className={`px-2 py-0.5 rounded text-xs font-medium ${
                              STATUS_STYLE[k.status] || 'bg-gray-100 text-gray-700'
                            }`}
                          >
                            {k.status}
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Detail panel */}
        <div className="bg-white rounded-xl border p-4">
          <h3 className="text-lg font-bold text-gray-900 mb-4">
            {selectedKitId ? 'Kit Detail' : 'Select a Kit'}
          </h3>

          {!selectedKitId ? (
            <p className="text-sm text-gray-500">
              Pick a kit from the list to see components, instances, and trigger a
              pre-build.
            </p>
          ) : detailLoading || !detail ? (
            <div className="flex items-center justify-center h-40">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-[#27AE60]" />
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <div className="font-mono text-sm text-gray-900">{detail.kit.kitCode}</div>
                <div className="text-sm text-gray-600">{detail.kit.kitName}</div>
                <div className="text-xs text-gray-500 mt-1">
                  on-hand {detail.kit.currentQty} · min {detail.kit.minQty} · reorder{' '}
                  {detail.kit.reorderQty}
                </div>
                {detail.kit.lastBuiltAt && (
                  <div className="text-xs text-gray-500">
                    last built {new Date(detail.kit.lastBuiltAt).toLocaleString()}
                  </div>
                )}
              </div>

              {/* Build form */}
              <div className="rounded-lg border bg-gray-50 p-3 space-y-2">
                <label className="block text-xs font-semibold text-gray-500 uppercase">
                  Build next
                </label>
                <div className="flex gap-2">
                  <input
                    type="number"
                    min={1}
                    value={buildCount}
                    onChange={(e) => setBuildCount(Math.max(1, Number(e.target.value) || 1))}
                    className="w-20 border rounded-lg px-2 py-1 text-sm"
                  />
                  <input
                    type="text"
                    placeholder="Bin / location"
                    value={buildLocation}
                    onChange={(e) => setBuildLocation(e.target.value)}
                    className="flex-1 border rounded-lg px-2 py-1 text-sm"
                  />
                </div>
                <div className="text-xs text-gray-500">
                  max you can build right now: <b>{detail.kit.canBuildMax}</b>
                </div>
                <button
                  onClick={handleBuild}
                  disabled={building || buildCount > detail.kit.canBuildMax}
                  className="w-full px-3 py-2 bg-[#27AE60] text-white rounded-lg text-sm font-medium hover:bg-[#229954] disabled:opacity-50"
                >
                  {building
                    ? 'Building…'
                    : `Build ${buildCount} Kit${buildCount === 1 ? '' : 's'}`}
                </button>
              </div>

              {/* Components */}
              <div>
                <div className="text-xs font-semibold text-gray-500 uppercase mb-2">
                  Components ({detail.components.length})
                </div>
                <div className="space-y-1 max-h-60 overflow-y-auto">
                  {detail.components.map((c) => {
                    const short = c.available < c.quantity
                    return (
                      <div
                        key={c.id}
                        className={`text-xs rounded border p-2 ${
                          short ? 'border-red-200 bg-red-50' : 'border-gray-200'
                        }`}
                      >
                        <div className="font-mono text-gray-900">{c.sku}</div>
                        <div className="text-gray-600 truncate">{c.name}</div>
                        <div className={`mt-0.5 ${short ? 'text-red-600' : 'text-gray-500'}`}>
                          need {c.quantity} · available {c.available}
                          {short && ' · SHORT'}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* Instances */}
              <div>
                <div className="text-xs font-semibold text-gray-500 uppercase mb-2">
                  Instances ({detail.instances.length})
                </div>
                {detail.instances.length === 0 ? (
                  <div className="text-xs text-gray-500">No instances built yet.</div>
                ) : (
                  <div className="space-y-1 max-h-60 overflow-y-auto">
                    {detail.instances.map((i) => (
                      <div
                        key={i.id}
                        className="text-xs rounded border border-gray-200 p-2 flex justify-between items-start"
                      >
                        <div>
                          <div className="text-gray-900">
                            {new Date(i.builtAt).toLocaleDateString()}
                            {i.location ? ` · ${i.location}` : ''}
                          </div>
                          <div className="text-gray-500">
                            {i.builtByName || 'system'}
                            {i.allocatedJobNumber ? ` → ${i.allocatedJobNumber}` : ''}
                          </div>
                        </div>
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-medium ${
                            INSTANCE_STYLE[i.status] || 'bg-gray-100 text-gray-600'
                          }`}
                        >
                          {i.status}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
