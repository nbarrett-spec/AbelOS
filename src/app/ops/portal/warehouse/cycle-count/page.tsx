'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'

interface BatchLine {
  id: string
  sku: string
  productId: string
  productName: string
  binLocation: string | null
  expectedQty: number
  liveOnHand: number | null
  countedQty: number | null
  variance: number | null
  status: 'PENDING' | 'COUNTED' | string
  countedAt: string | null
  countedByName: string | null
  notes: string | null
}

interface CurrentBatch {
  id: string
  weekStart: string
  status: 'OPEN' | 'CLOSED' | string
  assignedToId: string | null
  assignedToName: string | null
  totalSkus: number
  completedSkus: number
  discrepanciesFound: number
  createdAt: string
  closedAt: string | null
}

interface HistoryBatch {
  id: string
  weekStart: string
  status: string
  totalSkus: number
  completedSkus: number
  discrepanciesFound: number
  completionRate: number
  varianceDollars: number
  assignedToName: string | null
  createdAt: string
  closedAt: string | null
}

export default function CycleCountPage() {
  const [batch, setBatch] = useState<CurrentBatch | null>(null)
  const [lines, setLines] = useState<BatchLine[]>([])
  const [history, setHistory] = useState<HistoryBatch[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [savingLineId, setSavingLineId] = useState<string | null>(null)
  const [closing, setClosing] = useState(false)
  const [inputs, setInputs] = useState<Record<string, string>>({})
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [showHistory, setShowHistory] = useState(false)

  const loadAll = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const [curRes, histRes] = await Promise.all([
        fetch('/api/ops/warehouse/cycle-count/current'),
        fetch('/api/ops/warehouse/cycle-count/history'),
      ])
      if (curRes.ok) {
        const data = await curRes.json()
        setBatch(data.batch)
        setLines(data.lines || [])
      }
      if (histRes.ok) {
        const data = await histRes.json()
        setHistory(data.batches || [])
      }
    } catch (e: any) {
      setError('Failed to load cycle-count data')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadAll()
  }, [loadAll])

  const submitCount = async (line: BatchLine) => {
    const raw = inputs[line.id]
    const note = notes[line.id] ?? ''
    if (raw === undefined || raw === '') {
      setToast({ type: 'error', text: 'Enter a count first' })
      return
    }
    const countedQty = Number(raw)
    if (!Number.isFinite(countedQty) || countedQty < 0) {
      setToast({ type: 'error', text: 'Count must be a non-negative number' })
      return
    }
    setSavingLineId(line.id)
    try {
      const res = await fetch(
        `/api/ops/warehouse/cycle-count/line/${line.id}/count`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ countedQty, notes: note || undefined }),
        }
      )
      if (res.ok) {
        const body = await res.json()
        setToast({
          type: 'success',
          text:
            body.variance === 0
              ? `${line.sku}: count matches (${countedQty})`
              : `${line.sku}: variance ${body.variance > 0 ? '+' : ''}${body.variance}`,
        })
        await loadAll()
      } else {
        const body = await res.json().catch(() => ({}))
        setToast({ type: 'error', text: body.error || 'Count failed' })
      }
    } catch {
      setToast({ type: 'error', text: 'Network error' })
    } finally {
      setSavingLineId(null)
    }
  }

  const closeBatch = async () => {
    if (!batch) return
    setClosing(true)
    try {
      const res = await fetch('/api/ops/warehouse/cycle-count/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ batchId: batch.id }),
      })
      if (res.ok) {
        setToast({ type: 'success', text: 'Batch closed — next drop lands Monday 6AM' })
        await loadAll()
      } else {
        const body = await res.json().catch(() => ({}))
        setToast({ type: 'error', text: body.error || 'Failed to close batch' })
      }
    } catch {
      setToast({ type: 'error', text: 'Network error' })
    } finally {
      setClosing(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#27AE60]" />
      </div>
    )
  }

  const pctDone =
    batch && batch.totalSkus > 0
      ? Math.round((batch.completedSkus / batch.totalSkus) * 100)
      : 0
  const canClose =
    !!batch &&
    batch.status === 'OPEN' &&
    batch.completedSkus >= batch.totalSkus &&
    batch.totalSkus > 0

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Cycle Count</h1>
          <p className="text-gray-600 mt-1">
            Weekly 20-SKU risk-weighted count sheet. New batch drops every Monday 6 AM CT.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setShowHistory((v) => !v)}
            className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 text-sm font-medium"
          >
            {showHistory ? 'Hide' : 'Show'} History
          </button>
          <Link
            href="/ops/portal/warehouse"
            className="px-4 py-2 bg-gray-200 text-gray-900 rounded-lg hover:bg-gray-300 text-sm font-medium"
          >
            Back to Warehouse
          </Link>
        </div>
      </div>

      {error && (
        <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-800 text-sm">
          {error}
        </div>
      )}
      {toast && (
        <div
          className={`p-3 rounded-lg text-sm font-medium ${
            toast.type === 'success'
              ? 'bg-green-50 text-green-800 border border-green-200'
              : 'bg-red-50 text-red-800 border border-red-200'
          }`}
        >
          {toast.text}
          <button
            onClick={() => setToast(null)}
            className="float-right text-lg leading-none"
            aria-label="dismiss"
          >
            &times;
          </button>
        </div>
      )}

      {!batch ? (
        <div className="bg-white rounded-xl border p-8 text-center text-gray-500">
          <p className="text-3xl mb-3">&#128203;</p>
          <p className="text-sm font-medium">No cycle-count batches yet</p>
          <p className="text-xs mt-1">
            The weekly scheduler will drop the first batch at the next Monday 6 AM CT tick.
          </p>
        </div>
      ) : (
        <>
          {/* Batch Summary */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="bg-white rounded-xl border border-l-4 border-l-[#27AE60] p-4">
              <p className="text-xs text-gray-500 uppercase tracking-wide">Week Of</p>
              <p className="text-xl font-bold text-gray-900 mt-1">
                {new Date(batch.weekStart).toLocaleDateString('en-US', {
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric',
                })}
              </p>
              <p className="text-xs text-gray-400 mt-1">
                {batch.status === 'OPEN' ? 'Active batch' : batch.status}
              </p>
            </div>
            <div className="bg-white rounded-xl border border-l-4 border-l-[#C6A24E] p-4">
              <p className="text-xs text-gray-500 uppercase tracking-wide">Progress</p>
              <p className="text-xl font-bold text-gray-900 mt-1">
                {batch.completedSkus}/{batch.totalSkus}
              </p>
              <div className="w-full bg-gray-200 rounded-full h-1.5 mt-2">
                <div
                  className="bg-[#27AE60] h-1.5 rounded-full transition-all"
                  style={{ width: `${pctDone}%` }}
                />
              </div>
            </div>
            <div className="bg-white rounded-xl border border-l-4 border-l-red-500 p-4">
              <p className="text-xs text-gray-500 uppercase tracking-wide">Discrepancies</p>
              <p className="text-xl font-bold text-gray-900 mt-1">
                {batch.discrepanciesFound}
              </p>
              <p className="text-xs text-gray-400 mt-1">Variance &ne; 0 lines</p>
            </div>
            <div className="bg-white rounded-xl border border-l-4 border-l-blue-500 p-4">
              <p className="text-xs text-gray-500 uppercase tracking-wide">Assigned</p>
              <p className="text-xl font-bold text-gray-900 mt-1">
                {batch.assignedToName || 'Unassigned'}
              </p>
              <p className="text-xs text-gray-400 mt-1">
                Created {new Date(batch.createdAt).toLocaleDateString()}
              </p>
            </div>
          </div>

          {/* Close batch */}
          {batch.status === 'OPEN' && (
            <div className="flex items-center justify-end">
              <button
                onClick={closeBatch}
                disabled={!canClose || closing}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  canClose
                    ? 'bg-[#27AE60] text-white hover:bg-[#229954]'
                    : 'bg-gray-200 text-gray-500 cursor-not-allowed'
                }`}
                title={
                  canClose
                    ? 'All lines counted — ready to close'
                    : `${batch.totalSkus - batch.completedSkus} line(s) remaining`
                }
              >
                {closing ? 'Closing...' : 'Close Batch'}
              </button>
            </div>
          )}

          {/* Lines */}
          <div className="bg-white rounded-xl border overflow-hidden">
            <div className="p-4 border-b flex items-center justify-between">
              <h2 className="text-lg font-bold text-gray-900">
                Count Sheet ({lines.length} SKUs)
              </h2>
              <div className="flex gap-2 text-xs">
                <span className="px-2 py-1 rounded bg-gray-100 text-gray-600">
                  Pending: {lines.filter((l) => l.status === 'PENDING').length}
                </span>
                <span className="px-2 py-1 rounded bg-green-100 text-green-700">
                  Counted: {lines.filter((l) => l.status === 'COUNTED').length}
                </span>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b text-xs text-gray-600 uppercase">
                  <tr>
                    <th className="px-4 py-3 text-left">SKU</th>
                    <th className="px-4 py-3 text-left">Product</th>
                    <th className="px-4 py-3 text-left">Bin</th>
                    <th className="px-4 py-3 text-right">Expected</th>
                    <th className="px-4 py-3 text-right">Live On-Hand</th>
                    <th className="px-4 py-3 text-right">Counted</th>
                    <th className="px-4 py-3 text-right">Variance</th>
                    <th className="px-4 py-3 text-left">Notes</th>
                    <th className="px-4 py-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line) => {
                    const isDone = line.status === 'COUNTED'
                    const variance = line.variance
                    const hasDrift = variance != null && variance !== 0
                    return (
                      <tr
                        key={line.id}
                        className={`border-b ${isDone ? 'bg-green-50/40' : ''}`}
                      >
                        <td className="px-4 py-3 font-mono font-medium text-gray-900">
                          {line.sku}
                        </td>
                        <td className="px-4 py-3 text-gray-700 max-w-xs truncate">
                          {line.productName}
                        </td>
                        <td className="px-4 py-3 text-gray-600">
                          {line.binLocation || <span className="text-gray-300">—</span>}
                        </td>
                        <td className="px-4 py-3 text-right text-gray-900 font-medium">
                          {line.expectedQty}
                        </td>
                        <td className="px-4 py-3 text-right text-gray-500 text-xs">
                          {line.liveOnHand ?? '—'}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {isDone ? (
                            <span className="font-semibold text-gray-900">
                              {line.countedQty}
                            </span>
                          ) : (
                            <input
                              type="number"
                              min="0"
                              step="1"
                              inputMode="numeric"
                              value={inputs[line.id] ?? ''}
                              onChange={(e) =>
                                setInputs((v) => ({ ...v, [line.id]: e.target.value }))
                              }
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') submitCount(line)
                              }}
                              className="w-24 border rounded px-2 py-1 text-right text-sm focus:outline-none focus:ring-2 focus:ring-[#27AE60]"
                              placeholder="qty"
                            />
                          )}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {variance == null ? (
                            <span className="text-gray-300">—</span>
                          ) : (
                            <span
                              className={`font-semibold ${
                                hasDrift
                                  ? variance < 0
                                    ? 'text-red-600'
                                    : 'text-yellow-600'
                                  : 'text-green-600'
                              }`}
                            >
                              {variance > 0 ? '+' : ''}
                              {variance}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {isDone ? (
                            <span className="text-xs text-gray-500 truncate block max-w-[180px]">
                              {line.notes || (
                                <span className="text-gray-300">—</span>
                              )}
                            </span>
                          ) : (
                            <input
                              type="text"
                              value={notes[line.id] ?? ''}
                              onChange={(e) =>
                                setNotes((v) => ({
                                  ...v,
                                  [line.id]: e.target.value,
                                }))
                              }
                              className="w-36 border rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-[#27AE60]"
                              placeholder="optional"
                            />
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {isDone ? (
                            <span className="text-xs text-green-700 font-medium">
                              {line.countedAt
                                ? new Date(line.countedAt).toLocaleTimeString([], {
                                    hour: 'numeric',
                                    minute: '2-digit',
                                  })
                                : 'Done'}
                              {line.countedByName && (
                                <span className="block text-gray-400 font-normal">
                                  {line.countedByName}
                                </span>
                              )}
                            </span>
                          ) : (
                            <button
                              onClick={() => submitCount(line)}
                              disabled={savingLineId === line.id}
                              className="px-3 py-1.5 bg-[#27AE60] text-white rounded-lg text-xs font-medium hover:bg-[#229954] disabled:opacity-50"
                            >
                              {savingLineId === line.id ? 'Saving...' : 'Submit'}
                            </button>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                  {lines.length === 0 && (
                    <tr>
                      <td colSpan={9} className="px-4 py-8 text-center text-gray-500">
                        No count lines in this batch
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* History */}
      {showHistory && (
        <div className="bg-white rounded-xl border overflow-hidden">
          <div className="p-4 border-b">
            <h2 className="text-lg font-bold text-gray-900">History (last 12 weeks)</h2>
            <p className="text-xs text-gray-500 mt-1">
              Discrepancy trend — watch for weeks where variance $ spikes.
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b text-xs text-gray-600 uppercase">
                <tr>
                  <th className="px-4 py-3 text-left">Week</th>
                  <th className="px-4 py-3 text-left">Status</th>
                  <th className="px-4 py-3 text-left">Assigned</th>
                  <th className="px-4 py-3 text-right">Completion</th>
                  <th className="px-4 py-3 text-right">Discrepancies</th>
                  <th className="px-4 py-3 text-right">Variance $</th>
                  <th className="px-4 py-3 text-left">Closed</th>
                </tr>
              </thead>
              <tbody>
                {history.map((h) => (
                  <tr key={h.id} className="border-b">
                    <td className="px-4 py-3 font-medium text-gray-900">
                      {new Date(h.weekStart).toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                      })}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`text-xs px-2 py-1 rounded font-medium ${
                          h.status === 'OPEN'
                            ? 'bg-yellow-100 text-yellow-800'
                            : 'bg-gray-100 text-gray-700'
                        }`}
                      >
                        {h.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      {h.assignedToName || '—'}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {h.completedSkus}/{h.totalSkus} (
                      {Math.round(h.completionRate * 100)}%)
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span
                        className={`font-medium ${
                          h.discrepanciesFound > 0
                            ? 'text-red-600'
                            : 'text-gray-500'
                        }`}
                      >
                        {h.discrepanciesFound}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span
                        className={
                          h.varianceDollars > 0 ? 'text-red-600' : 'text-gray-500'
                        }
                      >
                        ${h.varianceDollars.toFixed(2)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500">
                      {h.closedAt
                        ? new Date(h.closedAt).toLocaleDateString()
                        : '—'}
                    </td>
                  </tr>
                ))}
                {history.length === 0 && (
                  <tr>
                    <td
                      colSpan={7}
                      className="px-4 py-8 text-center text-gray-500 text-sm"
                    >
                      No historical batches yet
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
