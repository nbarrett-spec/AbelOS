'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Bell } from 'lucide-react'
import { useStaffAuth } from '@/hooks/useStaffAuth'
import EmptyState from '@/components/ui/EmptyState'
import PageHeader from '@/components/ui/PageHeader'

interface Notification {
  id: string
  type: NotificationType
  title: string
  body: string
  timestamp: string
  read: boolean
  link?: string
  relatedId?: string
}

type NotificationType =
  | 'JOB_UPDATE'
  | 'TASK_ASSIGNED'
  | 'MESSAGE'
  | 'PO_APPROVAL'
  | 'DELIVERY_UPDATE'
  | 'QC_ALERT'
  | 'INVOICE_OVERDUE'
  | 'SCHEDULE_CHANGE'
  | 'SYSTEM'

const NOTIFICATION_CONFIG: Record<
  NotificationType,
  {
    icon: string
    color: string
    bgColor: string
    label: string
  }
> = {
  JOB_UPDATE: {
    icon: '🔧',
    color: 'text-blue-600',
    bgColor: 'bg-blue-50',
    label: 'Job Update',
  },
  TASK_ASSIGNED: {
    icon: '✅',
    color: 'text-green-600',
    bgColor: 'bg-green-50',
    label: 'Task Assigned',
  },
  MESSAGE: {
    icon: '💬',
    color: 'text-purple-600',
    bgColor: 'bg-purple-50',
    label: 'Message',
  },
  PO_APPROVAL: {
    icon: '🛒',
    color: 'text-orange-600',
    bgColor: 'bg-orange-50',
    label: 'Purchase Order',
  },
  DELIVERY_UPDATE: {
    icon: '🚚',
    color: 'text-teal-600',
    bgColor: 'bg-teal-50',
    label: 'Delivery',
  },
  QC_ALERT: {
    icon: '⚠️',
    color: 'text-red-600',
    bgColor: 'bg-red-50',
    label: 'QC Alert',
  },
  INVOICE_OVERDUE: {
    icon: '💰',
    color: 'text-yellow-600',
    bgColor: 'bg-yellow-50',
    label: 'Invoice',
  },
  SCHEDULE_CHANGE: {
    icon: '📅',
    color: 'text-indigo-600',
    bgColor: 'bg-indigo-50',
    label: 'Schedule',
  },
  SYSTEM: {
    icon: '⚙️',
    color: 'text-gray-600',
    bgColor: 'bg-gray-50',
    label: 'System',
  },
}

