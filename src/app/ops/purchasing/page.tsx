'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import Link from 'next/link'
import {
  ShoppingCart, Package, CheckCircle2, Clock, RefreshCw, Search, Sparkles,
  AlertTriangle, TrendingUp, Zap, Plus, Truck, ChevronDown, ChevronUp,
} from 'lucide-react'
import {
  PageHeader, KPICard, Card, CardHeader, CardTitle, CardDescription, CardBody,
  DataTable, Badge, StatusBadge, EmptyState, AnimatedNumber, LiveDataIndicator,
  InfoTip, Tabs,
} from '@/components/ui'
import { useLiveTick } from '@/hooks/useLiveTopic'
import { cn } from '@/lib/utils'

// ── Types ────────────────────────────────────────────────────────────────

interface PO {
  id: string; poNumber: string; supplierId: string; supplierName: string; supplierType: string
  supplierCountry: string; status: string; priority: string; subtotal: number; shippingCost: number
  dutyCost: number; totalCost: number; expectedDate: string; actualDate: string; trackingNumber: string
  notes: string; aiGenerated: boolean; aiReason: string; itemCount: number; totalReceived: number
  totalOrdered: number; createdAt: string
}

interface POStats {
  totalPOs: number; draftCount: number; openCount: number; pendingApproval: number
  totalSpend: number; openValue: number; overdueCount: number
}

interface RecommendationGroup {
  vendorId: string
  vendorName: string
  vendorCode: string
  itemCount: number
  estimatedTotal: number
  urgency: 'CRITICAL' | 'STANDARD'
  items: Array<{
    productId: string
    sku: string
    productName: string
    onHand: number
    onOrder: number
    reorderPoint: number
    recommendedQty: number
    estimatedCost: number
    unitCost?: number
  }>
}

interface VendorScorecard {
  vendorId: string
  vendorName: string
  vendorCode: string
  totalPOs: number
  onTimeRate: number
  avgLeadDays: number
  spend30Days: number
  spend90Days: number
  spend365Days: number
  qualityIssues: number
  topProducts: Array<any>
  trend: {
    previousMonth: number
    currentMonth: number
    percentChange: number
  }
}

// ── Formatters ───────────────────────────────────────────────────────────

