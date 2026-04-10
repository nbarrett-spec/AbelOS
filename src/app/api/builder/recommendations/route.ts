export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/auth'

interface RecommendedProduct {
  id: string
  sku: string
  name: string
  category: string
  basePrice: number
  builderPrice: number
  priceSource: string
  thumbnailUrl: string | null
  reason: string
  score?: number
}

interface RecommendationsResponse {
  frequentlyOrdered: RecommendedProduct[]
  buyAgain: RecommendedProduct[]
  frequentlyBoughtTogether: RecommendedProduct[]
  trendingInCategory: RecommendedProduct[]
}

export async function GET(request: NextRequest) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  try {
    const builderId = session.builderId

    // Get builder's pricing tier
    const builderRows: any[] = await prisma.$queryRawUnsafe(`
      SELECT "pricingTier" FROM "Builder" WHERE id = $1
    `, builderId)

    if (builderRows.length === 0) {
      return NextResponse.json({ error: 'Builder not found' }, { status: 404 })
    }

    const builderTier = builderRows[0]?.pricingTier || 'STANDARD'

    // ═══════════════════════════════════════════════════════════════════════════
    // 1. FREQUENTLY ORDERED — Top 10 products by total quantity across all orders
    // ═══════════════════════════════════════════════════════════════════════════
    const frequentlyOrderedRows: any[] = await prisma.$queryRawUnsafe(`
      WITH product_order_stats AS (
        SELECT
          p.id,
          p.sku,
          p.name,
          p.category,
          p."basePrice",
          p.cost,
          SUM(oi.quantity)::int AS total_quantity,
          COUNT(DISTINCT oi."orderId")::int AS order_count,
          ROUND((SUM(oi.quantity)::float / COUNT(DISTINCT oi."orderId"))::numeric, 2)::float AS avg_qty_per_order,
          bp."customPrice",
          tr."marginPercent" AS "tierMargin"
        FROM "Product" p
        INNER JOIN "OrderItem" oi ON oi."productId" = p.id
        INNER JOIN "Order" o ON o.id = oi."orderId"
        LEFT JOIN "BuilderPricing" bp ON bp."productId" = p.id AND bp."builderId" = $1
        LEFT JOIN "PricingTierRule" tr ON tr."tierName" = $2 AND tr.category = p.category AND tr.active = true
        WHERE o."builderId" = $1 AND p.active = true
        GROUP BY p.id, p.sku, p.name, p.category, p."basePrice", p.cost, bp."customPrice", tr."marginPercent"
        ORDER BY total_quantity DESC
        LIMIT 10
      )
      SELECT
        id,
        sku,
        name,
        category,
        "basePrice",
        cost,
        total_quantity,
        order_count,
        avg_qty_per_order,
        "customPrice",
        "tierMargin"
      FROM product_order_stats
    `, builderId, builderTier)

    const frequentlyOrdered: RecommendedProduct[] = frequentlyOrderedRows.map((row: any) => ({
      id: row.id,
      sku: row.sku,
      name: row.name,
      category: row.category,
      basePrice: Number(row.basePrice),
      builderPrice: calculateBuilderPrice(row),
      priceSource: getPriceSource(row),
      thumbnailUrl: null,
      reason: `Ordered ${row.total_quantity} total units across ${row.order_count} orders (avg ${row.avg_qty_per_order} per order)`,
      score: row.total_quantity,
    }))

    // ═══════════════════════════════════════════════════════════════════════════
    // 2. BUY AGAIN — Products ordered 30+ days ago but not in last 30 days
    // ═══════════════════════════════════════════════════════════════════════════
    const buyAgainRows: any[] = await prisma.$queryRawUnsafe(`
      WITH products_ordered_30plus_ago AS (
        SELECT DISTINCT p.id
        FROM "Product" p
        INNER JOIN "OrderItem" oi ON oi."productId" = p.id
        INNER JOIN "Order" o ON o.id = oi."orderId"
        WHERE o."builderId" = $1
          AND o."createdAt" >= NOW() - INTERVAL '90 days'
          AND o."createdAt" < NOW() - INTERVAL '30 days'
          AND p.active = true
      ),
      products_ordered_recent AS (
        SELECT DISTINCT p.id
        FROM "Product" p
        INNER JOIN "OrderItem" oi ON oi."productId" = p.id
        INNER JOIN "Order" o ON o.id = oi."orderId"
        WHERE o."builderId" = $1
          AND o."createdAt" >= NOW() - INTERVAL '30 days'
      )
      SELECT
        p.id,
        p.sku,
        p.name,
        p.category,
        p."basePrice",
        p.cost,
        MAX(o."createdAt")::timestamp AS last_ordered_date,
        SUM(oi.quantity)::int AS lifetime_quantity,
        bp."customPrice",
        tr."marginPercent" AS "tierMargin"
      FROM products_ordered_30plus_ago poa
      INNER JOIN "Product" p ON p.id = poa.id
      LEFT JOIN "OrderItem" oi ON oi."productId" = p.id
      LEFT JOIN "Order" o ON o.id = oi."orderId" AND o."builderId" = $1
      LEFT JOIN "BuilderPricing" bp ON bp."productId" = p.id AND bp."builderId" = $1
      LEFT JOIN "PricingTierRule" tr ON tr."tierName" = $2 AND tr.category = p.category AND tr.active = true
      WHERE p.id NOT IN (SELECT id FROM products_ordered_recent)
      GROUP BY p.id, p.sku, p.name, p.category, p."basePrice", p.cost, bp."customPrice", tr."marginPercent"
      ORDER BY last_ordered_date DESC
      LIMIT 8
    `, builderId, builderTier)

    const buyAgain: RecommendedProduct[] = buyAgainRows.map((row: any) => ({
      id: row.id,
      sku: row.sku,
      name: row.name,
      category: row.category,
      basePrice: Number(row.basePrice),
      builderPrice: calculateBuilderPrice(row),
      priceSource: getPriceSource(row),
      thumbnailUrl: null,
      reason: `Last ordered ${formatDaysAgo(row.last_ordered_date)} (${row.lifetime_quantity} units lifetime)`,
    }))

    // ═══════════════════════════════════════════════════════════════════════════
    // 3. FREQUENTLY BOUGHT TOGETHER
    // For builder's top 5 most-ordered products, find companions in same orders
    // ═══════════════════════════════════════════════════════════════════════════
    const topProductsRows: any[] = await prisma.$queryRawUnsafe(`
      SELECT p.id
      FROM "Product" p
      INNER JOIN "OrderItem" oi ON oi."productId" = p.id
      INNER JOIN "Order" o ON o.id = oi."orderId"
      WHERE o."builderId" = $1 AND p.active = true
      GROUP BY p.id
      ORDER BY SUM(oi.quantity) DESC
      LIMIT 5
    `, builderId)

    const topProductIds = topProductsRows.map((r: any) => r.id)
    let frequentlyBoughtTogether: RecommendedProduct[] = []

    if (topProductIds.length > 0) {
      const placeholders = topProductIds.map((_, i) => `$${i + 2}`).join(',')

      const fbtRows: any[] = await prisma.$queryRawUnsafe(`
        WITH companion_products AS (
          SELECT
            p.id,
            p.sku,
            p.name,
            p.category,
            p."basePrice",
            p.cost,
            COUNT(DISTINCT oi2."orderId")::int AS co_occurrence_count,
            ROW_NUMBER() OVER (ORDER BY COUNT(DISTINCT oi2."orderId") DESC) AS rn,
            bp."customPrice",
            tr."marginPercent" AS "tierMargin"
          FROM "OrderItem" oi1
          INNER JOIN "Order" o ON o.id = oi1."orderId"
          INNER JOIN "OrderItem" oi2 ON oi2."orderId" = o.id AND oi2."productId" != oi1."productId"
          INNER JOIN "Product" p ON p.id = oi2."productId"
          LEFT JOIN "BuilderPricing" bp ON bp."productId" = p.id AND bp."builderId" = $1
          LEFT JOIN "PricingTierRule" tr ON tr."tierName" = $2 AND tr.category = p.category AND tr.active = true
          WHERE o."builderId" = $1
            AND oi1."productId" = ANY(ARRAY[${placeholders}]::text[])
            AND p.active = true
            AND p.id NOT IN (SELECT id FROM "Product" WHERE id = ANY(ARRAY[${placeholders}]::text[]))
          GROUP BY p.id, p.sku, p.name, p.category, p."basePrice", p.cost, bp."customPrice", tr."marginPercent"
        )
        SELECT
          id, sku, name, category, "basePrice", cost,
          co_occurrence_count, "customPrice", "tierMargin"
        FROM companion_products
        WHERE rn <= 6
        ORDER BY co_occurrence_count DESC
      `, builderId, builderTier, ...topProductIds)

      frequentlyBoughtTogether = fbtRows.map((row: any) => ({
        id: row.id,
        sku: row.sku,
        name: row.name,
        category: row.category,
        basePrice: Number(row.basePrice),
        builderPrice: calculateBuilderPrice(row),
        priceSource: getPriceSource(row),
        thumbnailUrl: null,
        reason: `Paired with your top products in ${row.co_occurrence_count} orders`,
        score: row.co_occurrence_count,
      }))
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // 4. TRENDING IN CATEGORY
    // Products popular with OTHER builders in same categories, but you haven't ordered
    // ═══════════════════════════════════════════════════════════════════════════
    const trendingRows: any[] = await prisma.$queryRawUnsafe(`
      WITH builder_categories AS (
        SELECT DISTINCT p.category
        FROM "Product" p
        INNER JOIN "OrderItem" oi ON oi."productId" = p.id
        INNER JOIN "Order" o ON o.id = oi."orderId"
        WHERE o."builderId" = $1 AND p.active = true
      ),
      products_this_builder_ordered AS (
        SELECT DISTINCT p.id
        FROM "Product" p
        INNER JOIN "OrderItem" oi ON oi."productId" = p.id
        INNER JOIN "Order" o ON o.id = oi."orderId"
        WHERE o."builderId" = $1
      ),
      trending_products AS (
        SELECT
          p.id,
          p.sku,
          p.name,
          p.category,
          p."basePrice",
          p.cost,
          COUNT(DISTINCT oi."orderId")::int AS order_count,
          SUM(oi.quantity)::int AS total_units,
          ROW_NUMBER() OVER (PARTITION BY p.category ORDER BY COUNT(DISTINCT oi."orderId") DESC) AS category_rank,
          bp."customPrice",
          tr."marginPercent" AS "tierMargin"
        FROM "Product" p
        INNER JOIN "OrderItem" oi ON oi."productId" = p.id
        INNER JOIN "Order" o ON o.id = oi."orderId"
        LEFT JOIN "BuilderPricing" bp ON bp."productId" = p.id AND bp."builderId" = $1
        LEFT JOIN "PricingTierRule" tr ON tr."tierName" = $2 AND tr.category = p.category AND tr.active = true
        WHERE p.category IN (SELECT category FROM builder_categories)
          AND p.active = true
          AND p.id NOT IN (SELECT id FROM products_this_builder_ordered)
        GROUP BY p.id, p.sku, p.name, p.category, p."basePrice", p.cost, bp."customPrice", tr."marginPercent"
      )
      SELECT
        id, sku, name, category, "basePrice", cost,
        order_count, total_units, category_rank, "customPrice", "tierMargin"
      FROM trending_products
      WHERE category_rank <= 3
      ORDER BY order_count DESC
      LIMIT 8
    `, builderId, builderTier)

    const trendingInCategory: RecommendedProduct[] = trendingRows.map((row: any) => ({
      id: row.id,
      sku: row.sku,
      name: row.name,
      category: row.category,
      basePrice: Number(row.basePrice),
      builderPrice: calculateBuilderPrice(row),
      priceSource: getPriceSource(row),
      thumbnailUrl: null,
      reason: `#${row.category_rank} trending in ${row.category} (${row.order_count} other builders ordering)`,
      score: row.order_count,
    }))

    // Fetch thumbnail URLs for all recommended products
    const allRecommendedIds = [
      ...frequentlyOrdered,
      ...buyAgain,
      ...frequentlyBoughtTogether,
      ...trendingInCategory,
    ]
      .map((p) => p.id)
      .filter((id, idx, arr) => arr.indexOf(id) === idx)

    let thumbnailMap: Record<string, string | null> = {}
    if (allRecommendedIds.length > 0) {
      const placeholders = allRecommendedIds.map((_, i) => `$${i + 1}`).join(',')
      const thumbnailRows: any[] = await prisma.$queryRawUnsafe(
        `SELECT id, "thumbnailUrl" FROM "Product" WHERE id IN (${placeholders})`,
        ...allRecommendedIds
      )
      thumbnailMap = Object.fromEntries(
        thumbnailRows.map((r: any) => [r.id, r.thumbnailUrl])
      )
    }

    // Add thumbnails to all recommendations
    const addThumbnails = (products: RecommendedProduct[]) =>
      products.map((p) => ({
        ...p,
        thumbnailUrl: thumbnailMap[p.id] || null,
      }))

    return NextResponse.json({
      frequentlyOrdered: addThumbnails(frequentlyOrdered),
      buyAgain: addThumbnails(buyAgain),
      frequentlyBoughtTogether: addThumbnails(frequentlyBoughtTogether),
      trendingInCategory: addThumbnails(trendingInCategory),
    } as RecommendationsResponse)
  } catch (error: any) {
    console.error('Error fetching recommendations:', error)
    return NextResponse.json(
      { error: 'Failed to load recommendations' },
      { status: 500 }
    )
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Calculate the effective builder price using cascading priority:
 * 1. Custom pricing from BuilderPricing table
 * 2. Tier-based pricing from PricingTierRule
 * 3. Base price as fallback
 */
function calculateBuilderPrice(row: any): number {
  // If custom price exists, use it
  if (row.customPrice !== null && row.customPrice !== undefined) {
    return Number(row.customPrice)
  }

  // If tier margin exists, calculate price from cost
  if (row.tierMargin !== null && row.tierMargin !== undefined && row.cost > 0) {
    const tierPrice = row.cost / (1.0 - row.tierMargin)
    return Math.round(tierPrice * 100) / 100
  }

  // Fallback to base price
  return Number(row.basePrice)
}

/**
 * Determine price source for transparency
 */
function getPriceSource(row: any): string {
  if (row.customPrice !== null && row.customPrice !== undefined) {
    return 'CUSTOM'
  }
  if (row.tierMargin !== null && row.tierMargin !== undefined) {
    return 'TIER'
  }
  return 'BASE'
}

/**
 * Format days ago for human-readable output
 */
function formatDaysAgo(date: Date): string {
  const now = new Date()
  const diffMs = now.getTime() - new Date(date).getTime()
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

  if (diffDays < 1) return 'today'
  if (diffDays === 1) return '1 day ago'
  if (diffDays < 30) return `${diffDays} days ago`
  if (diffDays < 60) return '~1 month ago'
  if (diffDays < 365) return `~${Math.floor(diffDays / 30)} months ago`
  return `~${Math.floor(diffDays / 365)} year${Math.floor(diffDays / 365) > 1 ? 's' : ''} ago`
}
