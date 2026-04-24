'use client'

import { useEffect, useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  DollarSign, TrendingUp, Wallet, AlertTriangle, Package, Factory,
  Truck, ShoppingCart, ArrowUpRight, RefreshCw, Clock, ChevronRight,
  Activity, Building2, FileText
} from 'lucide-react'
import {
  KPICard, Sparkline, Badge, StatusBadge, PageHeader,
  Card, CardHeader, CardTitle, CardDescription, CardBody,
} from '@/components/ui'
import { cn } from '@/lib/utils'
import type { MonthlyRollup } from '@/lib/finance/monthly-rollup'
import {
  FinancialYtdStrip,
  FinancialMonthTable,
  FinancialLineChart,
  YearQuarterControls,
  type QuarterFilter,
} from '@/components/FinancialChart'

// ── Types (preserve API contract from /api/ops/executive/dashboard) ──────

interface DashboardData {
  revenueKpis: {
    totalRevenue: number
    totalOrders: number
    currentMonth: number
    lastMonth: number
    ytd: number
    momGrowth: number
    totalInvoiced: number
    totalCollected: number
    outstandingAR: number
    grossMargin: number
  }
  monthlyRevenue: Array<{ month: string; revenue: number; orderCount: number }>
  pipelineHealth: {
    ordersByStatus: Array<{ status: string; count: number; value: number }>
    totalOrders: number
    inProgress: number
    pending: number
  }
  builderMetrics: {
    totalBuilders: number
    activeBuilders: number
    newThisMonth: number
    topBuilders: Array<{ builderId: string; companyName: string; revenue: number; orderCount: number }>
  }
  operationsSnapshot: {
    completedAll: number
    completedThisMonth: number
    inProgress: number
    avgCycleTimeDays: number
    totalDeliveries: number
    activeDeliveries: number
  }
  financials: {
    totalPOSpend: number
    openPOs: number
    openPOValue: number
    grossMargin: number
  }
  alerts: {
    overdueInvoices: number
    stalledOrders: number
  }
}

// ── Formatters ───────────────────────────────────────────────────────────

const fmtMoney = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n)

