'use client'

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useRouter } from 'next/navigation'
import {
  Activity,
  ArrowRight,
  BarChart3,
  Building2,
  Command,
  DollarSign,
  Factory,
  FileText,
  Hash,
  HelpCircle,
  Package,
  Plus,
  Ruler,
  Search,
  Settings,
  ShoppingCart,
  Slash,
  Terminal,
  Truck,
  Users,
  AtSign,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import Kbd from './Kbd'

// ── Aegis v2 "Drafting Room" CommandMenu ─────────────────────────────────
// Raycast-feel. Scopes: default / '/' create / '>' power / '@' people /
// '#' entity IDs / '?' help. Spring scale 180ms 0.96→1.0. Cycling placeholder.
// Grouped results with sticky mono headers. Mini force-graph preview on
// entity-ID hover. ⌘K/Ctrl+K global.
// ─────────────────────────────────────────────────────────────────────────

export interface CommandItem {
  id: string
  label: string
  description?: string
  icon?: React.ComponentType<{ className?: string }>
  href?: string
  group: string
  scope?: CommandScope
  keywords?: string[]
  action?: () => void
  shortcut?: string
  /** Entity type — when present, shows a mini force-graph preview on hover */
  entity?: {
    type: 'order' | 'product' | 'person' | 'builder' | 'vendor' | 'po'
    id: string
    /** Connected entity labels for the preview graph */
    connections?: string[]
  }
}

export type CommandScope = 'default' | 'create' | 'power' | 'people' | 'entity' | 'help'

const SCOPE_PREFIX: Record<CommandScope, string> = {
  default: '',
  create: '/',
  power: '>',
  people: '@',
  entity: '#',
  help: '?',
}

const SCOPE_LABEL: Record<CommandScope, string> = {
  default: 'Search',
  create: 'Create',
  power: 'Commands',
  people: 'People',
  entity: 'Entities',
  help: 'Help',
}

const SCOPE_ICON: Record<CommandScope, React.ComponentType<{ className?: string }>> = {
  default: Search,
  create: Plus,
  power: Terminal,
  people: AtSign,
  entity: Hash,
  help: HelpCircle,
}

const PLACEHOLDERS = [
  'Search orders, people, SKUs…',
  'Jump to a builder or PO…',
  'Try /new quote or @brittney…',
  '#ORD-2026-0142 for entity view…',
  'Press > for commands, ? for help…',
]

const STATIC_COMMANDS: CommandItem[] = [
  { id: 'nav:executive',  group: 'Navigate', label: 'CEO Dashboard',        href: '/ops/executive',  icon: BarChart3, keywords: ['exec', 'ceo'] },
  { id: 'nav:ops',        group: 'Navigate', label: 'Ops Dashboard',        href: '/ops',            icon: BarChart3 },
  { id: 'nav:orders',     group: 'Navigate', label: 'Orders',               href: '/ops/orders',     icon: FileText },
  { id: 'nav:quotes',     group: 'Navigate', label: 'Quotes',               href: '/ops/quotes',     icon: DollarSign },
  { id: 'nav:accounts',   group: 'Navigate', label: 'Builder Accounts',     href: '/ops/accounts',   icon: Building2 },
  { id: 'nav:products',   group: 'Navigate', label: 'Product Catalog',      href: '/ops/products',   icon: Package },
  { id: 'nav:purchasing', group: 'Navigate', label: 'Purchase Orders',      href: '/ops/purchasing', icon: ShoppingCart, keywords: ['po'] },
  { id: 'nav:mrp',        group: 'Navigate', label: 'MRP — Forward Demand', href: '/ops/mrp',        icon: Factory },
  { id: 'nav:inventory',  group: 'Navigate', label: 'Inventory',            href: '/ops/inventory',  icon: Package },
  { id: 'nav:delivery',   group: 'Navigate', label: 'Delivery Center',      href: '/ops/delivery',   icon: Truck },
  { id: 'nav:ar',         group: 'Navigate', label: 'Accounts Receivable',  href: '/ops/finance/ar', icon: DollarSign },
  { id: 'nav:vendors',    group: 'Navigate', label: 'Vendors',              href: '/ops/vendors',    icon: Building2 },
  { id: 'nav:reports',    group: 'Navigate', label: 'Reports',              href: '/ops/reports',    icon: BarChart3 },
  { id: 'nav:takeoff',    group: 'Navigate', label: 'Takeoff Inquiries',    href: '/ops/takeoff-inquiries', icon: Ruler },
  { id: 'nav:staff',      group: 'Navigate', label: 'Staff',                href: '/ops/staff',      icon: Users },
  { id: 'nav:settings',   group: 'Navigate', label: 'Settings',             href: '/ops/settings',   icon: Settings },
  {
    id: 'action:activity',
    group: 'System',
    label: 'Recent activity',
    icon: Activity,
    keywords: ['activity', 'stream', 'events', 'live'],
    shortcut: 'A',
    scope: 'power',
    action: () => {
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('abel:open-activity'))
      }
    },
  },
  // Create scope
  { id: 'create:quote',  group: 'Create', label: 'New Quote',          icon: Plus, scope: 'create', action: () => typeof window !== 'undefined' && (window.location.href = '/ops/quotes/new') },
  { id: 'create:order',  group: 'Create', label: 'New Order',          icon: Plus, scope: 'create', action: () => typeof window !== 'undefined' && (window.location.href = '/ops/orders/new') },
  { id: 'create:po',     group: 'Create', label: 'New Purchase Order', icon: Plus, scope: 'create', action: () => typeof window !== 'undefined' && (window.location.href = '/ops/purchasing/new') },
  // Help
  { id: 'help:shortcuts', group: 'Help', label: 'Keyboard shortcuts', icon: HelpCircle, scope: 'help', action: () => typeof window !== 'undefined' && window.dispatchEvent(new CustomEvent('abel:open-shortcuts')) },
]

