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
      className="portal-topbar sticky top-0 z-20 print:hidden"
      style={{
        // Mockup-3 .topbar — 68px, semi-transparent white glass over the
        // multi-layer canvas. Sits above the data-portal background paint.
        height: 68,
        background: 'rgba(255, 255, 255, 0.6)',
        backdropFilter: 'blur(20px) saturate(1.4)',
        WebkitBackdropFilter: 'blur(20px) saturate(1.4)',
        borderBottom: '1px solid var(--glass-border, rgba(79,70,229,0.12))',
      }}
    >
      <div className="h-full flex items-center justify-between px-6 md:px-8 gap-4">
        {/* Left — page title (Instrument Serif) */}
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex flex-col justify-center min-w-0">
            <h1
              className="text-lg md:text-xl truncate"
              style={{
                fontFamily: 'var(--font-portal-display)',
                color: 'var(--portal-text-strong)',
                letterSpacing: '-0.01em',
                lineHeight: 1.15,
                fontWeight: 400,
              }}
            >
              {title}
            </h1>
            {subtitle && (
              <p
                className="text-[11px] truncate uppercase"
                style={{
                  fontFamily: 'var(--font-portal-mono)',
                  color: 'var(--portal-text-subtle)',
                  letterSpacing: '0.08em',
                  marginTop: 1,
                }}
              >
                {subtitle}
              </p>
            )}
          </div>
        </div>

        {/* Right — actions, search, bell, avatar */}
        <div className="flex items-center gap-2 md:gap-3">
          {actions}

          <button
            type="button"
            onClick={() => setSearchOpen((s) => !s)}
            className="hidden sm:flex items-center gap-2 px-3 h-9 rounded-full text-xs transition-colors"
            style={{
              border: '1px solid var(--glass-border)',
              background: 'rgba(79, 70, 229, 0.05)',
              color: 'var(--portal-text-muted)',
              minWidth: 200,
              fontFamily: 'var(--font-portal-body)',
            }}
            aria-label="Open command palette"
          >
            <Search className="w-3.5 h-3.5" />
            <span>Search…</span>
            <span
              className="ml-auto rounded px-1.5 py-0.5 text-[10px]"
              style={{
                background: 'rgba(79, 70, 229, 0.08)',
                color: 'var(--portal-text-muted)',
                fontFamily: 'var(--font-portal-mono)',
                letterSpacing: '0.05em',
              }}
            >
              ⌘K
            </span>
          </button>

          {/* Mobile search icon */}
          <button
            type="button"
            onClick={() => setSearchOpen((s) => !s)}
            className="sm:hidden flex items-center justify-center w-9 h-9 rounded-full transition-colors"
            style={{
              border: '1px solid var(--glass-border)',
              background: 'rgba(79, 70, 229, 0.05)',
              color: 'var(--portal-text-muted)',
            }}
            aria-label="Search"
          >
            <Search className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={onOpenNotifications}
            className="relative flex items-center justify-center w-9 h-9 rounded-full transition-colors"
            style={{
              border: '1px solid var(--glass-border)',
              background: 'rgba(79, 70, 229, 0.05)',
              color: 'var(--portal-text-strong)',
            }}
            aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ''}`}
          >
            <Bell className="w-4 h-4" />
            {unreadCount > 0 && (
              <span
                className="absolute -top-1 -right-1 min-w-[18px] h-[18px] flex items-center justify-center rounded-full text-[10px] font-semibold px-1"
                style={{
                  background: 'var(--c1)',
                  color: 'white',
                  fontFamily: 'var(--font-portal-mono)',
                }}
              >
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
          </button>

          {/* User-menu pill — Mockup-3 .user-menu */}
          <div
            className="hidden sm:flex items-center gap-2 pr-3 pl-1.5 h-9 rounded-full"
            style={{
              background: 'rgba(79, 70, 229, 0.05)',
              border: '1px solid var(--glass-border)',
              fontFamily: 'var(--font-portal-body)',
              fontSize: 13,
              fontWeight: 500,
              color: 'var(--portal-text-strong)',
            }}
            aria-label={`Signed in as ${builder.companyName}`}
            title={builder.email}
          >
            <span
              className="w-7 h-7 rounded-full inline-flex items-center justify-center text-[11px] font-semibold"
              style={{
                background: 'linear-gradient(135deg, #8B5CF6, #06B6D4)',
                color: 'white',
              }}
            >
              {initials || 'AB'}
            </span>
            <span className="truncate max-w-[140px]">
              {builder.companyName}
            </span>
          </div>
          {/* Mobile-only avatar (no name pill) */}
          <div
            className="sm:hidden flex items-center justify-center w-9 h-9 rounded-full text-xs font-semibold"
            style={{
              background: 'linear-gradient(135deg, #8B5CF6, #06B6D4)',
              color: 'white',
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
            background: 'var(--glass)',
            backdropFilter: 'blur(24px) saturate(1.4)',
            WebkitBackdropFilter: 'blur(24px) saturate(1.4)',
            border: '1px solid var(--glass-border)',
            color: 'var(--portal-text-muted)',
            fontFamily: 'var(--font-portal-body)',
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
