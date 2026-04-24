// One-off: clean up the Pulte "zombie" Jobs after the 2026-04-20 account loss.
//
// Pulte was lost as a customer 2026-04-20 (Doug Gough → Treeline → 84 Lumber).
// AUDIT-DATA-REPORT.md (HEAD 6169e25) found 246 Jobs in status=COMPLETE under
// Pulte/Centex/Del Webb that have been sitting in active ops views as zombies.
//
// Field decision (logged in PULTE-CLEANUP-RUNBOOK.md):
//   - Job has NO archivedAt and NO closedAt column.
//   - JobStatus enum already defines CLOSED as the terminal "archived" state
//     ("Payment received, job archived" — schema.prisma line 1136).
//   - We therefore transition COMPLETE → CLOSED. This is the same path the
//     audit recommended (AUDIT-DATA-REPORT.md "Step 2"). It is reversible.
//
// Pattern: scripts/_apply-bugfix-migration.mjs. Each statement separate.
// Idempotent: re-running after a successful pass updates 0 rows.
//
// Phases:
//   1) Inventory  — read-only $queryRawUnsafe counts (Builder, by-status, COMPLETE total)
//   2) Cleanup    — UPDATE Job SET status='CLOSED' for COMPLETE Pulte jobs older than
//                   7 days completed (mirrors audit's COMPLETE+7d gate)
//   3) Verify     — re-count remaining COMPLETE Pulte jobs (should be 0 once stable)
//
// Run with:  node scripts/_cleanup-pulte-zombies.mjs
//
// SAFETY:
//   - Default mode is DRY RUN. Set APPLY=1 to actually mutate.
//   - Default skip-window is 7 days (matches audit). Set SKIP_DAYS=0 to also
//     close very recently completed Pulte jobs (recommended given Pulte was
//     fully lost on 2026-04-20 — there is no future work to protect).

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const APPLY = process.env.APPLY === '1'
const SKIP_DAYS = Number.isFinite(parseInt(process.env.SKIP_DAYS, 10))
  ? parseInt(process.env.SKIP_DAYS, 10)
  : 7
const PULTE_NAME_REGEX = 'pulte|centex|del webb'

// ─── Phase 1: Inventory (read-only) ───────────────────────────────────────────

const COUNT_BUILDERS_SQL = `
SELECT id, "companyName"
FROM "Builder"
WHERE "companyName" ILIKE '%pulte%'
   OR "companyName" ILIKE '%centex%'
   OR "companyName" ILIKE '%del webb%'
ORDER BY "companyName"
`

const JOBS_BY_STATUS_SQL = `
SELECT j.status::text AS status, COUNT(*)::int AS n
FROM "Job" j
WHERE LOWER(j."builderName") ~ '${PULTE_NAME_REGEX}'
GROUP BY j.status
ORDER BY n DESC
`

const COMPLETE_TOTAL_SQL = `
SELECT COUNT(*)::int AS n
FROM "Job" j
WHERE LOWER(j."builderName") ~ '${PULTE_NAME_REGEX}'
  AND j.status::text = 'COMPLETE'
`

const COMPLETE_ELIGIBLE_SQL = `
SELECT COUNT(*)::int AS n
FROM "Job" j
WHERE LOWER(j."builderName") ~ '${PULTE_NAME_REGEX}'
  AND j.status::text = 'COMPLETE'
  AND (j."completedAt" IS NULL OR j."completedAt" < NOW() - INTERVAL '${SKIP_DAYS} days')
`

// ─── Phase 2: Cleanup (mutating, gated on APPLY=1) ────────────────────────────
//
// Idempotency: WHERE status = 'COMPLETE' means a second run after success
// matches 0 rows. We do NOT touch CLOSED, INVOICED, IN_PRODUCTION, CREATED.
// We skip rows completed in the last 7 days to avoid sweeping fresh work
// (matches audit recommendation).

const CLOSE_PULTE_COMPLETE_SQL = `
UPDATE "Job"
SET status = 'CLOSED', "updatedAt" = NOW()
WHERE LOWER("builderName") ~ '${PULTE_NAME_REGEX}'
  AND status::text = 'COMPLETE'
  AND ("completedAt" IS NULL OR "completedAt" < NOW() - INTERVAL '${SKIP_DAYS} days')
`

