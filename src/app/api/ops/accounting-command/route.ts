export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getStaffSession } from '@/lib/staff-auth'

/**
 * Simple auth check helper
 * Returns error response if not authenticated, null if authenticated
 */
function checkStaffAuth(request: NextRequest): NextResponse | null {
  const staffId = request.headers.get('x-staff-id')
  const staffRole = request.headers.get('x-staff-role')

  if (!staffId || !staffRole) {
    return NextResponse.json(
      { error: 'Authentication required' },
      { status: 401 }
    )
  }

  return null
}

/**
 * Elite Accounting Command Center API
 * Comprehensive financial data endpoints for Abel Lumber
 *
 * Sections:
 * - overview: Executive financial summary
 * - ar-detail: Full AR breakdown
 * - ap-detail: Full AP breakdown
 * - pnl: Profit & Loss
 * - job-costing: Job profitability
 * - cash-flow: Cash flow projection
 * - kpis: Key Performance Indicators
 */
export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const searchParams = request.nextUrl.searchParams
    const section = searchParams.get('section') || 'overview'

    let data: any = {}

    switch (section) {
      case 'overview':
        data = await getOverviewSection()
        break
      case 'ar-detail':
        data = await getARDetailSection()
        break
      case 'ap-detail':
        data = await getAPDetailSection()
        break
      case 'pnl':
        data = await getPNLSection()
        break
      case 'job-costing':
        data = await getJobCostingSection()
        break
      case 'cash-flow':
        data = await getCashFlowSection()
        break
      case 'kpis':
        data = await getKPIsSection()
        break
      default:
        return NextResponse.json(
          { error: 'Invalid section parameter' },
          { status: 400 }
        )
    }

    return NextResponse.json({
      success: true,
      section,
      data,
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    console.error('GET /api/ops/accounting-command error:', error)
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to fetch accounting data',
      },
      { status: 500 }
    )
  }
}

/**
 * SECTION: Overview - Executive financial summary
 */
