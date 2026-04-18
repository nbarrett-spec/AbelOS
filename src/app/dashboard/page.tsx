'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  Package,
  DollarSign,
  CreditCard,
  BarChart3,
  Truck,
  ArrowRight,
  Calendar,
} from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import Card, { CardHeader } from '@/components/ui/Card'
import Badge from '@/components/ui/Badge'
import Button from '@/components/ui/Button'
import OnboardingChecklist from '@/components/OnboardingChecklist'
import HeroSection from './components/HeroSection'
import KPIGrid from './components/KPIGrid'
import InsightsStrip from './components/InsightsStrip'
import OrdersPreview from './components/OrdersPreview'
import AccountHealthPanel from './components/AccountHealthPanel'
import QuickActionsDock from './components/QuickActionsDock'
import AccountSidebar from './components/AccountSidebar'

// ── Types ──────────────────────────────────────────────────────────────────

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

const PAYMENT_TERM_LABELS: Record<string, string> = {
  PAY_AT_ORDER: 'Pay at Order',
  PAY_ON_DELIVERY: 'Pay on Delivery',
  NET_15: 'Net 15',
  NET_30: 'Net 30',
}

function formatCurrency(n: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n)
}

// ── Dashboard skeleton ─────────────────────────────────────────────────────

function DashboardSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      {/* Hero skeleton */}
      <div className="h-44 rounded-2xl bg-gray-200 dark:bg-gray-800" />
      {/* KPI row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-28 rounded-xl bg-gray-200 dark:bg-gray-800" />
        ))}
      </div>
      {/* Quick actions */}
      <div className="grid grid-cols-5 lg:grid-cols-9 gap-2.5">
        {Array.from({ length: 9 }).map((_, i) => (
          <div key={i} className="h-20 rounded-xl bg-gray-200 dark:bg-gray-800" />
        ))}
      </div>
      {/* Content grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <div className="h-64 rounded-2xl bg-gray-200 dark:bg-gray-800" />
          <div className="h-72 rounded-2xl bg-gray-200 dark:bg-gray-800" />
        </div>
        <div className="space-y-5">
          <div className="h-52 rounded-2xl bg-gray-200 dark:bg-gray-800" />
          <div className="h-44 rounded-2xl bg-gray-200 dark:bg-gray-800" />
        </div>
      </div>
    </div>
  )
}

// ── Main page ──────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const { builder, loading: authLoading } = useAuth()
  const router = useRouter()
  const [health, setHealth] = useState<AccountHealth | null>(null)
  const [orders, setOrders] = useState<OrderSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [insights, setInsights] = useState<InsightsData | null>(null)

  const fetchInsights = useCallback(async () => {
    try {
      const [reorderRes, recsRes, pricingRes] = await Promise.all([
        fetch('/api/builder/reorder-forecast').then((r) => (r.ok ? r.json() : null)).catch(() => null),
        fetch('/api/builder/recommendations').then((r) => (r.ok ? r.json() : null)).catch(() => null),
        fetch('/api/builder/pricing-intelligence').then((r) => (r.ok ? r.json() : null)).catch(() => null),
      ])
      const alerts: ReorderAlert[] = (reorderRes?.upcomingReorders || [])
        .filter((r: any) => r.urgency === 'OVERDUE' || r.urgency === 'DUE_SOON')
        .slice(0, 4)
      const recs: RecommendedProduct[] = (recsRes?.buyAgain || recsRes?.trendingInCategory || []).slice(0, 4)
      const summary = reorderRes?.reorderSummary || { overdueCount: 0, dueSoonCount: 0, estimatedMonthlySpend: 0 }
      const savings = (pricingRes?.savingsBreakdown || []).reduce(
        (sum: number, m: any) => sum + (Number(m.savings) || 0),
        0
      )
      setInsights({
        reorderAlerts: alerts,
        recommendations: recs,
        reorderSummary: summary,
        tierName: pricingRes?.tierStatus?.currentTier || 'STANDARD',
        ytdSavings: savings,
      })
    } catch {
      // Silently fall through — insights are non-critical
    }
  }, [])

  useEffect(() => {
    if (builder) {
      Promise.all([fetchHealth(), fetchOrders(), fetchInsights()]).finally(() => setLoading(false))
    }
  }, [builder, fetchInsights])

  async function fetchHealth() {
    try {
      const res = await fetch('/api/account/health')
      if (res.ok) setHealth(await res.json())
    } catch {
      // Non-critical
    }
  }

  async function fetchOrders() {
    try {
      const res = await fetch('/api/orders')
      if (res.ok) {
        const data = await res.json()
        setOrders((data.orders || []).slice(0, 10))
      }
    } catch {
      // Non-critical
    }
  }

  // ── Auth guard ─────────────────────────────────────────────────────────
  if (authLoading) return <DashboardSkeleton />

  if (!builder) {
    return (
      <div className="flex flex-col items-center justify-center py-24 animate-enter">
        <div className="w-16 h-16 rounded-2xl bg-gray-100 dark:bg-gray-800 flex items-center justify-center mb-5">
          <Package className="w-8 h-8 text-gray-400 dark:text-gray-500" />
        </div>
        <p className="text-base font-semibold text-gray-900 dark:text-white mb-1">Sign in required</p>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">Access your projects and orders</p>
        <Link href="/login">
          <Button variant="accent" iconRight={<ArrowRight className="w-4 h-4" />}>
            Sign In
          </Button>
        </Link>
      </div>
    )
  }

  const firstName = builder.contactName?.split(' ')[0] || 'Builder'
  const h = health

  // ── KPI data with sparklines ─────────────────────────────────────────
  const kpiData = [
    {
      label: 'Open Orders',
      value: h?.orders.activeOrders ?? 0,
      icon: <Package className="w-4.5 h-4.5" />,
      accent: 'orange' as const,
      sparkline: [3, 5, 4, 7, 6, 8, h?.orders.activeOrders ?? 5],
      subtitle: `${h?.orders.totalOrders ?? 0} total`,
    },
    {
      label: 'YTD Spend',
      value: h ? formatCurrency(h.orders.last30DaysValue * 12) : '$0',
      icon: <DollarSign className="w-4.5 h-4.5" />,
      accent: 'navy' as const,
      sparkline: [8, 10, 9, 12, 14, 13, 16],
      subtitle: `${formatCurrency(h?.orders.last30DaysValue ?? 0)}/mo`,
    },
    {
      label: 'Credit Available',
      value: h ? formatCurrency(h.account.creditAvailable) : '$0',
      icon: <CreditCard className="w-4.5 h-4.5" />,
      accent: 'green' as const,
      subtitle: h ? `of ${formatCurrency(h.account.creditLimit)}` : undefined,
    },
    {
      label: 'Outstanding',
      value: h ? formatCurrency(h.invoices.totalOutstanding) : '$0',
      icon: <BarChart3 className="w-4.5 h-4.5" />,
      accent: (h?.invoices.overdueCount ?? 0) > 0 ? ('danger' as const) : ('info' as const),
      delta: (h?.invoices.overdueCount ?? 0) > 0 ? `${h?.invoices.overdueCount} overdue` : undefined,
      deltaDirection: (h?.invoices.overdueCount ?? 0) > 0 ? ('down' as const) : undefined,
    },
  ]

  return (
    <div className="space-y-6">
      {/* Hero Section */}
      <HeroSection firstName={firstName} ytdSavings={insights?.ytdSavings ?? 0} />

      {/* Onboarding Checklist */}
      <OnboardingChecklist />

      {/* KPI Grid */}
      <KPIGrid kpis={kpiData} loading={loading} />

      {/* Quick Actions Dock */}
      <div>
        <h3 className="text-xs font-bold text-gray-400 dark:text-gray-500 mb-2.5 uppercase tracking-widest px-0.5">
          Quick Actions
        </h3>
        <QuickActionsDock />
      </div>

      {/* Account Health */}
      {h && (
        <AccountHealthPanel
          outstandingBalance={h.invoices.totalOutstanding}
          creditAvailable={h.account.creditAvailable}
          creditLimit={h.account.creditLimit}
          accountBalance={h.account.accountBalance}
          overdueCount={h.invoices.overdueCount}
          overdueAmount={h.invoices.overdueAmount}
          activeOrders={h.orders.activeOrders}
          paymentTerms={PAYMENT_TERM_LABELS[h.account.paymentTerm] || h.account.paymentTerm}
        />
      )}

      {/* AI Insights Strip */}
      {insights && (
        <InsightsStrip
          insights={[]}
          ytdSavings={insights.ytdSavings}
          reorderCount={insights.reorderSummary.overdueCount + insights.reorderSummary.dueSoonCount}
        />
      )}

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: Orders + Deliveries */}
        <div className="lg:col-span-2 space-y-5">
          {/* Upcoming Deliveries */}
          {h && h.upcomingDeliveries.length > 0 && (
            <Card variant="default" padding="none" rounded="2xl" className="overflow-hidden animate-enter">
              <CardHeader className="flex items-center justify-between">
                <h3 className="text-base font-bold text-gray-900 dark:text-white flex items-center gap-2">
                  <Truck className="w-4.5 h-4.5 text-cyan-600 dark:text-cyan-400" />
                  Upcoming Deliveries
                </h3>
                <Link
                  href="/dashboard/deliveries"
                  className="inline-flex items-center gap-1 text-sm font-semibold text-abel-navy dark:text-abel-navy-light hover:text-abel-navy-dark dark:hover:text-white transition-colors group"
                >
                  View All
                  <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" />
                </Link>
              </CardHeader>
              <div className="divide-y divide-gray-100 dark:divide-gray-800">
                {h.upcomingDeliveries.slice(0, 3).map((d) => {
                  const daysLeft = Math.ceil(
                    (new Date(d.deliveryDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
                  )
                  return (
                    <div
                      key={d.id}
                      className="px-6 py-3.5 flex items-center justify-between hover:bg-gray-50 dark:hover:bg-gray-800/40 transition-colors"
                    >
                      <div className="flex items-center gap-4">
                        <div className="w-11 h-11 rounded-xl bg-cyan-50 dark:bg-cyan-900/20 flex flex-col items-center justify-center">
                          <span className="text-base font-bold text-cyan-700 dark:text-cyan-300 leading-none">
                            {daysLeft}
                          </span>
                          <span className="text-[9px] font-semibold text-cyan-500 dark:text-cyan-400 uppercase">
                            {daysLeft === 1 ? 'day' : 'days'}
                          </span>
                        </div>
                        <div>
                          <p className="text-sm font-bold text-gray-900 dark:text-white">
                            {d.orderNumber}
                          </p>
                          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 flex items-center gap-1">
                            <Calendar className="w-3 h-3" />
                            {new Date(d.deliveryDate).toLocaleDateString('en-US', {
                              weekday: 'short',
                              month: 'short',
                              day: 'numeric',
                            })}{' '}
                            &middot; {d.itemCount} items
                          </p>
                        </div>
                      </div>
                      <span className="text-sm font-bold text-gray-900 dark:text-white">
                        {formatCurrency(d.total)}
                      </span>
                    </div>
                  )
                })}
              </div>
            </Card>
          )}

          {/* Active Orders Preview */}
          <OrdersPreview orders={orders} loading={loading} />
        </div>

        {/* Right Column: Sidebar */}
        <AccountSidebar
          accountRep={h?.accountRep}
          paymentSummary={h?.invoices}
          lifetimeStats={
            h?.orders && h?.account
              ? {
                  totalOrders: h.orders.totalOrders,
                  lifetimeValue: h.orders.lifetimeValue,
                  last30DaysValue: h.orders.last30DaysValue,
                  status: h.account.status,
                }
              : undefined
          }
          recentPayments={h?.recentPayments}
        />
      </div>
    </div>
  )
}
