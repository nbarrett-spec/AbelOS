export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'
import { prisma } from '@/lib/prisma'

// ──────────────────────────────────────────────────────────────────────────
// GET /api/ops/calendar/jobs
//
// Month-view job calendar feed. Returns a flat list of events for the
// requested month (plus the surrounding padding needed to render a full
// Monday-start 7-col grid). Each job may emit up to TWO events: a 'start'
// event on Job.scheduledDate, and a 'close' event on the most recent
// HyphenDocument.closingDate that matches the job (if any).
//
// Materials-ready derivation (per job, across all active allocations):
//   - 'green' : every allocation is PICKED or CONSUMED
//   - 'amber' : at least one RESERVED row AND the summed (available across
//               the productIds covered by RESERVED rows) >= summed RESERVED
//               qty — i.e. the stock is there, just not picked yet. Zero
//               BACKORDERED rows.
//   - 'red'   : at least one BACKORDERED row, OR RESERVED qty exceeds
//               available stock.
//   - 'unknown' : no active allocation rows for this job at all.
//
// Query params:
//   ?month=YYYY-MM            (default: current month in America/Chicago wall time)
//   ?pm[]=staffId             (optional, multi)
//   ?builder[]=builderId      (optional, multi — matched against Builder.id OR builderName)
//   ?hideClosed=1|0           (default 0)
//
// Returns:
//   { month, range: { start, end }, events: [...] }
// ──────────────────────────────────────────────────────────────────────────

type MaterialsStatus = 'green' | 'amber' | 'red' | 'unknown'
type DateKind = 'start' | 'close'

interface CalendarEvent {
  jobId: string
  jobNumber: string
  community: string | null
  builderName: string
  status: string
  dateKind: DateKind
  date: string // ISO YYYY-MM-DD
  materialsStatus: MaterialsStatus
  assignedPMId: string | null
}

interface CalendarResponse {
  month: string // YYYY-MM
  range: { start: string; end: string }
  events: CalendarEvent[]
}

// ── Date helpers (UTC day arithmetic) ─────────────────────────────────────

function parseMonth(raw: string | null): { year: number; month: number } {
  if (raw && /^\d{4}-\d{2}$/.test(raw)) {
    const [y, m] = raw.split('-').map(Number)
    if (m >= 1 && m <= 12) return { year: y, month: m }
  }
  const now = new Date()
  return { year: now.getUTCFullYear(), month: now.getUTCMonth() + 1 }
}

function startOfMonthUTC(year: number, month: number): Date {
  return new Date(Date.UTC(year, month - 1, 1))
}

function endOfMonthUTC(year: number, month: number): Date {
  // day 0 of next month = last day of this month
  return new Date(Date.UTC(year, month, 0, 23, 59, 59, 999))
}

function startOfMondayWeek(d: Date): Date {
  const out = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
  const dow = out.getUTCDay() // 0=Sun ... 6=Sat
  const daysFromMonday = dow === 0 ? 6 : dow - 1
  out.setUTCDate(out.getUTCDate() - daysFromMonday)
  return out
}

function addDaysUTC(d: Date, n: number): Date {
  const out = new Date(d)
  out.setUTCDate(out.getUTCDate() + n)
  return out
}

function toYmd(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
}

