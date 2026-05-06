'use client'

import { useEffect, useState, useCallback } from 'react'
import PageHeader from '@/components/ui/PageHeader'
import { Card, CardBody } from '@/components/ui'
import { RefreshCw, Webhook } from 'lucide-react'

// ──────────────────────────────────────────────────────────────────────────
// Webhook Delivery Dashboard
//
// ADMIN-only. Reads /api/ops/admin/webhooks/stats and renders:
//   - Overview KPI strip (24h/7d totals, success rate, DLQ count)
//   - Per-provider breakdown table (received, success, failed, DLQ, latency)
//   - Recent failures list with click-to-detail JSON modal
//
// Layout enforces ADMIN_ROLES via the parent layout (StaffAuthGuard); this
// page just renders.
// ──────────────────────────────────────────────────────────────────────────

interface ProviderRow {
  provider: string
  total24h: number
  total7d: number
  success24h: number
  success7d: number
  failed24h: number
  failed7d: number
  deadLetter: number
  inFlight: number
  successRate24h: number | null
  successRate7d: number | null
  medianLatencyMs: number | null
}

interface Totals {
  total24h: number
  total7d: number
  success24h: number
  success7d: number
  failed24h: number
  failed7d: number
  deadLetter: number
  inFlight: number
  successRate24h: number | null
  successRate7d: number | null
}

interface FailureRow {
  id: string
  provider: string
  eventType: string | null
  status: string
  error: string | null
  retryCount: number
  maxRetries: number
  receivedAt: string
  lastAttemptAt: string | null
}

interface FailureDetail {
  id: string
  provider: string
  eventType: string | null
  payload: any | null
  retryCount: number
  status: string
}

interface StatsPayload {
  providers: ProviderRow[]
  totals: Totals
  recentFailures: FailureRow[]
  computedAt: string
}

function fmtAgo(iso: string | null): string {
  if (!iso) return '—'
  try {
    const diff = Date.now() - new Date(iso).getTime()
    if (diff < 60_000) return 'just now'
    const mins = Math.floor(diff / 60_000)
    if (mins < 60) return `${mins}m ago`
    const hrs = Math.floor(mins / 60)
    if (hrs < 24) return `${hrs}h ago`
    return `${Math.floor(hrs / 24)}d ago`
  } catch {
    return iso
  }
}

function fmtLatency(ms: number | null): string {
  if (ms == null) return '—'
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  return `${(ms / 60_000).toFixed(1)}m`
}

function fmtPct(n: number | null): string {
  if (n == null) return '—'
  return `${n.toFixed(1)}%`
}

function rateClass(n: number | null): string {
  if (n == null) return 'text-fg-subtle'
  if (n >= 99) return 'text-green-700'
  if (n >= 95) return 'text-amber-700'
  return 'text-red-700'
}

function statusBadge(status: string): JSX.Element {
  const map: Record<string, string> = {
    RECEIVED: 'bg-blue-100 text-blue-800',
    PROCESSED: 'bg-green-100 text-green-800',
    FAILED: 'bg-amber-100 text-amber-800',
    DEAD_LETTER: 'bg-red-100 text-red-800',
  }
  const cls = map[status] || 'bg-gray-100 text-gray-800'
  return (
    <span
      className={`inline-block px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide ${cls}`}
    >
      {status}
    </span>
  )
}

