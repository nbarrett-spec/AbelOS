'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { PageHeader, Card, CardBody, Badge, KPICard } from '@/components/ui'
import { AlertTriangle, Send, Filter, Check, X, ExternalLink, RefreshCw } from 'lucide-react'

interface SourceJob {
  id: string
  jobNumber: string | null
  builderName: string | null
  community: string | null
  scheduledDate: string | null
}

interface Recommendation {
  id: string
  vendorId: string
  vendorName: string | null
  vendorCode: string | null
  productId: string | null
  sku: string | null
  productName: string | null
  productCategory: string | null
  recommendationType: string
  urgency: 'CRITICAL' | 'HIGH' | 'NORMAL' | 'LOW' | string
  triggerReason: string
  recommendedQty: number
  estimatedCost: number
  targetDeliveryDate: string | null
  orderByDate: string | null
  aiReasoning: string | null
  sourceJobs: SourceJob[]
  soonestJobDate: string | null
  createdAt: string
}

interface SummaryShape {
  total: number
  totalCost: number
  byUrgency: Record<string, { count: number; totalCost: number }>
}

const urgencyOrder = ['CRITICAL', 'HIGH', 'NORMAL', 'LOW']

function fmt$(v: any): string {
  const n = Number(v)
  if (isNaN(n)) return '$0'
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(n)
}

function daysUntil(iso: string | null): number | null {
  if (!iso) return null
  const diff = new Date(iso).getTime() - Date.now()
  return Math.floor(diff / 86400000)
}

function urgencyVariant(u: string): 'danger' | 'warning' | 'info' | 'neutral' {
  if (u === 'CRITICAL') return 'danger'
  if (u === 'HIGH') return 'warning'
  if (u === 'NORMAL') return 'info'
  return 'neutral'
}