async function getOverviewSection() {
  const now = new Date()
  const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1)
  const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0)

  // Total AR (sum of balanceDue from unpaid invoices)
  const arResult: any[] = await prisma.$queryRawUnsafe(`
    SELECT COALESCE(SUM("balanceDue"), 0) as total_ar
    FROM "Invoice"
    WHERE "status"::text IN ('ISSUED', 'SENT', 'PARTIALLY_PAID', 'OVERDUE')
  `)
  const totalAR = Number(arResult[0]?.total_ar || 0)

  // Total AP (sum of total from POs with status APPROVED, SENT_TO_VENDOR, PARTIALLY_RECEIVED)
  const apResult: any[] = await prisma.$queryRawUnsafe(`
    SELECT COALESCE(SUM("total"), 0) as total_ap
    FROM "PurchaseOrder"
    WHERE "status"::text IN ('APPROVED', 'SENT_TO_VENDOR', 'PARTIALLY_RECEIVED')
  `)
  const totalAP = Number(apResult[0]?.total_ap || 0)

  // Revenue this month (sum of payments received this month)
  const revenueThisMonthResult: any[] = await prisma.$queryRawUnsafe(`
    SELECT COALESCE(SUM("amount"), 0) as revenue
    FROM "Payment"
    WHERE "receivedAt" >= $1 AND "receivedAt" < $2
  `, currentMonthStart, now)
  const revenueThisMonth = Number(revenueThisMonthResult[0]?.revenue || 0)

  // Revenue last month
  const revenueLastMonthResult: any[] = await prisma.$queryRawUnsafe(`
    SELECT COALESCE(SUM("amount"), 0) as revenue
    FROM "Payment"
    WHERE "receivedAt" >= $1 AND "receivedAt" <= $2
  `, lastMonthStart, lastMonthEnd)
  const revenueLastMonth = Number(revenueLastMonthResult[0]?.revenue || 0)

  // Expenses this month (sum of PO totals for received items this month)
  const expensesThisMonthResult: any[] = await prisma.$queryRawUnsafe(`
    SELECT COALESCE(SUM("total"), 0) as expenses
    FROM "PurchaseOrder"
    WHERE "status"::text = 'RECEIVED' AND "receivedAt" >= $1 AND "receivedAt" < $2
  `, currentMonthStart, now)
  const expensesThisMonth = Number(expensesThisMonthResult[0]?.expenses || 0)

  // Expenses last month
  const expensesLastMonthResult: any[] = await prisma.$queryRawUnsafe(`
    SELECT COALESCE(SUM("total"), 0) as expenses
    FROM "PurchaseOrder"
    WHERE "status"::text = 'RECEIVED' AND "receivedAt" >= $1 AND "receivedAt" <= $2
  `, lastMonthStart, lastMonthEnd)
  const expensesLastMonth = Number(expensesLastMonthResult[0]?.expenses || 0)

  const netIncomeThisMonth = revenueThisMonth - expensesThisMonth
  const netIncomeLastMonth = revenueLastMonth - expensesLastMonth

  // Cash position estimate
  const totalPaymentsEverResult: any[] = await prisma.$queryRawUnsafe(`
    SELECT COALESCE(SUM("amount"), 0) as total
    FROM "Payment"
  `)
  const totalPaymentsEver = Number(totalPaymentsEverResult[0]?.total || 0)

  const totalReceivedPOCostsResult: any[] = await prisma.$queryRawUnsafe(`
    SELECT COALESCE(SUM("total"), 0) as total
    FROM "PurchaseOrder"
    WHERE "status"::text = 'RECEIVED'
  `)
  const totalReceivedPOCosts = Number(totalReceivedPOCostsResult[0]?.total || 0)
  const cashPositionEstimate = totalPaymentsEver - totalReceivedPOCosts

  // Invoice count by status
  const invoiceCountResult: any[] = await prisma.$queryRawUnsafe(`
    SELECT "status"::text as status, COUNT(*)::int as count
    FROM "Invoice"
    GROUP BY "status"
  `)
  const invoiceCountByStatus = invoiceCountResult.reduce((acc: any, row: any) => {
    acc[row.status] = row.count
    return acc
  }, {})

  // PO count by status
  const poCountResult: any[] = await prisma.$queryRawUnsafe(`
    SELECT "status"::text as status, COUNT(*)::int as count
    FROM "PurchaseOrder"
    GROUP BY "status"
  `)
  const poCountByStatus = poCountResult.reduce((acc: any, row: any) => {
    acc[row.status] = row.count
    return acc
  }, {})

  // Top 5 builders by outstanding balance
  const top5BuildersResult: any[] = await prisma.$queryRawUnsafe(`
    SELECT b."id", b."companyName", COALESCE(SUM(i."balanceDue"), 0) as outstanding_balance
    FROM "Builder" b
    LEFT JOIN "Invoice" i ON b."id" = i."builderId"
      AND i."status"::text IN ('ISSUED', 'SENT', 'PARTIALLY_PAID', 'OVERDUE')
    GROUP BY b."id", b."companyName"
    ORDER BY outstanding_balance DESC
    LIMIT 5
  `)
  const top5BuildersByBalance = top5BuildersResult.map((row: any) => ({
    builderId: row.id,
    builderName: row.companyName,
    outstandingBalance: Number(row.outstanding_balance || 0),
  }))

  // Top 5 vendors by spend (from received POs)
  const top5VendorsResult: any[] = await prisma.$queryRawUnsafe(`
    SELECT v."id", v."name" AS "companyName", COALESCE(SUM(po."total"), 0) as total_spend
    FROM "Vendor" v
    LEFT JOIN "PurchaseOrder" po ON v."id" = po."vendorId"
      AND po."status"::text = 'RECEIVED'
    GROUP BY v."id", v."name"
    ORDER BY total_spend DESC
    LIMIT 5
  `)
  const top5VendorsBySpend = top5VendorsResult.map((row: any) => ({
    vendorId: row.id,
    vendorName: row.companyName,
    totalSpend: Number(row.total_spend || 0),
  }))

  return {
    totalAR,
    totalAP,
    revenueThisMonth,
    revenueLastMonth,
    expensesThisMonth,
    expensesLastMonth,
    netIncomeThisMonth,
    netIncomeLastMonth,
    cashPositionEstimate,
    invoiceCountByStatus,
    poCountByStatus,
    top5BuildersByBalance,
    top5VendorsBySpend,
  }
}

/**
 * SECTION: AR Detail - Full AR breakdown
 */