// ── Hook ─────────────────────────────────────────────────────────────────

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

// ── Mini force-graph preview ─────────────────────────────────────────────

function MiniForceGraph({
  center,
  nodes,
  width = 200,
  height = 120,
}: {
  center: string
  nodes: string[]
  width?: number
  height?: number
}) {
  // Deterministic layout — center node in the middle, others on a ring.
  const cx = width / 2
  const cy = height / 2
  const r = Math.min(width, height) / 2 - 14
  const positioned = nodes.slice(0, 6).map((label, i, arr) => {
    const angle = (i / Math.max(1, arr.length)) * Math.PI * 2 - Math.PI / 2
    return {
      label,
      x: cx + Math.cos(angle) * r,
      y: cy + Math.sin(angle) * r,
    }
  })
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="block">
      {positioned.map((n, i) => (
        <line
          key={`e-${i}`}
          x1={cx}
          y1={cy}
          x2={n.x}
          y2={n.y}
          stroke="var(--border-strong)"
          strokeWidth={1}
        />
      ))}
      {positioned.map((n, i) => (
        <g key={`n-${i}`}>
          <circle cx={n.x} cy={n.y} r={4} fill="var(--walnut-300, #9C7A5C)" />
          <text
            x={n.x}
            y={n.y + 14}
            textAnchor="middle"
            className="fill-[var(--fg-muted)]"
            style={{ fontSize: 9, fontFamily: 'var(--font-mono)' }}
          >
            {n.label.length > 10 ? `${n.label.slice(0, 10)}…` : n.label}
          </text>
        </g>
      ))}
      <circle
        cx={cx}
        cy={cy}
        r={6}
        fill="var(--signal, var(--gold))"
        stroke="var(--canvas)"
        strokeWidth={1.5}
      />
      <text
        x={cx}
        y={cy + 18}
        textAnchor="middle"
        className="fill-[var(--fg)]"
        style={{ fontSize: 10, fontFamily: 'var(--font-mono)', fontWeight: 600 }}
      >
        {center}
      </text>
    </svg>
  )
}

// ── Component ─────────────────────────────────────────────────────────────

export interface CommandMenuProps {
  open: boolean
  onClose: () => void
  extra?: CommandItem[]
}

