export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuthWithFallback } from '@/lib/api-auth'
import { getCronSummaries, getCronRuns, detectCronDrift } from '@/lib/cron'

// GET /api/admin/crons              → summary of all registered crons + drift
// GET /api/admin/crons?name=mrp-nightly → recent runs for one cron
export async function GET(request: NextRequest) {
  const authError = await checkStaffAuthWithFallback(request)
  if (authError) return authError

  const { searchParams } = new URL(request.url)
  const name = searchParams.get('name')
  const limit = Math.min(Number(searchParams.get('limit') || '25'), 100)

  try {
    if (name) {
      const runs = await getCronRuns(name, limit)
      return NextResponse.json({ name, runs })
    }

    const [summaries, drift] = await Promise.all([
      getCronSummaries(),
      detectCronDrift(),
    ])
    return NextResponse.json({ crons: summaries, drift })
  } catch (error: any) {
    console.error('[admin/crons] error:', error)
    return NextResponse.json({ error: error?.message || 'Failed to load cron data' }, { status: 500 })
  }
}
