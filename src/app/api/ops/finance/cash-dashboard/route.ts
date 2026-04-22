export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'
import { prisma } from '@/lib/prisma'

/**
 * GET /api/ops/finance/cash-dashboard
 *
 * Returns cash-in (paid invoices last 30d), cash-out (POs received/paid
 * last 30d — we proxy with received POs), net position, and a 90-day
 * forecast that walks Invoice.dueDate and PurchaseOrder.expectedDate.
 */
export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const now = new Date()
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
    const ninetyDaysOut = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000)

    const [paymentsLast30, posLast30, openAR, openAP] = await Promise.all([
      prisma.$queryRawUnsafe<any[]>(`
        SELECT amount::float, "receivedAt" FROM "Payment" WHERE "receivedAt" >= $1
      `, thirtyDaysAgo),
      prisma.$queryRawUnsafe<any[]>(`
        SELECT total::float, "receivedAt" FROM "PurchaseOrder"
        WHERE status::text IN ('RECEIVED', 'PARTIALLY_RECEIVED') AND "receivedAt" >= $1
      `, thirtyDaysAgo),
      prisma.$queryRawUnsafe<any[]>(`
        SELECT (i."total" - COALESCE(i."amountPaid", 0))::float AS "balanceDue", i."dueDate", i."status"::text AS status
        FROM "Invoice" i
        WHERE i."status"::text IN ('ISSUED', 'SENT', 'PARTIALLY_PAID', 'OVERDUE')
        AND (i."dueDate" IS NULL OR i."dueDate" <= $1)
        AND (i."total" - COALESCE(i."amountPaid", 0)) > 0
      `, ninetyDaysOut),
      prisma.$queryRawUnsafe<any[]>(`
        SELECT total::float, "expectedDate", status::text AS status FROM "PurchaseOrder"
        WHERE status::text IN ('APPROVED', 'SENT_TO_VENDOR', 'PARTIALLY_RECEIVED')
        AND ("expectedDate" IS NULL OR ("expectedDate" <= $1 AND "expectedDate" >= $2))
      `, ninetyDaysOut, now),
    ])

    const cashIn30 = paymentsLast30.reduce((s, p) => s + p.amount, 0)
    const cashOut30 = posLast30.reduce((s, p) => s + p.total, 0)
    const net30 = cashIn30 - cashOut30

    // 90-day forecast — bucket by week
    const weeks = 13
    const buckets = Array.from({ length: weeks }, (_, i) => ({
      weekIndex: i,
      weekStart: new Date(now.getTime() + i * 7 * 24 * 60 * 60 * 1000),
      cashIn: 0,
      cashOut: 0,
      net: 0,
      cumNet: 0,
    }))

    const weekIndexFor = (date: Date | null): number => {
      if (!date) return -1
      const diff = date.getTime() - now.getTime()
      if (diff < 0) return 0
      const w = Math.floor(diff / (7 * 24 * 60 * 60 * 1000))
      return Math.min(weeks - 1, w)
    }

    for (const inv of openAR) {
      const wi = weekIndexFor(inv.dueDate)
      if (wi >= 0) buckets[wi].cashIn += inv.balanceDue
    }
    for (const po of openAP) {
      const wi = weekIndexFor(po.expectedDate)
      if (wi >= 0) buckets[wi].cashOut += po.total
    }
    let cum = 0
    for (const b of buckets) {
      b.net = b.cashIn - b.cashOut
      cum += b.net
      b.cumNet = cum
    }

    return NextResponse.json({
      asOf: now.toISOString(),
      trailing30: {
        cashIn: Math.round(cashIn30 * 100) / 100,
        cashOut: Math.round(cashOut30 * 100) / 100,
        net: Math.round(net30 * 100) / 100,
        paymentCount: paymentsLast30.length,
        poReceivedCount: posLast30.length,
      },
      openTotals: {
        openAR: Math.round(openAR.reduce((s, i) => s + i.balanceDue, 0) * 100) / 100,
        openAP: Math.round(openAP.reduce((s, p) => s + p.total, 0) * 100) / 100,
        arCount: openAR.length,
        apCount: openAP.length,
      },
      forecast: buckets.map((b) => ({
        weekStart: b.weekStart.toISOString().slice(0, 10),
        cashIn: Math.round(b.cashIn * 100) / 100,
        cashOut: Math.round(b.cashOut * 100) / 100,
        net: Math.round(b.net * 100) / 100,
        cumNet: Math.round(b.cumNet * 100) / 100,
      })),
    })
  } catch (err: any) {
    console.error('[finance cash-dashboard] error', err)
    return NextResponse.json({ error: err?.message || 'failed' }, { status: 500 })
  }
}
