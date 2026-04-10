export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

interface AuthHeaders {
  staffId?: string
  staffRole?: string
}

function getAuthHeaders(request: NextRequest): AuthHeaders {
  const staffId = request.headers.get('x-staff-id')
  const staffRole = request.headers.get('x-staff-role')
  return { staffId: staffId || undefined, staffRole: staffRole || undefined }
}

// GET /api/ops/manufacturing-command/receiving — Receiving & Putaway dashboard
export async function GET(request: NextRequest) {
  const auth = getAuthHeaders(request)

  if (!auth.staffId || !auth.staffRole) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  try {
    const today = new Date()
    today.setHours(0, 0, 0, 0)

    // 1. AWAITING RECEIPT: POs with status SENT_TO_VENDOR
    const awaitingReceipt: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        po."id",
        po."poNumber",
        po."total",
        po."expectedDate",
        v."name" AS "vendorName",
        CAST((SELECT COUNT(*) FROM "PurchaseOrderItem" poi WHERE poi."purchaseOrderId" = po."id") AS INTEGER) AS "itemCount"
      FROM "PurchaseOrder" po
      JOIN "Vendor" v ON v."id" = po."vendorId"
      WHERE po."status"::text = 'SENT_TO_VENDOR'
      ORDER BY po."expectedDate" ASC
    `)

    const awaitingWithDays = awaitingReceipt.map((po: any) => ({
      ...po,
      total: Number(po.total),
      daysUntilDue: Math.ceil(
        (new Date(po.expectedDate).getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
      ),
    }))

    // 2. PARTIALLY RECEIVED: POs with status PARTIALLY_RECEIVED
    const partiallyReceived: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        po."id",
        po."poNumber",
        po."total",
        po."expectedDate",
        v."name" AS "vendorName",
        CAST((SELECT COUNT(*) FROM "PurchaseOrderItem" poi WHERE poi."purchaseOrderId" = po."id") AS INTEGER) AS "itemCount",
        CAST((SELECT COALESCE(SUM("receivedQty"), 0) FROM "PurchaseOrderItem" poi WHERE poi."purchaseOrderId" = po."id") AS INTEGER) AS "receivedCount"
      FROM "PurchaseOrder" po
      JOIN "Vendor" v ON v."id" = po."vendorId"
      WHERE po."status"::text = 'PARTIALLY_RECEIVED'
      ORDER BY po."expectedDate" ASC
    `)

    const partialWithDays = partiallyReceived.map((po: any) => ({
      ...po,
      total: Number(po.total),
      daysUntilDue: Math.ceil(
        (new Date(po.expectedDate).getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
      ),
    }))

    // 3. RECENTLY RECEIVED: POs received in last 14 days
    const recentlyReceived: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        po."id",
        po."poNumber",
        po."total",
        po."receivedAt",
        v."name" AS "vendorName",
        CAST((SELECT COUNT(*) FROM "PurchaseOrderItem" poi WHERE poi."purchaseOrderId" = po."id") AS INTEGER) AS "itemCount"
      FROM "PurchaseOrder" po
      JOIN "Vendor" v ON v."id" = po."vendorId"
      WHERE po."status"::text = 'RECEIVED'
        AND po."receivedAt" IS NOT NULL
        AND po."receivedAt" >= NOW() - INTERVAL '14 days'
      ORDER BY po."receivedAt" DESC
    `)

    const recentWithDates = recentlyReceived.map((po: any) => ({
      ...po,
      total: Number(po.total),
    }))

    // 4. OVERDUE: POs where expectedDate < today and status in (SENT_TO_VENDOR, APPROVED)
    const overdue: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        po."id",
        po."poNumber",
        po."total",
        po."expectedDate",
        v."name" AS "vendorName",
        CAST((SELECT COUNT(*) FROM "PurchaseOrderItem" poi WHERE poi."purchaseOrderId" = po."id") AS INTEGER) AS "itemCount"
      FROM "PurchaseOrder" po
      JOIN "Vendor" v ON v."id" = po."vendorId"
      WHERE po."expectedDate" < NOW()
        AND po."status"::text IN ('SENT_TO_VENDOR', 'APPROVED')
      ORDER BY po."expectedDate" ASC
    `)

    const overdueWithDays = overdue.map((po: any) => ({
      ...po,
      total: Number(po.total),
      daysOverdue: Math.ceil(
        (today.getTime() - new Date(po.expectedDate).getTime()) / (1000 * 60 * 60 * 24)
      ),
    }))

    // 5. SUMMARY STATS
    const summaryStats: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        COUNT(CASE WHEN po."status"::text = 'SENT_TO_VENDOR' THEN 1 END)::int AS "totalAwaiting",
        COUNT(CASE WHEN po."status"::text = 'PARTIALLY_RECEIVED' THEN 1 END)::int AS "totalPartiallyReceived",
        COUNT(CASE WHEN po."expectedDate" < NOW() AND po."status"::text IN ('SENT_TO_VENDOR', 'APPROVED') THEN 1 END)::int AS "totalOverdue",
        COUNT(CASE WHEN po."status"::text = 'RECEIVED' AND po."receivedAt" >= NOW() - INTERVAL '7 days' THEN 1 END)::int AS "receivedThisWeek",
        COUNT(CASE WHEN po."status"::text = 'RECEIVED' AND po."receivedAt" >= DATE_TRUNC('month', NOW()) THEN 1 END)::int AS "receivedThisMonth"
      FROM "PurchaseOrder" po
    `)

    const stats = summaryStats[0] || {}

    // 6. VENDOR PERFORMANCE: Top 10 vendors by PO count with avg lead time and on-time %
    const vendorPerf: any[] = await prisma.$queryRawUnsafe(`
      WITH vendor_stats AS (
        SELECT
          v."id",
          v."name" AS "vendorName",
          COUNT(po."id")::int AS "poCount",
          COALESCE(SUM(po."total"), 0)::float AS "totalSpend",
          ROUND(CAST(
            EXTRACT(EPOCH FROM (AVG(po."receivedAt" - po."orderedAt"))) / 86400 AS NUMERIC
          ), 1)::float AS "avgLeadTimeDays",
          ROUND(
            100.0 * COUNT(CASE WHEN po."receivedAt" <= po."expectedDate" THEN 1 END) /
            NULLIF(COUNT(CASE WHEN po."receivedAt" IS NOT NULL THEN 1 END), 0),
            1
          )::float AS "onTimePercent"
        FROM "Vendor" v
        LEFT JOIN "PurchaseOrder" po ON po."vendorId" = v."id"
        WHERE po."id" IS NOT NULL
        GROUP BY v."id", v."name"
        ORDER BY COUNT(po."id") DESC
        LIMIT 10
      )
      SELECT * FROM vendor_stats
    `)

    const vendorPerformance = vendorPerf.map((v: any) => ({
      ...v,
      totalSpend: Number(v.totalSpend),
      avgLeadTimeDays: Number(v.avgLeadTimeDays),
      onTimePercent: Number(v.onTimePercent),
    }))

    return NextResponse.json({
      awaitingReceipt: awaitingWithDays,
      partiallyReceived: partialWithDays,
      recentlyReceived: recentWithDates,
      overdue: overdueWithDays,
      summary: {
        totalAwaiting: stats.totalAwaiting || 0,
        totalPartiallyReceived: stats.totalPartiallyReceived || 0,
        totalOverdue: stats.totalOverdue || 0,
        receivedThisWeek: stats.receivedThisWeek || 0,
        receivedThisMonth: stats.receivedThisMonth || 0,
      },
      vendorPerformance,
    })
  } catch (error: any) {
    console.error('Error fetching receiving data:', error)
    return NextResponse.json({ error: 'Failed to load receiving data' }, { status: 500 })
  }
}

// PATCH /api/ops/manufacturing-command/receiving — Mark PO as received/partial
export async function PATCH(request: NextRequest) {
  const auth = getAuthHeaders(request)

  if (!auth.staffId || !auth.staffRole) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  try {
    const body = await request.json()
    const { poId, action } = body

    if (!poId || !action) {
      return NextResponse.json({ error: 'Missing poId or action' }, { status: 400 })
    }

    if (!['mark_received', 'mark_partial'].includes(action)) {
      return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
    }

    if (action === 'mark_received') {
      // Get all items for this PO
      const items: any[] = await prisma.$queryRawUnsafe(`
        SELECT "id", "quantity" FROM "PurchaseOrderItem" WHERE "purchaseOrderId" = $1
      `, poId)

      // Update PO status and receivedAt
      await prisma.$queryRawUnsafe(`
        UPDATE "PurchaseOrder"
        SET "status" = 'RECEIVED', "receivedAt" = NOW()
        WHERE "id" = $1
      `, poId)

      // For each item, update onHand inventory
      for (const item of items) {
        await prisma.$queryRawUnsafe(`
          UPDATE "InventoryItem"
          SET "onHand" = "onHand" + $1
          WHERE "productId" = (
            SELECT "productId" FROM "PurchaseOrderItem" WHERE "id" = $2
          )
        `, item.quantity, item.id)
      }

      return NextResponse.json({
        success: true,
        message: 'Purchase order marked as received and inventory updated',
      })
    } else if (action === 'mark_partial') {
      // Update PO status to PARTIALLY_RECEIVED
      await prisma.$queryRawUnsafe(`
        UPDATE "PurchaseOrder"
        SET "status" = 'PARTIALLY_RECEIVED'
        WHERE "id" = $1
      `, poId)

      return NextResponse.json({
        success: true,
        message: 'Purchase order marked as partially received',
      })
    }
  } catch (error: any) {
    console.error('Error updating receiving status:', error)
    return NextResponse.json({ error: 'Failed to update receiving status' }, { status: 500 })
  }
}
