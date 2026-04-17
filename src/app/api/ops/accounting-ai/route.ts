export const dynamic = 'force-dynamic'

import { prisma } from '@/lib/prisma'
// Auth check via headers (consistent with other ops API routes)
import Anthropic from '@anthropic-ai/sdk'
import { NextRequest, NextResponse } from 'next/server'
import { audit } from '@/lib/audit'

// ──────────────────────────────────────────────────────────────────────────
// Accounting AI Assistant — Real-time financial context for Dawn
// ──────────────────────────────────────────────────────────────────────────

interface AccountingAIRequest {
  message: string
}

interface AccountingContext {
  arOutstanding: number
  apOutstanding: number
  overdueInvoicesCount: number
  overdueInvoicesAmount: number
  revenueThisMonth: number
  revenueLastMonth: number
  topOverdueInvoices: Array<{
    invoiceNumber: string
    builderName: string
    balanceDue: number
    dueDate: string
  }>
  topUpcomingAP: Array<{
    poNumber: string
    vendorName: string
    total: number
    expectedDate: string | null
  }>
  cashPositionEstimate: number
  invoiceStatusDistribution: Record<string, number>
  recentPayments: Array<{
    invoiceNumber: string
    builderName: string
    amount: number
    receivedAt: string
  }>
}

interface AccountingAIResponse {
  success: boolean
  response: string
  context: {
    ar: number
    ap: number
    revenue: number
    cashPosition: number
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    // 1. Check authentication via headers
    const staffId = request.headers.get('x-staff-id')
    const staffRole = request.headers.get('x-staff-role')
    if (!staffId || !staffRole) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // 2. Parse request body
    const body = (await request.json()) as AccountingAIRequest
    if (!body.message) {
      return NextResponse.json(
        { error: 'Message is required' },
        { status: 400 }
      )
    }

    // 3. Fetch real-time financial context from database
    const context = await fetchFinancialContext()

    // 4. Prepare system prompt with financial snapshot
    const systemPrompt = buildSystemPrompt(context)

    // 5. Call Claude API
    const client = new Anthropic()
    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      system: systemPrompt,
      messages: [
        {
          role: 'user',
          content: body.message,
        },
      ],
    })

    // 6. Extract text response
    const aiResponse = response.content
      .filter((block: any) => block.type === 'text')
      .map((block: any) => (block as any).text)
      .join('\n')

    // 7. Return response with context
    const result: AccountingAIResponse = {
      success: true,
      response: aiResponse,
      context: {
        ar: context.arOutstanding,
        ap: context.apOutstanding,
        revenue: context.revenueThisMonth,
        cashPosition: context.cashPositionEstimate,
      },
    }

    return NextResponse.json(result)
  } catch (error: any) {
    console.error('[accounting-ai] Error:', error)
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Internal server error',
      },
      { status: 500 }
    )
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Fetch real-time financial context from database
// ──────────────────────────────────────────────────────────────────────────

