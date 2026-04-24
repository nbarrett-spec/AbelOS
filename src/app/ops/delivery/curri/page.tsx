'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Truck } from 'lucide-react'
import PageHeader from '@/components/ui/PageHeader'
import EmptyState from '@/components/ui/EmptyState'

interface CurriResponse {
  integrated: boolean
  deliveries: Array<{
    id: string
    deliveryNumber: string
    status: string
    curriBookingId: string
    curriTrackingUrl: string
    curriCost: number
    completedAt: string | null
    createdAt: string
    jobNumber?: string
  }>
  comparison: {
    inHouse: { count: number; avgCost: number; delivered: number; active: number }
    curri: { count: number; avgCost: number; delivered: number; active: number }
  }
  curriConfigured: boolean
  windowDays: number
}

export default function CurriDeliveriesPage() {
  const [data, setData] = useState<CurriResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/ops/delivery/curri?windowDays=30')
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const json = await res.json()
        if (!cancelled) setData(json)
      } catch (e: any) {
        if (!cancelled) setErr(e?.message || 'Failed to load')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className="min-h-screen bg-canvas p-6">
      <div className="max-w-6xl mx-auto">
        <PageHeader
          eyebrow="Delivery · Third-Party Overflow"
          title="Curri Deliveries"
          description="On-demand courier for out-of-area or overflow loads when in-house fleet is fully booked."
          actions={
            <Link
              href="/ops/delivery"
              className="px-4 py-2 rounded border border-border text-fg-muted hover:bg-surface hover:text-fg text-sm"
            >
              ← Delivery Center
            </Link>
          }
        />

        {data && !data.curriConfigured && (
          <div className="bg-amber-50 border-l-4 border-amber-500 p-5 mb-6 rounded-lg">
            <div className="text-amber-900 font-medium mb-1">Curri API key not set</div>
            <div className="text-amber-700 text-sm">
              Set <code className="bg-white px-1 py-0.5 rounded">CURRI_API_KEY</code> in Vercel env to enable
              quoting + booking. Historical Curri deliveries will still display below.
            </div>
          </div>
        )}

        {loading && <div className="bg-surface rounded-lg p-6 text-center text-fg-muted">Loading…</div>}

        {err && (
          <div className="bg-red-50 border-l-4 border-red-500 p-5 rounded-lg text-red-900">
            Error loading Curri data: {err}
          </div>
        )}

        {data && !loading && !err && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
              <div className="bg-surface rounded-lg shadow-sm border border-border p-4">
                <div className="text-xs uppercase tracking-[0.2em] text-fg-muted mb-2">In-House · 30d</div>
                <div className="text-3xl font-mono tabular-nums text-fg">{data.comparison.inHouse.count}</div>
                <div className="text-xs text-fg-muted mt-1">
                  {data.comparison.inHouse.delivered} delivered · {data.comparison.inHouse.active} active
                </div>
              </div>
              <div className="bg-surface rounded-lg shadow-sm border border-border p-4">
                <div className="text-xs uppercase tracking-[0.2em] text-fg-muted mb-2">Curri · 30d</div>
                <div className="text-3xl font-mono tabular-nums text-fg">{data.comparison.curri.count}</div>
                <div className="text-xs text-fg-muted mt-1">
                  {data.comparison.curri.delivered} delivered · {data.comparison.curri.active} active
                </div>
              </div>
              <div className="bg-surface rounded-lg shadow-sm border border-border p-4">
                <div className="text-xs uppercase tracking-[0.2em] text-fg-muted mb-2">Curri Avg Cost</div>
                <div className="text-3xl font-mono tabular-nums text-fg">
                  ${data.comparison.curri.avgCost.toFixed(0)}
                </div>
                <div className="text-xs text-fg-muted mt-1">per delivery</div>
              </div>
              <div className="bg-surface rounded-lg shadow-sm border border-border p-4">
                <div className="text-xs uppercase tracking-[0.2em] text-fg-muted mb-2">Total Curri Spend</div>
                <div className="text-3xl font-mono tabular-nums text-fg">
                  ${(data.comparison.curri.avgCost * data.comparison.curri.count).toFixed(0)}
                </div>
                <div className="text-xs text-fg-muted mt-1">last {data.windowDays}d</div>
              </div>
            </div>

            <div className="bg-surface rounded-lg shadow-sm border border-border overflow-hidden">
              <div className="p-4 border-b border-border">
                <h2 className="font-semibold text-fg">Recent Curri Deliveries</h2>
              </div>
              {data.deliveries.length === 0 ? (
                <EmptyState
                  icon={<Truck className="w-8 h-8 text-fg-subtle" />}
                  title="No deliveries scheduled"
                  description={`No Curri deliveries in the last ${data.windowDays} days.`}
                />
              ) : (
                <table className="w-full text-sm">
                  <thead className="bg-surface-muted text-xs uppercase tracking-[0.18em] text-fg-muted">
                    <tr>
                      <th className="text-left p-3">Delivery #</th>
                      <th className="text-left p-3">Job</th>
                      <th className="text-left p-3">Status</th>
                      <th className="text-right p-3">Cost</th>
                      <th className="text-left p-3">Tracking</th>
                      <th className="text-left p-3">Created</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.deliveries.map((d) => (
                      <tr key={d.id} className="border-t border-border hover:bg-row-hover">
                        <td className="p-3 font-mono text-xs">{d.deliveryNumber}</td>
                        <td className="p-3">{d.jobNumber || '—'}</td>
                        <td className="p-3 text-xs">{d.status}</td>
                        <td className="p-3 text-right font-mono tabular-nums">${(d.curriCost || 0).toFixed(2)}</td>
                        <td className="p-3">
                          {d.curriTrackingUrl ? (
                            <a href={d.curriTrackingUrl} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline text-xs">
                              Track ↗
                            </a>
                          ) : (
                            <span className="text-fg-subtle text-xs">—</span>
                          )}
                        </td>
                        <td className="p-3 text-xs text-fg-muted">{new Date(d.createdAt).toLocaleDateString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
