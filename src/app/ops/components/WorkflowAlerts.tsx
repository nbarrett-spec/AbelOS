'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

interface WorkflowAlert {
  id: string
  severity: 'HIGH' | 'MEDIUM' | 'LOW'
  title: string
  description: string
  actionHref: string
  actionLabel: string
  count?: number
  timeframe?: string
}

export function WorkflowAlerts() {
  const [alerts, setAlerts] = useState<WorkflowAlert[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function loadAlerts() {
      try {
        const response = await fetch('/api/ops/ai/alerts')
        const data = await response.json()
        setAlerts(data.alerts?.slice(0, 5) || [])
      } catch (error) {
        console.error('Failed to load alerts:', error)
      } finally {
        setLoading(false)
      }
    }

    loadAlerts()
  }, [])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-[#1B4F72]" />
      </div>
    )
  }

  if (alerts.length === 0) {
    return (
      <div className="text-center py-8">
        <p className="text-green-600 font-medium">✓ All systems operating normally</p>
        <p className="text-xs text-gray-400 mt-1">No workflow alerts at this time</p>
      </div>
    )
  }

  const severityConfig = {
    HIGH: { bgColor: 'bg-red-50', borderColor: 'border-l-red-500', dotColor: 'bg-red-500', textColor: 'text-red-700' },
    MEDIUM: { bgColor: 'bg-orange-50', borderColor: 'border-l-orange-500', dotColor: 'bg-orange-500', textColor: 'text-orange-700' },
    LOW: { bgColor: 'bg-blue-50', borderColor: 'border-l-blue-500', dotColor: 'bg-blue-500', textColor: 'text-blue-700' },
  }

  return (
    <div className="space-y-2 max-h-[400px] overflow-y-auto">
      {alerts.map((alert) => {
        const config = severityConfig[alert.severity]
        return (
          <div
            key={alert.id}
            className={`${config.bgColor} border-l-4 ${config.borderColor} p-3 rounded-lg`}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <div className={`w-2 h-2 rounded-full ${config.dotColor} flex-shrink-0`} />
                  <h4 className={`text-sm font-semibold ${config.textColor}`}>
                    {alert.title}
                  </h4>
                  {alert.count && (
                    <span className={`px-1.5 py-0.5 text-xs rounded font-bold ${config.textColor} opacity-70`}>
                      {alert.count}
                    </span>
                  )}
                </div>
                <p className="text-xs text-gray-600 mt-1">{alert.description}</p>
                {alert.timeframe && (
                  <p className="text-xs text-gray-400 mt-1">{alert.timeframe}</p>
                )}
              </div>
              <Link
                href={alert.actionHref}
                className={`flex-shrink-0 px-2.5 py-1 text-xs font-medium rounded ${config.textColor} bg-white hover:bg-gray-100 transition-colors whitespace-nowrap`}
              >
                {alert.actionLabel}
              </Link>
            </div>
          </div>
        )
      })}
    </div>
  )
}
