export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'
import { prisma } from '@/lib/prisma'
import { audit } from '@/lib/audit'
import { requireValidTransition, transitionErrorResponse } from '@/lib/status-guard'

/**
 * POST /api/ops/delivery/[deliveryId]/status
 *
 * Lightweight status-flip endpoint used by the driver manifest for the
 * intermediate states the existing /load · /depart · /complete trio doesn't
 * cover: ARRIVED, REFUSED, RESCHEDULED.
 *
 * Body: {
 *   action: 'ARRIVED' | 'REFUSED' | 'RESCHEDULED',
 *   notes?: string,
 *   updatedBy?: string,    // driver name for audit trail
 * }
 *
 * The full delivery flow:
 *   SCHEDULED → LOADING (POST /load)
 *   LOADING → IN_TRANSIT (POST /depart)
 *   IN_TRANSIT → ARRIVED (POST /status, action=ARRIVED)
 *   ARRIVED → UNLOADING ← (driver opens the existing /[id] page; complete
 *                          handles UNLOADING transitions implicitly)
 *   ARRIVED → REFUSED (POST /status, action=REFUSED)
 *   * → RESCHEDULED (POST /status, action=RESCHEDULED) — only legal from
 *     SCHEDULED or LOADING per state-machines.ts; we let the guard reject.
 *
 * For COMPLETE / PARTIAL_DELIVERY, callers continue to use the existing
 * /complete endpoint which captures signature + photos.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { deliveryId: string } }
) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const body = await request.json().catch(() => ({}))
    const action: string = String(body.action || '').toUpperCase()
    const notes: string | null = body.notes || null
    const updatedBy: string | null = body.updatedBy || null

    const VALID_ACTIONS = ['ARRIVED', 'REFUSED', 'RESCHEDULED'] as const
    if (!VALID_ACTIONS.includes(action as (typeof VALID_ACTIONS)[number])) {
      return NextResponse.json(
        { error: `Invalid action "${action}". Expected one of: ${VALID_ACTIONS.join(', ')}.` },
        { status: 400 }
      )
    }

    const rows: any[] = await prisma.$queryRawUnsafe(
      `SELECT d."id", d."deliveryNumber", d."status"::text AS "status", d."notes"
       FROM "Delivery" d
       WHERE d."id" = $1`,
      params.deliveryId
    )
    if (rows.length === 0) {
      return NextResponse.json({ error: 'Delivery not found' }, { status: 404 })
    }
    const d = rows[0]

    try {
      requireValidTransition('delivery', d.status, action)
    } catch (e) {
      const res = transitionErrorResponse(e)
      if (res) return res
      throw e
    }

    const now = new Date()
    const existingNotes: string = d.notes || ''
    const noteParts: string[] = []
    if (existingNotes) noteParts.push(existingNotes)
    noteParts.push(`[${action}]: ${now.toISOString()}${updatedBy ? ` by ${updatedBy}` : ''}`)
    if (notes) noteParts.push(`[${action}-NOTES]: ${notes}`)
    const NOTES_MAX_LEN = 2000
    let newNotes = noteParts.join('\n')
    if (newNotes.length > NOTES_MAX_LEN) {
      newNotes = newNotes.slice(0, NOTES_MAX_LEN - 16) + '… [truncated]'
    }

    // Field-specific stamps. arrivedAt for ARRIVED, completedAt for REFUSED
    // (terminal). RESCHEDULED leaves timing fields alone.
    const updateData: Record<string, unknown> = {
      status: action,
      notes: newNotes,
    }
    if (action === 'ARRIVED') updateData.arrivedAt = now
    if (action === 'REFUSED') updateData.completedAt = now

    await prisma.delivery.update({
      where: { id: params.deliveryId },
      data: updateData,
    })

    await prisma.deliveryTracking.create({
      data: {
        deliveryId: params.deliveryId,
        status: action,
        updatedBy: updatedBy || 'driver-portal',
        notes: notes || `${action} (${updatedBy || 'driver'})`,
      },
    }).catch(() => undefined)

    await audit(request, 'UPDATE', 'Delivery', params.deliveryId, {
      action,
      updatedBy,
      from: d.status,
      to: action,
    })

    return NextResponse.json({
      ok: true,
      deliveryId: params.deliveryId,
      deliveryNumber: d.deliveryNumber,
      status: action,
    })
  } catch (err: any) {
    console.error('[delivery status] error', err)
    return NextResponse.json({ error: err?.message || 'failed' }, { status: 500 })
  }
}
