'use client'

/**
 * Builder Portal — left sidebar (260px, walnut, fixed).
 *
 * §1 Layout Shell. Active indicator slides on a 3px amber bar using Framer's
 * layoutId. Collapses to icon rail at lg breakpoint and below; on phones the
 * portal layout swaps this for a bottom sheet (handled in layout.tsx).
 */

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard,
  Package,
  Search,
  FileText,
  Calendar,
  BarChart3,
  MessageSquare,
  FolderOpen,
  MapPin,
  Shield,
  Settings,
  ChevronsLeftRight,
  type LucideIcon,
} from 'lucide-react'
import { motion } from 'motion/react'
import { usePortal } from './PortalContext'

interface NavItem {
  label: string
  href: string
  icon: LucideIcon
  /** True if this item is exec-only. */
  execOnly?: boolean
  /** Unread / count badge if any. */
  badge?: number | null
}

const NAV: NavItem[] = [
  { label: 'Dashboard', href: '/portal', icon: LayoutDashboard },
  { label: 'Orders', href: '/portal/orders', icon: Package },
  { label: 'Catalog', href: '/portal/catalog', icon: Search },
  { label: 'Quotes', href: '/portal/quotes', icon: FileText },
  { label: 'Schedule', href: '/portal/schedule', icon: Calendar },
  { label: 'Analytics', href: '/portal/analytics', icon: BarChart3, execOnly: true },
  { label: 'Messages', href: '/portal/messages', icon: MessageSquare },
  { label: 'Documents', href: '/portal/documents', icon: FolderOpen },
  { label: 'Projects', href: '/portal/projects', icon: MapPin },
  { label: 'Warranty', href: '/portal/warranty', icon: Shield },
]

export function PortalSidebar() {
  const pathname = usePathname()
  const { canSeeExec, viewMode, setViewMode, builder, contact } = usePortal()

  const items = NAV.filter((it) => !it.execOnly || canSeeExec)

  return (
    <aside
      className="hidden md:flex md:flex-col md:fixed md:inset-y-0 md:left-0 md:z-30 print:hidden"
      style={{
        width: 260,
        background: 'var(--portal-walnut, #3E2A1E)',
        color: 'var(--portal-cream, #F3EAD8)',
        borderRight: '1px solid rgba(0,0,0,0.2)',
      }}
    >
      {/* Header — builder identity */}
      <div className="px-5 pt-6 pb-5" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <div className="flex items-center gap-3">
          <div
            className="rounded-lg flex items-center justify-center font-semibold"
            style={{
              width: 38,
              height: 38,
              background: 'linear-gradient(135deg, #C9822B, #D4A54A)',
              color: 'var(--portal-walnut)',
              fontFamily: 'var(--font-portal-display, Georgia)',
              fontSize: '1rem',
            }}
            aria-hidden="true"
          >
            {builder.companyName.charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <div
              className="truncate text-sm font-medium"
              style={{
                fontFamily: 'var(--font-portal-display, Georgia)',
                color: 'var(--portal-cream, #F3EAD8)',
                letterSpacing: '-0.01em',
              }}
            >
              {builder.companyName}
            </div>
            <div className="text-[11px]" style={{ color: 'rgba(243,234,216,0.55)' }}>
              Builder Portal
            </div>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-0.5" aria-label="Portal navigation">
        {items.map((item) => {
          const active =
            item.href === '/portal'
              ? pathname === '/portal'
              : pathname?.startsWith(item.href)
          const Icon = item.icon
          return (
            <Link
              key={item.href}
              href={item.href}
              className="relative flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors"
              style={{
                background: active ? 'rgba(255,255,255,0.06)' : 'transparent',
                color: active
                  ? 'var(--portal-cream, #F3EAD8)'
                  : 'rgba(243,234,216,0.78)',
                fontWeight: active ? 500 : 400,
              }}
            >
              {active && (
                <motion.span
                  layoutId="portal-sidebar-active"
                  className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-r"
                  style={{
                    background: 'linear-gradient(180deg, #C9822B, #D4A54A)',
                  }}
                  transition={{ type: 'spring', stiffness: 400, damping: 36 }}
                />
              )}
              <Icon className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span className="truncate">{item.label}</span>
              {item.badge != null && item.badge > 0 && (
                <span
                  className="ml-auto text-[10px] font-medium rounded-full px-2 py-0.5"
                  style={{
                    background: 'rgba(201,130,43,0.25)',
                    color: 'var(--portal-amber-light, #D4A54A)',
                  }}
                >
                  {item.badge > 99 ? '99+' : item.badge}
                </span>
              )}
            </Link>
          )
        })}
      </nav>

      {/* Footer — role switcher + settings + identity */}
      <div className="px-3 py-4" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
        {canSeeExec && (
          <button
            type="button"
            onClick={() => setViewMode(viewMode === 'pm' ? 'exec' : 'pm')}
            className="w-full flex items-center gap-2 px-3 py-2 mb-2 rounded-md text-xs transition-colors"
            style={{
              background: 'rgba(255,255,255,0.04)',
              color: 'rgba(243,234,216,0.85)',
            }}
            aria-label={`Switch to ${viewMode === 'pm' ? 'executive' : 'PM'} view`}
          >
            <ChevronsLeftRight className="w-3.5 h-3.5" />
            <span>View as: {viewMode === 'pm' ? 'PM' : 'Executive'}</span>
          </button>
        )}

        <Link
          href="/portal/settings"
          className="flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors"
          style={{
            color: 'rgba(243,234,216,0.7)',
          }}
        >
          <Settings className="w-4 h-4" aria-hidden="true" />
          <span>Settings</span>
        </Link>
        {contact && (
          <div
            className="px-3 pt-3 mt-2 text-[11px]"
            style={{
              borderTop: '1px solid rgba(255,255,255,0.05)',
              color: 'rgba(243,234,216,0.5)',
            }}
          >
            Signed in as <strong style={{ color: 'rgba(243,234,216,0.8)' }}>{contact.firstName} {contact.lastName}</strong>
          </div>
        )}
      </div>
    </aside>
  )
}