export default function NotificationsPage() {
  const { staff } = useStaffAuth()
  const currentUserId = staff?.id || ''
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [selectedFilter, setSelectedFilter] = useState<NotificationType | 'All'>('All')
  const [loading, setLoading] = useState(true)
  const router = useRouter()

  // Load notifications
  useEffect(() => {
    if (!currentUserId) return

    async function loadNotifications() {
      try {
        setLoading(true)
        const response = await fetch(`/api/ops/notifications?staffId=${currentUserId}`)
        if (response.ok) {
          const data = await response.json()
          // Map API shape — notifications have createdAt, page expects timestamp
          const mapped = (data.notifications || []).map((n: any) => ({
            ...n,
            timestamp: n.createdAt,
          }))
          setNotifications(mapped)
        }
      } catch (error) {
        console.error('Failed to load notifications:', error)
      } finally {
        setLoading(false)
      }
    }

    loadNotifications()
  }, [currentUserId])

  // Mark all as read
  const handleMarkAllRead = async () => {
    try {
      const unreadIds = notifications.filter(n => !n.read).map(n => n.id)
      if (unreadIds.length === 0) return

      await fetch(`/api/ops/notifications`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          markAllRead: true,
          staffId: currentUserId,
        }),
      })

      // Update local state
      setNotifications(notifications.map(n => ({ ...n, read: true })))
    } catch (error) {
      console.error('Failed to mark as read:', error)
    }
  }

  // Handle notification click
  const handleNotificationClick = async (notification: Notification) => {
    // Mark as read
    if (!notification.read) {
      try {
        await fetch(`/api/ops/notifications`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            notificationIds: [notification.id],
            staffId: currentUserId,
          }),
        })

        setNotifications(
          notifications.map(n =>
            n.id === notification.id ? { ...n, read: true } : n
          )
        )
      } catch (error) {
        console.error('Failed to mark notification as read:', error)
      }
    }

    // Navigate if link exists
    if (notification.link) {
      router.push(notification.link)
    }
  }

  // Group notifications by date
  const groupNotificationsByDate = (notifs: Notification[]) => {
    const today = new Date()
    today.setHours(0, 0, 0, 0)

    const yesterday = new Date(today)
    yesterday.setDate(yesterday.getDate() - 1)

    const groups: Record<string, Notification[]> = {
      Today: [],
      Yesterday: [],
      Earlier: [],
    }

    notifs.forEach(notif => {
      const notifDate = new Date(notif.timestamp)
      notifDate.setHours(0, 0, 0, 0)

      if (notifDate.getTime() === today.getTime()) {
        groups['Today'].push(notif)
      } else if (notifDate.getTime() === yesterday.getTime()) {
        groups['Yesterday'].push(notif)
      } else {
        groups['Earlier'].push(notif)
      }
    })

    return groups
  }

  // Filter notifications
  const filteredNotifications = notifications.filter(n => {
    if (selectedFilter === 'All') return true
    return n.type === selectedFilter
  })

  const groupedNotifications = groupNotificationsByDate(filteredNotifications)

  // Get unread count
  const unreadCount = notifications.filter(n => !n.read).length

  const getRelativeTime = (timestamp: string) => {
    const date = new Date(timestamp)
    const now = new Date()
    const seconds = Math.floor((now.getTime() - date.getTime()) / 1000)

    if (seconds < 60) return 'just now'
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
    if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  }

  return (
    <div className="h-full flex flex-col gap-4">
      <PageHeader
        title="Notifications"
        description={unreadCount > 0
          ? `${unreadCount} unread notification${unreadCount !== 1 ? 's' : ''}`
          : undefined}
        actions={
          unreadCount > 0 ? (
            <button
              onClick={handleMarkAllRead}
              className="px-4 py-2 text-sm font-medium text-fg-muted border border-border rounded-lg hover:bg-row-hover transition-colors"
            >
              Mark all read
            </button>
          ) : undefined
        }
      />

      {/* Filters */}
      <div className="flex gap-2 overflow-x-auto pb-2">
        {['All', ...Object.keys(NOTIFICATION_CONFIG)].map(filterType => (
          <button
            key={filterType}
            onClick={() => setSelectedFilter(filterType as any)}
            className={`px-4 py-2 rounded-full text-sm font-medium transition-all whitespace-nowrap ${
              selectedFilter === filterType
                ? 'bg-signal text-fg-on-accent'
                : 'bg-surface-elev text-fg-muted border border-border hover:border-border-strong'
            }`}
          >
            {filterType === 'All' ? 'All' : NOTIFICATION_CONFIG[filterType as NotificationType].label}
          </button>
        ))}
      </div>

      {/* Notifications */}
      <div className="flex-1 overflow-y-auto bg-surface-elev rounded-lg border border-border">
        {loading ? (
          <div className="flex items-center justify-center h-full text-fg-muted">
            <p>Loading notifications...</p>
          </div>
        ) : Object.values(groupedNotifications).every(g => g.length === 0) ? (
          <EmptyState
            icon={<Bell className="w-8 h-8 text-fg-subtle" />}
            title="No notifications"
            description="You're all caught up!"
          />
        ) : (
          <div className="divide-y divide-border">
            {['Today', 'Yesterday', 'Earlier'].map(dateGroup => {
              const notifs = groupedNotifications[dateGroup]
              if (notifs.length === 0) return null

              return (
                <div key={dateGroup}>
                  {/* Date header */}
                  <div className="sticky top-0 bg-surface-muted px-6 py-3 border-b border-border">
                    <h3 className="text-xs font-semibold text-fg-muted uppercase tracking-wider">
                      {dateGroup}
                    </h3>
                  </div>

                  {/* Notifications for this date */}
                  {notifs.map(notification => {
                    const config = NOTIFICATION_CONFIG[notification.type]
                    return (
                      <button
                        key={notification.id}
                        onClick={() => handleNotificationClick(notification)}
                        className={`w-full text-left px-6 py-4 border-l-4 transition-all hover:bg-row-hover ${
                          notification.read
                            ? 'border-transparent bg-surface-elev'
                            : 'border-signal bg-signal-subtle/30'
                        } ${notification.link ? 'cursor-pointer' : ''}`}
                      >
                        <div className="flex gap-4">
                          {/* Icon */}
                          <div
                            className={`text-2xl flex-shrink-0 ${
                              notification.read ? 'opacity-60' : 'opacity-100'
                            }`}
                          >
                            {config.icon}
                          </div>

                          {/* Content */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-start justify-between gap-2">
                              <div className="flex-1">
                                <h4
                                  className={`font-semibold ${
                                    notification.read
                                      ? 'text-fg-muted'
                                      : 'text-fg'
                                  }`}
                                >
                                  {notification.title}
                                </h4>
                                <p className="text-sm text-fg-muted mt-1 line-clamp-2">
                                  {notification.body}
                                </p>
                              </div>
                              {!notification.read && (
                                <div className="w-2 h-2 rounded-full bg-signal flex-shrink-0 mt-2" />
                              )}
                            </div>

                            {/* Footer */}
                            <div className="flex items-center justify-between mt-2">
                              <div className="flex gap-2">
                                <span
                                  className={`text-xs px-2 py-1 rounded font-medium ${config.color} ${config.bgColor}`}
                                >
                                  {config.label}
                                </span>
                              </div>
                              <span className="text-xs text-fg-subtle">
                                {getRelativeTime(notification.timestamp)}
                              </span>
                            </div>
                          </div>
                        </div>
                      </button>
                    )
                  })}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
