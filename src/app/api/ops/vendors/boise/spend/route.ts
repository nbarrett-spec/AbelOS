export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireStaffAuth } from '@/lib/api-auth'

// ──────────────────────────────────────────────────────────────────────────
// A-PERF-10 — Boise Cascade Spend Read Endpoint
//
// GET /api/ops/vendors/boise/spend?window=30d|90d|ytd  (default: 90d)
//
// Reads pre-computed BoiseSpendSnapshot rows written nightly by the
// `boise-spend-snapshot` cron. Falls back to a live aggregate query if no
// snapshot for the requested window exists yet (first deploy / cron not run).
//
// The snapshot table is keyed on (periodStart, periodEnd). To find the latest
// snapshot for a window we accept any periodEnd within the last 36h so a
// snapshot computed at 4am today still serves a request made at 8pm tonight.
// ──────────────────────────────────────────────────────────────────────────

type WindowKey = '30d' | '90d' | 'ytd'

interface SnapshotRow {
  id: string
  periodStart: Date
  periodEnd: Date
  totalSpend: number
  poCount: number
  itemCount: number
  byCategory: Record<string, number>
  byMonth: Array<{ month: string; spend: number }>
  computedAt: Date
}

interface CategoryRow {
  category: string
  spend: number
}

interface MonthRow {
  month: string
  spend: number
}

interface TotalsRow {
  totalSpend: number
  poCount: number
  itemCount: number
}

function parseWindow(raw: string | null): WindowKey {
  if (raw === '30d' || raw === '90d' || raw === 'ytd') return raw
  return '90d'
}

function buildPeriod(window: WindowKey): { periodStart: Date; periodEnd: Date } {
  const periodEnd = new Date()
  periodEnd.setUTCHours(0, 0, 0, 0)

  if (window === 'ytd') {
    return {
      periodStart: new Date(Date.UTC(periodEnd.getUTCFullYear(), 0, 1)),
      periodEnd,
    }
  }

  const days = window === '30d' ? 30 : 90
  const periodStart = new Date(periodEnd)
  periodStart.setUTCDate(periodStart.getUTCDate() - days)
  return { periodStart, periodEnd }
}

async function findSnapshot(
  window: WindowKey,
  periodStart: Date
): Promise<SnapshotRow | null> {
  // 36h freshness — snapshot from this morning's 4am cron (or yesterday's,
  // if today's cron hasn't fired yet) is still good.
  const cutoff = new Date(Date.now() - 36 * 60 * 60 * 1000)

  // Match periodStart within +/- 1 day to absorb day-boundary drift between
  // when the cron computes the window and when the read endpoint computes it.
  const startMin = new Date(periodStart.getTime() - 24 * 60 * 60 * 1000)
  const startMax = new Date(periodStart.getTime() + 24 * 60 * 60 * 1000)

  const rows: SnapshotRow[] = await prisma.$queryRawUnsafe<SnapshotRow[]>(
    `SELECT id, "periodStart", "periodEnd", "totalSpend", "poCount", "itemCount",
            "byCategory", "byMonth", "computedAt"
     FROM "BoiseSpendSnapshot"
     WHERE "periodStart" >= $1 AND "periodStart" <= $2
       AND "computedAt" >= $3
     ORDER BY "computedAt" DESC
     LIMIT 1`,
    startMin,
    startMax,
    cutoff
  )

  return rows[0] ?? null
}

