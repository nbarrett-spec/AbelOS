/**
 * GET /api/v1/engine/data/aegis/inventory
 * Inventory snapshot: totals + low/out stock counts + by-category breakdown.
 */

import { NextRequest, NextResponse } from 'next/server'
import { verifyEngineToken } from '@/lib/engine-auth'
import { prisma } from '@/lib/prisma'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const auth = await verifyEngineToken(req)
  if (!auth.ok) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  try {
    const [totals, byCategory, lowStock] = await Promise.all([
      prisma.$queryRaw<Array<{
        totalSkus: bigint
        inStock: bigint
        outOfStock: bigint
        lowStock: bigint
        onHandValue: number
      }>>`
        SELECT
          COUNT(*)::bigint AS "totalSkus",
          SUM(CASE WHEN "onHand" > 0 THEN 1 ELSE 0 END)::bigint AS "inStock",
          SUM(CASE WHEN "onHand" = 0 THEN 1 ELSE 0 END)::bigint AS "outOfStock",
          SUM(CASE WHEN "onHand" > 0 AND "onHand" < "reorderPoint" THEN 1 ELSE 0 END)::bigint AS "lowStock",
          COALESCE(SUM("onHand" * "unitCost"), 0)::float AS "onHandValue"
        FROM "InventoryItem"
      `,
      prisma.$queryRaw<Array<{ category: string | null; count: bigint; onHand: bigint; value: number }>>`
        SELECT
          COALESCE("category", 'uncategorized') AS category,
          COUNT(*)::bigint AS count,
          COALESCE(SUM("onHand"), 0)::bigint AS "onHand",
          COALESCE(SUM("onHand" * "unitCost"), 0)::float AS value
        FROM "InventoryItem"
        GROUP BY "category"
        ORDER BY value DESC
      `,
      prisma.$queryRaw<Array<{
        productId: string
        sku: string | null
        productName: string | null
        onHand: number
        reorderPoint: number
      }>>`
        SELECT "productId", "sku", "productName", "onHand", "reorderPoint"
        FROM "InventoryItem"
        WHERE "onHand" < "reorderPoint"
        ORDER BY ("reorderPoint" - "onHand") DESC
        LIMIT 50
      `,
    ])

    const t = totals[0] ?? {
      totalSkus: BigInt(0),
      inStock: BigInt(0),
      outOfStock: BigInt(0),
      lowStock: BigInt(0),
      onHandValue: 0,
    }

    return NextResponse.json({
      connected: true,
      total_skus: Number(t.totalSkus),
      in_stock: Number(t.inStock),
      out_of_stock: Number(t.outOfStock),
      low_stock: Number(t.lowStock),
      on_hand_value: t.onHandValue,
      by_category: byCategory.map((r) => ({
        category: r.category,
        count: Number(r.count),
        on_hand: Number(r.onHand),
        value: r.value,
      })),
      reorder_candidates: lowStock,
    })
  } catch (e: any) {
    return NextResponse.json({ connected: false, error: String(e?.message || e) })
  }
}
