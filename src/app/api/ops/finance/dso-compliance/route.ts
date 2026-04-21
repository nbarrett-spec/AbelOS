export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'
import { prisma } from '@/lib/prisma'

/**
 * GET /api/ops/finance/dso-compliance
 *
 * Per builder — actual DSO over the last 90 days vs. their contracted
 * payment term. Flags any builder >10 days over contract.
 *
 * Actual DSO for a paid invoice = (paidAt - issuedAt) in days, averaged.
 */
export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)

    const invoices = await prisma.invoice.findMany({
      where: {
        issuedAt: { gte: ninetyDaysAgo },
        paidAt: { not: null },
      },
      select: {
        builderId: true,
        issuedAt: true,
        paidAt: true,
        total: true,
        paymentTerm: true,
      },
    })

    const builders = await prisma.builder.findMany({
      select: { id: true, companyName: true, paymentTerm: true },
    })
    const builderMap = new Map(builders.map((b) => [b.id, b]))

    const termDays: Record<string, number> = {
      NET_15: 15,
      NET_30: 30,
      NET_45: 45,
      NET_60: 60,
      NET_90: 90,
      DUE_ON_RECEIPT: 0,
      CASH_ON_DELIVERY: 0,
    }

    const byBuilder = new Map<
      string,
      { days: number[]; total: number; count: number; term: string }
    >()

    for (const inv of invoices) {
      if (!inv.issuedAt || !inv.paidAt) continue
      const d = (inv.paidAt.getTime() - inv.issuedAt.getTime()) / (24 * 60 * 60 * 1000)
      const row = byBuilder.get(inv.builderId) || {
        days: [],
        total: 0,
        count: 0,
        term: inv.paymentTerm,
      }
      row.days.push(d)
      row.total += inv.total
      row.count += 1
      byBuilder.set(inv.builderId, row)
    }

    const rows = Array.from(byBuilder.entries()).map(([builderId, r]) => {
      const builder = builderMap.get(builderId)
      const avgDso = r.days.reduce((s, d) => s + d, 0) / r.days.length
      const contractTerm = builder?.paymentTerm || r.term || 'NET_30'
      const contractDays = termDays[contractTerm] ?? 30
      const delta = avgDso - contractDays
      return {
        builderId,
        builderName: builder?.companyName || '—',
        avgDso: Math.round(avgDso * 10) / 10,
        contractTerm,
        contractDays,
        deltaDays: Math.round(delta * 10) / 10,
        flagged: delta > 10,
        invoiceCount: r.count,
        totalRevenue: Math.round(r.total * 100) / 100,
      }
    })

    rows.sort((a, b) => b.deltaDays - a.deltaDays)

    return NextResponse.json({
      asOf: new Date().toISOString(),
      windowDays: 90,
      rows,
      flaggedCount: rows.filter((r) => r.flagged).length,
    })
  } catch (err: any) {
    console.error('[finance dso-compliance] error', err)
    return NextResponse.json({ error: err?.message || 'failed' }, { status: 500 })
  }
}
