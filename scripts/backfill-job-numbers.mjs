#!/usr/bin/env node
/**
 * One-time backfill: legacy Bolt / sequential job numbers → new "<address> <code>" naming.
 *
 * BUG 1 in CLAUDE-CODE-BUGFIX-HANDOFF-2026-05-01.md.
 *
 * Targets jobs whose jobNumber matches:
 *   - JOB-BOLT-XXXXXX   (Bolt-imported)
 *   - JOB-YYYY-NNNN     (legacy sequence)
 *
 * Resolution rules per the handoff:
 *   1. address + jobType  →  "<address> <code>"   (e.g. "10567 Boxthorn T1")
 *   2. address, no jobType →  "<address>"         (better than JOB-BOLT-*)
 *   3. neither             →  leave alone (orphan/stale)
 *
 * Uniqueness: Job.jobNumber is unique. On collision we append "-2", "-3", …
 * to the candidate until it's unused. Collisions are checked against both
 * existing rows and prior changes within this run.
 *
 * Safety: defaults to DRY-RUN. Set `DRYRUN=0` to apply.
 *
 * Run:
 *   DRYRUN=1 node scripts/backfill-job-numbers.mjs   (default — preview only)
 *   DRYRUN=0 node scripts/backfill-job-numbers.mjs   (apply)
 *
 * After running with DRYRUN=0, eyeball the output for surprises and verify
 * with: SELECT jobNumber FROM "Job" WHERE jobNumber LIKE 'JOB-BOLT-%' OR
 * jobNumber LIKE 'JOB-2___-_%' — should return zero rows for jobs that had
 * usable addresses.
 */

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const DRYRUN = process.env.DRYRUN !== '0'

// Mirrors src/lib/job-types.ts JOB_TYPE_CODES — keep in sync.
const JOB_TYPE_CODES = {
  TRIM_1: 'T1',
  TRIM_1_INSTALL: 'T1I',
  TRIM_2: 'T2',
  TRIM_2_INSTALL: 'T2I',
  DOORS: 'DR',
  DOOR_INSTALL: 'DRI',
  HARDWARE: 'HW',
  HARDWARE_INSTALL: 'HWI',
  FINAL_FRONT: 'FF',
  FINAL_FRONT_INSTALL: 'FFI',
  QC_WALK: 'QC',
  PUNCH: 'PL',
  WARRANTY: 'WR',
  CUSTOM: 'CU',
}

function normalizeAddress(addr) {
  return (addr || '').trim().replace(/\s+/g, ' ')
}

function buildCandidate(addr, jobType) {
  const a = normalizeAddress(addr)
  if (!a) return null
  if (jobType && JOB_TYPE_CODES[jobType]) {
    return `${a} ${JOB_TYPE_CODES[jobType]}`
  }
  return a
}

async function main() {
  console.log(`[backfill-job-numbers] mode: ${DRYRUN ? 'DRY-RUN' : 'APPLY'}`)
  console.log(`[backfill-job-numbers] DB: ${process.env.DATABASE_URL?.split('@')[1]?.split('?')[0] || '(unknown)'}`)

  // 1) Collect all in-use job numbers so we can detect collisions in-memory.
  const allRows = await prisma.$queryRawUnsafe(
    `SELECT "jobNumber" FROM "Job"`,
  )
  const used = new Set(allRows.map((r) => r.jobNumber))
  console.log(`[backfill-job-numbers] existing jobs: ${used.size}`)

  // 2) Fetch the targets — anything starting with "JOB-".
  const targets = await prisma.$queryRawUnsafe(
    `SELECT "id", "jobNumber", "jobAddress", "jobType"::text AS "jobType"
       FROM "Job"
      WHERE "jobNumber" LIKE 'JOB-%'
      ORDER BY "createdAt" ASC`,
  )
  console.log(`[backfill-job-numbers] candidates: ${targets.length}`)

  let renamed = 0
  let skippedNoAddress = 0
  let skippedAlreadyMatches = 0
  let collisions = 0
  const summary = []

  for (const job of targets) {
    const candidate = buildCandidate(job.jobAddress, job.jobType)
    if (!candidate) {
      skippedNoAddress++
      continue
    }

    if (candidate === job.jobNumber) {
      // Already in the new format somehow.
      skippedAlreadyMatches++
      continue
    }

    // Resolve collision suffix.
    let final = candidate
    if (used.has(final)) {
      let n = 2
      while (used.has(`${candidate}-${n}`)) n++
      final = `${candidate}-${n}`
      collisions++
    }

    summary.push({
      id: job.id,
      from: job.jobNumber,
      to: final,
      jobType: job.jobType,
    })

    // Reserve so subsequent rows in this run don't collide.
    used.add(final)
    used.delete(job.jobNumber)
    renamed++

    if (!DRYRUN) {
      await prisma.$executeRawUnsafe(
        `UPDATE "Job" SET "jobNumber" = $1, "updatedAt" = NOW() WHERE "id" = $2`,
        final,
        job.id,
      )
    }
  }

  console.log('')
  console.log(`[backfill-job-numbers] would rename: ${renamed}`)
  console.log(`[backfill-job-numbers]   collisions resolved with suffix: ${collisions}`)
  console.log(`[backfill-job-numbers] skipped (no address): ${skippedNoAddress}`)
  console.log(`[backfill-job-numbers] skipped (already matches): ${skippedAlreadyMatches}`)
  console.log('')

  // Print a sample of the changes — first 25 + last 5 if there are more.
  const head = summary.slice(0, 25)
  const tail = summary.length > 30 ? summary.slice(-5) : []
  for (const row of head) {
    console.log(`  ${row.from}  →  ${row.to}    (${row.jobType || 'address-only'})`)
  }
  if (tail.length) {
    console.log(`  … ${summary.length - 25 - tail.length} more …`)
    for (const row of tail) {
      console.log(`  ${row.from}  →  ${row.to}    (${row.jobType || 'address-only'})`)
    }
  }

  if (DRYRUN) {
    console.log('')
    console.log('[backfill-job-numbers] DRY-RUN — no rows updated. Re-run with DRYRUN=0 to apply.')
  } else {
    console.log('')
    console.log(`[backfill-job-numbers] APPLIED — ${renamed} rows updated.`)
  }
}

main()
  .catch((err) => {
    console.error('[backfill-job-numbers] failed:', err)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
