'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState } from 'react'

interface SalesTopNavProps {
  staffId: string
  firstName: string
  lastName: string
  email: string
  role: string
}

export default function SalesTopNav({
  staffId,
  firstName,
  lastName,
  email,
  role,
}: SalesTopNavProps) {
  const pathname = usePathname()
  const [showUserMenu, setShowUserMenu] = useState(false)

  const navLinks = [
    { href: '/sales', label: 'Dashboard', icon: '📊' },
    { href: '/sales/pipeline', label: 'Pipeline', icon: '📈' },
    { href: '/sales/deals', label: 'My Deals', icon: '💼' },
    { href: '/sales/contracts', label: 'Contracts', icon: '📋' },
    { href: '/sales/documents', label: 'Documents', icon: '📁' },
  ]

  const isActive = (href: string) => {
    if (href === '/sales') {
      return pathname === '/sales'
    }
    return pathname.startsWith(href)
  }

  const initials = `${firstName[0]}${lastName[0]}`.toUpperCase()

  async function handleLogout() {
    await fetch('/api/ops/auth/logout', { method: 'POST' })
    window.location.href = '/sales/login'
  }

  return (
    <nav className="bg-[#1e3a5f] text-white shadow-lg">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Left: Logo/Branding */}
          <div className="flex items-center gap-8">
            <Link href="/sales" className="flex items-center gap-2 flex-shrink-0">
              <div className="w-8 h-8 rounded bg-[#C6A24E] flex items-center justify-center font-bold text-white">
                A
              </div>
              <span className="text-lg font-bold hidden sm:inline">Abel Sales</span>
            </Link>

            {/* Center: Navigation Links */}
            <div className="hidden md:flex items-center gap-1">
              {navLinks.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`px-3 py-2 rounded-md text-sm font-medium transition-colors flex items-center gap-2 ${
                    isActive(link.href)
                      ? 'bg-white/20 text-white'
                      : 'text-white/70 hover:text-white hover:bg-white/10'
                  }`}
                >
                  <span className="text-base">{link.icon}</span>
                  <span>{link.label}</span>
                </Link>
              ))}
            </div>
          </div>

          {/* Right: User Info and Logout */}
          <div className="flex items-center gap-4">
            <div className="hidden sm:flex items-center gap-2 px-3 py-2 rounded-md bg-white/10">
              <span className="text-xs text-white/70">
                {new Date().toLocaleDateString('en-US', {
                  month: 'short',
                  day: 'numeric',
                })}
              </span>
            </div>

            <div className="relative">
              <button
                onClick={() => setShowUserMenu(!showUserMenu)}
                className="w-8 h-8 rounded-full bg-[#C6A24E] text-white text-xs flex items-center justify-center font-bold hover:bg-[#A8882A] transition-colors"
                title={`${firstName} ${lastName}`}
              >
                {initials}
              </button>

              {showUserMenu && (
                <div className="absolute right-0 top-10 w-56 bg-white rounded-lg shadow-xl border border-gray-200 py-2 z-50 text-gray-900">
                  <div className="px-4 py-3 border-b border-gray-200">
                    <p className="text-sm font-semibold text-gray-900">
                      {firstName} {lastName}
                    </p>
                    <p className="text-xs text-gray-500 mt-0.5">{email}</p>
                    <p className="text-xs text-gray-400 mt-1">
                      {role === 'SALES_REP' ? 'Sales Representative' : role}
                    </p>
                  </div>
                  <button
                    onClick={handleLogout}
                    className="w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50 transition-colors"
                  >
                    Sign Out
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Mobile navigation */}
        <div className="md:hidden pb-3 flex gap-1 overflow-x-auto">
          {navLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={`px-3 py-2 rounded-md text-xs font-medium whitespace-nowrap transition-colors ${
                isActive(link.href)
                  ? 'bg-white/20 text-white'
                  : 'text-white/70 hover:text-white hover:bg-white/10'
              }`}
            >
              {link.label}
            </Link>
          ))}
        </div>
      </div>
    </nav>
  )
}
