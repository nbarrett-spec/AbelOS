export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'
import { prisma } from '@/lib/prisma'
import { audit } from '@/lib/audit'

/**
 * POST /api/ops/delivery/[deliveryId]/depart
 *
 * Driver leaves the yard with the loaded truck.
 * Transition: LOADING → IN_TRANSIT.
 *
 * Body (optional): {
 *   departedBy?: string     // driver name for audit
 *   notes?:      string     // any pre-departure note (manifest checks, etc.)
 * }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { deliveryId: string } }
) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const body = await request.json().catch(() => ({}))
    const departedBy: string | null = body.departedBy || null
    const notes: string | null = body.notes || null

    const rows: any[] = await prisma.$queryRawUnsafe(
      `SELECT d."id", d."deliveryNumber", d."status"::text AS "status",
              d."crewId", d."notes"
       FROM "Delivery" d
       WHERE d."id" = $1`,
      params.deliveryId
    )
    if (rows.length === 0) {
      return NextResponse.json({ error: 'Delivery not found' }, { status: 404 })
    }
    const d = rows[0]

    // Only LOADING deliveries can depart.
    if (d.status !== 'LOADING') {
      return NextResponse.json(
        {
          error: `Cannot depart from status ${d.status}. Expected LOADING.`,
        },
        { status: 409 }
      )
    }

    const now = new Date()

    const existingNotes: string = d.notes || ''
    const noteParts: string[] = []
    if (existingNotes) noteParts.push(existingNotes)
    noteParts.push(`[DEPARTED]: ${now.toISOString()}${departedBy ? ` by ${departedBy}` : ''}`)
    if (notes) noteParts.push(`[DEPART-NOTES]: ${notes}`)
    const newNotes = noteParts.join('\n')

    await prisma.delivery.update({
      where: { id: params.deliveryId },
      data: {
        status: 'IN_TRANSIT',
        departedAt: now,
        notes: newNotes,
      },
    })

    await prisma.deliveryTracking.create({
      data: {
        deliveryId: params.deliveryId,
        status: 'DEPARTED',
        updatedBy: departedBy || 'driver-portal',
        notes: notes || `Departed yard${departedBy ? ` (${departedBy})` : ''}`,
      },
    }).catch(() => undefined)

    await audit(request, 'UPDATE', 'Delivery', params.deliveryId, {
      action: 'DEPART',
      departedBy,
      status: 'IN_TRANSIT',
      departedAt: now.toISOString(),
    })

    return NextResponse.json({
      ok: true,
      deliveryId: params.deliveryId,
      deliveryNumber: d.deliveryNumber,
      status: 'IN_TRANSIT',
      departedAt: now.toISOString(),
    })
  } catch (err: any) {
    console.error('[delivery depart] error', err)
    return NextResponse.json({ error: err?.message || 'failed' }, { status: 500 })
  }
}
