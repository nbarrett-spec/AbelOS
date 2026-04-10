'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'

interface Order {
  id: string
  orderNumber: string
  status: string
  total: number
  createdAt: string
  deliveryDate: string | null
  projectName: string
  itemCount: number
}

const STATUS_STEPS = [
  { key: 'RECEIVED', label: 'Received', icon: '📥' },
  { key: 'CONFIRMED', label: 'Confirmed', icon: '✅' },
  { key: 'IN_PRODUCTION', label: 'In Production', icon: '🏭' },
  { key: 'READY_TO_SHIP', label: 'Ready', icon: '📦' },
  { key: 'SHIPPED', label: 'Shipped', icon: '🚚' },
  { key: 'DELIVERED', label: 'Delivered', icon: '🏠' },
]

const STATUS_COLORS: Record<string, string> = {
  RECEIVED: 'bg-blue-100 text-blue-700',
  CONFIRMED: 'bg-indigo-100 text-indigo-700',
  IN_PRODUCTION: 'bg-yellow-100 text-yellow-700',
  READY_TO_SHIP: 'bg-purple-100 text-purple-700',
  SHIPPED: 'bg-orange-100 text-orange-700',
  DELIVERED: 'bg-green-100 text-green-700',
  COMPLETE: 'bg-green-100 text-green-700',
}

const PAGE_SIZE = 10

export default function OrdersPage() {
  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)

  useEffect(() => {
    fetch('/api/orders')
      .then(r => r.json())
      .then(data => setOrders(data.orders || []))
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-[#1B4F72] border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6 sm:mb-8">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">My Orders</h1>
            <p className="text-gray-500 text-sm mt-1">Track your order status and delivery schedule</p>
          </div>
          <Link href="/dashboard" className="text-sm text-[#1B4F72] hover:underline">← Back to Dashboard</Link>
        </div>

        {orders.length === 0 ? (
          <div className="bg-white rounded-2xl border p-12 text-center">
            <p className="text-gray-400 text-lg">No orders yet</p>
            <p className="text-gray-400 text-sm mt-2">Orders are created when you approve a quote</p>
          </div>
        ) : (
          <div className="space-y-4">
            {orders.slice(0, visibleCount).map(order => {
              const stepIndex = STATUS_STEPS.findIndex(s => s.key === order.status)
              const progress = Math.max(0, ((stepIndex + 1) / STATUS_STEPS.length) * 100)

              return (
                <Link
                  key={order.id}
                  href={`/orders/${order.id}`}
                  className="block bg-white rounded-2xl border hover:shadow-lg transition-shadow p-4 sm:p-6"
                >
                  <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2 sm:gap-0 mb-4">
                    <div>
                      <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
                        <h3 className="text-base sm:text-lg font-bold text-gray-900">{order.orderNumber}</h3>
                        <span className={`px-2 sm:px-3 py-0.5 sm:py-1 rounded-full text-xs font-medium ${STATUS_COLORS[order.status] || 'bg-gray-100 text-gray-600'}`}>
                          {order.status.replace(/_/g, ' ')}
                        </span>
                      </div>
                      <p className="text-sm text-gray-500 mt-1">{order.projectName} &middot; {order.itemCount} items</p>
                    </div>
                    <div className="sm:text-right">
                      <p className="text-lg sm:text-xl font-bold text-[#1B4F72]">${order.total?.toLocaleString('en-US', { minimumFractionDigits: 2 })}</p>
                      <p className="text-xs text-gray-400 mt-0.5">{new Date(order.createdAt).toLocaleDateString()}</p>
                    </div>
                  </div>

                  {/* Progress bar */}
                  <div className="relative">
                    <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-[#1B4F72] to-[#E67E22] rounded-full transition-all duration-500"
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                    <div className="flex justify-between mt-2">
                      {STATUS_STEPS.map((step, i) => (
                        <div key={step.key} className={`flex flex-col items-center ${i <= stepIndex ? 'opacity-100' : 'opacity-30'}`}>
                          <span className="text-xs">{step.icon}</span>
                          <span className="text-[10px] text-gray-500 mt-0.5 hidden sm:block">{step.label}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {order.deliveryDate && (
                    <div className="mt-3 flex items-center gap-2 text-sm text-gray-600">
                      <span>🚚</span>
                      <span>Estimated delivery: <strong>{new Date(order.deliveryDate).toLocaleDateString()}</strong></span>
                    </div>
                  )}
                </Link>
              )
            })}
            {orders.length > visibleCount && (
              <button
                onClick={() => setVisibleCount(c => c + PAGE_SIZE)}
                className="w-full py-3 text-sm font-medium text-[#1B4F72] bg-white border border-[#1B4F72]/20 rounded-xl hover:bg-[#1B4F72]/5 transition"
              >
                Show more orders ({orders.length - visibleCount} remaining)
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
