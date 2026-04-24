export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'
import { prisma } from '@/lib/prisma'
import { computeDemandForecast, ensureDemandForecastTable } from '@/lib/mrp/forecast'

/**
 * GET /api/ops/mrp/forecast?productId=X&months=3
 *
 * Returns forecast rows + the matching 12-month actual history for a single
 * product, ready to chart side-by-side. If `productId` is omitted, returns
 * the top-N highest-velocity products' summary (sku, last 12 sum, next-3 sum).
 *
 * If persisted DemandForecast rows exist, they are returned as-is. If not —
 * or if the caller passes ?recompute=1 — the lib computes on-the-fly without
 * persisting (read-only API).
 */
export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  const url = new URL(request.url)
  const productId = url.searchParams.get('productId') || undefined
  const months = Math.max(1, Math.min(12, parseInt(url.searchParams.get('months') || '3', 10)))
  const recompute = url.searchParams.get('recompute') === '1'
  const topN = Math.max(1, Math.min(100, parseInt(url.searchParams.get('topN') || '20', 10)))

  await ensureDemandForecastTable()

  // Single-product path
  if (productId) {
    const { products } = await computeDemandForecast({ productIds: [productId] })
    if (products.length === 0) {
      return NextResponse.json({
        productId,
        notFound: true,
        actuals: [],
        forecast: [],
      })
    }
    const p = products[0]

    // If persisted rows exist for the requested horizon, prefer those so we
    // report what's actually driving safety stock. Otherwise return live.
    let persisted: Array<{ month: string; forecastQty: number; low: number; high: number }> = []
    if (!recompute) {
      // DemandForecast schema stashes the CI band inside basedOn JSON —
      // see src/lib/mrp/forecast.ts persistForecast().
      const rows = await prisma.$queryRawUnsafe<
        Array<{ forecastDate: Date; predictedDemand: number; basedOn: any }>
      >(
        `SELECT "forecastDate", "predictedDemand", "basedOn"
           FROM "DemandForecast"
          WHERE "productId" = $1
            AND "forecastDate" >= date_trunc('month', NOW())
          ORDER BY "forecastDate" ASC
          LIMIT $2`,
        productId,
        months
      )
      persisted = rows.map((r) => {
        const qty = Number(r.predictedDemand)
        const bo = r.basedOn && typeof r.basedOn === 'object' ? r.basedOn : {}
        return {
          month: r.forecastDate.toISOString().slice(0, 10),
          forecastQty: qty,
          low: Number(bo.confidenceLow ?? 0),
          high: Number(bo.confidenceHigh ?? qty),
        }
      })
    }

    const forecast = (persisted.length > 0
      ? persisted.map((r) => ({
          month: r.month,
          forecastQty: r.forecastQty,
          confidenceLow: r.low,
          confidenceHigh: r.high,
        }))
      : p.forecast.slice(0, months))

    return NextResponse.json({
      productId: p.productId,
      sku: p.sku,
      name: p.name,
      category: p.category,
      alpha: p.alpha,
      method: p.method,
      totalHistoricalUnits: p.totalHistoricalUnits,
      residualStdDev: Math.round(p.residualStdDev * 100) / 100,
      actuals: p.actuals,
      forecast,
      persistedHit: persisted.length > 0,
    })
  }

  // Top-N summary path — cheap: just read DemandForecast + a quick 12-month
  // history aggregate per product, no BOM walk.
  const topProducts = await prisma.$queryRawUnsafe<
    Array<{ productId: string; sku: string; name: string; category: string | null; hist: number }>
  >(
    `
    WITH hist AS (
      SELECT
        oi."productId" as product_id,
        SUM(oi."quantity")::int as units
      FROM "Order" o
      JOIN "OrderItem" oi ON oi."orderId" = o."id"
      WHERE COALESCE(o."orderDate", o."createdAt") >= NOW() - INTERVAL '12 months'
        AND o."status" <> 'CANCELLED'
        AND COALESCE(o."isForecast", false) = false
      GROUP BY oi."productId"
    )
    SELECT
      p."id" as "productId",
      p."sku", p."name", p."category",
      COALESCE(h.units, 0) as hist
    FROM "Product" p
    LEFT JOIN hist h ON h.product_id = p."id"
    WHERE h.units IS NOT NULL AND h.units > 0
    ORDER BY h.units DESC
    LIMIT $1
    `,
    topN
  )

  const productIdList = topProducts.map((p) => p.productId)
  const forecastRows = productIdList.length === 0
    ? []
    : await prisma.$queryRawUnsafe<
        Array<{ productId: string; forecastDate: Date; predictedDemand: number }>
      >(
        `SELECT "productId", "forecastDate", "predictedDemand"
           FROM "DemandForecast"
          WHERE "productId" = ANY($1::text[])
            AND "forecastDate" >= date_trunc('month', NOW())
          ORDER BY "forecastDate" ASC
          LIMIT 500`,
        productIdList
      )

  const forecastByProduct = new Map<string, number>()
  for (const r of forecastRows) {
    forecastByProduct.set(
      r.productId,
      (forecastByProduct.get(r.productId) || 0) + Number(r.predictedDemand)
    )
  }

  return NextResponse.json({
    topN,
    products: topProducts.map((p) => ({
      productId: p.productId,
      sku: p.sku,
      name: p.name,
      category: p.category,
      last12MonthsUnits: Number(p.hist),
      next3MonthsForecast: forecastByProduct.get(p.productId) ?? null,
    })),
    persistedCount: forecastRows.length,
  })
}
