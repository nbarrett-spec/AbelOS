/**
 * PM Daily Digest Cron — /api/cron/pm-daily-digest
 *
 * Fires at 12:00 UTC Mon-Sat. That's 7:00 AM Central during CDT (daylight
 * time, UTC-5), 6:00 AM Central during CST (standard time, UTC-6). We pick
 * 12:00 UTC so summer-time PMs get the digest right at 7:00. During winter
 * they'll see it at 6:00, which we've decided is close enough — PMs are
 * usually on a truck by 7:00 anyway. If Nate wants it pinned to 7:00 CT
 * year-round, switch to 13:00 UTC in November; one line in vercel.json.
 *
 * Behavior:
 *   - Feature flag FEATURE_PM_DIGEST_EMAIL must be 'true' to send. Off by
 *     default so this doesn't spam PMs on first deploy.
 *   - Per-PM idempotency via AuditLog lookup (entity='email_send',
 *     action='PM_DIGEST', details.date = today). Vercel cron retries won't
 *     double-send.
 *   - DRY_RUN=1 renders the payload + logs what would be sent, without
 *     actually calling Resend.
 *
 * Each successful send records an AuditLog row — that's the trail for
 * "did the digest go out to Chad on April 29th?" questions.
 */

export const dynamic = 'force-dynamic'
export const maxDuration = 300

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { startCronRun, finishCronRun } from '@/lib/cron'
import { logAudit } from '@/lib/audit'
import { logger } from '@/lib/logger'
import {
  renderPmDigest,
  sendPmDigest,
  type PmDigestJob,
  type PmDigestRedJob,
  type PmDigestTask,
  type PmDigestClosing,
  type PmDigestSubstitution,
  type PmDigestPayload,
} from '@/lib/email/pm-digest'

const CRON_NAME = 'pm-daily-digest'
const AUDIT_ACTION = 'PM_DIGEST'
const AUDIT_ENTITY = 'email_send'

// Active job statuses — anything not yet DELIVERED/COMPLETE/INVOICED/CLOSED/CANCELLED.
// Matches the spirit of material-confirm-checkpoint's ACTIVE_STATUSES.
const ACTIVE_STATUSES = [
  'CREATED',
  'READINESS_CHECK',
  'MATERIALS_LOCKED',
  'IN_PRODUCTION',
  'STAGED',
  'LOADED',
  'IN_TRANSIT',
  'INSTALLING',
  'PUNCH_LIST',
]

interface PmRow {
  id: string
  firstName: string
  lastName: string
  email: string
}

// Local typed shape for raw rows. $queryRawUnsafe returns `any[]`, so we
// project through these to get type safety everywhere downstream.
interface JobRow {
  jobId: string
  jobNumber: string
  builderName: string | null
  community: string | null
  jobAddress: string | null
  status: string
  scheduledDate: Date | null
  jobType: string | null
}

interface RedJobRow {
  jobId: string
  jobNumber: string
  builderName: string | null
  scheduledDate: Date | null
  redLineCount: number
  maxFinancialImpact: number | null
}

interface TaskRow {
  taskId: string
  title: string
  priority: string
  dueDate: Date | null
  daysOverdue: number
  jobNumber: string | null
}

interface ClosingRow {
  jobId: string
  jobNumber: string
  builderName: string | null
  community: string | null
  closingDate: Date
}

interface SubRow {
  requestId: string
  jobNumber: string | null
  originalSku: string | null
  substituteSku: string | null
  quantity: number
  reason: string | null
  requestedAt: Date
}

interface PerPmResult {
  pmId: string
  pmEmail: string
  pmName: string
  status: 'SENT' | 'SKIPPED_DUPLICATE' | 'SKIPPED_DRY_RUN' | 'FAILED'
  counts: {
    today: number
    tomorrow: number
    red: number
    overdue: number
    closings: number
    substitutions: number
  }
  error?: string
}

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return runDigest(request)
}

// Manual trigger — same auth shape; /admin/crons "Run Now" button uses POST.
export async function POST(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return runDigest(request)
}

