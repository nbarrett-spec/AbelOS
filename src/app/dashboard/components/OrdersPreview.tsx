'use client'

import Link from 'next/link'
import { Package, ChevronRight } from 'lucide-react'

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

const ORDER_STATUS_LABELS: Record<string, { label: string; badge: string; icon: string }> = {
  RECEIVED: { label: 'Received', badge: 'bg-blue-100 dark:bg-blue-950/30 text-blue-700 dark:text-blue-300', icon: '📋' },
  CONFIRMED: {
    label: 'Confirmed',
    badge: 'bg-indigo-100 dark:bg-indigo-950/30 text-indigo-700 dark:text-indigo-300',
    icon: '✅',
  },
  IN_PRODUCTION: {
    label: 'In Production',
    badge: 'bg-amber-100 dark:bg-amber-950/30 text-amber-700 dark:text-amber-300',
    icon: '🔨',
  },
  READY_TO_SHIP: {
    label: 'Ready to Ship',
    badge: 'bg-emerald-100 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300',
    icon: '📦',
  },
  SHIPPED: { label: 'Shipped', badge: 'bg-cyan-100 dark:bg-cyan-950/30 text-cyan-700 dark:text-cyan-300', icon: '🚚' },
  DELIVERED: {
    label: 'Delivered',
    badge: 'bg-violet-100 dark:bg-violet-950/30 text-violet-700 dark:text-violet-300',
    icon: '✓',
  },
  COMPLETE: {
    label: 'Complete',
    badge: 'bg-emerald-100 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300',
    icon: '🏁',
  },
}

function formatCurrency(n: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n)
}

function formatDeliveryDate(dateStr: string) {
  const d = new Date(dateStr)
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

interface OrdersPreviewProps {
  orders: OrderSummary[]
  loading?: boolean
}

export default function OrdersPreview({ orders, loading }: OrdersPreviewProps) {
  const activeOrders = orders.filter((o) => !['COMPLETE', 'DELIVERED', 'CANCELLED'].includes(o.status))

  return (
    <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden transition-all hover:border-slate-300 dark:hover:border-slate-700">
      {/* Header */}
      <div className="px-6 py-5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
        <div>
          <h3 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <Package className="w-5 h-5 text-amber-600 dark:text-amber-400" />
            Active Orders
          </h3>
          <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">
            {activeOrders.length} active · {orders.length} total
          </p>
        </div>
        <Link
          href="/dashboard/orders"
          className="inline-flex items-center gap-1 text-sm font-semibold text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 transition-colors group"
        >
          View All
          <ChevronRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
        </Link>
      </div>

      {/* Content */}
      {loading ? (
        <div className="px-6 py-8 space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="skeleton h-16 rounded-xl" />
          ))}
        </div>
      ) : activeOrders.length === 0 ? (
        <div className="px-6 py-12 text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-slate-100 dark:bg-slate-800 mb-4">
            <Package className="w-8 h-8 text-gray-400 dark:text-gray-600" />
          </div>
          <p className="text-sm font-semibold text-gray-900 dark:text-white">No active orders</p>
          <p className="text-xs text-gray-600 dark:text-gray-400 mt-1 mb-4">
            Browse the catalog or request a quote to get started
          </p>
          <Link
            href="/catalog"
            className="inline-flex items-center gap-2 text-sm font-semibold text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 transition-colors"
          >
            Browse Catalog
            <ChevronRight className="w-4 h-4" />
          </Link>
        </div>
      ) : (
        <div className="divide-y divide-slate-200 dark:divide-slate-800">
          {activeOrders.slice(0, 5).map((order) => {
            const statusInfo = ORDER_STATUS_LABELS[order.status] || {
              label: order.status,
              badge: 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300',
              icon: '📋',
            }
            return (
              <Link
                key={order.id}
                href={`/orders/${order.id}`}
                className="px-6 py-4 transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/50 flex items-center justify-between group"
              >
                <div className="flex items-start gap-3 flex-1 min-w-0">
                  <span className="text-xl mt-0.5">{statusInfo.icon}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span className="font-mono text-sm font-bold text-amber-600 dark:text-amber-400">
                        {order.orderNumber}
                      </span>
                      <span className={`text-xs font-semibold px-2.5 py-1 rounded-lg ${statusInfo.badge}`}>
                        {statusInfo.label}
                      </span>
                    </div>
                    <p className="text-xs text-gray-600 dark:text-gray-400 truncate">
                      {order.projectName || 'Order'} · {order.itemCount} items
                      {order.deliveryDate && ` · ${formatDeliveryDate(order.deliveryDate)}`}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3 ml-3">
                  <p className="text-sm font-bold text-gray-900 dark:text-white whitespace-nowrap">
                    {formatCurrency(order.total)}
                  </p>
                  <ChevronRight className="w-4 h-4 text-gray-400 dark:text-gray-600 group-hover:text-gray-600 dark:group-hover:text-gray-400 transition-colors" />
                </div>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
