'use client'

/**
 * Builder Portal — slide-in notification panel (right edge, 380px).
 *
 * §1.4 Layout Shell. Phase 1 ships a stub UI + data structure; Phase 2 wires
 * to /api/builder/notifications (or the derived `getBuilderNotifications()`
 * server function from §0.3).
 */

import { useEffect } from 'react'
import { X, Package, Truck, FileText, Receipt } from 'lucide-react'
import type { PortalNotification } from '@/types/portal'

interface PortalNotificationPanelProps {
  open: boolean
  onClose: () => void
  notifications: PortalNotification[]
  onMarkAllRead?: () => void
}

const TYPE_ICON: Record<PortalNotification['type'], typeof Package> = {
  order: Package,
  delivery: Truck,
  quote: FileText,
  invoice: Receipt,
}

function bucketLabel(ts: string): 'Today' | 'This Week' | 'Earlier' {
  const t = new Date(ts).getTime()
  const now = Date.now()
  const dayMs = 24 * 60 * 60 * 1000
  if (now - t < dayMs) return 'Today'
  if (now - t < 7 * dayMs) return 'This Week'
  return 'Earlier'
}

export function PortalNotificationPanel({
  open,
  onClose,
  notifications,
  onMarkAllRead,
}: PortalNotificationPanelProps) {
  // Esc to close
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  // Group by bucket
  const grouped: Record<string, PortalNotification[]> = { Today: [], 'This Week': [], Earlier: [] }
  for (const n of notifications) grouped[bucketLabel(n.timestamp)].push(n)

  const unread = notifications.filter((n) => !n.read).length

  return (
    <>
      {/* Backdrop */}
      {open && (
        <div
          className="fixed inset-0 z-40 transition-opacity print:hidden"
          style={{
            background: 'rgba(46,30,20,0.32)',
            backdropFilter: 'blur(2px)',
          }}
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      {/* Panel */}
      <aside
        className="fixed top-0 right-0 z-50 h-screen w-full sm:w-[380px] flex flex-col print:hidden"
        style={{
          background: 'rgba(253,250,244,0.92)',
          backdropFilter: 'blur(16px) saturate(180%)',
          WebkitBackdropFilter: 'blur(16px) saturate(180%)',
          borderLeft: '1px solid var(--portal-border, #E8DFD0)',
          boxShadow: '-12px 0 40px rgba(62,42,30,0.08)',
          transform: open ? 'translateX(0)' : 'translateX(100%)',
          transition: 'transform 280ms cubic-bezier(0.16, 1, 0.3, 1)',
          willChange: 'transform',
        }}
        aria-hidden={!open}
        aria-label="Notifications"
      >
        <header
          className="flex items-center justify-between px-5 py-4"
          style={{ borderBottom: '1px solid var(--portal-border-light, #F0E8DA)' }}
        >
          <div>
            <h2
              className="text-base font-medium"
              style={{
                fontFamily: 'var(--font-portal-display, Georgia)',
                color: 'var(--portal-text-strong, #3E2A1E)',
              }}
            >
              Notifications
            </h2>
            <p className="text-[11px]" style={{ color: 'var(--portal-text-muted, #6B6056)' }}>
              {unread > 0 ? `${unread} unread` : 'All caught up'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {unread > 0 && onMarkAllRead && (
              <button
                type="button"
                onClick={onMarkAllRead}
                className="text-xs px-2 py-1 rounded transition-colors"
                style={{
                  color: 'var(--portal-amber, #C9822B)',
                }}
              >
                Mark all read
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="w-8 h-8 flex items-center justify-center rounded-md transition-colors"
              style={{ color: 'var(--portal-text-muted, #6B6056)' }}
              aria-label="Close notifications"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto px-3 py-3 space-y-5">
          {notifications.length === 0 && (
            <div className="text-center py-12">
              <p className="text-sm" style={{ color: 'var(--portal-text-muted, #6B6056)' }}>
                Nothing new right now.
              </p>
              <p className="text-xs mt-1" style={{ color: 'var(--portal-text-muted, #6B6056)' }}>
                We&apos;ll let you know when an order or delivery moves.
              </p>
            </div>
          )}

          {(['Today', 'This Week', 'Earlier'] as const).map((bucket) => {
            const items = grouped[bucket]
            if (items.length === 0) return null
            return (
              <section key={bucket}>
                <h3
                  className="text-[10px] font-semibold uppercase tracking-wider mb-2 px-2"
                  style={{ color: 'var(--portal-kiln-oak, #8B6F47)' }}
                >
                  {bucket}
                </h3>
                <ul className="space-y-1">
                  {items.map((n) => {
                    const Icon = TYPE_ICON[n.type]
                    return (
                      <li
                        key={n.id}
                        className="px-3 py-2.5 rounded-md transition-colors hover:bg-white/60"
                        style={{
                          background: n.read ? 'transparent' : 'rgba(201,130,43,0.06)',
                        }}
                      >
                        <a href={n.link} className="flex gap-3" onClick={onClose}>
                          <div
                            className="w-8 h-8 rounded-md flex items-center justify-center shrink-0"
                            style={{
                              background: 'rgba(62,42,30,0.05)',
                              color: 'var(--portal-walnut, #3E2A1E)',
                            }}
                          >
                            <Icon className="w-4 h-4" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <p
                              className="text-sm font-medium truncate"
                              style={{ color: 'var(--portal-text-strong, #3E2A1E)' }}
                            >
                              {n.title}
                            </p>
                            <p
                              className="text-xs leading-snug line-clamp-2"
                              style={{ color: 'var(--portal-text-muted, #6B6056)' }}
                            >
                              {n.description}
                            </p>
                            <p
                              className="text-[10px] mt-1"
                              style={{ color: 'var(--portal-kiln-oak, #8B6F47)' }}
                            >
                              {new Date(n.timestamp).toLocaleString()}
                            </p>
                          </div>
                        </a>
                      </li>
                    )
                  })}
                </ul>
              </section>
            )
          })}
        </div>
      </aside>
    </>
  )
}