export default function SmartPOQueuePage() {
  const [recs, setRecs] = useState<Recommendation[]>([])
  const [summary, setSummary] = useState<SummaryShape | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [sending, setSending] = useState(false)
  const [vendorFilter, setVendorFilter] = useState('')
  const [severityFilter, setSeverityFilter] = useState('')
  const [builderFilter, setBuilderFilter] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const qs = new URLSearchParams()
      if (vendorFilter) qs.set('vendorId', vendorFilter)
      if (severityFilter) qs.set('severity', severityFilter)
      if (builderFilter) qs.set('builderName', builderFilter)
      const res = await fetch(`/api/ops/purchasing/smart-po?${qs.toString()}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json()
      setRecs(json.recommendations || [])
      setSummary(json.summary || null)
    } catch (e: any) {
      setError(e?.message || String(e))
    } finally {
      setLoading(false)
    }
  }, [vendorFilter, severityFilter, builderFilter])

  useEffect(() => {
    load()
  }, [load])

  const allSelected = useMemo(
    () => recs.length > 0 && recs.every((r) => selected.has(r.id)),
    [recs, selected]
  )

  function toggleAll() {
    if (allSelected) setSelected(new Set())
    else setSelected(new Set(recs.map((r) => r.id)))
  }

  function toggleOne(id: string) {
    const next = new Set(selected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelected(next)
  }

  async function act(action: 'send_to_vendor' | 'approve' | 'reject') {
    if (selected.size === 0) return
    setSending(true)
    try {
      const res = await fetch('/api/ops/purchasing/smart-po', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ids: Array.from(selected) }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setSelected(new Set())
      await load()
    } catch (e: any) {
      setError(e?.message || String(e))
    } finally {
      setSending(false)
    }
  }

  const uniqueVendors = useMemo(() => {
    const m = new Map<string, string>()
    for (const r of recs) if (r.vendorId && !m.has(r.vendorId)) m.set(r.vendorId, r.vendorName || r.vendorId)
    return Array.from(m.entries())
  }, [recs])

  return (
    <div className="min-h-screen bg-bg">
      <PageHeader
        title="SmartPO Queue"
        description="ATP-driven PO recommendations. Sorted by earliest job scheduled date."
        crumbs={[
          { label: 'Ops', href: '/ops' },
          { label: 'Purchasing', href: '/ops/purchasing' },
          { label: 'SmartPO Queue' },
        ]}
        actions={
          <button
            onClick={load}
            className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-fg-subtle hover:text-fg"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        }
      />

      <div className="max-w-[1400px] mx-auto px-6 py-6 space-y-5">
        {/* KPIs */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <KPICard
            title="Critical"
            value={summary?.byUrgency?.CRITICAL?.count ?? 0}
            subtitle={fmt$(summary?.byUrgency?.CRITICAL?.totalCost || 0)}
            accent="danger"
            icon={<AlertTriangle className="w-4 h-4" />}
          />
          <KPICard
            title="High"
            value={summary?.byUrgency?.HIGH?.count ?? 0}
            subtitle={fmt$(summary?.byUrgency?.HIGH?.totalCost || 0)}
            accent="forecast"
          />
          <KPICard
            title="Normal"
            value={summary?.byUrgency?.NORMAL?.count ?? 0}
            subtitle={fmt$(summary?.byUrgency?.NORMAL?.totalCost || 0)}
            accent="accent"
          />
          <KPICard
            title="Total $ Queued"
            value={fmt$(summary?.totalCost || 0)}
            subtitle={`${summary?.total ?? 0} recommendations`}
            accent="brand"
          />
        </div>

        {/* Filters + bulk actions */}
        <Card>
          <CardBody>
            <div className="flex flex-wrap items-center gap-3">
              <Filter className="w-4 h-4 text-fg-subtle" />
              <select
                value={vendorFilter}
                onChange={(e) => setVendorFilter(e.target.value)}
                className="text-[12px] bg-bg border border-border rounded px-2 py-1"
              >
                <option value="">All vendors</option>
                {uniqueVendors.map(([id, name]) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </select>

              <select
                value={severityFilter}
                onChange={(e) => setSeverityFilter(e.target.value)}
                className="text-[12px] bg-bg border border-border rounded px-2 py-1"
              >
                <option value="">All severities</option>
                {urgencyOrder.map((u) => (
                  <option key={u} value={u}>
                    {u}
                  </option>
                ))}
              </select>

              <input
                type="text"
                placeholder="Builder name contains…"
                value={builderFilter}
                onChange={(e) => setBuilderFilter(e.target.value)}
                className="text-[12px] bg-bg border border-border rounded px-2 py-1 min-w-[180px]"
              />

              <div className="ml-auto flex items-center gap-2">
                <span className="text-[11px] text-fg-subtle">
                  {selected.size} selected
                </span>
                <button
                  onClick={() => act('reject')}
                  disabled={sending || selected.size === 0}
                  className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold rounded border border-border hover:bg-bg-subtle disabled:opacity-40"
                >
                  <X className="w-3.5 h-3.5" />
                  Reject
                </button>
                <button
                  onClick={() => act('approve')}
                  disabled={sending || selected.size === 0}
                  className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold rounded border border-border hover:bg-bg-subtle disabled:opacity-40"
                >
                  <Check className="w-3.5 h-3.5" />
                  Approve
                </button>
                <button
                  onClick={() => act('send_to_vendor')}
                  disabled={sending || selected.size === 0}
                  className="inline-flex items-center gap-1 px-3 py-1 text-[11px] font-semibold rounded bg-accent text-accent-fg hover:opacity-90 disabled:opacity-40"
                >
                  <Send className="w-3.5 h-3.5" />
                  Send to Vendor
                </button>
              </div>
            </div>
          </CardBody>
        </Card>

        {/* Error banner */}
        {error && (
          <Card>
            <CardBody>
              <div className="text-[12px] text-danger">Error: {error}</div>
            </CardBody>
          </Card>
        )}

        {/* Table */}
        <Card>
          <CardBody className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-[12px]">
                <thead className="bg-bg-subtle border-b border-border">
                  <tr className="text-left text-[11px] uppercase tracking-wider text-fg-subtle">
                    <th className="px-3 py-2 w-8">
                      <input
                        type="checkbox"
                        checked={allSelected}
                        onChange={toggleAll}
                        aria-label="Select all"
                      />
                    </th>
                    <th className="px-3 py-2">Severity</th>
                    <th className="px-3 py-2">Vendor</th>
                    <th className="px-3 py-2">SKU / Product</th>
                    <th className="px-3 py-2 font-mono text-right">Qty</th>
                    <th className="px-3 py-2 font-mono text-right">Est. Cost</th>
                    <th className="px-3 py-2">Required By</th>
                    <th className="px-3 py-2">Source Jobs</th>
                    <th className="px-3 py-2">Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {loading && recs.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="px-3 py-8 text-center text-fg-subtle">
                        Loading recommendations…
                      </td>
                    </tr>
                  ) : recs.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="px-3 py-8 text-center text-fg-subtle">
                        No pending SmartPO recommendations. The shortage-forecast cron will
                        populate this queue as it detects RED ATP lines.
                      </td>
                    </tr>
                  ) : (
                    recs.map((r) => {
                      const due = daysUntil(r.orderByDate)
                      return (
                        <tr
                          key={r.id}
                          className="border-t border-border hover:bg-bg-subtle"
                        >
                          <td className="px-3 py-2">
                            <input
                              type="checkbox"
                              checked={selected.has(r.id)}
                              onChange={() => toggleOne(r.id)}
                              aria-label={`Select ${r.sku}`}
                            />
                          </td>
                          <td className="px-3 py-2">
                            <Badge variant={urgencyVariant(r.urgency)} size="sm">
                              {r.urgency}
                            </Badge>
                          </td>
                          <td className="px-3 py-2">
                            <div className="font-medium">{r.vendorName || '—'}</div>
                            <div className="text-[10px] text-fg-subtle">
                              {r.vendorCode || r.vendorId.slice(0, 8)}
                            </div>
                          </td>
                          <td className="px-3 py-2">
                            <div className="font-medium">{r.sku || '—'}</div>
                            <div className="text-[10px] text-fg-subtle line-clamp-1">
                              {r.productName || ''}
                            </div>
                          </td>
                          <td className="px-3 py-2 font-mono text-right">
                            {r.recommendedQty.toLocaleString()}
                          </td>
                          <td className="px-3 py-2 font-mono text-right">
                            {fmt$(r.estimatedCost)}
                          </td>
                          <td className="px-3 py-2">
                            {r.orderByDate ? (
                              <>
                                <div className="font-mono">
                                  {new Date(r.orderByDate).toISOString().slice(0, 10)}
                                </div>
                                <div
                                  className={`text-[10px] ${
                                    due !== null && due < 3
                                      ? 'text-danger'
                                      : due !== null && due < 7
                                        ? 'text-warning'
                                        : 'text-fg-subtle'
                                  }`}
                                >
                                  {due === null ? '—' : due < 0 ? 'overdue' : `${due}d`}
                                </div>
                              </>
                            ) : (
                              '—'
                            )}
                          </td>
                          <td className="px-3 py-2">
                            <div className="flex flex-wrap gap-1">
                              {(r.sourceJobs || []).slice(0, 3).map((j) => (
                                <Link
                                  key={j.id}
                                  href={`/ops/jobs/${j.id}`}
                                  className="inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 border border-border rounded hover:bg-bg"
                                >
                                  {j.jobNumber || j.id.slice(0, 8)}
                                  <ExternalLink className="w-3 h-3" />
                                </Link>
                              ))}
                              {(r.sourceJobs?.length || 0) > 3 && (
                                <span className="text-[10px] text-fg-subtle">
                                  +{r.sourceJobs.length - 3} more
                                </span>
                              )}
                            </div>
                            {r.sourceJobs?.[0] && (
                              <div className="text-[10px] text-fg-subtle mt-0.5">
                                {r.sourceJobs[0].builderName}
                                {r.sourceJobs[0].community
                                  ? ` · ${r.sourceJobs[0].community}`
                                  : ''}
                              </div>
                            )}
                          </td>
                          <td className="px-3 py-2 max-w-[320px]">
                            <div className="line-clamp-2 text-fg-subtle">
                              {r.triggerReason}
                            </div>
                          </td>
                        </tr>
                      )
                    })
                  )}
                </tbody>
              </table>
            </div>
          </CardBody>
        </Card>
      </div>
    </div>
  )
}
