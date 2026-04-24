export const dynamic = 'force-dynamic'

// ──────────────────────────────────────────────────────────────────────────
// /api/ops/finance/ytd — dedicated YTD aggregator for /ops/finance/ytd.
//
// Reuses getMonthlyFinancials(year) from lib/finance/monthly-rollup so the
// numbers match everything else on /ops/finance (commit 246b7b9 wired YTD
// across finance/executive/reports/kpis via that same helper). We compose
// rather than re-derive.
//
// Extras layered on top of the rollup:
//   • 3-year compare (current + 2 priors) with cumulative revenue per month
//   • Year-over-year deltas vs same-window-last-year (Jan-through-Today)
//   • Top-10 builders by YTD revenue  (from OrderItem × Product.cost — same
//     SQL shape as /api/ops/finance/gross-margin)
//   • Top-10 builders by YTD GM %    (min revenue floor to keep it signal)
//   • Operating expense proxy: PurchaseOrder.total where category='GENERAL'
//     YTD. Real opex isn't modelled yet so this is the closest honest proxy
//     (matches how finance/health shows "non-COGS spend").
//
// Cache: 5-min per year-triplet keyed in-process. The underlying rollup
// helper has its own 60s cache, so cold calls only pay the SQL cost once
// per minute; this layer keeps the combined response cheap for repeated
// page loads.
// ──────────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'
import { prisma } from '@/lib/prisma'
import {
  getMonthlyFinancials,
  type MonthlyRollup,
  type YtdTotals,
} from '@/lib/finance/monthly-rollup'

// ── Types ──────────────────────────────────────────────────────────────────

export interface YtdMonthRow {
  month: number
  monthLabel: string
  revenue: number
  cogs: number
  gm: number
  gmPct: number
}

export interface YtdCompareYear {
  year: number
  revenue: number
  cogs: number
  gm: number
  gmPct: number
  /** Cumulative revenue Jan → month (1-12). Always 12 entries, padded 0. */
  cumulativeByMonth: number[]
  /** Same-window-YTD revenue — Jan through `asOfMonth` of that year.
   *  Used for apples-to-apples delta vs current year. */
  sameWindowRevenue: number
  sameWindowCogs: number
  sameWindowGm: number
}

export interface YtdTopBuilder {
  builderId: string
  builderName: string
  revenue: number
  cogs: number
  gmDollar: number
  gmPct: number
  orderCount: number
}

export interface YtdResponse {
  year: number
  asOf: string
  asOfMonth: number
  // Headline YTD figures for current year
  revenue: number
  cogs: number
  gm: number
  gmPct: number
  opex: number
  // Per-month breakdown for current year (Jan → Dec)
  byMonth: YtdMonthRow[]
  // Compare data for current + prior years, keyed by year string
  compare: Record<string, YtdCompareYear>
  // Year-over-year deltas (current vs prior, apples-to-apples window)
  yoy: {
    revenueDelta: number
    revenueDeltaPct: number
    cogsDelta: number
    cogsDeltaPct: number
    gmDelta: number
    gmDeltaPct: number
  }
  topBuilders: YtdTopBuilder[]
  topByGmPct: YtdTopBuilder[]
}

// ── Module-level response cache ────────────────────────────────────────────

const CACHE_TTL_MS = 5 * 60_000
const cache = new Map<string, { at: number; data: YtdResponse }>()

function cacheKey(year: number, compareYears: number[]): string {
  return `${year}::${compareYears.slice().sort().join(',')}`
}

// ── Helpers ────────────────────────────────────────────────────────────────

/** Pull Jan-through-asOfMonth subtotals out of a yearly rollup. */
function windowedTotals(rollup: MonthlyRollup, throughMonth: number) {
  const slice = rollup.months.slice(0, Math.max(0, Math.min(12, throughMonth)))
  const revenue = slice.reduce((s, m) => s + m.revenue, 0)
  const cogs = slice.reduce((s, m) => s + m.cogs, 0)
  const gm = revenue - cogs
  return { revenue, cogs, gm }
}

/** Cumulative revenue Jan → month, padded to 12 entries. */
function cumulativeRevenue(rollup: MonthlyRollup): number[] {
  const out: number[] = []
  let running = 0
  for (let i = 0; i < 12; i++) {
    running += rollup.months[i]?.revenue ?? 0
    out.push(running)
  }
  return out
}

