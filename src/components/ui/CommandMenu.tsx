'use client'

import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import {
  Search, ArrowRight, Package, Users, FileText, ShoppingCart, Truck, Settings,
  Building2, DollarSign, BarChart3, Factory, Ruler, Command, Activity
} from 'lucide-react'
import { cn } from '@/lib/utils'

// ── Types ─────────────────────────────────────────────────────────────────

export interface CommandItem {
  id: string
  label: string
  description?: string
  icon?: React.ComponentType<{ className?: string }>
  href?: string
  group: string
  /** Matched search terms in addition to label */
  keywords?: string[]
  /** Run instead of navigating */
  action?: () => void
  /** Shortcut hint (shown right-aligned) */
  shortcut?: string
}

// Built-in navigation — the workhorse routes
const STATIC_COMMANDS: CommandItem[] = [
  { id: 'nav:executive',  group: 'Navigate', label: 'CEO Dashboard',        href: '/ops/executive',   icon: BarChart3,   keywords: ['exec', 'ceo', 'dash'] },
  { id: 'nav:ops',        group: 'Navigate', label: 'Ops Dashboard',        href: '/ops',             icon: BarChart3,   keywords: ['home'] },
  { id: 'nav:orders',     group: 'Navigate', label: 'Orders',               href: '/ops/orders',      icon: FileText,    keywords: ['so'] },
  { id: 'nav:quotes',     group: 'Navigate', label: 'Quotes',               href: '/ops/quotes',      icon: DollarSign },
  { id: 'nav:accounts',   group: 'Navigate', label: 'Builder Accounts',     href: '/ops/accounts',    icon: Building2,   keywords: ['builders', 'customers'] },
  { id: 'nav:products',   group: 'Navigate', label: 'Product Catalog',      href: '/ops/products',    icon: Package },
  { id: 'nav:purchasing', group: 'Navigate', label: 'Purchase Orders',      href: '/ops/purchasing',  icon: ShoppingCart, keywords: ['po'] },
  { id: 'nav:mrp',        group: 'Navigate', label: 'MRP — Forward Demand', href: '/ops/mrp',         icon: Factory },
  { id: 'nav:inventory',  group: 'Navigate', label: 'Inventory',            href: '/ops/inventory',   icon: Package },
  { id: 'nav:delivery',   group: 'Navigate', label: 'Delivery Center',      href: '/ops/delivery',    icon: Truck },
  { id: 'nav:ar',         group: 'Navigate', label: 'Accounts Receivable',  href: '/ops/finance/ar',  icon: DollarSign,   keywords: ['collections'] },
  { id: 'nav:vendors',    group: 'Navigate', label: 'Vendors',              href: '/ops/vendors',     icon: Building2 },
  { id: 'nav:reports',    group: 'Navigate', label: 'Reports',              href: '/ops/reports',     icon: BarChart3 },
  { id: 'nav:takeoff',    group: 'Navigate', label: 'Takeoff Inquiries',    href: '/ops/takeoff-inquiries', icon: Ruler },
  { id: 'nav:staff',      group: 'Navigate', label: 'Staff',                href: '/ops/staff',       icon: Users },
  { id: 'nav:settings',   group: 'Navigate', label: 'Settings',             href: '/ops/settings',    icon: Settings },
  {
    id: 'action:activity',
    group: 'System',
    label: 'Recent activity (live events)',
    icon: Activity,
    keywords: ['activity', 'stream', 'events', 'live', 'drawer'],
    shortcut: 'A',
    action: () => {
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('abel:open-activity'))
      }
    },
  },
]

// ── Hook: open state + global keyboard trigger ────────────────────────────

export function useCommandMenu() {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen((o) => !o)
      }
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  return { open, setOpen }
}

// ── Component ─────────────────────────────────────────────────────────────

export interface CommandMenuProps {
  open: boolean
  onClose: () => void
  /** Additional commands (e.g. recent builders, live POs) */
  extra?: CommandItem[]
}

