'use client'

// ─────────────────────────────────────────────────────────────────────────────
// TodayDashboard — client component for /ops/today
//
// Receives the initial payload from the server page, then owns:
//   • KPI row (Today / Tomorrow / Red this week / Tasks due today)
//   • Today's Schedule section
//   • Tomorrow's Prep section (with red-materials warning banner)
//   • Overdue Actions section (with per-row Mark Done button)
//   • This Week's Closings (Hyphen)
//   • Refresh button + "updated Xs ago" timestamp
//
// Data fetch pattern mirrors the sibling Job-page flow (useEffect + fetch,
// no SWR) to keep the ops codebase consistent.
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import {
  KPICard,
  Badge,
  Button,
  StatusDot,
  EmptyState,
} from '@/components/ui'
import {
  Briefcase,
  CalendarClock,
  AlertTriangle,
  CheckSquare,
  RefreshCw,
  MapPin,
  ExternalLink,
  ArrowRight,
} from 'lucide-react'

// ── Types (must match /api/ops/pm/today response) ───────────────────────────

export type MaterialsStatus = 'GREEN' | 'AMBER' | 'RED' | 'NONE'

export interface TodayJob {
  id: string
  jobNumber: string
  community: string | null
  lotBlock: string | null
  jobAddress: string | null
  builderName: string
  status: string
  jobType: string | null
  scopeType: string
  scheduledDate: string | null
  materialsStatus: MaterialsStatus
  materialsBreakdown: {
    total: number
    picked: number
    consumed: number
    reserved: number
    backordered: number
    other: number
  }
}

export interface TodayTask {
  id: string
  title: string
  priority: string
  status: string
  category: string
  dueDate: string | null
  jobId: string | null
  jobNumber: string | null
  community: string | null
  builderName: string | null
}

export interface TodayClosing {
  jobId: string
  jobNumber: string
  builderName: string
  community: string | null
  closingDate: string
}

export interface TodayData {
  asOf: string
  staff: {
    id: string
    firstName: string
    lastName: string
    title: string | null
  } | null
  window: {
    timezone: string
    todayStart: string
    todayEnd: string
    tomorrowStart: string
    tomorrowEnd: string
    weekEnd: string
  }
  today: TodayJob[]
  tomorrow: TodayJob[]
  redJobsThisWeek: TodayJob[]
  overdueTasks: TodayTask[]
  closingsThisWeek: TodayClosing[]
}

// ── Small UI helpers ─────────────────────────────────────────────────────────

function jobTypeShort(jt: string | null): string {
  if (!jt) return ''
  const map: Record<string, string> = {
    TRIM_1: 'T1',
    TRIM_1_INSTALL: 'T1I',
    TRIM_2: 'T2',
    TRIM_2_INSTALL: 'T2I',
    DOORS: 'DR',
    DOOR_INSTALL: 'DRI',
    HARDWARE: 'HW',
    HARDWARE_INSTALL: 'HWI',
    FINAL_FRONT: 'FF',
    FINAL_FRONT_INSTALL: 'FFI',
    QC_WALK: 'QC',
    PUNCH: 'PL',
    WARRANTY: 'WR',
    CUSTOM: 'CU',
  }
  return map[jt] ?? jt
}

function materialsTone(
  m: MaterialsStatus
): 'success' | 'active' | 'alert' | 'offline' {
  switch (m) {
    case 'GREEN':
      return 'success'
    case 'AMBER':
      return 'active'
    case 'RED':
      return 'alert'
    default:
      return 'offline'
  }
}

function fmtTime(iso: string | null) {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZone: 'America/Chicago',
    })
  } catch {
    return '—'
  }
}

function fmtDate(iso: string | null) {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      timeZone: 'America/Chicago',
    })
  } catch {
    return '—'
  }
}

function relativeSeconds(asOf: string, now: number): string {
  const diffMs = now - Date.parse(asOf)
  if (!Number.isFinite(diffMs) || diffMs < 0) return 'just now'
  const s = Math.round(diffMs / 1000)
  if (s < 60) return `updated ${s}s ago`
  const m = Math.round(s / 60)
  if (m < 60) return `updated ${m}m ago`
  const h = Math.round(m / 60)
  return `updated ${h}h ago`
}

// ── Job row card ─────────────────────────────────────────────────────────────

