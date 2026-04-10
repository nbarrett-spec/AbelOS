'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/hooks/useAuth'
import OnboardingChecklist from '@/components/OnboardingChecklist'

interface ActionItem {
  id: string
  type: string
  priority: string
  icon: string
  title: string
  subtitle: string
  action: string
  href: string
}

interface ReorderAlert {
  productId: string
  sku: string
  name: string
  category: string
  urgency: 'OVERDUE' | 'DUE_SOON' | 'UPCOMING' | 'LATER'
  daysUntilReorder: number
  avgQuantity: number
  avgSpend: number
}

interface RecommendedProduct {
  id: string
  sku: string
  name: string
  category: string
  builderPrice: number
  reason: string
}

interface InsightsData {
  reorderAlerts: ReorderAlert[]
  recommendations: RecommendedProduct[]
  reorderSummary: { overdueCount: number; dueSoonCount: number; estimatedMonthlySpend: number }
  tierName: string
  ytdSavings: number
}

const ORDER_STATUS_LABELS: Record<string, { label: string; color: string; icon: string }> = {
  RECEIVED:      { label: 'Received',      color: 'bg-blue-500/10 text-blue-400',    icon: '📋' },
  CONFIRMED:     { label: 'Confirmed',     color: 'bg-indigo-500/10 text-indigo-400', icon: '✅' },
  IN_PRODUCTION: { label: 'In Production', color: 'bg-amber-500/10 text-amber-400',  icon: '🔨' },
  READY_TO_SHIP: { label: 'Ready to Ship', color: 'bg-emerald-500/10 text-emerald-400', icon: '📦' },
  SHIPPED:       { label: 'Shipped',       color: 'bg-cyan-500/10 text-cyan-400',    icon: '🚚' },
  DELIVERED:     { label: 'Delivered',     color: 'bg-violet-500/10 text-violet-400', icon: '✓' },
  COMPLETE:      { label: 'Complete',      color: 'bg-emerald-500/10 text-emerald-400',  icon: '🏁' },
}

const PAYMENT_TERM_LABELS: Record<string, string> = {
  PAY_AT_ORDER: 'Pay at Order',
  PAY_ON_DELIVERY: 'Pay on Delivery',
  NET_15: 'Net 15',
  NET_30: 'Net 30',
}

interface AccountHealth {
  account: {
    companyName: string
    contactName: string
    status: string
    paymentTerm: string
    creditLimit: number
    accountBalance: number
    creditAvailable: number
  }
  invoices: {
    totalOutstanding: number
    overdueAmount: number
    overdueCount: number
    openInvoiceCount: number
    paidLast30Days: number
  }
  orders: {
    totalOrders: number
    activeOrders: number
    lifetimeValue: number
    last30DaysValue: number
  }
  upcomingDeliveries: Array<{
    id: string
    orderNumber: string
    total: number
    status: string
    deliveryDate: string
    deliveryNotes: string | null
    itemCount: number
  }>
  recentCompletedOrders: Array<{
    id: string
    orderNumber: string
    total: number
    status: string
    createdAt: string
    itemCount: number
  }>
  accountRep: {
    firstName: string
    lastName: string
    email: string
    phone: string
    title: string
  } | null
  recentPayments: Array<{
    id: string
    amount: number
    method: string
    reference: string | null
    receivedAt: string
    invoiceNumber: string
  }>
}

interface OrderSummary {
  id: string
  orderNumber: string
  status: string
  total: number
  createdAt: string
  deliveryDate?: string
  projectName?: string
  itemCount: number
}

function formatCurrency(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n)
}

function formatCurrencyFull(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)
}

