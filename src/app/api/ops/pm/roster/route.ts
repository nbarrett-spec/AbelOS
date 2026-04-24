// ─────────────────────────────────────────────────────────────────────────────
// GET /api/ops/pm/roster
//
// Returns one row per active Project Manager with Monday-morning KPIs:
//   • activeJobs       — jobs assigned to PM where status NOT IN terminal set
//   • materialsReadyPct — % of active jobs with InventoryAllocation rollup = GREEN
//                         (matches the rollup used by /api/ops/pm/book/[staffId])
//   • closingThisWeek  — active jobs with HyphenDocument.closingDate in next 7d
//   • overdueTasks     — Task rows where jobId ∈ PM's jobs, dueDate < NOW(),
//                         status NOT IN (DONE, COMPLETE, CANCELLED)
//
// Primary PM selector:
//   role = 'PROJECT_MANAGER' OR department = 'PROJECT_MANAGEMENT' OR title ILIKE '%Project Manager%'
//   AND active = true
//
// Fallback: if 0 matches, return "staff who currently have any assignedPMId Jobs".
// This keeps the page populated even if someone's role flag drifts.
//
// Auth: /ops/* middleware already gates this. No privilege check — this page
// shows *all* active PMs, which is not sensitive (same info already visible on
// /ops/staff).
// ─────────────────────────────────────────────────────────────────────────────

export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'
import { safeJson } from '@/lib/safe-json'
import { logAudit } from '@/lib/audit'

interface RosterPM {
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

interface RosterResponse {
  asOf: string
  pms: RosterPM[]
  fallbackUsed: boolean
}

const TERMINAL_STATUSES = ['COMPLETE', 'INVOICED', 'CLOSED'] as const

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

export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  const viewerStaffId = request.headers.get('x-staff-id') || ''

  try {
    // ── 1. Primary PM selector ────────────────────────────────────────────
    // Role column is an enum (StaffRole), department is an enum (Department).
    // `title` is a free-form string we keyword-match. `roles` is the
    // comma-separated multi-role list (optional).
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

    // ── 2. Fallback — if the primary selector found nothing, pull any staff
    //    who currently have assignedPMId Jobs. Keeps the page alive if roles
    //    haven't been filled in cleanly.
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
      const body: RosterResponse = {
        asOf: new Date().toISOString(),
        pms: [],
        fallbackUsed,
      }
      return safeJson(body)
    }

    const pmIds = pmStaff.map((p) => p.id)

    // ── 3. All jobs for these PMs in one query ─────────────────────────────
    const jobs = await prisma.job.findMany({
      where: { assignedPMId: { in: pmIds } },
      select: {
        id: true,
        assignedPMId: true,
        status: true,
      },
    })

    // Index: jobId -> pmId, pmId -> jobIds
    const jobToPm = new Map<string, string>()
    const jobsByPm = new Map<string, Array<{ id: string; status: string }>>()
    for (const j of jobs) {
      if (!j.assignedPMId) continue
      jobToPm.set(j.id, j.assignedPMId)
      const arr = jobsByPm.get(j.assignedPMId) ?? []
      arr.push({ id: j.id, status: j.status })
      jobsByPm.set(j.assignedPMId, arr)
    }

    const allJobIds = jobs.map((j) => j.id)

    // ── 4. Allocations for all of these jobs in one query ──────────────────
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

    // ── 5. Closing dates (HyphenDocument.closingDate) per jobId ────────────
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
        // HyphenDocument may be missing in old snapshots — degrade silently.
        console.warn('[PM Roster] closingDate lookup skipped:', e)
      }
    }

    // ── 6. Overdue task counts per PM ──────────────────────────────────────
    // Do one query that returns jobId + count, then bucket by PM in-memory.
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
        console.warn('[PM Roster] overdue tasks lookup skipped:', e)
      }
    }

    // ── 7. Assemble per-PM KPIs ────────────────────────────────────────────
    const now = Date.now()
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000

    const pms: RosterPM[] = pmStaff.map((s) => {
      const pmJobs = jobsByPm.get(s.id) ?? []

      let activeJobs = 0
      let greenCount = 0
      let materialsConsidered = 0
      let closingThisWeek = 0

      for (const j of pmJobs) {
        const isActive = !TERMINAL_STATUSES.includes(j.status as any)
        if (!isActive) continue
        activeJobs++

        const allocs = allocByJob.get(j.id) ?? []
        if (allocs.length > 0) {
          materialsConsidered++
          if (rollupMaterials(allocs) === 'GREEN') greenCount++
        }

        const cd = closingByJob.get(j.id)
        if (cd) {
          const delta = cd.getTime() - now
          if (delta >= 0 && delta <= sevenDaysMs) closingThisWeek++
        }
      }

      const materialsReadyPct =
        materialsConsidered > 0
          ? Math.round((greenCount / materialsConsidered) * 100)
          : 0

      return {
        id: s.id,
        firstName: s.firstName,
        lastName: s.lastName,
        email: s.email,
        title: s.title,
        role: s.role,
        activeJobs,
        materialsReadyPct,
        closingThisWeek,
        overdueTasks: overdueByPm.get(s.id) ?? 0,
      }
    })

    const body: RosterResponse = {
      asOf: new Date().toISOString(),
      pms,
      fallbackUsed,
    }

    // Audit — non-blocking. Lightweight view event, no PII beyond count.
    logAudit({
      staffId: viewerStaffId,
      action: 'VIEW',
      entity: 'PMRoster',
      entityId: 'all',
      details: { pmCount: pms.length, fallbackUsed },
      ipAddress: request.headers.get('x-forwarded-for') || undefined,
      userAgent: request.headers.get('user-agent') || undefined,
      severity: 'INFO',
    }).catch(() => { /* non-blocking */ })

    return safeJson(body)
  } catch (error: any) {
    console.error('[PM Roster] Error:', error)
    return NextResponse.json(
      { error: 'Failed to load PM roster.', detail: error?.message },
      { status: 500 }
    )
  }
}
