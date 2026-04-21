'use client'

import React from 'react'
import PortalBackground from '@/components/PortalBackground'

export default function HomeownerLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-50 to-white relative">
      <PortalBackground portal="homeowner" />
      {/* Homeowner Header */}
      <header className="bg-[#0f2a3e] text-white">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold tracking-tight">ABEL LUMBER</h1>
            <p className="text-[#C6A24E] text-xs font-medium">Door & Hardware Selection Portal</p>
          </div>
          <a href="tel:18002235667" className="text-sm text-white/80 hover:text-white hidden sm:block">
            Need help? Call 1-800-ABEL-DOORS
          </a>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-5xl mx-auto px-4 py-6 sm:py-8">
        {children}
      </main>

      {/* Footer */}
      <footer className="border-t border-gray-200 mt-auto">
        <div className="max-w-5xl mx-auto px-4 py-6 flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="text-center sm:text-left">
            <p className="text-sm text-gray-500">Contact Abel Lumber</p>
            <p className="text-xs text-gray-400">
              <a href="tel:18002235667" className="hover:text-[#0f2a3e]">1-800-ABEL-DOORS</a>
              {' · '}
              <a href="mailto:homeowners@abellumber.com" className="hover:text-[#0f2a3e]">homeowners@abellumber.com</a>
            </p>
          </div>
          <p className="text-xs text-gray-400">&copy; {new Date().getFullYear()} Abel Lumber. All rights reserved.</p>
        </div>
      </footer>
    </div>
  )
}
