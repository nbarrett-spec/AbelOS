'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Calendar, AlertTriangle } from 'lucide-react'
import PageHeader from '@/components/ui/PageHeader'
import EmptyState from '@/components/ui/EmptyState'

// ──────────────────────────────────────────────────────────────────────────
// Manufacturing Schedule / Capacity (M-15)
//
// Read-only 4-week forward calendar so the manufacturing lead can spot
// over-booking before it becomes a fire drill. Days-as-columns, weeks-as-rows
// keeps the "what's next 7" scan on a single row and the "how does week 3
// look" scan on a single column.
//
// Capacity heuristic: 4 jobs/day = full. Green ≤4, yellow =4 (at), red >4.
// This is a placeholder until we have real per-day capacity in the schema —
// kept dead simple so the lead can challenge it in week 1 and we can swap in
// a real number without touching the UI.
// ──────────────────────────────────────────────────────────────────────────

const DAILY_CAPACITY = 4

interface ScheduleJob {
  id: string
  jobNumber: string
  scheduledDate: string
  status: string
  builderName: string
  community: string | null
}

interface DayBucket {
  date: string // YYYY-MM-DD UTC
  jobs: ScheduleJob[]
}

interface WeekBucket {
  weekStart: string
  days: DayBucket[]
}

interface ApiResponse {
  weeks: WeekBucket[]
  totalJobs: number
  windowStart: string
  windowEnd: string
}

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

// Status → background/border for the job card. Matches the staging board's
// purple/yellow/green for IN_PRODUCTION/STAGED/LOADED so a single visual
// language carries across the manufacturing pages.
function statusStyle(status: string): { bg: string; border: string; text: string } {
  switch (status) {
    case 'IN_PRODUCTION':
      return { bg: 'bg-purple-50', border: 'border-purple-300', text: 'text-purple-800' }
    case 'STAGED':
      return { bg: 'bg-yellow-50', border: 'border-yellow-300', text: 'text-yellow-800' }
    case 'LOADED':
      return { bg: 'bg-green-50', border: 'border-green-300', text: 'text-green-800' }
    case 'IN_TRANSIT':
    case 'DELIVERED':
      return { bg: 'bg-blue-50', border: 'border-blue-300', text: 'text-blue-800' }
    case 'INSTALLING':
    case 'PUNCH_LIST':
      return { bg: 'bg-indigo-50', border: 'border-indigo-300', text: 'text-indigo-800' }
    case 'COMPLETE':
    case 'INVOICED':
    case 'CLOSED':
      return { bg: 'bg-gray-50', border: 'border-gray-300', text: 'text-gray-700' }
    case 'READINESS_CHECK':
    case 'MATERIALS_LOCKED':
      return { bg: 'bg-amber-50', border: 'border-amber-300', text: 'text-amber-800' }
    case 'CREATED':
    default:
      return { bg: 'bg-slate-50', border: 'border-slate-300', text: 'text-slate-700' }
  }
}

function capacityTone(count: number): { tone: 'green' | 'yellow' | 'red'; label: string; chip: string } {
  if (count > DAILY_CAPACITY) {
    return {
      tone: 'red',
      label: `${count} jobs · over capacity`,
      chip: 'bg-red-100 text-red-800 border-red-300',
    }
  }
  if (count === DAILY_CAPACITY) {
    return {
      tone: 'yellow',
      label: `${count} jobs · at capacity`,
      chip: 'bg-yellow-100 text-yellow-800 border-yellow-300',
    }
  }
  return {
    tone: 'green',
    label: `${count} job${count === 1 ? '' : 's'} · ${DAILY_CAPACITY - count} open`,
    chip: 'bg-green-100 text-green-800 border-green-300',
  }
}

// Format YYYY-MM-DD (UTC date-only) as "Mon · Apr 28" without timezone drift.
function formatDayHeader(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map((n) => parseInt(n, 10))
  if (!y || !m || !d) return isoDate
  const dt = new Date(Date.UTC(y, m - 1, d))
  return dt.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  })
}

function formatWeekRange(weekStart: string): string {
  const [y, m, d] = weekStart.split('-').map((n) => parseInt(n, 10))
  if (!y || !m || !d) return weekStart
  const start = new Date(Date.UTC(y, m - 1, d))
  const end = new Date(start)
  end.setUTCDate(end.getUTCDate() + 6)
  const fmt = (dt: Date) =>
    dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
  return `${fmt(start)} – ${fmt(end)}`
}

