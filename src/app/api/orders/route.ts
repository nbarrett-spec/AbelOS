export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/auth'
import { sendOrderConfirmationEmail } from '@/lib/email'
import { notifyOrderConfirmed } from '@/lib/notifications'
import { apiLimiter, checkRateLimit } from '@/lib/rate-limit'
import { checkCSRF } from '@/lib/security'
import { logger, getRequestId } from '@/lib/logger'

// GET /api/orders — List builder's orders
export async function GET(request: NextRequest) {
  const requestId = getRequestId(request)
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  try {
    const orders: any[] = await prisma.$queryRaw`
      SELECT o."id", o."orderNumber", o."status", o."total", o."createdAt",
             o."deliveryDate",
             COALESCE(p."name", b."companyName") as "projectName",
             CAST((SELECT COUNT(*) FROM "OrderItem" oi WHERE oi."orderId" = o."id") AS INTEGER) as "itemCount"
      FROM "Order" o
      JOIN "Builder" b ON b."id" = o."builderId"
      LEFT JOIN "Quote" q ON q."id" = o."quoteId"
      LEFT JOIN "Project" p ON p."id" = q."projectId"
      WHERE o."builderId" = ${session.builderId}
      ORDER BY o."createdAt" DESC
    ` as any[]

    return NextResponse.json({ orders })
  } catch (error: any) {
    logger.error('orders_get_error', error, { requestId })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST /api/orders — Create order from quote
export async function POST(request: NextRequest) {
  const requestId = getRequestId(request)
  // CSRF check
  if (!checkCSRF(request)) {
    return NextResponse.json({ error: 'Invalid request origin' }, { status: 403 })
  }

  // Rate limit order creation — logs RATE_LIMIT SecurityEvent on rejection.
  const limited = await checkRateLimit(request, apiLimiter, 60, 'order-create')
  if (limited) return limited

  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  try {
    const body = await request.json()
    const { quoteId, deliveryNotes } = body

    // Validate required fields
    if (!quoteId) {
      return NextResponse.json({ error: 'quoteId is required' }, { status: 400 })
    }

    // Fetch quote with its items
    const quote: any = await prisma.$queryRawUnsafe(
      `SELECT q.*, p."id" as "projectId", p."builderId" as "ownerBuilderId"
       FROM "Quote" q
       LEFT JOIN "Project" p ON p."id" = q."projectId"
       WHERE q."id" = $1
         AND p."builderId" = $2`,
      quoteId,
      session.builderId
    )

    if (!quote || quote.length === 0) {
      return NextResponse.json({ error: 'Quote not found' }, { status: 404 })
    }

    const quoteRecord = quote[0]

    // Validate quote status is not already APPROVED
    if (quoteRecord.status === 'APPROVED') {
      return NextResponse.json({ error: 'Quote is already approved' }, { status: 400 })
    }

    // Generate order number and ID
    const orderNumber = `ORD-${new Date().getFullYear()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`
    const orderId = `ord${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`

    // Create Order + OrderItems + update Quote atomically
    const total = quoteRecord.total || 0

    const quoteItems: any[] = await prisma.$transaction(async (tx) => {
      // Create Order
      await tx.$executeRawUnsafe(
        `INSERT INTO "Order" ("id", "orderNumber", "builderId", "quoteId", "status", "total", "deliveryNotes", "createdAt", "updatedAt")
         VALUES ($1, $2, $3, $4, 'RECEIVED'::"OrderStatus", $5, $6, NOW(), NOW())`,
        orderId,
        orderNumber,
        session.builderId,
        quoteId,
        total,
        deliveryNotes || null
      )

      // Fetch quote items
      const items: any[] = await tx.$queryRawUnsafe(
        `SELECT * FROM "QuoteItem" WHERE "quoteId" = $1`,
        quoteId
      )

      // Create OrderItems for each quote item
      for (const item of items) {
        const orderItemId = `item${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`

        await tx.$executeRawUnsafe(
          `INSERT INTO "OrderItem" ("id", "orderId", "productId", "description", "quantity", "unitPrice", "total", "location", "createdAt", "updatedAt")
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())`,
          orderItemId,
          orderId,
          item.productId,
          item.description,
          item.quantity,
          item.unitPrice,
          item.total,
          item.location || null
        )
      }

      // Update Quote status to APPROVED
      await tx.$executeRawUnsafe(
        `UPDATE "Quote" SET "status" = 'APPROVED'::"QuoteStatus", "updatedAt" = NOW() WHERE "id" = $1`,
        quoteId
      )

      return items
    })

    // ── Auto-create Job for ops team ──────────────────────────────
    try {
      const jobCount: any[] = await prisma.$queryRawUnsafe(`SELECT COUNT(*)::int as count FROM "Job"`)
      const jobSeq = (jobCount[0]?.count || 0) + 1
      const jobNumber = `JOB-${new Date().getFullYear()}-${String(jobSeq).padStart(4, '0')}`
      const jobId = `job${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`

      // Fetch project info for job address
      let jobAddress: string | null = null
      let projectName = `Order ${orderNumber}`
      if (quoteRecord.projectId) {
        const proj: any[] = await prisma.$queryRawUnsafe(
          `SELECT "name", "jobAddress" FROM "Project" WHERE "id" = $1 LIMIT 1`,
          quoteRecord.projectId
        )
        if (proj[0]) {
          jobAddress = proj[0].jobAddress || null
          projectName = proj[0].name || projectName
        }
      }

      await prisma.$executeRawUnsafe(
        `INSERT INTO "Job" ("id", "jobNumber", "orderId", "projectId", "builderName", "builderContact", "jobAddress", "scopeType", "status", "scheduledDate", "createdAt", "updatedAt")
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'FULL_PACKAGE'::"ScopeType", 'CREATED'::"JobStatus", NULL, NOW(), NOW())`,
        jobId,
        jobNumber,
        orderId,
        quoteRecord.projectId || null,
        session.companyName,
        session.email,
        jobAddress
      )
    } catch (jobErr: any) {
      logger.warn('order_auto_create_job_failed', { msg: jobErr?.message, requestId })
      // Non-blocking — order is already created
    }

    // Send order confirmation email (fire-and-forget)
    sendOrderConfirmationEmail({
      to: session.email,
      builderName: session.companyName,
      orderNumber,
      projectName: 'Order ' + orderNumber,
      total,
    }).catch(() => {})

    // Fetch project name if available for notification
    const projectName = quoteRecord.projectId
      ? (await prisma.$queryRawUnsafe(
          `SELECT "name" FROM "Project" WHERE "id" = $1 LIMIT 1`,
          quoteRecord.projectId
        ) as any[]).at(0)?.name || `Order ${orderNumber}`
      : `Order ${orderNumber}`

    // Send in-app notification and queue email (fire-and-forget)
    notifyOrderConfirmed(
      session.builderId,
      session.email,
      orderNumber,
      projectName,
      total,
      quoteItems.length
    ).catch((err) => console.error('Notification dispatch error:', err))

    return NextResponse.json({ orderId, orderNumber, total })
  } catch (error: any) {
    console.error(error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
