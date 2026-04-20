export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuthWithFallback } from '@/lib/api-auth'
import { prisma } from '@/lib/prisma'

export async function GET(request: NextRequest) {
  // Auth check
  const authError = await checkStaffAuthWithFallback(request)
  if (authError) return authError

  try {
    const now = new Date()
    const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1)
    const currentMonthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59)
    const priorMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    const priorMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59)

    // ────────────────────────────────────────────────────────────────────────
    // 1. P&L Summary (current month + prior month)
    // ────────────────────────────────────────────────────────────────────────
    const pnlCurrent: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        COALESCE(SUM(CASE WHEN "status"::text IN ('PAID', 'ISSUED', 'SENT') THEN "total" ELSE 0 END), 0)::float AS "revenue",
        COALESCE(AVG(p."margin"), 0.35)::float AS "avgMargin"
      FROM "Invoice" i
      LEFT JOIN "Product" p ON TRUE
      WHERE i."createdAt" >= $1 AND i."createdAt" <= $2
    `, currentMonthStart, currentMonthEnd)

    const pnlPrior: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        COALESCE(SUM(CASE WHEN "status"::text IN ('PAID', 'ISSUED', 'SENT') THEN "total" ELSE 0 END), 0)::float AS "revenue",
        COALESCE(AVG(p."margin"), 0.35)::float AS "avgMargin"
      FROM "Invoice" i
      LEFT JOIN "Product" p ON TRUE
      WHERE i."createdAt" >= $1 AND i."createdAt" <= $2
    `, priorMonthStart, priorMonthEnd)

    const currentRevenue = pnlCurrent[0]?.revenue || 0
    const currentMargin = pnlCurrent[0]?.avgMargin || 0.35
    const currentCogs = currentRevenue * (1 - currentMargin)
    const currentGrossProfit = currentRevenue - currentCogs
    const currentGrossMarginPct = currentRevenue > 0 ? (currentGrossProfit / currentRevenue) * 100 : 0

    const priorRevenue = pnlPrior[0]?.revenue || 0
    const priorMargin = pnlPrior[0]?.avgMargin || 0.35
    const priorCogs = priorRevenue * (1 - priorMargin)
    const priorGrossProfit = priorRevenue - priorCogs
    const priorGrossMarginPct = priorRevenue > 0 ? (priorGrossProfit / priorRevenue) * 100 : 0

    const revenueChange = priorRevenue > 0 ? ((currentRevenue - priorRevenue) / priorRevenue) * 100 : 0

    // ────────────────────────────────────────────────────────────────────────
    // 2. Cash Position
    // ────────────────────────────────────────────────────────────────────────
    const cashPos: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        COALESCE(SUM(CASE WHEN i."status"::text NOT IN ('PAID', 'VOID', 'WRITE_OFF') THEN i."balanceDue" ELSE 0 END), 0)::float AS "totalAR",
        COALESCE(SUM(CASE WHEN po."status"::text IN ('APPROVED', 'SENT_TO_VENDOR', 'PARTIALLY_RECEIVED') THEN po."total" ELSE 0 END), 0)::float AS "totalAP"
      FROM "Invoice" i, "PurchaseOrder" po
      WHERE TRUE
    `)

    const totalAR = cashPos[0]?.totalAR || 0
    const totalAP = cashPos[0]?.totalAP || 0
    const netCashPosition = totalAR - totalAP

    // ────────────────────────────────────────────────────────────────────────
    // 3. AR Aging Waterfall
    // ────────────────────────────────────────────────────────────────────────
    const arAging: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        COALESCE(SUM(CASE WHEN i."dueDate" > NOW()::date THEN i."balanceDue" ELSE 0 END), 0)::float AS "current",
        COALESCE(SUM(CASE WHEN i."dueDate" <= NOW()::date AND i."dueDate" > (NOW() - INTERVAL '30 days')::date THEN i."balanceDue" ELSE 0 END), 0)::float AS "days_1_30",
        COALESCE(SUM(CASE WHEN i."dueDate" <= (NOW() - INTERVAL '30 days')::date AND i."dueDate" > (NOW() - INTERVAL '60 days')::date THEN i."balanceDue" ELSE 0 END), 0)::float AS "days_31_60",
        COALESCE(SUM(CASE WHEN i."dueDate" <= (NOW() - INTERVAL '60 days')::date AND i."dueDate" > (NOW() - INTERVAL '90 days')::date THEN i."balanceDue" ELSE 0 END), 0)::float AS "days_61_90",
        COALESCE(SUM(CASE WHEN i."dueDate" <= (NOW() - INTERVAL '90 days')::date THEN i."balanceDue" ELSE 0 END), 0)::float AS "days_90_plus"
      FROM "Invoice" i
      WHERE i."status"::text NOT IN ('PAID', 'VOID', 'WRITE_OFF')
    `)

    const aging = {
      current: arAging[0]?.current || 0,
      days_1_30: arAging[0]?.days_1_30 || 0,
      days_31_60: arAging[0]?.days_31_60 || 0,
      days_61_90: arAging[0]?.days_61_90 || 0,
      days_90_plus: arAging[0]?.days_90_plus || 0,
    }

    // ────────────────────────────────────────────────────────────────────────
    // 4. Top 5 Builder Exposure
    // ────────────────────────────────────────────────────────────────────────
    const topBuilders: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        b."id",
        b."companyName",
        COALESCE(SUM(i."balanceDue"), 0)::float AS "outstanding",
        COALESCE(b."creditLimit", 0)::float AS "creditLimit"
      FROM "Builder" b
      LEFT JOIN "Invoice" i ON i."builderId" = b."id" AND i."status"::text NOT IN ('PAID', 'VOID', 'WRITE_OFF')
      WHERE b."status"::text = 'ACTIVE'
      GROUP BY b."id", b."companyName", b."creditLimit"
      ORDER BY "outstanding" DESC
      LIMIT 5
    `)

    const topBuildersFormatted = topBuilders.map(b => ({
      id: b.id,
      companyName: b.companyName,
      outstanding: b.outstanding || 0,
      creditLimit: b.creditLimit || 0,
      utilization: b.creditLimit > 0 ? ((b.outstanding || 0) / b.creditLimit) * 100 : 0,
    }))

    // ────────────────────────────────────────────────────────────────────────
    // 5. Revenue Trend (12-month)
    // ────────────────────────────────────────────────────────────────────────
    const revenueTrend: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        DATE_TRUNC('month', i."createdAt")::date AS "month",
        COALESCE(SUM(CASE WHEN i."status"::text IN ('PAID', 'ISSUED', 'SENT') THEN i."total" ELSE 0 END), 0)::float AS "revenue"
      FROM "Invoice" i
      WHERE i."createdAt" >= NOW() - INTERVAL '12 months'
      GROUP BY DATE_TRUNC('month', i."createdAt")
      ORDER BY "month" ASC
    `)

    // ────────────────────────────────────────────────────────────────────────
    // 6. DSO Trend (from FinancialSnapshot if available, else calculate)
    // ────────────────────────────────────────────────────────────────────────
    const dsoTrend: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        DATE_TRUNC('month', i."createdAt")::date AS "month",
        COALESCE(AVG(EXTRACT(DAY FROM (NOW() - i."createdAt"))), 0)::float AS "dso"
      FROM "Invoice" i
      WHERE i."createdAt" >= NOW() - INTERVAL '6 months' AND i."status"::text = 'PAID'
      GROUP BY DATE_TRUNC('month', i."createdAt")
      ORDER BY "month" DESC
      LIMIT 6
    `)

    const currentDSO = dsoTrend.length > 0 ? dsoTrend[0].dso : 0

    // ────────────────────────────────────────────────────────────────────────
    // 7. Margin Trend (6-month gross margin %)
    // ────────────────────────────────────────────────────────────────────────
    const marginTrend: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        DATE_TRUNC('month', i."createdAt")::date AS "month",
        COALESCE(SUM(CASE WHEN i."status"::text IN ('PAID', 'ISSUED', 'SENT') THEN i."total" ELSE 0 END), 0)::float AS "revenue",
        COALESCE(AVG(p."margin"), 0.35)::float AS "avgMargin"
      FROM "Invoice" i
      LEFT JOIN "Product" p ON TRUE
      WHERE i."createdAt" >= NOW() - INTERVAL '6 months'
      GROUP BY DATE_TRUNC('month', i."createdAt")
      ORDER BY "month" ASC
    `)

    // ────────────────────────────────────────────────────────────────────────
    // 8. Delivery Performance (30-day on-time %)
    // ────────────────────────────────────────────────────────────────────────
    const deliveryPerf: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        COUNT(*)::int AS "total",
        COUNT(CASE WHEN d."actualDeliveryDate" <= d."scheduledDeliveryDate" THEN 1 END)::int AS "onTime"
      FROM "Delivery" d
      WHERE d."actualDeliveryDate" IS NOT NULL
        AND d."createdAt" >= NOW() - INTERVAL '30 days'
    `)

    const deliveryTotal = deliveryPerf[0]?.total || 1
    const deliveryOnTime = deliveryPerf[0]?.onTime || 0
    const deliveryOnTimePct = (deliveryOnTime / deliveryTotal) * 100

    // ────────────────────────────────────────────────────────────────────────
    // 9. Headcount by Department
    // ────────────────────────────────────────────────────────────────────────
    const headcount: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        COALESCE(s."department", 'Other')::text AS "department",
        COUNT(*)::int AS "count"
      FROM "Staff" s
      WHERE s."status"::text = 'ACTIVE'
      GROUP BY s."department"
      ORDER BY "count" DESC
    `)

    // ────────────────────────────────────────────────────────────────────────
    // 10. Key Alerts
    // ────────────────────────────────────────────────────────────────────────
    const alerts: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        COUNT(CASE WHEN i."status"::text = 'OVERDUE' THEN 1 END)::int AS "overdueCount",
        COUNT(CASE WHEN b."creditUtilization" > 0.9 THEN 1 END)::int AS "creditBreachCount",
        COUNT(CASE WHEN p."quantityOnHand" < p."minimumStock" THEN 1 END)::int AS "stockoutCount"
      FROM "Invoice" i, "Builder" b, "Product" p
      WHERE TRUE
    `)

    const alertCounts = {
      overdue: alerts[0]?.overdueCount || 0,
      creditBreach: alerts[0]?.creditBreachCount || 0,
      stockout: alerts[0]?.stockoutCount || 0,
    }

    return NextResponse.json({
      timestamp: new Date().toISOString(),
      pnl: {
        current: {
          revenue: Math.round(currentRevenue * 100) / 100,
          cogs: Math.round(currentCogs * 100) / 100,
          grossProfit: Math.round(currentGrossProfit * 100) / 100,
          grossMarginPct: Math.round(currentGrossMarginPct * 100) / 100,
        },
        prior: {
          revenue: Math.round(priorRevenue * 100) / 100,
          cogs: Math.round(priorCogs * 100) / 100,
          grossProfit: Math.round(priorGrossProfit * 100) / 100,
          grossMarginPct: Math.round(priorGrossMarginPct * 100) / 100,
        },
        revenueChangePercent: Math.round(revenueChange * 100) / 100,
      },
      cashPosition: {
        totalAR: Math.round(totalAR * 100) / 100,
        totalAP: Math.round(totalAP * 100) / 100,
        netPosition: Math.round(netCashPosition * 100) / 100,
      },
      arAging: {
        current: Math.round(aging.current * 100) / 100,
        days_1_30: Math.round(aging.days_1_30 * 100) / 100,
        days_31_60: Math.round(aging.days_31_60 * 100) / 100,
        days_61_90: Math.round(aging.days_61_90 * 100) / 100,
        days_90_plus: Math.round(aging.days_90_plus * 100) / 100,
      },
      topBuilders: topBuildersFormatted.map(b => ({
        id: b.id,
        companyName: b.companyName,
        outstanding: Math.round(b.outstanding * 100) / 100,
        creditLimit: Math.round(b.creditLimit * 100) / 100,
        utilizationPercent: Math.round(b.utilization * 100) / 100,
      })),
      revenueTrend: revenueTrend.map(r => ({
        month: r.month,
        revenue: Math.round(r.revenue * 100) / 100,
      })),
      dsoTrend: dsoTrend.reverse().map(d => ({
        month: d.month,
        dso: Math.round(d.dso * 100) / 100,
      })),
      currentDSO: Math.round(currentDSO * 100) / 100,
      marginTrend: marginTrend.map(m => ({
        month: m.month,
        grossMarginPct: Math.round(((m.revenue * (1 - m.avgMargin)) / m.revenue) * 100 * 100) / 100 || 0,
      })),
      deliveryPerformance: {
        onTimePercent: Math.round(deliveryOnTimePct * 100) / 100,
      },
      headcount: headcount.map(h => ({
        department: h.department,
        count: h.count,
      })),
      alerts: alertCounts,
    })
  } catch (error) {
    console.error('Executive dashboard error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch dashboard data' },
      { status: 500 }
    )
  }
}
