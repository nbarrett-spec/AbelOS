/**
 * Diagnostic: why is Aegis InFlow data drifting from InFlow source of truth?
 *
 * Pulls every signal you'd want to see in one place:
 *   - IntegrationConfig row (is INFLOW connected? when was the last sync?)
 *   - Last 10 SyncLog rows for INFLOW (status, durations, errors)
 *   - Last 10 CronRun rows for inflow-sync (zombies, failures, gaps)
 *   - SyncCursor for inflow-sync (which phase ran last)
 *   - Counts: Products linked vs unlinked, Orders linked vs unlinked,
 *     POs linked vs unlinked, last lastSyncedAt timestamps
 *   - Newest products and oldest stale products by lastSyncedAt
 */
import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

async function main() {
  console.log('\n=== INFLOW INTEGRATION DIAGNOSTIC ===\n')

  // 1. IntegrationConfig
  const cfg: any[] = await prisma.$queryRawUnsafe(
    `SELECT provider, status::text, "lastSyncAt", "lastSyncStatus", "createdAt", "updatedAt"
     FROM "IntegrationConfig" WHERE provider = 'INFLOW'`
  )
  console.log('1. IntegrationConfig (INFLOW):')
  if (cfg.length === 0) {
    console.log('   ❌ NO ROW — InFlow is NOT configured in DB. Sync will return early "not configured".')
  } else {
    console.log('   ', cfg[0])
  }

  // 2. SyncLog (last 10 INFLOW)
  console.log('\n2. SyncLog — last 10 INFLOW rows:')
  const syncLogs: any[] = await prisma.$queryRawUnsafe(
    `SELECT "syncType", status, "recordsProcessed" as proc, "recordsCreated" as cre,
            "recordsUpdated" as upd, "recordsSkipped" as skip, "recordsFailed" as fail,
            "durationMs", "completedAt", "errorMessage"
     FROM "SyncLog" WHERE provider = 'INFLOW'
     ORDER BY "completedAt" DESC LIMIT 10`
  )
  for (const r of syncLogs) {
    const errSnip = r.errorMessage ? ` | err=${String(r.errorMessage).slice(0, 100)}` : ''
    console.log(`   ${r.completedAt?.toISOString?.() || r.completedAt} ${r.syncType.padEnd(15)} ${r.status.padEnd(8)} proc=${r.proc} cre=${r.cre} upd=${r.upd} skip=${r.skip} fail=${r.fail} ${r.durationMs}ms${errSnip}`)
  }
  if (syncLogs.length === 0) console.log('   ❌ NO SYNC LOGS — sync has never run successfully OR rows pruned.')

  // 3. CronRun (last 10 inflow-sync)
  console.log('\n3. CronRun — last 10 inflow-sync rows:')
  const cronRuns: any[] = await prisma.$queryRawUnsafe(
    `SELECT column_name FROM information_schema.columns WHERE table_name = 'CronRun' ORDER BY ordinal_position`
  )
  console.log('   columns:', cronRuns.map((r:any)=>r.column_name).join(', '))

  // 4. SyncCursor
  console.log('\n4. SyncCursor (inflow-sync):')
  const cursor: any[] = await prisma.$queryRawUnsafe(
    `SELECT "lastCursor", "lastRunAt", "itemsProcessed", meta FROM "SyncCursor" WHERE name = 'inflow-sync'`
  )
  if (cursor.length > 0) console.log('   ', cursor[0])
  else console.log('   (no cursor — phase rotation hasn\'t advanced)')

  // 5. Linkage counts
  console.log('\n5. Data linkage to InFlow:')
  const linkCounts: any[] = await prisma.$queryRawUnsafe(`
    SELECT 'Product' as model,
           COUNT(*)::int as total,
           COUNT("inflowId")::int as linked,
           COUNT(*) - COUNT("inflowId")::int as unlinked,
           MAX("lastSyncedAt") as newest_sync,
           MIN("lastSyncedAt") FILTER (WHERE "inflowId" IS NOT NULL) as oldest_synced
    FROM "Product"
    UNION ALL
    SELECT 'Order' as model,
           COUNT(*)::int as total,
           COUNT("inflowOrderId")::int as linked,
           COUNT(*) - COUNT("inflowOrderId")::int as unlinked,
           NULL as newest_sync, NULL as oldest_synced
    FROM "Order"
    UNION ALL
    SELECT 'PurchaseOrder' as model,
           COUNT(*)::int as total,
           COUNT("inflowId")::int as linked,
           COUNT(*) - COUNT("inflowId")::int as unlinked,
           NULL as newest_sync, NULL as oldest_synced
    FROM "PurchaseOrder"
    UNION ALL
    SELECT 'Vendor' as model,
           COUNT(*)::int as total,
           COUNT("inflowVendorId")::int as linked,
           COUNT(*) - COUNT("inflowVendorId")::int as unlinked,
           NULL as newest_sync, NULL as oldest_synced
    FROM "Vendor"
  `)
  for (const r of linkCounts) {
    console.log(`   ${r.model.padEnd(15)} total=${r.total} linked=${r.linked} unlinked=${r.unlinked}${r.newest_sync ? ` newest=${r.newest_sync.toISOString()}` : ''}${r.oldest_synced ? ` oldest=${r.oldest_synced.toISOString()}` : ''}`)
  }

  // 6. Top stale products (synced but not recently)
  console.log('\n6. 5 oldest-synced linked Products (drift candidates):')
  const stale: any[] = await prisma.$queryRawUnsafe(`
    SELECT sku, name, "lastSyncedAt"
    FROM "Product"
    WHERE "inflowId" IS NOT NULL AND "lastSyncedAt" IS NOT NULL
    ORDER BY "lastSyncedAt" ASC LIMIT 5
  `)
  for (const r of stale) {
    console.log(`   ${r.lastSyncedAt?.toISOString?.()} ${r.sku} ${r.name?.slice(0, 60)}`)
  }

  // 7. Time since last successful product sync
  console.log('\n7. Hours since last SUCCESS per phase:')
  const lastSuccessByPhase: any[] = await prisma.$queryRawUnsafe(`
    SELECT "syncType",
           MAX("completedAt") as last_success,
           EXTRACT(EPOCH FROM (NOW() - MAX("completedAt"))) / 3600 as hours_ago
    FROM "SyncLog"
    WHERE provider = 'INFLOW' AND status IN ('SUCCESS','PARTIAL')
    GROUP BY "syncType"
    ORDER BY "syncType"
  `)
  for (const r of lastSuccessByPhase) {
    console.log(`   ${r.syncType.padEnd(15)} ${r.last_success?.toISOString?.()} (${Number(r.hours_ago).toFixed(1)}h ago)`)
  }

  await prisma.$disconnect()
}

main().catch((e) => { console.error(e); process.exit(1) })
