'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  DollarSign, Wallet, TrendingUp, TrendingDown, AlertTriangle, RefreshCw,
  Clock, Activity, ShoppingCart, ArrowUpRight, Zap,
} from 'lucide-react'
import {
  PageHeader, KPICard, Card, CardHeader, CardTitle, CardDescription, CardBody,
  DataTable, Badge, StatusBadge, EmptyState, AnimatedNumber, LiveDataIndicator,
  InfoTip, HealthChip,
} from '@/components/ui'
import { useLiveTick } from '@/hooks/useLiveTopic'
import { cn } from '@/lib/utils'

// ── Types ────────────────────────────────────────────────────────────────

interface FinancialData {
  arAging: {
    current:     { count: number; amount: number }
    days1to30:   { count: number; amount: number }
    days31to60:  { count: number; amount: number }
    days60plus:  { count: number; amount: number }
    totalAR: number
  }
  cashFlow: {
    collectedThisWeek: number
    outstandingAmount: number
    invoicesThisWeek: number
  }
  invoiceStatusPipeline: Array<{
    status: string
    count: number
    totalValue: number
  }>
  marginAnalysis: {
    totalOrders: number
    avgMargin: number
    totalOrderValue: number
  }
  poSpending: {
    byVendor: Array<{
      vendorId: string
      vendorName: string
      totalSpent: number
      orderCount: number
    }>
    totalPOValue: number
  }
  paymentTermsMix: Array<{
    term: string
    count: number
  }>
}

