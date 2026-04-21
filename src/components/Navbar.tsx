'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/hooks/useAuth'
import { getInitials } from '@/lib/utils'
import { useTheme } from '@/contexts/ThemeContext'
import GlobalSearch from '@/components/GlobalSearch'

const NAV_LINKS = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/dashboard/intelligence', label: '⚡ Intelligence', highlight: true },
  { href: '/dashboard/analytics', label: 'Analytics' },
  { href: '/dashboard/blueprints', label: '📐 Blueprints', highlight: true },
  { href: '/dashboard/projects', label: 'Projects' },
  { href: '/projects/new', label: 'New Project' },
  { href: '/quick-order', label: 'Quick Order' },
  { href: '/catalog', label: 'Catalog' },
  { href: '/bulk-order', label: 'Bulk Import' },
  { href: '/dashboard/orders', label: 'Orders' },
  { href: '/dashboard/schedule', label: '📅 Schedule', highlight: true },
  { href: '/dashboard/savings', label: 'Savings' },
  { href: '/dashboard/payments', label: 'Payments' },
  { href: '/dashboard/deliveries', label: '🚚 Deliveries' },
  { href: '/dashboard/referrals', label: '🎁 Referrals' },
  { href: '/ops', label: 'Ops Center', highlight: true },
  { href: '/admin', label: 'Admin' },
]

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
  order_confirmed: '📦',
  order_shipped: '🚚',
  order_delivered: '✅',
  quote_ready: '📋',
  invoice_created: '💳',
  invoice_overdue: '⚠️',
  payment_received: '💰',
  delivery_scheduled: '📅',
  delivery_in_transit: '🚚',
  delivery_complete: '✅',
  delivery_rescheduled: '🔄',
  warranty_update: '🛡️',
}

