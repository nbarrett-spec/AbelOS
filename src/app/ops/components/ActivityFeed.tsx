'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Package, ShoppingCart, CreditCard, AlertCircle, CheckCircle2 } from 'lucide-react'

interface ActivityItem {
  id: string
  type: 'order_created' | 'order_shipped' | 'payment_received' | 'alert_resolved' | 'po_created'
  title: string
  description: string
  timestamp: string
  href: string
  icon?: string
}

const iconMap = {
  order_created: Package,
  order_shipped: Package,
  payment_received: CreditCard,
  alert_resolved: CheckCircle2,
  po_created: ShoppingCart,
}

const typeColors = {
  order_created: 'bg-blue-50 text-blue-700 border-blue-200',
  order_shipped: 'bg-cyan-50 text-cyan-700 border-cyan-200',
  payment_received: 'bg-green-50 text-green-700 border-green-200',
  alert_resolved: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  po_created: 'bg-amber-50 text-amber-700 border-amber-200',
}

export function ActivityFeed() {
  const [activities, setActivities] = useState<ActivityItem[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch('/api/ops/activity-log?limit=6')
        if (res.ok) {
          const data = await res.json()
          setActivities(data.activities || [])
        }
      } catch (error) {
        console.error('Failed to load activity feed:', error)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-12 bg-gray-100 rounded-lg animate-pulse" />
        ))}
      </div>
    )
  }

  if (activities.length === 0) {
    return (
      <div className="text-center py-8 text-gray-400">
        <Package className="w-8 h-8 mx-auto mb-2 opacity-50" />
        <p className="text-sm">No recent activity</p>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {activities.map((activity) => {
        const Icon = iconMap[activity.type] || Package
        return (
          <Link key={activity.id} href={activity.href || '#'}>
            <div
              className={`p-3 rounded-lg border cursor-pointer transition-colors hover:shadow-elevation-1 ${
                typeColors[activity.type]
              }`}
            >
              <div className="flex items-start gap-3">
                <div className="mt-0.5">
                  <Icon className="w-4 h-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{activity.title}</p>
                  <p className="text-xs opacity-75 mt-0.5 line-clamp-1">{activity.description}</p>
                </div>
                <div className="text-xs opacity-60 whitespace-nowrap ml-2">{activity.timestamp}</div>
              </div>
            </div>
          </Link>
        )
      })}
    </div>
  )
}
