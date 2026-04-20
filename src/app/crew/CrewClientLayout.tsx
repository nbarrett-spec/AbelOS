'use client';

import React, { useState, useEffect } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

export default function CrewClientLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const isActive = (path: string) => pathname === path || pathname.startsWith(path + '/');

  return (
    <div className="flex flex-col h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-[#3E2A1E] text-white px-4 py-4 shadow-md">
        <div className="max-w-md mx-auto">
          <Image
            src="/images/logos/abel-logo.png"
            alt="Abel Lumber"
            width={100}
            height={32}
            className="h-8 w-auto mb-2"
          />
          <p className="text-sm text-blue-100">Field Crew Portal</p>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto pb-24 max-w-md mx-auto w-full">
        {children}
      </main>

      {/* Bottom Navigation */}
      <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 shadow-lg max-w-md mx-auto w-full">
        <div className="flex justify-around items-center h-20 px-2">
          {/* Today */}
          <Link
            href="/crew"
            className={`flex flex-col items-center justify-center w-20 h-20 rounded-lg transition-colors ${
              isActive('/crew') && pathname !== '/crew/route' && pathname !== '/crew/profile'
                ? 'text-[#C9822B] bg-orange-50'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            <svg className="w-6 h-6 mb-1" fill="currentColor" viewBox="0 0 24 24">
              <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V5h14v14zm-5-7h-4v4h4v-4z" />
            </svg>
            <span className="text-xs font-medium">Today</span>
          </Link>

          {/* Route */}
          <Link
            href="/crew/route"
            className={`flex flex-col items-center justify-center w-20 h-20 rounded-lg transition-colors ${
              isActive('/crew/route')
                ? 'text-[#C9822B] bg-orange-50'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            <svg className="w-6 h-6 mb-1" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm3.5-9c.83 0 1.5-.67 1.5-1.5S16.33 8 15.5 8 14 8.67 14 9.5s.67 1.5 1.5 1.5z" />
            </svg>
            <span className="text-xs font-medium">Route</span>
          </Link>

          {/* Profile */}
          <Link
            href="/crew/profile"
            className={`flex flex-col items-center justify-center w-20 h-20 rounded-lg transition-colors ${
              isActive('/crew/profile')
                ? 'text-[#C9822B] bg-orange-50'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            <svg className="w-6 h-6 mb-1" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" />
            </svg>
            <span className="text-xs font-medium">Profile</span>
          </Link>
        </div>
      </nav>
    </div>
  );
}
