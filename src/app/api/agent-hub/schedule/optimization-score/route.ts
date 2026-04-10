export const dynamic = 'force-dynamic'
import { prisma } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'

/**
 * GET /api/agent-hub/schedule/optimization-score
 * Score how optimized today's delivery schedule is.
 */
export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const searchParams = request.nextUrl.searchParams
    const date = searchParams.get('date') || new Date().toISOString().split('T')[0]

    // Get today's deliveries with job + crew info
    const deliveries: any[] = await prisma.$queryRawUnsafe(`
      SELECT d."id", d."crewId", d."routeOrder", d."status"::text AS "status",
             d."address",
             j."id" AS "jobId", j."community", j."builderName",
             j."scopeType"::text AS "scopeType",
             c."name" AS "crewName"
      FROM "Delivery" d
      JOIN "Job" j ON j."id" = d."jobId"
      LEFT JOIN "Crew" c ON c."id" = d."crewId"
      WHERE j."scheduledDate"::date = $1::date
        AND d."status"::text NOT IN ('CANCELLED')
      ORDER BY d."crewId", d."routeOrder"
    `, date)

    if (deliveries.length === 0) {
      return NextResponse.json({
        date,
        totalDeliveries: 0,
        optimizationScore: 100,
        message: 'No deliveries scheduled for this date',
        metrics: {},
      })
    }

    // ── Metrics ──

    // 1. Crew utilization — how evenly distributed?
    const crewLoads: Record<string, number> = {}
    for (const d of deliveries) {
      const crew = d.crewId || 'UNASSIGNED'
      crewLoads[crew] = (crewLoads[crew] || 0) + 1
    }
    const loads = Object.values(crewLoads)
    const avgLoad = loads.reduce((s, l) => s + l, 0) / loads.length
    const maxLoad = Math.max(...loads)
    const minLoad = Math.min(...loads)
    const balanceScore = maxLoad > 0 ? Math.round((minLoad / maxLoad) * 100) : 100

    // 2. Geographic clustering — how many unique communities per crew?
    const crewCommunities: Record<string, Set<string>> = {}
    for (const d of deliveries) {
      const crew = d.crewId || 'UNASSIGNED'
      if (!crewCommunities[crew]) crewCommunities[crew] = new Set()
      crewCommunities[crew].add(d.community || d.address)
    }
    const avgCommunities = Object.values(crewCommunities).length > 0
      ? Object.values(crewCommunities).reduce((s, c) => s + c.size, 0) / Object.values(crewCommunities).length
      : 0
    const clusterScore = Math.max(0, Math.round(100 - (avgCommunities - 1) * 25))

    // 3. Unassigned deliveries
    const unassigned = deliveries.filter(d => !d.crewId).length
    const assignmentScore = Math.round(((deliveries.length - unassigned) / deliveries.length) * 100)

    // Overall score (weighted)
    const optimizationScore = Math.round(
      balanceScore * 0.25 + clusterScore * 0.40 + assignmentScore * 0.35
    )

    // Crew breakdown
    const crewBreakdown = Object.entries(crewLoads).map(([crewId, count]) => ({
      crewId,
      crewName: deliveries.find(d => d.crewId === crewId)?.crewName || 'Unassigned',
      deliveryCount: count,
      communities: crewCommunities[crewId] ? Array.from(crewCommunities[crewId]) : [],
    }))

    return NextResponse.json({
      date,
      totalDeliveries: deliveries.length,
      optimizationScore,
      metrics: {
        balanceScore,
        clusterScore,
        assignmentScore,
        avgDeliveriesPerCrew: Math.round(avgLoad * 10) / 10,
        crewCount: loads.length,
        unassigned,
      },
      crewBreakdown,
      suggestions: generateSuggestions(balanceScore, clusterScore, assignmentScore, unassigned),
    })
  } catch (error) {
    console.error('GET /api/agent-hub/schedule/optimization-score error:', error)
    return NextResponse.json({ error: 'Failed to compute optimization score' }, { status: 500 })
  }
}

function generateSuggestions(balance: number, cluster: number, assignment: number, unassigned: number): string[] {
  const suggestions: string[] = []

  if (unassigned > 0) {
    suggestions.push(`${unassigned} deliveries have no crew assigned — assign crews to improve coverage.`)
  }
  if (balance < 70) {
    suggestions.push('Crew workload is imbalanced — redistribute deliveries for more even loading.')
  }
  if (cluster < 60) {
    suggestions.push('Crews are servicing too many different areas — try clustering deliveries by community.')
  }
  if (suggestions.length === 0) {
    suggestions.push('Schedule is well-optimized. No major improvements needed.')
  }

  return suggestions
}
