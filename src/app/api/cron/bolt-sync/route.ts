/**
 * Cron: ECI Bolt Sync
 *
 * Runs every hour during business hours
 * - Syncs customers → Builder/BuilderOrganization
 * - Syncs orders → Order table
 * - Syncs work orders → Job table
 * - Syncs invoices → Invoice table
 *
 * Each sync type logs to SyncLog
 * Requires CRON_SECRET for auth
 */

export const dynamic = 'force-dynamic'
export const maxDuration = 300

import { NextRequest, NextResponse } from 'next/server'
import {
  syncCustomers,
  syncOrders,
  syncWorkOrders,
  syncInvoices,
} from '@/lib/integrations/bolt'
import { startCronRun, finishCronRun } from '@/lib/cron'

export async function GET(request: NextRequest) {
  // Verify cron secret
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const runId = await startCronRun('bolt-sync', 'schedule')
  const results: any[] = []
  const startedAt = Date.now()

  // 1. Sync customers first (needed for order/WO matching)
  try {
    const custResult = await syncCustomers()
    results.push({ type: 'customers', ...custResult })
  } catch (e: any) {
    results.push({ type: 'customers', status: 'FAILED', error: e?.message })
  }

  // 2. Sync orders
  try {
    const sinceDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) // last 7 days
    const orderResult = await syncOrders(sinceDate)
    results.push({ type: 'orders', ...orderResult })
  } catch (e: any) {
    results.push({ type: 'orders', status: 'FAILED', error: e?.message })
  }

  // 3. Sync work orders → Jobs
  try {
    const sinceDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
    const woResult = await syncWorkOrders(sinceDate)
    results.push({ type: 'work_orders', ...woResult })
  } catch (e: any) {
    results.push({ type: 'work_orders', status: 'FAILED', error: e?.message })
  }

  // 4. Sync invoices
  try {
    const sinceDate = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000) // last 14 days
    const invResult = await syncInvoices(sinceDate)
    results.push({ type: 'invoices', ...invResult })
  } catch (e: any) {
    results.push({ type: 'invoices', status: 'FAILED', error: e?.message })
  }

  const totalDuration = Date.now() - startedAt
  const hasErrors = results.some(r => r.status === 'FAILED')

  const payload = {
    success: !hasErrors,
    durationMs: totalDuration,
    results,
  }
  await finishCronRun(runId, hasErrors ? 'FAILURE' : 'SUCCESS', totalDuration, {
    result: payload,
    error: hasErrors ? results.filter(r => r.status === 'FAILED').map(r => `${r.type}: ${r.error}`).join('; ') : undefined,
  })
  return NextResponse.json(payload)
}
