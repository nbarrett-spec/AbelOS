'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/hooks/useAuth'
import OnboardingChecklist from '@/components/OnboardingChecklist'
import HeroSection from './components/HeroSection'
import KPIGrid from './components/KPIGrid'
import InsightsStrip from './components/InsightsStrip'
import OrdersPreview from './components/OrdersPreview'
import AccountHealthPanel from './components/AccountHealthPanel'
import QuickActionsDock from './components/QuickActionsDock'
import AccountSidebar from './components/AccountSidebar'

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
        fetch('/api/builder/reorder-forecast')
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null),
        fetch('/api/builder/recommendations')
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null),
        fetch('/api/builder/pricing-intelligence')
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null),
      ])
      const alerts: ReorderAlert[] = (reorderRes?.upcomingReorders || [])
        .filter((r: any) => r.urgency === 'OVERDUE' || r.urgency === 'DUE_SOON')
        .slice(0, 4)
      const recs: RecommendedProduct[] = (
        recsRes?.buyAgain ||
        recsRes?.trendingInCategory ||
        []
      ).slice(0, 4)
      const summary = reorderRes?.reorderSummary || {
        overdueCount: 0,
        dueSoonCount: 0,
        estimatedMonthlySpend: 0,
      }
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
    } catch (err) {
      console.error('[Dashboard] Failed to load insights and reorder data:', err)
    }
  }, [])

  useEffect(() => {
    if (builder) {
      Promise.all([fetchHealth(), fetchOrders(), fetchInsights()]).finally(() =>
        setLoading(false)
      )
    }
  }, [builder, fetchInsights])

  async function fetchHealth() {
    try {
      const res = await fetch('/api/account/health')
      if (res.ok) {
        const data = await res.json()
        setHealth(data)
      }
    } catch (err) {
      console.error('[Dashboard] Failed to load account health:', err)
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

  if (authLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="w-8 h-8 border-4 border-abel-orange border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!builder) {
    return (
      <div className="text-center py-20">
        <p className="text-gray-600 dark:text-gray-400">
          Please sign in to access your dashboard.
        </p>
        <Link
          href="/login"
          className="inline-block mt-4 px-6 py-2.5 bg-abel-orange hover:bg-abel-orange/90 text-white rounded-xl font-semibold transition-colors"
        >
          Sign In
        </Link>
      </div>
    )
  }

  const firstName = builder.contactName?.split(' ')[0] || 'Builder'
  const h = health

  // Build KPI data
  const kpiData = [
    {
      label: 'Open Orders',
      value: h?.orders.activeOrders ?? 0,
      icon: '📦',
      color: 'blue' as const,
      trend: 'neutral' as const,
    },
    {
      label: 'YTD Spend',
      value: h ? formatCurrency(h.orders.last30DaysValue * 12) : '$0',
      icon: '💰',
      color: 'amber' as const,
      trend: 'neutral' as const,
    },
    {
      label: 'Credit Available',
      value: h ? formatCurrency(h.account.creditAvailable) : '$0',
      icon: '💳',
      color: 'emerald' as const,
      trend: 'neutral' as const,
    },
    {
      label: 'Outstanding',
      value: h ? formatCurrency(h.invoices.totalOutstanding) : '$0',
      icon: '📊',
      color: 'violet' as const,
      trend: 'neutral' as const,
    },
  ]

  return (
    <div className="space-y-8">
      {/* Hero Section */}
      <HeroSection firstName={firstName} ytdSavings={insights?.ytdSavings ?? 0} />

      {/* Onboarding Checklist */}
      <OnboardingChecklist />

      {/* KPI Grid */}
      <KPIGrid kpis={kpiData} />

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

      {/* Quick Actions Dock */}
      <div>
        <h3 className="text-sm font-bold text-gray-900 dark:text-white mb-3 uppercase tracking-wider px-1">
          Quick Actions
        </h3>
        <QuickActionsDock />
      </div>

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: Orders */}
        <div className="lg:col-span-2 space-y-6">
          {/* Upcoming Deliveries */}
          {h && h.upcomingDeliveries.length > 0 && (
            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
              <div className="px-6 py-5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
                <h3 className="text-lg font-bold text-gray-900 dark:text-white">Upcoming Deliveries</h3>
                <Link
                  href="/dashboard/deliveries"
                  className="text-sm font-semibold text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 transition-colors"
                >
                  View All →
                </Link>
              </div>
              <div className="divide-y divide-slate-200 dark:divide-slate-800">
                {h.upcomingDeliveries.slice(0, 3).map((d) => (
                  <div
                    key={d.id}
                    className="px-6 py-4 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-4">
                        <div className="text-lg font-bold text-amber-600 dark:text-amber-400 text-center">
                          {Math.ceil(
                            (new Date(d.deliveryDate).getTime() - Date.now()) /
                              (1000 * 60 * 60 * 24)
                          )}
                          <div className="text-[10px] text-gray-600 dark:text-gray-400 uppercase">days</div>
                        </div>
                        <div>
                          <p className="text-sm font-bold text-gray-900 dark:text-white">
                            {d.orderNumber}
                          </p>
                          <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                            {new Date(d.deliveryDate).toLocaleDateString('en-US', {
                              weekday: 'short',
                              month: 'short',
                              day: 'numeric',
                            })}{' '}
                            · {d.itemCount} items
                          </p>
                        </div>
                      </div>
                      <p className="text-sm font-bold text-gray-900 dark:text-white">
                        {formatCurrency(d.total)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Active Orders Preview */}
          <OrdersPreview orders={orders} loading={loading} />
        </div>

        {/* Right Column: Sidebar */}
        <AccountSidebar
          accountRep={h?.accountRep}
          paymentSummary={h?.invoices}
          lifetimeStats={h?.orders && h?.account && {
            totalOrders: h.orders.totalOrders,
            lifetimeValue: h.orders.lifetimeValue,
            last30DaysValue: h.orders.last30DaysValue,
            status: h.account.status,
          }}
          recentPayments={h?.recentPayments}
        />
      </div>
    </div>
  )
}
