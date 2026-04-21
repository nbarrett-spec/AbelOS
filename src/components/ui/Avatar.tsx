'use client'

import { type HTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

// ── Aegis v2 "Drafting Room" Avatar ──────────────────────────────────────
// Deterministic tint from name/ID hash into Abel palette (walnut, kiln-oak,
// brass, sky, dust). Initials fallback. 2px gold halo when editing.
// ─────────────────────────────────────────────────────────────────────────

export type AvatarSize = 'sm' | 'md' | 'lg' | 'xl'
export type AvatarStatus = 'editing' | 'online' | 'offline' | 'busy' | 'away'

const PX: Record<AvatarSize, number> = {
  sm: 24,
  md: 32,
  lg: 40,
  xl: 56,
}
const TEXT: Record<AvatarSize, string> = {
  sm: 'text-[10px]',
  md: 'text-[12px]',
  lg: 'text-[14px]',
  xl: 'text-[18px]',
}

// Abel palette for deterministic tints
const TINTS = [
  { bg: '#3E2A1E', fg: '#F5EFE9' }, // walnut-600
  { bg: '#8B6F47', fg: '#F5EFE9' }, // kiln-oak
  { bg: '#8B6F2A', fg: '#F5EFE9' }, // brass
  { bg: '#8CA8B8', fg: '#0a1a28' }, // sky
  { bg: '#B8876B', fg: '#2A1C14' }, // dust
  { bg: '#5A4233', fg: '#F5EFE9' }, // walnut-500
  { bg: '#9C7A5C', fg: '#1C120C' }, // walnut-300
] as const

function hashString(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h) + s.charCodeAt(i)
    h |= 0
  }
  return Math.abs(h)
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0][0]!.toUpperCase()
  return (parts[0][0]! + parts[parts.length - 1][0]!).toUpperCase()
}

const STATUS_COLOR: Record<AvatarStatus, string> = {
  editing: 'var(--signal, var(--gold))',
  online: 'var(--sage, #5caa68)',
  offline: 'var(--fg-subtle, #6b7280)',
  busy: 'var(--ember, #b64e3d)',
  away: 'var(--gold-dark, #a88a3a)',
}

export interface AvatarProps extends HTMLAttributes<HTMLDivElement> {
  name?: string
  /** Stable ID (used for deterministic tint if provided; falls back to name) */
  id?: string
  src?: string | null
  size?: AvatarSize
  status?: AvatarStatus
  /** Shortcut: when true, shows the "editing" halo ring in gold */
  editing?: boolean
}

export function Avatar({
  name = '',
  id,
  src,
  size = 'md',
  status,
  editing,
  className,
  style,
  ...props
}: AvatarProps) {
  const px = PX[size]
  const hashKey = id ?? name ?? 'anon'
  const tint = TINTS[hashString(hashKey) % TINTS.length]
  const initials = getInitials(name || '?')
  const resolvedStatus: AvatarStatus | undefined = editing ? 'editing' : status
  const haloColor = resolvedStatus ? STATUS_COLOR[resolvedStatus] : undefined

  return (
    <span
      {...props}
      className={cn('relative inline-flex shrink-0 align-middle', className)}
      style={{ width: px, height: px, ...style }}
    >
      <span
        className="inline-flex items-center justify-center rounded-full overflow-hidden font-semibold select-none"
        style={{
          width: px,
          height: px,
          background: src ? 'var(--surface-muted)' : tint.bg,
          color: tint.fg,
          boxShadow:
            resolvedStatus === 'editing'
              ? `0 0 0 2px var(--canvas), 0 0 0 4px ${haloColor}`
              : `0 0 0 1px var(--border)`,
        }}
        aria-label={name || undefined}
      >
        {src ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={src}
            alt={name}
            className="w-full h-full object-cover"
            draggable={false}
          />
        ) : (
          <span className={cn('leading-none', TEXT[size])}>{initials}</span>
        )}
      </span>
      {resolvedStatus && resolvedStatus !== 'editing' && (
        <span
          aria-hidden
          className="absolute bottom-0 right-0 rounded-full"
          style={{
            width: size === 'sm' ? 6 : 8,
            height: size === 'sm' ? 6 : 8,
            background: haloColor,
            boxShadow: '0 0 0 2px var(--canvas)',
          }}
        />
      )}
    </span>
  )
}

export default Avatar