async function getARDetailSection() {
  // All unpaid invoices with builder info, days outstanding, aging bucket
  const unpaidInvoicesResult: any[] = await prisma.$queryRawUnsafe(`
    SELECT i."id", i."invoiceNumber", i."builderId", b."companyName" as "builderName",
           i."total", i."amountPaid", i."balanceDue", i."dueDate",
           i."status"::text as status, i."createdAt",
           EXTRACT(DAY FROM NOW() - i."dueDate")::int as days_outstanding
    FROM "Invoice" i
    LEFT JOIN "Builder" b ON b."id" = i."builderId"
    WHERE i."status"::text IN ('ISSUED', 'SENT', 'PARTIALLY_PAID', 'OVERDUE')
    ORDER BY i."dueDate" ASC
  `)

  const now = new Date()
  const unpaidInvoices = unpaidInvoicesResult.map((row: any) => {
    const daysOutstanding = row.days_outstanding || 0
    let agingBucket = 'current'
    if (daysOutstanding > 90) agingBucket = '90+'
    else if (daysOutstanding > 60) agingBucket = '61-90'
    else if (daysOutstanding > 30) agingBucket = '31-60'
    else if (daysOutstanding > 0) agingBucket = '1-30'

    return {
      invoiceId: row.id,
      invoiceNumber: row.invoiceNumber,
      builderName: row.builderName || 'Unknown',
      total: Number(row.total || 0),
      amountPaid: Number(row.amountPaid || 0),
      balanceDue: Number(row.balanceDue || 0),
      dueDate: row.dueDate,
      status: row.status,
      daysOutstanding,
      agingBucket,
    }
  })

  // AR aging summary
  const agingSummary = { current: 0, '1-30': 0, '31-60': 0, '61-90': 0, '90+': 0 }
  unpaidInvoices.forEach((inv: any) => {
    if (inv.agingBucket === 'current') agingSummary.current += inv.balanceDue
    else if (inv.agingBucket === '1-30') agingSummary['1-30'] += inv.balanceDue
    else if (inv.agingBucket === '31-60') agingSummary['31-60'] += inv.balanceDue
    else if (inv.agingBucket === '61-90') agingSummary['61-90'] += inv.balanceDue
    else if (inv.agingBucket === '90+') agingSummary['90+'] += inv.balanceDue
  })

  // AR aging by builder
  const arByBuilderResult: any[] = await prisma.$queryRawUnsafe(`
    SELECT b."id", b."companyName",
           COALESCE(SUM(i."balanceDue"), 0) as total_balance,
           COUNT(i."id") as invoice_count
    FROM "Builder" b
    LEFT JOIN "Invoice" i ON b."id" = i."builderId"
      AND i."status"::text IN ('ISSUED', 'SENT', 'PARTIALLY_PAID', 'OVERDUE')
    GROUP BY b."id", b."companyName"
    ORDER BY total_balance DESC
  `)
  const arByBuilder = arByBuilderResult.map((row: any) => ({
    builderId: row.id,
    builderName: row.companyName,
    totalBalance: Number(row.total_balance || 0),
    invoiceCount: Number(row.invoice_count || 0),
  }))

  // Average days to pay (from paid invoices)
  const avgDaysToPayResult: any[] = await prisma.$queryRawUnsafe(`
    SELECT AVG(EXTRACT(DAY FROM i."paidAt" - i."dueDate"))::int as avg_days
    FROM "Invoice" i
    WHERE i."status"::text = 'PAID' AND i."paidAt" IS NOT NULL AND i."dueDate" IS NOT NULL
  `)
  const avgDaysToPay = avgDaysToPayResult[0]?.avg_days || 0

  // Collections effectiveness rate (invoices paid on time / total invoices)
  const collectionRateResult: any[] = await prisma.$queryRawUnsafe(`
    SELECT
      COUNT(CASE WHEN i."paidAt" <= i."dueDate" THEN 1 END)::float /
      NULLIF(COUNT(*)::int, 0) * 100 as collection_rate
    FROM "Invoice" i
    WHERE i."status"::text = 'PAID' AND i."paidAt" IS NOT NULL AND i."dueDate" IS NOT NULL
  `)
  const collectionsEffectivenessRate = collectionRateResult[0]?.collection_rate || 0

  // Recent payments (last 30 days)
  const recentPaymentsResult: any[] = await prisma.$queryRawUnsafe(`
    SELECT p."id", p."invoiceId", p."amount", p."method"::text as method,
           p."receivedAt", i."invoiceNumber", b."companyName" as "builderName"
    FROM "Payment" p
    LEFT JOIN "Invoice" i ON p."invoiceId" = i."id"
    LEFT JOIN "Builder" b ON i."builderId" = b."id"
    WHERE p."receivedAt" >= NOW() - INTERVAL '30 days'
    ORDER BY p."receivedAt" DESC
  `)
  const recentPayments = recentPaymentsResult.map((row: any) => ({
    paymentId: row.id,
    invoiceNumber: row.invoiceNumber,
    builderName: row.builderName || 'Unknown',
    amount: Number(row.amount || 0),
    method: row.method,
    receivedAt: row.receivedAt,
  }))

  return {
    unpaidInvoices,
    agingSummary,
    arByBuilder,
    avgDaysToPay,
    collectionsEffectivenessRate,
    recentPayments,
    totalAR: unpaidInvoices.reduce((sum: number, inv: any) => sum + inv.balanceDue, 0),
  }
}

