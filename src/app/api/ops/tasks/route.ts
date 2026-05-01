/**
 * /api/ops/tasks — Staff task management API
 *
 * GET  — List the calling staff member's tasks (sorted overdue → due-today
 *        → upcoming → no-date) plus aggregate counts for the FAB badge.
 * POST — Create a standalone task (not attached to a job).
 *
 * Spec: STAFF-TASK-SYSTEM-SPEC.md §1, §2.
 *
 * Auth: `checkStaffAuth(request)` validates the session, then we read
 * `x-staff-id` from the headers (same pattern as
 * /api/ops/jobs/[id]/tasks).
 *
 * The `complete` (POST) and `update` (PATCH) routes for individual tasks
 * live in /api/ops/tasks/[id]/* and are NOT modified here.
 */

export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'
import { audit } from '@/lib/audit'

const VALID_STATUSES = ['TODO', 'IN_PROGRESS', 'BLOCKED', 'DONE', 'CANCELLED'] as const
type TaskStatusStr = (typeof VALID_STATUSES)[number]

const DEFAULT_STATUSES: TaskStatusStr[] = ['TODO', 'IN_PROGRESS', 'BLOCKED']

// ── Reuse the normalize helpers from the existing job-tasks route ────────
function normalizeStatus(input: unknown): string {
  if (typeof input !== 'string') return 'TODO'
  const v = input.trim().toUpperCase()
  switch (v) {
    case 'TODO':
    case 'IN_PROGRESS':
    case 'BLOCKED':
    case 'DONE':
    case 'CANCELLED':
      return v
    case 'OPEN':
    case 'NEW':
    case 'PENDING':
      return 'TODO'
    case 'COMPLETE':
    case 'COMPLETED':
      return 'DONE'
    case 'CANCELED':
      return 'CANCELLED'
    default:
      return 'TODO'
  }
}

function normalizePriority(input: unknown): string {
  if (typeof input !== 'string') return 'MEDIUM'
  const v = input.trim().toUpperCase()
  if (v === 'LOW' || v === 'MEDIUM' || v === 'HIGH' || v === 'CRITICAL') {
    return v
  }
  return 'MEDIUM'
}

function normalizeCategory(input: unknown): string {
  const valid = new Set([
    'GENERAL',
    'READINESS_CHECK',
    'MATERIAL_VERIFICATION',
    'BUILDER_COMMUNICATION',
    'CREW_DISPATCH',
    'QUALITY_REVIEW',
    'INVOICE_FOLLOW_UP',
    'SCHEDULING',
    'EXCEPTION_RESOLUTION',
  ])
  if (typeof input !== 'string') return 'GENERAL'
  const v = input.trim().toUpperCase()
  return valid.has(v) ? v : 'GENERAL'
}

function parseStatuses(raw: string | null): TaskStatusStr[] {
  if (!raw) return DEFAULT_STATUSES
  const parts = raw
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter((s): s is TaskStatusStr =>
      (VALID_STATUSES as readonly string[]).includes(s),
    )
  return parts.length > 0 ? parts : DEFAULT_STATUSES
}

