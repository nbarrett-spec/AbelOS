export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuthWithFallback } from '@/lib/api-auth'
import { getHyphenEventPayload, reprocessHyphenOrderEvent } from '@/lib/hyphen/processor'

// ──────────────────────────────────────────────────────────────────────────
// GET  /api/admin/hyphen/events/[id]        → full payload + status
// POST /api/admin/hyphen/events/[id]        → reprocess action
//                                             (body: { action: 'reprocess' })
//
// Used by the /admin/hyphen "View Payload" modal and "Reprocess" button.
// ──────────────────────────────────────────────────────────────────────────

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const authError = await checkStaffAuthWithFallback(request)
  if (authError) return authError

  try {
    const event = await getHyphenEventPayload(params.id)
    if (!event) {
      return NextResponse.json({ error: 'Event not found' }, { status: 404 })
    }
    return NextResponse.json({ event })
  } catch (e: any) {
    console.error('[admin/hyphen/events/:id GET] error:', e)
    return NextResponse.json({ error: e?.message || 'Failed to load event' }, { status: 500 })
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
    // empty body is OK — default to reprocess
  }
  const action = body?.action || 'reprocess'

  if (action !== 'reprocess') {
    return NextResponse.json({ error: `Unknown action "${action}"` }, { status: 400 })
  }

  try {
    const result = await reprocessHyphenOrderEvent(params.id)
    return NextResponse.json({ result })
  } catch (e: any) {
    console.error('[admin/hyphen/events/:id POST] error:', e)
    return NextResponse.json({ error: e?.message || 'Failed to reprocess event' }, { status: 500 })
  }
}
