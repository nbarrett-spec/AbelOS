'use client'

import { type ReactNode } from 'react'
import { clsx } from 'clsx'
import { Inbox, Package, FileText, Search, Users, Truck, BarChart3, MessageSquare, Shield, Sparkles } from 'lucide-react'
import Button from './Button'

// ── Types ─────────────────────────────────────────────────────────────────

export interface EmptyStateProps {
  /** Icon key from preset map or custom ReactNode */
  icon?: EmptyStateIcon | ReactNode
  title: string
  description?: string
  /** Primary action button */
  action?: {
    label: string
    onClick?: () => void
    href?: string
  }
  /** Secondary action (link style) */
  secondaryAction?: {
    label: string
    onClick?: () => void
    href?: string
  }
  /** 'compact' for inline, 'full' for centered page */
  size?: 'compact' | 'default' | 'full'
  className?: string
}

export type EmptyStateIcon =
  | 'inbox'
  | 'package'
  | 'document'
  | 'search'
  | 'users'
  | 'truck'
  | 'chart'
  | 'message'
  | 'shield'
  | 'sparkles'

const iconMap: Record<EmptyStateIcon, React.ComponentType<{ className?: string }>> = {
  inbox: Inbox,
  package: Package,
  document: FileText,
  search: Search,
  users: Users,
  truck: Truck,
  chart: BarChart3,
  message: MessageSquare,
  shield: Shield,
  sparkles: Sparkles,
}

const sizeClasses = {
  compact: {
    wrapper: 'py-8',
    iconBox: 'w-12 h-12 rounded-xl',
    iconSize: 'w-6 h-6',
    title: 'text-sm',
    description: 'text-xs max-w-xs',
  },
  default: {
    wrapper: 'py-14',
    iconBox: 'w-16 h-16 rounded-2xl',
    iconSize: 'w-8 h-8',
    title: 'text-base',
    description: 'text-sm max-w-sm',
  },
  full: {
    wrapper: 'py-24',
    iconBox: 'w-20 h-20 rounded-2xl',
    iconSize: 'w-10 h-10',
    title: 'text-lg',
    description: 'text-sm max-w-md',
  },
}

// ── Component ─────────────────────────────────────────────────────────────

export default function EmptyState({
  icon = 'inbox',
  title,
  description,
  action,
  secondaryAction,
  size = 'default',
  className,
}: EmptyStateProps) {
  const s = sizeClasses[size]

  // Determine the icon to render
  let IconElement: ReactNode
  if (typeof icon === 'string' && icon in iconMap) {
    const IconComp = iconMap[icon as EmptyStateIcon]
    IconElement = <IconComp className={clsx(s.iconSize, 'text-gray-400 dark:text-gray-500')} />
  } else {
    IconElement = icon
  }

  return (
    <div className={clsx('flex flex-col items-center text-center', s.wrapper, className)}>
      {/* Icon container with subtle gradient */}
      <div
        className={clsx(
          s.iconBox,
          'bg-gradient-to-br from-gray-100 to-gray-50 dark:from-gray-800 dark:to-gray-800/50',
          'flex items-center justify-center mb-4',
          'ring-1 ring-gray-200/50 dark:ring-gray-700/50'
        )}
      >
        {IconElement}
      </div>

      {/* Text */}
      <h3 className={clsx(s.title, 'font-semibold text-gray-900 dark:text-white')}>{title}</h3>
      {description && (
        <p className={clsx(s.description, 'text-gray-500 dark:text-gray-400 mt-1.5 mx-auto')}>
          {description}
        </p>
      )}

      {/* Actions */}
      {(action || secondaryAction) && (
        <div className="flex items-center gap-3 mt-5">
          {action && (
            action.href ? (
              <a href={action.href}>
                <Button variant="accent" size="sm">{action.label}</Button>
              </a>
            ) : (
              <Button variant="accent" size="sm" onClick={action.onClick}>{action.label}</Button>
            )
          )}
          {secondaryAction && (
            secondaryAction.href ? (
              <a
                href={secondaryAction.href}
                className="text-sm font-medium text-abel-walnut dark:text-abel-walnut-light hover:text-abel-walnut-dark transition-colors"
              >
                {secondaryAction.label}
              </a>
            ) : (
              <button
                onClick={secondaryAction.onClick}
                className="text-sm font-medium text-abel-walnut dark:text-abel-walnut-light hover:text-abel-walnut-dark transition-colors"
              >
                {secondaryAction.label}
              </button>
            )
          )}
        </div>
      )}
    </div>
  )
}
