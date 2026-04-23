/**
 * Resolve an inbox item
 *
 * POST /api/ops/inbox/[id]/resolve
 *   body: { resolution: string, notes?: string }
 *
 * Sets status=COMPLETED, resolvedAt=NOW(), resolvedBy=<staffId>, result JSONB.
 * Writes audit log.
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
    const resolution = typeof body?.resolution === 'string' ? body.resolution : 'resolved'
    const notes = typeof body?.notes === 'string' ? body.notes : null

    const staff = getStaffFromHeaders(request.headers)

    const existing = await prisma.$queryRawUnsafe<any[]>(
      `SELECT id, status FROM "InboxItem" WHERE id = $1`,
      id
    )
    if (!existing.length) {
      return NextResponse.json({ error: 'Item not found' }, { status: 404 })
    }

    const result = {
      resolution,
      notes,
      resolvedBy: staff.staffId,
      resolvedByName: staff.staffName,
      at: new Date().toISOString(),
    }

    await prisma.$executeRawUnsafe(
      `UPDATE "InboxItem"
         SET status = 'COMPLETED',
             "resolvedAt" = NOW(),
             "resolvedBy" = $1,
             result = $2::jsonb,
             "updatedAt" = NOW()
       WHERE id = $3`,
      staff.staffId,
      JSON.stringify(result),
      id
    )

    await audit(request, 'RESOLVE', 'InboxItem', id, { resolution, notes })

    return NextResponse.json({
      id,
      status: 'COMPLETED',
      resolvedAt: new Date().toISOString(),
      resolvedBy: staff.staffId,
    })
  } catch (error: any) {
    logger.error('inbox_resolve_failed', { error: error?.message, id })
    return NextResponse.json(
      { error: error?.message || 'Failed to resolve item' },
      { status: 500 }
    )
  }
}
