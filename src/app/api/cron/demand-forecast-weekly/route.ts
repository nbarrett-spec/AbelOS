export const dynamic = 'force-dynamic'
export const maxDuration = 300

import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'
import { startCronRun, finishCronRun } from '@/lib/cron'
import { computeDemandForecast } from '@/lib/mrp/forecast'

/**
 * GET /api/cron/demand-forecast-weekly  — scheduled (CRON_SECRET)
 * POST /api/cron/demand-forecast-weekly — manual (staff auth)
 *
 * Runs Sunday 2 AM CT (0 7 * * 0 UTC). Recomputes the exponential-smoothing
 * demand forecast for every Product with ≥1 unit of historical demand in
 * the trailing 12 months, then:
 *
 *   • Upserts 3 months of DemandForecast rows per product
 *   • Raises InventoryItem.safetyStock to max(forecast × 0.5, current)
 *
 * Idempotent. Safe to re-run.
 */
export async function GET(request: NextRequest) {
  const cronSecret = request.headers.get('authorization')?.replace('Bearer ', '')
  const expected = process.env.CRON_SECRET
  if (!expected || cronSecret !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return runDemandForecastWeekly('schedule')
}

export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError
  return runDemandForecastWeekly('manual')
}

async function runDemandForecastWeekly(triggeredBy: 'schedule' | 'manual') {
  const runId = await startCronRun('demand-forecast-weekly', triggeredBy)
  const started = Date.now()
  try {
    const { summary } = await computeDemandForecast({ persist: true })
    await finishCronRun(
      runId,
      summary.errors.length > 0 && summary.productsProcessed === 0 ? 'FAILURE' : 'SUCCESS',
      Date.now() - started,
      {
        result: summary,
        error: summary.errors.length > 0 ? summary.errors.join('; ').slice(0, 3800) : undefined,
      }
    )
    return NextResponse.json(summary)
  } catch (err: any) {
    await finishCronRun(runId, 'FAILURE', Date.now() - started, {
      error: err?.message || String(err),
    })
    return NextResponse.json(
      { error: err?.message || 'demand-forecast failed' },
      { status: 500 }
    )
  }
}
