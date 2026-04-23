export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'
import { getRecentEvents } from '@/lib/redis'

/**
 * GET /api/ops/stream/recent?limit=50
 * Returns the most recent live events (most-recent first).
 */
export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const limit = Math.min(
      200,
      Math.max(1, parseInt(request.nextUrl.searchParams.get('limit') || '50', 10))
    )
    const events = await getRecentEvents(limit)
    return NextResponse.json({ ok: true, events })
  } catch (error: any) {
    console.error('[Stream Recent] Error:', error)
    return NextResponse.json({ error: 'Failed to fetch events' }, { status: 500 })
  }
}
