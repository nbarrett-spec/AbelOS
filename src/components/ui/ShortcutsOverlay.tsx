'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/utils'
import { Keyboard, X } from 'lucide-react'

// ── Types ─────────────────────────────────────────────────────────────────

export interface Shortcut {
  keys: string[]
  label: string
  /** Optional group label to partition shortcuts visually. */
  group?: string
}

export interface ShortcutsOverlayProps {
  /** Custom list — if omitted, the built-in global list is shown. */
  shortcuts?: Shortcut[]
  /** Toggle key — defaults to '?'. */
  triggerKey?: string
}

// Default global shortcut catalog. Pages may register additional ones by
// rendering <ShortcutsOverlay shortcuts={...} /> with their own list.
const DEFAULT_SHORTCUTS: Shortcut[] = [
  // Global
  { group: 'Global', keys: ['⌘', 'K'], label: 'Open command menu' },
  { group: 'Global', keys: ['/'],       label: 'Focus search on current page' },
  { group: 'Global', keys: ['?'],       label: 'Show this shortcut cheat sheet' },
  { group: 'Global', keys: ['G', 'D'],  label: 'Go to dashboard' },
  { group: 'Global', keys: ['G', 'O'],  label: 'Go to orders' },
  { group: 'Global', keys: ['G', 'F'],  label: 'Go to finance' },
  { group: 'Global', keys: ['G', 'P'],  label: 'Go to purchasing' },
  { group: 'Global', keys: ['G', 'A'],  label: 'Go to accounts' },
  { group: 'Global', keys: ['G', 'M'],  label: 'Go to MRP' },
  // Tables
  { group: 'Tables', keys: ['↑', '↓'], label: 'Move row selection' },
  { group: 'Tables', keys: ['↵'],      label: 'Open selected row' },
  { group: 'Tables', keys: ['E'],      label: 'Edit selected row' },
  { group: 'Tables', keys: ['M'],      label: 'Email related contact' },
  { group: 'Tables', keys: ['J', 'K'], label: 'Move row selection (vim-style)' },
  // Forms
  { group: 'Forms',  keys: ['⌘', '↵'], label: 'Submit form' },
  { group: 'Forms',  keys: ['Esc'],    label: 'Cancel / close modal' },
  // Detail pages
  { group: 'Detail', keys: ['⌘', 'P'], label: 'Print current view' },
  { group: 'Detail', keys: ['⌘', 'S'], label: 'Save changes' },
]

// ── Component ─────────────────────────────────────────────────────────────

/**
 * ShortcutsOverlay — press `?` (configurable) anywhere to show a modal
 * listing every keyboard shortcut in the app, grouped by context.
 *
 * Mount once at the app root (layout.tsx or similar).
 */
export default function ShortcutsOverlay({
  shortcuts = DEFAULT_SHORTCUTS,
  triggerKey = '?',
}: ShortcutsOverlayProps) {
  const [open, setOpen] = useState(false)
  const [mounted, setMounted] = useState(false)

  useEffect(() => { setMounted(true) }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Don't intercept when user is typing in a field.
      const target = e.target as HTMLElement | null
      const isTyping = target && (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      )
      if (e.key === 'Escape' && open) {
        setOpen(false)
        return
      }
      if (isTyping) return
      if (e.key === triggerKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault()
        setOpen(o => !o)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, triggerKey])

  if (!mounted || !open) return null

  // Group by `group` in insertion order.
  const groups: Record<string, Shortcut[]> = {}
  const order: string[] = []
  for (const s of shortcuts) {
    const g = s.group ?? 'Other'
    if (!groups[g]) { groups[g] = []; order.push(g) }
    groups[g].push(s)
  }

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Keyboard shortcuts"
      className="fixed inset-0 z-[80] flex items-center justify-center p-4"
      onClick={() => setOpen(false)}
    >
      <div
        aria-hidden
        className="fixed inset-0 bg-black/50 backdrop-blur-sm animate-[fadeIn_150ms_ease-out]"
      />
      <div
        className={cn(
          'relative w-full max-w-2xl panel panel-elevated p-0 overflow-hidden',
          'animate-[scaleIn_180ms_var(--ease-out)]'
        )}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-border">
          <div className="flex items-center gap-2">
            <span className="w-7 h-7 rounded-md bg-accent-subtle text-accent-fg flex items-center justify-center">
              <Keyboard className="w-4 h-4" />
            </span>
            <div>
              <div className="text-sm font-semibold text-fg">Keyboard shortcuts</div>
              <div className="text-[11px] text-fg-muted">Press <span className="kbd">?</span> anywhere to toggle</div>
            </div>
          </div>
          <button
            onClick={() => setOpen(false)}
            className="btn btn-ghost btn-sm"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="max-h-[70vh] overflow-y-auto p-5 grid grid-cols-1 md:grid-cols-2 gap-6">
          {order.map(groupName => (
            <div key={groupName}>
              <div className="eyebrow mb-2.5">{groupName}</div>
              <ul className="space-y-1.5">
                {groups[groupName].map((s, i) => (
                  <li key={`${groupName}-${i}`} className="flex items-center justify-between gap-4 py-1">
                    <span className="text-[13px] text-fg">{s.label}</span>
                    <span className="flex items-center gap-1 shrink-0">
                      {s.keys.map((k, j) => (
                        <span key={j} className="kbd">{k}</span>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* Footer hint */}
        <div className="px-5 py-2.5 text-[11px] text-fg-muted border-t border-border flex items-center justify-between">
          <span>Aegis · Abel OS</span>
          <span className="flex items-center gap-1.5">
            <span className="kbd">Esc</span><span>to close</span>
          </span>
        </div>
      </div>
    </div>,
    document.body
  )
}