const fmtMoneyCompact = (n: number) => {
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`
  if (Math.abs(n) >= 10_000)    return `$${Math.round(n / 1000)}K`
  if (Math.abs(n) >= 1_000)     return `$${(n / 1000).toFixed(1)}K`
  return fmtMoney(n)
}

const fmtInt = (n: number) => new Intl.NumberFormat('en-US').format(n)

const fmtPct = (n: number, decimals = 1) => `${n >= 0 ? '+' : ''}${n.toFixed(decimals)}%`

// ── Page ─────────────────────────────────────────────────────────────────

export default function ExecutiveDashboard() {
  const router = useRouter()
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [canViewFinancials, setCanViewFinancials] = useState(false)
  const [refreshing, setRefreshing] = useState(false)

  // ── YTD rollup ──
  const currentYear = new Date().getUTCFullYear()
  const currentMonth = new Date().getUTCMonth() + 1
  const [rollup, setRollup] = useState<MonthlyRollup | null>(null)
  const [rollupYear, setRollupYear] = useState<number>(currentYear)
  const [quarter, setQuarter] = useState<QuarterFilter>('YTD')

  useEffect(() => {
    fetchData()
    fetchPermissions()
  }, [])

  useEffect(() => {
    fetch(`/api/ops/finance/monthly-rollup?year=${rollupYear}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d && !d.error) setRollup(d) })
      .catch(() => { /* silent */ })
  }, [rollupYear])

  const fetchPermissions = async () => {
    try {
      const res = await fetch('/api/ops/auth/permissions')
      if (res.ok) {
        const perms = await res.json()
        setCanViewFinancials(perms.canViewOperationalFinancials === true)
      }
    } catch { /* default restricted */ }
  }

  const fetchData = async () => {
    setRefreshing(true)
    try {
      const response = await fetch('/api/ops/executive/dashboard')
      if (!response.ok) throw new Error('Failed to fetch data')
      const result = await response.json()
      setData(result)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  // Admin-only masking: KPICard.value wants `string | number`, so we use a
  // plain-string mask here rather than a JSX <span>. Visual hierarchy is
  // preserved by the bullet glyphs and the card's own typography.
  const restricted = '••••••'

  const monthlySeries = useMemo(() => data?.monthlyRevenue.map(m => m.revenue) ?? [], [data])
  const ordersSeries  = useMemo(() => data?.monthlyRevenue.map(m => m.orderCount) ?? [], [data])

  if (loading) {
    return (
      <div className="space-y-5">
        <PageHeader
          eyebrow="Executive"
          title="CEO Dashboard"
          description="Revenue, pipeline, and operations — updated live."
        />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[0, 1, 2, 3].map((i) => <KPICard key={i} title="" value="" loading />)}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          <div className="h-80 lg:col-span-2 skeleton rounded-lg" />
          <div className="h-80 skeleton rounded-lg" />
        </div>
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="panel p-12 text-center">
        <AlertTriangle className="w-8 h-8 text-data-negative mx-auto mb-3" />
        <div className="text-sm font-medium text-fg">Unable to load dashboard</div>
        <div className="text-xs text-fg-muted mt-1">{error || 'No data available'}</div>
        <button onClick={fetchData} className="btn btn-secondary btn-sm mt-4">
          <RefreshCw className="w-3.5 h-3.5" /> Retry
        </button>
      </div>
    )
  }

  // ── Derived ────────────────────────────────────────────────────────────
  const kpis = data.revenueKpis
  const hasAlerts = data.alerts.overdueInvoices > 0 || data.alerts.stalledOrders > 0
  const grossMarginTone =
    kpis.grossMargin >= 30 ? 'positive' : kpis.grossMargin >= 20 ? 'accent' : 'negative'

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <div className="space-y-5 animate-enter">
      {/* ── Page header ───────────────────────────────────────────────── */}
      <PageHeader
        eyebrow="Executive"
        title="CEO Dashboard"
        description="Revenue, pipeline, and operations at a glance."
        actions={
          <>
            {rollup && (
              <YearQuarterControls
                year={rollupYear}
                availableYears={[currentYear - 2, currentYear - 1, currentYear]}
                onYearChange={setRollupYear}
                quarter={quarter}
                onQuarterChange={setQuarter}
              />
            )}
            <button onClick={fetchData} className="btn btn-secondary btn-sm" disabled={refreshing}>
              <RefreshCw className={cn('w-3.5 h-3.5', refreshing && 'animate-spin')} />
              Refresh
            </button>
            <Link href="/ops/executive/operations" className="btn btn-primary btn-sm">
              Operations
              <ArrowUpRight className="w-3.5 h-3.5" />
            </Link>
          </>
        }
      />

      {/* ── YTD KPI strip + per-month table + chart ───────────────────── */}
      {rollup && (
        <div className="space-y-4">
          <FinancialYtdStrip ytd={rollup.ytd} restricted={!canViewFinancials} />
          <FinancialMonthTable
            months={rollup.months}
            currentMonth={rollupYear === currentYear ? currentMonth : 12}
            quarter={quarter}
            restricted={!canViewFinancials}
          />
          <FinancialLineChart
            months={rollup.months}
            currentMonth={rollupYear === currentYear ? currentMonth : 0}
            restricted={!canViewFinancials}
          />
        </div>
      )}

      {/* ── Alerts strip ──────────────────────────────────────────────── */}
      {hasAlerts && (
        <div className="panel panel-live border-l-0 px-4 py-3 flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2 text-data-warning">
            <AlertTriangle className="w-4 h-4" />
            <span className="text-xs font-semibold uppercase tracking-wide">Action required</span>
          </div>
          <div className="h-4 w-px bg-border" />
          <div className="flex items-center gap-4 text-sm text-fg">
            {data.alerts.overdueInvoices > 0 && (
              <button
                onClick={() => router.push('/ops/finance/ar?status=OVERDUE')}
                className="flex items-center gap-1.5 hover:text-accent transition-colors"
              >
                <span className="metric font-numeric text-data-negative">{data.alerts.overdueInvoices}</span>
                <span className="text-fg-muted">overdue invoices</span>
                <ChevronRight className="w-3 h-3 text-fg-subtle" />
              </button>
            )}
            {data.alerts.stalledOrders > 0 && (
              <button
                onClick={() => router.push('/ops/orders?stalled=true')}
                className="flex items-center gap-1.5 hover:text-accent transition-colors"
              >
                <span className="metric font-numeric text-data-warning">{data.alerts.stalledOrders}</span>
                <span className="text-fg-muted">orders stalled 7d+</span>
                <ChevronRight className="w-3 h-3 text-fg-subtle" />
              </button>
            )}
          </div>
        </div>
      )}

      {/* ── Top KPI row ───────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KPICard
          title="Revenue YTD"
          accent="brand"
          value={canViewFinancials ? fmtMoneyCompact(kpis.ytd) : restricted}
          subtitle={`${fmtInt(kpis.totalOrders)} orders`}
          icon={<DollarSign className="w-3.5 h-3.5" />}
          sparkline={monthlySeries}
          onClick={() => router.push('/ops/finance')}
        />
        <KPICard
          title="Outstanding AR"
          accent={kpis.outstandingAR > 500000 ? 'negative' : 'accent'}
          value={canViewFinancials ? fmtMoneyCompact(kpis.outstandingAR) : restricted}
          subtitle={canViewFinancials ? `Collected ${fmtMoneyCompact(kpis.totalCollected)}` : 'Admin only'}
          icon={<Wallet className="w-3.5 h-3.5" />}
          onClick={() => router.push('/ops/finance/ar')}
          badge={data.alerts.overdueInvoices > 0 ? (
            <Badge variant="danger" size="xs" dot>{data.alerts.overdueInvoices} overdue</Badge>
          ) : undefined}
        />
        <KPICard
          title="This Month"
          accent={kpis.momGrowth >= 0 ? 'positive' : 'negative'}
          value={canViewFinancials ? fmtMoneyCompact(kpis.currentMonth) : restricted}
          delta={canViewFinancials ? fmtPct(kpis.momGrowth) : undefined}
          deltaDirection={kpis.momGrowth >= 0 ? 'up' : 'down'}
          subtitle="vs last month"
          icon={<TrendingUp className="w-3.5 h-3.5" />}
          sparkline={monthlySeries.slice(-6)}
          onClick={() => router.push('/ops/finance')}
        />
        <KPICard
          title="Gross Margin"
          accent={grossMarginTone === 'positive' ? 'positive' : grossMarginTone === 'negative' ? 'negative' : 'accent'}
          value={canViewFinancials ? `${kpis.grossMargin.toFixed(1)}%` : restricted}
          subtitle="Revenue vs COGS"
          icon={<Activity className="w-3.5 h-3.5" />}
          onClick={() => router.push('/ops/finance/health')}
        />
      </div>

      {/* ── Revenue trend + pipeline ──────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        {/* Revenue trend */}
        <Card variant="default" padding="none" className="lg:col-span-2">
          <CardHeader>
            <div>
              <CardTitle>Revenue Trend</CardTitle>
              <CardDescription>Last {data.monthlyRevenue.length} months · dashed line indicates forecast</CardDescription>
            </div>
            <Badge variant="neutral" size="sm" dot>Live</Badge>
          </CardHeader>
          <CardBody className="pt-5">
            {data.monthlyRevenue.length === 0 ? (
              <div className="flex items-center justify-center h-48 text-fg-muted text-sm">
                Revenue data will appear as orders land.
              </div>
            ) : (
              <div className="space-y-2.5">
                {data.monthlyRevenue.map((m) => {
                  const max = Math.max(...data.monthlyRevenue.map(x => x.revenue), 1)
                  const pct = (m.revenue / max) * 100
                  return (
                    <div key={m.month} className="group">
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-xs font-medium text-fg-muted font-mono">{m.month}</span>
                        <div className="flex items-center gap-3 font-numeric tabular-nums">
                          {canViewFinancials ? (
                            <span className="text-sm font-semibold text-fg">{fmtMoney(m.revenue)}</span>
                          ) : (
                            <span className="text-sm text-fg-subtle">••••••</span>
                          )}
                          <span className="text-[11px] text-fg-subtle w-16 text-right">
                            {m.orderCount} orders
                          </span>
                        </div>
                      </div>
                      <div className="relative h-1.5 w-full bg-surface-muted rounded-full overflow-hidden">
                        <div
                          className="absolute inset-y-0 left-0 bg-gradient-to-r from-brand to-accent rounded-full transition-all duration-slow ease-out"
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

        {/* Pipeline */}
        <Card variant="default" padding="none">
          <CardHeader>
            <div>
              <CardTitle>Order Pipeline</CardTitle>
              <CardDescription>{fmtInt(data.pipelineHealth.totalOrders)} active</CardDescription>
            </div>
          </CardHeader>
          <CardBody className="pt-4 space-y-2">
            {data.pipelineHealth.ordersByStatus.length === 0 ? (
              <div className="flex items-center justify-center h-48 text-fg-muted text-sm">
                No orders yet.
              </div>
            ) : (
              data.pipelineHealth.ordersByStatus.map((item) => {
                const maxCount = Math.max(...data.pipelineHealth.ordersByStatus.map(s => s.count), 1)
                const pct = (item.count / maxCount) * 100
                return (
                  <button
                    key={item.status}
                    onClick={() => router.push(`/ops/orders?status=${item.status}`)}
                    className="w-full text-left py-1.5 px-2 -mx-2 rounded-md hover:bg-surface-muted transition-colors group"
                  >
                    <div className="flex items-center justify-between mb-1">
                      <StatusBadge status={item.status} size="sm" />
                      <div className="flex items-center gap-2 font-numeric tabular-nums">
                        <span className="text-sm font-semibold text-fg">{item.count}</span>
                        {canViewFinancials && (
                          <span className="text-[11px] text-fg-subtle">{fmtMoneyCompact(item.value)}</span>
                        )}
                      </div>
                    </div>
                    <div className="relative h-1 w-full bg-surface-muted rounded-full overflow-hidden">
                      <div
                        className="absolute inset-y-0 left-0 bg-fg-muted/40 group-hover:bg-accent/70 rounded-full transition-all duration-base"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </button>
                )
              })
            )}
          </CardBody>
        </Card>
      </div>

      {/* ── Operations snapshot strip ─────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <OpsTile
          title="Completed"
          value={fmtInt(data.operationsSnapshot.completedAll)}
          subtitle={`${data.operationsSnapshot.completedThisMonth} this month`}
          icon={<Factory className="w-3.5 h-3.5" />}
          onClick={() => router.push('/ops/orders?status=COMPLETE')}
          tone="positive"
        />
        <OpsTile
          title="In Progress"
          value={fmtInt(data.operationsSnapshot.inProgress)}
          subtitle="Active orders"
          icon={<Activity className="w-3.5 h-3.5" />}
          onClick={() => router.push('/ops/orders?status=IN_PROGRESS')}
          tone="accent"
        />
        <OpsTile
          title="Cycle Time"
          value={`${data.operationsSnapshot.avgCycleTimeDays}d`}
          subtitle="Order → complete"
          icon={<Clock className="w-3.5 h-3.5" />}
          onClick={() => router.push('/ops/executive/operations')}
          tone="neutral"
        />
        <OpsTile
          title="Deliveries"
          value={fmtInt(data.operationsSnapshot.totalDeliveries)}
          subtitle={`${data.operationsSnapshot.activeDeliveries} active`}
          icon={<Truck className="w-3.5 h-3.5" />}
          onClick={() => router.push('/ops/delivery')}
          tone="info"
        />
        <OpsTile
          title="Open PO Value"
          value={canViewFinancials ? fmtMoneyCompact(data.financials.openPOValue) : '••••'}
          subtitle={`${data.financials.openPOs} purchase orders`}
          icon={<ShoppingCart className="w-3.5 h-3.5" />}
          onClick={() => router.push('/ops/purchasing')}
          tone="neutral"
        />
        <OpsTile
          title="Builders"
          value={fmtInt(data.builderMetrics.activeBuilders)}
          subtitle={`${data.builderMetrics.newThisMonth} new this month`}
          icon={<Building2 className="w-3.5 h-3.5" />}
          onClick={() => router.push('/ops/accounts?status=ACTIVE')}
          tone="neutral"
        />
      </div>

      {/* ── Top builders + builder metrics ────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        {/* Top builders */}
        <Card variant="default" padding="none" className="lg:col-span-2">
          <CardHeader>
            <div>
              <CardTitle>Top Builders by Revenue</CardTitle>
              <CardDescription>YTD — click for account detail</CardDescription>
            </div>
            <Link href="/ops/accounts" className="text-xs text-fg-muted hover:text-accent flex items-center gap-1">
              All accounts <ChevronRight className="w-3 h-3" />
            </Link>
          </CardHeader>
          <div className="overflow-x-auto">
            {data.builderMetrics.topBuilders.length === 0 ? (
              <div className="text-center py-10 text-sm text-fg-muted">No builder revenue data yet.</div>
            ) : (
              <table className="datatable density-compact">
                <thead>
                  <tr>
                    <th style={{ width: 36 }}>#</th>
                    <th>Builder</th>
                    <th className="num">Revenue</th>
                    <th className="num">Orders</th>
                    <th className="num">Avg</th>
                    <th style={{ width: 80 }}>Share</th>
                  </tr>
                </thead>
                <tbody>
                  {data.builderMetrics.topBuilders.map((b, idx) => {
                    const maxRev = Math.max(...data.builderMetrics.topBuilders.map(x => x.revenue), 1)
                    const sharePct = (b.revenue / maxRev) * 100
                    return (
                      <tr
                        key={b.builderId}
                        onClick={() => router.push(`/ops/accounts/${b.builderId}`)}
                        className="cursor-pointer"
                      >
                        <td>
                          <span className="text-fg-subtle font-numeric tabular-nums text-xs">
                            {String(idx + 1).padStart(2, '0')}
                          </span>
                        </td>
                        <td className="font-medium text-fg truncate max-w-[240px]">{b.companyName}</td>
                        <td className="num font-semibold">
                          {canViewFinancials ? fmtMoneyCompact(b.revenue) : '••••'}
                        </td>
                        <td className="num text-fg-muted">{b.orderCount}</td>
                        <td className="num text-fg-muted">
                          {canViewFinancials ? fmtMoneyCompact(b.orderCount > 0 ? b.revenue / b.orderCount : 0) : '••••'}
                        </td>
                        <td>
                          <div className="relative h-1 w-full bg-surface-muted rounded-full overflow-hidden">
                            <div
                              className="absolute inset-y-0 left-0 bg-accent/70 rounded-full"
                              style={{ width: `${sharePct}%` }}
                            />
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>
        </Card>

        {/* Builder metrics / focus rail */}
        <Card variant="default" padding="none">
          <CardHeader>
            <div>
              <CardTitle>Account Health</CardTitle>
              <CardDescription>Network overview</CardDescription>
            </div>
          </CardHeader>
          <CardBody className="space-y-4">
            <button
              onClick={() => router.push('/ops/accounts')}
              className="block w-full text-left group"
            >
              <div className="eyebrow">Total Builders</div>
              <div className="metric metric-xl mt-1.5 group-hover:text-accent transition-colors">
                {fmtInt(data.builderMetrics.totalBuilders)}
              </div>
            </button>
            <div className="divider" />
            <button
              onClick={() => router.push('/ops/accounts?status=ACTIVE')}
              className="block w-full text-left"
            >
              <div className="flex items-center justify-between">
                <span className="eyebrow">Active</span>
                <span className="text-[11px] text-fg-subtle">
                  {data.builderMetrics.totalBuilders > 0
                    ? Math.round((data.builderMetrics.activeBuilders / data.builderMetrics.totalBuilders) * 100)
                    : 0}% activation
                </span>
              </div>
              <div className="metric metric-lg mt-1.5 text-data-positive">
                {fmtInt(data.builderMetrics.activeBuilders)}
              </div>
              <div className="relative h-1 w-full bg-surface-muted rounded-full overflow-hidden mt-2">
                <div
                  className="absolute inset-y-0 left-0 bg-data-positive rounded-full"
                  style={{
                    width: `${data.builderMetrics.totalBuilders > 0
                      ? (data.builderMetrics.activeBuilders / data.builderMetrics.totalBuilders) * 100
                      : 0}%`
                  }}
                />
              </div>
            </button>
            <div className="divider" />
            <button
              onClick={() => router.push('/ops/accounts?new=true')}
              className="block w-full text-left"
            >
              <div className="eyebrow">New This Month</div>
              <div className="metric metric-lg mt-1.5 text-accent">
                {fmtInt(data.builderMetrics.newThisMonth)}
              </div>
            </button>
          </CardBody>
        </Card>
      </div>

      {/* ── AI / quick access rail ────────────────────────────────────── */}
      <Card variant="default" padding="none">
        <CardHeader>
          <div>
            <CardTitle>Intelligence</CardTitle>
            <CardDescription>Deep analysis, one click away</CardDescription>
          </div>
        </CardHeader>
        <CardBody>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <QuickLink href="/ops/revenue-intelligence"      title="Revenue Machine"   icon={<DollarSign className="w-3.5 h-3.5" />} />
            <QuickLink href="/ops/cash-flow-optimizer"       title="Cash Flow Brain"   icon={<Wallet className="w-3.5 h-3.5" />} />
            <QuickLink href="/ops/procurement-intelligence"  title="Procurement Brain" icon={<Package className="w-3.5 h-3.5" />} />
            <QuickLink href="/ops/ai/insights"               title="AI Insights"       icon={<Activity className="w-3.5 h-3.5" />} />
          </div>
        </CardBody>
      </Card>

      {/* ── System health footer ──────────────────────────────────────── */}
      <div className="flex items-center justify-between flex-wrap gap-3 px-3 py-2 text-[11px] text-fg-muted tabular-nums border-t border-border">
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-1.5">
            <span className="relative flex w-1.5 h-1.5">
              <span className="absolute inset-0 rounded-full bg-data-positive animate-pulse-soft" />
              <span className="relative rounded-full w-1.5 h-1.5 bg-data-positive" />
            </span>
            System operational
          </span>
          <span className="h-3 w-px bg-border hidden sm:block" />
          <span className="font-mono hidden sm:inline">go-live-2026-04-13</span>
          <span className="h-3 w-px bg-border hidden md:block" />
          <span className="hidden md:inline">Data from live database</span>
        </div>
        <span className="flex items-center gap-1.5">
          <span className="kbd">⌘K</span>
          <span className="text-fg-subtle">to search</span>
        </span>
      </div>
    </div>
  )
}

// ── OpsTile: compact secondary KPI ───────────────────────────────────────

function OpsTile({
  title, value, subtitle, icon, onClick, tone = 'neutral',
}: {
  title: string
  value: string
  subtitle: string
  icon: React.ReactNode
  onClick: () => void
  tone?: 'positive' | 'negative' | 'accent' | 'info' | 'neutral'
}) {
  const toneClass = {
    positive: 'text-data-positive',
    negative: 'text-data-negative',
    accent:   'text-accent',
    info:     'text-data-info',
    neutral:  'text-fg',
  }[tone]

  return (
    <button
      onClick={onClick}
      className="panel panel-interactive text-left px-3 py-3 flex flex-col gap-1"
    >
      <div className="flex items-center gap-1.5 text-fg-subtle">
        {icon}
        <span className="eyebrow">{title}</span>
      </div>
      <div className={cn('metric metric-md tabular-nums', toneClass)}>{value}</div>
      <div className="text-[11px] text-fg-subtle truncate">{subtitle}</div>
    </button>
  )
}

// ── QuickLink ────────────────────────────────────────────────────────────

function QuickLink({ href, title, icon }: { href: string; title: string; icon: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="panel panel-interactive flex items-center justify-between gap-2 px-3 py-2.5 text-sm font-medium text-fg group"
    >
      <span className="flex items-center gap-2">
        <span className="w-6 h-6 rounded-md bg-accent-subtle text-accent-fg flex items-center justify-center">
          {icon}
        </span>
        {title}
      </span>
      <ArrowUpRight className="w-3.5 h-3.5 text-fg-subtle group-hover:text-accent group-hover:-translate-y-0.5 group-hover:translate-x-0.5 transition-transform duration-fast" />
    </Link>
  )
}
