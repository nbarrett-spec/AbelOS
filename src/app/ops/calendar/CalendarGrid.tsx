'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  PageHeader,
  Button,
  Card,
  EmptyState,
  Kbd,
  Badge,
} from '@/components/ui'
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon, RefreshCw, X } from 'lucide-react'
import JobChip, {
  type JobChipEvent,
  type MaterialsStatus,
  bucketStatus,
  BUCKET_LABEL,
  RAIL_COLORS,
  MATERIALS_COLOR,
  MATERIALS_LABEL,
} from './JobChip'

// ──────────────────────────────────────────────────────────────────────────
// CalendarGrid — month view for /ops/calendar.
//
// 7-col × 5-6 row grid. Weeks start Monday. Each day shows up to 3 chips
// with a "+N more" pill for overflow. Today cell has a blueprint gradient
// fade. Keyboard: ← → jumps month; T jumps to today.
// ──────────────────────────────────────────────────────────────────────────

interface StaffLite {
  id: string
  name: string
}

interface BuilderLite {
  id: string
  name: string
}

interface CalendarEvent extends JobChipEvent {
  assignedPMId: string | null
}

interface CalendarResponse {
  month: string
  range: { start: string; end: string }
  events: CalendarEvent[]
}

// ── Date helpers (UTC day arithmetic) ─────────────────────────────────────

function parseYmd(s: string): Date {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d))
}

function toYmd(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
}

function addDaysUTC(d: Date, n: number): Date {
  const out = new Date(d)
  out.setUTCDate(out.getUTCDate() + n)
  return out
}

function startOfMondayWeek(d: Date): Date {
  const out = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
  const dow = out.getUTCDay()
  const daysFromMonday = dow === 0 ? 6 : dow - 1
  out.setUTCDate(out.getUTCDate() - daysFromMonday)
  return out
}

function sameDayUTC(a: Date, b: Date): boolean {
  return (
    a.getUTCFullYear() === b.getUTCFullYear() &&
    a.getUTCMonth() === b.getUTCMonth() &&
    a.getUTCDate() === b.getUTCDate()
  )
}

function monthKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`
}

function monthLabel(year: number, month: number): string {
  const d = new Date(Date.UTC(year, month - 1, 1))
  return d.toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' })
}

// ──────────────────────────────────────────────────────────────────────────

export default function CalendarGrid({
  staff,
  builders,
}: {
  staff: StaffLite[]
  builders: BuilderLite[]
}) {
  // ── Month anchor ────────────────────────────────────────────────────────
  const now = new Date()
  const [anchor, setAnchor] = useState<{ year: number; month: number }>({
    year: now.getUTCFullYear(),
    month: now.getUTCMonth() + 1,
  })

  // ── Filters ─────────────────────────────────────────────────────────────
  const [pmFilter, setPmFilter] = useState<Set<string>>(new Set())
  const [builderFilter, setBuilderFilter] = useState<Set<string>>(new Set())
  const [statusFilter, setStatusFilter] = useState<Set<string>>(new Set())
  const [hideClosed, setHideClosed] = useState(false)

  // ── Data ────────────────────────────────────────────────────────────────
  const [data, setData] = useState<CalendarResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [lastFetched, setLastFetched] = useState<Date | null>(null)

  const fetchAbortRef = useRef<AbortController | null>(null)

  const fetchCalendar = useCallback(async () => {
    setLoading(true)
    setError(null)
    fetchAbortRef.current?.abort()
    const abort = new AbortController()
    fetchAbortRef.current = abort
    try {
      const qs = new URLSearchParams()
      qs.set('month', monthKey(anchor.year, anchor.month))
      for (const id of pmFilter) qs.append('pm[]', id)
      for (const id of builderFilter) qs.append('builder[]', id)
      if (hideClosed) qs.set('hideClosed', '1')
      const res = await fetch(`/api/ops/calendar/jobs?${qs.toString()}`, {
        cache: 'no-store',
        signal: abort.signal,
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || `HTTP ${res.status}`)
      }
      const json: CalendarResponse = await res.json()
      setData(json)
      setLastFetched(new Date())
    } catch (err: any) {
      if (err?.name === 'AbortError') return
      setError(err?.message ?? 'Failed to load calendar')
    } finally {
      if (!abort.signal.aborted) setLoading(false)
    }
  }, [anchor, pmFilter, builderFilter, hideClosed])

  useEffect(() => {
    fetchCalendar()
    return () => fetchAbortRef.current?.abort()
  }, [fetchCalendar])

  // ── Keyboard: ← → jumps month; T jumps to today ────────────────────────
  const prevMonth = useCallback(() => {
    setAnchor((a) => {
      const m = a.month - 1
      return m < 1 ? { year: a.year - 1, month: 12 } : { year: a.year, month: m }
    })
  }, [])

  const nextMonth = useCallback(() => {
    setAnchor((a) => {
      const m = a.month + 1
      return m > 12 ? { year: a.year + 1, month: 1 } : { year: a.year, month: m }
    })
  }, [])

  const jumpToday = useCallback(() => {
    const n = new Date()
    setAnchor({ year: n.getUTCFullYear(), month: n.getUTCMonth() + 1 })
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return
      }
      if (e.key === 'ArrowLeft') {
        e.preventDefault()
        prevMonth()
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        nextMonth()
      } else if (e.key === 't' || e.key === 'T') {
        e.preventDefault()
        jumpToday()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [prevMonth, nextMonth, jumpToday])

  // ── Apply client-side filters (PM/builder/status/hideClosed already sent
  // to API; status is client-only because the grid is small and status is
  // per-event). ─────────────────────────────────────────────────────────
  const filteredEvents = useMemo(() => {
    if (!data) return []
    const events = data.events
    if (statusFilter.size === 0) return events
    return events.filter((e) => statusFilter.has(bucketStatus(e.status)))
  }, [data, statusFilter])

  // ── Bucket events by day (YYYY-MM-DD key) ─────────────────────────────
  const eventsByDay = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>()
    for (const e of filteredEvents) {
      let arr = map.get(e.date)
      if (!arr) {
        arr = []
        map.set(e.date, arr)
      }
      arr.push(e)
    }
    return map
  }, [filteredEvents])

  // ── Compute grid days ──────────────────────────────────────────────────
  const gridDays = useMemo(() => {
    const monthStart = new Date(Date.UTC(anchor.year, anchor.month - 1, 1))
    const monthEnd = new Date(Date.UTC(anchor.year, anchor.month, 0))
    const gridStart = startOfMondayWeek(monthStart)
    const gridEnd = addDaysUTC(startOfMondayWeek(monthEnd), 6) // inclusive
    const days: Date[] = []
    for (let d = gridStart; d <= gridEnd; d = addDaysUTC(d, 1)) {
      days.push(d)
    }
    return days
  }, [anchor])

  const today = new Date()

  // ── Day expansion modal ────────────────────────────────────────────────
  const [expandedDay, setExpandedDay] = useState<string | null>(null)

  // ── Summary counts (for filter chip numbers) ──────────────────────────
  const bucketCounts = useMemo(() => {
    const counts: Record<string, number> = {
      IN_PROGRESS: 0,
      PENDING: 0,
      READY_TO_CLOSE: 0,
      CLOSED: 0,
    }
    if (!data) return counts
    for (const e of data.events) {
      counts[bucketStatus(e.status)]++
    }
    return counts
  }, [data])

  // Job open link — jobs page hover uses /ops/jobs/:id
  const openJob = useCallback((jobId: string) => {
    if (typeof window !== 'undefined') {
      window.location.href = `/ops/jobs/${jobId}`
    }
  }, [])

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="Operations"
        title="Job Calendar"
        description="Month view of scheduled starts, closing dates, and materials-ready status across active jobs."
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

      {/* Controls bar */}
      <div className="flex flex-wrap items-center gap-2 justify-between">
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            iconOnly
            onClick={prevMonth}
            aria-label="Previous month"
            icon={<ChevronLeft className="w-4 h-4" />}
          />
          <Button
            variant="ghost"
            size="sm"
            onClick={jumpToday}
            icon={<CalendarIcon className="w-3.5 h-3.5" />}
          >
            Today <Kbd className="ml-1">T</Kbd>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            iconOnly
            onClick={nextMonth}
            aria-label="Next month"
            icon={<ChevronRight className="w-4 h-4" />}
          />
          <div className="text-[15px] font-semibold text-fg ml-3 tabular-nums">
            {monthLabel(anchor.year, anchor.month)}
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <FilterSelect
            label="PM"
            options={staff.map((s) => ({ id: s.id, label: s.name }))}
            selected={pmFilter}
            onChange={setPmFilter}
            placeholder="All PMs"
          />
          <FilterSelect
            label="Builder"
            options={builders.map((b) => ({ id: b.id, label: b.name }))}
            selected={builderFilter}
            onChange={setBuilderFilter}
            placeholder="All builders"
          />
          <StatusFilter
            selected={statusFilter}
            onChange={setStatusFilter}
            counts={bucketCounts}
          />
          <label className="flex items-center gap-1.5 text-[11.5px] text-fg-muted select-none cursor-pointer px-2 h-7 rounded-md border border-border bg-surface-muted/30 hover:text-fg">
            <input
              type="checkbox"
              checked={hideClosed}
              onChange={(e) => setHideClosed(e.target.checked)}
              className="accent-[var(--c1)]"
            />
            Hide closed
          </label>
          {lastFetched && (
            <div className="text-[10.5px] font-mono tabular-nums text-fg-subtle">
              Updated {lastFetched.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
            </div>
          )}
        </div>
      </div>

      {/* Status legend */}
      <Legend />

      {/* Error */}
      {error && (
        <Card className="p-3 border-[var(--data-negative,#EF4444)]/40">
          <div className="text-[12.5px] text-[var(--data-negative,#EF4444)]">
            Error loading calendar: {error}
          </div>
        </Card>
      )}

      {/* Grid */}
      {loading && !data ? (
        <Card className="p-8">
          <div className="text-[13px] text-fg-muted">Loading calendar…</div>
        </Card>
      ) : filteredEvents.length === 0 && !loading ? (
        <Card className="p-0 overflow-hidden">
          <EmptyState
            title="No jobs in this month"
            description={
              data?.events.length
                ? 'All events filtered out — adjust filters.'
                : 'Nothing scheduled for this month.'
            }
          />
        </Card>
      ) : (
        <div>
          {/* Weekday header — Mon-start */}
          <div className="grid grid-cols-7 gap-1 mb-1">
            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
              <div
                key={d}
                className="text-center text-[10.5px] font-medium text-fg-subtle uppercase tracking-wide bp-label"
              >
                {d}
              </div>
            ))}
          </div>
          {/* Day cells */}
          <div className="grid grid-cols-7 gap-1">
            {gridDays.map((d) => {
              const key = toYmd(d)
              const events = eventsByDay.get(key) ?? []
              const inMonth = d.getUTCMonth() + 1 === anchor.month
              const isToday = sameDayUTC(d, today)
              const visible = events.slice(0, 3)
              const overflow = events.length - visible.length

              const todayGrad =
                'linear-gradient(135deg, color-mix(in srgb, var(--c1) 7%, transparent), color-mix(in srgb, var(--c4) 5%, transparent))'

              return (
                <div
                  key={key}
                  className={`relative rounded-md border min-h-[110px] flex flex-col transition-colors ${
                    inMonth
                      ? 'border-border bg-surface-muted/20'
                      : 'border-border/40 bg-transparent opacity-55'
                  } ${isToday ? 'ring-1 ring-[var(--c1)]' : ''}`}
                  style={isToday ? { backgroundImage: todayGrad } : undefined}
                >
                  {/* Day header */}
                  <div className="px-1.5 py-1 flex items-center justify-between border-b border-border/60">
                    <div className="flex items-center gap-1 min-w-0">
                      <span
                        className={`font-mono tabular-nums text-[11px] ${
                          isToday
                            ? 'text-[var(--c1)] font-semibold'
                            : inMonth
                              ? 'text-fg'
                              : 'text-fg-subtle'
                        }`}
                      >
                        {d.getUTCDate()}
                      </span>
                      <span
                        className={`text-[9px] font-medium uppercase tracking-wide ${
                          inMonth ? 'text-fg-subtle' : 'text-fg-subtle/70'
                        }`}
                      >
                        {d.toLocaleDateString(undefined, { weekday: 'short', timeZone: 'UTC' })}
                      </span>
                    </div>
                    {events.length > 0 && (
                      <span
                        className="font-mono tabular-nums text-[10px] text-fg-muted"
                        title={`${events.length} events`}
                      >
                        {events.length}
                      </span>
                    )}
                  </div>

                  {/* Chips */}
                  <div className="px-1 py-1 space-y-0.5 flex-1 overflow-hidden">
                    {visible.map((e, idx) => (
                      <JobChip
                        key={`${e.jobId}-${e.dateKind}-${idx}`}
                        event={e}
                        compact
                        onClick={() => openJob(e.jobId)}
                      />
                    ))}
                    {overflow > 0 && (
                      <button
                        onClick={() => setExpandedDay(key)}
                        className="w-full text-[10px] text-fg-muted hover:text-fg text-center py-0.5 rounded hover:bg-surface-muted/40"
                      >
                        +{overflow} more
                      </button>
                    )}
                    {events.length === 0 && inMonth && (
                      <div className="h-full" />
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Day expansion modal */}
      {expandedDay && (
        <DayExpansion
          dateKey={expandedDay}
          events={eventsByDay.get(expandedDay) ?? []}
          onClose={() => setExpandedDay(null)}
          onOpenJob={openJob}
        />
      )}
    </div>
  )
}

// ── Filter: multi-select with inline popover ──────────────────────────────

function FilterSelect({
  label,
  options,
  selected,
  onChange,
  placeholder,
}: {
  label: string
  options: Array<{ id: string; label: string }>
  selected: Set<string>
  onChange: (next: Set<string>) => void
  placeholder: string
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    if (open) document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const toggle = (id: string) => {
    const next = new Set(selected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    onChange(next)
  }

  const selectedLabel =
    selected.size === 0
      ? placeholder
      : selected.size === 1
        ? options.find((o) => o.id === [...selected][0])?.label ?? `1 ${label}`
        : `${selected.size} ${label}s`

  return (
    <div ref={rootRef} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className={`inline-flex items-center gap-1.5 px-2.5 h-7 text-[11.5px] rounded-md border border-border bg-surface-muted/30 hover:text-fg hover:border-border-strong transition-colors ${
          selected.size > 0 ? 'text-fg border-[var(--c1)]/40' : 'text-fg-muted'
        }`}
      >
        <span className="text-fg-subtle uppercase tracking-wide font-medium text-[9.5px] bp-label">{label}:</span>
        <span className="truncate max-w-[140px]">{selectedLabel}</span>
      </button>
      {open && (
        <div className="absolute right-0 top-8 z-20 w-[240px] max-h-[320px] overflow-auto rounded-md border border-border bg-surface-elevated shadow-lg p-1">
          {options.length === 0 ? (
            <div className="text-[11px] text-fg-subtle italic px-2 py-1.5">No options</div>
          ) : (
            options.map((o) => (
              <label
                key={o.id}
                className="flex items-center gap-2 px-2 py-1 text-[12px] text-fg hover:bg-surface-muted/50 rounded cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={selected.has(o.id)}
                  onChange={() => toggle(o.id)}
                  className="accent-[var(--c1)]"
                />
                <span className="truncate">{o.label}</span>
              </label>
            ))
          )}
          {selected.size > 0 && (
            <div className="border-t border-border mt-1 pt-1">
              <button
                onClick={() => onChange(new Set())}
                className="w-full text-[11px] text-fg-muted hover:text-fg px-2 py-1 text-left"
              >
                Clear
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function StatusFilter({
  selected,
  onChange,
  counts,
}: {
  selected: Set<string>
  onChange: (next: Set<string>) => void
  counts: Record<string, number>
}) {
  const buckets: Array<'IN_PROGRESS' | 'PENDING' | 'READY_TO_CLOSE' | 'CLOSED'> = [
    'IN_PROGRESS',
    'PENDING',
    'READY_TO_CLOSE',
    'CLOSED',
  ]
  return (
    <div className="inline-flex items-center rounded-md border border-border bg-surface-muted/30 p-0.5">
      {buckets.map((b) => {
        const active = selected.has(b)
        return (
          <button
            key={b}
            onClick={() => {
              const next = new Set(selected)
              if (next.has(b)) next.delete(b)
              else next.add(b)
              onChange(next)
            }}
            className={`px-2 h-6 rounded text-[10.5px] font-medium transition-colors inline-flex items-center gap-1 ${
              active ? 'bg-surface-elevated text-fg shadow-sm' : 'text-fg-muted hover:text-fg'
            }`}
            title={BUCKET_LABEL[b]}
          >
            <span
              className="w-1.5 h-1.5 rounded-full"
              style={{ background: RAIL_COLORS[b] }}
            />
            {BUCKET_LABEL[b]}
            <span className="font-mono tabular-nums text-[10px] text-fg-subtle ml-0.5">
              {counts[b] ?? 0}
            </span>
          </button>
        )
      })}
    </div>
  )
}

function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[10.5px] text-fg-muted">
      <span className="eyebrow bp-label">Materials:</span>
      {(['green', 'amber', 'red', 'unknown'] as MaterialsStatus[]).map((m) => (
        <span key={m} className="inline-flex items-center gap-1">
          <span
            className="w-1.5 h-1.5 rounded-full"
            style={{ background: MATERIALS_COLOR[m] }}
          />
          {MATERIALS_LABEL[m]}
        </span>
      ))}
      <span className="h-3 w-px bg-border mx-1" />
      <span className="eyebrow bp-label">Status:</span>
      {(['IN_PROGRESS', 'PENDING', 'READY_TO_CLOSE', 'CLOSED'] as const).map((b) => (
        <span key={b} className="inline-flex items-center gap-1">
          <span
            className="w-2 h-0.5 rounded"
            style={{ background: RAIL_COLORS[b] }}
          />
          {BUCKET_LABEL[b]}
        </span>
      ))}
    </div>
  )
}

// ── Day expansion modal ───────────────────────────────────────────────────

function DayExpansion({
  dateKey,
  events,
  onClose,
  onOpenJob,
}: {
  dateKey: string
  events: CalendarEvent[]
  onClose: () => void
  onOpenJob: (jobId: string) => void
}) {
  const d = parseYmd(dateKey)
  const label = d.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  })

  // Esc-to-close
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const startCount = events.filter((e) => e.dateKind === 'start').length
  const closeCount = events.filter((e) => e.dateKind === 'close').length

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm animate-[fadeIn_150ms_ease-out]"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="bg-surface-elevated border border-border rounded-lg shadow-xl w-[520px] max-w-[92vw] max-h-[80vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-border">
          <div>
            <div className="text-[13px] font-semibold text-fg">{label}</div>
            <div className="text-[11px] text-fg-muted mt-0.5 flex items-center gap-2">
              <Badge variant="neutral" size="xs">{events.length} events</Badge>
              {startCount > 0 && <span>{startCount} start{startCount === 1 ? '' : 's'}</span>}
              {closeCount > 0 && <span>{closeCount} closing</span>}
            </div>
          </div>
          <button
            className="p-1 rounded hover:bg-surface-muted/40"
            onClick={onClose}
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="overflow-auto p-3 space-y-1.5">
          {events.length === 0 ? (
            <div className="text-[12px] text-fg-muted italic">No events this day.</div>
          ) : (
            events.map((e, i) => (
              <JobChip
                key={`${e.jobId}-${e.dateKind}-${i}`}
                event={e}
                compact={false}
                onClick={() => onOpenJob(e.jobId)}
              />
            ))
          )}
        </div>
      </div>
    </div>
  )
}
