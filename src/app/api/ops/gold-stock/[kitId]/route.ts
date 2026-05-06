export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireStaffAuth } from '@/lib/api-auth'

const WAREHOUSE_ROLES = [
  'ADMIN',
  'MANAGER',
  'WAREHOUSE_LEAD',
  'WAREHOUSE_TECH',
] as any

/**
 * GET /api/ops/gold-stock/[kitId]
 *
 * Kit detail: components + inventory headroom + every GoldStockInstance.
 */
export async function GET(
  request: NextRequest,
  ctx: { params: Promise<{ kitId: string }> }
) {
  try {
    const auth = await requireStaffAuth(request, { allowedRoles: WAREHOUSE_ROLES })
    if (auth.error) return auth.error

    const { kitId } = await ctx.params
    if (!kitId) return NextResponse.json({ error: 'Missing kitId' }, { status: 400 })

    const kitRows: any[] = await prisma.$queryRawUnsafe(
      `SELECT k.*, b."companyName" AS "builderName", cfp."name" AS "planName"
         FROM "GoldStockKit" k
         LEFT JOIN "Builder" b ON b."id" = k."builderId"
         LEFT JOIN "CommunityFloorPlan" cfp ON cfp."id" = k."planId"
         WHERE k."id" = $1 LIMIT 1`,
      kitId
    )
    if (kitRows.length === 0) {
      return NextResponse.json({ error: 'Kit not found' }, { status: 404 })
    }

    const components: any[] = await prisma.$queryRawUnsafe(
      `SELECT c."id", c."productId", c."quantity",
              p."sku", p."name",
              COALESCE(ii."onHand", 0)::int AS "onHand",
              COALESCE(ii."available", 0)::int AS "available"
         FROM "GoldStockKitComponent" c
         JOIN "Product" p ON p."id" = c."productId"
         LEFT JOIN "InventoryItem" ii ON ii."productId" = c."productId"
         WHERE c."kitId" = $1
         ORDER BY p."sku"`,
      kitId
    )

    const instances: any[] = await prisma.$queryRawUnsafe(
      `SELECT i."id", i."status", i."location", i."builtAt",
              i."builtById", i."allocatedToJobId",
              s."firstName" || ' ' || s."lastName" AS "builtByName",
              j."jobNumber" AS "allocatedJobNumber"
         FROM "GoldStockInstance" i
         LEFT JOIN "Staff" s ON s."id" = i."builtById"
         LEFT JOIN "Job" j ON j."id" = i."allocatedToJobId"
         WHERE i."kitId" = $1
         ORDER BY i."builtAt" DESC
         LIMIT 200`,
      kitId
    )

    return NextResponse.json({
      kit: kitRows[0],
      components,
      instances,
    })
  } catch (err: any) {
    console.error('GET /api/ops/gold-stock/[kitId] error:', err)
    return NextResponse.json(
      { error: err?.message || 'Internal error' },
      { status: 500 }
    )
  }
}

/**
 * PATCH /api/ops/gold-stock/[kitId]
 *
 * Toggle active/archived status or tweak reorderQty / minQty.
 */
export async function PATCH(
  request: NextRequest,
  ctx: { params: Promise<{ kitId: string }> }
) {
  try {
    const auth = await requireStaffAuth(request, {
      allowedRoles: ['ADMIN', 'MANAGER', 'WAREHOUSE_LEAD'] as any,
    })
    if (auth.error) return auth.error

    const { kitId } = await ctx.params
    if (!kitId) return NextResponse.json({ error: 'Missing kitId' }, { status: 400 })
    const body = await request.json().catch(() => ({}))

    const fields: string[] = []
    const values: any[] = []
    let i = 1
    if (typeof body.status === 'string') {
      fields.push(`"status" = $${i++}`)
      values.push(body.status)
    }
    if (typeof body.reorderQty === 'number') {
      fields.push(`"reorderQty" = $${i++}`)
      values.push(body.reorderQty)
    }
    if (typeof body.minQty === 'number') {
      fields.push(`"minQty" = $${i++}`)
      values.push(body.minQty)
    }
    if (fields.length === 0) {
      return NextResponse.json({ error: 'No updatable fields' }, { status: 400 })
    }
    values.push(kitId)

    await prisma.$executeRawUnsafe(
      `UPDATE "GoldStockKit" SET ${fields.join(', ')} WHERE "id" = $${i}`,
      ...values
    )

    return NextResponse.json({ ok: true })
  } catch (err: any) {
    console.error('PATCH /api/ops/gold-stock/[kitId] error:', err)
    return NextResponse.json(
      { error: err?.message || 'Internal error' },
      { status: 500 }
    )
  }
}
