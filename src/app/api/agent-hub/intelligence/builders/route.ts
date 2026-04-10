export const dynamic = 'force-dynamic'
import { prisma } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'

/**
 * GET /api/agent-hub/intelligence/builders
 * Filterable list of builder intelligence profiles.
 * Filters: segment (at-risk, high-value, expansion-ready, churning, new), minHealth, maxHealth, orderTrend, paymentTrend
 */
export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const searchParams = request.nextUrl.searchParams
    const segment = searchParams.get('segment')
    const orderTrend = searchParams.get('orderTrend')
    const paymentTrend = searchParams.get('paymentTrend')
    const minHealth = searchParams.get('minHealth')
    const maxHealth = searchParams.get('maxHealth')
    const sortBy = searchParams.get('sortBy') || 'healthScore'
    const sortDir = searchParams.get('sortDir') === 'ASC' ? 'ASC' : 'DESC'
    const limit = parseInt(searchParams.get('limit') || '50', 10)
    const page = parseInt(searchParams.get('page') || '1', 10)
    const offset = (page - 1) * limit

    const conditions: string[] = []
    const params: any[] = []
    let idx = 1

    // Pre-built segments
    if (segment === 'at-risk') {
      conditions.push(`bi."healthScore" < 40`)
      conditions.push(`bi."orderTrend" IN ('DECLINING', 'CHURNING')`)
    } else if (segment === 'high-value') {
      conditions.push(`bi."totalLifetimeValue" > 20000`)
      conditions.push(`bi."healthScore" >= 60`)
    } else if (segment === 'expansion-ready') {
      conditions.push(`bi."crossSellScore" >= 60`)
      conditions.push(`bi."orderTrend" IN ('GROWING', 'STABLE')`)
    } else if (segment === 'churning') {
      conditions.push(`bi."orderTrend" = 'CHURNING'`)
    } else if (segment === 'new') {
      conditions.push(`bi."totalOrders" <= 2`)
    } else if (segment === 'credit-risk') {
      conditions.push(`bi."creditRiskScore" < 35`)
    }

    if (orderTrend) {
      conditions.push(`bi."orderTrend" = $${idx}`)
      params.push(orderTrend)
      idx++
    }
    if (paymentTrend) {
      conditions.push(`bi."paymentTrend" = $${idx}`)
      params.push(paymentTrend)
      idx++
    }
    if (minHealth) {
      conditions.push(`bi."healthScore" >= $${idx}`)
      params.push(parseInt(minHealth))
      idx++
    }
    if (maxHealth) {
      conditions.push(`bi."healthScore" <= $${idx}`)
      params.push(parseInt(maxHealth))
      idx++
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

    // Validate sort column
    const validSorts = ['healthScore', 'totalLifetimeValue', 'creditRiskScore', 'crossSellScore', 'daysSinceLastOrder', 'avgOrderValue', 'currentBalance']
    const sortColumn = validSorts.includes(sortBy) ? sortBy : 'healthScore'

    const countResult: any[] = await prisma.$queryRawUnsafe(
      `SELECT COUNT(*)::int AS count FROM "BuilderIntelligence" bi ${whereClause}`,
      ...params
    )
    const total = countResult[0]?.count || 0

    const profiles: any[] = await prisma.$queryRawUnsafe(`
      SELECT bi.*, b."companyName", b."contactName", b."email", b."status"::text AS "builderStatus"
      FROM "BuilderIntelligence" bi
      JOIN "Builder" b ON b."id" = bi."builderId"
      ${whereClause}
      ORDER BY bi."${sortColumn}" ${sortDir}
      LIMIT $${idx} OFFSET $${idx + 1}
    `, ...params, limit, offset)

    // Segment summary counts
    const segments: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        COUNT(*)::int AS "total",
        COUNT(CASE WHEN "healthScore" < 40 AND "orderTrend" IN ('DECLINING', 'CHURNING') THEN 1 END)::int AS "atRisk",
        COUNT(CASE WHEN "totalLifetimeValue" > 20000 AND "healthScore" >= 60 THEN 1 END)::int AS "highValue",
        COUNT(CASE WHEN "crossSellScore" >= 60 AND "orderTrend" IN ('GROWING', 'STABLE') THEN 1 END)::int AS "expansionReady",
        COUNT(CASE WHEN "orderTrend" = 'CHURNING' THEN 1 END)::int AS "churning",
        COUNT(CASE WHEN "creditRiskScore" < 35 THEN 1 END)::int AS "creditRisk"
      FROM "BuilderIntelligence"
    `)

    return NextResponse.json({
      data: profiles.map(p => ({
        ...p,
        avgOrderValue: Number(p.avgOrderValue),
        totalLifetimeValue: Number(p.totalLifetimeValue),
        currentBalance: Number(p.currentBalance),
        onTimePaymentRate: Number(p.onTimePaymentRate),
        pipelineValue: Number(p.pipelineValue),
      })),
      segments: segments[0],
      pagination: { page, limit, total, pages: Math.ceil(total / limit) }
    })
  } catch (error) {
    console.error('GET /api/agent-hub/intelligence/builders error:', error)
    return NextResponse.json({ error: 'Failed to fetch builder intelligence profiles' }, { status: 500 })
  }
}