function daysUntil(dateStr: string) {
  const d = new Date(dateStr)
  const now = new Date()
  const diff = Math.ceil((d.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
  return diff
}

function formatDeliveryDate(dateStr: string) {
  const d = new Date(dateStr)
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

function getCurrentDate() {
  const now = new Date()
  return now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
}

export default function DashboardPage() {
  const { builder, loading: authLoading } = useAuth()
  const router = useRouter()
  const [health, setHealth] = useState<AccountHealth | null>(null)
  const [orders, setOrders] = useState<OrderSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [healthLoading, setHealthLoading] = useState(true)
  const [reorderingId, setReorderingId] = useState<string | null>(null)
  const [reorderSuccess, setReorderSuccess] = useState<string | null>(null)
  const [actionItems, setActionItems] = useState<ActionItem[]>([])
  const [insights, setInsights] = useState<InsightsData | null>(null)

  const fetchInsights = useCallback(async () => {
    try {
      const [reorderRes, recsRes, pricingRes] = await Promise.all([
        fetch('/api/builder/reorder-forecast').then(r => r.ok ? r.json() : null).catch(() => null),
        fetch('/api/builder/recommendations').then(r => r.ok ? r.json() : null).catch(() => null),
        fetch('/api/builder/pricing-intelligence').then(r => r.ok ? r.json() : null).catch(() => null),
      ])
      const alerts: ReorderAlert[] = (reorderRes?.upcomingReorders || [])
        .filter((r: any) => r.urgency === 'OVERDUE' || r.urgency === 'DUE_SOON')
        .slice(0, 4)
      const recs: RecommendedProduct[] = (recsRes?.buyAgain || recsRes?.trendingInCategory || []).slice(0, 4)
      const summary = reorderRes?.reorderSummary || { overdueCount: 0, dueSoonCount: 0, estimatedMonthlySpend: 0 }
      const savings = (pricingRes?.savingsBreakdown || []).reduce((sum: number, m: any) => sum + (Number(m.savings) || 0), 0)
      setInsights({
        reorderAlerts: alerts,
        recommendations: recs,
        reorderSummary: summary,
        tierName: pricingRes?.tierStatus?.currentTier || 'STANDARD',
        ytdSavings: savings,
      })
    } catch (err) {
      console.error('[Dashboard] Failed to load insights and reorder data:', err)
    }
  }, [])

  const fetchActions = useCallback(async () => {
    try {
      const res = await fetch('/api/dashboard/actions')
      if (res.ok) {
        const data = await res.json()
        setActionItems(data.actions || [])
      }
    } catch (err) {
      console.error('[Dashboard] Failed to load action items:', err)
    }
  }, [])

  useEffect(() => {
    if (builder) {
      Promise.all([fetchHealth(), fetchOrders(), fetchActions(), fetchInsights()])
        .finally(() => setLoading(false))
    }
  }, [builder])

  async function fetchHealth() {
    try {
      setHealthLoading(true)
      const res = await fetch('/api/account/health')
      if (res.ok) {
        const data = await res.json()
        setHealth(data)
      }
    } catch (err) {
      console.error('[Dashboard] Failed to load account health:', err)
    } finally {
      setHealthLoading(false)
    }
  }

  async function fetchOrders() {
    try {
      const res = await fetch('/api/orders')
      if (res.ok) {
        const data = await res.json()
        setOrders((data.orders || []).slice(0, 10))
      }
    } catch (err) {
      console.error('[Dashboard] Failed to load orders:', err)
    }
  }

  async function handleReorder(orderId: string) {
    try {
      setReorderingId(orderId)
      setReorderSuccess(null)
      const res = await fetch(`/api/orders/${orderId}/reorder`, { method: 'POST' })
      if (res.ok) {
        const data = await res.json()
        setReorderSuccess(`${data.itemsAdded} item${data.itemsAdded !== 1 ? 's' : ''} added to cart from ${data.orderNumber}`)
        setTimeout(() => setReorderSuccess(null), 4000)
      }
    } catch (err) {
      console.error('[Dashboard] Failed to reorder:', err)
    } finally {
      setReorderingId(null)
    }
  }

  if (authLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="w-8 h-8 border-4 border-amber-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!builder) {
    return (
      <div className="text-center py-20">
        <p className="text-gray-400">Please sign in to access your dashboard.</p>
        <Link href="/login" className="inline-block mt-4 px-6 py-2 bg-amber-500 text-black rounded-xl font-semibold hover:bg-amber-400 transition-colors">Sign In</Link>
      </div>
    )
  }

  const activeOrders = orders.filter((o: OrderSummary) => !['COMPLETE', 'DELIVERED', 'CANCELLED'].includes(o.status))
  const h = health

  return (
    <div className="space-y-6">
      {/* Welcome + Quick Actions */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-white">
            Welcome back, {builder.contactName?.split(' ')[0] || 'Builder'}
          </h1>
          <p className="text-gray-400 text-sm mt-1">{getCurrentDate()}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link href="/catalog" className="px-3 sm:px-4 py-2 bg-gray-800 border border-gray-700 text-gray-300 rounded-xl text-xs sm:text-sm font-medium hover:bg-gray-700 hover:border-gray-600 transition-colors">
            Catalog
          </Link>
          <Link href="/dashboard/quotes" className="hidden sm:inline-flex px-4 py-2 bg-gray-800 border border-gray-700 text-gray-300 rounded-xl text-sm font-medium hover:bg-gray-700 hover:border-gray-600 transition-colors">
            Request Quote
          </Link>
          <Link href="/projects/new" className="px-3 sm:px-4 py-2 bg-amber-500 text-black rounded-xl text-xs sm:text-sm font-semibold hover:bg-amber-400 transition-colors">
            New Project
          </Link>
        </div>
      </div>

      {/* Onboarding Checklist */}
      <OnboardingChecklist />

      {/* Account Health Banner */}
      {h && (
        <div className="bg-gradient-to-r from-amber-500/10 to-amber-500/5 border border-amber-500/20 rounded-2xl p-6 backdrop-blur">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="border-l-4 border-amber-500 pl-4">
              <p className="text-xs text-gray-400 uppercase tracking-wider">Outstanding Balance</p>
              <p className="text-2xl font-bold text-white mt-1">{formatCurrency(h.invoices.totalOutstanding)}</p>
              {h.invoices.overdueCount > 0 && (
                <p className="text-xs text-red-400 mt-1">{h.invoices.overdueCount} overdue ({formatCurrency(h.invoices.overdueAmount)})</p>
              )}
            </div>
            <div className="border-l-4 border-emerald-500 pl-4">
              <p className="text-xs text-gray-400 uppercase tracking-wider">Credit Available</p>
              <p className="text-2xl font-bold text-white mt-1">{formatCurrency(h.account.creditAvailable)}</p>
              <p className="text-xs text-gray-400 mt-1">of {formatCurrency(h.account.creditLimit)} limit</p>
            </div>
            <div className="border-l-4 border-blue-500 pl-4">
              <p className="text-xs text-gray-400 uppercase tracking-wider">Active Orders</p>
              <p className="text-2xl font-bold text-white mt-1">{h.orders.activeOrders}</p>
              <p className="text-xs text-gray-400 mt-1">{h.orders.totalOrders} lifetime</p>
            </div>
            <div className="border-l-4 border-cyan-500 pl-4">
              <p className="text-xs text-gray-400 uppercase tracking-wider">Payment Terms</p>
              <p className="text-2xl font-bold text-white mt-1">{PAYMENT_TERM_LABELS[h.account.paymentTerm] || h.account.paymentTerm}</p>
              <Link href="/dashboard/invoices" className="text-xs text-amber-400 hover:text-amber-300 mt-1 inline-block transition-colors">View Invoices →</Link>
            </div>
          </div>
          {/* Credit usage bar */}
          {h.account.creditLimit > 0 && (
            <div className="mt-4 pt-3 border-t border-gray-700/50">
              <div className="flex items-center justify-between text-xs text-gray-400 mb-1">
                <span>Credit Usage</span>
                <span>{Math.round((h.account.accountBalance / h.account.creditLimit) * 100)}% used</span>
              </div>
              <div className="w-full bg-gray-800/50 rounded-full h-2">
                <div
                  className="h-2 rounded-full transition-all"
                  style={{
                    width: `${Math.min(100, (h.account.accountBalance / h.account.creditLimit) * 100)}%`,
                    backgroundColor: (h.account.accountBalance / h.account.creditLimit) > 0.8 ? '#EF4444' : '#F59E0B',
                  }}
                />
              </div>
            </div>
          )}
        </div>
      )}

      {/* ⚡ Intelligence Insights Strip */}
      {insights && (insights.reorderAlerts.length > 0 || insights.ytdSavings > 0) && (
        <div className="bg-gradient-to-r from-[#1B4F72]/20 to-[#E67E22]/10 border border-[#1B4F72]/30 rounded-2xl p-5 backdrop-blur">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-white flex items-center gap-2">
              <span>⚡</span> Smart Insights
              {insights.tierName && insights.tierName !== 'STANDARD' && (
                <span className="text-xs px-2 py-0.5 rounded-lg bg-amber-500/20 text-amber-400 font-bold">{insights.tierName}</span>
              )}
            </h3>
            <Link href="/dashboard/intelligence" className="text-xs text-amber-400 hover:text-amber-300 transition-colors font-medium">
              View Intelligence Center →
            </Link>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {/* Reorder Alerts */}
            <div className="bg-gray-900/40 rounded-xl p-4 border border-gray-800/50">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-gray-400 uppercase tracking-wider">Reorder Alerts</span>
                {(insights.reorderSummary.overdueCount + insights.reorderSummary.dueSoonCount) > 0 && (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-red-500/20 text-red-400 font-bold">
                    {insights.reorderSummary.overdueCount + insights.reorderSummary.dueSoonCount}
                  </span>
                )}
              </div>
              {insights.reorderAlerts.length > 0 ? (
                <div className="space-y-2">
                  {insights.reorderAlerts.slice(0, 3).map((alert) => (
                    <div key={alert.productId} className="flex items-center justify-between">
                      <span className="text-xs text-gray-300 truncate max-w-[140px]">{alert.name}</span>
                      <span className={`text-xs px-1.5 py-0.5 rounded font-semibold ${
                        alert.urgency === 'OVERDUE' ? 'bg-red-500/20 text-red-400' : 'bg-amber-500/20 text-amber-400'
                      }`}>
                        {alert.urgency === 'OVERDUE' ? `${Math.abs(alert.daysUntilReorder)}d overdue` : `${alert.daysUntilReorder}d`}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-gray-500">All caught up!</p>
              )}
            </div>
            {/* Tier Savings */}
            <div className="bg-gray-900/40 rounded-xl p-4 border border-gray-800/50">
              <span className="text-xs text-gray-400 uppercase tracking-wider">YTD Tier Savings</span>
              <p className="text-2xl font-bold text-emerald-400 mt-2">{formatCurrency(insights.ytdSavings)}</p>
              <p className="text-xs text-gray-500 mt-1">saved vs. standard pricing</p>
            </div>
            {/* Estimated Spend */}
            <div className="bg-gray-900/40 rounded-xl p-4 border border-gray-800/50">
              <span className="text-xs text-gray-400 uppercase tracking-wider">Est. Monthly Spend</span>
              <p className="text-2xl font-bold text-white mt-2">{formatCurrency(insights.reorderSummary.estimatedMonthlySpend)}</p>
              <p className="text-xs text-gray-500 mt-1">based on order patterns</p>
            </div>
          </div>
        </div>
      )}

      {/* Action Items */}
      {actionItems.length > 0 && (
        <div className="bg-gray-900/60 backdrop-blur border border-gray-800/50 rounded-2xl mb-6 overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-800/50 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-white flex items-center gap-2">
              <span className="text-base">⚡</span> Action Items
              <span className="bg-amber-500 text-black text-[10px] font-bold px-2 py-0.5 rounded-full">{actionItems.length}</span>
            </h3>
          </div>
          <div className="divide-y divide-gray-800/50">
            {actionItems.slice(0, 5).map((item: ActionItem) => (
              <Link key={item.id} href={item.href}
                className="flex items-center gap-3 px-5 py-3 hover:bg-gray-800/50 transition">
                <span className="text-lg flex-shrink-0">{item.icon}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-white truncate">{item.title}</p>
                  <p className="text-xs text-gray-400">{item.subtitle}</p>
                </div>
                <span className="text-xs font-semibold text-amber-400 bg-amber-500/10 px-3 py-1 rounded-lg whitespace-nowrap">
                  {item.action}
                </span>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Quick Nav Grid */}
      <div className="grid grid-cols-3 sm:grid-cols-5 md:grid-cols-9 gap-2">
        {[
          { href: '/dashboard/orders', icon: '📦', label: 'Orders' },
          { href: '/dashboard/invoices', icon: '💳', label: 'Invoices' },
          { href: '/dashboard/payments', icon: '💵', label: 'Payments' },
          { href: '/dashboard/deliveries', icon: '🚚', label: 'Deliveries' },
          { href: '/dashboard/messages', icon: '💬', label: 'Messages' },
          { href: '/catalog', icon: '📖', label: 'Catalog' },
          { href: '/dashboard/warranty', icon: '🛡', label: 'Warranty' },
          { href: '/dashboard/statement', icon: '📑', label: 'Statement' },
          { href: '/dashboard/analytics', icon: '📊', label: 'Analytics' },
          { href: '/dashboard/settings', icon: '⚙️', label: 'Settings' },
        ].map((item) => (
          <Link key={item.href} href={item.href} className="bg-gray-900/60 backdrop-blur rounded-2xl border border-gray-800/50 p-3 text-center hover:border-amber-500/50 hover:bg-gray-800/50 transition-all group">
            <span className="text-xl">{item.icon}</span>
            <p className="text-[11px] font-medium text-gray-400 mt-1 group-hover:text-amber-400 transition-colors">{item.label}</p>
          </Link>
        ))}
      </div>

      {/* Main Content - 3 Column */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Reorder Success Toast */}
        {reorderSuccess && (
          <div className="lg:col-span-3 animate-in">
            <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-2xl p-4 flex items-center justify-between backdrop-blur">
              <div className="flex items-center gap-3">
                <span className="text-emerald-400 text-lg">✓</span>
                <p className="text-sm font-medium text-emerald-300">{reorderSuccess}</p>
              </div>
              <Link href="/dashboard/cart" className="px-4 py-1.5 bg-emerald-500 text-black text-xs font-semibold rounded-xl hover:bg-emerald-400 transition-colors">
                View Cart
              </Link>
            </div>
          </div>
        )}

        {/* Column 1: Active Orders */}
        <div className="lg:col-span-2 space-y-6">
          {/* Upcoming Deliveries */}
          {h && h.upcomingDeliveries.length > 0 && (
            <div className="bg-gray-900/60 backdrop-blur border border-gray-800/50 rounded-2xl overflow-hidden">
              <div className="px-5 py-4 border-b border-gray-800/50 flex items-center justify-between">
                <h2 className="text-base font-semibold text-white">Upcoming Deliveries</h2>
                <Link href="/dashboard/deliveries" className="text-xs text-amber-400 font-medium hover:text-amber-300 transition-colors">View All</Link>
              </div>
              <div className="divide-y divide-gray-800/50">
                {h.upcomingDeliveries.map((d) => {
                  const days = daysUntil(d.deliveryDate)
                  return (
                    <div key={d.id} className="px-5 py-4 hover:bg-gray-800/50 transition-colors">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-4">
                          <div className={`w-12 h-12 rounded-xl flex flex-col items-center justify-center ${days <= 1 ? 'bg-red-500/10 text-red-400' : days <= 3 ? 'bg-amber-500/10 text-amber-400' : 'bg-blue-500/10 text-blue-400'}`}>
                            <span className="text-lg font-bold leading-none">{days}</span>
                            <span className="text-[9px] uppercase font-medium">{days === 1 ? 'day' : 'days'}</span>
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-bold text-amber-400 font-mono">{d.orderNumber}</span>
                              <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${ORDER_STATUS_LABELS[d.status]?.color || 'bg-gray-800 text-gray-400'}`}>
                                {ORDER_STATUS_LABELS[d.status]?.label || d.status}
                              </span>
                            </div>
                            <p className="text-xs text-gray-400 mt-0.5">{formatDeliveryDate(d.deliveryDate)} · {d.itemCount} items</p>
                            {d.deliveryNotes && <p className="text-xs text-gray-500 mt-0.5 truncate max-w-xs">{d.deliveryNotes}</p>}
                          </div>
                        </div>
                        <p className="text-sm font-bold text-white">{formatCurrencyFull(d.total)}</p>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Active Orders */}
          <div className="bg-gray-900/60 backdrop-blur border border-gray-800/50 rounded-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-800/50 flex items-center justify-between">
              <h2 className="text-base font-semibold text-white">Active Orders ({activeOrders.length})</h2>
              <Link href="/dashboard/orders" className="text-xs text-amber-400 font-medium hover:text-amber-300 transition-colors">View All</Link>
            </div>
            {activeOrders.length === 0 ? (
              <div className="p-8 text-center">
                <p className="text-4xl mb-3">📦</p>
                <p className="text-sm text-gray-400 font-medium">No active orders</p>
                <p className="text-xs text-gray-500 mt-1 mb-4">Browse the catalog or request a quote to get started</p>
                <Link href="/catalog" className="text-sm text-amber-400 font-medium hover:text-amber-300 transition-colors">Browse Catalog →</Link>
              </div>
            ) : (
              <div className="divide-y divide-gray-800/50">
                {activeOrders.slice(0, 6).map((order: OrderSummary) => {
                  const os = ORDER_STATUS_LABELS[order.status] || { label: order.status, color: 'bg-gray-800 text-gray-400', icon: '📋' }
                  return (
                    <Link key={order.id} href={`/orders/${order.id}`} className="block px-5 py-3 hover:bg-gray-800/50 transition-colors">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <span className="text-lg">{os.icon}</span>
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-bold text-amber-400 font-mono">{order.orderNumber}</span>
                              <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${os.color}`}>{os.label}</span>
                            </div>
                            <p className="text-xs text-gray-400 mt-0.5">
                              {order.projectName || 'Order'} · {order.itemCount} items
                              {order.deliveryDate && ` · ${formatDeliveryDate(order.deliveryDate)}`}
                            </p>
                          </div>
                        </div>
                        <p className="text-sm font-bold text-white">{formatCurrencyFull(order.total)}</p>
                      </div>
                    </Link>
                  )
                })}
              </div>
            )}
          </div>

          {/* Quick Reorder */}
          {h && h.recentCompletedOrders.length > 0 && (
            <div className="bg-gray-900/60 backdrop-blur border border-gray-800/50 rounded-2xl overflow-hidden">
              <div className="px-5 py-4 border-b border-gray-800/50 flex items-center justify-between">
                <h2 className="text-base font-semibold text-white">Quick Reorder</h2>
                <Link href="/dashboard/orders" className="text-xs text-amber-400 font-medium hover:text-amber-300 transition-colors">Order History</Link>
              </div>
              <div className="divide-y divide-gray-800/50">
                {h.recentCompletedOrders.map((order) => (
                  <div key={order.id} className="px-5 py-3 flex items-center justify-between hover:bg-gray-800/50 transition-colors">
                    <div>
                      <span className="text-sm font-bold text-amber-400 font-mono">{order.orderNumber}</span>
                      <p className="text-xs text-gray-400 mt-0.5">{order.itemCount} items · {formatCurrencyFull(order.total)} · {new Date(order.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</p>
                    </div>
                    <button
                      onClick={() => handleReorder(order.id)}
                      disabled={reorderingId === order.id}
                      className="px-3 py-1.5 bg-amber-500 text-black text-xs font-semibold rounded-xl hover:bg-amber-400 transition-colors disabled:opacity-50"
                    >
                      {reorderingId === order.id ? 'Adding...' : 'Reorder'}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Column 2: Sidebar */}
        <div className="space-y-6">
          {/* Account Rep */}
          {h?.accountRep && (
            <div className="bg-gray-900/60 backdrop-blur border border-gray-800/50 rounded-2xl p-5">
              <h2 className="text-sm font-semibold text-white mb-3">Your Abel Lumber Rep</h2>
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-full bg-amber-500 flex items-center justify-center text-black text-sm font-bold">
                  {h.accountRep.firstName[0]}{h.accountRep.lastName[0]}
                </div>
                <div>
                  <p className="text-sm font-bold text-white">{h.accountRep.firstName} {h.accountRep.lastName}</p>
                  <p className="text-xs text-gray-400">{h.accountRep.title || 'Account Manager'}</p>
                </div>
              </div>
              <div className="space-y-2">
                {h.accountRep.email && (
                  <a href={`mailto:${h.accountRep.email}`} className="flex items-center gap-2 text-sm text-amber-400 hover:text-amber-300 transition-colors">
                    <span className="text-xs">✉️</span> {h.accountRep.email}
                  </a>
                )}
                {h.accountRep.phone && (
                  <a href={`tel:${h.accountRep.phone}`} className="flex items-center gap-2 text-sm text-amber-400 hover:text-amber-300 transition-colors">
                    <span className="text-xs">📞</span> {h.accountRep.phone}
                  </a>
                )}
              </div>
              <Link href="/dashboard/messages" className="mt-3 block w-full text-center py-2 bg-gray-800 border border-gray-700 rounded-xl text-xs font-medium text-gray-300 hover:bg-gray-700 hover:border-gray-600 transition-colors">
                Send a Message
              </Link>
            </div>
          )}

          {/* Payment Summary */}
          {h && (
            <div className="bg-gray-900/60 backdrop-blur border border-gray-800/50 rounded-2xl p-5">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold text-white">Payment Summary</h2>
                <Link href="/dashboard/invoices" className="text-xs text-amber-400 hover:text-amber-300 transition-colors">View All</Link>
              </div>
              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-xs text-gray-400">Open Invoices</span>
                  <span className="text-sm font-bold text-white">{h.invoices.openInvoiceCount}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-xs text-gray-400">Total Outstanding</span>
                  <span className="text-sm font-bold text-amber-400">{formatCurrencyFull(h.invoices.totalOutstanding)}</span>
                </div>
                {h.invoices.overdueAmount > 0 && (
                  <div className="flex justify-between items-center">
                    <span className="text-xs text-red-400 font-medium">Overdue</span>
                    <span className="text-sm font-bold text-red-400">{formatCurrencyFull(h.invoices.overdueAmount)}</span>
                  </div>
                )}
                <div className="flex justify-between items-center pt-2 border-t border-gray-800">
                  <span className="text-xs text-gray-400">Paid (Last 30 days)</span>
                  <span className="text-sm font-bold text-emerald-400">{formatCurrencyFull(h.invoices.paidLast30Days)}</span>
                </div>
              </div>
            </div>
          )}

          {/* Recent Payments */}
          {h && h.recentPayments.length > 0 && (
            <div className="bg-gray-900/60 backdrop-blur border border-gray-800/50 rounded-2xl p-5">
              <h2 className="text-sm font-semibold text-white mb-3">Recent Payments</h2>
              <div className="space-y-2">
                {h.recentPayments.slice(0, 3).map((p) => (
                  <div key={p.id} className="flex items-center justify-between py-1.5">
                    <div>
                      <p className="text-xs font-medium text-white">{p.invoiceNumber}</p>
                      <p className="text-[10px] text-gray-500">{p.method} · {new Date(p.receivedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</p>
                    </div>
                    <span className="text-xs font-bold text-emerald-400">-{formatCurrencyFull(p.amount)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Lifetime Stats */}
          {h && (
            <div className="bg-gradient-to-br from-gray-900/60 to-gray-800/50 backdrop-blur border border-gray-800/50 rounded-2xl p-5">
              <h2 className="text-sm font-semibold text-white mb-3">Your Account</h2>
              <div className="space-y-2">
                <div className="flex justify-between">
                  <span className="text-xs text-gray-400">Lifetime Orders</span>
                  <span className="text-sm font-bold text-white">{h.orders.totalOrders}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-xs text-gray-400">Lifetime Value</span>
                  <span className="text-sm font-bold text-amber-400">{formatCurrency(h.orders.lifetimeValue)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-xs text-gray-400">Last 30 Days</span>
                  <span className="text-sm font-bold text-white">{formatCurrency(h.orders.last30DaysValue)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-xs text-gray-400">Account Status</span>
                  <span className={`text-xs px-2 py-0.5 rounded-lg font-semibold ${h.account.status === 'ACTIVE' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-amber-500/10 text-amber-400'}`}>
                    {h.account.status}
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
