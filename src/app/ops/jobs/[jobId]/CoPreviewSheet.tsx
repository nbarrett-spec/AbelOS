'use client'

import { useEffect, useMemo, useState } from 'react'

// ──────────────────────────────────────────────────────────────────────
// CO Preview Sheet — opens from the Job detail page, lets a PM lay out
// proposed change-order lines (ADD / REMOVE / SUBSTITUTE) and see the
// material impact before committing.
//
// This is read-only: it never writes to InventoryAllocation or ChangeOrder.
// When the PM hits "Confirm preview" we POST with `confirm: true` so the
// ChangeOrderPreview audit entry is logged — that's the attestation that
// this specific preview was seen and accepted. Actually creating the CO
// row is a separate flow (/api/ops/change-orders).
// ──────────────────────────────────────────────────────────────────────

type CoLineType = 'ADD' | 'REMOVE' | 'SUBSTITUTE'

interface DraftLine {
  clientId: string
  productId: string
  productLabel: string
  qty: number
  type: CoLineType
  substituteProductId?: string
  substituteLabel?: string
}

interface ProductOption {
  id: string
  sku: string
  name: string
}

interface ImpactLineStatus {
  status: string
  reason: string | null
  daysToShelf: number | null
  arrivalDate: string | null
  sourcing: { fromStock: number; fromIncoming: number; fromNewPO: number }
  onHand: number
  available: number
  existingAllocation: number
  incomingBeforeDue: number
  projectedATP: number
  costDelta: number
  unitCost: number
  productId: string
  sku: string | null
  productName: string | null
  substitute?: {
    productId: string
    sku: string | null
    productName: string | null
  }
  input: {
    productId: string
    qty: number
    type: CoLineType
    substituteProductId?: string
  }
}

interface ImpactResult {
  jobId: string
  jobNumber: string | null
  scheduledDate: string | null
  overallImpact: 'NONE' | 'DELAYED_BUT_OK' | 'AT_RISK' | 'WILL_MISS'
  newCompletionDate: string | null
  daysShifted: number
  totalNewValue: number
  summary: string
  lines: ImpactLineStatus[]
}

const OVERALL_STYLES: Record<ImpactResult['overallImpact'], string> = {
  NONE: 'bg-green-50 border-green-300 text-green-900',
  DELAYED_BUT_OK: 'bg-amber-50 border-amber-300 text-amber-900',
  AT_RISK: 'bg-orange-50 border-orange-400 text-orange-900',
  WILL_MISS: 'bg-red-50 border-red-400 text-red-900',
}

const LINE_STATUS_LABEL: Record<string, string> = {
  OK_FROM_STOCK: 'From stock',
  OK_FROM_INCOMING: 'Covered by incoming',
  DELAYED_INCOMING: 'Incoming late',
  NEEDS_NEW_PO: 'Needs new PO',
  UNFULFILLABLE: 'Will miss',
  RELEASE_OK: 'Release OK',
  RELEASE_PARTIAL: 'Release partial',
  RELEASE_NOT_FOUND: 'Nothing allocated',
  SUBSTITUTE_OK: 'Swap OK',
  SUBSTITUTE_SHORT: 'Swap short',
  MISSING_PRODUCT: 'Product missing',
  AT_RISK: 'At risk',
}

const LINE_TONE: Record<string, string> = {
  OK_FROM_STOCK: 'text-green-700 bg-green-50',
  OK_FROM_INCOMING: 'text-amber-700 bg-amber-50',
  DELAYED_INCOMING: 'text-orange-700 bg-orange-50',
  NEEDS_NEW_PO: 'text-amber-700 bg-amber-50',
  UNFULFILLABLE: 'text-red-700 bg-red-50',
  RELEASE_OK: 'text-green-700 bg-green-50',
  RELEASE_PARTIAL: 'text-amber-700 bg-amber-50',
  RELEASE_NOT_FOUND: 'text-gray-700 bg-gray-50',
  SUBSTITUTE_OK: 'text-green-700 bg-green-50',
  SUBSTITUTE_SHORT: 'text-orange-700 bg-orange-50',
  MISSING_PRODUCT: 'text-red-700 bg-red-50',
}

