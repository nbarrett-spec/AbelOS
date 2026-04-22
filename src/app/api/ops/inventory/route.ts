export const dynamic = 'force-dynamic'

import { prisma } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'
import { audit } from '@/lib/audit'
import { safeJson } from '@/lib/safe-json'

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/ops/inventory
//   Paginated product list joined with InventoryItem.
//   Query params:
//     search        — match SKU / name / description (ILIKE)
//     category      — Product.category exact match
//     status        — healthy | low | critical | out | overstocked
//     zone          — InventoryItem.warehouseZone exact match
//     sort          — name | sku | onHand | available | category | lastMovement
//     dir           — asc | desc (default asc, desc for numeric sorts)
//     page          — 1-indexed page number (default 1)
//     limit         — page size (default 50, max 200)
// ─────────────────────────────────────────────────────────────────────────────
export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const { searchParams } = new URL(request.url)
    const search = (searchParams.get('search') || '').trim()
    const category = (searchParams.get('category') || '').trim()
    const status = (searchParams.get('status') || '').trim().toLowerCase()
    const zone = (searchParams.get('zone') || '').trim()
    const sort = (searchParams.get('sort') || 'name').trim()
    const dir = (searchParams.get('dir') || '').trim().toLowerCase() === 'desc' ? 'DESC' : 'ASC'
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10) || 1)
    const limit = Math.min(200, Math.max(1, parseInt(searchParams.get('limit') || '50', 10) || 50))
    const offset = (page - 1) * limit

    const conditions: string[] = ['p."active" = true']
    const params: any[] = []
    let i = 1

    if (search) {
      conditions.push(`(p."sku" ILIKE $${i} OR p."name" ILIKE $${i} OR COALESCE(p."description",'') ILIKE $${i})`)
      params.push(`%${search}%`)
      i++
    }
    if (category && category !== 'All') {
      conditions.push(`p."category" = $${i}`)
      params.push(category)
      i++
    }
    if (zone && zone !== 'All') {
      conditions.push(`i."warehouseZone" = $${i}`)
      params.push(zone)
      i++
    }
    // Status filtering — derived
    if (status === 'out') {
      conditions.push(`(COALESCE(i."onHand",0) <= 0)`)
    } else if (status === 'critical') {
      conditions.push(`(COALESCE(i."onHand",0) > 0 AND COALESCE(i."onHand",0) <= COALESCE(i."safetyStock",0))`)
    } else if (status === 'low') {
      conditions.push(`(COALESCE(i."onHand",0) > COALESCE(i."safetyStock",0) AND COALESCE(i."onHand",0) <= COALESCE(i."reorderPoint",0))`)
    } else if (status === 'healthy') {
      conditions.push(`(COALESCE(i."onHand",0) > COALESCE(i."reorderPoint",0) AND (i."maxStock" IS NULL OR COALESCE(i."onHand",0) <= i."maxStock"))`)
    } else if (status === 'overstocked') {
      conditions.push(`(i."maxStock" IS NOT NULL AND COALESCE(i."onHand",0) > i."maxStock")`)
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''

    // ── Sort selection (whitelisted, server-side) ──
    let orderBy = `p."name" ${dir}`
    switch (sort) {
      case 'sku':         orderBy = `p."sku" ${dir}`; break
      case 'category':    orderBy = `p."category" ${dir}, p."name" ASC`; break
      case 'onHand':      orderBy = `COALESCE(i."onHand",0) ${dir === 'ASC' ? 'ASC' : 'DESC'}`; break
      case 'available':   orderBy = `COALESCE(i."available",0) ${dir === 'ASC' ? 'ASC' : 'DESC'}`; break
      case 'lastMovement': orderBy = `i."lastReceivedAt" ${dir === 'ASC' ? 'ASC' : 'DESC'} NULLS LAST`; break
      case 'name':
      default:            orderBy = `p."name" ${dir}`
    }

    const limitParam = i; params.push(limit); i++
    const offsetParam = i; params.push(offset); i++

    const rows: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        p."id", p."sku", p."name", p."displayName", p."category", p."subcategory",
        p."manufacturer", p."basePrice", p."cost", p."imageUrl", p."thumbnailUrl",
        p."leadTimeDays", p."active", p."inStock",
        COALESCE(i."onHand",0)        AS "onHand",
        COALESCE(i."committed",0)     AS "committed",
        COALESCE(i."available",0)     AS "available",
        COALESCE(i."onOrder",0)       AS "onOrder",
        COALESCE(i."reorderPoint",0)  AS "reorderPoint",
        COALESCE(i."reorderQty",0)    AS "reorderQty",
        COALESCE(i."safetyStock",0)   AS "safetyStock",
        i."maxStock",
        i."unitCost",
        i."warehouseZone",
        i."binLocation",
        i."status"                    AS "invStatus",
        i."lastCountedAt",
        i."lastReceivedAt",
        i."avgDailyUsage",
        i."daysOfSupply"
      FROM "Product" p
      LEFT JOIN "InventoryItem" i ON i."productId" = p."id"
      ${whereClause}
      ORDER BY ${orderBy}
      LIMIT $${limitParam} OFFSET $${offsetParam}
    `, ...params)

    // ── Total ──
    const countParams = params.slice(0, -2)
    const countRes: any[] = await prisma.$queryRawUnsafe(`
      SELECT CAST(COUNT(*) AS INTEGER) AS cnt
      FROM "Product" p
      LEFT JOIN "InventoryItem" i ON i."productId" = p."id"
      ${whereClause}
    `, ...countParams)
    const total = Number(countRes[0]?.cnt || 0)

    // ── Categories + zones for filter options ──
    const cats: any[] = await prisma.$queryRawUnsafe(`
      SELECT DISTINCT p."category"
      FROM "Product" p
      WHERE p."active" = true AND p."category" IS NOT NULL
      ORDER BY p."category" ASC
    `)
    const zones: any[] = await prisma.$queryRawUnsafe(`
      SELECT DISTINCT i."warehouseZone"
      FROM "InventoryItem" i
      WHERE i."warehouseZone" IS NOT NULL AND i."warehouseZone" <> ''
      ORDER BY i."warehouseZone" ASC
    `)

    return safeJson({
      products: rows.map(r => ({
        ...r,
        basePrice: r.basePrice == null ? null : Number(r.basePrice),
        cost: r.cost == null ? null : Number(r.cost),
        unitCost: r.unitCost == null ? null : Number(r.unitCost),
        onHand: Number(r.onHand),
        committed: Number(r.committed),
        available: Number(r.available),
        onOrder: Number(r.onOrder),
        reorderPoint: Number(r.reorderPoint),
        reorderQty: Number(r.reorderQty),
        safetyStock: Number(r.safetyStock),
        maxStock: r.maxStock == null ? null : Number(r.maxStock),
        avgDailyUsage: r.avgDailyUsage == null ? null : Number(r.avgDailyUsage),
        daysOfSupply: r.daysOfSupply == null ? null : Number(r.daysOfSupply),
      })),
      total,
      page,
      pageSize: limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
      categories: cats.map(c => c.category).filter(Boolean),
      zones: zones.map(z => z.warehouseZone).filter(Boolean),
    })
  } catch (error: any) {
    console.error('Inventory list API error:', error)
    return NextResponse.json({ error: 'Internal server error', detail: String(error?.message || error) }, { status: 500 })
  }
}

// ──────────────────────────────────────────────