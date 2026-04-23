'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  PageHeader,
  Button,
  KPICard,
  Card,
  EmptyState,
  Sheet,
  StatusDot,
  Kbd,
  Avatar,
  Badge,
} from '@/components/ui'
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon, RefreshCw, ExternalLink, Search } from 'lucide-react'

// ──────────────────────────────────────────────────────────────────────────
// Material Calendar — weekly/monthly grid of upcoming job delivery dates,
// each card color-coded by material allocation health. Click → drill into
// BoM vs allocated vs incoming PO vs shortfall in a side drawer.
// ──────────────────────────────────────────────────────────────────────────

type MaterialStatus = 'GREEN' | 'AMBER' | 'RED' | 'UNKNOWN'
type ViewMode = 'day' | 'week' | 'month'
type RowStatus = 'GREEN' | 'AMBER' | 'RED'

interface CalendarJob {
  jobId: string
  jobNumber: string
  jobAddress: string | null
  builderName: string
  communityName: string | null
  assignedPMName: string | null
  assignedPMId: string | null
  scheduledDate: string
  jobStatus: string
  scopeType: string
  materialStatus: MaterialStatus
  shortfallSummary: {
    shortCount: number
    criticalCount: number
    amberCount: number
  }
  bwpPoNumber: string | null
  hyphenJobId: string | null
}

interface CalendarResponse {
  asOf: string
  windowStart: string
  windowEnd: string
  view: ViewMode
  counts: {
    total: number
    green: number
    amber: number
    red: number
    unknown: number
  }
  jobs: CalendarJob[]
}

interface IncomingPo {
  poNumber: string
  vendor: string
  expectedDate: string
  qty: number
}

interface DrillRow {
  productId: string
  sku: string | null
  productName: string | null
  category: string | null
  required: number
  allocated: number
  onHand: number
  committedElsewhere: number
  incomingPos: IncomingPo[]
  shortfall: number
  status: RowStatus
}

interface JobDrillResponse {
  asOf: string
  job: {
    id: string
    jobNumber: string
    jobAddress: string | null
    builderName: string
    communityName: string | null
    assignedPMName: string | null
    scheduledDate: string | null
    jobStatus: string
    scopeType: string
    bwpPoNumber: string | null
    hyphenJobId: string | null
    hyphenDeepLink: string | null
  }
  summary: {
    totalRows: number
    greenCount: number
    amberCount: number
    redCount: number
  }
  rows: DrillRow[]
}

// ── Date helpers ──────────────────────────────────────────────────────────

function toYmd(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
}

function startOfWeek(d: Date): Date {
  const out = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
  const dow = out.getUTCDay() // 0=Sun ... 6=Sat
  const daysFromMonday = dow === 0 ? 6 : dow - 1
  out.setUTCDate(out.getUTCDate() - daysFromMonday)
  return out
}

function addDays(d: Date, n: number): Date {
  const out = new Date(d)
  out.setUTCDate(out.getUTCDate() + n)
  return out
}

function startOfMonth(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1))
}

function endOfMonth(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0))
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getUTCFullYear() === b.getUTCFullYear() &&
    a.getUTCMonth() === b.getUTCMonth() &&
    a.getUTCDate() === b.getUTCDate()
  )
}

function fmtDay(d: Date): string {
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })
}

function fmtDayShort(d: Date): string {
  return d.toLocaleDateString(undefined, { weekday: 'short', timeZone: 'UTC' })
}

function fmtDayNumOnly(d: Date): string {
  return String(d.getUTCDate())
}

// ── Status colors ─────────────────────────────────────────────────────────

type DotTone = 'active' | 'success' | 'alert' | 'info' | 'offline' | 'live'

const STATUS_COLORS: Record<MaterialStatus, { border: string; bg: string; dot: DotTone; label: string }> = {
  GREEN:   { border: '#10b981', bg: 'rgba(16,185,129,0.08)',   dot: 'success', label: 'On track' },
  AMBER:   { border: '#F59E0B', bg: 'rgba(245,158,11,0.10)',   dot: 'active',  label: 'PO incoming' },
  RED:     { border: '#EF4444', bg: 'rgba(239,68,68,0.10)',    dot: 'alert',   label: 'Short' },
  UNKNOWN: { border: '#6b7280', bg: 'rgba(107,114,128,0.08)',  dot: 'offline', label: 'Pending' },
}

