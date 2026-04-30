'use client'

/**
 * Builder Portal — sticky glass topbar.
 *
 * §1 Layout Shell. Search button (opens command palette — to be wired in
 * Phase 2 when CommandMenu is extended), notification bell with unread count,
 * builder avatar/initials.
 */

import { useState, type ReactNode } from 'react'
import { Bell, Search } from 'lucide-react'
import { usePortal } from './PortalContext'

interface PortalTopbarProps {
  /** Optional dynamic page heading — falls back to "Portal". */
  title?: string
  /** Optional descriptor under the heading. */
  subtitle?: string
  /** Optional right-side action slot. */
  actions?: ReactNode
  /** Click hook for the bell — opens NotificationPanel. */
  onOpenNotifications?: () => void
  /** Unread notification count for the badge. */
  unreadCount?: number
}

export function PortalTopbar({
  title = 'Portal',
  subtitle,
  actions,
  onOpenNotifications,
  unreadCount = 0,
}: PortalTopbarProps) {
  const { builder, contact } = usePortal()
  const [searchOpen, setSearchOpen] = useState(false)

  const initials =
    contact && contact.firstName
      ? `${contact.firstName[0] ?? ''}${contact.lastName[0] ?? ''}`.toUpperCase()
      : builder.companyName.slice(0, 2).toUpperCase()

  return (
    <header
      className="sticky top-0 z-20 print:hidden"
      style={{
        height: 64,
        background: 'rgba(253,250,244,0.85)',
        backdropFilter: 'blur(16px) saturate(180%)',
        WebkitBackdropFilter: 'blur(16px) saturate(180%)',
        borderBottom: '1px solid var(--portal-border-light, #F0E8DA)',
      }}
    >
      <div className="h-full flex items-center justify-between px-6 md:px-8">
        {/* Left — title block */}
        <div className="flex flex-col justify-center min-w-0">
          <h1
            className="text-lg md:text-xl font-medium truncate"
            style={{
              fontFamily: 'var(--font-portal-display, Georgia)',
              color: 'var(--portal-text-strong, #3E2A1E)',
              letterSpacing: '-0.01em',
              lineHeight: 1.15,
            }}
          >
            {title}
          </h1>
          {subtitle && (
            <p
              className="text-xs md:text-sm truncate"
              style={{ color: 'var(--portal-text-muted, #6B6056)' }}
            >
              {subtitle}
            </p>
          )}
        </div>

        {/* Right — actions, search, bell, avatar */}
        <div className="flex items-center gap-2 md:gap-3">
          {actions}

          <button
            type="button"
            onClick={() => setSearchOpen((s) => !s)}
            className="hidden sm:flex items-center gap-2 px-3 h-9 rounded-md text-xs transition-colors"
            style={{
              border: '1px solid var(--portal-border, #E8DFD0)',
              background: 'var(--portal-bg-card, #FFFFFF)',
              color: 'var(--portal-text-muted, #6B6056)',
              minWidth: 200,
            }}
            aria-label="Open command palette"
          >
            <Search className="w-3.5 h-3.5" />
            <span>Search…</span>
            <span
              className="ml-auto rounded px-1.5 py-0.5 text-[10px] font-mono"
              style={{
                background: 'var(--portal-bg-elevated, #FAF5E8)',
                color: 'var(--portal-text-muted, #6B6056)',
              }}
            >
              ⌘K
            </span>
          </button>

          {/* Mobile search icon */}
          <button
            type="button"
            onClick={() => setSearchOpen((s) => !s)}
            className="sm:hidden flex items-center justify-center w-9 h-9 rounded-md transition-colors"
            style={{
              border: '1px solid var(--portal-border, #E8DFD0)',
              background: 'var(--portal-bg-card, #FFFFFF)',
              color: 'var(--portal-text-muted, #6B6056)',
            }}
            aria-label="Search"
          >
            <Search className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={onOpenNotifications}
            className="relative flex items-center justify-center w-9 h-9 rounded-md transition-colors"
            style={{
              border: '1px solid var(--portal-border, #E8DFD0)',
              background: 'var(--portal-bg-card, #FFFFFF)',
              color: 'var(--portal-text-strong, #3E2A1E)',
            }}
            aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ''}`}
          >
            <Bell className="w-4 h-4" />
            {unreadCount > 0 && (
              <span
                className="absolute -top-1 -right-1 min-w-[18px] h-[18px] flex items-center justify-center rounded-full text-[10px] font-semibold px-1"
                style={{
                  background: 'var(--portal-amber, #C9822B)',
                  color: 'white',
                }}
              >
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
          </button>

          <div
            className="flex items-center justify-center w-9 h-9 rounded-full text-xs font-semibold"
            style={{
              background: 'linear-gradient(135deg, #C9822B, #D4A54A)',
              color: 'var(--portal-walnut, #3E2A1E)',
            }}
            aria-label={`Signed in as ${builder.companyName}`}
            title={builder.email}
          >
            {initials || 'AB'}
          </div>
        </div>
      </div>

      {/* Inline search dropdown placeholder — Phase 2 wires CommandMenu */}
      {searchOpen && (
        <div
          className="absolute top-full left-0 right-0 mx-auto max-w-2xl p-3 rounded-b-lg shadow-md text-sm"
          style={{
            background: 'var(--portal-bg-card, #FFFFFF)',
            border: '1px solid var(--portal-border, #E8DFD0)',
            color: 'var(--portal-text-muted, #6B6056)',
          }}
        >
          <p className="text-center py-2">
            Command palette wires in Phase 2 — extends the existing CommandMenu.
          </p>
        </div>
      )}
    </header>
  )
}
