'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { PageHeader, Card, CardBody, Badge, KPICard, StatusDot } from '@/components/ui'
import { useLiveTopic } from '@/hooks/useLiveTopic'
import {
  Activity, AlertTriangle, CheckCircle2, Clock, Database,
  Inbox as InboxIcon, Link2, RefreshCw, TimerReset, Zap,
} from 'lucide-react'

// ─── Types mirrored from /api/ops/admin/health-metrics ────────────────────

type SignalColor = 'GREEN' | 'AMBER' | 'RED'
type Severity = 'P0' | 'P1' | 'P2'

interface HealthMetrics {
  atdateTime: string
  signals: {
    db: SignalColor
    inbox: SignalColor
    cascades: SignalColor
    integrations: SignalColor
  }
  db: {
    rowCounts: Record<string, number>
    orphans: {
      ordersWithoutJobs: number
      jobsWithoutPM: number
      deliveriesWithoutCompletedAt: number
      invoicesWithoutDueDate: number
    }
    drift: {
      orderSubtotalVsItems: number
      invoiceBalanceDueVsComputed: number
      inventoryOnOrderNegative: number
    }
  }
  inbox: {
    pendingTotal: number
    byRole: Record<string, number>
    byType: Record<string, number>
    oldestPendingAgeDays: number
    unassigned: number
  }
  cascades: {
    ordersAutoCreatingJobs: number
    invoicesAutoPaidOnPayment: number
    deliveriesSchedulingOnOrderFlip: number
  }
  crons: Array<{
    name: string
    schedule: string
    lastRunAt: string | null
    status: 'SUCCESS' | 'FAILURE' | 'RUNNING' | null
    lastDurationMs: number | null
    lastError: string | null
    successCount24h: number
    failureCount24h: number
  }>
  cronDrift: {
    orphaned: Array<{ name: string; lastRunAt: string | null; runs24h: number }>
    neverRun: Array<{ name: string; schedule: string }>
    stale: Array<{ name: string; schedule: string; lastRunAt: string; minutesSinceLastRun: number; expectedMaxGapMinutes: number }>
  }
  cronRegisteredCount: number
  integrations: Record<string, { lastSync: string | null; status: 'OK' | 'STALE' | 'ERROR' | 'PENDING'; provider?: string }>
  activity: {
    auditLastHour: number
    ordersCreatedLastHour: number
    paymentsReceivedLastHour: number
    invoicesIssuedLastHour: number
  }
  alerts: Array<{ severity: Severity; message: string; linkTo?: string }>
}

// ─── Integration freshness matrix (from /api/ops/admin/integrations-freshness)
type FreshnessStatus = 'green' | 'amber' | 'red' | 'not-wired'

interface IntegrationFreshness {
  key: string
  label: string
  description: string
  status: FreshnessStatus
  lastSyncAt: string | null
  lastSuccessAt: string | null
  secondarySignalAt: string | null
  signalSource: string
  cadenceMinutes: number | null
  nextExpectedAt: string | null
  minutesSinceLast: number | null
  cronName: string | null
  notes: string | null
}

