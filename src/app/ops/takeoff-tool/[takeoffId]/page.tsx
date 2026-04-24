'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { useRouter, useParams } from 'next/navigation'

interface TakeoffItem {
  id: string
  category: string
  description: string
  location: string | null
  quantity: number
  productId: string | null
  product?: {
    id: string
    sku: string
    name: string
    basePrice: number
  } | null
  itemType?: string | null
  widthInches?: number | null
  heightInches?: number | null
  linearFeet?: number | null
  hardware?: string | null
  notes?: string | null
}

interface TakeoffDetail {
  id: string
  status: string
  confidence: number | null
  aiExtractionAt?: string | null
  aiExtractionModel?: string | null
  aiExtractionError?: string | null
  aiExtractionCost?: number | null
  blueprint?: { fileName: string; fileType: string } | null
  project?: {
    name: string
    builder?: { companyName: string }
  } | null
  items: TakeoffItem[]
}

const ITEM_TYPES = [
  { value: 'exterior_door', label: 'Exterior door' },
  { value: 'interior_door', label: 'Interior door' },
  { value: 'window', label: 'Window' },
  { value: 'trim', label: 'Trim' },
  { value: 'hardware', label: 'Hardware' },
  { value: 'misc', label: 'Misc' },
]

export default function TakeoffReviewPage() {
  const params = useParams<{ takeoffId: string }>()
  const router = useRouter()
  const takeoffId = params.takeoffId

  const [takeoff, setTakeoff] = useState<TakeoffDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [extracting, setExtracting] = useState(false)
  const [matching, setMatching] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch(`/api/ops/takeoffs/${takeoffId}`, { cache: 'no-store' })
      const data = await r.json()
      if (!r.ok) throw new Error(data.error || 'Load failed')
      setTakeoff(data as TakeoffDetail)
    } catch (e: any) {
      setErrorMessage(e?.message || 'Failed to load takeoff')
    } finally {
      setLoading(false)
    }
  }, [takeoffId])

  useEffect(() => {
    load()
  }, [load])

  const runExtract = async () => {
    setExtracting(true)
    setErrorMessage(null)
    setStatusMessage(null)
    try {
      const r = await fetch(`/api/ops/takeoffs/${takeoffId}/extract`, { method: 'POST' })
      const data = await r.json()
      if (r.status === 503 && data.manualFallback) {
        setStatusMessage('AI not configured — fill in rows manually below.')
      } else if (!r.ok) {
        setErrorMessage(data.error || data.reason || `Extract failed (${r.status})`)
      } else {
        setStatusMessage(
          data.cached
            ? `Cached extraction reused (${data.itemsCreated} rows).`
            : `Extracted ${data.itemsCreated} rows · $${(data.costEstimate || 0).toFixed(4)}`,
        )
      }
      await load()
    } catch (e: any) {
      setErrorMessage(e?.message || 'Extract failed')
    } finally {
      setExtracting(false)
    }
  }

  const runMatchProducts = async () => {
    setMatching(true)
    setErrorMessage(null)
    setStatusMessage(null)
    try {
      const r = await fetch(`/api/ops/takeoffs/${takeoffId}/match-products`, { method: 'POST' })
      const data = await r.json()
      if (!r.ok) {
        setErrorMessage(data.error || 'Match failed')
      } else {
        setStatusMessage(`Matched ${data.matched} of ${data.total} rows.`)
      }
      await load()
    } catch (e: any) {
      setErrorMessage(e?.message || 'Match failed')
    } finally {
      setMatching(false)
    }
  }

  const runGenerateQuote = async () => {
    setGenerating(true)
    setErrorMessage(null)
    setStatusMessage(null)
    try {
      const r = await fetch(`/api/ops/takeoffs/${takeoffId}/generate-quote`, {
        method: 'POST',
      })
      const data = await r.json()
      if (!r.ok) {
        setErrorMessage(data.error || 'Quote generation failed')
        return
      }
      router.push(data.redirectTo || `/ops/quotes/${data.quoteId}`)
    } catch (e: any) {
      setErrorMessage(e?.message || 'Quote generation failed')
    } finally {
      setGenerating(false)
    }
  }

  const patchItem = async (itemId: string, fields: Partial<TakeoffItem>) => {
    await fetch(`/api/ops/takeoffs/${takeoffId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'updateItem', itemId, ...fields }),
    })
  }

  const addRow = async () => {
    const r = await fetch(`/api/ops/takeoffs/${takeoffId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'addItem',
        category: 'Miscellaneous',
        description: 'New row',
        quantity: 1,
      }),
    })
    if (r.ok) await load()
  }

  const deleteRow = async (itemId: string) => {
    await fetch(`/api/ops/takeoffs/${takeoffId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'deleteItem', itemId }),
    })
    await load()
  }

  if (loading) {
    return <div className="p-8 text-gray-500">Loading…</div>
  }
  if (!takeoff) {
    return <div className="p-8 text-red-600">Takeoff not found.</div>
  }

  const hasItems = takeoff.items && takeoff.items.length > 0
  const matchedCount = takeoff.items.filter((i) => i.productId).length

  return (
    <div className="max-w-[1600px] space-y-6">
      {/* Breadcrumb + title */}
      <div>
        <div className="text-sm text-gray-500 mb-1">
          <Link href="/ops/takeoff-tool" className="hover:text-[#0f2a3e]">
            AI Takeoff Tool
          </Link>
          <span className="mx-2">/</span>
          <span>{takeoff.project?.name || 'Takeoff'}</span>
        </div>
        <div className="flex items-start justify-between gap-6 flex-wrap">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900">
              {takeoff.project?.name || 'Unnamed project'}
            </h1>
            <p className="text-gray-500 text-sm mt-1">
              {takeoff.project?.builder?.companyName || 'No builder assigned'} ·{' '}
              {takeoff.blueprint?.fileName || 'No blueprint'} · Status{' '}
              <strong>{takeoff.status}</strong>
              {takeoff.aiExtractionModel && (
                <> · AI model <code className="text-xs">{takeoff.aiExtractionModel}</code></>
              )}
              {typeof takeoff.aiExtractionCost === 'number' && (
                <> · Cost ${takeoff.aiExtractionCost.toFixed(4)}</>
              )}
            </p>
          </div>
          <div className="flex gap-2 flex-wrap">
            <button
              onClick={runExtract}
              disabled={extracting}
              className="bg-[#0f2a3e] text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-[#163d5c] disabled:opacity-50"
            >
              {extracting ? 'Extracting…' : hasItems ? 'Re-run AI extraction' : 'Run AI extraction (~$0.05)'}
            </button>
            <button
              onClick={runMatchProducts}
              disabled={matching || !hasItems}
              className="bg-white border border-gray-300 text-gray-800 px-4 py-2 rounded-lg text-sm font-semibold hover:bg-gray-50 disabled:opacity-50"
            >
              {matching ? 'Matching…' : 'Match products'}
            </button>
            <button
              onClick={runGenerateQuote}
              disabled={generating || !hasItems}
              className="bg-[#C6A24E] text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-[#b89142] disabled:opacity-50"
            >
              {generating ? 'Generating…' : 'Generate quote'}
            </button>
          </div>
        </div>
      </div>

      {statusMessage && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 text-sm text-emerald-800">
          {statusMessage}
        </div>
      )}
      {errorMessage && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
          {errorMessage}
        </div>
      )}
      {takeoff.aiExtractionError && !errorMessage && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-800">
          Last AI extraction error: {takeoff.aiExtractionError}
        </div>
      )}

      {/* Two-column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left: blueprint */}
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden flex flex-col">
          <div className="p-4 border-b border-gray-200 text-sm text-gray-600">
            Blueprint preview · {takeoff.blueprint?.fileType || 'file'}
          </div>
          <div className="flex-1 min-h-[600px] bg-gray-100">
            <embed
              src={`/api/ops/takeoffs/${takeoffId}/blueprint`}
              type={takeoff.blueprint?.fileType === 'pdf' ? 'application/pdf' : undefined}
              className="w-full h-full"
              style={{ minHeight: 600 }}
            />
          </div>
        </div>

        {/* Right: items table */}
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <div className="p-4 border-b border-gray-200 flex items-center justify-between">
            <div className="text-sm text-gray-700">
              <strong>{takeoff.items.length}</strong> items ·{' '}
              <strong>{matchedCount}</strong> matched to products
            </div>
            <button
              onClick={addRow}
              className="text-sm text-[#0f2a3e] hover:underline"
            >
              + Add row
            </button>
          </div>

          {!hasItems ? (
            <div className="p-8 text-gray-500 text-sm">
              No items yet. Click <strong>Run AI extraction</strong> above — or
              hit <strong>+ Add row</strong> to enter items manually.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50 text-gray-600 uppercase text-xs">
                  <tr>
                    <th className="px-3 py-2 text-left">Type</th>
                    <th className="px-3 py-2 text-left">Description</th>
                    <th className="px-3 py-2 text-right">W</th>
                    <th className="px-3 py-2 text-right">H</th>
                    <th className="px-3 py-2 text-right">Qty / LF</th>
                    <th className="px-3 py-2 text-left">Hardware</th>
                    <th className="px-3 py-2 text-left">Location</th>
                    <th className="px-3 py-2 text-left">Product</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {takeoff.items.map((item) => (
                    <ItemRow
                      key={item.id}
                      item={item}
                      onPatch={async (fields) => {
                        await patchItem(item.id, fields)
                        await load()
                      }}
                      onDelete={() => deleteRow(item.id)}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function ItemRow({
  item,
  onPatch,
  onDelete,
}: {
  item: TakeoffItem
  onPatch: (fields: Partial<TakeoffItem>) => Promise<void>
  onDelete: () => void
}) {
  const [local, setLocal] = useState(item)

  useEffect(() => setLocal(item), [item])

  const commit = async (fields: Partial<TakeoffItem>) => {
    const merged = { ...local, ...fields }
    setLocal(merged)
    await onPatch(fields)
  }

  return (
    <tr>
      <td className="px-3 py-2">
        <select
          value={local.itemType || ''}
          onChange={(e) => setLocal({ ...local, itemType: e.target.value })}
          onBlur={(e) => commit({ itemType: e.target.value })}
          className="w-full border border-gray-200 rounded px-2 py-1 text-xs"
        >
          <option value="">—</option>
          {ITEM_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </td>
      <td className="px-3 py-2 min-w-[220px]">
        <input
          type="text"
          value={local.description}
          onChange={(e) => setLocal({ ...local, description: e.target.value })}
          onBlur={(e) => commit({ description: e.target.value })}
          className="w-full border border-gray-200 rounded px-2 py-1 text-xs"
        />
      </td>
      <td className="px-3 py-2 w-[80px] text-right">
        <NumberInput
          value={local.widthInches ?? null}
          onCommit={(v) => commit({ widthInches: v })}
        />
      </td>
      <td className="px-3 py-2 w-[80px] text-right">
        <NumberInput
          value={local.heightInches ?? null}
          onCommit={(v) => commit({ heightInches: v })}
        />
      </td>
      <td className="px-3 py-2 w-[80px] text-right">
        <input
          type="number"
          value={local.quantity}
          onChange={(e) => setLocal({ ...local, quantity: Number(e.target.value) || 0 })}
          onBlur={(e) => commit({ quantity: Number(e.target.value) || 0 })}
          className="w-full border border-gray-200 rounded px-2 py-1 text-xs text-right"
        />
      </td>
      <td className="px-3 py-2">
        <input
          type="text"
          value={local.hardware || ''}
          onChange={(e) => setLocal({ ...local, hardware: e.target.value })}
          onBlur={(e) => commit({ hardware: e.target.value })}
          className="w-full border border-gray-200 rounded px-2 py-1 text-xs"
        />
      </td>
      <td className="px-3 py-2">
        <input
          type="text"
          value={local.location || ''}
          onChange={(e) => setLocal({ ...local, location: e.target.value })}
          onBlur={(e) => commit({ location: e.target.value })}
          className="w-full border border-gray-200 rounded px-2 py-1 text-xs"
        />
      </td>
      <td className="px-3 py-2 min-w-[180px]">
        {local.product ? (
          <span className="text-xs text-gray-700">
            <strong>{local.product.sku}</strong> — {local.product.name}
          </span>
        ) : (
          <span className="text-xs text-gray-400">— unmatched —</span>
        )}
      </td>
      <td className="px-3 py-2 text-right">
        <button
          type="button"
          onClick={onDelete}
          className="text-xs text-red-600 hover:underline"
        >
          Remove
        </button>
      </td>
    </tr>
  )
}

function NumberInput({
  value,
  onCommit,
}: {
  value: number | null
  onCommit: (v: number | null) => void
}) {
  const [local, setLocal] = useState<string>(value == null ? '' : String(value))
  useEffect(() => setLocal(value == null ? '' : String(value)), [value])

  return (
    <input
      type="number"
      step="any"
      value={local}
      onChange={(e) => setLocal(e.target.value)}
      onBlur={() => {
        if (local === '') onCommit(null)
        else {
          const n = Number(local)
          onCommit(Number.isFinite(n) ? n : null)
        }
      }}
      className="w-full border border-gray-200 rounded px-2 py-1 text-xs text-right"
    />
  )
}
