export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'
import { safeJson } from '@/lib/safe-json'

// ──────────────────────────────────────────────────────────────────────────
// GET /api/ops/cash-flow-optimizer/payment-terms
// Analyze builder payment behavior and recommend optimal terms
// ──────────────────────────────────────────────────────────────────────────
export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    // Get all builders with payment history
    const builderPaymentData = await prisma.$queryRawUnsafe<
      Array<{
        builderId: string
        companyName: string
        currentPaymentTerm: string
        totalInvoiced: number
        amountPaid: number
        outstandingBalance: number
        invoiceCount: number
        paymentCount: number
        avgDaysToPay: number
        latestIssuedDate: string
        latestPaidDate: string
      }>
    >(`
      SELECT
        b.id as "builderId",
        b."companyName",
        b."paymentTerm" as "currentPaymentTerm",
        COALESCE(SUM(i.total), 0)::float as "totalInvoiced",
        COALESCE(SUM(p.amount), 0)::float as "amountPaid",
        COALESCE(SUM(i."balanceDue"), 0)::float as "outstandingBalance",
        COUNT(DISTINCT i.id)::int as "invoiceCount",
        COUNT(DISTINCT p.id)::int as "paymentCount",
        COALESCE(
          ROUND(AVG(EXTRACT(EPOCH FROM (p."receivedAt" - i."issuedAt")) / 86400)),
          0
        )::int as "avgDaysToPay",
        MAX(i."issuedAt")::text as "latestIssuedDate",
        MAX(p."receivedAt")::text as "latestPaidDate"
      FROM "Builder" b
      LEFT JOIN "Invoice" i ON b.id = i."builderId"
      LEFT JOIN "Payment" p ON i.id = p."invoiceId"
      WHERE i.status::text NOT IN ('DRAFT', 'VOID')
      GROUP BY b.id, b."companyName", b."paymentTerm"
      ORDER BY b."companyName" ASC
    `)

    // Calculate metrics and recommendations
    const recommendations = builderPaymentData.map((builder) => {
      const onTimeRate =
        builder.invoiceCount > 0 ? (builder.paymentCount / builder.invoiceCount) * 100 : 0
      const avgDaysToPay = builder.avgDaysToPay || 0

      // Recommend term based on payment behavior
      let recommendedTerm = builder.currentPaymentTerm
      let estimatedCashImpact = 0
      let reasoning = 'Current term aligns with payment behavior'

      const termDaysMap: Record<string, number> = {
        PAY_AT_ORDER: 0,
        PAY_ON_DELIVERY: 1,
        NET_15: 15,
        NET_30: 30,
      }

      const currentTermDays = termDaysMap[builder.currentPaymentTerm] || 0

      // Logic: if builder consistently pays earlier than term, tighten term
      if (avgDaysToPay < currentTermDays * 0.5 && builder.invoiceCount >= 5) {
        recommendedTerm = 'PAY_ON_DELIVERY'
        estimatedCashImpact = (currentTermDays - 1) * (builder.outstandingBalance / builder.invoiceCount)
        reasoning = 'Builder pays much faster than term allows; tighten to PAY_ON_DELIVERY'
      } else if (avgDaysToPay < currentTermDays * 0.75 && builder.invoiceCount >= 3) {
        if (recommendedTerm !== 'PAY_AT_ORDER') {
          recommendedTerm = 'PAY_ON_DELIVERY'
          estimatedCashImpact = (currentTermDays - 1) * (builder.outstandingBalance / builder.invoiceCount)
          reasoning = 'Builder pays ahead of term; recommend tighter term'
        }
      }

      // If builder is late payer, relax term to reduce default risk
      if (onTimeRate < 70 && builder.invoiceCount >= 5) {
        recommendedTerm = 'NET_30'
        estimatedCashImpact = -30 * (builder.outstandingBalance / builder.invoiceCount)
        reasoning = 'Low on-time rate; recommend NET_30 for flexibility'
      }

      return {
        builderId: builder.builderId,
        companyName: builder.companyName,
        currentPaymentTerm: builder.currentPaymentTerm,
        recommendedTerm,
        avgDaysToPay,
        onTimeRate: Math.round(onTimeRate * 100) / 100,
        totalInvoiced: builder.totalInvoiced,
        outstandingBalance: builder.outstandingBalance,
        invoiceCount: builder.invoiceCount,
        paymentCount: builder.paymentCount,
        estimatedCashImpact: Math.round(estimatedCashImpact * 100) / 100,
        reasoning,
        latestIssuedDate: builder.latestIssuedDate,
        latestPaidDate: builder.latestPaidDate,
      }
    })

    // Sort by estimated cash impact (highest first)
    recommendations.sort((a, b) => b.estimatedCashImpact - a.estimatedCashImpact)

    // Calculate summary stats
    const summaryStats = {
      totalBuilders: builderPaymentData.length,
      totalInvoiced: builderPaymentData.reduce((sum, b) => sum + b.totalInvoiced, 0),
      totalOutstanding: builderPaymentData.reduce((sum, b) => sum + b.outstandingBalance, 0),
      avgDaysToPay: Math.round(
        builderPaymentData.reduce((sum, b) => sum + b.avgDaysToPay, 0) /
          Math.max(builderPaymentData.length, 1)
      ),
      termDistribution: {
        PAY_AT_ORDER: builderPaymentData.filter((b) => b.currentPaymentTerm === 'PAY_AT_ORDER').length,
        PAY_ON_DELIVERY: builderPaymentData.filter((b) => b.currentPaymentTerm === 'PAY_ON_DELIVERY').length,
        NET_15: builderPaymentData.filter((b) => b.currentPaymentTerm === 'NET_15').length,
        NET_30: builderPaymentData.filter((b) => b.currentPaymentTerm === 'NET_30').length,
      },
      recommendedChanges: recommendations.filter((r) => r.recommendedTerm !== r.currentPaymentTerm).length,
    }

    return safeJson({
      recommendations,
      summaryStats,
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    console.error('GET /api/ops/cash-flow-optimizer/payment-terms error:', error)
    return NextResponse.json(
      { error: 'Failed to analyze payment terms' },
      { status: 500 }
    )
  }
}

