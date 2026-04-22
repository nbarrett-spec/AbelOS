export const dynamic = 'force-dynamic'
import { prisma } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'
import { safeJson } from '@/lib/safe-json'

// ──────────────────────────────────────────────────────────────────
// ACCOUNTING MORNING BRIEFING — Financial overview and priorities
// ──────────────────────────────────────────────────────────────────

// Invoice statuses considered "unpaid / open"
const UNPAID_STATUSES = `('DRAFT', 'ISSUED', 'SENT', 'PARTIALLY_PAID', 'OVERDUE')`

export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const now = new Date()
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString().split('T')[0]
    const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).toISOString().split('T')[0]
    const sevenDaysFromNow = new Date(now.getTime() + 7 * 86400000).toISOString().split('T')[0]

    // ── 1. Invoices to Send (completed/delivered jobs not yet invoiced) ──
    const invoicesToSend: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        j."id",
        j."jobNumber",
        j."builderName",
        o."total" AS "orderTotal",
        j."completedAt" AS "completedDate",
        j."status"::text AS status
      FROM "Job" j
      LEFT JOIN "Order" o ON j."orderId" = o."id"
      WHERE j."status"::text IN ('DELIVERED', 'PUNCH_LIST', 'COMPLETE')
        AND NOT EXISTS (SELECT 1 FROM "Invoice" i WHERE i."jobId" = j."id")
      ORDER BY j."completedAt" ASC NULLS LAST
      LIMIT 20
    `)

    // ── 2. Payments Received Today ──
    const paymentsReceived: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        p."id",
        i."invoiceNumber",
        b."companyName" AS "builderName",
        p."amount",
        p."method"::text AS "paymentMethod",
        p."receivedAt"
      FROM "Payment" p
      JOIN "Invoice" i ON p."invoiceId" = i."id"
      LEFT JOIN "Builder" b ON i."builderId" = b."id"
      WHERE p."receivedAt" >= $1::date
        AND p."receivedAt" < $2::date
      ORDER BY p."receivedAt" DESC
    `, todayStart, todayEnd)

    // ── 3. Collections Follow-Ups Due ──
    const collectionsFollowUps: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        i."id",
        i."invoiceNumber",
        b."companyName" AS "builderName",
        (i."total" - COALESCE(i."amountPaid",0))::float AS amount,
        EXTRACT(DAY FROM NOW() - i."dueDate")::int AS "daysOverdue",
        CASE
          WHEN EXTRACT(DAY FROM NOW() - i."dueDate") > 10 THEN 3
          WHEN EXTRACT(DAY FROM NOW() - i."dueDate") > 5 THEN 2
          ELSE 1
        END AS "escalationLevel"
      FROM "Invoice" i
      LEFT JOIN "Builder" b ON i."builderId" = b."id"
      WHERE i."status"::text IN ${UNPAID_STATUSES}
        AND i."dueDate" IS NOT NULL
        AND i."dueDate" < CURRENT_DATE
      ORDER BY i."dueDate" ASC
      LIMIT 15
    `)

    // ── 4. AP Due This Week (using expectedDate) ──
    const apDueThisWeek: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        po."id",
        po."poNumber",
        v."name" AS vendor,
        po."total" AS amount,
        po."expectedDate" AS "dueDate",
        po."status"::text AS status
      FROM "PurchaseOrder" po
      JOIN "Vendor" v ON po."vendorId" = v."id"
      WHERE po."status"::text IN ('APPROVED', 'SENT_TO_VENDOR', 'PARTIALLY_RECEIVED')
        AND po."expectedDate" IS NOT NULL
        AND po."expectedDate" >= CURRENT_DATE
        AND po."expectedDate" < $1::date
      ORDER BY po."expectedDate" ASC
    `, sevenDaysFromNow)

    // ── 5. AR Aging Summary ──
    const arAging: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        CASE
          WHEN i."dueDate" IS NULL OR i."dueDate" >= CURRENT_DATE THEN 'current'
          WHEN EXTRACT(DAY FROM CURRENT_DATE - i."dueDate") < 30 THEN 'days30'
          WHEN EXTRACT(DAY FROM CURRENT_DATE - i."dueDate") < 60 THEN 'days60'
          ELSE 'days90plus'
        END AS bucket,
        COUNT(*)::int AS count,
        SUM(i."total" - COALESCE(i."amountPaid",0))::float AS total
      FROM "Invoice" i
      WHERE i."status"::text IN ${UNPAID_STATUSES}
        AND (i."total" - COALESCE(i."amountPaid",0)) > 0
      GROUP BY bucket
    `)

    const arAgingSummary = {
      current: arAging.find((a: any) => a.bucket === 'current')?.total || 0,
      days30: arAging.find((a: any) => a.bucket === 'days30')?.total || 0,
      days60: arAging.find((a: any) => a.bucket === 'days60')?.total || 0,
      days90plus: arAging.find((a: any) => a.bucket === 'days90plus')?.total || 0,
      total: arAging.reduce((sum: number, a: any) => sum + (a.total || 0), 0),
    }

    // ── 6. Recent Activity (last 10 transactions) ──
    const paymentsActivity: any[] = await prisma.$queryRawUnsafe(`
      SELECT * FROM (
        SELECT 'payment'::text AS type, p."id", i."invoiceNumber" AS description, p."amount", p."receivedAt" AS date
        FROM "Payment" p
        JOIN "Invoice" i ON p."invoiceId" = i."id"
        WHERE p."receivedAt" >= $1::timestamp
        UNION ALL
        SELECT 'invoice'::text AS type, i."id", i."invoiceNumber" AS description, i."total" AS amount, i."createdAt" AS date
        FROM "Invoice" i
        WHERE i."createdAt" >= $1::timestamp
      ) activity
      ORDER BY date DESC
      LIMIT 10
    `, new Date(now.getTime() - 7 * 86400000).toISOString())

    // ── 7. Key Metrics ──
    const invoicesToSendCount = invoicesToSend.length
    const paymentsReceivedToday = paymentsReceived.length
    const collectionsFollowUpsDue = collectionsFollowUps.length
    const apDueThisWeekCount = apDueThisWeek.length

    // Total AR and overdue
    const arTotals: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        COUNT(*)::int AS "unpaidCount",
        COALESCE(SUM(i."total" - COALESCE(i."amountPaid",0)), 0)::float AS total,
        COALESCE(SUM(CASE WHEN i."dueDate" < CURRENT_DATE THEN (i."total" - COALESCE(i."amountPaid",0)) ELSE 0 END), 0)::float AS "overdueTotal"
      FROM "Invoice" i
      WHERE i."status"::text IN ${UNPAID_STATUSES}
    `)

    const overdueAR = arTotals[0]?.overdueTotal || 0

    // ── Total AP from outstanding POs ──
    const apTotals: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        COUNT(*)::int AS "poCount",
        COALESCE(SUM(po."total"), 0)::float AS "totalAP"
      FROM "PurchaseOrder" po
      WHERE po."status"::text IN ('SENT_TO_VENDOR', 'APPROVED', 'PARTIALLY_RECEIVED')
    `)

    const totalAP = apTotals[0]?.totalAP || 0

    // ── Bank Balance estimate ──
    const totalPaymentsReceived: any[] = await prisma.$queryRawUnsafe(`
      SELECT COALESCE(SUM(p."amount"), 0)::float AS "totalReceived"
      FROM "Payment" p
    `)

    const cashReceived = totalPaymentsReceived[0]?.totalReceived || 0
    const bankBalance = Math.max(0, cashReceived - totalAP)

    return safeJson({
      date: now.toISOString(),
      summary: {
        invoicesToSend: invoicesToSendCount,
        paymentsReceivedToday,
        collectionsFollowUpsDue,
        apDueThisWeek: apDueThisWeekCount,
        bankBalance,
        totalAP,
        overdueAR,
      },
      invoicesToSend,
      paymentsReceived,
      collectionsFollowUps,
      apDueThisWeek,
      arAgingSummary,
      recentActivity: paymentsActivity,
    })
  } catch (error: any) {
    console.error('Failed to fetch accounting briefing:', error)
    return NextResponse.json(
      { error: 'Failed to fetch accounting briefing' },
      { status: 500 }
    )
  }
}
