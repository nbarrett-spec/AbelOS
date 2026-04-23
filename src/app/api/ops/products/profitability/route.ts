export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuthWithFallback } from '@/lib/api-auth'
import { prisma } from '@/lib/prisma'

// ──────────────────────────────────────────────────────────────────────────
// GET /api/ops/products/profitability
// Product Profitability Analyzer — computes A-F grades for each product
// based on margin, revenue contribution, volume, and trend
// ──────────────────────────────────────────────────────────────────────────

interface ProductProfitScore {
  productId: string
  name: string
  sku: string
  category: string
  basePrice: number
  cost: number
  marginDollar: number
  marginPct: number
  compositeScore: number
  grade: 'A' | 'B' | 'C' | 'D' | 'F'
  marginScore: number
  marginGrade: 'A' | 'B' | 'C' | 'D' | 'F'
  revenueScore: number
  revenueGrade: 'A' | 'B' | 'C' | 'D' | 'F'
  volumeScore: number
  volumeGrade: 'A' | 'B' | 'C' | 'D' | 'F'
  trendScore: number
  trendGrade: 'A' | 'B' | 'C' | 'D' | 'F'
  unitsSold90d: number
  revenue90d: number
  unitsSold12mo: number
  revenue12mo: number
  grossProfit12mo: number
  trendDirection: 'UP' | 'FLAT' | 'DOWN'
  onHand: number
  flags: string[]
}

interface ProfitabilityResponse {
  products: ProductProfitScore[]
  summary: {
    totalProducts: number
    avgMargin: number
    negativeMarginCount: number
    deadStockCount: number
    zeroCostCount: number
    gradeDistribution: Record<string, number>
    totalRevenue90d: number
    totalRevenue12mo: number
    totalGrossProfit12mo: number
  }
}

function scoreToGrade(score: number): 'A' | 'B' | 'C' | 'D' | 'F' {
  if (score >= 80) return 'A'
  if (score >= 60) return 'B'
  if (score >= 40) return 'C'
  if (score >= 20) return 'D'
  return 'F'
}

function calculateCompositeScore(
  marginScore: number,
  revenueScore: number,
  volumeScore: number,
  trendScore: number
): number {
  const composite =
    marginScore * 0.4 +
    revenueScore * 0.25 +
    volumeScore * 0.2 +
    trendScore * 0.15
  return Math.round(composite)
}

