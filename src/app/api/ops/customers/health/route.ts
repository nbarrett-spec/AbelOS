export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuthWithFallback } from '@/lib/api-auth'

interface BuilderScore {
  builderId: string
  builderName: string
  compositeScore: number
  grade: string
  paymentScore: number
  paymentGrade: string
  activityScore: number
  activityGrade: string
  marginScore: number
  marginGrade: string
  relationshipScore: number
  relationshipGrade: string
  arOutstanding: number
  overdueAmount: number
  last90dOrders: number
  riskLevel: string
  trend: string
}

function scoreToGrade(score: number): string {
  if (score >= 90) return 'A'
  if (score >= 80) return 'B'
  if (score >= 70) return 'C'
  if (score >= 60) return 'D'
  return 'F'
}

function scoreToRiskLevel(score: number): string {
  if (score >= 80) return 'LOW'
  if (score >= 70) return 'MEDIUM'
  if (score >= 60) return 'HIGH'
  return 'CRITICAL'
}

// GET /api/ops/customers/health — Builder health scores (A-F grades)
export async function GET(request: NextRequest) {
  const authError = await checkStaffAuthWithFallback(request)
  if (authError) return authError

  try {
    // 1. Get all ACTIVE builders
    const builders: any[] = await prisma.$queryRawUnsafe(`
      SELECT "id", "companyName"
      FROM "Builder"
      WHERE "status" = 'ACTIVE'
      ORDER BY "companyName"
    `)

    const results: BuilderScore[] = []
    const gradeDistribution: Record<string, number> = { A: 0, B: 0, C: 0, D: 0, F: 0 }
    let totalScore = 0

    for (const builder of builders) {
      const builderId = builder.id

      // 2. Payment Health: avg days-to-pay, overdue count, overdue amount
      const paymentData: any[] = await prisma.$queryRawUnsafe(`
        SELECT
          COALESCE(AVG(EXTRACT(DAY FROM ("paidAt" - "dueDate")))::float, 0) AS "avgDaysToPay",
          COUNT(CASE WHEN "status"::text = 'OVERDUE' THEN 1 END)::int AS "overdueCount",
          COALESCE(SUM(CASE WHEN "status"::text = 'OVERDUE' THEN "balanceDue" ELSE 0 END), 0)::float AS "overdueAmount",
          COALESCE(SUM(CASE WHEN "status"::text NOT IN ('PAID', 'VOID', 'WRITE_OFF') THEN "balanceDue" ELSE 0 END), 0)::float AS "arOutstanding",
          COUNT(CASE WHEN "status"::text = 'PAID' THEN 1 END)::int AS "paidCount"
        FROM "Invoice"
        WHERE "builderId" = $1
      `, builderId)

      const payment = paymentData[0] || { avgDaysToPay: 0, overdueCount: 0, overdueAmount: 0, arOutstanding: 0, paidCount: 0 }
      const avgDaysToPay = payment.avgDaysToPay || 0
      const paymentScore = Math.max(0, 100 - (avgDaysToPay / 30) * 50 - (payment.overdueCount > 0 ? 20 : 0))

      // 3. Order Activity: last 90 vs prior 90 days
      const activityData: any[] = await prisma.$queryRawUnsafe(`
        SELECT
          COUNT(CASE WHEN "createdAt" >= NOW() - INTERVAL '90 days' THEN 1 END)::int AS "last90",
          COUNT(CASE WHEN "createdAt" >= NOW() - INTERVAL '180 days' AND "createdAt" < NOW() - INTERVAL '90 days' THEN 1 END)::int AS "prior90"
        FROM "Order"
        WHERE "builderId" = $1
      `, builderId)

      const activity = activityData[0] || { last90: 0, prior90: 0 }
      const orderTrend = activity.last90 > 0 && activity.prior90 > 0
        ? (activity.last90 / activity.prior90) * 100
        : (activity.last90 > 0 ? 120 : 50)
      const activityScore = Math.min(100, Math.max(0, (orderTrend / 100) * 100))

      // 4. Margin Quality: avg margin % on orders
      const marginData: any[] = await prisma.$queryRawUnsafe(`
        SELECT
          COALESCE(AVG(
            CASE
              WHEN "total" > 0 THEN ((("total" - COALESCE((
                SELECT SUM("lineTotal")
                FROM "OrderItem"
                WHERE "orderId" = "Order"."id"
              ), 0)) / "total") * 100)
              ELSE NULL
            END
          ), 25)::float AS "avgMarginPct"
        FROM "Order"
        WHERE "builderId" = $1 AND "createdAt" >= NOW() - INTERVAL '90 days'
      `, builderId)

      const marginMargin = marginData[0] || { avgMarginPct: 25 }
      const avgMarginPct = (marginMargin.avgMarginPct || 25) / 100
      const marginScore = Math.min(100, Math.max(0, (avgMarginPct / 0.35) * 100))

      // 5. Relationship Depth: distinct categories, projects, time as customer
      const relationshipData: any[] = await prisma.$queryRawUnsafe(`
        SELECT
          COUNT(DISTINCT p.id)::int AS "projectCount",
          COUNT(DISTINCT pi."category")::int AS "categoryCount",
          EXTRACT(DAY FROM (NOW() - "createdAt"))::int AS "daysSinceCreated"
        FROM "Builder" b
        LEFT JOIN "Project" p ON p."builderId" = b.id
        LEFT JOIN "Order" o ON o."builderId" = b.id
        LEFT JOIN "OrderItem" oi ON oi."orderId" = o.id
        LEFT JOIN "Product" pi ON pi.id = oi."productId"
        WHERE b.id = $1
        GROUP BY b.id, b."createdAt"
      `, builderId)

      const relationship = relationshipData[0] || { projectCount: 0, categoryCount: 0, daysSinceCreated: 0 }
      const yearsAsCustomer = (relationship.daysSinceCreated || 0) / 365
      const relationshipScore = Math.min(100,
        (relationship.categoryCount || 0) * 10 +
        (relationship.projectCount || 0) * 15 +
        (yearsAsCustomer >= 2 ? 40 : yearsAsCustomer * 20)
      )

      // Composite score (weighted average)
      const compositeScore = (
        paymentScore * 0.40 +
        activityScore * 0.25 +
        marginScore * 0.20 +
        relationshipScore * 0.15
      )

      const grade = scoreToGrade(compositeScore)
      const riskLevel = scoreToRiskLevel(compositeScore)
      const trend = activity.last90 > activity.prior90 ? '↑' : (activity.last90 < activity.prior90 ? '↓' : '→')

      gradeDistribution[grade]++
      totalScore += compositeScore

      results.push({
        builderId,
        builderName: builder.companyName,
        compositeScore: Math.round(compositeScore * 10) / 10,
        grade,
        paymentScore: Math.round(paymentScore * 10) / 10,
        paymentGrade: scoreToGrade(paymentScore),
        activityScore: Math.round(activityScore * 10) / 10,
        activityGrade: scoreToGrade(activityScore),
        marginScore: Math.round(marginScore * 10) / 10,
        marginGrade: scoreToGrade(marginScore),
        relationshipScore: Math.round(relationshipScore * 10) / 10,
        relationshipGrade: scoreToGrade(relationshipScore),
        arOutstanding: Math.round(payment.arOutstanding),
        overdueAmount: Math.round(payment.overdueAmount),
        last90dOrders: activity.last90,
        riskLevel,
        trend,
      })
    }

    // Sort by composite score descending
    results.sort((a, b) => b.compositeScore - a.compositeScore)

    // Count at-risk (D or F)
    const atRiskCount = results.filter(r => ['D', 'F'].includes(r.grade)).length

    return NextResponse.json({
      builders: results,
      summary: {
        totalBuilders: results.length,
        gradeDistribution,
        avgScore: results.length > 0 ? Math.round((totalScore / results.length) * 10) / 10 : 0,
        atRiskCount,
      },
    })
  } catch (error) {
    console.error('Error computing builder health scores:', error)
    return NextResponse.json(
      { error: 'Failed to compute health scores' },
      { status: 500 }
    )
  }
}