function toCompareYear(rollup: MonthlyRollup, asOfMonth: number): YtdCompareYear {
  const win = windowedTotals(rollup, asOfMonth)
  const ytd = rollup.ytd
  return {
    year: rollup.year,
    revenue: ytd.revenue,
    cogs: ytd.cogs,
    gm: ytd.gp,
    gmPct: ytd.gpPct,
    cumulativeByMonth: cumulativeRevenue(rollup),
    sameWindowRevenue: win.revenue,
    sameWindowCogs: win.cogs,
    sameWindowGm: win.gm,
  }
}

/** Top builders by YTD revenue, joined with cost to compute GM. Same SQL
 *  shape as /api/ops/finance/gross-margin so numbers reconcile. */
async function fetchTopBuilders(year: number): Promise<YtdTopBuilder[]> {
  const jan1 = new Date(Date.UTC(year, 0, 1))
  const jan1Next = new Date(Date.UTC(year + 1, 0, 1))

  const rows = await prisma.$queryRaw<
    Array<{
      builderId: string
      companyName: string
      revenue: number
      cogs: number
      orderCount: bigint | number
    }>
  >`
    SELECT
      b."id"              AS "builderId",
      b."companyName"     AS "companyName",
      COALESCE(SUM(oi."lineTotal"), 0)                           AS "revenue",
      COALESCE(SUM(oi."quantity" * COALESCE(p."cost", 0)), 0)    AS "cogs",
      COUNT(DISTINCT o."id")                                     AS "orderCount"
    FROM "Builder" b
    LEFT JOIN "Order" o ON o."builderId" = b."id"
      AND COALESCE(o."orderDate", o."createdAt") >= ${jan1}
      AND COALESCE(o."orderDate", o."createdAt") <  ${jan1Next}
      AND o."isForecast" = false
      AND o."status"::text != 'CANCELLED'
    LEFT JOIN "OrderItem" oi ON oi."orderId" = o."id"
    LEFT JOIN "Product" p ON p."id" = oi."productId"
    GROUP BY b."id", b."companyName"
    HAVING COALESCE(SUM(oi."lineTotal"), 0) > 0
    ORDER BY "revenue" DESC
    LIMIT 50
  `

  return rows.map((r) => {
    const revenue = Number(r.revenue) || 0
    const cogs = Number(r.cogs) || 0
    const gmDollar = revenue - cogs
    const gmPct = revenue > 0 ? (gmDollar / revenue) * 100 : 0
    return {
      builderId: r.builderId,
      builderName: r.companyName,
      revenue: Math.round(revenue * 100) / 100,
      cogs: Math.round(cogs * 100) / 100,
      gmDollar: Math.round(gmDollar * 100) / 100,
      gmPct: Math.round(gmPct * 10) / 10,
      orderCount: Number(r.orderCount),
    }
  })
}

/** Operating-expense proxy: YTD PurchaseOrder total where category='GENERAL'.
 *  Real opex isn't modelled yet. Returns 0 on any error so the rest of the
 *  dashboard still renders. */
async function fetchOpexProxy(year: number): Promise<number> {
  const jan1 = new Date(Date.UTC(year, 0, 1))
  const jan1Next = new Date(Date.UTC(year + 1, 0, 1))
  try {
    const rows = await prisma.$queryRaw<Array<{ total: number | null }>>`
      SELECT COALESCE(SUM("total"), 0)::float AS total
      FROM "PurchaseOrder"
      WHERE COALESCE("orderedAt", "createdAt") >= ${jan1}
        AND COALESCE("orderedAt", "createdAt") <  ${jan1Next}
        AND "status"::text != 'CANCELLED'
        AND "category"::text = 'GENERAL'
    `
    return Number(rows[0]?.total ?? 0)
  } catch {
    return 0
  }
}

