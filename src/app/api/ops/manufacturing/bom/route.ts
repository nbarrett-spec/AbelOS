export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'
import { safeJson } from '@/lib/safe-json'

// ──────────────────────────────────────────────────────────────────────────
// GET /api/ops/manufacturing/bom — List BOMs for a parent product
// Query: ?parentId=xxx  or  ?search=keyword  or  all parents
// ──────────────────────────────────────────────────────────────────────────
export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const { searchParams } = new URL(request.url)
    const parentId = searchParams.get('parentId')
    const search = searchParams.get('search')?.trim()

    if (parentId) {
      // Get full BOM for a specific parent product
      const components: any[] = await prisma.$queryRawUnsafe(`
        SELECT
          be.id,
          be."parentId",
          be."componentId",
          be.quantity,
          be."componentType",
          be."createdAt",
          be."updatedAt",
          pp.sku as "parentSku",
          pp.name as "parentName",
          cp.sku as "componentSku",
          cp.name as "componentName",
          cp.category as "componentCategory",
          cp.cost as "componentCost",
          cp."imageUrl" as "componentImage",
          ii."onHand" as "componentOnHand",
          ii."committed" as "componentCommitted",
          ii."available" as "componentAvailable"
        FROM "BomEntry" be
        JOIN "Product" pp ON be."parentId" = pp.id
        JOIN "Product" cp ON be."componentId" = cp.id
        LEFT JOIN "InventoryItem" ii ON ii."productId" = cp.id
        WHERE be."parentId" = $1
        ORDER BY
          CASE be."componentType"
            WHEN 'Slab' THEN 1
            WHEN 'Jamb' THEN 2
            WHEN 'Casing' THEN 3
            WHEN 'Hinge' THEN 4
            WHEN 'Lockset' THEN 5
            WHEN 'Strike' THEN 6
            WHEN 'Stop' THEN 7
            ELSE 99
          END,
          cp.name ASC
      `, parentId)

      // Get parent product info
      const parent: any[] = await prisma.$queryRawUnsafe(`
        SELECT id, sku, name, category, cost, "basePrice", "imageUrl"
        FROM "Product"
        WHERE id = $1
      `, parentId)

      // Calculate total component cost
      const totalComponentCost = components.reduce((sum, c) => sum + (c.componentCost * c.quantity), 0)

      return safeJson({
        parent: parent[0] || null,
        components,
        totalComponentCost,
        componentCount: components.length,
      })
    }

    // List all parent products that have BOMs
    let whereClause = ''
    const params: any[] = []

    if (search) {
      whereClause = `AND (p.name ILIKE $1 OR p.sku ILIKE $1)`
      params.push(`%${search}%`)
    }

    const parents: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        p.id,
        p.sku,
        p.name,
        p.category,
        p.cost,
        p."basePrice",
        p."imageUrl",
        COUNT(be.id)::int as "componentCount",
        COALESCE(SUM(cp.cost * be.quantity), 0)::float as "totalComponentCost"
      FROM "Product" p
      JOIN "BomEntry" be ON be."parentId" = p.id
      JOIN "Product" cp ON be."componentId" = cp.id
      WHERE p.active = true ${whereClause}
      GROUP BY p.id, p.sku, p.name, p.category, p.cost, p."basePrice", p."imageUrl"
      ORDER BY p.name ASC
    `, ...params)

    // Also get products that could be parents (have no parent BOM) for the "create BOM" dropdown
    const potentialParents: any[] = await prisma.$queryRawUnsafe(`
      SELECT p.id, p.sku, p.name, p.category
      FROM "Product" p
      WHERE p.active = true
        AND p.category IN ('Interior Doors', 'Exterior Doors')
      ORDER BY p.name ASC
      LIMIT 200
    `)

    return safeJson({
      parents,
      potentialParents,
      total: parents.length,
    })
  } catch (error: any) {
    console.error('[BOM API GET] Error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch BOM data', details: error.message },
      { status: 500 }
    )
  }
}

// ──────────────────────────────────────────────────────────────────────────
// POST /api/ops/manufacturing/bom — Add a component to a BOM
// Body: { parentId, componentId, quantity, componentType }
// ──────────────────────────────────────────────────────────────────────────
export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const body = await request.json()
    const { parentId, componentId, quantity, componentType } = body

    if (!parentId || !componentId) {
      return NextResponse.json(
        { error: 'parentId and componentId are required' },
        { status: 400 }
      )
    }

    if (parentId === componentId) {
      return NextResponse.json(
        { error: 'A product cannot be a component of itself' },
        { status: 400 }
      )
    }

    // Verify both products exist
    const products: any[] = await prisma.$queryRawUnsafe(`
      SELECT id, sku, name FROM "Product" WHERE id IN ($1, $2)
    `, parentId, componentId)

    if (products.length < 2) {
      return NextResponse.json(
        { error: 'One or both products not found' },
        { status: 404 }
      )
    }

    // Check for circular reference (component can't already be a parent of parent)
    const circularCheck: any[] = await prisma.$queryRawUnsafe(`
      SELECT id FROM "BomEntry" WHERE "parentId" = $1 AND "componentId" = $2
    `, componentId, parentId)

    if (circularCheck.length > 0) {
      return NextResponse.json(
        { error: 'Circular BOM reference detected: component is already a parent of this product' },
        { status: 400 }
      )
    }

    // Upsert: insert or update if already exists
    const existing: any[] = await prisma.$queryRawUnsafe(`
      SELECT id FROM "BomEntry" WHERE "parentId" = $1 AND "componentId" = $2
    `, parentId, componentId)

    let entry: any

    if (existing.length > 0) {
      // Update existing
      const updated: any[] = await prisma.$queryRawUnsafe(`
        UPDATE "BomEntry"
        SET quantity = $1, "componentType" = $2, "updatedAt" = NOW()
        WHERE "parentId" = $3 AND "componentId" = $4
        RETURNING *
      `, quantity || 1, componentType || null, parentId, componentId)
      entry = updated[0]
    } else {
      // Insert new
      const inserted: any[] = await prisma.$queryRawUnsafe(`
        INSERT INTO "BomEntry" (id, "parentId", "componentId", quantity, "componentType", "createdAt", "updatedAt")
        VALUES (gen_random_uuid()::text, $1, $2, $3, $4, NOW(), NOW())
        RETURNING *
      `, parentId, componentId, quantity || 1, componentType || null)
      entry = inserted[0]
    }

    return NextResponse.json({
      success: true,
      entry,
      isUpdate: existing.length > 0,
    })
  } catch (error: any) {
    console.error('[BOM API POST] Error:', error)
    return NextResponse.json(
      { error: 'Failed to save BOM entry', details: error.message },
      { status: 500 }
    )
  }
}

// ──────────────────────────────────────────────────────────────────────────
// DELETE /api/ops/manufacturing/bom — Remove a component from a BOM
// Body: { bomEntryId } or { parentId, componentId }
// ──────────────────────────────────────────────────────────────────────────
export async function DELETE(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const body = await request.json()
    const { bomEntryId, parentId, componentId } = body

    if (bomEntryId) {
      await prisma.$executeRawUnsafe(`
        DELETE FROM "BomEntry" WHERE id = $1
      `, bomEntryId)
    } else if (parentId && componentId) {
      await prisma.$executeRawUnsafe(`
        DELETE FROM "BomEntry" WHERE "parentId" = $1 AND "componentId" = $2
      `, parentId, componentId)
    } else {
      return NextResponse.json(
        { error: 'Either bomEntryId or (parentId + componentId) required' },
        { status: 400 }
      )
    }

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error('[BOM API DELETE] Error:', error)
    return NextResponse.json(
      { error: 'Failed to delete BOM entry', details: error.message },
      { status: 500 }
    )
  }
}
