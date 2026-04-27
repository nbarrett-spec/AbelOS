#!/usr/bin/env node
// One-shot: recompute Order.subtotal + Order.total from OrderItem.lineTotal.
//
// Closes SCAN-A2 finding F1: 4180/4574 Orders had stale cached `total`,
// $1.7M net drift. Mirrors logic in /api/cron/recompute-order-totals.
//
// Default: DRY-RUN. Logs scanned, drifted, top-10 worst drifters, and
// total drift recovered. Pass `--apply` to commit the UPDATE.
//
// Idempotent — re-running on a clean dataset reports `drifted: 0`.
//
// Trust model (per SCAN-A2 F5): treat OrderItem.lineTotal as the imported
// truth. Sum lineTotal for subtotal; total = subtotal + taxAmount + shippingCost.
//
// Usage:
//   node scripts/_recompute-order-totals.mjs            # dry-run
//   node scripts/_recompute-order-totals.mjs --apply    # commit writes

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const APPLY = process.argv.includes('--apply')
const DRIFT_EPSILON = 0.01
const TOP_N = 10

// Selects every drifted Order in one diff query. Same shape as the cron.
const DRIFT_QUERY = `
  WITH item_totals AS (
    SELECT "orderId", COALESCE(SUM("lineTotal"), 0)::float AS sub
    FROM "OrderItem"
    GROUP BY "orderId"
  )
  SELECT
    o."id"                                                    AS "id",
    o."orderNumber"                                           AS "orderNumber",
    o."status"::text                                          AS "status",
    o."subtotal"::float                                       AS "cachedSubtotal",
    o."total"::float                                          AS "cachedTotal",
    o."taxAmount"::float                                      AS "taxAmount",
    o."shippingCost"::float                                   AS "shippingCost",
    COALESCE(it.sub, 0)::float                                AS "recomputedSubtotal",
    (COALESCE(it.sub, 0) + o."taxAmount" + o."shippingCost")::float
                                                              AS "recomputedTotal"
  FROM "Order" o
  LEFT JOIN item_totals it ON it."orderId" = o."id"
  WHERE
    ABS(o."subtotal" - COALESCE(it.sub, 0)) > $1
    OR ABS(o."total" - (COALESCE(it.sub, 0) + o."taxAmount" + o."shippingCost")) > $1
`

const APPLY_UPDATE_QUERY = `
  UPDATE "Order"
     SET "subtotal" = $2,
         "total"    = $3
   WHERE "id" = $1
`

function fmtMoney(n) {
  const sign = n < 0 ? '-' : ''
  const abs = Math.abs(n)
  return `${sign}$${abs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

async function main() {
  console.log('═'.repeat(72))
  console.log('Recompute Order Totals — ' + (APPLY ? 'APPLY MODE (will write)' : 'DRY RUN (no writes)'))
  console.log('═'.repeat(72))

  const totalRowsResult = await prisma.$queryRawUnsafe(
    `SELECT COUNT(*)::int AS count FROM "Order"`
  )
  const scanned = Number(totalRowsResult[0]?.count || 0)

  const drifters = await prisma.$queryRawUnsafe(DRIFT_QUERY, DRIFT_EPSILON)

  console.log(`\nScanned:    ${scanned} orders`)
  console.log(`Drifted:    ${drifters.length} orders need rewrite`)

  if (drifters.length === 0) {
    console.log('\nNothing to do. All Order.subtotal/total in sync with OrderItem.lineTotal.')
    return
  }

  // Worst drifters by |cached total - recomputed total|.
  const sorted = drifters
    .map((r) => ({
      ...r,
      driftAbs: Math.abs(Number(r.cachedTotal) - Number(r.recomputedTotal)),
      driftSigned: Number(r.cachedTotal) - Number(r.recomputedTotal),
    }))
    .sort((a, b) => b.driftAbs - a.driftAbs)

  // Aggregate: total dollars to recover.
  let totalDriftAbs = 0
  let totalDriftNet = 0
  const byStatus = new Map()
  for (const r of sorted) {
    totalDriftAbs += r.driftAbs
    totalDriftNet += r.driftSigned
    const s = r.status || 'UNKNOWN'
    byStatus.set(s, (byStatus.get(s) || 0) + 1)
  }

  console.log(`\nTotal drift:`)
  console.log(`  abs : ${fmtMoney(totalDriftAbs)}`)
  console.log(`  net : ${fmtMoney(totalDriftNet)}  (positive = cached overstated)`)

  console.log(`\nDrift count by Order.status:`)
  const statusRows = Array.from(byStatus.entries()).sort((a, b) => b[1] - a[1])
  for (const [status, n] of statusRows) {
    console.log(`  ${status.padEnd(20)} ${n}`)
  }

  console.log(`\nTop ${TOP_N} worst drifters (cached total → recomputed total):`)
  console.log(`  ${'orderNumber'.padEnd(14)} ${'status'.padEnd(18)} ${'cachedTotal'.padStart(14)} ${'recomputed'.padStart(14)} ${'drift'.padStart(14)}`)
  for (const r of sorted.slice(0, TOP_N)) {
    console.log(
      `  ${String(r.orderNumber || r.id).padEnd(14)} ` +
      `${String(r.status || '-').padEnd(18)} ` +
      `${fmtMoney(Number(r.cachedTotal)).padStart(14)} ` +
      `${fmtMoney(Number(r.recomputedTotal)).padStart(14)} ` +
      `${fmtMoney(r.driftSigned).padStart(14)}`
    )
  }

  if (!APPLY) {
    console.log(`\n[DRY RUN] No writes performed. Re-run with --apply to commit.`)
    return
  }

  console.log(`\nApplying updates to ${drifters.length} orders...`)
  let written = 0
  for (const r of sorted) {
    await prisma.$executeRawUnsafe(
      APPLY_UPDATE_QUERY,
      r.id,
      Number(r.recomputedSubtotal),
      Number(r.recomputedTotal)
    )
    written++
    if (written % 500 === 0) {
      console.log(`  …${written}/${drifters.length}`)
    }
  }
  console.log(`\nWrote ${written} rows.`)
  console.log(`Drift recovered (abs): ${fmtMoney(totalDriftAbs)}`)
  console.log(`Drift recovered (net): ${fmtMoney(totalDriftNet)}`)

  // Verify idempotency: run the diff query again, assert empty.
  const recheck = await prisma.$queryRawUnsafe(DRIFT_QUERY, DRIFT_EPSILON)
  if (recheck.length === 0) {
    console.log(`\nVerified: 0 remaining drifters. Idempotent — re-running is a no-op.`)
  } else {
    console.warn(`\nWARNING: ${recheck.length} orders still drift after apply. Investigate.`)
  }
}

main()
  .catch((e) => {
    console.error('\nFAILED:', e?.message || e)
    if (e?.stack) console.error(e.stack)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