function JobCard({ job }: { job: TodayJob }) {
  const typeCode = jobTypeShort(job.jobType)
  return (
    <Link
      href={`/ops/jobs/${job.id}`}
      className="block group"
    >
      <div
        className={[
          'rounded-lg border border-border bg-surface hover:border-border-strong',
          'transition-colors px-4 py-3 flex flex-col sm:flex-row sm:items-center',
          'gap-2 sm:gap-4',
        ].join(' ')}
      >
        {/* Left: time */}
        <div className="shrink-0 w-full sm:w-[72px] text-[13px] font-mono text-fg-muted">
          {fmtTime(job.scheduledDate)}
        </div>

        {/* Middle: chips + job meta */}
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[12px] text-fg font-semibold">
              {job.jobNumber}
            </span>
            {typeCode && (
              <Badge variant="brand" size="xs">
                {typeCode}
              </Badge>
            )}
            <Badge variant="neutral" size="xs">
              {job.status.replace(/_/g, ' ')}
            </Badge>
            <span className="inline-flex items-center gap-1.5">
              <StatusDot
                tone={materialsTone(job.materialsStatus)}
                size={8}
                label={`materials ${job.materialsStatus.toLowerCase()}`}
              />
              <span className="text-[11px] text-fg-subtle uppercase tracking-wider">
                {job.materialsStatus === 'NONE'
                  ? 'no alloc'
                  : job.materialsStatus.toLowerCase()}
              </span>
            </span>
          </div>
          <div className="mt-1 text-[13px] text-fg truncate">
            <span className="text-fg-muted">{job.builderName}</span>
            {job.community && (
              <>
                <span className="mx-1.5 text-fg-subtle">·</span>
                {job.community}
              </>
            )}
            {job.lotBlock && (
              <>
                <span className="mx-1.5 text-fg-subtle">·</span>
                <span className="text-fg-muted">{job.lotBlock}</span>
              </>
            )}
          </div>
          {job.jobAddress && (
            <div className="mt-0.5 flex items-center gap-1 text-[12px] text-fg-subtle truncate">
              <MapPin className="w-3 h-3" />
              <span className="truncate">{job.jobAddress}</span>
            </div>
          )}
        </div>

        {/* Right: open indicator */}
        <div className="shrink-0 text-fg-subtle group-hover:text-fg transition-colors">
          <ExternalLink className="w-4 h-4" />
        </div>
      </div>
    </Link>
  )
}

// ── Component ────────────────────────────────────────────────────────────────

