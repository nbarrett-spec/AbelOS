'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

interface ActionItem {
  id: string
  type: string
  priority: 'HIGH' | 'MEDIUM' | 'LOW'
  title: string
  subtitle: string
  href: string
  age?: string
  amount?: number
}

interface ActionSummary {
  total: number
  high: number
  medium: number
  low: number
}

const TYPE_ICONS: Record<string, string> = {
  ORDER_CONFIRM: '📦',
  INVOICE_OVERDUE: '💰',
  PO_APPROVAL: '📋',
  JOB_SCHEDULE: '🔧',
  QUOTE_FOLLOWUP: '📝',
  DELIVERY_TODAY: '🚚',
}

const PRIORITY_STYLES: Record<string, { dot: string; bg: string }> = {
  HIGH: { dot: 'bg-red-500', bg: 'border-l-red-400' },
  MEDIUM: { dot: 'bg-amber-400', bg: 'border-l-amber-400' },
  LOW: { dot: 'bg-blue-400', bg: 'border-l-blue-300' },
}

export function ActionQueue() {
  const [actions, setActions] = useState<ActionItem[]>([])
  const [summary, setSummary] = useState<ActionSummary>({ total: 0, high: 0, medium: 0, low: 0 })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch('/api/ops/action-queue')
        if (res.ok) {
          const data = await res.json()
          setActions(data.actions || [])
          setSummary(data.summary || { total: 0, high: 0, medium: 0, low: 0 })
        }
      } catch (err) {
        console.error('Failed to load action queue:', err)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map(i => (
          <div key={i} className="animate-pulse h-14 bg-gray-100 rounded-lg" />
        ))}
      </div>
    )
  }

  if (actions.length === 0) {
    return (
      <div className="text-center py-6">
        <div className="text-3xl mb-2">✅</div>
        <p className="text-sm text-gray-500 font-medium">All caught up!</p>
        <p className="text-xs text-gray-400 mt-1">No urgent actions right now</p>
      </div>
    )
  }

  return (
    <div>
      {/* Priority summary */}
      <div className="flex items-center gap-3 mb-3">
        {summary.high > 0 && (
          <span className="flex items-center gap-1 text-xs font-semibold text-red-600">
            <span className="w-2 h-2 bg-red-500 rounded-full" />
            {summary.high} urgent
          </span>
        )}
        {summary.medium > 0 && (
          <span className="flex items-center gap-1 text-xs text-amber-600">
            <span className="w-2 h-2 bg-amber-400 rounded-full" />
            {summary.medium} pending
          </span>
        )}
        {summary.low > 0 && (
          <span className="flex items-center gap-1 text-xs text-gray-500">
            <span className="w-2 h-2 bg-blue-400 rounded-full" />
            {summary.low} follow-up
          </span>
        )}
      </div>

      {/* Action items */}
      <div className="space-y-1.5">
        {actions.map(action => {
          const style = PRIORITY_STYLES[action.priority] || PRIORITY_STYLES.LOW
          const icon = TYPE_ICONS[action.type] || '📌'

          return (
            <Link
              key={action.id}
              href={action.href}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border-l-[3px] ${style.bg} bg-white hover:bg-gray-50 transition-colors group`}
            >
              <span className="text-base flex-shrink-0">{icon}</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900 truncate group-hover:text-[#1B4F72]">{action.title}</p>
                <p className="text-[11px] text-gray-500 truncate">{action.subtitle}</p>
              </div>
              {action.age && (
                <span className={`text-[10px] font-medium flex-shrink-0 px-2 py-0.5 rounded-full ${
                  action.priority === 'HIGH' ? 'bg-red-50 text-red-600' :
                  action.priority === 'MEDIUM' ? 'bg-amber-50 text-amber-600' :
                  'bg-gray-100 text-gray-500'
                }`}>
                  {action.age}
                </span>
              )}
            </Link>
          )
        })}
      </div>
    </div>
  )
}
