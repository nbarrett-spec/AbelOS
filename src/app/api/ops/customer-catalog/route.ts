export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'

/**
 * GET /api/ops/customer-catalog
 *
 * Builder-facing product catalog (staff view of what a specific builder sees).
 *
 * Joins:
 *   - Product (active = true)
 *   - BuilderPricing (LEFT JOIN if builderId given) — builder-specific override
 *   - InventoryItem.available — for in-stock badge / filter
 *
 * Query params:
 *   builderId?:    string  — when set, joins BuilderPricing for per-builder price
 *   q?:            string  — search by name/sku/description
 *   category?:     string  — exact match on Product.category
 *   inStockOnly?:  '1' | 'true' — filter to InventoryItem.available > 0
 *   sort?:         'name' | 'priceAsc' | 'priceDesc' | 'newest' (default: 'name')
 *   page?:         number  (default 1)
 *   pageSize?:     number  (default 50, max 100)
 */
export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const { searchParams } = new URL(request.url)
    const builderId = searchParams.get('builderId') || ''
    const q = (searchParams.get('q') || '').trim()
    const category = searchParams.get('category') || ''
    const inStockOnly = ['1', 'true', 'yes'].includes(
      (searchParams.get('inStockOnly') || '').toLowerCase()
    )
    const sort = searchParams.get('sort') || 'name'
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10))
    const pageSize = Math.min(
      100,
      Math.max(1, parseInt(searchParams.get('pageSize') || '50', 10))
    )
    const skip = (page - 1) * pageSize

    // Build dynamic WHERE clause with parameterized values
    const whereConditions: string[] = ['p."active" = true']
    const params: any[] = []
    let pidx = 1

    if (q) {
      whereConditions.push(
        `(p."name" ILIKE $${pidx} OR p."sku" ILIKE $${pidx} OR p."description" ILIKE $${pidx})`
      )
      params.push(`%${q}%`)
      pidx++
    }
    if (category) {
      whereConditions.push(`p."category" = $${pidx}`)
      params.push(category)
      pidx++
    }
    if (inStockOnly) {
      whereConditions.push(`COALESCE(i."available", 0) > 0`)
    }

    const whereClause = whereConditions.join(' AND ')

    // ORDER BY whitelist (no user input in SQL string)
    // effectivePrice = COALESCE(bp.customPrice, p.basePrice)
    const sortMap: Record<string, string> = {
      name: 'p."name" ASC',
      priceAsc: 'COALESCE(bp."customPrice", p."basePrice") ASC, p."name" ASC',
      priceDesc: 'COALESCE(bp."customPrice", p."basePrice") DESC, p."name" ASC',
      newest: 'p."createdAt" DESC, p."name" ASC',
    }
    const orderBy = sortMap[sort] || sortMap.name

    // BuilderPricing JOIN — only when a builder is selected
    const bpJoin = builderId
      ? `LEFT JOIN "BuilderPricing" bp ON bp."productId" = p."id" AND bp."builderId" = $${pidx}`
      : `LEFT JOIN "BuilderPricing" bp ON FALSE`
    if (builderId) {
      params.push(builderId)
      pidx++
    }

    // Total count (pre-pagination) — same WHERE / JOIN so inStockOnly is honored
    const countSql = `
      SELECT COUNT(*)::int AS total
      FROM "Product" p
      ${bpJoin}
      LEFT JOIN "InventoryItem" i ON i."productId" = p."id"
      WHERE ${whereClause}
    `
    const countRows: { total: number }[] = await prisma.$queryRawUnsafe(
      countSql,
      ...params
    )
    const total = countRows[0]?.total || 0

    // Page of rows
    const rowsSql = `
      SELECT
        p."id",
        p."sku",
        p."name",
        p."displayName",
        p."category",
        p."subcategory",
        p."basePrice",
        p."imageUrl",
        p."thumbnailUrl",
        p."imageAlt",
        p."inStock"        AS "productInStock",
        p."createdAt",
        bp."customPrice"   AS "builderPrice",
        COALESCE(i."available", 0)::int AS "available",
        COALESCE(i."onHand",     0)::int AS "onHand"
      FROM "Product" p
      ${bpJoin}
      LEFT JOIN "InventoryItem" i ON i."productId" = p."id"
      WHERE ${whereClause}
      ORDER BY ${orderBy}
      LIMIT $${pidx} OFFSET $${pidx + 1}
    `
    const rows: any[] = await prisma.$queryRawUnsafe(
      rowsSql,
      ...params,
      pageSize,
      skip
    )

    // Distinct categories (for filter dropdown) — independent of current filters
    const cats: { category: string }[] = await prisma.$queryRawUnsafe(
      `SELECT DISTINCT "category" FROM "Product" WHERE "active" = true AND "category" IS NOT NULL ORDER BY "category" ASC`
    )

    const products = rows.map((r) => {
      const basePrice = Number(r.basePrice) || 0
      const builderPrice =
        r.builderPrice != null ? Number(r.builderPrice) : null
      const effectivePrice = builderPrice != null ? builderPrice : basePrice
      const available = Number(r.available) || 0
      return {
        id: r.id,
        sku: r.sku,
        name: r.name,
        displayName: r.displayName,
        category: r.category,
        subcategory: r.subcategory,
        basePrice,
        builderPrice,
        effectivePrice,
        priceSource: builderPrice != null ? 'builder' : 'list',
        imageUrl: r.imageUrl,
        thumbnailUrl: r.thumbnailUrl,
        imageAlt: r.imageAlt,
        available,
        inStock: available > 0,
        createdAt: r.createdAt,
      }
    })

    return NextResponse.json({
      products,
      pagination: {
        page,
        pageSize,
        total,
        pages: Math.max(1, Math.ceil(total / pageSize)),
      },
      categories: cats.map((c) => c.category).filter(Boolean),
    })
  } catch (error: any) {
    console.error('GET /api/ops/customer-catalog error:', error)
    return NextResponse.json(
      { error: 'Internal server error', details: error?.message || String(error) },
      { status: 500 }
    )
  }
}
