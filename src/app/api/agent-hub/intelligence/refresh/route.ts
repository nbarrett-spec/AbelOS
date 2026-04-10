export const dynamic = 'force-dynamic'
import { prisma } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'
import { audit } from '@/lib/audit'

/**
 * POST /api/agent-hub/intelligence/refresh
 * Recompute builder intelligence profiles from real platform data.
 * Body: { builderId?: string } — if omitted, refreshes ALL builders.
 */
export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const body = await request.json().catch(() => ({}))
    const { builderId } = body as { builderId?: string }

    // Get builders to refresh
    let builders: any[]
    if (builderId) {
      builders = await prisma.$queryRawUnsafe(
        `SELECT "id", "companyName" FROM "Builder" WHERE "id" = $1`, builderId
      )
    } else {
      builders = await prisma.$queryRawUnsafe(
        `SELECT "id", "companyName" FROM "Builder" WHERE "status"::text != 'CLOSED'`
      )
    }

    if (!builders || builders.length === 0) {
      return NextResponse.json({ error: 'No builders found' }, { status: 404 })
    }

    const results: { builderId: string; status: string; error?: string }[] = []
    const now = new Date()

    for (const builder of builders) {
      let step = 'init'
      try {
        const bid = builder.id

        step = 'orderStats'
        // 1. Order patterns
        const orderStats: any[] = await prisma.$queryRawUnsafe(`
          SELECT
            COUNT(*)::int AS "totalOrders",
            COALESCE(AVG("total"), 0) AS "avgOrderValue",
            COALESCE(SUM("total"), 0) AS "totalLifetimeValue",
            MAX("createdAt") AS "lastOrderDate"
          FROM "Order"
          WHERE "builderId" = $1 AND "status"::text NOT IN ('CANCELLED')
        `, bid)

        const os = orderStats[0] || {}
        const totalOrders = os.totalOrders || 0
        const avgOrderValue = Number(os.avgOrderValue || 0)
        const totalLifetimeValue = Number(os.totalLifetimeValue || 0)
        const lastOrderDate = os.lastOrderDate || null
        const daysSinceLastOrder = lastOrderDate
          ? Math.floor((now.getTime() - new Date(lastOrderDate).getTime()) / (1000 * 60 * 60 * 24))
          : 999

        // Order frequency (avg days between orders)
        let orderFrequencyDays = 0
        if (totalOrders >= 2) {
          const orderDates: any[] = await prisma.$queryRawUnsafe(`
            SELECT "createdAt" FROM "Order"
            WHERE "builderId" = $1 AND "status"::text NOT IN ('CANCELLED')
            ORDER BY "createdAt" ASC
          `, bid)
          if (orderDates.length >= 2) {
            const first = new Date(orderDates[0].createdAt).getTime()
            const last = new Date(orderDates[orderDates.length - 1].createdAt).getTime()
            orderFrequencyDays = Math.floor((last - first) / (1000 * 60 * 60 * 24) / (orderDates.length - 1))
          }
        }

        step = 'paymentStats'
        // 2. Payment behavior (Payment has no status column — all records are valid payments; uses receivedAt not createdAt)
        const paymentStats: any[] = await prisma.$queryRawUnsafe(`
          SELECT
            COALESCE(AVG(EXTRACT(EPOCH FROM (p."receivedAt" - i."createdAt")) / 86400), 0)::int AS "avgDaysToPayment",
            COUNT(*)::int AS "paidCount"
          FROM "Payment" p
          JOIN "Invoice" i ON i."id" = p."invoiceId"
          WHERE i."builderId" = $1
        `, bid)

        const ps = paymentStats[0] || {}
        const avgDaysToPayment = ps.avgDaysToPayment || 0

        step = 'invoicePayment'
        // On-time payment rate
        const invoicePayment: any[] = await prisma.$queryRawUnsafe(`
          SELECT
            COUNT(*)::int AS "totalInvoices",
            COUNT(CASE WHEN "status"::text = 'PAID' THEN 1 END)::int AS "paidOnTime"
          FROM "Invoice"
          WHERE "builderId" = $1 AND "status"::text NOT IN ('DRAFT', 'VOID')
        `, bid)
        const ip = invoicePayment[0] || {}
        const onTimePaymentRate = ip.totalInvoices > 0
          ? Math.round((ip.paidOnTime / ip.totalInvoices) * 100)
          : 0

        // Current balance (sum of unpaid invoices)
        const balanceResult: any[] = await prisma.$queryRawUnsafe(`
          SELECT COALESCE(SUM("balanceDue"), 0) AS "currentBalance"
          FROM "Invoice"
          WHERE "builderId" = $1 AND "status"::text IN ('SENT', 'OVERDUE', 'PARTIALLY_PAID')
        `, bid)
        const currentBalance = Number(balanceResult[0]?.currentBalance || 0)

        step = 'creditRisk'
        // 3. Credit risk score (0-100, lower = riskier)
        let creditRiskScore = 50
        if (onTimePaymentRate >= 90) creditRiskScore += 25
        else if (onTimePaymentRate >= 70) creditRiskScore += 10
        else if (onTimePaymentRate < 50) creditRiskScore -= 20
        if (avgDaysToPayment > 60) creditRiskScore -= 15
        else if (avgDaysToPayment < 30) creditRiskScore += 10
        if (currentBalance > 10000) creditRiskScore -= 10
        creditRiskScore = Math.max(0, Math.min(100, creditRiskScore))

        step = 'paymentTrend'
        // 4. Payment trend
        let paymentTrend = 'STABLE'
        // Compare last 3 invoices payment speed vs overall average
        const recentPayments: any[] = await prisma.$queryRawUnsafe(`
          SELECT EXTRACT(EPOCH FROM (p."receivedAt" - i."createdAt")) / 86400 AS "daysToPay"
          FROM "Payment" p
          JOIN "Invoice" i ON i."id" = p."invoiceId"
          WHERE i."builderId" = $1
          ORDER BY p."receivedAt" DESC LIMIT 3
        `, bid)
        if (recentPayments.length >= 2) {
          const recentAvg = recentPayments.reduce((s, p) => s + Number(p.daysToPay), 0) / recentPayments.length
          if (recentAvg < avgDaysToPayment * 0.8) paymentTrend = 'IMPROVING'
          else if (recentAvg > avgDaysToPayment * 1.3) paymentTrend = 'DECLINING'
        }

        step = 'orderTrend'
        // 5. Order trend
        let orderTrend = 'STABLE'
        if (daysSinceLastOrder > 180) orderTrend = 'CHURNING'
        else if (daysSinceLastOrder > 90) orderTrend = 'DECLINING'
        else if (totalOrders >= 3) {
          // Compare recent order values to historical
          const recentOrders: any[] = await prisma.$queryRawUnsafe(`
            SELECT "total" FROM "Order"
            WHERE "builderId" = $1 AND "status"::text NOT IN ('CANCELLED')
            ORDER BY "createdAt" DESC LIMIT 3
          `, bid)
          if (recentOrders.length >= 2) {
            const recentTotal = recentOrders.reduce((s, o) => s + Number(o.total), 0)
            if (recentTotal > avgOrderValue * recentOrders.length * 1.2) orderTrend = 'GROWING'
            else if (recentTotal < avgOrderValue * recentOrders.length * 0.7) orderTrend = 'DECLINING'
          }
        }

        // 6. Health score (1-100)
        let healthScore = 50
        if (orderTrend === 'GROWING') healthScore += 20
        else if (orderTrend === 'DECLINING') healthScore -= 15
        else if (orderTrend === 'CHURNING') healthScore -= 30
        if (onTimePaymentRate >= 80) healthScore += 15
        else if (onTimePaymentRate < 50) healthScore -= 15
        if (totalOrders >= 5) healthScore += 10
        if (totalLifetimeValue > 50000) healthScore += 10
        else if (totalLifetimeValue > 20000) healthScore += 5
        healthScore = Math.max(1, Math.min(100, healthScore))

        // 7. Cross-sell score
        let crossSellScore = 0
        if (totalOrders >= 2 && orderTrend !== 'CHURNING') {
          crossSellScore = Math.min(100, Math.round(
            (healthScore * 0.4) + (onTimePaymentRate * 0.3) + (Math.min(totalOrders, 10) * 3)
          ))
        }

        // 8. Next order estimate
        let nextOrderEstimate = null
        if (lastOrderDate && orderFrequencyDays > 0 && orderTrend !== 'CHURNING') {
          const nextDate = new Date(lastOrderDate)
          nextDate.setDate(nextDate.getDate() + orderFrequencyDays)
          if (nextDate > now) nextOrderEstimate = nextDate
          else nextOrderEstimate = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000) // Next week
        }

        step = 'activeProjects'
        // 9. Active projects (open orders + open jobs)
        const activeProjects: any[] = await prisma.$queryRawUnsafe(`
          SELECT COUNT(*)::int AS count
          FROM "Order"
          WHERE "builderId" = $1 AND "status"::text NOT IN ('COMPLETE', 'CANCELLED', 'DELIVERED')
        `, bid)
        const activeProjectCount = activeProjects[0]?.count || 0

        step = 'pipeline'
        // 10. Pipeline value (open quotes — Quote has no builderId, join through Project)
        const pipeline: any[] = await prisma.$queryRawUnsafe(`
          SELECT COALESCE(SUM(q."total"), 0) AS "pipelineValue"
          FROM "Quote" q
          JOIN "Project" p ON p."id" = q."projectId"
          WHERE p."builderId" = $1 AND q."status"::text IN ('DRAFT', 'SENT')
        `, bid)
        const pipelineValue = Number(pipeline[0]?.pipelineValue || 0)

        // Data quality score
        let dataQualityScore = 30
        if (totalOrders > 0) dataQualityScore += 20
        if (totalOrders >= 3) dataQualityScore += 15
        if (ip.totalInvoices > 0) dataQualityScore += 15
        if (recentPayments.length > 0) dataQualityScore += 10
        if (lastOrderDate) dataQualityScore += 10
        dataQualityScore = Math.min(100, dataQualityScore)

        step = 'upsert'
        // Upsert intelligence profile
        await prisma.$executeRawUnsafe(`
          INSERT INTO "BuilderIntelligence" (
            "id", "builderId", "avgOrderValue", "orderFrequencyDays", "lastOrderDate",
            "totalLifetimeValue", "totalOrders", "avgDaysToPayment", "onTimePaymentRate",
            "currentBalance", "creditRiskScore", "paymentTrend", "healthScore", "orderTrend",
            "daysSinceLastOrder", "crossSellScore", "nextOrderEstimate",
            "estimatedNextOrderValue", "activeProjectCount", "pipelineValue",
            "dataQualityScore", "lastUpdated", "createdAt"
          ) VALUES (
            gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
            $14, $15, $16, $17, $18, $19, $20, NOW(), NOW()
          )
          ON CONFLICT ("builderId") DO UPDATE SET
            "avgOrderValue" = $2, "orderFrequencyDays" = $3, "lastOrderDate" = $4,
            "totalLifetimeValue" = $5, "totalOrders" = $6, "avgDaysToPayment" = $7,
            "onTimePaymentRate" = $8, "currentBalance" = $9, "creditRiskScore" = $10,
            "paymentTrend" = $11, "healthScore" = $12, "orderTrend" = $13,
            "daysSinceLastOrder" = $14, "crossSellScore" = $15, "nextOrderEstimate" = $16,
            "estimatedNextOrderValue" = $17, "activeProjectCount" = $18, "pipelineValue" = $19,
            "dataQualityScore" = $20, "lastUpdated" = NOW()
        `,
          bid, avgOrderValue, orderFrequencyDays, lastOrderDate,
          totalLifetimeValue, totalOrders, avgDaysToPayment, onTimePaymentRate,
          currentBalance, creditRiskScore, paymentTrend, healthScore, orderTrend,
          daysSinceLastOrder, crossSellScore, nextOrderEstimate,
          avgOrderValue, activeProjectCount, pipelineValue,
          dataQualityScore
        )

        results.push({ builderId: bid, status: 'OK' })
      } catch (err: any) {
        results.push({ builderId: builder.id, status: 'ERROR', error: `[${step}] ${err.message?.slice(0, 200)}` })
      }
    }

    const successCount = results.filter(r => r.status === 'OK').length
    const errorCount = results.filter(r => r.status === 'ERROR').length

    await audit(request, 'UPDATE', 'BuilderIntelligence', 'batch', {
      buildersProcessed: results.length,
      successes: successCount,
      errors: errorCount
    })

    return NextResponse.json({
      success: errorCount === 0,
      processed: results.length,
      successes: successCount,
      errors: errorCount,
      results: errorCount > 0 ? results.filter(r => r.status === 'ERROR') : undefined
    })
  } catch (error) {
    console.error('POST /api/agent-hub/intelligence/refresh error:', error)
    return NextResponse.json({ error: 'Failed to refresh intelligence' }, { status: 500 })
  }
}
