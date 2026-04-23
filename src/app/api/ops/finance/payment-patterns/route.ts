export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'
import { prisma } from '@/lib/prisma'

// ──────────────────────────────────────────────────────────────────────────
// GET /api/ops/finance/payment-patterns
//
// Per-builder payment behavior:
//   - avgDaysToPay  (receivedAt - issuedAt)
//   - avgDaysLate   (receivedAt - dueDate)
//   - termCompliance = % of historical payments made on/before dueDate
//   - grade A..F    based on avgDaysLate & termCompliance
//   - sampleSize
//   - currentOutstanding
//   - contractedTerm
// ──────────────────────────────────────────────────────────────────────────

const TERM_DAYS: Record<string, number> = {
  PAY_AT_ORDER: 0,
  PAY_ON_DELIVERY: 0,
  NET_15: 15,
  NET_30: 30,
}

function gradeFor(avgLate: number, compliance: number): 'A' | 'B' | 'C' | 'D' | 'F' {
  if (compliance >= 0.95 && avgLate <= 0) return 'A'
  if (compliance >= 0.85 && avgLate <= 5) return 'B'
  if (compliance >= 0.70 && avgLate <= 15) return 'C'
  if (compliance >= 0.50 && avgLate <= 30) return 'D'
  return 'F'
}

export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    // Historical payments joined to invoices
    const rows: Array<{ builderId: string; issuedAt: Date | null; dueDate: Date | null; receivedAt: Date; amount: number }> = await prisma.$queryRawUnsafe(`
      SELECT i."builderId" AS "builderId",
             i."issuedAt" AS "issuedAt",
             i."dueDate"  AS "dueDate",
             p."receivedAt" AS "receivedAt",
             p.amount::float AS amount
      FROM "Payment" p
      JOIN "Invoice" i ON i."id" = p."invoiceId"
      WHERE p."receivedAt" IS NOT NULL
    `)

    // Aggregate per builder
    const agg: Record<string, {
      daysToPay: number[]
      daysLate: number[]
      onTime: number
      total: number
      paidAmount: number
    }> = {}
    for (const r of rows) {
      const bid = r.builderId
      if (!agg[bid]) agg[bid] = { daysToPay: [], daysLate: [], onTime: 0, total: 0, paidAmount: 0 }
      const a = agg[bid]
      const dtp = r.issuedAt ? (r.receivedAt.getTime() - r.issuedAt.getTime()) / 86400000 : null
      const dlate = r.dueDate ? (r.receivedAt.getTime() - r.dueDate.getTime()) / 86400000 : null
      if (dtp !== null && Number.isFinite(dtp)) a.daysToPay.push(dtp)
      if (dlate !== null && Number.isFinite(dlate)) {
        a.daysLate.push(dlate)
        if (dlate <= 0) a.onTime++
      }
      a.total++
      a.paidAmount += Number(r.amount)
    }

    // Builder lookup
    const builderIds = Object.keys(agg)
    const builders = builderIds.length === 0 ? [] : await prisma.builder.findMany({
      where: { id: { in: builderIds } },
      select: { id: true, companyName: true, paymentTerm: true, creditLimit: true },
    })
    const bMap = new Map(builders.map(b => [b.id, b]))

    // Current outstanding per builder
    const openRows: Array<{ builderId: string; outstanding: number; count: number }> = await prisma.$queryRawUnsafe(`
      SELECT "builderId",
             COALESCE(SUM(total - "amountPaid"), 0)::float as outstanding,
             COUNT(*)::int as count
      FROM "Invoice"
      WHERE status::text NOT IN ('PAID','VOID','WRITE_OFF')
        AND (total - COALESCE("amountPaid",0)) > 0
      GROUP BY "builderId"
    `)
    const openMap = new Map(openRows.map(r => [r.builderId, r]))

    const avg = (arr: number[]) => arr.length === 0 ? 0 : arr.reduce((a, b) => a + b, 0) / arr.length

    const patterns = builderIds.map(bid => {
      const a = agg[bid]
      const b = bMap.get(bid)
      const o = openMap.get(bid)
      const avgDaysToPay = Math.round(avg(a.daysToPay))
      const avgDaysLate = Math.round(avg(a.daysLate))
      const compliance = a.total > 0 ? a.onTime / a.total : 1
      const grade = gradeFor(avgDaysLate, compliance)
      return {
        builderId: bid,
        builderName: b?.companyName ?? 'Unknown',
        paymentTerm: b?.paymentTerm ?? null,
        contractedTermDays: TERM_DAYS[b?.paymentTerm ?? 'NET_15'] ?? 15,
        avgDaysToPay,
        avgDaysLate,
        termCompliance: Math.round(compliance * 100),
        grade,
        sampleSize: a.total,
        paidAmount: a.paidAmount,
        currentOutstanding: o?.outstanding ?? 0,
        openInvoiceCount: o?.count ?? 0,
        creditLimit: b?.creditLimit ?? null,
      }
    }).sort((a, b) => {
      // Worst behavior first: F, D, C, B, A — within grade, by outstanding
      const gOrder = { F: 0, D: 1, C: 2, B: 3, A: 4 }
      const ga = gOrder[a.grade]
      const gb = gOrder[b.grade]
      if (ga !== gb) return ga - gb
      return b.currentOutstanding - a.currentOutstanding
    })

    // Also return builders with no payment history but open invoices (pending grade)
    const unknownIds: string[] = []
    for (const [bid] of openMap) {
      if (!agg[bid]) unknownIds.push(bid)
    }
    const unknownBuilders = unknownIds.length === 0 ? [] : await prisma.builder.findMany({
      where: { id: { in: unknownIds } },
      select: { id: true, companyName: true, paymentTerm: true },
    })
    const unknownList = unknownBuilders.map(b => {
      const o = openMap.get(b.id)
      return {
        builderId: b.id,
        builderName: b.companyName,
        paymentTerm: b.paymentTerm,
        contractedTermDays: TERM_DAYS[b.paymentTerm] ?? 15,
        avgDaysToPay: null,
        avgDaysLate: null,
        termCompliance: null,
        grade: '—' as const,
        sampleSize: 0,
        paidAmount: 0,
        currentOutstanding: o?.outstanding ?? 0,
        openInvoiceCount: o?.count ?? 0,
        creditLimit: null,
      }
    })

    return NextResponse.json({
      asOf: new Date().toISOString(),
      patterns,
      pendingGrade: unknownList,
    })
  } catch (err: any) {
    console.error('[payment-patterns]', err)
    return NextResponse.json({ error: err?.message || 'failed' }, { status: 500 })
  }
}
