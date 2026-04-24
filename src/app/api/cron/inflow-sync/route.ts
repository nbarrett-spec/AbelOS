/**
 * Cron: InFlow Inventory Sync
 *
 * Runs every 30 minutes during business hours (Mon-Fri 6am-6pm CT / 11am-11pm UTC)
 * - Syncs product catalog from InFlow
 * - Syncs inventory levels (on-hand, committed, available)
 * - Syncs purchase orders
 * - Syncs sales orders
 *
 * Each sync type logs to SyncLog and updates IntegrationConfig.lastSyncAt
 * Requires CRON_SECRET for auth
 */

export const dynamic = 'force-dynamic'
// Bumped from 300 → 800 (Vercel Pro ceiling is 900s). Product sync durations
// drifted from ~100s to ~280s over April 2026 as the InFlow catalog grew;
// adding inventory (~110s) + PO (~10s) + SO (~10s) sequentially pushed every
// run past the old 300s kill ceiling, which is why every CronRun row from
// 18:00 UTC onward looked like a TIMEOUT failure even though SyncLog showed
// SUCCESS. Budget-aware skipping below gives us a second line of defence.
export const maxDuration = 800

import { NextRequest, NextResponse } from 'next/server'
import {
  syncProducts as syncInflowProducts,
  syncInventory as syncInflowInventory,
  syncPurchaseOrders as syncInflowPurchaseOrders,
  syncSalesOrders as syncInflowSalesOrders,
} from '@/lib/integrations/inflow'
import { startCronRun, finishCronRun } from '@/lib/cron'

// Soft time budget (ms). After each sync phase, check remaining budget and
// skip the next phase if we're running hot — the skipped phase will run on
// the next hourly cron. Keeps us comfortably under Vercel's maxDuration so
// finishCronRun() can actually fire and CronRun doesn't go zombie.
const TIME_BUDGET_MS = 700_000

export async function GET(request: NextRequest) {
  // Verify cron secret
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const runId = await startCronRun('inflow-sync', 'schedule')
  const started = Date.now()

  try {
    const startTime = Date.now()
    const results: any[] = []
    const skipped: string[] = []

    // Budget gate — if fewer than `minMsNeeded` remain, skip this phase.
    const elapsed = () => Date.now() - startTime
    const budgetOkay = (minMsNeeded: number) => elapsed() + minMsNeeded < TIME_BUDGET_MS

    // 1. Products — creates/updates product records. Typically 200-300s.
    //    Always run: downstream phases depend on Product rows existing.
    const productResult = await syncInflowProducts()
    results.push(productResult)

    // 2. Inventory — updates quantities on existing products. Typically ~110s.
    //    Skip if we're already past budget; runs next hour.
    let inventoryResult: any = null
    if (budgetOkay(150_000)) {
      inventoryResult = await syncInflowInventory()
      results.push(inventoryResult)
    } else {
      skipped.push('inventory')
    }

    // 3. Purchase orders — ~10s, cheap.
    let poResult: any = null
    if (budgetOkay(30_000)) {
      poResult = await syncInflowPurchaseOrders()
      results.push(poResult)
    } else {
      skipped.push('purchaseOrders')
    }

    // 4. Sales orders — ~10s, cheap.
    let soResult: any = null
    if (budgetOkay(30_000)) {
      soResult = await syncInflowSalesOrders()
      results.push(soResult)
    } else {
      skipped.push('salesOrders')
    }

    const duration = Date.now() - startTime

    const summary = {
      totalProcessed: results.reduce((sum, r) => sum + (r.recordsProcessed || 0), 0),
      totalCreated: results.reduce((sum, r) => sum + (r.recordsCreated || 0), 0),
      totalUpdated: results.reduce((sum, r) => sum + (r.recordsUpdated || 0), 0),
      totalFailed: results.reduce((sum, r) => sum + (r.recordsFailed || 0), 0),
      anyFailures: results.some(r => r.status === 'FAILED'),
      skippedPhases: skipped,
    }

    const payload = {
      success: !summary.anyFailures,
      message: summary.anyFailures
        ? 'InFlow sync completed with errors'
        : skipped.length > 0
          ? `InFlow sync partial: skipped ${skipped.join(', ')} (time budget exceeded)`
          : 'InFlow sync completed successfully',
      duration_ms: duration,
      summary,
      results,
      timestamp: new Date().toISOString(),
    }
    await finishCronRun(runId, summary.anyFailures ? 'FAILURE' : 'SUCCESS', Date.now() - started, {
      result: payload,
      error: summary.anyFailures ? 'One or more InFlow sync operations failed' : undefined,
    })
    return NextResponse.json(payload)
  } catch (error) {
    console.error('[InFlow Sync] Error:', error)
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