interface FreshnessPayload {
  atdateTime: string
  summary: { green: number; amber: number; red: number; notWired: number }
  integrations: IntegrationFreshness[]
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function fmtAgo(iso: string | null): string {
  if (!iso) return '—'
  const diff = Date.now() - new Date(iso).getTime()
  if (diff < 60_000) return 'just now'
  const mins = Math.floor(diff / 60_000)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

function fmtDuration(ms: number | null): string {
  if (ms == null) return '—'
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  return `${(ms / 60_000).toFixed(1)}m`
}

function fmtUntil(iso: string | null): string {
  if (!iso) return '—'
  const diff = new Date(iso).getTime() - Date.now()
  if (diff <= 0) return 'now'
  const mins = Math.floor(diff / 60_000)
  if (mins < 1) return '<1m'
  if (mins < 60) return `${mins}m`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ${mins % 60}m`
  return `${Math.floor(hrs / 24)}d`
}

function freshnessTone(s: FreshnessStatus): 'success' | 'active' | 'alert' | 'offline' {
  if (s === 'green') return 'success'
  if (s === 'amber') return 'active'
  if (s === 'red') return 'alert'
  return 'offline'
}

function freshnessBadge(s: FreshnessStatus): 'success' | 'warning' | 'danger' | 'neutral' {
  if (s === 'green') return 'success'
  if (s === 'amber') return 'warning'
  if (s === 'red') return 'danger'
  return 'neutral'
}

function freshnessLabel(s: FreshnessStatus): string {
  if (s === 'green') return 'FRESH'
  if (s === 'amber') return 'STALE'
  if (s === 'red') return 'DEAD'
  return 'NOT WIRED'
}

function signalClasses(s: SignalColor): { bg: string; text: string; dot: string; ring: string } {
  if (s === 'RED') return { bg: 'bg-data-negative-bg', text: 'text-data-negative-fg', dot: 'bg-data-negative', ring: 'ring-data-negative/40' }
  if (s === 'AMBER') return { bg: 'bg-data-warning-bg', text: 'text-data-warning-fg', dot: 'bg-signal', ring: 'ring-signal/40' }
  return { bg: 'bg-data-positive-bg', text: 'text-data-positive-fg', dot: 'bg-data-positive', ring: 'ring-data-positive/40' }
}

function severityVariant(s: Severity): 'danger' | 'warning' | 'info' {
  return s === 'P0' ? 'danger' : s === 'P1' ? 'warning' : 'info'
}

// ─── Page ─────────────────────────────────────────────────────────────────

interface HyphenReviewCounts {
  total: number
  unmatched: number
  low: number
  medium: number
}

export default function SystemHealthPage() {
  const [data, setData] = useState<HealthMetrics | null>(null)
  const [freshness, setFreshness] = useState<FreshnessPayload | null>(null)
  const [hyphenCounts, setHyphenCounts] = useState<HyphenReviewCounts | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null)

  // Live wakeup — any tracked topic publishes, we re-fetch.
  const liveEvt = useLiveTopic(['orders', 'invoices', 'deliveries', 'pos', 'inbox'])

  const fetchData = useCallback(async () => {
    try {
      const [metricsRes, freshnessRes, hyphenRes] = await Promise.all([
        fetch('/api/ops/admin/health-metrics', { cache: 'no-store' }),
        fetch('/api/ops/admin/integrations-freshness', { cache: 'no-store' }),
        fetch('/api/ops/hyphen/unmatched?limit=1', { cache: 'no-store' }),
      ])
      if (!metricsRes.ok) throw new Error(`Failed: ${metricsRes.status}`)
      const json = (await metricsRes.json()) as HealthMetrics
      setData(json)
      if (freshnessRes.ok) {
        const f = (await freshnessRes.json()) as FreshnessPayload
        setFreshness(f)
      }
      if (hyphenRes.ok) {
        const h = await hyphenRes.json()
        setHyphenCounts(h.counts as HyphenReviewCounts)
      }
      setLastRefresh(new Date())
      setError(null)
    } catch (e: any) {
      setError(e?.message || 'Failed to load system health')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchData()
    const t = setInterval(fetchData, 30_000)
    return () => clearInterval(t)
  }, [fetchData])

  // Debounced live refresh — if a topic publishes, refetch once (after 2s).
  useEffect(() => {
    if (!liveEvt) return
    const t = setTimeout(fetchData, 2000)
    return () => clearTimeout(t)
  }, [liveEvt, fetchData])

  const alertsByPriority = useMemo(() => {
    const empty: { P0: HealthMetrics['alerts']; P1: HealthMetrics['alerts']; P2: HealthMetrics['alerts'] } = { P0: [], P1: [], P2: [] }
    if (!data) return empty
    return {
      P0: data.alerts.filter((a) => a.severity === 'P0'),
      P1: data.alerts.filter((a) => a.severity === 'P1'),
      P2: data.alerts.filter((a) => a.severity === 'P2'),
    }
  }, [data])

  if (loading && !data) {
    return (
      <div className="space-y-5 animate-pulse">
        <div className="h-20 bg-surface-muted rounded-lg" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-28 bg-surface-muted rounded-lg" />
          ))}
        </div>
        <div className="h-96 bg-surface-muted rounded-lg" />
      </div>
    )
  }

  if (error && !data) {
    return (
      <div className="space-y-5">
        <PageHeader
          title="System Health"
          description="One-glance operational health of Aegis."
          crumbs={[{ label: 'Ops', href: '/ops' }, { label: 'Admin', href: '/ops/admin' }, { label: 'System Health' }]}
        />
        <Card>
          <CardBody>
            <div className="text-sm text-data-negative-fg">{error}</div>
          </CardBody>
        </Card>
      </div>
    )
  }

  if (!data) return null

  return (
    <div className="space-y-5">
      <PageHeader
        title="System Health"
        description="Cascades, orphans, inbox backlog, integrations and crons — all in one place. Auto-refreshes every 30s."
        crumbs={[
          { label: 'Ops', href: '/ops' },
          { label: 'Admin', href: '/ops/admin' },
          { label: 'System Health' },
        ]}
        actions={
          <div className="flex items-center gap-3">
            {lastRefresh && (
              <span className="text-[11px] text-fg-subtle font-mono tabular-nums hidden md:inline">
                Updated {lastRefresh.toLocaleTimeString()}
              </span>
            )}
            <button
              onClick={fetchData}
              className="inline-flex items-center gap-2 h-8 px-3 rounded-md bg-brand text-fg-on-accent text-xs font-semibold hover:opacity-90 transition-opacity"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Refresh
            </button>
          </div>
        }
      />

      {/* ── Main grid: hero + drill-downs (col-span 3) + sidebar alerts (col-span 1) ── */}
      <div className="grid grid-cols-1 xl:grid-cols-4 gap-5">
        <div className="xl:col-span-3 space-y-5 min-w-0">
          {/* ── Hero strip — 4 signal cards ────────────────────── */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <SignalCard
              label="DB Integrity"
              signal={data.signals.db}
              icon={<Database className="w-4 h-4" />}
              primary={`${
                data.db.orphans.ordersWithoutJobs +
                data.db.orphans.jobsWithoutPM +
                data.db.orphans.deliveriesWithoutCompletedAt +
                data.db.orphans.invoicesWithoutDueDate
              } orphans`}
              secondary={`${
                data.db.drift.orderSubtotalVsItems +
                data.db.drift.invoiceBalanceDueVsComputed +
                data.db.drift.inventoryOnOrderNegative
              } drift rows`}
              href="/ops/admin/data-quality"
            />
            <SignalCard
              label="Inbox"
              signal={data.signals.inbox}
              icon={<InboxIcon className="w-4 h-4" />}
              primary={`${data.inbox.pendingTotal} pending`}
              secondary={`Oldest ${data.inbox.oldestPendingAgeDays}d · ${data.inbox.unassigned} unassigned`}
              href="/ops/inbox"
            />
            <SignalCard
              label="Cascades (24h)"
              signal={data.signals.cascades}
              icon={<Zap className="w-4 h-4" />}
              primary={`${
                data.cascades.ordersAutoCreatingJobs +
                data.cascades.invoicesAutoPaidOnPayment +
                data.cascades.deliveriesSchedulingOnOrderFlip
              } fired`}
              secondary={`${data.cascades.ordersAutoCreatingJobs} order→job · ${data.cascades.invoicesAutoPaidOnPayment} pay→inv`}
            />
            <SignalCard
              label="Integrations"
              signal={data.signals.integrations}
              icon={<Link2 className="w-4 h-4" />}
              primary={`${Object.values(data.integrations).filter((i) => i.status === 'OK').length} / ${Object.keys(data.integrations).length} OK`}
              secondary={`${Object.values(data.integrations).filter((i) => i.status === 'STALE').length} stale · ${Object.values(data.integrations).filter((i) => i.status === 'ERROR').length} error`}
              href="/ops/sync-health"
            />
          </div>

          {/* ── Live activity KPIs (last hour) ─────────────────── */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <KPICard
              title="Audit Events (1h)"
              value={data.activity.auditLastHour}
              accent="brand"
              icon={<Activity className="w-4 h-4" />}
            />
            <KPICard
              title="Orders Placed (1h)"
              value={data.activity.ordersCreatedLastHour}
              accent="accent"
              icon={<Activity className="w-4 h-4" />}
            />
            <KPICard
              title="Payments (1h)"
              value={data.activity.paymentsReceivedLastHour}
              accent="positive"
              icon={<Activity className="w-4 h-4" />}
            />
            <KPICard
              title="Invoices Issued (1h)"
              value={data.activity.invoicesIssuedLastHour}
              accent="forecast"
              icon={<Activity className="w-4 h-4" />}
            />
          </div>

          {/* ── Hyphen unmatched review ─────────────────────────── */}
          <Card>
            <CardBody>
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h2 className="text-sm font-semibold text-fg">Hyphen Documents — Unmatched</h2>
                  <p className="text-xs text-fg-subtle mt-0.5">
                    Scraped docs from the Hyphen portal that couldn't be confidently tied to a Job.
                  </p>
                </div>
                <Link
                  href="/ops/admin/hyphen-unmatched"
                  className="text-[11px] font-semibold text-accent-fg hover:underline"
                >
                  Review queue →
                </Link>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <KPICard
                  title="Needs review"
                  value={hyphenCounts?.total ?? 0}
                  accent={(hyphenCounts?.total || 0) > 0 ? 'danger' : 'neutral'}
                  icon={<AlertTriangle className="w-4 h-4" />}
                />
                <KPICard
                  title="Unmatched (no Job)"
                  value={hyphenCounts?.unmatched ?? 0}
                  accent={(hyphenCounts?.unmatched || 0) > 0 ? 'danger' : 'neutral'}
                  icon={<InboxIcon className="w-4 h-4" />}
                />
                <KPICard
                  title="Low confidence"
                  value={hyphenCounts?.low ?? 0}
                  accent="forecast"
                  icon={<InboxIcon className="w-4 h-4" />}
                />
                <KPICard
                  title="Medium confidence"
                  value={hyphenCounts?.medium ?? 0}
                  accent="accent"
                  icon={<InboxIcon className="w-4 h-4" />}
                />
              </div>
            </CardBody>
          </Card>

          {/* ── DB integrity + Inbox backlog side-by-side ─────── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <Card>
              <CardBody>
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h2 className="text-sm font-semibold text-fg">DB Integrity</h2>
                    <p className="text-xs text-fg-subtle mt-0.5">Orphan counts and drift checks</p>
                  </div>
                  <Link href="/ops/admin/data-quality" className="text-[11px] font-semibold text-accent-fg hover:underline">
                    Open data-repair →
                  </Link>
                </div>
                <div className="space-y-3">
                  <MetricRow
                    label="Orders without linked Job"
                    value={data.db.orphans.ordersWithoutJobs}
                    tone={data.db.orphans.ordersWithoutJobs > 10 ? 'negative' : data.db.orphans.ordersWithoutJobs > 0 ? 'warning' : 'ok'}
                    href="/ops/admin/data-quality"
                  />
                  <MetricRow
                    label="Active jobs without PM"
                    value={data.db.orphans.jobsWithoutPM}
                    tone={data.db.orphans.jobsWithoutPM > 20 ? 'negative' : data.db.orphans.jobsWithoutPM > 0 ? 'warning' : 'ok'}
                    href="/ops/jobs?filter=unassigned"
                  />
                  <MetricRow
                    label="Deliveries COMPLETE w/o completedAt"
                    value={data.db.orphans.deliveriesWithoutCompletedAt}
                    tone={data.db.orphans.deliveriesWithoutCompletedAt > 0 ? 'warning' : 'ok'}
                    href="/ops/delivery"
                  />
                  <MetricRow
                    label="Issued invoices missing dueDate"
                    value={data.db.orphans.invoicesWithoutDueDate}
                    tone={data.db.orphans.invoicesWithoutDueDate > 0 ? 'warning' : 'ok'}
                    href="/ops/invoices"
                  />
                  <div className="border-t border-border pt-3" />
                  <MetricRow
                    label="Order subtotal vs line-items (>$1 drift)"
                    value={data.db.drift.orderSubtotalVsItems}
                    tone={data.db.drift.orderSubtotalVsItems > 50 ? 'negative' : data.db.drift.orderSubtotalVsItems > 0 ? 'warning' : 'ok'}
                    href="/ops/admin/data-quality"
                  />
                  <MetricRow
                    label="Invoice balanceDue mismatch"
                    value={data.db.drift.invoiceBalanceDueVsComputed}
                    tone={data.db.drift.invoiceBalanceDueVsComputed > 0 ? 'negative' : 'ok'}
                    href="/ops/admin/data-quality"
                  />
                  <MetricRow
                    label="Inventory onOrder negative"
                    value={data.db.drift.inventoryOnOrderNegative}
                    tone={data.db.drift.inventoryOnOrderNegative > 0 ? 'warning' : 'ok'}
                    href="/ops/inventory"
                  />
                </div>
              </CardBody>
            </Card>

            <Card>
              <CardBody>
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h2 className="text-sm font-semibold text-fg">Inbox Backlog</h2>
                    <p className="text-xs text-fg-subtle mt-0.5">
                      {data.inbox.pendingTotal} pending · oldest {data.inbox.oldestPendingAgeDays}d
                    </p>
                  </div>
                  <Link href="/ops/inbox" className="text-[11px] font-semibold text-accent-fg hover:underline">
                    Open inbox →
                  </Link>
                </div>

                <div className="mb-4">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-fg-subtle mb-2">
                    By role
                  </div>
                  <div className="space-y-1.5">
                    {Object.entries(data.inbox.byRole).length === 0 && (
                      <div className="text-xs text-fg-subtle italic">No pending items</div>
                    )}
                    {Object.entries(data.inbox.byRole)
                      .sort((a, b) => b[1] - a[1])
                      .slice(0, 8)
                      .map(([role, n]) => (
                        <InboxRoleRow key={role} role={role} count={n} total={data.inbox.pendingTotal} />
                      ))}
                  </div>
                </div>

                <div>
                  <div className="text-[10px] font-bold uppercase tracking-wider text-fg-subtle mb-2">
                    By type
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {Object.entries(data.inbox.byType).length === 0 && (
                      <div className="text-xs text-fg-subtle italic">—</div>
                    )}
                    {Object.entries(data.inbox.byType)
                      .sort((a, b) => b[1] - a[1])
                      .slice(0, 10)
                      .map(([type, n]) => (
                        <Badge key={type} variant="neutral" size="sm">
                          {type} · {n}
                        </Badge>
                      ))}
                  </div>
                </div>
              </CardBody>
            </Card>
          </div>

          {/* ── Cascade activity ───────────────────────────────── */}
          <Card>
            <CardBody>
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h2 className="text-sm font-semibold text-fg">Cascade Activity (Last 24h)</h2>
                  <p className="text-xs text-fg-subtle mt-0.5">
                    Are the auto-wiring cascades firing? A zero here during business hours is a red flag.
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <CascadeTile
                  label="Order → Job"
                  description="Confirmed orders auto-creating Job rows"
                  value={data.cascades.ordersAutoCreatingJobs}
                />
                <CascadeTile
                  label="Payment → Invoice PAID"
                  description="Invoices flipped PAID after Payment"
                  value={data.cascades.invoicesAutoPaidOnPayment}
                />
                <CascadeTile
                  label="Order → Delivery"
                  description="Deliveries scheduled on order flip"
                  value={data.cascades.deliveriesSchedulingOnOrderFlip}
                />
              </div>
            </CardBody>
          </Card>

          {/* ── Cron runs table ────────────────────────────────── */}
          <Card>
            <CardBody>
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h2 className="text-sm font-semibold text-fg">Cron Runs</h2>
                  <p className="text-xs text-fg-subtle mt-0.5">
                    {data.cronRegisteredCount} registered jobs ·{' '}
                    {data.cronDrift.stale.length > 0 && (
                      <span className="text-data-negative-fg font-semibold">
                        {data.cronDrift.stale.length} stale
                      </span>
                    )}
                    {data.cronDrift.stale.length > 0 && data.cronDrift.neverRun.length > 0 && ' · '}
                    {data.cronDrift.neverRun.length > 0 && (
                      <span className="text-data-warning-fg font-semibold">
                        {data.cronDrift.neverRun.length} never run
                      </span>
                    )}
                  </p>
                </div>
                <Link href="/ops/admin/crons" className="text-[11px] font-semibold text-accent-fg hover:underline">
                  Open cron logs →
                </Link>
              </div>
              <div className="overflow-auto -mx-2 md:mx-0 max-h-[480px]">
                <table className="min-w-full text-sm">
                  <thead className="sticky top-0 bg-surface z-10">
                    <tr className="border-b border-border">
                      <th className="px-3 py-2 text-left text-[10px] font-bold uppercase tracking-wider text-fg-subtle">Name</th>
                      <th className="px-3 py-2 text-left text-[10px] font-bold uppercase tracking-wider text-fg-subtle">Schedule</th>
                      <th className="px-3 py-2 text-left text-[10px] font-bold uppercase tracking-wider text-fg-subtle">Status</th>
                      <th className="px-3 py-2 text-left text-[10px] font-bold uppercase tracking-wider text-fg-subtle">Last Run</th>
                      <th className="px-3 py-2 text-left text-[10px] font-bold uppercase tracking-wider text-fg-subtle">Duration</th>
                      <th className="px-3 py-2 text-left text-[10px] font-bold uppercase tracking-wider text-fg-subtle">24h S/F</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.crons.slice(0, 30).map((c) => (
                      <tr key={c.name} className="border-b border-border/50 hover:bg-surface-muted">
                        <td className="px-3 py-2 text-xs font-mono font-semibold text-fg">{c.name}</td>
                        <td className="px-3 py-2 text-xs text-fg-muted font-mono">{c.schedule}</td>
                        <td className="px-3 py-2">
                          <CronStatusBadge status={c.status} />
                        </td>
                        <td className="px-3 py-2 text-xs text-fg-muted">{fmtAgo(c.lastRunAt)}</td>
                        <td className="px-3 py-2 text-xs text-fg-muted font-mono tabular-nums">{fmtDuration(c.lastDurationMs)}</td>
                        <td className="px-3 py-2 text-xs font-mono tabular-nums">
                          <span className="text-data-positive-fg">{c.successCount24h}</span>
                          {' / '}
                          <span className={c.failureCount24h > 0 ? 'text-data-negative-fg font-semibold' : 'text-fg-subtle'}>
                            {c.failureCount24h}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardBody>
          </Card>

          {/* ── Integration freshness ──────────────────────────── */}
          <Card>
            <CardBody>
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h2 className="text-sm font-semibold text-fg">Integration Freshness</h2>
                  <p className="text-xs text-fg-subtle mt-0.5">
                    {freshness
                      ? `${freshness.summary.green} fresh · ${freshness.summary.amber} stale · ${freshness.summary.red} dead · ${freshness.summary.notWired} not wired`
                      : 'Last successful sync per provider'}
                  </p>
                </div>
                <Link href="/ops/sync-health" className="text-[11px] font-semibold text-accent-fg hover:underline">
                  Open sync health →
                </Link>
              </div>

              {freshness ? (
                <FreshnessMatrix rows={freshness.integrations} />
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                  {Object.entries(data.integrations).map(([key, intg]) => (
                    <IntegrationTile key={key} name={key} intg={intg} />
                  ))}
                </div>
              )}
            </CardBody>
          </Card>
        </div>

        {/* ── Right sidebar: alerts ─────────────────────────────── */}
        <div className="xl:col-span-1 xl:sticky xl:top-20 xl:self-start">
          <Card>
            <CardBody>
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold text-fg flex items-center gap-1.5">
                  <AlertTriangle className="w-4 h-4 text-signal" />
                  Alerts
                </h2>
                <Badge variant={data.alerts.length === 0 ? 'success' : data.alerts.some((a) => a.severity === 'P0') ? 'danger' : 'warning'} size="sm">
                  {data.alerts.length}
                </Badge>
              </div>

              {data.alerts.length === 0 ? (
                <div className="flex items-center gap-2 text-xs text-data-positive-fg">
                  <CheckCircle2 className="w-4 h-4" />
                  All systems green — no alerts.
                </div>
              ) : (
                <div className="space-y-4">
                  {(['P0', 'P1', 'P2'] as Severity[]).map((sev) => {
                    const items = alertsByPriority[sev]
                    if (items.length === 0) return null
                    return (
                      <div key={sev}>
                        <div className="text-[10px] font-bold uppercase tracking-wider text-fg-subtle mb-1.5 flex items-center gap-1.5">
                          <Badge variant={severityVariant(sev)} size="xs">{sev}</Badge>
                          <span>{items.length} item{items.length === 1 ? '' : 's'}</span>
                        </div>
                        <div className="space-y-1.5">
                          {items.map((a, i) => (
                            <AlertItem key={`${sev}-${i}`} alert={a} />
                          ))}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </CardBody>
          </Card>

          {/* ── Row counts reference ─────────────────────────── */}
          <Card className="mt-5">
            <CardBody>
              <h2 className="text-sm font-semibold text-fg mb-3 flex items-center gap-1.5">
                <Database className="w-4 h-4 text-fg-subtle" />
                Row Counts
              </h2>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
                {Object.entries(data.db.rowCounts).map(([model, n]) => (
                  <div key={model} className="flex items-center justify-between">
                    <span className="text-fg-muted">{model}</span>
                    <span className="font-mono tabular-nums font-semibold text-fg">{n.toLocaleString()}</span>
                  </div>
                ))}
              </div>
            </CardBody>
          </Card>
        </div>
      </div>

      {/* Snapshot footer */}
      <div className="text-[11px] text-fg-subtle font-mono text-center pt-2">
        Snapshot: {new Date(data.atdateTime).toLocaleString()}
      </div>
    </div>
  )
}

// ─── Presentational sub-components ────────────────────────────────────────

function SignalCard({
  label,
  signal,
  icon,
  primary,
  secondary,
  href,
}: {
  label: string
  signal: SignalColor
  icon: React.ReactNode
  primary: string
  secondary: string
  href?: string
}) {
  const c = signalClasses(signal)
  const inner = (
    <Card className={`h-full ${href ? 'transition-transform hover:-translate-y-0.5' : ''}`}>
      <CardBody>
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-2 text-xs font-semibold text-fg-muted uppercase tracking-wider">
            <span className="text-fg-subtle">{icon}</span>
            {label}
          </div>
          <span
            className={`inline-flex items-center gap-1.5 text-[10px] font-mono font-bold uppercase px-2 py-0.5 rounded-full ring-1 ${c.bg} ${c.text} ${c.ring}`}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${c.dot}`} />
            {signal}
          </span>
        </div>
        <div className="text-2xl font-bold text-fg tabular-nums">{primary}</div>
        <div className="text-[11px] text-fg-subtle mt-1">{secondary}</div>
      </CardBody>
    </Card>
  )
  return href ? <Link href={href}>{inner}</Link> : inner
}

