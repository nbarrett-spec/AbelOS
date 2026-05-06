export const dynamic = 'force-dynamic'
export const maxDuration = 120

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { withCronRun } from '@/lib/cron'
import { logger } from '@/lib/logger'

// ─────────────────────────────────────────────────────────────────────────────
// B-FEAT-4 / A-BIZ-8 — Manufacturing 24-hour late check
//
// Manufacturing builds the day before delivery. This cron flags any Job that
// is scheduled to deliver inside the next 24 hours but is NOT yet in (or past)
// IN_PRODUCTION. v1 uses a calendar-24h window — business-day awareness can
// land later if Friday/weekend false-positives become noisy.
//
// Logic:
//   1. Find Jobs with scheduledDate ∈ (NOW, NOW + 24h]
//   2. For each, confirm it has BOM-bearing items (i.e. its Order has at
//      least one OrderItem whose product has BomEntry rows). If not, skip —
//      no manufacturing required, nothing to flag.
//   3. If status is below IN_PRODUCTION on the JobStatus ladder, write an
//      InboxItem (severity HIGH, kind MFG_LATE_24HR, entity Job).
//
// Idempotency: each Job gets at most one MFG_LATE_24HR InboxItem per UTC
// calendar date. A `sourceKey` of `mfg-late-<jobId>-<YYYY-MM-DD>` is stamped
// into actionData and checked before insert so the hourly schedule doesn't
// double-write.
//
// Note on the data model: this codebase uses `InboxItem` (not `Alert`) as the
// canonical staff-action queue. The task spec maps as:
//   severity HIGH        → priority 'HIGH'
//   kind MFG_LATE_24HR   → type 'MFG_LATE_24HR'
//   entity Job           → entityType 'Job'
//   entityId jobId       → entityId
//   details {...}        → actionData
// ─────────────────────────────────────────────────────────────────────────────

const CRON_NAME = 'mfg-24hr-check'

// JobStatus values ordered earliest → latest. Anything strictly before
// IN_PRODUCTION is "not yet in manufacturing" and qualifies for the alert.
const PRE_PRODUCTION_STATUSES = ['CREATED', 'READINESS_CHECK', 'MATERIALS_LOCKED']

interface JobRow {
  id: string
  jobNumber: string
  scheduledDate: string
  status: string
  orderId: string | null
  builderName: string
  assignedPMId: string | null
}

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 })
  }
  const provided = request.headers.get('authorization')?.replace('Bearer ', '')
  if (provided !== cronSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  return withCronRun(CRON_NAME, async () => {
    const result = await runCheck()
    return NextResponse.json(result)
  })
}

