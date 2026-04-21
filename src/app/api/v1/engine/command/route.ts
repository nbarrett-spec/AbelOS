/**
 * POST /api/v1/engine/command
 * Relays a typed command to the NUC coordinator's /agent/command endpoint.
 * Adds audit logging and enforces bearer auth on the inbound side.
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

  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 })
  }

  const commandType = body?.command_type || 'unknown'
  const timeoutMs = Math.min(
    Math.max((body?.timeout_seconds ?? 60) * 1000 + 5000, 10_000),
    305_000
  )

  try {
    const resp = await forwardToNuc('/agent/command', {
      method: 'POST',
      body: JSON.stringify(body),
      timeoutMs,
    })
    const result = await resp.json().catch(() => ({ error: 'non-json response' }))

    await logAudit({
      staffId: 'nuc-engine-relay',
      staffName: auth.source,
      action: `engine.command.${commandType}`,
      entity: 'NucCommand',
      entityId: result?.command_id,
      details: {
        source: body?.source || 'relay',
        trust_lane: result?.trust_lane,
        status: result?.status,
      },
    }).catch(() => {})

    return NextResponse.json(result, { status: resp.status })
  } catch (e: any) {
    await logAudit({
      staffId: 'nuc-engine-relay',
      action: `engine.command.${commandType}.failed`,
      entity: 'NucCommand',
      severity: 'WARN',
      details: { error: String(e?.message || e) },
    }).catch(() => {})
    return NextResponse.json(
      { error: `NUC unreachable: ${e?.message || e}`, trust_lane: 'unknown' },
      { status: 502 }
    )
  }
}
