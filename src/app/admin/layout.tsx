'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import Navbar from '@/components/Navbar'
import CriticalAlertBanner from '@/components/CriticalAlertBanner'
import AegisBackground from '@/components/AegisBackground'

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const pathname = usePathname()
  const [sidebarOpen, setSidebarOpen] = useState(true)

  const navItems = [
    { href: '/admin', label: 'Dashboard', icon: '📊' },
    { href: '/admin/builders', label: 'Builders', icon: '👷' },
    { href: '/admin/products', label: 'Products', icon: '📦' },
    { href: '/admin/quotes', label: 'Quotes', icon: '📄' },
    { href: '/admin/crons', label: 'Cron Jobs', icon: '⏱️' },
    { href: '/admin/hyphen', label: 'Hyphen', icon: '🔌' },
    { href: '/admin/webhooks', label: 'Webhooks', icon: '📬' },
    { href: '/admin/errors', label: 'Errors', icon: '🐛' },
    { href: '/admin/health', label: 'Health', icon: '💓' },
    { href: '/admin/timeline', label: 'Timeline', icon: '📈' },
    { href: '/admin/alert-history', label: 'Alert Log', icon: '🔔' },
    { href: '/admin/slo', label: 'SLOs', icon: '🎯' },
  ]

  return (
    <div className="min-h-screen bg-canvas relative">
      <AegisBackground variant="subtle" orbCount={2} />
      <div className="relative z-[1]">
        <Navbar />
        <CriticalAlertBanner />
        <div className="flex">
          {/* Sidebar */}
          <aside
            className={`${
              sidebarOpen ? 'w-64' : 'w-20'
            } transition-all duration-300 min-h-screen border-r border-glass-border`}
            style={{ background: 'var(--glass)', backdropFilter: 'var(--glass-blur)', WebkitBackdropFilter: 'var(--glass-blur)' }}
          >
            <div className="p-4 space-y-6">
              {/* Toggle Button */}
              <button
                onClick={() => setSidebarOpen(!sidebarOpen)}
                className="w-full text-left hover:bg-white/10 p-2 rounded transition text-fg-muted hover:text-fg"
              >
                {sidebarOpen ? '←' : '→'}
              </button>

              {/* Nav Items */}
              <nav className="space-y-2">
                {navItems.map((item) => {
                  const isActive = pathname === item.href
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={`flex items-center gap-3 px-4 py-3 rounded-lg transition ${
                        isActive
                          ? 'bg-signal/15 text-fg border-l-[3px] border-c1'
                          : 'text-fg-muted hover:text-fg hover:bg-white/5 border-l-[3px] border-transparent'
                      }`}
                    >
                      <span className="text-xl">{item.icon}</span>
                      {sidebarOpen && <span className="font-medium">{item.label}</span>}
                    </Link>
                  )
                })}
              </nav>
            </div>
          </aside>

          {/* Main Content */}
          <main className="flex-1">
            <div className="p-8 animate-enter">
              {children}
            </div>
          </main>
        </div>
      </div>
    </div>
  )
}
