// ──────────────────────────────────────────────────────────────────────────
// Monthly financial rollup — SERVER-ONLY
//
// Returns a 12-row array (one per month) for a given calendar year covering:
//   revenue (Order.total, non-forecast)
//   cogs (PurchaseOrder.total — proxy, we don't track COGS in InvoiceItem yet)
//   gp (revenue - cogs)
//   gpPct (gp / revenue)
//   ni (gp — currently same as GP; opex not modeled yet, kept as field for future)
//   invoicesSent (count + sum Invoice.total)
//   paymentsReceived (count + sum Payment.amount)
//
// Also returns a YTD totals struct pre-aggregated for KPI strips.
//
// Cached in-process per (year) for the request lifetime so repeat calls from
// sibling dashboards (finance / exec / reports / kpis) don't hammer Neon.
// ──────────────────────────────────────────────────────────────────────────

import { prisma } from '@/lib/prisma'

export interface MonthlyFinancialRow {
  month: number // 1-12
  monthLabel: string // "Jan", "Feb", ...
  revenue: number
  cogs: number
  gp: number
  gpPct: number
  ni: number
  invoicesSent: number
  invoicesTotal: number
  paymentsReceived: number
  paymentsTotal: number
  orderCount: number
  poCount: number
}

export interface YtdTotals {
  year: number
  revenue: number
  cogs: number
  gp: number
  gpPct: number
  ni: number
  totalInvoiced: number
  totalCollected: number
  arOutstanding: number
  avgDso: number
  orderCount: number
  invoiceCount: number
  paymentCount: number
}

export interface MonthlyRollup {
  year: number
  months: MonthlyFinancialRow[]
  ytd: YtdTotals
}

const MONTH_LABELS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
]

// Request-scoped cache (per Node serverless instance). Keyed by year.
// Short-lived — lives for the life of one module instance which in Next.js
// is a single request on a cold container, otherwise shared for the duration
// of a warm invocation. That's the right tradeoff for dashboards.
const cache = new Map<number, { at: number; data: MonthlyRollup }>()
const CACHE_TTL_MS = 60_000 // 60s — dashboards refresh on interval anyway

function emptyRow(month: number): MonthlyFinancialRow {
  return {
    month,
    monthLabel: MONTH_LABELS[month - 1]!,
    revenue: 0,
    cogs: 0,
    gp: 0,
    gpPct: 0,
    ni: 0,
    invoicesSent: 0,
    invoicesTotal: 0,
    paymentsReceived: 0,
    paymentsTotal: 0,
    orderCount: 0,
    poCount: 0,
  }
}

type RawMonthRow = {
  month: Date
  total: number | null
  count: bigint | number | null
}
type RawInvMonthRow = RawMonthRow & { collected: number | null; balance: number | null }

