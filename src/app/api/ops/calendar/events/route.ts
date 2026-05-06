export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'
import { prisma } from '@/lib/prisma'

// ──────────────────────────────────────────────────────────────────────────
// GET /api/ops/calendar/events
//
// Aggregator for non-job calendar events that the month/week/day grid in
// /ops/calendar overlays on top of the job-start / job-close chips returned
// by /api/ops/calendar/jobs.
//
// Sources (all keyed off jobId so we drill back to /ops/jobs/:id):
//   - DELIVERY    : ScheduleEntry.entryType = DELIVERY   (canonical)
//   - INSTALL     : ScheduleEntry.entryType = INSTALLATION + Installation.scheduledDate
//   - QC          : Inspection.scheduledDate (any status)
//
// Notes:
//   - Delivery has no scheduledDate column on the model itself — the source
//     of truth for "delivery is on the calendar for X day" is ScheduleEntry.
//   - There is no CalendarEvent / Meeting model in the schema today, so
//     internal meetings are not surfaced here. (See FIXME below — wire up
//     when that model exists.)
//
// Query params:
//   ?from=YYYY-MM-DD   inclusive
//   ?to=YYYY-MM-DD     inclusive
//   ?jobId=xxx         optional filter
//
// Returns:
//   { range: { from, to }, events: [...] }
// ──────────────────────────────────────────────────────────────────────────

type EventType = 'DELIVERY' | 'INSTALL' | 'QC'

interface OpsCalendarEvent {
  id: string
  eventType: EventType
  date: string // YYYY-MM-DD
  title: string
  jobId: string | null
  jobNumber: string | null
  builderName: string | null
  community: string | null
  status: string | null
  href: string // drill-through target
}

function parseYmd(raw: string | null, fallback: Date): Date {
  if (raw && /^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const [y, m, d] = raw.split('-').map(Number)
    return new Date(Date.UTC(y, m - 1, d))
  }
  return new Date(Date.UTC(fallback.getUTCFullYear(), fallback.getUTCMonth(), fallback.getUTCDate()))
}

function toYmd(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
}

