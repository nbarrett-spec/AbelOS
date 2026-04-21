/**
 * POST /api/v1/engine/agent/approve/[commandId]
 * Approves a queued RED-lane command on the NUC.
 */

import { NextRequest, NextResponse } from 'next/server'
import { verifyEngineToken, forwardToNuc } from '@/lib/engine-auth'
import { logAudit } from '@/lib/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(
  req: NextRequest,
  { params }: { params: { commandId: string } }
) {
  const auth = await verifyEngineToken(req)
  if (!auth.ok) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const { commandId } = params

  try {
    const resp = await forwardToNuc(`/agent/approve/${encodeURIComponent(commandId)}`, {
      method: 'POST',
      timeoutMs: 120_000,
    })
    const body = await resp.json().catch(() => ({}))

    await logAudit({
      staffId: 'nuc-engine-relay',
      staffName: auth.source,
      action: 'engine.command.approved',
      entity: 'NucCommand',
      entityId: commandId,
      severity: 'INFO',
      details: { status: body?.status, trust_lane: body?.trust_lane },
    }).catch(() => {})

    return NextResponse.json(body, { status: resp.status })
  } catch (e: any) {
    return NextResponse.json({ error: `NUC unreachable: ${e?.message || e}` }, { status: 502 })
  }
}