function fmtUsd(n: number) {
  const sign = n < 0 ? '-' : ''
  return sign + '$' + Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: 0 })
}

function fmtDate(iso: string | null) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function CoPreviewSheet({
  jobId,
  open,
  onClose,
}: {
  jobId: string
  open: boolean
  onClose: () => void
}) {
  const [products, setProducts] = useState<ProductOption[]>([])
  const [productQuery, setProductQuery] = useState('')
  const [lines, setLines] = useState<DraftLine[]>([])
  const [impact, setImpact] = useState<ImpactResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [confirmedAt, setConfirmedAt] = useState<Date | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Load product catalog for the SKU picker. We cap at 300 to keep the UI
  // responsive — server-side search handles the long tail.
  useEffect(() => {
    if (!open) return
    let ignore = false
    const url = productQuery.trim()
      ? `/api/ops/products?search=${encodeURIComponent(productQuery.trim())}&limit=100`
      : `/api/ops/products?limit=300&active=true`
    fetch(url)
      .then((r) => r.json())
      .then((data) => {
        if (ignore) return
        const list: ProductOption[] = (data?.products || data || [])
          .map((p: any) => ({
            id: p.id,
            sku: p.sku || '',
            name: p.name || p.displayName || '',
          }))
          .filter((p: ProductOption) => p.id)
        setProducts(list)
      })
      .catch(() => {})
    return () => {
      ignore = true
    }
  }, [open, productQuery])

  const addLine = () => {
    setLines((prev) => [
      ...prev,
      {
        clientId: 'draft-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        productId: '',
        productLabel: '',
        qty: 1,
        type: 'ADD',
      },
    ])
    setConfirmedAt(null)
  }

  const updateLine = (clientId: string, patch: Partial<DraftLine>) => {
    setLines((prev) => prev.map((l) => (l.clientId === clientId ? { ...l, ...patch } : l)))
    setConfirmedAt(null)
  }

  const removeLine = (clientId: string) => {
    setLines((prev) => prev.filter((l) => l.clientId !== clientId))
    setConfirmedAt(null)
  }

  // Debounced live preview as the PM edits.
  const validLines = useMemo(() => {
    return lines.filter(
      (l) =>
        l.productId &&
        Number.isFinite(l.qty) &&
        l.qty > 0 &&
        (l.type !== 'SUBSTITUTE' || l.substituteProductId)
    )
  }, [lines])

  useEffect(() => {
    if (!open) return
    if (validLines.length === 0) {
      setImpact(null)
      setError(null)
      return
    }
    const handle = setTimeout(async () => {
      setLoading(true)
      setError(null)
      try {
        const res = await fetch(`/api/ops/jobs/${jobId}/co-preview`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            coLines: validLines.map((l) => ({
              productId: l.productId,
              qty: l.qty,
              type: l.type,
              substituteProductId: l.substituteProductId,
            })),
          }),
        })
        if (!res.ok) {
          const j = await res.json().catch(() => ({}))
          throw new Error(j?.error || `Preview failed (${res.status})`)
        }
        const data: ImpactResult = await res.json()
        setImpact(data)
      } catch (e: any) {
        setError(e?.message || 'Preview failed')
        setImpact(null)
      } finally {
        setLoading(false)
      }
    }, 250)
    return () => clearTimeout(handle)
  }, [jobId, open, validLines])

  const handleConfirm = async () => {
    if (!impact || validLines.length === 0) return
    setConfirming(true)
    try {
      await fetch(`/api/ops/jobs/${jobId}/co-preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          coLines: validLines.map((l) => ({
            productId: l.productId,
            qty: l.qty,
            type: l.type,
            substituteProductId: l.substituteProductId,
          })),
          confirm: true,
        }),
      })
      setConfirmedAt(new Date())
    } catch (e) {
      // non-fatal — the impact is already rendered
    } finally {
      setConfirming(false)
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex">
      <div
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
        aria-label="Close preview"
      />
      <div className="relative ml-auto h-full w-full max-w-3xl bg-white shadow-2xl flex flex-col">
        <div className="flex items-center justify-between p-5 border-b">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Preview Change Order</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              Read-only impact. Nothing is saved until a CO is formally submitted.
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-2xl leading-none px-2"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* Lines editor */}
          <div className="border rounded-lg">
            <div className="flex items-center justify-between px-3 py-2 border-b bg-gray-50">
              <span className="text-sm font-medium text-gray-700">CO Lines</span>
              <button
                onClick={addLine}
                className="text-xs bg-[#0f2a3e] text-white px-3 py-1 rounded hover:bg-[#143549]"
              >
                + Add line
              </button>
            </div>
            {lines.length === 0 && (
              <div className="p-5 text-sm text-gray-500 text-center">
                Add lines to preview material impact.
              </div>
            )}
            <div className="divide-y">
              {lines.map((l) => (
                <div key={l.clientId} className="p-3 grid grid-cols-12 gap-2 items-center">
                  <select
                    value={l.type}
                    onChange={(e) => updateLine(l.clientId, { type: e.target.value as CoLineType })}
                    className="col-span-2 border rounded px-2 py-1 text-sm"
                  >
                    <option value="ADD">Add</option>
                    <option value="REMOVE">Remove</option>
                    <option value="SUBSTITUTE">Substitute</option>
                  </select>
                  <div className="col-span-6">
                    <ProductPicker
                      products={products}
                      value={l.productId}
                      label={l.productLabel}
                      onSelect={(p) =>
                        updateLine(l.clientId, {
                          productId: p.id,
                          productLabel: `${p.sku} — ${p.name}`,
                        })
                      }
                      onSearch={setProductQuery}
                      placeholder="Select SKU..."
                    />
                    {l.type === 'SUBSTITUTE' && (
                      <div className="mt-2">
                        <ProductPicker
                          products={products}
                          value={l.substituteProductId || ''}
                          label={l.substituteLabel || ''}
                          onSelect={(p) =>
                            updateLine(l.clientId, {
                              substituteProductId: p.id,
                              substituteLabel: `${p.sku} — ${p.name}`,
                            })
                          }
                          onSearch={setProductQuery}
                          placeholder="Substitute with..."
                        />
                      </div>
                    )}
                  </div>
                  <input
                    type="number"
                    min={1}
                    value={l.qty}
                    onChange={(e) => updateLine(l.clientId, { qty: Number(e.target.value) })}
                    className="col-span-2 border rounded px-2 py-1 text-sm text-right"
                    aria-label="Quantity"
                  />
                  <button
                    onClick={() => removeLine(l.clientId)}
                    className="col-span-2 text-xs text-gray-500 hover:text-red-600"
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Impact preview */}
          {error && (
            <div className="bg-red-50 border border-red-200 rounded p-3 text-sm text-red-700">
              {error}
            </div>
          )}

          {impact && (
            <div className="space-y-3">
              <div
                className={`border rounded-lg p-4 ${OVERALL_STYLES[impact.overallImpact]}`}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-wider">
                      {impact.overallImpact.replace(/_/g, ' ')}
                    </div>
                    <div className="text-sm mt-1">{impact.summary}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs text-gray-600">Net value change</div>
                    <div className="text-lg font-bold tabular-nums">
                      {fmtUsd(impact.totalNewValue)}
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-3 mt-3 text-xs">
                  <div>
                    <div className="text-gray-600">Current target</div>
                    <div className="font-semibold">{fmtDate(impact.scheduledDate)}</div>
                  </div>
                  <div>
                    <div className="text-gray-600">New completion</div>
                    <div className="font-semibold">{fmtDate(impact.newCompletionDate)}</div>
                  </div>
                  <div>
                    <div className="text-gray-600">Days shifted</div>
                    <div className="font-semibold">{impact.daysShifted}</div>
                  </div>
                </div>
              </div>

              <div className="border rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-xs text-gray-600 uppercase">
                    <tr>
                      <th className="text-left px-3 py-2">Line</th>
                      <th className="text-right px-3 py-2">Qty</th>
                      <th className="text-right px-3 py-2">Stock/Inc/New</th>
                      <th className="text-right px-3 py-2">Days to shelf</th>
                      <th className="text-left px-3 py-2">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {impact.lines.map((l, i) => (
                      <tr key={`${l.productId}-${i}`}>
                        <td className="px-3 py-2">
                          <div className="font-mono text-xs text-gray-500">{l.sku || '—'}</div>
                          <div className="text-sm text-gray-900">
                            {l.input.type}
                            {l.substitute && (
                              <span className="text-gray-500">
                                {' '}
                                → {l.substitute.sku || l.substitute.productId}
                              </span>
                            )}
                          </div>
                          {l.reason && (
                            <div className="text-xs text-gray-500 mt-0.5">{l.reason}</div>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">{l.input.qty}</td>
                        <td className="px-3 py-2 text-right text-xs tabular-nums">
                          {l.sourcing.fromStock}/{l.sourcing.fromIncoming}/{l.sourcing.fromNewPO}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {l.daysToShelf == null ? '—' : l.daysToShelf + 'd'}
                        </td>
                        <td className="px-3 py-2">
                          <span
                            className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
                              LINE_TONE[l.status] || 'bg-gray-50 text-gray-700'
                            }`}
                          >
                            {LINE_STATUS_LABEL[l.status] || l.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {loading && (
            <div className="text-xs text-gray-500 italic">Recalculating impact...</div>
          )}
        </div>

        <div className="p-4 border-t bg-gray-50 flex items-center justify-between gap-3">
          <div className="text-xs text-gray-600">
            {confirmedAt
              ? `Preview confirmed ${confirmedAt.toLocaleTimeString()}`
              : 'Confirming logs a ChangeOrderPreview audit entry.'}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-100 rounded"
            >
              Cancel
            </button>
            <button
              onClick={handleConfirm}
              disabled={!impact || confirming || validLines.length === 0}
              className="px-4 py-1.5 text-sm bg-[#0f2a3e] text-white rounded hover:bg-[#143549] disabled:opacity-50"
            >
              {confirming ? 'Logging...' : 'Confirm preview'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// Small combobox — shows a search input + dropdown filtered against the
// loaded product list. Keeps the footprint tight; we're not pulling in a
// headless-ui dep just for one picker.
function ProductPicker({
  products,
  value,
  label,
  onSelect,
  onSearch,
  placeholder,
}: {
  products: ProductOption[]
  value: string
  label: string
  onSelect: (p: ProductOption) => void
  onSearch: (q: string) => void
  placeholder?: string
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState(label)

  useEffect(() => {
    setQuery(label)
  }, [label])

  const filtered = useMemo(() => {
    const q = query.toLowerCase()
    if (!q) return products.slice(0, 25)
    return products
      .filter((p) => p.sku.toLowerCase().includes(q) || p.name.toLowerCase().includes(q))
      .slice(0, 25)
  }, [query, products])

  return (
    <div className="relative">
      <input
        value={query}
        onChange={(e) => {
          setQuery(e.target.value)
          onSearch(e.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        placeholder={placeholder}
        className="w-full border rounded px-2 py-1 text-sm"
      />
      {open && filtered.length > 0 && (
        <div className="absolute left-0 right-0 top-full mt-1 bg-white border rounded shadow-lg max-h-60 overflow-y-auto z-10">
          {filtered.map((p) => (
            <button
              type="button"
              key={p.id}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                onSelect(p)
                setQuery(`${p.sku} — ${p.name}`)
                setOpen(false)
              }}
              className={`w-full text-left px-3 py-1.5 text-xs hover:bg-gray-50 ${
                value === p.id ? 'bg-gray-100' : ''
              }`}
            >
              <span className="font-mono text-gray-600">{p.sku}</span>
              <span className="ml-2 text-gray-900">{p.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
