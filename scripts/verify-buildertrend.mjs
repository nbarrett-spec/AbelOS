#!/usr/bin/env node
/**
 * verify-buildertrend.mjs — BuilderTrend cron + integration smoke check
 *
 * What it does (read-only):
 *   1. Loads the BUILDERTREND row from IntegrationConfig and reports whether
 *      creds (apiKey + apiSecret + baseUrl) are present.
 *   2. Counts BTProjectMapping rows and flags Brookfield / Bloomfield / Pulte
 *      builder links (our three active builder portals as of 2026-04).
 *   3. Confirms the two Wave 2 enum fixes are still queryable:
 *        - DecisionNoteType has GENERAL (cron line 570 cast target)
 *        - TaskStatus has TODO (webhook line 703 cast target)
 *      and that the bad pre-Wave-2 values (MATERIAL_SELECTION, PENDING)
 *      are *not* present.
 *   4. If CRON_URL + CRON_SECRET are set in the environment, triggers
 *      GET {CRON_URL}/api/cron/buildertrend-sync with Bearer auth and
 *      verifies a 200 response (graceful-skip when unconfigured, full sync
 *      otherwise). Wrong-auth probe confirms the 401 gate.
 *   5. Tails the last 5 CronRun rows for buildertrend-sync.
 *
 * What it does NOT do:
 *   - No writes. No schema changes. No git.
 *   - Does not fetch a CRON_SECRET for you — pass it via env.
 *
 * Usage:
 *   # Full run (probe production):
 *   CRON_URL=https://app.abellumber.com \
 *   CRON_SECRET=... \
 *   node --env-file=.env scripts/verify-buildertrend.mjs
 *
 *   # DB-only (no HTTP probe):
 *   node --env-file=.env scripts/verify-buildertrend.mjs
 *
 * Exit codes:
 *   0 — every assertion passed
 *   1 — one or more assertions failed (details in stderr)
 */

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
const results = []
let failed = 0

function check(name, ok, detail = '') {
  results.push({ name, ok, detail })
  if (!ok) failed++
}

