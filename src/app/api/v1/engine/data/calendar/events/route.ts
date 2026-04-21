import { NextRequest, NextResponse } from 'next/server'
import { verifyEngineToken } from '@/lib/engine-auth'
import { readSnapshot } from '@/lib/engine-snapshot'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const auth = await verifyEngineToken(req)
  if (!auth.ok) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => ({}))
  const daysAhead = Number(body?.daysAhead ?? 30)
  const snap = await readSnapshot('calendar', `list_events:${daysAhead}d`)
  return NextResponse.json(snap)
}
