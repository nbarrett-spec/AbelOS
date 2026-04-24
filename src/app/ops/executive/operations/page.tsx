'use client'

import { useEffect, useState, useMemo } from 'react'
import Link from 'next/link'
import {
  Activity, AlertTriangle, Clock, Factory, RefreshCw, Truck, Users,
  Package, TrendingUp, Calendar,
} from 'lucide-react'
import {
  PageHeader, KPICard, Card, CardHeader, CardTitle, CardDescription, CardBody,
  DataTable, Badge, StatusBadge, EmptyState, AnimatedNumber, LiveDataIndicator,
  InfoTip, HealthChip,
} from '@/components/ui'
import { useLiveTick } from '@/hooks/useLiveTopic'
import { cn } from '@/lib/utils'

// ── Types (preserve API contract from /api/ops/executive/operations) ────

interface OperationsData {
  crewUtilization: Array<{
    crewId: string
    crewName: string
    scheduled: number
    inProgress: number
    completed: number
  }>
  scheduleHeatmap: Array<{
    date: string
    deliveries: number
    installations: number
    total: number
  }>
  jobVelocity: Array<{
    status: string
    avgDays: number
  }>
  exceptions: Array<{
    id: string
    jobNumber: string | null
    noteType: string
    subject: string
    author: string | null
    createdAt: string
  }>
  vendorPerformance: Array<{
    vendorId: string
    vendorName: string
    onTimeRate: number
    avgLeadDays: number
    totalOrders: number
    openPOValue: number
  }>
}

// ── Formatters ───────────────────────────────────────────────────────────

