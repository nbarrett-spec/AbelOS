export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'

/**
 * POST /api/ops/migrate/data-scrub
 *
 * Fixes data gaps across the platform:
 * 1. Creates Jobs for Orders that don't have one
 * 2. Populates Job.projectId from Order→Quote→Project chain
 * 3. Populates Order.projectId from Quote.projectId where missing
 * 4. Links Deliveries to Jobs where orderId matches
 * 5. Creates Activity log entries for orphan records
 *
 * Safe to re-run — checks for existence before creating.
 */
export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  const results: { step: string; affected: number; status: string }[] = []

  // ── Step 1: Create Jobs for Orders without one ──────────────────
  try {
    // Find all orders without a corresponding job
    const orphanOrders: any[] = await prisma.$queryRawUnsafe(`
      SELECT o."id" as "orderId", o."orderNumber", o."builderId",
             o."quoteId", o."total", o."status"::text as "orderStatus",
             b."companyName", b."email", b."contactName",
             q."projectId" as "quoteProjectId",
             p."name" as "projectName", p."jobAddress"
      FROM "Order" o
      JOIN "Builder" b ON b."id" = o."builderId"
      LEFT JOIN "Quote" q ON q."id" = o."quoteId"
      LEFT JOIN "Project" p ON p."id" = q."projectId"
      LEFT JOIN "Job" j ON j."orderId" = o."id"
      WHERE j."id" IS NULL
      ORDER BY o."createdAt" ASC
    `)

    let jobsCreated = 0
    for (const order of orphanOrders) {
      try {
        const jobId = `job${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
        const jobSeq = jobsCreated + 1
        const jobNumber = `JOB-SCRUB-${new Date().getFullYear()}-${String(jobSeq).padStart(4, '0')}`
        const projectId = order.quoteProjectId || null

        // Map order status to appropriate job status
        let jobStatus = 'CREATED'
        const os = order.orderStatus
        if (['DELIVERED', 'COMPLETED'].includes(os)) jobStatus = 'DELIVERED'
        else if (os === 'IN_TRANSIT') jobStatus = 'IN_TRANSIT'
        else if (os === 'SHIPPED') jobStatus = 'LOADED'
        else if (['PROCESSING', 'CONFIRMED'].includes(os)) jobStatus = 'IN_PRODUCTION'
        else if (os === 'RECEIVED') jobStatus = 'CREATED'

        await prisma.$executeRawUnsafe(`
          INSERT INTO "Job" (
            "id", "jobNumber", "orderId", "projectId",
            "builderName", "builderContact", "jobAddress",
            "scopeType", "status",
            "createdAt", "updatedAt"
          ) VALUES (
            $1, $2, $3, $4,
            $5, $6, $7,
            'FULL_PACKAGE'::"ScopeType", $8::"JobStatus",
            NOW(), NOW()
          )
        `,
          jobId, jobNumber, order.orderId, projectId,
          order.companyName, order.email,
          order.jobAddress || null,
          jobStatus
        )
        jobsCreated++
      } catch (e: any) {
        console.warn(`[Data Scrub] Failed to create job for order ${order.orderId}:`, e?.message)
      }
    }
    results.push({
      step: 'Create Jobs for orphan Orders',
      affected: jobsCreated,
      status: `${jobsCreated}/${orphanOrders.length} created`
    })
  } catch (e: any) {
    results.push({ step: 'Create Jobs for orphan Orders', affected: 0, status: `ERROR: ${e?.message?.slice(0, 200)}` })
  }

  // ── Step 2: Populate Job.projectId from Order→Quote→Project ──────
  try {
    const updated: any[] = await prisma.$queryRawUnsafe(`
      UPDATE "Job" j
      SET "projectId" = q."projectId",
          "updatedAt" = NOW()
      FROM "Order" o
      LEFT JOIN "Quote" q ON q."id" = o."quoteId"
      WHERE j."orderId" = o."id"
        AND j."projectId" IS NULL
        AND q."projectId" IS NOT NULL
      RETURNING j."id"
    `)
    results.push({
      step: 'Populate Job.projectId from Order→Quote→Project',
      affected: Array.isArray(updated) ? updated.length : 0,
      status: 'OK'
    })
  } catch (e: any) {
    results.push({ step: 'Populate Job.projectId', affected: 0, status: `ERROR: ${e?.message?.slice(0, 200)}` })
  }

  // ── Step 3: (Skipped — Order table uses quoteId→Quote→projectId chain, no direct projectId column)

  // ── Step 4: Populate Job.jobAddress from Project ─────────────────
  try {
    const updated: any[] = await prisma.$queryRawUnsafe(`
      UPDATE "Job" j
      SET "jobAddress" = p."jobAddress",
          "updatedAt" = NOW()
      FROM "Project" p
      WHERE j."projectId" = p."id"
        AND j."jobAddress" IS NULL
        AND p."jobAddress" IS NOT NULL
      RETURNING j."id"
    `)
    results.push({
      step: 'Populate Job.jobAddress from Project',
      affected: Array.isArray(updated) ? updated.length : 0,
      status: 'OK'
    })
  } catch (e: any) {
    results.push({ step: 'Populate Job.jobAddress', affected: 0, status: `ERROR: ${e?.message?.slice(0, 200)}` })
  }

  // ── Step 5: (Skipped — Delivery requires jobId, no orderId column. Deliveries are created from Jobs.)

  // ── Step 6: Populate Job.builderName where missing ────────────────
  try {
    const updated: any[] = await prisma.$queryRawUnsafe(`
      UPDATE "Job" j
      SET "builderName" = b."companyName",
          "builderContact" = COALESCE(j."builderContact", b."email"),
          "updatedAt" = NOW()
      FROM "Order" o
      JOIN "Builder" b ON b."id" = o."builderId"
      WHERE j."orderId" = o."id"
        AND (j."builderName" IS NULL OR j."builderName" = '')
      RETURNING j."id"
    `)
    results.push({
      step: 'Populate Job.builderName from Order→Builder',
      affected: Array.isArray(updated) ? updated.length : 0,
      status: 'OK'
    })
  } catch (e: any) {
    results.push({ step: 'Populate Job.builderName', affected: 0, status: `ERROR: ${e?.message?.slice(0, 200)}` })
  }

  // ── Step 7: (Skipped — Quote table uses projectId chain, no direct builderId column)

  // ── Step 8: Create Deliveries for Jobs in LOADED/IN_TRANSIT/DELIVERED without one ──
  try {
    const jobsWithoutDelivery: any[] = await prisma.$queryRawUnsafe(`
      SELECT j."id", j."jobNumber", j."jobAddress", j."status"::text as status
      FROM "Job" j
      LEFT JOIN "Delivery" d ON d."jobId" = j."id"
      WHERE d."id" IS NULL
        AND j."status"::text IN ('LOADED', 'IN_TRANSIT', 'DELIVERED', 'INSTALLING', 'COMPLETE')
    `)

    let delsCreated = 0
    for (const job of jobsWithoutDelivery) {
      try {
        const deliveryId = `del_scrub_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
        const delSeq = delsCreated + 1
        const deliveryNumber = `DEL-SCRUB-${new Date().getFullYear()}-${String(delSeq).padStart(4, '0')}`
        const address = job.jobAddress || 'Address TBD'

        let delStatus = 'SCHEDULED'
        if (['DELIVERED', 'INSTALLING', 'COMPLETE'].includes(job.status)) delStatus = 'COMPLETE'
        else if (job.status === 'IN_TRANSIT') delStatus = 'EN_ROUTE'
        else if (job.status === 'LOADED') delStatus = 'LOADED'

        await prisma.$executeRawUnsafe(`
          INSERT INTO "Delivery" ("id", "jobId", "deliveryNumber", "address", "status", "routeOrder", "loadPhotos", "sitePhotos", "createdAt", "updatedAt")
          VALUES ($1, $2, $3, $4, $5::"DeliveryStatus", 0, '{}', '{}', NOW(), NOW())
        `, deliveryId, job.id, deliveryNumber, address, delStatus)
        delsCreated++
      } catch (de: any) {
        console.warn(`[Data Scrub] Failed to create delivery for job ${job.id}:`, de?.message)
      }
    }
    results.push({
      step: 'Create Deliveries for Jobs in transit/delivered without one',
      affected: delsCreated,
      status: `${delsCreated}/${jobsWithoutDelivery.length} created`
    })
  } catch (e: any) {
    results.push({ step: 'Create Deliveries for Jobs', affected: 0, status: `ERROR: ${e?.message?.slice(0, 200)}` })
  }

  const totalAffected = results.reduce((sum, r) => sum + r.affected, 0)
  const errors = results.filter(r => r.status.startsWith('ERROR')).length

  return NextResponse.json({
    success: errors === 0,
    summary: {
      totalRecordsFixed: totalAffected,
      steps: results.length,
      errors,
    },
    results,
  })
}
