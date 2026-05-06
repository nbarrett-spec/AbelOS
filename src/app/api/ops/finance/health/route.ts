export const dynamic = 'force-dynamic'
import { prisma } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'
import { safeJson } from '@/lib/safe-json'
import { parseRoles, type StaffRole } from '@/lib/permissions'

const SENSITIVE_FINANCE_ROLES: StaffRole[] = ['ADMIN', 'MANAGER', 'ACCOUNTING']

export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  const staffRolesStr = request.headers.get('x-staff-roles') || request.headers.get('x-staff-role') || ''
  const userRoles = parseRoles(staffRolesStr) as StaffRole[]
  const canSeeSensitiveFinance = userRoles.some(r => SENSITIVE_FINANCE_ROLES.includes(r))

  try {
    const now = new Date()
    // Cash-flow horizons (days out from now) — used in the SQL aggregation
    // below to bucket inflows/outflows without fetching every Invoice/PO row.
    const horizonMs = (days: number) => new Date(now.getTime() + days * 24 * 60 * 60 * 1000)
    const horizon30 = horizonMs(30)
    const horizon60 = horizonMs(60)
    const horizon90 = horizonMs(90)

    // ── Order totals (count + revenue) — one round-trip ──
    const orderAggResult: any[] = await prisma.$queryRawUnsafe(
      `SELECT COUNT(*)::int AS count, COALESCE(SUM(total), 0)::float AS "totalRevenue"
       FROM "Order"`
    )
    const ordersTotalRevenue = Number(orderAggResult[0]?.totalRevenue || 0)
    const totalOrderCount = orderAggResult[0]?.count || 0

    // ── Invoice rollup: total billed, total collected, total outstanding ──
    const invoiceAggResult: any[] = await prisma.$queryRawUnsafe(
      `SELECT
         COALESCE(SUM(total), 0)::float                           AS "totalInvoiced",
         COALESCE(SUM("amountPaid"), 0)::float                    AS "totalCollected",
         COALESCE(SUM(total - "amountPaid"), 0)::float            AS "totalOutstanding"
       FROM "Invoice"`
    )
    const totalInvoiced = Number(invoiceAggResult[0]?.totalInvoiced || 0)
    const totalCollected = Number(invoiceAggResult[0]?.totalCollected || 0)
    const totalOutstanding = Number(invoiceAggResult[0]?.totalOutstanding || 0)

    // ── PO rollup: total count + count of RECEIVED (used for vendor timeliness) ──
    const poAggResult: any[] = await prisma.$queryRawUnsafe(
      `SELECT
         COUNT(*)::int                                                   AS "totalPOs",
         COUNT(*) FILTER (WHERE status::text = 'RECEIVED')::int          AS "receivedPOs"
       FROM "PurchaseOrder"`
    )
    const totalPOs = poAggResult[0]?.totalPOs || 0
    const paidOnTimePOs = poAggResult[0]?.receivedPOs || 0

    // ── Cash-flow buckets — single query computes 30/60/90 inflows/outflows ──
    const cashFlowResult: any[] = await prisma.$queryRawUnsafe(
      `WITH inflows AS (
        SELECT
          COALESCE(SUM(CASE WHEN COALESCE("dueDate", "createdAt" + INTERVAL '30 days') > $1
                            AND COALESCE("dueDate", "createdAt" + INTERVAL '30 days') <= $2
                       THEN total - "amountPaid" ELSE 0 END), 0)::float AS "in30",
          COALESCE(SUM(CASE WHEN COALESCE("dueDate", "createdAt" + INTERVAL '30 days') > $1
                            AND COALESCE("dueDate", "createdAt" + INTERVAL '30 days') <= $3
                       THEN total - "amountPaid" ELSE 0 END), 0)::float AS "in60",
          COALESCE(SUM(CASE WHEN COALESCE("dueDate", "createdAt" + INTERVAL '30 days') > $1
                            AND COALESCE("dueDate", "createdAt" + INTERVAL '30 days') <= $4
                       THEN total - "amountPaid" ELSE 0 END), 0)::float AS "in90"
        FROM "Invoice"
        WHERE status::text != 'PAID'
      ),
      outflows AS (
        SELECT
          COALESCE(SUM(CASE WHEN COALESCE("expectedDate", $1) <= $2 THEN total ELSE 0 END), 0)::float AS "out30",
          COALESCE(SUM(CASE WHEN COALESCE("expectedDate", $1) <= $3 THEN total ELSE 0 END), 0)::float AS "out60",
          COALESCE(SUM(CASE WHEN COALESCE("expectedDate", $1) <= $4 THEN total ELSE 0 END), 0)::float AS "out90"
        FROM "PurchaseOrder"
        WHERE status::text != 'RECEIVED'
      )
      SELECT i."in30", i."in60", i."in90", o."out30", o."out60", o."out90"
        FROM inflows i, outflows o`,
      now, horizon30, horizon60, horizon90
    )
    const cf = cashFlowResult[0] || { in30: 0, in60: 0, in90: 0, out30: 0, out60: 0, out90: 0 }

    // ── Builder health: per-builder billed/paid/balance + credit limit, all DB-side ──
    const builderHealthRows: any[] = await prisma.$queryRawUnsafe(
      `SELECT
         b.id                                              AS "builderId",
         b."companyName"                                   AS "builderName",
         COALESCE(b."creditLimit", 50000)::float           AS "creditLimit",
         COALESCE(SUM(i.total), 0)::float                  AS "totalBilled",
         COALESCE(SUM(i."amountPaid"), 0)::float           AS "totalPaid"
       FROM "Builder" b
       JOIN "Order" o ON o."builderId" = b.id
       LEFT JOIN "Invoice" i ON i."builderId" = b.id
       GROUP BY b.id, b."companyName", b."creditLimit"
       ORDER BY (
         COALESCE(SUM(i.total), 0) - COALESCE(SUM(i."amountPaid"), 0)
       ) / GREATEST(COALESCE(b."creditLimit", 50000), 1) DESC`
    )

    // ── Revenue by job scope — combine Job.scopeType with Order.total via SQL ──
    const revenueByScopeRows: any[] = await prisma.$queryRawUnsafe(
      `SELECT
         j."scopeType"                                  AS "scopeType",
         COUNT(j.id)::int                               AS "jobCount",
         COALESCE(SUM(o.total), 0)::float               AS amount
       FROM "Job" j
       LEFT JOIN "Order" o ON o.id = j."orderId"
       GROUP BY j."scopeType"`
    )

    // Calculate gross margin from ACTUAL order line items vs product cost
    let marginData: any[] = []
    try {
      marginData = await prisma.$queryRawUnsafe(`
        SELECT
          COALESCE(SUM(oi."lineTotal"), 0)::float as "totalRevenue",
          COALESCE(SUM(oi.quantity * COALESCE(bom_cost(p.id), p.cost)), 0)::float as "totalCost"
        FROM "OrderItem" oi
        JOIN "Product" p ON oi."productId" = p.sku
        JOIN "Order" o ON oi."orderId" = o.id
      `)
    } catch { marginData = [{ totalRevenue: 0, totalCost: 0 }] }
    const totalProductRevenue = Number(marginData[0]?.totalRevenue || 0)
    const totalProductCost = Number(marginData[0]?.totalCost || 0)
    const grossMarginPercent = totalProductRevenue > 0 ? (totalProductRevenue - totalProductCost) / totalProductRevenue : 0

    // Revenue per job — aggregate from ALL sources (Orders + BPW + Hyphen)
    let totalRevenue = ordersTotalRevenue

    // Add BPW invoice revenue (Pulte)
    try {
      const bpwRev: any[] = await prisma.$queryRawUnsafe(
        `SELECT COALESCE(SUM(ABS("amount")), 0)::float as total FROM "BpwInvoice" WHERE "amount" IS NOT NULL`
      )
      totalRevenue += Number(bpwRev[0]?.total || 0)
    } catch { /* BpwInvoice table may not exist yet */ }

    // Add Hyphen payment revenue (Toll/Brookfield/Shaddock)
    try {
      const hypRev: any[] = await prisma.$queryRawUnsafe(
        `SELECT COALESCE(SUM(ABS("amount")), 0)::float as total FROM "HyphenPayment" WHERE "amount" IS NOT NULL`
      )
      totalRevenue += Number(hypRev[0]?.total || 0)
    } catch { /* HyphenPayment table may not exist yet */ }

    const totalJobs = totalOrderCount || 1
    const revenuePerJob = totalRevenue / totalJobs

    // AR Collection rate (totals come from invoiceAggResult)
    const arCollectionRate = totalInvoiced > 0 ? totalCollected / totalInvoiced : 0

    // DSO (Days Sales Outstanding)
    const dailyRevenue = totalCollected > 0 ? totalCollected / 365 : 1
    const dso = dailyRevenue > 0 ? totalOutstanding / dailyRevenue : 0

    // Vendor payment timeliness — totals come from poAggResult
    const vendorPaymentTimeliness = totalPOs > 0 ? paidOnTimePOs / totalPOs : 1.0

    // Cash flow projection — values precomputed by cashFlowResult above
    const next30Days = { expectedInflows: cf.in30, expectedOutflows: cf.out30 }
    const next60Days = { expectedInflows: cf.in60, expectedOutflows: cf.out60 }
    const next90Days = { expectedInflows: cf.in90, expectedOutflows: cf.out90 }

    next30Days.expectedInflows = next30Days.expectedInflows || next60Days.expectedInflows / 2
    next30Days.expectedOutflows = next30Days.expectedOutflows || next60Days.expectedOutflows / 2

    // Builder health — final shaping from DB rows
    const builderHealth = builderHealthRows.map((row: any) => {
      const totalBilled = Number(row.totalBilled || 0)
      const totalPaid = Number(row.totalPaid || 0)
      const balance = totalBilled - totalPaid
      const creditLimit = Number(row.creditLimit || 50000)
      const utilization = (balance / creditLimit) * 100
      const paymentHistoryScore = (totalPaid / Math.max(totalBilled, 1)) * 100

      let riskFlag: string | null = null
      if (utilization > 80) riskFlag = 'High Balance'
      if (paymentHistoryScore < 70) riskFlag = 'Slow Pay'
      if (utilization > 80 && paymentHistoryScore < 70) riskFlag = 'Critical'

      return {
        builderId: row.builderId,
        builderName: row.builderName || 'Unknown',
        creditLimit,
        currentBalance: balance,
        utilizationPercent: utilization,
        paymentHistoryScore,
        riskFlag,
      }
    })

    // Revenue by scope type — pre-aggregated rows + percent-of-total in JS
    const totalScopeAmount = revenueByScopeRows.reduce((sum: number, r: any) => sum + Number(r.amount || 0), 0)
    const revenueByScope = revenueByScopeRows
      .map((r: any) => ({
        scopeType: r.scopeType,
        amount: Number(r.amount || 0),
        jobCount: r.jobCount || 0,
        percent: totalScopeAmount > 0 ? (Number(r.amount || 0) / totalScopeAmount) * 100 : 0,
      }))
      .sort((a, b) => b.amount - a.amount)

    return NextResponse.json(
      {
        keyMetrics: {
          // Margin hidden from non-finance roles
          grossMarginPercent: canSeeSensitiveFinance ? grossMarginPercent : undefined,
          revenuePerJob,
          arCollectionRate: canSeeSensitiveFinance ? arCollectionRate : undefined,
          dso: canSeeSensitiveFinance ? dso : undefined,
          vendorPaymentTimeliness,
        },
        // Cash flow projections restricted to finance roles
        cashFlowProjection: canSeeSensitiveFinance ? {
          next30Days: {
            expectedInflows: next30Days.expectedInflows,
            expectedOutflows: next30Days.expectedOutflows,
            netProjection: next30Days.expectedInflows - next30Days.expectedOutflows,
          },
          next60Days: {
            expectedInflows: next60Days.expectedInflows,
            expectedOutflows: next60Days.expectedOutflows,
            netProjection: next60Days.expectedInflows - next60Days.expectedOutflows,
          },
          next90Days: {
            expectedInflows: next90Days.expectedInflows,
            expectedOutflows: next90Days.expectedOutflows,
            netProjection: next90Days.expectedInflows - next90Days.expectedOutflows,
          },
        } : { restricted: true },
        // Builder credit health — restrict credit limits to finance roles
        builderHealth: canSeeSensitiveFinance ? builderHealth : builderHealth.map((b: any) => ({
          builderId: b.builderId,
          builderName: b.builderName,
          riskFlag: b.riskFlag,
          // Hide exact balance and credit limit from non-finance roles
        })),
        revenueByScope,
      },
      { headers: { 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    console.error('Health API error:', error)
    return NextResponse.json({ error: 'Failed to fetch health data' }, { status: 500 })
  }
}
