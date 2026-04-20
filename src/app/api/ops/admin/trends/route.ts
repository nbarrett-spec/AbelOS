export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuthWithFallback } from '@/lib/api-auth'

// ──────────────────────────────────────────────────────────────────────────
// GET /api/ops/admin/trends
// Business metrics dashboard: 12+ KPIs as time-series data
// Returns: { metrics: [...], generatedAt: ISO }
// ──────────────────────────────────────────────────────────────────────────

interface MetricSeries {
  period: string
  value: number
}

interface Metric {
  id: string
  name: string
  currentValue: number
  priorValue: number
  changePercent: number
  trend: 'UP' | 'DOWN' | 'FLAT'
  format: 'currency' | 'percent' | 'number' | 'days'
  series: MetricSeries[]
}

interface TrendsResponse {
  metrics: Metric[]
  generatedAt: string
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  // ── Auth check ──
  const authError = await checkStaffAuthWithFallback(request)
  if (authError) return authError

  try {
    const metrics: Metric[] = []

    // ────── 1. REVENUE (last 12 months) ──────
    const revenueData: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        to_char(date_trunc('month', "createdAt"), 'YYYY-MM') as period,
        COALESCE(SUM(total)::numeric, 0) as value
      FROM "Invoice"
      WHERE
        "status" IN ('ISSUED', 'SENT', 'PARTIALLY_PAID', 'PAID', 'OVERDUE')
        AND "createdAt" >= NOW() - INTERVAL '12 months'
      GROUP BY date_trunc('month', "createdAt")
      ORDER BY date_trunc('month', "createdAt") ASC
    `)
    const revenueSeries = revenueData.map((r) => ({
      period: r.period,
      value: Math.round(parseFloat(r.value) * 100) / 100,
    }))
    const currentRev = revenueSeries.length > 0 ? revenueSeries[revenueSeries.length - 1].value : 0
    const priorRev = revenueSeries.length > 1 ? revenueSeries[revenueSeries.length - 2].value : currentRev
    metrics.push({
      id: 'revenue',
      name: 'Revenue',
      currentValue: currentRev,
      priorValue: priorRev,
      changePercent: priorRev > 0 ? ((currentRev - priorRev) / priorRev) * 100 : 0,
      trend: currentRev > priorRev ? 'UP' : currentRev < priorRev ? 'DOWN' : 'FLAT',
      format: 'currency',
      series: revenueSeries,
    })

    // ────── 2. GROSS MARGIN % (last 12 months) ──────
    const marginData: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        to_char(date_trunc('month', i."createdAt"), 'YYYY-MM') as period,
        COALESCE(SUM(i.total - COALESCE((
          SELECT COALESCE(SUM("unitPrice" * quantity)::numeric, 0)
          FROM "InvoiceItem" ii
          WHERE ii."invoiceId" = i.id
        ), 0))::numeric, 0) as gross_profit,
        COALESCE(SUM(i.total)::numeric, 0) as revenue
      FROM "Invoice" i
      WHERE
        i."status" IN ('ISSUED', 'SENT', 'PARTIALLY_PAID', 'PAID', 'OVERDUE')
        AND i."createdAt" >= NOW() - INTERVAL '12 months'
      GROUP BY date_trunc('month', i."createdAt")
      ORDER BY date_trunc('month', i."createdAt") ASC
    `)
    const marginSeries = marginData.map((m) => ({
      period: m.period,
      value:
        parseFloat(m.revenue) > 0
          ? Math.round((parseFloat(m.gross_profit) / parseFloat(m.revenue)) * 10000) / 100
          : 0,
    }))
    const currentMargin = marginSeries.length > 0 ? marginSeries[marginSeries.length - 1].value : 0
    const priorMargin = marginSeries.length > 1 ? marginSeries[marginSeries.length - 2].value : currentMargin
    metrics.push({
      id: 'gross_margin_pct',
      name: 'Gross Margin %',
      currentValue: currentMargin,
      priorValue: priorMargin,
      changePercent: priorMargin > 0 ? currentMargin - priorMargin : 0,
      trend: currentMargin > priorMargin ? 'UP' : currentMargin < priorMargin ? 'DOWN' : 'FLAT',
      format: 'percent',
      series: marginSeries,
    })

