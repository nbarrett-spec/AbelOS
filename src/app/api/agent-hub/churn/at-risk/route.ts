export const dynamic = 'force-dynamic'
import { prisma } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'

/**
 * GET /api/agent-hub/churn/at-risk
 * Builders whose order frequency has dropped significantly — candidates for reactivation.
 */
export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const sp = request.nextUrl.searchParams
    const minDays = parseInt(sp.get('minDaysSinceOrder') || '60', 10)
    const limit = parseInt(sp.get('limit') || '50', 10)

    const atRisk: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        bi."builderId",
        b."companyName",
        b."contactName",
        b."email",
        b."phone",
        b."status"::text AS "accountStatus",
        bi."healthScore",
        bi."orderTrend",
        bi."paymentTrend",
        bi."totalLifetimeValue",
        bi."daysSinceLastOrder",
        bi."daysSinceLastCommunication",
        bi."avgOrderValue",
        bi."orderFrequencyDays",
        bi."crossSellScore",
        bi."creditRiskScore",
        bi."lastOrderDate",
        CASE
          WHEN bi."orderTrend"::text = 'CHURNING' THEN 'CRITICAL'
          WHEN bi."orderTrend"::text = 'DECLINING' AND bi."daysSinceLastOrder" > 90 THEN 'HIGH'
          WHEN bi."orderTrend"::text = 'DECLINING' THEN 'MEDIUM'
          WHEN bi."daysSinceLastOrder" > bi."orderFrequencyDays" * 2 THEN 'MEDIUM'
          ELSE 'LOW'
        END AS "churnRisk"
      FROM "BuilderIntelligence" bi
      JOIN "Builder" b ON b."id" = bi."builderId"
      WHERE b."status"::text NOT IN ('CLOSED', 'SUSPENDED')
        AND (
          bi."orderTrend"::text IN ('DECLINING', 'CHURNING')
          OR bi."daysSinceLastOrder" >= $1
        )
      ORDER BY
        CASE bi."orderTrend"::text
          WHEN 'CHURNING' THEN 1
          WHEN 'DECLINING' THEN 2
          ELSE 3
        END,
        bi."totalLifetimeValue" DESC
      LIMIT $2
    `, minDays, limit)

    // Segment summary
    const critical = atRisk.filter(r => r.churnRisk === 'CRITICAL')
    const high = atRisk.filter(r => r.churnRisk === 'HIGH')
    const medium = atRisk.filter(r => r.churnRisk === 'MEDIUM')

    const totalAtRiskLTV = atRisk.reduce((s, r) => s + Number(r.totalLifetimeValue || 0), 0)

    return NextResponse.json({
      data: atRisk.map(r => ({
        ...r,
        healthScore: Number(r.healthScore),
        totalLifetimeValue: Number(r.totalLifetimeValue),
        avgOrderValue: Number(r.avgOrderValue),
        crossSellScore: Number(r.crossSellScore),
        creditRiskScore: Number(r.creditRiskScore),
        daysSinceLastOrder: Number(r.daysSinceLastOrder),
      })),
      summary: {
        total: atRisk.length,
        critical: critical.length,
        high: high.length,
        medium: medium.length,
        totalAtRiskLTV: Math.round(totalAtRiskLTV),
        avgHealthScore: atRisk.length > 0
          ? Math.round(atRisk.reduce((s, r) => s + Number(r.healthScore || 0), 0) / atRisk.length)
          : 0,
      },
    })
  } catch (error) {
    console.error('GET /api/agent-hub/churn/at-risk error:', error)
    return NextResponse.json({ error: 'Failed to fetch at-risk builders' }, { status: 500 })
  }
}
