export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'
import { audit } from '@/lib/audit'

// GET /api/ops/schedule/milestones — Get milestones (optionally filtered by jobId)
export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const sp = request.nextUrl.searchParams
    const jobId = sp.get('jobId')
    const status = sp.get('status')
    const from = sp.get('from')
    const to = sp.get('to')

    const conditions: string[] = []
    const params: any[] = []
    let paramIdx = 1

    if (jobId) { conditions.push(`m."jobId" = $${paramIdx++}`); params.push(jobId) }
    if (status) { conditions.push(`m."status" = $${paramIdx++}`); params.push(status) }
    if (from) { conditions.push(`m."plannedDate" >= $${paramIdx++}::timestamptz`); params.push(from) }
    if (to) { conditions.push(`m."plannedDate" <= $${paramIdx++}::timestamptz`); params.push(to) }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

    const milestones: any[] = await prisma.$queryRawUnsafe(
      `SELECT m.*,
              j."jobNumber", j."builderName", j."jobAddress", j."status" as "jobStatus"
       FROM "ScheduleMilestone" m
       LEFT JOIN "Job" j ON j.id = m."jobId"
       ${where}
       ORDER BY m."plannedDate" ASC NULLS LAST, m."sortOrder" ASC`,
      ...params
    )

    return NextResponse.json({ milestones })
  } catch (error: any) {
    console.error('[Milestones GET]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

// POST /api/ops/schedule/milestones — Create milestone(s) for a job
export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    // Audit log
    audit(request, 'CREATE', 'Schedule', undefined, { method: 'POST' }).catch(() => {})

    const body = await request.json()

    // Support both single milestone and bulk creation
    const milestones = Array.isArray(body) ? body : [body]
    const created: any[] = []

    for (const ms of milestones) {
      const { jobId, name, code, plannedDate, durationDays, dependsOn, sortOrder, notes } = ms
      if (!jobId || !name || !code) continue

      const result: any[] = await prisma.$queryRawUnsafe(
        `INSERT INTO "ScheduleMilestone" ("id", "jobId", "name", "code", "plannedDate", "durationDays", "dependsOn", "sortOrder", "notes")
         VALUES (gen_random_uuid()::text, $1, $2, $3, $4::timestamptz, $5, $6::text[], $7, $8)
         RETURNING *`,
        jobId, name, code, plannedDate ? new Date(plannedDate) : null,
        durationDays || 1, dependsOn || [], sortOrder || 0, notes || null
      )
      if (result[0]) created.push(result[0])
    }

    return NextResponse.json({ milestones: created, count: created.length }, { status: 201 })
  } catch (error: any) {
    console.error('[Milestones POST]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
