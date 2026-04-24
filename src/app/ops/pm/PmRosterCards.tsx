'use client'

// ─────────────────────────────────────────────────────────────────────────────
// PmRosterCards — client component for /ops/pm landing page
//
// Renders one card per active PM. Each card:
//   • headshot placeholder (initials in a circle via <Avatar/>)
//   • name + title/role
//   • 4 KPI tiles (Active Jobs · Materials Ready · Closing This Week · Overdue)
//   • "Open Book →" footer button linking to /ops/pm/book/[staffId]
//
// KPI tiles are plain <div>s (not <KPICard/>) so they can live *inside* a card
// without glass-on-glass stacking. Materials Ready tile is color-coded:
//   ≥ 80 green · 50–79 amber · < 50 red.
//
// Refresh: manual "Refresh" button calls router.refresh().
// ─────────────────────────────────────────────────────────────────────────────

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import {
  Briefcase,
  PackageCheck,
  CalendarClock,
  AlertTriangle,
  ArrowRight,
  RefreshCw,
} from 'lucide-react'
import { Avatar } from '@/components/ui'
import { cn } from '@/lib/utils'

export interface RosterPM {
  id: string
  firstName: string
  lastName: string
  email: string
  title: string | null
  role: string
  activeJobs: number
  materialsReadyPct: number
  closingThisWeek: number
  overdueTasks: number
}

interface Props {
  pms: RosterPM[]
  asOf: string
  fallbackUsed: boolean
}

// ── Tile — compact KPI inside a card ─────────────────────────────────────────
function Tile({
  label,
  value,
  icon,
  tone = 'neutral',
}: {
  label: string
  value: number | string
  icon: React.ReactNode
  tone?: 'neutral' | 'positive' | 'accent' | 'negative' | 'brand'
}) {
  const toneClass: Record<string, string> = {
    neutral: 'text-fg',
    positive: 'text-data-positive-fg',
    accent: 'text-accent-fg',
    negative: 'text-data-negative-fg',
    brand: 'text-accent-fg',
  }
  const bgClass: Record<string, string> = {
    neutral: 'bg-surface-muted',
    positive: 'bg-data-positive-bg',
    accent: 'bg-accent-subtle',
    negative: 'bg-data-negative-bg',
    brand: 'bg-brand-subtle',
  }
  return (
    <div className={cn('rounded-md border border-border/60 p-3 flex flex-col gap-1', bgClass[tone])}>
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-fg-muted">
        <span className={cn('shrink-0', toneClass[tone])}>{icon}</span>
        <span className="truncate">{label}</span>
      </div>
      <div className={cn('text-xl font-semibold font-numeric leading-none', toneClass[tone])}>
        {value}
      </div>
    </div>
  )
}

function readyTone(pct: number): 'positive' | 'accent' | 'negative' {
  if (pct >= 80) return 'positive'
  if (pct >= 50) return 'accent'
  return 'negative'
}

// ── Single card ──────────────────────────────────────────────────────────────
function PmCard({ pm }: { pm: RosterPM }) {
  const fullName = `${pm.firstName} ${pm.lastName}`.trim()
  const displayTitle =
    pm.title ||
    (pm.role === 'PROJECT_MANAGER' ? 'Project Manager' : pm.role.replace(/_/g, ' '))

  const href = `/ops/pm/book/${encodeURIComponent(pm.id)}`

  return (
    <Link
      href={href}
      className={cn(
        'glass-card group relative overflow-hidden flex flex-col gap-4 p-5',
        'transition-[border-color,box-shadow,transform] duration-fast ease-out',
        'hover:border-border-strong hover:shadow-elevation-2'
      )}
    >
      {/* Header: avatar + name + title */}
      <div className="flex items-center gap-3">
        <Avatar name={fullName} size="lg" />
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-fg truncate">{fullName}</div>
          <div className="text-xs text-fg-muted truncate">{displayTitle}</div>
        </div>
      </div>

      {/* 2×2 KPI grid */}
      <div className="grid grid-cols-2 gap-2">
        <Tile
          label="Active Jobs"
          value={pm.activeJobs}
          icon={<Briefcase className="w-3.5 h-3.5" />}
          tone="brand"
        />
        <Tile
          label="Materials Ready"
          value={`${pm.materialsReadyPct}%`}
          icon={<PackageCheck className="w-3.5 h-3.5" />}
          tone={readyTone(pm.materialsReadyPct)}
        />
        <Tile
          label="Closing ≤ 7d"
          value={pm.closingThisWeek}
          icon={<CalendarClock className="w-3.5 h-3.5" />}
          tone="accent"
        />
        <Tile
          label="Overdue Tasks"
          value={pm.overdueTasks}
          icon={<AlertTriangle className="w-3.5 h-3.5" />}
          tone={pm.overdueTasks === 0 ? 'positive' : 'negative'}
        />
      </div>

      {/* Footer CTA */}
      <div className="flex items-center justify-between pt-2 border-t border-border/60">
        <span className="text-xs text-fg-subtle truncate">{pm.email}</span>
        <span className="text-xs font-medium text-fg group-hover:text-accent-fg transition-colors flex items-center gap-1">
          Open Book
          <ArrowRight className="w-3.5 h-3.5 transition-transform group-hover:translate-x-0.5" />
        </span>
      </div>
    </Link>
  )
}

// ── Main component ───────────────────────────────────────────────────────────
export default function PmRosterCards({ pms, asOf, fallbackUsed }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [lastRefreshed, setLastRefreshed] = useState(asOf)

  const handleRefresh = () => {
    startTransition(() => {
      router.refresh()
      setLastRefreshed(new Date().toISOString())
    })
  }

  const asOfLabel = new Date(lastRefreshed).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })

  return (
    <div className="space-y-4">
      {/* Refresh bar */}
      <div className="flex items-center justify-between text-xs text-fg-muted">
        <span>
          {fallbackUsed ? (
            <span className="text-accent-fg">
              Showing staff with assigned jobs (role-based lookup returned empty).
            </span>
          ) : (
            <>Refreshed {asOfLabel}</>
          )}
        </span>
        <button
          type="button"
          onClick={handleRefresh}
          disabled={isPending}
          className={cn(
            'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-border/60',
            'bg-surface hover:bg-surface-muted hover:border-border-strong',
            'transition-colors text-xs font-medium text-fg',
            'disabled:opacity-50 disabled:cursor-not-allowed'
          )}
        >
          <RefreshCw className={cn('w-3.5 h-3.5', isPending && 'animate-spin')} />
          {isPending ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {/* Cards grid — 1 / 2 / 4 columns */}
      {pms.length === 0 ? (
        <div className="glass-card p-8 text-center">
          <div className="text-sm font-semibold text-fg mb-1">No Project Managers configured.</div>
          <div className="text-xs text-fg-muted">
            Add staff via{' '}
            <Link href="/ops/staff" className="underline hover:text-fg">
              /ops/staff
            </Link>
            .
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {pms.map((pm) => (
            <PmCard key={pm.id} pm={pm} />
          ))}
        </div>
      )}
    </div>
  )
}
