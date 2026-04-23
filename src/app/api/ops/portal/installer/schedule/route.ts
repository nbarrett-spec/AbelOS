export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'

// ──────────────────────────────────────────────────────────────────────────
// GET /api/ops/portal/installer/schedule
// 7-day forward schedule for installer-relevant jobs. Grouped by date.
// ──────────────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const end = new Date(today)
  end.setDate(end.getDate() + 7)

  try {
    const jobs: any[] = await prisma.$queryRawUnsafe(
      `SELECT j."id", j."jobNumber", j."builderName", j."community", j."lotBlock",
              j."jobAddress", j."scheduledDate",
              j."status"::text AS "status",
              j."scopeType"::text AS "scopeType"
       FROM "Job" j
       WHERE j."status" IN ('STAGED','LOADED','DELIVERED','INSTALLING','PUNCH_LIST')
         AND j."scheduledDate" IS NOT NULL
         AND j."scheduledDate" >= $1::timestamptz
         AND j."scheduledDate" < $2::timestamptz
       ORDER BY j."scheduledDate" ASC, j."jobNumber" ASC
       LIMIT 200`,
      today.toISOString(),
      end.toISOString(),
    ).catch(() => [] as any[]) as any[]

    // Group by YYYY-MM-DD
    const byDate: Record<string, any[]> = {}
    for (const j of jobs) {
      const d = j.scheduledDate ? new Date(j.scheduledDate).toISOString().split('T')[0] : 'unscheduled'
      if (!byDate[d]) byDate[d] = []
      byDate[d].push({
        id: j.id,
        jobNumber: j.jobNumber,
        builderName: j.builderName,
        community: j.community,
        lotBlock: j.lotBlock,
        jobAddress: j.jobAddress,
        scheduledDate: j.scheduledDate,
        status: j.status,
        scopeType: j.scopeType,
      })
    }

    const days = Object.keys(byDate)
      .sort()
      .map((d) => ({ date: d, jobs: byDate[d] }))

    return NextResponse.json({ startDate: today.toISOString().split('T')[0], days })
  } catch (error: any) {
    console.error('[installer/schedule] error:', error?.message)
    return NextResponse.json({ error: 'Failed to load schedule' }, { status: 500 })
  }
}
