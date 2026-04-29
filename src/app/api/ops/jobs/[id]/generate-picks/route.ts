export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'
import { audit } from '@/lib/audit'
import { generatePicksForJob } from '@/lib/mrp/auto-pick'

/**
 * POST /api/ops/jobs/[id]/generate-picks
 *
 * Manually trigger pick generation for a job. Called when a job transitions to
 * READINESS_CHECK or MATERIALS_LOCKED (and is called from job lifecycle),
 * but staff can also request it manually via this endpoint.
 *
 * Returns: { jobId, picksGenerated, skipped, reason? }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const { id } = params
    const staffId = request.headers.get('x-staff-id') || 'system'

    const result = await generatePicksForJob(id)

    // Audit the action
    await audit(request, 'CREATE', 'MaterialPick', id, {
      action: 'auto-generate-picks',
      picksGenerated: result.picksGenerated,
    }).catch(() => {})

    return NextResponse.json(result)
  } catch (error: any) {
    console.error(`[POST /api/ops/jobs/[id]/generate-picks] error:`, error)
    return NextResponse.json(
      { error: error?.message || 'Failed to generate picks' },
      { status: 500 }
    )
  }
}