function MetricRow({
  label,
  value,
  tone,
  href,
}: {
  label: string
  value: number
  tone: 'ok' | 'warning' | 'negative'
  href?: string
}) {
  const toneClass =
    tone === 'negative'
      ? 'text-data-negative-fg font-semibold'
      : tone === 'warning'
        ? 'text-data-warning-fg font-semibold'
        : 'text-fg-muted'

  const inner = (
    <div className="flex items-center justify-between text-xs">
      <span className="text-fg-muted">{label}</span>
      <span className={`tabular-nums font-mono ${toneClass}`}>{value.toLocaleString()}</span>
    </div>
  )

  if (!href || value === 0) return inner
  return (
    <Link href={href} className="block rounded-sm hover:bg-surface-muted -mx-1 px-1 py-0.5 transition-colors">
      {inner}
    </Link>
  )
}

function InboxRoleRow({ role, count, total }: { role: string; count: number; total: number }) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0
  return (
    <Link
      href={role === 'UNASSIGNED' ? '/ops/inbox?filter=unassigned' : `/ops/inbox?role=${role}`}
      className="block"
    >
      <div className="flex items-center justify-between text-xs mb-1">
        <span className="text-fg-muted font-mono">{role}</span>
        <span className="font-mono tabular-nums font-semibold text-fg">{count}</span>
      </div>
      <div className="h-1.5 bg-surface-muted rounded-full overflow-hidden">
        <div
          className="h-full bg-brand rounded-full transition-[width]"
          style={{ width: `${Math.max(2, pct)}%` }}
        />
      </div>
    </Link>
  )
}