    // ────── 3. AR AGING (last 12 months snapshots) ──────
    const arData: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        to_char("snapshotDate", 'YYYY-MM') as period,
        "arTotal" as value
      FROM "FinancialSnapshot"
      WHERE "snapshotDate" >= NOW() - INTERVAL '12 months'
      ORDER BY "snapshotDate" ASC
    `)
    const arSeries = arData.map((a) => ({
      period: a.period,
      value: Math.round(parseFloat(a.value) * 100) / 100,
    }))
    const currentAR = arSeries.length > 0 ? arSeries[arSeries.length - 1].value : 0
    const priorAR = arSeries.length > 1 ? arSeries[arSeries.length - 2].value : currentAR
    metrics.push({
      id: 'ar_aging',
      name: 'AR Outstanding',
      currentValue: currentAR,
      priorValue: priorAR,
      changePercent: priorAR > 0 ? ((currentAR - priorAR) / priorAR) * 100 : 0,
      trend: currentAR > priorAR ? 'UP' : currentAR < priorAR ? 'DOWN' : 'FLAT',
      format: 'currency',
      series: arSeries,
    })

    // ────── 4. DSO (Days Sales Outstanding) ──────
    const dsoData: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        to_char("snapshotDate", 'YYYY-MM') as period,
        "dso" as value
      FROM "FinancialSnapshot"
      WHERE "snapshotDate" >= NOW() - INTERVAL '12 months'
      ORDER BY "snapshotDate" ASC
    `)
    const dsoSeries = dsoData.map((d) => ({
      period: d.period,
      value: Math.round(parseFloat(d.value) * 100) / 100,
    }))
    const currentDSO = dsoSeries.length > 0 ? dsoSeries[dsoSeries.length - 1].value : 0
    const priorDSO = dsoSeries.length > 1 ? dsoSeries[dsoSeries.length - 2].value : currentDSO
    metrics.push({
      id: 'dso',
      name: 'DSO (Days)',
      currentValue: currentDSO,
      priorValue: priorDSO,
      changePercent: priorDSO > 0 ? currentDSO - priorDSO : 0,
      trend: currentDSO < priorDSO ? 'UP' : currentDSO > priorDSO ? 'DOWN' : 'FLAT',
      format: 'days',
      series: dsoSeries,
    })

    // ────── 5. ORDER VOLUME (last 12 months) ──────
    const orderVolData: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        to_char(date_trunc('month', "createdAt"), 'YYYY-MM') as period,
        COUNT(*)::int as value
      FROM "Order"
      WHERE "createdAt" >= NOW() - INTERVAL '12 months'
      GROUP BY date_trunc('month', "createdAt")
      ORDER BY date_trunc('month', "createdAt") ASC
    `)
    const orderVolSeries = orderVolData.map((o) => ({
      period: o.period,
      value: o.value,
    }))
    const currentOrderVol = orderVolSeries.length > 0 ? orderVolSeries[orderVolSeries.length - 1].value : 0
    const priorOrderVol = orderVolSeries.length > 1 ? orderVolSeries[orderVolSeries.length - 2].value : currentOrderVol
    metrics.push({
      id: 'order_volume',
      name: 'Order Volume',
      currentValue: currentOrderVol,
      priorValue: priorOrderVol,
      changePercent: priorOrderVol > 0 ? ((currentOrderVol - priorOrderVol) / priorOrderVol) * 100 : 0,
      trend: currentOrderVol > priorOrderVol ? 'UP' : currentOrderVol < priorOrderVol ? 'DOWN' : 'FLAT',
      format: 'number',
      series: orderVolSeries,
    })

    // ────── 6. AVERAGE ORDER VALUE (last 12 months) ──────
    const aovData: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        to_char(date_trunc('month', "createdAt"), 'YYYY-MM') as period,
        COALESCE(AVG(total)::numeric, 0) as value
      FROM "Order"
      WHERE "createdAt" >= NOW() - INTERVAL '12 months'
      GROUP BY date_trunc('month', "createdAt")
      ORDER BY date_trunc('month', "createdAt") ASC
    `)
    const aovSeries = aovData.map((a) => ({
      period: a.period,
      value: Math.round(parseFloat(a.value) * 100) / 100,
    }))
    const currentAOV = aovSeries.length > 0 ? aovSeries[aovSeries.length - 1].value : 0
    const priorAOV = aovSeries.length > 1 ? aovSeries[aovSeries.length - 2].value : currentAOV
    metrics.push({
      id: 'avg_order_value',
      name: 'Average Order Value',
      currentValue: currentAOV,
      priorValue: priorAOV,
      changePercent: priorAOV > 0 ? ((currentAOV - priorAOV) / priorAOV) * 100 : 0,
      trend: currentAOV > priorAOV ? 'UP' : currentAOV < priorAOV ? 'DOWN' : 'FLAT',
      format: 'currency',
      series: aovSeries,
    })

    // ────── 7. QUOTE WIN RATE (last 12 months) ──────
    const quoteWinData: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        to_char(date_trunc('month', q."createdAt"), 'YYYY-MM') as period,
        COUNT(q.id)::int as total_quotes,
        COUNT(CASE WHEN q."status" = 'ORDERED' THEN 1 END)::int as ordered_quotes
      FROM "Quote" q
      WHERE q."createdAt" >= NOW() - INTERVAL '12 months'
      GROUP BY date_trunc('month', q."createdAt")
      ORDER BY date_trunc('month', q."createdAt") ASC
    `)
    const quoteWinSeries = quoteWinData.map((q) => ({
      period: q.period,
      value:
        q.total_quotes > 0 ? Math.round((q.ordered_quotes / q.total_quotes) * 10000) / 100 : 0,
    }))
    const currentWinRate = quoteWinSeries.length > 0 ? quoteWinSeries[quoteWinSeries.length - 1].value : 0
    const priorWinRate = quoteWinSeries.length > 1 ? quoteWinSeries[quoteWinSeries.length - 2].value : currentWinRate
    metrics.push({
      id: 'quote_win_rate',
      name: 'Quote Win Rate %',
      currentValue: currentWinRate,
      priorValue: priorWinRate,
      changePercent: priorWinRate > 0 ? currentWinRate - priorWinRate : 0,
      trend: currentWinRate > priorWinRate ? 'UP' : currentWinRate < priorWinRate ? 'DOWN' : 'FLAT',
      format: 'percent',
      series: quoteWinSeries,
    })

    // ────── 8. DELIVERY ON-TIME % (last 12 months) ──────
    const onTimeData: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        to_char(date_trunc('month', d."updatedAt"), 'YYYY-MM') as period,
        COUNT(d.id)::int as total,
        COUNT(CASE WHEN
          d."completedAt" IS NOT NULL
          AND d."completedAt" <= (SELECT MAX("scheduledDate") FROM "ScheduleEntry" WHERE "jobId" = d."jobId" LIMIT 1)
          THEN 1 END)::int as on_time
      FROM "Delivery" d
      WHERE
        d."status" IN ('COMPLETE', 'PARTIAL_DELIVERY')
        AND d."updatedAt" >= NOW() - INTERVAL '12 months'
      GROUP BY date_trunc('month', d."updatedAt")
      ORDER BY date_trunc('month', d."updatedAt") ASC
    `)
    const onTimeSeries = onTimeData.map((o) => ({
      period: o.period,
      value: o.total > 0 ? Math.round((o.on_time / o.total) * 10000) / 100 : 0,
    }))
    const currentOnTime = onTimeSeries.length > 0 ? onTimeSeries[onTimeSeries.length - 1].value : 0
    const priorOnTime = onTimeSeries.length > 1 ? onTimeSeries[onTimeSeries.length - 2].value : currentOnTime
    metrics.push({
      id: 'on_time_pct',
      name: 'On-Time Delivery %',
      currentValue: currentOnTime,
      priorValue: priorOnTime,
      changePercent: priorOnTime > 0 ? currentOnTime - priorOnTime : 0,
      trend: currentOnTime > priorOnTime ? 'UP' : currentOnTime < priorOnTime ? 'DOWN' : 'FLAT',
      format: 'percent',
      series: onTimeSeries,
    })

    // ────── 9. INVENTORY TURNS (last 12 months, quarterly) ──────
    const inventoryData: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        to_char(date_trunc('quarter', i."lastReceivedAt"), 'YYYY-Q') as period,
        COALESCE(SUM(i."unitCost" * i."onHand")::numeric, 0) as avg_inventory
      FROM "InventoryItem" i
      WHERE i."lastReceivedAt" >= NOW() - INTERVAL '12 months'
      GROUP BY date_trunc('quarter', i."lastReceivedAt")
      ORDER BY date_trunc('quarter', i."lastReceivedAt") ASC
    `)
    const cogs: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        to_char(date_trunc('quarter', ii."createdAt"), 'YYYY-Q') as period,
        COALESCE(SUM(ii."unitPrice" * ii.quantity)::numeric, 0) as cogs_quarter
      FROM "InvoiceItem" ii
      JOIN "Invoice" i ON ii."invoiceId" = i.id
      WHERE
        i."status" IN ('ISSUED', 'SENT', 'PARTIALLY_PAID', 'PAID', 'OVERDUE')
        AND ii."createdAt" >= NOW() - INTERVAL '12 months'
      GROUP BY date_trunc('quarter', ii."createdAt")
      ORDER BY date_trunc('quarter', ii."createdAt") ASC
    `)
    const invTurnSeries = cogs.map((c) => {
      const invItem = inventoryData.find((i) => i.period === c.period)
      const avgInv = invItem ? parseFloat(invItem.avg_inventory) : 1
      return {
        period: c.period,
        value: avgInv > 0 ? Math.round((parseFloat(c.cogs_quarter) / avgInv) * 100) / 100 : 0,
      }
    })
    const currentTurns = invTurnSeries.length > 0 ? invTurnSeries[invTurnSeries.length - 1].value : 0
    const priorTurns = invTurnSeries.length > 1 ? invTurnSeries[invTurnSeries.length - 2].value : currentTurns
    metrics.push({
      id: 'inventory_turns',
      name: 'Inventory Turns',
      currentValue: currentTurns,
      priorValue: priorTurns,
      changePercent: priorTurns > 0 ? ((currentTurns - priorTurns) / priorTurns) * 100 : 0,
      trend: currentTurns > priorTurns ? 'UP' : currentTurns < priorTurns ? 'DOWN' : 'FLAT',
      format: 'number',
      series: invTurnSeries,
    })

    // ────── 10. ACTIVE BUILDERS (last 12 months) ──────
    const activeBuilderData: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        to_char(date_trunc('month', o."createdAt"), 'YYYY-MM') as period,
        COUNT(DISTINCT o."builderId")::int as value
      FROM "Order" o
      WHERE o."createdAt" >= NOW() - INTERVAL '12 months'
      GROUP BY date_trunc('month', o."createdAt")
      ORDER BY date_trunc('month', o."createdAt") ASC
    `)
    const activeBuilderSeries = activeBuilderData.map((a) => ({
      period: a.period,
      value: a.value,
    }))
    const currentActiveBuilders = activeBuilderSeries.length > 0 ? activeBuilderSeries[activeBuilderSeries.length - 1].value : 0
    const priorActiveBuilders = activeBuilderSeries.length > 1 ? activeBuilderSeries[activeBuilderSeries.length - 2].value : currentActiveBuilders
    metrics.push({
      id: 'active_builders',
      name: 'Active Builders',
      currentValue: currentActiveBuilders,
      priorValue: priorActiveBuilders,
      changePercent: priorActiveBuilders > 0 ? ((currentActiveBuilders - priorActiveBuilders) / priorActiveBuilders) * 100 : 0,
      trend: currentActiveBuilders > priorActiveBuilders ? 'UP' : currentActiveBuilders < priorActiveBuilders ? 'DOWN' : 'FLAT',
      format: 'number',
      series: activeBuilderSeries,
    })

    // ────── 11. NEW BUILDERS (first order ever) ──────
    const newBuilderData: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        to_char(date_trunc('month', b."createdAt"), 'YYYY-MM') as period,
        COUNT(b.id)::int as value
      FROM "Builder" b
      WHERE
        b."createdAt" >= NOW() - INTERVAL '12 months'
        AND (SELECT COUNT(*) FROM "Order" WHERE "builderId" = b.id) >= 1
      GROUP BY date_trunc('month', b."createdAt")
      ORDER BY date_trunc('month', b."createdAt") ASC
    `)
    const newBuilderSeries = newBuilderData.map((n) => ({
      period: n.period,
      value: n.value,
    }))
    const currentNewBuilders = newBuilderSeries.length > 0 ? newBuilderSeries[newBuilderSeries.length - 1].value : 0
    const priorNewBuilders = newBuilderSeries.length > 1 ? newBuilderSeries[newBuilderSeries.length - 2].value : currentNewBuilders
    metrics.push({
      id: 'new_builders',
      name: 'New Builders',
      currentValue: currentNewBuilders,
      priorValue: priorNewBuilders,
      changePercent: priorNewBuilders > 0 ? ((currentNewBuilders - priorNewBuilders) / priorNewBuilders) * 100 : 0,
      trend: currentNewBuilders > priorNewBuilders ? 'UP' : currentNewBuilders < priorNewBuilders ? 'DOWN' : 'FLAT',
      format: 'number',
      series: newBuilderSeries,
    })

    // ────── 12. CREDIT UTILIZATION % ──────
    const creditUtilData: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        to_char(date_trunc('month', b."createdAt"), 'YYYY-MM') as period,
        COALESCE(AVG(
          CASE WHEN b."creditLimit" > 0
            THEN (b."accountBalance" / b."creditLimit" * 100)
            ELSE 0
          END
        )::numeric, 0) as value
      FROM "Builder" b
      WHERE b."createdAt" >= NOW() - INTERVAL '12 months'
      GROUP BY date_trunc('month', b."createdAt")
      ORDER BY date_trunc('month', b."createdAt") ASC
    `)
    const creditUtilSeries = creditUtilData.map((c) => ({
      period: c.period,
      value: Math.round(parseFloat(c.value) * 100) / 100,
    }))
    const currentCreditUtil = creditUtilSeries.length > 0 ? creditUtilSeries[creditUtilSeries.length - 1].value : 0
    const priorCreditUtil = creditUtilSeries.length > 1 ? creditUtilSeries[creditUtilSeries.length - 2].value : currentCreditUtil
    metrics.push({
      id: 'credit_utilization',
      name: 'Avg Credit Utilization %',
      currentValue: currentCreditUtil,
      priorValue: priorCreditUtil,
      changePercent: priorCreditUtil > 0 ? currentCreditUtil - priorCreditUtil : 0,
      trend: currentCreditUtil > priorCreditUtil ? 'UP' : currentCreditUtil < priorCreditUtil ? 'DOWN' : 'FLAT',
      format: 'percent',
      series: creditUtilSeries,
    })

    return NextResponse.json({
      metrics,
      generatedAt: new Date().toISOString(),
    } as TrendsResponse)
  } catch (error: any) {
    console.error('Trends API error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
