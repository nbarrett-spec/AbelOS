export const dynamic = 'force-dynamic'
import { prisma } from '@/lib/prisma'
import { NextRequest } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'
import { safeJson } from '@/lib/safe-json'

export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const tomorrow = new Date(today)
    tomorrow.setDate(tomorrow.getDate() + 1)

    const twoDaysAgo = new Date(today)
    twoDaysAgo.setDate(twoDaysAgo.getDate() - 2)

    // Arriving Today - POs with expectedDate = today and not fully received
    const arrivingTodayData = await prisma.$queryRawUnsafe<any[]>(
      `SELECT
        po."id",
        po."poNumber",
        json_build_object(
          'id', v."id",
          'name', v."name",
          'code', v."code"
        ) as "vendor",
        COUNT(poi."id")::int as "itemCount",
        po."total" as "totalAmount",
        po."status"
      FROM "PurchaseOrder" po
      LEFT JOIN "Vendor" v ON po."vendorId" = v."id"
      LEFT JOIN "PurchaseOrderItem" poi ON po."id" = poi."purchaseOrderId"
      WHERE po."expectedDate" >= $1::timestamptz
        AND po."expectedDate" < $2::timestamptz
        AND po."status"::text != 'CANCELLED'
      GROUP BY po."id", v."id"
      ORDER BY po."expectedDate" ASC`,
      today.toISOString(),
      tomorrow.toISOString()
    )

    // Overdue POs - past expectedDate and not fully received
    const overdueData = await prisma.$queryRawUnsafe<any[]>(
      `SELECT
        po."id",
        po."poNumber",
        json_build_object(
          'id', v."id",
          'name', v."name",
          'code', v."code"
        ) as "vendor",
        EXTRACT(DAY FROM (NOW() - po."expectedDate"))::int as "daysOverdue",
        po."total" as "totalAmount",
        po."status"
      FROM "PurchaseOrder" po
      LEFT JOIN "Vendor" v ON po."vendorId" = v."id"
      WHERE po."expectedDate" < NOW()
        AND po."status"::text NOT IN ('RECEIVED', 'CANCELLED')
      ORDER BY po."expectedDate" ASC`
    )

    // Critically Low Items - inventory <= reorderPoint
    const criticallyLowData = await prisma.$queryRawUnsafe<any[]>(
      `SELECT
        p."id",
        p."sku",
        p."name",
        ii."onHand",
        ii."reorderPoint",
        MAX(po."createdAt") as "lastOrderDate"
      FROM "InventoryItem" ii
      LEFT JOIN "Product" p ON ii."productId" = p."id"
      LEFT JOIN "PurchaseOrderItem" poi ON p."id" = poi."productId"
      LEFT JOIN "PurchaseOrder" po ON poi."purchaseOrderId" = po."id"
      WHERE ii."onHand" <= ii."reorderPoint"
        AND ii."onHand" > 0
      GROUP BY p."id", ii."productId", p."sku", p."name", ii."onHand", ii."reorderPoint"
      ORDER BY ii."onHand" ASC
      LIMIT 20`
    )

    // Pending Approval - POs in PENDING_APPROVAL status
    const pendingApprovalData = await prisma.$queryRawUnsafe<any[]>(
      `SELECT
        po."id",
        po."poNumber",
        json_build_object(
          'id', v."id",
          'name', v."name",
          'code', v."code"
        ) as "vendor",
        po."total" as "totalAmount",
        po."createdAt",
        COUNT(poi."id")::int as "itemCount"
      FROM "PurchaseOrder" po
      LEFT JOIN "Vendor" v ON po."vendorId" = v."id"
      LEFT JOIN "PurchaseOrderItem" poi ON po."id" = poi."purchaseOrderId"
      WHERE po."status"::text = 'PENDING_APPROVAL'
      GROUP BY po."id", v."id"
      ORDER BY po."createdAt" ASC`
    )

    // Count metrics for summary
    const [openPOValue, vendorResponsesPending] = await Promise.all([
      prisma.$queryRawUnsafe<Array<{ total: number }>>(
        `SELECT COALESCE(SUM(po."total"), 0)::float as "total"
         FROM "PurchaseOrder" po
         WHERE po."status"::text IN ('SENT_TO_VENDOR', 'PARTIALLY_RECEIVED')`
      ),
      prisma.$queryRawUnsafe<Array<{ count: number }>>(
        `SELECT COUNT(*)::int as "count"
         FROM "PurchaseOrder" po
         WHERE po."status"::text = 'APPROVED'
         AND po."orderedAt" IS NULL`
      ),
    ])

    // Recent Receiving - items received in last 48 hours
    const recentReceivingData = await prisma.$queryRawUnsafe<any[]>(
      `SELECT
        p."id",
        p."sku",
        p."name",
        COALESCE(poi."receivedQty", poi."quantity") as "quantityReceived",
        po."poNumber",
        po."updatedAt" as "receivedDate"
      FROM "PurchaseOrderItem" poi
      LEFT JOIN "PurchaseOrder" po ON poi."purchaseOrderId" = po."id"
      LEFT JOIN "Product" p ON poi."productId" = p."id"
      WHERE po."updatedAt" >= $1::timestamptz
        AND po."status"::text = 'RECEIVED'
      ORDER BY po."updatedAt" DESC
      LIMIT 15`,
      twoDaysAgo.toISOString()
    )

    // Compile summary metrics
    const summary = {
      posArrivingToday: arrivingTodayData.length,
      posOverdue: overdueData.length,
      criticallyLowItems: criticallyLowData.length,
      pendingApproval: pendingApprovalData.length,
      openPOValue: openPOValue[0]?.total || 0,
      vendorResponsesPending: vendorResponsesPending[0]?.count || 0,
    }

    return safeJson({
      summary,
      arrivingToday: arrivingTodayData,
      overduePOs: overdueData,
      criticallyLow: criticallyLowData,
      pendingApproval: pendingApprovalData,
      recentReceiving: recentReceivingData,
    })
  } catch (error) {
    console.error('GET /api/ops/purchasing-briefing error:', error)
    return safeJson(
      { error: 'Failed to fetch purchasing briefing' },
      { status: 500 }
    )
  }
}
