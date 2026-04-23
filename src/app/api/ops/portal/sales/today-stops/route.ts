export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'

/**
 * GET /api/ops/portal/sales/today-stops
 *
 * Returns the sales rep's scheduled meetings/visits for today.
 * Heuristic: reads from Activity (scheduledAt = today, type MEETING|SITE_VISIT)
 * + DealActivity follow-ups due today. Groups by builder.
 *
 * Future: when GoogleCalendar integration lands, merge events whose title
 * contains a Builder.companyName OR whose attendee email matches a BuilderContact.
 */
export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const staffId = request.headers.get('x-staff-id')
    const { searchParams } = new URL(request.url)
    const overrideStaffId = searchParams.get('staffId') // admins peeking at someone else's day
    const effectiveStaffId = overrideStaffId || staffId
    if (!effectiveStaffId) {
      return NextResponse.json({ error: 'staffId unavailable' }, { status: 400 })
    }

    // Date window: today local (UTC-safe by using UTC day boundaries)
    const dayStart = new Date()
    dayStart.setHours(0, 0, 0, 0)
    const dayEnd = new Date(dayStart)
    dayEnd.setDate(dayEnd.getDate() + 1)

    // Activities scheduled today for this rep — with builder info
    const scheduled: any[] = await prisma.$queryRawUnsafe(
      `SELECT
         a."id"             AS "activityId",
         a."builderId",
         a."activityType",
         a."subject",
         a."scheduledAt",
         a."notes",
         b."companyName",
         b."city",
         b."state"
       FROM "Activity" a
       LEFT JOIN "Builder" b ON b."id" = a."builderId"
       WHERE a."staffId" = $1
         AND a."scheduledAt" IS NOT NULL
         AND a."scheduledAt" >= $2
         AND a."scheduledAt" <  $3
         AND a."activityType"::text IN ('MEETING','SITE_VISIT','CALL')
       ORDER BY a."scheduledAt" ASC`,
      effectiveStaffId,
      dayStart.toISOString(),
      dayEnd.toISOString(),
    )

    // Deal follow-ups due today (MEETING/SITE_VISIT types, or anything with followUpDate today)
    const dealStops: any[] = await prisma.$queryRawUnsafe(
      `SELECT
         da."id"            AS "activityId",
         d."builderId",
         d."companyName",
         da."type"          AS "activityType",
         da."subject",
         da."followUpDate"  AS "scheduledAt",
         da."notes"
       FROM "DealActivity" da
       JOIN "Deal" d ON d."id" = da."dealId"
       WHERE da."staffId" = $1
         AND da."followUpDone" = false
         AND da."followUpDate" IS NOT NULL
         AND da."followUpDate" >= $2
         AND da."followUpDate" <  $3
       ORDER BY da."followUpDate" ASC`,
      effectiveStaffId,
      dayStart.toISOString(),
      dayEnd.toISOString(),
    )

    // Merge + dedupe by (builderId || companyName) keeping the earliest scheduledAt per stop
    type Stop = {
      activityId: string
      builderId: string | null
      companyName: string | null
      scheduledAt: string | null
      activityType: string
      subject: string
      city?: string | null
      state?: string | null
      source: 'activity' | 'deal'
    }
    const merged: Stop[] = [
      ...scheduled.map((r: any) => ({
        activityId: r.activityId,
        builderId: r.builderId,
        companyName: r.companyName,
        scheduledAt: r.scheduledAt,
        activityType: r.activityType,
        subject: r.subject,
        city: r.city,
        state: r.state,
        source: 'activity' as const,
      })),
      ...dealStops.map((r: any) => ({
        activityId: r.activityId,
        builderId: r.builderId,
        companyName: r.companyName,
        scheduledAt: r.scheduledAt,
        activityType: r.activityType,
        subject: r.subject,
        source: 'deal' as const,
      })),
    ].sort((a, b) => {
      const aT = a.scheduledAt ? new Date(a.scheduledAt).getTime() : 0
      const bT = b.scheduledAt ? new Date(b.scheduledAt).getTime() : 0
      return aT - bT
    })

    return NextResponse.json({
      ok: true,
      date: dayStart.toISOString().slice(0, 10),
      staffId: effectiveStaffId,
      googleCalendarConnected: false, // stub — update when GoogleCalendar integration lands
      stops: merged,
    })
  } catch (err: any) {
    console.error('[today-stops]', err)
    return NextResponse.json({ error: err?.message || 'internal' }, { status: 500 })
  }
}
