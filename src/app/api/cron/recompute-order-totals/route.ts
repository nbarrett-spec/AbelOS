/**
 * Cron: Recompute Order Totals (W1-ORDER-TOTAL backfill)
 *
 * Background — SCAN-A2 finding F1
 * ────────────────────────────────────────────────────────────────────────
 * As of 2026-04-27, 4180 / 4574 Orders (91%) had a cached `Order.total`
 * that disagreed with `SUM(OrderItem.lineTotal)` by more than $0.01. Net
 * dollar drift was $1.7M overstatement; abs drift $2.1M.
 *
 * Root cause is upstream and not fixed by this cron — `POST /api/ops/orders`
 * copies `total/subtotal` from the source Quote at creation, and no Order
 * mutation handler recomputes after items change. Fixing those handlers is
 * a separate W1 task.
 *
 * What this cron does
 * ────────────────────────────────────────────────────────────────────────
 *   1. Pulls every Order id (full sweep — set is small enough at ~4.5K).
 *   2. For each, computes
 *        recomputedSubtotal = SUM(OrderItem.lineTotal)
 *        recomputedTotal    = recomputedSubtotal + taxAmount + shippingCost
 *   3. If |cached - recomputed| > $0.01 on either field, UPDATEs the row.
 *      Touches ONLY `subtotal` and `total`. Leaves taxAmount, shippingCost,
 *      paymentStatus, status, etc. alone.
 *   4. Re-running yields zero updates once everything is in sync.
 *
 * Why trust lineTotal (not qty * unitPrice)?
 * ────────────────────────────────────────────────────────────────────────
 * SCAN-A2 F5 documents 1377 OrderItem rows where lineTotal != qty*unitPrice
 * — these are imported InFlow lines with rounding/discount baked in. The
 * scan recommends "Trust lineTotal (the imported truth)" so we sum that
 * column directly.
 *
 * Auth: CRON_SECRET bearer.
 * Schedule: every 4 hours (vercel.json). Tracked via withCronRun().
 */

export const dynamic = 'force-dynamic'
export const maxDuration = 300

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { withCronRun } from '@/lib/cron'

// Drift threshold — anything inside one cent is considered in-sync. Floats
// being floats, never compare for exact equality.
const DRIFT_EPSILON = 0.01

interface RecomputeResult {
  scanned: number
  updated: number
  totalDriftAbs: number
  totalDriftNet: number
  durationMs: number
  // Index signature so the result satisfies logger's LogContext shape
  // ({ [key: string]: unknown }) when passed to logger.info().
  [key: string]: unknown
}

async function recomputeOrderTotals(): Promise<RecomputeResult> {
  const started = Date.now()

  // Single set-based diff query: pulls every Order joined to its summed
  // items in one shot, returns ONLY the rows that need a write. The cron
  // is full-sweep (the table is small), but the response payload is the
  // drift set, so the work scales with drift, not with table size.
  //
  // - LEFT JOIN + COALESCE handles orders with zero items (recomputed = 0).
  // - We pull `taxAmount` and `shippingCost` straight from the row so the
  //   recomputed total uses the row's own tax/shipping; we never modify
  //   those columns.
  const drifters = await prisma.$queryRawUnsafe<
    Array<{
      id: string
      orderNumber: string
      cachedSubtotal: number
      cachedTotal: number
      taxAmount: number
      shippingCost: number
      recomputedSubtotal: number
      recomputedTotal: number
    }>
  >(`
    WITH item_totals AS (
      SELECT "orderId", COALESCE(SUM("lineTotal"), 0)::float AS sub
      FROM "OrderItem"
      GROUP BY "orderId"
    )
    SELECT
      o."id"                                                    AS "id",
      o."orderNumber"                                           AS "orderNumber",
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
  `, DRIFT_EPSILON)

  const totalRowsResult = await prisma.$queryRawUnsafe<Array<{ count: number }>>(
    `SELECT COUNT(*)::int AS count FROM "Order"`
  )
  const scanned = Number(totalRowsResult[0]?.count || 0)

  let updated = 0
  let totalDriftAbs = 0
  let totalDriftNet = 0

  for (const row of drifters) {
    const newSubtotal = Number(row.recomputedSubtotal)
    const newTotal = Number(row.recomputedTotal)
    const cachedTotal = Number(row.cachedTotal)
    const driftSigned = cachedTotal - newTotal // positive = cached overstated
    totalDriftAbs += Math.abs(driftSigned)
    totalDriftNet += driftSigned

    // Idempotent: parameterized UPDATE on a single Order. Only writes
    // subtotal + total. Doesn't bump updatedAt (we leave that for the
    // upstream CRUD handlers when they actually edit business state).
    await prisma.$executeRawUnsafe(
      `UPDATE "Order"
         SET "subtotal" = $2,
             "total"    = $3
       WHERE "id" = $1`,
      row.id,
      newSubtotal,
      newTotal
    )
    updated++
  }

  const durationMs = Date.now() - started
  return {
    scanned,
    updated,
    totalDriftAbs: Math.round(totalDriftAbs * 100) / 100,
    totalDriftNet: Math.round(totalDriftNet * 100) / 100,
    durationMs,
  }
}

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret || !authHeader?.startsWith('Bearer ')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const token = authHeader.slice(7)
  if (token !== cronSecret) {
    return NextResponse.json({ error: 'Invalid cron secret' }, { status: 401 })
  }

  return withCronRun('recompute-order-totals', async () => {
    const result = await recomputeOrderTotals()
    logger.info('recompute_order_totals_complete', result)
    return NextResponse.json(result)
  })
}