/**
 * SECTION: AP Detail - Full AP breakdown
 */
async function getAPDetailSection() {
  // All open POs with vendor info, status, age
  const openPOsResult: any[] = await prisma.$queryRawUnsafe(`
    SELECT po."id", po."poNumber", po."vendorId", v."name" as "vendorName",
           po."total", po."status"::text as status, po."createdAt",
           EXTRACT(DAY FROM NOW() - po."createdAt")::int as days_old,
           po."expectedDeliveryDate"
    FROM "PurchaseOrder" po
    LEFT JOIN "Vendor" v ON v."id" = po."vendorId"
    WHERE po."status"::text IN ('APPROVED', 'SENT_TO_VENDOR', 'PARTIALLY_RECEIVED')
    ORDER BY po."createdAt" ASC
  `)

  const openPOs = openPOsResult.map((row: any) => ({
    poId: row.id,
    poNumber: row.poNumber,
    vendorName: row.vendorName || 'Unknown',
    total: Number(row.total || 0),
    status: row.status,
    daysOld: row.days_old || 0,
    createdAt: row.createdAt,
    expectedDeliveryDate: row.expectedDeliveryDate,
  }))

  // AP aging summary
  const apAgingSummary = { current: 0, '1-30': 0, '31-60': 0, '60+': 0 }
  openPOs.forEach((po: any) => {
    const daysOld = po.daysOld
    if (daysOld <= 30) apAgingSummary.current += po.total
    else if (daysOld <= 60) apAgingSummary['1-30'] += po.total
    else if (daysOld <= 90) apAgingSummary['31-60'] += po.total
    else apAgingSummary['60+'] += po.total
  })

  // AP by vendor
  const apByVendorResult: any[] = await prisma.$queryRawUnsafe(`
    SELECT v."id", v."name" AS "companyName",
           COALESCE(SUM(po."total"), 0) as total_ap,
           COUNT(po."id") as po_count
    FROM "Vendor" v
    LEFT JOIN "PurchaseOrder" po ON v."id" = po."vendorId"
      AND po."status"::text IN ('APPROVED', 'SENT_TO_VENDOR', 'PARTIALLY_RECEIVED')
    GROUP BY v."id", v."name"
    ORDER BY total_ap DESC
  `)
  const apByVendor = apByVendorResult.map((row: any) => ({
    vendorId: row.id,
    vendorName: row.companyName,
    totalAP: Number(row.total_ap || 0),
    poCount: Number(row.po_count || 0),
  }))

  // Upcoming AP due this week / next 2 weeks
  const weekFromNow = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
  const twoWeeksFromNow = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000)

  const upcomingThisWeekResult: any[] = await prisma.$queryRawUnsafe(`
    SELECT COUNT(*)::int as count, COALESCE(SUM("total"), 0) as total
    FROM "PurchaseOrder"
    WHERE "status"::text IN ('APPROVED', 'SENT_TO_VENDOR', 'PARTIALLY_RECEIVED')
      AND "expectedDeliveryDate" >= NOW() AND "expectedDeliveryDate" <= $1
  `, weekFromNow)
  const upcomingThisWeek = {
    count: Number(upcomingThisWeekResult[0]?.count || 0),
    total: Number(upcomingThisWeekResult[0]?.total || 0),
  }

  const upcomingNext2WeeksResult: any[] = await prisma.$queryRawUnsafe(`
    SELECT COUNT(*)::int as count, COALESCE(SUM("total"), 0) as total
    FROM "PurchaseOrder"
    WHERE "status"::text IN ('APPROVED', 'SENT_TO_VENDOR', 'PARTIALLY_RECEIVED')
      AND "expectedDeliveryDate" > $1 AND "expectedDeliveryDate" <= $2
  `, weekFromNow, twoWeeksFromNow)
  const upcomingNext2Weeks = {
    count: Number(upcomingNext2WeeksResult[0]?.count || 0),
    total: Number(upcomingNext2WeeksResult[0]?.total || 0),
  }

  // Average vendor lead time (from received POs)
  const avgLeadTimeResult: any[] = await prisma.$queryRawUnsafe(`
    SELECT AVG(EXTRACT(DAY FROM po."receivedAt" - po."createdAt"))::int as avg_lead_days
    FROM "PurchaseOrder" po
    WHERE po."status"::text = 'RECEIVED' AND po."receivedAt" IS NOT NULL
  `)
  const avgVendorLeadTime = avgLeadTimeResult[0]?.avg_lead_days || 0

  // Vendor payment history
  const vendorPaymentHistoryResult: any[] = await prisma.$queryRawUnsafe(`
    SELECT v."id", v."name" AS "companyName",
           COUNT(po."id") as po_count,
           AVG(EXTRACT(DAY FROM po."receivedAt" - po."createdAt"))::int as avg_lead_days
    FROM "Vendor" v
    LEFT JOIN "PurchaseOrder" po ON v."id" = po."vendorId"
      AND po."status"::text = 'RECEIVED'
    GROUP BY v."id", v."name"
    ORDER BY po_count DESC
  `)
  const vendorPaymentHistory = vendorPaymentHistoryResult.map((row: any) => ({
    vendorId: row.id,
    vendorName: row.companyName,
    poCount: Number(row.po_count || 0),
    avgLeadDays: row.avg_lead_days || 0,
  }))

  return {
    openPOs,
    apAgingSummary,
    apByVendor,
    upcomingThisWeek,
    upcomingNext2Weeks,
    avgVendorLeadTime,
    vendorPaymentHistory,
    totalAP: openPOs.reduce((sum: number, po: any) => sum + po.total, 0),
  }
}

