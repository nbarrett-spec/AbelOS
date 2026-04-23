'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import {
  CheckCircle2,
  AlertTriangle,
  Clock,
  Calendar,
  MapPin,
  ArrowRight,
  ShieldCheck,
} from 'lucide-react'
import Card, { CardHeader } from '@/components/ui/Card'

/**
 * JobStatusGrid — builder-facing schedule confidence widget.
 *
 * Shows every active job for the authenticated builder classified GREEN /
 * AMBER / RED by the ATP engine, with builder-appropriate language. No
 * SKUs, no POs, no vendor names, no internal math — just "ON SCHEDULE /
 * AT RISK / DELAYED" with an expected resolution date.
 *
 * Voice (memory/brand/voice.md): quiet competence, dry wit, no oversell.
 * "We're on it," not "We apologize for the delay."
 */

interface JobStatusItem {
  jobId: string
  jobNumber: string | null
  community: string | null
  address: string | null
  scheduledDate: string | null
  status: 'ON_SCHEDULE' | 'AT_RISK' | 'DELAYED' | 'PENDING'
  headline: string
  message: string
  resolutionDate: string | null
  daysUntilDelivery: number | null
  itemsOnSchedule: number
  itemsAtRisk: number
  totalItems: number
}

interface StatusResponse {
  counts: {
    onSchedule: number
    atRisk: number
    delayed: number
    pending: number
    total: number
  }
  jobs: JobStatusItem[]
  asOf: string
}

interface JobStatusGridProps {
  builderId: string
}

// ── Tone config — maps to existing design tokens (data-positive/warning/negative) ──

const TONE = {
  ON_SCHEDULE: {
    label: 'On schedule',
    icon: CheckCircle2,
    // green/sage — healthy
    cardBorder: 'border-data-positive/30 hover:border-data-positive/60',
    stripe: 'bg-data-positive',
    chipBg: 'bg-data-positive-bg',
    chipFg: 'text-data-positive-fg',
    iconWrap: 'bg-data-positive-bg text-data-positive-fg',
    dotClass: 'bg-data-positive',
  },
  AT_RISK: {
    label: 'At risk',
    icon: AlertTriangle,
    // amber
    cardBorder: 'border-data-warning/30 hover:border-data-warning/60',
    stripe: 'bg-data-warning',
    chipBg: 'bg-data-warning-bg',
    chipFg: 'text-data-warning-fg',
    iconWrap: 'bg-data-warning-bg text-data-warning-fg',
    dotClass: 'bg-data-warning',
  },
  DELAYED: {
    label: 'Delayed',
    icon: Clock,
    // red/ember
    cardBorder: 'border-data-negative/30 hover:border-data-negative/60',
    stripe: 'bg-data-negative',
    chipBg: 'bg-data-negative-bg',
    chipFg: 'text-data-negative-fg',
    iconWrap: 'bg-data-negative-bg text-data-negative-fg',
    dotClass: 'bg-data-negative',
  },
  PENDING: {
    label: 'Scheduling',
    icon: Calendar,
    cardBorder: 'border-border hover:border-fg-subtle',
    stripe: 'bg-fg-subtle',
    chipBg: 'bg-surface-muted',
    chipFg: 'text-fg-muted',
    iconWrap: 'bg-surface-muted text-fg-muted',
    dotClass: 'bg-fg-subtle',
  },
} as const

// ── Utilities ────────────────────────────────────────────────────────────

function formatDayMonth(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })
}

function formatShort(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

// ── KPI tile ─────────────────────────────────────────────────────────────

function KPITile({
  label,
  count,
  tone,
}: {
  label: string
  count: number
  tone: keyof typeof TONE
}) {
  const t = TONE[tone]
  const Icon = t.icon
  return (
    <div
      className={`relative overflow-hidden rounded-xl border ${t.cardBorder} bg-surface p-4 flex items-center gap-4 transition-colors`}
    >
      <div className={`w-11 h-11 rounded-lg flex items-center justify-center ${t.iconWrap}`}>
        <Icon className="w-5 h-5" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[10px] font-bold uppercase tracking-widest text-fg-subtle">
          {label}
        </p>
        <p className="text-2xl font-bold text-fg mt-0.5 leading-none tabular-nums">
          {count}
        </p>
      </div>
    </div>
  )
}

// ── Job card ─────────────────────────────────────────────────────────────

function JobCard({ job }: { job: JobStatusItem }) {
  const t = TONE[job.status]
  const Icon = t.icon
  const title =
    job.community && job.address
      ? `${job.community} · ${job.address}`
      : job.community || job.address || job.jobNumber || 'Job'

  return (
    <Link
      href={`/dashboard/schedule?jobId=${job.jobId}`}
      className={`group relative block overflow-hidden rounded-xl border ${t.cardBorder} bg-surface transition-all hover:shadow-sm`}
    >
      {/* Left status stripe */}
      <span
        className={`absolute inset-y-0 left-0 w-1 ${t.stripe}`}
        aria-hidden
      />
      <div className="p-5 pl-6">
        {/* Header row: status chip + job number */}
        <div className="flex items-center justify-between mb-3">
          <span
            className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md ${t.chipBg} ${t.chipFg} text-[10px] font-bold uppercase tracking-widest`}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${t.dotClass}`} aria-hidden />
            {job.headline}
          </span>
          {job.jobNumber && (
            <span className="text-[10px] font-mono text-fg-subtle uppercase tracking-wide">
              {job.jobNumber}
            </span>
          )}
        </div>

        {/* Title */}
        <div className="flex items-start gap-2 mb-2">
          <MapPin className="w-3.5 h-3.5 text-fg-subtle mt-0.5 shrink-0" />
          <p className="text-sm font-semibold text-fg leading-snug line-clamp-2">
            {title}
          </p>
        </div>

        {/* Message */}
        <p className="text-sm text-fg-muted leading-relaxed mb-3">
          {job.message}
        </p>

        {/* Footer row: delivery date + item counts */}
        <div className="flex items-center justify-between pt-3 border-t border-border">
          <div className="flex items-center gap-1.5 text-xs text-fg-muted">
            <Calendar className="w-3.5 h-3.5" />
            <span className="font-semibold text-fg">
              {job.scheduledDate ? formatDayMonth(job.scheduledDate) : 'TBD'}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {job.totalItems > 0 && (
              <span className="text-[11px] text-fg-subtle tabular-nums">
                {job.itemsOnSchedule}/{job.totalItems} ready
              </span>
            )}
            <div className="opacity-0 group-hover:opacity-100 transition-opacity">
              <ArrowRight className="w-3.5 h-3.5 text-fg-subtle" />
            </div>
          </div>
        </div>
      </div>
    </Link>
  )
}

