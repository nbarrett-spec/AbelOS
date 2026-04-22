export const dynamic = 'force-dynamic'
import { prisma } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'
import { safeJson } from '@/lib/safe-json'

// ──────────────────────────────────────────────────────────────────
// CREW SCHEDULING CONFLICT DETECTION
// ──────────────────────────────────────────────────────────────────
// GET ?date=YYYY-MM-DD  — check conflicts for a specific date
// GET ?days=7           — check conflicts for the next N days
// GET ?crewId=xxx       — check a specific crew's schedule
// ──────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  const date = request.nextUrl.searchParams.get('date')
  const days = parseInt(request.nextUrl.searchParams.get('days') || '7')
  const crewId = request.nextUrl.searchParams.get('crewId')

  try {
    const startDate = date ? new Date(date) : new Date()
    const endDate = new Date(startDate.getTime() + days * 86400000)

    // Find all schedule entries where crews are double-booked on the same date
    let conflictQuery = `
      SELECT
        se1."id" AS "entry1Id",
        se1."scheduledDate" AS "conflictDate",
        se1."scheduledTime" AS "time1",
        se1."entryType"::text AS "type1",
        j1."jobNumber" AS "job1",
        j1."builderName" AS "builder1",
        j1."jobAddress" AS "address1",
        se2."id" AS "entry2Id",
        se2."scheduledTime" AS "time2",
        se2."entryType"::text AS "type2",
        j2."jobNumber" AS "job2",
        j2."builderName" AS "builder2",
        j2."jobAddress" AS "address2",
        c."id" AS "crewId",
        c."name" AS "crewName",
        c."crewType"::text AS "crewType"
      FROM "ScheduleEntry" se1
      JOIN "ScheduleEntry" se2 ON se1."crewId" = se2."crewId"
        AND se1."scheduledDate" = se2."scheduledDate"
        AND se1."id" < se2."id"
      JOIN "Crew" c ON se1."crewId" = c."id"
      JOIN "Job" j1 ON se1."jobId" = j1."id"
      JOIN "Job" j2 ON se2."jobId" = j2."id"
      WHERE se1."status"::text NOT IN ('CANCELLED', 'COMPLETED')
        AND se2."status"::text NOT IN ('CANCELLED', 'COMPLETED')
        AND se1."scheduledDate" >= $1::date
        AND se1."scheduledDate" <= $2::date
    `
    const params: any[] = [startDate.toISOString(), endDate.toISOString()]
    let idx = 3

    if (crewId) {
      conflictQuery += ` AND c."id" = $${idx}`
      params.push(crewId)
      idx++
    }

    conflictQuery += ` ORDER BY se1."scheduledDate" ASC, c."name" ASC`

    const conflicts: any[] = await prisma.$queryRawUnsafe(conflictQuery, ...params)

    // ── Crew utilization for the period ──
    const utilization: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        c."id" AS "crewId",
        c."name" AS "crewName",
        c."crewType"::text AS "crewType",
        COUNT(DISTINCT se."scheduledDate")::int AS "daysScheduled",
        COUNT(se."id")::int AS "totalEntries",
        COUNT(CASE WHEN se."scheduledDate" = CURRENT_DATE THEN 1 END)::int AS "todayEntries"
      FROM "Crew" c
      LEFT JOIN "ScheduleEntry" se ON se."crewId" = c."id"
        AND se."scheduledDate" >= $1::date
        AND se."scheduledDate" <= $2::date
        AND se."status"::text NOT IN ('CANCELLED')
      WHERE c."active" = true
      GROUP BY c."id", c."name", c."crewType"
      ORDER BY "totalEntries" DESC
    `, startDate.toISOString(), endDate.toISOString())

    return safeJson({
      conflicts,
      conflictCount: conflicts.length,
      utilization,
      period: { start: startDate.toISOString(), end: endDate.toISOString(), days },
    })
  } catch (error: any) {
    console.error('[Crew Conflicts]', error)
    return NextResponse.json({ error: 'Internal server error'}, { status: 500 })
  }
}
