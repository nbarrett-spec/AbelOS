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
export const maxDuration = 300

import { NextRequest, NextResponse } from 'next/server'
import {
  syncProducts as syncInflowProducts,
  syncInventory as syncInflowInventory,
  syncPurchaseOrders as syncInflowPurchaseOrders,
  syncSalesOrders as syncInflowSalesOrders,
} from '@/lib/integrations/inflow'
import { startCronRun, finishCronRun } from '@/lib/cron'

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
    // console.log('[InFlow Sync] Starting scheduled sync...')

    const startTime = Date.now()
    const results = []

    // Sync products first (creates/updates product records)
    // console.log('[InFlow Sync] Syncing products...')
    const productResult = await syncInflowProducts()
    results.push(productResult)

    // Sync inventory levels (updates quantities on existing products)
    // console.log('[InFlow Sync] Syncing inventory...')
    const inventoryResult = await syncInflowInventory()
    results.push(inventoryResult)

    // Sync purchase orders
    // console.log('[InFlow Sync] Syncing purchase orders...')
    const poResult = await syncInflowPurchaseOrders()
    results.push(poResult)

    // Sync sales orders
    // console.log('[InFlow Sync] Syncing sales orders...')
    const soResult = await syncInflowSalesOrders()
    results.push(soResult)

    const duration = Date.now() - startTime

    const summary = {
      totalProcessed: results.reduce((sum, r) => sum + (r.recordsProcessed || 0), 0),
      totalCreated: results.reduce((sum, r) => sum + (r.recordsCreated || 0), 0),
      totalUpdated: results.reduce((sum, r) => sum + (r.recordsUpdated || 0), 0),
      totalFailed: results.reduce((sum, r) => sum + (r.recordsFailed || 0), 0),
      anyFailures: results.some(r => r.status === 'FAILED'),
    }

    // console.log(
      `[InFlow Sync] Completed in ${duration}ms — ${summary.totalProcessed} records processed, ${summary.totalCreated} created, ${summary.totalUpdated} updated`
    )

    const payload = {
      success: !summary.anyFailures,
      message: summary.anyFailures
        ? 'InFlow sync completed with errors'
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
