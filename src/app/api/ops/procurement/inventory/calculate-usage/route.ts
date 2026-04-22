export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'
import { audit } from '@/lib/audit'

// ──────────────────────────────────────────────────────────────────────────
// POST /api/ops/procurement/inventory/calculate-usage
// AI-powered: Calculates avg daily usage from order history and updates
// reorder points, safety stock, and days of supply for all inventory items
// ──────────────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    // Audit log
    audit(request, 'CREATE', 'Procurement', undefined, { method: 'POST' }).catch(() => {})

    // Calculate daily usage from last 90 days of orders
    const usage = await prisma.$queryRawUnsafe(`
      SELECT
        p."id" as "productId",
        p."sku",
        SUM(oi."quantity")::int as "totalOrdered90d",
        ROUND(SUM(oi."quantity")::numeric / 90, 2) as "avgDailyUsage",
        COUNT(DISTINCT o."id")::int as "orderCount"
      FROM "OrderItem" oi
      JOIN "Order" o ON oi."orderId" = o."id"
      JOIN "Product" p ON oi."productId" = p."id"
      WHERE o."createdAt" > NOW() - INTERVAL '90 days'
        AND o."status" != 'CANCELLED'
      GROUP BY p."id", p."sku"
    `) as any[]

    let updated = 0
    for (const u of usage) {
      const avgDaily = Number(u.avgDailyUsage) || 0
      if (avgDaily <= 0) continue

      // AI-calculated reorder points:
      // Reorder point = (avg daily usage × lead time) + safety stock
      // Safety stock = avg daily usage × 7 days buffer
      // Reorder qty = avg daily usage × 30 days (1 month supply)
      const safetyStock = Math.ceil(avgDaily * 7)
      const avgLeadTime = 14 // default, could be supplier-specific
      const reorderPoint = Math.ceil(avgDaily * avgLeadTime) + safetyStock
      const reorderQty = Math.max(Math.ceil(avgDaily * 30), 10)

      const result = await prisma.$queryRawUnsafe(`
        UPDATE "InventoryItem"
        SET "avgDailyUsage" = $1,
            "reorderPoint" = GREATEST($2, "reorderPoint"),
            "safetyStock" = GREATEST($3, "safetyStock"),
            "reorderQty" = GREATEST($4, "reorderQty"),
            "available" = "onHand" - COALESCE("committed", 0) + COALESCE("onOrder", 0),
            "daysOfSupply" = CASE WHEN $1 > 0 THEN ("onHand" + COALESCE("onOrder", 0) - COALESCE("committed", 0)) / $1 ELSE 999 END,
            "status" = CASE
              WHEN "onHand" = 0 THEN 'OUT_OF_STOCK'
              WHEN "onHand" <= $3 THEN 'CRITICAL'
              WHEN "onHand" <= $2 THEN 'LOW_STOCK'
              WHEN "onHand" > "maxStock" THEN 'OVERSTOCK'
              ELSE 'IN_STOCK'
            END,
            "updatedAt" = NOW()
        WHERE "productId" = $5
        RETURNING "id"
      `, avgDaily, reorderPoint, safetyStock, reorderQty, u.productId) as any[]

      if (result.length > 0) updated++
    }

    return NextResponse.json({
      success: true,
      message: `Updated usage data for ${updated} inventory items based on 90-day order history`,
      itemsAnalyzed: usage.length,
      itemsUpdated: updated,
    })
  } catch (error) {
    console.error('Usage calculation error:', error)
    return NextResponse.json({ error: 'Failed to calculate usage', details: String(error) }, { status: 500 })
  }
}
