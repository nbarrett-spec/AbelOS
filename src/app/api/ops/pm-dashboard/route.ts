export const dynamic = 'force-dynamic'
import { prisma } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'
import { safeJson } from '@/lib/safe-json'

export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  const staffId = request.headers.get('x-staff-id') || ''

  try {
    // ── My Active Jobs ──────────────────────────────────────────────
    const myJobs: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        j."id",
        j."jobNumber",
        j."status"::text as status,
        j."scopeType"::text as "scopeType",
        j."community",
        j."jobAddress" as address,
        j."createdAt",
        j."updatedAt",
        j."builderName",
        EXTRACT(DAY FROM NOW() - j."createdAt")::int as "daysOpen"
      FROM "Job" j
      WHERE j."assignedPMId" = $1
        AND j."status"::text NOT IN ('CLOSED', 'CANCELLED')
      ORDER BY j."updatedAt" DESC
    `, staffId)

    // ── At-Risk Jobs (stalled > 7 days, or in early stages > 14 days) ──
    const atRiskJobs = myJobs.filter(j => {
      const daysSinceUpdate = Math.floor(
        (Date.now() - new Date(j.updatedAt).getTime()) / (1000 * 60 * 60 * 24)
      )
      const earlyStages = ['CREATED', 'READINESS_CHECK', 'MATERIALS_LOCKED']
      if (earlyStages.includes(j.status) && j.daysOpen > 14) return true
      if (daysSinceUpdate > 7) return true
      return false
    }).map(j => ({
      ...j,
      riskReason: Math.floor((Date.now() - new Date(j.updatedAt).getTime()) / (1000 * 60 * 60 * 24)) > 7
        ? 'No activity in 7+ days'
        : `In ${j.status} for ${j.daysOpen}+ days`,
    }))

    // ── Jobs by Status (my jobs only) ──
    const statusCounts: Record<string, number> = {}
    myJobs.forEach(j => {
      statusCounts[j.status] = (statusCounts[j.status] || 0) + 1
    })

    // ── Completed jobs in last 30 days ──
    const completedRecent: any[] = await prisma.$queryRawUnsafe(`
      SELECT COUNT(*)::int as count
      FROM "Job"
      WHERE "assignedPMId" = $1
        AND "status"::text IN ('INVOICED', 'CLOSED')
        AND "updatedAt" > NOW() - INTERVAL '30 days'
    `, staffId)

    // ── On-Time Delivery Rate (deliveries completed on schedule) ──
    const deliveryStats: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        COUNT(*)::int as total,
        COUNT(CASE WHEN se."status"::text = 'COMPLETED' THEN 1 END)::int as completed,
        COUNT(CASE WHEN se."status"::text = 'RESCHEDULED' THEN 1 END)::int as rescheduled
      FROM "ScheduleEntry" se
      JOIN "Job" j ON se."jobId" = j."id"
      WHERE j."assignedPMId" = $1
        AND se."entryType"::text = 'DELIVERY'
        AND se."scheduledDate" > NOW() - INTERVAL '90 days'
    `, staffId)

    const ds = deliveryStats[0] || { total: 0, completed: 0, rescheduled: 0 }
    const onTimeRate = ds.total > 0 ? Math.round((ds.completed / ds.total) * 100) : 100

    // ── Upcoming deliveries this week ──
    const upcomingDeliveries: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        se."id",
        se."scheduledDate",
        se."entryType"::text as type,
        se."status"::text as status,
        j."jobNumber",
        j."jobAddress" as address,
        j."builderName",
        c."name" as "crewName"
      FROM "ScheduleEntry" se
      JOIN "Job" j ON se."jobId" = j."id"
      LEFT JOIN "Crew" c ON se."crewId" = c."id"
      WHERE j."assignedPMId" = $1
        AND se."scheduledDate" BETWEEN NOW() AND NOW() + INTERVAL '7 days'
        AND se."status"::text NOT IN ('CANCELLED')
      ORDER BY se."scheduledDate" ASC
      LIMIT 20
    `, staffId)

    // ── Crew utilization (crews on my jobs) ──
    const crewUtil: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        c."id",
        c."name",
        c."crewType"::text as type,
        COUNT(DISTINCT se."id")::int as "scheduledEntries",
        COUNT(DISTINCT CASE WHEN se."status"::text = 'COMPLETED' THEN se."id" END)::int as "completedEntries"
      FROM "Crew" c
      JOIN "ScheduleEntry" se ON se."crewId" = c."id"
      JOIN "Job" j ON se."jobId" = j."id"
      WHERE j."assignedPMId" = $1
        AND se."scheduledDate" > NOW() - INTERVAL '30 days'
        AND c."active" = true
      GROUP BY c."id", c."name", c."crewType"
      ORDER BY "scheduledEntries" DESC
      LIMIT 10
    `, staffId)

    // ── Average days to complete a job ──
    const avgCycle: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        ROUND(AVG(EXTRACT(DAY FROM "updatedAt" - "createdAt")))::int as "avgDays"
      FROM "Job"
      WHERE "assignedPMId" = $1
        AND "status"::text IN ('INVOICED', 'CLOSED')
        AND "updatedAt" > NOW() - INTERVAL '180 days'
    `, staffId)

    return safeJson({
      kpis: {
        activeJobs: myJobs.length,
        completedLast30: completedRecent[0]?.count || 0,
        atRiskCount: atRiskJobs.length,
        onTimeDeliveryRate: onTimeRate,
        avgCycleDays: avgCycle[0]?.avgDays || 0,
        deliveriesThisWeek: upcomingDeliveries.length,
      },
      jobsByStatus: statusCounts,
      atRiskJobs: atRiskJobs.slice(0, 10),
      upcomingDeliveries,
      crewUtilization: crewUtil,
    })
  } catch (error: any) {
    console.error('[PM Dashboard API] Error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch PM dashboard data'},
      { status: 500 }
    )
  }
}
