export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuthWithFallback } from '@/lib/api-auth'
import { audit } from '@/lib/audit'

/**
 * GET /api/ops/sync-health
 * Returns comprehensive sync health data:
 * - Integration configs + status
 * - Last sync per provider/type with staleness indicators
 * - Recent sync errors
 * - CronRun history for sync crons
 * - Record counts per major table
 */
export async function GET(request: NextRequest) {
  const authError = await checkStaffAuthWithFallback(request)
  if (authError) return authError

  try {
    // 1. Integration configs
    const integrations: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        provider::text as provider,
        name,
        status::text as status,
        "syncEnabled",
        "lastSyncAt",
        "lastSyncStatus",
        "baseUrl",
        "companyId",
        "createdAt",
        "updatedAt"
      FROM "IntegrationConfig"
      ORDER BY provider
    `)

    // 2. Latest sync per provider+type
    const latestSyncs: any[] = await prisma.$queryRawUnsafe(`
      SELECT DISTINCT ON (provider, "syncType")
        provider,
        "syncType",
        direction,
        status,
        "recordsProcessed",
        "recordsCreated",
        "recordsUpdated",
        "recordsSkipped",
        "recordsFailed",
        "errorMessage",
        "startedAt",
        "completedAt",
        "durationMs"
      FROM "SyncLog"
      ORDER BY provider, "syncType", "completedAt" DESC
    `)

    // 3. Recent failed syncs (last 50)
    const recentErrors: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        provider,
        "syncType",
        status,
        "errorMessage",
        "recordsFailed",
        "completedAt",
        "durationMs"
      FROM "SyncLog"
      WHERE status IN ('FAILED', 'PARTIAL')
      ORDER BY "completedAt" DESC
      LIMIT 50
    `)

    // 4. Sync volume last 24h / 7d
    const syncVolume24h: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        provider,
        "syncType",
        COUNT(*) as run_count,
        SUM("recordsProcessed")::int as total_processed,
        SUM("recordsCreated")::int as total_created,
        SUM("recordsUpdated")::int as total_updated,
        SUM("recordsFailed")::int as total_failed,
        COUNT(*) FILTER (WHERE status = 'FAILED') as failed_runs,
        AVG("durationMs")::int as avg_duration_ms
      FROM "SyncLog"
      WHERE "completedAt" >= NOW() - INTERVAL '24 hours'
      GROUP BY provider, "syncType"
      ORDER BY provider, "syncType"
    `)

    const syncVolume7d: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        provider,
        "syncType",
        COUNT(*) as run_count,
        SUM("recordsProcessed")::int as total_processed,
        SUM("recordsFailed")::int as total_failed,
        COUNT(*) FILTER (WHERE status = 'FAILED') as failed_runs
      FROM "SyncLog"
      WHERE "completedAt" >= NOW() - INTERVAL '7 days'
      GROUP BY provider, "syncType"
      ORDER BY provider, "syncType"
    `)

    // 5. CronRun history for sync crons (last 20 per cron)
    const cronRuns: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        "cronName",
        status,
        "startedAt",
        "endedAt",
        "durationMs",
        error,
        "triggeredBy"
      FROM "CronRun"
      WHERE "cronName" IN ('inflow-sync', 'bolt-sync', 'hyphen-sync', 'bpw-sync', 'gmail-sync')
      ORDER BY "startedAt" DESC
      LIMIT 100
    `)

    // 6. Record counts for major tables
    const tableCounts: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        (SELECT COUNT(*)::int FROM "Product") as products,
        (SELECT COUNT(*)::int FROM "Product" WHERE active = true) as active_products,
        (SELECT COUNT(*)::int FROM "InventoryItem") as inventory_items,
        (SELECT COUNT(*)::int FROM "Order") as orders,
        (SELECT COUNT(*)::int FROM "Order" WHERE status NOT IN ('COMPLETE', 'CANCELLED')) as open_orders,
        (SELECT COUNT(*)::int FROM "Job") as jobs,
        (SELECT COUNT(*)::int FROM "Job" WHERE status NOT IN ('COMPLETE', 'CANCELLED')) as active_jobs,
        (SELECT COUNT(*)::int FROM "Invoice") as invoices,
        (SELECT COUNT(*)::int FROM "Invoice" WHERE status NOT IN ('PAID', 'VOIDED', 'CANCELLED')) as open_invoices,
        (SELECT COUNT(*)::int FROM "PurchaseOrder") as purchase_orders,
        (SELECT COUNT(*)::int FROM "PurchaseOrder" WHERE status NOT IN ('RECEIVED', 'CANCELLED')) as open_pos,
        (SELECT COUNT(*)::int FROM "Builder") as builders,
        (SELECT COUNT(*)::int FROM "Vendor") as vendors,
        (SELECT COUNT(*)::int FROM "BuilderOrganization") as builder_orgs
    `)

    // 7. Staleness check — when was each table last updated?
    const staleness: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        (SELECT MAX("updatedAt") FROM "Product") as products_last_updated,
        (SELECT MAX("updatedAt") FROM "InventoryItem") as inventory_last_updated,
        (SELECT MAX("updatedAt") FROM "Order") as orders_last_updated,
        (SELECT MAX("updatedAt") FROM "Job") as jobs_last_updated,
        (SELECT MAX("updatedAt") FROM "Invoice") as invoices_last_updated,
        (SELECT MAX("updatedAt") FROM "PurchaseOrder") as pos_last_updated,
        (SELECT MAX("updatedAt") FROM "Builder") as builders_last_updated
    `)

    // 8. Products with no inventory record (orphaned from sync)
    const orphanedProducts: any[] = await prisma.$queryRawUnsafe(`
      SELECT COUNT(*)::int as count
      FROM "Product" p
      WHERE p.active = true
        AND NOT EXISTS (SELECT 1 FROM "InventoryItem" i WHERE i."productId" = p.id)
    `)

    // 9. Products synced from InFlow vs manual
    const productSources: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        COUNT(*)::int FILTER (WHERE "inflowId" IS NOT NULL) as from_inflow,
        COUNT(*)::int FILTER (WHERE "inflowId" IS NULL) as manual,
        COUNT(*)::int as total
      FROM "Product"
      WHERE active = true
    `)

    // 10. Orders by source
    const orderSources: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        COUNT(*)::int FILTER (WHERE "inflowOrderId" IS NOT NULL) as from_inflow,
        COUNT(*)::int FILTER (WHERE "inflowOrderId" IS NULL) as manual_or_bolt,
        COUNT(*)::int as total
      FROM "Order"
    `)

    // Build staleness indicators
    const now = new Date()
    const staleThresholds = {
      products: 2 * 60 * 60 * 1000,      // 2 hours
      inventory: 2 * 60 * 60 * 1000,     // 2 hours
      orders: 2 * 60 * 60 * 1000,        // 2 hours
      jobs: 2 * 60 * 60 * 1000,          // 2 hours
      invoices: 24 * 60 * 60 * 1000,     // 24 hours
      pos: 2 * 60 * 60 * 1000,           // 2 hours
    }

    const s = staleness[0] || {}
    const stalenessReport: Record<string, any> = {}
    for (const [key, threshold] of Object.entries(staleThresholds)) {
      const lastUpdated = s[`${key}_last_updated`] || s[`${key.slice(0, -1)}_last_updated`]
      if (lastUpdated) {
        const age = now.getTime() - new Date(lastUpdated).getTime()
        stalenessReport[key] = {
          lastUpdated,
          ageMs: age,
          ageHuman: formatAge(age),
          isStale: age > threshold,
          threshold: formatAge(threshold),
        }
      } else {
        stalenessReport[key] = {
          lastUpdated: null,
          ageMs: null,
          ageHuman: 'Never synced',
          isStale: true,
          threshold: formatAge(threshold),
        }
      }
    }

    return NextResponse.json({
      integrations,
      latestSyncs,
      recentErrors,
      syncVolume: { last24h: syncVolume24h, last7d: syncVolume7d },
      cronRuns: groupBy(cronRuns, 'cronName'),
      tableCounts: tableCounts[0] || {},
      staleness: stalenessReport,
      orphanedProducts: orphanedProducts[0]?.count || 0,
      dataSources: {
        products: productSources[0] || {},
        orders: orderSources[0] || {},
      },
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    console.error('Error fetching sync health:', error)
    return NextResponse.json(
      { error: 'Failed to fetch sync health data' },
      { status: 500 }
    )
  }
}

/**
 * POST /api/ops/sync-health
 * Trigger a manual sync for a specific provider
 * Body: { provider: 'inflow' | 'bolt' | 'hyphen' | 'bpw', syncType?: string }
 */
export async function POST(request: NextRequest) {
  const authError = await checkStaffAuthWithFallback(request)
  if (authError) return authError

  try {
    const body = await request.json()
    const { provider } = body

    if (!provider) {
      return NextResponse.json({ error: 'provider is required' }, { status: 400 })
    }

    const cronMap: Record<string, string> = {
      inflow: '/api/cron/inflow-sync',
      bolt: '/api/cron/bolt-sync',
      hyphen: '/api/cron/hyphen-sync',
      bpw: '/api/cron/bpw-sync',
    }

    const cronPath = cronMap[provider.toLowerCase()]
    if (!cronPath) {
      return NextResponse.json({ error: `Unknown provider: ${provider}` }, { status: 400 })
    }
    audit(request, `MANUAL_SYNC_${String(provider).toUpperCase()}`, 'IntegrationConfig', undefined, { provider, cronPath }).catch(() => {})

    // Trigger the cron endpoint internally
    const cronSecret = process.env.CRON_SECRET
    if (!cronSecret) {
      return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 })
    }

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : 'http://localhost:3000'

    const response = await fetch(`${baseUrl}${cronPath}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${cronSecret}`,
      },
    })

    const result = await response.json()

    return NextResponse.json({
      triggered: true,
      provider,
      cronPath,
      status: response.status,
      result,
    })
  } catch (error) {
    console.error('Error triggering manual sync:', error)
    return NextResponse.json(
      { error: 'Failed to trigger sync' },
      { status: 500 }
    )
  }
}

function formatAge(ms: number): string {
  if (ms < 60000) return `${Math.round(ms / 1000)}s`
  if (ms < 3600000) return `${Math.round(ms / 60000)}m`
  if (ms < 86400000) return `${(ms / 3600000).toFixed(1)}h`
  return `${(ms / 86400000).toFixed(1)}d`
}

function groupBy(arr: any[], key: string): Record<string, any[]> {
  return arr.reduce((acc, item) => {
    const k = item[key]
    if (!acc[k]) acc[k] = []
    acc[k].push(item)
    return acc
  }, {} as Record<string, any[]>)
}
