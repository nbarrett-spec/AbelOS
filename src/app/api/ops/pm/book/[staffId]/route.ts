export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'
import { safeJson } from '@/lib/safe-json'
import { logAudit } from '@/lib/audit'

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/ops/pm/book/:staffId
//
// Returns one PM's full workload: staff card, 4 KPIs, and a row per active job
// with materials-ready signal, closing date, and last activity.
//
// Auth: staff session required. PMs may read their own book; ADMIN/MANAGER may
// read any PM's book.
//
// Data source:
//   • Staff          — name + role
//   • Job            — rows where assignedPMId = :staffId
//   • InventoryAllocation — rolled up per job to derive GREEN / AMBER / RED
//   • HyphenDocument — latest closingDate per jobId (Brookfield jobs)
//   • AuditLog       — last entry where entity='Job' and entityId=job.id
// ─────────────────────────────────────────────────────────────────────────────

type MaterialsStatus = 'GREEN' | 'AMBER' | 'RED' | 'NONE'

interface JobRow {
  id: string
  jobNumber: string
  community: string | null
  lotBlock: string | null
  builderName: string
  status: string
  materialsStatus: MaterialsStatus
  materialsBreakdown: {
    total: number
    picked: number
    consumed: number
    reserved: number
    backordered: number
    other: number
  }
  closingDate: string | null
  scheduledDate: string | null
  lastActivityAt: string | null
  updatedAt: string
}

interface BookResponse {
  staff: {
    id: string
    firstName: string
    lastName: string
    email: string
    title: string | null
    role: string
  } | null
  asOf: string
  summary: {
    activeJobs: number
    materialsReadyPct: number
    closingThisWeek: number
    overdueActions: number
  }
  jobs: JobRow[]
}

// Terminal statuses — excluded from "active jobs"
const TERMINAL_STATUSES = ['COMPLETE', 'INVOICED', 'CLOSED'] as const

// Allocation status rollup — ready (green) vs shortage (red)
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

