export const dynamic = 'force-dynamic'
import { prisma } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'

/**
 * GET /api/agent-hub/pricing/analysis
 * Margin analysis across builders, products, and time periods.
 */
export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    // Overall margin analysis from orders
    const marginByCategory: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        p."category",
        COUNT(DISTINCT oi."orderId")::int AS "orderCount",
        SUM(oi."quantity")::int AS "totalUnits",
        ROUND(AVG(p."basePrice")::numeric, 2)::float AS "avgPrice",
        ROUND(AVG(p."cost")::numeric, 2)::float AS "avgCost",
        ROUND(AVG((p."basePrice" - p."cost") / NULLIF(p."basePrice", 0) * 100)::numeric, 1)::float AS "avgMarginPct",
        ROUND(SUM(oi."lineTotal")::numeric, 2)::float AS "totalRevenue"
      FROM "OrderItem" oi
      JOIN "Product" p ON p."id" = oi."productId"
      JOIN "Order" o ON o."id" = oi."orderId"
      WHERE o."status"::text NOT IN ('CANCELLED')
        AND o."createdAt" >= NOW() - INTERVAL '90 days'
      GROUP BY p."category"
      ORDER BY SUM(oi."lineTotal") DESC
    `)

    // Top 10 builders by margin
    const marginByBuilder: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        b."id" AS "builderId",
        b."companyName",
        COUNT(DISTINCT o."id")::int AS "orderCount",
        ROUND(SUM(o."total")::numeric, 2)::float AS "totalRevenue",
        ROUND(AVG(o."total")::numeric, 2)::float AS "avgOrderValue"
      FROM "Order" o
      JOIN "Builder" b ON b."id" = o."builderId"
      WHERE o."status"::text NOT IN ('CANCELLED')
        AND o."createdAt" >= NOW() - INTERVAL '90 days'
      GROUP BY b."id", b."companyName"
      ORDER BY SUM(o."total") DESC
      LIMIT 15
    `)

    // Pricing events summary
    const eventStats: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        COUNT(*)::int AS "totalEvents",
        ROUND(AVG("margin")::numeric, 1)::float AS "avgMargin",
        ROUND(SUM("savings")::numeric, 2)::float AS "totalDiscountsGiven",
        ROUND(AVG("finalPrice" / NULLIF("basePrice", 0) * 100)::numeric, 1)::float AS "avgPriceRealization"
      FROM "PricingEvent"
      WHERE "createdAt" >= NOW() - INTERVAL '30 days'
    `)

    // Active rules count
    const ruleCount: any[] = await prisma.$queryRawUnsafe(`
      SELECT COUNT(*)::int AS count FROM "PricingRule" WHERE "isActive" = true
    `)

    return NextResponse.json({
      marginByCategory,
      marginByBuilder,
      pricingEvents: eventStats[0] || {},
      activeRules: ruleCount[0]?.count || 0,
      period: '90 days',
    })
  } catch (error) {
    console.error('GET /api/agent-hub/pricing/analysis error:', error)
    return NextResponse.json({ error: 'Failed to generate analysis' }, { status: 500 })
  }
}