async function runDigest(request: NextRequest) {
  const featureOn = process.env.FEATURE_PM_DIGEST_EMAIL === 'true'
  const dryRun =
    process.env.DRY_RUN === '1' ||
    request.nextUrl.searchParams.get('dryRun') === '1'

  const runId = await startCronRun(CRON_NAME, 'schedule')
  const started = Date.now()

  // ── Kill switch short-circuit ──
  // Still open + close a CronRun row so observability reflects "ran, did nothing".
  if (!featureOn) {
    const payload = {
      ok: true,
      skipped: true,
      reason: 'FEATURE_OFF',
      note: 'FEATURE_PM_DIGEST_EMAIL !== "true"; no emails sent',
    }
    await finishCronRun(runId, 'SUCCESS', Date.now() - started, {
      result: payload,
    })
    return NextResponse.json(payload)
  }

  try {
    // ── Window math (UTC dates aligned to server "today") ──
    // Keep everything as "naive UTC day" — we don't have a proper TZ library
    // on the server and DB columns are timestamptz. DFW PMs see "today"
    // ending at midnight CT, but for digest purposes a 6-hour boundary
    // slop is fine: we're listing the next day's jobs under "Tomorrow"
    // anyway.
    const today = new Date()
    today.setUTCHours(0, 0, 0, 0)
    const tomorrow = new Date(today)
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1)
    const dayAfterTomorrow = new Date(tomorrow)
    dayAfterTomorrow.setUTCDate(dayAfterTomorrow.getUTCDate() + 1)
    const sevenDaysOut = new Date(today)
    sevenDaysOut.setUTCDate(sevenDaysOut.getUTCDate() + 7)

    const todayIso = today.toISOString().slice(0, 10) // "YYYY-MM-DD"

    // ── Fetch active PMs ──
    // Use $queryRawUnsafe because role is an enum and roles is a CSV string —
    // matches the pattern in pm-daily-tasks/route.ts. PROJECT_MANAGER covers
    // the primary role field; the LIKE branch catches multi-role staff.
    const pms = await prisma.$queryRawUnsafe<PmRow[]>(`
      SELECT id, "firstName", "lastName", email
      FROM "Staff"
      WHERE active = true
        AND email <> ''
        AND (role::text = 'PROJECT_MANAGER' OR COALESCE(roles, '') LIKE '%PROJECT_MANAGER%')
      ORDER BY "firstName", "lastName"
    `)

    logger.info('pm_digest_start', {
      pmCount: pms.length,
      dryRun,
      today: todayIso,
    })

    const results: PerPmResult[] = []

    for (const pm of pms) {
      const pmResult: PerPmResult = {
        pmId: pm.id,
        pmEmail: pm.email,
        pmName: `${pm.firstName} ${pm.lastName}`,
        status: 'FAILED',
        counts: {
          today: 0,
          tomorrow: 0,
          red: 0,
          overdue: 0,
          closings: 0,
          substitutions: 0,
        },
      }

      try {
        // ── Idempotency check — have we already sent this PM their digest today?
        // AuditLog has details->>'date'; we stored YYYY-MM-DD at send time.
        const existing: Array<{ id: string }> = await prisma.$queryRawUnsafe(
          `SELECT id FROM "AuditLog"
            WHERE "action" = $1
              AND "entity" = $2
              AND "staffId" = $3
              AND ("details"->>'date') = $4
            LIMIT 1`,
          AUDIT_ACTION,
          AUDIT_ENTITY,
          pm.id,
          todayIso
        )

        if (existing.length > 0 && !dryRun) {
          pmResult.status = 'SKIPPED_DUPLICATE'
          results.push(pmResult)
          continue
        }

        // ── Gather per-PM data ──
        const [
          todayJobsRaw,
          tomorrowJobsRaw,
          redJobsRaw,
          overdueTasksRaw,
          closingsRaw,
          subsRaw,
        ] = await Promise.all([
          fetchJobs(pm.id, today, tomorrow),
          fetchJobs(pm.id, tomorrow, dayAfterTomorrow),
          fetchRedJobs(pm.id, today, sevenDaysOut),
          fetchOverdueTasks(pm.id, today),
          fetchClosings(pm.id, today, sevenDaysOut),
          fetchPendingSubstitutions(pm.id),
        ])

        pmResult.counts = {
          today: todayJobsRaw.length,
          tomorrow: tomorrowJobsRaw.length,
          red: redJobsRaw.length,
          overdue: overdueTasksRaw.length,
          closings: closingsRaw.length,
          substitutions: subsRaw.length,
        }

        const payload: PmDigestPayload = {
          pmFirstName: pm.firstName,
          pmLastName: pm.lastName,
          pmStaffId: pm.id,
          todayJobs: toJobs(todayJobsRaw),
          tomorrowJobs: toJobs(tomorrowJobsRaw),
          redJobsThisWeek: toRedJobs(redJobsRaw),
          overdueTasks: toTasks(overdueTasksRaw),
          closingsThisWeek: toClosings(closingsRaw),
          pendingSubstitutions: toSubs(subsRaw),
        }

        if (dryRun) {
          const rendered = renderPmDigest(payload)
          logger.info('pm_digest_dry_run', {
            pmId: pm.id,
            pmEmail: pm.email,
            subject: rendered.subject,
            counts: pmResult.counts,
          })
          pmResult.status = 'SKIPPED_DRY_RUN'
          results.push(pmResult)
          continue
        }

        const sendResult = await sendPmDigest({
          to: pm.email,
          payload,
        })

        if (!sendResult.success) {
          pmResult.status = 'FAILED'
          pmResult.error = sendResult.error || 'unknown send failure'
          logger.warn('pm_digest_send_failed', {
            pmId: pm.id,
            error: pmResult.error,
          })
          results.push(pmResult)
          continue
        }

        // Record the send in AuditLog — both for idempotency and for the
        // "when did we last email this PM" view. details.date is the key
        // the idempotency check above reads.
        await logAudit({
          staffId: pm.id,
          action: AUDIT_ACTION,
          entity: AUDIT_ENTITY,
          entityId: sendResult.id || undefined,
          details: {
            date: todayIso,
            to: pm.email,
            messageId: sendResult.id,
            counts: pmResult.counts,
            cron: CRON_NAME,
          },
          severity: 'INFO',
        })

        pmResult.status = 'SENT'
        results.push(pmResult)
      } catch (err: any) {
        pmResult.status = 'FAILED'
        pmResult.error = err?.message || String(err)
        logger.error('pm_digest_iteration_error', err, { pmId: pm.id })
        results.push(pmResult)
      }
    }

    const summary = {
      ok: true,
      dryRun,
      total: results.length,
      sent: results.filter((r) => r.status === 'SENT').length,
      skippedDuplicate: results.filter((r) => r.status === 'SKIPPED_DUPLICATE')
        .length,
      skippedDryRun: results.filter((r) => r.status === 'SKIPPED_DRY_RUN')
        .length,
      failed: results.filter((r) => r.status === 'FAILED').length,
      pms: results,
      durationMs: Date.now() - started,
    }

    await finishCronRun(runId, 'SUCCESS', Date.now() - started, {
      result: {
        total: summary.total,
        sent: summary.sent,
        skippedDuplicate: summary.skippedDuplicate,
        skippedDryRun: summary.skippedDryRun,
        failed: summary.failed,
        dryRun,
      },
    })
    return NextResponse.json(summary)
  } catch (err: any) {
    logger.error('pm_digest_fatal', err)
    await finishCronRun(runId, 'FAILURE', Date.now() - started, {
      error: err?.message || String(err),
    })
    return NextResponse.json(
      { ok: false, error: err?.message || String(err) },
      { status: 500 }
    )
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Query helpers — each one returns a narrow typed shape. Queries use
// $queryRawUnsafe because Prisma doesn't model the JSONB details field well
// and we need SQL-level filtering on enum casts. Same pattern as
// pm-daily-tasks/route.ts, so future Aegis devs have one migration target.
// ─────────────────────────────────────────────────────────────────────────────

async function fetchJobs(
  pmId: string,
  startDay: Date,
  endDay: Date
): Promise<JobRow[]> {
  const rows = await prisma.$queryRawUnsafe<JobRow[]>(
    `
    SELECT
      j.id                 AS "jobId",
      j."jobNumber"        AS "jobNumber",
      j."builderName"      AS "builderName",
      j.community          AS "community",
      j."jobAddress"       AS "jobAddress",
      j.status::text       AS "status",
      j."scheduledDate"    AS "scheduledDate",
      j."jobType"::text    AS "jobType"
    FROM "Job" j
    WHERE j."assignedPMId" = $1
      AND j."scheduledDate" >= $2
      AND j."scheduledDate" <  $3
      AND j.status::text = ANY($4::text[])
    ORDER BY j."scheduledDate" ASC, j."jobNumber" ASC
    `,
    pmId,
    startDay,
    endDay,
    ACTIVE_STATUSES
  )
  return rows
}

/**
 * Red-material jobs for this PM, over the next 7 days. We use InboxItem as
 * the signal source — the shortage-forecast + material-confirm crons
 * already emit MRP_RECOMMENDATION / SCHEDULE_CHANGE items with the job in
 * entityId when coverage goes RED. Querying that table is O(open-items)
 * instead of re-running the heavy BoM/ATP projection per PM per morning.
 *
 * Signal list (PENDING items only, filed against the Job entity):
 *   - type='MRP_RECOMMENDATION' or priority='CRITICAL'
 *   - type='SCHEDULE_CHANGE' (often means a closing moved forward, now red)
 *
 * A job might have multiple signals; we collapse by jobId and surface
 * the count + worst priority in the reason line.
 */
async function fetchRedJobs(
  pmId: string,
  startDay: Date,
  endDay: Date
): Promise<RedJobRow[]> {
  const rows = await prisma.$queryRawUnsafe<RedJobRow[]>(
    `
    SELECT
      j.id                            AS "jobId",
      j."jobNumber"                   AS "jobNumber",
      j."builderName"                 AS "builderName",
      j."scheduledDate"               AS "scheduledDate",
      COUNT(ii.id)::int               AS "redLineCount",
      MAX(COALESCE(ii."financialImpact", 0))::float AS "maxFinancialImpact"
    FROM "Job" j
    JOIN "InboxItem" ii
      ON ii."entityType" = 'Job'
     AND ii."entityId"   = j.id
    WHERE j."assignedPMId" = $1
      AND j."scheduledDate" >= $2
      AND j."scheduledDate" <  $3
      AND j.status::text = ANY($4::text[])
      AND ii.status = 'PENDING'
      AND (
            ii.type IN ('MRP_RECOMMENDATION', 'SCHEDULE_CHANGE')
         OR ii.priority = 'CRITICAL'
      )
    GROUP BY j.id, j."jobNumber", j."builderName", j."scheduledDate"
    ORDER BY j."scheduledDate" ASC
    LIMIT 20
    `,
    pmId,
    startDay,
    endDay,
    ACTIVE_STATUSES
  )
  return rows
}

async function fetchOverdueTasks(
  pmId: string,
  today: Date
): Promise<TaskRow[]> {
  const rows = await prisma.$queryRawUnsafe<TaskRow[]>(
    `
    SELECT
      t.id                                      AS "taskId",
      t.title                                   AS "title",
      t.priority::text                          AS "priority",
      t."dueDate"                               AS "dueDate",
      GREATEST(
        FLOOR(EXTRACT(EPOCH FROM ($2::timestamptz - t."dueDate")) / 86400)::int,
        0
      )                                         AS "daysOverdue",
      j."jobNumber"                             AS "jobNumber"
    FROM "Task" t
    LEFT JOIN "Job" j ON j.id = t."jobId"
    WHERE t."assigneeId" = $1
      AND t.status::text NOT IN ('DONE', 'CANCELLED')
      AND t."dueDate" IS NOT NULL
      AND t."dueDate" < $2
    ORDER BY t."dueDate" ASC
    LIMIT 20
    `,
    pmId,
    today
  )
  return rows
}

/**
 * Closings this week — sourced from HyphenDocument.closingDate for jobs
 * assigned to this PM. The Hyphen scraper populates closingDate on
 * eventType='closing_date' rows, and jobId is backfilled once the row
 * matches. We surface the nearest closing per Job (MIN()) so multiple
 * Hyphen pings for the same lot don't double-list.
 */
async function fetchClosings(
  pmId: string,
  startDay: Date,
  endDay: Date
): Promise<ClosingRow[]> {
  const rows = await prisma.$queryRawUnsafe<ClosingRow[]>(
    `
    SELECT
      j.id                           AS "jobId",
      j."jobNumber"                  AS "jobNumber",
      j."builderName"                AS "builderName",
      j.community                    AS "community",
      MIN(hd."closingDate")          AS "closingDate"
    FROM "Job" j
    JOIN "HyphenDocument" hd ON hd."jobId" = j.id
    WHERE j."assignedPMId" = $1
      AND hd."closingDate" >= $2
      AND hd."closingDate" <  $3
    GROUP BY j.id, j."jobNumber", j."builderName", j.community
    ORDER BY MIN(hd."closingDate") ASC
    LIMIT 30
    `,
    pmId,
    startDay,
    endDay
  )
  return rows
}

/**
 * Substitution requests that are PENDING and belong to a Job assigned to
 * this PM. The SubstitutionRequest table is auto-created on first use by
 * src/lib/substitution-requests.ts; if it doesn't exist yet (fresh env),
 * the catch below returns an empty array so the digest still renders.
 */
async function fetchPendingSubstitutions(pmId: string): Promise<SubRow[]> {
  try {
    const rows = await prisma.$queryRawUnsafe<SubRow[]>(
      `
      SELECT
        sr.id                        AS "requestId",
        j."jobNumber"                AS "jobNumber",
        po.sku                       AS "originalSku",
        ps.sku                       AS "substituteSku",
        sr.quantity                  AS "quantity",
        sr.reason                    AS "reason",
        sr."createdAt"               AS "requestedAt"
      FROM "SubstitutionRequest" sr
      JOIN "Job" j         ON j.id = sr."jobId"
      LEFT JOIN "Product" po ON po.id = sr."originalProductId"
      LEFT JOIN "Product" ps ON ps.id = sr."substituteProductId"
      WHERE j."assignedPMId" = $1
        AND sr.status = 'PENDING'
      ORDER BY sr."createdAt" ASC
      LIMIT 20
      `,
      pmId
    )
    return rows
  } catch (e: any) {
    // Table may not exist in this environment (nobody's used substitutions
    // yet). Treat as "no pending substitutions" — don't blow up the digest.
    logger.warn('pm_digest_subs_query_failed', {
      pmId,
      error: e?.message || String(e),
    })
    return []
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Row projections — SQL → template shape. Keeps the cron readable.
// ─────────────────────────────────────────────────────────────────────────────

function toJobs(rows: JobRow[]): PmDigestJob[] {
  return rows.map((r) => ({
    jobId: r.jobId,
    jobNumber: r.jobNumber,
    builderName: r.builderName,
    community: r.community,
    jobAddress: r.jobAddress,
    status: r.status,
    scheduledDate: r.scheduledDate,
    jobType: r.jobType,
  }))
}

function toRedJobs(rows: RedJobRow[]): PmDigestRedJob[] {
  return rows.map((r) => {
    const count = Number(r.redLineCount || 0)
    const impact = Number(r.maxFinancialImpact || 0)
    const reasonParts: string[] = []
    reasonParts.push(`${count} open signal${count === 1 ? '' : 's'}`)
    if (impact > 0) {
      const dollars = impact >= 1000 ? `$${Math.round(impact / 100) / 10}k` : `$${Math.round(impact)}`
      reasonParts.push(`~${dollars} exposure`)
    }
    return {
      jobId: r.jobId,
      jobNumber: r.jobNumber,
      builderName: r.builderName,
      scheduledDate: r.scheduledDate,
      reason: reasonParts.join(' · '),
    }
  })
}

function toTasks(rows: TaskRow[]): PmDigestTask[] {
  return rows.map((r) => ({
    taskId: r.taskId,
    title: r.title,
    priority: r.priority,
    dueDate: r.dueDate,
    daysOverdue: Number(r.daysOverdue || 0),
    jobNumber: r.jobNumber,
  }))
}

function toClosings(rows: ClosingRow[]): PmDigestClosing[] {
  return rows.map((r) => ({
    jobId: r.jobId,
    jobNumber: r.jobNumber,
    builderName: r.builderName,
    community: r.community,
    closingDate: r.closingDate,
  }))
}

function toSubs(rows: SubRow[]): PmDigestSubstitution[] {
  return rows.map((r) => ({
    requestId: r.requestId,
    jobNumber: r.jobNumber,
    originalSku: r.originalSku,
    substituteSku: r.substituteSku,
    quantity: Number(r.quantity || 0),
    reason: r.reason,
    requestedAt: r.requestedAt,
  }))
}