const fmtMoneyCompact = (n: number) => {
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`
  if (Math.abs(n) >= 10_000)    return `$${Math.round(n / 1000)}K`
  if (Math.abs(n) >= 1_000)     return `$${(n / 1000).toFixed(1)}K`
  return `$${Math.round(n)}`
}

const fmtInt = (n: number) => new Intl.NumberFormat('en-US').format(n)

// ── Page ─────────────────────────────────────────────────────────────────

export default function OperationsDashboard() {
  const [data, setData] = useState<OperationsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [refreshTick, setRefreshTick] = useState<number | null>(null)

  const liveTick = useLiveTick(['orders', 'pos'])

  useEffect(() => { fetchData() }, [])
  useEffect(() => { if (liveTick > 0) fetchData() /* eslint-disable-next-line */ }, [liveTick])

  async function fetchData() {
    setRefreshing(true)
    try {
      const res = await fetch('/api/ops/executive/operations')
      if (!res.ok) throw new Error('Failed to fetch operations data')
      const json = await res.json()
      setData(json)
      setError(null)
      setRefreshTick(Date.now())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  // ── Derived metrics ────────────────────────────────────────────────────

  const throughput = useMemo(() => {
    if (!data) return { completed: 0, inProgress: 0, scheduled: 0 }
    return data.crewUtilization.reduce(
      (acc, c) => ({
        completed: acc.completed + c.completed,
        inProgress: acc.inProgress + c.inProgress,
        scheduled: acc.scheduled + c.scheduled,
      }),
      { completed: 0, inProgress: 0, scheduled: 0 }
    )
  }, [data])

  const onTimePct = useMemo(() => {
    if (!data || data.vendorPerformance.length === 0) return 0
    const sum = data.vendorPerformance.reduce((s, v) => s + (v.onTimeRate || 0), 0)
    return Math.round(sum / data.vendorPerformance.length)
  }, [data])

  const avgCycle = useMemo(() => {
    if (!data || data.jobVelocity.length === 0) return 0
    const s = data.jobVelocity.reduce((a, v) => a + (v.avgDays || 0), 0)
    return Math.round((s / data.jobVelocity.length) * 10) / 10
  }, [data])

  const wip = throughput.inProgress + throughput.scheduled

  const todayStr = new Date().toISOString().slice(0, 10)
  const todayDeliveries = useMemo(() => {
    if (!data) return null
    return data.scheduleHeatmap.find((d) => d.date === todayStr)
      ?? data.scheduleHeatmap[0] // fall back to first day if today missing
  }, [data, todayStr])

  // Builder × status heatmap synthesized from crew data (proxy for floor load)
  const heatmapRows = useMemo(() => {
    if (!data) return []
    return data.crewUtilization.map((c) => ({
      crewId: c.crewId,
      crewName: c.crewName,
      scheduled: c.scheduled,
      inProgress: c.inProgress,
      completed: c.completed,
      total: c.scheduled + c.inProgress + c.completed,
    }))
  }, [data])

  // ── Render ─────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="space-y-5">
        <PageHeader eyebrow="Executive" title="Operations" description="Throughput, cycle time, WIP and vendor performance." />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[0, 1, 2, 3].map((i) => <KPICard key={i} title="" value="" loading />)}
        </div>
        <div className="h-96 skeleton rounded-lg" />
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="panel p-12 text-center">
        <AlertTriangle className="w-8 h-8 text-data-negative mx-auto mb-3" />
        <div className="text-sm font-medium text-fg">Unable to load operations</div>
        <div className="text-xs text-fg-muted mt-1">{error || 'No data available'}</div>
        <button onClick={fetchData} className="btn btn-secondary btn-sm mt-4">
          <RefreshCw className="w-3.5 h-3.5" /> Retry
        </button>
      </div>
    )
  }

  const onTimeTone: 'positive' | 'accent' | 'negative' =
    onTimePct >= 90 ? 'positive' : onTimePct >= 70 ? 'accent' : 'negative'
  const cycleTone: 'positive' | 'accent' | 'negative' =
    avgCycle <= 10 ? 'positive' : avgCycle <= 20 ? 'accent' : 'negative'

  return (
    <div className="space-y-5 animate-enter">
      <LiveDataIndicator trigger={refreshTick} />

      <PageHeader
        eyebrow="Executive"
        title="Operations"
        description="Throughput, cycle time, WIP, crew utilization and vendor performance."
        actions={
          <>
            <HealthChip />
            <button onClick={fetchData} className="btn btn-secondary btn-sm" disabled={refreshing}>
              <RefreshCw className={cn('w-3.5 h-3.5', refreshing && 'animate-spin')} />
              Refresh
            </button>
            <Link href="/ops/executive" className="btn btn-ghost btn-sm">CEO View</Link>
          </>
        }
      />

      {/* ── Top KPI row ───────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KPICard
          title="Throughput"
          accent="brand"
          value={<AnimatedNumber value={throughput.completed} />}
          subtitle={`${fmtInt(throughput.inProgress)} in progress · ${fmtInt(throughput.scheduled)} scheduled`}
          icon={<Factory className="w-3.5 h-3.5" />}
          onClick={() => document.getElementById('section-status-distribution')?.scrollIntoView({ behavior: 'smooth' })}
        />
        <KPICard
          title="On-Time %"
          accent={onTimeTone}
          value={<AnimatedNumber value={onTimePct} format={(v) => `${Math.round(v)}%`} />}
          subtitle={`${data.vendorPerformance.length} vendors tracked`}
          icon={<TrendingUp className="w-3.5 h-3.5" />}
          onClick={() => document.getElementById('section-vendor-performance')?.scrollIntoView({ behavior: 'smooth' })}
        />
        <KPICard
          title="Cycle Time"
          accent={cycleTone}
          value={<AnimatedNumber value={avgCycle} format={(v) => `${v.toFixed(1)}d`} />}
          subtitle="Avg across pipeline stages"
          icon={<Clock className="w-3.5 h-3.5" />}
          onClick={() => document.getElementById('section-job-velocity')?.scrollIntoView({ behavior: 'smooth' })}
        />
        <KPICard
          title="WIP"
          accent="accent"
          value={<AnimatedNumber value={wip} />}
          subtitle={`${fmtInt(throughput.scheduled)} scheduled next 2w`}
          icon={<Activity className="w-3.5 h-3.5" />}
          onClick={() => document.getElementById('section-schedule-heatmap')?.scrollIntoView({ behavior: 'smooth' })}
        />
      </div>

      {/* ── Drafting-line divider ─────────────────────────────────────── */}
      <div className="divider-draft" />

      {/* ── Status distribution + Today's deliveries ──────────────────── */}
      <div id="section-status-distribution" className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <Card
          variant="default"
          padding="none"
          className="lg:col-span-2 hover:border-l-2 hover:border-signal transition-all duration-200"
        >
          <CardHeader>
            <div>
              <CardTitle>Status Distribution</CardTitle>
              <CardDescription>Crew load across next 2 weeks</CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <LiveDataIndicator trigger={refreshTick} className="w-10 h-[2px]" />
              <StatusBadge status="SCHEDULED" size="xs" />
              <StatusBadge status="IN_PROGRESS" size="xs" />
              <StatusBadge status="COMPLETED" size="xs" />
            </div>
          </CardHeader>
          <CardBody>
            {heatmapRows.length === 0 ? (
              <EmptyState icon="users" title="No crews scheduled" description="Schedule appears when jobs are booked." size="compact" />
            ) : (
              <div className="space-y-3">
                {heatmapRows.map((c) => {
                  const total = Math.max(1, c.total)
                  const schedPct = (c.scheduled / total) * 100
                  const progPct = (c.inProgress / total) * 100
                  const compPct = (c.completed / total) * 100
                  return (
                    <div key={c.crewId}>
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-sm font-medium text-fg">{c.crewName}</span>
                        <span className="text-[11px] text-fg-subtle tabular-nums">
                          {fmtInt(c.total)} jobs
                        </span>
                      </div>
                      <div className="relative flex h-2 rounded-full overflow-hidden bg-surface-muted">
                        <div className="bg-forecast transition-all duration-base" style={{ width: `${schedPct}%` }} title={`Scheduled: ${c.scheduled}`} />
                        <div className="bg-accent transition-all duration-base" style={{ width: `${progPct}%` }} title={`In Progress: ${c.inProgress}`} />
                        <div className="bg-data-positive transition-all duration-base" style={{ width: `${compPct}%` }} title={`Completed: ${c.completed}`} />
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </CardBody>
        </Card>

        <Card
          variant="default"
          padding="none"
          className="panel-live hover:border-l-2 hover:border-signal transition-all duration-200"
        >
          <CardHeader>
            <div>
              <CardTitle>Today's Deliveries</CardTitle>
              <CardDescription>
                <span className="tabular-nums">{todayDeliveries?.date ?? todayStr}</span>
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <LiveDataIndicator trigger={refreshTick} className="w-10 h-[2px]" />
              <Badge variant="neutral" size="sm" dot>Live</Badge>
            </div>
          </CardHeader>
          <CardBody>
            {!todayDeliveries || todayDeliveries.total === 0 ? (
              <EmptyState icon="truck" title="No deliveries today" size="compact" />
            ) : (
              <div className="space-y-4">
                <div className="flex items-baseline gap-3">
                  <span className="metric metric-xxl font-numeric tabular-nums">
                    <AnimatedNumber value={todayDeliveries.total} />
                  </span>
                  <span className="text-xs text-fg-muted">total events</span>
                </div>
                <div className="divider" />
                <div className="space-y-2.5">
                  <Row icon={<Truck className="w-3.5 h-3.5 text-accent" />} label="Deliveries" value={todayDeliveries.deliveries} />
                  <Row icon={<Package className="w-3.5 h-3.5 text-data-positive" />} label="Installations" value={todayDeliveries.installations} />
                </div>
                <Link href="/ops/delivery" className="btn btn-primary btn-sm w-full justify-center">
                  Open Delivery Board
                </Link>
              </div>
            )}
          </CardBody>
        </Card>
      </div>

      {/* ── Drafting-line divider ─────────────────────────────────────── */}
      <div className="divider-draft" />

      {/* ── Schedule heatmap (14 day) ─────────────────────────────────── */}
      <Card
        id="section-schedule-heatmap"
        variant="default"
        padding="none"
        className="hover:border-l-2 hover:border-signal transition-all duration-200"
      >
        <CardHeader>
          <div>
            <CardTitle>Schedule Density — 14 Day</CardTitle>
            <CardDescription>Installations + deliveries combined</CardDescription>
          </div>
          <InfoTip label="Schedule density">
            Shows forward 14-day load. Darker cells indicate higher combined delivery + install events on that date.
          </InfoTip>
        </CardHeader>
        <CardBody>
          {data.scheduleHeatmap.length === 0 ? (
            <EmptyState icon="chart" title="No schedule data" size="compact" />
          ) : (
            <div className="grid grid-cols-7 gap-1.5">
              {data.scheduleHeatmap.map((d) => {
                const maxTotal = Math.max(...data.scheduleHeatmap.map((x) => x.total), 1)
                const intensity = d.total / maxTotal
                const bg = intensity === 0
                  ? 'rgba(120,120,120,0.08)'
                  : `rgba(201, 130, 43, ${(0.15 + intensity * 0.7).toFixed(2)})`
                return (
                  <div
                    key={d.date}
                    className="rounded-md p-2 border border-border/40 hover:border-accent/50 transition-colors group"
                    style={{ backgroundColor: bg }}
                    title={`${d.date}: ${d.deliveries} deliveries, ${d.installations} installs`}
                  >
                    <div className="text-[10px] text-fg-subtle tabular-nums">
                      {new Date(d.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    </div>
                    <div className="metric font-numeric tabular-nums mt-1 group-hover:text-accent transition-colors">
                      {d.total}
                    </div>
                    <div className="text-[10px] text-fg-muted mt-0.5">
                      {d.deliveries}d · {d.installations}i
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </CardBody>
      </Card>

      {/* ── Drafting-line divider ─────────────────────────────────────── */}
      <div className="divider-draft" />

      {/* ── Job velocity ──────────────────────────────────────────────── */}
      <Card
        id="section-job-velocity"
        variant="default"
        padding="none"
        className="hover:border-l-2 hover:border-signal transition-all duration-200"
      >
        <CardHeader>
          <div>
            <CardTitle>Job Velocity by Stage</CardTitle>
            <CardDescription>Average days spent per pipeline stage</CardDescription>
          </div>
          <InfoTip label="Cycle time">
            Average days a job spends in each stage. Long tails indicate a bottleneck worth investigating.
          </InfoTip>
        </CardHeader>
        <CardBody>
          {data.jobVelocity.length === 0 ? (
            <EmptyState icon="chart" title="No velocity data" size="compact" />
          ) : (
            <div className="space-y-3">
              {data.jobVelocity.map((s) => {
                const max = Math.max(...data.jobVelocity.map((v) => v.avgDays), 1)
                const pct = (s.avgDays / max) * 100
                const tone =
                  s.avgDays > 20 ? 'bg-data-negative' :
                  s.avgDays > 10 ? 'bg-accent' : 'bg-data-positive'
                return (
                  <div key={s.status}>
                    <div className="flex items-center justify-between mb-1">
                      <StatusBadge status={s.status} size="sm" />
                      <span className="text-sm font-semibold tabular-nums text-fg">
                        <AnimatedNumber value={s.avgDays} format={(v) => `${v.toFixed(1)}d`} />
                      </span>
                    </div>
                    <div className="relative h-1.5 w-full bg-surface-muted rounded-full overflow-hidden">
                      <div
                        className={cn('absolute inset-y-0 left-0 rounded-full transition-all duration-slow', tone)}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </CardBody>
      </Card>

      {/* ── Drafting-line divider ─────────────────────────────────────── */}
      <div className="divider-draft" />

      {/* ── Exceptions + Vendor performance ───────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <Card
          variant="default"
          padding="none"
          className="hover:border-l-2 hover:border-signal transition-all duration-200"
        >
          <CardHeader>
            <div>
              <CardTitle>Exception Tracker</CardTitle>
              <CardDescription>
                {data.exceptions.length === 0
                  ? 'No exceptions — smooth sailing.'
                  : `${data.exceptions.length} active ${data.exceptions.length === 1 ? 'issue' : 'issues'}`}
              </CardDescription>
            </div>
            {data.exceptions.length > 0 && (
              <Badge variant="warning" size="sm" dot>{data.exceptions.length}</Badge>
            )}
          </CardHeader>
          <CardBody className="max-h-96 overflow-y-auto scrollbar-thin space-y-2">
            {data.exceptions.length === 0 ? (
              <EmptyState icon="shield" title="All clear" description="No escalations or exceptions on the board." size="compact" />
            ) : (
              data.exceptions.map((exc) => {
                const isEsc = exc.noteType === 'ESCALATION'
                return (
                  <div
                    key={exc.id}
                    className={cn(
                      'panel px-3 py-2.5 border-l-2',
                      isEsc ? 'border-l-data-negative' : 'border-l-data-warning'
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium text-fg truncate">{exc.subject}</div>
                        <div className="text-[11px] text-fg-muted mt-0.5 flex items-center gap-2">
                          <span>Job: <span className="font-numeric tabular-nums">{exc.jobNumber || '—'}</span></span>
                          <span>·</span>
                          <span>{exc.author || 'unknown'}</span>
                          <span>·</span>
                          <span className="tabular-nums">{new Date(exc.createdAt).toLocaleDateString()}</span>
                        </div>
                      </div>
                      <Badge variant={isEsc ? 'danger' : 'warning'} size="xs">{exc.noteType}</Badge>
                    </div>
                  </div>
                )
              })
            )}
          </CardBody>
        </Card>

        <Card
          id="section-vendor-performance"
          variant="default"
          padding="none"
          className="hover:border-l-2 hover:border-signal transition-all duration-200"
        >
          <CardHeader>
            <div>
              <CardTitle>Vendor Performance</CardTitle>
              <CardDescription>On-time rate and open exposure</CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <LiveDataIndicator trigger={refreshTick} className="w-10 h-[2px]" />
              <Link href="/ops/purchasing" className="text-xs text-fg-muted hover:text-accent">
                All vendors →
              </Link>
            </div>
          </CardHeader>
          <DataTable
            density="compact"
            data={data.vendorPerformance}
            rowKey={(v) => v.vendorId}
            empty={<EmptyState icon="users" title="No vendors tracked" size="compact" />}
            columns={[
              {
                key: 'vendorName',
                header: 'Vendor',
                cell: (v) => <span className="font-medium text-fg truncate block max-w-[200px]">{v.vendorName}</span>,
              },
              {
                key: 'onTimeRate',
                header: 'On-Time',
                numeric: true,
                heatmap: true,
                heatmapValue: (v) => v.onTimeRate,
                cell: (v) => {
                  const pct = Math.round(v.onTimeRate)
                  const tone = pct >= 90 ? 'text-data-positive' : pct >= 70 ? 'text-accent' : 'text-data-negative'
                  return <span className={cn('font-semibold tabular-nums', tone)}>{pct}%</span>
                },
              },
              {
                key: 'avgLeadDays',
                header: 'Lead',
                numeric: true,
                cell: (v) => <span className="tabular-nums">{v.avgLeadDays}d</span>,
              },
              {
                key: 'openPOValue',
                header: 'Open PO',
                numeric: true,
                heatmap: true,
                heatmapValue: (v) => v.openPOValue,
                cell: (v) => <span className="tabular-nums">{fmtMoneyCompact(v.openPOValue)}</span>,
              },
            ]}
          />
        </Card>
      </div>
    </div>
  )
}

// ── helpers ──────────────────────────────────────────────────────────────

function Row({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2">
        {icon}
        <span className="text-sm text-fg-muted">{label}</span>
      </div>
      <span className="metric metric-md font-numeric tabular-nums">
        <AnimatedNumber value={value} />
      </span>
    </div>
  )
}