// ── Handler ────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  const { searchParams } = new URL(request.url)
  const now = new Date()
  const currentYear = now.getUTCFullYear()
  const asOfMonth = now.getUTCMonth() + 1 // 1-12

  const yearParam = searchParams.get('year')
  const year = yearParam ? parseInt(yearParam, 10) : currentYear
  if (!Number.isFinite(year) || year < 2000 || year > 2100) {
    return NextResponse.json({ error: 'Invalid year' }, { status: 400 })
  }

  const compareParam = searchParams.get('compareYears')
  let compareYears: number[]
  if (compareParam) {
    compareYears = compareParam
      .split(',')
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => Number.isFinite(n) && n >= 2000 && n <= 2100 && n !== year)
  } else {
    compareYears = [year - 1, year - 2]
  }

  const key = cacheKey(year, compareYears)
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
    return NextResponse.json(hit.data, {
      headers: { 'Cache-Control': 'private, max-age=60', 'x-ytd-cache': 'hit' },
    })
  }

  try {
    const [currentRollup, priorRollups, topBuilders, opex] = await Promise.all([
      getMonthlyFinancials(year),
      Promise.all(compareYears.map((y) => getMonthlyFinancials(y))),
      fetchTopBuilders(year),
      fetchOpexProxy(year),
    ])

    const compare: Record<string, YtdCompareYear> = {}
    compare[String(year)] = toCompareYear(currentRollup, asOfMonth)
    for (const r of priorRollups) {
      compare[String(r.year)] = toCompareYear(r, asOfMonth)
    }

    // YoY vs nearest prior year (apples-to-apples window)
    const priorKey = String(year - 1)
    const prior = compare[priorKey]
    const currentWindow = windowedTotals(currentRollup, asOfMonth)
    const yoy = prior
      ? {
          revenueDelta: currentWindow.revenue - prior.sameWindowRevenue,
          revenueDeltaPct:
            prior.sameWindowRevenue > 0
              ? ((currentWindow.revenue - prior.sameWindowRevenue) / prior.sameWindowRevenue) * 100
              : 0,
          cogsDelta: currentWindow.cogs - prior.sameWindowCogs,
          cogsDeltaPct:
            prior.sameWindowCogs > 0
              ? ((currentWindow.cogs - prior.sameWindowCogs) / prior.sameWindowCogs) * 100
              : 0,
          gmDelta: currentWindow.gm - prior.sameWindowGm,
          gmDeltaPct:
            prior.sameWindowGm !== 0
              ? ((currentWindow.gm - prior.sameWindowGm) / Math.abs(prior.sameWindowGm)) * 100
              : 0,
        }
      : { revenueDelta: 0, revenueDeltaPct: 0, cogsDelta: 0, cogsDeltaPct: 0, gmDelta: 0, gmDeltaPct: 0 }

    // Top by GM% — min $10k revenue floor to avoid tiny-builder noise
    const topByGmPct = [...topBuilders]
      .filter((b) => b.revenue >= 10_000)
      .sort((a, b) => b.gmPct - a.gmPct)
      .slice(0, 10)

    const byMonth: YtdMonthRow[] = currentRollup.months.map((m) => ({
      month: m.month,
      monthLabel: m.monthLabel,
      revenue: Math.round(m.revenue),
      cogs: Math.round(m.cogs),
      gm: Math.round(m.gp),
      gmPct: Math.round(m.gpPct * 10) / 10,
    }))

    const ytd: YtdTotals = currentRollup.ytd

    const payload: YtdResponse = {
      year,
      asOf: now.toISOString(),
      asOfMonth,
      revenue: Math.round(ytd.revenue),
      cogs: Math.round(ytd.cogs),
      gm: Math.round(ytd.gp),
      gmPct: Math.round(ytd.gpPct * 10) / 10,
      opex: Math.round(opex),
      byMonth,
      compare,
      yoy,
      topBuilders: topBuilders.slice(0, 10),
      topByGmPct,
    }

    cache.set(key, { at: Date.now(), data: payload })
    return NextResponse.json(payload, {
      headers: { 'Cache-Control': 'private, max-age=60', 'x-ytd-cache': 'miss' },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('[finance/ytd] error', err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

// NOTE: cache invalidation was previously exposed as `export function _clearYtdCache()`
// but Next.js 14 app-router route files only permit HTTP method + config exports
// (GET/POST/.../dynamic/revalidate/runtime/etc). Any other export = build failure.
// Cache.clear() is reachable via restarting the Lambda cold start — no caller
// relied on this symbol. If invalidation is ever needed at runtime, add a
// POST handler with an ?action=clear-cache query param gated behind checkStaffAuth.
