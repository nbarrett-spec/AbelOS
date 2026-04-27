/**
 * Cron: ECI Bolt Sync — DISABLED 2026-04-23
 *
 * Disabled in vercel.json after 100% failure rate since 2026-04-21 02:30 UTC.
 * Root cause: no ECI_BOLT IntegrationConfig row (Abel is migrating off Bolt).
 * Decision tracked in InboxItem cmobj8d8000006bldzouh2hu3.
 *
 * Route kept intact in case Nate decides to re-enable — restore the vercel.json
 * entry and insert an IntegrationConfig row (provider=ECI_BOLT, status=CONNECTED,
 * apiKey, baseUrl, companyId) to turn back on.
 *
 * Runs every hour during business hours (when enabled)
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
  // DISABLED 2026-04-21 — Pulte account closed; Abel migrating off ECI Bolt.
  // De-registered from vercel.json same day. Route kept for re-enable path
  // (restore vercel.json entry + insert IntegrationConfig row). Until then we
  // short-circuit BEFORE auth so any stray caller (manual or stale schedule)
  // gets a clear 410 instead of running the sync logic.
  return NextResponse.json(
    {
      success: false,
      disabled: true,
      reason: 'ECI Bolt sync retired 2026-04-21 (Pulte account lost; migration off Bolt). Restore vercel.json entry and IntegrationConfig row to re-enable.',
    },
    { status: 410 },
  )

  // ──────────────────────────────────────────────────────────────────────
  // Original sync logic preserved below for reference. Unreachable while
  // the early return above is in place.
  // ──────────────────────────────────────────────────────────────────────
  // Verify cron secret
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Check if ECI Bolt is configured before burning a CronRun entry
  const boltConfig: any[] = await (await import('@/lib/prisma')).prisma.$queryRawUnsafe(
    `SELECT id FROM "IntegrationConfig" WHERE provider::text = 'ECI_BOLT' AND status::text = 'CONNECTED' LIMIT 1`
  )
  if (boltConfig.length === 0) {
    return NextResponse.json({
      success: true,
      skipped: true,
      message: 'ECI Bolt not configured — skipping sync. Add IntegrationConfig with provider=ECI_BOLT to enable.',
    })
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

  // 2. Sync orders — look back 30 days to catch status updates on older orders
  try {
    const sinceDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) // last 30 days
    const orderResult = await syncOrders(sinceDate)
    results.push({ type: 'orders', ...orderResult })
  } catch (e: any) {
    results.push({ type: 'orders', status: 'FAILED', error: e?.message })
  }

  // 3. Sync work orders → Jobs — 30 day lookback for job status changes
  try {
    const sinceDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) // last 30 days
    const woResult = await syncWorkOrders(sinceDate)
    results.push({ type: 'work_orders', ...woResult })
  } catch (e: any) {
    results.push({ type: 'work_orders', status: 'FAILED', error: e?.message })
  }

  // 4. Sync invoices — 60 day lookback to catch payment updates on aging invoices
  try {
    const sinceDate = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000) // last 60 days
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
    error: hasErrors ? results.filter(r => r.status === 'FAILED').map(r => `${r.type}: ${r.errorMessage || r.error || 'unknown'}`).join('; ') : undefined,
  })
  return NextResponse.json(payload)
}
