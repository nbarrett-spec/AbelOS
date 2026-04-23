export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'
import { notifyDeliveryStatusChange } from '@/lib/notifications'
import { safeJson } from '@/lib/safe-json'
import { audit } from '@/lib/audit'
import { generateOpsAlert, isElevenLabsConfigured } from '@/lib/elevenlabs'

// ──────────────────────────────────────────────────────────────────
// BUILDER DELIVERY NOTIFICATION TRIGGER
// ──────────────────────────────────────────────────────────────────
// POST { deliveryId, status, reason?, newDate? }
// Sends builder email + in-app notification on delivery status change
// ──────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    // Audit log
    audit(request, 'CREATE', 'DeliveryNotify', undefined, { method: 'POST' }).catch(() => {})

    const body = await request.json()
    const { deliveryId, status, reason, newDate } = body

    if (!deliveryId || !status) {
      return NextResponse.json({ error: 'deliveryId and status are required' }, { status: 400 })
    }

    const validStatuses = ['SCHEDULED', 'LOADING', 'IN_TRANSIT', 'ARRIVED', 'COMPLETE', 'RESCHEDULED']
    if (!validStatuses.includes(status)) {
      return NextResponse.json({ error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` }, { status: 400 })
    }

    const result = await notifyDeliveryStatusChange(deliveryId, status, { reason, newDate })

    if (!result) {
      return NextResponse.json({ error: 'Delivery not found or no notification configured for this status' }, { status: 404 })
    }

    // Generate voice alert for warehouse/driver (non-blocking)
    let voiceAlertUrl: string | null = null
    if (isElevenLabsConfigured()) {
      const statusMessages: Record<string, string> = {
        SCHEDULED: `Delivery ${deliveryId} is now scheduled.`,
        LOADING: `Loading has started for delivery ${deliveryId}. Please prepare the dock.`,
        IN_TRANSIT: `Delivery ${deliveryId} is now in transit.`,
        ARRIVED: `Delivery ${deliveryId} has arrived on site.`,
        COMPLETE: `Delivery ${deliveryId} is complete. All items confirmed.`,
        RESCHEDULED: `Delivery ${deliveryId} has been rescheduled${newDate ? ` to ${newDate}` : ''}.${reason ? ` Reason: ${reason}` : ''}`,
      }
      generateOpsAlert({ message: statusMessages[status] || `Delivery ${deliveryId} status: ${status}` })
        .then(r => { if ('error' in r) console.warn('[Delivery TTS]', r.error) })
        .catch(e => console.warn('[Delivery TTS] Failed:', e.message))
    }

    return safeJson({ success: true, notified: result.sent, status, voiceAlertGenerated: isElevenLabsConfigured() })
  } catch (error: any) {
    console.error('[Delivery Notify] Error:', error)
    return NextResponse.json({ error: 'Notification failed' }, { status: 500 })
  }
}
