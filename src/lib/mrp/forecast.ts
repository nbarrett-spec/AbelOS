/**
 * Demand Forecast — simple exponential smoothing per SKU.
 *
 * Approach:
 *   1. Read 12 months of monthly unit demand per Product. Demand comes from
 *      OrderItem × BomEntry expansion (terminal leaf components) keyed to
 *      Order.orderDate (falls back to Order.createdAt).
 *   2. Apply Brown's simple exponential smoothing with α = 0.3:
 *        S_1       = actual_1            (seed with first observation)
 *        S_t       = α * actual_t + (1-α) * S_{t-1}
 *        forecast  = S_T  (flat-forward — carry the last smoothed value out
 *                          across the next 3 months)
 *   3. 80% CI is ±1.28σ of residuals (actual - smoothed). Floored at 0.
 *   4. Upsert DemandForecast rows keyed by (productId, forecastDate=first of
 *      forecast month). The table already exists in prisma/schema.prisma with
 *      columns { forecastDate, periodDays, predictedDemand, actualDemand,
 *      confidenceLevel, basedOn JSONB }. We write predictedDemand=qty and
 *      stash method/alpha/confidenceLow/confidenceHigh inside basedOn so we
 *      can reconstruct the CI band on read.
 *   5. InventoryItem.safetyStock = max(monthly forecast * 0.5, current safetyStock).
 *
 * All SQL is raw (no schema.prisma change). DemandForecast is authoritative
 * in schema.prisma; ensureDemandForecastTable() only adds the unique index
 * needed for ON CONFLICT upserts (not in the Prisma model since the schema
 * doesn't declare a @@unique([productId, forecastDate])).
 */

import { prisma } from '@/lib/prisma'

// ─── Types ──────────────────────────────────────────────────────────────

export interface MonthlyPoint {
  month: string // "YYYY-MM-01"
  quantity: number
}

export interface ForecastPoint {
  month: string // "YYYY-MM-01"
  forecastQty: number
  confidenceLow: number
  confidenceHigh: number
}

export interface ProductForecast {
  productId: string
  sku: string
  name: string
  category: string | null
  actuals: MonthlyPoint[] // last 12 months
  forecast: ForecastPoint[] // next 3 months
  alpha: number
  method: 'EXPONENTIAL_SMOOTHING'
  smoothedLast: number
  residualStdDev: number
  totalHistoricalUnits: number
}

export interface ForecastRunSummary {
  asOf: string
  productsProcessed: number
  forecastsUpserted: number
  safetyStockUpdates: number
  skipped: number
  errors: string[]
  durationMs: number
}

// ─── Constants ──────────────────────────────────────────────────────────

const DEFAULT_ALPHA = 0.3
const HORIZON_MONTHS = 3
const LOOKBACK_MONTHS = 12
const Z_80 = 1.2816 // 80% two-sided CI

// ─── Bootstrap ──────────────────────────────────────────────────────────

let tableEnsured = false

export async function ensureDemandForecastTable(): Promise<void> {
  if (tableEnsured) return
  try {
    // Table itself is owned by prisma/schema.prisma — we only add the
    // (productId, forecastDate) unique index our upsert ON CONFLICT relies
    // on. Idempotent; noop on redeploys.
    await prisma.$executeRawUnsafe(`
      CREATE UNIQUE INDEX IF NOT EXISTS "DemandForecast_productId_forecastDate_key"
        ON "DemandForecast" ("productId", "forecastDate")
    `)
    tableEnsured = true
  } catch (e) {
    // Log once, but keep tableEnsured = true so we stop retrying.
    console.warn('[forecast] ensureDemandForecastTable failed:', e)
    tableEnsured = true
  }
}

// ─── Historical demand query ────────────────────────────────────────────

/**
 * Pulls 12 months of BOM-expanded monthly demand, bucketed per Product.
 *
 * Uses Order.orderDate for the date key (business order date, falls back to
 * createdAt when orderDate is null). Only terminal BOM leaves are counted,
 * matching runMrpProjection() in lib/mrp.ts.
 */
