#!/usr/bin/env node
// scripts/backfill-order-jobs.mjs
//
// Backfill Job rows for historical Orders that should have had one.
//
// Context: the order-lifecycle cascade (src/lib/cascades/order-lifecycle.ts —
// `onOrderConfirmed`) creates a Job when an Order moves into CONFIRMED or
// beyond. Until that helper was wired in, thousands of historical orders
// came in (from InFlow, Hyphen, direct entry) without ever getting a Job
// row. As of this snapshot: 3,203 non-job orders — 9 CONFIRMED, 200
// RECEIVED, 2,974 DELIVERED (1,526 over 1 year old, 1,448 within), 20
// CANCELLED. RECEIVED and CANCELLED are intentionally skipped (no Job
// expected yet / ever). Everything else should have had a Job.
//
// Strategy (dry-run by default; `--apply` to write):
//
//   1. Pull every Order where:
//        o.status NOT IN ('CANCELLED', 'DRAFT')
//        AND no Job exists linking to it (Job.orderId = Order.id)
//
//   2. Classify each:
//        CREATE_JOB
//          — status in CONFIRMED / IN_PRODUCTION / AWAITING_MATERIAL /
//            READY_TO_SHIP / PARTIAL_SHIPPED / SHIPPED / DELIVERED /
//            COMPLETE. A Job should have existed.
//        SKIP
//          — RECEIVED (Job not yet expected) or CANCELLED/DRAFT.
//        HISTORICAL_COMPLETE
//          — DELIVERED/COMPLETE AND orderDate > 1 year ago. Still in the
//            CREATE_JOB bucket, just flagged so the report distinguishes
//            clean-up noise from recent-active backfill.
//
//   3. For each CREATE_JOB: use the same INSERT pattern as
//      src/lib/cascades/order-lifecycle.ts `onOrderConfirmed` (idempotent
//      existence check, JOB-YYYY-NNNN numbering, scopeType DOORS_AND_TRIM,
//      builderName denorm from Builder.companyName). We replicate instead
//      of importing because the cascade module is TS under @/ aliases and
//      this is a plain .mjs script — same pattern as the other backfills
//      in this directory (backfill-pm-assignments.mjs etc.).
//
//   4. Set Job.status to match the Order's progression:
//        Order DELIVERED or COMPLETE → Job CLOSED
//        Order SHIPPED or PARTIAL_SHIPPED → Job DELIVERED
//        Order READY_TO_SHIP          → Job STAGED
//        Order IN_PRODUCTION          → Job IN_PRODUCTION
//        Order AWAITING_MATERIAL      → Job IN_PRODUCTION
//        Order CONFIRMED              → Job CREATED
//      For Jobs set to CLOSED/DELIVERED/COMPLETE we also stamp completedAt
//      = Order.updatedAt (best-effort defensible timestamp).
//
//   5. Round-robin assignedPMId across the canonical PM roster (Chad Zeh,
//      Brittney Werner, Thomas Robinson, Ben Wilson), matching the
//      pattern in backfill-pm-assignments.mjs. Only applied to jobs we
//      create — pre-existing jobs are left alone (that's owned by the
//      PM-assignment backfill script).
//
//   6. Batch writes in chunks of 100 with progress logging. Each chunk
//      is wrapped in a single prisma.$transaction.
//
// Idempotency: safe to re-run. Before every INSERT we re-check
// `Job.orderId = ?`. If a Job already exists (e.g. another operator
// ran the cascade between dry-run and apply) we skip that order.
//
// USAGE:
//   node scripts/backfill-order-jobs.mjs           # dry-run, prints plan
//   node scripts/backfill-order-jobs.mjs --apply   # execute writes
//
// DO NOT run --apply without reviewing the dry-run output first.

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
const APPLY = process.argv.includes('--apply')
const BATCH_SIZE = 100

// Canonical PM roster — same as scripts/backfill-pm-assignments.mjs.
const PM_ROSTER = [
  'Chad Zeh',
  'Brittney Werner',
  'Thomas Robinson',
  'Ben Wilson',
]

// Order status → Job status mapping per task spec.
const ORDER_TO_JOB_STATUS = {
  CONFIRMED: 'CREATED',
  IN_PRODUCTION: 'IN_PRODUCTION',
  AWAITING_MATERIAL: 'IN_PRODUCTION',
  READY_TO_SHIP: 'STAGED',
  SHIPPED: 'DELIVERED',
  PARTIAL_SHIPPED: 'DELIVERED',
  DELIVERED: 'CLOSED',
  COMPLETE: 'CLOSED',
}

