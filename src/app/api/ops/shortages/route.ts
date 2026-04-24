export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'

/**
 * GET /api/ops/shortages
 *
 * Surfaces DemandForecast shortfalls for the ops floor:
 * joins DemandForecast → Product → InventoryItem → VendorProduct (preferred),
 * tallies open PO coverage, and counts jobs currently needing the SKU.
 *
 * Query params:
 *   horizon  = 7 | 14 | 30   (default 14) — forward-looking window in days
 *   severity = all | high    (default all) — "high" keeps only shortfall $ ≥ $250
 *              or days-of-coverage ≤ 3
 *   vendorId = <preferred vendor id>       — filter to one preferred vendor
 *
 * Data model note: DemandForecast is monthly (periodDays=30, forecastDate =
 * first-of-month). We pro-rate into the requested horizon: for each
 * forecast row, take the overlap between [today, today+horizon) and
 * [forecastDate, forecastDate + periodDays) and multiply by
 * predictedDemand / periodDays. That lets a single horizon=7 request answer
 * "how short are we THIS week" without a new cron.
 *
 * Response:
 *   {
 *     asOf, horizonDays,
 *     summary: { shortSkus, shortageDollars, minDaysOfCoverage },
 *     items: [ ... ]
 *   }
 *
 * Items are sorted by shortage $ desc. Empty `items` is a valid response;
 * page layer renders an empty state explaining the cron hasn't run yet.
 */