/**
 * SECTION: P&L - Profit & Loss
 */
async function getPNLSection() {
  // Monthly revenue (last 12 months from payments)
  const monthlyRevenueResult: any[] = await prisma.$queryRawUnsafe(`
    SELECT DATE_TRUNC('month', p."receivedAt")::date as month,
           COALESCE(SUM(p."amount"), 0) as revenue
    FROM "Payment" p
    WHERE p."receivedAt" >= NOW() - INTERVAL '12 months'
    GROUP BY DATE_TRUNC('month', p."receivedAt")
    ORDER BY month DESC
  `)
  const monthlyRevenue = monthlyRevenueResult.map((row: any) => ({
    month: row.month,
    revenue: Number(row.revenue || 0),
  }))

  // Monthly expenses (last 12 months from received POs)
  const monthlyExpensesResult: any[] = await prisma.$queryRawUnsafe(`
    SELECT DATE_TRUNC('month', po."receivedAt")::date as month,
           COALESCE(SUM(po."total"), 0) as expenses
    FROM "PurchaseOrder" po
    WHERE po."status"::text = 'RECEIVED'
      AND po."receivedAt" >= NOW() - INTERVAL '12 months'
    GROUP BY DATE_TRUNC('month', po."receivedAt")
    ORDER BY month DESC
  `)
  const monthlyExpenses = monthlyExpensesResult.map((row: any) => ({
    month: row.month,
    expenses: Number(row.expenses || 0),
  }))

  // Combine for monthly net income
  const monthlyNetIncome = monthlyRevenue.map((m: any) => {
    const expense = monthlyExpenses.find((e: any) => e.month === m.month)?.expenses || 0
    return {
      month: m.month,
      revenue: m.revenue,
      expenses: expense,
      netIncome: m.revenue - expense,
      grossMargin: m.revenue > 0 ? ((m.revenue - expense) / m.revenue * 100) : 0,
    }
  })

  // Revenue by builder (top 10)
  const revenueByBuilderResult: any[] = await prisma.$queryRawUnsafe(`
    SELECT b."id", b."companyName",
           COALESCE(SUM(p."amount"), 0) as total_revenue
    FROM "Builder" b
    LEFT JOIN "Invoice" i ON b."id" = i."builderId"
    LEFT JOIN "Payment" p ON i."id" = p."invoiceId"
    WHERE p."amount" IS NOT NULL
    GROUP BY b."id", b."companyName"
    ORDER BY total_revenue DESC
    LIMIT 10
  `)
  const revenueByBuilder = revenueByBuilderResult.map((row: any) => ({
    builderId: row.id,
    builderName: row.companyName,
    totalRevenue: Number(row.total_revenue || 0),
  }))

  // Expense by vendor (top 10)
  const expenseByVendorResult: any[] = await prisma.$queryRawUnsafe(`
    SELECT v."id", v."name" AS "companyName",
           COALESCE(SUM(po."total"), 0) as total_expenses
    FROM "Vendor" v
    LEFT JOIN "PurchaseOrder" po ON v."id" = po."vendorId"
      AND po."status"::text = 'RECEIVED'
    GROUP BY v."id", v."name"
    ORDER BY total_expenses DESC
    LIMIT 10
  `)
  const expenseByVendor = expenseByVendorResult.map((row: any) => ({
    vendorId: row.id,
    vendorName: row.companyName,
    totalExpenses: Number(row.total_expenses || 0),
  }))

  // Gross margin percentage
  const totalRevenue = monthlyRevenue.reduce((sum: number, m: any) => sum + m.revenue, 0)
  const totalExpenses = monthlyExpenses.reduce((sum: number, m: any) => sum + m.expenses, 0)
  const grossMarginPercentage = totalRevenue > 0 ? ((totalRevenue - totalExpenses) / totalRevenue * 100) : 0

  return {
    monthlyRevenue,
    monthlyExpenses,
    monthlyNetIncome,
    revenueByBuilder,
    expenseByVendor,
    totalRevenue,
    totalExpenses,
    netIncome: totalRevenue - totalExpenses,
    grossMarginPercentage,
  }
}

