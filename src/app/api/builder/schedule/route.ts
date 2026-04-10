export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/auth'

/**
 * GET /api/builder/schedule
 * Returns all jobs, schedule entries, and deliveries for the authenticated builder.
 * Grouped for a visual timeline / Gantt view.
 *
 * Query params:
 *   ?from=2026-04-01&to=2026-06-30  (default: 60-day window)
 *   ?projectId=xxx                   (filter to single project)
 */
export async function GET(request: NextRequest) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const projectId = searchParams.get('projectId')

  // Default window: 30 days back, 60 days forward
  const now = new Date()
  const defaultFrom = new Date(now)
  defaultFrom.setDate(defaultFrom.getDate() - 30)
  const defaultTo = new Date(now)
  defaultTo.setDate(defaultTo.getDate() + 60)

  const from = searchParams.get('from')
    ? new Date(searchParams.get('from')!)
    : defaultFrom
  const to = searchParams.get('to')
    ? new Date(searchParams.get('to')!)
    : defaultTo

  try {
    // ── Jobs with schedule entries ──
    let jobQuery = `SELECT
        j.id, j."jobNumber", j.status, j."scopeType", j."jobAddress",
        j.community, j."builderName", j."scheduledDate", j."actualDate",
        j."completedAt", j."readinessCheck", j."materialsLocked", j."loadConfirmed",
        j."lotBlock", j."dropPlan",
        o."orderNumber", o.id as "orderId", o.total as "orderTotal",
        p.id as "projectId", p.name as "projectName"
      FROM "Job" j
      JOIN "Order" o ON j."orderId" = o.id
      JOIN "Quote" q ON o."quoteId" = q.id
      LEFT JOIN "Project" p ON q."projectId" = p.id
      WHERE o."builderId" = $1
        AND (j."scheduledDate" >= $2 OR j."scheduledDate" IS NULL)
        AND (j."scheduledDate" <= $3 OR j."scheduledDate" IS NULL)`

    const queryParams: any[] = [session.builderId, from.toISOString(), to.toISOString()]

    if (projectId) {
      jobQuery += ` AND q."projectId" = $4`
      queryParams.push(projectId)
    }

    jobQuery += ` ORDER BY COALESCE(j."scheduledDate", j."createdAt") ASC`

    const jobs: any[] = await prisma.$queryRawUnsafe(jobQuery, ...queryParams)

    const jobIds = jobs.map((j: any) => j.id)

    // ── Schedule entries for these jobs ──
    let scheduleEntries: any[] = []
    if (jobIds.length > 0) {
      scheduleEntries = await prisma.$queryRawUnsafe(
        `SELECT
          se.id, se."jobId", se."entryType", se.title,
          se."scheduledDate", se."scheduledTime", se.status,
          se.notes, se."startedAt", se."completedAt",
          c.name as "crewName", c."vehiclePlate"
        FROM "ScheduleEntry" se
        LEFT JOIN "Crew" c ON se."crewId" = c.id
        WHERE se."jobId" = ANY($1::text[])
        ORDER BY se."scheduledDate" ASC`,
        jobIds
      )
    }

    // ── Deliveries for these jobs ──
    let deliveries: any[] = []
    if (jobIds.length > 0) {
      deliveries = await prisma.$queryRawUnsafe(
        `SELECT
          d.id, d."jobId", d."deliveryNumber", d.status, d.address,
          d."departedAt", d."arrivedAt", d."completedAt",
          d."sitePhotos", d."signedBy",
          c.name as "crewName", c."vehiclePlate"
        FROM "Delivery" d
        LEFT JOIN "Crew" c ON d."crewId" = c.id
        WHERE d."jobId" = ANY($1::text[])
        ORDER BY d."createdAt" ASC`,
        jobIds
      )
    }

    // ── Group by job ──
    const scheduleByJob: Record<string, any[]> = {}
    for (const se of scheduleEntries) {
      if (!scheduleByJob[se.jobId]) scheduleByJob[se.jobId] = []
      scheduleByJob[se.jobId].push(se)
    }

    const deliveriesByJob: Record<string, any[]> = {}
    for (const d of deliveries) {
      if (!deliveriesByJob[d.jobId]) deliveriesByJob[d.jobId] = []
      deliveriesByJob[d.jobId].push(d)
    }

    // ── Build timeline items ──
    const timeline = jobs.map((job: any) => {
      const jobSchedule = scheduleByJob[job.id] || []
      const jobDeliveries = deliveriesByJob[job.id] || []

      // Compute milestones from job status
      const milestones = buildMilestones(job)

      return {
        id: job.id,
        jobNumber: job.jobNumber,
        status: job.status,
        scopeType: job.scopeType,
        address: job.jobAddress,
        community: job.community,
        lotBlock: job.lotBlock,
        dropPlan: job.dropPlan,
        orderNumber: job.orderNumber,
        orderId: job.orderId,
        orderTotal: job.orderTotal ? Number(job.orderTotal) : null,
        projectId: job.projectId,
        projectName: job.projectName,
        scheduledDate: job.scheduledDate,
        actualDate: job.actualDate,
        completedAt: job.completedAt,
        readinessCheck: job.readinessCheck,
        materialsLocked: job.materialsLocked,
        loadConfirmed: job.loadConfirmed,
        milestones,
        schedule: jobSchedule.map((se: any) => ({
          id: se.id,
          type: se.entryType,
          title: se.title,
          date: se.scheduledDate,
          time: se.scheduledTime,
          status: se.status,
          crew: se.crewName,
          vehicle: se.vehiclePlate,
          notes: se.notes,
          startedAt: se.startedAt,
          completedAt: se.completedAt,
        })),
        deliveries: jobDeliveries.map((d: any) => ({
          id: d.id,
          deliveryNumber: d.deliveryNumber,
          status: d.status,
          address: d.address,
          crew: d.crewName,
          vehicle: d.vehiclePlate,
          departedAt: d.departedAt,
          arrivedAt: d.arrivedAt,
          completedAt: d.completedAt,
          hasPhotos: Array.isArray(d.sitePhotos) && d.sitePhotos.length > 0,
          signedBy: d.signedBy,
        })),
      }
    })

    // ── Summary stats ──
    const stats = {
      totalJobs: timeline.length,
      activeJobs: timeline.filter(j =>
        !['COMPLETE', 'INVOICED', 'CLOSED'].includes(j.status)
      ).length,
      upcomingDeliveries: deliveries.filter(d =>
        ['SCHEDULED', 'LOADING'].includes(d.status)
      ).length,
      inTransit: deliveries.filter(d =>
        ['IN_TRANSIT', 'ARRIVED', 'UNLOADING'].includes(d.status)
      ).length,
      completedThisMonth: timeline.filter(j => {
        if (!j.completedAt) return false
        const completed = new Date(j.completedAt)
        return completed.getMonth() === now.getMonth() && completed.getFullYear() === now.getFullYear()
      }).length,
    }

    // ── Projects list for filter ──
    const projects: any[] = await prisma.$queryRawUnsafe(
      `SELECT DISTINCT p.id, p.name
       FROM "Project" p
       JOIN "Quote" q ON q."projectId" = p.id
       JOIN "Order" o ON o."quoteId" = q.id
       JOIN "Job" j ON j."orderId" = o.id
       WHERE o."builderId" = $1
       ORDER BY p.name ASC`,
      session.builderId
    )

    return NextResponse.json({
      timeline,
      stats,
      projects,
      dateRange: { from: from.toISOString(), to: to.toISOString() },
    })
  } catch (error) {
    console.error('Error fetching builder schedule:', error)
    return NextResponse.json({ error: 'Failed to fetch schedule' }, { status: 500 })
  }
}