function CascadeTile({
  label,
  description,
  value,
}: {
  label: string
  description: string
  value: number
}) {
  const color = value === 0 ? 'text-data-negative-fg' : 'text-data-positive-fg'
  return (
    <div className="rounded-md border border-border bg-surface p-3">
      <div className="flex items-center gap-2 mb-2">
        <span className={`w-2 h-2 rounded-full ${value === 0 ? 'bg-data-negative' : 'bg-data-positive'}`} />
        <span className="text-xs font-semibold text-fg">{label}</span>
      </div>
      <div className={`text-2xl font-bold font-mono tabular-nums ${color}`}>{value}</div>
      <div className="text-[11px] text-fg-subtle mt-1">{description}</div>
    </div>
  )
}

function CronStatusBadge({ status }: { status: 'SUCCESS' | 'FAILURE' | 'RUNNING' | null }) {
  if (status === 'SUCCESS') return <Badge variant="success" size="xs">OK</Badge>
  if (status === 'FAILURE') return <Badge variant="danger" size="xs">FAIL</Badge>
  if (status === 'RUNNING') return <Badge variant="info" size="xs">RUN</Badge>
  return <Badge variant="neutral" size="xs">—</Badge>
}

function IntegrationTile({
  name,
  intg,
}: {
  name: string
  intg: { lastSync: string | null; status: 'OK' | 'STALE' | 'ERROR' | 'PENDING' }
}) {
  const variant = intg.status === 'OK' ? 'success' : intg.status === 'ERROR' ? 'danger' : intg.status === 'STALE' ? 'warning' : 'neutral'
  return (
    <div className="rounded-md border border-border bg-surface p-3">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-xs font-semibold text-fg uppercase">{name}</span>
        <Badge variant={variant} size="xs">{intg.status}</Badge>
      </div>
      <div className="flex items-center gap-1.5 text-[11px] text-fg-subtle">
        <Clock className="w-3 h-3" />
        <span className="font-mono tabular-nums">{intg.lastSync ? fmtAgo(intg.lastSync) : 'never'}</span>
      </div>
    </div>
  )
}

