export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'
import { audit } from '@/lib/audit'
import { sendDeliveryConfirmation } from '@/lib/email/delivery-confirmation'

/**
 * POST /api/ops/deliveries/[id]/send-confirmation
 *
 * Manually send (or re-send) the delivery confirmation email to the builder.
 *
 * The email is auto-sent from the delivery-complete cascade on the first
 * COMPLETE transition. This endpoint covers:
 *   - Resending if the builder asks ("didn't get it, spam filter")
 *   - Sending if the auto-cascade failed (Resend hiccup / no API key when
 *     the delivery was marked complete)
 *   - CC'ing extra recipients (super's personal email, community PM, etc.)
 *
 * Idempotency: the underlying sendDeliveryConfirmation() checks
 * Delivery.confirmationSentAt. A plain POST with no body returns
 * { sent: false, reason: 'already_sent' } once the confirmation is on file.
 * Pass `{ force: true }` (or any CC list) to override.
 *
 * Body (all optional):
 *   {
 *     ccEmails?: string[],  // additional recipients, same body as primary
 *     force?:    boolean,   // resend even when confirmationSentAt is set
 *   }
 *
 * Returns:
 *   { sent: true,  recipientEmails: ['builder@...', 'cc@...'], deliveryNumber }
 *   { sent: false, reason: 'already_sent' | 'no_builder_email' | ..., ... }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const body = await request.json().catch(() => ({}))
    const ccEmails: string[] = Array.isArray(body?.ccEmails) ? body.ccEmails : []
    // If CC recipients were supplied, implicitly force — the user is
    // explicitly asking to send right now. Otherwise require an explicit
    // `force: true` so a double-submitted button doesn't spam the builder.
    const force: boolean = body?.force === true || ccEmails.length > 0

    const result = await sendDeliveryConfirmation(params.id, { ccEmails, force })

    if (!result.sent) {
      // 404 on not_found, 409 on already_sent (idempotent "nothing to do"),
      // 422 on everything else (no builder email, Resend failure, etc.)
      const statusCode =
        result.reason === 'delivery_not_found'
          ? 404
          : result.reason === 'already_sent'
            ? 409
            : 422

      return NextResponse.json(
        {
          sent: false,
          reason: result.reason,
          recipientEmails: result.recipientEmails,
          alreadySentAt: result.alreadySentAt,
          deliveryNumber: result.deliveryNumber,
        },
        { status: statusCode },
      )
    }

    await audit(request, 'UPDATE', 'Delivery', params.id, {
      action: 'delivery_confirmation_sent',
      recipientEmails: result.recipientEmails,
      force,
      ccCount: ccEmails.length,
    })

    return NextResponse.json({
      sent: true,
      recipientEmails: result.recipientEmails,
      deliveryNumber: result.deliveryNumber,
    })
  } catch (err: any) {
    console.error('[send-confirmation] error', err)
    return NextResponse.json(
      { error: err?.message || 'failed' },
      { status: 500 },
    )
  }
}
