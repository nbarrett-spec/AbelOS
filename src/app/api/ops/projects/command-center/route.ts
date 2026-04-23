export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'
import { prisma } from '@/lib/prisma'

/**
 * GET /api/ops/projects/command-center
 *
 * Returns, for every active Project, the assigned PM, builder, stage,
 * next milestone and an alert bag (overdue jobs, stockouts, payment).
 *
 * Grouped by PM in the response so the UI can render a sectioned list.
 */
export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  const staffId = request.headers.get('x-staff-id') || ''
  const rolesHeader = (request.headers.get('x-staff-roles') || request.headers.get('x-staff-role') || '').toUpperCase()
  const isPrivileged = /ADMIN|MANAGER/.test(rolesHeader)
  const allOverride = request.nextUrl.searchParams.get('all') === '1' && isPrivileged
  // Scope to this PM unless caller is ADMIN/MANAGER with ?all=1 (or no staff id).
  const pmFilterId = !isPrivileged && staffId
    ? staffId
    : (allOverride ? null : (isPrivileged ? null : staffId))

  try {
    const activeStatuses: any[] = [
      'DRAFT',
      'BLUEPRINT_UPLOADED',
      'TAKEOFF_PENDING',
      'TAKEOFF_COMPLETE',
      'QUOTE_GENERATED',
      'QUOTE_APPROVED',
      'ORDERED',
      'IN_PROGRESS',
      'DELIVERED',
    ]

    // If scoped to a PM, restrict Projects to those that have at least one Job
    // assigned to this PM (via quote.order.jobs). We pre-compute the eligible
    // projectIds so findMany stays readable.
    let projectIdFilter: { in: string[] } | undefined = undefined
    if (pmFilterId) {
      const scopedProjectIds: any[] = await prisma.$queryRawUnsafe(
        `
          SELECT DISTINCT q."projectId" AS id
          FROM "Job" j
          JOIN "Order" o ON j."orderId" = o."id"
          JOIN "Quote" q ON o."quoteId" = q."id"
          WHERE j."assignedPMId" = $1
            AND q."projectId" IS NOT NULL
        `,
        pmFilterId,
      )
      const ids = scopedProjectIds.map((r: any) => r.id).filter(Boolean) as string[]
      // If the PM owns zero projects, force an empty result instead of
      // returning the whole table.
      projectIdFilter = { in: ids.length ? ids : ['__none__'] }
    }

    const projects = await prisma.project.findMany({
      where: {
        status: { in: activeStatuses },
        ...(projectIdFilter ? { id: projectIdFilter } : {}),
      },
      select: {
        id: true,
        name: true,
        status: true,
        planName: true,
        lotNumber: true,
        subdivision: true,
        updatedAt: true,
        builder: { select: { id: true, companyName: true } },
        quotes: {
          select: {
            id: true,
            quoteNumber: true,
            status: true,
            total: true,
            order: {
              select: {
                id: true,
                orderNumber: true,
                status: true,
                total: true,
                deliveryDate: true,
                paymentStatus: true,
                jobs: {
                  select: {
                    id: true,
                    jobNumber: true,
                    status: true,
                    scheduledDate: true,
                    assignedPM: {
                      select: { id: true, firstName: true, lastName: true },
                    },
                  },
                },
              },
            },
          },
        },
      },
      orderBy: { updatedAt: 'desc' },
      take: 400,
    })

    // Flatten jobs + figure out assigned PM per project
    const now = new Date()
    const rows = projects.map((p) => {
      const jobs = p.quotes.flatMap((q) => (q.order?.jobs || []).map((j) => ({
        ...j,
        orderNumber: q.order?.orderNumber,
        orderStatus: q.order?.status,
        deliveryDate: q.order?.deliveryDate,
      })))
      // Use first assigned PM as the primary; pick first job's PM for grouping
      const primaryPM = jobs.find((j) => j.assignedPM)?.assignedPM || null

      const order = p.quotes[0]?.order || null
      const overdueJobs = jobs.filter(
        (j) => j.scheduledDate && j.scheduledDate < now && !['COMPLETE', 'CLOSED', 'INVOICED'].includes(j.status)
      ).length

      // Next milestone: earliest future scheduledDate
      const future = jobs
        .map((j) => j.scheduledDate)
        .filter((d): d is Date => !!d && d > now)
        .sort((a, b) => a.getTime() - b.getTime())
      const nextMilestone = future[0] || null
      const daysToNext = nextMilestone
        ? Math.ceil((nextMilestone.getTime() - now.getTime()) / (24 * 60 * 60 * 1000))
        : null

      const paymentAlert = p.quotes.some(
        (q) => q.order?.paymentStatus === 'OVERDUE'
      )

      const alerts: string[] = []
      if (overdueJobs) alerts.push(`${overdueJobs} overdue job${overdueJobs === 1 ? '' : 's'}`)
      if (paymentAlert) alerts.push('payment overdue')

      return {
        projectId: p.id,
        name: p.name,
        planName: p.planName,
        lotNumber: p.lotNumber,
        subdivision: p.subdivision,
        builderId: p.builder.id,
        builderName: p.builder.companyName,
        status: p.status,
        pmId: primaryPM?.id || null,
        pmName: primaryPM ? `${primaryPM.firstName} ${primaryPM.lastName}` : null,
        jobCount: jobs.length,
        overdueJobs,
        nextMilestone,
        daysToNext,
        alerts,
        orderTotal: order?.total ?? null,
      }
    })

    // Group by PM
    const pmGroups = new Map<
      string,
      { pmId: string | null; pmName: string; projects: typeof rows }
    >()
    for (const r of rows) {
      const k = r.pmId || 'unassigned'
      const g = pmGroups.get(k) || {
        pmId: r.pmId,
        pmName: r.pmName || 'Unassigned',
        projects: [],
      }
      g.projects.push(r)
      pmGroups.set(k, g)
    }

    const groups = Array.from(pmGroups.values()).sort((a, b) => {
      if (a.pmId === null) return 1
      if (b.pmId === null) return -1
      return a.pmName.localeCompare(b.pmName)
    })

    return NextResponse.json({
      asOf: now.toISOString(),
      scope: pmFilterId ? 'pm' : 'all',
      total: rows.length,
      groups,
      summary: {
        totalProjects: rows.length,
        withAlerts: rows.filter((r) => r.alerts.length > 0).length,
        overdueTotal: rows.reduce((s, r) => s + r.overdueJobs, 0),
        unassigned: rows.filter((r) => !r.pmId).length,
      },
    })
  } catch (err: any) {
    console.error('[projects command-center] error', err)
    return NextResponse.json({ error: err?.message || 'failed' }, { status: 500 })
  }
}