function toNum(v: unknown): number {
  if (v === null || v === undefined) return 0
  if (typeof v === 'bigint') return Number(v)
  if (typeof v === 'number') return v
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

/**
 * Return 12-row monthly rollup for calendar year + pre-aggregated YTD totals.
 * Computed live from Order / PurchaseOrder / Invoice / Payment.
 *
 * COGS is proxied from PurchaseOrder.total since we don't track landed cost
 * per InvoiceItem yet. This is consistent with how /ops/finance already
 * calculates gross margin.
 */
export async function getMonthlyFinancials(year: number): Promise<MonthlyRollup> {
  const now = Date.now()
  const hit = cache.get(year)
  if (hit && now - hit.at < CACHE_TTL_MS) return hit.data

  const start = new Date(Date.UTC(year, 0, 1))
  const end = new Date(Date.UTC(year + 1, 0, 1))

  // Run queries in parallel — 4 CTEs would be equivalent but this is simpler
  // to read and the queries are all indexed on the date columns.
  const [orderRows, poRows, invRows, payRows, arRow, dsoRow] = await Promise.all([
    prisma.$queryRaw<RawMonthRow[]>`
      SELECT DATE_TRUNC('month', COALESCE("orderDate", "createdAt")) AS month,
             COUNT(*)::int AS count,
             COALESCE(SUM(total), 0)::float AS total
      FROM "Order"
      WHERE COALESCE("orderDate", "createdAt") >= ${start}
        AND COALESCE("orderDate", "createdAt") < ${end}
        AND "isForecast" = false
        AND status::text != 'CANCELLED'
      GROUP BY 1
    `,
    prisma.$queryRaw<RawMonthRow[]>`
      SELECT DATE_TRUNC('month', COALESCE("orderedAt", "createdAt")) AS month,
             COUNT(*)::int AS count,
             COALESCE(SUM(total), 0)::float AS total
      FROM "PurchaseOrder"
      WHERE COALESCE("orderedAt", "createdAt") >= ${start}
        AND COALESCE("orderedAt", "createdAt") < ${end}
      GROUP BY 1
    `,
    prisma.$queryRaw<RawInvMonthRow[]>`
      SELECT DATE_TRUNC('month', COALESCE("issuedAt", "createdAt")) AS month,
             COUNT(*)::int AS count,
             COALESCE(SUM(total), 0)::float AS total,
             COALESCE(SUM("amountPaid"), 0)::float AS collected,
             COALESCE(SUM("balanceDue"), 0)::float AS balance
      FROM "Invoice"
      WHERE COALESCE("issuedAt", "createdAt") >= ${start}
        AND COALESCE("issuedAt", "createdAt") < ${end}
      GROUP BY 1
    `,
    prisma.$queryRaw<RawMonthRow[]>`
      SELECT DATE_TRUNC('month', "receivedAt") AS month,
             COUNT(*)::int AS count,
             COALESCE(SUM(amount), 0)::float AS total
      FROM "Payment"
      WHERE "receivedAt" >= ${start} AND "receivedAt" < ${end}
      GROUP BY 1
    `,
    // AR outstanding is a snapshot — current open balances regardless of year
    prisma.$queryRaw<Array<{ outstanding: number }>>`
      SELECT COALESCE(SUM("balanceDue"), 0)::float AS outstanding
      FROM "Invoice"
      WHERE status::text NOT IN ('PAID','VOID','WRITE_OFF','DRAFT')
    `,
    // DSO — for issued-and-paid invoices in the year, average days between
    // issuedAt and paidAt. Simpler than a full weighted-average-AR-based DSO
    // and good enough for a header KPI.
    prisma.$queryRaw<Array<{ avg_days: number | null }>>`
      SELECT AVG(EXTRACT(EPOCH FROM ("paidAt" - "issuedAt")) / 86400)::float AS avg_days
      FROM "Invoice"
      WHERE "issuedAt" IS NOT NULL
        AND "paidAt" IS NOT NULL
        AND "issuedAt" >= ${start}
        AND "issuedAt" < ${end}
    `,
  ])

  // Build 12-row array
  const months: MonthlyFinancialRow[] = Array.from({ length: 12 }, (_, i) => emptyRow(i + 1))

  const idx = (d: Date) => d.getUTCMonth() // 0-11

  for (const r of orderRows) {
    const i = idx(new Date(r.month))
    months[i]!.revenue = toNum(r.total)
    months[i]!.orderCount = toNum(r.count)
  }
  for (const r of poRows) {
    const i = idx(new Date(r.month))
    months[i]!.cogs = toNum(r.total)
    months[i]!.poCount = toNum(r.count)
  }
  for (const r of invRows) {
    const i = idx(new Date(r.month))
    months[i]!.invoicesSent = toNum(r.count)
    months[i]!.invoicesTotal = toNum(r.total)
  }
  for (const r of payRows) {
    const i = idx(new Date(r.month))
    months[i]!.paymentsReceived = toNum(r.count)
    months[i]!.paymentsTotal = toNum(r.total)
  }

  // Derive GP / GP% / NI now that revenue + cogs are filled
  for (const m of months) {
    m.gp = m.revenue - m.cogs
    m.gpPct = m.revenue > 0 ? (m.gp / m.revenue) * 100 : 0
    m.ni = m.gp // opex not modeled — kept structurally so UI doesn't break
  }

  const ytdRevenue = months.reduce((s, m) => s + m.revenue, 0)
  const ytdCogs = months.reduce((s, m) => s + m.cogs, 0)
  const ytdGp = ytdRevenue - ytdCogs
  const ytdInvoiced = months.reduce((s, m) => s + m.invoicesTotal, 0)
  const ytdCollected = months.reduce((s, m) => s + m.paymentsTotal, 0)
  const ytdOrders = months.reduce((s, m) => s + m.orderCount, 0)
  const ytdInvoiceCount = months.reduce((s, m) => s + m.invoicesSent, 0)
  const ytdPaymentCount = months.reduce((s, m) => s + m.paymentsReceived, 0)

  const ytd: YtdTotals = {
    year,
    revenue: ytdRevenue,
    cogs: ytdCogs,
    gp: ytdGp,
    gpPct: ytdRevenue > 0 ? (ytdGp / ytdRevenue) * 100 : 0,
    ni: ytdGp, // placeholder until opex is modeled
    totalInvoiced: ytdInvoiced,
    totalCollected: ytdCollected,
    arOutstanding: toNum(arRow[0]?.outstanding),
    avgDso: Math.round(toNum(dsoRow[0]?.avg_days) * 10) / 10,
    orderCount: ytdOrders,
    invoiceCount: ytdInvoiceCount,
    paymentCount: ytdPaymentCount,
  }

  const data: MonthlyRollup = { year, months, ytd }
  cache.set(year, { at: now, data })
  return data
}

/** Clear the in-process cache (use sparingly — mainly for tests). */
export function clearMonthlyRollupCache(year?: number) {
  if (year !== undefined) cache.delete(year)
  else cache.clear()
}
