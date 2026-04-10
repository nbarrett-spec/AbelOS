export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/auth'

/**
 * GET /api/catalog/inventory
 *
 * Real-time inventory levels for specified products or all products.
 * Returns stock quantity, status badge, and last sync time.
 * Builder auth required.
 *
 * Query params:
 *   productIds - comma-separated product IDs (optional, returns all if omitted)
 *   category - filter by category (optional)
 */
export async function GET(request: NextRequest) {
  try {
    const session = await getSession()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const productIdsParam = searchParams.get('productIds')
    const category = searchParams.get('category')

    let inventoryQuery: string
    const params: any[] = []
    let paramIdx = 1

    if (productIdsParam) {
      const ids = productIdsParam.split(',').map((s) => s.trim()).filter(Boolean)
      inventoryQuery = `
        SELECT
          i."productId",
          p.sku,
          p.name,
          p.category,
          COALESCE(SUM(i."onHand"), 0)::int AS stock,
          MAX(i."updatedAt") AS "lastSync"
        FROM "InventoryItem" i
        JOIN "Product" p ON p.id = i."productId"
        WHERE i."productId" = ANY($${paramIdx}::text[])
        GROUP BY i."productId", p.sku, p.name, p.category
      `
      params.push(ids)
      paramIdx++
    } else {
      inventoryQuery = `
        SELECT
          i."productId",
          p.sku,
          p.name,
          p.category,
          COALESCE(SUM(i."onHand"), 0)::int AS stock,
          MAX(i."updatedAt") AS "lastSync"
        FROM "InventoryItem" i
        JOIN "Product" p ON p.id = i."productId" AND p.active = true
        ${category ? `WHERE p.category ILIKE $${paramIdx}` : ''}
        GROUP BY i."productId", p.sku, p.name, p.category
        ORDER BY p.name ASC
        LIMIT 500
      `
      if (category) {
        params.push(`%${category}%`)
        paramIdx++
      }
    }

    const rows: any[] = await prisma.$queryRawUnsafe(inventoryQuery, ...params)

    const inventory = rows.map((row) => {
      let status: 'IN_STOCK' | 'LOW_STOCK' | 'OUT_OF_STOCK'
      let color: string
      if (row.stock > 20) {
        status = 'IN_STOCK'
        color = 'green'
      } else if (row.stock > 0) {
        status = 'LOW_STOCK'
        color = 'yellow'
      } else {
        status = 'OUT_OF_STOCK'
        color = 'red'
      }

      return {
        productId: row.productId,
        sku: row.sku,
        name: row.name,
        category: row.category,
        stock: row.stock,
        status,
        color,
        lastSync: row.lastSync?.toISOString() || null,
      }
    })

    return NextResponse.json({
      inventory,
      count: inventory.length,
      timestamp: new Date().toISOString(),
    })
  } catch (error: any) {
    console.error('GET /api/catalog/inventory error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