// ─── Phase 3: Verify (read-only) ──────────────────────────────────────────────

const VERIFY_REMAINING_COMPLETE_SQL = COMPLETE_TOTAL_SQL
const VERIFY_NEW_CLOSED_SQL = `
SELECT COUNT(*)::int AS n
FROM "Job" j
WHERE LOWER(j."builderName") ~ '${PULTE_NAME_REGEX}'
  AND j.status::text = 'CLOSED'
`

async function main() {
  console.log('────────────────────────────────────────────────────────────')
  console.log(' R8-PULTE-ZOMBIES — Pulte job cleanup')
  console.log(`  Mode           : ${APPLY ? 'APPLY (will mutate)' : 'DRY RUN (no mutations)'}`)
  console.log(`  Skip window    : ${SKIP_DAYS} day(s)  [override with SKIP_DAYS=N]`)
  console.log(`  Field strategy : status COMPLETE → CLOSED (no archivedAt/closedAt in schema)`)
  console.log('────────────────────────────────────────────────────────────\n')

  // Phase 1
  console.log('[1/3] Inventory phase (read-only)...')

  const builders = await prisma.$queryRawUnsafe(COUNT_BUILDERS_SQL)
  console.log(`  Pulte/Centex/Del Webb Builder rows: ${builders.length}`)
  for (const b of builders) console.log(`    ${b.id} — ${b.companyName}`)

  const byStatus = await prisma.$queryRawUnsafe(JOBS_BY_STATUS_SQL)
  console.log(`  Pulte Jobs by status (matched on Job.builderName regex):`)
  console.table(byStatus)

  const [{ n: completeTotal }] = await prisma.$queryRawUnsafe(COMPLETE_TOTAL_SQL)
  const [{ n: completeEligible }] = await prisma.$queryRawUnsafe(COMPLETE_ELIGIBLE_SQL)
  console.log(`  COMPLETE total                 : ${completeTotal}`)
  console.log(`  COMPLETE eligible (>${SKIP_DAYS}d)        : ${completeEligible}`)
  console.log(`  COMPLETE skipped  (≤${SKIP_DAYS}d)        : ${completeTotal - completeEligible}`)

  // Phase 2
  console.log('\n[2/3] Cleanup phase...')
  if (!APPLY) {
    console.log(`  DRY RUN — would set status=CLOSED on ${completeEligible} Job rows.`)
    console.log('  Re-run with APPLY=1 to execute.')
  } else {
    console.log('  APPLY=1 — running UPDATE...')
    const updated = await prisma.$executeRawUnsafe(CLOSE_PULTE_COMPLETE_SQL)
    console.log(`  ${updated} rows updated to status=CLOSED.`)
    if (updated !== completeEligible) {
      console.warn(
        `  ⚠ Updated count (${updated}) ≠ pre-check eligible (${completeEligible}). ` +
        `Likely benign drift if a job changed state mid-run; investigate if delta is large.`
      )
    }
  }

  // Phase 3
  console.log('\n[3/3] Verify phase (read-only)...')
  const [{ n: remaining }] = await prisma.$queryRawUnsafe(VERIFY_REMAINING_COMPLETE_SQL)
  const [{ n: closed }] = await prisma.$queryRawUnsafe(VERIFY_NEW_CLOSED_SQL)
  console.log(`  COMPLETE Pulte Jobs remaining: ${remaining}`)
  console.log(`  CLOSED   Pulte Jobs total    : ${closed}`)

  if (APPLY) {
    if (remaining > completeTotal - completeEligible) {
      console.warn(
        `  ⚠ Remaining COMPLETE (${remaining}) is higher than expected ` +
        `(${completeTotal - completeEligible} skipped). Investigate.`
      )
    } else {
      console.log('  OK — only the <7d skip-window jobs remain in COMPLETE.')
    }
  }

  console.log('\nDone.')
}

main()
  .catch((e) => { console.error('Cleanup failed:', e); process.exit(1) })
  .finally(() => prisma.$disconnect())
