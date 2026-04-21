'use client'

import { useEffect, useRef, useState } from 'react'
import Avatar from './Avatar'
import Tooltip from './Tooltip'
import { cn } from '@/lib/utils'

interface Viewer {
  staffId: string
  name: string
  avatar: string | null
  lastSeen: string
  /** True if this viewer has interacted with a tracked input in the last 15s */
  isActive?: boolean
  /** True if this viewer is currently in a tracked input field */
  isTyping?: boolean
}

export interface PresenceAvatarsProps {
  /** Path to register presence on. Defaults to current pathname. */
  path?: string
  /** How often to ping/refresh, ms. Default 30s. */
  intervalMs?: number
  /** Max avatars to show inline before collapsing to "+N". Default 5. */
  max?: number
  className?: string
  /** Optional record id — if set, presence is also keyed by record and typing
   *  indicators attach to inputs within the host DOM. */
  recordId?: string
  /** Optional record type — sent to the activity API */
  recordType?: string
}

// ── Typing Indicator sub-component ───────────────────────────────────────

function TypingIndicator({ className }: { className?: string }) {
  return (
    <span
      role="img"
      aria-label="typing"
      className={cn(
        'inline-flex items-end gap-0.5 h-3 w-4 shrink-0',
        className,
      )}
    >
      <span className="w-[3px] h-[3px] rounded-full bg-signal animate-[typing-dot_1.2s_ease-in-out_0ms_infinite]" />
      <span className="w-[3px] h-[3px] rounded-full bg-signal animate-[typing-dot_1.2s_ease-in-out_160ms_infinite]" />
      <span className="w-[3px] h-[3px] rounded-full bg-signal animate-[typing-dot_1.2s_ease-in-out_320ms_infinite]" />
      <style jsx>{`
        @keyframes typing-dot {
          0%, 60%, 100% { transform: translateY(0);   opacity: 0.45; }
          30%           { transform: translateY(-2px); opacity: 1; }
        }
      `}</style>
    </span>
  )
}

/**
 * PresenceAvatars — tiny overlapping avatars showing who else is viewing this page.
 *
 * Usage:
 *   <PresenceAvatars />
 *   <PresenceAvatars path="/ops/orders/abc-123" />
 *
 * Pings POST /api/ops/presence every `intervalMs`. Fetches the live viewer list
 * at the same cadence. Self-filters out the current user if detectable via a
 * cookie so Nate doesn't see his own face.
 */
export default function PresenceAvatars({
  path,
  intervalMs = 30_000,
  max = 5,
  className,
  recordId,
  recordType,
}: PresenceAvatarsProps) {
  const [viewers, setViewers] = useState<Viewer[]>([])
  const [resolvedPath, setResolvedPath] = useState<string>('')
  const isTypingRef = useRef<boolean>(false)
  const lastActiveRef = useRef<number>(0)

  useEffect(() => {
    if (typeof window === 'undefined') return
    const p = path || window.location.pathname
    setResolvedPath(p)

    let cancelled = false

    async function ping() {
      try {
        await fetch('/api/ops/presence', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: p }),
          credentials: 'include',
        })
      } catch {}
    }

    async function fetchViewers() {
      try {
        const res = await fetch(`/api/ops/presence?path=${encodeURIComponent(p)}`, {
          credentials: 'include',
        })
        if (!res.ok) return
        const data = await res.json()
        if (!cancelled && Array.isArray(data.viewers)) {
          setViewers(data.viewers)
        }
      } catch {}
    }

    // Fire and forget, then re-ping on an interval.
    ping().then(fetchViewers)
    const t = setInterval(() => {
      ping().then(fetchViewers)
    }, intervalMs)

    return () => {
      cancelled = true
      clearInterval(t)
    }
  }, [path, intervalMs])

  // ── Typing / active tracking ─────────────────────────────────────────────
  useEffect(() => {
    if (!recordId) return
    if (typeof window === 'undefined') return

    async function pingActivity(isTyping: boolean) {
      try {
        await fetch('/api/ops/presence/activity', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ recordId, recordType, isTyping }),
        })
      } catch {}
    }

    function isTrackedInput(el: EventTarget | null): boolean {
      const t = el as HTMLElement | null
      if (!t) return false
      const tag = t.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
      if ((t as any).isContentEditable) return true
      return false
    }

    function onFocus(e: FocusEvent) {
      if (!isTrackedInput(e.target)) return
      isTypingRef.current = true
      lastActiveRef.current = Date.now()
      pingActivity(true)
    }

    function onBlur(e: FocusEvent) {
      if (!isTrackedInput(e.target)) return
      isTypingRef.current = false
      pingActivity(false)
    }

    function onInput(e: Event) {
      if (!isTrackedInput(e.target)) return
      lastActiveRef.current = Date.now()
      if (!isTypingRef.current) {
        isTypingRef.current = true
        pingActivity(true)
      }
    }

    document.addEventListener('focus', onFocus, true)
    document.addEventListener('blur', onBlur, true)
    document.addEventListener('input', onInput, true)

    // Send isTyping=false if no keystroke in 15s
    const decay = setInterval(() => {
      if (isTypingRef.current && Date.now() - lastActiveRef.current > 15_000) {
        isTypingRef.current = false
        pingActivity(false)
      }
    }, 5_000)

    return () => {
      document.removeEventListener('focus', onFocus, true)
      document.removeEventListener('blur', onBlur, true)
      document.removeEventListener('input', onInput, true)
      clearInterval(decay)
      if (isTypingRef.current) pingActivity(false)
    }
  }, [recordId, recordType])

  // Filter out the current user from the display (best-effort via cookie)
  const selfId = typeof document !== 'undefined'
    ? (document.cookie.match(/(?:^|;\s*)staff_id=([^;]+)/)?.[1] || '')
    : ''
  const others = selfId ? viewers.filter((v) => v.staffId !== selfId) : viewers

  if (others.length === 0) return null

  const shown = others.slice(0, max)
  const overflow = others.length - shown.length

  return (
    <div
      className={cn('flex items-center -space-x-2', className)}
      aria-label={`${others.length} viewing now`}
      data-presence-path={resolvedPath}
    >
      {shown.map((v) => {
        const tooltipText = v.isTyping
          ? `${v.name} · typing…`
          : v.isActive
            ? `${v.name} · actively editing`
            : `${v.name} · viewing now`
        return (
          <Tooltip key={v.staffId} content={tooltipText} side="bottom" delay={150}>
            <div className="relative flex items-center">
              <div
                className={cn(
                  'rounded-full',
                  v.isActive
                    ? 'ring-2 ring-signal shadow-[0_0_0_1px_var(--surface),_0_0_8px_2px_var(--signal)]'
                    : 'ring-2 ring-surface',
                )}
              >
                <Avatar name={v.name} src={v.avatar} size="sm" status="online" />
              </div>
              {v.isTyping && (
                <span className="absolute -bottom-1.5 left-1/2 -translate-x-1/2">
                  <TypingIndicator />
                </span>
              )}
            </div>
          </Tooltip>
        )
      })}
      {overflow > 0 && (
        <Tooltip
          content={others.slice(max).map((v) => v.name).join(', ')}
          side="bottom"
          delay={150}
        >
          <div className="w-6 h-6 rounded-full bg-surface-muted ring-2 ring-surface flex items-center justify-center text-[10px] font-semibold text-fg-muted">
            +{overflow}
          </div>
        </Tooltip>
      )}
    </div>
  )
}
