export const dynamic = 'force-dynamic'
import { prisma } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'

/**
 * GET /api/agent-hub/context/pipeline
 * Full sales pipeline with deal health signals for the Sales Agent.
 */
export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    // Active deals (not WON or LOST)
    const deals: any[] = await prisma.$queryRawUnsafe(`
      SELECT d."id", d."dealNumber", d."companyName", d."contactName",
             d."stage"::text AS "stage", d."dealValue", d."probability",
             d."expectedCloseDate", d."createdAt", d."updatedAt",
             d."source"::text AS "source", d."description",
             s."firstName" || ' ' || s."lastName" AS "assignedTo"
      FROM "Deal" d
      LEFT JOIN "Staff" s ON s."id" = d."ownerId"
      WHERE d."stage"::text NOT IN ('WON', 'LOST')
      ORDER BY d."dealValue" DESC
    `)

    // Pipeline by stage
    const byStage: any[] = await prisma.$queryRawUnsafe(`
      SELECT "stage"::text AS "stage",
             COUNT(*)::int AS count,
             COALESCE(SUM("dealValue"), 0) AS "totalValue",
             COALESCE(AVG("dealValue"), 0) AS "avgValue"
      FROM "Deal"
      WHERE "stage"::text NOT IN ('WON', 'LOST')
      GROUP BY "stage"
      ORDER BY "stage"
    `)

    // Recently won deals (last 30 days)
    const recentWins: any[] = await prisma.$queryRawUnsafe(`
      SELECT d."id", d."dealNumber", d."companyName", d."dealValue", d."updatedAt"
      FROM "Deal" d
      WHERE d."stage"::text = 'WON' AND d."updatedAt" >= NOW() - INTERVAL '30 days'
      ORDER BY d."dealValue" DESC
      LIMIT 10
    `)

    // Recently lost deals (last 30 days)
    const recentLosses: any[] = await prisma.$queryRawUnsafe(`
      SELECT d."id", d."dealNumber", d."companyName", d."dealValue",
             d."updatedAt", d."lostReason"
      FROM "Deal" d
      WHERE d."stage"::text = 'LOST' AND d."updatedAt" >= NOW() - INTERVAL '30 days'
      ORDER BY d."dealValue" DESC
      LIMIT 10
    `)

    // Open quotes summary
    const quotesSummary: any[] = await prisma.$queryRawUnsafe(`
      SELECT "status"::text AS "status",
             COUNT(*)::int AS count,
             COALESCE(SUM("total"), 0) AS "totalValue"
      FROM "Quote"
      WHERE "status"::text IN ('DRAFT', 'SENT')
      GROUP BY "status"
    `)

    const now = new Date()
    const enrichedDeals = deals.map(d => {
      const daysSinceUpdate = Math.floor((now.getTime() - new Date(d.updatedAt).getTime()) / (1000 * 60 * 60 * 24))
      const isStale = daysSinceUpdate > 14
      const isOverdue = d.expectedCloseDate && new Date(d.expectedCloseDate) < now
      const value = Number(d.dealValue)
      const probability = Number(d.probability)
      return {
        ...d,
        value,
        probability,
        daysSinceUpdate,
        isStale,
        isOverdue,
        healthSignal: isOverdue ? 'CRITICAL' : isStale ? 'WARNING' : 'HEALTHY',
        weightedValue: value * (probability / 100),
      }
    })

    const totalPipelineValue = enrichedDeals.reduce((s, d) => s + d.value, 0)
    const totalWeightedValue = enrichedDeals.reduce((s, d) => s + d.weightedValue, 0)

    return NextResponse.json({
      deals: enrichedDeals,
      summary: {
        totalDeals: enrichedDeals.length,
        totalPipelineValue,
        totalWeightedValue,
        staleDeals: enrichedDeals.filter(d => d.isStale).length,
        overdueDeals: enrichedDeals.filter(d => d.isOverdue).length,
      },
      byStage: byStage.map(s => ({
        ...s,
        totalValue: Number(s.totalValue),
        avgValue: Number(s.avgValue),
      })),
      quotes: quotesSummary.map(q => ({ ...q, totalValue: Number(q.totalValue) })),
      recentWins: recentWins.map(w => ({ ...w, value: Number(w.dealValue) })),
      recentLosses: recentLosses.map(l => ({ ...l, value: Number(l.dealValue) })),
    })
  } catch (error) {
    console.error('GET /api/agent-hub/context/pipeline error:', error)
    return NextResponse.json({ error: 'Failed to fetch pipeline context' }, { status: 500 })
  }
}