// ── Milestone builder from job status workflow ──
function buildMilestones(job: any) {
  const statuses = [
    'CREATED', 'READINESS_CHECK', 'MATERIALS_LOCKED', 'IN_PRODUCTION',
    'STAGED', 'LOADED', 'IN_TRANSIT', 'DELIVERED', 'INSTALLING',
    'PUNCH_LIST', 'COMPLETE', 'INVOICED', 'CLOSED',
  ]

  const labels: Record<string, string> = {
    CREATED: 'Order Created',
    READINESS_CHECK: 'Readiness Check (T-72)',
    MATERIALS_LOCKED: 'Materials Locked (T-48)',
    IN_PRODUCTION: 'In Production',
    STAGED: 'Staged for Loading',
    LOADED: 'Loaded on Truck',
    IN_TRANSIT: 'In Transit',
    DELIVERED: 'Delivered to Site',
    INSTALLING: 'Installation',
    PUNCH_LIST: 'Punch List',
    COMPLETE: 'Complete',
    INVOICED: 'Invoiced',
    CLOSED: 'Closed',
  }

  const currentIdx = statuses.indexOf(job.status)

  return statuses.map((s, i) => ({
    key: s,
    label: labels[s] || s,
    status: i < currentIdx ? 'done' : i === currentIdx ? 'current' : 'upcoming',
    active: i <= currentIdx,
  }))
}