function FreshnessMatrix({ rows }: { rows: IntegrationFreshness[] }) {
  // Order: red → amber → not-wired → green. Surface the worst first.
  const order: FreshnessStatus[] = ['red', 'amber', 'not-wired', 'green']
  const sorted = [...rows].sort(
    (a, b) => order.indexOf(a.status) - order.indexOf(b.status),
  )

  return (
    <div className="divide-y divide-border rounded-md border border-border bg-surface">
      {sorted.map((r) => (
        <FreshnessRow key={r.key} row={r} />
      ))}
    </div>
  )
}

function FreshnessRow({ row }: { row: IntegrationFreshness }) {
  const tone = freshnessTone(row.status)
  const badgeVariant = freshnessBadge(row.status)
  const badgeLabel = freshnessLabel(row.status)
  const lastSyncLabel = row.lastSyncAt ? fmtAgo(row.lastSyncAt) : 'never'
  const showNext = row.status !== 'not-wired' && row.nextExpectedAt
  const cronHref = row.cronName ? `/ops/admin/crons?name=${row.cronName}` : undefined

  const content = (
    <div className="flex items-start gap-3 px-3 py-2.5 hover:bg-surface-muted transition-colors">
      <StatusDot tone={tone} size={8} className="mt-1.5" label={`${row.label} ${badgeLabel}`} />

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[13px] font-semibold text-fg">{row.label}</span>
          <Badge variant={badgeVariant} size="xs">
            {badgeLabel}
          </Badge>
          {row.cronName && (
            <span className="text-[10px] text-fg-subtle font-mono">{row.cronName}</span>
          )}
        </div>
        <div className="text-[11px] text-fg-subtle mt-0.5">{row.description}</div>
        {row.notes && (
          <div className="text-[11px] text-data-warning-fg mt-1">{row.notes}</div>
        )}
      </div>

      <div className="flex flex-col items-end gap-0.5 shrink-0 min-w-[120px]">
        <div className="flex items-center gap-1.5 text-[12px] text-fg">
          <Clock className="w-3 h-3 text-fg-subtle" />
          <span className="font-mono tabular-nums">{lastSyncLabel}</span>
        </div>
        {showNext ? (
          <div className="text-[10px] text-fg-subtle font-mono tabular-nums">
            next in {fmtUntil(row.nextExpectedAt)}
          </div>
        ) : (
          <div className="text-[10px] text-fg-subtle font-mono tabular-nums">
            {row.cadenceMinutes
              ? `cadence ${row.cadenceMinutes}m`
              : row.status === 'not-wired'
                ? '—'
                : 'event-driven'}
          </div>
        )}
      </div>
    </div>
  )

  if (cronHref) {
    return (
      <Link href={cronHref} className="block focus:outline-none focus:ring-2 focus:ring-brand/40 rounded-sm">
        {content}
      </Link>
    )
  }
  return content
}

function AlertItem({ alert }: { alert: { severity: Severity; message: string; linkTo?: string } }) {
  const inner = (
    <div className="flex items-start gap-2 text-xs p-2 rounded-md hover:bg-surface-muted transition-colors border border-transparent hover:border-border">
      <span className="flex-shrink-0 mt-0.5">
        {alert.severity === 'P0' ? (
          <AlertTriangle className="w-3.5 h-3.5 text-data-negative" />
        ) : alert.severity === 'P1' ? (
          <TimerReset className="w-3.5 h-3.5 text-signal" />
        ) : (
          <Activity className="w-3.5 h-3.5 text-fg-muted" />
        )}
      </span>
      <span className="text-fg-muted leading-snug">{alert.message}</span>
    </div>
  )
  return alert.linkTo ? <Link href={alert.linkTo}>{inner}</Link> : inner
}
