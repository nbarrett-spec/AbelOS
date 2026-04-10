export const dynamic = 'force-dynamic'
import { prisma } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'

/**
 * GET /api/agent-hub/expansion/opportunities
 * Builders with high cross-sell scores — untapped product categories they should be buying.
 */
export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const sp = request.nextUrl.searchParams
    const minScore = parseInt(sp.get('minCrossSellScore') || '40', 10)
    const limit = parseInt(sp.get('limit') || '50', 10)

    const opportunities: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        bi."builderId",
        b."companyName",
        b."contactName",
        b."email",
        b."status"::text AS "accountStatus",
        bi."healthScore",
        bi."crossSellScore",
        bi."totalLifetimeValue",
        bi."avgOrderValue",
        bi."orderTrend",
        bi."topProductCategories",
        bi."missingCategories",
        bi."estimatedWalletShare",
        bi."orderFrequencyDays",
        bi."daysSinceLastOrder",
        bi."pipelineValue"
      FROM "BuilderIntelligence" bi
      JOIN "Builder" b ON b."id" = bi."builderId"
      WHERE b."status"::text NOT IN ('CLOSED', 'SUSPENDED')
        AND bi."crossSellScore" >= $1
        AND bi."orderTrend"::text NOT IN ('CHURNING')
      ORDER BY bi."crossSellScore" DESC, bi."totalLifetimeValue" DESC
      LIMIT $2
    `, minScore, limit)

    // Compute potential revenue from expansion
    const enriched = opportunities.map(o => {
      const ltv = Number(o.totalLifetimeValue) || 0
      const walletShare = Number(o.estimatedWalletShare) || 30
      // If we capture 30% wallet share and could get to 60%, that's a 100% revenue increase
      const potentialLift = walletShare < 100 ? Math.round(ltv * ((60 - walletShare) / 100)) : 0

      return {
        ...o,
        healthScore: Number(o.healthScore),
        crossSellScore: Number(o.crossSellScore),
        totalLifetimeValue: Number(o.totalLifetimeValue),
        avgOrderValue: Number(o.avgOrderValue),
        estimatedWalletShare: walletShare,
        potentialAnnualLift: potentialLift,
        daysSinceLastOrder: Number(o.daysSinceLastOrder),
        pipelineValue: Number(o.pipelineValue),
      }
    })

    const totalPotentialLift = enriched.reduce((s, o) => s + o.potentialAnnualLift, 0)

    return NextResponse.json({
      data: enriched,
      summary: {
        total: enriched.length,
        avgCrossSellScore: enriched.length > 0
          ? Math.round(enriched.reduce((s, o) => s + o.crossSellScore, 0) / enriched.length)
          : 0,
        totalPotentialLift: Math.round(totalPotentialLift),
        avgWalletShare: enriched.length > 0
          ? Math.round(enriched.reduce((s, o) => s + o.estimatedWalletShare, 0) / enriched.length)
          : 0,
      },
    })
  } catch (error) {
    console.error('GET /api/agent-hub/expansion/opportunities error:', error)
    return NextResponse.json({ error: 'Failed to fetch expansion opportunities' }, { status: 500 })
  }
}
