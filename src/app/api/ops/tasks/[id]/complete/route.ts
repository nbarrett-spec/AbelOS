export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'
import { audit } from '@/lib/audit'

// POST /api/ops/tasks/[id]/complete — Mark a task as DONE
//
// Called by the PM "Today" dashboard to dismiss an overdue/today task once
// the PM has handled it. Sets status='DONE' and completedAt=NOW() (or the
// caller-supplied timestamp).
//
// Body: { completedAt?: string (ISO) }
// Returns: { id, status, completedAt } on success, 404 if task is missing.
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const taskId = params.id

    // Body is optional — Today dashboard sends none.
    let completedAt: Date | null = null
    try {
      const text = await request.text()
      if (text) {
        const body = JSON.parse(text)
        if (body?.completedAt) {
          const parsed = new Date(body.completedAt)
          if (!Number.isNaN(parsed.getTime())) completedAt = parsed
        }
      }
    } catch {
      // Ignore body parse errors — fall through to NOW().
    }
    if (!completedAt) completedAt = new Date()

    // Verify task exists.
    const existing: Array<{ id: string; status: string }> =
      await prisma.$queryRawUnsafe(
        `SELECT "id", "status"::text AS "status" FROM "Task" WHERE "id" = $1`,
        taskId
      )
    if (existing.length === 0) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    }

    // Already terminal? Return success without rewriting.
    const currentStatus = existing[0].status
    if (currentStatus === 'DONE' || currentStatus === 'CANCELLED') {
      return NextResponse.json({
        id: taskId,
        status: currentStatus,
        completedAt: null,
        alreadyClosed: true,
      })
    }

    // Mark DONE.
    const updated: Array<{
      id: string
      status: string
      completedAt: Date | null
    }> = await prisma.$queryRawUnsafe(
      `UPDATE "Task"
          SET "status" = 'DONE'::"TaskStatus",
              "completedAt" = $1,
              "updatedAt" = NOW()
        WHERE "id" = $2
        RETURNING "id", "status"::text AS "status", "completedAt"`,
      completedAt,
      taskId
    )

    audit(request, 'COMPLETE', 'Task', taskId, {
      method: 'POST',
      previousStatus: currentStatus,
    }).catch(() => {})

    const row = updated[0]
    return NextResponse.json({
      id: row.id,
      status: row.status,
      completedAt: row.completedAt
        ? new Date(row.completedAt).toISOString()
        : null,
    })
  } catch (error: any) {
    console.error('[tasks/complete] failed:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