// ── Skeleton ─────────────────────────────────────────────────────────────

function GridSkeleton() {
  return (
    <div className="space-y-4 animate-pulse">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-20 rounded-xl bg-surface-muted" />
        ))}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="h-44 rounded-xl bg-surface-muted" />
        ))}
      </div>
    </div>
  )
}

// ── Main component ──────────────────────────────────────────────────────

export default function JobStatusGrid({ builderId: _builderId }: JobStatusGridProps) {
  // builderId is used server-side via session — kept as a prop for caller
  // intent & future extensions (multi-account admin views).
  const [data, setData] = useState<StatusResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/builder-portal/jobs/status')
        if (!res.ok) {
          if (!cancelled) setError('Schedule unavailable')
          return
        }
        const json: StatusResponse = await res.json()
        if (!cancelled) setData(json)
      } catch {
        if (!cancelled) setError('Schedule unavailable')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <Card variant="default" padding="none" rounded="2xl" className="overflow-hidden animate-enter">
      <CardHeader className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-4.5 h-4.5 text-data-positive-fg" />
          <h3 className="text-base font-bold text-fg">Schedule confidence</h3>
        </div>
        <Link
          href="/dashboard/schedule"
          className="inline-flex items-center gap-1 text-sm font-semibold text-brand dark:text-brand-hover hover:text-fg dark:hover:text-white transition-colors group"
        >
          Full schedule
          <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" />
        </Link>
      </CardHeader>

      <div className="px-6 py-5">
        {loading ? (
          <GridSkeleton />
        ) : error ? (
          <div className="py-12 text-center">
            <p className="text-sm text-fg-muted">{error}. Try refreshing.</p>
          </div>
        ) : !data || data.jobs.length === 0 ? (
          <div className="py-12 text-center">
            <div className="w-12 h-12 rounded-xl bg-surface-muted mx-auto flex items-center justify-center mb-3">
              <ShieldCheck className="w-6 h-6 text-fg-subtle" />
            </div>
            <p className="text-sm font-semibold text-fg mb-1">No active jobs</p>
            <p className="text-sm text-fg-muted">
              When you have a delivery in flight, you&rsquo;ll see its status here.
            </p>
          </div>
        ) : (
          <div className="space-y-5">
            {/* KPI tiles — always show On Schedule, then At Risk / Delayed when >0 */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <KPITile label="On schedule" count={data.counts.onSchedule} tone="ON_SCHEDULE" />
              <KPITile label="At risk" count={data.counts.atRisk} tone="AT_RISK" />
              <KPITile label="Delayed" count={data.counts.delayed} tone="DELAYED" />
            </div>

            {/* Narrative — one line, builder voice */}
            <p className="text-xs text-fg-muted">
              {renderHeadlineNarrative(data.counts)} &middot; Updated{' '}
              {new Date(data.asOf).toLocaleTimeString('en-US', {
                hour: 'numeric',
                minute: '2-digit',
              })}
            </p>

            {/* Job grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {data.jobs.map((job) => (
                <JobCard key={job.jobId} job={job} />
              ))}
            </div>
          </div>
        )}
      </div>
    </Card>
  )
}

// Voice-aware one-liner. No oversell, no apology.
function renderHeadlineNarrative(c: StatusResponse['counts']): string {
  if (c.total === 0) return 'No active jobs.'
  if (c.delayed === 0 && c.atRisk === 0) {
    return c.total === 1 ? '1 job, all clear.' : `${c.total} jobs, all clear.`
  }
  if (c.delayed === 0 && c.atRisk > 0) {
    return `${c.onSchedule} on schedule. ${c.atRisk} covered by incoming.`
  }
  return `${c.onSchedule} on schedule. ${c.atRisk} covered. ${c.delayed} working.`
}
