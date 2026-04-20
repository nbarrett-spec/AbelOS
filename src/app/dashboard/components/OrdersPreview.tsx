'use client'

import Link from 'next/link'
import { Package, ChevronRight, ShoppingBag } from 'lucide-react'
import Card, { CardHeader, CardBody } from '@/components/ui/Card'
import Badge from '@/components/ui/Badge'
import Button from '@/components/ui/Button'

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

const STATUS_MAP: Record<string, { label: string; variant: 'info' | 'warning' | 'success' | 'brand' | 'neutral' | 'orange' }> = {
  RECEIVED: { label: 'Received', variant: 'info' },
  CONFIRMED: { label: 'Confirmed', variant: 'brand' },
  IN_PRODUCTION: { label: 'In Production', variant: 'warning' },
  READY_TO_SHIP: { label: 'Ready to Ship', variant: 'success' },
  SHIPPED: { label: 'Shipped', variant: 'info' },
  DELIVERED: { label: 'Delivered', variant: 'success' },
  COMPLETE: { label: 'Complete', variant: 'success' },
}

function formatCurrency(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n)
}

function formatDeliveryDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

interface OrdersPreviewProps {
  orders: OrderSummary[]
  loading?: boolean
}

export default function OrdersPreview({ orders, loading }: OrdersPreviewProps) {
  const activeOrders = orders.filter((o) => !['COMPLETE', 'DELIVERED', 'CANCELLED'].includes(o.status))

  return (
    <Card variant="default" padding="none" rounded="2xl" className="overflow-hidden">
      {/* Header */}
      <CardHeader className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <Package className="w-4.5 h-4.5 text-abel-amber" />
            Active Orders
          </h3>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
            {activeOrders.length} active &middot; {orders.length} total
          </p>
        </div>
        <Link
          href="/dashboard/orders"
          className="inline-flex items-center gap-1 text-sm font-semibold text-abel-walnut dark:text-abel-walnut-light hover:text-abel-walnut-dark dark:hover:text-white transition-colors group"
        >
          View All
          <ChevronRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
        </Link>
      </CardHeader>

      {/* Content */}
      {loading ? (
        <div className="px-6 py-6 space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="flex items-center gap-4 animate-pulse">
              <div className="w-10 h-10 rounded-lg bg-gray-100 dark:bg-gray-800" />
              <div className="flex-1 space-y-2">
                <div className="h-3.5 w-32 bg-gray-100 dark:bg-gray-800 rounded" />
                <div className="h-3 w-48 bg-gray-100 dark:bg-gray-800 rounded" />
              </div>
              <div className="h-4 w-16 bg-gray-100 dark:bg-gray-800 rounded" />
            </div>
          ))}
        </div>
      ) : activeOrders.length === 0 ? (
        <div className="px-6 py-14 text-center">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-gray-100 dark:bg-gray-800 mb-4">
            <ShoppingBag className="w-7 h-7 text-gray-400 dark:text-gray-500" />
          </div>
          <p className="text-sm font-semibold text-gray-900 dark:text-white">No active orders</p>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 mb-5 max-w-xs mx-auto">
            Browse the catalog or request a quote to get started with your next project
          </p>
          <Link href="/catalog">
            <Button variant="outline" size="sm" iconRight={<ChevronRight className="w-4 h-4" />}>
              Browse Catalog
            </Button>
          </Link>
        </div>
      ) : (
        <div className="divide-y divide-gray-100 dark:divide-gray-800">
          {activeOrders.slice(0, 5).map((order) => {
            const statusInfo = STATUS_MAP[order.status] || { label: order.status, variant: 'neutral' as const }
            return (
              <Link
                key={order.id}
                href={`/orders/${order.id}`}
                className="px-6 py-3.5 flex items-center justify-between group transition-colors hover:bg-gray-50 dark:hover:bg-gray-800/40"
              >
                <div className="flex items-center gap-3.5 min-w-0 flex-1">
                  <div className="w-9 h-9 rounded-lg bg-abel-amber/8 dark:bg-abel-amber/15 flex items-center justify-center shrink-0">
                    <Package className="w-4 h-4 text-abel-amber" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="font-mono text-sm font-bold text-gray-900 dark:text-white">
                        {order.orderNumber}
                      </span>
                      <Badge variant={statusInfo.variant} size="xs">{statusInfo.label}</Badge>
                    </div>
                    <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                      {order.projectName || 'Order'} &middot; {order.itemCount} items
                      {order.deliveryDate && ` \u00b7 ${formatDeliveryDate(order.deliveryDate)}`}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2.5 ml-3 shrink-0">
                  <span className="text-sm font-bold text-gray-900 dark:text-white">
                    {formatCurrency(order.total)}
                  </span>
                  <ChevronRight className="w-4 h-4 text-gray-300 dark:text-gray-600 group-hover:text-gray-500 dark:group-hover:text-gray-400 transition-colors" />
                </div>
              </Link>
            )
          })}
        </div>
      )}
    </Card>
  )
}
