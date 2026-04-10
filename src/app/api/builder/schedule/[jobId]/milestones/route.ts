export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/auth'

/**
 * GET /api/builder/schedule/[jobId]/milestones
 * Full milestone + activity detail for a single job.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { jobId: string } }
) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  const jobId = params.jobId

  try {
    // Verify builder owns this job (through order)
    const jobs: any[] = await prisma.$queryRawUnsafe(
      `SELECT j.*, o."orderNumber", o.total,
              p.name as "projectName", p."jobAddress" as "projectAddress"
       FROM "Job" j
       JOIN "Order" o ON j."orderId" = o.id
       JOIN "Quote" q ON o."quoteId" = q.id
       LEFT JOIN "Project" p ON q."projectId" = p.id
       WHERE j.id = $1 AND o."builderId" = $2
       LIMIT 1`,
      jobId,
      session.builderId
    )

    if (jobs.length === 0) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    }

    const job = jobs[0]

    // Get all schedule entries
    const schedule: any[] = await prisma.$queryRawUnsafe(
      `SELECT se.*, c.name as "crewName", c."vehiclePlate", c."crewType"
       FROM "ScheduleEntry" se
       LEFT JOIN "Crew" c ON se."crewId" = c.id
       WHERE se."jobId" = $1
       ORDER BY se."scheduledDate" ASC`,
      jobId
    )

    // Get all deliveries with tracking
    const deliveries: any[] = await prisma.$queryRawUnsafe(
      `SELECT d.*, c.name as "crewName", c."vehiclePlate"
       FROM "Delivery" d
       LEFT JOIN "Crew" c ON d."crewId" = c.id
       WHERE d."jobId" = $1
       ORDER BY d."createdAt" ASC`,
      jobId
    )

    const deliveryIds = deliveries.map((d: any) => d.id)
    let trackingEvents: any[] = []
    if (deliveryIds.length > 0) {
      trackingEvents = await prisma.$queryRawUnsafe(
        `SELECT * FROM "DeliveryTracking"
         WHERE "deliveryId" = ANY($1::text[])
         ORDER BY timestamp ASC`,
        deliveryIds
      )
    }

    const trackingByDelivery: Record<string, any[]> = {}
    for (const t of trackingEvents) {
      if (!trackingByDelivery[t.deliveryId]) trackingByDelivery[t.deliveryId] = []
      trackingByDelivery[t.deliveryId].push(t)
    }

    // Get recent activity/notes
    const activities: any[] = await prisma.$queryRawUnsafe(
      `SELECT a.id, a."activityType", a.title, a.details, a."createdAt"
       FROM "Activity" a
       WHERE a."jobId" = $1
       ORDER BY a."createdAt" DESC
       LIMIT 20`,
      jobId
    )

    // Get tasks
    const tasks: any[] = await prisma.$queryRawUnsafe(
      `SELECT t.id, t.title, t.status, t.priority, t."dueDate", t."completedAt"
       FROM "Task" t
       WHERE t."jobId" = $1
       ORDER BY t."dueDate" ASC NULLS LAST`,
      jobId
    )

    // Build milestone progress
    const milestoneSteps = [
      { key: 'CREATED', label: 'Order Created', icon: '📋' },
      { key: 'READINESS_CHECK', label: 'Readiness Check (T-72)', icon: '✅' },
      { key: 'MATERIALS_LOCKED', label: 'Materials Locked (T-48)', icon: '🔒' },
      { key: 'IN_PRODUCTION', label: 'In Production', icon: '🔨' },
      { key: 'STAGED', label: 'Staged', icon: '📦' },
      { key: 'LOADED', label: 'Loaded', icon: '🚛' },
      { key: 'IN_TRANSIT', label: 'In Transit', icon: '🚚' },
      { key: 'DELIVERED', label: 'Delivered', icon: '📍' },
      { key: 'INSTALLING', label: 'Installation', icon: '🔧' },
      { key: 'PUNCH_LIST', label: 'Punch List', icon: '📝' },
      { key: 'COMPLETE', label: 'Complete', icon: '🎉' },
    ]

    const statusOrder = milestoneSteps.map(m => m.key)
    const currentIdx = statusOrder.indexOf(job.status)

    return NextResponse.json({
      job: {
        id: job.id,
        jobNumber: job.jobNumber,
        status: job.status,
        scopeType: job.scopeType,
        address: job.jobAddress,
        community: job.community,
        lotBlock: job.lotBlock,
        orderNumber: job.orderNumber,
        orderTotal: job.total ? Number(job.total) : null,
        projectName: job.projectName,
        scheduledDate: job.scheduledDate,
        completedAt: job.completedAt,
        readinessCheck: job.readinessCheck,
        materialsLocked: job.materialsLocked,
        loadConfirmed: job.loadConfirmed,
      },
      milestones: milestoneSteps.map((m, i) => ({
        ...m,
        status: i < currentIdx ? 'done' : i === currentIdx ? 'current' : 'upcoming',
      })),
      progressPercent: currentIdx >= 0 ? Math.round((currentIdx / (milestoneSteps.length - 1)) * 100) : 0,
      schedule: schedule.map((se: any) => ({
        id: se.id,
        type: se.entryType,
        title: se.title,
        date: se.scheduledDate,
        time: se.scheduledTime,
        status: se.status,
        crew: se.crewName,
        vehicle: se.vehiclePlate,
        crewType: se.crewType,
        notes: se.notes,
        startedAt: se.startedAt,
        completedAt: se.completedAt,
      })),
      deliveries: deliveries.map((d: any) => ({
        id: d.id,
        deliveryNumber: d.deliveryNumber,
        status: d.status,
        address: d.address,
        crew: d.crewName,
        vehicle: d.vehiclePlate,
        departedAt: d.departedAt,
        arrivedAt: d.arrivedAt,
        completedAt: d.completedAt,
        loadPhotos: d.loadPhotos || [],
        sitePhotos: d.sitePhotos || [],
        signedBy: d.signedBy,
        damageNotes: d.damageNotes,
        tracking: (trackingByDelivery[d.id] || []).map((t: any) => ({
          id: t.id,
          status: t.status,
          location: t.location,
          notes: t.notes,
          eta: t.eta,
          timestamp: t.timestamp,
        })),
      })),
      tasks: tasks.map((t: any) => ({
        id: t.id,
        title: t.title,
        status: t.status,
        priority: t.priority,
        dueDate: t.dueDate,
        completedAt: t.completedAt,
      })),
      recentActivity: activities.map((a: any) => ({
        id: a.id,
        type: a.activityType,
        title: a.title,
        details: a.details,
        timestamp: a.createdAt,
      })),
    })
  } catch (error) {
    console.error('Error fetching job milestones:', error)
    return NextResponse.json({ error: 'Failed to fetch milestones' }, { status: 500 })
  }
}