async function loadMonthlyDemand(
  productIds: string[] | null
): Promise<Map<string, Map<string, number>>> {
  const today = new Date()
  const cutoff = new Date(today.getFullYear(), today.getMonth() - LOOKBACK_MONTHS, 1)

  const rows = await prisma.$queryRawUnsafe<
    Array<{ productId: string; month: Date; quantity: number }>
  >(
    `
    WITH RECURSIVE
    order_demand AS (
      SELECT
        date_trunc('month', COALESCE(o."orderDate", o."createdAt"))::date as month,
        oi."productId" as product_id,
        oi."quantity"::float as qty,
        0 as depth
      FROM "Order" o
      JOIN "OrderItem" oi ON oi."orderId" = o."id"
      WHERE COALESCE(o."orderDate", o."createdAt") >= $1
        AND COALESCE(o."orderDate", o."createdAt") < date_trunc('month', NOW())
        AND o."status" NOT IN ('CANCELLED')
        AND COALESCE(o."isForecast", false) = false

      UNION ALL

      SELECT
        od.month,
        be."componentId",
        od.qty * be."quantity",
        od.depth + 1
      FROM order_demand od
      JOIN "BomEntry" be ON be."parentId" = od.product_id
      WHERE od.depth < 4
    ),
    has_children AS (
      SELECT DISTINCT "parentId" as product_id FROM "BomEntry"
    )
    SELECT
      od.product_id as "productId",
      od.month as month,
      SUM(od.qty)::float as quantity
    FROM order_demand od
    LEFT JOIN has_children hc ON hc.product_id = od.product_id
    WHERE (hc.product_id IS NULL OR od.depth > 0)
      ${productIds ? 'AND od.product_id = ANY($2::text[])' : ''}
    GROUP BY od.product_id, od.month
    `,
    cutoff,
    ...(productIds ? [productIds] : [])
  )

  const result = new Map<string, Map<string, number>>()
  for (const r of rows) {
    const pid = r.productId
    const key = isoMonth(r.month)
    if (!result.has(pid)) result.set(pid, new Map())
    result.get(pid)!.set(key, (result.get(pid)!.get(key) || 0) + Number(r.quantity))
  }
  return result
}

// ─── Smoothing core ─────────────────────────────────────────────────────

/**
 * Build 12 monthly buckets covering the last LOOKBACK_MONTHS completed
 * calendar months (inclusive). Position 0 = oldest, position 11 = most
 * recent completed month.
 */
function buildMonthKeys(): string[] {
  const out: string[] = []
  const today = new Date()
  // Most recent completed month = first day of current month - 1 month
  const mostRecent = new Date(today.getFullYear(), today.getMonth() - 1, 1)
  for (let i = LOOKBACK_MONTHS - 1; i >= 0; i--) {
    const d = new Date(mostRecent.getFullYear(), mostRecent.getMonth() - i, 1)
    out.push(isoMonth(d))
  }
  return out
}

function buildForecastMonthKeys(): string[] {
  const out: string[] = []
  const today = new Date()
  // First forecast month = current calendar month
  for (let i = 0; i < HORIZON_MONTHS; i++) {
    const d = new Date(today.getFullYear(), today.getMonth() + i, 1)
    out.push(isoMonth(d))
  }
  return out
}

/**
 * Compute smoothed series + 3-month forward flat-forward forecast.
 * Returns the per-month actuals in order and the forecast rows.
 */
export function exponentialSmoothing(
  actuals: number[],
  alpha: number = DEFAULT_ALPHA
): { smoothed: number[]; residualStdDev: number; smoothedLast: number } {
  if (actuals.length === 0) {
    return { smoothed: [], residualStdDev: 0, smoothedLast: 0 }
  }
  const smoothed: number[] = new Array(actuals.length)
  smoothed[0] = actuals[0]
  for (let i = 1; i < actuals.length; i++) {
    smoothed[i] = alpha * actuals[i] + (1 - alpha) * smoothed[i - 1]
  }

  // Residual std dev (one-step-ahead errors). Use in-sample residuals:
  //   err_t = actual_t - smoothed_{t-1}   (for t >= 1)
  const residuals: number[] = []
  for (let i = 1; i < actuals.length; i++) {
    residuals.push(actuals[i] - smoothed[i - 1])
  }
  let residualStdDev = 0
  if (residuals.length > 1) {
    const mean = residuals.reduce((a, b) => a + b, 0) / residuals.length
    const variance =
      residuals.reduce((acc, x) => acc + (x - mean) ** 2, 0) /
      Math.max(1, residuals.length - 1)
    residualStdDev = Math.sqrt(Math.max(0, variance))
  }

  return {
    smoothed,
    residualStdDev,
    smoothedLast: smoothed[smoothed.length - 1],
  }
}

