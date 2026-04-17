export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'
import { safeJson } from '@/lib/safe-json'
import { audit } from '@/lib/audit'

// ──────────────────────────────────────────────────────────────────────────
// GET /api/ops/cash-flow-optimizer/working-capital
// Project cash position and identify working capital gaps
// ──────────────────────────────────────────────────────────────────────────
export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    // 1. Calculate current working capital position
    const currentPosition = await calculateCurrentPosition()

    // 2. Calculate key metrics
    const metrics = await calculateWorkingCapitalMetrics(currentPosition)

    // 3. Build 90-day forecast with scenarios
    const forecasts = await buildCashFlowForecast()

    // 4. Identify cash gap periods
    const gaps = identifyCashGaps(forecasts)

    // 5. Generate recommendations
    const recommendations = generateRecommendations(currentPosition, metrics, gaps)

    return safeJson({
      currentPosition,
      metrics,
      forecasts: {
        optimistic: forecasts.optimistic,
        base: forecasts.base,
        pessimistic: forecasts.pessimistic,
      },
      cashGaps: gaps,
      recommendations,
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    console.error('GET /api/ops/cash-flow-optimizer/working-capital error:', error)
    return NextResponse.json(
      { error: 'Failed to calculate working capital forecast' },
      { status: 500 }
    )
  }
}