interface PaymentVelocityData {
  weeks: Array<{ weekStart: string; total: number }>
  current: number
  trailingAvg: number
  trendPct: number
  sparklineData: number[]
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

// ── Page ─────────────────────────────────────────────────────────────────

export default function FinancialDashboard() {
  const [data, setData] = useState<FinancialData | null>(null)
  const [velocity, setVelocity] = useState<PaymentVelocityData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [canViewFinancials, setCanViewFinancials] = useState(false)
  const [refreshTick, setRefreshTick] = useState<number | null>(null)

  const liveTick = useLiveTick(['ar', 'orders', 'pos'])

  useEffect(() => {
    fetchData()
    fetchPermissions()
  }, [])

  useEffect(() => { if (liveTick > 0) fetchData() /* eslint-disable-next-line */ }, [liveTick])

  async function fetchPermissions() {
    try {
      const res = await fetch('/api/ops/auth/permissions')
      if (res.ok) {
        const perms = await res.json()
        setCanViewFinancials(perms.canViewOperationalFinancials === true)
      }
    } catch { /* default restricted */ }
  }

  async function fetchData() {
    setRefreshing(true)
    try {
      const [finRes, velRes] = await Promise.all([
        fetch('/api/ops/executive/financial'),
        fetch('/api/ops/executive/payment-velocity'),
      ])
      if (!finRes.ok) throw new Error('Failed to fetch financial data')
      const json = await finRes.json()
      setData(json)
      // Velocity is additive — non-fatal if it fails (e.g. role-gated 403)
      if (velRes.ok) {
        try {
          const vJson = await velRes.json()
          setVelocity(vJson)
        } catch { /* ignore parse error */ }
      } else {
        setVelocity(null)
      }
      setError(null)
      setRefreshTick(Date.now())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  const restricted = '••••••'

  // ── Derived ────────────────────────────────────────────────────────────

  const collectionEfficiencyPct = useMemo(() => {
    if (!data) return 0
    if (data.arAging.totalAR <= 0) return 0
    return Math.round(((data.cashFlow.collectedThisWeek / data.arAging.totalAR) * 100) / (52 / 12))
  }, [data])

  const dso = useMemo(() => {
    if (!data) return 0
    if (data.arAging.totalAR <= 0 || data.cashFlow.collectedThisWeek <= 0) return 0
    return Math.round((data.arAging.totalAR / (data.cashFlow.collectedThisWeek * 52)) * 365)
  }, [data])

  const netCash = useMemo(() => {
    if (!data) return 0
    return data.cashFlow.collectedThisWeek - data.poSpending.totalPOValue * (7 / 365)
  }, [data])

  const marginOrders = useMemo(() => {
    if (!data) return []
    return data.poSpending.byVendor.slice(0, 12).map((v) => ({
      ...v,
      estimatedMargin: Math.max(0, 1 - (v.totalSpent / Math.max(1, data.marginAnalysis.totalOrderValue))),
    }))
  }, [data])

  // ── Render ─────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="space-y-5">
        <PageHeader eyebrow="Executive" title="Financial" description="Cash, AR, AP, margin — exec view." />
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          {[0,1,2,3,4].map(i => <KPICard key={i} title="" value="" loading />)}
        </div>
        <div className="h-72 skeleton rounded-lg" />
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="panel p-12 text-center">
        <AlertTriangle className="w-8 h-8 text-data-negative mx-auto mb-3" />
        <div className="text-sm font-medium text-fg">Unable to load financials</div>
        <div className="text-xs text-fg-muted mt-1">{error || 'No data available'}</div>
        <button onClick={fetchData} className="btn btn-secondary btn-sm mt-4">
          <RefreshCw className="w-3.5 h-3.5" /> Retry
        </button>
      </div>
    )
  }

  const marginTone: 'positive' | 'accent' | 'negative' =
    data.marginAnalysis.avgMargin >= 0.3 ? 'positive' :
    data.marginAnalysis.avgMargin >= 0.2 ? 'accent' : 'negative'

  const dsoTone: 'positive' | 'accent' | 'negative' =
    dso === 0 ? 'accent' : dso <= 45 ? 'positive' : dso <= 75 ? 'accent' : 'negative'

  return (
    <div className="space-y-5 animate-enter">
      <LiveDataIndicator trigger={refreshTick} />

      <PageHeader
        eyebrow="Executive"
        title="Financial"
        description="Cash in, cash out, AR aging, vendor spend and margin analytics."
        actions={
          <>
            <HealthChip />
            <button onClick={fetchData} className="btn btn-secondary btn-sm" disabled={refreshing}>
              <RefreshCw className={cn('w-3.5 h-3.5', refreshing && 'animate-spin')} />
              Refresh
            </button>
            <Link href="/ops/finance/cash" className="btn btn-primary btn-sm">
              Cash Detail <ArrowUpRight className="w-3.5 h-3.5" />
            </Link>
          </>
        }
      />

      {/* ── Top KPI row ───────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <KPICard
          title="Cash In (7d)"
          accent="positive"
          value={canViewFinancials
            ? <AnimatedNumber value={data.cashFlow.collectedThisWeek} format={fmtMoneyCompact} />
            : restricted}
          subtitle={`${data.cashFlow.invoicesThisWeek} invoices issued`}
          icon={<TrendingUp className="w-3.5 h-3.5" />}
          onClick={() => document.getElementById('section-cash-waterfall')?.scrollIntoView({ behavior: 'smooth' })}
        />
        <KPICard
          title="Cash Out (weekly est.)"
          accent="negative"
          value={canViewFinancials
            ? <AnimatedNumber value={data.poSpending.totalPOValue * (7 / 365)} format={fmtMoneyCompact} />
            : restricted}
          subtitle="PO spend run-rate"
          icon={<TrendingDown className="w-3.5 h-3.5" />}
          onClick={() => document.getElementById('section-ap-schedule')?.scrollIntoView({ behavior: 'smooth' })}
        />
        <KPICard
          title="Net Weekly"
          accent={netCash >= 0 ? 'positive' : 'negative'}
          value={canViewFinancials
            ? <AnimatedNumber value={netCash} format={fmtMoneyCompact} />
            : restricted}
          subtitle={netCash >= 0 ? 'Positive flow' : 'Negative flow'}
          icon={<Wallet className="w-3.5 h-3.5" />}
          onClick={() => document.getElementById('section-cash-waterfall')?.scrollIntoView({ behavior: 'smooth' })}
        />
        <KPICard
          title="Gross Margin"
          accent={marginTone}
          value={canViewFinancials
            ? <AnimatedNumber value={data.marginAnalysis.avgMargin * 100} format={(v) => `${v.toFixed(1)}%`} />
            : restricted}
          subtitle={`${data.marginAnalysis.totalOrders} orders`}
          icon={<Activity className="w-3.5 h-3.5" />}
          onClick={() => document.getElementById('section-vendor-spend')?.scrollIntoView({ behavior: 'smooth' })}
        />
        {(() => {
          // Payment Velocity — this week vs trailing 4-week average
          const v = velocity
          const hasData = !!v && canViewFinancials
          const trendPct = v?.trendPct ?? 0
          const isUp = trendPct >= 0
          const accent: 'positive' | 'negative' | 'neutral' =
            !hasData ? 'neutral' : isUp ? 'positive' : 'negative'
          const deltaStr = hasData
            ? `${isUp ? '+' : ''}${trendPct.toFixed(1)}% vs 4w avg`
            : undefined
          return (
            <KPICard
              title="Payment Velocity"
              accent={accent}
              value={hasData
                ? <AnimatedNumber value={v!.current} format={fmtMoneyCompact} />
                : restricted}
              delta={deltaStr}
              deltaDirection={hasData ? (isUp ? 'up' : 'down') : undefined}
              subtitle={hasData
                ? `4w avg ${fmtMoneyCompact(v!.trailingAvg)}`
                : 'Awaiting data'}
              icon={<Zap className="w-3.5 h-3.5" />}
              sparkline={hasData ? v!.sparklineData : undefined}
            />
          )
        })()}
      </div>

      {/* ── Drafting-line divider ─────────────────────────────────────── */}
      <div className="divider-draft" />

      {/* ── Cash waterfall (simple) ───────────────────────────────────── */}
      <Card
        id="section-cash-waterfall"
        variant="default"
        padding="none"
        className="hover:border-l-2 hover:border-signal transition-all duration-200"
      >
        <CardHeader>
          <div>
            <CardTitle>Cash Waterfall — 90 Day Outlook</CardTitle>
            <CardDescription>
              Collections + expected AR by bucket, less weekly PO spend.
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <LiveDataIndicator trigger={refreshTick} className="w-10 h-[2px]" />
            <Link href="/ops/finance/cash" className="text-xs text-fg-muted hover:text-accent">
              Full model →
            </Link>
          </div>
        </CardHeader>
        <CardBody>
          {(() => {
            const start = 0
            const steps: Array<{ label: string; value: number; tone: 'in' | 'out' | 'start' | 'end' }> = [
              { label: 'Starting', value: 0, tone: 'start' },
              { label: 'Current AR', value: data.arAging.current.amount, tone: 'in' },
              { label: '1-30d', value: data.arAging.days1to30.amount * 0.9, tone: 'in' },
              { label: '31-60d', value: data.arAging.days31to60.amount * 0.75, tone: 'in' },
              { label: '60+d', value: data.arAging.days60plus.amount * 0.4, tone: 'in' },
              { label: 'PO spend (90d)', value: -data.poSpending.totalPOValue * (90 / 365), tone: 'out' },
            ]
            let running = start
            const points = steps.map((s, i) => {
              const before = running
              if (s.tone !== 'start') running += s.value
              return { ...s, before, after: running, idx: i }
            })
            const endVal = running
            points.push({ label: 'Projected', value: endVal, tone: 'end', before: 0, after: endVal, idx: points.length })

            const max = Math.max(...points.map((p) => Math.max(Math.abs(p.before), Math.abs(p.after)))) || 1

            return (
              <div className="space-y-2">
                {points.map((p) => {
                  const isBar = p.tone !== 'start' && p.tone !== 'end'
                  const width = isBar
                    ? (Math.abs(p.value) / max) * 100
                    : (Math.abs(p.after) / max) * 100
                  const offset = isBar
                    ? (Math.min(p.before, p.after) / max) * 100 + 50
                    : 50
                  const barColor = p.tone === 'in' ? 'bg-data-positive' : p.tone === 'out' ? 'bg-data-negative' : 'bg-brand'
                  return (
                    <div key={p.label} className="flex items-center gap-3">
                      <div className="w-32 text-xs text-fg-muted truncate">{p.label}</div>
                      <div className="flex-1 relative h-6 bg-surface-muted/40 rounded">
                        {/* Center line for waterfall */}
                        <div className="absolute top-0 bottom-0 left-1/2 w-px bg-border/60" />
                        <div
                          className={cn('absolute top-1 bottom-1 rounded', barColor)}
                          style={{
                            left: `${Math.max(0, Math.min(100, offset - (p.value < 0 ? width : 0)))}%`,
                            width: `${Math.max(1, width)}%`,
                          }}
                        />
                      </div>
                      <div className="w-24 text-right text-sm font-semibold font-numeric tabular-nums text-fg">
                        {canViewFinancials ? (
                          p.tone === 'end'
                            ? fmtMoneyCompact(p.after)
                            : p.tone === 'start' ? '—' : fmtMoneyCompact(p.value)
                        ) : restricted}
                      </div>
                    </div>
                  )
                })}
              </div>
            )
          })()}
        </CardBody>
      </Card>

      {/* ── Drafting-line divider ─────────────────────────────────────── */}
      <div className="divider-draft" />

      {/* ── AR aging + DSO ────────────────────────────────────────────── */}
      <div id="section-ar-aging" className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <Card
          variant="default"
          padding="none"
          className="lg:col-span-2 hover:border-l-2 hover:border-signal transition-all duration-200"
        >
          <CardHeader>
            <div>
              <CardTitle>AR Aging</CardTitle>
              <CardDescription>Outstanding receivables by bucket</CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <LiveDataIndicator trigger={refreshTick} className="w-10 h-[2px]" />
              <Link href="/ops/finance/ar" className="text-xs text-fg-muted hover:text-accent">
                All invoices →
              </Link>
            </div>
          </CardHeader>
          <CardBody>
            {(() => {
              const buckets = [
                { label: 'Current',  b: data.arAging.current,     tone: 'bg-data-positive',  text: 'text-data-positive' },
                { label: '1-30d',    b: data.arAging.days1to30,   tone: 'bg-forecast',       text: 'text-forecast' },
                { label: '31-60d',   b: data.arAging.days31to60,  tone: 'bg-accent',         text: 'text-accent' },
                { label: '60+d',     b: data.arAging.days60plus,  tone: 'bg-data-negative',  text: 'text-data-negative' },
              ]
              const max = Math.max(...buckets.map((x) => x.b.amount), 1)
              return (
                <div className="space-y-3">
                  {buckets.map(({ label, b, tone, text }) => {
                    const pct = (b.amount / max) * 100
                    return (
                      <div key={label} className="group">
                        <div className="flex items-center justify-between mb-1.5">
                          <div className="flex items-center gap-2">
                            <span className={cn('w-2 h-2 rounded-full', tone)} />
                            <span className="text-sm font-medium text-fg">{label}</span>
                            <span className="text-[11px] text-fg-subtle tabular-nums">
                              {b.count} {b.count === 1 ? 'inv' : 'invs'}
                            </span>
                          </div>
                          <span className={cn('text-sm font-semibold font-numeric tabular-nums', text)}>
                            {canViewFinancials ? fmtMoney(b.amount) : restricted}
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
              )
            })()}
          </CardBody>
        </Card>

        <Card variant="default" padding="none">
          <CardHeader>
            <div className="flex items-center gap-2">
              <CardTitle>DSO</CardTitle>
              <InfoTip label="DSO">
                Days Sales Outstanding — average days to collect AR from invoice date. Lower is better; under 45d is healthy.
              </InfoTip>
            </div>
          </CardHeader>
          <CardBody className="space-y-4">
            <div>
              <div className="metric metric-xxl font-numeric tabular-nums">
                {canViewFinancials ? <AnimatedNumber value={dso} format={(v) => `${Math.round(v)}d`} /> : restricted}
              </div>
              <div className="text-xs text-fg-muted mt-1">Days sales outstanding</div>
            </div>
            <div className="divider" />
            <div className="space-y-2.5">
              <MiniStat
                label="Collection efficiency"
                value={canViewFinancials ? `${collectionEfficiencyPct}%` : restricted}
                tone={collectionEfficiencyPct >= 80 ? 'positive' : collectionEfficiencyPct >= 50 ? 'accent' : 'negative'}
              />
              <MiniStat
                label="Total outstanding"
                value={canViewFinancials ? fmtMoneyCompact(data.arAging.totalAR) : restricted}
              />
              <MiniStat
                label="Target DSO"
                value="45d"
                tone={dsoTone}
              />
            </div>
          </CardBody>
        </Card>
      </div>

      {/* ── Drafting-line divider ─────────────────────────────────────── */}
      <div className="divider-draft" />

      {/* ── GM by account (top vendors proxy) ─────────────────────────── */}
      <Card
        id="section-vendor-spend"
        variant="default"
        padding="none"
        className="hover:border-l-2 hover:border-signal transition-all duration-200"
      >
        <CardHeader>
          <div>
            <CardTitle>Top Vendor Spend · GM Impact</CardTitle>
            <CardDescription>
              Ranked PO spend with estimated gross margin contribution
            </CardDescription>
          </div>
          <Link href="/ops/vendors" className="text-xs text-fg-muted hover:text-accent">All vendors →</Link>
        </CardHeader>
        <DataTable
          density="compact"
          data={marginOrders}
          rowKey={(v) => v.vendorId}
          empty={<EmptyState icon="package" title="No vendor spend yet" size="compact" />}
          columns={[
            {
              key: 'vendorName',
              header: 'Vendor',
              cell: (v) => <span className="font-medium text-fg truncate block max-w-[320px]">{v.vendorName}</span>,
            },
            {
              key: 'orderCount',
              header: 'POs',
              numeric: true,
              cell: (v) => <span className="tabular-nums">{v.orderCount}</span>,
            },
            {
              key: 'totalSpent',
              header: 'Spend',
              numeric: true,
              heatmap: true,
              heatmapValue: (v) => v.totalSpent,
              cell: (v) => (
                <span className="tabular-nums font-semibold">
                  {canViewFinancials ? fmtMoneyCompact(v.totalSpent) : restricted}
                </span>
              ),
            },
            {
              key: 'estimatedMargin',
              header: 'Est. share',
              numeric: true,
              heatmap: true,
              heatmapValue: (v) => v.estimatedMargin,
              cell: (v) => (
                <span className="tabular-nums text-fg-muted">
                  {canViewFinancials ? `${(v.estimatedMargin * 100).toFixed(1)}%` : restricted}
                </span>
              ),
            },
          ]}
        />
      </Card>

      {/* ── Drafting-line divider ─────────────────────────────────────── */}
      <div className="divider-draft" />

      {/* ── Invoice pipeline + AP schedule ────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <Card
          variant="default"
          padding="none"
          className="hover:border-l-2 hover:border-signal transition-all duration-200"
        >
          <CardHeader>
            <div>
              <CardTitle>Invoice Pipeline</CardTitle>
              <CardDescription>Status + dollar value in-flight</CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <LiveDataIndicator trigger={refreshTick} className="w-10 h-[2px]" />
              <Link href="/ops/finance/ar" className="text-xs text-fg-muted hover:text-accent">AR →</Link>
            </div>
          </CardHeader>
          <CardBody>
            {data.invoiceStatusPipeline.length === 0 ? (
              <EmptyState icon="document" title="No invoices in pipeline" size="compact" />
            ) : (
              <div className="space-y-2.5">
                {data.invoiceStatusPipeline.map((s) => {
                  const max = Math.max(...data.invoiceStatusPipeline.map((x) => x.count), 1)
                  const pct = (s.count / max) * 100
                  return (
                    <div key={s.status}>
                      <div className="flex items-center justify-between mb-1">
                        <StatusBadge status={s.status} size="sm" />
                        <div className="flex items-center gap-3 font-numeric tabular-nums">
                          <span className="text-sm font-semibold text-fg">{s.count}</span>
                          <span className="text-[11px] text-fg-subtle w-20 text-right">
                            {canViewFinancials ? fmtMoneyCompact(s.totalValue) : restricted}
                          </span>
                        </div>
                      </div>
                      <div className="relative h-1 w-full bg-surface-muted rounded-full overflow-hidden">
                        <div
                          className="absolute inset-y-0 left-0 bg-accent/70 rounded-full transition-all duration-slow"
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

        <Card
          id="section-ap-schedule"
          variant="default"
          padding="none"
          className="hover:border-l-2 hover:border-signal transition-all duration-200"
        >
          <CardHeader>
            <div>
              <CardTitle>AP Schedule Summary</CardTitle>
              <CardDescription>Payment terms mix + PO run-rate</CardDescription>
            </div>
            <Link href="/ops/finance/ap" className="text-xs text-fg-muted hover:text-accent">AP →</Link>
          </CardHeader>
          <CardBody>
            <div className="mb-4 pb-4 border-b border-border">
              <div className="eyebrow">Total PO Value</div>
              <div className="metric metric-xl mt-1 font-numeric tabular-nums">
                {canViewFinancials
                  ? <AnimatedNumber value={data.poSpending.totalPOValue} format={fmtMoneyCompact} />
                  : restricted}
              </div>
            </div>
            {data.paymentTermsMix.length === 0 ? (
              <EmptyState icon="chart" title="No terms data" size="compact" />
            ) : (
              <div className="space-y-2">
                {data.paymentTermsMix.map((item) => {
                  const total = data.paymentTermsMix.reduce((s, t) => s + t.count, 0) || 1
                  const pct = (item.count / total) * 100
                  return (
                    <div key={item.term}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm font-medium text-fg">{item.term}</span>
                        <span className="text-sm tabular-nums text-fg-muted">
                          {item.count} <span className="text-fg-subtle">· {pct.toFixed(0)}%</span>
                        </span>
                      </div>
                      <div className="relative h-1 w-full bg-surface-muted rounded-full overflow-hidden">
                        <div
                          className="absolute inset-y-0 left-0 bg-brand/70 rounded-full transition-all duration-slow"
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
      </div>

      {/* ── Footer stats ──────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Card variant="default" padding="lg">
          <div className="flex items-center gap-2 mb-2">
            <Clock className="w-3.5 h-3.5 text-fg-muted" />
            <div className="eyebrow">Avg Order Value</div>
          </div>
          <div className="metric metric-lg font-numeric tabular-nums">
            {canViewFinancials && data.marginAnalysis.totalOrders > 0
              ? fmtMoneyCompact(data.marginAnalysis.totalOrderValue / data.marginAnalysis.totalOrders)
              : restricted}
          </div>
        </Card>
        <Card variant="default" padding="lg">
          <div className="flex items-center gap-2 mb-2">
            <ShoppingCart className="w-3.5 h-3.5 text-fg-muted" />
            <div className="eyebrow">Total Order Value</div>
          </div>
          <div className="metric metric-lg font-numeric tabular-nums">
            {canViewFinancials ? fmtMoneyCompact(data.marginAnalysis.totalOrderValue) : restricted}
          </div>
        </Card>
        <Card variant="default" padding="lg">
          <div className="flex items-center gap-2 mb-2">
            <DollarSign className="w-3.5 h-3.5 text-fg-muted" />
            <div className="eyebrow">Orders Analyzed</div>
          </div>
          <div className="metric metric-lg font-numeric tabular-nums">
            <AnimatedNumber value={data.marginAnalysis.totalOrders} />
          </div>
        </Card>
      </div>
    </div>
  )
}

// ── helpers ──────────────────────────────────────────────────────────────

function MiniStat({
  label,
  value,
  tone,
}: {
  label: string
  value: string
  tone?: 'positive' | 'accent' | 'negative'
}) {
  const toneClass =
    tone === 'positive' ? 'text-data-positive' :
    tone === 'accent'   ? 'text-accent' :
    tone === 'negative' ? 'text-data-negative' : 'text-fg'
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-fg-muted">{label}</span>
      <span className={cn('font-semibold font-numeric tabular-nums', toneClass)}>{value}</span>
    </div>
  )
}
