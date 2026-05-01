export const dynamic = 'force-dynamic'
export const maxDuration = 300

import { NextRequest, NextResponse } from 'next/server'
import { syncScheduleUpdates, syncPayments, syncOrders, getAllTenants } from '@/lib/integrations/hyphen'
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

  // Multi-tenant: pull every active HyphenTenant row. Falls back to the
  // legacy single IntegrationConfig row if the new HyphenTenant table is
  // empty or not yet migrated.
  const tenants = await getAllTenants()
  const runId = await startCronRun('hyphen-sync', 'schedule')
  const started = Date.now()

  if (tenants.length === 0) {
    // Previously: SUCCESS + skipped:true. That hid the config gap — Brookfield
    // had 0/72 orders syncing for weeks while /admin/crons showed all-green.
    // Treat "no enabled tenants" as a FAILURE: cron can't do its job, and the
    // cron-failure notifier will ping Nate so the gap surfaces. Once a tenant
    // gets seeded + syncEnabled=true (or all are deliberately disabled), this
    // resolves on the next run.
    const msg =
      'No Hyphen tenants enabled — sync is dead. Either set HYPHEN_<BUILDER>_USERNAME / _PASSWORD env vars + flip HyphenTenant.syncEnabled=true for that builder, or disable this cron in vercel.json if Hyphen is intentionally off.'
    await finishCronRun(runId, 'FAILURE', Date.now() - started, {
      result: { skipped: true, reason: 'NO_HYPHEN_CONFIG', message: msg },
      error: msg,
    })
    return NextResponse.json(
      { success: false, skipped: true, reason: 'NO_HYPHEN_CONFIG', message: msg },
      { status: 503 },
    )
  }

  try {
    // Per-tenant orchestration: run schedule/payments/orders for each tenant
    // sequentially per-sync-type. The lib functions handle per-tenant isolation
    // — one tenant failing does not poison the others. Aggregate counts come
    // back in the SyncResult shape.
    const errorsPerTenant: Record<string, string[]> = {}
    const succeededTenants = new Set<string>()
    const failedTenants = new Set<string>()

    const runForTenant = async (tenant: typeof tenants[number]) => {
      const label = tenant.builderName || tenant.tenantId || 'unknown'
      try {
        const [s, p, o] = await Promise.all([
          syncScheduleUpdates(tenant),
          syncPayments(tenant),
          syncOrders(tenant),
        ])
        const tenantErrors: string[] = []
        for (const r of [s, p, o]) {
          if (r.status === 'FAILED') tenantErrors.push(`${r.syncType}: ${r.errorMessage || 'unknown'}`)
        }
        if (tenantErrors.length > 0) {
          errorsPerTenant[label] = tenantErrors
          failedTenants.add(label)
        } else {
          succeededTenants.add(label)
        }
        return { tenant: label, schedule: s, payments: p, orders: o }
      } catch (err: any) {
        errorsPerTenant[label] = [err?.message || String(err)]
        failedTenants.add(label)
        return { tenant: label, error: err?.message || String(err) }
      }
    }

    const perTenantResults = await Promise.all(tenants.map(runForTenant))

    const tenantsProcessed = tenants.length
    const tenantsSucceeded = succeededTenants.size
    const tenantsFailed = failedTenants.size
    const allSuccess = tenantsFailed === 0

    const payload = {
      success: allSuccess,
      timestamp: new Date().toISOString(),
      tenants_processed: tenantsProcessed,
      tenants_succeeded: tenantsSucceeded,
      tenants_failed: tenantsFailed,
      errors_per_tenant: errorsPerTenant,
      results: perTenantResults,
    }

    // Surface tenant-by-tenant errors so /admin/crons shows the real failure.
    const failureSummary = allSuccess
      ? undefined
      : Object.entries(errorsPerTenant)
          .map(([t, errs]) => `${t}: ${errs.join('; ')}`)
          .join(' | ') || 'One or more tenant syncs FAILED'

    // Partial success (some tenants OK, some failed) → SUCCESS with details,
    // not FAILURE. /admin/crons should not red-flag the whole job because
    // Toll's creds expired while Brookfield + Shaddock kept ingesting.
    const cronStatus = allSuccess ? 'SUCCESS' : (tenantsSucceeded > 0 ? 'SUCCESS' : 'FAILURE')

    await finishCronRun(runId, cronStatus, Date.now() - started, {
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
