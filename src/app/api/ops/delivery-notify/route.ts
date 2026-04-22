export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'
import { notifyDeliveryStatusChange } from '@/lib/notifications'
import { safeJson } from '@/lib/safe-json'
import { audit } from '@/lib/audit'

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

    return safeJson({ success: true, notified: result.sent, status })
  } catch (error: any) {
    console.error('[Delivery Notify] Error:', error)
    return NextResponse.json({ error: 'Notification failed' }, { status: 500 })
  }
}
