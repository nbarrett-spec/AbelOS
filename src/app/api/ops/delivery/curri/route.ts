/**
 * Curri Delivery Integration — DEFERRED (2026-04-22)
 *
 * The Curri API integration was never wired. In-house drivers handle all
 * deliveries. This route is now a deliberate no-op:
 *   GET  → 200 with a "not integrated" payload (so dashboards that poll
 *          it don't throw).
 *   POST → 501 Not Implemented.
 *
 * See memory/projects/delivery-partners.md for re-evaluation criteria.
 */

export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'

export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  return NextResponse.json({
    integrated: false,
    provider: 'CURRI',
    deliveries: [],
    comparison: {
      inHouse: { count: 0, avgCost: 0, delivered: 0, active: 0 },
      curri: { count: 0, avgCost: 0, delivered: 0, active: 0 },
    },
    curriConfigured: false,
    message:
      'Curri integration deferred. In-house drivers handle all deliveries. ' +
      'See memory/projects/delivery-partners.md.',
  })
}

export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  return NextResponse.json(
    {
      error: 'Not Implemented',
      integrated: false,
      message:
        'Curri booking endpoint is deferred. Book deliveries through the ' +
        'in-house dispatch flow at /ops/delivery.',
    },
    { status: 501 }
  )
}
