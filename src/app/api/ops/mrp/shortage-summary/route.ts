export const dynamic = 'force-dynamic'

import { NextRequest } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'
import { safeJson } from '@/lib/safe-json'
import { computeShortageSummary } from '@/lib/mrp/atp'

/**
 * GET /api/ops/mrp/shortage-summary
 *
 * Returns a quick ATP shortage rollup for admin / system-health panels:
 *   { activeRed, activeAmber, activeGreen, totalShortageValue, jobsAtRisk }
 *
 * Heavy read — do not poll aggressively.
 */
export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const summary = await computeShortageSummary()
    return safeJson({ asOf: new Date().toISOString(), ...summary })
  } catch (error: any) {
    return safeJson(
      { error: 'Failed to compute shortage summary', details: error?.message || String(error) },
      { status: 500 }
    )
  }
}
