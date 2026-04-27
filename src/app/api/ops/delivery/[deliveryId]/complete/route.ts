export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'
import { prisma } from '@/lib/prisma'
import { audit } from '@/lib/audit'
import { onDeliveryComplete } from '@/lib/cascades/delivery-lifecycle'
import { requireValidTransition, transitionErrorResponse } from '@/lib/status-guard'
import { fireAutomationEvent } from '@/lib/automation-executor'

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
      select: { id: true, jobId: true, status: true, notes: true, sitePhotos: true, damageNotes: true },
    })
    if (!delivery) return NextResponse.json({ error: 'delivery not found' }, { status: 404 })

    const targetDeliveryStatus = partialComplete ? 'PARTIAL_DELIVERY' : 'COMPLETE'

    // Guard: enforce DeliveryStatus state machine.
    try {
      requireValidTransition('delivery', String(delivery.status), targetDeliveryStatus)
    } catch (e) {
      const res = transitionErrorResponse(e)
      if (res) return res
      throw e
    }

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

    // Update Job status if this was its delivery (only advance on full complete).
    // Guard: skip the Job flip if it's not a valid transition from the current Job status.
    if (delivery.jobId && !partialComplete) {
      try {
        const job = await prisma.job.findUnique({
          where: { id: delivery.jobId },
          select: { status: true },
        })
        if (job) {
          try {
            requireValidTransition('job', String(job.status), 'DELIVERED')
            await prisma.job.update({
              where: { id: delivery.jobId },
              data: {
                status: 'DELIVERED',
                actualDate: now,
              },
            })
          } catch {
            console.warn(
              `[delivery complete] skipped Job→DELIVERED flip — invalid from ${job.status} for job ${delivery.jobId}`,
            )
            // Still stamp actualDate without status flip
            await prisma.job.update({
              where: { id: delivery.jobId },
              data: { actualDate: now },
            })
          }
        }
      } catch (e: any) {
        console.warn('[delivery complete] job update failed:', e?.message)
      }
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

    // Cross-entity cascade — on full-complete, advance the linked Order to
    // DELIVERED, trigger the invoice-on-delivery draft, and notify the PM.
    // Skip for partial deliveries (those stay PARTIAL_DELIVERY until a
    // follow-up delivery closes the remainder). Fire-and-forget.
    if (!partialComplete) {
      onDeliveryComplete(delivery.id).catch((err: any) => {
        console.error('[delivery complete] cascade failure', delivery.id, err?.message || err)
      })
    }

    // Fire user-defined automation rules (AutomationRule table) for
    // DELIVERY_COMPLETE. Fires for both partial and full — the `status` field
    // in the context lets rules differentiate. Fire-and-forget; failures
    // must never block delivery completion. Best-effort context lookup —
    // join to Job/Order to expose orderId + builderId for downstream rules.
    try {
      const ctxRows: any[] = await prisma.$queryRawUnsafe(
        `SELECT d."deliveryNumber", j."orderId", o."builderId"
         FROM "Delivery" d
         LEFT JOIN "Job" j ON j."id" = d."jobId"
         LEFT JOIN "Order" o ON o."id" = j."orderId"
         WHERE d."id" = $1`,
        delivery.id,
      )
      const ctx = ctxRows[0] || {}
      fireAutomationEvent('DELIVERY_COMPLETE', delivery.id, {
        deliveryId: delivery.id,
        deliveryNumber: ctx.deliveryNumber || null,
        orderId: ctx.orderId || null,
        jobId: delivery.jobId || null,
        builderId: ctx.builderId || null,
        status: partialComplete ? 'PARTIAL_DELIVERY' : 'COMPLETE',
      }).catch(() => {})
    } catch {
      // best-effort — never block on context fetch
    }

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
