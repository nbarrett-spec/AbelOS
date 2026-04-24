// ─────────────────────────────────────────────────────────────────────────────
// GET /api/ops/pm/compare
//
// Multi-PM comparison table data. One row per active Project Manager with a
// superset of the roster KPIs plus a few "book-shape" health metrics so the
// exec can answer "who's overloaded / who needs help / whose book is in the
// best/worst shape" from one page.
//
// Metrics per PM:
//   • activeJobs         — Job rows where assignedPMId = PM AND status NOT IN
//                          (COMPLETE, INVOICED, CLOSED)
//   • totalJobDollars    — Σ Order.total over distinct orderIds for this PM's
//                          active jobs. One order can seed multiple jobs; we
//                          count each order's total once per PM.
//   • materialsReadyPct  — % of active jobs whose InventoryAllocation rollup
//                          is GREEN (same logic as /api/ops/pm/book + roster).
//                          Denominator is "active jobs that have any alloc".
//   • redJobs            — Active jobs with ≥1 BACKORDERED allocation.
//   • overdueTasks       — Task rows where jobId ∈ PM's jobs, status NOT IN
//                          (DONE, COMPLETE, CANCELLED), dueDate < NOW().
//   • closingsThisWeek   — Active jobs with HyphenDocument.closingDate within
//                          the next 7d.
//   • avgDaysToClose     — Avg (Job.updatedAt − Job.createdAt) in whole days,
//                          restricted to jobs with status IN (CLOSED,INVOICED).
//                          Historical signal, not dependent on YTD filter.
//   • ytdCompleted       — Count of jobs with status IN (COMPLETE, INVOICED,
//                          CLOSED) AND updatedAt ≥ Jan 1 of current year.
//
// Primary PM selector (same as /api/ops/pm/roster):
//   role = PROJECT_MANAGER OR department = PROJECT_MANAGEMENT
//     OR title ILIKE '%Project Manager%'
//     OR roles CONTAINS 'PROJECT_MANAGER'
//   AND active = true
//
// Fallback: if 0 matches, return "staff who currently have any assignedPMId
// Jobs". Keeps the page populated even if role flags drift.
//
// Auth: checkStaffAuth (/ops/* middleware already gates this). No extra
// privilege check — this is the same info already exposed on /ops/pm, just
// in a different shape.
// ─────────────────────────────────────────────────────────────────────────────

export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'
import { safeJson } from '@/lib/safe-json'
import { logAudit } from '@/lib/audit'

export interface ComparePM {
  staffId: string
  firstName: string
  lastName: string
  email: string
  title: string | null
  role: string
  activeJobs: number
  totalJobDollars: number
  materialsReadyPct: number
  redJobs: number
  overdueTasks: number
  closingsThisWeek: number
  avgDaysToClose: number | null
  ytdCompleted: number
}

export interface CompareResponse {
  asOf: string
  monthKey: string
  pms: ComparePM[]
  fallbackUsed: boolean
}

const TERMINAL_STATUSES = ['COMPLETE', 'INVOICED', 'CLOSED'] as const
const CLOSED_SET = new Set<string>(TERMINAL_STATUSES)

const READY_ALLOC = new Set(['PICKED', 'CONSUMED'])
const SHORTAGE_ALLOC = new Set(['BACKORDERED'])
const PENDING_ALLOC = new Set(['RESERVED'])

type MaterialsStatus = 'GREEN' | 'AMBER' | 'RED' | 'NONE'

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

function monthKey(d: Date): string {
  // e.g. "2026-04" — matches the header the comparison page prints.
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  return `${y}-${m}`
}

