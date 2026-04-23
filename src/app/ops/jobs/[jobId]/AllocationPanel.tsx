'use client'

import { useEffect, useState } from 'react'

interface Allocation {
  id: string
  productId: string
  sku: string | null
  productName: string | null
  category: string | null
  quantity: number
  status: string
  allocationType: string
  allocatedBy: string | null
  notes: string | null
  allocatedAt: string | null
  releasedAt: string | null
  updatedAt: string | null
  onHand: number | null
  committed: number | null
  available: number | null
}

interface Summary {
  total: number
  reserved: number
  picked: number
  consumed: number
  backordered: number
  released: number
  shortLines: number
}

const STATUS_STYLES: Record<string, string> = {
  RESERVED: 'bg-blue-100 text-blue-800 border-blue-200',
  PICKED: 'bg-amber-100 text-amber-800 border-amber-200',
  CONSUMED: 'bg-green-100 text-green-800 border-green-200',
  BACKORDERED: 'bg-red-100 text-red-800 border-red-200',
  RELEASED: 'bg-gray-100 text-gray-600 border-gray-200',
}

export default function AllocationPanel({ jobId }: { jobId: string }) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [summary, setSummary] = useState<Summary | null>(null)
  const [allocations, setAllocations] = useState<Allocation[]>([])

  useEffect(() => {
    let ignore = false
    async function load() {
      try {
        setLoading(true)
        const r = await fetch(`/api/ops/jobs/${jobId}/allocations`)
        if (!r.ok) throw new Error('Failed to load allocations')
        const j = await r.json()
        if (ignore) return
        setSummary(j.summary ?? null)
        setAllocations(j.allocations ?? [])
        setError(null)
      } catch (e: any) {
        if (!ignore) setError(e?.message ?? 'error')
      } finally {
        if (!ignore) setLoading(false)
      }
    }
    if (jobId) load()
    return () => { ignore = true }
  }, [jobId])

  if (loading) {
    return (
      <div className="bg-white rounded-lg border p-6 text-sm text-gray-500">
        Loading allocation ledger...
      </div>
    )
  }

  if (error) {
    return (
      <div className="bg-white rounded-lg border p-6 text-sm text-red-600">
        {error}
      </div>
    )
  }

  if (!summary || summary.total === 0) {
    return (
      <div className="bg-white rounded-lg border p-6 text-sm text-gray-500">
        <div className="font-medium text-gray-700 mb-1">No allocation rows yet.</div>
        <div>
          Allocations are written when the Job enters <code className="bg-gray-100 px-1 rounded">READINESS_CHECK</code> or
          {' '}<code className="bg-gray-100 px-1 rounded">MATERIALS_LOCKED</code>, or when a Job is created with an Order attached.
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Summary row */}
      <div className="bg-white rounded-lg border p-5">
        <h3 className="text-sm font-semibold text-gray-900 mb-3">Allocation Ledger</h3>
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-3 text-sm">
          <SummaryStat label="Total" value={summary.total} />
          <SummaryStat label="Reserved" value={summary.reserved} tone="blue" />
          <SummaryStat label="Picked" value={summary.picked} tone="amber" />
          <SummaryStat label="Consumed" value={summary.consumed} tone="green" />
          <SummaryStat label="Backordered" value={summary.backordered} tone={summary.backordered > 0 ? 'red' : undefined} />
          <SummaryStat label="Released" value={summary.released} tone="gray" />
        </div>
        {summary.shortLines > 0 && (
          <div className="mt-3 text-xs text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">
            {summary.shortLines} line(s) short today. Consider a PO or reallocation.
          </div>
        )}
      </div>

      {/* Detail table */}
      <div className="bg-white rounded-lg border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b">
            <tr className="text-left text-xs font-medium text-gray-500 uppercase">
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2">SKU</th>
              <th className="px-4 py-2">Product</th>
              <th className="px-4 py-2">Qty</th>
              <th className="px-4 py-2">On Hand</th>
              <th className="px-4 py-2">Available</th>
              <th className="px-4 py-2">Allocated</th>
            </tr>
          </thead>
          <tbody>
            {allocations.map((a) => (
              <tr key={a.id} className="border-b last:border-0 hover:bg-gray-50">
                <td className="px-4 py-2">
                  <span className={`inline-block px-2 py-0.5 text-xs rounded border ${STATUS_STYLES[a.status] ?? 'bg-gray-100 text-gray-700 border-gray-200'}`}>
                    {a.status}
                  </span>
                </td>
                <td className="px-4 py-2 font-mono text-xs text-gray-700">
                  {a.sku ?? '—'}
                </td>
                <td className="px-4 py-2 text-gray-700">
                  <div className="truncate max-w-xs">{a.productName ?? a.productId}</div>
                  {a.category && <div className="text-xs text-gray-400">{a.category}</div>}
                </td>
                <td className="px-4 py-2 font-mono tabular-nums">{a.quantity}</td>
                <td className="px-4 py-2 font-mono tabular-nums text-gray-500">{a.onHand ?? '—'}</td>
                <td className="px-4 py-2 font-mono tabular-nums text-gray-500">{a.available ?? '—'}</td>
                <td className="px-4 py-2 text-xs text-gray-500">
                  {a.allocatedAt ? new Date(a.allocatedAt).toLocaleDateString() : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function SummaryStat({
  label,
  value,
  tone,
}: {
  label: string
  value: number
  tone?: 'blue' | 'amber' | 'green' | 'red' | 'gray'
}) {
  const toneClass =
    tone === 'blue' ? 'text-blue-700'
    : tone === 'amber' ? 'text-amber-700'
    : tone === 'green' ? 'text-green-700'
    : tone === 'red' ? 'text-red-700'
    : tone === 'gray' ? 'text-gray-500'
    : 'text-gray-900'

  return (
    <div>
      <div className="text-xs text-gray-500 uppercase tracking-wide">{label}</div>
      <div className={`text-xl font-mono tabular-nums font-semibold ${toneClass}`}>{value}</div>
    </div>
  )
}
