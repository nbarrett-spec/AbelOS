export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verifyToken } from '@/lib/auth'
import { mapCategory, PRODUCT_TAXONOMY } from '@/lib/product-categories'
import { apiLimiter, checkRateLimit } from '@/lib/rate-limit'

export async function GET(request: NextRequest) {
  const limited = await checkRateLimit(request, apiLimiter, 60, 'catalog')
  if (limited) return limited

  try {
    const { searchParams } = new URL(request.url)
    const search = searchParams.get('search') || ''
    const cleanCategory = searchParams.get('category') || ''
    const page = Math.max(1, parseInt(searchParams.get('page') || '1'))
    const limit = Math.max(1, Math.min(parseInt(searchParams.get('limit') || '40'), 200))
    const skip = (page - 1) * limit

    // ── Identify the logged-in builder ──────────────────────────────────
    let builderId: string | null = null
    let builderTier: string | null = null
    const sessionCookie = request.cookies.get('abel_session')
    if (sessionCookie) {
      const session = await verifyToken(sessionCookie.value)
      if (session?.builderId) {
        builderId = session.builderId
        // Get builder's pricing tier
        const builderRows: any[] = await prisma.$queryRawUnsafe(
          `SELECT "pricingTier" FROM "Builder" WHERE id = $1`, builderId
        )
        builderTier = builderRows[0]?.pricingTier || 'STANDARD'
      }
    }

    // ── Map clean category to raw categories for WHERE clause ──────────────
    // We query ALL distinct raw categories, run each through mapCategory(),
    // and collect the ones that map to the selected clean category.
    // This catches both explicit CATEGORY_MAP entries AND fuzzy matches.
    let rawCategoriesToMatch: string[] = []
    if (cleanCategory && cleanCategory !== 'All') {
      const allRawCats: any[] = await prisma.$queryRawUnsafe(
        `SELECT DISTINCT category FROM "Product" WHERE active = true ORDER BY category`
      )
      rawCategoriesToMatch = allRawCats
        .map(r => r.category as string)
        .filter(rawCat => mapCategory(rawCat).category === cleanCategory)
    }

    // ── Build product query ─────────────────────────────────────────────
    const conditions: string[] = ['p.active = true']
    const queryParams: any[] = []
    let paramIdx = 1

    if (search) {
      conditions.push(`(p.name ILIKE $${paramIdx} OR p.sku ILIKE $${paramIdx})`)
      queryParams.push(`%${search}%`)
      paramIdx++
    }

    // If cleanCategory is specified, use IN clause with mapped raw categories
    let categoryCondition = ''
    if (cleanCategory && cleanCategory !== 'All' && rawCategoriesToMatch.length > 0) {
      // Cap at 200 placeholders to avoid query size issues
      const placeholders = rawCategoriesToMatch.map((_, i) => `$${paramIdx + i}`).join(',')
      categoryCondition = ` AND p.category IN (${placeholders})`
      queryParams.push(...rawCategoriesToMatch)
      paramIdx += rawCategoriesToMatch.length
    }

    const whereClause = conditions.join(' AND ') + categoryCondition

    // Main product query with LEFT JOINs for builder-specific pricing
    let productQuery: string
    const productParams = [...queryParams]

    if (builderId) {
      // Logged-in builder: join custom pricing + tier rules
      productQuery = `
        SELECT
          p.id, p.sku, p.name, p.description, p.category, p.subcategory,
          p."basePrice", COALESCE(bom_cost(p.id), p.cost) as cost, p."displayName",
          p."doorSize", p.handing, p."coreType", p."panelStyle", p."jambSize",
          p.material, p."fireRating", p."hardwareFinish",
          p."imageUrl", p."thumbnailUrl", p."imageAlt", p.active,
          bp."customPrice",
          bp.margin AS "customMargin",
          tr."marginPercent" AS "tierMargin",
          tr."minMargin" AS "tierMinMargin",
          CASE
            WHEN bp."customPrice" IS NOT NULL THEN bp."customPrice"
            WHEN tr."marginPercent" IS NOT NULL AND COALESCE(bom_cost(p.id), p.cost) > 0
              THEN ROUND((COALESCE(bom_cost(p.id), p.cost) / (1.0 - tr."marginPercent"))::numeric, 2)
            ELSE p."basePrice"
          END AS "builderPrice",
          CASE
            WHEN bp."customPrice" IS NOT NULL THEN 'CUSTOM'
            WHEN tr."marginPercent" IS NOT NULL THEN 'TIER'
            ELSE 'BASE'
          END AS "priceSource"
        FROM "Product" p
        LEFT JOIN "BuilderPricing" bp ON bp."productId" = p.id AND bp."builderId" = $${paramIdx}
        LEFT JOIN "PricingTierRule" tr ON tr."tierName" = $${paramIdx + 1} AND tr.category = p.category AND tr.active = true
        WHERE ${whereClause}
        ORDER BY p.category ASC, p.name ASC
        LIMIT $${paramIdx + 2} OFFSET $${paramIdx + 3}
      `
      productParams.push(builderId, builderTier, limit, skip)
    } else {
      // Not logged in or no builder: return base price
      productQuery = `
        SELECT
          p.id, p.sku, p.name, p.description, p.category, p.subcategory,
          p."basePrice", p."displayName",
          p."doorSize", p.handing, p."coreType", p."panelStyle", p."jambSize",
          p.material, p."fireRating", p."hardwareFinish",
          p."imageUrl", p."thumbnailUrl", p."imageAlt", p.active,
          NULL::float AS "customPrice",
          NULL::float AS "customMargin",
          NULL::float AS "tierMargin",
          NULL::float AS "tierMinMargin",
          p."basePrice" AS "builderPrice",
          'BASE' AS "priceSource"
        FROM "Product" p
        WHERE ${whereClause}
        ORDER BY p.category ASC, p.name ASC
        LIMIT $${paramIdx} OFFSET $${paramIdx + 1}
      `
      productParams.push(limit, skip)
    }

    const products: any[] = await prisma.$queryRawUnsafe(productQuery, ...productParams)

    // ── Query inventory levels for all products ──────────────────────────────
    const productIds = products.map(p => p.id)
    let inventoryMap: Record<string, number> = {}
    if (productIds.length > 0) {
      const inventoryRows: any[] = await prisma.$queryRawUnsafe(
        `SELECT "productId", COALESCE(SUM("onHand"), 0)::int as stock
         FROM "InventoryItem"
         WHERE "productId" = ANY($1::text[])
         GROUP BY "productId"`,
        productIds
      )
      inventoryMap = Object.fromEntries(inventoryRows.map(r => [r.productId, r.stock]))
    }

    // Generic displayNames that should be replaced with raw product name
    const GENERIC_DISPLAY_NAMES = new Set([
      'Interior Door', 'Exterior Door', 'Door', 'Hardware', 'Trim',
      'Frame', 'Component', 'Miscellaneous', 'Product',
    ])

    // Map each product with clean category and subcategory
    const cleanProducts = products.map(p => {
      const mapped = mapCategory(p.category)
      // Fix bad displayNames: if displayName is a generic label, prefer raw name
      let bestName = p.displayName || p.name
      if (GENERIC_DISPLAY_NAMES.has(p.displayName?.trim())) {
        bestName = p.name
      }

      // Determine stock status
      const stock = inventoryMap[p.id] || 0
      let stockStatus: 'IN_STOCK' | 'LOW_STOCK' | 'OUT_OF_STOCK'
      if (stock > 20) {
        stockStatus = 'IN_STOCK'
      } else if (stock > 0) {
        stockStatus = 'LOW_STOCK'
      } else {
        stockStatus = 'OUT_OF_STOCK'
      }

      return {
        ...p,
        displayName: bestName,
        basePrice: Number(p.basePrice) || 0,
        builderPrice: Number(p.builderPrice) || 0,
        customPrice: p.customPrice ? Number(p.customPrice) : null,
        customMargin: p.customMargin ? Number(p.customMargin) : null,
        tierMargin: p.tierMargin ? Number(p.tierMargin) : null,
        cleanCategory: mapped.category,
        cleanSubcategory: mapped.subcategory,
        stock,
        stockStatus,
        cost: undefined, // Never expose cost to builder
      }
    })

    // ── Count query ─────────────────────────────────────────────────────
    let countQuery = `SELECT COUNT(*)::int as count FROM "Product" p WHERE ${whereClause}`
    const totalRows: any[] = await prisma.$queryRawUnsafe(countQuery, ...queryParams)
    const total = totalRows[0]?.count || 0

    // ── Categories — return clean category names (9 total) ─────────────────
    const cleanCategories = PRODUCT_TAXONOMY.map(cat => cat.name)

    return NextResponse.json({
      products: cleanProducts,
      total,
      page,
      totalPages: Math.ceil(total / limit),
      categories: cleanCategories,
      pricingTier: builderTier,
      hasPricing: !!builderId,
    })
  } catch (error: any) {
    console.error('Catalog API error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch catalog' },
      { status: 500 }
    )
  }
}
