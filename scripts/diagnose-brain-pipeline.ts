/**
 * Diagnose what's flowing (or NOT flowing) between the NUC Brain and Aegis.
 *
 * From the Aegis side we can answer:
 *   - Has the Brain ever posted to /api/ops/brain/webhook?
 *   - When was the last InboxItem with type starting BRAIN_*?
 *   - Are scheduled crons aegis-brain-sync / brain-sync-staff actually running?
 *   - What's in the IntegrationConfig for HYPHEN, GMAIL, GCAL?
 *   - How many email accounts have OAuth tokens?
 *   - What's the WebhookEvent state for provider='brain'?
 */
import { PrismaClient } from '@prisma/client'
const p = new PrismaClient()

async function safeQuery<T = any>(label: string, sql: string, args: any[] = []): Promise<T[] | null> {
  try {
    return await p.$queryRawUnsafe<T[]>(sql, ...args)
  } catch (e: any) {
    console.log(`  [${label}] table missing or query failed: ${e?.message?.slice(0, 80)}`)
    return null
  }
}

async function main() {
  console.log(`══════════════════════════════════════════════════════════════════════`)
  console.log(`  BRAIN → AEGIS PIPELINE DIAGNOSTIC — ${new Date().toISOString()}`)
  console.log(`══════════════════════════════════════════════════════════════════════\n`)

  // ── 1. Brain webhook receipts (InboxItem rows + AuditLog) ──
  console.log(`─── 1. Brain webhook receipts ───`)
  const inbox = await safeQuery<{ c: bigint; lastAt: Date | null }>(
    'InboxItem',
    `SELECT COUNT(*)::bigint c, MAX("createdAt") as "lastAt"
     FROM "InboxItem"
     WHERE type LIKE 'BRAIN_%'`
  )
  if (inbox && inbox[0]) {
    console.log(`  BRAIN_* InboxItems total: ${Number(inbox[0].c)}`)
    console.log(`  Most recent: ${inbox[0].lastAt ? new Date(inbox[0].lastAt).toISOString() : 'never'}`)
  }

  const inboxByType = await safeQuery<{ type: string; c: bigint }>(
    'InboxItem',
    `SELECT type, COUNT(*)::bigint c FROM "InboxItem"
     WHERE type LIKE 'BRAIN_%'
     GROUP BY type ORDER BY COUNT(*) DESC`
  )
  if (inboxByType?.length) {
    console.log(`  By type:`)
    inboxByType.forEach(r => console.log(`    ${r.type.padEnd(30)} ${Number(r.c)}`))
  }

  // ── 2. AuditLog evidence the brain webhook fired ──
  console.log(`\n─── 2. AuditLog "brain webhook" hits (last 7d) ───`)
  const audit = await safeQuery<{ c: bigint; lastAt: Date | null }>(
    'AuditLog',
    `SELECT COUNT(*)::bigint c, MAX("createdAt") as "lastAt"
     FROM "AuditLog"
     WHERE entity ILIKE '%brain%' OR action ILIKE '%brain%'`
  )
  if (audit && audit[0]) {
    console.log(`  Brain-tagged AuditLog rows: ${Number(audit[0].c)}`)
    console.log(`  Most recent: ${audit[0].lastAt ? new Date(audit[0].lastAt).toISOString() : 'never'}`)
  }

  // ── 3. CronRun status for the brain sync jobs ──
  console.log(`\n─── 3. CronRun status (brain sync jobs) ───`)
  const crons = await safeQuery<{ name: string; status: string; startedAt: Date; finishedAt: Date | null; durationMs: number | null; error: string | null }>(
    'CronRun',
    `SELECT name, status, "startedAt", "finishedAt", "durationMs", "error"
     FROM "CronRun"
     WHERE name LIKE '%brain%'
     ORDER BY "startedAt" DESC
     LIMIT 10`
  )
  if (crons?.length) {
    crons.forEach(c => {
      const err = c.error ? ` ERR=${c.error.slice(0, 60)}` : ''
      console.log(`  ${c.name.padEnd(28)} ${c.status.padEnd(10)} ${new Date(c.startedAt).toISOString()} (${c.durationMs ?? '?'}ms)${err}`)
    })
  } else {
    console.log(`  (no brain cron runs recorded — crons probably aren't reaching the DB at all)`)
  }

  // ── 4. IntegrationConfig — what's wired ──
  console.log(`\n─── 4. IntegrationConfig (provider, status, last sync) ───`)
  const integ = await safeQuery<{ provider: string; status: string; lastSyncAt: Date | null; webhookSecret: string | null; apiKey: string | null }>(
    'IntegrationConfig',
    `SELECT provider, status, "lastSyncAt",
            CASE WHEN "webhookSecret" IS NOT NULL THEN 'set' ELSE NULL END as "webhookSecret",
            CASE WHEN "apiKey" IS NOT NULL THEN 'set' ELSE NULL END as "apiKey"
     FROM "IntegrationConfig" ORDER BY provider`
  )
  if (integ?.length) {
    integ.forEach(i =>
      console.log(`  ${i.provider.padEnd(14)} ${i.status.padEnd(12)} lastSync=${i.lastSyncAt ? new Date(i.lastSyncAt).toISOString() : 'never'} secret=${i.webhookSecret ?? '-'} apiKey=${i.apiKey ?? '-'}`)
    )
  }

  // ── 5. Gmail — multi-account state ──
  console.log(`\n─── 5. Gmail accounts wired ───`)
  // GmailAccount may or may not exist as a model; fall back to OAuthCredential
  const gmail = await safeQuery<any>(
    'GmailAccount',
    `SELECT email, status, "lastSyncAt" FROM "GmailAccount" ORDER BY email`
  )
  if (gmail) {
    if (gmail.length === 0) console.log(`  (table exists, 0 rows)`)
    else gmail.forEach(g => console.log(`  ${g.email.padEnd(40)} ${g.status} lastSync=${g.lastSyncAt}`))
  } else {
    // Try OAuth credential table
    const oauth = await safeQuery<any>(
      'OAuthCredential',
      `SELECT provider, "accountEmail", "expiresAt" FROM "OAuthCredential"
       WHERE provider IN ('GOOGLE','GMAIL','GCAL') ORDER BY "accountEmail"`
    )
    if (oauth?.length) {
      console.log(`  OAuthCredential rows (Google providers):`)
      oauth.forEach(o => console.log(`    ${o.provider.padEnd(8)} ${o.accountEmail || '-'} expires=${o.expiresAt}`))
    }
  }

  // ── 6. WebhookEvent — has Brain ever posted? ──
  console.log(`\n─── 6. WebhookEvent rows by provider (last 30d) ───`)
  const webhooks = await safeQuery<{ provider: string; status: string; c: bigint; lastAt: Date | null }>(
    'WebhookEvent',
    `SELECT provider, status, COUNT(*)::bigint c, MAX("receivedAt") as "lastAt"
     FROM "WebhookEvent"
     WHERE "receivedAt" > NOW() - INTERVAL '30 days'
     GROUP BY provider, status
     ORDER BY provider, status`
  )
  if (webhooks?.length) {
    webhooks.forEach(w =>
      console.log(`  ${w.provider.padEnd(14)} ${w.status.padEnd(12)} count=${String(Number(w.c)).padStart(5)} last=${w.lastAt ? new Date(w.lastAt).toISOString() : '-'}`)
    )
  } else {
    console.log(`  (no webhook events in last 30 days — pipeline is silent)`)
  }

  // ── 7. SyncLog — last successful pulls ──
  console.log(`\n─── 7. SyncLog: last sync per provider ───`)
  const syncs = await safeQuery<{ provider: string; status: string; lastAt: Date }>(
    'SyncLog',
    `SELECT provider, status, MAX("startedAt") as "lastAt"
     FROM "SyncLog"
     WHERE "startedAt" > NOW() - INTERVAL '14 days'
     GROUP BY provider, status
     ORDER BY provider, status`
  )
  if (syncs?.length) {
    syncs.forEach(s =>
      console.log(`  ${s.provider.padEnd(14)} ${s.status.padEnd(10)} ${new Date(s.lastAt).toISOString()}`)
    )
  } else {
    console.log(`  (no syncs in last 14 days)`)
  }

  console.log(`\n═══════════════════════════════════════════════════════════════════════\n`)
  await p.$disconnect()
}

main().catch(e => { console.error(e); process.exit(1) })
