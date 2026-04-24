export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'
import { safeJson } from '@/lib/safe-json'

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/ops/pm/today
//
// Auto-scoped PM "today + tomorrow" dashboard data. Reads the logged-in staff
// id from the `x-staff-id` header (injected by middleware) and returns:
//
//   • today          — jobs with scheduledDate inside today's window
//   • tomorrow       — jobs with scheduledDate inside tomorrow's window
//   • redJobsThisWeek — jobs w/ RED materials + scheduledDate in next 7 days
//   • overdueTasks   — tasks assigned to this PM's jobs, past dueDate, open
//   • closingsThisWeek — HyphenDocument closingDate entries in next 7 days
//
// Date boundaries: America/Chicago (Abel HQ is in DFW). We compute the start
// of "today" and "tomorrow" in CT via Intl.DateTimeFormat, then translate to
// absolute Date instants for the SQL/Prisma query. This keeps the definition
// of "today" stable for any PM regardless of server timezone.
//
// Materials status derivation mirrors /api/ops/pm/book/[staffId] exactly
// (RED if any BACKORDERED alloc, GREEN if 100% PICKED/CONSUMED, AMBER o/w,
// NONE if no allocations). Kept in sync so this page and the PM Book tell the
// same story.
//
// Auth: checkStaffAuth gate. Any staff with /api/ops/* access may call it;
// the response is always scoped to the caller (no admin override here — PMs
// log in as themselves).
// ─────────────────────────────────────────────────────────────────────────────

type MaterialsStatus = 'GREEN' | 'AMBER' | 'RED' | 'NONE'

interface JobRow {
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

interface TaskRow {
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

interface ClosingRow {
  jobId: string
  jobNumber: string
  builderName: string
  community: string | null
  closingDate: string
}

interface TodayResponse {
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
  today: JobRow[]
  tomorrow: JobRow[]
  redJobsThisWeek: JobRow[]
  overdueTasks: TaskRow[]
  closingsThisWeek: ClosingRow[]
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const READY_ALLOC = new Set(['PICKED', 'CONSUMED'])
const SHORTAGE_ALLOC = new Set(['BACKORDERED'])
const PENDING_ALLOC = new Set(['RESERVED'])

function rollupMaterials(rows: Array<{ status: string | null }>): MaterialsStatus {
  if (rows.length === 0) return 'NONE'
  let ready = 0
  let short = 0
  let pending = 0
  for (const r of rows) {
    const s = (r.status || '').toUpperCase()
    if (READY_ALLOC.has(s)) ready++
    else if (SHORTAGE_ALLOC.has(s)) short++
    else if (PENDING_ALLOC.has(s)) pending++
  }
  if (short > 0) return 'RED'
  if (pending === 0 && ready === rows.length) return 'GREEN'
  return 'AMBER'
}

function breakdown(rows: Array<{ status: string | null }>) {
  let picked = 0,
    consumed = 0,
    reserved = 0,
    backordered = 0,
    other = 0
  for (const a of rows) {
    const s = (a.status || '').toUpperCase()
    if (s === 'PICKED') picked++
    else if (s === 'CONSUMED') consumed++
    else if (s === 'RESERVED') reserved++
    else if (s === 'BACKORDERED') backordered++
    else other++
  }
  return {
    total: rows.length,
    picked,
    consumed,
    reserved,
    backordered,
    other,
  }
}

// Compute the midnight-to-midnight window for "today" in America/Chicago,
// returning absolute Date instants that can be used in Prisma queries.
//
// Why Intl: Node server may be in UTC (Vercel), but a DFW-based PM's "today"
// should mean Chicago-local today. Using Intl.DateTimeFormat keeps DST
// correct without dragging in a tz library.
function chicagoWindow(now: Date = new Date()) {
  const TZ = 'America/Chicago'
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(now)

  const map: Record<string, string> = {}
  for (const p of parts) if (p.type !== 'literal') map[p.type] = p.value

  const y = Number(map.year)
  const m = Number(map.month)
  const d = Number(map.day)
  const hour = Number(map.hour === '24' ? '00' : map.hour)
  const min = Number(map.minute)
  const sec = Number(map.second)

  // Offset between "wall clock in Chicago" and the UTC instant we were given.
  // A positive offsetMs means Chicago is that many ms ahead of UTC; we use
  // it to turn a Chicago wall-clock date into an absolute UTC instant.
  const ctWallAsIfUtcMs = Date.UTC(y, m - 1, d, hour, min, sec)
  const offsetMs = ctWallAsIfUtcMs - now.getTime() // typically -5h or -6h

  // Build the Chicago midnight for "today" as a UTC instant.
  const todayWallAsIfUtcMs = Date.UTC(y, m - 1, d, 0, 0, 0)
  const todayStart = new Date(todayWallAsIfUtcMs - offsetMs)
  const todayEnd = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000)
  const tomorrowStart = todayEnd
  const tomorrowEnd = new Date(todayEnd.getTime() + 24 * 60 * 60 * 1000)
  const weekEnd = new Date(todayStart.getTime() + 7 * 24 * 60 * 60 * 1000)

