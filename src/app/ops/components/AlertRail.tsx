'use client'

import Link from 'next/link'
import { AlertTriangle, AlertCircle, CheckCircle2 } from 'lucide-react'

interface Alert {
  id: string
  type: 'critical' | 'warning' | 'info' | 'success'
  title: string
  count: number
  href: string
  icon?: 'alert' | 'warning' | 'check'
}

const severityConfig = {
  critical: {
    bg: 'bg-danger-50 border-danger-200',
    text: 'text-danger-700',
    badge: 'bg-danger-100 text-danger-700',
    icon: 'AlertTriangle',
  },
  warning: {
    bg: 'bg-warning-50 border-warning-200',
    text: 'text-warning-700',
    badge: 'bg-warning-100 text-warning-700',
    icon: 'AlertCircle',
  },
  info: {
    bg: 'bg-info-50 border-info-200',
    text: 'text-info-700',
    badge: 'bg-info-100 text-info-700',
    icon: 'AlertCircle',
  },
  success: {
    bg: 'bg-success-50 border-success-200',
    text: 'text-success-700',
    badge: 'bg-success-100 text-success-700',
    icon: 'CheckCircle2',
  },
}

export function AlertRail({ alerts }: { alerts: Alert[] }) {
  if (alerts.length === 0) {
    return null
  }

  return (
    <div className="mb-6 space-y-2">
      <div className="flex items-center gap-2">
        <div className="w-1 h-4 bg-gradient-to-b from-abel-amber to-abel-amber rounded-full" />
        <p className="text-xs font-semibold text-gray-600 uppercase tracking-wider">System Alerts</p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
        {alerts.map((alert) => {
          const config = severityConfig[alert.type]
          return (
            <Link key={alert.id} href={alert.href}>
              <div className={`${config.bg} border px-3 py-2.5 rounded-lg cursor-pointer hover:shadow-elevation-2 transition-shadow`}>
                <div className="flex items-start gap-2">
                  <div className={`text-sm font-bold ${config.badge} px-2 py-1 rounded`}>
                    {alert.count}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-semibold ${config.text} truncate`}>{alert.title}</p>
                  </div>
                </div>
              </div>
            </Link>
          )
        })}
      </div>
    </div>
  )
}