export default function TodayDashboard({
  initial,
}: {
  initial: TodayData | null
}) {
  const [data, setData] = useState<TodayData | null>(initial)
  const [loading, setLoading] = useState<boolean>(!initial)
  const [error, setError] = useState<string | null>(null)
  const [completingTaskId, setCompletingTaskId] = useState<string | null>(null)
  const [dismissedTaskIds, setDismissedTaskIds] = useState<Set<string>>(
    new Set()
  )
  const [nowTick, setNowTick] = useState<number>(() => Date.now())

  // Re-tick every 15s so "updated Xs ago" stays fresh without refetching.
  useEffect(() => {
    const id = setInterval(() => setNowTick(Date.now()), 15_000)
    return () => clearInterval(id)
  }, [])

  const abortRef = useRef<AbortController | null>(null)

  const load = useCallback(async () => {
    abortRef.current?.abort()
    const ac = new AbortController()
    abortRef.current = ac
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/ops/pm/today', {
        cache: 'no-store',
        signal: ac.signal,
      })
      if (!res.ok) {
        const body = await res.text()
        throw new Error(`API ${res.status}: ${body.slice(0, 120)}`)
      }
      const json = (await res.json()) as TodayData
      setData(json)
    } catch (e: any) {
      if (e?.name === 'AbortError') return
      console.error('[PM Today] load failed', e)
      setError(e?.message ?? 'Failed to load.')
    } finally {
      setLoading(false)
    }
  }, [])

  // If server didn't manage to preload, pull on mount.
  useEffect(() => {
    if (!initial) void load()
  }, [initial, load])

  const markTaskDone = useCallback(
    async (taskId: string) => {
      setCompletingTaskId(taskId)
      try {
        // POST /api/ops/tasks/[id]/complete; optimistically dismiss client-side
        // even on transient failure so the PM can move on. The next refresh
        // will reconcile against server state.
        let serverOk = false
        try {
          const res = await fetch(
            `/api/ops/tasks/${encodeURIComponent(taskId)}/complete`,
            { method: 'POST' }
          )
          serverOk = res.ok
        } catch {
          serverOk = false
        }
        if (!serverOk) {
          console.info(
            `[PM Today] mark-done endpoint unavailable; dismissing task ${taskId} client-side only`
          )
        }
        setDismissedTaskIds((prev) => {
          const next = new Set(prev)
          next.add(taskId)
          return next
        })
      } finally {
        setCompletingTaskId(null)
      }
    },
    []
  )

  // ── Derived ──
  const kpis = useMemo(() => {
    const today = data?.today ?? []
    const tomorrow = data?.tomorrow ?? []
    const red = data?.redJobsThisWeek ?? []
    const overdue = data?.overdueTasks ?? []
    const visibleOverdue = overdue.filter((t) => !dismissedTaskIds.has(t.id))

    // "Tasks due today" = subset of overdue that is already past due today,
    // plus any tasks in overdue list whose dueDate is today (we don't have a
    // separate due-today list, but overdue includes everything < now() —
    // which is strictly "overdue", so expose that count as the KPI).
    return {
      todayCount: today.length,
      tomorrowCount: tomorrow.length,
      redCount: red.length,
      overdueCount: visibleOverdue.length,
    }
  }, [data, dismissedTaskIds])

  const visibleOverdueTasks = useMemo(
    () =>
      (data?.overdueTasks ?? []).filter((t) => !dismissedTaskIds.has(t.id)),
    [data, dismissedTaskIds]
  )

  const redInTomorrow = useMemo(
    () =>
      (data?.tomorrow ?? []).filter((j) => j.materialsStatus === 'RED').length,
    [data]
  )

  // ── Empty "no jobs at all" state ──
  const hasAnyJobs =
    (data?.today?.length ?? 0) > 0 ||
    (data?.tomorrow?.length ?? 0) > 0 ||
    (data?.redJobsThisWeek?.length ?? 0) > 0 ||
    (data?.closingsThisWeek?.length ?? 0) > 0 ||
    (data?.overdueTasks?.length ?? 0) > 0

  if (!loading && data && !hasAnyJobs) {
    return (
      <div className="space-y-4">
        <RefreshBar
          asOf={data.asOf}
          nowTick={nowTick}
          loading={loading}
          onRefresh={load}
        />
        <div className="glass-card">
          <EmptyState
            icon="inbox"
            title="No jobs assigned to you"
            description="You don't have any active jobs scheduled. If that's unexpected, check with your manager so today's book can be set up."
            size="full"
          />
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <RefreshBar
        asOf={data?.asOf}
        nowTick={nowTick}
        loading={loading}
        onRefresh={load}
      />

      {error && (
        <div className="rounded-lg border border-data-negative/40 bg-data-negative-bg text-data-negative-fg px-4 py-3 text-sm">
          Couldn't refresh: {error}
        </div>
      )}

      {/* KPI row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard
          title="Jobs Today"
          value={kpis.todayCount}
          accent="brand"
          icon={<Briefcase className="w-4 h-4" />}
          subtitle="scheduled for today"
        />
        <KPICard
          title="Jobs Tomorrow"
          value={kpis.tomorrowCount}
          accent="accent"
          icon={<CalendarClock className="w-4 h-4" />}
          subtitle="scheduled for tomorrow"
        />
        <KPICard
          title="Red Materials (7d)"
          value={kpis.redCount}
          accent={kpis.redCount === 0 ? 'positive' : 'negative'}
          icon={<AlertTriangle className="w-4 h-4" />}
          subtitle="jobs w/ backorders this week"
        />
        <KPICard
          title="Overdue Tasks"
          value={kpis.overdueCount}
          accent={kpis.overdueCount === 0 ? 'positive' : 'negative'}
          icon={<CheckSquare className="w-4 h-4" />}
          subtitle="past due, still open"
        />
      </div>

      {/* Today's Schedule */}
      <Section title="Today's Schedule" count={data?.today.length ?? 0}>
        {data && data.today.length > 0 ? (
          <div className="space-y-2">
            {data.today.map((j) => (
              <JobCard key={j.id} job={j} />
            ))}
          </div>
        ) : (
          <EmptyState
            icon="inbox"
            size="compact"
            title="Nothing scheduled for today"
            description="No jobs on your calendar for today."
          />
        )}
      </Section>

      {/* Tomorrow's Prep */}
      <Section title="Tomorrow's Prep" count={data?.tomorrow.length ?? 0}>
        {data && data.tomorrow.length > 0 ? (
          <>
            {redInTomorrow > 0 && (
              <div
                className={[
                  'mb-3 rounded-lg px-4 py-3 text-sm',
                  'border border-data-negative/40 bg-data-negative-bg text-data-negative-fg',
                  'flex items-center gap-2',
                ].join(' ')}
                role="alert"
              >
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>
                  <strong>{redInTomorrow}</strong> of{' '}
                  <strong>{data.tomorrow.length}</strong> tomorrow jobs have
                  red materials — act now.
                </span>
              </div>
            )}
            <div className="space-y-2">
              {data.tomorrow.map((j) => (
                <JobCard key={j.id} job={j} />
              ))}
            </div>
          </>
        ) : (
          <EmptyState
            icon="inbox"
            size="compact"
            title="Nothing scheduled for tomorrow"
            description="A clear calendar — good time to catch up on this week's prep."
          />
        )}
      </Section>

      {/* Overdue Actions */}
      <Section
        title="Overdue Actions"
        count={visibleOverdueTasks.length}
        tone={visibleOverdueTasks.length > 0 ? 'alert' : undefined}
      >
        {visibleOverdueTasks.length > 0 ? (
          <div className="divide-y divide-border rounded-lg border border-border bg-surface">
            {visibleOverdueTasks.map((t) => (
              <div
                key={t.id}
                className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 px-4 py-3"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="danger" size="xs">
                      {t.priority}
                    </Badge>
                    <Badge variant="neutral" size="xs">
                      {t.category.replace(/_/g, ' ')}
                    </Badge>
                    <span className="text-[12px] text-data-negative font-mono">
                      due {fmtDate(t.dueDate)}
                    </span>
                  </div>
                  <div className="mt-1 text-[13px] text-fg truncate">
                    {t.title}
                  </div>
                  <div className="text-[12px] text-fg-muted truncate">
                    {t.jobNumber ? (
                      <Link
                        href={`/ops/jobs/${t.jobId}`}
                        className="underline hover:text-fg"
                      >
                        {t.jobNumber}
                      </Link>
                    ) : (
                      <span className="text-fg-subtle">no job linked</span>
                    )}
                    {t.builderName && (
                      <>
                        <span className="mx-1.5 text-fg-subtle">·</span>
                        {t.builderName}
                      </>
                    )}
                    {t.community && (
                      <>
                        <span className="mx-1.5 text-fg-subtle">·</span>
                        {t.community}
                      </>
                    )}
                  </div>
                </div>
                <div className="shrink-0">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => markTaskDone(t.id)}
                    disabled={completingTaskId === t.id}
                  >
                    {completingTaskId === t.id ? 'Marking…' : 'Mark Done'}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState
            icon="sparkles"
            size="compact"
            title="No overdue tasks"
            description="You're caught up. Good."
          />
        )}
      </Section>

      {/* This week's closings */}
      {(data?.closingsThisWeek?.length ?? 0) > 0 && (
        <Section
          title="This Week's Closings"
          count={data?.closingsThisWeek.length ?? 0}
        >
          <div className="divide-y divide-border rounded-lg border border-border bg-surface">
            {data!.closingsThisWeek.map((c) => (
              <Link
                key={c.jobId}
                href={`/ops/jobs/${c.jobId}`}
                className="flex items-center gap-4 px-4 py-2.5 hover:bg-surface-muted transition-colors"
              >
                <div className="shrink-0 w-[72px] text-[13px] font-mono text-fg-muted">
                  {fmtDate(c.closingDate)}
                </div>
                <div className="flex-1 min-w-0 text-[13px]">
                  <span className="font-mono text-[12px] text-fg font-semibold">
                    {c.jobNumber}
                  </span>
                  <span className="mx-1.5 text-fg-subtle">·</span>
                  <span className="text-fg-muted">{c.builderName}</span>
                  {c.community && (
                    <>
                      <span className="mx-1.5 text-fg-subtle">·</span>
                      {c.community}
                    </>
                  )}
                </div>
                <ArrowRight className="w-4 h-4 text-fg-subtle shrink-0" />
              </Link>
            ))}
          </div>
        </Section>
      )}

      {/* Footer — data source link for debugging */}
      <div className="text-xs text-fg-subtle">
        Data source:{' '}
        <Link href="/api/ops/pm/today" className="underline hover:text-fg">
          /api/ops/pm/today
        </Link>
      </div>
    </div>
  )
}

// ── Section wrapper ──────────────────────────────────────────────────────────

function Section({
  title,
  count,
  tone,
  children,
}: {
  title: string
  count?: number
  tone?: 'alert'
  children: React.ReactNode
}) {
  return (
    <section>
      <div className="flex items-center justify-between mb-2">
        <h2
          className={[
            'text-sm font-semibold uppercase tracking-wider',
            tone === 'alert' ? 'text-data-negative' : 'text-fg',
          ].join(' ')}
        >
          {title}
          {typeof count === 'number' && (
            <span className="ml-2 text-fg-subtle font-normal normal-case tracking-normal">
              ({count})
            </span>
          )}
        </h2>
      </div>
      {children}
    </section>
  )
}

// ── Refresh bar ──────────────────────────────────────────────────────────────

function RefreshBar({
  asOf,
  nowTick,
  loading,
  onRefresh,
}: {
  asOf: string | undefined
  nowTick: number
  loading: boolean
  onRefresh: () => void | Promise<void>
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs text-fg-subtle">
        {asOf ? relativeSeconds(asOf, nowTick) : loading ? 'loading…' : '—'}
      </span>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => {
          void onRefresh()
        }}
        disabled={loading}
        icon={
          <RefreshCw
            className={['w-3.5 h-3.5', loading ? 'animate-spin' : ''].join(' ')}
          />
        }
      >
        {loading ? 'Refreshing' : 'Refresh'}
      </Button>
    </div>
  )
}
