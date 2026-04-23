export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'
import { prisma } from '@/lib/prisma'
import { audit } from '@/lib/audit'
import { requireValidTransition, transitionErrorResponse } from '@/lib/status-guard'

/**
 * POST /api/ops/delivery/[deliveryId]/load
 *
 * Warehouse / driver marks a delivery as loading onto the truck.
 * Transition: SCHEDULED → LOADING.
 *
 * Body (optional): {
 *   loadedBy?:   string   // staff / driver name for audit
 *   notes?:      string   // load-line notes
 *   loadPhotos?: string[] // URLs or data URLs — appended to Delivery.loadPhotos
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
    const loadedBy: string | null = body.loadedBy || null
    const notes: string | null = body.notes || null
    const loadPhotos: string[] = Array.isArray(body.loadPhotos) ? body.loadPhotos : []

    const rows: any[] = await prisma.$queryRawUnsafe(
      `SELECT d."id", d."deliveryNumber", d."status"::text AS "status",
              d."crewId", d."notes", d."loadPhotos"
       FROM "Delivery" d
       WHERE d."id" = $1`,
      params.deliveryId
    )
    if (rows.length === 0) {
      return NextResponse.json({ error: 'Delivery not found' }, { status: 404 })
    }
    const d = rows[0]

    // Guard: enforce DeliveryStatus state machine (SCHEDULED → LOADING).
    try {
      requireValidTransition('delivery', d.status, 'LOADING')
    } catch (e) {
      const res = transitionErrorResponse(e)
      if (res) return res
      throw e
    }

    // Dispatch should have assigned a crew before the truck starts loading.
    if (!d.crewId) {
      return NextResponse.json(
        {
          error: 'Delivery has no crew assigned. Use /assign-driver first.',
        },
        { status: 409 }
      )
    }

    const existingNotes: string = d.notes || ''
    const noteParts: string[] = []
    if (existingNotes) noteParts.push(existingNotes)
    noteParts.push(`[LOADING]: ${new Date().toISOString()}${loadedBy ? ` by ${loadedBy}` : ''}`)
    if (notes) noteParts.push(`[LOAD-NOTES]: ${notes}`)
    const newNotes = noteParts.join('\n')

    // Append any supplied photos to existing loadPhotos array.
    const existingPhotos: string[] = Array.isArray(d.loadPhotos) ? d.loadPhotos : []
    const mergedPhotos = [...existingPhotos, ...loadPhotos]

    await prisma.delivery.update({
      where: { id: params.deliveryId },
      data: {
        status: 'LOADING',
        notes: newNotes,
        loadPhotos: mergedPhotos,
      },
    })

    await prisma.deliveryTracking.create({
      data: {
        deliveryId: params.deliveryId,
        status: 'LOADED',
        updatedBy: loadedBy || 'warehouse',
        notes: notes || `Loaded${loadedBy ? ` by ${loadedBy}` : ''}`,
      },
    }).catch(() => undefined)

    await audit(request, 'UPDATE', 'Delivery', params.deliveryId, {
      action: 'LOAD',
      loadedBy,
      photosAdded: loadPhotos.length,
      status: 'LOADING',
    })

    return NextResponse.json({
      ok: true,
      deliveryId: params.deliveryId,
      deliveryNumber: d.deliveryNumber,
      status: 'LOADING',
    })
  } catch (err: any) {
    console.error('[delivery load] error', err)
    return NextResponse.json({ error: err?.message || 'failed' }, { status: 500 })
  }
}