export async function GET(
  request: NextRequest,
  { params }: { params: { staffId: string } }
) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  const viewerStaffId = request.headers.get('x-staff-id') || ''
  const rolesHeader = (
    request.headers.get('x-staff-roles') ||
    request.headers.get('x-staff-role') ||
    ''
  ).toUpperCase()
  const isPrivileged = /ADMIN|MANAGER/.test(rolesHeader)

  const targetStaffId = params.staffId

  // PMs can only view their own book. Admin/Manager can view any PM.
  if (!isPrivileged && viewerStaffId !== targetStaffId) {
    return NextResponse.json(
      { error: 'You can only view your own book.' },
      { status: 403 }
    )
  }

  try {
    // ── 1. Staff record ──
    const staff = await prisma.staff.findUnique({
      where: { id: targetStaffId },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        title: true,
        role: true,
      },
    })

    if (!staff) {
      return NextResponse.json(
        { error: `Staff ${targetStaffId} not found.` },
        { status: 404 }
      )
    }

    // ── 2. All jobs assigned to this PM (active + recently closed for context) ──
    const jobs = await prisma.job.findMany({
      where: { assignedPMId: targetStaffId },
      select: {
        id: true,
        jobNumber: true,
        community: true,
        lotBlock: true,
        builderName: true,
        status: true,
        scheduledDate: true,
        updatedAt: true,
      },
      orderBy: { updatedAt: 'desc' },
    })

    const jobIds = jobs.map((j) => j.id)

    // ── 3. Material allocation rollup (one query, grouped in-memory) ──
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

    // ── 4. Closing dates from HyphenDocument ──
    // Use $queryRawUnsafe to get max(closingDate) per jobId in one pass
    let closingByJob = new Map<string, Date>()
    if (jobIds.length > 0) {
      try {
        const closingRows: Array<{ jobId: string; closingDate: Date | null }> =
          await prisma.$queryRawUnsafe(
            `SELECT "jobId", MAX("closingDate") AS "closingDate"
               FROM "HyphenDocument"
              WHERE "jobId" = ANY($1::text[])
                AND "closingDate" IS NOT NULL
              GROUP BY "jobId"`,
            jobIds
          )
        for (const row of closingRows) {
          if (row.jobId && row.closingDate) {
            closingByJob.set(row.jobId, row.closingDate)
          }
        }
      } catch (e) {
        // HyphenDocument table may not exist in very old snapshots — skip quietly.
        console.warn('[PM Book] closingDate lookup skipped:', e)
      }
    }

    // ── 5. Last activity — most recent AuditLog entry per job ──
    let lastActivityByJob = new Map<string, Date>()
    if (jobIds.length > 0) {
      try {
        const actRows: Array<{ entityId: string; createdAt: Date }> =
          await prisma.$queryRawUnsafe(
            `SELECT DISTINCT ON ("entityId") "entityId", "createdAt"
               FROM "AuditLog"
              WHERE "entity" = 'Job'
                AND "entityId" = ANY($1::text[])
              ORDER BY "entityId", "createdAt" DESC`,
            jobIds
          )
        for (const row of actRows) {
          if (row.entityId && row.createdAt) {
            lastActivityByJob.set(row.entityId, row.createdAt)
          }
        }
      } catch (e) {
        console.warn('[PM Book] lastActivity lookup skipped:', e)
      }
    }

    // ── 6. Overdue tasks (tasks assigned to jobs owned by this PM, past due) ──
    let overdueActions = 0
    if (jobIds.length > 0) {
      try {
        const overdueRows: Array<{ c: number }> = await prisma.$queryRawUnsafe(
          `SELECT COUNT(*)::int AS c
             FROM "Task" t
            WHERE t."jobId" = ANY($1::text[])
              AND t."status"::text NOT IN ('COMPLETE', 'CANCELLED')
              AND t."dueDate" IS NOT NULL
              AND t."dueDate" < NOW()`,
          jobIds
        )
        overdueActions = overdueRows[0]?.c ?? 0
      } catch (e) {
        console.warn('[PM Book] overdue tasks lookup skipped:', e)
      }
    }

    // ── 7. Assemble rows + derive KPIs ──
    const now = Date.now()
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000

    let activeJobsCount = 0
    let greenCount = 0
    let materialsConsideredCount = 0
    let closingThisWeek = 0

    const rows: JobRow[] = jobs.map((j) => {
      const jobAllocs = allocByJob.get(j.id) ?? []
      const total = jobAllocs.length
      let picked = 0
      let consumed = 0
      let reserved = 0
      let backordered = 0
      let other = 0
      for (const a of jobAllocs) {
        const s = (a.status || '').toUpperCase()
        if (s === 'PICKED') picked++
        else if (s === 'CONSUMED') consumed++
        else if (s === 'RESERVED') reserved++
        else if (s === 'BACKORDERED') backordered++
        else other++
      }
      const materialsStatus = rollupMaterials(jobAllocs)
      const closingDate = closingByJob.get(j.id) ?? null
      const lastActivityAt = lastActivityByJob.get(j.id) ?? null

      const isActive = !TERMINAL_STATUSES.includes(j.status as any)
      if (isActive) activeJobsCount++
      if (isActive && total > 0) {
        materialsConsideredCount++
        if (materialsStatus === 'GREEN') greenCount++
      }
      if (isActive && closingDate) {
        const delta = closingDate.getTime() - now
        if (delta >= 0 && delta <= sevenDaysMs) closingThisWeek++
      }

      return {
        id: j.id,
        jobNumber: j.jobNumber,
        community: j.community,
        lotBlock: j.lotBlock,
        builderName: j.builderName,
        status: j.status,
        materialsStatus,
        materialsBreakdown: {
          total,
          picked,
          consumed,
          reserved,
          backordered,
          other,
        },
        closingDate: closingDate ? closingDate.toISOString() : null,
        scheduledDate: j.scheduledDate ? j.scheduledDate.toISOString() : null,
        lastActivityAt: lastActivityAt ? lastActivityAt.toISOString() : null,
        updatedAt: j.updatedAt.toISOString(),
      }
    })

    const materialsReadyPct =
      materialsConsideredCount > 0
        ? Math.round((greenCount / materialsConsideredCount) * 100)
        : 0

    const body: BookResponse = {
      staff,
      asOf: new Date().toISOString(),
      summary: {
        activeJobs: activeJobsCount,
        materialsReadyPct,
        closingThisWeek,
        overdueActions,
      },
      jobs: rows,
    }

    // ── 8. Audit trail — PM book views are sensitive workload snapshots ──
    // Fire-and-forget so audit failures never break the read path.
    logAudit({
      staffId: viewerStaffId,
      action: 'VIEW',
      entity: 'PMBook',
      entityId: targetStaffId,
      details: {
        targetStaffId,
        targetStaffName: `${staff.firstName} ${staff.lastName}`,
        activeJobs: activeJobsCount,
        crossPM: viewerStaffId !== targetStaffId,
      },
      ipAddress: request.headers.get('x-forwarded-for') || undefined,
      userAgent: request.headers.get('user-agent') || undefined,
      severity: 'INFO',
    }).catch(() => { /* non-blocking */ })

    return safeJson(body)
  } catch (error: any) {
    console.error('[PM Book] Error:', error)
    return NextResponse.json(
      { error: 'Failed to load PM book.', detail: error?.message },
      { status: 500 }
    )
  }
}