export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  const url = new URL(request.url)
  const horizonRaw = url.searchParams.get('horizon') || '14'
  const horizonDays = horizonRaw === '7' ? 7 : horizonRaw === '30' ? 30 : 14
  const severity = url.searchParams.get('severity') === 'high' ? 'high' : 'all'
  const vendorId = url.searchParams.get('vendorId') || null

  try {
    // ── 1. Pro-rated forecast demand per productId in the window ─────────
    // Overlap math:
    //   window = [today, today + horizon)
    //   row    = [forecastDate, forecastDate + periodDays)
    //   ovl    = max(0, least(window_end, row_end) - greatest(window_start, row_start))
    //   units  = predictedDemand * ovl_days / periodDays
    const rawDemand = await prisma.$queryRawUnsafe<
      Array<{
        productId: string
        windowDemand: number
        periodDaysMax: number
      }>
    >(
      `
      WITH w AS (
        SELECT
          date_trunc('day', NOW())::date AS window_start,
          (date_trunc('day', NOW()) + ($1::int || ' days')::interval)::date AS window_end
      ),
      overlap AS (
        SELECT
          df."productId" AS product_id,
          df."periodDays" AS period_days,
          GREATEST(
            0,
            EXTRACT(EPOCH FROM (
              LEAST((w.window_end)::timestamp,
                    (df."forecastDate" + (df."periodDays" || ' days')::interval))
              - GREATEST((w.window_start)::timestamp, df."forecastDate"::timestamp)
            )) / 86400.0
          ) AS ovl_days,
          df."predictedDemand"::float AS pred
        FROM "DemandForecast" df
        CROSS JOIN w
        WHERE df."forecastDate" < w.window_end
          AND (df."forecastDate" + (df."periodDays" || ' days')::interval) > w.window_start
      )
      SELECT
        product_id AS "productId",
        SUM(pred * ovl_days / NULLIF(period_days, 0))::float AS "windowDemand",
        MAX(period_days)::int AS "periodDaysMax"
      FROM overlap
      WHERE ovl_days > 0
      GROUP BY product_id
      HAVING SUM(pred * ovl_days / NULLIF(period_days, 0)) > 0
      `,
      horizonDays
    )

    if (rawDemand.length === 0) {
      return NextResponse.json(
        {
          asOf: new Date().toISOString(),
          horizonDays,
          summary: { shortSkus: 0, shortageDollars: 0, minDaysOfCoverage: null },
          items: [],
          note:
            'No DemandForecast rows cover the requested window. The weekly cron (/api/cron/demand-forecast-weekly) may not have run yet.',
        },
        { headers: { 'Cache-Control': 'private, max-age=60' } }
      )
    }

    const productIds = rawDemand.map((r) => r.productId)
    const demandByProduct = new Map(
      rawDemand.map((r) => [r.productId, Number(r.windowDemand) || 0])
    )

    // ── 2. Product metadata + cost ───────────────────────────────────────
    const products = await prisma.$queryRawUnsafe<
      Array<{
        id: string
        sku: string
        name: string
        category: string | null
        cost: number | null
      }>
    >(
      `SELECT "id", "sku", "name", "category", "cost"
         FROM "Product"
        WHERE "id" = ANY($1::text[])`,
      productIds
    )
    const productById = new Map(products.map((p) => [p.id, p]))

    // ── 3. Inventory snapshot ─────────────────────────────────────────────
    const inventory = await prisma.$queryRawUnsafe<
      Array<{
        productId: string
        onHand: number
        available: number
        avgDailyUsage: number | null
      }>
    >(
      `SELECT "productId", "onHand", "available", "avgDailyUsage"
         FROM "InventoryItem"
        WHERE "productId" = ANY($1::text[])`,
      productIds
    )
    const invByProduct = new Map(
      inventory.map((i) => [
        i.productId,
        {
          onHand: Number(i.onHand) || 0,
          available: Number(i.available) || 0,
          avgDailyUsage: Number(i.avgDailyUsage) || 0,
        },
      ])
    )

    // ── 4. Preferred vendor per product (vendorProduct.preferred=true). ──
    // If none flagged, fall back to the lowest-cost vendor with a price.
    const vendorRows = await prisma.$queryRawUnsafe<
      Array<{
        productId: string
        vendorId: string
        vendorName: string
        vendorCode: string
        vendorEmail: string | null
        vendorContactName: string | null
        vendorCost: number | null
        leadTimeDays: number | null
        preferred: boolean
      }>
    >(
      `
      SELECT
        vp."productId",
        v."id" AS "vendorId",
        v."name" AS "vendorName",
        v."code" AS "vendorCode",
        v."email" AS "vendorEmail",
        v."contactName" AS "vendorContactName",
        vp."vendorCost",
        vp."leadTimeDays",
        vp."preferred"
      FROM "VendorProduct" vp
      JOIN "Vendor" v ON v."id" = vp."vendorId"
      WHERE vp."productId" = ANY($1::text[])
        AND v."active" = true
      ORDER BY vp."preferred" DESC, vp."vendorCost" ASC NULLS LAST
      `,
      productIds
    )
    const vendorByProduct = new Map<
      string,
      {
        vendorId: string
        vendorName: string
        vendorCode: string
        vendorEmail: string | null
        vendorContactName: string | null
        vendorCost: number | null
        leadTimeDays: number | null
      }
    >()
    for (const row of vendorRows) {
      if (!vendorByProduct.has(row.productId)) {
        vendorByProduct.set(row.productId, {
          vendorId: row.vendorId,
          vendorName: row.vendorName,
          vendorCode: row.vendorCode,
          vendorEmail: row.vendorEmail,
          vendorContactName: row.vendorContactName,
          vendorCost: row.vendorCost != null ? Number(row.vendorCost) : null,
          leadTimeDays: row.leadTimeDays,
        })
      }
    }

    // ── 5. Open PO coverage (qty still expected to arrive) ────────────────
    const poRows = await prisma.$queryRawUnsafe<
      Array<{
        productId: string
        openPoCount: number
        inTransitQty: number
        earliestExpected: Date | null
      }>
    >(
      `
      SELECT
        poi."productId",
        COUNT(DISTINCT po."id")::int AS "openPoCount",
        COALESCE(SUM(GREATEST(poi."quantity" - COALESCE(poi."receivedQty", 0), 0)), 0)::int
          AS "inTransitQty",
        MIN(po."expectedDate") AS "earliestExpected"
      FROM "PurchaseOrderItem" poi
      JOIN "PurchaseOrder" po ON po."id" = poi."purchaseOrderId"
      WHERE poi."productId" = ANY($1::text[])
        AND po."status" IN ('SENT', 'CONFIRMED', 'PARTIAL', 'APPROVED')
      GROUP BY poi."productId"
      `,
      productIds
    )
    const poByProduct = new Map(
      poRows.map((r) => [
        r.productId,
        {
          openPoCount: Number(r.openPoCount) || 0,
          inTransitQty: Number(r.inTransitQty) || 0,
          earliestExpected: r.earliestExpected,
        },
      ])
    )

    // ── 6. Affected jobs — how many open jobs in window need the SKU ─────
    // Uses MaterialWatch (AWAITING/PARTIAL) as ground truth since the ATP
    // shortage cron populates it; one row per (job, productId).
    const jobRows = await prisma.$queryRawUnsafe<
      Array<{ productId: string; jobCount: number }>
    >(
      `
      SELECT "productId", COUNT(DISTINCT "jobId")::int AS "jobCount"
      FROM "MaterialWatch"
      WHERE "productId" = ANY($1::text[])
        AND "status" IN ('AWAITING','PARTIAL')
      GROUP BY "productId"
      `,
      productIds
    )
    const jobsByProduct = new Map(
      jobRows.map((r) => [r.productId, Number(r.jobCount) || 0])
    )

    // ── 7. Earliest short-date per product (first MaterialWatch job date) ─
    const dateRows = await prisma.$queryRawUnsafe<
      Array<{ productId: string; earliest: Date | null }>
    >(
      `
      SELECT mw."productId", MIN(j."scheduledDate") AS "earliest"
      FROM "MaterialWatch" mw
      JOIN "Job" j ON j."id" = mw."jobId"
      WHERE mw."productId" = ANY($1::text[])
        AND mw."status" IN ('AWAITING','PARTIAL')
        AND j."scheduledDate" IS NOT NULL
      GROUP BY mw."productId"
      `,
      productIds
    )
    const earliestByProduct = new Map(
      dateRows.map((r) => [r.productId, r.earliest])
    )

    // ── 8. Assemble items ─────────────────────────────────────────────────
    const items = [] as Array<{
      productId: string
      sku: string
      name: string
      category: string | null
      onHand: number
      available: number
      forecastDemand: number
      shortageQty: number
      shortageDollars: number
      daysOfCoverage: number | null
      earliestShortDate: string | null
      openPoCount: number
      inTransitQty: number
      earliestExpected: string | null
      affectedJobCount: number
      preferredVendor: null | {
        vendorId: string
        name: string
        code: string
        email: string | null
        contactName: string | null
        leadTimeDays: number | null
      }
      unitCost: number
    }>

    let minDaysOfCoverage: number | null = null

    for (const pid of productIds) {
      const product = productById.get(pid)
      if (!product) continue

      const inv = invByProduct.get(pid) || { onHand: 0, available: 0, avgDailyUsage: 0 }
      const vendor = vendorByProduct.get(pid) || null
      const po = poByProduct.get(pid) || {
        openPoCount: 0,
        inTransitQty: 0,
        earliestExpected: null,
      }

      // Optional filter: only products whose preferred/fallback vendor matches.
      if (vendorId) {
        if (!vendor || vendor.vendorId !== vendorId) continue
      }

      const windowDemand = Math.round(demandByProduct.get(pid) || 0)
      // Shortage = forecast demand + committed-to-others spilled into
      // `committed`; InventoryItem.available already nets out committed.
      // Incoming POs within the window count as supply.
      const projectedSupply =
        (inv.available || 0) +
        // only count in-transit if it's expected inside the window
        (po.earliestExpected &&
        (new Date(po.earliestExpected).getTime() - Date.now()) / 86400000 < horizonDays
          ? po.inTransitQty
          : 0)

      const shortageQty = Math.max(0, windowDemand - projectedSupply)
      if (shortageQty <= 0) continue

      const unitCost = Number(product.cost ?? vendor?.vendorCost ?? 0)
      const shortageDollars = Math.round(shortageQty * unitCost * 100) / 100

      // days-of-coverage: how long onHand lasts at the forecast pace
      const dailyBurn =
        windowDemand > 0 && horizonDays > 0 ? windowDemand / horizonDays : 0
      const daysOfCoverage =
        dailyBurn > 0 ? Math.round((inv.available / dailyBurn) * 10) / 10 : null

      if (
        daysOfCoverage !== null &&
        (minDaysOfCoverage === null || daysOfCoverage < minDaysOfCoverage)
      ) {
        minDaysOfCoverage = daysOfCoverage
      }

      items.push({
        productId: pid,
        sku: product.sku,
        name: product.name,
        category: product.category,
        onHand: inv.onHand,
        available: inv.available,
        forecastDemand: windowDemand,
        shortageQty,
        shortageDollars,
        daysOfCoverage,
        earliestShortDate: earliestByProduct.get(pid)
          ? (earliestByProduct.get(pid) as Date).toISOString().slice(0, 10)
          : null,
        openPoCount: po.openPoCount,
        inTransitQty: po.inTransitQty,
        earliestExpected: po.earliestExpected
          ? new Date(po.earliestExpected).toISOString().slice(0, 10)
          : null,
        affectedJobCount: jobsByProduct.get(pid) || 0,
        preferredVendor: vendor
          ? {
              vendorId: vendor.vendorId,
              name: vendor.vendorName,
              code: vendor.vendorCode,
              email: vendor.vendorEmail,
              contactName: vendor.vendorContactName,
              leadTimeDays: vendor.leadTimeDays,
            }
          : null,
        unitCost,
      })
    }

    // severity filter after shortage calc so the "high only" switch is stable
    const filtered =
      severity === 'high'
        ? items.filter(
            (it) =>
              it.shortageDollars >= 250 ||
              (it.daysOfCoverage !== null && it.daysOfCoverage <= 3)
          )
        : items

    filtered.sort((a, b) => b.shortageDollars - a.shortageDollars)

    const summary = {
      shortSkus: filtered.length,
      shortageDollars:
        Math.round(filtered.reduce((s, it) => s + it.shortageDollars, 0) * 100) / 100,
      minDaysOfCoverage,
    }

    return NextResponse.json(
      {
        asOf: new Date().toISOString(),
        horizonDays,
        severity,
        vendorId,
        summary,
        items: filtered,
      },
      { headers: { 'Cache-Control': 'private, max-age=60' } }
    )
  } catch (error: any) {
    console.error('[api/ops/shortages] error:', error)
    return NextResponse.json(
      { error: 'Failed to compute shortages', details: String(error?.message || error) },
      { status: 500 }
    )
  }
}
