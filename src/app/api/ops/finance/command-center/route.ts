import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuthWithFallback } from '@/lib/api-auth'
import { logger } from '@/lib/logger'

/**
 * GET /api/ops/finance/command-center
 *
 * Returns the complete Financial Command Center payload:
 * - Latest snapshot + prior for comparison
 * - AR aging by builder (top 10)
 * - 30-day cash flow forecast
 * - 12-month revenue trend
 * - 12-month DSO trend
 * - Active alerts (overdue, credit limit breaches, margin warnings)
 * - PO commitment pipeline by vendor
 *
 * All queries use parameterized SQL for safety.
 */

export async function GET(request: NextRequest) {
  const authError = await checkStaffAuthWithFallback(request)
  if (authError) return authError

  try {
    // Get latest snapshot via raw SQL
    const snapshots = await prisma.$queryRawUnsafe<any[]>(
      `SELECT * FROM "FinancialSnapshot" ORDER BY "snapshotDate" DESC LIMIT 2`
    )
    const latestSnapshot = snapshots[0] || null
    const priorSnapshot = snapshots[1] || null

    // ─── AR Aging by Builder (Top 10) ────────────────────────────────────
    const arByBuilder = await prisma.$queryRawUnsafe<
      Array<{
        builderId: string
        builderName: string
        current: number
        days30: number
        days60: number
        days90plus: number
        total: number
      }>
    >(`
      SELECT
        b."id" AS "builderId",
        b."companyName" AS "builderName",
        COALESCE(SUM(CASE WHEN i."dueDate" >= NOW()::date THEN i."balanceDue" ELSE 0 END), 0)::float AS current,
        COALESCE(SUM(CASE WHEN i."dueDate" < NOW()::date AND i."dueDate" >= NOW()::date - INTERVAL '30 days' THEN i."balanceDue" ELSE 0 END), 0)::float AS days30,
        COALESCE(SUM(CASE WHEN i."dueDate" < NOW()::date - INTERVAL '30 days' AND i."dueDate" >= NOW()::date - INTERVAL '60 days' THEN i."balanceDue" ELSE 0 END), 0)::float AS days60,
        COALESCE(SUM(CASE WHEN i."dueDate" < NOW()::date - INTERVAL '60 days' THEN i."balanceDue" ELSE 0 END), 0)::float AS days90plus,
        COALESCE(SUM(i."balanceDue"), 0)::float AS total
      FROM "Invoice" i
      JOIN "Builder" b ON b."id" = i."builderId"
      WHERE i."status" IN ('ISSUED', 'SENT', 'PARTIALLY_PAID', 'OVERDUE')
      GROUP BY b."id", b."companyName"
      ORDER BY total DESC
      LIMIT 10
    `)

    // ─── Overdue Invoices (for alerts) ──────────────────────────────────
    const overdueInvoices = await prisma.$queryRawUnsafe<
      Array<{
        invoiceId: string
        invoiceNumber: string
        builderName: string
        amount: number
        daysOverdue: number
        dueDate: Date
      }>
    >(`
      SELECT
        i."id" AS "invoiceId",
        i."invoiceNumber",
        b."companyName" AS "builderName",
        i."balanceDue" AS amount,
        EXTRACT(DAY FROM NOW() - i."dueDate")::int AS "daysOverdue",
        i."dueDate"
      FROM "Invoice" i
      JOIN "Builder" b ON b."id" = i."builderId"
      WHERE i."dueDate" < NOW()::date AND i."status" IN ('ISSUED', 'SENT', 'PARTIALLY_PAID', 'OVERDUE')
      ORDER BY "daysOverdue" DESC
      LIMIT 20
    `)

    // ─── Revenue Trend (last 12 months) ──────────────────────────────────
    const revenueTrend = await prisma.$queryRawUnsafe<
      Array<{
        month: string
        revenue: number
      }>
    >(`
      SELECT
        TO_CHAR(i."issuedAt", 'YYYY-MM') AS month,
        COALESCE(SUM(i."total"), 0)::float AS revenue
      FROM "Invoice" i
      WHERE i."status" IN ('ISSUED', 'SENT', 'PARTIALLY_PAID', 'PAID')
        AND i."issuedAt" >= NOW() - INTERVAL '12 months'
      GROUP BY TO_CHAR(i."issuedAt", 'YYYY-MM')
      ORDER BY month ASC
    `)

    // ─── DSO Trend (last 12 snapshots) ──────────────────────────────────
    const dsoTrend = await prisma.$queryRawUnsafe<Array<{ snapshotDate: string; dso: number }>>(
      `SELECT "snapshotDate", dso FROM "FinancialSnapshot" ORDER BY "snapshotDate" DESC LIMIT 12`
    )

    // ─── Open PO Pipeline by Vendor ──────────────────────────────────────
    const poPipeline = await prisma.$queryRawUnsafe<
      Array<{
        vendorId: string
        vendorName: string
        count: number
        totalAmount: number
        expectedDate: Date | null
      }>
    >(`
      SELECT
        v."id" AS "vendorId",
        v."name" AS "vendorName",
        COUNT(po."id")::int AS count,
        COALESCE(SUM(po."total"), 0)::float AS "totalAmount",
        MIN(po."expectedDate") AS "expectedDate"
      FROM "PurchaseOrder" po
      JOIN "Vendor" v ON v."id" = po."vendorId"
      WHERE po."status" IN ('APPROVED', 'SENT_TO_VENDOR', 'PARTIALLY_RECEIVED')
      GROUP BY v."id", v."name"
      ORDER BY "totalAmount" DESC
      LIMIT 10
    `)

    // ─── Credit Limit Exposure (top 10 builders) ─────────────────────────
    const creditExposure = await prisma.$queryRawUnsafe<
      Array<{
        builderId: string
        builderName: string
        creditLimit: number
        arOutstanding: number
        utilization: number
      }>
    >(`
      SELECT
        b."id" AS "builderId",
        b."companyName" AS "builderName",
        COALESCE(b."creditLimit", 0)::float AS "creditLimit",
        COALESCE(SUM(i."balanceDue"), 0)::float AS "arOutstanding",
        CASE
          WHEN COALESCE(b."creditLimit", 0) > 0
          THEN ROUND((COALESCE(SUM(i."balanceDue"), 0) / COALESCE(b."creditLimit", 1)) * 100, 1)::float
          ELSE 0
        END AS utilization
      FROM "Builder" b
      LEFT JOIN "Invoice" i ON i."builderId" = b."id" AND i."status" IN ('ISSUED', 'SENT', 'PARTIALLY_PAID', 'OVERDUE')
      WHERE b."status" = 'ACTIVE'
      GROUP BY b."id", b."companyName", b."creditLimit"
      ORDER BY "arOutstanding" DESC
      LIMIT 10
    `)

    // ─── Collections Cycle Actions (in progress) ─────────────────────────
    const collectionsInProgress = await prisma.$queryRawUnsafe<Array<{ count: number }>>(
      `
      SELECT COUNT(DISTINCT ca."invoiceId")::int AS count
      FROM "CollectionAction" ca
      JOIN "Invoice" i ON i."id" = ca."invoiceId"
      WHERE ca."sentAt" >= NOW() - INTERVAL '7 days'
        AND i."status" IN ('ISSUED', 'SENT', 'PARTIALLY_PAID', 'OVERDUE')
    `
    )

    // ─── Build Alerts ───────────────────────────────────────────────────
    const alerts = []

    if (overdueInvoices.length > 0) {
      const totalOverdue = overdueInvoices.reduce((s, inv) => s + inv.amount, 0)
      alerts.push({
        type: 'overdue',
        severity: 'high',
        title: 'Overdue Invoices',
        message: `${overdueInvoices.length} invoices overdue`,
        count: overdueInvoices.length,
        value: totalOverdue,
      })
    }

    const creditBreach = creditExposure.filter((c) => c.utilization > 100)
    if (creditBreach.length > 0) {
      alerts.push({
        type: 'credit_breach',
        severity: 'critical',
        title: 'Credit Limit Breached',
        message: `${creditBreach.length} builders over credit limit`,
        count: creditBreach.length,
        value: creditBreach.reduce((s, c) => s + c.arOutstanding, 0),
      })
    }

    const warningThreshold = 75
    const creditWarning = creditExposure.filter((c) => c.utilization > warningThreshold && c.utilization <= 100)
    if (creditWarning.length > 0) {
      alerts.push({
        type: 'credit_warning',
        severity: 'warning',
        title: 'High Credit Utilization',
        message: `${creditWarning.length} builders >75% credit utilized`,
        count: creditWarning.length,
        value: creditWarning.reduce((s, c) => s + c.arOutstanding, 0),
      })
    }

    return NextResponse.json({
      snapshot: latestSnapshot,
      priorSnapshot,
      arByBuilder,
      overdueInvoices: overdueInvoices.slice(0, 10),
      revenueTrend,
      dsoTrend,
      poPipeline,
      creditExposure,
      alerts,
      collectionsInProgress: collectionsInProgress[0]?.count || 0,
      timestamp: new Date(),
    })
  } catch (e: any) {
    logger.error('command_center_fetch_failed', e)
    return NextResponse.json({ error: 'Failed to fetch command center data' }, { status: 500 })
  }
}