export default function Navbar() {
  const { builder, logout } = useAuth()
  const { theme, toggleTheme } = useTheme()
  const router = useRouter()
  const [menuOpen, setMenuOpen] = useState(false)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<any[]>([])
  const [searchLoading, setSearchLoading] = useState(false)
  const searchRef = useRef<HTMLDivElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)

  // Notification state
  const [notifOpen, setNotifOpen] = useState(false)
  const [notifications, setNotifications] = useState<BuilderNotification[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const notifRef = useRef<HTMLDivElement>(null)

  // Close search and notif dropdowns on click outside
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setSearchOpen(false)
      }
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) {
        setNotifOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  // Fetch notifications + unread count (poll every 30s)
  const fetchNotifications = useCallback(async () => {
    if (!builder) return
    try {
      const res = await fetch('/api/notifications')
      if (res.ok) {
        const data = await res.json()
        setNotifications(data.notifications || [])
        setUnreadCount(data.unreadCount || 0)
      }
    } catch {}
  }, [builder])

  useEffect(() => {
    fetchNotifications()
    const interval = setInterval(fetchNotifications, 30000)
    return () => clearInterval(interval)
  }, [fetchNotifications])

  // Mark notification as read
  const markAsRead = async (id: string) => {
    try {
      await fetch('/api/notifications', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notificationIds: [id] }),
      })
      setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n))
      setUnreadCount(prev => Math.max(0, prev - 1))
    } catch {}
  }

  const markAllRead = async () => {
    try {
      await fetch('/api/notifications', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ markAllRead: true }),
      })
      setNotifications(prev => prev.map(n => ({ ...n, read: true })))
      setUnreadCount(0)
    } catch {}
  }

  const handleNotifClick = (n: BuilderNotification) => {
    if (!n.read) markAsRead(n.id)
    if (n.link) {
      setNotifOpen(false)
      router.push(n.link)
    }
  }

  const getTimeAgo = (ts: string) => {
    const sec = Math.floor((Date.now() - new Date(ts).getTime()) / 1000)
    if (sec < 60) return 'just now'
    if (sec < 3600) return `${Math.floor(sec / 60)}m ago`
    if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`
    if (sec < 604800) return `${Math.floor(sec / 86400)}d ago`
    return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  }

  // Keyboard shortcut: Ctrl+K or Cmd+K to open search
  useEffect(() => {
    function handleKeydown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setSearchOpen(true)
        setTimeout(() => searchInputRef.current?.focus(), 50)
      }
      if (e.key === 'Escape') setSearchOpen(false)
    }
    document.addEventListener('keydown', handleKeydown)
    return () => document.removeEventListener('keydown', handleKeydown)
  }, [])

  // Debounced search
  const doSearch = useCallback(async (q: string) => {
    if (q.length < 2) { setSearchResults([]); return }
    setSearchLoading(true)
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`)
      if (res.ok) {
        const data = await res.json()
        setSearchResults(data.results || [])
      }
    } catch {} finally { setSearchLoading(false) }
  }, [])

  useEffect(() => {
    const timer = setTimeout(() => doSearch(searchQuery), 250)
    return () => clearTimeout(timer)
  }, [searchQuery, doSearch])

  function handleResultClick(href: string) {
    setSearchOpen(false)
    setSearchQuery('')
    setSearchResults([])
    router.push(href)
  }

  function fmtCurrency(n: number) {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)
  }

  return (
    <nav className="bg-surface/80 dark:bg-[#0B1120]/90 text-fg shadow-lg" style={{ backdropFilter: 'blur(24px) saturate(1.4)', WebkitBackdropFilter: 'blur(24px) saturate(1.4)', borderBottom: '1px solid var(--glass-border)' }}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <Link href="/dashboard" className="flex items-center gap-3">
            <div className="w-8 h-8 bg-signal rounded-lg flex items-center justify-center font-bold text-sm">
              AB
            </div>
            <span className="font-semibold text-lg hidden sm:block">
              Abel Builder Platform
            </span>
          </Link>

          {/* Desktop Nav Links + Global Search */}
          <div className="hidden md:flex items-center gap-6">
            {/* Global Search */}
            {builder && <GlobalSearch />}

            {NAV_LINKS.map(link => (
              <Link
                key={link.href}
                href={link.href}
                className={link.highlight
                  ? 'text-c1 hover:text-fg transition font-medium'
                  : 'text-fg-muted hover:text-fg transition'}
              >
                {link.label}
              </Link>
            ))}
          </div>

          <div className="flex items-center gap-2">
            {/* Dark Mode Toggle */}
            <button
              onClick={toggleTheme}
              className="p-2 hover:bg-surface/10 rounded-lg transition"
              aria-label="Toggle dark mode"
              title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            >
              {theme === 'dark' ? (
                <svg className="w-5 h-5 text-yellow-300" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 2a1 1 0 011 1v1a1 1 0 11-2 0V3a1 1 0 011-1zm4 8a4 4 0 11-8 0 4 4 0 018 0zm-.464 4.95l.707.707a1 1 0 001.414-1.414l-.707-.707a1 1 0 00-1.414 1.414zm2.12-10.607a1 1 0 010 1.414l-.706.707a1 1 0 11-1.414-1.414l.707-.707a1 1 0 011.414 0zM17 11a1 1 0 100-2h-1a1 1 0 100 2h1zm-7 4a1 1 0 011 1v1a1 1 0 11-2 0v-1a1 1 0 011-1zM5.05 6.464A1 1 0 106.465 5.05l-.708-.707a1 1 0 00-1.414 1.414l.707.707zm1.414 8.486l-.707.707a1 1 0 01-1.414-1.414l.707-.707a1 1 0 011.414 1.414zM4 11a1 1 0 100-2H3a1 1 0 000 2h1z" clipRule="evenodd" />
                </svg>
              ) : (
                <svg className="w-5 h-5 text-fg-muted" fill="currentColor" viewBox="0 0 20 20">
                  <path d="M17.293 13.293A8 8 0 016.707 2.707a8.001 8.001 0 1010.586 10.586z" />
                </svg>
              )}
            </button>

            {/* Search Button */}
            {builder && (
              <div ref={searchRef} className="relative">
                <button
                  onClick={() => { setSearchOpen(!searchOpen); setTimeout(() => searchInputRef.current?.focus(), 50) }}
                  className="p-2 hover:bg-surface/10 rounded-lg transition flex items-center gap-2"
                  title="Search (Ctrl+K)"
                >
                  <svg className="w-5 h-5 text-fg-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                  <span className="hidden lg:block text-xs text-fg-subtle border border-border rounded px-1.5 py-0.5">Ctrl+K</span>
                </button>

                {searchOpen && (
                  <div className="absolute right-0 mt-2 w-96 max-w-[90vw] glass-card z-[60] overflow-hidden">
                    <div className="flex items-center px-4 py-3 border-b border-border">
                      <svg className="w-5 h-5 text-fg-subtle mr-3 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                      </svg>
                      <input
                        ref={searchInputRef}
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="Search orders, invoices, quotes, products..."
                        className="flex-1 text-sm text-fg placeholder:text-fg-subtle outline-none bg-transparent"
                        autoFocus
                      />
                      {searchQuery && (
                        <button onClick={() => { setSearchQuery(''); setSearchResults([]) }} className="text-fg-subtle hover:text-fg ml-2">
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                        </button>
                      )}
                    </div>
                    <div className="max-h-80 overflow-y-auto">
                      {searchLoading ? (
                        <div className="px-4 py-6 text-center text-sm text-fg-subtle">Searching...</div>
                      ) : searchResults.length > 0 ? (
                        searchResults.map((r, i) => (
                          <button
                            key={`${r.type}-${r.id}-${i}`}
                            onClick={() => handleResultClick(r.href)}
                            className="w-full text-left px-4 py-3 hover:bg-surface-muted flex items-center gap-3 border-b border-border/50 transition"
                          >
                            <span className="text-lg flex-shrink-0">{r.icon}</span>
                            <div className="flex-1 min-w-0">
                              <div className="text-sm font-medium text-fg truncate">{r.label}</div>
                              <div className="text-xs text-fg-muted">{r.subtitle}{r.total ? ` · ${fmtCurrency(Number(r.total))}` : ''}</div>
                            </div>
                            <svg className="w-4 h-4 text-fg-subtle flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                          </button>
                        ))
                      ) : searchQuery.length >= 2 ? (
                        <div className="px-4 py-6 text-center text-sm text-fg-subtle">No results for "{searchQuery}"</div>
                      ) : (
                        <div className="px-4 py-6 text-center text-sm text-fg-subtle">Type to search orders, invoices, quotes...</div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Notification Bell */}
            {builder && (
              <div ref={notifRef} className="relative">
                <button
                  onClick={() => { setNotifOpen(!notifOpen); if (!notifOpen) fetchNotifications() }}
                  className="p-2 hover:bg-surface/10 rounded-lg transition relative"
                  title="Notifications"
                >
                  <svg className="w-5 h-5 text-fg-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                  </svg>
                  {unreadCount > 0 && (
                    <span className="absolute -top-0.5 -right-0.5 bg-signal text-white text-[10px] font-bold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1">
                      {unreadCount > 99 ? '99+' : unreadCount}
                    </span>
                  )}
                </button>

                {notifOpen && (
                  <div className="absolute right-0 mt-2 w-96 max-w-[90vw] glass-card z-[60] overflow-hidden">
                    <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                      <h3 className="text-sm font-semibold text-fg">Notifications</h3>
                      {unreadCount > 0 && (
                        <button onClick={markAllRead} className="text-xs text-signal hover:underline font-medium">
                          Mark all read
                        </button>
                      )}
                    </div>
                    <div className="max-h-96 overflow-y-auto">
                      {notifications.length === 0 ? (
                        <div className="px-4 py-8 text-center text-sm text-fg-subtle">
                          <svg className="w-8 h-8 mx-auto mb-2 text-fg-subtle" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                          </svg>
                          No notifications yet
                        </div>
                      ) : (
                        notifications.map(n => (
                          <button
                            key={n.id}
                            onClick={() => handleNotifClick(n)}
                            className={`w-full text-left px-4 py-3 border-b border-border/50 transition hover:bg-surface-muted flex items-start gap-3 ${
                              n.read ? 'bg-surface' : 'bg-signal-subtle'
                            }`}
                          >
                            <span className="text-lg flex-shrink-0 mt-0.5">{NOTIF_ICONS[n.type] || '🔔'}</span>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-start justify-between gap-2">
                                <p className={`text-sm truncate ${n.read ? 'text-fg-muted' : 'text-fg font-semibold'}`}>
                                  {n.title}
                                </p>
                                {!n.read && (
                                  <span className="w-2 h-2 rounded-full bg-signal flex-shrink-0 mt-1.5" />
                                )}
                              </div>
                              <p className="text-xs text-fg-muted truncate mt-0.5">{n.message}</p>
                              <p className="text-[11px] text-fg-subtle mt-1">{getTimeAgo(n.createdAt)}</p>
                            </div>
                          </button>
                        ))
                      )}
                    </div>
                    {notifications.length > 0 && (
                      <div className="border-t border-border px-4 py-2 text-center">
                        <button
                          onClick={() => { setNotifOpen(false); router.push('/dashboard/notifications') }}
                          className="text-xs text-signal hover:underline font-medium"
                        >
                          View all notifications
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* User Menu */}
            {builder && (
              <div className="relative">
                <button
                  onClick={() => setMenuOpen(!menuOpen)}
                  className="flex items-center gap-2 hover:bg-surface/10 rounded-lg px-3 py-2 transition"
                >
                  <div className="w-8 h-8 bg-signal rounded-full flex items-center justify-center text-sm font-bold">
                    {getInitials(builder.contactName)}
                  </div>
                  <span className="hidden sm:block text-sm">
                    {builder.companyName}
                  </span>
                </button>

                {menuOpen && (
                  <div className="glass-card absolute right-0 mt-2 w-48 py-1 z-50">
                    <div className="px-4 py-2 border-b">
                      <p className="text-sm font-medium text-fg">
                        {builder.contactName}
                      </p>
                      <p className="text-xs text-fg-muted">{builder.email}</p>
                    </div>
                    <button
                      onClick={() => {
                        setMenuOpen(false)
                        logout()
                      }}
                      className="w-full text-left px-4 py-2 text-sm text-data-negative hover:bg-data-negative-bg"
                    >
                      Sign Out
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Mobile hamburger */}
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="md:hidden p-2 hover:bg-surface/10 rounded-lg transition"
              aria-label="Toggle menu"
            >
              {mobileMenuOpen ? (
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              ) : (
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Mobile Nav Menu */}
      {mobileMenuOpen && (
        <div className="md:hidden border-t border-border bg-surface">
          <div className="px-4 py-3 space-y-1">
            {NAV_LINKS.map(link => (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setMobileMenuOpen(false)}
                className={`block px-3 py-2.5 rounded-lg text-sm transition ${
                  link.highlight
                    ? 'text-c1 font-medium hover:bg-surface-muted'
                    : 'text-fg-muted hover:text-fg hover:bg-surface-muted'
                }`}
              >
                {link.label}
              </Link>
            ))}
          </div>
        </div>
      )}
    </nav>
  )
}
