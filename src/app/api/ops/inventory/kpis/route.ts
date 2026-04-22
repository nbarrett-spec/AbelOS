export const dynamic = 'force-dynamic'

import { prisma } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'
import { safeJson } from '@/lib/safe-json'

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/ops/inventory/kpis
//   Aggregate metrics for the inventory dashboard:
//     - totalSkus              count of active products
//     - trackedSkus            count of products with InventoryItem rows
//     - totalOnHand            sum of units in stock
//     - totalOnHandValue       sum(onHand * COALESCE(unitCost, product.cost))
//     - belowReorder           items with onHand <= reorderPoint and onHand > 0
//     - outOfStock             items with onHand <= 0
//     - overstocked            items above maxStock
//     - avgInventoryTurns      sum(180-day usage) / avg(onHand) over the period
//     - lowStockUrgency        sum(reorderPoint - onHand) for items at/below reorder
// ─────────────────────────────────────────────────────────────────────────────
export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const aggregates: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        CAST((SELECT COUNT(*) FROM "Product" WHERE "active" = true) AS INTEGER) AS "totalSkus",
        CAST(COUNT(i."id") AS INTEGER)                                            AS "trackedSkus",
        CAST(COALESCE(SUM(i."onHand"), 0) AS BIGINT)                              AS "totalOnHand",
        COALESCE(SUM(i."onHand" * COALESCE(i."unitCost", p."cost", 0)), 0)        AS "totalOnHandValue",
        CAST(COUNT(CASE WHEN COALESCE(i."onHand",0) > 0 AND COALESCE(i."onHand",0) <= COALESCE(i."reorderPoint",0) THEN 1 END) AS INTEGER) AS "belowReorder",
        CAST(COUNT(CASE WHEN COALESCE(i."onHand",0) <= 0 THEN 1 END) AS INTEGER)  AS "outOfStock",
        CAST(COUNT(CASE WHEN i."maxStock" IS NOT NULL AND COALESCE(i."onHand",0) > i."maxStock" THEN 1 END) AS INTEGER) AS "overstocked",
        COALESCE(AVG(NULLIF(i."onHand", 0)), 0)                                   AS "avgOnHand",
        COALESCE(SUM(GREATEST(COALESCE(i."reorderPoint",0) - COALESCE(i."onHand",0), 0)), 0) AS "lowStockUrgency"
      FROM "InventoryItem" i
      LEFT JOIN "Product" p ON p."id" = i."productId"
    `)

    // Inventory turns = annualized issues / average inventory.
    // Use last 180 days of MaterialPick (issues) as the source of truth.
    const turnsRow: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        COALESCE(SUM(mp."pickedQty"), 0) AS "issued180",
        COALESCE(AVG(NULLIF(i."onHand", 0)), 0) AS "avgOnHand"
      FROM "MaterialPick" mp
      LEFT JOIN "InventoryItem" i ON i."productId" = mp."productId"
      WHERE mp."pickedAt" >= NOW() - INTERVAL '180 days'
    `)
    const issued = Number(turnsRow[0]?.issued180 || 0)
    const avgOnHand = Number(turnsRow[0]?.avgOnHand || 0)
    const annualizedIssued = issued * 2  // 180d * 2 = 1y
    const turns = avgOnHand > 0 ? annualizedIssued / avgOnHand : 0

    // Top 5 critical items (lowest available, still active)
    const critical: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        p."id", p."sku", p."name", p."category",
        COALESCE(i."onHand",0)        AS "onHand",
        COALESCE(i."available",0)     AS "available",
        COALESCE(i."reorderPoint",0)  AS "reorderPoint"
      FROM "Product" p
      LEFT JOIN "InventoryItem" i ON i."productId" = p."id"
      WHERE p."active" = true
        AND COALESCE(i."onHand",0) <= COALESCE(i."reorderPoint",0)
      ORDER BY (COALESCE(i."onHand",0) - COALESCE(i."reorderPoint",0)) ASC,
               COALESCE(i."onHand",0) ASC
      LIMIT 5
    `)

    const k = aggregates[0] || {}

    return safeJson({
      totalSkus: Number(k.totalSkus || 0),
      trackedSkus: Number(k.trackedSkus || 0),
      totalOnHand: Number(k.totalOnHand || 0),
      totalOnHandValue: Number(k.totalOnHandValue || 0),
      belowReorder: Number(k.belowReorder || 0),
      outOfStock: Number(k.outOfStock || 0),
      overstocked: Number(k.overstocked || 0),
      avgOnHand: Number(k.avgOnHand || 0),
      lowStockUrgency: Number(k.lowStockUrgency || 0),
      avgInventoryTurns: Math.round(turns * 10) / 10,
      criticalItems: critical.map(r => ({
        id: r.id,
        sku: r.sku,
        name: r.name,
        category: r.category,
        onHand: Number(r.onHand),
        available: Number(r.available),
        reorderPoint: Number(r.reorderPoint),
      })),
    })
  } catch (error: any) {
    console.error('Inventory KPI error:', error)
    return NextResponse.json({ error: 'Internal server error', detail: String(error?.message || error) }, { status: 500 })
  }
}
