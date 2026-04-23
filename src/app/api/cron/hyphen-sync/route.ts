export const dynamic = 'force-dynamic'
export const maxDuration = 300

import { NextRequest, NextResponse } from 'next/server'
import { syncScheduleUpdates, syncPayments, syncOrders } from '@/lib/integrations/hyphen'
import { startCronRun, finishCronRun } from '@/lib/cron'

// Note: vercel.json schedules this as GET, older code used POST. Both work.
async function handle(request: NextRequest) {
  // Verify CRON_SECRET bearer auth
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET

  if (!cronSecret) {
    console.error('CRON_SECRET not configured')
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 })
  }

  if (!authHeader || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Check if Hyphen is configured. Record the CronRun either way so the
  // /ops/crons observability page doesn't flag the job as stale/dead when
  // it's intentionally short-circuiting on missing credentials.
  //
  // Pre-check must match what lib/integrations/hyphen.ts::getConfig() actually
  // requires (status=CONNECTED AND apiKey AND baseUrl) — otherwise a half-
  // configured row makes the three sync funcs each return FAILED, which the
  // cron surfaces as the unhelpful "One or more sync operations FAILED".
  const hyphenConfig: any[] = await (await import('@/lib/prisma')).prisma.$queryRawUnsafe(
    `SELECT id,
            ("apiKey" IS NOT NULL AND "apiKey" <> '')   AS has_api_key,
            ("baseUrl" IS NOT NULL AND "baseUrl" <> '') AS has_base_url
     FROM "IntegrationConfig"
     WHERE provider::text = 'HYPHEN' AND status::text = 'CONNECTED' LIMIT 1`
  )
  const runId = await startCronRun('hyphen-sync', 'schedule')
  const started = Date.now()

  if (hyphenConfig.length === 0) {
    const msg = 'Hyphen not configured — skipping sync. Add IntegrationConfig with provider=HYPHEN to enable.'
    await finishCronRun(runId, 'SUCCESS', Date.now() - started, {
      result: { skipped: true, reason: 'NO_HYPHEN_CONFIG', message: msg },
    })
    return NextResponse.json({ success: true, skipped: true, message: msg })
  }

  // CONNECTED row exists but credentials incomplete — surface clearly rather
  // than letting each of the three syncs fail with the generic error.
  const cfgRow = hyphenConfig[0]
  if (!cfgRow.has_api_key || !cfgRow.has_base_url) {
    const missing = [
      !cfgRow.has_api_key ? 'apiKey' : null,
      !cfgRow.has_base_url ? 'baseUrl' : null,
    ].filter(Boolean).join(', ')
    const msg = `Hyphen IntegrationConfig is CONNECTED but missing: ${missing}. Update the row and re-test the connection.`
    await finishCronRun(runId, 'SUCCESS', Date.now() - started, {
      result: { skipped: true, reason: 'HYPHEN_CONFIG_INCOMPLETE', missing, message: msg },
    })
    return NextResponse.json({ success: true, skipped: true, message: msg })
  }

  try {
    // Execute all three sync operations
    const [scheduleResult, paymentsResult, ordersResult] = await Promise.all([
      syncScheduleUpdates(),
      syncPayments(),
      syncOrders(),
    ])

    const allSuccess = [scheduleResult, paymentsResult, ordersResult].every(r => r.status !== 'FAILED')

    const payload = {
      success: allSuccess,
      timestamp: new Date().toISOString(),
      results: {
        scheduleUpdates: scheduleResult,
        payments: paymentsResult,
        orders: ordersResult,
      },
    }

    // Surface the actual sync errorMessage(s) on failure instead of the
    // generic "One or more sync operations FAILED" — otherwise /admin/crons
    // shows a useless error and whoever's on-call has to dig through JSON.
    const failureSummary = allSuccess ? undefined : [scheduleResult, paymentsResult, ordersResult]
      .filter(r => r.status === 'FAILED')
      .map(r => `${r.syncType}: ${r.errorMessage || 'unknown'}`)
      .join(' | ') || 'One or more sync operations FAILED'

    await finishCronRun(runId, allSuccess ? 'SUCCESS' : 'FAILURE', Date.now() - started, {
      result: payload,
      error: failureSummary,
    })
    return NextResponse.json(payload, { status: allSuccess ? 200 : 207 })
  } catch (error: any) {
    console.error('Hyphen cron sync error:', error)
    await finishCronRun(runId, 'FAILURE', Date.now() - started, { error: error?.message || String(error) })
    return NextResponse.json(
      {
        success: false,
        timestamp: new Date().toISOString(),
        error: error.message,
      },
      { status: 500 }
    )
  }
}

export async function GET(request: NextRequest) { return handle(request) }
export async function POST(request: NextRequest) { return handle(request) }
