'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useAuth } from '@/hooks/useAuth'

interface BuilderNotification {
  id: string
  type: string
  title: string
  message: string
  link?: string
  read: boolean
  createdAt: string
}

const NOTIF_ICONS: Record<string, string> = {
  order_status: '📦',
  order_confirmed: '✅',
  order_shipped: '🚚',
  order_delivered: '📬',
  quote_ready: '📋',
  delivery_update: '🚚',
  delivery_scheduled: '📅',
  delivery_in_transit: '🚛',
  delivery_complete: '✅',
  delivery_rescheduled: '🔄',
  invoice_created: '💳',
  invoice_overdue: '⚠️',
  payment_received: '💰',
  general: '🔔',
}

const NOTIF_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  order_status: { bg: 'bg-blue-50', text: 'text-blue-700', border: 'border-l-4 border-blue-400' },
  order_confirmed: { bg: 'bg-green-50', text: 'text-green-700', border: 'border-l-4 border-green-400' },
  order_shipped: { bg: 'bg-cyan-50', text: 'text-cyan-700', border: 'border-l-4 border-cyan-400' },
  order_delivered: { bg: 'bg-violet-50', text: 'text-violet-700', border: 'border-l-4 border-violet-400' },
  quote_ready: { bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-l-4 border-amber-400' },
  delivery_update: { bg: 'bg-orange-50', text: 'text-orange-700', border: 'border-l-4 border-orange-400' },
  delivery_scheduled: { bg: 'bg-indigo-50', text: 'text-indigo-700', border: 'border-l-4 border-indigo-400' },
  delivery_in_transit: { bg: 'bg-orange-50', text: 'text-orange-700', border: 'border-l-4 border-orange-400' },
  delivery_complete: { bg: 'bg-green-50', text: 'text-green-700', border: 'border-l-4 border-green-400' },
  delivery_rescheduled: { bg: 'bg-purple-50', text: 'text-purple-700', border: 'border-l-4 border-purple-400' },
  invoice_created: { bg: 'bg-slate-50', text: 'text-slate-700', border: 'border-l-4 border-slate-400' },
  invoice_overdue: { bg: 'bg-red-50', text: 'text-red-700', border: 'border-l-4 border-red-400' },
  payment_received: { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-l-4 border-emerald-400' },
  general: { bg: 'bg-gray-50', text: 'text-gray-700', border: 'border-l-4 border-gray-400' },
}

const TYPE_LABELS: Record<string, string> = {
  order_status: 'Order Status',
  order_confirmed: 'Order Confirmed',
  order_shipped: 'Order Shipped',
  order_delivered: 'Order Delivered',
  quote_ready: 'Quote Ready',
  delivery_update: 'Delivery Update',
  delivery_scheduled: 'Delivery Scheduled',
  delivery_in_transit: 'Delivery In Transit',
  delivery_complete: 'Delivery Completed',
  delivery_rescheduled: 'Delivery Rescheduled',
  invoice_created: 'Invoice Created',
  invoice_overdue: 'Invoice Overdue',
  payment_received: 'Payment Received',
  general: 'General',
}

export default function NotificationsPage() {
  const { builder } = useAuth()
  const router = useRouter()
  const [notifications, setNotifications] = useState<BuilderNotification[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [filter, setFilter] = useState<'all' | 'unread'>('all')
  const [isLoading, setIsLoading] = useState(true)
  const [selectedNotifs, setSelectedNotifs] = useState<Set<string>>(new Set())

  const fetchNotifications = useCallback(async () => {
    if (!builder) return
    try {
      const url = filter === 'unread' ? '/api/notifications?unread=true' : '/api/notifications'
      const res = await fetch(url)
      if (res.ok) {
        const data = await res.json()
        setNotifications(data.notifications || [])
        setUnreadCount(data.unreadCount || 0)
      }
    } catch (error) {
      console.error('Failed to fetch notifications:', error)
    } finally {
      setIsLoading(false)
    }
  }, [builder, filter])

  useEffect(() => {
    fetchNotifications()
  }, [fetchNotifications])

  const markAsRead = async (id: string) => {
    try {
      await fetch('/api/notifications', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notificationIds: [id] }),
      })
      setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n))
      setUnreadCount(prev => Math.max(0, prev - 1))
    } catch (error) {
      console.error('Failed to mark notification as read:', error)
    }
  }

  const markSelectedAsRead = async () => {
    if (selectedNotifs.size === 0) return
    try {
      await fetch('/api/notifications', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notificationIds: Array.from(selectedNotifs) }),
      })
      setNotifications(prev =>
        prev.map(n => selectedNotifs.has(n.id) ? { ...n, read: true } : n)
      )
      const unreadSelected = Array.from(selectedNotifs).filter(id =>
        notifications.find(n => n.id === id && !n.read)
      ).length
      setUnreadCount(prev => Math.max(0, prev - unreadSelected))
      setSelectedNotifs(new Set())
    } catch (error) {
      console.error('Failed to mark notifications as read:', error)
    }
  }

  const markAllAsRead = async () => {
    try {
      await fetch('/api/notifications', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ markAllRead: true }),
      })
      setNotifications(prev => prev.map(n => ({ ...n, read: true })))
      setUnreadCount(0)
    } catch (error) {
      console.error('Failed to mark all as read:', error)
    }
  }

  const handleNotificationClick = (notif: BuilderNotification) => {
    if (!notif.read) markAsRead(notif.id)
    if (notif.link) {
      router.push(notif.link)
    }
  }

  const getTimeAgo = (ts: string) => {
    const sec = Math.floor((Date.now() - new Date(ts).getTime()) / 1000)
    if (sec < 60) return 'just now'
    if (sec < 3600) return `${Math.floor(sec / 60)}m ago`
    if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`
    if (sec < 604800) return `${Math.floor(sec / 86400)}d ago`
    return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  }

  const toggleSelected = (id: string) => {
    const newSelected = new Set(selectedNotifs)
    if (newSelected.has(id)) {
      newSelected.delete(id)
    } else {
      newSelected.add(id)
    }
    setSelectedNotifs(newSelected)
  }

  const filteredNotifications = filter === 'unread'
    ? notifications.filter(n => !n.read)
    : notifications

  const typeKey = (type: string) => type.toLowerCase().replace(/_/g, '_')
  const getIcon = (type: string) => NOTIF_ICONS[typeKey(type)] || '🔔'
  const getColors = (type: string) => NOTIF_COLORS[typeKey(type)] || NOTIF_COLORS.general
  const getLabel = (type: string) => TYPE_LABELS[typeKey(type)] || type

  if (!builder) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p>Redirecting...</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">Notifications</h1>
              <p className="text-gray-500 mt-1">
                {unreadCount > 0 ? `${unreadCount} unread notification${unreadCount !== 1 ? 's' : ''}` : 'All caught up!'}
              </p>
            </div>
            {unreadCount > 0 && (
              <button
                onClick={markAllAsRead}
                className="px-4 py-2 bg-abel-orange text-white rounded-lg hover:bg-abel-orange/90 transition font-medium"
              >
                Mark All as Read
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
        <div className="flex items-center gap-3">
          <button
            onClick={() => { setFilter('all'); setSelectedNotifs(new Set()) }}
            className={`px-4 py-2 rounded-lg font-medium transition ${
              filter === 'all'
                ? 'bg-abel-navy text-white'
                : 'bg-white text-gray-700 border border-gray-200 hover:border-gray-300'
            }`}
          >
            All ({notifications.length})
          </button>
          <button
            onClick={() => { setFilter('unread'); setSelectedNotifs(new Set()) }}
            className={`px-4 py-2 rounded-lg font-medium transition ${
              filter === 'unread'
                ? 'bg-abel-navy text-white'
                : 'bg-white text-gray-700 border border-gray-200 hover:border-gray-300'
            }`}
          >
            Unread ({notifications.filter(n => !n.read).length})
          </button>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 pb-12">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <div className="text-center">
              <div className="w-8 h-8 border-4 border-gray-300 border-t-abel-orange rounded-full animate-spin mx-auto mb-3"></div>
              <p className="text-gray-500">Loading notifications...</p>
            </div>
          </div>
        ) : filteredNotifications.length === 0 ? (
          <div className="bg-white rounded-lg border border-gray-200 py-12 text-center">
            <svg className="w-16 h-16 text-gray-300 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
            </svg>
            <p className="text-gray-500 font-medium">
              {filter === 'unread' ? 'No unread notifications' : 'No notifications yet'}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {selectedNotifs.size > 0 && (
              <div className="bg-abel-navy/10 border border-abel-navy/20 rounded-lg p-4 flex items-center justify-between">
                <span className="text-sm font-medium text-abel-navy">
                  {selectedNotifs.size} selected
                </span>
                <button
                  onClick={markSelectedAsRead}
                  className="text-sm px-3 py-1.5 bg-abel-navy text-white rounded hover:bg-abel-navy/90 transition font-medium"
                >
                  Mark as Read
                </button>
              </div>
            )}

            {filteredNotifications.map(notif => {
              const colors = getColors(notif.type)
              const icon = getIcon(notif.type)
              const label = getLabel(notif.type)
              const isSelected = selectedNotifs.has(notif.id)

              return (
                <div
                  key={notif.id}
                  className={`${colors.border} bg-white border border-gray-200 rounded-lg p-4 transition hover:shadow-md cursor-pointer ${
                    !notif.read ? 'ring-1 ring-abel-orange/20' : ''
                  }`}
                  onClick={() => handleNotificationClick(notif)}
                >
                  <div className="flex items-start gap-4">
                    <div
                      className="flex-shrink-0 mt-1"
                      onClick={e => {
                        e.stopPropagation()
                        toggleSelected(notif.id)
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => { }}
                        className="w-5 h-5 rounded border-gray-300 text-abel-orange focus:ring-abel-orange/20 cursor-pointer"
                      />
                    </div>

                    <div className="flex-shrink-0 text-3xl mt-0.5">
                      {icon}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="flex items-center gap-2">
                            <p className={`font-semibold ${!notif.read ? 'text-gray-900' : 'text-gray-700'}`}>
                              {notif.title}
                            </p>
                            <span className="inline-flex items-center px-2 py-1 rounded text-xs font-medium bg-gray-100 text-gray-700">
                              {label}
                            </span>
                          </div>
                          <p className="text-gray-600 mt-1 text-sm">{notif.message}</p>
                          <p className="text-gray-400 text-xs mt-2">{getTimeAgo(notif.createdAt)}</p>
                        </div>

                        {!notif.read && (
                          <div className="flex-shrink-0">
                            <span className="inline-block w-3 h-3 bg-abel-orange rounded-full"></span>
                          </div>
                        )}
                      </div>

                      {notif.link && (
                        <div className="mt-3 flex items-center gap-2 text-sm text-abel-orange hover:text-abel-orange/80 font-medium">
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                          </svg>
                          View Details
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 pb-8">
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-2 text-abel-orange hover:text-abel-orange/80 font-medium"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Back to Dashboard
        </Link>
      </div>
    </div>
  )
}
