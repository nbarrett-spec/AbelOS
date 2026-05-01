/**
 * /api/ops/tasks/clear-completed — Archive the caller's "Completed (last 24h)"
 *
 * BUG 3c. The "Completed (last 24h)" section in the Task Panel is purely a
 * confidence-pat-on-the-back, but builds up over a shift. The bulk endpoint
 * skips already-DONE rows (the cancel/complete UPDATEs are gated by
 * `status NOT IN ('DONE', 'CANCELLED')`), so we need a dedicated endpoint
 * that explicitly archives DONE → CANCELLED for the caller.
 *
 * Scope:
 *   - Only DONE tasks where the caller is the assignee (or ADMIN/MANAGER)
 *   - Only those completed in the last 24h (matches what the panel renders;
 *     we don't blow away historical DONE rows the user can't see)
 *   - Status transitions DONE → CANCELLED (sentinel "archived from view")
 *
 * No body required. Returns { affected }.
 */

export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'
import { audit } from '@/lib/audit'

export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  const staffId = request.headers.get('x-staff-id')
  if (!staffId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    // Resolve caller's role for the auth-scope check.
    const callerRows: any[] = await prisma.$queryRawUnsafe(
      `SELECT "role"::text AS "role" FROM "Staff" WHERE "id" = $1`,
      staffId,
    )
    const callerRole: string = callerRows[0]?.role || ''
    const isAdminOrManager = callerRole === 'ADMIN' || callerRole === 'MANAGER'

    // Window matches the Task Panel's "Completed (last 24h)" section so the
    // user only ever clears what they could actually see in the UI.
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000)

    // ADMIN / MANAGER can clear DONE tasks they're assigned to OR created.
    // Other roles only clear their own assignments.
    const result = isAdminOrManager
      ? await prisma.$executeRawUnsafe(
          `UPDATE "Task"
              SET "status" = 'CANCELLED'::"TaskStatus",
                  "updatedAt" = NOW()
            WHERE "status"::text = 'DONE'
              AND "completedAt" >= $1
              AND ("assigneeId" = $2 OR "creatorId" = $2)`,
          since,
          staffId,
        )
      : await prisma.$executeRawUnsafe(
          `UPDATE "Task"
              SET "status" = 'CANCELLED'::"TaskStatus",
                  "updatedAt" = NOW()
            WHERE "status"::text = 'DONE'
              AND "completedAt" >= $1
              AND "assigneeId" = $2`,
          since,
          staffId,
        )

    const affected = typeof result === 'number' ? result : 0

    audit(request, 'UPDATE', 'Task', undefined, {
      method: 'POST',
      action: 'clear-completed',
      windowHours: 24,
      affected,
    }).catch(() => {})

    return NextResponse.json({ affected })
  } catch (err: any) {
    console.error('[ops/tasks/clear-completed] failed:', err)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    )
  }
}