export function CommandMenu({ open, onClose, extra = [] }: CommandMenuProps) {
  const router = useRouter()
  const [rawQuery, setRawQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const [placeholderIdx, setPlaceholderIdx] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const [entering, setEntering] = useState(false)
  const [hoverEntity, setHoverEntity] = useState<CommandItem | null>(null)

  const allCommands = useMemo(() => [...STATIC_COMMANDS, ...extra], [extra])

  // Detect scope from leading prefix
  const { scope, innerQuery } = useMemo(() => {
    const q = rawQuery
    if (q.startsWith('/')) return { scope: 'create' as CommandScope, innerQuery: q.slice(1) }
    if (q.startsWith('>')) return { scope: 'power' as CommandScope, innerQuery: q.slice(1) }
    if (q.startsWith('@')) return { scope: 'people' as CommandScope, innerQuery: q.slice(1) }
    if (q.startsWith('#')) return { scope: 'entity' as CommandScope, innerQuery: q.slice(1) }
    if (q.startsWith('?')) return { scope: 'help' as CommandScope, innerQuery: q.slice(1) }
    return { scope: 'default' as CommandScope, innerQuery: q }
  }, [rawQuery])

  // Debounce the query by 150ms
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(innerQuery), 150)
    return () => clearTimeout(t)
  }, [innerQuery])

  // Cycle placeholder every 4s when empty
  useEffect(() => {
    if (rawQuery) return
    const t = setInterval(() => {
      setPlaceholderIdx((i) => (i + 1) % PLACEHOLDERS.length)
    }, 4000)
    return () => clearInterval(t)
  }, [rawQuery])

  // Spring enter
  useEffect(() => {
    if (open) {
      setEntering(false)
      setRawQuery('')
      setActiveIndex(0)
      requestAnimationFrame(() => {
        requestAnimationFrame(() => setEntering(true))
      })
      setTimeout(() => inputRef.current?.focus(), 20)
    }
  }, [open])

  const filtered = useMemo(() => {
    const q = debouncedQuery.trim().toLowerCase()
    let items = allCommands
    // Apply scope filtering
    if (scope !== 'default') {
      items = items.filter((c) => c.scope === scope)
    }
    if (!q) return items
    return items.filter(
      (c) =>
        c.label.toLowerCase().includes(q) ||
        c.description?.toLowerCase().includes(q) ||
        c.keywords?.some((k) => k.toLowerCase().includes(q)),
    )
  }, [debouncedQuery, allCommands, scope])

  const grouped = useMemo(() => {
    const groups: Record<string, CommandItem[]> = {}
    filtered.forEach((c) => {
      if (!groups[c.group]) groups[c.group] = []
      groups[c.group].push(c)
    })
    return groups
  }, [filtered])

  const runItem = useCallback(
    (item: CommandItem) => {
      onClose()
      if (item.action) item.action()
      else if (item.href) router.push(item.href)
    },
    [onClose, router],
  )

  // Keyboard nav
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
      } else if (e.key === 'Tab') {
        // Cycle scope
        e.preventDefault()
        const order: CommandScope[] = ['default', 'create', 'power', 'people', 'entity', 'help']
        const next = order[(order.indexOf(scope) + (e.shiftKey ? -1 : 1) + order.length) % order.length]
        setRawQuery(SCOPE_PREFIX[next] + innerQuery)
        inputRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, filtered, activeIndex, runItem, scope, innerQuery])

  if (!open) return null

  const ScopeIcon = SCOPE_ICON[scope]
  let runningIndex = 0

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center pt-[12vh] px-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
    >
      <div
        className="aegis-cmd-backdrop absolute inset-0"
        data-entering={entering || undefined}
      />
      <div
        className="aegis-cmd-panel relative w-full max-w-[640px] overflow-hidden"
        data-entering={entering || undefined}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-4 h-14 border-b border-border">
          <ScopeIcon className="w-5 h-5 text-[var(--signal)] shrink-0" />
          {scope !== 'default' && (
            <span className="inline-flex items-center gap-1 shrink-0 px-2 py-0.5 rounded-md font-mono text-[10px] uppercase tracking-[0.18em] bg-[var(--signal-subtle)] text-[var(--signal)]">
              {SCOPE_LABEL[scope]}
            </span>
          )}
          <input
            ref={inputRef}
            value={rawQuery}
            onChange={(e) => {
              setRawQuery(e.target.value)
              setActiveIndex(0)
            }}
            placeholder={PLACEHOLDERS[placeholderIdx]}
            className="flex-1 bg-transparent outline-none text-[18px] text-fg placeholder:text-fg-subtle"
            style={{ caretColor: 'var(--signal)' }}
          />
          <Kbd size="sm">esc</Kbd>
        </div>

        <div className="flex">
          <div className="flex-1 max-h-[52vh] overflow-y-auto scrollbar-thin py-1">
            {filtered.length === 0 ? (
              <div className="px-4 py-10 text-center text-[13px] text-fg-muted">
                No results for &ldquo;{innerQuery}&rdquo;
              </div>
            ) : (
              Object.entries(grouped).map(([group, items]) => (
                <div key={group} className="py-1">
                  <div className="sticky top-0 z-[1] px-4 pt-2 pb-1 font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-fg-subtle bg-[var(--bg-raised,var(--surface-elevated))]">
                    {group}
                  </div>
                  {items.map((item) => {
                    const myIndex = runningIndex++
                    const Icon = item.icon ?? ArrowRight
                    const active = activeIndex === myIndex
                    return (
                      <button
                        key={item.id}
                        onMouseEnter={() => {
                          setActiveIndex(myIndex)
                          if (item.entity) setHoverEntity(item)
                        }}
                        onMouseLeave={() => setHoverEntity(null)}
                        onClick={() => runItem(item)}
                        className={cn(
                          'w-full flex items-center gap-3 px-4 py-2 text-left text-[13px]',
                          'transition-colors duration-[120ms]',
                          active
                            ? 'bg-[var(--signal-subtle)] text-fg'
                            : 'hover:bg-surface-muted text-fg',
                        )}
                      >
                        <Icon
                          className={cn(
                            'w-4 h-4 shrink-0',
                            active ? 'text-[var(--signal)]' : 'text-fg-muted',
                          )}
                        />
                        <span className="flex-1 min-w-0 truncate">
                          <span className="text-fg">{item.label}</span>
                          {item.description && (
                            <span className="text-fg-muted text-[11.5px] ml-2">
                              {item.description}
                            </span>
                          )}
                        </span>
                        {item.shortcut && <Kbd size="sm">{item.shortcut}</Kbd>}
                      </button>
                    )
                  })}
                </div>
              ))
            )}
          </div>
          {hoverEntity?.entity && (
            <aside className="hidden md:block w-[220px] border-l border-border bg-[var(--bg-sunken,var(--canvas))] p-3">
              <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-fg-subtle mb-2">
                Relationships
              </div>
              <MiniForceGraph
                center={hoverEntity.entity.id}
                nodes={hoverEntity.entity.connections ?? []}
              />
              <div className="mt-2 text-[11.5px] text-fg-muted">
                {hoverEntity.label}
              </div>
            </aside>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 px-4 py-2 border-t border-border bg-surface-muted text-[11px] text-fg-subtle">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1">
              <Kbd size="sm">↑↓</Kbd> navigate
            </span>
            <span className="flex items-center gap-1">
              <Kbd size="sm">↵</Kbd> open
            </span>
            <span className="flex items-center gap-1">
              <Kbd size="sm">Tab</Kbd> scope
            </span>
          </div>
          <span className="flex items-center gap-1">
            <Command className="w-3 h-3" /> Aegis
          </span>
        </div>
      </div>

      <style jsx>{`
        .aegis-cmd-backdrop {
          background: rgba(10, 26, 40, 0.65);
          backdrop-filter: blur(16px) saturate(1.4);
          -webkit-backdrop-filter: blur(16px) saturate(1.4);
          opacity: 0;
          transition: opacity 180ms var(--ease);
        }
        .aegis-cmd-backdrop[data-entering='true'] { opacity: 1; }

        .aegis-cmd-panel {
          background: var(--bg-raised, var(--surface-elevated));
          border: 1px solid var(--border);
          border-radius: var(--radius-lg);
          box-shadow: var(--elev-4);
          opacity: 0;
          transform: scale(0.96);
          transition:
            opacity 180ms var(--ease-spring),
            transform 180ms var(--ease-spring);
        }
        .aegis-cmd-panel[data-entering='true'] {
          opacity: 1;
          transform: scale(1);
        }

        @media (prefers-reduced-motion: reduce) {
          .aegis-cmd-backdrop,
          .aegis-cmd-panel {
            transition-duration: 120ms !important;
          }
        }
      `}</style>

      {/** swallow unused var so bundler doesn't warn */}
      <span hidden>{Slash.toString().length}</span>
    </div>
  )
}

export default CommandMenu
