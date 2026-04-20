export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuthWithFallback } from '@/lib/api-auth'

// Default margin protection rules (can be overridden via SystemConfig in future)
const DEFAULT_RULES = [
  {
    id: 'rule_min_margin',
    name: 'Minimum Margin Floor',
    description: 'No quote or order below this margin %',
    threshold: 15,
    unit: '%',
    category: 'PRICING',
    severity: 'BLOCK',
    active: true,
  },
  {
    id: 'rule_warn_margin',
    name: 'Margin Warning Threshold',
    description: 'Warn when margin falls below this %',
    threshold: 22,
    unit: '%',
    category: 'PRICING',
    severity: 'WARN',
    active: true,
  },
  {
    id: 'rule_max_discount',
    name: 'Maximum Discount Allowed',
    description: 'Maximum discount % without manager override',
    threshold: 20,
    unit: '%',
    category: 'DISCOUNT',
    severity: 'BLOCK',
    active: true,
  },
  {
    id: 'rule_cost_increase_alert',
    name: 'Cost Increase Alert',
    description: 'Alert when product cost increases more than this %',
    threshold: 10,
    unit: '%',
    category: 'COST',
    severity: 'WARN',
    active: true,
  },
  {
    id: 'rule_negative_margin',
    name: 'Negative Margin Block',
    description: 'Hard block on negative margin items',
    threshold: 0,
    unit: '%',
    category: 'PRICING',
    severity: 'BLOCK',
    active: true,
  },
]

/**
 * GET /api/ops/margin-rules
 * Returns active margin rules, recent violations, and product health summary
 */
export async function GET(request: NextRequest) {
  const authError = await checkStaffAuthWithFallback(request)
  if (authError) return authError

  try {
    // Fetch recent low-margin quotes (last 30 days)
    const violations: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        q."id",
        q."quoteNumber",
        q."total"::float AS total,
        q."subtotal"::float AS subtotal,
        q."createdAt",
        b."companyName" AS "builderName",
        s."firstName" || ' ' || COALESCE(s."lastName", '') AS "repName",
        CASE
          WHEN q."subtotal" > 0 THEN ((q."total" - q."subtotal") / q."subtotal" * 100)::float
          ELSE NULL
        END AS "calculatedMargin"
      FROM "Quote" q
      JOIN "Project" p ON p."id" = q."projectId"
      JOIN "Builder" b ON b."id" = p."builderId"
      LEFT JOIN "Staff" s ON s."id" = q."createdBy"
      WHERE q."createdAt" >= NOW() - INTERVAL '30 days'
      ORDER BY q."createdAt" DESC
      LIMIT 50
    `)

    // Calculate margin stats for past 30 days
    const marginStats: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        COUNT(*)::int AS "totalQuotes30d",
        COALESCE(AVG(
          CASE
            WHEN q."subtotal" > 0 THEN ((q."total" - q."subtotal") / q."subtotal" * 100)
            ELSE NULL
          END
        ), 0)::float AS "avgMargin",
        COUNT(CASE
          WHEN q."subtotal" > 0 AND ((q."total" - q."subtotal") / q."subtotal" * 100) < 15 THEN 1
        END)::int AS "belowFloor",
        COUNT(CASE
          WHEN q."subtotal" > 0 AND q."total" < q."subtotal" THEN 1
        END)::int AS "negativeMargin"
      FROM "Quote" q
      WHERE q."createdAt" >= NOW() - INTERVAL '30 days'
    `)

    const stats = marginStats[0] || {
      totalQuotes30d: 0,
      avgMargin: 0,
      belowFloor: 0,
      negativeMargin: 0,
    }

    // Product margin health
    const productHealth: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        COUNT(CASE
          WHEN p."cost" > 0 AND p."basePrice" > 0 AND ((p."basePrice" - p."cost") / p."basePrice" * 100) < 15 THEN 1
        END)::int AS "lowMarginProducts",
        COUNT(CASE
          WHEN p."cost" > 0 AND p."basePrice" > 0 AND p."basePrice" < p."cost" THEN 1
        END)::int AS "negativeMarginProducts",
        COUNT(*)::int AS "totalActiveProducts"
      FROM "Product" p
      WHERE p."active" = true
    `)

    const health = productHealth[0] || {
      lowMarginProducts: 0,
      negativeMarginProducts: 0,
      totalActiveProducts: 0,
    }

    // Filter violations to only those below threshold (15%)
    const relevantViolations = violations
      .filter(v => v.calculatedMargin !== null && v.calculatedMargin < 15)
      .slice(0, 20)

    return NextResponse.json({
      rules: DEFAULT_RULES,
      violations: relevantViolations,
      marginStats: {
        totalQuotes30d: stats.totalQuotes30d,
        avgMargin: Math.round(stats.avgMargin * 100) / 100,
        belowFloor: stats.belowFloor,
        negativeMargin: stats.negativeMargin,
      },
      productHealth: {
        lowMarginProducts: health.lowMarginProducts,
        negativeMarginProducts: health.negativeMarginProducts,
        totalActiveProducts: health.totalActiveProducts,
      },
    })
  } catch (error: any) {
    console.error('Margin rules GET error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

/**
 * POST /api/ops/margin-rules/validate
 * Validate a proposed price against margin rules
 * Body: { productId, proposedPrice, quantity, builderId? }
 */
export async function POST(request: NextRequest) {
  const authError = await checkStaffAuthWithFallback(request)
  if (authError) return authError

  try {
    const body = await request.json()
    const { productId, proposedPrice, quantity = 1, builderId } = body

    if (!productId || proposedPrice === undefined) {
      return NextResponse.json(
        { error: 'productId and proposedPrice required' },
        { status: 400 }
      )
    }

    // Fetch product
    const product: any[] = await prisma.$queryRawUnsafe(
      `SELECT "id", "cost", "basePrice", "minMargin" FROM "Product" WHERE "id" = $1`,
      productId
    )

    if (!product.length) {
      return NextResponse.json({ error: 'Product not found' }, { status: 404 })
    }

    const prod = product[0]
    const unitCost = Number(prod.cost) || 0
    const totalCost = unitCost * quantity
    const totalPrice = proposedPrice * quantity

    // Calculate margin
    const margin = totalCost > 0 ? ((totalPrice - totalCost) / totalPrice) * 100 : 0

    const warnings: string[] = []
    const blocks: string[] = []

    // Rule checks
    if (margin < 0) {
      blocks.push('Negative margin is not allowed')
    }

    if (margin < 15) {
      blocks.push(`Margin below floor (15%). Current: ${Math.round(margin)}%`)
    }

    if (margin < 22 && margin >= 15) {
      warnings.push(`Margin below warning threshold (22%). Current: ${Math.round(margin)}%`)
    }

    // Calculate discount from base price
    const basePrice = Number(prod.basePrice) || 0
    const discountPercent = basePrice > 0 ? ((basePrice - proposedPrice) / basePrice) * 100 : 0
    if (discountPercent > 20) {
      blocks.push(`Discount exceeds max (20%). Current: ${Math.round(discountPercent)}%`)
    }

    const allowed = blocks.length === 0

    return NextResponse.json({
      allowed,
      margin: Math.round(margin * 100) / 100,
      warnings,
      blocks,
      debug: {
        totalCost,
        totalPrice,
        discountPercent: Math.round(discountPercent * 100) / 100,
      },
    })
  } catch (error: any) {
    console.error('Margin rules POST error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
