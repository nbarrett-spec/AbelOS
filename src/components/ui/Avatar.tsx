'use client'

import { clsx } from 'clsx'

const sizes = {
  xs: 'w-6 h-6 text-[10px]',
  sm: 'w-8 h-8 text-xs',
  md: 'w-10 h-10 text-sm',
  lg: 'w-12 h-12 text-base',
  xl: 'w-16 h-16 text-lg',
}

const statusColors = {
  online: 'bg-success-500',
  offline: 'bg-gray-400',
  busy: 'bg-danger-500',
  away: 'bg-warning-400',
}

export interface AvatarProps {
  name?: string
  src?: string | null
  size?: keyof typeof sizes
  status?: keyof typeof statusColors
  className?: string
}

function getInitials(name: string): string {
  return name
    .split(' ')
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase()
}

/** Deterministic warm color from a name string */
function nameToColor(name: string): string {
  const colors = [
    'bg-abel-walnut', 'bg-abel-amber', 'bg-success-600', 'bg-info-600',
    'bg-abel-charcoal', 'bg-warning-600', 'bg-danger-500', 'bg-abel-walnut-light',
  ]
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash)
  }
  return colors[Math.abs(hash) % colors.length]
}

export default function Avatar({ name = '', src, size = 'md', status, className }: AvatarProps) {
  const initials = getInitials(name)

  return (
    <div className={clsx('relative inline-flex shrink-0', className)}>
      {src ? (
        <img
          src={src}
          alt={name}
          className={clsx(
            sizes[size],
            'rounded-full object-cover ring-2 ring-white dark:ring-gray-900'
          )}
        />
      ) : (
        <div
          className={clsx(
            sizes[size],
            'rounded-full flex items-center justify-center font-semibold text-white',
            'ring-2 ring-white dark:ring-gray-900',
            nameToColor(name)
          )}
          aria-label={name}
        >
          {initials || '?'}
        </div>
      )}
      {status && (
        <span
          className={clsx(
            'absolute bottom-0 right-0 block rounded-full ring-2 ring-white dark:ring-gray-900',
            statusColors[status],
            size === 'xs' || size === 'sm' ? 'w-2 h-2' : 'w-3 h-3'
          )}
        />
      )}
    </div>
  )
}
