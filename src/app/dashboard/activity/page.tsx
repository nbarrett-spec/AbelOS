'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'

interface Activity {
  id: string
  type: 'ORDER' | 'QUOTE' | 'WARRANTY' | 'INVOICE'
  title: string
  description: string
  status: string
  amount?: number
  link: string
  timestamp: string
  createdAt: string
}

const TYPE_CONFIG: Record<string, { icon: string; color: string; bg: string }> = {
  ORDER: { icon: '📦', color: 'text-blue-700', bg: 'bg-blue-50' },
  QUOTE: { icon: '📋', color: 'text-indigo-700', bg: 'bg-indigo-50' },
  WARRANTY: { icon: '🛡️', color: 'text-amber-700', bg: 'bg-amber-50' },
  INVOICE: { icon: '💳', color: 'text-green-700', bg: 'bg-green-50' },
}

const STATUS_COLORS: Record<string, string> = {
  RECEIVED: 'bg-blue-100 text-blue-700',
  CONFIRMED: 'bg-indigo-100 text-indigo-700',
  IN_PRODUCTION: 'bg-yellow-100 text-yellow-700',
  READY_TO_SHIP: 'bg-purple-100 text-purple-700',
  SHIPPED: 'bg-orange-100 text-orange-700',
  DELIVERED: 'bg-green-100 text-green-700',
  COMPLETE: 'bg-green-100 text-green-700',
  DRAFT: 'bg-surface-muted text-fg-muted',
  SENT: 'bg-blue-100 text-blue-700',
  APPROVED: 'bg-green-100 text-green-700',
  REJECTED: 'bg-red-100 text-red-700',
  EXPIRED: 'bg-surface-muted text-fg-muted',
  ORDERED: 'bg-green-100 text-green-700',
  OPEN: 'bg-blue-100 text-blue-700',
  IN_PROGRESS: 'bg-yellow-100 text-yellow-700',
  RESOLVED: 'bg-green-100 text-green-700',
  CLOSED: 'bg-surface-muted text-fg-muted',
  PAID: 'bg-green-100 text-green-700',
  OVERDUE: 'bg-red-100 text-red-700',
  CANCELLED: 'bg-surface-muted text-fg-muted',
}

function timeAgo(dateStr: string): string {
  const now = new Date()
  const date = new Date(dateStr)
  const seconds = Math.floor((now.getTime() - date.getTime()) / 1000)

  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return date.toLocaleDateString()
}

export default function ActivityPage() {
  const [activities, setActivities] = useState<Activity[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<string>('ALL')

  useEffect(() => {
    fetch('/api/activity')
      .then(r => r.json())
      .then(data => setActivities(data.activities || []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const filtered = filter === 'ALL' ? activities : activities.filter(a => a.type === filter)

  // Group activities by date
  const grouped: Record<string, Activity[]> = {}
  for (const a of filtered) {
    const date = new Date(a.timestamp)
    const today = new Date()
    const yesterday = new Date(today)
    yesterday.setDate(yesterday.getDate() - 1)

    let key: string
    if (date.toDateString() === today.toDateString()) {
      key = 'Today'
    } else if (date.toDateString() === yesterday.toDateString()) {
      key = 'Yesterday'
    } else {
      key = date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
    }

    if (!grouped[key]) grouped[key] = []
    grouped[key].push(a)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 border-4 border-brand border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-fg">Activity Log</h1>
          <p className="text-fg-muted text-sm mt-1">Recent activity across your account</p>
        </div>
        <Link href="/dashboard" className="text-sm text-brand hover:underline">
          ← Back to Dashboard
        </Link>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-2 mb-6 flex-wrap">
        {[
          { key: 'ALL', label: 'All Activity' },
          { key: 'ORDER', label: 'Orders' },
          { key: 'QUOTE', label: 'Quotes' },
          { key: 'INVOICE', label: 'Invoices' },
          { key: 'WARRANTY', label: 'Warranty' },
        ].map(f => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`px-4 py-1.5 rounded-full text-sm font-medium transition ${
              filter === f.key
                ? 'bg-brand text-white'
                : 'bg-surface border border-border text-fg-muted hover:bg-surface-muted'
            }`}
          >
            {f.label}
            {f.key !== 'ALL' && (
              <span className="ml-1.5 opacity-70">
                ({activities.filter(a => f.key === 'ALL' || a.type === f.key).length})
              </span>
            )}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="bg-surface rounded-2xl border p-12 text-center">
          <p className="text-fg-subtle text-lg">No activity found</p>
        </div>
      ) : (
        <div className="space-y-8">
          {Object.entries(grouped).map(([dateLabel, items]) => (
            <div key={dateLabel}>
              <h3 className="text-xs font-semibold text-fg-subtle uppercase tracking-wider mb-3">{dateLabel}</h3>
              <div className="space-y-2">
                {items.map(activity => {
                  const config = TYPE_CONFIG[activity.type] || TYPE_CONFIG.ORDER
                  return (
                    <Link
                      key={activity.id}
                      href={activity.link}
                      className="flex items-start gap-4 bg-surface rounded-xl border border-border hover:border-border hover:shadow-sm transition p-4"
                    >
                      <div className={`w-10 h-10 rounded-lg ${config.bg} flex items-center justify-center text-lg flex-shrink-0`}>
                        {config.icon}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium text-fg text-sm">{activity.title}</span>
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${STATUS_COLORS[activity.status] || 'bg-surface-muted text-fg-muted'}`}>
                            {activity.status.replace(/_/g, ' ')}
                          </span>
                        </div>
                        <p className="text-sm text-fg-muted mt-0.5">{activity.description}</p>
                      </div>
                      <div className="text-right flex-shrink-0">
                        {activity.amount !== undefined && activity.amount !== null && (
                          <p className="text-sm font-semibold text-fg">
                            ${activity.amount.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                          </p>
                        )}
                        <p className="text-xs text-fg-subtle mt-0.5">{timeAgo(activity.timestamp)}</p>
                      </div>
                    </Link>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