const fmtMoneyCompact = (n: number) => {
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`
  if (Math.abs(n) >= 10_000)    return `$${Math.round(n / 1000)}K`
  if (Math.abs(n) >= 1_000)     return `$${(n / 1000).toFixed(1)}K`
  return `$${Math.round(n)}`
}

const fmtMoney = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(n)

const STATUSES = ['ALL', 'DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'SENT', 'IN_TRANSIT', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED']

// ── Page ─────────────────────────────────────────────────────────────────

export default function PurchaseOrdersPage() {
  const [orders, setOrders] = useState<PO[]>([])
  const [stats, setStats] = useState<POStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState('ALL')
  const [search, setSearch] = useState('')
  const [recommendations, setRecommendations] = useState<RecommendationGroup[]>([])
  const [scorecards, setScorecards] = useState<VendorScorecard[]>([])
  const [recsLoading, setRecsLoading] = useState(false)
  const [scoresLoading, setScoresLoading] = useState(false)
  const [activeTab, setActiveTab] = useState<string>('pipeline')
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [refreshTick, setRefreshTick] = useState<number | null>(null)
  const [expandedRec, setExpandedRec] = useState<string | null>(null)

  const liveTick = useLiveTick('pos')

  const fetchPOs = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      if (statusFilter !== 'ALL') params.set('status', statusFilter)
      if (search) params.set('search', search)
      const res = await fetch(`/api/ops/procurement/purchase-orders?${params}`)
      if (res.ok) {
        const d = await res.json()
        setOrders(d.orders || [])
        setStats(d.stats || null)
      }
      setRefreshTick(Date.now())
    } catch (err) {
      console.error('[Purchasing] Failed to load purchase orders:', err)
      setError('Failed to load data. Please try again.')
    } finally {
      setLoading(false)
    }
  }, [statusFilter, search])

  const fetchRecommendations = useCallback(async () => {
    setRecsLoading(true)
    try {
      const res = await fetch('/api/ops/purchasing/recommendations')
      if (res.ok) setRecommendations(await res.json())
    } catch (err) {
      console.error('[Purchasing] Failed to load recommendations:', err)
    } finally {
      setRecsLoading(false)
    }
  }, [])

  const fetchScorecards = useCallback(async () => {
    setScoresLoading(true)
    try {
      const res = await fetch('/api/ops/vendors/scorecard')
      if (res.ok) setScorecards(await res.json())
    } catch (err) {
      console.error('[Purchasing] Failed to load scorecards:', err)
    } finally {
      setScoresLoading(false)
    }
  }, [])

  useEffect(() => {
    fetch('/api/ops/procurement/setup', { method: 'POST' }).then(() => {
      fetchPOs()
      fetchRecommendations()
      fetchScorecards()
    })
  }, []) // eslint-disable-line

  useEffect(() => { fetchPOs() }, [fetchPOs])
  useEffect(() => { if (liveTick > 0) fetchPOs() /* eslint-disable-next-line */ }, [liveTick])

  const createRecommendationPO = async (vendorId: string, vendorName: string, items: any[]) => {
    const staffId = 'staff_default'
    setActionLoading(`rec-${vendorId}`)
    try {
      const res = await fetch('/api/ops/purchasing/recommendations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vendorId,
          createdById: staffId,
          items: items.map(i => ({
            productId: i.productId,
            sku: i.sku,
            productName: i.productName,
            recommendedQty: i.recommendedQty,
            unitCost: i.unitCost,
          })),
        }),
      })
      if (res.ok) {
        fetchPOs()
        fetchRecommendations()
      }
    } catch (err) {
      console.error('[Purchasing] Failed to create recommendation PO:', err)
    } finally {
      setActionLoading(null)
    }
  }

  // ── Derived ────────────────────────────────────────────────────────────

  const kanbanBuckets = useMemo(() => {
    const buckets: Record<string, PO[]> = {
      DRAFT: [],
      SENT: [],
      PARTIALLY_RECEIVED: [],
      RECEIVED: [],
    }
    for (const o of orders) {
      if (buckets[o.status]) buckets[o.status].push(o)
      else if (o.status === 'APPROVED' || o.status === 'PENDING_APPROVAL') buckets.DRAFT.push(o)
      else if (o.status === 'IN_TRANSIT') buckets.SENT.push(o)
    }
    return buckets
  }, [orders])

  // ── Render ─────────────────────────────────────────────────────────────

  if (error) {
    return (
      <div className="space-y-5">
        <PageHeader eyebrow="Procurement" title="Purchase Orders" description="Vendor management · PO pipeline · smart reorder." />
        <div className="panel p-12 text-center">
          <AlertTriangle className="w-8 h-8 text-data-negative mx-auto mb-3" />
          <div className="text-sm font-medium text-fg">{error}</div>
          <button onClick={() => { setError(null); fetchPOs() }} className="btn btn-secondary btn-sm mt-4">
            <RefreshCw className="w-3.5 h-3.5" /> Retry
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-5 animate-enter">
      <LiveDataIndicator trigger={refreshTick} />

      <PageHeader
        eyebrow="Procurement"
        title="Purchase Orders"
        description="Vendor management, PO pipeline, and smart MRP-driven reorder recommendations."
        actions={
          <>
            <button onClick={fetchPOs} className="btn btn-secondary btn-sm" disabled={loading}>
              <RefreshCw className={cn('w-3.5 h-3.5', loading && 'animate-spin')} />
              Refresh
            </button>
            <Link href="/ops/procurement-intelligence" className="btn btn-primary btn-sm">
              <Sparkles className="w-3.5 h-3.5" /> AI Generate POs
            </Link>
          </>
        }
      />

      {/* ── Top KPIs ──────────────────────────────────────────────────── */}
      {stats && (
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          <KPICard
            title="Total POs"
            accent="brand"
            value={<AnimatedNumber value={stats.totalPOs} />}
            subtitle={`${stats.draftCount} drafts`}
            icon={<ShoppingCart className="w-3.5 h-3.5" />}
          />
          <KPICard
            title="Open / In Transit"
            accent="accent"
            value={<AnimatedNumber value={stats.openCount} />}
            subtitle={`${stats.pendingApproval} pending approval`}
            icon={<Truck className="w-3.5 h-3.5" />}
          />
          <KPICard
            title="Open Value"
            accent="neutral"
            value={<AnimatedNumber value={stats.openValue} format={fmtMoneyCompact} />}
            subtitle="In-flight spend"
            icon={<Package className="w-3.5 h-3.5" />}
          />
          <KPICard
            title="Overdue"
            accent={stats.overdueCount > 0 ? 'negative' : 'positive'}
            value={<AnimatedNumber value={stats.overdueCount} />}
            subtitle="Past expected date"
            icon={<AlertTriangle className="w-3.5 h-3.5" />}
          />
          <KPICard
            title="Total Spend"
            accent="positive"
            value={<AnimatedNumber value={stats.totalSpend} format={fmtMoneyCompact} />}
            subtitle="Lifetime"
            icon={<TrendingUp className="w-3.5 h-3.5" />}
          />
        </div>
      )}

      <Tabs
        tabs={[
          { id: 'pipeline', label: 'Pipeline' },
          { id: 'recommendations', label: `Smart Reorder${recommendations.length > 0 ? ` · ${recommendations.length}` : ''}` },
          { id: 'scorecards', label: 'Vendor Scorecards' },
          { id: 'all', label: 'All POs' },
        ] as any}
        activeTab={activeTab}
        onChange={(t) => setActiveTab(t)}
      />

      {/* ── PIPELINE (Kanban) ─────────────────────────────────────────── */}
      {activeTab === 'pipeline' && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          {(['DRAFT', 'SENT', 'PARTIALLY_RECEIVED', 'RECEIVED'] as const).map((col) => {
            const items = kanbanBuckets[col] || []
            return (
              <Card key={col} variant="default" padding="none" className="flex flex-col">
                <CardHeader className="sticky top-0 bg-surface z-10">
                  <div className="min-w-0">
                    <CardTitle>
                      <span className="flex items-center gap-2">
                        <StatusBadge status={col} size="sm" />
                        <span className="text-[11px] text-fg-subtle tabular-nums">{items.length}</span>
                      </span>
                    </CardTitle>
                  </div>
                </CardHeader>
                <div className="p-2 space-y-2 min-h-[320px] max-h-[600px] overflow-y-auto scrollbar-thin">
                  {items.length === 0 ? (
                    <div className="text-center py-8 text-xs text-fg-subtle">Empty</div>
                  ) : (
                    items.slice(0, 25).map((po) => (
                      <Link
                        key={po.id}
                        href={`/ops/purchasing/${po.id}`}
                        className="panel panel-interactive block p-3"
                      >
                        <div className="flex items-center justify-between mb-1 gap-2">
                          <span className="font-semibold font-mono text-xs text-fg truncate">{po.poNumber}</span>
                          {po.aiGenerated && <Badge variant="brand" size="xs">AI</Badge>}
                        </div>
                        <div className="text-xs text-fg-muted truncate mb-2">{po.supplierName}</div>
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-fg-subtle tabular-nums">{po.itemCount} items</span>
                          <span className="font-semibold tabular-nums text-fg">
                            {fmtMoneyCompact(po.totalCost)}
                          </span>
                        </div>
                        {po.totalOrdered > 0 && (
                          <div className="mt-2">
                            <div className="relative h-1 w-full bg-surface-muted rounded-full overflow-hidden">
                              <div
                                className={cn(
                                  'absolute inset-y-0 left-0 rounded-full',
                                  po.totalReceived >= po.totalOrdered ? 'bg-data-positive' : 'bg-accent'
                                )}
                                style={{ width: `${Math.min(100, (po.totalReceived / po.totalOrdered) * 100)}%` }}
                              />
                            </div>
                            <div className="text-[10px] text-fg-subtle tabular-nums mt-1">
                              {po.totalReceived}/{po.totalOrdered} received
                            </div>
                          </div>
                        )}
                      </Link>
                    ))
                  )}
                  {items.length > 25 && (
                    <div className="text-center text-[11px] text-fg-subtle py-1">
                      + {items.length - 25} more
                    </div>
                  )}
                </div>
              </Card>
            )
          })}
        </div>
      )}

      {/* ── RECOMMENDATIONS ───────────────────────────────────────────── */}
      {activeTab === 'recommendations' && (
        <Card variant="default" padding="none">
          <CardHeader>
            <div>
              <CardTitle>
                <span className="flex items-center gap-2">
                  <Zap className="w-4 h-4 text-accent" />
                  Smart PO Recommendations (MRP)
                </span>
              </CardTitle>
              <CardDescription>Reorder suggestions based on demand, lead time, and reorder points.</CardDescription>
            </div>
            <button onClick={fetchRecommendations} className="btn btn-secondary btn-sm" disabled={recsLoading}>
              <RefreshCw className={cn('w-3.5 h-3.5', recsLoading && 'animate-spin')} />
              Refresh
            </button>
          </CardHeader>
          <CardBody>
            {recsLoading ? (
              <div className="text-center py-10 text-sm text-fg-muted">Loading recommendations…</div>
            ) : recommendations.length === 0 ? (
              <EmptyState
                icon="package"
                title="Inventory healthy"
                description="No reorder recommendations — all stock levels above reorder points."
                size="default"
              />
            ) : (
              <div className="space-y-2">
                {recommendations.map((rec) => {
                  const expanded = expandedRec === rec.vendorId
                  return (
                    <div
                      key={rec.vendorId}
                      className={cn(
                        'panel border-l-2 overflow-hidden',
                        rec.urgency === 'CRITICAL' ? 'border-l-data-negative' : 'border-l-accent'
                      )}
                    >
                      <div
                        onClick={() => setExpandedRec(expanded ? null : rec.vendorId)}
                        className="p-3 cursor-pointer flex items-center justify-between gap-3 panel-interactive"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-semibold text-sm text-fg truncate">{rec.vendorName}</span>
                            <Badge variant={rec.urgency === 'CRITICAL' ? 'danger' : 'warning'} size="xs">
                              {rec.urgency}
                            </Badge>
                          </div>
                          <div className="text-xs text-fg-muted mt-1 tabular-nums">
                            {rec.itemCount} items · est. {fmtMoney(rec.estimatedTotal)}
                          </div>
                        </div>
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            createRecommendationPO(rec.vendorId, rec.vendorName, rec.items)
                          }}
                          disabled={actionLoading === `rec-${rec.vendorId}`}
                          className="btn btn-success btn-sm"
                        >
                          <Plus className="w-3.5 h-3.5" />
                          {actionLoading === `rec-${rec.vendorId}` ? 'Creating…' : 'Create PO'}
                        </button>
                        {expanded
                          ? <ChevronUp className="w-4 h-4 text-fg-subtle" />
                          : <ChevronDown className="w-4 h-4 text-fg-subtle" />}
                      </div>

                      {expanded && (
                        <div className="border-t border-border">
                          <DataTable
                            density="compact"
                            data={rec.items}
                            rowKey={(i) => i.productId}
                            columns={[
                              {
                                key: 'sku',
                                header: 'SKU',
                                cell: (i) => <span className="font-mono text-xs text-fg-muted">{i.sku}</span>,
                              },
                              { key: 'productName', header: 'Product' },
                              {
                                key: 'onHand',
                                header: 'On Hand',
                                numeric: true,
                                cell: (i) => <span className="tabular-nums">{i.onHand}</span>,
                              },
                              {
                                key: 'recommendedQty',
                                header: 'Rec. Qty',
                                numeric: true,
                                cell: (i) => <span className="tabular-nums font-semibold text-accent">{i.recommendedQty}</span>,
                              },
                              {
                                key: 'estimatedCost',
                                header: 'Est. Cost',
                                numeric: true,
                                cell: (i) => <span className="tabular-nums">{fmtMoney(i.estimatedCost)}</span>,
                              },
                            ]}
                          />
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </CardBody>
        </Card>
      )}

      {/* ── SCORECARDS ────────────────────────────────────────────────── */}
      {activeTab === 'scorecards' && (
        <Card variant="default" padding="none">
          <CardHeader>
            <div>
              <CardTitle>Vendor Performance Scorecards</CardTitle>
              <CardDescription>On-time rate, lead time, spend, and month-over-month trend</CardDescription>
            </div>
            <button onClick={fetchScorecards} className="btn btn-secondary btn-sm" disabled={scoresLoading}>
              <RefreshCw className={cn('w-3.5 h-3.5', scoresLoading && 'animate-spin')} />
              Refresh
            </button>
          </CardHeader>
          <CardBody>
            {scoresLoading ? (
              <div className="text-center py-10 text-sm text-fg-muted">Loading scorecards…</div>
            ) : scorecards.length === 0 ? (
              <EmptyState icon="users" title="No vendors yet" description="Create vendors first." size="default" />
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                {scorecards.map((sc) => {
                  const tone: 'positive' | 'accent' | 'negative' =
                    sc.onTimeRate >= 90 ? 'positive' :
                    sc.onTimeRate >= 70 ? 'accent' : 'negative'
                  const toneClass =
                    tone === 'positive' ? 'text-data-positive' :
                    tone === 'accent'   ? 'text-accent' : 'text-data-negative'
                  const trendPos = sc.trend.percentChange >= 0
                  return (
                    <div key={sc.vendorId} className="panel panel-interactive p-4 space-y-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="font-semibold text-fg truncate">{sc.vendorName}</div>
                          <div className="text-[11px] text-fg-subtle font-mono">{sc.vendorCode}</div>
                        </div>
                        <Badge
                          variant={trendPos ? 'success' : 'danger'}
                          size="xs"
                        >
                          {trendPos ? '+' : ''}{sc.trend.percentChange.toFixed(1)}% MoM
                        </Badge>
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <div className="panel px-3 py-2">
                          <div className="eyebrow">On-Time</div>
                          <div className={cn('metric metric-md tabular-nums mt-1', toneClass)}>
                            {Math.round(sc.onTimeRate)}%
                          </div>
                        </div>
                        <div className="panel px-3 py-2">
                          <div className="eyebrow">Lead</div>
                          <div className="metric metric-md tabular-nums mt-1 text-fg">
                            {sc.avgLeadDays}d
                          </div>
                        </div>
                      </div>

                      <div className="divider" />

                      <div className="space-y-1.5 text-sm">
                        <Row label="30d" value={fmtMoneyCompact(sc.spend30Days)} />
                        <Row label="90d" value={fmtMoneyCompact(sc.spend90Days)} />
                        <Row label="365d" value={fmtMoneyCompact(sc.spend365Days)} />
                      </div>
                      <div className="flex items-center justify-between text-xs text-fg-muted pt-1">
                        <span>{sc.totalPOs} POs</span>
                        {sc.qualityIssues > 0 && (
                          <Badge variant="warning" size="xs">{sc.qualityIssues} quality issues</Badge>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </CardBody>
        </Card>
      )}

      {/* ── ALL POs ───────────────────────────────────────────────────── */}
      {activeTab === 'all' && (
        <>
          <Card variant="default" padding="md">
            <div className="space-y-3">
              <div className="flex items-center gap-2 flex-wrap">
                <div className="relative flex-1 min-w-[240px]">
                  <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-subtle pointer-events-none" />
                  <input
                    placeholder="Search PO# or supplier…"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    className="input w-full pl-8"
                  />
                </div>
              </div>
              <div className="flex items-center gap-1.5 flex-wrap">
                {STATUSES.map(s => (
                  <button
                    key={s}
                    onClick={() => setStatusFilter(s)}
                    className={cn(
                      'text-[11px] px-2 py-1 rounded-md transition-colors',
                      statusFilter === s
                        ? 'bg-brand text-fg-on-accent font-medium'
                        : 'text-fg-muted hover:bg-surface-muted'
                    )}
                  >
                    {s.replace(/_/g, ' ')}
                  </button>
                ))}
              </div>
            </div>
          </Card>

          <DataTable
            density="default"
            data={orders}
            loading={loading}
            rowKey={(o) => o.id}
            onRowClick={(o) => { window.location.href = `/ops/purchasing/${o.id}` }}
            keyboardNav
            empty={<EmptyState icon="package" title="No purchase orders" description="Use AI Generate POs or create one manually." />}
            columns={[
              {
                key: 'status',
                header: 'Status',
                cell: (o) => <StatusBadge status={o.status} size="sm" />,
              },
              {
                key: 'poNumber',
                header: 'PO#',
                cell: (o) => (
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-semibold text-fg">{o.poNumber}</span>
                    {o.aiGenerated && <Badge variant="brand" size="xs">AI</Badge>}
                    {o.priority === 'URGENT' && <Badge variant="danger" size="xs">URGENT</Badge>}
                  </div>
                ),
              },
              {
                key: 'supplierName',
                header: 'Supplier',
                cell: (o) => (
                  <div>
                    <div className="text-sm text-fg">{o.supplierName}</div>
                    <div className="text-[11px] text-fg-subtle">{o.supplierType}</div>
                  </div>
                ),
              },
              {
                key: 'itemCount',
                header: 'Items',
                numeric: true,
                cell: (o) => <span className="tabular-nums">{o.itemCount}</span>,
              },
              {
                key: 'received',
                header: 'Received',
                numeric: true,
                cell: (o) => (
                  <span className={cn('tabular-nums', o.totalReceived >= o.totalOrdered ? 'text-data-positive' : 'text-accent')}>
                    {o.totalReceived}/{o.totalOrdered}
                  </span>
                ),
              },
              {
                key: 'totalCost',
                header: 'Total',
                numeric: true,
                heatmap: true,
                heatmapValue: (o) => o.totalCost,
                cell: (o) => <span className="tabular-nums font-semibold">{fmtMoney(o.totalCost)}</span>,
              },
              {
                key: 'expectedDate',
                header: 'ETA',
                hideOnMobile: true,
                cell: (o) => o.expectedDate
                  ? <span className="tabular-nums text-fg-muted">{new Date(o.expectedDate).toLocaleDateString()}</span>
                  : <span className="text-fg-subtle">—</span>,
              },
            ]}
          />
        </>
      )}
    </div>
  )
}

// ── helpers ──────────────────────────────────────────────────────────────

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-fg-muted">{label}</span>
      <span className="font-semibold font-numeric tabular-nums text-fg">{value}</span>
    </div>
  )
}
