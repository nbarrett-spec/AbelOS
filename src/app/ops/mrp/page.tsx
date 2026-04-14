'use client'

import { useCallback, useEffect, useState } from 'react'

interface Stockout {
  productId: string
  sku: string
  name: string
  category: string | null
  onHand: number
  committed: number
  safetyStock: number
  reorderQty: number
  totalDemand: number
  totalInbound: number
  endingBalance: number
  stockoutDate: string | null
  daysUntilStockout: number | null
  shortfallQty: number
  urgency: 'CRITICAL' | 'HIGH' | 'NORMAL' | 'LOW'
  preferredVendor: {
    vendorId: string
    name: string
    leadTimeDays: number | null
    vendorCost: number | null
    minOrderQty: number
  } | null
  drivingJobIds: string[]
  schedule: { date: string; demand: number; inbound: number; balance: number }[]
}

interface StockoutsResponse {
  asOf: string
  horizonDays: number
  leadBufferDays: number
  unscheduledJobCount: number
  summary: {
    total: number
    critical: number
    high: number
    normal: number
    low: number
    estimatedReorderValue: number
  }
  stockouts: Stockout[]
}

interface ProjectionProduct {
  productId: string
  sku: string
  name: string
  category: string | null
  onHand: number
  totalDemand: number
  totalInbound: number
  endingBalance: number
  stockoutDate: string | null
  daysUntilStockout: number | null
  schedule: { date: string; balance: number }[]
}

type Tab = 'stockouts' | 'projection' | 'about'

