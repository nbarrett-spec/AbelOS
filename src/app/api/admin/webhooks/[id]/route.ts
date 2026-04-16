export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuthWithFallback } from '@/lib/api-auth'
import {
  getWebhookPayload,
  incrementWebhookRetry,
  markWebhookProcessed,
  markWebhookFailed,
  resurrectWebhook,
} from '@/lib/webhook'
import { replayWebhookPayload } from '@/lib/webhooks/dispatcher'

// ──────────────────────────────────────────────────────────────────────────
// GET  /api/admin/webhooks/[id]             → full payload + status
// POST /api/admin/webhooks/[id]             → operator action
//   body: { action: 'replay' }              → re-run processor now
//   body: { action: 'resurrect' }           → flip DEAD_LETTER back to FAILED
// ──────────────────────────────────────────────────────────────────────────

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const authError = await checkStaffAuthWithFallback(request)
  if (authError) return authError

  try {
    const evt = await getWebhookPayload(params.id)
    if (!evt) {
      return NextResponse.json({ error: 'Event not found' }, { status: 404 })
    }
    return NextResponse.json({ event: evt })
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || 'Failed to load event' },
      { status: 500 }
    )
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const authError = await checkStaffAuthWithFallback(request)
  if (authError) return authError

  let body: any = {}
  try {
    body = await request.json()
  } catch {
    body = {}
  }
  const action = body.action

  try {
    if (action === 'resurrect') {
      const ok = await resurrectWebhook(params.id)
      if (!ok) {
        return NextResponse.json(
          { error: 'Unable to resurrect event (not found or wrong state)' },
          { status: 400 }
        )
      }
      return NextResponse.json({ success: true, action: 'resurrect' })
    }

    if (action === 'replay') {
      const evt = await getWebhookPayload(params.id)
      if (!evt) {
        return NextResponse.json({ error: 'Event not found' }, { status: 404 })
      }
      if (!evt.payload) {
        return NextResponse.json(
          { error: 'No stored payload — cannot replay this event' },
          { status: 400 }
        )
      }

      // Burn a retry slot before the attempt so a mid-replay crash still
      // counts. Matches the cron worker's behavior.
      await incrementWebhookRetry(params.id)

      try {
        await replayWebhookPayload(evt.provider, evt.payload)
        await markWebhookProcessed(params.id)
        return NextResponse.json({ success: true, action: 'replay', status: 'PROCESSED' })
      } catch (err: any) {
        await markWebhookFailed(params.id, err?.message || String(err))
        return NextResponse.json(
          {
            success: false,
            action: 'replay',
            error: err?.message || String(err),
          },
          { status: 200 } // 200 so the UI can display the failure gracefully
        )
      }
    }

    return NextResponse.json(
      { error: `Unknown action: ${action}` },
      { status: 400 }
    )
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || 'Action failed' },
      { status: 500 }
    )
  }
}
