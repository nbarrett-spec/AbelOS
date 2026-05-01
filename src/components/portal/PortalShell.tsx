'use client'

/**
 * Builder Portal — client shell that composes Sidebar + Topbar + Notification
 * panel + main content area. Lives inside <PortalProvider> in layout.tsx.
 */

import { useState, type ReactNode } from 'react'
import { PortalSidebar } from './PortalSidebar'
import { PortalTopbar } from './PortalTopbar'
import { PortalNotificationPanel } from './PortalNotificationPanel'
import type { PortalNotification } from '@/types/portal'

interface PortalShellProps {
  title?: string
  subtitle?: string
  /** Initial notifications (from server). Phase 2 will wire live polling. */
  notifications?: PortalNotification[]
  topbarActions?: ReactNode
  children: ReactNode
}

export function PortalShell({
  title,
  subtitle,
  notifications: initialNotifications = [],
  topbarActions,
  children,
}: PortalShellProps) {
  const [notifications, setNotifications] = useState(initialNotifications)
  const [panelOpen, setPanelOpen] = useState(false)

  const unreadCount = notifications.filter((n) => !n.read).length

  function markAllRead() {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })))
  }

  return (
    <>
      <PortalSidebar />
      <div className="md:pl-[260px] min-h-screen flex flex-col">
        <PortalTopbar
          title={title}
          subtitle={subtitle}
          actions={topbarActions}
          onOpenNotifications={() => setPanelOpen(true)}
          unreadCount={unreadCount}
        />
        {/* main is transparent so the data-portal multi-layer background
            (warm canvas + radial washes + blueprint grid) shows through. */}
        <main className="flex-1 px-4 sm:px-6 md:px-8 py-6 md:py-8">
          {children}
        </main>
      </div>

      <PortalNotificationPanel
        open={panelOpen}
        onClose={() => setPanelOpen(false)}
        notifications={notifications}
        onMarkAllRead={markAllRead}
      />
    </>
  )
}