// ──────────────────────────────────────────────────────────────────────────
// POST /api/ops/cash-flow-optimizer/working-capital
// Save forecasts and snapshots
// ──────────────────────────────────────────────────────────────────────────
export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    // Audit log
    audit(request, 'CREATE', 'CashFlowOptimizer', undefined, { method: 'POST' }).catch(() => {})

    const body = await request.json()
    const { action } = body

    if (!action) {
      return NextResponse.json(
        { error: 'Missing required field: action' },
        { status: 400 }
      )
    }

    if (action === 'refresh_forecast') {
      return await handleRefreshForecast()
    }

    if (action === 'take_snapshot') {
      return await handleTakeSnapshot()
    }

    return NextResponse.json(
      { error: `Unknown action: ${action}` },
      { status: 400 }
    )
  } catch (error) {
    console.error('POST /api/ops/cash-flow-optimizer/working-capital error:', error)
    return NextResponse.json(
      { error: 'Failed to process working capital request' },
      { status: 500 }
    )
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Helper: Calculate current position
// ──────────────────────────────────────────────────────────────────────────
async function calculateCurrentPosition(): Promise<{
  totalAR: number
  totalAP: number
  inventoryValue: number
  cashOnHand: number
  workingCapital: number
}> {
  // Calculate AR (Accounts Receivable)
  const arResult = await prisma.$queryRawUnsafe<
    Array<{ total: number }>
  >(`
    SELECT COALESCE(SUM("balanceDue"), 0)::float as total
    FROM "Invoice"
    WHERE status::text NOT IN ('DRAFT', 'VOID', 'WRITE_OFF')
  `)

  const totalAR = arResult[0]?.total || 0

  // Calculate AP (Accounts Payable)
  const apResult = await prisma.$queryRawUnsafe<
    Array<{ total: number }>
  >(`
    SELECT COALESCE(SUM(po.total), 0)::float as total
    FROM "PurchaseOrder" po
    WHERE po.status::text NOT IN ('DRAFT', 'CANCELLED', 'RECEIVED')
  `)

  const totalAP = apResult[0]?.total || 0

  // Calculate inventory value
  const inventoryResult = await prisma.$queryRawUnsafe<
    Array<{ total: number }>
  >(`
    SELECT COALESCE(SUM(ii."onHand" * COALESCE(bom_cost(p.id), p.cost)), 0)::float as total
    FROM "InventoryItem" ii
    JOIN "Product" p ON ii."productId" = p.id
    WHERE p.active = true
  `)

  const inventoryValue = inventoryResult[0]?.total || 0

  // Cash on hand: calculated as total payments received minus total PO expenditures
  // This gives a running cash balance based on actual transactions
  let cashResult: any[] = []
  try {
    cashResult = await prisma.$queryRawUnsafe(`
      SELECT
        COALESCE((SELECT SUM("amountPaid")::float FROM "Invoice" WHERE status::text IN ('PAID', 'PARTIALLY_PAID')), 0) -
        COALESCE((SELECT SUM(total)::float FROM "PurchaseOrder" WHERE status::text IN ('SENT', 'RECEIVED')), 0) as "netCash"
    `)
  } catch { cashResult = [{ netCash: 0 }] }
  const cashOnHand = Math.max(Number(cashResult[0]?.netCash || 0), 0)

  const workingCapital = totalAR + inventoryValue - totalAP

  return {
    totalAR,
    totalAP,
    inventoryValue,
    cashOnHand,
    workingCapital,
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Helper: Calculate working capital metrics
// ──────────────────────────────────────────────────────────────────────────
async function calculateWorkingCapitalMetrics(
  position: Awaited<ReturnType<typeof calculateCurrentPosition>>
): Promise<{
  dso: number // Days Sales Outstanding
  dpo: number // Days Payable Outstanding
  ccc: number // Cash Conversion Cycle
  currentRatio: number
  quickRatio: number
}> {
  // DSO = (AR / Revenue) * 365
  // Using total invoiced in last 90 days
  const revenueResult = await prisma.$queryRawUnsafe<
    Array<{ total: number }>
  >(`
    SELECT COALESCE(SUM(total), 0)::float as total
    FROM "Invoice"
    WHERE status::text NOT IN ('DRAFT', 'VOID', 'WRITE_OFF')
      AND "issuedAt" >= NOW() - INTERVAL '90 days'
  `)

  const revenue90d = revenueResult[0]?.total || 1 // Avoid division by zero
  const dso = Math.round((position.totalAR / revenue90d) * 365) || 30

  // DPO = (AP / COGS) * 365
  // Using PO spend in last 90 days as proxy
  const poResult = await prisma.$queryRawUnsafe<
    Array<{ total: number }>
  >(`
    SELECT COALESCE(SUM(total), 0)::float as total
    FROM "PurchaseOrder"
    WHERE "createdAt" >= NOW() - INTERVAL '90 days'
  `)

  const spending90d = poResult[0]?.total || 1
  const dpo = Math.round((position.totalAP / spending90d) * 365) || 45

  // CCC = DSO + DIO - DPO
  // DIO (Days Inventory Outstanding) ≈ (Inventory / COGS) * 365
  const dio = Math.round((position.inventoryValue / (spending90d / 2)) * 365) || 60
  const ccc = dso + dio - dpo

  // Current Ratio = Current Assets / Current Liabilities
  const currentAssets = position.totalAR + position.inventoryValue + position.cashOnHand
  const currentLiabilities = position.totalAP
  const currentRatio = currentLiabilities > 0 ? Math.round((currentAssets / currentLiabilities) * 100) / 100 : 0

  // Quick Ratio = (Current Assets - Inventory) / Current Liabilities
  const quickAssets = position.totalAR + position.cashOnHand
  const quickRatio = currentLiabilities > 0 ? Math.round((quickAssets / currentLiabilities) * 100) / 100 : 0

  return {
    dso,
    dpo,
    ccc,
    currentRatio,
    quickRatio,
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Helper: Build 90-day cash flow forecast
// ──────────────────────────────────────────────────────────────────────────
async function buildCashFlowForecast(): Promise<{
  optimistic: Array<any>
  base: Array<any>
  pessimistic: Array<any>
}> {
  const today = new Date()
  const forecast: Array<any> = []

  // Fetch payment due dates and expected inflows
  const paymentSchedule = await prisma.$queryRawUnsafe<
    Array<{
      forecastDate: string
      expectedInflow: number
      invoiceCount: number
    }>
  >(`
    SELECT
      DATE("dueDate")::text as "forecastDate",
      COALESCE(SUM("balanceDue"), 0)::float as "expectedInflow",
      COUNT(*)::int as "invoiceCount"
    FROM "Invoice"
    WHERE status::text NOT IN ('DRAFT', 'VOID', 'WRITE_OFF', 'PAID')
      AND "dueDate" >= CURRENT_DATE
      AND "dueDate" < CURRENT_DATE + INTERVAL '90 days'
    GROUP BY DATE("dueDate")
    ORDER BY DATE("dueDate")
  `)

  // Fetch PO payment schedule
  const poSchedule = await prisma.$queryRawUnsafe<
    Array<{
      forecastDate: string
      expectedOutflow: number
      poCount: number
    }>
  >(`
    SELECT
      DATE("createdAt" + INTERVAL '30 days')::text as "forecastDate",
      COALESCE(SUM(total), 0)::float as "expectedOutflow",
      COUNT(*)::int as "poCount"
    FROM "PurchaseOrder"
    WHERE status::text NOT IN ('DRAFT', 'CANCELLED', 'RECEIVED')
      AND "createdAt" + INTERVAL '30 days' >= CURRENT_DATE
      AND "createdAt" + INTERVAL '30 days' < CURRENT_DATE + INTERVAL '90 days'
    GROUP BY DATE("createdAt" + INTERVAL '30 days')
    ORDER BY DATE("createdAt" + INTERVAL '30 days')
  `)

  const paymentMap = new Map(paymentSchedule.map((p) => [p.forecastDate, p.expectedInflow]))
  const poMap = new Map(poSchedule.map((p) => [p.forecastDate, p.expectedOutflow]))

  // Calculate actual starting balance from collected payments - PO spend
  let startResult: any[] = []
  try {
    startResult = await prisma.$queryRawUnsafe(`
      SELECT
        COALESCE((SELECT SUM("amountPaid")::float FROM "Invoice" WHERE status::text IN ('PAID', 'PARTIALLY_PAID')), 0) -
        COALESCE((SELECT SUM(total)::float FROM "PurchaseOrder" WHERE status::text IN ('SENT', 'RECEIVED')), 0) as "balance"
    `)
  } catch { startResult = [{ balance: 0 }] }
  let runningBalance = Math.max(Number(startResult[0]?.balance || 0), 0)

  // Calculate average daily overhead from actual PO spending over last 90 days
  let overheadResult: any[] = []
  try {
    overheadResult = await prisma.$queryRawUnsafe(`
      SELECT COALESCE(SUM(total)::float / GREATEST(COUNT(DISTINCT DATE("createdAt")), 1), 0) as "dailyAvg"
      FROM "PurchaseOrder"
      WHERE "createdAt" >= NOW() - INTERVAL '90 days'
    `)
  } catch { overheadResult = [{ dailyAvg: 0 }] }
  const estimatedDailyOverhead = Number(overheadResult[0]?.dailyAvg || 0)

  for (let i = 0; i < 90; i++) {
    const date = new Date(today)
    date.setDate(date.getDate() + i)
    const dateStr = date.toISOString().split('T')[0]

    const dailyInflow = paymentMap.get(dateStr) || 0
    const dailyOutflow = poMap.get(dateStr) || estimatedDailyOverhead

    const netCashFlow = dailyInflow - dailyOutflow
    runningBalance += netCashFlow

    forecast.push({
      forecastDate: dateStr,
      projectedInflows: dailyInflow,
      projectedOutflows: dailyOutflow,
      netCashFlow,
      runningBalance,
      inflowSources: { invoicePayments: dailyInflow },
      outflowCategories: { poPayments: dailyOutflow },
      confidenceLevel: i < 30 ? 0.9 : i < 60 ? 0.7 : 0.5,
    })
  }

  return {
    base: forecast,
    optimistic: forecast.map((day) => ({
      ...day,
      projectedInflows: day.projectedInflows * 1.15,
      runningBalance: day.runningBalance * 1.1,
    })),
    pessimistic: forecast.map((day) => ({
      ...day,
      projectedOutflows: day.projectedOutflows * 1.2,
      runningBalance: day.runningBalance * 0.85,
    })),
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Helper: Identify cash gap periods
// ──────────────────────────────────────────────────────────────────────────
function identifyCashGaps(forecasts: { base: Array<any> }): Array<any> {
  const gaps: Array<any> = []
  const threshold = 10000 // Minimum cash on hand

  let gapStart: string | null = null

  for (const day of forecasts.base) {
    if (day.runningBalance < threshold) {
      if (!gapStart) {
        gapStart = day.forecastDate
      }
    } else {
      if (gapStart) {
        const gapStartVal = gapStart
        gaps.push({
          startDate: gapStartVal,
          endDate: day.forecastDate,
          minBalance: Math.min(
            ...forecasts.base
              .filter(
                (d) =>
                  d.forecastDate >= gapStartVal &&
                  d.forecastDate <= day.forecastDate
              )
              .map((d) => d.runningBalance)
          ),
        })
        gapStart = null
      }
    }
  }

  if (gapStart) {
    const gapStartVal = gapStart
    gaps.push({
      startDate: gapStartVal,
      endDate: forecasts.base[forecasts.base.length - 1].forecastDate,
      minBalance: Math.min(
        ...forecasts.base
          .filter((d) => d.forecastDate >= gapStartVal)
          .map((d) => d.runningBalance)
      ),
    })
  }

  return gaps
}

// ──────────────────────────────────────────────────────────────────────────
// Helper: Generate recommendations
// ──────────────────────────────────────────────────────────────────────────
function generateRecommendations(
  position: Awaited<ReturnType<typeof calculateCurrentPosition>>,
  metrics: Awaited<ReturnType<typeof calculateWorkingCapitalMetrics>>,
  gaps: Array<any>
): Array<{
  priority: string
  action: string
  description: string
  estimatedImpact: number
}> {
  const recommendations: Array<any> = []

  // Check DSO
  if (metrics.dso > 45) {
    recommendations.push({
      priority: 'HIGH',
      action: 'accelerate_collections',
      description: `DSO is ${metrics.dso} days; target < 45. Consider incentivizing early payment or tightening credit terms.`,
      estimatedImpact: Math.round(position.totalAR * 0.05),
    })
  }

  // Check DPO
  if (metrics.dpo < 30) {
    recommendations.push({
      priority: 'MEDIUM',
      action: 'negotiate_vendor_terms',
      description: `DPO is ${metrics.dpo} days; consider negotiating NET_45 or NET_60 with key vendors.`,
      estimatedImpact: Math.round(position.totalAP * 0.1),
    })
  }

  // Check CCC
  if (metrics.ccc > 60) {
    recommendations.push({
      priority: 'HIGH',
      action: 'reduce_cash_conversion_cycle',
      description: `CCC is ${metrics.ccc} days; focus on reducing inventory and improving collections.`,
      estimatedImpact: Math.round(position.workingCapital * 0.05),
    })
  }

  // Check current ratio
  if (metrics.currentRatio < 1.5) {
    recommendations.push({
      priority: 'HIGH',
      action: 'improve_liquidity',
      description: `Current ratio is ${metrics.currentRatio}; target > 1.5. Reduce liabilities or increase liquid assets.`,
      estimatedImpact: Math.round(position.totalAP * 0.1),
    })
  }

  // Check for gaps
  if (gaps.length > 0) {
    recommendations.push({
      priority: 'CRITICAL',
      action: 'address_cash_gaps',
      description: `Identified ${gaps.length} cash gap period(s). Plan for short-term financing or accelerate collections.`,
      estimatedImpact: -gaps[0].minBalance,
    })
  }

  // Inventory optimization
  if (position.inventoryValue > position.totalAR * 0.5) {
    recommendations.push({
      priority: 'MEDIUM',
      action: 'optimize_inventory',
      description: `Inventory is ${Math.round((position.inventoryValue / position.totalAR) * 100)}% of AR. Review slow-moving SKUs.`,
      estimatedImpact: Math.round(position.inventoryValue * 0.1),
    })
  }

  return recommendations
}

// ──────────────────────────────────────────────────────────────────────────
// Handler: Refresh and save forecast
// ──────────────────────────────────────────────────────────────────────────
async function handleRefreshForecast(): Promise<NextResponse> {
  try {
    const position = await calculateCurrentPosition()
    const forecasts = await buildCashFlowForecast()

    // Clear existing forecasts for this date range
    await prisma.$executeRawUnsafe(
      'DELETE FROM "CashFlowForecast" WHERE "forecastDate" >= CURRENT_DATE'
    )

    // Insert new forecasts
    for (const day of forecasts.base) {
      await prisma.$executeRawUnsafe(
        `INSERT INTO "CashFlowForecast"
        ("forecastDate", "projectedInflows", "projectedOutflows", "netCashFlow", "runningBalance",
         "inflowSources", "outflowCategories", "confidenceLevel", "scenario", "assumptions", "createdAt")
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())`,
        day.forecastDate,
        day.projectedInflows,
        day.projectedOutflows,
        day.netCashFlow,
        day.runningBalance,
        JSON.stringify(day.inflowSources),
        JSON.stringify(day.outflowCategories),
        day.confidenceLevel,
        'BASE',
        JSON.stringify({ position })
      )
    }

    return safeJson({
      message: 'Forecast refreshed successfully',
      forecastDays: forecasts.base.length,
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    console.error('handleRefreshForecast error:', error)
    return NextResponse.json(
      { error: 'Failed to refresh forecast' },
      { status: 500 }
    )
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Handler: Take working capital snapshot
// ──────────────────────────────────────────────────────────────────────────
async function handleTakeSnapshot(): Promise<NextResponse> {
  try {
    const position = await calculateCurrentPosition()
    const metrics = await calculateWorkingCapitalMetrics(position)

    const snapshotDate = new Date().toISOString().split('T')[0]

    // Delete existing snapshot for today if any
    await prisma.$executeRawUnsafe(
      'DELETE FROM "WorkingCapitalSnapshot" WHERE "snapshotDate" = $1',
      snapshotDate
    )

    // Insert new snapshot
    await prisma.$executeRawUnsafe(
      `INSERT INTO "WorkingCapitalSnapshot"
      ("snapshotDate", "totalAR", "totalAP", "inventory", "cashOnHand", "workingCapital",
       "currentRatio", "quickRatio", "dso", "dpo", "cashConversionCycle", "metadata", "createdAt")
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW())`,
      snapshotDate,
      position.totalAR,
      position.totalAP,
      position.inventoryValue,
      position.cashOnHand,
      position.workingCapital,
      metrics.currentRatio,
      metrics.quickRatio,
      metrics.dso,
      metrics.dpo,
      metrics.ccc,
      JSON.stringify({ timestamp: new Date().toISOString() })
    )

    return safeJson({
      message: 'Snapshot captured successfully',
      snapshotDate,
      position,
      metrics,
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    console.error('handleTakeSnapshot error:', error)
    return NextResponse.json(
      { error: 'Failed to take snapshot' },
      { status: 500 }
    )
  }
}