export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  const viewerStaffId = request.headers.get('x-staff-id') || ''

  try {
    // ── 1. Primary PM selector ─────────────────────────────────────────────
    let pmStaff = await prisma.staff.findMany({
      where: {
        active: true,
        OR: [
          { role: 'PROJECT_MANAGER' },
          { department: 'PROJECT_MANAGEMENT' },
          { title: { contains: 'Project Manager', mode: 'insensitive' } },
          { roles: { contains: 'PROJECT_MANAGER' } },
        ],
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        title: true,
        role: true,
      },
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
    })

    // ── 2. Fallback if the primary selector is empty ───────────────────────
    let fallbackUsed = false
    if (pmStaff.length === 0) {
      fallbackUsed = true
      const withJobs = await prisma.job.findMany({
        where: { assignedPMId: { not: null } },
        select: { assignedPMId: true },
        distinct: ['assignedPMId'],
      })
      const ids = withJobs
        .map((j) => j.assignedPMId)
        .filter((x): x is string => !!x)
      if (ids.length > 0) {
        pmStaff = await prisma.staff.findMany({
          where: { id: { in: ids }, active: true },
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            title: true,
            role: true,
          },
          orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
        })
      }
    }

    if (pmStaff.length === 0) {
      const body: CompareResponse = {
        asOf: new Date().toISOString(),
        monthKey: monthKey(new Date()),
        pms: [],
        fallbackUsed,
      }
      return safeJson(body)
    }

    // Safety bound — the task brief says ≤20 PMs, but cap anyway so a bad
    // staff state can't blow up the page.
    const pmIds = pmStaff.slice(0, 50).map((p) => p.id)
    if (pmIds.length < pmStaff.length) {
      pmStaff = pmStaff.slice(0, 50)
    }

    // ── 3. All jobs for these PMs ──────────────────────────────────────────
    const jobs = await prisma.job.findMany({
      where: { assignedPMId: { in: pmIds } },
      select: {
        id: true,
        assignedPMId: true,
        status: true,
        orderId: true,
        createdAt: true,
        updatedAt: true,
      },
    })

    // Index helpers
    const jobToPm = new Map<string, string>()
    const jobsByPm = new Map<
      string,
      Array<{
        id: string
        status: string
        orderId: string | null
        createdAt: Date
        updatedAt: Date
      }>
    >()
    for (const j of jobs) {
      if (!j.assignedPMId) continue
      jobToPm.set(j.id, j.assignedPMId)
      const arr = jobsByPm.get(j.assignedPMId) ?? []
      arr.push({
        id: j.id,
        status: j.status,
        orderId: j.orderId,
        createdAt: j.createdAt,
        updatedAt: j.updatedAt,
      })
      jobsByPm.set(j.assignedPMId, arr)
    }

    const allJobIds = jobs.map((j) => j.id)

    // ── 4. Allocations for all jobs (single query) ─────────────────────────
    const allocRows =
      allJobIds.length === 0
        ? []
        : await prisma.inventoryAllocation.findMany({
            where: { jobId: { in: allJobIds } },
            select: { jobId: true, status: true },
          })

    const allocByJob = new Map<string, Array<{ status: string | null }>>()
    for (const a of allocRows) {
      if (!a.jobId) continue
      const arr = allocByJob.get(a.jobId) ?? []
      arr.push({ status: a.status })
      allocByJob.set(a.jobId, arr)
    }

    // ── 5. Order totals — distinct orderIds across all jobs ────────────────
    //    We pull each order's total exactly once and bucket by PM by walking
    //    each PM's active jobs' distinct orderIds.
    const orderIds = Array.from(
      new Set(jobs.map((j) => j.orderId).filter((x): x is string => !!x))
    )
    const orderTotals = new Map<string, number>()
    if (orderIds.length > 0) {
      const orders = await prisma.order.findMany({
        where: { id: { in: orderIds } },
        select: { id: true, total: true },
      })
      for (const o of orders) {
        orderTotals.set(o.id, o.total ?? 0)
      }
    }

    // ── 6. Closing dates per job (HyphenDocument) ──────────────────────────
    const closingByJob = new Map<string, Date>()
    if (allJobIds.length > 0) {
      try {
        const closingRows: Array<{ jobId: string; closingDate: Date | null }> =
          await prisma.$queryRawUnsafe(
            `SELECT "jobId", MAX("closingDate") AS "closingDate"
               FROM "HyphenDocument"
              WHERE "jobId" = ANY($1::text[])
                AND "closingDate" IS NOT NULL
              GROUP BY "jobId"`,
            allJobIds
          )
        for (const row of closingRows) {
          if (row.jobId && row.closingDate) {
            closingByJob.set(row.jobId, row.closingDate)
          }
        }
      } catch (e) {
        console.warn('[PM Compare] closingDate lookup skipped:', e)
      }
    }

    // ── 7. Overdue task counts per PM ──────────────────────────────────────
    const overdueByPm = new Map<string, number>()
    if (allJobIds.length > 0) {
      try {
        const overdueRows: Array<{ jobId: string; c: number }> =
          await prisma.$queryRawUnsafe(
            `SELECT t."jobId" AS "jobId", COUNT(*)::int AS c
               FROM "Task" t
              WHERE t."jobId" = ANY($1::text[])
                AND t."status"::text NOT IN ('DONE', 'COMPLETE', 'CANCELLED')
                AND t."dueDate" IS NOT NULL
                AND t."dueDate" < NOW()
              GROUP BY t."jobId"`,
            allJobIds
          )
        for (const row of overdueRows) {
          if (!row.jobId) continue
          const pmId = jobToPm.get(row.jobId)
          if (!pmId) continue
          overdueByPm.set(pmId, (overdueByPm.get(pmId) ?? 0) + Number(row.c))
        }
      } catch (e) {
        console.warn('[PM Compare] overdue tasks lookup skipped:', e)
      }
    }

    // ── 8. Assemble per-PM metrics ─────────────────────────────────────────
    const now = Date.now()
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000
    const msPerDay = 24 * 60 * 60 * 1000
    const ytdStartMs = Date.UTC(new Date().getUTCFullYear(), 0, 1)

    const pms: ComparePM[] = pmStaff.map((s) => {
      const pmJobs = jobsByPm.get(s.id) ?? []

      let activeJobs = 0
      let greenCount = 0
      let materialsConsidered = 0
      let redJobs = 0
      let closingsThisWeek = 0
      let ytdCompleted = 0
      let closeDaysSum = 0
      let closeDaysN = 0

      // Distinct order totals per PM — one order may seed multiple jobs.
      const seenOrderIds = new Set<string>()
      let totalJobDollars = 0

      for (const j of pmJobs) {
        const isActive = !CLOSED_SET.has(j.status)
        const isClosed = CLOSED_SET.has(j.status)

        if (isClosed) {
          // Historical avg time-to-close (CLOSED or INVOICED only, not COMPLETE
          // — spec calls out CLOSED/INVOICED).
          if (j.status === 'CLOSED' || j.status === 'INVOICED') {
            const days = Math.max(
              0,
              Math.round((j.updatedAt.getTime() - j.createdAt.getTime()) / msPerDay)
            )
            closeDaysSum += days
            closeDaysN += 1
          }

          if (j.updatedAt.getTime() >= ytdStartMs) {
            ytdCompleted += 1
          }
          continue
        }

        if (!isActive) continue
        activeJobs++

        // Order $ — only from active jobs, distinct orderIds.
        if (j.orderId && !seenOrderIds.has(j.orderId)) {
          seenOrderIds.add(j.orderId)
          totalJobDollars += orderTotals.get(j.orderId) ?? 0
        }

        const allocs = allocByJob.get(j.id) ?? []
        if (allocs.length > 0) {
          materialsConsidered++
          const roll = rollupMaterials(allocs)
          if (roll === 'GREEN') greenCount++
          if (roll === 'RED') redJobs++
        }

        const cd = closingByJob.get(j.id)
        if (cd) {
          const delta = cd.getTime() - now
          if (delta >= 0 && delta <= sevenDaysMs) closingsThisWeek++
        }
      }

      const materialsReadyPct =
        materialsConsidered > 0
          ? Math.round((greenCount / materialsConsidered) * 100)
          : 0

      const avgDaysToClose =
        closeDaysN > 0 ? Math.round(closeDaysSum / closeDaysN) : null

      return {
        staffId: s.id,
        firstName: s.firstName,
        lastName: s.lastName,
        email: s.email,
        title: s.title,
        role: s.role,
        activeJobs,
        totalJobDollars: Math.round(totalJobDollars * 100) / 100,
        materialsReadyPct,
        redJobs,
        overdueTasks: overdueByPm.get(s.id) ?? 0,
        closingsThisWeek,
        avgDaysToClose,
        ytdCompleted,
      }
    })

    const now2 = new Date()
    const body: CompareResponse = {
      asOf: now2.toISOString(),
      monthKey: monthKey(now2),
      pms,
      fallbackUsed,
    }

    // Audit — non-blocking. Low-sensitivity view event.
    logAudit({
      staffId: viewerStaffId,
      action: 'VIEW',
      entity: 'PMCompare',
      entityId: 'all',
      details: { pmCount: pms.length, fallbackUsed },
      ipAddress: request.headers.get('x-forwarded-for') || undefined,
      userAgent: request.headers.get('user-agent') || undefined,
      severity: 'INFO',
    }).catch(() => {
      /* non-blocking */
    })

    return safeJson(body)
  } catch (error: any) {
    console.error('[PM Compare] Error:', error)
    return NextResponse.json(
      { error: 'Failed to load PM comparison.', detail: error?.message },
      { status: 500 }
    )
  }
}
