export const dynamic = 'force-dynamic'
import { prisma } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'

/**
 * GET /api/agent-hub/context/inventory-alerts
 * Products below reorder threshold with demand forecast context.
 * Used by Ops Agent and the daily brief.
 */
export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    // Products at or below reorder point via InventoryItem table
    const alerts: any[] = await prisma.$queryRawUnsafe(`
      WITH recent_demand AS (
        SELECT oi."productId",
               COALESCE(SUM(oi."quantity"), 0)::int AS "demand30",
               COUNT(DISTINCT o."id")::int AS "orders30"
        FROM "OrderItem" oi
        JOIN "Order" o ON o."id" = oi."orderId"
        WHERE o."createdAt" >= NOW() - INTERVAL '30 days'
          AND o."status"::text NOT IN ('CANCELLED')
        GROUP BY oi."productId"
      )
      SELECT p."id", p."name", p."sku", p."category",
             i."onHand" AS "stockQuantity",
             i."committed",
             i."available",
             i."onOrder",
             i."reorderPoint", i."reorderQty",
             i."warehouseZone", i."binLocation",
             p."cost", p."basePrice",
             COALESCE(rd."demand30", 0) AS "demand30Days",
             COALESCE(rd."orders30", 0) AS "ordersLast30Days",
             CASE
               WHEN COALESCE(rd."demand30", 0) > 0 THEN
                 ROUND(i."available"::numeric / (rd."demand30"::numeric / 30), 0)::int
               ELSE 999
             END AS "estimatedDaysOfStock"
      FROM "InventoryItem" i
      JOIN "Product" p ON p."id" = i."productId"
      LEFT JOIN recent_demand rd ON rd."productId" = p."id"
      WHERE p."active" = true
        AND i."available" <= i."reorderPoint"
      ORDER BY (i."available"::float / NULLIF(i."reorderPoint", 0)) ASC
      LIMIT 50
    `)

    const totalReorderValue = alerts.reduce(
      (sum, a) => sum + (Number(a.reorderQty) * Number(a.cost)),
      0
    )

    return NextResponse.json({
      alerts: alerts.map(a => ({
        ...a,
        stockQuantity: Number(a.stockQuantity),
        available: Number(a.available),
        committed: Number(a.committed),
        onOrder: Number(a.onOrder),
        reorderPoint: Number(a.reorderPoint),
        cost: Number(a.cost),
        basePrice: Number(a.basePrice),
        reorderValue: Number(a.reorderQty) * Number(a.cost),
        signal: Number(a.available) === 0 ? 'OUT_OF_STOCK'
          : Number(a.estimatedDaysOfStock) < 7 ? 'CRITICAL'
          : 'LOW',
      })),
      summary: {
        totalAlerts: alerts.length,
        outOfStock: alerts.filter(a => Number(a.available) === 0).length,
        totalReorderValue: Math.round(totalReorderValue * 100) / 100,
      },
    })
  } catch (error) {
    console.error('GET /api/agent-hub/context/inventory-alerts error:', error)
    return NextResponse.json({ error: 'Failed to fetch inventory alerts' }, { status: 500 })
  }
}
