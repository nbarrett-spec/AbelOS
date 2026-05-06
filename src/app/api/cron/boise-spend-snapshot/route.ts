export const dynamic = 'force-dynamic'
export const maxDuration = 300

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { withCronRun } from '@/lib/cron'
import { logger } from '@/lib/logger'

// ──────────────────────────────────────────────────────────────────────────
// A-PERF-10 — Boise Cascade Spend Snapshot Cron
//
// Runs daily at 4am Central (10 UTC). Auth: Bearer ${CRON_SECRET}.
//
// For each of the three windows the supply-chain / vendor pages care about
// (last 30 days, last 90 days, YTD), this cron computes:
//   - totalSpend across Boise POs in the window
//   - poCount, itemCount
//   - byCategory:  POCategory → spend
//   - byMonth:     12-element [{ month: "2026-01", spend: number }] series
// ...and upserts a row in BoiseSpendSnapshot keyed on (periodStart, periodEnd).
//
// The /api/ops/vendors/boise/spend read endpoint serves whichever snapshot
// matches the requested window. If no snapshot exists yet (first deploy /
// cron not run), the read endpoint falls back to live computation.
//
// "Boise" is matched by Vendor.code = 'BC' (canonical) or
// Vendor.name ILIKE 'Boise%' (defensive — catches code drift).
// ──────────────────────────────────────────────────────────────────────────

function validateCronAuth(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  const auth = request.headers.get('authorization') || ''
  return auth === `Bearer ${secret}`
}

interface WindowDef {
  label: string
  periodStart: Date
  periodEnd: Date
}

interface CategoryRow {
  category: string
  spend: number
}

interface MonthRow {
  month: string // "YYYY-MM"
  spend: number
}

interface TotalsRow {
  totalSpend: number
  poCount: number
  itemCount: number
}

function buildWindows(now: Date): WindowDef[] {
  const periodEnd = new Date(now)
  // Truncate to start of day UTC so re-runs within a day produce identical keys
  periodEnd.setUTCHours(0, 0, 0, 0)

  const last30 = new Date(periodEnd)
  last30.setUTCDate(last30.getUTCDate() - 30)

  const last90 = new Date(periodEnd)
  last90.setUTCDate(last90.getUTCDate() - 90)

  const ytdStart = new Date(Date.UTC(periodEnd.getUTCFullYear(), 0, 1))

  return [
    { label: 'last_30_days', periodStart: last30, periodEnd },
    { label: 'last_90_days', periodStart: last90, periodEnd },
    { label: 'ytd', periodStart: ytdStart, periodEnd },
  ]
}

async function computeWindow(w: WindowDef): Promise<{
  totalSpend: number
  poCount: number
  itemCount: number
  byCategory: Record<string, number>
  byMonth: MonthRow[]
}> {
  // Headline totals — single SUM over PurchaseOrder, restricted to Boise.
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
    w.periodStart,
    w.periodEnd
  )

  const headline = totals[0] ?? { totalSpend: 0, poCount: 0, itemCount: 0 }

  // Category breakdown — group by POCategory.
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
    w.periodStart,
    w.periodEnd
  )

  const byCategory: Record<string, number> = {}
  for (const c of cats) {
    byCategory[c.category] = Math.round(c.spend * 100) / 100
  }

  // Monthly breakdown — always 12 months ending at periodEnd, even if some
  // months are zero. Lets the chart render a continuous series.
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
    w.periodStart,
    w.periodEnd
  )

  const monthMap = new Map(months.map(m => [m.month, m.spend]))
  const byMonth: MonthRow[] = []
  // Walk from periodStart's month → periodEnd's month
  const cur = new Date(Date.UTC(w.periodStart.getUTCFullYear(), w.periodStart.getUTCMonth(), 1))
  const stop = new Date(Date.UTC(w.periodEnd.getUTCFullYear(), w.periodEnd.getUTCMonth(), 1))
  while (cur <= stop) {
    const key = `${cur.getUTCFullYear()}-${String(cur.getUTCMonth() + 1).padStart(2, '0')}`
    byMonth.push({ month: key, spend: Math.round((monthMap.get(key) ?? 0) * 100) / 100 })
    cur.setUTCMonth(cur.getUTCMonth() + 1)
  }

  return {
    totalSpend: Math.round(headline.totalSpend * 100) / 100,
    poCount: headline.poCount,
    itemCount: headline.itemCount,
    byCategory,
    byMonth,
  }
}

async function upsertSnapshot(
  w: WindowDef,
  data: {
    totalSpend: number
    poCount: number
    itemCount: number
    byCategory: Record<string, number>
    byMonth: MonthRow[]
  }
): Promise<string> {
  const id = `bss_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  await prisma.$executeRawUnsafe(
    `INSERT INTO "BoiseSpendSnapshot"
       (id, "periodStart", "periodEnd", "totalSpend", "poCount", "itemCount",
        "byCategory", "byMonth", "computedAt")
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, NOW())
     ON CONFLICT ("periodStart", "periodEnd") DO UPDATE SET
       "totalSpend" = EXCLUDED."totalSpend",
       "poCount"    = EXCLUDED."poCount",
       "itemCount"  = EXCLUDED."itemCount",
       "byCategory" = EXCLUDED."byCategory",
       "byMonth"    = EXCLUDED."byMonth",
       "computedAt" = NOW()`,
    id,
    w.periodStart,
    w.periodEnd,
    data.totalSpend,
    data.poCount,
    data.itemCount,
    JSON.stringify(data.byCategory),
    JSON.stringify(data.byMonth)
  )
  return id
}

async function runSnapshot() {
  const windows = buildWindows(new Date())
  const summary: Array<{
    label: string
    periodStart: string
    periodEnd: string
    totalSpend: number
    poCount: number
    itemCount: number
  }> = []

  for (const w of windows) {
    try {
      const data = await computeWindow(w)
      await upsertSnapshot(w, data)
      summary.push({
        label: w.label,
        periodStart: w.periodStart.toISOString(),
        periodEnd: w.periodEnd.toISOString(),
        totalSpend: data.totalSpend,
        poCount: data.poCount,
        itemCount: data.itemCount,
      })
    } catch (e: any) {
      logger.error('boise_spend_snapshot_window_failed', e, { window: w.label })
      throw e
    }
  }

  return { windows: summary }
}

export async function GET(request: NextRequest) {
  if (!validateCronAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  return withCronRun('boise-spend-snapshot', async () => {
    const result = await runSnapshot()
    return NextResponse.json({ success: true, ...result })
  })
}

export async function POST(request: NextRequest) {
  return GET(request)
}
