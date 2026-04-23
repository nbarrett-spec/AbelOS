export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'
import { prisma } from '@/lib/prisma'
import { audit } from '@/lib/audit'

/**
 * POST /api/ops/delivery/[deliveryId]/complete
 *
 * Marks a delivery complete (or partial) with captured signature + photos
 * from the driver's device.
 *
 * Body: {
 *   signedBy?: string,              // legacy — maps to recipientName
 *   recipientName?: string,         // who signed on site
 *   signature?: string,             // legacy — maps to signatureDataUrl
 *   signatureDataUrl?: string,      // base64 PNG (data: URL)
 *   photos?: string[],              // base64 data URLs from <input capture="environment">
 *   sitePhotos?: string[],          // legacy alias for photos
 *   damagedItems?: string[],        // list of damaged line items
 *   damageNotes?: string,           // free-text damage description
 *   partialComplete?: boolean,      // if true, status → PARTIAL_DELIVERY instead of COMPLETE
 *   notes?: string,                 // free-text driver notes
 *   deliveredBy?: string,           // driver's name (auditing)
 * }
 *
 * Stores signature + photos as JSON blob in Delivery.notes until blob storage
 * is wired. sitePhotos (URLs column) remains untouched for now to avoid
 * schema churn; the base64 blob lives in notes under [PROOF-JSON] sentinel.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { deliveryId: string } }
) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const body = await request.json()

    // Normalize field aliases (legacy desktop flow vs new mobile flow)
    const recipientName: string | null =
      (body.recipientName || body.signedBy || null) as string | null
    const signatureDataUrl: string | null =
      (body.signatureDataUrl || body.signature || null) as string | null
    const photos: string[] = Array.isArray(body.photos)
      ? body.photos
      : Array.isArray(body.sitePhotos)
        ? body.sitePhotos
        : []
    const damagedItems: string[] = Array.isArray(body.damagedItems) ? body.damagedItems : []
    const damageNotes: string | null = body.damageNotes || null
    const partialComplete: boolean = body.partialComplete === true
    const notes: string | null = body.notes || null
    const deliveredBy: string | null = body.deliveredBy || null

    const now = new Date()

    const delivery = await prisma.delivery.findUnique({
      where: { id: params.deliveryId },
      select: { id: true, jobId: true, notes: true, sitePhotos: true, damageNotes: true },
    })
    if (!delivery) return NextResponse.json({ error: 'delivery not found' }, { status: 404 })

    // Build a structured proof blob embedded in notes (until blob storage lands).
    // The blob is ~base64 heavy — we keep it last so humans can still read
    // the first lines of notes without seeing a giant data URL.
    const proofBlob = {
      capturedAt: now.toISOString(),
      recipientName,
      deliveredBy,
      partialComplete,
      damagedItems,
      photosCount: photos.length,
      hasSignature: !!signatureDataUrl,
      // Inline blobs — tradeoff: keeps driver PoD self-contained without blob
      // storage. Move to S3/R2 later; the sentinel makes migration easy.
      signatureDataUrl: signatureDataUrl || null,
      photos,
    }

    const newNotesParts: string[] = []
    if (delivery.notes) newNotesParts.push(delivery.notes)
    if (notes) newNotesParts.push(`[DRIVER]: ${notes}`)
    if (damagedItems.length > 0) {
      newNotesParts.push(`[DAMAGED]: ${damagedItems.join(', ')}`)
    }
    if (partialComplete) {
      newNotesParts.push('[PARTIAL]: delivery marked partial by driver')
    }
    newNotesParts.push(`[PROOF-JSON]: ${JSON.stringify(proofBlob)}`)
    const newNotes = newNotesParts.join('\n')

    const newDamageNotes =
      damageNotes || delivery.damageNotes || (damagedItems.length > 0 ? damagedItems.join('; ') : null)

    await prisma.delivery.update({
      where: { id: delivery.id },
      data: {
        status: partialComplete ? 'PARTIAL_DELIVERY' : 'COMPLETE',
        completedAt: now,
        arrivedAt: now,
        signedBy: recipientName,
        notes: newNotes,
        damageNotes: newDamageNotes,
      },
    })

    // Update Job status if this was its delivery (only advance on full complete)
    if (delivery.jobId && !partialComplete) {
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
        status: partialComplete ? 'PARTIAL_DELIVERY' : 'COMPLETE',
        updatedBy: deliveredBy || 'driver-portal',
        notes: `Signed by ${recipientName || 'unspecified'}${partialComplete ? ' (partial)' : ''}${damagedItems.length > 0 ? ` · damaged: ${damagedItems.length}` : ''}`,
      },
    })

    await audit(request, 'UPDATE', 'Delivery', delivery.id, {
      status: partialComplete ? 'PARTIAL_DELIVERY' : 'COMPLETE',
      recipientName,
      photosCount: photos.length,
      damagedItemsCount: damagedItems.length,
      partialComplete,
    })

    return NextResponse.json({
      ok: true,
      completedAt: now.toISOString(),
      status: partialComplete ? 'PARTIAL_DELIVERY' : 'COMPLETE',
    })
  } catch (err: any) {
    console.error('[delivery complete] error', err)
    return NextResponse.json({ error: err?.message || 'failed' }, { status: 500 })
  }
}
