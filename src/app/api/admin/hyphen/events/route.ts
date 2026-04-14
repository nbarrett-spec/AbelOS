export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'
import { listHyphenEvents } from '@/lib/hyphen/auth'

// GET /api/admin/hyphen/events?kind=order&status=RECEIVED&limit=50

export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  const { searchParams } = new URL(request.url)
  const kind = searchParams.get('kind') || undefined
  const status = searchParams.get('status') || undefined
  const limit = Math.min(Number(searchParams.get('limit') || '50'), 200)

  try {
    const events = await listHyphenEvents({ kind, status, limit })
    return NextResponse.json({ events })
  } catch (e: any) {
    console.error('[admin/hyphen/events] error:', e)
    return NextResponse.json({ error: e?.message || 'Failed to load events' }, { status: 500 })
  }
}
