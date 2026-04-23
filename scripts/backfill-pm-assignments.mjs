#!/usr/bin/env node
// scripts/backfill-pm-assignments.mjs
//
// Backfill Job.assignedPMId for Jobs that have no PM but are still active.
//
// Context: 573 of 1023 Jobs currently have assignedPMId = null. Most were
// created by the InFlow/Hyphen sync pipelines which don't pick a PM, or
// from early manual entry before the PM seat was wired to the Job form.
//
// Strategy (first match wins per Job):
//   1. If the linked Builder has a "primary PM" concept in the schema
//      (checked at runtime — no such column exists today), assign that.
//      Builder model has no primaryPMId / assignedPMId as of schema head,
//      so this branch is a no-op until a column is added. The script logs
//      a single warning if the concept is missing and proceeds to round-robin.
//   2. Round-robin across the active PMs:
//        Chad Zeh, Brittney Werner, Thomas Robinson, Ben Wilson
//      matched by lowercased "firstName lastName" — with fallback to anyone
//      with role PROJECT_MANAGER and active=true if a named PM isn't found.
//   3. Leave null only if no active PMs exist at all.
//
// Scope: Jobs where
//     assignedPMId IS NULL
//     AND status NOT IN ('CLOSED', 'CANCELLED', 'COMPLETE')
//
// The script is DRY-RUN by default. Pass --apply to write.
//
// USAGE:
//   node scripts/backfill-pm-assignments.mjs           # dry-run, prints plan
//   node scripts/backfill-pm-assignments.mjs --apply   # execute UPDATEs
//
// DO NOT run --apply without reviewing the dry-run output first.

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
const APPLY = process.argv.includes('--apply')

// Canonical PM roster from CLAUDE.md / memory/people/abel-team.md.
// Matching is case-insensitive on "firstName lastName".
const PM_ROSTER = [
  'Chad Zeh',
  'Brittney Werner',
  'Thomas Robinson',
  'Ben Wilson',
]

