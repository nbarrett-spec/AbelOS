/**
 * GET /api/v1/engine/agent/pending
 * Returns the RED-lane commands awaiting approval.
 */

import { NextRequest, NextResponse } from 'next/server'
import { verifyEngineToken, forwardToNuc } from '@/lib/engine-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const auth = await verifyEngineToken(req)
  if (!auth.ok) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  try {
    const resp = await forwardToNuc('/agent/pending', { method: 'GET', timeoutMs: 10_000 })
    const body = await resp.json().catch(() => ({ pending: [] }))
    return NextResponse.json(body, { status: resp.status })
  } catch (e: any) {
    return NextResponse.json({ error: `NUC unreachable: ${e?.message || e}` }, { status: 502 })
  }
}
