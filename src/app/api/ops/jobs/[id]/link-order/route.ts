export const dynamic = 'force-dynamic'
import * as Sentry from '@sentry/nextjs'
import { prisma } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'
import { audit } from '@/lib/audit'

// ── POST /api/ops/jobs/[id]/link-order ─────────────────────────────────────
// Links an existing Order to a Job by setting Job.orderId. Used by the job-
// detail "Link to Order" UI when a job was created independently of its order
// (e.g. backfilled, imported, or scheduled before the order landed).
//
// Body:
//   { orderId: string }   // Order.id to link
//
// Validation:
//   - Job exists
//   - Order exists
//   - Cross-builder protection: if the Job is already linked to an Order,
//     the new Order must share the same Order.builderId. Linking across
//     builders would corrupt accounting (revenue/COGS attribution, AR aging,
//     builder P&L). Refuses with 400 on mismatch.
//   - One-job-per-order: if the target Order is already linked to a different
//     Job, refuse with 409. Caller must unlink the other job first.
//
// Permissions: ADMIN, MANAGER, PROJECT_MANAGER (gated via the
// '/api/ops/jobs' prefix entry in src/lib/permissions.ts API_ACCESS).
// ─────────────────────────────────────────────────────────────────────────

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const jobId = params.id
    const body = await request.json().catch(() => ({}))
    const orderId = typeof body?.orderId === 'string' ? body.orderId.trim() : ''

    if (!orderId) {
      return NextResponse.json(
        { error: 'orderId is required' },
        { status: 400 }
      )
    }

    // ── Load Job (current orderId + denormalized builder for response) ──
    const jobRows: any[] = await prisma.$queryRawUnsafe(
      `SELECT j."id", j."jobNumber", j."orderId", j."builderName",
              o."builderId" AS "currentBuilderId"
         FROM "Job" j
         LEFT JOIN "Order" o ON o."id" = j."orderId"
         WHERE j."id" = $1`,
      jobId
    )
    if (jobRows.length === 0) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    }
    const job = jobRows[0]

    // ── Load target Order (with builderId for cross-builder check) ──
    const orderRows: any[] = await prisma.$queryRawUnsafe(
      `SELECT "id", "orderNumber", "builderId" FROM "Order" WHERE "id" = $1`,
      orderId
    )
    if (orderRows.length === 0) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 })
    }
    const order = orderRows[0]

    // ── No-op: already linked to this exact order ──
    if (job.orderId === orderId) {
      return NextResponse.json({
        ok: true,
        job: { id: job.id, jobNumber: job.jobNumber },
        order: { id: order.id, orderNumber: order.orderNumber },
        unchanged: true,
      })
    }

    // ── Cross-builder guard ──
    // Job's source-of-truth builder is the linked Order's builderId. If the
    // job already has a link, the new Order must match that builderId.
    if (job.currentBuilderId && job.currentBuilderId !== order.builderId) {
      return NextResponse.json(
        {
          error:
            'Cross-builder linking refused. The job is currently associated with a different builder via its existing order. Unlink the existing order first or pick an order from the same builder.',
          jobBuilderId: job.currentBuilderId,
          orderBuilderId: order.builderId,
        },
        { status: 400 }
      )
    }

    // ── Already-linked-elsewhere guard ──
    // A Job carries Order.id via Job.orderId, so "this order is already linked
    // to a different job" means another Job row points to the same orderId.
    const conflictRows: any[] = await prisma.$queryRawUnsafe(
      `SELECT "id", "jobNumber" FROM "Job"
         WHERE "orderId" = $1 AND "id" <> $2
         LIMIT 1`,
      orderId,
      jobId
    )
    if (conflictRows.length > 0) {
      return NextResponse.json(
        {
          error:
            'Order is already linked to a different job. Unlink it from that job before linking it here.',
          conflictingJob: {
            id: conflictRows[0].id,
            jobNumber: conflictRows[0].jobNumber,
          },
        },
        { status: 409 }
      )
    }

    // ── Perform the link ──
    await prisma.$executeRawUnsafe(
      `UPDATE "Job"
         SET "orderId" = $1, "updatedAt" = NOW()
         WHERE "id" = $2`,
      orderId,
      jobId
    )

    await audit(request, 'LINK_ORDER_TO_JOB', 'Job', jobId, {
      jobId,
      orderId,
      previousOrderId: job.orderId || null,
      orderNumber: order.orderNumber,
      builderId: order.builderId,
    })

    return NextResponse.json({
      ok: true,
      job: { id: job.id, jobNumber: job.jobNumber },
      order: { id: order.id, orderNumber: order.orderNumber },
    })
  } catch (error: any) {
    console.error('[link-order] failed:', error)
    Sentry.captureException(error, {
      tags: { route: '/api/ops/jobs/[id]/link-order', method: 'POST' },
      extra: { jobId: params.id },
    })
    return NextResponse.json(
      { error: 'Failed to link order to job', detail: error?.message },
      { status: 500 }
    )
  }
}
