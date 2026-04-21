import { NextRequest, NextResponse } from 'next/server'
import { verifyEngineToken } from '@/lib/engine-auth'
import { readSnapshot } from '@/lib/engine-snapshot'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const auth = await verifyEngineToken(req)
  if (!auth.ok) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const snap = await readSnapshot('calendar', 'health')
  return NextResponse.json({
    connected: snap.connected,
    last_sync: snap.fetched_at,
    stale: snap.stale,
    source: 'calendar',
  })
}
