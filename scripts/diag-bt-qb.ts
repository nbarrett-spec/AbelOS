/**
 * Diagnostic: BuilderTrend + QuickBooks integration sweep.
 *
 * Mirror of scripts/diag-inflow.ts but covers BUILDERTREND + QUICKBOOKS_DESKTOP
 * (QBWC) and QUICKBOOKS_ONLINE (stub). Read-only.
 */
import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

async function dumpProvider(label: string, provider: string) {
  console.log(`\n=== ${label} ===`)

  // 1. IntegrationConfig
  let cfg: any[] = []
  try {
    cfg = await prisma.$queryRawUnsafe(
      `SELECT provider::text, status::text, "lastSyncAt", "lastSyncStatus",
              ("apiKey" IS NOT NULL) AS "hasApiKey",
              ("apiSecret" IS NOT NULL) AS "hasApiSecret",
              ("accessToken" IS NOT NULL) AS "hasAccessToken",
              "tokenExpiresAt", "syncEnabled", "baseUrl",
              "createdAt", "updatedAt"
       FROM "IntegrationConfig" WHERE provider::text = $1`,
      provider
    )
  } catch (e: any) {
    console.log(`   ! query failed: ${e.message}`)
  }
  console.log(`1. IntegrationConfig:`)
  if (cfg.length === 0) {
    console.log(`   (no row — ${provider} not configured)`)
  } else {
    for (const r of cfg) console.log('  ', r)
  }

  // 2. SyncLog last 10
  console.log(`2. SyncLog last 10:`)
  try {
    const logs: any[] = await prisma.$queryRawUnsafe(
      `SELECT "syncType", status::text, "recordsProcessed" AS proc,
              "recordsCreated" AS cre, "recordsUpdated" AS upd,
              "recordsSkipped" AS skip, "recordsFailed" AS fail,
              "durationMs", "completedAt", LEFT("errorMessage", 100) AS err
       FROM "SyncLog" WHERE provider::text = $1
       ORDER BY "completedAt" DESC NULLS LAST LIMIT 10`,
      provider
    )
    if (logs.length === 0) console.log(`   (no rows)`)
    for (const r of logs) {
      console.log(`   ${r.completedAt?.toISOString?.() ?? r.completedAt} ${r.syncType?.padEnd?.(15)} ${r.status?.padEnd?.(8)} proc=${r.proc} cre=${r.cre} upd=${r.upd} skip=${r.skip} fail=${r.fail} ${r.durationMs}ms${r.err ? ' | ' + r.err : ''}`)
    }
  } catch (e: any) {
    console.log(`   ! ${e.message}`)
  }
}

async function dumpCron(name: string) {
  console.log(`\n=== CronRun: ${name} ===`)
  try {
    const rows: any[] = await prisma.$queryRawUnsafe(
      `SELECT * FROM "CronRun" WHERE name = $1
       ORDER BY "startedAt" DESC LIMIT 10`,
      name
    )
    if (rows.length === 0) console.log(`   (no rows)`)
    for (const r of rows) {
      const status = r.status ?? r.state ?? r.outcome ?? ''
      const dur = r.durationMs ?? r.duration_ms ?? ''
      const err = r.error ? ` err=${String(r.error).slice(0, 100)}` : ''
      console.log(`   ${r.startedAt?.toISOString?.() ?? r.startedAt} status=${status} ${dur}ms${err}`)
    }
  } catch (e: any) {
    console.log(`   ! ${e.message}`)
  }
}

async function main() {
  console.log('\n##### BUILDERTREND + QUICKBOOKS DIAGNOSTIC #####\n')

  await dumpProvider('BUILDERTREND', 'BUILDERTREND')
  await dumpCron('buildertrend-sync')

  console.log('\n3. BTProjectMapping linkage:')
  try {
    const r: any[] = await prisma.$queryRawUnsafe(`
      SELECT COUNT(*)::int AS total,
             COUNT("jobId")::int AS mapped_to_job,
             COUNT("builderId")::int AS mapped_to_builder,
             MAX("lastSyncedAt") AS newest_sync,
             MIN("lastSyncedAt") AS oldest_sync,
             COUNT(DISTINCT "btProjectId")::int AS distinct_bt_ids
      FROM "BTProjectMapping"`)
    console.log('  ', r[0])
  } catch (e: any) { console.log('   !', e.message) }

  console.log('\n3a. Newest BTProjectMapping rows:')
  try {
    const r: any[] = await prisma.$queryRawUnsafe(`
      SELECT "btProjectId", "btProjectName", "btBuilderName", "btStatus",
             "lastSyncedAt", "createdAt"
      FROM "BTProjectMapping"
      ORDER BY "lastSyncedAt" DESC NULLS LAST LIMIT 5`)
    if (r.length === 0) console.log('   (none)')
    for (const row of r) console.log('  ', row)
  } catch (e: any) { console.log('   !', e.message) }

  await dumpProvider('QUICKBOOKS_DESKTOP (QBWC)', 'QUICKBOOKS_DESKTOP')
  await dumpCron('qb-aggregate')

  console.log('\n4. QBSyncQueue counts by status:')
  try {
    const r: any[] = await prisma.$queryRawUnsafe(`
      SELECT status, COUNT(*)::int AS n,
             MAX("createdAt") AS newest,
             MIN("createdAt") AS oldest
      FROM "QBSyncQueue" GROUP BY status ORDER BY n DESC`)
    if (r.length === 0) console.log('   (empty)')
    for (const row of r) console.log('  ', row)
  } catch (e: any) { console.log('   !', e.message) }

  console.log('\n5. Qb mirror tables row counts (QBWC writes here):')
  for (const t of ['QbCustomer', 'QbVendor', 'QbAccount', 'QbItem', 'QbInvoice', 'QbInvoiceLine', 'QbBill', 'QbBillExpenseLine']) {
    try {
      const r: any[] = await prisma.$queryRawUnsafe(`
        SELECT COUNT(*)::int AS n,
               MAX("syncedAt") AS newest_sync
        FROM "${t}"`)
      console.log(`   ${t.padEnd(22)} n=${r[0].n} newest=${r[0].newest_sync ?? '(never)'}`)
    } catch (e: any) {
      console.log(`   ${t.padEnd(22)} ! ${e.message?.slice(0, 80)}`)
    }
  }

  console.log('\n6. Customer/Vendor linkage to QB (qbCustomerId / qbVendorId):')
  for (const [model, col] of [
    ['Customer', 'qbCustomerId'],
    ['Vendor', 'qbVendorId'],
  ]) {
    try {
      const r: any[] = await prisma.$queryRawUnsafe(
        `SELECT COUNT(*)::int AS total,
                COUNT("${col}")::int AS linked,
                (COUNT(*) - COUNT("${col}"))::int AS unlinked
         FROM "${model}"`)
      console.log(`   ${model.padEnd(10)} total=${r[0].total} linked=${r[0].linked} unlinked=${r[0].unlinked}`)
    } catch (e: any) {
      console.log(`   ${model.padEnd(10)} ! ${e.message?.slice(0, 80)}`)
    }
  }

  // Try QBO too in case the enum was added.
  await dumpProvider('QUICKBOOKS_ONLINE (stub)', 'QUICKBOOKS_ONLINE')

  await prisma.$disconnect()
}

main().catch((e) => { console.error(e); process.exit(1) })
