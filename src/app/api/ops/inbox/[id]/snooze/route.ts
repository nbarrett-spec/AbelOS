/**
 * Snooze an inbox item
 *
 * POST /api/ops/inbox/[id]/snooze
 *   body: { until: ISO8601 string, notes?: string }
 *
 * Sets snoozedUntil. Keeps status=SNOOZED. Audits.
 */

export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { audit } from '@/lib/audit'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  try {
    const body = await request.json().catch(() => ({}))
    const until = body?.until

    if (!until) {
      return NextResponse.json({ error: 'Missing required field: until' }, { status: 400 })
    }

    const parsed = new Date(until)
    if (Number.isNaN(parsed.getTime())) {
      return NextResponse.json({ error: 'Invalid "until" timestamp' }, { status: 400 })
    }

    const existing = await prisma.$queryRawUnsafe<any[]>(
      `SELECT id FROM "InboxItem" WHERE id = $1`,
      id
    )
    if (!existing.length) {
      return NextResponse.json({ error: 'Item not found' }, { status: 404 })
    }

    await prisma.$executeRawUnsafe(
      `UPDATE "InboxItem"
         SET status = 'SNOOZED',
             "snoozedUntil" = $1,
             "updatedAt" = NOW()
       WHERE id = $2`,
      parsed.toISOString(),
      id
    )

    await audit(request, 'SNOOZE', 'InboxItem', id, { until: parsed.toISOString(), notes: body?.notes })

    return NextResponse.json({
      id,
      status: 'SNOOZED',
      snoozedUntil: parsed.toISOString(),
    })
  } catch (error: any) {
    logger.error('inbox_snooze_failed', { error: error?.message, id })
    return NextResponse.json(
      { error: error?.message || 'Failed to snooze item' },
      { status: 500 }
    )
  }
}