// Job statuses that represent a finished lifecycle — stamp completedAt.
const COMPLETED_JOB_STATUSES = new Set(['CLOSED', 'DELIVERED', 'COMPLETE'])

function makeJobId() {
  return `job_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

function pad(n, w = 4) {
  return String(n).padStart(w, '0')
}

async function main() {
  const startedAt = Date.now()
  console.log(`\n${'='.repeat(74)}`)
  console.log(`Order → Job backfill  —  mode: ${APPLY ? 'APPLY' : 'DRY RUN'}`)
  console.log(`${'='.repeat(74)}\n`)

  // ── 1. Load candidate orders. ───────────────────────────────────────────
  const candidates = await prisma.$queryRawUnsafe(`
    SELECT o."id", o."orderNumber", o."builderId",
           o."status"::text AS status,
           o."deliveryDate", o."orderDate", o."updatedAt", o."createdAt",
           b."companyName" AS "builderName"
    FROM "Order" o
    LEFT JOIN "Builder" b ON b."id" = o."builderId"
    LEFT JOIN "Job" j ON j."orderId" = o."id"
    WHERE j."id" IS NULL
      AND o."status"::text NOT IN ('CANCELLED')
    ORDER BY o."orderDate" ASC NULLS LAST, o."createdAt" ASC
  `)
  console.log(`Candidate orphan orders (no Job, not CANCELLED): ${candidates.length}\n`)

  // ── 2. Classify each. ───────────────────────────────────────────────────
  const oneYearAgo = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000)

  const createJob = []        // Jobs we will create (recent + historical both end up here)
  const skip = []              // RECEIVED only in current scope
  const historicalComplete = [] // Subset of createJob: DELIVERED/COMPLETE AND > 1 year old

  const classCounts = {}

  for (const o of candidates) {
    const mapped = ORDER_TO_JOB_STATUS[o.status]
    if (!mapped) {
      // RECEIVED or anything else we don't touch.
      skip.push(o)
      classCounts['SKIP'] = (classCounts['SKIP'] || 0) + 1
      continue
    }
    createJob.push(o)
    classCounts['CREATE_JOB'] = (classCounts['CREATE_JOB'] || 0) + 1
    const isDoneStatus = o.status === 'DELIVERED' || o.status === 'COMPLETE'
    const refDate = o.orderDate ? new Date(o.orderDate) : new Date(o.createdAt)
    if (isDoneStatus && refDate < oneYearAgo) {
      historicalComplete.push(o)
      classCounts['HISTORICAL_COMPLETE'] = (classCounts['HISTORICAL_COMPLETE'] || 0) + 1
    }
  }

  console.log(`─── Classification ───`)
  console.log(`  CREATE_JOB:           ${classCounts['CREATE_JOB'] || 0}`)
  console.log(`      of which HISTORICAL_COMPLETE (>1yr, DELIVERED/COMPLETE):`)
  console.log(`                        ${classCounts['HISTORICAL_COMPLETE'] || 0}`)
  console.log(`  SKIP (RECEIVED only): ${classCounts['SKIP'] || 0}`)

  // Breakdown by status of CREATE_JOB for visibility.
  const byStatus = {}
  for (const o of createJob) byStatus[o.status] = (byStatus[o.status] || 0) + 1
  console.log(`\n  CREATE_JOB by order status:`)
  for (const [s, n] of Object.entries(byStatus).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${s.padEnd(20)} ${n}`)
  }

  if (createJob.length === 0) {
    console.log(`\nNothing to backfill. Done.`)
    await prisma.$disconnect()
    return
  }

  // ── 3. Load PM pool for round-robin. ────────────────────────────────────
  const allPms = await prisma.staff.findMany({
    where: {
      active: true,
      OR: [
        { role: 'PROJECT_MANAGER' },
        { roles: { contains: 'PROJECT_MANAGER' } },
      ],
    },
    select: { id: true, firstName: true, lastName: true, email: true },
  })
  const byFullName = new Map(
    allPms.map((s) => [`${s.firstName} ${s.lastName}`.toLowerCase(), s]),
  )
  const rosterPms = []
  const rosterMissing = []
  for (const name of PM_ROSTER) {
    const hit = byFullName.get(name.toLowerCase())
    if (hit) rosterPms.push(hit)
    else rosterMissing.push(name)
  }
  const pmPool = rosterPms.length > 0 ? rosterPms : allPms

  console.log(`\n─── PM pool ───`)
  console.log(`  Active PMs in Staff: ${allPms.length}`)
  console.log(`  Named roster matched: ${rosterPms.length} / ${PM_ROSTER.length}`)
  if (rosterMissing.length) {
    console.log(`  Missing from Staff: ${rosterMissing.join(', ')}`)
  }
  if (pmPool.length === 0) {
    console.log(`  (no PMs — new jobs will be created with assignedPMId=null)`)
  } else {
    for (const p of pmPool) {
      console.log(`   - ${p.firstName} ${p.lastName}  id=${p.id}`)
    }
  }

  // ── 4. Seed the job-number counter once. ────────────────────────────────
  const year = new Date().getFullYear()
  const maxRow = await prisma.$queryRawUnsafe(
    `SELECT COALESCE(MAX(CAST(SUBSTRING("jobNumber" FROM '[0-9]+$') AS INT)), 0) AS max_num
     FROM "Job" WHERE "jobNumber" LIKE $1`,
    `JOB-${year}-%`,
  )
  let nextJobNum = Number(maxRow[0]?.max_num || 0) + 1
  console.log(`\nJob number series: JOB-${year}-${pad(nextJobNum)} onward`)

  // ── 5. Build per-order plan (in memory, no writes yet). ─────────────────
  const plan = []
  let cursor = 0
  const perPm = new Map()
  const perJobStatus = new Map()

  for (const o of createJob) {
    const jobStatus = ORDER_TO_JOB_STATUS[o.status]
    const jobNumber = `JOB-${year}-${pad(nextJobNum++)}`
    const jobId = makeJobId()
    const assignedPMId = pmPool.length > 0 ? pmPool[cursor++ % pmPool.length].id : null
    const completedAt = COMPLETED_JOB_STATUSES.has(jobStatus)
      ? (o.updatedAt || o.createdAt || new Date())
      : null
    const scheduledDate = o.deliveryDate || null

    plan.push({
      orderId: o.id,
      orderNumber: o.orderNumber,
      orderStatus: o.status,
      builderName: o.builderName || 'Unknown Builder',
      jobId,
      jobNumber,
      jobStatus,
      assignedPMId,
      scheduledDate,
      completedAt,
    })
    if (assignedPMId) perPm.set(assignedPMId, (perPm.get(assignedPMId) || 0) + 1)
    perJobStatus.set(jobStatus, (perJobStatus.get(jobStatus) || 0) + 1)
  }

  // ── 6. Report plan. ─────────────────────────────────────────────────────
  console.log(`\n─── Job-creation plan ───`)
  console.log(`  Total jobs to create: ${plan.length}`)
  console.log(`\n  By resulting Job.status:`)
  for (const [s, n] of Array.from(perJobStatus.entries()).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${s.padEnd(20)} ${n}`)
  }
  if (pmPool.length > 0) {
    console.log(`\n  Round-robin PM assignment:`)
    const nameFor = new Map(pmPool.map((p) => [p.id, `${p.firstName} ${p.lastName}`]))
    for (const [pmId, n] of Array.from(perPm.entries()).sort((a, b) => b[1] - a[1])) {
      console.log(`    ${(nameFor.get(pmId) || pmId).padEnd(22)} ${n}`)
    }
  }
  console.log(`\n  Sample (first 5):`)
  for (const r of plan.slice(0, 5)) {
    console.log(
      `    ${r.jobNumber.padEnd(14)} ← ${r.orderNumber.padEnd(14)} status=${r.orderStatus.padEnd(16)} → job.${r.jobStatus}`,
    )
  }

  // ── 7. Apply? ───────────────────────────────────────────────────────────
  if (!APPLY) {
    console.log(`\nDry run. Re-run with --apply to execute.`)
    await prisma.$disconnect()
    return
  }

  console.log(`\nApplying ${plan.length} job inserts in batches of ${BATCH_SIZE}…`)
  let created = 0
  let skippedAlreadyExists = 0
  let failed = 0
  const failures = []

  for (let i = 0; i < plan.length; i += BATCH_SIZE) {
    const batch = plan.slice(i, i + BATCH_SIZE)

    // Idempotency: re-check which orderIds still have no Job just before write.
    const orderIds = batch.map((r) => r.orderId)
    const alreadyLinked = await prisma.$queryRawUnsafe(
      `SELECT "orderId" FROM "Job" WHERE "orderId" = ANY($1::text[])`,
      orderIds,
    )
    const linkedSet = new Set(alreadyLinked.map((r) => r.orderId))
    const toInsert = batch.filter((r) => !linkedSet.has(r.orderId))
    skippedAlreadyExists += batch.length - toInsert.length

    if (toInsert.length === 0) {
      process.stdout.write(
        `\r  batch ${Math.floor(i / BATCH_SIZE) + 1}  created=${created}  skipped=${skippedAlreadyExists}  failed=${failed}   `,
      )
      continue
    }

    try {
      await prisma.$transaction(
        toInsert.map((r) =>
          prisma.$executeRawUnsafe(
            `INSERT INTO "Job" (
              "id", "jobNumber", "orderId",
              "builderName", "scopeType", "status",
              "assignedPMId", "scheduledDate", "completedAt",
              "createdAt", "updatedAt"
            ) VALUES (
              $1, $2, $3,
              $4, 'DOORS_AND_TRIM'::"ScopeType", $5::"JobStatus",
              $6, $7, $8,
              NOW(), NOW()
            )`,
            r.jobId,
            r.jobNumber,
            r.orderId,
            r.builderName,
            r.jobStatus,
            r.assignedPMId,
            r.scheduledDate,
            r.completedAt,
          ),
        ),
      )
      created += toInsert.length
    } catch (e) {
      // Fall back to per-row inserts on batch failure so one bad row doesn't
      // nuke the whole chunk.
      for (const r of toInsert) {
        try {
          await prisma.$executeRawUnsafe(
            `INSERT INTO "Job" (
              "id", "jobNumber", "orderId",
              "builderName", "scopeType", "status",
              "assignedPMId", "scheduledDate", "completedAt",
              "createdAt", "updatedAt"
            ) VALUES (
              $1, $2, $3,
              $4, 'DOORS_AND_TRIM'::"ScopeType", $5::"JobStatus",
              $6, $7, $8,
              NOW(), NOW()
            )`,
            r.jobId,
            r.jobNumber,
            r.orderId,
            r.builderName,
            r.jobStatus,
            r.assignedPMId,
            r.scheduledDate,
            r.completedAt,
          )
          created += 1
        } catch (e2) {
          failed += 1
          if (failures.length < 10) {
            failures.push({ orderNumber: r.orderNumber, error: e2?.message })
          }
        }
      }
    }

    process.stdout.write(
      `\r  batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(plan.length / BATCH_SIZE)}  created=${created}  skipped=${skippedAlreadyExists}  failed=${failed}   `,
    )
  }
  console.log(`\n`)

  // ── 8. Re-count orphans + per-PM job totals. ────────────────────────────
  const orphanAfter = await prisma.$queryRawUnsafe(`
    SELECT o."status"::text AS status, COUNT(*)::int AS n
    FROM "Order" o
    LEFT JOIN "Job" j ON j."orderId" = o."id"
    WHERE j."id" IS NULL
    GROUP BY o."status"::text
    ORDER BY n DESC
  `)
  console.log(`─── Post-backfill orphan Orders (no Job) ───`)
  let orphanTotal = 0
  for (const r of orphanAfter) {
    console.log(`  ${r.status.padEnd(20)} ${r.n}`)
    orphanTotal += r.n
  }
  console.log(`  TOTAL                 ${orphanTotal}`)

  const perPmAfter = await prisma.$queryRawUnsafe(`
    SELECT COALESCE(s."firstName" || ' ' || s."lastName", '(unassigned)') AS pm,
           COUNT(*)::int AS n
    FROM "Job" j
    LEFT JOIN "Staff" s ON s."id" = j."assignedPMId"
    GROUP BY 1
    ORDER BY n DESC
  `)
  console.log(`\n─── Job counts per PM (post-backfill) ───`)
  for (const r of perPmAfter) {
    console.log(`  ${String(r.pm).padEnd(24)} ${r.n}`)
  }

  if (failures.length > 0) {
    console.log(`\nFirst ${failures.length} failures:`)
    for (const f of failures) console.log(`  ${f.orderNumber}: ${f.error}`)
  }

  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1)
  console.log(
    `\nFinished. created=${created}  skipped_already_linked=${skippedAlreadyExists}  failed=${failed}  elapsed=${elapsed}s`,
  )

  await prisma.$disconnect()
}

main().catch(async (e) => {
  console.error(e)
  await prisma.$disconnect()
  process.exit(1)
})