// ──────────────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const url = request.nextUrl
    const { year, month } = parseMonth(url.searchParams.get('month'))
    const monthKey = `${year}-${String(month).padStart(2, '0')}`

    // Accept both ?pm=a,b and repeated ?pm[]=a&pm[]=b / ?pm=a&pm=b
    const pmRaw = url.searchParams.getAll('pm').concat(url.searchParams.getAll('pm[]'))
    const pmIds = Array.from(
      new Set(
        pmRaw
          .flatMap((v) => v.split(','))
          .map((s) => s.trim())
          .filter(Boolean)
      )
    )

    const builderRaw = url.searchParams.getAll('builder').concat(url.searchParams.getAll('builder[]'))
    const builderIds = Array.from(
      new Set(
        builderRaw
          .flatMap((v) => v.split(','))
          .map((s) => s.trim())
          .filter(Boolean)
      )
    )

    const hideClosed = url.searchParams.get('hideClosed') === '1'

    // Grid span: start-of-week containing 1st of month → end-of-week containing last day.
    // This yields up to 6 rows × 7 columns. Events outside the month (in padding days)
    // are still included so chips can render in the neighbor-month padding.
    const monthStart = startOfMonthUTC(year, month)
    const monthEnd = endOfMonthUTC(year, month)
    const gridStart = startOfMondayWeek(monthStart)
    const gridEnd = addDaysUTC(startOfMondayWeek(monthEnd), 7) // exclusive

    // ── Query jobs whose scheduledDate falls in the grid range ──────────────
    const jobWhere: any = {
      scheduledDate: { gte: gridStart, lt: gridEnd },
    }
    if (pmIds.length > 0) jobWhere.assignedPMId = { in: pmIds }
    if (builderIds.length > 0) {
      // Builder filter: match either the linked Builder id (via orderId→Order.builderId),
      // OR the denormalized builderName (rare — seed data sometimes has no FK). We don't
      // have a direct Job.builderId column, so we accept builderId strings that match the
      // denormalized builderName too, for robustness.
      jobWhere.OR = [
        { order: { is: { builderId: { in: builderIds } } } },
        { builderName: { in: builderIds } },
      ]
    }
    if (hideClosed) {
      jobWhere.status = { notIn: ['CLOSED', 'INVOICED'] as const }
    }

    const jobs = await prisma.job.findMany({
      where: jobWhere,
      select: {
        id: true,
        jobNumber: true,
        community: true,
        builderName: true,
        status: true,
        assignedPMId: true,
        scheduledDate: true,
      },
      orderBy: { scheduledDate: 'asc' },
      take: 2000, // hard cap — month view shouldn't exceed this
    })

    // Also fetch Hyphen closing dates for any jobs in the grid range. This
    // gives us close events — including close events for jobs whose
    // scheduledDate falls OUTSIDE the grid (we still want close chips
    // for those) as long as the closing date is inside.
    const hyphenCloses = await prisma.hyphenDocument.findMany({
      where: {
        closingDate: { gte: gridStart, lt: gridEnd },
        jobId: { not: null },
      },
      select: {
        jobId: true,
        closingDate: true,
      },
      orderBy: { scrapedAt: 'desc' },
    })

    // Pick the MOST RECENT closing date per jobId (scrapedAt desc).
    const closeByJob = new Map<string, Date>()
    for (const row of hyphenCloses) {
      if (row.jobId && row.closingDate && !closeByJob.has(row.jobId)) {
        closeByJob.set(row.jobId, row.closingDate)
      }
    }

    // Fetch close-only jobs (jobs referenced by close events but not already in `jobs`).
    const closeOnlyIds = [...closeByJob.keys()].filter((id) => !jobs.find((j) => j.id === id))
    let closeOnlyJobs: typeof jobs = []
    if (closeOnlyIds.length > 0) {
      const closeJobWhere: any = { id: { in: closeOnlyIds } }
      if (pmIds.length > 0) closeJobWhere.assignedPMId = { in: pmIds }
      if (builderIds.length > 0) {
        closeJobWhere.OR = [
          { order: { is: { builderId: { in: builderIds } } } },
          { builderName: { in: builderIds } },
        ]
      }
      if (hideClosed) {
        closeJobWhere.status = { notIn: ['CLOSED', 'INVOICED'] as const }
      }
      closeOnlyJobs = await prisma.job.findMany({
        where: closeJobWhere,
        select: {
          id: true,
          jobNumber: true,
          community: true,
          builderName: true,
          status: true,
          assignedPMId: true,
          scheduledDate: true,
        },
        take: 500,
      })
    }

    const allJobs = [...jobs, ...closeOnlyJobs]
    if (allJobs.length === 0) {
      const empty: CalendarResponse = {
        month: monthKey,
        range: { start: toYmd(gridStart), end: toYmd(addDaysUTC(gridEnd, -1)) },
        events: [],
      }
      return NextResponse.json(empty)
    }

    // ── Materials-ready derivation ──────────────────────────────────────────
    // Fetch all active allocation rows (RESERVED/BACKORDERED/PICKED/CONSUMED)
    // for these jobs in one shot, then bucket.
    const jobIds = allJobs.map((j) => j.id)

    const allocations = await prisma.inventoryAllocation.findMany({
      where: {
        jobId: { in: jobIds },
        status: { in: ['RESERVED', 'BACKORDERED', 'PICKED', 'CONSUMED'] },
      },
      select: {
        jobId: true,
        productId: true,
        quantity: true,
        status: true,
      },
    })

    // Gather all productIds whose "available" we need for the amber check
    const reservedProductIds = new Set<string>()
    for (const a of allocations) {
      if (a.status === 'RESERVED' && a.productId) reservedProductIds.add(a.productId)
    }
    const availByProduct = new Map<string, number>()
    if (reservedProductIds.size > 0) {
      const inv = await prisma.inventoryItem.findMany({
        where: { productId: { in: [...reservedProductIds] } },
        select: { productId: true, available: true },
      })
      for (const r of inv) availByProduct.set(r.productId, r.available ?? 0)
    }

    // Bucket allocations per job
    interface AllocBucket {
      reserved: number
      backordered: number
      picked: number
      consumed: number
      reservedByProduct: Map<string, number>
      total: number
    }
    const byJob = new Map<string, AllocBucket>()
    for (const a of allocations) {
      if (!a.jobId) continue
      let b = byJob.get(a.jobId)
      if (!b) {
        b = {
          reserved: 0,
          backordered: 0,
          picked: 0,
          consumed: 0,
          reservedByProduct: new Map(),
          total: 0,
        }
        byJob.set(a.jobId, b)
      }
      const q = a.quantity ?? 0
      b.total += q
      if (a.status === 'RESERVED') {
        b.reserved += q
        if (a.productId) {
          b.reservedByProduct.set(a.productId, (b.reservedByProduct.get(a.productId) ?? 0) + q)
        }
      } else if (a.status === 'BACKORDERED') {
        b.backordered += q
      } else if (a.status === 'PICKED') {
        b.picked += q
      } else if (a.status === 'CONSUMED') {
        b.consumed += q
      }
    }

    const deriveMaterials = (jobId: string): MaterialsStatus => {
      const b = byJob.get(jobId)
      if (!b || b.total === 0) return 'unknown'
      if (b.backordered > 0) return 'red'
      if (b.reserved > 0) {
        // Amber if stock CAN cover reserved for every product; red otherwise.
        for (const [pid, need] of b.reservedByProduct) {
          const have = availByProduct.get(pid) ?? 0
          if (have < need) return 'red'
        }
        return 'amber'
      }
      // Everything is PICKED or CONSUMED → green
      return 'green'
    }

    // ── Build events ───────────────────────────────────────────────────────
    const events: CalendarEvent[] = []
    const jobsById = new Map(allJobs.map((j) => [j.id, j]))
    const inGridRange = (d: Date) => d >= gridStart && d < gridEnd

    for (const job of allJobs) {
      const mat = deriveMaterials(job.id)

      // Start event (if scheduledDate within grid range)
      if (job.scheduledDate && inGridRange(job.scheduledDate)) {
        events.push({
          jobId: job.id,
          jobNumber: job.jobNumber,
          community: job.community,
          builderName: job.builderName,
          status: job.status,
          dateKind: 'start',
          date: toYmd(job.scheduledDate),
          materialsStatus: mat,
          assignedPMId: job.assignedPMId,
        })
      }

      // Close event (if a closing date exists and falls in grid)
      const close = closeByJob.get(job.id)
      if (close && inGridRange(close)) {
        events.push({
          jobId: job.id,
          jobNumber: job.jobNumber,
          community: job.community,
          builderName: job.builderName,
          status: job.status,
          dateKind: 'close',
          date: toYmd(close),
          materialsStatus: mat,
          assignedPMId: job.assignedPMId,
        })
      }
    }

    // Stable sort: by date, then start before close, then jobNumber
    events.sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? -1 : 1
      if (a.dateKind !== b.dateKind) return a.dateKind === 'start' ? -1 : 1
      return a.jobNumber.localeCompare(b.jobNumber)
    })

    // silence unused-var warning for jobsById (kept in case future clients want fast lookup)
    void jobsById

    const payload: CalendarResponse = {
      month: monthKey,
      range: { start: toYmd(gridStart), end: toYmd(addDaysUTC(gridEnd, -1)) },
      events,
    }

    return NextResponse.json(payload)
  } catch (err: any) {
    console.error('[GET /api/ops/calendar/jobs] error', err)
    return NextResponse.json(
      { error: err?.message ?? 'Failed to load calendar' },
      { status: 500 }
    )
  }
}
