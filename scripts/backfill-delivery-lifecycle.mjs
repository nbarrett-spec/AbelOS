#!/usr/bin/env node
// scripts/backfill-delivery-lifecycle.mjs
//
// Repairs the Delivery lifecycle so rows actually reflect their real state.
//
// Context: every current Delivery row is status=COMPLETE (211 of 211 on the
// live DB). That happened because deliveries were only ever inserted at the
// very end of the flow — nothing created a SCHEDULED row when Order hit
// READY_TO_SHIP, so the driver portal never had work to show and the
// executive on-time metric is meaningless.
//
// This script does four things:
//   A. Leave existing Deliveries alone if status=COMPLETE AND completedAt
//      is set. Truth wins — those were real deliveries.
//   D. For existing Deliveries that are status=COMPLETE but completedAt IS
//      NULL, reclassify based on linked Job status:
//        Job CREATED/READINESS_CHECK/MATERIALS_LOCKED/STAGED/IN_PRODUCTION → SCHEDULED
//        Job INSTALLING                                                     → IN_TRANSIT
//        Job DELIVERED/COMPLETE/INVOICED/CLOSED/PUNCH_LIST                  → COMPLETE
//           (stamp completedAt = Job.actualDate || Job.updatedAt so the metric
//           has a defensible timestamp; flag in notes as backfilled)
//      This is the main fix: 204 of the 211 existing rows are bogus COMPLETEs
//      without a completedAt timestamp, flashed into existence as already done.
//   B. For every Order in a shipping/delivered-but-not-finished state that
//      has NO matching Delivery row, create one at the right stage:
//        READY_TO_SHIP     → Delivery.status=SCHEDULED
//        SHIPPED           → Delivery.status=IN_TRANSIT + departedAt=now
//        PARTIAL_SHIPPED   → Delivery.status=IN_TRANSIT + departedAt=now
//   C. For every Job with status=DELIVERED AND NO Delivery row yet,
//      create a best-effort Delivery.status=COMPLETE with
//      completedAt=Job.actualDate. This is a history repair.
//
// Dry-run by default. Pass --apply to actually write.
//
// USAGE:
//   node scripts/backfill-delivery-lifecycle.mjs           # preview
//   node scripts/backfill-delivery-lifecycle.mjs --apply   # execute
//
// NB: deliveryNumber generation uses DEL-YYYY-NNNN. For historical repair
// rows (C) we stamp DEL-HIST-YYYY-NNNN so they're distinguishable on an
// audit pass — the unique constraint on deliveryNumber is preserved.

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
const APPLY = process.argv.includes('--apply')

function pad(n, w = 4) {
  return String(n).padStart(w, '0')
}

