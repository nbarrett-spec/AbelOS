/**
 * GET /api/integrations/nuc/health
 *
 * Health snapshot for the NUC brain engine (FastAPI at :8400/brain/*).
 *
 * IMPORTANT: This route ALWAYS returns HTTP 200, even when the NUC is
 * offline. That's by design — the NUC is a subsystem, not the Aegis app
 * itself, so a NUC outage should not page the uptime monitor pointed at
 * Aegis. Clients should key off the `ok` field in the body, not the
 * HTTP status.
 *
 * Auth: staff session required (checkStaffAuth). This endpoint leaks
 * engine version + per-module status, which we don't want exposed on
 * the public internet.
 */

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'
import { nucHealth } from '@/lib/nuc-bridge'

export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  const checkedAt = new Date().toISOString()
  const result = await nucHealth()

  if (!result.reachable) {
    return NextResponse.json({
      ok: false,
      error: result.error || 'NUC_OFFLINE',
      detail: result.detail,
      latencyMs: result.latencyMs,
      checkedAt,
      note:
        'NUC brain engine unreachable. Expected on Vercel/sandbox environments where the Tailscale IP 100.84.113.47 is not routable. Configure NUC_BRAIN_URL to a Tailscale-reachable proxy (e.g. Cloudflare Tunnel) to enable.',
    })
  }

  return NextResponse.json({
    ok: true,
    latencyMs: result.latencyMs,
    engineVersion: result.engineVersion,
    moduleStatus: result.moduleStatus,
    checkedAt,
  })
}
