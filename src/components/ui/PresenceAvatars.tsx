'use client'

import { useEffect, useState } from 'react'
import Avatar from './Avatar'
import Tooltip from './Tooltip'
import { cn } from '@/lib/utils'

interface Viewer {
  staffId: string
  name: string
  avatar: string | null
  lastSeen: string
}

export interface PresenceAvatarsProps {
  /** Path to register presence on. Defaults to current pathname. */
  path?: string
  /** How often to ping/refresh, ms. Default 30s. */
  intervalMs?: number
  /** Max avatars to show inline before collapsing to "+N". Default 5. */
  max?: number
  className?: string
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
}: PresenceAvatarsProps) {
  const [viewers, setViewers] = useState<Viewer[]>([])
  const [resolvedPath, setResolvedPath] = useState<string>('')

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
      {shown.map((v) => (
        <Tooltip key={v.staffId} content={`${v.name} · viewing now`} side="bottom" delay={150}>
          <div className="ring-2 ring-surface rounded-full">
            <Avatar name={v.name} src={v.avatar} size="xs" status="online" />
          </div>
        </Tooltip>
      ))}
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