async function runCheck() {
  let checked = 0
  let flagged = 0
  const alerts: Array<{ inboxItemId: string; jobId: string; jobNumber: string }> = []
  const errors: string[] = []

  try {
    // Pull every Job whose scheduled delivery falls inside the next 24h and
    // is still in a pre-production status. Joining nothing extra keeps the
    // query cheap; per-job BOM inspection happens below.
    const jobs: JobRow[] = await prisma.$queryRawUnsafe(
      `
      SELECT
        j."id", j."jobNumber", j."scheduledDate", j."status"::text AS "status",
        j."orderId", j."builderName", j."assignedPMId"
      FROM "Job" j
      WHERE j."scheduledDate" IS NOT NULL
        AND j."scheduledDate" > NOW()
        AND j."scheduledDate" <= NOW() + INTERVAL '24 hours'
        AND j."status"::text = ANY($1::text[])
      ORDER BY j."scheduledDate" ASC
      LIMIT 500
      `,
      PRE_PRODUCTION_STATUSES
    )
    checked = jobs.length

    const today = new Date().toISOString().slice(0, 10) // YYYY-MM-DD UTC

    for (const job of jobs) {
      try {
        // BOM-check: does this Job's Order contain any line whose product
        // has at least one BomEntry? If not, treat the Job as "no manufacturing
        // required" and skip the alert.
        //
        // (B-FEAT-3 may centralize this into a `jobHasBomItems()` helper. If
        // it ships in this same wave, swap the inline query for the helper.)
        if (!(await jobHasBomBearingItems(job.orderId))) {
          continue
        }

        const sourceKey = `mfg-late-${job.id}-${today}`

        // Idempotency: skip if we already wrote a MFG_LATE_24HR InboxItem
        // for this Job on this UTC date.
        if (await sourceKeyExists(sourceKey)) {
          continue
        }

        const inboxItemId = await createInboxItem({
          type: 'MFG_LATE_24HR',
          source: CRON_NAME,
          title: `Manufacturing late: ${job.jobNumber} delivers in <24h, not yet in production`,
          description: `Job ${job.jobNumber} (${job.builderName}) is scheduled to deliver at ${new Date(job.scheduledDate).toISOString()} but its current status is ${job.status}. Manufacturing builds the day before delivery — this is now late.`,
          priority: 'HIGH',
          entityType: 'Job',
          entityId: job.id,
          assignedTo: job.assignedPMId,
          dueBy: new Date(job.scheduledDate),
          actionData: {
            sourceKey,
            severity: 'HIGH',
            kind: 'MFG_LATE_24HR',
            entity: 'Job',
            entityId: job.id,
            details: {
              jobNumber: job.jobNumber,
              scheduledDate: job.scheduledDate,
              currentStatus: job.status,
              builderName: job.builderName,
            },
          },
        })

        flagged += 1
        alerts.push({ inboxItemId, jobId: job.id, jobNumber: job.jobNumber })
      } catch (e: any) {
        errors.push(`${job.id}: ${e?.message || String(e)}`)
        logger.error('mfg_24hr_check_job_failed', e, { jobId: job.id })
      }
    }
  } catch (e: any) {
    logger.error('mfg_24hr_check_fatal', e)
    throw e
  }

  return { checked, flagged, alerts, errors }
}

// ─────────────────────────────────────────────────────────────────────────────
// BOM-bearing check (inline; promote to a shared helper once B-FEAT-3 lands).
// Returns true iff the Order has at least one OrderItem whose product has at
// least one BomEntry row (i.e. is a manufacturable parent).
// ─────────────────────────────────────────────────────────────────────────────
async function jobHasBomBearingItems(orderId: string | null): Promise<boolean> {
  if (!orderId) return false
  const rows = await prisma
    .$queryRawUnsafe<Array<{ exists: boolean }>>(
      `
      SELECT EXISTS (
        SELECT 1
        FROM "OrderItem" oi
        JOIN "BomEntry" be ON be."parentId" = oi."productId"
        WHERE oi."orderId" = $1
        LIMIT 1
      ) AS exists
      `,
      orderId
    )
    .catch(() => [] as Array<{ exists: boolean }>)
  return Boolean(rows[0]?.exists)
}

async function sourceKeyExists(sourceKey: string): Promise<boolean> {
  const rows = await prisma
    .$queryRawUnsafe<any[]>(
      `
      SELECT "id" FROM "InboxItem"
      WHERE "type" = 'MFG_LATE_24HR'
        AND "actionData"->>'sourceKey' = $1
      LIMIT 1
      `,
      sourceKey
    )
    .catch<any[]>(() => [])
  return rows.length > 0
}

async function createInboxItem(params: {
  type: string
  source: string
  title: string
  description?: string
  priority: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'
  entityType: string
  entityId: string
  assignedTo?: string | null
  dueBy?: Date
  actionData?: any
}): Promise<string> {
  const id = 'ibx' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
  await prisma.$executeRawUnsafe(
    `INSERT INTO "InboxItem"
      ("id","type","source","title","description","priority","status",
       "entityType","entityId","assignedTo","dueBy","actionData","createdAt","updatedAt")
     VALUES ($1,$2,$3,$4,$5,$6,'PENDING',$7,$8,$9,$10,$11::jsonb,NOW(),NOW())`,
    id,
    params.type,
    params.source,
    params.title,
    params.description || null,
    params.priority,
    params.entityType,
    params.entityId,
    params.assignedTo || null,
    params.dueBy || null,
    JSON.stringify(params.actionData || {})
  )
  return id
}
