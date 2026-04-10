'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { WorkflowAlerts } from './components/WorkflowAlerts'
import { ActionQueue } from './components/ActionQueue'
import { AIRecommendations } from './components/AIRecommendations'
import { DonutChart, HBarChart, Sparkline, ProgressRing } from './components/Charts'

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

export default function OpsDashboard() {
  const [data, setData] = useState<DashboardData | null>(null)
  const [productCategories, setProductCategories] = useState<ProductCategoryStat[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function loadAll() {
      try {
        const [dashResp, catResp] = await Promise.all([
          fetch('/api/ops/dashboard'),
          fetch('/api/ops/product-categories'),
        ])

        const [dashData, catData] = await Promise.all([
          dashResp.ok ? dashResp.json() : null,
          catResp.ok ? catResp.json() : { categories: [] },
        ])

        if (dashData) setData(dashData)
        if (catData.categories) {
          // Map API response to dashboard format — use top-level categories with product counts
          const mapped: ProductCategoryStat[] = catData.categories
            .filter((c: any) => !c.parentId && c.liveProductCount > 0)
            .map((c: any) => ({ name: c.name, count: c.liveProductCount || c.productCount || 0 }))
            .sort((a: ProductCategoryStat, b: ProductCategoryStat) => b.count - a.count)
          setProductCategories(mapped)
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
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#1B4F72]" />
      </div>
    )
  }

  const fmt = (n: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n)
  const fmtFull = (n: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)

  const orders = data?.orders
  const pos = data?.purchaseOrders

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Operations Dashboard</h1>
          <p className="text-sm text-gray-500 mt-1">
            Real-time overview of Abel Lumber operations
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/ops/jobs" className="px-3 py-1.5 text-sm bg-[#1B4F72] text-white rounded-lg hover:bg-[#154360] transition-colors">
            + New Job
          </Link>
          <button className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors">
            Export Report
          </button>
        </div>
      </div>

      {/* Primary KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KPICard
          label="Builder Accounts"
          value={data?.builders.total || 0}
          sub={`${data?.products.total?.toLocaleString() || 0} products in catalog`}
          color="blue"
          href="/ops/accounts"
        />
        <KPICard
          label="Sales Orders"
          value={orders?.total || 0}
          sub={`${orders?.active || 0} active · ${orders?.completed || 0} fulfilled`}
          color="orange"
          href="/ops/orders"
        />
        <KPICard
          label="Order Revenue"
          value={fmt(orders?.totalRevenue || 0)}
          sub={`${fmt(orders?.paidRevenue || 0)} collected`}
          color="green"
          href="/ops/orders"
          isString
        />
        <KPICard
          label="Purchase Orders"
          value={pos?.total || 0}
          sub={`${fmt(pos?.totalSpend || 0)} total spend`}
          color="purple"
          href="/ops/purchasing"
        />
      </div>

      {/* AI Recommendations - Click to Approve */}
      <div className="bg-white rounded-xl border p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <span className="text-lg">🧠</span>
            <h3 className="font-semibold text-gray-900">AI Recommendations</h3>
          </div>
          <Link href="/ops/ai/predictive" className="text-sm text-[#1B4F72] hover:text-[#E67E22]">
            View All →
          </Link>
        </div>
        <AIRecommendations />
      </div>

      {/* Two-column layout: Order Pipeline + Recent Orders */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Order Pipeline */}
        <div className="bg-white rounded-xl border p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-gray-900">Order Pipeline</h3>
            <Link href="/ops/orders" className="text-sm text-[#1B4F72] hover:text-[#E67E22]">
              View All →
            </Link>
          </div>
          <OrderPipeline byStatus={orders?.byStatus || {}} />
        </div>

        {/* Recent Orders */}
        <div className="bg-white rounded-xl border p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-gray-900">Recent Orders</h3>
            <Link href="/ops/orders" className="text-sm text-[#1B4F72] hover:text-[#E67E22]">
              All Orders →
            </Link>
          </div>
          <RecentOrdersList orders={data?.recentOrders || []} />
        </div>
      </div>

      {/* Three-column: Workflow Alerts / Payment Status / Quick Actions */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Workflow Alerts */}
        <div className="bg-white rounded-xl border p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-gray-900">Workflow Alerts</h3>
            <Link href="/ops/ai" className="text-xs text-[#1B4F72] hover:text-[#E67E22]">
              AI Tools →
            </Link>
          </div>
          <WorkflowAlerts />
        </div>

        {/* Payment Overview */}
        <div className="bg-white rounded-xl border p-5">
          <h3 className="font-semibold text-gray-900 mb-3">Payment Status</h3>
          <div className="space-y-3">
            <PaymentRow
              label="Paid"
              count={orders?.byPayment?.['PAID']?.count || 0}
              amount={orders?.paidRevenue || 0}
              color="text-green-600"
            />
            <PaymentRow
              label="Invoiced"
              count={orders?.byPayment?.['INVOICED']?.count || 0}
              amount={orders?.invoicedRevenue || 0}
              color="text-blue-600"
            />
            <PaymentRow
              label="Pending"
              count={orders?.byPayment?.['PENDING']?.count || 0}
              amount={orders?.pendingRevenue || 0}
              color="text-amber-600"
            />
            <PaymentRow
              label="Overdue"
              count={orders?.byPayment?.['OVERDUE']?.count || 0}
              amount={orders?.byPayment?.['OVERDUE']?.revenue || 0}
              color="text-red-600"
            />
          </div>
          <Link
            href="/ops/orders"
            className="block mt-4 text-center text-sm text-[#1B4F72] hover:text-[#E67E22]"
          >
            Manage Orders →
          </Link>
        </div>

        {/* Today's Action Queue */}
        <div className="bg-white rounded-xl border p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-gray-900">Today's Actions</h3>
            <span className="text-xs text-gray-400">Auto-refreshed</span>
          </div>
          <ActionQueue />
        </div>
      </div>

      {/* Charts Row: Product Categories + Top Builders */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Product Category Breakdown */}
        <div className="bg-white rounded-xl border p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-gray-900">Product Catalog</h3>
            <Link href="/ops/products" className="text-sm text-[#1B4F72] hover:text-[#E67E22]">
              View All →
            </Link>
          </div>
          {productCategories.length > 0 ? (
            <DonutChart
              data={productCategories.slice(0, 8).map((cat, i) => ({
                label: cat.name,
                value: cat.count,
                color: ['#1B4F72', '#E67E22', '#27AE60', '#8E44AD', '#3498DB', '#E74C3C', '#D97706', '#06B6D4', '#9CA3AF'][i] || '#9CA3AF',
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

        {/* Top Builders */}
        <div className="bg-white rounded-xl border p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-gray-900">Top Builders by Revenue</h3>
            <Link href="/ops/accounts" className="text-sm text-[#1B4F72] hover:text-[#E67E22]">
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

      {/* Revenue Trend + Operations Health + PO Breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Monthly Order Revenue */}
        <div className="bg-white rounded-xl border p-5">
          <h3 className="font-semibold text-gray-900 mb-2">Monthly Order Revenue</h3>
          <p className="text-2xl font-bold text-gray-900">{fmt(orders?.totalRevenue || 0)}</p>
          <p className="text-xs text-gray-500 mb-3">Total from {orders?.total || 0} orders</p>
          {(orders?.monthlyTrend?.length || 0) > 0 ? (
            <>
              <Sparkline
                data={orders!.monthlyTrend.map(m => m.revenue)}
                width={280}
                height={60}
                color="#1B4F72"
                fillColor="#1B4F72"
                showDots
              />
              <div className="flex justify-between mt-2">
                <span className="text-[10px] text-gray-400">
                  {orders!.monthlyTrend[0]?.month || ''}
                </span>
                <span className="text-[10px] text-gray-400">
                  {orders!.monthlyTrend[orders!.monthlyTrend.length - 1]?.month || ''}
                </span>
              </div>
            </>
          ) : (
            <p className="text-xs text-gray-400 text-center py-4">Trend data building...</p>
          )}
        </div>

        {/* Operations Health */}
        <div className="bg-white rounded-xl border p-5">
          <h3 className="font-semibold text-gray-900 mb-4">Operations Health</h3>
          <div className="flex items-center justify-around">
            <ProgressRing
              value={orders?.total ? Math.round(((orders.completed) / orders.total) * 100) : 0}
              color="#27AE60"
              label="Fulfillment Rate"
            />
            <ProgressRing
              value={orders?.totalRevenue ? Math.round((orders.paidRevenue / orders.totalRevenue) * 100) : 0}
              color="#1B4F72"
              label="Collection Rate"
            />
            <ProgressRing
              value={data?.products.total ? Math.min(Math.round((data.products.total / 3500) * 100), 100) : 0}
              color="#8E44AD"
              label="Catalog Coverage"
            />
          </div>
          <div className="mt-5 pt-4 border-t">
            <h4 className="text-xs font-semibold text-gray-500 uppercase mb-3">Key Metrics</h4>
            <div className="grid grid-cols-2 gap-3">
              <MetricItem label="Avg Order Value" value={fmtFull(orders?.total ? (orders.totalRevenue / orders.total) : 0)} href="/ops/orders" />
              <MetricItem label="Active Orders" value={String(orders?.active || 0)} href="/ops/orders?status=active" />
              <MetricItem label="Products" value={(data?.products.total || 0).toLocaleString()} href="/ops/products" />
              <MetricItem label="PO Spend" value={fmt(pos?.totalSpend || 0)} href="/ops/purchasing" />
            </div>
          </div>
        </div>

        {/* Monthly Order Volume */}
        <div className="bg-white rounded-xl border p-5">
          <h3 className="font-semibold text-gray-900 mb-2">Monthly Order Volume</h3>
          <p className="text-2xl font-bold text-gray-900">{orders?.total || 0}</p>
          <p className="text-xs text-gray-500 mb-3">Total orders processed</p>
          {(orders?.monthlyTrend?.length || 0) > 0 ? (
            <>
              <Sparkline
                data={orders!.monthlyTrend.map(m => m.count)}
                width={280}
                height={60}
                color="#E67E22"
                fillColor="#E67E22"
                showDots
              />
              <div className="flex justify-between mt-2">
                <span className="text-[10px] text-gray-400">
                  {orders!.monthlyTrend[0]?.month || ''}
                </span>
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
    </div>
  )
}

// ─── Sub-components ─────────────────────────────────────────────────

function KPICard({
  label, value, sub, color, href, isString,
}: {
  label: string; value: number | string; sub: string; color: string; href: string; isString?: boolean
}) {
  const colorMap: Record<string, string> = {
    blue: 'border-l-[#1B4F72]',
    orange: 'border-l-[#E67E22]',
    green: 'border-l-[#27AE60]',
    purple: 'border-l-[#8E44AD]',
    red: 'border-l-[#E74C3C]',
  }

  return (
    <Link href={href}>
      <div className={`bg-white rounded-xl border border-l-4 ${colorMap[color] || colorMap.blue} p-4 hover:shadow-md transition-shadow cursor-pointer`}>
        <p className="text-xs text-gray-500 uppercase tracking-wide">{label}</p>
        <p className="text-2xl font-bold text-gray-900 mt-1">
          {isString ? value : typeof value === 'number' ? value.toLocaleString() : value}
        </p>
        <p className="text-xs text-gray-400 mt-1">{sub}</p>
      </div>
    </Link>
  )
}

function OrderPipeline({ byStatus }: { byStatus: Record<string, { count: number; revenue: number }> }) {
  const stages = [
    { key: 'RECEIVED', label: 'Received', color: '#95A5A6' },
    { key: 'CONFIRMED', label: 'Confirmed', color: '#3498DB' },
    { key: 'IN_PRODUCTION', label: 'In Production', color: '#E67E22' },
    { key: 'READY_TO_SHIP', label: 'Ready to Ship', color: '#F39C12' },
    { key: 'SHIPPED', label: 'Shipped', color: '#1ABC9C' },
    { key: 'DELIVERED', label: 'Delivered', color: '#2ECC71' },
    { key: 'COMPLETE', label: 'Complete', color: '#27AE60' },
  ]

  const fmt = (n: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n)

  const totalOrders = stages.reduce((sum, s) => sum + (byStatus[s.key]?.count || 0), 0)

  return (
    <div className="space-y-2">
      {stages.map((stage) => {
        const count = byStatus[stage.key]?.count || 0
        const revenue = byStatus[stage.key]?.revenue || 0
        const pct = totalOrders > 0 ? (count / totalOrders) * 100 : 0
        return (
          <Link key={stage.key} href={`/ops/orders?status=${stage.key}`} className="flex items-center gap-3 p-1.5 rounded-lg hover:bg-gray-50 transition-colors group">
            <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: stage.color }} />
            <span className="text-sm text-gray-600 w-[110px] group-hover:text-[#1B4F72] group-hover:font-medium">{stage.label}</span>
            <div className="flex-1 bg-gray-100 rounded-full h-2">
              <div className="h-2 rounded-full transition-all" style={{ width: `${Math.max(pct, count > 0 ? 2 : 0)}%`, backgroundColor: stage.color }} />
            </div>
            <span className="text-xs text-gray-400 w-20 text-right hidden sm:inline">{count > 0 ? fmt(revenue) : ''}</span>
            <span className={`text-sm font-medium w-8 text-right ${count > 0 ? 'text-gray-900' : 'text-gray-300'}`}>
              {count}
            </span>
          </Link>
        )
      })}
      {totalOrders === 0 && (
        <p className="text-xs text-gray-400 text-center pt-2">
          No orders in the pipeline yet
        </p>
      )}
    </div>
  )
}

function RecentOrdersList({ orders }: { orders: DashboardData['recentOrders'] }) {
  if (orders.length === 0) {
    return (
      <div className="text-center text-gray-400 text-sm py-8">
        <p className="text-3xl mb-2">📦</p>
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

  const paymentIcons: Record<string, string> = {
    PAID: '✅',
    INVOICED: '📄',
    PENDING: '⏳',
    OVERDUE: '🔴',
  }

  const fmt = (n: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n)

  return (
    <div className="space-y-2">
      {orders.map((order) => (
        <Link key={order.id} href={`/ops/orders/${order.id}`} className="flex items-center gap-3 p-2 rounded-lg hover:bg-gray-50 hover:shadow-sm transition-all cursor-pointer group">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <p className="text-sm font-medium text-gray-900 truncate group-hover:text-[#1B4F72]">{order.builderName}</p>
              <span className="text-xs text-gray-400">{paymentIcons[order.paymentStatus] || ''}</span>
            </div>
            <p className="text-xs text-gray-500">{order.orderNumber}</p>
          </div>
          <span className="text-sm font-medium text-gray-900">{fmt(order.total)}</span>
          <span className={`text-xs px-2 py-0.5 rounded-full whitespace-nowrap ${statusColors[order.status] || 'bg-gray-100 text-gray-600'}`}>
            {order.status.replace(/_/g, ' ')}
          </span>
        </Link>
      ))}
    </div>
  )
}

function PaymentRow({ label, count, amount, color }: { label: string; count: number; amount: number; color: string }) {
  const fmt = (n: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n)

  return (
    <Link href={`/ops/orders?payment=${label.toUpperCase()}`} className="flex justify-between items-center p-1.5 rounded-lg hover:bg-gray-50 transition-colors group">
      <div className="flex items-center gap-2">
        <span className="text-sm text-gray-600 group-hover:text-[#1B4F72] group-hover:font-medium">{label}</span>
        <span className="text-xs text-gray-400">({count})</span>
      </div>
      <span className={`text-sm font-semibold ${color}`}>{fmt(amount)}</span>
    </Link>
  )
}

function MetricItem({ label, value, href }: { label: string; value: string; href?: string }) {
  const content = (
    <div className={href ? "p-1.5 rounded-lg hover:bg-gray-50 transition-colors cursor-pointer group" : ""}>
      <p className={`text-xs text-gray-500 ${href ? 'group-hover:text-[#1B4F72]' : ''}`}>{label}</p>
      <p className="text-sm font-semibold text-gray-900">{value}</p>
    </div>
  )
  return href ? <Link href={href}>{content}</Link> : content
}
