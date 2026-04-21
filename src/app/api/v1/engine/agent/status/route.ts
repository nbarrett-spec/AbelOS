/**
 * GET /api/v1/engine/agent/status
 * Relays to the NUC's /agent/status endpoint.
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
    const resp = await forwardToNuc('/agent/status', { method: 'GET', timeoutMs: 10_000 })
    const body = await resp.json().catch(() => ({}))
    return NextResponse.json(body, { status: resp.status })
  } catch (e: any) {
    return NextResponse.json({ error: `NUC unreachable: ${e?.message || e}` }, { status: 502 })
  }
}
