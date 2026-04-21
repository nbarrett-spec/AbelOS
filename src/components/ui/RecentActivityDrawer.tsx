'use client'

import { useCallback, useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import { Activity, X } from 'lucide-react'
import { useLiveTick } from '@/hooks/useLiveTopic'

interface LiveEventRow {
  topic: string
  entity?: string
  entityId?: string
  action: string
  at: string
  staffId?: string
  id?: string
}

export interface RecentActivityDrawerProps {
  className?: string
}

/**
 * RecentActivityDrawer — floating panel opening from the right edge of the
 * screen. Globally accessible via:
 *   - Keyboard `A` (when no input is focused)
 *   - `window.dispatchEvent(new CustomEvent('abel:open-activity'))`
 *
 * Shows the last 50 events, auto-refreshes every 30s AND every time a live
 * event fires on any topic.
 */
export default function RecentActivityDrawer({ className }: RecentActivityDrawerProps) {
  const [open, setOpen] = useState(false)
  const [events, setEvents] = useState<LiveEventRow[]>([])
  const [loading, setLoading] = useState(false)

  const tick = useLiveTick(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/ops/stream/recent?limit=50', { credentials: 'include' })
      if (res.ok) {
        const data = await res.json()
        setEvents(Array.isArray(data.events) ? data.events : [])
      }
    } finally {
      setLoading(false)
    }
  }, [])

  // Open on 'A' keystroke (unless typing in an input)
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'a' && e.key !== 'A') return
      const target = e.target as HTMLElement | null
      if (!target) return
      const tag = target.tagName
      const isEditable =
        tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (target as any).isContentEditable
      if (isEditable) return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      setOpen((v) => !v)
    }
    function onCustom() {
      setOpen(true)
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('abel:open-activity', onCustom as any)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('abel:open-activity', onCustom as any)
    }
  }, [])

  // Load on open, then on every tick while open, and every 30s as a fallback.
  useEffect(() => {
    if (!open) return
    load()
    const t = setInterval(load, 30_000)
    return () => clearInterval(t)
  }, [open, load])

  useEffect(() => {
    if (open) load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick])

  if (!open) return null

  return (
    <div className={cn('fixed inset-0 z-[75] pointer-events-none', className)}>
      <div
        className="absolute inset-0 bg-black/30 backdrop-blur-[2px] pointer-events-auto"
        onClick={() => setOpen(false)}
      />
      <aside
        className={cn(
          'absolute right-0 top-0 bottom-0 w-[380px] max-w-[92vw]',
          'bg-surface border-l border-border shadow-elevation-5',
          'pointer-events-auto flex flex-col animate-[slideInRight_180ms_ease-out]'
        )}
        role="dialog"
        aria-label="Recent activity"
      >
        <header className="h-[3.25rem] px-4 flex items-center justify-between border-b border-border shrink-0">
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-accent" />
            <h2 className="text-sm font-semibold text-fg">Recent activity</h2>
            {loading && <span className="text-[10px] text-fg-subtle">refreshing…</span>}
          </div>
          <button
            onClick={() => setOpen(false)}
            className="p-1 rounded hover:bg-surface-muted text-fg-muted"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto">
          {events.length === 0 && (
            <div className="p-6 text-xs text-fg-subtle text-center">
              No recent events in the live stream.
            </div>
          )}
          <ul className="divide-y divide-border">
            {events.map((e, i) => (
              <li key={`${e.id || ''}-${i}`} className="px-4 py-2.5 hover:bg-surface-muted">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-mono text-fg-subtle">
                    {new Date(e.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                  </span>
                  <span className="text-[10px] uppercase tracking-wide text-fg-subtle">{e.topic}</span>
                </div>
                <div className="text-[12px] text-fg mt-0.5">
                  <span className="font-medium">{e.action}</span>
                  {e.entity && <span className="text-fg-muted"> · {e.entity}</span>}
                  {e.entityId && (
                    <span className="font-mono text-fg-subtle"> · {e.entityId.slice(0, 8)}</span>
                  )}
                </div>
                {e.staffId && e.staffId !== 'unknown' && (
                  <div className="text-[10px] text-fg-subtle mt-0.5">by {e.staffId}</div>
                )}
              </li>
            ))}
          </ul>
        </div>

        <footer className="px-4 py-2 border-t border-border text-[10px] text-fg-subtle">
          Press <kbd className="kbd">A</kbd> to toggle · last 50 events
        </footer>
      </aside>
    </div>
  )
}