function makeDeliveryId() {
  return `del_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

/**
 * Get the next DEL-YYYY-NNNN number for the given prefix.
 * We pull the current max once at process start, then increment in memory
 * to avoid hammering the DB with MAX queries inside the loop.
 */
async function initNumberCursor(prefix) {
  const row = await prisma.$queryRawUnsafe(
    `SELECT COALESCE(MAX(CAST(SUBSTRING("deliveryNumber" FROM '[0-9]+$') AS INT)), 0)::int AS max_num
     FROM "Delivery" WHERE "deliveryNumber" LIKE $1`,
    `${prefix}%`
  )
  return Number(row[0]?.max_num || 0)
}

async function main() {
  const year = new Date().getFullYear()
  const divider = '='.repeat(70)

  console.log(`\n${divider}`)
  console.log(`Delivery lifecycle backfill  —  mode: ${APPLY ? 'APPLY' : 'DRY RUN'}`)
  console.log(divider)

  // ── Snapshot current state ──────────────────────────────────────────
  const beforeCounts = await prisma.$queryRawUnsafe(
    `SELECT "status"::text AS s, COUNT(*)::int AS c
     FROM "Delivery" GROUP BY "status" ORDER BY c DESC`
  )
  console.log('\nBefore — Delivery status counts:')
  for (const r of beforeCounts) console.log(`   ${r.s.padEnd(18)} ${r.c}`)

  // ── A. Inventory current COMPLETE deliveries — leave alone ─────────
  const completeRow = await prisma.$queryRawUnsafe(
    `SELECT COUNT(*)::int AS c FROM "Delivery"
     WHERE "status"::text = 'COMPLETE' AND "completedAt" IS NOT NULL`
  )
  const completeTruthful = completeRow[0]?.c || 0
  console.log(`\nA. COMPLETE deliveries with completedAt (leave alone): ${completeTruthful}`)

  // ── D. Bogus COMPLETE — reclassify by linked Job status ────────────
  const bogusCompletes = await prisma.$queryRawUnsafe(
    `SELECT d."id"             AS "deliveryId",
            d."deliveryNumber",
            d."jobId",
            j."status"::text   AS "jobStatus",
            j."actualDate",
            j."updatedAt"      AS "jobUpdatedAt",
            j."completedAt"    AS "jobCompletedAt"
     FROM "Delivery" d
     LEFT JOIN "Job" j ON j."id" = d."jobId"
     WHERE d."status"::text = 'COMPLETE' AND d."completedAt" IS NULL`
  )

  const reclassPlan = {
    SCHEDULED: [],
    IN_TRANSIT: [],
    COMPLETE: [],
    UNKNOWN: [],
  }
  for (const r of bogusCompletes) {
    const target = classifyByJobStatus(r.jobStatus)
    reclassPlan[target].push(r)
  }

  console.log(`\nD. COMPLETE-without-completedAt reclassification plan — ${bogusCompletes.length} rows`)
  for (const [k, v] of Object.entries(reclassPlan)) {
    console.log(`   → ${k.padEnd(18)} ${v.length}`)
  }

  // ── B. Orders missing Delivery rows ─────────────────────────────────
  //
  // For a given Order, a "matching Delivery" is any Delivery on a Job
  // linked to that order. If the Job doesn't exist yet, we skip — that's
  // the order-cascade's job, not ours.
  const ordersNeedingDeliveries = await prisma.$queryRawUnsafe(
    `SELECT o."id"            AS "orderId",
            o."orderNumber",
            o."status"::text  AS "orderStatus",
            j."id"            AS "jobId",
            j."jobAddress",
            j."scheduledDate",
            b."address"       AS "builderAddress",
            b."city"          AS "builderCity",
            b."state"         AS "builderState",
            b."zip"           AS "builderZip"
     FROM "Order" o
     INNER JOIN "Job" j ON j."orderId" = o."id"
     LEFT JOIN "Builder" b ON b."id" = o."builderId"
     WHERE o."status"::text IN ('READY_TO_SHIP', 'SHIPPED', 'PARTIAL_SHIPPED')
       AND NOT EXISTS (
         SELECT 1 FROM "Delivery" d WHERE d."jobId" = j."id"
       )`
  )

  const byStatus = {
    READY_TO_SHIP: 0,
    SHIPPED: 0,
    PARTIAL_SHIPPED: 0,
  }
  for (const r of ordersNeedingDeliveries) byStatus[r.orderStatus]++

  console.log(`\nB. Orders without Delivery rows — ${ordersNeedingDeliveries.length} total`)
  for (const [k, v] of Object.entries(byStatus)) {
    console.log(`   ${k.padEnd(18)} ${v}`)
  }

  // ── C. Jobs status=DELIVERED but no Delivery row ────────────────────
  const jobsNeedingHistory = await prisma.$queryRawUnsafe(
    `SELECT j."id"            AS "jobId",
            j."jobNumber",
            j."jobAddress",
            j."actualDate",
            j."updatedAt",
            j."completedAt",
            o."id"            AS "orderId",
            b."address"       AS "builderAddress",
            b."city"          AS "builderCity",
            b."state"         AS "builderState",
            b."zip"           AS "builderZip"
     FROM "Job" j
     LEFT JOIN "Order" o ON o."id" = j."orderId"
     LEFT JOIN "Builder" b ON b."id" = o."builderId"
     WHERE j."status"::text = 'DELIVERED'
       AND NOT EXISTS (
         SELECT 1 FROM "Delivery" d WHERE d."jobId" = j."id"
       )`
  )
  console.log(`\nC. Jobs DELIVERED without Delivery rows: ${jobsNeedingHistory.length}`)

  // ── Plan summary ────────────────────────────────────────────────────
  const totalInserts = ordersNeedingDeliveries.length + jobsNeedingHistory.length
  const totalReclassify = bogusCompletes.length
  console.log(`\n${divider}`)
  console.log(`PLAN: insert ${totalInserts} Delivery rows, reclassify ${totalReclassify}`)
  console.log(`  Section D (reclassify bogus COMPLETEs):      ${totalReclassify}`)
  console.log(`  Section B (open-order SCHEDULED/IN_TRANSIT): ${ordersNeedingDeliveries.length}`)
  console.log(`  Section C (historical COMPLETE):             ${jobsNeedingHistory.length}`)
  console.log(divider)

  if (!APPLY) {
    // Show a small sample of each pass so the user can eyeball it
    const sampleD_sched = reclassPlan.SCHEDULED.slice(0, 3)
    const sampleD_trans = reclassPlan.IN_TRANSIT.slice(0, 3)
    const sampleD_comp = reclassPlan.COMPLETE.slice(0, 3)
    const sampleB = ordersNeedingDeliveries.slice(0, 3)
    const sampleC = jobsNeedingHistory.slice(0, 3)

    if (sampleD_sched.length) {
      console.log('\nSample (D → SCHEDULED):')
      for (const r of sampleD_sched) {
        console.log(`  · ${r.deliveryNumber} linked-job ${r.jobStatus}`)
      }
    }
    if (sampleD_trans.length) {
      console.log('\nSample (D → IN_TRANSIT):')
      for (const r of sampleD_trans) {
        console.log(`  · ${r.deliveryNumber} linked-job ${r.jobStatus}`)
      }
    }
    if (sampleD_comp.length) {
      console.log('\nSample (D → COMPLETE w/ completedAt stamped):')
      for (const r of sampleD_comp) {
        console.log(`  · ${r.deliveryNumber} linked-job ${r.jobStatus} stamp=${fmtDate(r.actualDate || r.jobCompletedAt || r.jobUpdatedAt)}`)
      }
    }
    if (sampleB.length) {
      console.log('\nSample (B, orders):')
      for (const r of sampleB) {
        console.log(`  · ${r.orderNumber} [${r.orderStatus}] job ${r.jobId.slice(0, 10)}… @ ${truncate(r.jobAddress || r.builderAddress, 48)}`)
      }
    }
    if (sampleC.length) {
      console.log('\nSample (C, jobs):')
      for (const r of sampleC) {
        console.log(`  · ${r.jobNumber} DELIVERED @ ${truncate(r.jobAddress || r.builderAddress, 48)}  (completed ${fmtDate(r.completedAt || r.updatedAt)})`)
      }
    }
    console.log('\nDRY RUN — no writes. Re-run with --apply to execute.\n')
    await prisma.$disconnect()
    return
  }

  // ── APPLY ───────────────────────────────────────────────────────────
  let liveCursor = await initNumberCursor(`DEL-${year}-`)
  let histCursor = await initNumberCursor(`DEL-HIST-${year}-`)

  let reclassifiedD = 0
  let insertedB = 0
  let insertedC = 0
  let errors = 0

  // Section D — reclassify bogus COMPLETEs first, so Section B idempotency
  // (which skips jobs that already have any non-cancelled delivery) still
  // holds. (B is keyed on Order.status + jobId; D doesn't create new rows.)
  const backfillMarker =
    '[LIFECYCLE-BACKFILL]: status reclassified from bogus COMPLETE on ' +
    new Date().toISOString().slice(0, 10)

  // SCHEDULED bucket: strip completedAt/arrivedAt, flip status.
  for (const r of reclassPlan.SCHEDULED) {
    try {
      await prisma.$executeRawUnsafe(
        `UPDATE "Delivery"
         SET "status" = 'SCHEDULED'::"DeliveryStatus",
             "completedAt" = NULL,
             "arrivedAt" = NULL,
             "departedAt" = NULL,
             "notes" = CASE WHEN "notes" IS NULL OR "notes" = ''
                            THEN $2
                            ELSE "notes" || E'\n' || $2 END,
             "updatedAt" = NOW()
         WHERE "id" = $1`,
        r.deliveryId, backfillMarker
      )
      reclassifiedD++
    } catch (err) {
      errors++
      console.error(`  ! D/SCHEDULED update failed ${r.deliveryNumber}: ${err.message}`)
    }
  }

  // IN_TRANSIT bucket: driver should have departed but we don't know when.
  // Stamp departedAt with the Job.updatedAt as a best-effort.
  for (const r of reclassPlan.IN_TRANSIT) {
    const depTs = r.jobUpdatedAt || new Date()
    try {
      await prisma.$executeRawUnsafe(
        `UPDATE "Delivery"
         SET "status" = 'IN_TRANSIT'::"DeliveryStatus",
             "completedAt" = NULL,
             "arrivedAt" = NULL,
             "departedAt" = $2,
             "notes" = CASE WHEN "notes" IS NULL OR "notes" = ''
                            THEN $3
                            ELSE "notes" || E'\n' || $3 END,
             "updatedAt" = NOW()
         WHERE "id" = $1`,
        r.deliveryId, depTs, backfillMarker
      )
      reclassifiedD++
    } catch (err) {
      errors++
      console.error(`  ! D/IN_TRANSIT update failed ${r.deliveryNumber}: ${err.message}`)
    }
  }

  // COMPLETE bucket: keep status COMPLETE but stamp completedAt from Job so
  // the on-time metric works. We leave the Delivery row otherwise untouched.
  for (const r of reclassPlan.COMPLETE) {
    const stamp = r.actualDate || r.jobCompletedAt || r.jobUpdatedAt || new Date()
    try {
      await prisma.$executeRawUnsafe(
        `UPDATE "Delivery"
         SET "completedAt" = $2,
             "arrivedAt" = COALESCE("arrivedAt", $2),
             "notes" = CASE WHEN "notes" IS NULL OR "notes" = ''
                            THEN $3
                            ELSE "notes" || E'\n' || $3 END,
             "updatedAt" = NOW()
         WHERE "id" = $1`,
        r.deliveryId, stamp, backfillMarker + ' (completedAt stamped from Job)'
      )
      reclassifiedD++
    } catch (err) {
      errors++
      console.error(`  ! D/COMPLETE update failed ${r.deliveryNumber}: ${err.message}`)
    }
  }

  // UNKNOWN bucket: no linked job or unhandled status. Leave as-is but log.
  if (reclassPlan.UNKNOWN.length > 0) {
    console.log(`   (${reclassPlan.UNKNOWN.length} rows in UNKNOWN bucket — left as-is for manual review)`)
  }

  // Section B — open-order deliveries
  for (const r of ordersNeedingDeliveries) {
    const address = buildAddress(r)

    let status, departedAt
    if (r.orderStatus === 'READY_TO_SHIP') {
      status = 'SCHEDULED'
      departedAt = null
    } else {
      // SHIPPED, PARTIAL_SHIPPED — already on the road, best-effort departedAt
      status = 'IN_TRANSIT'
      departedAt = new Date()
    }

    liveCursor++
    const deliveryNumber = `DEL-${year}-${pad(liveCursor)}`
    const deliveryId = makeDeliveryId()

    try {
      await prisma.$executeRawUnsafe(
        `INSERT INTO "Delivery" (
          "id", "jobId", "deliveryNumber", "routeOrder",
          "address", "status", "departedAt",
          "createdAt", "updatedAt"
        ) VALUES (
          $1, $2, $3, 0, $4, $5::"DeliveryStatus", $6, NOW(), NOW()
        )`,
        deliveryId, r.jobId, deliveryNumber, address, status, departedAt
      )
      insertedB++
    } catch (err) {
      errors++
      console.error(`  ! insert failed for order ${r.orderNumber}: ${err.message}`)
    }
  }

  // Section C — historical COMPLETE repair
  for (const r of jobsNeedingHistory) {
    const address = buildAddress(r)
    const completedAt = r.actualDate || r.completedAt || r.updatedAt || new Date()

    histCursor++
    const deliveryNumber = `DEL-HIST-${year}-${pad(histCursor)}`
    const deliveryId = makeDeliveryId()

    try {
      await prisma.$executeRawUnsafe(
        `INSERT INTO "Delivery" (
          "id", "jobId", "deliveryNumber", "routeOrder",
          "address", "status", "completedAt", "arrivedAt",
          "notes",
          "createdAt", "updatedAt"
        ) VALUES (
          $1, $2, $3, 0, $4, 'COMPLETE'::"DeliveryStatus", $5, $5,
          '[HISTORICAL-BACKFILL]: delivery row reconstructed from Job.status=DELIVERED — no original lifecycle trail.',
          NOW(), NOW()
        )`,
        deliveryId, r.jobId, deliveryNumber, address, completedAt
      )
      insertedC++
    } catch (err) {
      errors++
      console.error(`  ! insert failed for job ${r.jobNumber}: ${err.message}`)
    }
  }

  console.log('\nAPPLY results:')
  console.log(`   Section D reclassified:  ${reclassifiedD}`)
  console.log(`   Section B inserted:      ${insertedB}`)
  console.log(`   Section C inserted:      ${insertedC}`)
  console.log(`   Errors:                  ${errors}`)

  // ── After state ─────────────────────────────────────────────────────
  const afterCounts = await prisma.$queryRawUnsafe(
    `SELECT "status"::text AS s, COUNT(*)::int AS c
     FROM "Delivery" GROUP BY "status" ORDER BY c DESC`
  )
  console.log('\nAfter — Delivery status counts:')
  for (const r of afterCounts) console.log(`   ${r.s.padEnd(18)} ${r.c}`)
  console.log()

  await prisma.$disconnect()
}

/**
 * Classify a bogus COMPLETE Delivery's target status based on its Job's status.
 *  - Pre-ship Job states (materials still in the yard) → SCHEDULED
 *  - INSTALLING and beyond (materials already on site) → COMPLETE
 *    (we can't reconstruct an accurate IN_TRANSIT for these — the truck
 *    has long since returned; just mark the delivery done with best-effort
 *    completedAt pulled from the Job timeline.)
 */
function classifyByJobStatus(jobStatus) {
  switch (jobStatus) {
    case 'CREATED':
    case 'READINESS_CHECK':
    case 'MATERIALS_LOCKED':
    case 'STAGED':
    case 'IN_PRODUCTION':
      return 'SCHEDULED'
    case 'INSTALLING':
    case 'DELIVERED':
    case 'PUNCH_LIST':
    case 'COMPLETE':
    case 'INVOICED':
    case 'CLOSED':
      return 'COMPLETE'
    default:
      return 'UNKNOWN'
  }
}

function buildAddress(r) {
  return (
    r.jobAddress ||
    [r.builderAddress, r.builderCity, r.builderState, r.builderZip]
      .filter(Boolean)
      .join(', ') ||
    'TBD'
  )
}

function truncate(s, n) {
  if (!s) return ''
  return s.length > n ? s.slice(0, n - 1) + '…' : s
}

function fmtDate(d) {
  if (!d) return '—'
  try {
    return new Date(d).toISOString().slice(0, 10)
  } catch {
    return '—'
  }
}

main().catch(err => {
  console.error('FATAL:', err)
  prisma.$disconnect()
  process.exit(1)
})