export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const url = request.nextUrl
    const now = new Date()
    const fromDefault = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
    const toDefault = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 23, 59, 59, 999))
    const from = parseYmd(url.searchParams.get('from'), fromDefault)
    const toRaw = parseYmd(url.searchParams.get('to'), toDefault)
    // make `to` end-of-day inclusive
    const to = new Date(Date.UTC(toRaw.getUTCFullYear(), toRaw.getUTCMonth(), toRaw.getUTCDate(), 23, 59, 59, 999))
    const jobIdFilter = url.searchParams.get('jobId') || undefined

    // ── Schedule entries (deliveries + installs) ─────────────────────────
    const scheduleWhere: any = {
      scheduledDate: { gte: from, lte: to },
      entryType: { in: ['DELIVERY', 'INSTALLATION'] as const },
    }
    if (jobIdFilter) scheduleWhere.jobId = jobIdFilter

    const scheduleEntries = await prisma.scheduleEntry.findMany({
      where: scheduleWhere,
      select: {
        id: true,
        title: true,
        scheduledDate: true,
        entryType: true,
        status: true,
        jobId: true,
        job: {
          select: {
            jobNumber: true,
            community: true,
            builderName: true,
          },
        },
      },
      orderBy: { scheduledDate: 'asc' },
      take: 1000,
    }).catch(() => [])

    // ── Direct Installation rows (some may have scheduledDate w/o ScheduleEntry) ──
    const installs = await prisma.installation.findMany({
      where: {
        scheduledDate: { gte: from, lte: to },
        ...(jobIdFilter ? { jobId: jobIdFilter } : {}),
      },
      select: {
        id: true,
        installNumber: true,
        scopeNotes: true,
        scheduledDate: true,
        status: true,
        jobId: true,
        job: {
          select: {
            jobNumber: true,
            community: true,
            builderName: true,
          },
        },
      },
      orderBy: { scheduledDate: 'asc' },
      take: 500,
    }).catch(() => [])

    // ── QC walks / inspections ───────────────────────────────────────────
    const inspections = await prisma.inspection.findMany({
      where: {
        scheduledDate: { gte: from, lte: to },
        ...(jobIdFilter ? { jobId: jobIdFilter } : {}),
      },
      select: {
        id: true,
        scheduledDate: true,
        status: true,
        jobId: true,
      },
      orderBy: { scheduledDate: 'asc' },
      take: 500,
    }).catch(() => [])

    // Hydrate inspection job context in one query
    const inspectionJobIds = Array.from(
      new Set(inspections.map((i) => i.jobId).filter(Boolean) as string[])
    )
    const jobLookup = new Map<string, { jobNumber: string; community: string | null; builderName: string }>()
    if (inspectionJobIds.length > 0) {
      const jobs = await prisma.job.findMany({
        where: { id: { in: inspectionJobIds } },
        select: { id: true, jobNumber: true, community: true, builderName: true },
      })
      for (const j of jobs) {
        jobLookup.set(j.id, {
          jobNumber: j.jobNumber,
          community: j.community,
          builderName: j.builderName,
        })
      }
    }

    // ── Merge into a single event list ───────────────────────────────────
    const events: OpsCalendarEvent[] = []

    for (const s of scheduleEntries) {
      if (!s.scheduledDate) continue
      const isDelivery = s.entryType === 'DELIVERY'
      events.push({
        id: `sched:${s.id}`,
        eventType: isDelivery ? 'DELIVERY' : 'INSTALL',
        date: toYmd(s.scheduledDate),
        title: s.title || (isDelivery ? 'Delivery' : 'Install'),
        jobId: s.jobId,
        jobNumber: s.job?.jobNumber ?? null,
        builderName: s.job?.builderName ?? null,
        community: s.job?.community ?? null,
        status: s.status,
        href: s.jobId ? `/ops/jobs/${s.jobId}` : '#',
      })
    }

    // De-dupe installs that already have a corresponding INSTALLATION schedule entry
    // for the same job + date — prefer ScheduleEntry as the canonical source.
    const installKeySet = new Set(
      scheduleEntries
        .filter((s) => s.entryType === 'INSTALLATION' && s.jobId && s.scheduledDate)
        .map((s) => `${s.jobId}:${toYmd(s.scheduledDate as Date)}`)
    )
    for (const i of installs) {
      if (!i.scheduledDate || !i.jobId) continue
      const k = `${i.jobId}:${toYmd(i.scheduledDate)}`
      if (installKeySet.has(k)) continue
      events.push({
        id: `install:${i.id}`,
        eventType: 'INSTALL',
        date: toYmd(i.scheduledDate),
        title: i.scopeNotes ? i.scopeNotes.slice(0, 80) : i.installNumber,
        jobId: i.jobId,
        jobNumber: i.job?.jobNumber ?? null,
        builderName: i.job?.builderName ?? null,
        community: i.job?.community ?? null,
        status: i.status,
        href: `/ops/jobs/${i.jobId}`,
      })
    }

    for (const ins of inspections) {
      if (!ins.scheduledDate) continue
      const ctx = ins.jobId ? jobLookup.get(ins.jobId) : undefined
      events.push({
        id: `qc:${ins.id}`,
        eventType: 'QC',
        date: toYmd(ins.scheduledDate),
        title: 'QC Walk',
        jobId: ins.jobId,
        jobNumber: ctx?.jobNumber ?? null,
        builderName: ctx?.builderName ?? null,
        community: ctx?.community ?? null,
        status: ins.status,
        href: ins.jobId ? `/ops/jobs/${ins.jobId}` : '/ops/inspections',
      })
    }

    // FIXME: when a CalendarEvent / Meeting model is added (B-BUG-5 follow-up
    // alongside the broken Google Calendar sync) include builder/internal
    // meetings here too.

    // Stable sort: by date, then by event type weight (delivery first), then jobNumber
    const typeWeight: Record<EventType, number> = { DELIVERY: 0, INSTALL: 1, QC: 2 }
    events.sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? -1 : 1
      if (a.eventType !== b.eventType) return typeWeight[a.eventType] - typeWeight[b.eventType]
      return (a.jobNumber || '').localeCompare(b.jobNumber || '')
    })

    return NextResponse.json({
      range: { from: toYmd(from), to: toYmd(to) },
      events,
    })
  } catch (err: any) {
    console.error('[GET /api/ops/calendar/events] error', err)
    return NextResponse.json(
      { error: err?.message ?? 'Failed to load calendar events' },
      { status: 500 }
    )
  }
}
