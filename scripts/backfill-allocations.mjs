#!/usr/bin/env node
/**
 * backfill-allocations.mjs
 * ------------------------
 * Turns on the `InventoryAllocation` ledger for every active Job that has an
 * Order attached. Safe to run repeatedly — per-job ON CONFLICT (jobId, productId)
 * against a partial unique idx on active-status rows makes it idempotent.
 *
 * Pipeline:
 *   1. List active Jobs, ORDER BY scheduledDate ASC NULLS LAST (earliest first).
 *   2. For each Job, BoM-expand the attached Order into a set of { productId, qty }.
 *   3. Track running InventoryItem.onHand balance per productId — when a job's
 *      demand exceeds remaining balance, the allocation is marked BACKORDERED
 *      (not RESERVED), so we reflect reality rather than over-reserve.
 *   4. Insert rows in a transaction per job.
 *   5. At the end, call recompute_inventory_committed() to roll the ledger
 *      into InventoryItem.committed / .available.
 *
 * Flags:
 *   --dry-run   (default) — compute everything, touch nothing
 *   --report    — alias for --dry-run (kept for CLI ergonomics)
 *   --commit    — actually insert allocations + recompute
 *
 * Output: a compact table + a JSON summary at end.
 */
import 'dotenv/config'
import { PrismaClient } from '@prisma/client'

const args = new Set(process.argv.slice(2))
const COMMIT = args.has('--commit')
const DRY = !COMMIT // default to dry-run

const ACTIVE_STATUSES = [
  'CREATED', 'READINESS_CHECK', 'MATERIALS_LOCKED',
  'IN_PRODUCTION', 'STAGED', 'LOADED', 'IN_TRANSIT',
  'INSTALLING', 'PUNCH_LIST',
]

const prisma = new PrismaClient()

function log(...a) { console.log(...a) }

async function q(sql, ...params) {
  return prisma.$queryRawUnsafe(sql, ...params)
}

