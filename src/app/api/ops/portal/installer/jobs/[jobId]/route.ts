export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'

// ──────────────────────────────────────────────────────────────────────────
// GET /api/ops/portal/installer/jobs/[jobId]
// Returns full job detail for the install crew: BOM lines, notes,
// punch items (Task-backed since PunchItem model does not exist), photos.
// ──────────────────────────────────────────────────────────────────────────

export async function GET(
  request: NextRequest,
  { params }: { params: { jobId: string } },
) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  const { jobId } = params
  if (!jobId) return NextResponse.json({ error: 'Missing jobId' }, { status: 400 })

  try {
    const rows: any[] = await prisma.$queryRawUnsafe(
      `SELECT j."id", j."jobNumber", j."builderName", j."builderContact",
              j."community", j."lotBlock", j."jobAddress",
              j."latitude", j."longitude",
              j."status"::text AS "status",
              j."scopeType"::text AS "scopeType",
              j."scheduledDate", j."actualDate", j."completedAt",
              o."id" AS "orderId", o."orderNumber", o."deliveryNotes", o."poNumber", o."total" AS "orderTotal",
              pm."id" AS "pmId", pm."firstName" AS "pmFirstName", pm."lastName" AS "pmLastName",
              pm."email" AS "pmEmail", pm."phone" AS "pmPhone"
       FROM "Job" j
       LEFT JOIN "Order" o ON o."id" = j."orderId"
       LEFT JOIN "Staff" pm ON pm."id" = j."assignedPMId"
       WHERE j."id" = $1
       LIMIT 1`,
      jobId,
    )
    if (rows.length === 0) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    }
    const j = rows[0]

    // BOM lines from linked Order
    let bom: any[] = []
    if (j.orderId) {
      bom = (await prisma.$queryRawUnsafe(
        `SELECT oi."id", oi."description", oi."quantity",
                p."sku", p."name", p."displayName"
         FROM "OrderItem" oi
         LEFT JOIN "Product" p ON p."id" = oi."productId"
         WHERE oi."orderId" = $1
         ORDER BY oi."id" ASC
         LIMIT 500`,
        j.orderId,
      ).catch(() => [] as any[])) as any[]
    }

    // Notes (latest 30)
    const notes: any[] = (await prisma.$queryRawUnsafe(
      `SELECT dn."id", dn."subject", dn."body", dn."priority",
              dn."noteType"::text AS "noteType", dn."createdAt",
              s."firstName", s."lastName"
       FROM "DecisionNote" dn
       LEFT JOIN "Staff" s ON s."id" = dn."authorId"
       WHERE dn."jobId" = $1
       ORDER BY dn."createdAt" DESC
       LIMIT 30`,
      jobId,
    ).catch(() => [] as any[])) as any[]

    // Punch items — we piggy-back on Task with category='INSTALLATION' or 'PUNCH_LIST'
    const punchItems: any[] = (await prisma.$queryRawUnsafe(
      `SELECT "id", "title", "description", "status", "priority", "dueDate", "createdAt"
       FROM "Task"
       WHERE "jobId" = $1
         AND ("category" = 'PUNCH_LIST' OR LOWER("title") LIKE '%punch%')
       ORDER BY "createdAt" DESC
       LIMIT 100`,
      jobId,
    ).catch(() => [] as any[])) as any[]

    // Photos — persisted on Installation rows (beforePhotos/afterPhotos)
    let photos: string[] = []
    try {
      const installs: any[] = await prisma.$queryRawUnsafe(
        `SELECT "beforePhotos", "afterPhotos" FROM "Installation" WHERE "jobId" = $1`,
        jobId,
      )
      for (const i of installs) {
        if (Array.isArray(i.beforePhotos)) photos.push(...i.beforePhotos)
        if (Array.isArray(i.afterPhotos)) photos.push(...i.afterPhotos)
      }
    } catch {
      photos = []
    }

    return NextResponse.json({
      id: j.id,
      jobNumber: j.jobNumber,
      builderName: j.builderName,
      builderContact: j.builderContact,
      community: j.community,
      lotBlock: j.lotBlock,
      jobAddress: j.jobAddress,
      latitude: j.latitude,
      longitude: j.longitude,
      status: j.status,
      scopeType: j.scopeType,
      scheduledDate: j.scheduledDate,
      actualDate: j.actualDate,
      completedAt: j.completedAt,
      order: j.orderId ? {
        id: j.orderId,
        orderNumber: j.orderNumber,
        poNumber: j.poNumber,
        total: j.orderTotal,
        deliveryNotes: j.deliveryNotes,
      } : null,
      pm: j.pmId ? {
        id: j.pmId,
        firstName: j.pmFirstName,
        lastName: j.pmLastName,
        email: j.pmEmail,
        phone: j.pmPhone,
      } : null,
      bom,
      notes,
      punchItems,
      photos,
    })
  } catch (error: any) {
    console.error('[installer/jobs/:id] error:', error?.message)
    return NextResponse.json({ error: 'Failed to load job' }, { status: 500 })
  }
}