export default function MrpPage() {
  const [tab, setTab] = useState<Tab>('stockouts')
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<StockoutsResponse | null>(null)
  const [projectionData, setProjectionData] = useState<ProjectionProduct[]>([])
  const [setupRan, setSetupRan] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [genResult, setGenResult] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  // Run the idempotent setup once on mount
  useEffect(() => {
    fetch('/api/ops/mrp/setup', { method: 'POST' })
      .then(() => setSetupRan(true))
      .catch(() => setSetupRan(true))
  }, [])

  const loadStockouts = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/ops/mrp/stockouts')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json()
      setData(json)
    } catch (e: any) {
      setError(e?.message || 'Failed to load stockouts')
    } finally {
      setLoading(false)
    }
  }, [])

  const loadProjection = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/ops/mrp/projection')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json()
      setProjectionData(json.products || [])
    } catch (e: any) {
      setError(e?.message || 'Failed to load projection')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (tab === 'stockouts') loadStockouts()
    if (tab === 'projection') loadProjection()
  }, [tab, loadStockouts, loadProjection])

  const handleGenerateDrafts = async () => {
    setGenerating(true)
    setGenResult(null)
    try {
      const res = await fetch('/api/ops/mrp/draft-pos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`)
      setGenResult(
        `Created ${json.created} new MRP recommendation${json.created === 1 ? '' : 's'}` +
          (json.skipped ? ` (${json.skipped} already pending)` : '') +
          `. Estimated spend: $${(json.totalEstimatedSpend || 0).toLocaleString()}.`
      )
      // Refresh
      loadStockouts()
    } catch (e: any) {
      setGenResult(`Error: ${e?.message || 'failed'}`)
    } finally {
      setGenerating(false)
    }
  }

  const filteredStockouts = data?.stockouts.filter((s) => {
    if (!search) return true
    const q = search.toLowerCase()
    return (
      s.sku.toLowerCase().includes(q) ||
      s.name.toLowerCase().includes(q) ||
      (s.category || '').toLowerCase().includes(q)
    )
  })

  const filteredProjection = projectionData.filter((p) => {
    if (!search) return true
    const q = search.toLowerCase()
    return (
      p.sku.toLowerCase().includes(q) ||
      p.name.toLowerCase().includes(q) ||
      (p.category || '').toLowerCase().includes(q)
    )
  })

  return (
    <div className="p-6 max-w-[1600px] mx-auto">
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-3">
          <span>🎯</span>
          <span>MRP — Forward Demand Planning</span>
        </h1>
        <p className="text-gray-600 mt-2">
          Walks active jobs through BOM expansion to project a 90-day inventory
          balance per product. Surfaces stockouts before they happen and drafts POs
          to cover them.
        </p>
      </div>

      {data?.unscheduledJobCount && data.unscheduledJobCount > 0 ? (
        <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded text-sm text-amber-900">
          ⚠️ {data.unscheduledJobCount} active jobs have no scheduled date and were
          excluded from the projection. They&apos;re still consuming inventory but
          can&apos;t be time-phased.
        </div>
      ) : null}

      {/* Tab nav */}
      <div className="flex gap-2 mb-4 border-b border-gray-200">
        {(['stockouts', 'projection', 'about'] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              tab === t
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-600 hover:text-gray-900'
            }`}
          >
            {t === 'stockouts' && 'Stockouts'}
            {t === 'projection' && '90-Day Projection'}
            {t === 'about' && 'How it works'}
          </button>
        ))}
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded text-sm text-red-800">
          {error}
        </div>
      )}

      {tab === 'stockouts' && (
        <>
          {/* Summary cards */}
          {data?.summary && (
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
              <Card label="Total stockouts" value={String(data.summary.total)} accent="default" />
              <Card label="Critical (<7d)" value={String(data.summary.critical)} accent="red" />
              <Card label="High (<14d)" value={String(data.summary.high)} accent="orange" />
              <Card label="Normal (<30d)" value={String(data.summary.normal)} accent="yellow" />
              <Card
                label="Est. spend"
                value={`$${Math.round(data.summary.estimatedReorderValue).toLocaleString()}`}
                accent="default"
              />
            </div>
          )}

          {/* Action bar */}
          <div className="flex items-center justify-between gap-3 mb-4">
            <input
              type="text"
              placeholder="Search SKU, product, or category..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="flex-1 max-w-sm px-3 py-2 border border-gray-300 rounded text-sm"
            />
            <div className="flex gap-2">
              <button
                onClick={loadStockouts}
                disabled={loading}
                className="px-4 py-2 text-sm border border-gray-300 rounded hover:bg-gray-50"
              >
                {loading ? 'Refreshing…' : 'Refresh'}
              </button>
              <button
                onClick={handleGenerateDrafts}
                disabled={generating || !data?.stockouts.length}
                className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-400"
              >
                {generating ? 'Generating…' : 'Generate Draft POs'}
              </button>
            </div>
          </div>

          {genResult && (
            <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded text-sm text-green-800">
              {genResult}{' '}
              <a
                href="/ops/procurement-intelligence"
                className="underline font-medium"
              >
                Review in AI Procurement Brain →
              </a>
            </div>
          )}

          {/* Stockouts table */}
          <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="text-left px-3 py-2 font-medium text-gray-700">Urgency</th>
                    <th className="text-left px-3 py-2 font-medium text-gray-700">SKU</th>
                    <th className="text-left px-3 py-2 font-medium text-gray-700">Product</th>
                    <th className="text-right px-3 py-2 font-medium text-gray-700">On Hand</th>
                    <th className="text-right px-3 py-2 font-medium text-gray-700">Demand</th>
                    <th className="text-right px-3 py-2 font-medium text-gray-700">Inbound</th>
                    <th className="text-right px-3 py-2 font-medium text-gray-700">Ending</th>
                    <th className="text-left px-3 py-2 font-medium text-gray-700">Stocks Out</th>
                    <th className="text-left px-3 py-2 font-medium text-gray-700">Vendor</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredStockouts?.length === 0 && (
                    <tr>
                      <td colSpan={9} className="text-center py-8 text-gray-500">
                        {loading
                          ? 'Loading…'
                          : 'No stockouts projected. Inventory is healthy.'}
                      </td>
                    </tr>
                  )}
                  {filteredStockouts?.map((s) => (
                    <tr key={s.productId} className="border-b border-gray-100 hover:bg-gray-50">
                      <td className="px-3 py-2">
                        <UrgencyBadge urgency={s.urgency} />
                      </td>
                      <td className="px-3 py-2 font-mono text-xs">{s.sku}</td>
                      <td className="px-3 py-2">
                        <div className="font-medium text-gray-900">{s.name}</div>
                        <div className="text-xs text-gray-500">{s.category}</div>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{s.onHand}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-red-600">
                        −{s.totalDemand}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-green-600">
                        +{s.totalInbound}
                      </td>
                      <td
                        className={`px-3 py-2 text-right tabular-nums font-medium ${
                          s.endingBalance < 0 ? 'text-red-700' : 'text-gray-900'
                        }`}
                      >
                        {s.endingBalance}
                      </td>
                      <td className="px-3 py-2">
                        <div>{s.stockoutDate}</div>
                        <div className="text-xs text-gray-500">
                          in {s.daysUntilStockout}d
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        {s.preferredVendor ? (
                          <div>
                            <div className="font-medium">{s.preferredVendor.name}</div>
                            <div className="text-xs text-gray-500">
                              {s.preferredVendor.leadTimeDays
                                ? `${s.preferredVendor.leadTimeDays}d lead`
                                : 'lead unknown'}
                            </div>
                          </div>
                        ) : (
                          <span className="text-xs text-amber-600">No preferred vendor</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {tab === 'projection' && (
        <>
          <div className="mb-4">
            <input
              type="text"
              placeholder="Search SKU, product, or category..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full max-w-sm px-3 py-2 border border-gray-300 rounded text-sm"
            />
          </div>
          <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="text-left px-3 py-2 font-medium text-gray-700">SKU</th>
                    <th className="text-left px-3 py-2 font-medium text-gray-700">Product</th>
                    <th className="text-right px-3 py-2 font-medium text-gray-700">On Hand</th>
                    <th className="text-right px-3 py-2 font-medium text-gray-700">Demand</th>
                    <th className="text-right px-3 py-2 font-medium text-gray-700">Inbound</th>
                    <th className="text-right px-3 py-2 font-medium text-gray-700">90-day end</th>
                    <th className="text-left px-3 py-2 font-medium text-gray-700">Trajectory</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredProjection.length === 0 && (
                    <tr>
                      <td colSpan={7} className="text-center py-8 text-gray-500">
                        {loading ? 'Loading…' : 'No products with active demand or inbound.'}
                      </td>
                    </tr>
                  )}
                  {filteredProjection.slice(0, 200).map((p) => (
                    <tr key={p.productId} className="border-b border-gray-100 hover:bg-gray-50">
                      <td className="px-3 py-2 font-mono text-xs">{p.sku}</td>
                      <td className="px-3 py-2">
                        <div className="font-medium text-gray-900">{p.name}</div>
                        <div className="text-xs text-gray-500">{p.category}</div>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{p.onHand}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-red-600">
                        −{p.totalDemand}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-green-600">
                        +{p.totalInbound}
                      </td>
                      <td
                        className={`px-3 py-2 text-right tabular-nums font-medium ${
                          p.endingBalance < 0 ? 'text-red-700' : 'text-gray-900'
                        }`}
                      >
                        {p.endingBalance}
                      </td>
                      <td className="px-3 py-2">
                        <Sparkline schedule={p.schedule} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {filteredProjection.length > 200 && (
              <div className="px-3 py-2 text-xs text-gray-500 border-t border-gray-100">
                Showing first 200 of {filteredProjection.length}. Refine search to narrow.
              </div>
            )}
          </div>
        </>
      )}

      {tab === 'about' && (
        <div className="bg-white rounded-lg border border-gray-200 p-6 prose max-w-none">
          <h2>How MRP works</h2>
          <p>
            For each active job (status not in COMPLETE/CLOSED/CANCELLED) with a
            scheduled date, the system walks <code>Job → Order → OrderItem</code> and
            recursively expands each line through any matching <code>BomEntry</code>{' '}
            relationships (up to 4 levels deep). Components with no further BOM
            children are treated as terminal — they consume themselves.
          </p>
          <p>
            Demand is bucketed on{' '}
            <code>scheduledDate − leadBufferDays</code> (default 3) so material is
            on hand before install. Inbound supply comes from open Purchase Orders
            (status APPROVED, SENT_TO_VENDOR, PARTIALLY_RECEIVED) using{' '}
            <code>expectedDate</code> if set, otherwise <code>orderedAt + 14d</code>.
          </p>
          <p>
            For each product and each day in the horizon (default 90), we compute:
          </p>
          <pre className="bg-gray-50 p-3 rounded text-xs">
{`projected_balance(d) =
    onHand
  + Σ inbound(d') for d' ≤ d
  − Σ demand(d')  for d' ≤ d`}
          </pre>
          <p>
            A product <strong>stocks out</strong> on the first day where the
            projected balance falls below safety stock. The Generate Draft POs
            button writes <code>SmartPORecommendation</code> rows tagged{' '}
            <code>MRP_FORWARD</code> that show up in the existing AI Procurement
            Brain approval channel.
          </p>
          <p>
            A nightly cron at <code>/api/cron/mrp-nightly</code> runs the same
            projection, drafts new recommendations for new stockouts, and resolves
            stale recommendations whose stockout has been covered by a received PO.
          </p>
          <p className="text-xs text-gray-500">
            See <code>docs/MRP_SPEC.md</code> for the full architecture.
          </p>
        </div>
      )}
    </div>
  )
}

function Card({
  label,
  value,
  accent,
}: {
  label: string
  value: string
  accent: 'default' | 'red' | 'orange' | 'yellow' | 'green'
}) {
  const accentClasses = {
    default: 'bg-white border-gray-200',
    red: 'bg-red-50 border-red-200',
    orange: 'bg-orange-50 border-orange-200',
    yellow: 'bg-yellow-50 border-yellow-200',
    green: 'bg-green-50 border-green-200',
  }
  return (
    <div className={`p-3 rounded border ${accentClasses[accent]}`}>
      <div className="text-xs text-gray-600 uppercase tracking-wide">{label}</div>
      <div className="text-2xl font-bold text-gray-900 mt-1">{value}</div>
    </div>
  )
}

function UrgencyBadge({ urgency }: { urgency: 'CRITICAL' | 'HIGH' | 'NORMAL' | 'LOW' }) {
  const styles = {
    CRITICAL: 'bg-red-100 text-red-800 border-red-200',
    HIGH: 'bg-orange-100 text-orange-800 border-orange-200',
    NORMAL: 'bg-yellow-100 text-yellow-800 border-yellow-200',
    LOW: 'bg-gray-100 text-gray-700 border-gray-200',
  }
  return (
    <span
      className={`inline-block px-2 py-0.5 text-xs font-medium rounded border ${styles[urgency]}`}
    >
      {urgency}
    </span>
  )
}

function Sparkline({ schedule }: { schedule: { balance: number }[] }) {
  if (!schedule || schedule.length === 0) return null
  const max = Math.max(...schedule.map((s) => s.balance), 1)
  const min = Math.min(...schedule.map((s) => s.balance), 0)
  const range = max - min || 1
  const width = 120
  const height = 24
  const step = width / Math.max(schedule.length - 1, 1)
  const points = schedule
    .map((s, i) => {
      const x = i * step
      const y = height - ((s.balance - min) / range) * height
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
  const last = schedule[schedule.length - 1].balance
  const stroke = last < 0 ? '#dc2626' : '#2563eb'
  return (
    <svg width={width} height={height} className="inline-block">
      <polyline
        points={points}
        fill="none"
        stroke={stroke}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {min < 0 && (
        <line
          x1="0"
          y1={height - ((0 - min) / range) * height}
          x2={width}
          y2={height - ((0 - min) / range) * height}
          stroke="#fca5a5"
          strokeWidth="0.5"
          strokeDasharray="2 2"
        />
      )}
    </svg>
  )
}