async function computeLive(periodStart: Date, periodEnd: Date) {
  const totals = await prisma.$queryRawUnsafe<TotalsRow[]>(
    `SELECT
       COALESCE(SUM(po."total"), 0)::float AS "totalSpend",
       COUNT(DISTINCT po."id")::int        AS "poCount",
       COALESCE(SUM(itm.cnt), 0)::int      AS "itemCount"
     FROM "PurchaseOrder" po
     JOIN "Vendor" v ON v.id = po."vendorId"
     LEFT JOIN (
       SELECT "purchaseOrderId", COUNT(*)::int AS cnt
       FROM "PurchaseOrderItem"
       GROUP BY "purchaseOrderId"
     ) itm ON itm."purchaseOrderId" = po.id
     WHERE (v.code = 'BC' OR v.name ILIKE 'Boise%')
       AND po."status" NOT IN ('DRAFT', 'CANCELLED')
       AND COALESCE(po."orderedAt", po."createdAt") >= $1
       AND COALESCE(po."orderedAt", po."createdAt") <  $2`,
    periodStart,
    periodEnd
  )

  const headline = totals[0] ?? { totalSpend: 0, poCount: 0, itemCount: 0 }

  const cats = await prisma.$queryRawUnsafe<CategoryRow[]>(
    `SELECT po."category"::text AS category,
            COALESCE(SUM(po."total"), 0)::float AS spend
     FROM "PurchaseOrder" po
     JOIN "Vendor" v ON v.id = po."vendorId"
     WHERE (v.code = 'BC' OR v.name ILIKE 'Boise%')
       AND po."status" NOT IN ('DRAFT', 'CANCELLED')
       AND COALESCE(po."orderedAt", po."createdAt") >= $1
       AND COALESCE(po."orderedAt", po."createdAt") <  $2
     GROUP BY po."category"`,
    periodStart,
    periodEnd
  )

  const byCategory: Record<string, number> = {}
  for (const c of cats) {
    byCategory[c.category] = Math.round(c.spend * 100) / 100
  }

  const months = await prisma.$queryRawUnsafe<MonthRow[]>(
    `SELECT TO_CHAR(DATE_TRUNC('month', COALESCE(po."orderedAt", po."createdAt")), 'YYYY-MM') AS month,
            COALESCE(SUM(po."total"), 0)::float AS spend
     FROM "PurchaseOrder" po
     JOIN "Vendor" v ON v.id = po."vendorId"
     WHERE (v.code = 'BC' OR v.name ILIKE 'Boise%')
       AND po."status" NOT IN ('DRAFT', 'CANCELLED')
       AND COALESCE(po."orderedAt", po."createdAt") >= $1
       AND COALESCE(po."orderedAt", po."createdAt") <  $2
     GROUP BY 1
     ORDER BY 1 ASC`,
    periodStart,
    periodEnd
  )

  return {
    totalSpend: Math.round(headline.totalSpend * 100) / 100,
    poCount: headline.poCount,
    itemCount: headline.itemCount,
    byCategory,
    byMonth: months.map(m => ({
      month: m.month,
      spend: Math.round(m.spend * 100) / 100,
    })),
  }
}

export async function GET(request: NextRequest) {
  const auth = await requireStaffAuth(request)
  if (auth.error) return auth.error

  try {
    const window = parseWindow(request.nextUrl.searchParams.get('window'))
    const { periodStart, periodEnd } = buildPeriod(window)

    // 1. Try snapshot first (cheap).
    const snap = await findSnapshot(window, periodStart)
    if (snap) {
      return NextResponse.json({
        window,
        periodStart: snap.periodStart,
        periodEnd: snap.periodEnd,
        totalSpend: snap.totalSpend,
        poCount: snap.poCount,
        itemCount: snap.itemCount,
        byCategory: snap.byCategory ?? {},
        byMonth: snap.byMonth ?? [],
        source: 'snapshot',
        computedAt: snap.computedAt,
      })
    }

    // 2. Fallback — compute live. Slower, but correct on cold-start.
    const live = await computeLive(periodStart, periodEnd)
    return NextResponse.json({
      window,
      periodStart,
      periodEnd,
      ...live,
      source: 'live',
      computedAt: new Date(),
    })
  } catch (error) {
    console.error('GET /api/ops/vendors/boise/spend error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch Boise spend', details: String(error) },
      { status: 500 }
    )
  }
}
