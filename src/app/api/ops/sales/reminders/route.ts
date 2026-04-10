export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'

export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const now = new Date()
    const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000)
    const sevenDaysFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)

    // 1. STALE DEALS: No DealActivity in last 14 days, not WON or LOST
    const staleDeals: any[] = await prisma.$queryRawUnsafe(
      `
      SELECT
        d."id",
        d."dealNumber",
        d."companyName",
        d."stage",
        d."ownerId",
        s."firstName",
        s."lastName",
        CAST(COALESCE(FLOOR(EXTRACT(EPOCH FROM NOW() - MAX(da."createdAt")) / 86400), 999) AS INT) as "daysSinceActivity"
      FROM "Deal" d
      LEFT JOIN "DealActivity" da ON d."id" = da."dealId"
      LEFT JOIN "Staff" s ON d."ownerId" = s."id"
      WHERE d."stage"::text NOT IN ('WON', 'LOST')
      GROUP BY d."id", d."dealNumber", d."companyName", d."stage", d."ownerId", s."firstName", s."lastName"
      HAVING MAX(da."createdAt") < $1 OR MAX(da."createdAt") IS NULL
      ORDER BY MAX(da."createdAt") ASC NULLS FIRST
      `,
      fourteenDaysAgo
    )

    // Map owner names
    const staleDealsMapped = staleDeals.map((deal) => ({
      id: deal.id,
      dealNumber: deal.dealNumber,
      companyName: deal.companyName,
      stage: deal.stage,
      daysSinceActivity: deal.daysSinceActivity || 999,
      ownerId: deal.ownerId,
      ownerName: deal.firstName && deal.lastName ? `${deal.firstName} ${deal.lastName}` : 'Unassigned',
    }))

    // 2. OVERDUE FOLLOW-UPS: followUpDate < NOW and followUpDone = false
    const overdueFollowUps: any[] = await prisma.$queryRawUnsafe(
      `
      SELECT
        da."id" as "activityId",
        da."dealId",
        d."companyName",
        da."subject",
        da."followUpDate",
        d."ownerId",
        s."firstName",
        s."lastName"
      FROM "DealActivity" da
      JOIN "Deal" d ON da."dealId" = d."id"
      LEFT JOIN "Staff" s ON d."ownerId" = s."id"
      WHERE da."followUpDate" < NOW()
        AND da."followUpDone" = false
      ORDER BY da."followUpDate" ASC
      `
    )

    // Map owner names
    const overdueFollowUpsMapped = overdueFollowUps.map((activity) => ({
      activityId: activity.activityId,
      dealId: activity.dealId,
      companyName: activity.companyName,
      subject: activity.subject,
      followUpDate: activity.followUpDate ? new Date(activity.followUpDate).toISOString() : null,
      ownerId: activity.ownerId,
      ownerName: activity.firstName && activity.lastName ? `${activity.firstName} ${activity.lastName}` : 'Unassigned',
    }))

    // 3. DEALS CLOSING SOON: expectedCloseDate within next 7 days, not WON or LOST
    const closingSoon: any[] = await prisma.$queryRawUnsafe(
      `
      SELECT
        d."id",
        d."dealNumber",
        d."companyName",
        d."dealValue",
        d."expectedCloseDate",
        d."stage",
        d."ownerId",
        s."firstName",
        s."lastName"
      FROM "Deal" d
      LEFT JOIN "Staff" s ON d."ownerId" = s."id"
      WHERE d."expectedCloseDate" IS NOT NULL
        AND d."expectedCloseDate" >= NOW()
        AND d."expectedCloseDate" <= $1
        AND d."stage"::text NOT IN ('WON', 'LOST')
      ORDER BY d."expectedCloseDate" ASC
      `,
      sevenDaysFromNow
    )

    // Map owner names
    const closingSoonMapped = closingSoon.map((deal) => ({
      id: deal.id,
      dealNumber: deal.dealNumber,
      companyName: deal.companyName,
      dealValue: deal.dealValue || 0,
      expectedCloseDate: deal.expectedCloseDate ? new Date(deal.expectedCloseDate).toISOString() : null,
      stage: deal.stage,
      ownerId: deal.ownerId,
      ownerName: deal.firstName && deal.lastName ? `${deal.firstName} ${deal.lastName}` : 'Unassigned',
    }))

    return NextResponse.json(
      {
        staleDeals: staleDealsMapped,
        overdueFollowUps: overdueFollowUpsMapped,
        closingSoon: closingSoonMapped,
        summary: {
          staleDealsCount: staleDealsMapped.length,
          overdueFollowUpsCount: overdueFollowUpsMapped.length,
          closingSoonCount: closingSoonMapped.length,
        },
      },
      { status: 200 }
    )
  } catch (error: any) {
    console.error('Error fetching reminders:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
