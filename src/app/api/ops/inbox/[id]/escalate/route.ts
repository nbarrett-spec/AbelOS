/**
 * Escalate an inbox item to another staff member
 *
 * POST /api/ops/inbox/[id]/escalate
 *   body: { toStaffId: string, reason?: string }
 *
 * Re-assigns the item. Updates assignedTo. Writes audit log.
 */

export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { audit, getStaffFromHeaders } from '@/lib/audit'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  try {
    const body = await request.json().catch(() => ({}))
    const toStaffId = body?.toStaffId
    const reason = typeof body?.reason === 'string' ? body.reason : null

    if (!toStaffId || typeof toStaffId !== 'string') {
      return NextResponse.json({ error: 'Missing required field: toStaffId' }, { status: 400 })
    }

    const staff = getStaffFromHeaders(request.headers)

    const existing = await prisma.$queryRawUnsafe<any[]>(
      `SELECT id, "assignedTo" FROM "InboxItem" WHERE id = $1`,
      id
    )
    if (!existing.length) {
      return NextResponse.json({ error: 'Item not found' }, { status: 404 })
    }
    const previousAssignee = existing[0]?.assignedTo || null

    // Verify the target staff exists (accept id OR email)
    const target = await prisma.$queryRawUnsafe<any[]>(
      `SELECT id, email, "firstName", "lastName" FROM "Staff" WHERE id = $1 OR email = $1 LIMIT 1`,
      toStaffId
    )
    if (!target.length) {
      return NextResponse.json({ error: 'Target staff member not found' }, { status: 404 })
    }
    const resolvedAssignee = target[0].id

    await prisma.$executeRawUnsafe(
      `UPDATE "InboxItem"
         SET "assignedTo" = $1,
             "updatedAt" = NOW()
       WHERE id = $2`,
      resolvedAssignee,
      id
    )

    await audit(
      request,
      'ESCALATE',
      'InboxItem',
      id,
      { from: previousAssignee, to: resolvedAssignee, reason, escalatedBy: staff.staffId },
      'WARN'
    )

    return NextResponse.json({
      id,
      assignedTo: resolvedAssignee,
      previousAssignee,
    })
  } catch (error: any) {
    logger.error('inbox_escalate_failed', { error: error?.message, id })
    return NextResponse.json(
      { error: error?.message || 'Failed to escalate item' },
      { status: 500 }
    )
  }
}