// ──────────────────────────────────────────────────────────────────────────

export default function MaterialCalendarPage() {
  const [view, setView] = useState<ViewMode>('week')
  const [anchorDate, setAnchorDate] = useState<Date>(() => {
    const now = new Date()
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  })
  const [data, setData] = useState<CalendarResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [lastFetched, setLastFetched] = useState<Date | null>(null)

  // Filter state
  const [builderFilter, setBuilderFilter] = useState<Set<string>>(new Set())
  const [pmFilter, setPmFilter] = useState<Set<string>>(new Set())
  const [statusFilter, setStatusFilter] = useState<Set<MaterialStatus>>(new Set())
  const [searchQuery, setSearchQuery] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)

  // Drill state
  const [drillJobId, setDrillJobId] = useState<string | null>(null)
  const [drillData, setDrillData] = useState<JobDrillResponse | null>(null)
  const [drillLoading, setDrillLoading] = useState(false)

  // ── Range compute ───────────────────────────────────────────────────────
  const [rangeStart, rangeEnd] = useMemo(() => {
    if (view === 'day') {
      return [anchorDate, anchorDate]
    }
    if (view === 'week') {
      const s = startOfWeek(anchorDate)
      return [s, addDays(s, 6)]
    }
    // month — include neighbor-week padding so the grid is rectangular
    const monthStart = startOfMonth(anchorDate)
    const monthEnd = endOfMonth(anchorDate)
    return [startOfWeek(monthStart), addDays(startOfWeek(monthEnd), 6)]
  }, [view, anchorDate])

  // ── Fetch calendar data ─────────────────────────────────────────────────
  const fetchCalendar = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({
        start: toYmd(rangeStart),
        end: toYmd(rangeEnd),
        view,
      })
      const res = await fetch(`/api/ops/material-calendar?${params.toString()}`, {
        cache: 'no-store',
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || `HTTP ${res.status}`)
      }
      const json: CalendarResponse = await res.json()
      setData(json)
      setLastFetched(new Date())
    } catch (err: any) {
      setError(err?.message ?? 'Failed to load calendar')
    } finally {
      setLoading(false)
    }
  }, [rangeStart, rangeEnd, view])

  useEffect(() => {
    fetchCalendar()
  }, [fetchCalendar])

  // Polling every 60s
  useEffect(() => {
    const id = setInterval(() => {
      fetchCalendar()
    }, 60_000)
    return () => clearInterval(id)
  }, [fetchCalendar])

  // ── Fetch drill-down on click ──────────────────────────────────────────
  useEffect(() => {
    if (!drillJobId) {
      setDrillData(null)
      return
    }
    let cancelled = false
    setDrillLoading(true)
    ;(async () => {
      try {
        const res = await fetch(`/api/ops/material-calendar/job/${drillJobId}`, {
          cache: 'no-store',
        })
        const json: JobDrillResponse = await res.json()
        if (!cancelled) setDrillData(json)
      } catch (err) {
        if (!cancelled) setDrillData(null)
      } finally {
        if (!cancelled) setDrillLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [drillJobId])

  // ── Keyboard shortcuts ─────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Don't intercept when typing in an input/textarea
      const target = e.target as HTMLElement
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        if (e.key === 'Escape') {
          (target as HTMLInputElement).blur()
        }
        return
      }
      if (e.key === 't' || e.key === 'T') {
        setAnchorDate(() => {
          const now = new Date()
          return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
        })
      } else if (e.key === 'd' || e.key === 'D') {
        setView('day')
      } else if (e.key === 'w' || e.key === 'W') {
        setView('week')
      } else if (e.key === 'm' || e.key === 'M') {
        setView('month')
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        navigatePrev()
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        navigateNext()
      } else if (e.key === '/') {
        e.preventDefault()
        searchRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view])

  const navigatePrev = useCallback(() => {
    setAnchorDate(d => {
      if (view === 'day') return addDays(d, -1)
      if (view === 'week') return addDays(d, -7)
      // month — jump to first of previous month
      return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1))
    })
  }, [view])

  const navigateNext = useCallback(() => {
    setAnchorDate(d => {
      if (view === 'day') return addDays(d, 1)
      if (view === 'week') return addDays(d, 7)
      return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1))
    })
  }, [view])

  // ── Apply filters ─────────────────────────────────────────────────────
  const filteredJobs = useMemo(() => {
    if (!data) return []
    return data.jobs.filter(j => {
      if (builderFilter.size > 0 && !builderFilter.has(j.builderName)) return false
      if (pmFilter.size > 0 && (!j.assignedPMId || !pmFilter.has(j.assignedPMId))) return false
      if (statusFilter.size > 0 && !statusFilter.has(j.materialStatus)) return false
      if (searchQuery.trim()) {
        const q = searchQuery.trim().toLowerCase()
        const hay = `${j.jobNumber} ${j.jobAddress ?? ''} ${j.builderName} ${j.communityName ?? ''} ${j.bwpPoNumber ?? ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [data, builderFilter, pmFilter, statusFilter, searchQuery])

  // Unique builders / PMs for filter UI
  const uniqueBuilders = useMemo(() => {
    if (!data) return []
    return Array.from(new Set(data.jobs.map(j => j.builderName))).sort()
  }, [data])

  const uniquePMs = useMemo(() => {
    if (!data) return []
    const seen = new Map<string, string>()
    for (const j of data.jobs) {
      if (j.assignedPMId && j.assignedPMName) seen.set(j.assignedPMId, j.assignedPMName)
    }
    return Array.from(seen.entries()).map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name))
  }, [data])

  // Bucket filtered jobs by day for grid rendering
  const jobsByDay = useMemo(() => {
    const map = new Map<string, CalendarJob[]>()
    for (const j of filteredJobs) {
      const key = toYmd(new Date(j.scheduledDate))
      let arr = map.get(key)
      if (!arr) {
        arr = []
        map.set(key, arr)
      }
      arr.push(j)
    }
    return map
  }, [filteredJobs])

  // Status counts for the visible filtered set
  const visibleCounts = useMemo(() => {
    return {
      total: filteredJobs.length,
      green: filteredJobs.filter(j => j.materialStatus === 'GREEN').length,
      amber: filteredJobs.filter(j => j.materialStatus === 'AMBER').length,
      red: filteredJobs.filter(j => j.materialStatus === 'RED').length,
      unknown: filteredJobs.filter(j => j.materialStatus === 'UNKNOWN').length,
    }
  }, [filteredJobs])

  // ── Render helpers ─────────────────────────────────────────────────────
  const rangeLabel = useMemo(() => {
    if (view === 'day') return fmtDay(anchorDate)
    if (view === 'week') return `${fmtDay(rangeStart)} — ${fmtDay(rangeEnd)}`
    return anchorDate.toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' })
  }, [view, anchorDate, rangeStart, rangeEnd])

  return (
    <div className="space-y-5 px-5 py-5 md:px-8 md:py-6">
      <PageHeader
        eyebrow="MRP"
        title="Material Calendar"
        description="Upcoming job delivery dates, color-coded by material readiness."
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={fetchCalendar}
              icon={<RefreshCw className="w-3.5 h-3.5" />}
              disabled={loading}
            >
              {loading ? 'Refreshing…' : 'Refresh'}
            </Button>
          </div>
        }
      />

      {/* Top counters */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <KPICard
          title="In view"
          value={visibleCounts.total}
          accent="neutral"
          subtitle={rangeLabel}
        />
        <KPICard
          title="On track"
          value={visibleCounts.green}
          accent="positive"
          subtitle="Fully allocated"
        />
        <KPICard
          title="PO incoming"
          value={visibleCounts.amber}
          accent="accent"
          subtitle="Short, covered"
        />
        <KPICard
          title="Short"
          value={visibleCounts.red}
          accent="negative"
          subtitle="No covering PO"
        />
        <KPICard
          title="Unknown"
          value={visibleCounts.unknown}
          accent="neutral"
          subtitle="Awaiting ATP"
        />
      </div>

      {/* Controls bar */}
      <div className="flex flex-wrap items-center gap-2 justify-between">
        <div className="flex items-center gap-2">
          <div className="inline-flex items-center rounded-md border border-border bg-surface-muted/40 p-0.5">
            {(['day', 'week', 'month'] as ViewMode[]).map(v => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={`px-2.5 h-7 rounded text-[12px] font-medium capitalize transition-colors ${
                  view === v
                    ? 'bg-surface-elevated text-fg shadow-sm'
                    : 'text-fg-muted hover:text-fg'
                }`}
                title={`${v} view (${v[0]})`}
              >
                {v} <Kbd className="ml-1">{v[0].toUpperCase()}</Kbd>
              </button>
            ))}
          </div>

          <div className="inline-flex items-center gap-1 ml-2">
            <Button
              variant="ghost"
              size="sm"
              iconOnly
              onClick={navigatePrev}
              aria-label="Previous"
              icon={<ChevronLeft className="w-4 h-4" />}
            />
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setAnchorDate(() => {
                const now = new Date()
                return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
              })}
              icon={<CalendarIcon className="w-3.5 h-3.5" />}
            >
              Today <Kbd className="ml-1">T</Kbd>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              iconOnly
              onClick={navigateNext}
              aria-label="Next"
              icon={<ChevronRight className="w-4 h-4" />}
            />
          </div>

          <div className="text-[13px] font-medium text-fg ml-2 tabular-nums">
            {rangeLabel}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-fg-subtle pointer-events-none" />
            <input
              ref={searchRef}
              type="text"
              placeholder="Search job / address / PO…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-8 w-[260px] pl-7 pr-2 text-[12px] rounded-md border border-border bg-surface-muted/30 text-fg placeholder:text-fg-subtle focus:outline-none focus:ring-1 focus:ring-[var(--signal,#b48a3a)]"
            />
            <Kbd className="absolute right-2 top-1/2 -translate-y-1/2">/</Kbd>
          </div>

          {lastFetched && (
            <div className="text-[10.5px] font-mono tabular-nums text-fg-subtle">
              Updated {lastFetched.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </div>
          )}
        </div>
      </div>

      {/* Content area: sidebar filters + grid */}
      <div className="grid grid-cols-12 gap-4">
        <aside className="col-span-12 md:col-span-3 lg:col-span-2 space-y-3">
          <FilterGroup title="Status">
            {(['GREEN', 'AMBER', 'RED', 'UNKNOWN'] as MaterialStatus[]).map(s => (
              <FilterChip
                key={s}
                active={statusFilter.has(s)}
                onClick={() => toggle(statusFilter, s, setStatusFilter)}
              >
                <StatusDot tone={STATUS_COLORS[s].dot} />
                <span className="capitalize">{STATUS_COLORS[s].label}</span>
                <span className="ml-auto text-fg-subtle font-mono tabular-nums text-[10.5px]">
                  {data?.counts?.[s.toLowerCase() as keyof typeof data.counts] ?? 0}
                </span>
              </FilterChip>
            ))}
          </FilterGroup>

          {uniqueBuilders.length > 0 && (
            <FilterGroup title="Builder">
              {uniqueBuilders.slice(0, 12).map(b => (
                <FilterChip
                  key={b}
                  active={builderFilter.has(b)}
                  onClick={() => toggle(builderFilter, b, setBuilderFilter)}
                >
                  <span className="truncate">{b}</span>
                </FilterChip>
              ))}
            </FilterGroup>
          )}

          {uniquePMs.length > 0 && (
            <FilterGroup title="Project Manager">
              {uniquePMs.map(pm => (
                <FilterChip
                  key={pm.id}
                  active={pmFilter.has(pm.id)}
                  onClick={() => toggle(pmFilter, pm.id, setPmFilter)}
                >
                  <Avatar size="sm" name={pm.name} id={pm.id} />
                  <span className="truncate">{pm.name}</span>
                </FilterChip>
              ))}
            </FilterGroup>
          )}

          {(builderFilter.size + pmFilter.size + statusFilter.size + (searchQuery ? 1 : 0)) > 0 && (
            <Button
              variant="ghost"
              size="xs"
              fullWidth
              onClick={() => {
                setBuilderFilter(new Set())
                setPmFilter(new Set())
                setStatusFilter(new Set())
                setSearchQuery('')
              }}
            >
              Clear filters
            </Button>
          )}
        </aside>

        <main className="col-span-12 md:col-span-9 lg:col-span-10">
          {error && (
            <Card className="p-4 border-[var(--data-negative,#EF4444)]/40">
              <div className="text-[12.5px] text-[var(--data-negative,#EF4444)]">
                Error loading calendar: {error}
              </div>
            </Card>
          )}

          {loading && !data ? (
            <Card className="p-8">
              <div className="text-[13px] text-fg-muted">Loading calendar…</div>
            </Card>
          ) : filteredJobs.length === 0 && !loading ? (
            <Card className="p-0 overflow-hidden">
              <EmptyState
                title="No jobs in this window"
                description={data?.jobs?.length ? 'All jobs filtered out — adjust filters.' : 'Nothing scheduled.'}
              />
            </Card>
          ) : view === 'week' ? (
            <WeekView
              rangeStart={rangeStart}
              jobsByDay={jobsByDay}
              onJobClick={setDrillJobId}
            />
          ) : view === 'day' ? (
            <DayView
              date={anchorDate}
              jobs={jobsByDay.get(toYmd(anchorDate)) ?? []}
              onJobClick={setDrillJobId}
            />
          ) : (
            <MonthView
              rangeStart={rangeStart}
              rangeEnd={rangeEnd}
              anchorDate={anchorDate}
              jobsByDay={jobsByDay}
              onJobClick={setDrillJobId}
            />
          )}
        </main>
      </div>

      {/* Drawer */}
      <Sheet
        open={!!drillJobId}
        onClose={() => setDrillJobId(null)}
        width="wide"
        title={drillData ? `${drillData.job.jobNumber} — ${drillData.job.builderName}` : 'Loading…'}
        subtitle={drillData ? drillData.job.jobAddress ?? undefined : undefined}
        tabs={['details']}
        footer={
          drillData?.job?.hyphenDeepLink ? (
            <a
              href={drillData.job.hyphenDeepLink}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-[12.5px] text-[var(--signal,#b48a3a)] hover:underline"
            >
              Open in Hyphen <ExternalLink className="w-3 h-3" />
            </a>
          ) : undefined
        }
      >
        <DrillContent data={drillData} loading={drillLoading} />
      </Sheet>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────────
// Sub-components
// ──────────────────────────────────────────────────────────────────────────

function toggle<T>(set: Set<T>, item: T, setter: (s: Set<T>) => void) {
  const next = new Set(set)
  if (next.has(item)) next.delete(item)
  else next.add(item)
  setter(next)
}

function FilterGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="eyebrow mb-1.5">{title}</div>
      <div className="space-y-0.5">{children}</div>
    </div>
  )
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-2 px-2 h-7 rounded text-[12px] text-left transition-colors ${
        active
          ? 'bg-surface-elevated text-fg ring-1 ring-[var(--signal,#b48a3a)]/40'
          : 'text-fg-muted hover:bg-surface-muted hover:text-fg'
      }`}
    >
      {children}
    </button>
  )
}

function JobCard({ job, onClick, compact = false }: { job: CalendarJob; onClick: () => void; compact?: boolean }) {
  const cfg = STATUS_COLORS[job.materialStatus]
  return (
    <button
      onClick={onClick}
      className="w-full text-left rounded-md border border-border bg-surface-elevated hover:shadow-md transition-all overflow-hidden group"
      style={{ borderLeft: `3px solid ${cfg.border}` }}
      title={`${job.jobNumber} • ${job.materialStatus}`}
    >
      <div
        className={compact ? 'px-2 py-1.5' : 'px-2.5 py-2'}
        style={{ background: cfg.bg }}
      >
        <div className="flex items-center gap-1.5 min-w-0">
          <StatusDot tone={cfg.dot} />
          <span className="font-mono text-[11px] tabular-nums text-fg truncate">
            {job.jobNumber}
          </span>
        </div>
        {!compact && (
          <>
            <div className="text-[11.5px] text-fg mt-0.5 truncate">
              {job.jobAddress || job.communityName || '—'}
            </div>
            <div className="flex items-center gap-1.5 mt-1">
              <span className="text-[10px] text-fg-muted truncate flex-1">
                {job.builderName}
              </span>
              {job.assignedPMName && (
                <Avatar size="sm" name={job.assignedPMName} id={job.assignedPMId ?? job.jobId} />
              )}
            </div>
            {job.shortfallSummary.shortCount > 0 && (
              <div className="mt-1 text-[10px] tabular-nums font-mono flex items-center gap-1">
                <span style={{ color: cfg.border }}>
                  {job.shortfallSummary.criticalCount > 0 && `${job.shortfallSummary.criticalCount} short`}
                  {job.shortfallSummary.criticalCount > 0 && job.shortfallSummary.amberCount > 0 && ' — '}
                  {job.shortfallSummary.amberCount > 0 && `${job.shortfallSummary.amberCount} incoming`}
                </span>
              </div>
            )}
          </>
        )}
      </div>
    </button>
  )
}

function WeekView({
  rangeStart,
  jobsByDay,
  onJobClick,
}: {
  rangeStart: Date
  jobsByDay: Map<string, CalendarJob[]>
  onJobClick: (id: string) => void
}) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(rangeStart, i))
  const today = new Date()
  return (
    <div className="grid grid-cols-7 gap-2">
      {days.map(d => {
        const key = toYmd(d)
        const jobs = jobsByDay.get(key) ?? []
        const isToday = sameDay(d, today)
        return (
          <div
            key={key}
            className={`rounded-md border bg-surface-muted/20 min-h-[400px] flex flex-col ${
              isToday ? 'border-[var(--signal,#b48a3a)]' : 'border-border'
            }`}
          >
            <div className={`px-2.5 py-1.5 border-b border-border flex items-center justify-between ${isToday ? 'bg-[var(--signal,#b48a3a)]/10' : ''}`}>
              <span className="text-[11px] font-medium text-fg-muted">
                {fmtDayShort(d)}
              </span>
              <span className="font-mono tabular-nums text-[13px] text-fg">
                {fmtDayNumOnly(d)}
              </span>
            </div>
            <div className="p-1.5 space-y-1.5 flex-1">
              {jobs.length === 0 ? (
                <div className="text-[10.5px] text-fg-subtle italic py-2 text-center">—</div>
              ) : (
                jobs.map(j => (
                  <JobCard key={j.jobId} job={j} onClick={() => onJobClick(j.jobId)} />
                ))
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function DayView({
  date,
  jobs,
  onJobClick,
}: {
  date: Date
  jobs: CalendarJob[]
  onJobClick: (id: string) => void
}) {
  return (
    <Card className="p-3">
      <div className="mb-3 text-[13px] font-medium text-fg">
        {fmtDay(date)} — <span className="font-mono tabular-nums text-fg-muted">{jobs.length} jobs</span>
      </div>
      {jobs.length === 0 ? (
        <div className="py-8 text-center text-[13px] text-fg-muted">No jobs scheduled.</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
          {jobs.map(j => (
            <JobCard key={j.jobId} job={j} onClick={() => onJobClick(j.jobId)} />
          ))}
        </div>
      )}
    </Card>
  )
}

function MonthView({
  rangeStart,
  rangeEnd,
  anchorDate,
  jobsByDay,
  onJobClick,
}: {
  rangeStart: Date
  rangeEnd: Date
  anchorDate: Date
  jobsByDay: Map<string, CalendarJob[]>
  onJobClick: (id: string) => void
}) {
  const dayCount = Math.round((rangeEnd.getTime() - rangeStart.getTime()) / (24 * 60 * 60 * 1000)) + 1
  const days = Array.from({ length: dayCount }, (_, i) => addDays(rangeStart, i))
  const today = new Date()
  const activeMonth = anchorDate.getUTCMonth()

  return (
    <div>
      <div className="grid grid-cols-7 gap-1 mb-1">
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => (
          <div key={d} className="text-center text-[10.5px] font-medium text-fg-subtle uppercase tracking-wide">
            {d}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {days.map(d => {
          const key = toYmd(d)
          const jobs = jobsByDay.get(key) ?? []
          const inMonth = d.getUTCMonth() === activeMonth
          const isToday = sameDay(d, today)
          const greenN = jobs.filter(j => j.materialStatus === 'GREEN').length
          const amberN = jobs.filter(j => j.materialStatus === 'AMBER').length
          const redN = jobs.filter(j => j.materialStatus === 'RED').length
          const unkN = jobs.filter(j => j.materialStatus === 'UNKNOWN').length
          return (
            <div
              key={key}
              className={`rounded border min-h-[98px] flex flex-col ${
                inMonth ? 'border-border bg-surface-muted/20' : 'border-border/40 bg-transparent opacity-60'
              } ${isToday ? 'ring-1 ring-[var(--signal,#b48a3a)]' : ''}`}
            >
              <div className="px-1.5 py-0.5 flex items-center justify-between">
                <span className={`font-mono tabular-nums text-[11px] ${inMonth ? 'text-fg' : 'text-fg-subtle'}`}>
                  {fmtDayNumOnly(d)}
                </span>
                {jobs.length > 0 && (
                  <span className="text-[10px] font-mono tabular-nums text-fg-muted">
                    {jobs.length}
                  </span>
                )}
              </div>
              <div className="px-1 pb-1 space-y-0.5 flex-1 overflow-hidden">
                {jobs.slice(0, 3).map(j => (
                  <JobCard key={j.jobId} job={j} onClick={() => onJobClick(j.jobId)} compact />
                ))}
                {jobs.length > 3 && (
                  <div className="text-[10px] text-fg-muted text-center">
                    +{jobs.length - 3} more
                  </div>
                )}
                {jobs.length > 0 && (
                  <div className="flex items-center gap-1 pt-0.5 text-[9px] font-mono tabular-nums">
                    {redN > 0 && <span style={{ color: STATUS_COLORS.RED.border }}>●{redN}</span>}
                    {amberN > 0 && <span style={{ color: STATUS_COLORS.AMBER.border }}>●{amberN}</span>}
                    {greenN > 0 && <span style={{ color: STATUS_COLORS.GREEN.border }}>●{greenN}</span>}
                    {unkN > 0 && <span style={{ color: STATUS_COLORS.UNKNOWN.border }}>●{unkN}</span>}
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Drill content ─────────────────────────────────────────────────────────

function DrillContent({ data, loading }: { data: JobDrillResponse | null; loading: boolean }) {
  if (loading && !data) {
    return <div className="text-[13px] text-fg-muted">Loading BoM…</div>
  }
  if (!data) {
    return <div className="text-[13px] text-fg-muted">No data.</div>
  }

  const { job, summary, rows } = data

  return (
    <div className="space-y-4">
      {/* Header row */}
      <div className="grid grid-cols-2 gap-2 text-[12px]">
        <Field label="Community" value={job.communityName ?? '—'} />
        <Field label="PM" value={job.assignedPMName ?? '—'} />
        <Field
          label="Scheduled"
          value={
            job.scheduledDate
              ? new Date(job.scheduledDate).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
              : '—'
          }
        />
        <Field label="Status" value={job.jobStatus} />
        <Field label="Scope" value={job.scopeType} />
        <Field label="Builder PO" value={job.bwpPoNumber ?? '—'} />
      </div>

      {/* Summary chips */}
      <div className="flex items-center gap-2 text-[11px] font-mono tabular-nums">
        <Badge variant="neutral">
          {summary.totalRows} rows
        </Badge>
        {summary.redCount > 0 && (
          <Badge style={{ background: STATUS_COLORS.RED.bg, color: STATUS_COLORS.RED.border, borderColor: STATUS_COLORS.RED.border }}>
            {summary.redCount} RED
          </Badge>
        )}
        {summary.amberCount > 0 && (
          <Badge style={{ background: STATUS_COLORS.AMBER.bg, color: STATUS_COLORS.AMBER.border, borderColor: STATUS_COLORS.AMBER.border }}>
            {summary.amberCount} AMBER
          </Badge>
        )}
        {summary.greenCount > 0 && (
          <Badge style={{ background: STATUS_COLORS.GREEN.bg, color: STATUS_COLORS.GREEN.border, borderColor: STATUS_COLORS.GREEN.border }}>
            {summary.greenCount} GREEN
          </Badge>
        )}
      </div>

      {/* BoM table */}
      {rows.length === 0 ? (
        <div className="text-[13px] text-fg-muted italic">No BoM requirements found for this job.</div>
      ) : (
        <div className="border border-border rounded-md overflow-hidden">
          <table className="w-full text-[11.5px]">
            <thead>
              <tr className="bg-surface-muted/40 text-fg-muted text-[10.5px] uppercase tracking-wide">
                <th className="text-left px-2 py-1.5 font-medium">SKU</th>
                <th className="text-left px-2 py-1.5 font-medium">Product</th>
                <th className="text-right px-2 py-1.5 font-medium">Req</th>
                <th className="text-right px-2 py-1.5 font-medium">Alloc</th>
                <th className="text-right px-2 py-1.5 font-medium">On Hand</th>
                <th className="text-left px-2 py-1.5 font-medium">Incoming</th>
                <th className="text-right px-2 py-1.5 font-medium">Short</th>
                <th className="text-left px-2 py-1.5 font-medium w-[72px]">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => {
                const cfg = STATUS_COLORS[r.status]
                return (
                  <tr key={r.productId} className="border-t border-border hover:bg-surface-muted/20" style={{ background: r.status === 'RED' ? cfg.bg : r.status === 'AMBER' ? cfg.bg : undefined }}>
                    <td className="px-2 py-1.5 font-mono text-[11px] text-fg">{r.sku ?? '—'}</td>
                    <td className="px-2 py-1.5 text-fg truncate max-w-[200px]" title={r.productName ?? undefined}>
                      {r.productName ?? '—'}
                    </td>
                    <td className="px-2 py-1.5 text-right font-mono tabular-nums text-fg">{r.required}</td>
                    <td className="px-2 py-1.5 text-right font-mono tabular-nums text-fg">{r.allocated}</td>
                    <td className="px-2 py-1.5 text-right font-mono tabular-nums text-fg-muted">{r.onHand}</td>
                    <td className="px-2 py-1.5">
                      {r.incomingPos.length === 0 ? (
                        <span className="text-fg-subtle">—</span>
                      ) : (
                        <div className="flex flex-col gap-0.5">
                          {r.incomingPos.slice(0, 2).map((po, i) => (
                            <span key={i} className="font-mono text-[10.5px] tabular-nums text-fg-muted">
                              {po.poNumber} • {po.qty}u • {new Date(po.expectedDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                            </span>
                          ))}
                          {r.incomingPos.length > 2 && (
                            <span className="text-[10px] text-fg-subtle">+{r.incomingPos.length - 2} more</span>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="px-2 py-1.5 text-right font-mono tabular-nums" style={{ color: r.shortfall > 0 ? cfg.border : undefined }}>
                      {r.shortfall}
                    </td>
                    <td className="px-2 py-1.5">
                      <div className="flex items-center gap-1 text-[10.5px] font-medium" style={{ color: cfg.border }}>
                        <StatusDot tone={cfg.dot} />
                        {r.status}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="text-[10.5px] text-fg-subtle">
        Row-level actions (expedite, substitute, flag for PM) — TODO — hook to
        purchasing + messaging endpoints.
      </div>
    </div>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="eyebrow text-[9.5px]">{label}</div>
      <div className="text-[12.5px] text-fg truncate">{value}</div>
    </div>
  )
}
