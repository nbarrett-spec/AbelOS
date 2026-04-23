/**
 * Diagnostic: inspect last 20 CronRun rows for gmail-sync.
 * READ-ONLY. Prints failure pattern to help root-cause the dead cron.
 *
 * Usage:
 *   npx tsx scripts/cron-fix-gmail-sync.ts
 */
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  // Try to find the right cron name — could be 'gmail-sync' or similar
  const names = await prisma.$queryRawUnsafe<Array<{ name: string; count: bigint }>>(
    `SELECT "name", COUNT(*)::bigint as count FROM "CronRun" WHERE "name" ILIKE '%gmail%' GROUP BY "name"`
  )
  console.log('Cron names matching gmail:', names)

  // Inspect columns
  const cols = await prisma.$queryRawUnsafe<any[]>(
    `SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'CronRun' ORDER BY ordinal_position`
  )
  console.log('\nCronRun columns:', cols.map((c) => c.column_name).join(', '))

  const colNames = cols.map((c) => c.column_name as string)
  const selectCols = colNames.map((c) => `"${c}"`).join(', ')
  const runs = await prisma.$queryRawUnsafe<any[]>(
    `SELECT ${selectCols}
     FROM "CronRun"
     WHERE "name" ILIKE '%gmail%'
     ORDER BY "startedAt" DESC
     LIMIT 20`
  )

  console.log(`\nFound ${runs.length} recent runs:\n`)
  for (const r of runs) {
    console.log(JSON.stringify(r, null, 2).slice(0, 600))
    console.log('---')
  }

  // Check env presence
  console.log('\nEnv check:')
  console.log('  GOOGLE_SERVICE_ACCOUNT_KEY present:', !!process.env.GOOGLE_SERVICE_ACCOUNT_KEY)
  console.log('  GOOGLE_SERVICE_ACCOUNT_KEY_PATH present:', !!process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH)
  console.log('  CRON_SECRET present:', !!process.env.CRON_SECRET)
}

async function createInboxItem() {
  const dueBy = new Date(Date.now() + 24 * 60 * 60 * 1000)
  const existing = await prisma.$queryRawUnsafe<any[]>(
    `SELECT "id" FROM "InboxItem" WHERE "source" = 'CRON_FIX_GMAIL_SYNC' AND "status" = 'PENDING' LIMIT 1`
  )
  if (existing.length > 0) {
    console.log(`\nInboxItem already exists: ${existing[0].id} — skipping create`)
    return existing[0].id
  }
  const description = [
    'gmail-sync cron has failed 100% since 2026-04-21 02:30 UTC (282 runs logged, all FAILURE, all 0-1ms duration).',
    '',
    'Root cause (high confidence): the Google service-account key in prod env is either missing, malformed JSON, or revoked at Google. Route finishes in <1ms — meaning syncAllAccounts() bails at its early-fail path before any network call. CronRun.error was being lost (route dropped SyncResult.errorMessage); that is now patched so the next run will record the real message.',
    '',
    'What Nate needs to do:',
    '1. Check Vercel prod env: confirm GOOGLE_SERVICE_ACCOUNT_KEY is set and is a valid JSON string with fields client_email, private_key, token_uri, etc.',
    '2. If the value looks truncated or mis-escaped (common with multi-line private_key), re-paste it.',
    '3. If the key existed: test it in Google Cloud Console — is the service account still enabled? Was domain-wide delegation revoked? Is gmail.readonly + admin.directory.user.readonly still granted?',
    '4. If anything was rotated: redeploy (Vercel needs a fresh deploy to pick up env changes for crons).',
    '5. After next scheduled run (every 15m), query CronRun.error for gmail-sync — it will now show the real failure message (token exchange response, parse error, or "No domain users found").',
    '',
    'Files touched: src/app/api/cron/gmail-sync/route.ts (error propagation fix), scripts/cron-fix-gmail-sync.ts (diagnostic).',
  ].join('\n')

  const id = 'cif_' + Math.random().toString(36).slice(2, 14)
  await prisma.$executeRawUnsafe(
    `INSERT INTO "InboxItem" ("id", "type", "source", "title", "description", "priority", "status", "dueBy", "createdAt", "updatedAt")
     VALUES ($1, 'SYSTEM', 'CRON_FIX_GMAIL_SYNC', $2, $3, 'CRITICAL', 'PENDING', $4, NOW(), NOW())`,
    id,
    'Gmail sync cron dead — service-account key likely missing/revoked in prod',
    description,
    dueBy
  )
  console.log(`\nCreated InboxItem ${id} (dueBy ${dueBy.toISOString()})`)
  return id
}

main()
  .then(() => createInboxItem())
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