export async function GET(request: NextRequest) {
  const authError = await checkStaffAuthWithFallback(request)
  if (authError) return authError

  try {
    // 1. Get all active products with base pricing
    //    NOTE: Product uses boolean `active`, not a `status` enum.
    const products: any[] = await prisma.$queryRawUnsafe(`
      SELECT p.id, p.name, p.sku, p.category, p."basePrice", p.cost,
        CASE WHEN p."basePrice" > 0
          THEN ROUND(((p."basePrice" - COALESCE(p.cost, 0)) / p."basePrice" * 100)::numeric, 1)
          ELSE 0
        END as "marginPct"
      FROM "Product" p
      WHERE p.active = true
      ORDER BY p.sku ASC
    `)

    // 2. Get 90-day revenue and volume by product (unit count = SUM(quantity), not row count)
    const revenue90d: any[] = await prisma.$queryRawUnsafe(`
      SELECT oli."productId",
        COALESCE(SUM(oli.quantity), 0)::int as "unitsSold",
        COALESCE(SUM(oli.quantity * oli."unitPrice"), 0)::float as revenue
      FROM "OrderItem" oli
      JOIN "Order" o ON o.id = oli."orderId"
      WHERE o."createdAt" >= NOW() - INTERVAL '90 days'
      GROUP BY oli."productId"
    `)

    // 2b. Get 12-month revenue and volume by product (for display columns)
    const revenue12mo: any[] = await prisma.$queryRawUnsafe(`
      SELECT oli."productId",
        COALESCE(SUM(oli.quantity), 0)::int as "unitsSold",
        COALESCE(SUM(oli.quantity * oli."unitPrice"), 0)::float as revenue
      FROM "OrderItem" oli
      JOIN "Order" o ON o.id = oli."orderId"
      WHERE o."createdAt" >= NOW() - INTERVAL '365 days'
      GROUP BY oli."productId"
    `)

    // 3. Get trend data (last 30 vs prior 30)
    const trendData: any[] = await prisma.$queryRawUnsafe(`
      SELECT oli."productId",
        COALESCE(SUM(CASE WHEN o."createdAt" >= NOW() - INTERVAL '30 days'
          THEN oli.quantity * oli."unitPrice" ELSE 0 END), 0)::float as "recent30",
        COALESCE(SUM(CASE WHEN o."createdAt" < NOW() - INTERVAL '30 days'
          AND o."createdAt" >= NOW() - INTERVAL '60 days'
          THEN oli.quantity * oli."unitPrice" ELSE 0 END), 0)::float as "prior30"
      FROM "OrderItem" oli
      JOIN "Order" o ON o.id = oli."orderId"
      WHERE o."createdAt" >= NOW() - INTERVAL '60 days'
      GROUP BY oli."productId"
    `)

    // 4. Get current inventory levels
    const inventory: any[] = await prisma.$queryRawUnsafe(`
      SELECT "productId", "onHand", "reorderPoint", COALESCE(available, 0) as available
      FROM "InventoryItem"
    `)

    // Build lookup maps
    const revenueLookup = new Map(
      revenue90d.map(r => [
        r.productId,
        { unitsSold: r.unitsSold || 0, revenue: Number(r.revenue) || 0 },
      ])
    )

    const trendLookup = new Map(
      trendData.map(t => [
        t.productId,
        { recent30: Number(t.recent30) || 0, prior30: Number(t.prior30) || 0 },
      ])
    )

    const revenue12moLookup = new Map(
      revenue12mo.map(r => [
        r.productId,
        { unitsSold: r.unitsSold || 0, revenue: Number(r.revenue) || 0 },
      ])
    )

    const inventoryLookup = new Map(
      inventory.map(i => [
        i.productId,
        { onHand: i.onHand || 0, reorderPoint: i.reorderPoint || 0 },
      ])
    )

    // Calculate total revenue and volume for percentile ranking
    const totalRevenue90d = Array.from(revenueLookup.values()).reduce(
      (sum, v) => sum + v.revenue,
      0
    )
    const volumes = Array.from(revenueLookup.values()).map(v => v.unitsSold)
    const sortedVolumes = [...volumes].sort((a, b) => a - b)

    // Score each product
    const scored: ProductProfitScore[] = products.map(p => {
      const rev = revenueLookup.get(p.id) || { unitsSold: 0, revenue: 0 }
      const rev12 = revenue12moLookup.get(p.id) || { unitsSold: 0, revenue: 0 }
      const trend = trendLookup.get(p.id) || { recent30: 0, prior30: 0 }
      const inv = inventoryLookup.get(p.id) || { onHand: 0, reorderPoint: 0 }

      const basePrice = Number(p.basePrice) || 0
      const cost = Number(p.cost) || 0
      const marginDollar = basePrice - cost
      const marginPct = Number(p.marginPct) || 0
      const grossProfit12mo = rev12.revenue - rev12.unitsSold * cost

      // 1. Margin Score (40%)
      let marginScore = 0
      if (marginPct > 30) marginScore = 100
      else if (marginPct > 20) marginScore = 80
      else if (marginPct > 10) marginScore = 60
      else if (marginPct > 5) marginScore = 40
      else marginScore = 10

      // 2. Revenue Contribution Score (25%)
      const revenueShare = totalRevenue90d > 0 ? (rev.revenue / totalRevenue90d) * 100 : 0
      let revenueScore = 0
      if (revenueShare > 2) revenueScore = 100 // Top 2%
      else if (revenueShare > 1) revenueScore = 80
      else if (revenueShare > 0.5) revenueScore = 60
      else if (revenueShare > 0.1) revenueScore = 40
      else revenueScore = 10

      // 3. Volume Score (20%) — percentile ranking
      const volumePercentile = sortedVolumes.length > 0
        ? (sortedVolumes.filter(v => v <= rev.unitsSold).length / sortedVolumes.length) * 100
        : 0
      const volumeScore = Math.round(volumePercentile)

      // 4. Trend Score (15%)
      let trendScore = 50 // neutral baseline
      let trendDirection: 'UP' | 'FLAT' | 'DOWN' = 'FLAT'

      if (trend.prior30 > 0) {
        const trendPct = (trend.recent30 - trend.prior30) / trend.prior30
        if (trendPct > 0.2) {
          trendScore = 100
          trendDirection = 'UP'
        } else if (trendPct > 0) {
          trendScore = 75
          trendDirection = 'UP'
        } else if (trendPct > -0.2) {
          trendScore = 50
          trendDirection = 'FLAT'
        } else {
          trendScore = 20
          trendDirection = 'DOWN'
        }
      }

      // Calculate composite score
      const compositeScore = calculateCompositeScore(
        marginScore,
        revenueScore,
        volumeScore,
        trendScore
      )

      // Determine flags
      const flags: string[] = []
      if (marginPct < 0) flags.push('NEGATIVE_MARGIN')
      if (marginPct > 0 && marginPct < 10) flags.push('LOW_MARGIN')
      if (inv.onHand > 0 && rev.unitsSold === 0) flags.push('DEAD_STOCK')
      if (trend.prior30 > 0 && trend.recent30 < trend.prior30 * 0.7)
        flags.push('DECLINING')
      if (compositeScore >= 80 && trendDirection === 'UP')
        flags.push('HIGH_PERFORMER')
      if (inv.onHand > 0 && inv.onHand <= inv.reorderPoint)
        flags.push('STOCKOUT_RISK')

      return {
        productId: p.id,
        name: p.name,
        sku: p.sku,
        category: p.category,
        basePrice,
        cost,
        marginDollar,
        marginPct,
        compositeScore,
        grade: scoreToGrade(compositeScore),
        marginScore: Math.round(marginScore),
        marginGrade: scoreToGrade(marginScore),
        revenueScore: Math.round(revenueScore),
        revenueGrade: scoreToGrade(revenueScore),
        volumeScore,
        volumeGrade: scoreToGrade(volumeScore),
        trendScore: Math.round(trendScore),
        trendGrade: scoreToGrade(trendScore),
        unitsSold90d: rev.unitsSold,
        revenue90d: rev.revenue,
        unitsSold12mo: rev12.unitsSold,
        revenue12mo: rev12.revenue,
        grossProfit12mo,
        trendDirection,
        onHand: inv.onHand,
        flags,
      }
    })

    // Sort by composite score descending
    scored.sort((a, b) => b.compositeScore - a.compositeScore)

    // Build summary
    const negativeMarginCount = scored.filter(p => p.marginPct < 0).length
    const deadStockCount = scored.filter(p => p.flags.includes('DEAD_STOCK')).length
    const zeroCostCount = scored.filter(p => p.cost <= 0).length
    const gradeDistribution: Record<string, number> = {
      A: 0,
      B: 0,
      C: 0,
      D: 0,
      F: 0,
    }
    scored.forEach(p => {
      gradeDistribution[p.grade]++
    })

    const avgMargin =
      scored.length > 0
        ? Math.round((scored.reduce((sum, p) => sum + p.marginPct, 0) / scored.length) * 10) / 10
        : 0

    const totalRevenue12mo = scored.reduce((sum, p) => sum + p.revenue12mo, 0)
    const totalGrossProfit12mo = scored.reduce((sum, p) => sum + p.grossProfit12mo, 0)

    const response: ProfitabilityResponse = {
      products: scored,
      summary: {
        totalProducts: scored.length,
        avgMargin,
        negativeMarginCount,
        deadStockCount,
        zeroCostCount,
        gradeDistribution,
        totalRevenue90d,
        totalRevenue12mo,
        totalGrossProfit12mo,
      },
    }

    return NextResponse.json(response)
  } catch (error: any) {
    console.error('Error calculating product profitability:', error)
    return NextResponse.json(
      { error: 'Failed to calculate product profitability' },
      { status: 500 }
    )
  }
}