/**
 * SECTION: Job Costing - Job profitability
 */
async function getJobCostingSection() {
  // For each job with orders: job number, builder name, order total (revenue), PO costs, gross profit, margin %
  const jobCostingResult: any[] = await prisma.$queryRawUnsafe(`
    SELECT j."id", j."jobNumber", j."builderName",
           COALESCE(SUM(o."total"), 0) as order_revenue,
           j."createdAt"
    FROM "Job" j
    LEFT JOIN "Order" o ON o."id" = j."orderId"
    GROUP BY j."id", j."jobNumber", j."builderName"
    ORDER BY j."jobNumber" ASC
  `)

  // Get PO costs by job
  const poCostsByJobResult: any[] = await prisma.$queryRawUnsafe(`
    SELECT j."id", COALESCE(SUM(po."total"), 0) as po_total_cost
    FROM "Job" j
    LEFT JOIN "PurchaseOrder" po ON j."id" = po."jobId"
      AND po."status"::text = 'RECEIVED'
    GROUP BY j."id"
  `)

  const poCostsByJob = poCostsByJobResult.reduce((acc: any, row: any) => {
    acc[row.id] = Number(row.po_total_cost || 0)
    return acc
  }, {})

  const jobCosting = jobCostingResult.map((job: any) => {
    const revenue = Number(job.order_revenue || 0)
    const costs = poCostsByJob[job.id] || 0
    const grossProfit = revenue - costs
    const marginPercent = revenue > 0 ? (grossProfit / revenue * 100) : 0

    return {
      jobId: job.id,
      jobNumber: job.jobNumber,
      builderName: job.builderName || 'Unknown',
      revenue,
      costs,
      grossProfit,
      marginPercent,
    }
  }).sort((a: any, b: any) => a.marginPercent - b.marginPercent) // Least profitable first

  // Calculate overall average margin
  const totalRevenue = jobCosting.reduce((sum: number, j: any) => sum + j.revenue, 0)
  const totalCosts = jobCosting.reduce((sum: number, j: any) => sum + j.costs, 0)
  const overallMarginPercent = totalRevenue > 0 ? ((totalRevenue - totalCosts) / totalRevenue * 100) : 0

  return {
    jobCosting,
    overallAverageMargin: overallMarginPercent,
    totalRevenue,
    totalCosts,
    totalGrossProfit: totalRevenue - totalCosts,
  }
}

/**
 * SECTION: Cash Flow - Cash flow projection
 */
