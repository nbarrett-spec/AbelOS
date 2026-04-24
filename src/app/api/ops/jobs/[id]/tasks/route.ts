export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'
import { audit } from '@/lib/audit'

// GET /api/ops/jobs/[id]/tasks — List tasks for a job (newest first)
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const jobId = params.id

    // Verify job exists
    const job: Array<{ id: string }> = await prisma.$queryRawUnsafe(
      `SELECT "id" FROM "Job" WHERE "id" = $1`,
      jobId
    )
    if (job.length === 0) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    }

    const tasks: any[] = await prisma.$queryRawUnsafe(
      `SELECT t."id",
              t."title",
              t."description",
              t."priority"::text AS "priority",
              t."status"::text   AS "status",
              t."category"::text AS "category",
              t."dueDate",
              t."completedAt",
              t."assigneeId",
              t."creatorId",
              t."createdAt",
              t."updatedAt",
              s."firstName" AS "assigneeFirstName",
              s."lastName"  AS "assigneeLastName"
         FROM "Task" t
    LEFT JOIN "Staff" s ON s."id" = t."assigneeId"
        WHERE t."jobId" = $1
     ORDER BY t."createdAt" DESC
        LIMIT 200`,
      jobId
    )

    const enriched = tasks.map((t) => ({
      ...t,
      assignee:
        t.assigneeFirstName || t.assigneeLastName
          ? {
              id: t.assigneeId,
              firstName: t.assigneeFirstName,
              lastName: t.assigneeLastName,
            }
          : null,
    }))

    return NextResponse.json({ tasks: enriched })
  } catch (error: any) {
    console.error('[jobs/tasks] list failed:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

// Map free-form / legacy frontend status strings to the canonical TaskStatus
// enum. The PM portal currently sends 'OPEN' for new tasks; older callers
// may send 'PENDING' / 'NEW'. Anything we don't recognize falls back to TODO.
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

// POST /api/ops/jobs/[id]/tasks — Create a task on this job
//
// Called by the PM portal "Create task" modal. The frontend sends
// { title, description, dueDate, status: 'OPEN', priority }.
//
// Auth context provides x-staff-id (from middleware/api-auth). We default
// both creator and assignee to the calling staff when not specified.
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const jobId = params.id
    const staffId = request.headers.get('x-staff-id')
    if (!staffId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Verify job exists and grab some metadata for defaults. Job has no
    // direct builderId column — it links to Builder via orderId → Order.
    const job: Array<{
      id: string
      assignedPMId: string | null
      communityId: string | null
      orderBuilderId: string | null
    }> = await prisma.$queryRawUnsafe(
      `SELECT j."id",
              j."assignedPMId",
              j."communityId",
              o."builderId" AS "orderBuilderId"
         FROM "Job" j
    LEFT JOIN "Order" o ON o."id" = j."orderId"
        WHERE j."id" = $1`,
      jobId
    )
    if (job.length === 0) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    }

    const body = await request.json().catch(() => ({}))
    const {
      title,
      description,
      dueDate,
      priority,
      status,
      category,
      assigneeId: rawAssigneeId,
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
        : job[0].assignedPMId || staffId

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
                 "assigneeId", "creatorId", "jobId",
                 "createdAt", "updatedAt"`,
      taskId,
      assigneeId,
      staffId,
      jobId,
      job[0].orderBuilderId,
      job[0].communityId,
      title.trim(),
      typeof description === 'string' && description.trim()
        ? description.trim()
        : null,
      normalizePriority(priority),
      normalizeStatus(status),
      normalizeCategory(category),
      dueDate ? new Date(dueDate) : null
    )

    audit(request, 'CREATE', 'Task', taskId, {
      method: 'POST',
      jobId,
      title: title.trim(),
    }).catch(() => {})

    return NextResponse.json(inserted[0], { status: 201 })
  } catch (error: any) {
    console.error('[jobs/tasks] create failed:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
