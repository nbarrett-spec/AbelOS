export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'

// GET /api/ops/sales/stats — Sales dashboard statistics
export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    // Total deals by stage with count and value
    const dealsByStage: any[] = await prisma.$queryRawUnsafe(
      `SELECT "stage"::text AS "stage", COUNT(*)::int AS count, COALESCE(SUM("dealValue"), 0) AS value
       FROM "Deal"
       GROUP BY "stage"::text
       ORDER BY "stage"::text`
    )

    // Deals by owner with count and value
    const dealsByOwner: any[] = await prisma.$queryRawUnsafe(
      `SELECT d."ownerId", s."firstName", s."lastName", s."email",
              COUNT(d.id)::int AS count, COALESCE(SUM(d."dealValue"), 0) AS value
       FROM "Deal" d
       LEFT JOIN "Staff" s ON s."id" = d."ownerId"
       WHERE d."ownerId" IS NOT NULL
       GROUP BY d."ownerId", s."firstName", s."lastName", s."email"
       ORDER BY count DESC`
    )

    // Win rate: won / (won + lost)
    const dealCounts: any[] = await prisma.$queryRawUnsafe(
      `SELECT
        COUNT(*) FILTER (WHERE "stage"::text = 'WON')::int AS won,
        COUNT(*) FILTER (WHERE "stage"::text = 'LOST')::int AS lost
       FROM "Deal"`
    )
    const { won, lost } = dealCounts[0] || { won: 0, lost: 0 }
    const winRate = won + lost > 0 ? Math.round((won / (won + lost)) * 100) : 0

    // Pipeline value: sum of dealValue where stage not WON/LOST/ONBOARDED
    const pipelineResult: any[] = await prisma.$queryRawUnsafe(
      `SELECT COALESCE(SUM("dealValue"), 0) AS value
       FROM "Deal"
       WHERE "stage"::text NOT IN ('WON', 'LOST', 'ONBOARDED')`
    )
    const pipelineValue = pipelineResult[0]?.value || 0

    // Deals closing this month
    const now = new Date()
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0)

    const closingThisMonth: any[] = await prisma.$queryRawUnsafe(
      `SELECT d.*, s."firstName", s."lastName"
       FROM "Deal" d
       LEFT JOIN "Staff" s ON s."id" = d."ownerId"
       WHERE d."expectedCloseDate" >= $1 AND d."expectedCloseDate" < $2
       AND d."stage"::text NOT IN ('WON', 'LOST', 'ONBOARDED')
       ORDER BY d."expectedCloseDate" ASC`,
      monthStart,
      monthEnd
    )

    // Recent activity: last 10 activities across all deals
    const recentActivity: any[] = await prisma.$queryRawUnsafe(
      `SELECT da.*, d."companyName", d."dealNumber", s."firstName", s."lastName"
       FROM "DealActivity" da
       LEFT JOIN "Deal" d ON d."id" = da."dealId"
       LEFT JOIN "Staff" s ON s."id" = da."staffId"
       ORDER BY da."createdAt" DESC
       LIMIT 10`
    )

    return NextResponse.json({
      stats: {
        dealsByStage: dealsByStage.map((s) => ({
          stage: s.stage,
          count: s.count,
          value: parseFloat(s.value),
        })),
        dealsByOwner: dealsByOwner.map((o) => ({
          owner: {
            id: o.ownerId,
            firstName: o.firstName,
            lastName: o.lastName,
            email: o.email,
          },
          count: o.count,
          value: parseFloat(o.value),
        })),
        winRate: `${winRate}%`,
        totalWon: won,
        totalLost: lost,
        pipelineValue: parseFloat(pipelineValue),
        closingThisMonth: closingThisMonth.map((d) => ({
          id: d.id,
          dealNumber: d.dealNumber,
          companyName: d.companyName,
          dealValue: d.dealValue,
          stage: d.stage,
          expectedCloseDate: d.expectedCloseDate,
          owner: {
            id: d.ownerId,
            firstName: d.firstName,
            lastName: d.lastName,
          },
        })),
        recentActivity: recentActivity.map((a) => ({
          id: a.id,
          dealId: a.dealId,
          deal: {
            dealNumber: a.dealNumber,
            companyName: a.companyName,
          },
          type: a.type,
          subject: a.subject,
          notes: a.notes,
          staff: {
            id: a.staffId,
            firstName: a.firstName,
            lastName: a.lastName,
          },
          createdAt: a.createdAt,
        })),
      },
    })
  } catch (error: any) {
    console.error(error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
