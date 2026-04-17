export const dynamic = 'force-dynamic'
import { prisma } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'
import { audit } from '@/lib/audit'

// GET /api/ops/inventory — Products with stock levels from InventoryItem
export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const { searchParams } = new URL(request.url)
    const search = searchParams.get('search') || ''
    const category = searchParams.get('category') || ''
    const stockFilter = searchParams.get('stock') || '' // low, out, all
    const page = parseInt(searchParams.get('page') || '1')
    const limit = parseInt(searchParams.get('limit') || '50')
    const offset = (page - 1) * limit

    // Build parameterized WHERE clauses
    const conditions: string[] = ['p."active" = true']
    const params: any[] = []
    let paramIdx = 1

    if (search) {
      conditions.push(`(p."name" ILIKE $${paramIdx} OR p."sku" ILIKE $${paramIdx})`)
      params.push(`%${search}%`)
      paramIdx++
    }
    if (category && category !== 'All') {
      conditions.push(`p."category" = $${paramIdx}`)
      params.push(category)
      paramIdx++
    }
    if (stockFilter === 'low') {
      conditions.push(`(i."onHand" IS NOT NULL AND i."onHand" > 0 AND i."onHand" <= GREATEST(i."reorderPoint", 10))`)
    }
    if (stockFilter === 'out') {
      conditions.push(`(i."onHand" IS NULL OR i."onHand" = 0)`)
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

    // Add limit and offset as parameters
    const limitParam = paramIdx
    params.push(limit)
    paramIdx++
    const offsetParam = paramIdx
    params.push(offset)
    paramIdx++

    // Main query: left join products with inventory
    const rows: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        p."id", p."sku", p."name", p."category", p."basePrice",
        COALESCE(i."onHand", 0) AS "onHand",
        COALESCE(i."committed", 0) AS "committed",
        COALESCE(i."available", 0) AS "available",
        COALESCE(i."onOrder", 0) AS "onOrder",
        COALESCE(i."reorderPoint", 0) AS "reorderPoint",
        i."warehouseZone",
        i."binLocation",
        i."lastCountedAt"
      FROM "Product" p
      LEFT JOIN "InventoryItem" i ON i."productId" = p."id"
      ${whereClause}
      ORDER BY p."category" ASC, p."name" ASC
      LIMIT $${limitParam} OFFSET $${offsetParam}
    `, ...params)

    // Count (reuse same params minus limit/offset)
    const countParams = params.slice(0, -2)
    const countResult: any[] = await prisma.$queryRawUnsafe(`
      SELECT CAST(COUNT(*) AS INTEGER) as cnt
      FROM "Product" p
      LEFT JOIN "InventoryItem" i ON i."productId" = p."id"
      ${whereClause}
    `, ...countParams)
    const total = countResult[0]?.cnt || 0

    // Summary stats
    const stats: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        CAST(COUNT(DISTINCT i."id") AS INTEGER) as "trackedItems",
        CAST(COALESCE(SUM(i."onHand"), 0) AS INTEGER) as "totalOnHand",
        CAST(COUNT(CASE WHEN i."onHand" > 0 AND i."onHand" <= GREATEST(i."reorderPoint", 10) THEN 1 END) AS INTEGER) as "lowStock",
        CAST(COUNT(CASE WHEN i."onHand" = 0 AND i."id" IS NOT NULL THEN 1 END) AS INTEGER) as "outOfStock",
        CAST(COALESCE(SUM(i."onOrder"), 0) AS INTEGER) as "totalOnOrder"
      FROM "InventoryItem" i
    `)

    // Categories
    const cats: any[] = await prisma.$queryRawUnsafe(`
      SELECT DISTINCT p."category"
      FROM "Product" p
      WHERE p."active" = true
      ORDER BY p."category" ASC
    `)

    return NextResponse.json({
      products: rows.map(r => ({
        ...r,
        basePrice: Number(r.basePrice),
        onHand: Number(r.onHand),
        committed: Number(r.committed),
        available: Number(r.available),
        onOrder: Number(r.onOrder),
        reorderPoint: Number(r.reorderPoint),
      })),
      total,
      page,
      totalPages: Math.ceil(total / limit),
      categories: cats.map(c => c.category),
      stats: stats[0] ? {
        trackedItems: Number(stats[0].trackedItems),
        totalOnHand: Number(stats[0].totalOnHand),
        lowStock: Number(stats[0].lowStock),
        outOfStock: Number(stats[0].outOfStock),
        totalOnOrder: Number(stats[0].totalOnOrder),
      } : null,
    })
  } catch (error: any) {
    console.error('Inventory API error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// PATCH /api/ops/inventory — Update stock level for a product
export async function PATCH(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    // Audit log
    audit(request, 'UPDATE', 'Inventory', undefined, { method: 'PATCH' }).catch(() => {})

    const body = await request.json()
    const { productId, onHand, committed, onOrder, reorderPoint, reorderQty, warehouseZone, binLocation } = body

    if (!productId) {
      return NextResponse.json({ error: 'productId is required' }, { status: 400 })
    }

    // Check if inventory item exists
    const existing: any[] = await prisma.$queryRawUnsafe(
      `SELECT "id" FROM "InventoryItem" WHERE "productId" = $1 LIMIT 1`, productId
    )

    if (existing.length === 0) {
      // Create new inventory item
      const newOnHand = onHand ?? 0
      const newCommitted = committed ?? 0
      const newAvailable = newOnHand - newCommitted
      await prisma.$executeRawUnsafe(`
        INSERT INTO "InventoryItem" ("id", "productId", "onHand", "committed", "onOrder", "available",
          "reorderPoint", "reorderQty", "warehouseZone", "binLocation", "lastCountedAt")
        VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
      `, productId, newOnHand, newCommitted, onOrder ?? 0, newAvailable,
        reorderPoint ?? 0, reorderQty ?? 0, warehouseZone || null, binLocation || null)
    } else {
      // Update existing inventory item
      const setClauses: string[] = ['"lastCountedAt" = NOW()']
      if (onHand !== undefined) {
        setClauses.push(`"onHand" = ${Number(onHand)}`)
        setClauses.push(`"available" = ${Number(onHand)} - COALESCE("committed", 0)`)
      }
      if (committed !== undefined) {
        setClauses.push(`"committed" = ${Number(committed)}`)
        setClauses.push(`"available" = COALESCE("onHand", 0) - ${Number(committed)}`)
      }
      if (onOrder !== undefined) setClauses.push(`"onOrder" = ${Number(onOrder)}`)
      if (reorderPoint !== undefined) setClauses.push(`"reorderPoint" = ${Number(reorderPoint)}`)
      if (reorderQty !== undefined) setClauses.push(`"reorderQty" = ${Number(reorderQty)}`)
      if (warehouseZone !== undefined) setClauses.push(`"warehouseZone" = '${(warehouseZone || '').replace(/'/g, "''")}'`)
      if (binLocation !== undefined) setClauses.push(`"binLocation" = '${(binLocation || '').replace(/'/g, "''")}'`)

      await prisma.$executeRawUnsafe(`
        UPDATE "InventoryItem" SET ${setClauses.join(', ')} WHERE "productId" = $1
      `, productId)
    }

    // Fetch updated item
    const rows: any[] = await prisma.$queryRawUnsafe(`
      SELECT i.*, p."name" AS "productName", p."sku" AS "productSku"
      FROM "InventoryItem" i
      LEFT JOIN "Product" p ON p."id" = i."productId"
      WHERE i."productId" = $1
    `, productId)

    return NextResponse.json(rows[0] || {})
  } catch (error: any) {
    console.error('Inventory PATCH error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
