import { NextRequest, NextResponse } from 'next/server'
import { verifyEngineToken } from '@/lib/engine-auth'
import { readSnapshot } from '@/lib/engine-snapshot'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const auth = await verifyEngineToken(req)
  if (!auth.ok) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const url = new URL(req.url)
  const company = url.searchParams.get('company') || 'all'
  const snap = await readSnapshot('hubspot', `contacts:${company}`)
  return NextResponse.json(snap)
}
