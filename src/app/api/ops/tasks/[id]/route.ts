/**
 * /api/ops/tasks/[id] — Update a single task
 *
 * Spec: STAFF-TASK-SYSTEM-SPEC.md §3 (PATCH).
 *
 * The `complete/route.ts` sibling already handles `status: DONE` via POST.
 * This PATCH covers status transitions other than DONE plus general edits
 * (title, description, dueDate, priority).
 *
 * Auth: must be assignee, creator, or hold ADMIN/MANAGER role.
 */

export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'
import { audit } from '@/lib/audit'

function normalizeStatus(input: unknown): string | null {
  if (typeof input !== 'string') return null
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
      return null
  }
}

function normalizePriority(input: unknown): string | null {
  if (typeof input !== 'string') return null
  const v = input.trim().toUpperCase()
  if (v === 'LOW' || v === 'MEDIUM' || v === 'HIGH' || v === 'CRITICAL') {
    return v
  }
  return null
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  const staffId = request.headers.get('x-staff-id')
  if (!staffId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const taskId = params.id
    const body = await request.json().catch(() => ({}))

    // Fetch the task + the calling staff's role for authorization.
    const taskRows: any[] = await prisma.$queryRawUnsafe(
      `SELECT t."id", t."assigneeId", t."creatorId",
              t."status"::text AS "status"
         FROM "Task" t
        WHERE t."id" = $1`,
      taskId,
    )
    if (taskRows.length === 0) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    }
    const task = taskRows[0]

    // Authorize: assignee, creator, or ADMIN/MANAGER.
    let authorized = task.assigneeId === staffId || task.creatorId === staffId
    if (!authorized) {
      const staffRows: any[] = await prisma.$queryRawUnsafe(
        `SELECT "role"::text AS "role" FROM "Staff" WHERE "id" = $1`,
        staffId,
      )
      const role = staffRows[0]?.role
      if (role === 'ADMIN' || role === 'MANAGER') {
        authorized = true
      }
    }
    if (!authorized) {
      return NextResponse.json(
        { error: 'Not authorized to update this task' },
        { status: 403 },
      )
    }

    // Build a dynamic UPDATE based on which fields the body included.
    const sets: string[] = ['"updatedAt" = NOW()']
    const queryParams: any[] = []
    let idx = 1

    if (body.title !== undefined) {
      const t =
        typeof body.title === 'string' && body.title.trim()
          ? body.title.trim()
          : null
      if (!t) {
        return NextResponse.json(
          { error: 'title cannot be empty' },
          { status: 400 },
        )
      }
      sets.push(`"title" = $${idx}`)
      queryParams.push(t)
      idx++
    }

    if (body.description !== undefined) {
      const d =
        typeof body.description === 'string' && body.description.trim()
          ? body.description.trim()
          : null
      sets.push(`"description" = $${idx}`)
      queryParams.push(d)
      idx++
    }

    if (body.priority !== undefined) {
      const p = normalizePriority(body.priority)
      if (!p) {
        return NextResponse.json(
          { error: 'invalid priority' },
          { status: 400 },
        )
      }
      sets.push(`"priority" = $${idx}::"TaskPriority"`)
      queryParams.push(p)
      idx++
    }

    if (body.dueDate !== undefined) {
      // Allow explicit null to clear the date.
      if (body.dueDate === null) {
        sets.push(`"dueDate" = NULL`)
      } else {
        const d = new Date(body.dueDate)
        if (Number.isNaN(d.getTime())) {
          return NextResponse.json(
            { error: 'invalid dueDate' },
            { status: 400 },
          )
        }
        sets.push(`"dueDate" = $${idx}`)
        queryParams.push(d)
        idx++
      }
    }

    let statusChange: string | null = null
    if (body.status !== undefined) {
      const s = normalizeStatus(body.status)
      if (!s) {
        return NextResponse.json(
          { error: 'invalid status' },
          { status: 400 },
        )
      }
      sets.push(`"status" = $${idx}::"TaskStatus"`)
      queryParams.push(s)
      idx++
      statusChange = s

      // Sync completedAt with status:
      //  - moving to DONE: stamp completedAt = NOW() if not already DONE
      //  - moving away from DONE: clear completedAt
      if (s === 'DONE' && task.status !== 'DONE') {
        sets.push(`"completedAt" = NOW()`)
      } else if (s !== 'DONE' && task.status === 'DONE') {
        sets.push(`"completedAt" = NULL`)
      }
    }

    if (sets.length === 1) {
      // Only "updatedAt" is set — nothing meaningful to change.
      return NextResponse.json(
        { error: 'No updatable fields provided' },
        { status: 400 },
      )
    }

    queryParams.push(taskId)
    const updated: any[] = await prisma.$queryRawUnsafe(
      `UPDATE "Task"
          SET ${sets.join(', ')}
        WHERE "id" = $${idx}
        RETURNING "id", "title", "description",
                  "priority"::text AS "priority",
                  "status"::text   AS "status",
                  "category"::text AS "category",
                  "dueDate", "completedAt",
                  "assigneeId", "creatorId", "jobId", "builderId", "communityId",
                  "createdAt", "updatedAt"`,
      ...queryParams,
    )

    audit(request, 'UPDATE', 'Task', taskId, {
      method: 'PATCH',
      changes: Object.keys(body),
      statusChange,
    }).catch(() => {})

    const t = updated[0]
    return NextResponse.json({
      ...t,
      dueDate: t.dueDate ? new Date(t.dueDate).toISOString() : null,
      completedAt: t.completedAt ? new Date(t.completedAt).toISOString() : null,
      createdAt: new Date(t.createdAt).toISOString(),
      updatedAt: new Date(t.updatedAt).toISOString(),
    })
  } catch (error: any) {
    console.error('[ops/tasks/[id]] update failed:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    )
  }
}