export default function CommandMenu({ open, onClose, extra = [] }: CommandMenuProps) {
  const router = useRouter()
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  const allCommands = useMemo(() => [...STATIC_COMMANDS, ...extra], [extra])

  const filtered = useMemo(() => {
    if (!query.trim()) return allCommands
    const q = query.toLowerCase()
    return allCommands.filter((c) =>
      c.label.toLowerCase().includes(q) ||
      c.description?.toLowerCase().includes(q) ||
      c.keywords?.some((k) => k.toLowerCase().includes(q))
    )
  }, [query, allCommands])

  const grouped = useMemo(() => {
    const groups: Record<string, CommandItem[]> = {}
    filtered.forEach((c) => {
      if (!groups[c.group]) groups[c.group] = []
      groups[c.group].push(c)
    })
    return groups
  }, [filtered])

  // Reset state when opened
  useEffect(() => {
    if (open) {
      setQuery('')
      setActiveIndex(0)
      setTimeout(() => inputRef.current?.focus(), 10)
    }
  }, [open])

  const runItem = useCallback((item: CommandItem) => {
    onClose()
    if (item.action) item.action()
    else if (item.href) router.push(item.href)
  }, [onClose, router])

  // Keyboard navigation
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setActiveIndex((i) => Math.min(i + 1, filtered.length - 1))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setActiveIndex((i) => Math.max(i - 1, 0))
      } else if (e.key === 'Enter') {
        e.preventDefault()
        const item = filtered[activeIndex]
        if (item) runItem(item)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, filtered, activeIndex, runItem])

  if (!open) return null

  let index = 0
  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center pt-[15vh] px-4 animate-fade-in"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
    >
      <div className="absolute inset-0 bg-stone-950/60 backdrop-blur-sm" />
      <div
        className="relative w-full max-w-xl panel panel-elevated overflow-hidden animate-slide-up"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-3 h-12 border-b border-border">
          <Search className="w-4 h-4 text-fg-subtle shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => { setQuery(e.target.value); setActiveIndex(0) }}
            placeholder="Jump to page, builder, order, PO…"
            className="flex-1 bg-transparent outline-none text-sm text-fg placeholder:text-fg-subtle"
          />
          <span className="kbd">esc</span>
        </div>

        <div className="max-h-[60vh] overflow-y-auto scrollbar-thin py-1">
          {filtered.length === 0 ? (
            <div className="px-4 py-10 text-center text-sm text-fg-muted">
              No results for &ldquo;{query}&rdquo;
            </div>
          ) : (
            Object.entries(grouped).map(([group, items]) => (
              <div key={group} className="py-1">
                <div className="px-3 pt-2 pb-1 eyebrow">{group}</div>
                {items.map((item) => {
                  const myIndex = index++
                  const Icon = item.icon ?? ArrowRight
                  return (
                    <button
                      key={item.id}
                      onMouseEnter={() => setActiveIndex(myIndex)}
                      onClick={() => runItem(item)}
                      className={cn(
                        'w-full flex items-center gap-2.5 px-3 py-2 text-left text-sm text-fg',
                        'transition-colors duration-fast',
                        activeIndex === myIndex ? 'bg-accent-subtle text-accent-fg' : 'hover:bg-surface-muted'
                      )}
                    >
                      <Icon className={cn('w-4 h-4 shrink-0', activeIndex === myIndex ? 'text-accent' : 'text-fg-muted')} />
                      <span className="flex-1 truncate">
                        {item.label}
                        {item.description && (
                          <span className="text-fg-muted text-xs ml-2">{item.description}</span>
                        )}
                      </span>
                      {item.shortcut && <span className="kbd">{item.shortcut}</span>}
                    </button>
                  )
                })}
              </div>
            ))
          )}
        </div>

        <div className="flex items-center justify-between gap-3 px-3 py-2 border-t border-border bg-surface-muted text-[11px] text-fg-subtle">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1"><span className="kbd">↑↓</span> navigate</span>
            <span className="flex items-center gap-1"><span className="kbd">↵</span> open</span>
          </div>
          <span className="flex items-center gap-1">
            <Command className="w-3 h-3" /> Aegis
          </span>
        </div>
      </div>
    </div>
  )
}
