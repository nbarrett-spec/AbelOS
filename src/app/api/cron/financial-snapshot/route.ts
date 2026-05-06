export const dynamic = 'force-dynamic'
import * as Sentry from '@sentry/nextjs'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { withCronRun } from '@/lib/cron'
import { logger } from '@/lib/logger'

/**
 * Financial Snapshot Cron
 * Runs daily at 6am UTC to capture critical financial KPIs
 */

function getCronSecret(): string | null {
  const secret = process.env.CRON_SECRET
  return secret && secret.length > 0 ? secret : null
}

async function calculateFinancialSnapshot() {
  const today = new Date()
  today.setUTCHours(0, 0, 0, 0)

  const ninetyDaysAgo = new Date(today)
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90)

  const thirtyDaysAgo = new Date(today)
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

  try {
    // ─── AR & Aging Analysis ────────────────────────────────────────────
    const arData = await prisma.$queryRawUnsafe<
      Array<{ total: number; current: number; days30: number; days60: number; days90plus: number }>
    >(`
      SELECT
        COALESCE(SUM(i."total" - COALESCE(i."amountPaid", 0)), 0)::float AS total,
        COALESCE(SUM(CASE WHEN i."dueDate" >= $1 THEN i."total" - COALESCE(i."amountPaid", 0) ELSE 0 END), 0)::float AS current,
        COALESCE(SUM(CASE WHEN i."dueDate" < $1 AND i."dueDate" >= $2 THEN i."total" - COALESCE(i."amountPaid", 0) ELSE 0 END), 0)::float AS days30,
        COALESCE(SUM(CASE WHEN i."dueDate" < $2 AND i."dueDate" >= $3 THEN i."total" - COALESCE(i."amountPaid", 0) ELSE 0 END), 0)::float AS days60,
        COALESCE(SUM(CASE WHEN i."dueDate" < $3 THEN i."total" - COALESCE(i."amountPaid", 0) ELSE 0 END), 0)::float AS days90plus
      FROM "Invoice" i
      WHERE i."status"::text IN ('ISSUED', 'SENT', 'PARTIALLY_PAID', 'OVERDUE')
        AND (i."total" - COALESCE(i."amountPaid", 0)) > 0
    `, today, thirtyDaysAgo, ninetyDaysAgo)

    const arTotal = arData[0]?.total || 0
    const arCurrent = arData[0]?.current || 0
    const ar30 = arData[0]?.days30 || 0
    const ar60 = arData[0]?.days60 || 0
    const ar90Plus = arData[0]?.days90plus || 0

    // ─── AP Analysis ────────────────────────────────────────────────────
    const apData = await prisma.$queryRawUnsafe<Array<{ total: number }>>(
      `SELECT COALESCE(SUM(po."total"), 0)::float AS total
       FROM "PurchaseOrder" po WHERE po."status" NOT IN ('RECEIVED', 'CANCELLED')`
    )
    const apTotal = apData[0]?.total || 0

    const cashOnHand = 0 // TODO: Integrate with actual cash account

    // ─── Revenue Calculations ───────────────────────────────────────────
    const currentMonth = new Date(today)
    currentMonth.setDate(1)
    const priorMonth = new Date(currentMonth)
    priorMonth.setMonth(priorMonth.getMonth() - 1)
    const currentYear = new Date(today)
    currentYear.setMonth(0, 1)

    const revenueData = await prisma.$queryRawUnsafe<
      Array<{ thisMonth: number; priorMonth: number; ytd: number }>
    >(
      `SELECT
        COALESCE(SUM(CASE WHEN i."issuedAt" >= $1 THEN i."total" ELSE 0 END), 0)::float AS "thisMonth",
        COALESCE(SUM(CASE WHEN i."issuedAt" >= $2 AND i."issuedAt" < $1 THEN i."total" ELSE 0 END), 0)::float AS "priorMonth",
        COALESCE(SUM(CASE WHEN i."issuedAt" >= $3 THEN i."total" ELSE 0 END), 0)::float AS ytd
      FROM "Invoice" i WHERE i."status" IN ('ISSUED', 'SENT', 'PARTIALLY_PAID', 'PAID')`,
      currentMonth, priorMonth, currentYear
    )

    const revenueMonth = revenueData[0]?.thisMonth || 0
    const revenuePrior = revenueData[0]?.priorMonth || 0
    const revenueYTD = revenueData[0]?.ytd || 0

    // ─── DSO ────────────────────────────────────────────────────────────
    const dailyRevenueAvg = revenueYTD / 90
    const dso = dailyRevenueAvg > 0 ? (arTotal / dailyRevenueAvg) * 90 : 0
    const dpo = 0

    // ─── Current Ratio ──────────────────────────────────────────────────
    const currentRatio = apTotal > 0 ? (arTotal + cashOnHand) / apTotal : 0

    // ─── Open PO Total ──────────────────────────────────────────────────
    const poData = await prisma.$queryRawUnsafe<Array<{ total: number }>>(
      `SELECT COALESCE(SUM(po."total"), 0)::float AS total
       FROM "PurchaseOrder" po WHERE po."status" IN ('APPROVED', 'SENT_TO_VENDOR', 'PARTIALLY_RECEIVED')`
    )
    const openPOTotal = poData[0]?.total || 0

    // ─── Pending Invoices ───────────────────────────────────────────────
    const pendingData = await prisma.$queryRawUnsafe<Array<{ count: number }>>(
      `SELECT COUNT(*)::int AS count FROM "Invoice" i WHERE i."status" IN ('DRAFT', 'ISSUED')`
    )
    const pendingInvoices = pendingData[0]?.count || 0

    // ─── Overdue AR % ───────────────────────────────────────────────────
    const overdueARPct = arTotal > 0 ? ((ar90Plus + ar60) / arTotal) * 100 : 0

    // ─── Top 5 Exposures ────────────────────────────────────────────────
    const topExposures = await prisma.$queryRawUnsafe<
      Array<{ builderId: string; builderName: string; balance: number }>
    >(`
      SELECT b."id" AS "builderId", b."companyName" AS "builderName",
             COALESCE(SUM(i."total" - COALESCE(i."amountPaid", 0)), 0)::float AS balance
      FROM "Invoice" i JOIN "Builder" b ON b."id" = i."builderId"
      WHERE i."status"::text IN ('ISSUED', 'SENT', 'PARTIALLY_PAID', 'OVERDUE')
        AND (i."total" - COALESCE(i."amountPaid", 0)) > 0
      GROUP BY b."id", b."companyName" ORDER BY balance DESC LIMIT 5
    `)

    const netCashPosition = (cashOnHand + arTotal) - apTotal

    // ─── Store Snapshot via raw SQL ─────────────────────────────────────
    const snapshotId = `fs_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

    await prisma.$executeRawUnsafe(
      `INSERT INTO "FinancialSnapshot" (
        id, "snapshotDate", "cashOnHand", "arTotal", "apTotal", "netCashPosition",
        "arCurrent", "ar30", "ar60", "ar90Plus", dso, dpo, "currentRatio",
        "revenueMonth", "revenuePrior", "revenueYTD", "openPOTotal",
        "pendingInvoices", "overdueARPct", "topExposure", "createdAt"
      ) VALUES ($1, $2::timestamp, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20::jsonb, NOW())`,
      snapshotId, today.toISOString(), cashOnHand, arTotal, apTotal, netCashPosition,
      arCurrent, ar30, ar60, ar90Plus, dso, dpo, currentRatio,
      revenueMonth, revenuePrior, revenueYTD, openPOTotal,
      pendingInvoices, overdueARPct, JSON.stringify(topExposures)
    )

    return {
      snapshotId,
      arTotal,
      apTotal,
      netCashPosition,
      dso: Math.round(dso * 10) / 10,
      revenueMonth,
      openPOTotal,
      overdueARPct: Math.round(overdueARPct * 10) / 10,
    }
  } catch (e: any) {
    logger.error('financial_snapshot_calc_failed', e)
    Sentry.captureException(e, { tags: { route: '/api/cron/financial-snapshot', cron: 'financial-snapshot' } })
    throw e
  }
}

export async function GET(request: NextRequest) {
  const expected = getCronSecret()
  if (!expected) {
    return new Response('Not configured', { status: 500 })
  }
  const secret = request.headers.get('authorization')?.split('Bearer ')[1]
  if (secret !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  return withCronRun('financial-snapshot', async () => {
    const result = await calculateFinancialSnapshot()
    return NextResponse.json(result)
  })
}
