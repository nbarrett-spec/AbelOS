'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import Navbar from '@/components/Navbar'

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
  ]

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      <div className="flex">
        {/* Sidebar */}
        <aside
          className={`${
            sidebarOpen ? 'w-64' : 'w-20'
          } bg-abel-navy text-white transition-all duration-300 min-h-screen`}
        >
          <div className="p-4 space-y-6">
            {/* Toggle Button */}
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="w-full text-left hover:bg-white/10 p-2 rounded transition"
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
                        ? 'bg-abel-orange text-white'
                        : 'text-white/70 hover:text-white hover:bg-white/10'
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
          <div className="p-8">
            {children}
          </div>
        </main>
      </div>
    </div>
  )
}
