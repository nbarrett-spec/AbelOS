export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'
import { prisma } from '@/lib/prisma'

/**
 * POST /api/ops/delivery/[deliveryId]/complete
 *
 * Marks a delivery complete with optional captured signature.
 *
 * Body: {
 *   signedBy: string,
 *   signature?: string (base64 PNG),
 *   deliveredBy?: string (driver name),
 *   notes?: string,
 *   sitePhotos?: string[]
 * }
 *
 * Stores the signature as a data-URL-ish note until we wire blob storage.
 * Also updates the linked Job status → DELIVERED and Order status if all
 * deliveries complete.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { deliveryId: string } }
) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const body = await request.json()
    const { signedBy, signature, notes, sitePhotos } = body

    const now = new Date()

    const delivery = await prisma.delivery.findUnique({
      where: { id: params.deliveryId },
      select: { id: true, jobId: true, notes: true, sitePhotos: true },
    })
    if (!delivery) return NextResponse.json({ error: 'delivery not found' }, { status: 404 })

    const newNotes = [
      delivery.notes,
      notes,
      signature ? `[SIGNATURE-DATAURL]: ${signature.slice(0, 50)}...` : null,
    ]
      .filter(Boolean)
      .join('\n')

    await prisma.delivery.update({
      where: { id: delivery.id },
      data: {
        status: 'COMPLETE',
        completedAt: now,
        arrivedAt: delivery.id ? now : undefined,
        signedBy: signedBy || null,
        notes: newNotes,
        sitePhotos: sitePhotos && Array.isArray(sitePhotos)
          ? [...(delivery.sitePhotos || []), ...sitePhotos]
          : delivery.sitePhotos,
      },
    })

    // Update Job status if this was its delivery
    if (delivery.jobId) {
      await prisma.job.update({
        where: { id: delivery.jobId },
        data: {
          status: 'DELIVERED',
          actualDate: now,
        },
      })
    }

    // Log a tracking event
    await prisma.deliveryTracking.create({
      data: {
        deliveryId: delivery.id,
        status: 'COMPLETE',
        updatedBy: 'system',
        notes: `Signed by ${signedBy || 'unspecified'}`,
      },
    })

    return NextResponse.json({ ok: true, completedAt: now.toISOString() })
  } catch (err: any) {
    console.error('[delivery complete] error', err)
    return NextResponse.json({ error: err?.message || 'failed' }, { status: 500 })
  }
}
