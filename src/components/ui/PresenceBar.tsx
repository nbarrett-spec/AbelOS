'use client'

import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import Avatar from './Avatar'
import Tooltip from './Tooltip'

// ── Types ─────────────────────────────────────────────────────────────────

export interface PresenceUser {
  id: string
  name: string
  email?: string
  avatarUrl?: string
  /** ISO timestamp of last heartbeat */
  seenAt?: string
}

export interface PresenceBarProps {
  /** Resource identifier (e.g. "order:abc123"). Included in polling request. */
  resource: string
  /** API endpoint for presence. GET returns users, POST records this user's heartbeat.
   *  Default '/api/presence'. */
  endpoint?: string
  /** Polling interval in ms. Default 30000. */
  pollMs?: number
  /** Max avatars shown before stacking into "+N". Default 4. */
  limit?: number
  /** Compact mode — smaller avatars, no label */
  compact?: boolean
  className?: string
}

// ── Component ─────────────────────────────────────────────────────────────

/**
 * PresenceBar — shows avatars of other staff currently viewing this resource.
 *
 * Transport: lazy polling (no websocket server needed). Every `pollMs`, POSTs
 * a heartbeat for the current user + GETs the active list. If the endpoint
 * doesn't exist (404 / 500), this component degrades gracefully to rendering
 * nothing — no error toast, no console spam.
 *
 * Expected API:
 *   GET  /api/presence?resource=order:abc123 → { users: PresenceUser[] }
 *   POST /api/presence { resource }          → { ok: true }
 */
export default function PresenceBar({
  resource,
  endpoint = '/api/presence',
  pollMs = 30_000,
  limit = 4,
  compact = false,
  className,
}: PresenceBarProps) {
  const [users, setUsers] = useState<PresenceUser[]>([])
  const [available, setAvailable] = useState(true)

  useEffect(() => {
    if (!resource) return
    let cancelled = false

    const heartbeat = async () => {
      if (!available) return
      try {
        // Fire-and-forget heartbeat. Don't await response for GET.
        fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ resource }),
        }).catch(() => { /* ignore */ })

        const res = await fetch(`${endpoint}?resource=${encodeURIComponent(resource)}`, {
          cache: 'no-store',
        })
        if (!res.ok) {
          if (res.status === 404) { setAvailable(false) }
          return
        }
        const data = await res.json()
        if (!cancelled && Array.isArray(data?.users)) {
          setUsers(data.users)
        }
      } catch {
        // Network / endpoint not present — silently disable.
        setAvailable(false)
      }
    }

    heartbeat()
    const id = window.setInterval(heartbeat, pollMs)
    return () => { cancelled = true; window.clearInterval(id) }
  }, [resource, endpoint, pollMs, available])

  if (!available || users.length === 0) return null

  const visible = users.slice(0, limit)
  const extra = users.length - visible.length

  return (
    <div className={cn('flex items-center gap-2', className)}>
      {!compact && (
        <span className="eyebrow text-[10px] text-fg-subtle hidden sm:inline">Viewing now</span>
      )}
      <div className="flex items-center -space-x-1.5">
        {visible.map(u => (
          <Tooltip key={u.id} content={u.name}>
            <span className="ring-2 ring-canvas rounded-full inline-block">
              <Avatar name={u.name} src={u.avatarUrl} size={compact ? 'sm' : 'md'} />
            </span>
          </Tooltip>
        ))}
        {extra > 0 && (
          <span className={cn(
            'inline-flex items-center justify-center rounded-full ring-2 ring-canvas',
            'bg-surface-muted text-fg-muted font-medium',
            compact ? 'w-5 h-5 text-[9px]' : 'w-6 h-6 text-[10px]',
          )}>
            +{extra}
          </span>
        )}
      </div>
    </div>
  )
}
