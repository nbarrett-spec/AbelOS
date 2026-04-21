#!/usr/bin/env node
// scripts/backfill-job-schedules.mjs
//
// Backfill Job.scheduledDate from the best available upstream source.
//
// Context: 471 Job rows currently have scheduledDate = null. These rows
// were mostly created by:
//   - The InFlow sync (src/lib/integrations/inflow.ts) — imports SalesOrders
//     as Jobs, but the sync didn't carry `expectedDeliveryDate` through to
//     the Prisma insert.
//   - The Hyphen import (src/app/api/ops/import-hyphen/route.ts) — creates
//     placeholder Jobs from HyphenOrder rows WITHOUT setting scheduledDate
//     (see the INSERT near line 307 — no scheduledDate column in the list).
//   - Early manual entry through /ops/jobs.
//
// Backfill strategy, in order of preference (first match wins per job):
//   1. linked Order.deliveryDate   (for Jobs created from an Abel Order)
//   2. linked HyphenOrder.requestedEnd or actualEnd via boltJobId "HYP-*"
//   3. first ScheduleEntry.scheduledDate for the same Job
//   4. Order.dueDate
//   5. no change (leave null, report in the summary)
//
// The script is a dry-run by default. Pass `--apply` to actually write.
//
// USAGE:
//   node scripts/backfill-job-schedules.mjs           # dry-run, prints plan
//   node scripts/backfill-job-schedules.mjs --apply   # execute UPDATEs
//
// DO NOT run --apply without reviewing dry-run output first. The orchestrator
// that owns this task is NOT authorized to --apply automatically.

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
const APPLY = process.argv.includes('--apply')

async function main() {
  console.log(`\n${'='.repeat(70)}`)
  console.log(`Job.scheduledDate backfill  —  mode: ${APPLY ? 'APPLY' : 'DRY RUN'}`)
  console.log(`${'='.repeat(70)}\n`)

  // Pull every Job missing a scheduledDate, joined to potential sources.
  // Using raw SQL keeps the query surface small (no Prisma select explosion).
  const rows = await prisma.$queryRawUnsafe(`
    SELECT
      j."id"             AS "jobId",
      j."jobNumber",
      j."boltJobId",
      j."orderId",
      o."deliveryDate"   AS "orderDeliveryDate",
      o."dueDate"        AS "orderDueDate",
      (
        SELECT se."scheduledDate"
          FROM "ScheduleEntry" se
         WHERE se."jobId" = j."id"
         ORDER BY se."scheduledDate" ASC
         LIMIT 1
      )                  AS "firstScheduleEntry",
      (
        SELECT COALESCE(ho."actualEnd", ho."requestedEnd")
          FROM "HyphenOrder" ho
         WHERE 'HYP-' || ho."hyphId" = j."boltJobId"
         LIMIT 1
      )                  AS "hyphenEnd"
    FROM "Job" j
    LEFT JOIN "Order" o ON o."id" = j."orderId"
    WHERE j."scheduledDate" IS NULL
    ORDER BY j."createdAt" DESC
  `)

  const total = rows.length
  console.log(`Found ${total} jobs missing scheduledDate.`)

  const plan = {
    fromOrderDeliveryDate: 0,
    fromHyphenEnd: 0,
    fromScheduleEntry: 0,
    fromOrderDueDate: 0,
    leftNull: 0,
  }
  const updates = []

  for (const r of rows) {
    let pick = null
    let source = null
    if (r.orderDeliveryDate) {
      pick = r.orderDeliveryDate
      source = 'Order.deliveryDate'
      plan.fromOrderDeliveryDate++
    } else if (r.hyphenEnd) {
      pick = r.hyphenEnd
      source = 'HyphenOrder.actualEnd|requestedEnd'
      plan.fromHyphenEnd++
    } else if (r.firstScheduleEntry) {
      pick = r.firstScheduleEntry
      source = 'ScheduleEntry.scheduledDate'
      plan.fromScheduleEntry++
    } else if (r.orderDueDate) {
      pick = r.orderDueDate
      source = 'Order.dueDate'
      plan.fromOrderDueDate++
    } else {
      plan.leftNull++
      continue
    }
    updates.push({ jobId: r.jobId, jobNumber: r.jobNumber, pick, source })
  }

  // Print a sample so a human can eyeball the mapping.
  const SAMPLE = 15
  console.log('\nProposed updates (first 15):')
  for (const u of updates.slice(0, SAMPLE)) {
    const iso = new Date(u.pick).toISOString().slice(0, 10)
    console.log(`  ${u.jobNumber.padEnd(18)}  →  ${iso}   [${u.source}]`)
  }
  if (updates.length > SAMPLE) {
    console.log(`  … ${updates.length - SAMPLE} more`)
  }

  console.log('\nPlan summary:')
  console.log(`  from Order.deliveryDate       : ${plan.fromOrderDeliveryDate}`)
  console.log(`  from HyphenOrder end dates    : ${plan.fromHyphenEnd}`)
  console.log(`  from ScheduleEntry            : ${plan.fromScheduleEntry}`)
  console.log(`  from Order.dueDate            : ${plan.fromOrderDueDate}`)
  console.log(`  left null (no upstream data)  : ${plan.leftNull}`)
  console.log(`  total candidates              : ${total}`)

  if (!APPLY) {
    console.log('\nDry run complete. Re-run with --apply to write changes.')
    await prisma.$disconnect()
    return
  }

  console.log('\nApplying updates…')
  let ok = 0
  let failed = 0
  for (const u of updates) {
    try {
      await prisma.$executeRawUnsafe(
        `UPDATE "Job" SET "scheduledDate" = $1, "updatedAt" = NOW() WHERE "id" = $2 AND "scheduledDate" IS NULL`,
        u.pick,
        u.jobId
      )
      ok++
    } catch (e) {
      failed++
      console.error(`  FAIL ${u.jobNumber}: ${String(e).slice(0, 200)}`)
    }
  }
  console.log(`\nApplied ${ok} updates, ${failed} failures.`)
  await prisma.$disconnect()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
