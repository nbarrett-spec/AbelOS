export const dynamic = 'force-dynamic'
import { prisma } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'
import { safeJson } from '@/lib/safe-json'
import { cached } from '@/lib/cache'

async function computeFinanceDashboard() {
    const now = new Date()
    const currentDate = now
    const monthStart = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1)
    const quarterStart = new Date(
      currentDate.getFullYear(),
      Math.floor(currentDate.getMonth() / 3) * 3,
      1
    )
    const yearStart = new Date(currentDate.getFullYear(), 0, 1)

    // ── AR aging — bucketed in a single SQL pass over open invoices ──
    const arAgingResult: any[] = await prisma.$queryRawUnsafe(
      `WITH open_invs AS (
        SELECT
          (total - "amountPaid") AS balance,
          EXTRACT(DAY FROM ($1::timestamptz - COALESCE("issuedAt", "createdAt"))) AS days_out
        FROM "Invoice"
        WHERE status::text NOT IN ('PAID', 'VOID')
          AND (total - "amountPaid") > 0
      )
      SELECT
        COUNT(*) FILTER (WHERE days_out <= 0)::int                                       AS "currentCount",
        COALESCE(SUM(balance) FILTER (WHERE days_out <= 0), 0)::float                    AS "currentAmount",
        COUNT(*) FILTER (WHERE days_out > 0  AND days_out <= 30)::int                    AS "d1Count",
        COALESCE(SUM(balance) FILTER (WHERE days_out > 0  AND days_out <= 30), 0)::float AS "d1Amount",
        COUNT(*) FILTER (WHERE days_out > 30 AND days_out <= 60)::int                    AS "d2Count",
        COALESCE(SUM(balance) FILTER (WHERE days_out > 30 AND days_out <= 60), 0)::float AS "d2Amount",
        COUNT(*) FILTER (WHERE days_out > 60)::int                                       AS "d3Count",
        COALESCE(SUM(balance) FILTER (WHERE days_out > 60), 0)::float                    AS "d3Amount"
      FROM open_invs`,
      now
    )
    const ar = arAgingResult[0] || {}
    const arAging = {
      current:    { count: ar.currentCount || 0, amount: Number(ar.currentAmount || 0) },
      days1to30:  { count: ar.d1Count || 0,      amount: Number(ar.d1Amount || 0) },
      days31to60: { count: ar.d2Count || 0,      amount: Number(ar.d2Amount || 0) },
      days60plus: { count: ar.d3Count || 0,      amount: Number(ar.d3Amount || 0) },
    }
    const totalAR =
      arAging.current.amount +
      arAging.days1to30.amount +
      arAging.days31to60.amount +
      arAging.days60plus.amount

    // ── AP summary — open POs grouped by vendor in one query ──
    const apByVendorRows: any[] = await prisma.$queryRawUnsafe(
      `SELECT
         po."vendorId"                                          AS "vendorId",
         COALESCE(v.name, 'Unknown')                            AS "vendorName",
         CASE WHEN v.active THEN 'active' ELSE 'inactive' END   AS status,
         COUNT(po.id)::int                                      AS "totalPOs",
         COALESCE(SUM(po.total), 0)::float                      AS total
       FROM "PurchaseOrder" po
       LEFT JOIN "Vendor" v ON v.id = po."vendorId"
       WHERE po.status::text NOT IN ('CANCELLED', 'RECEIVED')
       GROUP BY po."vendorId", v.name, v.active
       ORDER BY total DESC`
    )
    const apSummary = apByVendorRows.map((r: any) => ({
      vendorId: r.vendorId,
      vendorName: r.vendorName,
      totalPOs: r.totalPOs,
      total: Number(r.total || 0),
      status: r.status,
    }))
    const totalAP = apSummary.reduce((sum: number, v: any) => sum + v.total, 0)

    // ── Invoice & PO alert metrics — both rolled up DB-side ──
    const invoiceAlertsResult: any[] = await prisma.$queryRawUnsafe(
      `SELECT
        COUNT(*) FILTER (WHERE status::text NOT IN ('PAID', 'OVERDUE')
                          AND COALESCE("dueDate", "createdAt" + INTERVAL '30 days') < $1)::int    AS "overdueCount",
        COALESCE(SUM(CASE WHEN status::text NOT IN ('PAID', 'OVERDUE')
                          AND COALESCE("dueDate", "createdAt" + INTERVAL '30 days') < $1
                     THEN total - "amountPaid" ELSE 0 END), 0)::float                              AS "overdueAmount",
        COUNT(*) FILTER (WHERE status::text != 'PAID' AND (total - "amountPaid") > 5000)::int      AS "unpaidCount",
        COALESCE(SUM(CASE WHEN status::text != 'PAID' AND (total - "amountPaid") > 5000
                     THEN total - "amountPaid" ELSE 0 END), 0)::float                              AS "unpaidAmount"
       FROM "Invoice"`,
      now
    )
    const invAlerts = invoiceAlertsResult[0] || {}

    const poAlertResult: any[] = await prisma.$queryRawUnsafe(
      `SELECT COUNT(*)::int AS count, COALESCE(SUM(total), 0)::float AS total
       FROM "PurchaseOrder" WHERE status::text = 'PENDING_APPROVAL'`
    )
    const posPendingApprovalCount = poAlertResult[0]?.count || 0
    const posPendingApprovalAmount = Number(poAlertResult[0]?.total || 0)

    // ── Combined revenue (Order + BpwInvoice + HyphenPayment) ──
    // Single CTE pulls all three streams; we compute monthly buckets and
    // period totals from it without materializing rows in Node memory.
    const sixMonthsAgo = new Date(currentDate.getFullYear(), currentDate.getMonth() - 5, 1)

    const COMBINED_REV_CTE = `
      WITH combined AS (
        SELECT "createdAt"::timestamptz AS rev_date, total::float AS amount, "builderId" AS bid
        FROM "Order" WHERE total > 0
        UNION ALL
        SELECT "invoiceDate"::timestamptz AS rev_date, ABS("amount")::float AS amount,
               (SELECT id FROM "Builder" WHERE LOWER("companyName") LIKE '%pulte%' LIMIT 1) AS bid
        FROM "BpwInvoice" WHERE "amount" IS NOT NULL AND "amount" != 0 AND "invoiceDate" IS NOT NULL
        UNION ALL
        SELECT hp."paymentDate"::timestamptz AS rev_date, ABS(hp."amount")::float AS amount,
               (SELECT id FROM "Builder"
                WHERE LOWER("companyName") LIKE LOWER(SPLIT_PART(hp."builderName", ' ', 1)) || '%'
                LIMIT 1) AS bid
        FROM "HyphenPayment" hp
        WHERE hp."amount" IS NOT NULL AND hp."amount" != 0 AND hp."paymentDate" IS NOT NULL
      )`

    const monthlyRevenueRows: any[] = await prisma.$queryRawUnsafe<any[]>(
      `${COMBINED_REV_CTE}
       SELECT
         DATE_TRUNC('month', rev_date)::date AS month_start,
         COALESCE(SUM(amount), 0)::float     AS amount
       FROM combined
       WHERE rev_date >= $1::timestamptz
       GROUP BY DATE_TRUNC('month', rev_date)
       ORDER BY month_start ASC`,
      sixMonthsAgo
    ).catch(() => [] as any[])

    const monthlyRevenueMap: Record<string, number> = {}
    for (const row of monthlyRevenueRows) {
      const d = new Date(row.month_start)
      monthlyRevenueMap[`${d.getFullYear()}-${d.getMonth()}`] = Number(row.amount || 0)
    }
    const monthlyRevenue: Array<{ month: string; amount: number }> = []
    for (let i = 5; i >= 0; i--) {
      const date = new Date(currentDate.getFullYear(), currentDate.getMonth() - i, 1)
      monthlyRevenue.push({
        month: date.toLocaleDateString('en-US', { month: 'short' }),
        amount: monthlyRevenueMap[`${date.getFullYear()}-${date.getMonth()}`] || 0,
      })
    }

    // Period totals — month/quarter/year in one query
    const periodTotalsResult: any[] = await prisma.$queryRawUnsafe<any[]>(
      `${COMBINED_REV_CTE}
       SELECT
         COALESCE(SUM(CASE WHEN rev_date >= $1 THEN amount ELSE 0 END), 0)::float AS "month",
         COALESCE(SUM(CASE WHEN rev_date >= $2 THEN amount ELSE 0 END), 0)::float AS "quarter",
         COALESCE(SUM(CASE WHEN rev_date >= $3 THEN amount ELSE 0 END), 0)::float AS "year"
       FROM combined`,
      monthStart, quarterStart, yearStart
    ).catch(() => [{ month: 0, quarter: 0, year: 0 }] as any[])
    const revenueThisMonth = Number(periodTotalsResult[0]?.month || 0)
    const revenueThisQuarter = Number(periodTotalsResult[0]?.quarter || 0)
    const revenueThisYear = Number(periodTotalsResult[0]?.year || 0)

    // Top builders by combined revenue — totalBilled is per-builder rev across
    // all three streams; balance + totalPaid come from the Invoice rollup.
    const topBuildersRows: any[] = await prisma.$queryRawUnsafe<any[]>(
      `${COMBINED_REV_CTE},
       per_builder AS (
         SELECT bid AS "builderId", COALESCE(SUM(amount), 0)::float AS "totalBilled"
         FROM combined WHERE bid IS NOT NULL GROUP BY bid
       ),
       inv_rollup AS (
         SELECT "builderId",
                COALESCE(SUM("amountPaid"), 0)::float          AS "totalPaid",
                COALESCE(SUM(total - "amountPaid"), 0)::float  AS balance
         FROM "Invoice" GROUP BY "builderId"
       )
       SELECT
         pb."builderId",
         b."companyName" AS "builderName",
         pb."totalBilled",
         COALESCE(i."totalPaid", 0)::float AS "totalPaid",
         COALESCE(i.balance, 0)::float AS balance
       FROM per_builder pb
       LEFT JOIN "Builder" b ON b.id = pb."builderId"
       LEFT JOIN inv_rollup i ON i."builderId" = pb."builderId"
       ORDER BY pb."totalBilled" DESC
       LIMIT 10`
    ).catch(() => [] as any[])
    const topBuilders = topBuildersRows.map((r: any) => ({
      builderId: r.builderId,
      builderName: r.builderName || 'Unknown',
      totalBilled: Number(r.totalBilled || 0),
      totalPaid: Number(r.totalPaid || 0),
      balance: Number(r.balance || 0),
    }))

    // Alerts — built directly from precomputed counters
    const alerts: Array<{ type: string; message: string; value: number; count: number }> = []
    if ((invAlerts.overdueCount || 0) > 0) {
      alerts.push({
        type: 'overdue',
        message: `${invAlerts.overdueCount} overdue invoices`,
        value: Number(invAlerts.overdueAmount || 0),
        count: invAlerts.overdueCount,
      })
    }
    if ((invAlerts.unpaidCount || 0) > 0) {
      alerts.push({
        type: 'unpaid',
        message: `${invAlerts.unpaidCount} large unpaid invoices (>$5K)`,
        value: Number(invAlerts.unpaidAmount || 0),
        count: invAlerts.unpaidCount,
      })
    }
    if (posPendingApprovalCount > 0) {
      alerts.push({
        type: 'approval',
        message: `${posPendingApprovalCount} POs awaiting approval`,
        value: posPendingApprovalAmount,
        count: posPendingApprovalCount,
      })
    }

    return {
      cashPosition: {
        totalAR,
        totalAP,
        netCashPosition: totalAR - totalAP,
        revenueThisMonth,
        revenueThisQuarter,
        revenueThisYear,
      },
      arAging,
      apSummary,
      monthlyRevenue,
      topBuilders,
      alerts,
    }
}

export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    // 60s TTL — finance dashboard is global; warm cache amortizes across all staff viewers.
    const payload = await cached('ops:finance:dashboard:v1', 60, computeFinanceDashboard)
    return NextResponse.json(payload, { headers: { 'Content-Type': 'application/json' } })
  } catch (error: any) {
    console.error('Dashboard API error:', error)
    return NextResponse.json({ error: 'Failed to fetch dashboard data' }, { status: 500 })
  }
}