async function main() {
  // ── 1. IntegrationConfig row ───────────────────────────────────────────
  const configs = await prisma.$queryRawUnsafe(
    `SELECT "id","provider","name",
            "apiKey" IS NOT NULL AS has_key,
            "apiSecret" IS NOT NULL AS has_secret,
            "baseUrl","status","syncEnabled","lastSyncAt","lastSyncStatus",
            "accessToken" IS NOT NULL AS has_token,"tokenExpiresAt"
     FROM "IntegrationConfig" WHERE "provider"::text = 'BUILDERTREND'`
  )

  const hasRow = configs.length === 1
  check('IntegrationConfig row exists (exactly one)', hasRow,
    `found ${configs.length} row(s)`)

  const cfg = configs[0]
  const fullyConfigured = !!(cfg && cfg.has_key && cfg.has_secret && cfg.baseUrl)

  if (cfg) {
    console.log('\n── IntegrationConfig (BUILDERTREND) ──')
    console.log(`  id:            ${cfg.id}`)
    console.log(`  status:        ${cfg.status}`)
    console.log(`  syncEnabled:   ${cfg.syncEnabled}`)
    console.log(`  apiKey:        ${cfg.has_key ? 'set' : 'null'}`)
    console.log(`  apiSecret:     ${cfg.has_secret ? 'set' : 'null'}`)
    console.log(`  baseUrl:       ${cfg.baseUrl ?? 'null'}`)
    console.log(`  accessToken:   ${cfg.has_token ? 'set' : 'null'}`)
    console.log(`  lastSyncAt:    ${cfg.lastSyncAt ?? 'never'}`)
    console.log(`  fullyConfigured: ${fullyConfigured}`)
  }

  // ── 2. BTProjectMapping counts + Brookfield inspection ─────────────────
  const mappingSummary = await prisma.$queryRawUnsafe(
    `SELECT COUNT(*)::int AS total,
            COUNT("jobId")::int AS with_job,
            COUNT(CASE WHEN "btBuilderName" ILIKE '%brookfield%' THEN 1 END)::int AS brookfield,
            COUNT(CASE WHEN "btBuilderName" ILIKE '%bloomfield%' THEN 1 END)::int AS bloomfield,
            COUNT(CASE WHEN "btBuilderName" ILIKE '%pulte%' THEN 1 END)::int AS pulte
     FROM "BTProjectMapping"`
  )
  const mapStat = mappingSummary[0]
  console.log('\n── BTProjectMapping ──')
  console.log(`  total:        ${mapStat.total}`)
  console.log(`  linked-to-job: ${mapStat.with_job}`)
  console.log(`  brookfield:   ${mapStat.brookfield}`)
  console.log(`  bloomfield:   ${mapStat.bloomfield}`)
  console.log(`  pulte:        ${mapStat.pulte}`)

  if (mapStat.brookfield > 0) {
    const sample = await prisma.$queryRawUnsafe(
      `SELECT "btProjectId","btProjectName","btBuilderName","btCommunity","btLot","btStatus","jobId"
       FROM "BTProjectMapping"
       WHERE "btBuilderName" ILIKE '%brookfield%' OR "btCommunity" ILIKE '%brookfield%'
       LIMIT 5`
    )
    console.log('\n  Brookfield sample:')
    for (const row of sample) {
      console.log(`    - ${row.btProjectName} (job=${row.jobId ?? 'UNLINKED'}, status=${row.btStatus})`)
    }
  }

  // ── 3. Wave 2 enum fixes still valid ───────────────────────────────────
  const dntValues = await prisma.$queryRawUnsafe(
    `SELECT enumlabel FROM pg_enum
     WHERE enumtypid = (SELECT oid FROM pg_type WHERE typname='DecisionNoteType')
     ORDER BY enumsortorder`
  )
  const dntList = dntValues.map(r => r.enumlabel)
  check('DecisionNoteType contains GENERAL (Wave 2 fix target)',
    dntList.includes('GENERAL'),
    `labels: ${JSON.stringify(dntList)}`)
  check('DecisionNoteType does NOT contain MATERIAL_SELECTION (pre-fix bug value)',
    !dntList.includes('MATERIAL_SELECTION'))

  const tsValues = await prisma.$queryRawUnsafe(
    `SELECT enumlabel FROM pg_enum
     WHERE enumtypid = (SELECT oid FROM pg_type WHERE typname='TaskStatus')
     ORDER BY enumsortorder`
  )
  const tsList = tsValues.map(r => r.enumlabel)
  check('TaskStatus contains TODO (Wave 2 fix target)',
    tsList.includes('TODO'),
    `labels: ${JSON.stringify(tsList)}`)
  check('TaskStatus does NOT contain PENDING (pre-fix bug value)',
    !tsList.includes('PENDING'))

  // ── 4. HTTP probe (optional — only if CRON_URL + CRON_SECRET in env) ───
  const cronUrl = process.env.CRON_URL
  const cronSecret = process.env.CRON_SECRET
  if (cronUrl && cronSecret) {
    const endpoint = `${cronUrl.replace(/\/$/, '')}/api/cron/buildertrend-sync`
    console.log(`\n── HTTP probe: ${endpoint} ──`)

    // 4a. No auth → 401
    try {
      const r = await fetch(endpoint)
      check('No-auth request returns 401', r.status === 401, `got ${r.status}`)
    } catch (err) {
      check('No-auth request reachable', false, String(err))
    }

    // 4b. Valid auth → 200 (graceful-skip or real sync)
    try {
      const r = await fetch(endpoint, {
        headers: { Authorization: `Bearer ${cronSecret}` }
      })
      const body = await r.json()
      check('Authed request returns 200', r.status === 200,
        `got ${r.status}, body=${JSON.stringify(body).slice(0, 200)}`)

      if (fullyConfigured) {
        check('Configured sync did not mark itself skipped',
          body.skipped !== true,
          `body.skipped=${body.skipped}`)
        if (body.summary) {
          console.log('  sync summary:', JSON.stringify(body.summary))
        }
      } else {
        check('Unconfigured sync returns {skipped:true, reason:"not_configured"}',
          body.skipped === true && body.reason === 'not_configured',
          `body=${JSON.stringify(body)}`)
      }
    } catch (err) {
      check('Authed request reachable', false, String(err))
    }
  } else {
    console.log('\n── HTTP probe skipped (set CRON_URL and CRON_SECRET to enable) ──')
  }

  // ── 5. CronRun log tail ────────────────────────────────────────────────
  // Note: DB drift — column is "name" / "finishedAt", not schema.prisma's "cronName" / "endedAt"
  const runs = await prisma.$queryRawUnsafe(
    `SELECT "id","name","status","triggeredBy","startedAt","finishedAt","durationMs","result","error"
     FROM "CronRun" WHERE "name" = 'buildertrend-sync'
     ORDER BY "startedAt" DESC LIMIT 5`
  )
  console.log(`\n── Last ${runs.length} buildertrend-sync CronRun entries ──`)
  for (const r of runs) {
    const started = r.startedAt instanceof Date ? r.startedAt.toISOString() : r.startedAt
    console.log(`  ${started} — ${r.status} (${r.durationMs}ms, via ${r.triggeredBy})`)
    if (r.error) console.log(`    error: ${r.error}`)
  }
  if (runs.length > 0) {
    const recentFailures = runs.filter(r => r.status === 'FAILURE' || r.status === 'FAILED').length
    check('No recent CronRun FAILUREs (last 5)', recentFailures === 0,
      `${recentFailures} failure(s) in last 5 runs`)
  }

  // ── Summary ────────────────────────────────────────────────────────────
  console.log('\n── Summary ──')
  for (const r of results) {
    const mark = r.ok ? 'PASS' : 'FAIL'
    console.log(`  [${mark}] ${r.name}${r.detail ? ' — ' + r.detail : ''}`)
  }
  if (failed === 0) {
    console.log(`\nAll ${results.length} checks passed.`)
  } else {
    console.error(`\n${failed} of ${results.length} checks failed.`)
  }
}

main()
  .catch(err => {
    console.error('verify-buildertrend.mjs crashed:', err)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
    if (failed > 0) process.exitCode = 1
  })
