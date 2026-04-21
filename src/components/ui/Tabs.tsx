'use client'

import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { cn } from '@/lib/utils'

// ── Aegis v2 "Drafting Room" Tabs ────────────────────────────────────────
// Underline style: 2px gold bottom on active. Gold underline slides 180ms.
// Inter 13px weight 500. Horizontal scroll with fade edges on mobile.
// ─────────────────────────────────────────────────────────────────────────

export interface Tab {
  id: string
  label: string
  icon?: ReactNode
  badge?: string | number
  disabled?: boolean
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

export function Tabs({
  tabs,
  activeTab,
  onChange,
  variant = 'underline',
  size = 'md',
  fullWidth = false,
  className,
}: TabsProps) {
  const listRef = useRef<HTMLDivElement>(null)
  const btnRefs = useRef<Record<string, HTMLButtonElement | null>>({})
  const [underline, setUnderline] = useState<{ left: number; width: number } | null>(null)

  useEffect(() => {
    if (variant !== 'underline') return
    const btn = btnRefs.current[activeTab]
    const list = listRef.current
    if (!btn || !list) {
      setUnderline(null)
      return
    }
    const listRect = list.getBoundingClientRect()
    const btnRect = btn.getBoundingClientRect()
    setUnderline({
      left: btnRect.left - listRect.left + list.scrollLeft,
      width: btnRect.width,
    })
  }, [activeTab, tabs, variant])

  return (
    <div className={cn('relative', className)}>
      <div
        ref={listRef}
        role="tablist"
        className={cn(
          'flex relative overflow-x-auto scrollbar-thin',
          variant === 'underline' && 'border-b border-border',
          variant === 'pills' && 'bg-surface-muted rounded-lg p-1 gap-1',
          variant === 'enclosed' && 'bg-surface-muted rounded-lg p-1 gap-0.5',
          fullWidth && 'w-full',
        )}
        style={
          variant === 'underline'
            ? {
                maskImage:
                  'linear-gradient(to right, transparent, black 16px, black calc(100% - 16px), transparent)',
                WebkitMaskImage:
                  'linear-gradient(to right, transparent, black 16px, black calc(100% - 16px), transparent)',
              }
            : undefined
        }
      >
        {tabs.map((tab) => {
          const active = tab.id === activeTab
          return (
            <button
              key={tab.id}
              ref={(el) => { btnRefs.current[tab.id] = el }}
              role="tab"
              aria-selected={active}
              aria-controls={`panel-${tab.id}`}
              id={`tab-${tab.id}`}
              disabled={tab.disabled}
              onClick={() => !tab.disabled && onChange(tab.id)}
              className={cn(
                'relative inline-flex items-center justify-center gap-1.5 whitespace-nowrap',
                'font-medium transition-colors duration-[180ms]',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--signal)] focus-visible:ring-offset-2',
                tab.disabled && 'opacity-40 cursor-not-allowed',
                fullWidth && 'flex-1',
                size === 'sm' && 'px-3 py-1.5 text-[12px]',
                size === 'md' && 'px-4 py-2 text-[13px]',
                // Underline
                variant === 'underline' && [
                  '-mb-px',
                  active
                    ? 'text-fg'
                    : 'text-fg-muted hover:text-[var(--signal)]',
                ],
                // Pills
                variant === 'pills' && [
                  'rounded-md',
                  active
                    ? 'bg-surface text-fg shadow-sm'
                    : 'text-fg-muted hover:text-fg',
                ],
                // Enclosed
                variant === 'enclosed' && [
                  'rounded-md',
                  active
                    ? 'bg-surface text-fg shadow-sm'
                    : 'text-fg-muted hover:text-fg',
                ],
              )}
              style={{
                transitionTimingFunction: 'var(--ease)',
                letterSpacing: '-0.005em',
              }}
            >
              {tab.icon && <span className="shrink-0">{tab.icon}</span>}
              {tab.label}
              {tab.badge !== undefined && (
                <span
                  className={cn(
                    'ml-1 px-1.5 py-0.5 text-[10px] font-semibold rounded-full leading-none tabular-nums',
                    active
                      ? 'bg-[var(--signal-subtle)] text-[var(--signal)]'
                      : 'bg-surface-muted text-fg-muted',
                  )}
                >
                  {tab.badge}
                </span>
              )}
            </button>
          )
        })}

        {variant === 'underline' && underline && (
          <span
            aria-hidden
            className="absolute bottom-0 h-[2px] rounded-full pointer-events-none"
            style={{
              left: underline.left,
              width: underline.width,
              background: 'var(--grad, var(--signal))',
              transition:
                'left 180ms var(--ease), width 180ms var(--ease)',
            }}
          />
        )}
      </div>
    </div>
  )
}

export default Tabs
