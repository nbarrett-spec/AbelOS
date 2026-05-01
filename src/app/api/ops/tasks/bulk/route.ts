/**
 * /api/ops/tasks/bulk — Multi-task actions
 *
 * v2 enhancement of the staff task system. Lets the panel clear or
 * snooze N tasks in one request instead of N round trips.
 *
 * Body:
 *   {
 *     action: 'complete' | 'snooze' | 'cancel',
 *     ids: string[],
 *     dueDate?: ISO string (only for snooze)
 *   }
 *
 * Auth: assignee, creator, or ADMIN/MANAGER for each row in `ids`.
 * Rows the caller can't act on are silently skipped — the response
 * reports `affected` (succeeded) and `skipped` (auth failed / missing).
 */

export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'
import { audit } from '@/lib/audit'

type BulkAction = 'complete' | 'snooze' | 'cancel'

export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  const staffId = request.headers.get('x-staff-id')
  if (!staffId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await request.json().catch(() => ({}))
    const action = body?.action as BulkAction | undefined
    const ids = Array.isArray(body?.ids)
      ? (body.ids as string[]).filter(
          (x) => typeof x === 'string' && x.trim(),
        )
      : []
    if (!action || !['complete', 'snooze', 'cancel'].includes(action)) {
      return NextResponse.json(
        { error: 'action must be "complete", "snooze", or "cancel"' },
        { status: 400 },
      )
    }
    if (ids.length === 0) {
      return NextResponse.json(
        { error: 'ids must be a non-empty string array' },
        { status: 400 },
      )
    }
    if (ids.length > 200) {
      return NextResponse.json(
        { error: 'Too many ids (max 200 per request)' },
        { status: 400 },
      )
    }

    let dueDate: Date | null = null
    if (action === 'snooze') {
      if (!body?.dueDate) {
        return NextResponse.json(
          { error: 'dueDate is required for snooze' },
          { status: 400 },
        )
      }
      dueDate = new Date(body.dueDate)
      if (Number.isNaN(dueDate.getTime())) {
        return NextResponse.json(
          { error: 'invalid dueDate' },
          { status: 400 },
        )
      }
    }

    // Resolve caller's role once for the auth-eligibility check.
    const callerRows: any[] = await prisma.$queryRawUnsafe(
      `SELECT "role"::text AS "role" FROM "Staff" WHERE "id" = $1`,
      staffId,
    )
    const callerRole: string = callerRows[0]?.role || ''
    const isAdminOrManager = callerRole === 'ADMIN' || callerRole === 'MANAGER'

    // Pull all candidate tasks; we filter eligibility in memory so we can
    // emit a single SQL UPDATE for the rows we keep.
    const candidates: any[] = await prisma.$queryRawUnsafe(
      `SELECT "id", "assigneeId", "creatorId", "status"::text AS "status"
         FROM "Task"
        WHERE "id" = ANY($1::text[])`,
      ids,
    )

    const eligibleIds: string[] = []
    let skippedAuth = 0
    for (const t of candidates) {
      if (
        isAdminOrManager ||
        t.assigneeId === staffId ||
        t.creatorId === staffId
      ) {
        eligibleIds.push(t.id)
      } else {
        skippedAuth++
      }
    }

    let affected = 0
    if (eligibleIds.length > 0) {
      let result: any
      if (action === 'complete') {
        // Skip already-terminal rows so we don't re-stamp completedAt.
        result = await prisma.$executeRawUnsafe(
          `UPDATE "Task"
              SET "status" = 'DONE'::"TaskStatus",
                  "completedAt" = NOW(),
                  "updatedAt" = NOW()
            WHERE "id" = ANY($1::text[])
              AND "status"::text NOT IN ('DONE', 'CANCELLED')`,
          eligibleIds,
        )
      } else if (action === 'cancel') {
        result = await prisma.$executeRawUnsafe(
          `UPDATE "Task"
              SET "status" = 'CANCELLED'::"TaskStatus",
                  "updatedAt" = NOW()
            WHERE "id" = ANY($1::text[])
              AND "status"::text NOT IN ('DONE', 'CANCELLED')`,
          eligibleIds,
        )
      } else {
        // snooze — push out the dueDate without changing status
        result = await prisma.$executeRawUnsafe(
          `UPDATE "Task"
              SET "dueDate" = $2,
                  "updatedAt" = NOW()
            WHERE "id" = ANY($1::text[])
              AND "status"::text NOT IN ('DONE', 'CANCELLED')`,
          eligibleIds,
          dueDate,
        )
      }
      affected = typeof result === 'number' ? result : 0
    }

    audit(request, 'UPDATE', 'Task', undefined, {
      method: 'POST',
      bulkAction: action,
      requested: ids.length,
      eligible: eligibleIds.length,
      affected,
      skippedAuth,
    }).catch(() => {})

    return NextResponse.json({
      action,
      affected,
      skippedAuth,
      skippedNotFound: ids.length - candidates.length,
      eligible: eligibleIds.length,
    })
  } catch (err: any) {
    console.error('[ops/tasks/bulk] failed:', err)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    )
  }
}
