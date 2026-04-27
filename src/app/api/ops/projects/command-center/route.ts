export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'
import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'

/**
 * GET /api/ops/projects/command-center
 *
 * PM Command Center feed — pivot is **Job**, not Project.
 * Project model in this DB is sparse (1 row); real PM work lives in Job with
 * `assignedPMId`. This endpoint groups every active Job by the PM who owns it
 * so execs see the whole book and PMs see their own shelf.
 *
 * Role rules:
 *   ADMIN / MANAGER    — defaults to all PMs; optional ?pmId=<staffId> filter
 *   PROJECT_MANAGER    — defaults to own jobs; ?all=1 or ?pmId=<self or other>
 *                        lets them opt into a peer view (read-only)
 *   Others             — self-scoped by default.
 *
 * Departed-staff handling: we still surface jobs assigned to inactive staff
 * under the original PM's name with an `pmActive=false` flag so the UI can tag
 * them as "ex-staff — needs reassignment".
 */
export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  const staffId = request.headers.get('x-staff-id') || ''
  const rolesHeader = (
    request.headers.get('x-staff-roles') ||
    request.headers.get('x-staff-role') ||
    ''
  ).toUpperCase()
  const isPrivileged = /ADMIN|MANAGER/.test(rolesHeader)

  const url = request.nextUrl
  const pmParam = url.searchParams.get('pmId')
  const allFlag = url.searchParams.get('all') === '1'

  // Resolve effective filter PM
  let pmFilterId: string | null = null
  if (isPrivileged) {
    pmFilterId = pmParam && pmParam !== 'all' ? pmParam : null
  } else {
    // Regular PMs: own by default; can opt into all via ?all=1 or another PM via ?pmId
    if (allFlag) pmFilterId = null
    else if (pmParam) pmFilterId = pmParam
    else pmFilterId = staffId || null
  }

  const activeJobStatuses = [
    'CREATED',
    'READINESS_CHECK',
    'MATERIALS_LOCKED',
    'IN_PRODUCTION',
    'STAGED',
    'LOADED',
    'IN_TRANSIT',
    'DELIVERED',
    'INSTALLING',
    'PUNCH_LIST',
  ] as const

  try {
    const now = new Date()

    const jobs = await prisma.job.findMany({
      where: {
        status: { in: activeJobStatuses as any },
        ...(pmFilterId ? { assignedPMId: pmFilterId } : {}),
      },
      select: {
        id: true,
        jobNumber: true,
        jobAddress: true,
        community: true,
        lotBlock: true,
        status: true,
        scheduledDate: true,
        builderName: true,
        createdAt: true,
        assignedPM: {
          select: { id: true, firstName: true, lastName: true, active: true, role: true },
        },
        order: {
          select: {
            id: true,
            orderNumber: true,
            status: true,
            total: true,
            paymentStatus: true,
          },
        },
      },
      orderBy: [{ scheduledDate: 'asc' }, { createdAt: 'desc' }],
      take: 2000,
    })

    // Pull allocation rollups in one shot — so each row can surface a
    // "materials short" flag without a per-job fetch.
    const jobIds = jobs.map((j) => j.id)
    const allocations: { jobId: string; status: string; quantity: number }[] =
      jobIds.length === 0
        ? []
        : ((await prisma.$queryRawUnsafe(
            `SELECT "jobId", status::text as status, SUM(quantity)::int as quantity
               FROM "InventoryAllocation"
              WHERE "jobId" = ANY($1)
              GROUP BY "jobId", status`,
            jobIds,
          )) as any[])

    const allocByJob = new Map<
      string,
      { reserved: number; backordered: number; picked: number; consumed: number }
    >()
    for (const a of allocations) {
      const bucket = allocByJob.get(a.jobId) || {
        reserved: 0,
        backordered: 0,
        picked: 0,
        consumed: 0,
      }
      if (a.status === 'RESERVED') bucket.reserved = a.quantity
      else if (a.status === 'BACKORDERED') bucket.backordered = a.quantity
      else if (a.status === 'PICKED') bucket.picked = a.quantity
      else if (a.status === 'CONSUMED') bucket.consumed = a.quantity
      allocByJob.set(a.jobId, bucket)
    }

    type Row = {
      projectId: string // jobId (kept key name for UI compat)
      jobId: string
      name: string
      planName: string | null
      lotNumber: string | null
      subdivision: string | null
      builderId: string
      builderName: string
      status: string
      pmId: string | null
      pmName: string | null
      pmActive: boolean | null
      jobCount: number
      overdueJobs: number
      nextMilestone: Date | null
      daysToNext: number | null
      alerts: string[]
      orderTotal: number | null
      materialShortQty: number | null
    }

    const rows: Row[] = jobs.map((j) => {
      const pm = j.assignedPM
      const pmActive = pm?.active ?? null
      const scheduledDate = j.scheduledDate
      const overdue =
        !!scheduledDate &&
        scheduledDate < now &&
        !['DELIVERED', 'INSTALLING', 'PUNCH_LIST'].includes(j.status as any)
      const daysToNext = scheduledDate
        ? Math.ceil((scheduledDate.getTime() - now.getTime()) / (24 * 60 * 60 * 1000))
        : null

      const alloc = allocByJob.get(j.id)
      const alerts: string[] = []
      if (overdue) alerts.push('overdue')
      if (j.order?.paymentStatus === 'OVERDUE') alerts.push('payment overdue')
      if (alloc?.backordered && alloc.backordered > 0) {
        alerts.push(`${alloc.backordered} short`)
      }
      if (pmActive === false) alerts.push('ex-staff PM')

      return {
        projectId: j.id,
        jobId: j.id,
        name: j.jobNumber || j.jobAddress || 'Untitled job',
        planName: null,
        lotNumber: j.lotBlock,
        subdivision: j.community,
        builderId: '', // builderId isn't directly on Job; builderName is
        builderName: j.builderName || '—',
        status: j.status,
        pmId: pm?.id ?? null,
        pmName: pm ? `${pm.firstName} ${pm.lastName}` : null,
        pmActive,
        jobCount: 1,
        overdueJobs: overdue ? 1 : 0,
        nextMilestone: scheduledDate,
        daysToNext,
        alerts,
        orderTotal: j.order?.total ? Number(j.order.total) : null,
        materialShortQty: alloc?.backordered ?? null,
      }
    })

    // Group by PM
    const pmGroups = new Map<
      string,
      { pmId: string | null; pmName: string; pmActive: boolean | null; projects: Row[] }
    >()
    for (const r of rows) {
      const k = r.pmId || 'unassigned'
      const g =
        pmGroups.get(k) ||
        {
          pmId: r.pmId,
          pmName: r.pmName || 'Unassigned',
          pmActive: r.pmActive,
          projects: [] as Row[],
        }
      g.projects.push(r)
      pmGroups.set(k, g)
    }

    const groups = Array.from(pmGroups.values()).sort((a, b) => {
      if (a.pmId === null) return 1
      if (b.pmId === null) return -1
      // Active PMs first, ex-staff last, alphabetical within each
      if (a.pmActive && !b.pmActive) return -1
      if (!a.pmActive && b.pmActive) return 1
      return a.pmName.localeCompare(b.pmName)
    })

    // Roster of PMs (for the picker in the UI). Returned only when privileged
    // so regular PMs don't leak the list — but we also include when the regular
    // PM has opted into the all-view (they need the picker to switch between
    // their own and a peer's view).
    let pmRoster:
      | Array<{ id: string; name: string; role: string; jobCount: number; active: boolean }>
      | null = null
    if (isPrivileged || allFlag) {
      // Wrapped in its own try/catch so a roster failure doesn't 500 the page.
      // Bug fixed 2026-04-27: previous call wrapped the params as
      // `[activeJobStatuses as any]` which Postgres saw as a 2-D text array
      // and failed type-coercion on `status::text = ANY ($1)`. Pass the
      // status list directly (matches the jobIds call above).
      try {
        const rosterRows: any[] = await prisma.$queryRawUnsafe(
          `
          SELECT s.id, s."firstName" || ' ' || s."lastName" AS name,
                 COALESCE(s.role::text, 'STAFF') AS role, s.active,
                 COUNT(j.id)::int AS job_count
          FROM "Staff" s
          LEFT JOIN "Job" j ON j."assignedPMId" = s.id
            AND j.status::text = ANY ($1)
          WHERE s.id IN (
            SELECT DISTINCT "assignedPMId" FROM "Job"
            WHERE "assignedPMId" IS NOT NULL
              AND status::text = ANY ($1)
          )
          GROUP BY s.id
          ORDER BY s.active DESC, job_count DESC, s."firstName" ASC
        `,
          Array.from(activeJobStatuses) as string[],
        )
        pmRoster = rosterRows.map((r) => ({
          id: r.id,
          name: r.name,
          role: r.role,
          active: r.active,
          jobCount: r.job_count,
        }))
      } catch (rosterErr: any) {
        // Don't fail the page over the picker. Log + leave roster null;
        // the UI will simply hide the picker.
        logger.error('projects_command_center_roster_failed', rosterErr, {
          isPrivileged,
          allFlag,
        })
        pmRoster = null
      }
    }

    return NextResponse.json({
      asOf: now.toISOString(),
      scope: pmFilterId ? 'pm' : 'all',
      pmFilterId,
      isPrivileged,
      viewerStaffId: staffId || null,
      total: rows.length,
      groups,
      pmRoster,
      summary: {
        totalProjects: rows.length,
        withAlerts: rows.filter((r) => r.alerts.length > 0).length,
        overdueTotal: rows.reduce((s, r) => s + r.overdueJobs, 0),
        unassigned: rows.filter((r) => !r.pmId).length,
        shortMaterial: rows.filter((r) => (r.materialShortQty ?? 0) > 0).length,
        exStaffPM: rows.filter((r) => r.pmActive === false).length,
      },
    })
  } catch (err: any) {
    logger.error('projects_command_center_failed', err, {
      pmFilterId,
      isPrivileged,
      staffId,
    })
    return NextResponse.json({ error: err?.message || 'failed' }, { status: 500 })
  }
}
