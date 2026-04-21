'use client'

import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import { Activity, GitBranch, AlertCircle, RefreshCw, Bell } from 'lucide-react'

export interface StatusBarItem {
  label: string
  value: string | number
  tone?: 'neutral' | 'positive' | 'negative' | 'warning' | 'info'
  icon?: React.ComponentType<{ className?: string }>
  href?: string
}

export interface StatusBarProps {
  /** Deployment identifier — usually commit SHA or tag */
  deployTag?: string
  /** ISO timestamp of last InFlow sync */
  lastSyncAt?: string | null
  /** Active alert count */
  alertCount?: number
  /** Any extra items */
  items?: StatusBarItem[]
  className?: string
}

const TONE_CLASSES: Record<NonNullable<StatusBarItem['tone']>, string> = {
  neutral:  'text-fg-muted',
  positive: 'text-data-positive',
  negative: 'text-data-negative',
  warning:  'text-data-warning',
  info:     'text-data-info',
}

const TONE_DOTS: Record<NonNullable<StatusBarItem['tone']>, string> = {
  neutral:  'bg-fg-subtle',
  positive: 'bg-data-positive',
  negative: 'bg-data-negative',
  warning:  'bg-data-warning',
  info:     'bg-data-info',
}

function relativeTime(iso: string | null | undefined): string {
  if (!iso) return 'never'
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return 'unknown'
  const diffSec = Math.floor((Date.now() - then) / 1000)
  if (diffSec < 60) return `${diffSec}s ago`
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`
  return `${Math.floor(diffSec / 86400)}d ago`
}

/**
 * Footer system health strip — deploy tag, last sync, alert count.
 * Small, unobtrusive, bottom of AppShell. Use as the "trust me, it's all running" signal.
 */
export default function StatusBar({
  deployTag,
  lastSyncAt,
  alertCount = 0,
  items = [],
  className,
}: StatusBarProps) {
  // Tick so relative time stays fresh
  const [, setTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 30_000)
    return () => clearInterval(id)
  }, [])

  const syncTone: NonNullable<StatusBarItem['tone']> = !lastSyncAt
    ? 'neutral'
    : (Date.now() - new Date(lastSyncAt).getTime()) > 6 * 60 * 60 * 1000
      ? 'warning'
      : 'positive'

  return (
    <div
      className={cn(
        'flex items-center gap-4 px-4 h-7 border-t border-border bg-surface',
        'text-[11px] font-medium text-fg-muted tabular-nums',
        className
      )}
    >
      {/* System live indicator */}
      <div className="flex items-center gap-1.5">
        <span className="relative flex w-1.5 h-1.5">
          <span className="absolute inset-0 rounded-full bg-data-positive animate-pulse-soft" />
          <span className="relative rounded-full w-1.5 h-1.5 bg-data-positive" />
        </span>
        <span className="text-fg-muted">System</span>
        <span className="text-data-positive">operational</span>
      </div>

      <span className="h-3 w-px bg-border" />

      {/* Deploy tag */}
      {deployTag && (
        <div className="flex items-center gap-1.5" title="Build / deploy identifier">
          <GitBranch className="w-3 h-3" />
          <span className="font-mono">{deployTag}</span>
        </div>
      )}

      {deployTag && <span className="h-3 w-px bg-border hidden sm:block" />}

      {/* Last sync */}
      <div className="flex items-center gap-1.5 hidden sm:flex" title="Last InFlow sync">
        <RefreshCw className={cn('w-3 h-3', syncTone === 'warning' && 'text-data-warning')} />
        <span>InFlow synced <span className={TONE_CLASSES[syncTone]}>{relativeTime(lastSyncAt)}</span></span>
      </div>

      <span className="h-3 w-px bg-border hidden sm:block" />

      {/* Alert count */}
      <div className="flex items-center gap-1.5" title="Active alerts">
        <Bell className={cn('w-3 h-3', alertCount > 0 && 'text-data-warning')} />
        <span className={alertCount > 0 ? 'text-data-warning font-semibold' : ''}>
          {alertCount} alert{alertCount === 1 ? '' : 's'}
        </span>
      </div>

      {items.map((item, i) => {
        const Icon = item.icon ?? Activity
        const tone = item.tone ?? 'neutral'
        return (
          <span key={i} className="flex items-center gap-3">
            <span className="h-3 w-px bg-border hidden md:block" />
            <span className={cn('flex items-center gap-1.5 hidden md:flex', TONE_CLASSES[tone])}>
              <Icon className="w-3 h-3" />
              <span className="text-fg-muted">{item.label}</span>
              <span>{item.value}</span>
            </span>
          </span>
        )
      })}

      <div className="ml-auto flex items-center gap-1.5">
        <span className="kbd hidden sm:inline-flex">⌘K</span>
        <span className="text-fg-subtle hidden sm:inline">to search</span>
      </div>
    </div>
  )
}
