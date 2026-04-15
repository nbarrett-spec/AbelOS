'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { BarChart, Briefcase, TrendingUp, ShoppingCart, Users, Package, AlertCircle } from 'lucide-react'
import { WorkflowAlerts } from './components/WorkflowAlerts'
import { ActionQueue } from './components/ActionQueue'
import { AIRecommendations } from './components/AIRecommendations'
import { DonutChart, HBarChart, Sparkline, ProgressRing } from './components/Charts'
import { ContextStrip } from './components/ContextStrip'
import { AlertRail } from './components/AlertRail'
import { KPICardElite } from './components/KPICardElite'
import { ActivityFeed } from './components/ActivityFeed'

interface DashboardData {
  builders: { total: number }
  products: { total: number }
  orders: {
    total: number
    active: number
    completed: number
    totalRevenue: number
    paidRevenue: number
    invoicedRevenue: number
    pendingRevenue: number
    byStatus: Record<string, { count: number; revenue: number }>
    byPayment: Record<string, { count: number; revenue: number }>
    monthlyTrend: Array<{ month: string; count: number; revenue: number }>
  }
  purchaseOrders: {
    total: number
    totalSpend: number
    byStatus: Record<string, { count: number; total: number }>
  }
  topBuilders: Array<{ name: string; orderCount: number; totalValue: number }>
  recentOrders: Array<{
    id: string
    orderNumber: string
    builderName: string
    total: number
    status: string
    paymentStatus: string
    createdAt: string
  }>
}

interface ProductCategoryStat {
  name: string
  count: number
}

interface SystemAlert {
  id: string
  type: 'critical' | 'warning' | 'info' | 'success'
  title: string
  count: number
  href: string
}

