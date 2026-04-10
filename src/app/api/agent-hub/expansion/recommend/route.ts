export const dynamic = 'force-dynamic'
import { prisma } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'

/**
 * POST /api/agent-hub/expansion/recommend
 * Generate product recommendations for a builder based on what similar builders buy.
 */
export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const body = await request.json()
    const { builderId } = body

    if (!builderId) {
      return NextResponse.json({ error: 'Missing builderId' }, { status: 400 })
    }

    // Get this builder's profile
    const builders: any[] = await prisma.$queryRawUnsafe(`
      SELECT b."id", b."companyName", b."contactName",
             bi."topProductCategories", bi."missingCategories",
             bi."crossSellScore", bi."totalLifetimeValue", bi."avgOrderValue"
      FROM "Builder" b
      LEFT JOIN "BuilderIntelligence" bi ON bi."builderId" = b."id"
      WHERE b."id" = $1
    `, builderId)

    if (builders.length === 0) {
      return NextResponse.json({ error: 'Builder not found' }, { status: 404 })
    }

    const builder = builders[0]

    // Get categories this builder currently buys
    const currentCategories: any[] = await prisma.$queryRawUnsafe(`
      SELECT DISTINCT p."category", COUNT(*)::int AS "orderCount",
             SUM(oi."quantity")::int AS "totalQty",
             SUM(oi."lineTotal")::float AS "totalSpend"
      FROM "OrderItem" oi
      JOIN "Product" p ON p."id" = oi."productId"
      JOIN "Order" o ON o."id" = oi."orderId"
      WHERE o."builderId" = $1 AND o."status"::text NOT IN ('CANCELLED')
      GROUP BY p."category"
      ORDER BY SUM(oi."lineTotal") DESC
    `, builderId)

    const buyingCategories = new Set(currentCategories.map(c => c.category))

    // Get categories that similar-sized builders buy but this one doesn't
    const avgOrderValue = Number(builder.avgOrderValue) || 0
    const orderRange = avgOrderValue > 0 ? [avgOrderValue * 0.5, avgOrderValue * 2] : [500, 10000]

    const missingCategories: any[] = await prisma.$queryRawUnsafe(`
      WITH similar_builders AS (
        SELECT bi."builderId"
        FROM "BuilderIntelligence" bi
        WHERE bi."builderId" != $1
          AND bi."avgOrderValue" BETWEEN $2 AND $3
          AND bi."orderTrend"::text NOT IN ('CHURNING')
        LIMIT 50
      ),
      similar_purchases AS (
        SELECT p."category",
               COUNT(DISTINCT o."builderId")::int AS "builderCount",
               SUM(oi."lineTotal")::float AS "totalValue",
               ROUND(AVG(oi."lineTotal")::numeric, 2)::float AS "avgLineValue"
        FROM "OrderItem" oi
        JOIN "Product" p ON p."id" = oi."productId"
        JOIN "Order" o ON o."id" = oi."orderId"
        WHERE o."builderId" IN (SELECT "builderId" FROM similar_builders)
          AND o."status"::text NOT IN ('CANCELLED')
        GROUP BY p."category"
        HAVING COUNT(DISTINCT o."builderId") >= 3
      )
      SELECT * FROM similar_purchases
      ORDER BY "builderCount" DESC
    `, builderId, orderRange[0], orderRange[1])

    // Filter to categories the builder doesn't buy + rank by adoption rate
    const recommendations = missingCategories
      .filter(mc => !buyingCategories.has(mc.category))
      .map(mc => ({
        category: mc.category,
        adoptionRate: mc.builderCount, // how many similar builders buy this
        avgLineValue: Number(mc.avgLineValue),
        totalMarketValue: Number(mc.totalValue),
        confidence: mc.builderCount >= 10 ? 'HIGH' : mc.builderCount >= 5 ? 'MEDIUM' : 'LOW',
      }))

    // Top products in recommended categories
    const topProducts: any[] = []
    for (const rec of recommendations.slice(0, 3)) {
      const products: any[] = await prisma.$queryRawUnsafe(`
        SELECT p."id", p."name", p."sku", p."category", p."basePrice",
               COUNT(DISTINCT oi."orderId")::int AS "orderFrequency"
        FROM "Product" p
        JOIN "OrderItem" oi ON oi."productId" = p."id"
        WHERE p."category" = $1 AND p."active" = true
        GROUP BY p."id", p."name", p."sku", p."category", p."basePrice"
        ORDER BY COUNT(DISTINCT oi."orderId") DESC
        LIMIT 5
      `, rec.category)

      topProducts.push({
        category: rec.category,
        products: products.map(p => ({ ...p, basePrice: Number(p.basePrice) })),
      })
    }

    return NextResponse.json({
      builder: {
        id: builder.id,
        companyName: builder.companyName,
        contactName: builder.contactName,
        crossSellScore: Number(builder.crossSellScore),
        totalLifetimeValue: Number(builder.totalLifetimeValue),
      },
      currentCategories: currentCategories.map(c => ({
        ...c, totalSpend: Number(c.totalSpend),
      })),
      recommendations,
      topProducts,
      estimatedExpansionValue: recommendations.reduce((s, r) => s + r.avgLineValue * 4, 0), // ~4 orders/year
    })
  } catch (error) {
    console.error('POST /api/agent-hub/expansion/recommend error:', error)
    return NextResponse.json({ error: 'Failed to generate recommendations' }, { status: 500 })
  }
}