export default function ManufacturingSchedulePage() {
  const [data, setData] = useState<ApiResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        setLoading(true)
        const res = await fetch('/api/ops/manufacturing/schedule')
        if (!res.ok) {
          throw new Error('Failed to load schedule')
        }
        const json: ApiResponse = await res.json()
        if (!cancelled) {
          setData(json)
          setError(null)
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'An error occurred')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [])

  // Roll-up counts for the header strip.
  const summary = useMemo(() => {
    if (!data) return { total: 0, overDays: 0, atDays: 0 }
    let overDays = 0
    let atDays = 0
    for (const week of data.weeks) {
      for (const day of week.days) {
        if (day.jobs.length > DAILY_CAPACITY) overDays++
        else if (day.jobs.length === DAILY_CAPACITY) atDays++
      }
    }
    return { total: data.totalJobs, overDays, atDays }
  }, [data])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-[#0f2a3e]" />
          <p className="mt-4 text-fg-muted">Loading schedule...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Schedule & Capacity"
        description="4-week forward view of scheduled jobs. Read-only — flag over-bookings before they bite."
        actions={
          <Link
            href="/ops/manufacturing"
            className="text-xs text-[#0f2a3e] hover:underline"
          >
            ← Back to Dashboard
          </Link>
        }
      />

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Summary strip */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="bg-white border border-border rounded-xl p-4">
          <p className="text-xs text-fg-muted">Total scheduled (next 28d)</p>
          <p className="text-2xl font-semibold text-fg mt-1">{summary.total}</p>
        </div>
        <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4">
          <p className="text-xs text-yellow-900/70">Days at capacity</p>
          <p className="text-2xl font-semibold text-yellow-900 mt-1">{summary.atDays}</p>
        </div>
        <div className="bg-red-50 border border-red-200 rounded-xl p-4">
          <p className="text-xs text-red-900/70 flex items-center gap-1.5">
            {summary.overDays > 0 && <AlertTriangle className="w-3 h-3" />}
            Days over capacity
          </p>
          <p className="text-2xl font-semibold text-red-900 mt-1">{summary.overDays}</p>
        </div>
      </div>

      {/* Calendar grid: rows = weeks, columns = days */}
      {!data || data.weeks.length === 0 ? (
        <EmptyState
          icon={<Calendar className="w-6 h-6 text-fg-subtle" />}
          title="No schedule data"
          description="No jobs are scheduled in the next 28 days."
        />
      ) : (
        <div className="overflow-x-auto">
          <div className="min-w-[1100px] space-y-4 pb-4">
            {/* Day-of-week header row */}
            <div className="grid grid-cols-[120px_repeat(7,minmax(0,1fr))] gap-2 px-1">
              <div className="text-xs font-medium text-fg-subtle uppercase tracking-wide">
                Week
              </div>
              {DAY_LABELS.map((d) => (
                <div
                  key={d}
                  className="text-xs font-medium text-fg-subtle uppercase tracking-wide text-center"
                >
                  {d}
                </div>
              ))}
            </div>

            {data.weeks.map((week) => (
              <div
                key={week.weekStart}
                className="grid grid-cols-[120px_repeat(7,minmax(0,1fr))] gap-2"
              >
                <div className="flex flex-col justify-start pt-2">
                  <p className="text-xs font-semibold text-fg">
                    Week of
                  </p>
                  <p className="text-xs text-fg-muted">{formatWeekRange(week.weekStart)}</p>
                </div>

                {week.days.map((day) => {
                  const cap = capacityTone(day.jobs.length)
                  return (
                    <div
                      key={day.date}
                      className="bg-surface border border-border rounded-lg p-2 min-h-[160px] flex flex-col gap-2"
                    >
                      <div className="flex items-center justify-between gap-1">
                        <span className="text-xs font-medium text-fg">
                          {formatDayHeader(day.date)}
                        </span>
                      </div>
                      <span
                        className={`text-[10px] font-medium px-1.5 py-0.5 rounded border ${cap.chip} text-center leading-tight`}
                        title={`Capacity heuristic: ${DAILY_CAPACITY} jobs/day`}
                      >
                        {cap.label}
                      </span>

                      <div className="flex flex-col gap-1.5 mt-0.5">
                        {day.jobs.length === 0 ? (
                          <p className="text-[10px] text-fg-subtle italic mt-1">No jobs</p>
                        ) : (
                          day.jobs.map((job) => {
                            const s = statusStyle(job.status)
                            return (
                              <Link
                                key={job.id}
                                href={`/ops/jobs/${job.id}`}
                                className={`block rounded border ${s.bg} ${s.border} px-2 py-1.5 hover:shadow-sm hover:border-[#0f2a3e] transition-all`}
                              >
                                <p className={`text-[11px] font-semibold ${s.text} truncate`}>
                                  {job.jobNumber}
                                </p>
                                <p className="text-[10px] text-fg-muted truncate">
                                  {job.builderName}
                                  {job.community ? ` · ${job.community}` : ''}
                                </p>
                                <p className={`text-[9px] mt-0.5 font-mono uppercase ${s.text}/80`}>
                                  {job.status.replace(/_/g, ' ')}
                                </p>
                              </Link>
                            )
                          })
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Footer note — capacity is a heuristic, not a contract */}
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-xs text-blue-900">
        <p className="font-medium mb-1">About capacity</p>
        <p>
          Capacity is currently a flat heuristic of {DAILY_CAPACITY} jobs/day.
          Green = under, yellow = at, red = over. Click any job card to open it.
          Reschedule lives on the job page — drag-and-drop is intentionally not on this view.
        </p>
      </div>
    </div>
  )
}
