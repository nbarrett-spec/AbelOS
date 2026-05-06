export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuthWithFallback } from '@/lib/api-auth'
import { getCronSummaries, getCronRuns, detectCronDrift } from '@/lib/cron'
import {
  enrichSummariesWithHealth,
  getRecentSyncLogs,
  CRON_TO_INTEGRATION_PROVIDER,
  triggerCronByName,
} from '@/lib/cron-health'

// GET  /api/ops/admin/crons              → summary of all registered crons + drift + health
// GET  /api/ops/admin/crons?name=mrp-nightly → recent runs + sync logs for one cron
// POST /api/ops/admin/crons { name }     → manually trigger a cron (ADMIN only)
//
// (POST is also exposed at /api/ops/admin/crons/[name]/trigger for routing
// preference — both paths share the same trigger logic.)
//
// Auth note: route is gated to ADMIN via API_ACCESS in src/lib/permissions.ts.
// The Run-now POST proxies to /api/cron/<name> with the CRON_SECRET so it
// exercises the exact same code path Vercel's scheduler hits — works for
// every cron uniformly without needing each route to expose its own
// staff-auth POST handler.

export async function GET(request: NextRequest) {
  const authError = await checkStaffAuthWithFallback(request)
  if (authError) return authError

  const { searchParams } = new URL(request.url)
  const name = searchParams.get('name')
  const limit = Math.min(Number(searchParams.get('limit') || '25'), 100)

  try {
    if (name) {
      // Detail mode: recent CronRun rows + SyncLog rows (if mapped) + the
      // integration provider name for click-through to integrations-freshness.
      const [runs, syncLogs] = await Promise.all([
        getCronRuns(name, limit),
        getRecentSyncLogs(name, Math.min(limit, 25)),
      ])
      return NextResponse.json({
        name,
        runs,
        syncLogs,
        integrationProvider: CRON_TO_INTEGRATION_PROVIDER[name] ?? null,
      })
    }

    const [summaries, drift] = await Promise.all([
      getCronSummaries(),
      detectCronDrift(),
    ])
    const enriched = await enrichSummariesWithHealth(summaries)
    return NextResponse.json({ crons: enriched, drift })
  } catch (error: any) {
    console.error('[ops/admin/crons] error:', error)
    return NextResponse.json({ error: error?.message || 'Failed to load cron data' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const authError = await checkStaffAuthWithFallback(request)
  if (authError) return authError

  let body: any = null
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const name = String(body?.name || '').trim()
  return triggerCronByName(request, name)
}
