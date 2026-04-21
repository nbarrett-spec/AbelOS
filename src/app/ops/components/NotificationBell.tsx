'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

interface Notification {
  id: string
  staffId: string
  type: string
  title: string
  message: string | null
  link: string | null
  read: boolean
  createdAt: string
}

export function NotificationBell() {
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [isOpen, setIsOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const router = useRouter()

  const fetchNotifications = async () => {
    try {
      const staffId = localStorage.getItem('x-staff-id')
      if (!staffId) return

      const response = await fetch('/api/ops/notifications', {
        headers: { 'x-staff-id': staffId },
      })
      const data = await response.json()
      setNotifications(data.notifications || [])
      setUnreadCount(data.unreadCount || 0)
    } catch (error) {
      console.error('Failed to fetch notifications:', error)
    }
  }

  useEffect(() => {
    fetchNotifications()
    const interval = setInterval(fetchNotifications, 30000)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const markAsRead = async (notificationIds: string[]) => {
    try {
      const staffId = localStorage.getItem('x-staff-id')
      if (!staffId) return

      await fetch('/api/ops/notifications', {
        method: 'PATCH',
        headers: {
          'x-staff-id': staffId,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ids: notificationIds }),
      })

      await fetchNotifications()
    } catch (error) {
      console.error('Failed to mark notifications as read:', error)
    }
  }

  const markAllAsRead = async () => {
    try {
      const staffId = localStorage.getItem('x-staff-id')
      if (!staffId) return

      await fetch('/api/ops/notifications', {
        method: 'PATCH',
        headers: {
          'x-staff-id': staffId,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ markAllRead: true }),
      })

      await fetchNotifications()
    } catch (error) {
      console.error('Failed to mark all notifications as read:', error)
    }
  }

  const handleNotificationClick = async (notification: Notification) => {
    if (!notification.read) {
      await markAsRead([notification.id])
    }
    if (notification.link) {
      router.push(notification.link)
      setIsOpen(false)
    }
  }

  const timeAgo = (dateString: string) => {
    const date = new Date(dateString)
    const now = new Date()
    const seconds = Math.floor((now.getTime() - date.getTime()) / 1000)

    if (seconds < 60) return 'just now'
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
    return `${Math.floor(seconds / 86400)}d ago`
  }

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="relative p-2 hover:bg-gray-100 rounded-lg transition-colors"
        aria-label="Notifications"
      >
        <svg
          className="w-6 h-6"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          style={{ color: '#1e3a5f' }}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
          />
        </svg>
        {unreadCount > 0 && (
          <span
            className="absolute top-0 right-0 w-5 h-5 text-white text-xs flex items-center justify-center rounded-full font-bold"
            style={{ backgroundColor: '#C6A24E' }}
          >
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <div
          className="absolute right-0 mt-2 w-96 bg-white rounded-lg shadow-xl z-50"
          style={{ maxHeight: '500px', boxShadow: '0 10px 25px rgba(0, 0, 0, 0.1)' }}
        >
          <div className="border-b p-4 flex items-center justify-between" style={{ borderColor: '#C6A24E' }}>
            <h3 className="font-semibold" style={{ color: '#1e3a5f' }}>
              Notifications
            </h3>
            {unreadCount > 0 && (
              <button
                onClick={markAllAsRead}
                className="text-sm px-2 py-1 rounded transition-colors"
                style={{ color: '#C6A24E', backgroundColor: '#fff3e0' }}
              >
                Mark all as read
              </button>
            )}
          </div>

          <div style={{ maxHeight: '400px', overflowY: 'auto' }}>
            {notifications.length === 0 ? (
              <div className="p-4 text-center text-gray-500">
                <p>No notifications yet</p>
              </div>
            ) : (
              notifications.map((notif) => (
                <div
                  key={notif.id}
                  onClick={() => handleNotificationClick(notif)}
                  className="border-b p-3 cursor-pointer transition-colors hover:bg-gray-50"
                  style={{ backgroundColor: notif.read ? 'transparent' : '#f0f4f8' }}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <h4 className="font-semibold text-sm" style={{ color: '#1e3a5f' }}>
                          {notif.title}
                        </h4>
                        {!notif.read && (
                          <span
                            className="inline-block w-2 h-2 rounded-full"
                            style={{ backgroundColor: '#C6A24E' }}
                          />
                        )}
                      </div>
                      {notif.message && <p className="text-xs text-gray-600 mt-1 line-clamp-2">{notif.message}</p>}
                      <p className="text-xs text-gray-400 mt-1">{timeAgo(notif.createdAt)}</p>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
