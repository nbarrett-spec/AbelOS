export const dynamic = 'force-dynamic'

import * as Sentry from '@sentry/nextjs'
import { prisma } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'
import { audit } from '@/lib/audit'
import { safeJson } from '@/lib/safe-json'

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/ops/inventory/[id]
//   Full product detail: product fields, inventory, BOM (parent + components),
//   builder pricing, and pending allocations from MaterialPick.
// ─────────────────────────────────────────────────────────────────────────────
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  const productId = params.id
  if (!productId) {
    return NextResponse.json({ error: 'productId required' }, { status: 400 })
  }

  try {
    // ── 1. Product + inventory ──
    const productRows: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        p.*,
        i."id" AS "invId", i."onHand", i."committed", i."available", i."onOrder",
        i."reorderPoint", i."reorderQty", i."safetyStock", i."maxStock",
        i."unitCost", i."avgDailyUsage", i."daysOfSupply",
        i."warehouseZone", i."binLocation", i."location",
        i."status" AS "invStatus", i."lastCountedAt", i."lastReceivedAt"
      FROM "Product" p
      LEFT JOIN "InventoryItem" i ON i."productId" = p."id"
      WHERE p."id" = $1
      LIMIT 1
    `, productId)

    if (!productRows[0]) {
      return NextResponse.json({ error: 'Product not found' }, { status: 404 })
    }
    const r = productRows[0]

    // ── 2. BOM as PARENT — components this product is built from ──
    const components: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        b."id", b."quantity", b."componentType",
        c."id" AS "componentId", c."sku", c."name", c."category",
        c."thumbnailUrl", c."imageUrl",
        COALESCE(ci."onHand",0) AS "onHand",
        COALESCE(ci."available",0) AS "available"
      FROM "BomEntry" b
      JOIN "Product" c ON c."id" = b."componentId"
      LEFT JOIN "InventoryItem" ci ON ci."productId" = c."id"
      WHERE b."parentId" = $1
      ORDER BY c."name" ASC
    `, productId)

    // ── 3. BOM as COMPONENT — assemblies that USE this product ──
    const usedIn: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        b."id", b."quantity", b."componentType",
        pa."id" AS "parentId", pa."sku", pa."name", pa."category",
        pa."thumbnailUrl", pa."imageUrl"
      FROM "BomEntry" b
      JOIN "Product" pa ON pa."id" = b."parentId"
      WHERE b."componentId" = $1
      ORDER BY pa."name" ASC
    `, productId)

    // ── 4. Builder pricing ──
    const builderPricing: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        bp."id", bp."customPrice", bp."margin", bp."effectiveDate",
        b."id" AS "builderId", b."companyName", b."contactName"
      FROM "BuilderPricing" bp
      JOIN "Builder" b ON b."id" = bp."builderId"
      WHERE bp."productId" = $1
      ORDER BY b."companyName" ASC
    `, productId)

    // ── 5. Allocations (MaterialPick PENDING/PICKING in next 30 days) ──
    const allocations: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        mp."id", mp."quantity", mp."pickedQty", mp."status",
        mp."zone", mp."createdAt",
        j."id" AS "jobId", j."jobNumber", j."jobAddress" AS "address",
        j."status" AS "jobStatus",
        COALESCE(b."companyName", j."builderName") AS "builderName"
      FROM "MaterialPick" mp
      LEFT JOIN "Job" j ON j."id" = mp."jobId"
      LEFT JOIN "Order" o ON o."id" = j."orderId"
      LEFT JOIN "Builder" b ON b."id" = o."builderId"
      WHERE mp."productId" = $1
        AND mp."status" IN ('PENDING','PICKING')
      ORDER BY mp."createdAt" ASC
      LIMIT 50
    `, productId)

    // ── 6. Future demand (PENDING picks in next 30 days, total qty) ──
    const futureDemand: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        CAST(COUNT(*) AS INTEGER) AS "pickCount",
        COALESCE(SUM(mp."quantity" - COALESCE(mp."pickedQty",0)), 0) AS "qtyDue"
      FROM "MaterialPick" mp
      WHERE mp."productId" = $1
        AND mp."status" IN ('PENDING','PICKING')
        AND mp."createdAt" >= NOW() - INTERVAL '30 days'
    `, productId)

    // ── 7. Average monthly usage (last 6 months from picks) ──
    const usageRow: any[] = await prisma.$queryRawUnsafe(`
      SELECT COALESCE(SUM(mp."pickedQty"), 0) AS "total180"
      FROM "MaterialPick" mp
      WHERE mp."productId" = $1
        AND mp."pickedAt" >= NOW() - INTERVAL '180 days'
    `, productId)
    const avgMonthlyUsage = Number(usageRow[0]?.total180 || 0) / 6

    return safeJson({
      product: {
        id: r.id,
        sku: r.sku,
        name: r.name,
        displayName: r.displayName,
        description: r.description,
        category: r.category,
        subcategory: r.subcategory,
        // manufacturer column doesn't exist on Product model — removed 2026-05-06
        cost: r.cost == null ? null : Number(r.cost),
        basePrice: r.basePrice == null ? null : Number(r.basePrice),
        minMargin: r.minMargin == null ? null : Number(r.minMargin),
        doorSize: r.doorSize,
        handing: r.handing,
        coreType: r.coreType,
        panelStyle: r.panelStyle,
        jambSize: r.jambSize,
        casingCode: r.casingCode,
        hardwareFinish: r.hardwareFinish,
        material: r.material,
        fireRating: r.fireRating,
        imageUrl: r.imageUrl,
        thumbnailUrl: r.thumbnailUrl,
        imageAlt: r.imageAlt,
        active: r.active,
        inStock: r.inStock,
        leadTimeDays: r.leadTimeDays == null ? null : Number(r.leadTimeDays),
        inflowId: r.inflowId,
        inflowCategory: r.inflowCategory,
        lastSyncedAt: r.lastSyncedAt,
      },
      inventory: r.invId ? {
        id: r.invId,
        onHand: Number(r.onHand || 0),
        committed: Number(r.committed || 0),
        available: Number(r.available || 0),
        onOrder: Number(r.onOrder || 0),
        reorderPoint: Number(r.reorderPoint || 0),
        reorderQty: Number(r.reorderQty || 0),
        safetyStock: Number(r.safetyStock || 0),
        maxStock: r.maxStock == null ? null : Number(r.maxStock),
        unitCost: r.unitCost == null ? null : Number(r.unitCost),
        avgDailyUsage: r.avgDailyUsage == null ? null : Number(r.avgDailyUsage),
        daysOfSupply: r.daysOfSupply == null ? null : Number(r.daysOfSupply),
        warehouseZone: r.warehouseZone,
        binLocation: r.binLocation,
        location: r.location,
        status: r.invStatus,
        lastCountedAt: r.lastCountedAt,
        lastReceivedAt: r.lastReceivedAt,
      } : null,
      bom: {
        components: components.map(c => ({
          ...c,
          quantity: Number(c.quantity),
          onHand: Number(c.onHand),
          available: Number(c.available),
        })),
        usedIn: usedIn.map(u => ({
          ...u,
          quantity: Number(u.quantity),
        })),
        isParent: components.length > 0,
        isComponent: usedIn.length > 0,
      },
      builderPricing: builderPricing.map(bp => ({
        ...bp,
        customPrice: bp.customPrice == null ? null : Number(bp.customPrice),
        margin: bp.margin == null ? null : Number(bp.margin),
      })),
      allocations: allocations.map(a => ({
        ...a,
        quantity: Number(a.quantity),
        pickedQty: Number(a.pickedQty || 0),
      })),
      futureDemand: {
        pickCount: Number(futureDemand[0]?.pickCount || 0),
        qtyDue: Number(futureDemand[0]?.qtyDue || 0),
      },
      avgMonthlyUsage: Math.round(avgMonthlyUsage * 10) / 10,
    })
  } catch (error: any) {
    console.error('Inventory detail GET error:', error)
    Sentry.captureException(error, { tags: { route: '/api/ops/inventory/[id]', method: 'GET' } })
    return NextResponse.json({ error: 'Internal server error', detail: String(error?.message || error) }, { status: 500 })
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/ops/inventory/[id]
//   Update product description, images, and/or inventory reorder settings.
//   Body fields (all optional):
//     description, displayName, imageUrl, thumbnailUrl, imageAlt
//     reorderPoint, reorderQty, safetyStock, maxStock, warehouseZone, binLocation, unitCost
// ─────────────────────────────────────────────────────────────────────────────
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  const productId = params.id
  if (!productId) {
    return NextResponse.json({ error: 'productId required' }, { status: 400 })
  }

  try {
    const body = await request.json()
    audit(request, 'UPDATE', 'Product', productId, { fields: Object.keys(body) }).catch(() => {})

    // ── Product field updates ──
    const productFields = [
      'description', 'displayName', 'imageUrl', 'thumbnailUrl', 'imageAlt',
    ]
    const productSets: string[] = []
    const productParams: any[] = []
    let pi = 1
    for (const key of productFields) {
      if (body[key] !== undefined) {
        productSets.push(`"${key}" = $${pi}`)
        productParams.push(body[key] === '' ? null : body[key])
        pi++
      }
    }
    if (productSets.length > 0) {
      productSets.push(`"updatedAt" = NOW()`)
      productParams.push(productId)
      await prisma.$executeRawUnsafe(
        `UPDATE "Product" SET ${productSets.join(', ')} WHERE "id" = $${pi}`,
        ...productParams
      )
    }

    // ── Inventory field updates ──
    const invFields: Array<[string, 'num' | 'str']> = [
      ['reorderPoint', 'num'], ['reorderQty', 'num'], ['safetyStock', 'num'],
      ['maxStock', 'num'], ['unitCost', 'num'],
      ['warehouseZone', 'str'], ['binLocation', 'str'],
    ]
    const hasInvUpdate = invFields.some(([k]) => body[k] !== undefined)

    if (hasInvUpdate) {
      const existing: any[] = await prisma.$queryRawUnsafe(
        `SELECT "id" FROM "InventoryItem" WHERE "productId" = $1 LIMIT 1`, productId
      )

      if (existing.length === 0) {
        // Create empty inventory record so we can patch it
        await prisma.$executeRawUnsafe(`
          INSERT INTO "InventoryItem" ("id", "productId", "onHand", "committed", "onOrder",
            "available", "reorderPoint", "reorderQty", "safetyStock", "unitCost",
            "warehouseZone", "binLocation", "createdAt", "updatedAt")
          VALUES (gen_random_uuid()::text, $1, 0, 0, 0, 0,
            $2, $3, $4, $5, $6, $7, NOW(), NOW())
        `,
          productId,
          body.reorderPoint !== undefined ? Number(body.reorderPoint) : 0,
          body.reorderQty !== undefined ? Number(body.reorderQty) : 0,
          body.safetyStock !== undefined ? Number(body.safetyStock) : 0,
          body.unitCost !== undefined ? Number(body.unitCost) : 0,
          body.warehouseZone || null,
          body.binLocation || null,
        )
      } else {
        const sets: string[] = [`"updatedAt" = NOW()`]
        const sp: any[] = []
        let n = 1
        for (const [k, t] of invFields) {
          if (body[k] !== undefined) {
            sets.push(`"${k}" = $${n}`)
            if (t === 'num') {
              sp.push(body[k] === null ? null : Number(body[k]))
            } else {
              sp.push(body[k] === '' ? null : body[k])
            }
            n++
          }
        }
        sp.push(productId)
        await prisma.$executeRawUnsafe(
          `UPDATE "InventoryItem" SET ${sets.join(', ')} WHERE "productId" = $${n}`,
          ...sp
        )
      }
    }

    // Return updated detail
    const rows: any[] = await prisma.$queryRawUnsafe(`
      SELECT p.*, i."onHand", i."reorderPoint", i."reorderQty", i."safetyStock",
             i."unitCost", i."warehouseZone", i."binLocation"
      FROM "Product" p
      LEFT JOIN "InventoryItem" i ON i."productId" = p."id"
      WHERE p."id" = $1
    `, productId)

    return safeJson({ ok: true, product: rows[0] || null })
  } catch (error: any) {
    console.error('Inventory PATCH [id] error:', error)
    Sentry.captureException(error, { tags: { route: '/api/ops/inventory/[id]', method: 'PATCH' } })
    return NextResponse.json({ error: 'Internal server error', detail: String(error?.message || error) }, { status: 500 })
  }
}
