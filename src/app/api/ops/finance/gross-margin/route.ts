export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'
import { prisma } from '@/lib/prisma'

/**
 * GET /api/ops/finance/gross-margin
 *
 * Gross margin by builder, YTD:
 *   revenue = sum of paid (or invoiced) OrderItem.lineTotal
 *   cogs    = sum of OrderItem.quantity * product.cost
 *   gm$     = revenue - cogs
 *   gm%     = gm$ / revenue
 *
 * Uses raw SQL for speed — at scale this saves a lot over Prisma relation loads.
 */
export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const year = new Date().getUTCFullYear()
    const jan1 = new Date(Date.UTC(year, 0, 1))

    const rows = await prisma.$queryRaw<
      Array<{
        builderId: string
        companyName: string
        revenue: number
        cogs: number
        orderCount: bigint | number
      }>
    >`
      SELECT
        b."id"              AS "builderId",
        b."companyName"     AS "companyName",
        COALESCE(SUM(oi."lineTotal"), 0)                            AS "revenue",
        COALESCE(SUM(oi."quantity" * COALESCE(p."cost", 0)), 0)     AS "cogs",
        COUNT(DISTINCT o."id")                                      AS "orderCount"
      FROM "Builder" b
      LEFT JOIN "Order" o ON o."builderId" = b."id"
        AND o."createdAt" >= ${jan1}
        AND o."status" NOT IN ('CANCELLED')
      LEFT JOIN "OrderItem" oi ON oi."orderId" = o."id"
      LEFT JOIN "Product" p ON p."id" = oi."productId"
      GROUP BY b."id", b."companyName"
      HAVING COALESCE(SUM(oi."lineTotal"), 0) > 0
      ORDER BY "revenue" DESC
      LIMIT 100
    `

    const result = rows.map((r) => {
      const revenue = Number(r.revenue) || 0
      const cogs = Number(r.cogs) || 0
      const gmDollar = revenue - cogs
      const gmPct = revenue > 0 ? gmDollar / revenue : 0
      let band: 'green' | 'amber' | 'red' | 'neutral' = 'neutral'
      if (revenue === 0) band = 'neutral'
      else if (gmPct >= 0.3) band = 'green'
      else if (gmPct >= 0.15) band = 'amber'
      else band = 'red'
      return {
        builderId: r.builderId,
        builderName: r.companyName,
        revenue: Math.round(revenue * 100) / 100,
        cogs: Math.round(cogs * 100) / 100,
        gmDollar: Math.round(gmDollar * 100) / 100,
        gmPct: Math.round(gmPct * 10000) / 10000,
        orderCount: Number(r.orderCount),
        band,
      }
    })

    const totals = result.reduce(
      (a, r) => {
        a.revenue += r.revenue
        a.cogs += r.cogs
        a.gmDollar += r.gmDollar
        return a
      },
      { revenue: 0, cogs: 0, gmDollar: 0 }
    )
    const totalGmPct = totals.revenue > 0 ? totals.gmDollar / totals.revenue : 0

    return NextResponse.json({
      asOf: new Date().toISOString(),
      year,
      rows: result,
      totals: {
        revenue: Math.round(totals.revenue * 100) / 100,
        cogs: Math.round(totals.cogs * 100) / 100,
        gmDollar: Math.round(totals.gmDollar * 100) / 100,
        gmPct: Math.round(totalGmPct * 10000) / 10000,
      },
    })
  } catch (err: any) {
    console.error('[finance gross-margin] error', err)
    return NextResponse.json({ error: err?.message || 'failed' }, { status: 500 })
  }
}