export default function OpsDashboard() {
  const [data, setData] = useState<DashboardData | null>(null)
  const [productCategories, setProductCategories] = useState<ProductCategoryStat[]>([])
  const [systemAlerts, setSystemAlerts] = useState<SystemAlert[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function loadAll() {
      try {
        const [dashResp, catResp, alertsResp] = await Promise.all([
          fetch('/api/ops/dashboard'),
          fetch('/api/ops/product-categories'),
          fetch('/api/ops/system-alerts'),
        ])

        const [dashData, catData, alertsData] = await Promise.all([
          dashResp.ok ? dashResp.json() : null,
          catResp.ok ? catResp.json() : { categories: [] },
          alertsResp.ok ? alertsResp.json() : { alerts: [] },
        ])

        if (dashData) setData(dashData)
        if (catData.categories) {
          const mapped: ProductCategoryStat[] = catData.categories
            .filter((c: any) => !c.parentId && c.liveProductCount > 0)
            .map((c: any) => ({ name: c.name, count: c.liveProductCount || c.productCount || 0 }))
            .sort((a: ProductCategoryStat, b: ProductCategoryStat) => b.count - a.count)
          setProductCategories(mapped)
        }
        if (alertsData?.alerts) {
          setSystemAlerts(alertsData.alerts)
        }
      } catch (err) {
        console.error('Failed to load dashboard:', err)
      } finally {
        setLoading(false)
      }
    }
    loadAll()
  }, [])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-abel-navy" />
      </div>
    )
  }

  const fmt = (n: number) =>
    new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(n)

  const orders = data?.orders
  const pos = data?.purchaseOrders

  const todayDate = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  })

  return (
    <div className="space-y-6">
      {/* Greeting + Context Strip */}
      <ContextStrip
        greeting="Welcome back to Operations"
        currentDate={todayDate}
        kpis={[
          { label: 'Orders Open', value: orders?.active || 0, severity: 'neutral' },
          { label: 'Deliveries Today', value: 0, severity: 'positive' },
          { label: 'Revenue MTD', value: fmt(orders?.totalRevenue || 0), severity: 'positive' },
          { label: 'Outstanding AR', value: fmt(orders?.pendingRevenue || 0), severity: 'warning' },
        ]}
      />

      {/* Alert Rail */}
      <AlertRail alerts={systemAlerts} />

      {/* KPI Grid — 2x2 desktop, 1 mobile */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICardElite
          label="Builder Accounts"
          value={data?.builders.total || 0}
          color="navy"
          context={`${data?.products.total?.toLocaleString() || 0} products`}
          href="/ops/accounts"
        />
        <KPICardElite
          label="Sales Orders"
          value={orders?.total || 0}
          color="orange"
          context={`${orders?.active || 0} active · ${orders?.completed || 0} fulfilled`}
          delta={(orders?.active || 0) > 0 ? 5 : 0}
          href="/ops/orders"
        />
        <KPICardElite
          label="Order Revenue"
          value={fmt(orders?.totalRevenue || 0)}
          color="green"
          context={`${fmt(orders?.paidRevenue || 0)} collected`}
          href="/ops/orders"
        />
        <KPICardElite
          label="Purchase Orders"
          value={pos?.total || 0}
          color="slate"
          context={`${fmt(pos?.totalSpend || 0)} total spend`}
          href="/ops/purchasing"
        />
      </div>

      {/* Top section: AI Recommendations */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-2 h-6 bg-gradient-to-b from-abel-orange to-abel-orange rounded-full" />
            <h2 className="text-lg font-semibold text-gray-900">AI Recommendations</h2>
          </div>
          <Link href="/ops/ai/predictive" className="text-sm text-abel-navy hover:text-abel-orange transition-colors font-medium">
            View All →
          </Link>
        </div>
        <AIRecommendations />
      </div>

      {/* Two-column: Pipeline + Recent Orders */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
              <BarChart className="w-5 h-5 text-abel-navy" />
              Order Pipeline
            </h3>
            <Link href="/ops/orders" className="text-sm text-abel-navy hover:text-abel-orange font-medium">
              View All →
            </Link>
          </div>
          <OrderPipeline byStatus={orders?.byStatus || {}} />
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
              <Package className="w-5 h-5 text-abel-orange" />
              Recent Orders
            </h3>
            <Link href="/ops/orders" className="text-sm text-abel-navy hover:text-abel-orange font-medium">
              All Orders →
            </Link>
          </div>
          <RecentOrdersList orders={data?.recentOrders || []} />
        </div>
      </div>

      {/* Three-column: Alerts + Payment + Actions */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <AlertCircle className="w-5 h-5 text-danger-500" />
            Workflow Alerts
          </h3>
          <WorkflowAlerts />
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Payment Status</h3>
          <div className="space-y-3">
            <PaymentRow
              label="Paid"
              count={orders?.byPayment?.['PAID']?.count || 0}
              amount={orders?.paidRevenue || 0}
              color="text-success-600"
            />
            <PaymentRow
              label="Invoiced"
              count={orders?.byPayment?.['INVOICED']?.count || 0}
              amount={orders?.invoicedRevenue || 0}
              color="text-info-600"
            />
            <PaymentRow
              label="Pending"
              count={orders?.byPayment?.['PENDING']?.count || 0}
              amount={orders?.pendingRevenue || 0}
              color="text-warning-600"
            />
            <PaymentRow
              label="Overdue"
              count={orders?.byPayment?.['OVERDUE']?.count || 0}
              amount={orders?.byPayment?.['OVERDUE']?.revenue || 0}
              color="text-danger-600"
            />
          </div>
          <Link href="/ops/orders" className="block mt-4 text-center text-sm text-abel-navy hover:text-abel-orange font-medium">
            Manage Orders →
          </Link>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center justify-between">
            <span className="flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-abel-green" />
              Today's Actions
            </span>
            <span className="text-xs text-gray-500 font-normal">Auto-refreshed</span>
          </h3>
          <ActionQueue />
        </div>
      </div>

      {/* Product Catalog + Top Builders */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
              <Package className="w-5 h-5 text-abel-slate" />
              Product Catalog
            </h3>
            <Link href="/ops/products" className="text-sm text-abel-navy hover:text-abel-orange font-medium">
              View All →
            </Link>
          </div>
          {productCategories.length > 0 ? (
            <DonutChart
              data={productCategories.slice(0, 8).map((cat, i) => ({
                label: cat.name,
                value: cat.count,
                color: ['#1B4F72', '#E67E22', '#27AE60', '#8E44AD', '#3498DB', '#E74C3C', '#D97706', '#06B6D4'][i] || '#9CA3AF',
              }))}
              size={150}
              thickness={22}
              centerValue={(data?.products.total || 0).toLocaleString()}
              centerLabel="products"
            />
          ) : (
            <p className="text-sm text-gray-400 text-center py-8">Loading product data...</p>
          )}
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
              <Users className="w-5 h-5 text-abel-orange" />
              Top Builders
            </h3>
            <Link href="/ops/accounts" className="text-sm text-abel-navy hover:text-abel-orange font-medium">
              All Accounts →
            </Link>
          </div>
          {(data?.topBuilders?.length || 0) > 0 ? (
            <HBarChart
              data={data!.topBuilders.map((b, i) => ({
                label: b.name.length > 20 ? b.name.slice(0, 18) + '...' : b.name,
                value: b.totalValue,
                color: ['#1B4F72', '#E67E22', '#27AE60', '#8E44AD', '#3498DB'][i],
              }))}
              formatValue={(v) => fmt(v)}
            />
          ) : (
            <p className="text-sm text-gray-400 text-center py-8">No builder data yet</p>
          )}
        </div>
      </div>

      {/* Revenue + Operations Health + PO Breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-2">Monthly Revenue</h3>
          <p className="text-3xl font-bold text-abel-navy">{fmt(orders?.totalRevenue || 0)}</p>
          <p className="text-xs text-gray-500 mb-4">From {orders?.total || 0} orders</p>
          {(orders?.monthlyTrend?.length || 0) > 0 ? (
            <>
              <Sparkline
                data={orders!.monthlyTrend.map((m) => m.revenue)}
                width={280}
                height={60}
                color="#1B4F72"
                fillColor="#1B4F72"
                showDots
              />
              <div className="flex justify-between mt-2">
                <span className="text-[10px] text-gray-400">{orders!.monthlyTrend[0]?.month || ''}</span>
                <span className="text-[10px] text-gray-400">
                  {orders!.monthlyTrend[orders!.monthlyTrend.length - 1]?.month || ''}
                </span>
              </div>
            </>
          ) : (
            <p className="text-xs text-gray-400 text-center py-4">Trend data building...</p>
          )}
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Ops Health</h3>
          <div className="flex items-center justify-around mb-5">
            <ProgressRing
              value={orders?.total ? Math.round(((orders.completed) / orders.total) * 100) : 0}
              color="#27AE60"
              label="Fulfillment"
            />
            <ProgressRing
              value={orders?.totalRevenue ? Math.round((orders.paidRevenue / orders.totalRevenue) * 100) : 0}
              color="#1B4F72"
              label="Collection"
            />
            <ProgressRing
              value={data?.products.total ? Math.min(Math.round((data.products.total / 3500) * 100), 100) : 0}
              color="#8E44AD"
              label="Catalog"
            />
          </div>
          <div className="pt-4 border-t">
            <p className="text-xs font-semibold text-gray-500 uppercase mb-3">Key Metrics</p>
            <div className="grid grid-cols-2 gap-3">
              <MetricItem label="Avg Order" value={fmt(orders?.total ? orders.totalRevenue / orders.total : 0)} />
              <MetricItem label="Active Orders" value={String(orders?.active || 0)} />
              <MetricItem label="Products" value={(data?.products.total || 0).toLocaleString()} />
              <MetricItem label="PO Spend" value={fmt(pos?.totalSpend || 0)} />
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-2">Order Volume</h3>
          <p className="text-3xl font-bold text-abel-orange">{orders?.total || 0}</p>
          <p className="text-xs text-gray-500 mb-4">Total orders processed</p>
          {(orders?.monthlyTrend?.length || 0) > 0 ? (
            <>
              <Sparkline
                data={orders!.monthlyTrend.map((m) => m.count)}
                width={280}
                height={60}
                color="#E67E22"
                fillColor="#E67E22"
                showDots
              />
              <div className="flex justify-between mt-2">
                <span className="text-[10px] text-gray-400">{orders!.monthlyTrend[0]?.month || ''}</span>
                <span className="text-[10px] text-gray-400">
                  {orders!.monthlyTrend[orders!.monthlyTrend.length - 1]?.month || ''}
                </span>
              </div>
            </>
          ) : (
            <p className="text-xs text-gray-400 text-center py-4">Volume data building...</p>
          )}
        </div>
      </div>

      {/* Activity Feed */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
          <ShoppingCart className="w-5 h-5 text-abel-navy" />
          Live Activity Feed
        </h3>
        <ActivityFeed />
      </div>
    </div>
  )
}

// ─── Sub-components ─────────────────────────────────────────────────

function OrderPipeline({ byStatus }: { byStatus: Record<string, { count: number; revenue: number }> }) {
  const stages = [
    { key: 'RECEIVED', label: 'Received', color: '#95A5A6' },
    { key: 'CONFIRMED', label: 'Confirmed', color: '#3498DB' },
    { key: 'IN_PRODUCTION', label: 'Production', color: '#E67E22' },
    { key: 'READY_TO_SHIP', label: 'Ready', color: '#F39C12' },
    { key: 'SHIPPED', label: 'Shipped', color: '#1ABC9C' },
    { key: 'DELIVERED', label: 'Delivered', color: '#2ECC71' },
    { key: 'COMPLETE', label: 'Complete', color: '#27AE60' },
  ]

  const fmt = (n: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0 }).format(n)

  const totalOrders = stages.reduce((sum, s) => sum + (byStatus[s.key]?.count || 0), 0)

  return (
    <div className="space-y-3">
      {stages.map((stage) => {
        const count = byStatus[stage.key]?.count || 0
        const revenue = byStatus[stage.key]?.revenue || 0
        const pct = totalOrders > 0 ? (count / totalOrders) * 100 : 0
        return (
          <Link key={stage.key} href={`/ops/orders?status=${stage.key}`} className="block">
            <div className="flex items-center gap-3 p-2 rounded-lg hover:bg-gray-50 transition-colors group">
              <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: stage.color }} />
              <span className="text-sm text-gray-600 w-[100px] group-hover:text-abel-navy group-hover:font-medium">{stage.label}</span>
              <div className="flex-1 bg-gray-100 rounded-full h-2.5">
                <div className="h-2.5 rounded-full transition-all" style={{ width: `${Math.max(pct, count > 0 ? 2 : 0)}%`, backgroundColor: stage.color }} />
              </div>
              <span className="text-xs text-gray-400 w-16 text-right hidden sm:inline">{count > 0 ? fmt(revenue) : ''}</span>
              <span className={`text-sm font-semibold w-8 text-right ${count > 0 ? 'text-gray-900' : 'text-gray-300'}`}>{count}</span>
            </div>
          </Link>
        )
      })}
      {totalOrders === 0 && <p className="text-xs text-gray-400 text-center pt-4">No orders in pipeline</p>}
    </div>
  )
}

function RecentOrdersList({ orders }: { orders: DashboardData['recentOrders'] }) {
  if (orders.length === 0) {
    return (
      <div className="text-center text-gray-400 text-sm py-8">
        <Package className="w-8 h-8 mx-auto mb-2 opacity-50" />
        <p>No recent orders</p>
      </div>
    )
  }

  const statusColors: Record<string, string> = {
    RECEIVED: 'bg-gray-100 text-gray-700',
    CONFIRMED: 'bg-blue-100 text-blue-700',
    IN_PRODUCTION: 'bg-orange-100 text-orange-700',
    READY_TO_SHIP: 'bg-yellow-100 text-yellow-700',
    SHIPPED: 'bg-teal-100 text-teal-700',
    DELIVERED: 'bg-green-100 text-green-700',
    COMPLETE: 'bg-emerald-100 text-emerald-700',
  }

  const fmt = (n: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0 }).format(n)

  return (
    <div className="space-y-2">
      {orders.map((order) => (
        <Link key={order.id} href={`/ops/orders/${order.id}`} className="block">
          <div className="flex items-center gap-3 p-2 rounded-lg hover:bg-gray-50 transition-colors group">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-900 truncate group-hover:text-abel-navy">{order.builderName}</p>
              <p className="text-xs text-gray-500">{order.orderNumber}</p>
            </div>
            <span className="text-sm font-medium text-gray-900">{fmt(order.total)}</span>
            <span className={`text-xs px-2 py-1 rounded-full whitespace-nowrap ${statusColors[order.status] || 'bg-gray-100'}`}>
              {order.status.replace(/_/g, ' ')}
            </span>
          </div>
        </Link>
      ))}
    </div>
  )
}

function PaymentRow({ label, count, amount, color }: { label: string; count: number; amount: number; color: string }) {
  const fmt = (n: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0 }).format(n)

  return (
    <Link href={`/ops/orders?payment=${label.toUpperCase()}`} className="block">
      <div className="flex justify-between items-center p-2 rounded-lg hover:bg-gray-50 transition-colors group">
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-600 group-hover:text-abel-navy group-hover:font-medium">{label}</span>
          <span className="text-xs text-gray-400">({count})</span>
        </div>
        <span className={`text-sm font-semibold ${color}`}>{fmt(amount)}</span>
      </div>
    </Link>
  )
}

function MetricItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="p-2 rounded-lg hover:bg-gray-50 transition-colors">
      <p className="text-xs text-gray-500">{label}</p>
      <p className="text-sm font-semibold text-gray-900 mt-1">{value}</p>
    </div>
  )
}
