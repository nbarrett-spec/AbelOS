export const dynamic = 'force-dynamic'
import { prisma } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'
import { audit } from '@/lib/audit'
import { allocateJobMaterials, releaseJobMaterials } from '@/lib/mrp'

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const { id } = params

    // Get job with related data
    const jobRows: any[] = await prisma.$queryRawUnsafe(`
      SELECT j.*,
             j."status"::text AS "status",
             j."scopeType"::text AS "scopeType",
             o."orderNumber", o."total" AS "orderTotal", o."status"::text AS "orderStatus",
             o."deliveryNotes", o."poNumber",
             b."id" AS "builder_id", b."companyName" AS "builder_companyName",
             b."contactName" AS "builder_contactName", b."email" AS "builder_email",
             b."phone" AS "builder_phone",
             pm."id" AS "pm_id", pm."firstName" AS "pm_firstName", pm."lastName" AS "pm_lastName",
             pm."email" AS "pm_email", pm."phone" AS "pm_phone"
      FROM "Job" j
      LEFT JOIN "Order" o ON o."id" = j."orderId"
      LEFT JOIN "Builder" b ON b."id" = o."builderId"
      LEFT JOIN "Staff" pm ON pm."id" = j."assignedPMId"
      WHERE j."id" = $1
    `, id)

    if (jobRows.length === 0) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    }

    const job = jobRows[0]

    // Get related collections
    const [tasks, deliveries, installations, materialPicks, scheduleEntries, qualityChecks, decisionNotes] = await Promise.all([
      prisma.$queryRawUnsafe(`
        SELECT * FROM "Task" WHERE "jobId" = $1 ORDER BY "createdAt" DESC
      `, id).catch(() => []),
      prisma.$queryRawUnsafe(`
        SELECT * FROM "Delivery" WHERE "jobId" = $1 ORDER BY "createdAt" DESC
      `, id).catch(() => []),
      prisma.$queryRawUnsafe(`
        SELECT * FROM "Installation" WHERE "jobId" = $1 ORDER BY "createdAt" DESC
      `, id).catch(() => []),
      prisma.$queryRawUnsafe(`
        SELECT * FROM "MaterialPick" WHERE "jobId" = $1 ORDER BY "createdAt" DESC
      `, id).catch(() => []),
      prisma.$queryRawUnsafe(`
        SELECT * FROM "ScheduleEntry" WHERE "jobId" = $1 ORDER BY "scheduledDate" ASC
      `, id).catch(() => []),
      prisma.$queryRawUnsafe(`
        SELECT * FROM "QualityCheck" WHERE "jobId" = $1 ORDER BY "createdAt" DESC
      `, id).catch(() => []),
      prisma.$queryRawUnsafe(`
        SELECT * FROM "DecisionNote" WHERE "jobId" = $1 ORDER BY "createdAt" DESC
      `, id).catch(() => []),
    ])

    // Structure the response
    const result = {
      id: job.id,
      jobNumber: job.jobNumber,
      orderId: job.orderId,
      builderName: job.builderName,
      builderContact: job.builderContact,
      jobAddress: job.jobAddress,
      lotBlock: job.lotBlock,
      community: job.community,
      scopeType: job.scopeType,
      dropPlan: job.dropPlan,
      assignedPMId: job.assignedPMId,
      status: job.status,
      readinessCheck: job.readinessCheck,
      materialsLocked: job.materialsLocked,
      loadConfirmed: job.loadConfirmed,
      scheduledDate: job.scheduledDate,
      actualDate: job.actualDate,
      completedAt: job.completedAt,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      order: job.orderNumber ? {
        id: job.orderId,
        orderNumber: job.orderNumber,
        total: job.orderTotal,
        status: job.orderStatus,
        deliveryNotes: job.deliveryNotes,
        poNumber: job.poNumber,
        builder: job.builder_id ? {
          id: job.builder_id,
          companyName: job.builder_companyName,
          contactName: job.builder_contactName,
          email: job.builder_email,
          phone: job.builder_phone,
        } : null,
      } : null,
      assignedPM: job.pm_id ? {
        id: job.pm_id,
        firstName: job.pm_firstName,
        lastName: job.pm_lastName,
        email: job.pm_email,
        phone: job.pm_phone,
      } : null,
      tasks,
      deliveries,
      installations,
      materialPicks,
      scheduleEntries,
      qualityChecks,
      decisionNotes,
    }

    return NextResponse.json(result)
  } catch (error) {
    console.error('Error fetching job:', error)
    return NextResponse.json({ error: 'Failed to fetch job' }, { status: 500 })
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const { id } = params
    const body = await request.json()

    // Get current job status
    const currentRows: any[] = await prisma.$queryRawUnsafe(`
      SELECT "id", "status"::text AS "status", "orderId" FROM "Job" WHERE "id" = $1
    `, id)

    if (currentRows.length === 0) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    }

    const currentJob = currentRows[0]
    const newStatus = body.status

    // Build SET clauses
    const setClauses: string[] = ['"updatedAt" = NOW()']
    const validFields = ['builderName', 'builderContact', 'jobAddress', 'lotBlock', 'community', 'dropPlan', 'assignedPMId']

    for (const field of validFields) {
      if (body[field] !== undefined) {
        setClauses.push(`"${field}" = '${String(body[field]).replace(/'/g, "''")}'`)
      }
    }

    if (body.scopeType !== undefined) {
      setClauses.push(`"scopeType" = '${body.scopeType}'::"ScopeType"`)
    }

    if (body.scheduledDate !== undefined) {
      setClauses.push(body.scheduledDate ? `"scheduledDate" = '${body.scheduledDate}'::timestamptz` : `"scheduledDate" = NULL`)
    }

    if (body.actualDate !== undefined) {
      setClauses.push(body.actualDate ? `"actualDate" = '${body.actualDate}'::timestamptz` : `"actualDate" = NULL`)
    }

    // Handle status transition side effects
    if (newStatus && newStatus !== currentJob.status) {
      setClauses.push(`"status" = '${newStatus}'::"JobStatus"`)

      if (newStatus === 'READINESS_CHECK') setClauses.push(`"readinessCheck" = true`)
      if (newStatus === 'MATERIALS_LOCKED') setClauses.push(`"materialsLocked" = true`)
      if (newStatus === 'LOADED') setClauses.push(`"loadConfirmed" = true`)
      if (newStatus === 'COMPLETE') setClauses.push(`"completedAt" = NOW()`)
    }

    await prisma.$executeRawUnsafe(`
      UPDATE "Job" SET ${setClauses.join(', ')} WHERE "id" = $1
    `, id)

    // ── MRP: allocate / release inventory commitments based on lifecycle ──
    if (newStatus && newStatus !== currentJob.status) {
      try {
        if (newStatus === 'MATERIALS_LOCKED') {
          await allocateJobMaterials(id)
        } else if (
          ['DELIVERED', 'COMPLETE', 'CLOSED', 'CANCELLED'].includes(newStatus)
        ) {
          await releaseJobMaterials(id)
        }
      } catch (mrpErr: any) {
        console.warn('[Job PATCH] MRP allocation hook failed:', mrpErr?.message)
      }
    }

    // ── Auto-create Delivery when Job reaches LOADED/IN_TRANSIT ──
    if (newStatus && ['LOADED', 'IN_TRANSIT', 'STAGED'].includes(newStatus)) {
      try {
        // Check if delivery already exists for this job
        const existingDel: any[] = await prisma.$queryRawUnsafe(
          `SELECT "id" FROM "Delivery" WHERE "jobId" = $1 LIMIT 1`, id
        )
        if (existingDel.length === 0) {
          // Get job address for delivery
          const jobInfo: any[] = await prisma.$queryRawUnsafe(
            `SELECT "jobAddress", "jobNumber" FROM "Job" WHERE "id" = $1`, id
          )
          const delCount: any[] = await prisma.$queryRawUnsafe(`SELECT COUNT(*)::int as c FROM "Delivery"`)
          const delSeq = (delCount[0]?.c || 0) + 1
          const deliveryNumber = `DEL-${new Date().getFullYear()}-${String(delSeq).padStart(4, '0')}`
          const deliveryId = `del${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
          const address = jobInfo[0]?.jobAddress || 'TBD'

          const delStatus = newStatus === 'IN_TRANSIT' ? 'EN_ROUTE' : 'SCHEDULED'

          await prisma.$executeRawUnsafe(`
            INSERT INTO "Delivery" ("id", "jobId", "deliveryNumber", "address", "status", "routeOrder", "loadPhotos", "sitePhotos", "createdAt", "updatedAt")
            VALUES ($1, $2, $3, $4, $5::"DeliveryStatus", 0, '{}', '{}', NOW(), NOW())
          `, deliveryId, id, deliveryNumber, address, delStatus)
        }
      } catch (delErr: any) {
        console.warn('[Job PATCH] Auto-create delivery failed:', delErr?.message)
      }
    }

    // Re-fetch via GET logic (simplified)
    const updatedRows: any[] = await prisma.$queryRawUnsafe(`
      SELECT j.*, j."status"::text AS "status", j."scopeType"::text AS "scopeType",
             pm."firstName" AS "pm_firstName", pm."lastName" AS "pm_lastName"
      FROM "Job" j
      LEFT JOIN "Staff" pm ON pm."id" = j."assignedPMId"
      WHERE j."id" = $1
    `, id)

    await audit(request, 'UPDATE', 'Job', id, body)

    return NextResponse.json(updatedRows[0] || {})
  } catch (error) {
    console.error('Error updating job:', error)
    return NextResponse.json({ error: 'Failed to update job' }, { status: 500 })
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const { id } = params

    const rows: any[] = await prisma.$queryRawUnsafe(`
      SELECT "id" FROM "Job" WHERE "id" = $1
    `, id)

    if (rows.length === 0) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    }

    // Soft delete by setting status to CLOSED
    await prisma.$executeRawUnsafe(`
      UPDATE "Job" SET "status" = 'CLOSED'::"JobStatus", "updatedAt" = NOW() WHERE "id" = $1
    `, id)

    await audit(request, 'DELETE', 'Job', id, {})

    return NextResponse.json({ success: true, message: 'Job closed' })
  } catch (error) {
    console.error('Error deleting job:', error)
    return NextResponse.json({ error: 'Failed to delete job' }, { status: 500 })
  }
}
