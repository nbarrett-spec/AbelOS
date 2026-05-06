export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireStaffAuth } from '@/lib/api-auth'

// ──────────────────────────────────────────────────────────────────────────
// /api/ops/manufacturing/schedule
//
// GET — read-only forward capacity view for the manufacturing lead.
// Returns every job with a scheduledDate in the next 28 days, grouped by
// week (Mon–Sun) and then by day. Powers the M-15 schedule/capacity page.
//
// Auth: ADMIN, MANAGER, PROJECT_MANAGER (route-level prefix /api/ops/manufacturing
// already covers warehouse roles via canAccessAPI; this allowedRoles list is
// the explicit task contract — read-only forecasting view, leadership/PM only).
// ──────────────────────────────────────────────────────────────────────────

interface ScheduleJobRow {
  id: string
  jobNumber: string
  scheduledDate: Date
  status: string
  builderName: string
  community: string | null
}

interface DayBucket {
  date: string // ISO date (YYYY-MM-DD) in UTC
  jobs: {
    id: string
    jobNumber: string
    scheduledDate: string
    status: string
    builderName: string
    community: string | null
  }[]
}

interface WeekBucket {
  weekStart: string // ISO date (YYYY-MM-DD) — Monday of that week, UTC
  days: DayBucket[]
}

// Returns the YYYY-MM-DD string in UTC for a Date (date-only, no time).
function utcDateKey(d: Date): string {
  const yyyy = d.getUTCFullYear()
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(d.getUTCDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

// Returns the Monday-anchored start of the ISO week containing `d`, in UTC.
function startOfIsoWeekUtc(d: Date): Date {
  const out = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
  const day = out.getUTCDay() // 0=Sun..6=Sat
  // Shift back to Monday: Mon=1 -> 0 days back, Sun=0 -> 6 days back
  const diff = day === 0 ? 6 : day - 1
  out.setUTCDate(out.getUTCDate() - diff)
  return out
}

function addUtcDays(d: Date, n: number): Date {
  const out = new Date(d)
  out.setUTCDate(out.getUTCDate() + n)
  return out
}

export async function GET(request: NextRequest) {
  const auth = await requireStaffAuth(request, {
    allowedRoles: ['ADMIN', 'MANAGER', 'PROJECT_MANAGER'],
  })
  if (auth.error) return auth.error

  try {
    let rows: ScheduleJobRow[] = []
    try {
      rows = await prisma.$queryRawUnsafe<ScheduleJobRow[]>(
        `SELECT j.id, j."jobNumber", j."scheduledDate", j.status::text AS status,
                j."builderName", j.community
         FROM "Job" j
         WHERE j."scheduledDate" IS NOT NULL
           AND j."scheduledDate" >= NOW()
           AND j."scheduledDate" < NOW() + INTERVAL '28 days'
           AND EXISTS (
             SELECT 1
               FROM "OrderItem" oi
               JOIN "BomEntry" be ON be."parentId" = oi."productId"
              WHERE oi."orderId" = j."orderId"
           )
         ORDER BY j."scheduledDate" ASC`,
      )
    } catch (e: any) {
      // If the Job table or scheduledDate column is missing in this environment,
      // return an empty 4-week grid so the page still renders cleanly.
      if (/relation .* does not exist|column .* does not exist/i.test(String(e?.message))) {
        rows = []
      } else {
        throw e
      }
    }

    // Build a 4-week skeleton anchored on the Monday of the current ISO week.
    const now = new Date()
    const week0 = startOfIsoWeekUtc(now)

    const weeks: WeekBucket[] = []
    for (let w = 0; w < 4; w++) {
      const weekStart = addUtcDays(week0, w * 7)
      const days: DayBucket[] = []
      for (let d = 0; d < 7; d++) {
        const day = addUtcDays(weekStart, d)
        days.push({ date: utcDateKey(day), jobs: [] })
      }
      weeks.push({ weekStart: utcDateKey(weekStart), days })
    }

    // Index each day bucket by its ISO date for O(1) job placement.
    const dayIndex = new Map<string, DayBucket>()
    for (const week of weeks) {
      for (const day of week.days) {
        dayIndex.set(day.date, day)
      }
    }

    // Drop each job into its matching day bucket. Jobs whose scheduledDate
    // falls outside the 28-day window (edge case from clock skew or filter
    // mismatch) are silently dropped; the SQL filter is the source of truth.
    for (const row of rows) {
      const key = utcDateKey(new Date(row.scheduledDate))
      const bucket = dayIndex.get(key)
      if (!bucket) continue
      bucket.jobs.push({
        id: row.id,
        jobNumber: row.jobNumber,
        scheduledDate: new Date(row.scheduledDate).toISOString(),
        status: row.status,
        builderName: row.builderName,
        community: row.community,
      })
    }

    return NextResponse.json({
      weeks,
      totalJobs: rows.length,
      windowStart: utcDateKey(week0),
      windowEnd: utcDateKey(addUtcDays(week0, 28)),
    })
  } catch (error) {
    console.error('Manufacturing schedule error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch schedule' },
      { status: 500 },
    )
  }
}