async function getCashFlowSection() {
  const now = new Date()

  // AR expected collections by week (next 8 weeks based on due dates)
  const arCollectionsResult: any[] = await prisma.$queryRawUnsafe(`
    SELECT DATE_TRUNC('week', i."dueDate")::date as week,
           COALESCE(SUM(i."balanceDue"), 0) as expected_collections
    FROM "Invoice" i
    WHERE i."status"::text IN ('ISSUED', 'SENT', 'PARTIALLY_PAID', 'OVERDUE')
      AND i."dueDate" >= $1 AND i."dueDate" < $2
    GROUP BY DATE_TRUNC('week', i."dueDate")
    ORDER BY week ASC
  `, now, new Date(now.getTime() + 8 * 7 * 24 * 60 * 60 * 1000))

  const arCollections = arCollectionsResult.map((row: any) => ({
    week: row.week,
    expectedCollections: Number(row.expected_collections || 0),
  }))

  // AP expected payments by week (next 8 weeks based on PO expected dates)
  const apPaymentsResult: any[] = await prisma.$queryRawUnsafe(`
    SELECT DATE_TRUNC('week', po."expectedDeliveryDate")::date as week,
           COALESCE(SUM(po."total"), 0) as expected_payments
    FROM "PurchaseOrder" po
    WHERE po."status"::text IN ('APPROVED', 'SENT_TO_VENDOR', 'PARTIALLY_RECEIVED')
      AND po."expectedDeliveryDate" >= $1 AND po."expectedDeliveryDate" < $2
    GROUP BY DATE_TRUNC('week', po."expectedDeliveryDate")
    ORDER BY week ASC
  `, now, new Date(now.getTime() + 8 * 7 * 24 * 60 * 60 * 1000))

  const apPayments = apPaymentsResult.map((row: any) => ({
    week: row.week,
    expectedPayments: Number(row.expected_payments || 0),
  }))

  // Net cash flow by week
  const weekMap = new Map<string, any>()
  arCollections.forEach((col: any) => {
    const week = col.week ? new Date(col.week).toISOString().split('T')[0] : ''
    if (!weekMap.has(week)) weekMap.set(week, { week: col.week, inflows: 0, outflows: 0 })
    weekMap.get(week)!.inflows = col.expectedCollections
  })
  apPayments.forEach((pay: any) => {
    const week = pay.week ? new Date(pay.week).toISOString().split('T')[0] : ''
    if (!weekMap.has(week)) weekMap.set(week, { week: pay.week, inflows: 0, outflows: 0 })
    weekMap.get(week)!.outflows = pay.expectedPayments
  })

  const netCashFlowByWeek = Array.from(weekMap.values()).map((w: any) => ({
    week: w.week,
    inflows: w.inflows,
    outflows: w.outflows,
    netCashFlow: w.inflows - w.outflows,
  }))

  // Current cash position
  const totalPaymentsResult: any[] = await prisma.$queryRawUnsafe(`
    SELECT COALESCE(SUM("amount"), 0) as total FROM "Payment"
  `)
  const totalPOCostsResult: any[] = await prisma.$queryRawUnsafe(`
    SELECT COALESCE(SUM("total"), 0) as total FROM "PurchaseOrder"
    WHERE "status"::text = 'RECEIVED'
  `)
  const currentCashPosition = Number(totalPaymentsResult[0]?.total || 0) - Number(totalPOCostsResult[0]?.total || 0)

  return {
    arCollections,
    apPayments,
    netCashFlowByWeek,
    currentCashPosition,
  }
}

/**
 * SECTION: KPIs - Key Performance Indicators
 */
