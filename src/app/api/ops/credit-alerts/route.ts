export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'

type AlertType = 'OVER_CREDIT_LIMIT' | 'OVERDUE_INVOICES' | 'HIGH_BALANCE'
type Severity = 'HIGH' | 'MEDIUM' | 'LOW'

interface CreditAlert {
  type: AlertType
  severity: Severity
  builderId: string
  companyName: string
  details: string
  amount: number
}

interface AlertSummary {
  total: number
  high: number
  medium: number
  low: number
}

interface CreditAlertsResponse {
  alerts: CreditAlert[]
  summary: AlertSummary
}

// GET /api/ops/credit-alerts — Check builder accounts for credit issues
export async function GET(request: NextRequest): Promise<NextResponse> {
  // SECURITY: Require staff auth to access credit alerts
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const alerts: CreditAlert[] = []

    // 1. Check for builders over credit limit
    const overCreditLimitBuilders = await prisma.$queryRawUnsafe<
      Array<{
        id: string
        companyName: string
        accountBalance: number
        creditLimit: number
      }>
    >(
      `
      SELECT b."id", b."companyName",
             COALESCE(b."accountBalance", 0) AS "accountBalance",
             COALESCE(b."creditLimit", 0) AS "creditLimit"
      FROM "Builder" b
      WHERE b."accountBalance" > b."creditLimit"
        AND b."status" = 'ACTIVE'
      ORDER BY (b."accountBalance" - b."creditLimit") DESC
      `
    )

    for (const builder of overCreditLimitBuilders) {
      const excessAmount = builder.accountBalance - builder.creditLimit
      alerts.push({
        type: 'OVER_CREDIT_LIMIT',
        severity: excessAmount > builder.creditLimit * 0.5 ? 'HIGH' : 'MEDIUM',
        builderId: builder.id,
        companyName: builder.companyName,
        details: `Over credit limit by $${excessAmount.toFixed(2)} (Balance: $${builder.accountBalance.toFixed(2)}, Limit: $${builder.creditLimit.toFixed(2)})`,
        amount: excessAmount,
      })
    }

    // 2. Check for builders with overdue invoices
    const overdueInvoiceBuilders = await prisma.$queryRawUnsafe<
      Array<{
        builderId: string
        companyName: string
        overdueAmount: number
        overdueCount: number
      }>
    >(
      `
      SELECT b."id" AS "builderId", b."companyName",
             COALESCE(SUM(i."balanceDue"), 0) AS "overdueAmount",
             COUNT(i."id")::int AS "overdueCount"
      FROM "Builder" b
      JOIN "Invoice" i ON i."builderId" = b."id"
      WHERE i."status" = 'OVERDUE'
        AND b."status" = 'ACTIVE'
      GROUP BY b."id", b."companyName"
      ORDER BY "overdueAmount" DESC
      `
    )

    for (const builder of overdueInvoiceBuilders) {
      const severity =
        builder.overdueCount > 5 ? 'HIGH' : builder.overdueCount > 2 ? 'MEDIUM' : 'LOW'
      alerts.push({
        type: 'OVERDUE_INVOICES',
        severity,
        builderId: builder.builderId,
        companyName: builder.companyName,
        details: `${builder.overdueCount} overdue invoice(s) totaling $${builder.overdueAmount.toFixed(2)}`,
        amount: builder.overdueAmount,
      })
    }

    // 3. Check for builders with high outstanding balances
    const highBalanceBuilders = await prisma.$queryRawUnsafe<
      Array<{
        builderId: string
        companyName: string
        creditLimit: number
        outstandingBalance: number
        utilizationPercent: number
      }>
    >(
      `
      SELECT b."id" AS "builderId", b."companyName",
             COALESCE(b."creditLimit", 0) AS "creditLimit",
             COALESCE(SUM(i."balanceDue"), 0) AS "outstandingBalance",
             CASE
               WHEN COALESCE(b."creditLimit", 0) = 0 THEN 0
               ELSE ROUND(
                 (COALESCE(SUM(i."balanceDue"), 0)::numeric / COALESCE(b."creditLimit", 1)::numeric) * 100
               )
             END AS "utilizationPercent"
      FROM "Builder" b
      LEFT JOIN "Invoice" i ON i."builderId" = b."id"
        AND i."status" NOT IN ('PAID', 'VOID', 'WRITE_OFF')
      WHERE b."status" = 'ACTIVE'
      GROUP BY b."id", b."companyName", b."creditLimit"
      HAVING COALESCE(SUM(i."balanceDue"), 0) > 0
        AND COALESCE(b."creditLimit", 0) > 0
        AND (COALESCE(SUM(i."balanceDue"), 0)::numeric / COALESCE(b."creditLimit", 1)::numeric) >= 0.75
      ORDER BY "utilizationPercent" DESC
      `
    )

    for (const builder of highBalanceBuilders) {
      // Skip if already alerted for over credit limit
      const alreadyAlerted = alerts.some(
        (a) => a.builderId === builder.builderId && a.type === 'OVER_CREDIT_LIMIT'
      )
      if (alreadyAlerted) continue

      const severity =
        builder.utilizationPercent >= 95
          ? 'HIGH'
          : builder.utilizationPercent >= 85
            ? 'MEDIUM'
            : 'LOW'

      alerts.push({
        type: 'HIGH_BALANCE',
        severity,
        builderId: builder.builderId,
        companyName: builder.companyName,
        details: `Outstanding balance of $${builder.outstandingBalance.toFixed(2)} (${builder.utilizationPercent}% of credit limit)`,
        amount: builder.outstandingBalance,
      })
    }

    // Calculate summary
    const summary: AlertSummary = {
      total: alerts.length,
      high: alerts.filter((a) => a.severity === 'HIGH').length,
      medium: alerts.filter((a) => a.severity === 'MEDIUM').length,
      low: alerts.filter((a) => a.severity === 'LOW').length,
    }

    return NextResponse.json({
      alerts: alerts.sort((a, b) => {
        // Sort by severity (HIGH > MEDIUM > LOW), then by amount descending
        const severityOrder: Record<Severity, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 }
        if (severityOrder[a.severity] !== severityOrder[b.severity]) {
          return severityOrder[a.severity] - severityOrder[b.severity]
        }
        return b.amount - a.amount
      }),
      summary,
    } as CreditAlertsResponse)
  } catch (error: any) {
    console.error('Error fetching credit alerts:', error)
    return NextResponse.json({ error: 'Failed to load credit alerts' }, { status: 500 })
  }
}