async function fetchFinancialContext(): Promise<AccountingContext> {
  const now = new Date()
  const currentMonthStart = new Date(
    now.getFullYear(),
    now.getMonth(),
    1
  ).toISOString()
  const currentMonthEnd = new Date(
    now.getFullYear(),
    now.getMonth() + 1,
    1
  ).toISOString()
  const lastMonthStart = new Date(
    now.getFullYear(),
    now.getMonth() - 1,
    1
  ).toISOString()
  const lastMonthEnd = new Date(
    now.getFullYear(),
    now.getMonth(),
    1
  ).toISOString()

  // 1. Total AR outstanding
  const arResult = await prisma.$queryRawUnsafe<
    Array<{ total: number | null }>
  >(
    `
    SELECT COALESCE(SUM("balanceDue"), 0) as total
    FROM "Invoice"
    WHERE "status" NOT IN ('PAID', 'VOID', 'WRITE_OFF')
  `
  )
  const arOutstanding = arResult[0]?.total ?? 0

  // 2. Total AP outstanding
  const apResult = await prisma.$queryRawUnsafe<
    Array<{ total: number | null }>
  >(
    `
    SELECT COALESCE(SUM("total"), 0) as total
    FROM "PurchaseOrder"
    WHERE "status" IN ('APPROVED', 'SENT_TO_VENDOR', 'PARTIALLY_RECEIVED')
  `
  )
  const apOutstanding = apResult[0]?.total ?? 0

  // 3. Overdue invoices count and total
  const overdueResult = await prisma.$queryRawUnsafe<
    Array<{ count: bigint; total: number | null }>
  >(
    `
    SELECT COUNT(*) as count, COALESCE(SUM("balanceDue"), 0) as total
    FROM "Invoice"
    WHERE "status" NOT IN ('PAID', 'VOID', 'WRITE_OFF')
      AND "dueDate" < CURRENT_DATE
  `
  )
  const overdueInvoicesCount = Number(overdueResult[0]?.count ?? 0)
  const overdueInvoicesAmount = overdueResult[0]?.total ?? 0

  // 4. Revenue this month (sum of payments received this month)
  const revenueThisMonthResult = await prisma.$queryRawUnsafe<
    Array<{ total: number | null }>
  >(
    `
    SELECT COALESCE(SUM("amount"), 0) as total
    FROM "Payment"
    WHERE "receivedAt" >= $1
      AND "receivedAt" < $2
  `,
    currentMonthStart,
    currentMonthEnd
  )
  const revenueThisMonth = revenueThisMonthResult[0]?.total ?? 0

  // 5. Revenue last month
  const revenueLastMonthResult = await prisma.$queryRawUnsafe<
    Array<{ total: number | null }>
  >(
    `
    SELECT COALESCE(SUM("amount"), 0) as total
    FROM "Payment"
    WHERE "receivedAt" >= $1
      AND "receivedAt" < $2
  `,
    lastMonthStart,
    lastMonthEnd
  )
  const revenueLastMonth = revenueLastMonthResult[0]?.total ?? 0

  // 6. Top 5 overdue invoices
  const topOverdueInvoices = await prisma.$queryRawUnsafe<
    Array<{
      invoiceNumber: string
      builderName: string | null
      balanceDue: number
      dueDate: Date
    }>
  >(
    `
    SELECT
      i."invoiceNumber",
      b."name" as "builderName",
      i."balanceDue",
      i."dueDate"
    FROM "Invoice" i
    LEFT JOIN "Builder" b ON i."builderId" = b."id"
    WHERE i."status" NOT IN ('PAID', 'VOID', 'WRITE_OFF')
      AND i."dueDate" < CURRENT_DATE
    ORDER BY i."dueDate" ASC
    LIMIT 5
  `
  )

  // 7. Top 5 upcoming AP
  const topUpcomingAP = await prisma.$queryRawUnsafe<
    Array<{
      poNumber: string
      vendorName: string
      total: number
      expectedDate: Date | null
    }>
  >(
    `
    SELECT
      po."poNumber",
      v."name" as "vendorName",
      po."total",
      po."expectedDate"
    FROM "PurchaseOrder" po
    JOIN "Vendor" v ON po."vendorId" = v."id"
    WHERE po."status" IN ('APPROVED', 'SENT_TO_VENDOR', 'PARTIALLY_RECEIVED')
    ORDER BY po."expectedDate" ASC NULLS LAST
    LIMIT 5
  `
  )

  // 8. Cash position estimate (AR - AP)
  const cashPositionEstimate = arOutstanding - apOutstanding

  // 9. Invoice status distribution
  const statusDistResult = await prisma.$queryRawUnsafe<
    Array<{ status: string; count: bigint }>
  >(
    `
    SELECT "status", COUNT(*) as count
    FROM "Invoice"
    GROUP BY "status"
  `
  )
  const invoiceStatusDistribution: Record<string, number> = {}
  statusDistResult.forEach((row: any) => {
    invoiceStatusDistribution[row.status] = Number(row.count)
  })

  // 10. Recent activity (last 5 payments)
  const recentPayments = await prisma.$queryRawUnsafe<
    Array<{
      invoiceNumber: string
      builderName: string | null
      amount: number
      receivedAt: Date
    }>
  >(
    `
    SELECT
      i."invoiceNumber",
      b."name" as "builderName",
      p."amount",
      p."receivedAt"
    FROM "Payment" p
    JOIN "Invoice" i ON p."invoiceId" = i."id"
    LEFT JOIN "Builder" b ON i."builderId" = b."id"
    ORDER BY p."receivedAt" DESC
    LIMIT 5
  `
  )

  return {
    arOutstanding: Number(arOutstanding),
    apOutstanding: Number(apOutstanding),
    overdueInvoicesCount,
    overdueInvoicesAmount: Number(overdueInvoicesAmount),
    revenueThisMonth: Number(revenueThisMonth),
    revenueLastMonth: Number(revenueLastMonth),
    topOverdueInvoices: topOverdueInvoices.map((inv: any) => ({
      invoiceNumber: inv.invoiceNumber,
      builderName: inv.builderName || 'Unknown',
      balanceDue: Number(inv.balanceDue),
      dueDate: new Date(inv.dueDate).toISOString().split('T')[0],
    })),
    topUpcomingAP: topUpcomingAP.map((po: any) => ({
      poNumber: po.poNumber,
      vendorName: po.vendorName,
      total: Number(po.total),
      expectedDate: po.expectedDate
        ? new Date(po.expectedDate).toISOString().split('T')[0]
        : null,
    })),
    cashPositionEstimate,
    invoiceStatusDistribution,
    recentPayments: recentPayments.map((pmt: any) => ({
      invoiceNumber: pmt.invoiceNumber,
      builderName: pmt.builderName || 'Unknown',
      amount: Number(pmt.amount),
      receivedAt: new Date(pmt.receivedAt).toISOString().split('T')[0],
    })),
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Build system prompt with financial snapshot
// ──────────────────────────────────────────────────────────────────────────

function buildSystemPrompt(context: AccountingContext): string {
  const today = new Date().toISOString().split('T')[0]

  const topOverdueText =
    context.topOverdueInvoices.length > 0
      ? context.topOverdueInvoices
          .map(
            (inv: any) =>
              `- ${inv.invoiceNumber} (${inv.builderName}): $${inv.balanceDue.toLocaleString()} due ${inv.dueDate}`
          )
          .join('\n')
      : '(None)'

  const topAPText =
    context.topUpcomingAP.length > 0
      ? context.topUpcomingAP
          .map(
            (po: any) =>
              `- ${po.poNumber} (${po.vendorName}): $${po.total.toLocaleString()} expected ${po.expectedDate || 'TBD'}`
          )
          .join('\n')
      : '(None)'

  const recentPaymentsText =
    context.recentPayments.length > 0
      ? context.recentPayments
          .map(
            (pmt: any) =>
              `- ${pmt.invoiceNumber} (${pmt.builderName}): $${pmt.amount.toLocaleString()} on ${pmt.receivedAt}`
          )
          .join('\n')
      : '(None)'

  const statusDistText = Object.entries(context.invoiceStatusDistribution)
    .map(([status, count]: any[]) => `- ${status}: ${count}`)
    .join('\n')

  return `You are Dawn's AI financial assistant for Abel Lumber. You have access to real-time financial data. Be concise, precise, and actionable. Use dollar amounts with proper formatting. When asked about trends, compare to prior periods. When asked about actions, give specific recommendations with account names and amounts. You are speaking to an experienced accountant - use proper accounting terminology.

Current Financial Snapshot:

ACCOUNTS RECEIVABLE
- Total Outstanding: $${context.arOutstanding.toLocaleString()}
- Overdue Invoices: ${context.overdueInvoicesCount} invoices totaling $${context.overdueInvoicesAmount.toLocaleString()}

TOP 5 OVERDUE INVOICES (by due date):
${topOverdueText}

ACCOUNTS PAYABLE
- Total Outstanding: $${context.apOutstanding.toLocaleString()}

TOP 5 UPCOMING PURCHASES (by expected date):
${topAPText}

CASH POSITION
- Estimated Cash Position (AR - AP): $${context.cashPositionEstimate.toLocaleString()}

REVENUE TRENDS
- This Month: $${context.revenueThisMonth.toLocaleString()}
- Last Month: $${context.revenueLastMonth.toLocaleString()}
- Month-over-Month Change: ${((context.revenueThisMonth - context.revenueLastMonth) / (context.revenueLastMonth || 1) * 100).toFixed(1)}%

INVOICE STATUS DISTRIBUTION
${statusDistText}

RECENT PAYMENTS (last 5):
${recentPaymentsText}

Today's date: ${today}`
}