// ──────────────────────────────────────────────────────────────────────
// GET /api/ops/tasks
// ──────────────────────────────────────────────────────────────────────
export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  const staffId = request.headers.get('x-staff-id')
  if (!staffId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { searchParams } = new URL(request.url)
    const statuses = parseStatuses(searchParams.get('status'))
    const category = searchParams.get('category')
    const limit = Math.min(
      200,
      Math.max(1, parseInt(searchParams.get('limit') || '50', 10)),
    )
    const includeDone = searchParams.get('include_done') === 'true'

    // Build dynamic WHERE clause; we either include DONE-from-last-24h via
    // OR-branch, or filter strictly to the requested statuses.
    const params: any[] = [staffId, statuses]
    let whereClause = `t."assigneeId" = $1 AND t."status"::text = ANY($2::text[])`
    let paramIdx = 3

    if (category) {
      whereClause += ` AND t."category"::text = $${paramIdx}`
      params.push(normalizeCategory(category))
      paramIdx++
    }

    // Fetch the active task list + (optionally) recent completions in a
    // single query: a UNION of "active by status filter" and "DONE in last
    // 24h" when include_done=true.
    const includeDoneClause = includeDone
      ? ` UNION ALL
         SELECT t."id", t."title", t."description",
                t."priority"::text AS "priority",
                t."status"::text AS "status",
                t."category"::text AS "category",
                t."dueDate", t."completedAt",
                t."assigneeId", t."creatorId",
                t."jobId", t."builderId", t."communityId",
                t."sourceKey",
                t."createdAt", t."updatedAt",
                j."jobNumber", j."jobAddress" AS "address",
                b."companyName" AS "builderName",
                sc."firstName" AS "creatorFirstName",
                sc."lastName" AS "creatorLastName"
           FROM "Task" t
      LEFT JOIN "Job" j ON j."id" = t."jobId"
      LEFT JOIN "Builder" b ON b."id" = t."builderId"
      LEFT JOIN "Staff" sc ON sc."id" = t."creatorId"
          WHERE t."assigneeId" = $1
            AND t."status"::text = 'DONE'
            AND t."completedAt" > NOW() - INTERVAL '24 hours'`
      : ''

    const tasks: any[] = await prisma.$queryRawUnsafe(
      `WITH ordered AS (
         SELECT t."id", t."title", t."description",
                t."priority"::text AS "priority",
                t."status"::text AS "status",
                t."category"::text AS "category",
                t."dueDate", t."completedAt",
                t."assigneeId", t."creatorId",
                t."jobId", t."builderId", t."communityId",
                t."sourceKey",
                t."createdAt", t."updatedAt",
                j."jobNumber", j."jobAddress" AS "address",
                b."companyName" AS "builderName",
                sc."firstName" AS "creatorFirstName",
                sc."lastName" AS "creatorLastName"
           FROM "Task" t
      LEFT JOIN "Job" j ON j."id" = t."jobId"
      LEFT JOIN "Builder" b ON b."id" = t."builderId"
      LEFT JOIN "Staff" sc ON sc."id" = t."creatorId"
          WHERE ${whereClause}
         ${includeDoneClause}
       )
       SELECT * FROM ordered
       ORDER BY
         CASE WHEN "status" = 'DONE' THEN 1 ELSE 0 END,
         CASE WHEN "dueDate" IS NULL THEN 1 ELSE 0 END,
         CASE WHEN "dueDate" < NOW() THEN 0 ELSE 1 END,
         "dueDate" ASC,
         CASE "priority"
           WHEN 'CRITICAL' THEN 0
           WHEN 'HIGH' THEN 1
           WHEN 'MEDIUM' THEN 2
           WHEN 'LOW' THEN 3
         END
       LIMIT $${paramIdx}`,
      ...params,
      limit,
    )

    // Aggregate counts (independent query — small table for one staff).
    const countRows: any[] = await prisma.$queryRawUnsafe(
      `SELECT
         COUNT(*) FILTER (
           WHERE "status"::text NOT IN ('DONE', 'CANCELLED')
         )::int AS "total",
         COUNT(*) FILTER (
           WHERE "status"::text NOT IN ('DONE', 'CANCELLED')
             AND "dueDate" IS NOT NULL
             AND "dueDate" < NOW()
         )::int AS "overdue",
         COUNT(*) FILTER (
           WHERE "status"::text NOT IN ('DONE', 'CANCELLED')
             AND "priority"::text = 'CRITICAL'
         )::int AS "critical",
         COUNT(*) FILTER (
           WHERE "status"::text NOT IN ('DONE', 'CANCELLED')
             AND "dueDate" IS NOT NULL
             AND "dueDate"::date = CURRENT_DATE
         )::int AS "dueToday",
         COUNT(*) FILTER (
           WHERE "status"::text = 'DONE'
             AND "completedAt" > NOW() - INTERVAL '24 hours'
         )::int AS "completed24h"
       FROM "Task"
       WHERE "assigneeId" = $1`,
      staffId,
    )

    const counts = countRows[0] || {
      total: 0,
      overdue: 0,
      critical: 0,
      dueToday: 0,
      completed24h: 0,
    }

    const enriched = tasks.map((t) => ({
      id: t.id,
      title: t.title,
      description: t.description,
      priority: t.priority,
      status: t.status,
      category: t.category,
      dueDate: t.dueDate ? new Date(t.dueDate).toISOString() : null,
      completedAt: t.completedAt ? new Date(t.completedAt).toISOString() : null,
      assigneeId: t.assigneeId,
      creatorId: t.creatorId,
      jobId: t.jobId,
      builderId: t.builderId,
      communityId: t.communityId,
      sourceKey: t.sourceKey,
      createdAt: new Date(t.createdAt).toISOString(),
      updatedAt: new Date(t.updatedAt).toISOString(),
      job: t.jobNumber
        ? { jobNumber: t.jobNumber, address: t.address ?? null }
        : null,
      builder: t.builderName ? { companyName: t.builderName } : null,
      creator:
        t.creatorFirstName || t.creatorLastName
          ? {
              firstName: t.creatorFirstName,
              lastName: t.creatorLastName,
            }
          : null,
    }))

    return NextResponse.json({ tasks: enriched, counts })
  } catch (error: any) {
    console.error('[ops/tasks] list failed:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

// ──────────────────────────────────────────────────────────────────────
// POST /api/ops/tasks — create a standalone task
// ──────────────────────────────────────────────────────────────────────
export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  const staffId = request.headers.get('x-staff-id')
  if (!staffId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await request.json().catch(() => ({}))
    const {
      title,
      description,
      dueDate,
      priority,
      status,
      category,
      assigneeId: rawAssigneeId,
      jobId: rawJobId,
      builderId: rawBuilderId,
    } = body ?? {}

    if (!title || typeof title !== 'string' || !title.trim()) {
      return NextResponse.json(
        { error: 'title is required' },
        { status: 400 }
      )
    }

    const assigneeId =
      typeof rawAssigneeId === 'string' && rawAssigneeId.trim()
        ? rawAssigneeId.trim()
        : staffId

    const jobId = typeof rawJobId === 'string' && rawJobId.trim() ? rawJobId.trim() : null
    let builderId =
      typeof rawBuilderId === 'string' && rawBuilderId.trim()
        ? rawBuilderId.trim()
        : null
    let communityId: string | null = null

    // If a job is linked, derive builderId + communityId from it (matches
    // the job-task POST route's behavior).
    if (jobId) {
      const jobRows: any[] = await prisma.$queryRawUnsafe(
        `SELECT j."id", j."communityId", o."builderId" AS "orderBuilderId"
           FROM "Job" j
      LEFT JOIN "Order" o ON o."id" = j."orderId"
          WHERE j."id" = $1`,
        jobId,
      )
      if (jobRows.length === 0) {
        return NextResponse.json({ error: 'Job not found' }, { status: 404 })
      }
      builderId = builderId || jobRows[0].orderBuilderId || null
      communityId = jobRows[0].communityId || null
    }

    const taskId = `task_${Date.now().toString(36)}_${Math.random()
      .toString(36)
      .slice(2, 8)}`

    const inserted: any[] = await prisma.$queryRawUnsafe(
      `INSERT INTO "Task" (
         "id", "assigneeId", "creatorId", "jobId", "builderId", "communityId",
         "title", "description", "priority", "status", "category",
         "dueDate", "createdAt", "updatedAt"
       )
       VALUES (
         $1, $2, $3, $4, $5, $6,
         $7, $8, $9::"TaskPriority", $10::"TaskStatus", $11::"TaskCategory",
         $12, NOW(), NOW()
       )
       RETURNING "id", "title", "description",
                 "priority"::text AS "priority",
                 "status"::text   AS "status",
                 "category"::text AS "category",
                 "dueDate", "completedAt",
                 "assigneeId", "creatorId", "jobId", "builderId", "communityId",
                 "createdAt", "updatedAt"`,
      taskId,
      assigneeId,
      staffId,
      jobId,
      builderId,
      communityId,
      title.trim(),
      typeof description === 'string' && description.trim()
        ? description.trim()
        : null,
      normalizePriority(priority),
      normalizeStatus(status),
      normalizeCategory(category),
      dueDate ? new Date(dueDate) : null,
    )

    audit(request, 'CREATE', 'Task', taskId, {
      method: 'POST',
      standalone: !jobId,
      title: title.trim(),
    }).catch(() => {})

    const t = inserted[0]
    return NextResponse.json(
      {
        ...t,
        dueDate: t.dueDate ? new Date(t.dueDate).toISOString() : null,
        completedAt: t.completedAt
          ? new Date(t.completedAt).toISOString()
          : null,
        createdAt: new Date(t.createdAt).toISOString(),
        updatedAt: new Date(t.updatedAt).toISOString(),
      },
      { status: 201 },
    )
  } catch (error: any) {
    console.error('[ops/tasks] create failed:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
