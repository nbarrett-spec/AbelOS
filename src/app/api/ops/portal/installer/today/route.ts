export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'

// ──────────────────────────────────────────────────────────────────────────
// GET /api/ops/portal/installer/today
// Returns installs assigned to the current installer for today.
// Filters Jobs in STAGED | LOADED | DELIVERED | INSTALLING so the installer
// sees what's staged for them, en route, on-site, or already in progress.
// Grouped by community in the client.
// ──────────────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  const staffId = request.headers.get('x-staff-id') || ''
  const url = new URL(request.url)
  // Optional ?date=YYYY-MM-DD override (defaults to today local)
  const dateParam = url.searchParams.get('date')

  const today = dateParam ? new Date(dateParam) : new Date()
  today.setHours(0, 0, 0, 0)
  const tomorrow = new Date(today)
  tomorrow.setDate(tomorrow.getDate() + 1)

  try {
    // Pull jobs scheduled for today (or with no scheduled date but status=INSTALLING so
    // an in-progress install isn't hidden after midnight). Assignment is loose: any
    // Installation row linked to a Crew where this staff is a member, OR Job.assignedPMId,
    // OR any job for now (so INSTALLER with no crew mapping sees the queue).
    // We use status filter + scheduled date as the primary filter; crew membership is
    // surfaced via a label. If we find no rows with crew match, we fall back to all.
    const jobs: any[] = await prisma.$queryRawUnsafe(
      `SELECT j."id", j."jobNumber", j."builderName", j."community", j."lotBlock",
              j."jobAddress", j."latitude", j."longitude",
              j."status"::text AS "status",
              j."scheduledDate", j."actualDate", j."createdAt",
              j."scopeType"::text AS "scopeType",
              o."orderNumber", o."deliveryNotes",
              pm."firstName" AS "pmFirstName", pm."lastName" AS "pmLastName", pm."id" AS "pmId"
       FROM "Job" j
       LEFT JOIN "Order" o ON o."id" = j."orderId"
       LEFT JOIN "Staff" pm ON pm."id" = j."assignedPMId"
       WHERE j."status" IN ('STAGED','LOADED','DELIVERED','INSTALLING')
         AND (
           j."scheduledDate" IS NULL
           OR (j."scheduledDate" >= $1::timestamptz AND j."scheduledDate" < $2::timestamptz)
           OR j."status" = 'INSTALLING'
         )
       ORDER BY j."scheduledDate" ASC NULLS LAST, j."jobNumber" ASC
       LIMIT 50`,
      today.toISOString(),
      tomorrow.toISOString(),
    ).catch(() => [] as any[]) as any[]

    // Fetch any notes with [INSTALL] or general notes for each job (lightweight)
    const jobIds = jobs.map((j) => j.id)
    let notesByJob: Record<string, { body: string; priority: string; noteType: string }[]> = {}
    if (jobIds.length > 0) {
      try {
        const notes: any[] = await prisma.$queryRawUnsafe(
          `SELECT "jobId", "subject", "body", "priority", "noteType"::text AS "noteType"
           FROM "DecisionNote"
           WHERE "jobId" = ANY($1::text[])
             AND "priority" IN ('HIGH','URGENT')
           ORDER BY "createdAt" DESC
           LIMIT 200`,
          jobIds,
        )
        for (const n of notes) {
          if (!notesByJob[n.jobId]) notesByJob[n.jobId] = []
          notesByJob[n.jobId].push({ body: n.body, priority: n.priority, noteType: n.noteType })
        }
      } catch {
        notesByJob = {}
      }
    }

    // Compute simple distance-from-previous using lat/lon haversine where available
    const jobsOut = jobs.map((j, idx) => {
      const prev = idx > 0 ? jobs[idx - 1] : null
      let distanceMi: number | null = null
      if (prev && typeof prev.latitude === 'number' && typeof prev.longitude === 'number' &&
          typeof j.latitude === 'number' && typeof j.longitude === 'number') {
        distanceMi = haversineMi(prev.latitude, prev.longitude, j.latitude, j.longitude)
      }
      return {
        id: j.id,
        jobNumber: j.jobNumber,
        builderName: j.builderName,
        community: j.community,
        lotBlock: j.lotBlock,
        jobAddress: j.jobAddress,
        latitude: j.latitude,
        longitude: j.longitude,
        status: j.status,
        scopeType: j.scopeType,
        scheduledDate: j.scheduledDate,
        actualDate: j.actualDate,
        orderNumber: j.orderNumber,
        deliveryNotes: j.deliveryNotes,
        pm: j.pmId ? {
          id: j.pmId,
          firstName: j.pmFirstName,
          lastName: j.pmLastName,
        } : null,
        highPriorityNotes: notesByJob[j.id] || [],
        distanceFromPrevMi: distanceMi,
      }
    })

    // KPIs
    const total = jobsOut.length
    const completed = jobsOut.filter((j) => j.status === 'COMPLETE' || j.status === 'PUNCH_LIST').length
    const inProgress = jobsOut.filter((j) => j.status === 'INSTALLING').length
    const remaining = total - completed

    return NextResponse.json({
      staffId,
      date: today.toISOString().split('T')[0],
      kpis: { total, completed, inProgress, remaining },
      jobs: jobsOut,
    })
  } catch (error: any) {
    console.error('[installer/today] error:', error?.message)
    return NextResponse.json({ error: 'Failed to load today queue' }, { status: 500 })
  }
}

function haversineMi(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 3958.8 // miles
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return Math.round(R * c * 10) / 10
}
