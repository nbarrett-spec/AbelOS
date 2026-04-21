/**
 * POST /api/v1/engine/chat
 * Natural-language chat with the NUC's command agent. Uses a longer timeout
 * because Claude responses take up to ~60s.
 */

import { NextRequest, NextResponse } from 'next/server'
import { verifyEngineToken, forwardToNuc } from '@/lib/engine-auth'
import { logAudit } from '@/lib/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const auth = await verifyEngineToken(req)
  if (!auth.ok) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const body = await req.json().catch(() => null)
  if (!body || typeof body.message !== 'string') {
    return NextResponse.json({ error: 'message required' }, { status: 400 })
  }

  try {
    const resp = await forwardToNuc('/agent/chat', {
      method: 'POST',
      body: JSON.stringify(body),
      timeoutMs: 120_000,
    })
    const result = await resp.json().catch(() => ({ error: 'non-json response' }))

    await logAudit({
      staffId: 'nuc-engine-relay',
      staffName: auth.source,
      action: 'engine.chat',
      entity: 'NucChat',
      entityId: result?.conversation_id,
      details: {
        message_length: body.message.length,
        has_error: Boolean(result?.error),
      },
    }).catch(() => {})

    return NextResponse.json(result, { status: resp.status })
  } catch (e: any) {
    return NextResponse.json(
      { error: `NUC unreachable: ${e?.message || e}` },
      { status: 502 }
    )
  }
}