async function main() {
  console.log(`\n${'='.repeat(70)}`)
  console.log(`Job.assignedPMId backfill  —  mode: ${APPLY ? 'APPLY' : 'DRY RUN'}`)
  console.log(`${'='.repeat(70)}\n`)

  // ── 1. Detect whether Builder has a "primary PM" column. ──
  // Prisma schema currently has none, but we check info_schema at runtime
  // so the script keeps working if/when that column is added.
  const builderCols = await prisma.$queryRawUnsafe(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_name = 'Builder'
      AND column_name IN ('primaryPMId', 'assignedPMId', 'accountPMId', 'pmId')
  `)
  const builderPmCol = (builderCols || [])[0]?.column_name || null
  if (builderPmCol) {
    console.log(`Builder primary-PM column detected: ${builderPmCol}`)
  } else {
    console.log(`No Builder primary-PM column found — round-robin only.`)
  }

  // ── 2. Load the PM pool. ──
  // Prefer the canonical roster (by name); otherwise any active PROJECT_MANAGER.
  const allPms = await prisma.staff.findMany({
    where: {
      active: true,
      OR: [
        { role: 'PROJECT_MANAGER' },
        { roles: { contains: 'PROJECT_MANAGER' } },
      ],
    },
    select: { id: true, firstName: true, lastName: true, email: true, role: true, roles: true },
  })

  const byFullName = new Map()
  for (const s of allPms) {
    byFullName.set(`${s.firstName} ${s.lastName}`.toLowerCase(), s)
  }

  const rosterPms = []
  const rosterMissing = []
  for (const name of PM_ROSTER) {
    const hit = byFullName.get(name.toLowerCase())
    if (hit) rosterPms.push(hit)
    else rosterMissing.push(name)
  }

  // Final PM pool: prefer the named roster, fall back to any active PM.
  const pool = rosterPms.length > 0 ? rosterPms : allPms
  console.log(`\nActive PMs found: ${allPms.length}`)
  console.log(`Named roster matched: ${rosterPms.length} / ${PM_ROSTER.length}`)
  if (rosterMissing.length) {
    console.log(`  Missing from Staff table: ${rosterMissing.join(', ')}`)
  }
  console.log(`Pool being used for round-robin:`)
  for (const p of pool) {
    console.log(`  - ${p.firstName} ${p.lastName}  (${p.email})  id=${p.id}`)
  }
  if (pool.length === 0) {
    console.log(`\nNo active PMs available — cannot assign. Exiting.`)
    await prisma.$disconnect()
    process.exit(0)
  }

  // ── 3. Load candidate jobs. ──
  const jobs = await prisma.$queryRawUnsafe(`
    SELECT j."id", j."jobNumber", j."builderName", j."status"::text AS status,
           j."orderId", o."builderId" AS "orderBuilderId"
    FROM "Job" j
    LEFT JOIN "Order" o ON o."id" = j."orderId"
    WHERE j."assignedPMId" IS NULL
      AND j."status"::text NOT IN ('CLOSED', 'CANCELLED', 'COMPLETE')
    ORDER BY j."createdAt" ASC
  `)
  console.log(`\nCandidate jobs (assignedPMId IS NULL, not closed/cancelled/complete): ${jobs.length}`)

  // ── 4. Preload builder-level PM if such a column exists. ──
  const builderPmMap = new Map()
  if (builderPmCol) {
    const builderIds = Array.from(new Set(jobs.map((j) => j.orderBuilderId).filter(Boolean)))
    if (builderIds.length > 0) {
      // Safe: builderPmCol was whitelisted from info_schema lookup, and we
      // wrap it in double quotes.
      const rows = await prisma.$queryRawUnsafe(
        `SELECT "id", "${builderPmCol}" AS "pmId" FROM "Builder" WHERE "id" = ANY($1::text[])`,
        builderIds,
      )
      for (const r of rows) {
        if (r.pmId) builderPmMap.set(r.id, r.pmId)
      }
    }
  }

  // Confirm any builder-level PM IDs resolve to active staff.
  if (builderPmMap.size > 0) {
    const uniquePmIds = Array.from(new Set(builderPmMap.values()))
    const validPms = await prisma.staff.findMany({
      where: { id: { in: uniquePmIds }, active: true },
      select: { id: true },
    })
    const validIds = new Set(validPms.map((p) => p.id))
    for (const [bid, pmid] of builderPmMap.entries()) {
      if (!validIds.has(pmid)) builderPmMap.delete(bid)
    }
  }

  // ── 5. Plan assignments. ──
  const perPm = new Map() // pmId → count
  let primarySource = 0
  let rrSource = 0
  let cursor = 0
  const updates = [] // {id, pmId}

  for (const job of jobs) {
    let pmId = null

    // 5a. Builder primary PM
    if (job.orderBuilderId && builderPmMap.has(job.orderBuilderId)) {
      pmId = builderPmMap.get(job.orderBuilderId)
      primarySource++
    }

    // 5b. Round-robin
    if (!pmId) {
      const choice = pool[cursor % pool.length]
      cursor++
      pmId = choice.id
      rrSource++
    }

    updates.push({ id: job.id, pmId })
    perPm.set(pmId, (perPm.get(pmId) || 0) + 1)
  }

  // ── 6. Report plan. ──
  console.log(`\n─── Assignment plan ───`)
  console.log(`Builder primary-PM: ${primarySource}`)
  console.log(`Round-robin:        ${rrSource}`)
  console.log(`Total to assign:    ${updates.length}`)
  console.log(`\nPer-PM counts:`)
  const nameFor = new Map(pool.map((p) => [p.id, `${p.firstName} ${p.lastName}`]))
  // Also look up any PM IDs pulled via builder column that aren't in the RR pool.
  const strayIds = Array.from(perPm.keys()).filter((id) => !nameFor.has(id))
  if (strayIds.length > 0) {
    const stray = await prisma.staff.findMany({
      where: { id: { in: strayIds } },
      select: { id: true, firstName: true, lastName: true },
    })
    for (const s of stray) nameFor.set(s.id, `${s.firstName} ${s.lastName}`)
  }
  const sortedPerPm = Array.from(perPm.entries()).sort((a, b) => b[1] - a[1])
  for (const [pmId, count] of sortedPerPm) {
    const label = nameFor.get(pmId) || `(unknown ${pmId})`
    console.log(`  ${label.padEnd(24)} ${count}`)
  }

  // Preview first 5 rows so a human can eyeball before --apply.
  console.log(`\nSample (first 5 planned updates):`)
  for (const u of updates.slice(0, 5)) {
    const job = jobs.find((j) => j.id === u.id)
    console.log(
      `  ${job.jobNumber.padEnd(16)} builder="${(job.builderName || '').slice(0, 28)}"  →  ${nameFor.get(u.pmId) || u.pmId}`,
    )
  }

  // ── 7. Apply if requested. ──
  if (!APPLY) {
    console.log(`\nDry run complete. Re-run with --apply to write these updates.`)
    await prisma.$disconnect()
    return
  }

  console.log(`\nApplying ${updates.length} updates…`)
  let written = 0
  // Chunk in batches of 200 to avoid oversized queries.
  for (let i = 0; i < updates.length; i += 200) {
    const batch = updates.slice(i, i + 200)
    await prisma.$transaction(
      batch.map((u) =>
        prisma.job.update({
          where: { id: u.id },
          data: { assignedPMId: u.pmId },
        }),
      ),
    )
    written += batch.length
    process.stdout.write(`\r  wrote ${written}/${updates.length}`)
  }
  console.log(`\nDone.`)
  await prisma.$disconnect()
}

main().catch(async (e) => {
  console.error(e)
  await prisma.$disconnect()
  process.exit(1)
})
