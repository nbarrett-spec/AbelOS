export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'
import { prisma } from '@/lib/prisma'

// ──────────────────────────────────────────────────────────────────────────
// GET /api/ops/finance/ap-forecast
//
// 90-day forward cash-out forecast based on open PO expected dates.
// Returns a daily series + weekly aggregates + per-vendor forecast.
//
// When vendor has no historical payment-term data we fall back to
// "pay on receipt" (expected date). Future: layer in vendor.paymentTermsDays
// once that column is wired.
// ──────────────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const now = new Date()
    now.setHours(0, 0, 0, 0)
    const horizon = new Date(now)
    horizon.setDate(horizon.getDate() + 90)

    const pos = await prisma.purchaseOrder.findMany({
      where: {
        status: { in: ['APPROVED', 'SENT_TO_VENDOR', 'PARTIALLY_RECEIVED', 'RECEIVED'] },
      },
      select: {
        id: true, poNumber: true, total: true, expectedDate: true, receivedAt: true,
        vendor: { select: { id: true, name: true } },
      },
    })

    // Day buckets: key = YYYY-MM-DD
    const daily: Record<string, { date: string; amount: number; count: number }> = {}
    const vendorForecast: Record<string, { vendorId: string; vendorName: string; amount: number; count: number }> = {}

    // Build 90 day skeleton
    for (let i = 0; i <= 90; i++) {
      const d = new Date(now)
      d.setDate(d.getDate() + i)
      const key = d.toISOString().slice(0, 10)
      daily[key] = { date: key, amount: 0, count: 0 }
    }

    let overdueAmount = 0
    let overdueCount = 0
    let pastWindowAmount = 0

    for (const po of pos) {
      const exp = po.expectedDate
      const total = Number(po.total)
      const vid = po.vendor.id
      if (!vendorForecast[vid]) {
        vendorForecast[vid] = { vendorId: vid, vendorName: po.vendor.name, amount: 0, count: 0 }
      }

      if (!exp) {
        // No expected date — assume 30 days out
        const assumed = new Date(now)
        assumed.setDate(assumed.getDate() + 30)
        const key = assumed.toISOString().slice(0, 10)
        if (daily[key]) {
          daily[key].amount += total
          daily[key].count++
        }
        vendorForecast[vid].amount += total
        vendorForecast[vid].count++
        continue
      }

      if (exp < now) {
        overdueAmount += total
        overdueCount++
        continue
      }
      if (exp > horizon) {
        pastWindowAmount += total
        continue
      }
      const key = exp.toISOString().slice(0, 10)
      if (daily[key]) {
        daily[key].amount += total
        daily[key].count++
      }
      vendorForecast[vid].amount += total
      vendorForecast[vid].count++
    }

    const series = Object.values(daily)

    // Weekly aggregates
    const weekly: Array<{ weekStart: string; amount: number; count: number }> = []
    for (let i = 0; i < 13; i++) {
      const start = new Date(now)
      start.setDate(start.getDate() + i * 7)
      const end = new Date(start)
      end.setDate(end.getDate() + 7)
      const sum = series
        .filter(s => s.date >= start.toISOString().slice(0, 10) && s.date < end.toISOString().slice(0, 10))
        .reduce((a, b) => ({ amount: a.amount + b.amount, count: a.count + b.count }), { amount: 0, count: 0 })
      weekly.push({ weekStart: start.toISOString().slice(0, 10), amount: sum.amount, count: sum.count })
    }

    // Cumulative series for line chart
    let running = 0
    const cumulative = series.map(d => {
      running += d.amount
      return { date: d.date, cumAmount: running, daily: d.amount }
    })

    const grand = series.reduce((s, d) => s + d.amount, 0)
    const vendorList = Object.values(vendorForecast).sort((a, b) => b.amount - a.amount)

    return NextResponse.json({
      asOf: now.toISOString(),
      horizonDate: horizon.toISOString(),
      overdue: { amount: overdueAmount, count: overdueCount },
      pastWindow: pastWindowAmount,
      grandTotal: grand,
      daily: series,
      weekly,
      cumulative,
      vendors: vendorList,
    })
  } catch (err: any) {
    console.error('[ap-forecast]', err)
    return NextResponse.json({ error: err?.message || 'failed' }, { status: 500 })
  }
}