// ──────────────────────────────────────────────────────────────────────────
// POST /api/ops/cash-flow-optimizer/payment-terms
// Manage payment term recommendations
// ──────────────────────────────────────────────────────────────────────────
export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const body = await request.json()
    const { action, recommendationId, builderId, reason } = body

    if (!action) {
      return NextResponse.json(
        { error: 'Missing required field: action' },
        { status: 400 }
      )
    }

    // Action: generate_recommendations
    if (action === 'generate_recommendations') {
      return await handleGenerateRecommendations()
    }

    // Action: approve_recommendation
    if (action === 'approve_recommendation') {
      if (!recommendationId) {
        return NextResponse.json(
          { error: 'Missing required field: recommendationId' },
          { status: 400 }
        )
      }
      return await handleApproveRecommendation(recommendationId)
    }

    // Action: reject_recommendation
    if (action === 'reject_recommendation') {
      if (!recommendationId) {
        return NextResponse.json(
          { error: 'Missing required field: recommendationId' },
          { status: 400 }
        )
      }
      return await handleRejectRecommendation(recommendationId, reason)
    }

    return NextResponse.json(
      { error: `Unknown action: ${action}` },
      { status: 400 }
    )
  } catch (error) {
    console.error('POST /api/ops/cash-flow-optimizer/payment-terms error:', error)
    return NextResponse.json(
      { error: 'Failed to process payment term request' },
      { status: 500 }
    )
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Handler: Generate and save recommendations
// ──────────────────────────────────────────────────────────────────────────
async function handleGenerateRecommendations(): Promise<NextResponse> {
  try {
    // Fetch all builders with payment metrics
    const builderMetrics = await prisma.$queryRawUnsafe<
      Array<{
        builderId: string
        companyName: string
        currentPaymentTerm: string
        avgDaysToPay: number
        onTimeRate: number
        outstandingBalance: number
        invoiceCount: number
        paymentCount: number
      }>
    >(`
      SELECT
        b.id as "builderId",
        b."companyName",
        b."paymentTerm" as "currentPaymentTerm",
        COALESCE(
          ROUND(AVG(EXTRACT(EPOCH FROM (p."receivedAt" - i."issuedAt")) / 86400)),
          0
        )::int as "avgDaysToPay",
        CASE
          WHEN COUNT(DISTINCT i.id) > 0 THEN
            ROUND((COUNT(DISTINCT p.id)::float / COUNT(DISTINCT i.id)) * 100)
          ELSE 0
        END::int as "onTimeRate",
        COALESCE(SUM(i."balanceDue"), 0)::float as "outstandingBalance",
        COUNT(DISTINCT i.id)::int as "invoiceCount",
        COUNT(DISTINCT p.id)::int as "paymentCount"
      FROM "Builder" b
      LEFT JOIN "Invoice" i ON b.id = i."builderId"
      LEFT JOIN "Payment" p ON i.id = p."invoiceId"
      WHERE i.status::text NOT IN ('DRAFT', 'VOID')
      GROUP BY b.id, b."companyName", b."paymentTerm"
    `)

    // Generate recommendations
    const recommendationsToCreate = []

    for (const metric of builderMetrics) {
      let recommendedTerm = metric.currentPaymentTerm
      let estimatedCashImpact = 0
      let reasoning = ''
      let confidence = 0.7

      const termDaysMap: Record<string, number> = {
        PAY_AT_ORDER: 0,
        PAY_ON_DELIVERY: 1,
        NET_15: 15,
        NET_30: 30,
      }

      const currentTermDays = termDaysMap[metric.currentPaymentTerm] || 0

      // Decision logic
      if (metric.invoiceCount < 3) {
        continue // Insufficient history
      }

      if (metric.onTimeRate >= 90 && metric.avgDaysToPay < currentTermDays * 0.6) {
        // Excellent payer who pays fast
        recommendedTerm = 'PAY_ON_DELIVERY'
        estimatedCashImpact = (currentTermDays - 1) * 10000 // Simplified
        reasoning = 'Excellent payment history; tighten terms for better cash flow'
        confidence = 0.9
      } else if (metric.onTimeRate >= 80 && metric.avgDaysToPay < currentTermDays * 0.75) {
        recommendedTerm = 'PAY_ON_DELIVERY'
        estimatedCashImpact = (currentTermDays - 1) * 10000
        reasoning = 'Good payer; recommend tighter terms'
        confidence = 0.8
      } else if (metric.onTimeRate < 70) {
        recommendedTerm = 'NET_30'
        estimatedCashImpact = -30 * 10000
        reasoning = 'Late payer; extend terms to reduce default risk'
        confidence = 0.75
      }

      if (recommendedTerm !== metric.currentPaymentTerm) {
        recommendationsToCreate.push({
          builderId: metric.builderId,
          currentTerm: metric.currentPaymentTerm,
          recommendedTerm,
          reasoning,
          estimatedCashImpact: Math.round(estimatedCashImpact),
          estimatedRiskChange: metric.onTimeRate >= 80 ? -5 : 5,
          confidence: Math.round(confidence * 100),
          status: 'PENDING',
        })
      }
    }

    // Insert recommendations (delete old pending ones first)
    await prisma.$executeRawUnsafe(
      'DELETE FROM "PaymentTermRecommendation" WHERE status = $1',
      'PENDING'
    )

    for (const rec of recommendationsToCreate) {
      await prisma.$executeRawUnsafe(
        `INSERT INTO "PaymentTermRecommendation"
        ("builderId", "currentTerm", "recommendedTerm", "reasoning", "estimatedCashImpact", "estimatedRiskChange", "confidence", "status", "createdAt")
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())`,
        rec.builderId,
        rec.currentTerm,
        rec.recommendedTerm,
        rec.reasoning,
        rec.estimatedCashImpact,
        rec.estimatedRiskChange,
        rec.confidence,
        rec.status
      )
    }

    return safeJson({
      message: 'Recommendations generated successfully',
      count: recommendationsToCreate.length,
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    console.error('handleGenerateRecommendations error:', error)
    return NextResponse.json(
      { error: 'Failed to generate recommendations' },
      { status: 500 }
    )
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Handler: Approve a recommendation
// ──────────────────────────────────────────────────────────────────────────
async function handleApproveRecommendation(recommendationId: string): Promise<NextResponse> {
  try {
    // Get the recommendation
    const recommendation = await prisma.$queryRawUnsafe<
      Array<{
        builderId: string
        recommendedTerm: string
      }>
    >(
      'SELECT "builderId", "recommendedTerm" FROM "PaymentTermRecommendation" WHERE id = $1',
      recommendationId
    )

    if (!recommendation || recommendation.length === 0) {
      return NextResponse.json(
        { error: 'Recommendation not found' },
        { status: 404 }
      )
    }

    const { builderId, recommendedTerm } = recommendation[0]

    // Update builder's payment term
    await prisma.$executeRawUnsafe(
      'UPDATE "Builder" SET "paymentTerm" = $1::"PaymentTerm", "updatedAt" = NOW() WHERE id = $2',
      recommendedTerm,
      builderId
    )

    // Mark recommendation as approved
    await prisma.$executeRawUnsafe(
      'UPDATE "PaymentTermRecommendation" SET status = $1, "reviewedAt" = NOW() WHERE id = $2',
      'APPROVED',
      recommendationId
    )

    return safeJson({
      message: 'Recommendation approved and applied',
      builderId,
      newPaymentTerm: recommendedTerm,
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    console.error('handleApproveRecommendation error:', error)
    return NextResponse.json(
      { error: 'Failed to approve recommendation' },
      { status: 500 }
    )
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Handler: Reject a recommendation
// ──────────────────────────────────────────────────────────────────────────
async function handleRejectRecommendation(recommendationId: string, reason?: string): Promise<NextResponse> {
  try {
    // Mark recommendation as rejected
    await prisma.$executeRawUnsafe(
      'UPDATE "PaymentTermRecommendation" SET status = $1, "reviewedAt" = NOW() WHERE id = $2',
      'REJECTED',
      recommendationId
    )

    return safeJson({
      message: 'Recommendation rejected',
      reason: reason || 'No reason provided',
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    console.error('handleRejectRecommendation error:', error)
    return NextResponse.json(
      { error: 'Failed to reject recommendation' },
      { status: 500 }
    )
  }
}