  return { todayStart, todayEnd, tomorrowStart, tomorrowEnd, weekEnd, tz: TZ }
}

// ── Handler ──────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  const staffId = request.headers.get('x-staff-id') || ''
  if (!staffId) {
    return NextResponse.json({ error: 'Missing staff identity.' }, { status: 401 })
  }

  try {
    const { todayStart, todayEnd, tomorrowStart, tomorrowEnd, weekEnd, tz } =
      chicagoWindow()

    // ── Staff card (for header greeting on the page) ──
    const staff = await prisma.staff.findUnique({
      where: { id: staffId },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        title: true,
      },
    })

    // ── Today's jobs ──
    const todayJobs = await prisma.job.findMany({
      where: {
        assignedPMId: staffId,
        scheduledDate: { gte: todayStart, lt: todayEnd },
      },
      select: {
        id: true,
        jobNumber: true,
        community: true,
        lotBlock: true,
        jobAddress: true,
        builderName: true,
        status: true,
        jobType: true,
        scopeType: true,
        scheduledDate: true,
      },
      orderBy: { scheduledDate: 'asc' },
    })

    // ── Tomorrow's jobs ──
    const tomorrowJobs = await prisma.job.findMany({
      where: {
        assignedPMId: staffId,
        scheduledDate: { gte: tomorrowStart, lt: tomorrowEnd },
      },
      select: {
        id: true,
        jobNumber: true,
        community: true,
        lotBlock: true,
        jobAddress: true,
        builderName: true,
        status: true,
        jobType: true,
        scopeType: true,
        scheduledDate: true,
      },
      orderBy: { scheduledDate: 'asc' },
    })

    // ── This week's jobs (for red-material rollup) ──
    const weekJobs = await prisma.job.findMany({
      where: {
        assignedPMId: staffId,
        scheduledDate: { gte: todayStart, lt: weekEnd },
      },
      select: {
        id: true,
        jobNumber: true,
        community: true,
        lotBlock: true,
        jobAddress: true,
        builderName: true,
        status: true,
        jobType: true,
        scopeType: true,
        scheduledDate: true,
      },
    })

    // Dedupe job id set (today + tomorrow + week + any overdue tasks need it)
    const jobIds = Array.from(
      new Set([
        ...todayJobs.map((j) => j.id),
        ...tomorrowJobs.map((j) => j.id),
        ...weekJobs.map((j) => j.id),
      ])
    )

    // ── Materials allocation rollup (single query across all relevant jobs) ──
    const allocRows =
      jobIds.length === 0
        ? []
        : await prisma.inventoryAllocation.findMany({
            where: { jobId: { in: jobIds } },
            select: { jobId: true, status: true },
          })

    const allocByJob = new Map<string, Array<{ status: string | null }>>()
    for (const a of allocRows) {
      if (!a.jobId) continue
      const arr = allocByJob.get(a.jobId) ?? []
      arr.push({ status: a.status })
      allocByJob.set(a.jobId, arr)
    }

    const decorate = (j: (typeof todayJobs)[number]): JobRow => {
      const allocs = allocByJob.get(j.id) ?? []
      return {
        id: j.id,
        jobNumber: j.jobNumber,
        community: j.community,
        lotBlock: j.lotBlock,
        jobAddress: j.jobAddress,
        builderName: j.builderName,
        status: j.status,
        jobType: (j.jobType as string | null) ?? null,
        scopeType: j.scopeType as unknown as string,
        scheduledDate: j.scheduledDate ? j.scheduledDate.toISOString() : null,
        materialsStatus: rollupMaterials(allocs),
        materialsBreakdown: breakdown(allocs),
      }
    }

