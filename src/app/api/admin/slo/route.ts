export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuthWithFallback } from '@/lib/api-auth'
import { computeAllSlos } from '@/lib/slo'

// ──────────────────────────────────────────────────────────────────────────
// GET /api/admin/slo — compute and return all SLO statuses.
//
// Each SLO queries the underlying observability tables (UptimeProbe,
// ClientError, ServerError) to compute current budget consumption over
// the configured rolling window. Computations run in parallel; a failure
// in one SLO returns status:'no_data' for that SLO without blocking the
// others.
//
// Response shape:
// {
//   slos: SloResult[],
//   meta: { computedAt, healthy, warning, critical, noData }
// }
// ──────────────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  try {
    const authError = await checkStaffAuthWithFallback(request)
    if (authError) return authError

    const slos = await computeAllSlos()

    const meta = {
      computedAt: new Date().toISOString(),
      total: slos.length,
      healthy: slos.filter((s) => s.status === 'healthy').length,
      warning: slos.filter((s) => s.status === 'warning').length,
      critical: slos.filter((s) => s.status === 'critical').length,
      noData: slos.filter((s) => s.status === 'no_data').length,
    }

    return NextResponse.json({ slos, meta })
  } catch (err: any) {
    console.error('GET /api/admin/slo error:', err)
    return NextResponse.json(
      { error: err?.message || 'Internal error' },
      { status: 500 }
    )
  }
}
