export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'

// ──────────────────────────────────────────────────────────────────────────
// GET /api/ops/portal/installer/briefing
// Start-of-day briefing payload:
//   - Today's install count
//   - Community grouping summary
//   - First stop (earliest scheduled address today)
//   - Yesterday's jobs that ran long (actualDate != null AND completedAt == null)
//   - Outstanding punch items across all jobs
// ──────────────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  const now = new Date()
  const today = new Date(now)
  today.setHours(0, 0, 0, 0)
  const tomorrow = new Date(today)
  tomorrow.setDate(tomorrow.getDate() + 1)
  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)

  try {
    const todayJobs: any[] = await prisma.$queryRawUnsafe(
      `SELECT "id", "jobNumber", "builderName", "community", "lotBlock",
              "jobAddress", "scheduledDate",
              "status"::text AS "status"
       FROM "Job"
       WHERE "status" IN ('STAGED','LOADED','DELIVERED','INSTALLING')
         AND (
           ("scheduledDate" >= $1::timestamptz AND "scheduledDate" < $2::timestamptz)
           OR "status" = 'INSTALLING'
         )
       ORDER BY "scheduledDate" ASC NULLS LAST
       LIMIT 50`,
      today.toISOString(),
      tomorrow.toISOString(),
    ).catch(() => [] as any[]) as any[]

    const ranLongYesterday: any[] = await prisma.$queryRawUnsafe(
      `SELECT "id", "jobNumber", "builderName", "community"
       FROM "Job"
       WHERE "actualDate" IS NOT NULL
         AND "actualDate" >= $1::timestamptz
         AND "actualDate" < $2::timestamptz
         AND "completedAt" IS NULL
       LIMIT 20`,
      yesterday.toISOString(),
      today.toISOString(),
    ).catch(() => [] as any[]) as any[]

    const openPunchRows: any[] = await prisma.$queryRawUnsafe(
      `SELECT COUNT(*)::int AS c
       FROM "Task"
       WHERE "category" = 'PUNCH_LIST'
         AND "status" NOT IN ('DONE','CANCELLED')`,
    ).catch(() => [{ c: 0 }] as any[]) as any[]
    const openPunchCount = openPunchRows[0]?.c ?? 0

    // Group by community
    const byCommunity: Record<string, number> = {}
    for (const j of todayJobs) {
      const key = j.community || 'Unassigned'
      byCommunity[key] = (byCommunity[key] ?? 0) + 1
    }
    const communities = Object.entries(byCommunity).map(([name, count]) => ({ name, count }))

    // First stop = earliest scheduled address today
    const firstStop = todayJobs.find((j) => j.scheduledDate) || todayJobs[0] || null

    return NextResponse.json({
      date: today.toISOString().split('T')[0],
      installCount: todayJobs.length,
      communities,
      firstStop: firstStop ? {
        jobNumber: firstStop.jobNumber,
        builderName: firstStop.builderName,
        community: firstStop.community,
        lotBlock: firstStop.lotBlock,
        jobAddress: firstStop.jobAddress,
        scheduledDate: firstStop.scheduledDate,
      } : null,
      ranLongYesterday,
      openPunchCount,
    })
  } catch (error: any) {
    console.error('[installer/briefing] error:', error?.message)
    return NextResponse.json({ error: 'Failed to load briefing' }, { status: 500 })
  }
}