// ─── Main entry point ──────────────────────────────────────────────────

export interface ComputeOptions {
  /** Limit to a set of product IDs (e.g. for a one-off API request). */
  productIds?: string[]
  /** Alpha smoothing coefficient. Default 0.3. */
  alpha?: number
  /** When true, persist DemandForecast rows + update safety stock. */
  persist?: boolean
}

/**
 * Compute a per-product forecast. Without `persist`, returns the computed
 * forecasts without touching the DB (used by the read-side API for
 * on-demand queries and by the script in dry-run).
 *
 * With `persist`, upserts DemandForecast rows and bumps InventoryItem.safetyStock.
 */
export async function computeDemandForecast(
  opts: ComputeOptions = {}
): Promise<{ summary: ForecastRunSummary; products: ProductForecast[] }> {
  const started = Date.now()
  const alpha = Math.max(0.05, Math.min(0.95, opts.alpha ?? DEFAULT_ALPHA))
  await ensureDemandForecastTable()

  const summary: ForecastRunSummary = {
    asOf: new Date().toISOString(),
    productsProcessed: 0,
    forecastsUpserted: 0,
    safetyStockUpdates: 0,
    skipped: 0,
    errors: [],
    durationMs: 0,
  }

  const productIds = opts.productIds && opts.productIds.length > 0 ? opts.productIds : null

  const demandByProduct = await loadMonthlyDemand(productIds)
  const monthKeys = buildMonthKeys()
  const forecastMonthKeys = buildForecastMonthKeys()

  // Pull product metadata for every product that has any historical demand,
  // plus any explicitly-requested productIds (even if no history — we'll
  // return zeros so the caller can surface "no history" cleanly).
  const allPids = new Set<string>(demandByProduct.keys())
  if (productIds) for (const id of productIds) allPids.add(id)
  if (allPids.size === 0) {
    summary.durationMs = Date.now() - started
    return { summary, products: [] }
  }

  const productMeta = await prisma.$queryRawUnsafe<
    Array<{ id: string; sku: string; name: string; category: string | null }>
  >(
    `SELECT "id", "sku", "name", "category" FROM "Product" WHERE "id" = ANY($1::text[])`,
    Array.from(allPids)
  )
  const metaById = new Map(productMeta.map((p) => [p.id, p]))

  const products: ProductForecast[] = []

  for (const pid of allPids) {
    const meta = metaById.get(pid)
    if (!meta) {
      summary.skipped++
      continue
    }

    const monthMap = demandByProduct.get(pid) || new Map<string, number>()
    const actuals: MonthlyPoint[] = monthKeys.map((m) => ({
      month: m,
      quantity: Math.round(monthMap.get(m) || 0),
    }))

    const totalHistoricalUnits = actuals.reduce((a, b) => a + b.quantity, 0)

    // Skip products with zero history AND not explicitly requested — avoids
    // writing thousands of forecast=0 rows for the long tail of dead SKUs.
    const explicitlyRequested = productIds?.includes(pid) ?? false
    if (totalHistoricalUnits === 0 && !explicitlyRequested) {
      summary.skipped++
      continue
    }

    const { smoothed, residualStdDev, smoothedLast } = exponentialSmoothing(
      actuals.map((a) => a.quantity),
      alpha
    )

    const forecast: ForecastPoint[] = forecastMonthKeys.map((month) => {
      const qty = Math.max(0, Math.round(smoothedLast))
      const band = Math.round(Z_80 * residualStdDev)
      return {
        month,
        forecastQty: qty,
        confidenceLow: Math.max(0, qty - band),
        confidenceHigh: qty + band,
      }
    })

    products.push({
      productId: pid,
      sku: meta.sku,
      name: meta.name,
      category: meta.category,
      actuals,
      forecast,
      alpha,
      method: 'EXPONENTIAL_SMOOTHING',
      smoothedLast,
      residualStdDev,
      totalHistoricalUnits,
    })

    summary.productsProcessed++

    if (opts.persist) {
      try {
        await persistForecast(pid, forecast, alpha)
        summary.forecastsUpserted += forecast.length
        const didBump = await bumpSafetyStock(pid, forecast[0].forecastQty)
        if (didBump) summary.safetyStockUpdates++
      } catch (err: any) {
        summary.errors.push(`${meta.sku}: ${err?.message || String(err)}`)
      }
    }
    // Residuals available via products[i].residualStdDev if callers need it
    void smoothed
  }

  summary.durationMs = Date.now() - started
  return { summary, products }
}

