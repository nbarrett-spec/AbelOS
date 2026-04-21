'use client'

import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import StatusDot from './StatusDot'
import { useLiveTopic } from '@/hooks/useLiveTopic'

// ── Types ─────────────────────────────────────────────────────────────────

export type SyncState = 'live' | 'catching-up' | 'offline'

export interface SyncSourceInfo {
  name: string
  lastSyncAt: string | null
  status: 'ok' | 'warn' | 'error'
  error?: string
}

export interface SyncChipProps {
  /** Polling cadence for /api/health in ms. Default 10000. */
  pollMs?: number
  /** Window after which "live" tips to "catching up" if no SSE tick, in ms. Default 10000. */
  staleMs?: number
  /** Override sources for dropdown */
  sources?: SyncSourceInfo[]
  className?: string
}

// ── Helpers ───────────────────────────────────────────────────────────────

function formatAgo(ms: number): string {
  if (ms < 1000) return 'just now'
  const secs = Math.round(ms / 1000)
  if (secs < 60) return `${secs}s`
  const mins = Math.round(secs / 60)
  if (mins < 60) return `${mins}m`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs}h`
  const days = Math.round(hrs / 24)
  return `${days}d`
}

// ── Component ─────────────────────────────────────────────────────────────

/**
 * SyncChip — top-bar sync status indicator.
 *
 * Polls /api/health every 10s and tracks the most recent SSE event timestamp
 * from useLiveTopic('*'). Displays one of:
 *   Live · 2s         — data fresh within staleMs
 *   Catching up…      — health OK but no tick in staleMs
 *   Offline — queued N — health check failed
 *
 * Click to expand sync details per data source.
 */
export default function SyncChip({
  pollMs = 10_000,
  staleMs = 10_000,
  sources: overrideSources,
  className,
}: SyncChipProps) {
  const [state, setState] = useState<SyncState>('live')
  const [lastHealthAt, setLastHealthAt] = useState<number>(Date.now())
  const [queued, setQueued] = useState(0)
  const [open, setOpen] = useState(false)
  const [now, setNow] = useState(Date.now())
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Last SSE event tick — wildcard subscription
  const lastEvent = useLiveTopic(null)
  const lastEventAtMs = lastEvent?.at ? new Date(lastEvent.at).getTime() : lastHealthAt

  // ── Health polling ─────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false

    async function check() {
      try {
        const res = await fetch('/api/health', { cache: 'no-store' })
        if (cancelled) return
        if (res.ok) {
          setLastHealthAt(Date.now())
          setQueued(0)
        } else {
          setState('offline')
          setQueued((q) => q + 1)
        }
      } catch {
        if (cancelled) return
        setState('offline')
        setQueued((q) => q + 1)
      }
    }

    check()
    const t = setInterval(check, pollMs)
    return () => {
      cancelled = true
      clearInterval(t)
    }
  }, [pollMs])

  // ── Heartbeat timer for "X seconds ago" updates ────────────────────────
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1_000)
    return () => clearInterval(t)
  }, [])

  // ── Derive state ───────────────────────────────────────────────────────
  useEffect(() => {
    // If offline was set by health check, only recover when health ticks
    if (state === 'offline' && Date.now() - lastHealthAt > pollMs * 2) return
    if (state === 'offline' && Date.now() - lastHealthAt <= pollMs) {
      setState('live')
    }
    const ageMs = Date.now() - lastEventAtMs
    if (state !== 'offline') {
      setState(ageMs > staleMs ? 'catching-up' : 'live')
    }
  }, [now, lastEventAtMs, lastHealthAt, pollMs, staleMs, state])

  // ── Dropdown outside-click ─────────────────────────────────────────────
  useEffect(() => {
    if (!open) return
    function onClick(e: MouseEvent) {
      if (!dropdownRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [open])

  const ageMs = Math.max(0, now - lastEventAtMs)
  const tone: 'live' | 'active' | 'alert' | 'offline' =
    state === 'live' ? 'live' : state === 'catching-up' ? 'active' : 'offline'
  const label =
    state === 'live'
      ? `Live · ${formatAgo(ageMs)}`
      : state === 'catching-up'
        ? 'Catching up…'
        : `Offline — queued ${queued}`

  // Default sources for dropdown
  const sources: SyncSourceInfo[] = overrideSources ?? [
    { name: 'InFlow', lastSyncAt: new Date(lastHealthAt).toISOString(), status: state === 'offline' ? 'error' : 'ok' },
    { name: 'Hyphen', lastSyncAt: new Date(lastHealthAt).toISOString(), status: 'warn', error: '0/80 linked — diagnostic pending' },
    { name: 'Stripe', lastSyncAt: new Date(lastHealthAt).toISOString(), status: state === 'offline' ? 'error' : 'ok' },
    { name: 'Gmail',  lastSyncAt: new Date(lastHealthAt).toISOString(), status: state === 'offline' ? 'error' : 'ok' },
  ]

  return (
    <div ref={dropdownRef} className={cn('relative', className)}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'inline-flex items-center gap-1.5 h-7 px-2 rounded-md',
          'border border-border bg-surface-muted hover:border-border-strong',
          'transition-colors text-[11px] font-mono text-fg-muted hover:text-fg',
        )}
        aria-label={label}
        aria-expanded={open}
      >
        <StatusDot
          tone={state === 'live' ? 'live' : state === 'catching-up' ? 'active' : 'offline'}
          size={6}
        />
        <span>{label}</span>
      </button>

      {open && (
        <div
          role="dialog"
          className={cn(
            'absolute right-0 top-8 w-[260px] z-50',
            'rounded-md border border-border bg-surface shadow-elevation-4',
            'animate-[slideDown_140ms_ease-out]',
          )}
        >
          <header className="px-3 py-2 border-b border-border flex items-center justify-between">
            <span className="text-[10px] uppercase tracking-wide text-fg-subtle">Sync Status</span>
            <span className="text-[10px] font-mono text-fg-subtle">{label}</span>
          </header>
          <ul className="py-1">
            {sources.map((s) => {
              const dotTone = s.status === 'ok' ? 'success' : s.status === 'warn' ? 'active' : 'alert'
              const last = s.lastSyncAt ? formatAgo(Date.now() - new Date(s.lastSyncAt).getTime()) : '—'
              return (
                <li key={s.name} className="px-3 py-1.5 flex items-start gap-2">
                  <StatusDot tone={dotTone as any} size={6} className="mt-1" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <span className="text-[12px] font-medium text-fg">{s.name}</span>
                      <span className="text-[10px] font-mono text-fg-subtle">{last} ago</span>
                    </div>
                    {s.error && (
                      <p className="text-[10px] text-ember-500 mt-0.5 truncate" title={s.error}>
                        {s.error}
                      </p>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
          <footer className="px-3 py-2 border-t border-border text-[10px] text-fg-subtle">
            Polls every {Math.round(pollMs / 1000)}s · SSE from /api/ops/stream
          </footer>
        </div>
      )}
    </div>
  )
}
