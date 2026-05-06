export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireStaffAuth } from '@/lib/api-auth'

const WAREHOUSE_ROLES = [
  'ADMIN',
  'MANAGER',
  'WAREHOUSE_LEAD',
  'WAREHOUSE_TECH',
  'QC_INSPECTOR',
] as any

/**
 * GET /api/ops/gold-stock
 *
 * List every GoldStockKit with rolled-up counts and component health so the
 * warehouse page can render status at a glance.
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireStaffAuth(request, { allowedRoles: WAREHOUSE_ROLES })
    if (auth.error) return auth.error

    const rows: Array<{
      id: string
      kitCode: string
      kitName: string
      builderId: string | null
      builderName: string | null
      planId: string | null
      planName: string | null
      reorderQty: number
      minQty: number
      currentQty: number
      status: string
      avgLeadTimeDays: number | null
      lastBuiltAt: Date | null
      createdAt: Date
      componentCount: number
      onHandKits: number
      allocatedKits: number
      consumedKits: number
      canBuildMax: number
    }> = await prisma.$queryRawUnsafe(`
      SELECT
        k."id", k."kitCode", k."kitName",
        k."builderId", b."companyName" AS "builderName",
        k."planId", cfp."name" AS "planName",
        k."reorderQty", k."minQty", k."currentQty",
        k."status", k."avgLeadTimeDays", k."lastBuiltAt", k."createdAt",
        (SELECT COUNT(*)::int FROM "GoldStockKitComponent" c WHERE c."kitId" = k."id") AS "componentCount",
        (SELECT COUNT(*)::int FROM "GoldStockInstance" i WHERE i."kitId" = k."id" AND i."status" = 'ON_HAND') AS "onHandKits",
        (SELECT COUNT(*)::int FROM "GoldStockInstance" i WHERE i."kitId" = k."id" AND i."status" = 'ALLOCATED') AS "allocatedKits",
        (SELECT COUNT(*)::int FROM "GoldStockInstance" i WHERE i."kitId" = k."id" AND i."status" = 'CONSUMED') AS "consumedKits",
        COALESCE((
          SELECT MIN(FLOOR(COALESCE(ii."available", 0) / NULLIF(c."quantity", 0)))::int
          FROM "GoldStockKitComponent" c
          LEFT JOIN "InventoryItem" ii ON ii."productId" = c."productId"
          WHERE c."kitId" = k."id"
        ), 0) AS "canBuildMax"
      FROM "GoldStockKit" k
      LEFT JOIN "Builder" b ON b."id" = k."builderId"
      LEFT JOIN "CommunityFloorPlan" cfp ON cfp."id" = k."planId"
      ORDER BY k."status" ASC, (k."currentQty" < k."minQty") DESC, k."kitCode" ASC
    `)

    return NextResponse.json({ kits: rows })
  } catch (err: any) {
    console.error('GET /api/ops/gold-stock error:', err)
    return NextResponse.json(
      { error: err?.message || 'Internal error' },
      { status: 500 }
    )
  }
}
