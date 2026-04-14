export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'
import { runMrpProjection } from '@/lib/mrp'

/**
 * GET /api/ops/mrp/projection
 *
 * Time-phased inventory projection over a horizon (default 90 days).
 * Walks active jobs → BOM-expanded demand → daily consumption schedule,
 * intersected with on-hand and inbound POs.
 *
 * Query params:
 *   ?horizonDays=90       (7-365)
 *   ?leadBufferDays=3     (0-30, days before scheduledDate to need material on hand)
 *   ?productId=xxx        (filter to a single product, repeatable)
 *   ?includeQuiet=1       (also include products with zero demand+inbound)
 */
export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const { searchParams } = new URL(request.url)
    const horizonDays = parseInt(searchParams.get('horizonDays') || '90', 10)
    const leadBufferDays = parseInt(searchParams.get('leadBufferDays') || '3', 10)
    const productIds = searchParams.getAll('productId')
    const includeQuiet = searchParams.get('includeQuiet') === '1'

    const result = await runMrpProjection({
      horizonDays,
      leadBufferDays,
      productIds: productIds.length > 0 ? productIds : undefined,
      includeQuiet,
    })

    return NextResponse.json(result, {
      status: 200,
      headers: {
        'Cache-Control': 'private, max-age=60',
      },
    })
  } catch (error: any) {
    console.error('[mrp/projection] error:', error)
    return NextResponse.json(
      {
        error: 'Failed to compute MRP projection',
        details: String(error?.message || error),
      },
      { status: 500 }
    )
  }
}
