'use client'

import { useState, type ReactNode } from 'react'
import { clsx } from 'clsx'

// ── Types ─────────────────────────────────────────────────────────────────

export interface Tab {
  id: string
  label: string
  icon?: ReactNode
  badge?: string | number
}

export interface TabsProps {
  tabs: Tab[]
  activeTab: string
  onChange: (tabId: string) => void
  variant?: 'underline' | 'pills' | 'enclosed'
  size?: 'sm' | 'md'
  fullWidth?: boolean
  className?: string
}

// ── Component ─────────────────────────────────────────────────────────────

export default function Tabs({
  tabs,
  activeTab,
  onChange,
  variant = 'underline',
  size = 'md',
  fullWidth = false,
  className,
}: TabsProps) {
  return (
    <div
      className={clsx(
        'flex',
        variant === 'underline' && 'border-b border-gray-200 dark:border-gray-800',
        variant === 'pills' && 'bg-gray-100 dark:bg-gray-800 rounded-xl p-1 gap-1',
        variant === 'enclosed' && 'bg-gray-100 dark:bg-gray-800 rounded-xl p-1 gap-0.5',
        fullWidth && 'w-full',
        className
      )}
      role="tablist"
    >
      {tabs.map((tab) => {
        const active = tab.id === activeTab

        return (
          <button
            key={tab.id}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(tab.id)}
            className={clsx(
              'relative inline-flex items-center justify-center gap-1.5 font-medium transition-all duration-150',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40',
              fullWidth && 'flex-1',
              // Size
              size === 'sm' && 'px-3 py-1.5 text-xs',
              size === 'md' && 'px-4 py-2 text-sm',
              // Underline variant
              variant === 'underline' && [
                '-mb-px',
                active
                  ? 'text-brand dark:text-brand-hover border-b-2 border-brand dark:border-brand-hover'
                  : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 border-b-2 border-transparent',
              ],
              // Pills variant
              variant === 'pills' && [
                'rounded-lg',
                active
                  ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
                  : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200',
              ],
              // Enclosed variant
              variant === 'enclosed' && [
                'rounded-lg',
                active
                  ? 'bg-white dark:bg-gray-900 text-gray-900 dark:text-white shadow-sm'
                  : 'text-gray-500 dark:text-gray-400 hover:text-gray-700',
              ]
            )}
          >
            {tab.icon && <span className="shrink-0">{tab.icon}</span>}
            {tab.label}
            {tab.badge !== undefined && (
              <span
                className={clsx(
                  'ml-1 px-1.5 py-0.5 text-[10px] font-semibold rounded-full leading-none',
                  active
                    ? 'bg-brand/10 text-brand dark:bg-brand/30 dark:text-brand-hover'
                    : 'bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300'
                )}
              >
                {tab.badge}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
