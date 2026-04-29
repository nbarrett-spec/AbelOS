export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'
import { audit } from '@/lib/audit'
import { autoAllocateJob } from '@/lib/mrp/auto-allocate'

/**
 * POST /api/ops/jobs/[id]/auto-allocate
 * Trigger auto-allocation for a job (normally called automatically when orderId is set).
 * Useful for manual retry or re-trigger.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const { id } = params

    // Execute auto-allocation
    const result = await autoAllocateJob(id)

    // Audit log the manual trigger
    await audit(request, 'CREATE', 'InventoryAllocation', id, {
      action: 'manual_auto_allocate_trigger',
      result,
    }).catch((e) => console.warn('Audit logging failed:', e))

    return NextResponse.json(result, { status: 200 })
  } catch (error) {
    console.error('[auto-allocate] Endpoint error:', error)
    return NextResponse.json(
      { error: 'Auto-allocation failed', details: String(error) },
      { status: 500 }
    )
  }
}