    const today = todayJobs.map(decorate)
    const tomorrow = tomorrowJobs.map(decorate)
    const redJobsThisWeek = weekJobs
      .map(decorate)
      .filter((j) => j.materialsStatus === 'RED')
      // Most pressing first (earliest scheduled)
      .sort((a, b) => {
        const ax = a.scheduledDate ? Date.parse(a.scheduledDate) : Infinity
        const bx = b.scheduledDate ? Date.parse(b.scheduledDate) : Infinity
        return ax - bx
      })

    // ── Need a broader set of PM-owned jobs for overdue task scoping ──
    // Tasks can be overdue on any open job this PM owns — not just the
    // today/tomorrow window. Fetch every open-status job id separately.
    const pmJobIdsForTasks = await prisma.job.findMany({
      where: { assignedPMId: staffId },
      select: { id: true, jobNumber: true, community: true, builderName: true },
    })
    const pmJobIdList = pmJobIdsForTasks.map((j) => j.id)
    const jobMetaById = new Map(pmJobIdsForTasks.map((j) => [j.id, j]))

    // ── Overdue tasks ──
    // Match the raw-SQL style used by PM roster (accepts both 'DONE' and
    // 'COMPLETE' defensively in case status values drift).
    let overdueTasks: TaskRow[] = []
    if (pmJobIdList.length > 0) {
      try {
        const rows: Array<{
          id: string
          title: string
          priority: string
          status: string
          category: string
          dueDate: Date | null
          jobId: string | null
        }> = await prisma.$queryRawUnsafe(
          `SELECT t."id",
                  t."title",
                  t."priority"::text AS "priority",
                  t."status"::text   AS "status",
                  t."category"::text AS "category",
                  t."dueDate",
                  t."jobId"
             FROM "Task" t
            WHERE t."jobId" = ANY($1::text[])
              AND t."status"::text NOT IN ('DONE', 'COMPLETE', 'CANCELLED')
              AND t."dueDate" IS NOT NULL
              AND t."dueDate" < NOW()
            ORDER BY t."dueDate" ASC
            LIMIT 100`,
          pmJobIdList
        )
        overdueTasks = rows.map((r) => {
          const meta = r.jobId ? jobMetaById.get(r.jobId) : null
          return {
            id: r.id,
            title: r.title,
            priority: r.priority,
            status: r.status,
            category: r.category,
            dueDate: r.dueDate ? r.dueDate.toISOString() : null,
            jobId: r.jobId,
            jobNumber: meta?.jobNumber ?? null,
            community: meta?.community ?? null,
            builderName: meta?.builderName ?? null,
          }
        })
      } catch (e) {
        console.warn('[PM Today] overdue tasks lookup skipped:', e)
      }
    }

    // ── Closings this week (HyphenDocument.closingDate on this PM's jobs) ──
    let closingsThisWeek: ClosingRow[] = []
    if (pmJobIdList.length > 0) {
      try {
        const rows: Array<{
          jobId: string
          closingDate: Date
        }> = await prisma.$queryRawUnsafe(
          `SELECT "jobId", MAX("closingDate") AS "closingDate"
             FROM "HyphenDocument"
            WHERE "jobId" = ANY($1::text[])
              AND "closingDate" IS NOT NULL
              AND "closingDate" >= $2::timestamptz
              AND "closingDate" <  $3::timestamptz
            GROUP BY "jobId"
            ORDER BY MAX("closingDate") ASC`,
          pmJobIdList,
          todayStart.toISOString(),
          weekEnd.toISOString()
        )
        closingsThisWeek = rows.map((r) => {
          const meta = jobMetaById.get(r.jobId)
          return {
            jobId: r.jobId,
            jobNumber: meta?.jobNumber ?? '—',
            builderName: meta?.builderName ?? '—',
            community: meta?.community ?? null,
            closingDate: r.closingDate.toISOString(),
          }
        })
      } catch (e) {
        console.warn('[PM Today] closings lookup skipped:', e)
      }
    }

    const body: TodayResponse = {
      asOf: new Date().toISOString(),
      staff,
      window: {
        timezone: tz,
        todayStart: todayStart.toISOString(),
        todayEnd: todayEnd.toISOString(),
        tomorrowStart: tomorrowStart.toISOString(),
        tomorrowEnd: tomorrowEnd.toISOString(),
        weekEnd: weekEnd.toISOString(),
      },
      today,
      tomorrow,
      redJobsThisWeek,
      overdueTasks,
      closingsThisWeek,
    }

    return safeJson(body)
  } catch (error: any) {
    console.error('[PM Today] Error:', error)
    return NextResponse.json(
      { error: 'Failed to load today dashboard.', detail: error?.message },
      { status: 500 }
    )
  }
}
