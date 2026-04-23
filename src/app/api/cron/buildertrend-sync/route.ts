/**
 * Cron: BuilderTrend Sync
 *
 * Runs every 2 hours at :15. Pulls schedule items and material selections
 * (which also creates decision notes for new selections) from BuilderTrend
 * and mirrors them into Aegis.
 *
 * - Schedule items   → ScheduleEntry rows linked to Job via BTProjectMapping
 * - Material selections → DecisionNote rows for operator review
 *
 * BuilderTrend configuration lives in IntegrationConfig row (provider=BUILDERTREND).
 * If the integration is not configured, returns 200 with {skipped: true}.
 *
 * Requires CRON_SECRET for auth.
 */

export const dynamic = 'force-dynamic'
export const maxDuration = 300

import { NextRequest, NextResponse } from 'next/server'
import {
  syncSchedules as syncBtSchedules,
  syncMaterialSelections as syncBtMaterialSelections,
  getBuilderTrendConfig,
} from '@/lib/integrations/buildertrend'
import { startCronRun, finishCronRun } from '@/lib/cron'

export async function GET(request: NextRequest) {
  // Verify cron secret
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const runId = await startCronRun('buildertrend-sync', 'schedule')
  const started = Date.now()

  try {
    // Short-circuit if not configured — don't flap as FAILURE on /admin/crons
    const config = await getBuilderTrendConfig()
    if (!config) {
      const payload = {
        skipped: true,
        reason: 'not_configured',
        message: 'BuilderTrend IntegrationConfig missing or incomplete (apiKey/apiSecret/baseUrl).',
        timestamp: new Date().toISOString(),
      }
      await finishCronRun(runId, 'SUCCESS', Date.now() - started, { result: payload })
      return NextResponse.json(payload, { status: 200 })
    }

    const results = []

    // Schedule items (also updates ScheduleEntry rows in place)
    // This covers "schedule items" AND serves as the upstream notification
    // path — decision notes are produced inline by syncMaterialSelections.
    const scheduleResult = await syncBtSchedules()
    results.push(scheduleResult)

    // Material selections (also creates DecisionNote rows = our "decision notes")
    const materialsResult = await syncBtMaterialSelections()
    results.push(materialsResult)

    const summary = {
      totalProcessed: results.reduce((sum, r) => sum + (r.recordsProcessed || 0), 0),
      totalCreated: results.reduce((sum, r) => sum + (r.recordsCreated || 0), 0),
      totalUpdated: results.reduce((sum, r) => sum + (r.recordsUpdated || 0), 0),
      totalSkipped: results.reduce((sum, r) => sum + (r.recordsSkipped || 0), 0),
      totalFailed: results.reduce((sum, r) => sum + (r.recordsFailed || 0), 0),
      anyFailures: results.some(r => r.status === 'FAILED'),
    }

    const payload = {
      success: !summary.anyFailures,
      message: summary.anyFailures
        ? 'BuilderTrend sync completed with errors'
        : 'BuilderTrend sync completed successfully',
      duration_ms: Date.now() - started,
      summary,
      results,
      timestamp: new Date().toISOString(),
    }

    await finishCronRun(
      runId,
      summary.anyFailures ? 'FAILURE' : 'SUCCESS',
      Date.now() - started,
      {
        result: payload,
        error: summary.anyFailures ? 'One or more BuilderTrend sync operations failed' : undefined,
      }
    )

    return NextResponse.json(payload)
  } catch (error) {
    console.error('[BuilderTrend Sync] Error:', error)
    await finishCronRun(runId, 'FAILURE', Date.now() - started, {
      error: error instanceof Error ? error.message : String(error),
    })
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    )
  }
}
