export const dynamic = 'force-dynamic'
import { prisma } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'

/**
 * GET /api/agent-hub/context/builder/[id]
 * Everything an agent needs about a builder in ONE call:
 * - Builder info + intelligence profile
 * - Recent orders (last 10)
 * - Open invoices
 * - Active jobs
 * - Recent communications
 * - Pending quotes
 * - Collection actions
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const bid = params.id

    // Builder info
    const builder: any[] = await prisma.$queryRawUnsafe(`
      SELECT "id", "companyName", "contactName", "email", "phone",
             "address", "city", "state", "zip",
             "status"::text AS "status", "creditLimit", "currentBalance",
             "taxExempt", "notes", "createdAt"
      FROM "Builder"
      WHERE "id" = $1
    `, bid)

    if (!builder || builder.length === 0) {
      return NextResponse.json({ error: 'Builder not found' }, { status: 404 })
    }

    // Intelligence profile
    const intel: any[] = await prisma.$queryRawUnsafe(
      `SELECT * FROM "BuilderIntelligence" WHERE "builderId" = $1`, bid
    )

    // Recent orders (last 10)
    const recentOrders: any[] = await prisma.$queryRawUnsafe(`
      SELECT "id", "orderNumber", "status"::text AS "status", "total", "createdAt",
             "deliveryDate", "deliveryNotes"
      FROM "Order"
      WHERE "builderId" = $1
      ORDER BY "createdAt" DESC
      LIMIT 10
    `, bid)

    // Open invoices
    const openInvoices: any[] = await prisma.$queryRawUnsafe(`
      SELECT "id", "invoiceNumber", "status"::text AS "status", "total", "balanceDue",
             "dueDate", "createdAt"
      FROM "Invoice"
      WHERE "builderId" = $1 AND "status"::text NOT IN ('PAID', 'VOID', 'DRAFT', 'WRITE_OFF')
      ORDER BY "dueDate" ASC
    `, bid)

    // Active jobs
    const activeJobs: any[] = await prisma.$queryRawUnsafe(`
      SELECT j."id", j."jobNumber", j."status"::text AS "status", j."jobAddress",
             j."community", j."lotBlock", j."scheduledDate", j."orderId"
      FROM "Job" j
      JOIN "Order" o ON o."id" = j."orderId"
      WHERE o."builderId" = $1 AND j."status"::text NOT IN ('COMPLETE', 'CLOSED', 'INVOICED')
      ORDER BY j."scheduledDate" ASC
    `, bid)

    // Pending quotes
    const pendingQuotes: any[] = await prisma.$queryRawUnsafe(`
      SELECT "id", "quoteNumber", "status"::text AS "status", "total",
             "expiresAt", "createdAt"
      FROM "Quote"
      WHERE "builderId" = $1 AND "status"::text IN ('DRAFT', 'SENT')
      ORDER BY "createdAt" DESC
    `, bid)

    // Collection actions (last 5)
    const collectionActions: any[] = await prisma.$queryRawUnsafe(`
      SELECT ca."id", ca."invoiceId", ca."actionType", ca."channel", ca."sentAt",
             ca."notes", i."invoiceNumber"
      FROM "CollectionAction" ca
      JOIN "Invoice" i ON i."id" = ca."invoiceId"
      WHERE i."builderId" = $1
      ORDER BY ca."sentAt" DESC
      LIMIT 5
    `, bid)

    // Recent activity/communications (last 10)
    let recentComms: any[] = []
    try {
      recentComms = await prisma.$queryRawUnsafe(`
        SELECT "id", "type"::text AS "type", "subject", "body", "createdAt"
        FROM "Activity"
        WHERE "builderId" = $1
        ORDER BY "createdAt" DESC
        LIMIT 10
      `, bid)
    } catch {
      // Activity table may not have these exact columns — skip gracefully
    }

    // Summary stats
    const totalOutstanding = openInvoices.reduce((s, i) => s + Number(i.balanceDue), 0)
    const overdueInvoices = openInvoices.filter(i =>
      i.dueDate && new Date(i.dueDate) < new Date() && i.status !== 'PAID'
    )

    return NextResponse.json({
      builder: {
        ...builder[0],
        creditLimit: Number(builder[0].creditLimit || 0),
        currentBalance: Number(builder[0].currentBalance || 0),
      },
      intelligence: intel[0] ? {
        ...intel[0],
        avgOrderValue: Number(intel[0].avgOrderValue),
        totalLifetimeValue: Number(intel[0].totalLifetimeValue),
        currentBalance: Number(intel[0].currentBalance),
        onTimePaymentRate: Number(intel[0].onTimePaymentRate),
        pipelineValue: Number(intel[0].pipelineValue),
      } : null,
      recentOrders: recentOrders.map(o => ({ ...o, total: Number(o.total) })),
      openInvoices: openInvoices.map(i => ({
        ...i,
        total: Number(i.total),
        balanceDue: Number(i.balanceDue),
      })),
      activeJobs,
      pendingQuotes: pendingQuotes.map(q => ({ ...q, total: Number(q.total) })),
      collectionActions,
      recentCommunications: recentComms,
      quickStats: {
        totalOutstanding,
        overdueCount: overdueInvoices.length,
        overdueAmount: overdueInvoices.reduce((s, i) => s + Number(i.balanceDue), 0),
        activeJobCount: activeJobs.length,
        pendingQuoteCount: pendingQuotes.length,
        pendingQuoteValue: pendingQuotes.reduce((s, q) => s + Number(q.total), 0),
      }
    })
  } catch (error) {
    console.error('GET /api/agent-hub/context/builder/[id] error:', error)
    return NextResponse.json({ error: 'Failed to fetch builder context' }, { status: 500 })
  }
}