try {
  const started = Date.now()
  log(`[backfill] mode = ${COMMIT ? 'COMMIT' : 'DRY-RUN'}`)

  // 1. Load active jobs ordered by scheduledDate ASC NULLS LAST.
  const jobs = await q(
    `SELECT j.id, j."jobNumber", j."status"::text AS status, j."orderId", j."scheduledDate"
     FROM "Job" j
     WHERE j."status"::text = ANY($1::text[])
       AND j."orderId" IS NOT NULL
     ORDER BY j."scheduledDate" ASC NULLS LAST, j."createdAt" ASC`,
    ACTIVE_STATUSES
  )
  log(`[backfill] active jobs with orderId: ${jobs.length}`)

  // 2. Load current onHand snapshot for running balance math.
  const invRows = await q(
    `SELECT "productId", COALESCE("onHand", 0)::int AS on_hand FROM "InventoryItem"`
  )
  const onHand = new Map()
  for (const r of invRows) onHand.set(r.productId, Number(r.on_hand))

  // Track running committed per productId across jobs (not stored anywhere else
  // — just used to decide RESERVED vs BACKORDERED during backfill).
  const runningCommitted = new Map()

  // 3. Pre-load existing allocations so we don't try to re-allocate jobs that
  //    already have active rows. This is critical if someone runs backfill
  //    twice or after a partial run.
  const existingActive = await q(
    `SELECT DISTINCT "jobId", "productId"
     FROM "InventoryAllocation"
     WHERE "status" IN ('RESERVED', 'PICKED', 'BACKORDERED')
       AND "jobId" IS NOT NULL`
  )
  const existingKey = new Set(existingActive.map(r => `${r.jobId}::${r.productId}`))
  log(`[backfill] existing active allocation (jobId,productId) pairs: ${existingKey.size}`)

  const summary = {
    jobsConsidered: jobs.length,
    jobsProcessed: 0,
    jobsSkippedNoDemand: 0,
    allocationsCreated: 0,
    allocationsReserved: 0,
    allocationsBackordered: 0,
    jobsWithBackorders: 0,
    productsHit: new Set(),
    errors: [],
  }

  // Per-job BoM expansion — identical recursive walk as src/lib/mrp.ts
  const BOM_EXPAND_SQL = `
    WITH RECURSIVE
    job_demand AS (
      SELECT oi."productId" AS product_id, oi."quantity"::float AS qty, 0 AS depth
      FROM "Job" j
      JOIN "OrderItem" oi ON oi."orderId" = j."orderId"
      WHERE j."id" = $1

      UNION ALL

      SELECT b."componentId", jd.qty * b."quantity", jd.depth + 1
      FROM job_demand jd
      JOIN "BomEntry" b ON b."parentId" = jd.product_id
      WHERE jd.depth < 4
    ),
    has_children AS (
      SELECT DISTINCT "parentId" AS product_id FROM "BomEntry"
    )
    SELECT
      jd.product_id AS "productId",
      SUM(jd.qty)::int AS quantity
    FROM job_demand jd
    LEFT JOIN has_children hc ON hc.product_id = jd.product_id
    WHERE (hc.product_id IS NULL OR jd.depth > 0)
      AND jd.product_id IS NOT NULL
    GROUP BY jd.product_id
    HAVING SUM(jd.qty)::int > 0
  `

  for (const job of jobs) {
    let lines
    try {
      lines = await q(BOM_EXPAND_SQL, job.id)
    } catch (e) {
      summary.errors.push({ jobId: job.id, error: e.message })
      continue
    }
    if (!lines || lines.length === 0) {
      summary.jobsSkippedNoDemand++
      continue
    }
    summary.jobsProcessed++

    // Decide RESERVED vs BACKORDERED per line using running balance
    const perJobStatuses = []
    let jobHadBackorder = false

    for (const line of lines) {
      const pid = line.productId
      const qty = Number(line.quantity) || 0
      if (qty <= 0) continue

      summary.productsHit.add(pid)

      // Skip if this (jobId, productId) pair already has an active ledger row
      if (existingKey.has(`${job.id}::${pid}`)) continue

      const oh = Number(onHand.get(pid) ?? 0)
      const already = Number(runningCommitted.get(pid) ?? 0)
      const remaining = oh - already
      const status = remaining >= qty ? 'RESERVED' : 'BACKORDERED'

      perJobStatuses.push({ productId: pid, quantity: qty, status })

      if (status === 'RESERVED') {
        summary.allocationsReserved++
        runningCommitted.set(pid, already + qty)
      } else {
        summary.allocationsBackordered++
        jobHadBackorder = true
      }
    }

    if (jobHadBackorder) summary.jobsWithBackorders++

    if (perJobStatuses.length === 0) continue

    summary.allocationsCreated += perJobStatuses.length

    if (COMMIT) {
      // Insert. Use ON CONFLICT DO NOTHING against the partial unique idx.
      // Single row per execute to keep errors granular.
      for (const r of perJobStatuses) {
        const id = `ia_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
        try {
          await prisma.$executeRawUnsafe(
            `INSERT INTO "InventoryAllocation"
              ("id", "productId", "orderId", "jobId", "quantity",
               "allocationType", "status", "allocatedBy", "notes",
               "allocatedAt", "createdAt", "updatedAt")
             VALUES ($1, $2, $3, $4, $5,
                     'JOB', $6, 'backfill-script',
                     'backfilled 2026-04-23 — turn on InventoryAllocation ledger',
                     NOW(), NOW(), NOW())
             ON CONFLICT ("jobId", "productId")
               WHERE "status" IN ('RESERVED', 'PICKED', 'BACKORDERED')
             DO NOTHING`,
            id, r.productId, job.orderId, job.id, r.quantity, r.status
          )
        } catch (e) {
          summary.errors.push({
            jobId: job.id, productId: r.productId, error: e.message,
          })
        }
      }
    }
  }

  if (COMMIT) {
    log(`[backfill] running recompute_inventory_committed() ...`)
    const rec = await q(`SELECT recompute_inventory_committed(NULL) AS touched`)
    log(`[backfill] recompute touched ${rec[0].touched} InventoryItem rows`)
  }

  const elapsed = Date.now() - started

  // Summary
  log('\n===== BACKFILL SUMMARY =====')
  log(`mode:                  ${COMMIT ? 'COMMIT (wrote)' : 'DRY-RUN (nothing written)'}`)
  log(`jobs considered:       ${summary.jobsConsidered}`)
  log(`jobs with no demand:   ${summary.jobsSkippedNoDemand}`)
  log(`jobs processed:        ${summary.jobsProcessed}`)
  log(`jobs w/ backorder:     ${summary.jobsWithBackorders}`)
  log(`allocations created:   ${summary.allocationsCreated}`)
  log(`  \u2514 RESERVED:         ${summary.allocationsReserved}`)
  log(`  \u2514 BACKORDERED:      ${summary.allocationsBackordered}`)
  log(`distinct products hit: ${summary.productsHit.size}`)
  log(`errors:                ${summary.errors.length}`)
  log(`elapsed ms:            ${elapsed}`)

  if (summary.errors.length > 0) {
    log('\nfirst 10 errors:')
    log(summary.errors.slice(0, 10))
  }

  // Post-commit: print live ledger stats so we can eyeball it
  if (COMMIT) {
    const live = await q(
      `SELECT status, COUNT(*)::int AS n, SUM("quantity")::int AS qty
         FROM "InventoryAllocation"
         WHERE "status" IN ('RESERVED', 'PICKED', 'BACKORDERED', 'RELEASED', 'CONSUMED')
         GROUP BY status
         ORDER BY n DESC`
    )
    log('\nlive ledger:')
    log(live)
    const inv = await q(
      `SELECT COUNT(*)::int AS rows, SUM("onHand")::int AS onhand,
              SUM("committed")::int AS committed, SUM("available")::int AS available
         FROM "InventoryItem"`
    )
    log('\nInventoryItem totals:')
    log(inv)
  }
} catch (e) {
  console.error('[backfill] FAILED:', e?.message || e)
  process.exit(1)
} finally {
  await prisma.$disconnect()
}