async function getKPIsSection() {
  // DSO (Days Sales Outstanding)
  const dsoResult: any[] = await prisma.$queryRawUnsafe(`
    SELECT AVG(EXTRACT(DAY FROM NOW() - i."createdAt"))::int as avg_days_outstanding
    FROM "Invoice" i
    WHERE i."status"::text IN ('ISSUED', 'SENT', 'PARTIALLY_PAID', 'OVERDUE')
  `)
  const dso = dsoResult[0]?.avg_days_outstanding || 0

  // DPO (Days Payable Outstanding)
  const dpoResult: any[] = await prisma.$queryRawUnsafe(`
    SELECT AVG(EXTRACT(DAY FROM NOW() - po."createdAt"))::int as avg_days_outstanding
    FROM "PurchaseOrder" po
    WHERE po."status"::text IN ('APPROVED', 'SENT_TO_VENDOR', 'PARTIALLY_RECEIVED')
  `)
  const dpo = dpoResult[0]?.avg_days_outstanding || 0

  // Cash Conversion Cycle = DSO - DPO
  const ccc = dso - dpo

  // Current Ratio = AR / AP
  const totalARResult: any[] = await prisma.$queryRawUnsafe(`
    SELECT COALESCE(SUM("balanceDue"), 0) as total FROM "Invoice"
    WHERE "status"::text IN ('ISSUED', 'SENT', 'PARTIALLY_PAID', 'OVERDUE')
  `)
  const totalAPResult: any[] = await prisma.$queryRawUnsafe(`
    SELECT COALESCE(SUM("total"), 0) as total FROM "PurchaseOrder"
    WHERE "status"::text IN ('APPROVED', 'SENT_TO_VENDOR', 'PARTIALLY_RECEIVED')
  `)
  const totalAR = Number(totalARResult[0]?.total || 0)
  const totalAP = Number(totalAPResult[0]?.total || 0)
  const currentRatio = totalAP > 0 ? totalAR / totalAP : 0

  // Collection Rate (% of invoices paid on time)
  const collectionRateResult: any[] = await prisma.$queryRawUnsafe(`
    SELECT
      COUNT(CASE WHEN i."paidAt" <= i."dueDate" THEN 1 END)::float /
      NULLIF(COUNT(*)::int, 0) * 100 as collection_rate
    FROM "Invoice" i
    WHERE i."status"::text = 'PAID'
  `)
  const collectionRate = collectionRateResult[0]?.collection_rate || 0

  // Average invoice size
  const avgInvoiceSizeResult: any[] = await prisma.$queryRawUnsafe(`
    SELECT AVG("total")::numeric as avg_size FROM "Invoice"
  `)
  const avgInvoiceSize = Number(avgInvoiceSizeResult[0]?.avg_size || 0)

  // Average PO size
  const avgPOSizeResult: any[] = await prisma.$queryRawUnsafe(`
    SELECT AVG("total")::numeric as avg_size FROM "PurchaseOrder"
  `)
  const avgPOSize = Number(avgPOSizeResult[0]?.avg_size || 0)

  // Revenue per job
  const totalRevenueResult: any[] = await prisma.$queryRawUnsafe(`
    SELECT COALESCE(SUM(p."amount"), 0) as total FROM "Payment"
  `)
  const jobCountResult: any[] = await prisma.$queryRawUnsafe(`
    SELECT COUNT(DISTINCT "id") as count FROM "Job"
  `)
  const totalRevenue = Number(totalRevenueResult[0]?.total || 0)
  const jobCount = Number(jobCountResult[0]?.count || 1)
  const revenuePerJob = jobCount > 0 ? totalRevenue / jobCount : 0

  // Month over month revenue growth
  const now = new Date()
  const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1)
  const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0)

  const currentMonthRevenueResult: any[] = await prisma.$queryRawUnsafe(`
    SELECT COALESCE(SUM("amount"), 0) as total FROM "Payment"
    WHERE "receivedAt" >= $1 AND "receivedAt" < $2
  `, currentMonthStart, now)
  const lastMonthRevenueResult: any[] = await prisma.$queryRawUnsafe(`
    SELECT COALESCE(SUM("amount"), 0) as total FROM "Payment"
    WHERE "receivedAt" >= $1 AND "receivedAt" <= $2
  `, lastMonthStart, lastMonthEnd)

  const currentMonthRevenue = Number(currentMonthRevenueResult[0]?.total || 0)
  const lastMonthRevenue = Number(lastMonthRevenueResult[0]?.total || 0)
  const momRevenueGrowth = lastMonthRevenue > 0
    ? ((currentMonthRevenue - lastMonthRevenue) / lastMonthRevenue * 100)
    : 0

  return {
    dso,
    dpo,
    cashConversionCycle: ccc,
    currentRatio: Number(currentRatio.toFixed(2)),
    collectionRate: Number(collectionRate.toFixed(2)),
    avgInvoiceSize: Number(avgInvoiceSize.toFixed(2)),
    avgPOSize: Number(avgPOSize.toFixed(2)),
    revenuePerJob: Number(revenuePerJob.toFixed(2)),
    momRevenueGrowth: Number(momRevenueGrowth.toFixed(2)),
  }
}