export default function AdminWebhooksDashboardPage() {
  const [data, setData] = useState<StatsPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [detail, setDetail] = useState<FailureDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/ops/admin/webhooks/stats', { cache: 'no-store' })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || `Failed: HTTP ${res.status}`)
      }
      const json = (await res.json()) as StatsPayload
      setData(json)
      setLastRefresh(new Date())
    } catch (e: any) {
      setError(e?.message || 'Failed to load webhook stats')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
    const t = setInterval(load, 60_000)
    return () => clearInterval(t)
  }, [load])

  async function openDetail(id: string) {
    setDetailLoading(true)
    try {
      const res = await fetch(`/api/admin/webhooks/${id}`, { cache: 'no-store' })
      if (res.ok) {
        const body = await res.json()
        setDetail(body.event)
      } else {
        const body = await res.json().catch(() => ({}))
        alert(`Failed to load detail: ${body.error || res.status}`)
      }
    } catch (e: any) {
      alert(`Failed to load detail: ${e?.message || e}`)
    } finally {
      setDetailLoading(false)
    }
  }

  const empty =
    !loading &&
    data != null &&
    data.providers.length === 0 &&
    data.recentFailures.length === 0

  return (
    <div className="space-y-5">
      <PageHeader
        title="Webhook Delivery"
        description="Inbound webhook health by provider — success rates, failures, dead-letter queue, and end-to-end latency. Auto-refreshes every 60s."
        crumbs={[
          { label: 'Ops', href: '/ops' },
          { label: 'Admin', href: '/ops/admin' },
          { label: 'Webhooks' },
        ]}
        actions={
          <div className="flex items-center gap-3">
            {lastRefresh && (
              <span className="text-[11px] text-fg-subtle font-mono tabular-nums hidden md:inline">
                Updated {lastRefresh.toLocaleTimeString()}
              </span>
            )}
            <button
              onClick={load}
              className="inline-flex items-center gap-2 h-8 px-3 rounded-md bg-brand text-fg-on-accent text-xs font-semibold hover:opacity-90 transition-opacity"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Refresh
            </button>
          </div>
        }
      />

      {error && (
        <Card>
          <CardBody>
            <div className="text-sm text-data-negative-fg">{error}</div>
          </CardBody>
        </Card>
      )}

      {loading && !data && (
        <div className="space-y-4 animate-pulse">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-24 bg-surface-muted rounded-lg" />
            ))}
          </div>
          <div className="h-72 bg-surface-muted rounded-lg" />
        </div>
      )}

      {data && empty && (
        <Card>
          <CardBody>
            <div className="text-center py-12 text-fg-subtle">
              <Webhook className="w-10 h-10 mx-auto mb-3 opacity-40" />
              <div className="text-sm font-medium">No webhook events yet</div>
              <p className="text-xs mt-1 max-w-md mx-auto">
                Once Stripe, InFlow, Hyphen, Gmail, Resend, or Twilio start
                pushing events, this dashboard will fill in. The WebhookEvent
                table is ready and indexed.
              </p>
            </div>
          </CardBody>
        </Card>
      )}

      {data && !empty && (
        <>
          {/* ── Overview KPIs ──────────────────────────────────────────── */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <KPI
              label="Events (24h)"
              value={data.totals.total24h.toLocaleString()}
              sub={`${data.totals.total7d.toLocaleString()} in 7d`}
              accent="brand"
            />
            <KPI
              label="Success Rate (24h)"
              value={fmtPct(data.totals.successRate24h)}
              sub={`7d: ${fmtPct(data.totals.successRate7d)}`}
              accent={
                (data.totals.successRate24h ?? 100) >= 99
                  ? 'positive'
                  : (data.totals.successRate24h ?? 100) >= 95
                    ? 'warning'
                    : 'negative'
              }
            />
            <KPI
              label="In Flight"
              value={data.totals.inFlight.toLocaleString()}
              sub="Received, awaiting processing"
              accent={data.totals.inFlight > 0 ? 'warning' : 'positive'}
            />
            <KPI
              label="Dead Letter Queue"
              value={data.totals.deadLetter.toLocaleString()}
              sub="Retries exhausted — operator action"
              accent={data.totals.deadLetter > 0 ? 'negative' : 'positive'}
            />
          </div>

          {/* ── Per-provider breakdown ─────────────────────────────────── */}
          <Card>
            <CardBody>
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h2 className="text-sm font-semibold text-fg">By Provider</h2>
                  <p className="text-xs text-fg-subtle mt-0.5">
                    Stripe, InFlow, Hyphen, Gmail, Resend, Twilio — counts over
                    last 24h and 7d, plus median end-to-end latency
                    (received → processed).
                  </p>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="bg-surface-muted">
                    <tr>
                      <Th>Provider</Th>
                      <Th align="right">Events 24h</Th>
                      <Th align="right">Events 7d</Th>
                      <Th align="right">Success 24h</Th>
                      <Th align="right">Success 7d</Th>
                      <Th align="right">Failed 24h</Th>
                      <Th align="right">DLQ</Th>
                      <Th align="right">In Flight</Th>
                      <Th align="right">Median Latency</Th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border-default">
                    {data.providers.length === 0 && (
                      <tr>
                        <td
                          colSpan={9}
                          className="px-4 py-8 text-center text-fg-subtle text-xs"
                        >
                          No events received yet.
                        </td>
                      </tr>
                    )}
                    {data.providers.map((p) => (
                      <tr key={p.provider} className="hover:bg-surface-muted/50">
                        <td className="px-3 py-2 font-medium text-fg">
                          {p.provider}
                        </td>
                        <td className="px-3 py-2 text-right text-fg tabular-nums">
                          {p.total24h.toLocaleString()}
                        </td>
                        <td className="px-3 py-2 text-right text-fg-muted tabular-nums">
                          {p.total7d.toLocaleString()}
                        </td>
                        <td
                          className={`px-3 py-2 text-right tabular-nums ${rateClass(p.successRate24h)}`}
                        >
                          {fmtPct(p.successRate24h)}
                        </td>
                        <td
                          className={`px-3 py-2 text-right tabular-nums ${rateClass(p.successRate7d)}`}
                        >
                          {fmtPct(p.successRate7d)}
                        </td>
                        <td
                          className={`px-3 py-2 text-right tabular-nums ${p.failed24h > 0 ? 'text-amber-700' : 'text-fg-subtle'}`}
                        >
                          {p.failed24h.toLocaleString()}
                        </td>
                        <td
                          className={`px-3 py-2 text-right tabular-nums ${p.deadLetter > 0 ? 'text-red-700 font-semibold' : 'text-fg-subtle'}`}
                        >
                          {p.deadLetter.toLocaleString()}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-fg-muted">
                          {p.inFlight.toLocaleString()}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-fg-muted">
                          {fmtLatency(p.medianLatencyMs)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardBody>
          </Card>

          {/* ── Recent failures ────────────────────────────────────────── */}
          <Card>
            <CardBody>
              <div className="mb-3">
                <h2 className="text-sm font-semibold text-fg">Recent Failures</h2>
                <p className="text-xs text-fg-subtle mt-0.5">
                  Last 20 FAILED + DEAD_LETTER events. Click a row for the raw
                  payload.
                </p>
              </div>
              {data.recentFailures.length === 0 ? (
                <div className="py-6 text-center text-xs text-fg-subtle">
                  No recent failures. Nothing to do.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead className="bg-surface-muted">
                      <tr>
                        <Th>Provider</Th>
                        <Th>Event Type</Th>
                        <Th>Status</Th>
                        <Th align="right">Retries</Th>
                        <Th>Last Attempt</Th>
                        <Th>Error</Th>
                        <Th></Th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border-default">
                      {data.recentFailures.map((f) => (
                        <tr
                          key={f.id}
                          className="hover:bg-surface-muted/50 cursor-pointer"
                          onClick={() => openDetail(f.id)}
                        >
                          <td className="px-3 py-2 font-medium text-fg">
                            {f.provider}
                          </td>
                          <td className="px-3 py-2 font-mono text-xs text-fg-muted">
                            {f.eventType || '—'}
                          </td>
                          <td className="px-3 py-2">{statusBadge(f.status)}</td>
                          <td className="px-3 py-2 text-right text-fg-muted tabular-nums">
                            {f.retryCount} / {f.maxRetries}
                          </td>
                          <td className="px-3 py-2 text-fg-muted">
                            {fmtAgo(f.lastAttemptAt || f.receivedAt)}
                          </td>
                          <td
                            className="px-3 py-2 text-xs text-red-700 max-w-md truncate"
                            title={f.error || ''}
                          >
                            {f.error || '—'}
                          </td>
                          <td className="px-3 py-2 text-right">
                            <span className="text-[11px] text-accent-fg">
                              View →
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardBody>
          </Card>
        </>
      )}

      {/* ── Detail modal ─────────────────────────────────────────────── */}
      {detail && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50"
          onClick={() => setDetail(null)}
        >
          <div
            className="bg-surface-default rounded-lg max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col border border-border-default"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-6 py-4 border-b border-border-default flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-fg">
                  {detail.provider}: {detail.eventType || 'event'}
                </h2>
                <div className="text-xs text-fg-subtle font-mono mt-1">
                  {detail.id} · {detail.status} · {detail.retryCount} retries
                </div>
              </div>
              <button
                onClick={() => setDetail(null)}
                className="text-fg-subtle hover:text-fg text-2xl leading-none"
              >
                ×
              </button>
            </div>
            <div className="flex-1 overflow-auto p-6">
              <pre className="text-xs bg-surface-muted p-4 rounded border border-border-default font-mono whitespace-pre-wrap break-all">
                {detail.payload
                  ? JSON.stringify(detail.payload, null, 2)
                  : '— No stored payload (event was received before payload capture was enabled) —'}
              </pre>
            </div>
          </div>
        </div>
      )}
      {detailLoading && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-40 pointer-events-none">
          <div className="text-fg-on-accent text-xs bg-fg/80 px-3 py-1.5 rounded">
            Loading...
          </div>
        </div>
      )}
    </div>
  )
}

// ── Local sub-components ────────────────────────────────────────────────

function Th({
  children,
  align = 'left',
}: {
  children?: React.ReactNode
  align?: 'left' | 'right'
}) {
  // Tailwind needs literal class names, not interpolated.
  const alignCls = align === 'right' ? 'text-right' : 'text-left'
  return (
    <th
      className={`px-3 py-2 ${alignCls} text-[10px] font-semibold text-fg-muted uppercase tracking-wide`}
    >
      {children}
    </th>
  )
}

type KpiAccent = 'brand' | 'positive' | 'warning' | 'negative'

function KPI({
  label,
  value,
  sub,
  accent,
}: {
  label: string
  value: string
  sub?: string
  accent: KpiAccent
}) {
  const accentMap: Record<KpiAccent, string> = {
    brand: 'text-fg',
    positive: 'text-green-700',
    warning: 'text-amber-700',
    negative: 'text-red-700',
  }
  return (
    <Card>
      <CardBody>
        <div className="text-[10px] uppercase tracking-wide font-semibold text-fg-subtle">
          {label}
        </div>
        <div
          className={`text-2xl font-bold mt-1 tabular-nums ${accentMap[accent]}`}
        >
          {value}
        </div>
        {sub && <div className="text-[11px] text-fg-subtle mt-1">{sub}</div>}
      </CardBody>
    </Card>
  )
}
