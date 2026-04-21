import { NextRequest, NextResponse } from 'next/server'
import { verifyEngineToken } from '@/lib/engine-auth'
import { readSnapshot } from '@/lib/engine-snapshot'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const auth = await verifyEngineToken(req)
  if (!auth.ok) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => ({}))
  const method = `search_threads:${body?.query ?? ''}`
  const snap = await readSnapshot('gmail', method)
  return NextResponse.json(snap)
}

export async function GET(req: NextRequest) {
  const auth = await verifyEngineToken(req)
  if (!auth.ok) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const url = new URL(req.url)
  const threadId = url.searchParams.get('threadId') || ''
  const snap = await readSnapshot('gmail', `get_thread:${threadId}`)
  return NextResponse.json(snap)
}