// ─── Persistence ────────────────────────────────────────────────────────

async function persistForecast(
  productId: string,
  points: ForecastPoint[],
  alpha: number
): Promise<void> {
  for (const p of points) {
    const id = `df_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
    // basedOn packs the CI band + method so the read side can reconstruct the
    // same shape it had under the old schema without needing extra columns.
    const basedOn = JSON.stringify({
      method: 'EXPONENTIAL_SMOOTHING',
      alpha,
      confidenceLow: p.confidenceLow,
      confidenceHigh: p.confidenceHigh,
    })
    await prisma.$executeRawUnsafe(
      `
      INSERT INTO "DemandForecast" (
        "id", "productId", "forecastDate", "periodDays",
        "predictedDemand", "confidenceLevel", "basedOn",
        "createdAt", "updatedAt"
      ) VALUES ($1, $2, $3::date, 30, $4, 0.8, $5::jsonb, NOW(), NOW())
      ON CONFLICT ("productId", "forecastDate")
      DO UPDATE SET
        "predictedDemand" = EXCLUDED."predictedDemand",
        "confidenceLevel" = EXCLUDED."confidenceLevel",
        "basedOn" = EXCLUDED."basedOn",
        "updatedAt" = NOW()
      `,
      id,
      productId,
      p.month,
      p.forecastQty,
      basedOn
    )
  }
}

/**
 * Update InventoryItem.safetyStock = GREATEST(monthlyForecast * 0.5, current).
 * Only raises the floor — never lowers an existing (possibly human-tuned)
 * safety stock value. Returns true if an update was actually applied.
 */
async function bumpSafetyStock(productId: string, monthlyForecast: number): Promise<boolean> {
  const target = Math.max(0, Math.round(monthlyForecast * 0.5))
  if (target <= 0) return false
  const rows = await prisma.$queryRawUnsafe<Array<{ updated: number }>>(
    `
    UPDATE "InventoryItem"
    SET "safetyStock" = GREATEST(COALESCE("safetyStock", 0), $1::int),
        "updatedAt" = NOW()
    WHERE "productId" = $2
      AND COALESCE("safetyStock", 0) < $1::int
    RETURNING 1 as updated
    `,
    target,
    productId
  )
  return rows.length > 0
}

// ─── Public helper for SmartPO integration ──────────────────────────────

/**
 * Look up the upcoming 1-month forecast demand for a product.
 * Returns null if no DemandForecast row exists yet.
 */
export async function getForecastDemand(
  productId: string,
  monthsAhead: number = 1
): Promise<number | null> {
  await ensureDemandForecastTable()
  const rows = await prisma.$queryRawUnsafe<Array<{ predictedDemand: number }>>(
    `
    SELECT "predictedDemand"
    FROM "DemandForecast"
    WHERE "productId" = $1
      AND "forecastDate" >= date_trunc('month', NOW())
    ORDER BY "forecastDate" ASC
    LIMIT $2
    `,
    productId,
    monthsAhead
  )
  if (rows.length === 0) return null
  return rows.reduce((a, r) => a + Number(r.predictedDemand), 0)
}

// ─── Helpers ────────────────────────────────────────────────────────────

function isoMonth(d: Date | string): string {
  const date = typeof d === 'string' ? new Date(d) : d
  const y = date.getUTCFullYear()
  const m = String(date.getUTCMonth() + 1).padStart(2, '0')
  return `${y}-${m}-01`
}
