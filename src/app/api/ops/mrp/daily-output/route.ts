export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'
import { prisma } from '@/lib/prisma'

/**
 * GET /api/ops/mrp/daily-output
 *
 * Daily output dashboard data:
 *   - Units produced yesterday (sum of OrderItem.quantity for Orders whose
 *     status landed in READY_TO_SHIP/SHIPPED/DELIVERED/COMPLETE yesterday)
 *   - 7-day rolling average
 *   - On-time completion rate (Orders completed whose deliveryDate was met)
 *   - PM-level productivity: jobs completed per PM in the last 7 days
 *
 * All derived via updatedAt proxy — not precise but sufficient until we wire
 * a status-change audit log. Acceptable for the floor dashboard today.
 */
export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const now = new Date()
    const startOfToday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
    const startOfYesterday = new Date(startOfToday.getTime() - 24 * 60 * 60 * 1000)
    const sevenDaysAgo = new Date(startOfToday.getTime() - 7 * 24 * 60 * 60 * 1000)
    const fourteenDaysAgo = new Date(startOfToday.getTime() - 14 * 24 * 60 * 60 * 1000)

    // Orders that reached a terminal-ish status recently
    const completedStatuses: any[] = ['READY_TO_SHIP', 'SHIPPED', 'DELIVERED', 'COMPLETE']

    const recentCompletions = await prisma.order.findMany({
      where: {
        status: { in: completedStatuses },
        updatedAt: { gte: fourteenDaysAgo },
      },
      select: {
        id: true,
        orderNumber: true,
        updatedAt: true,
        deliveryDate: true,
        status: true,
        items: { select: { quantity: true } },
      },
    })

    // Bucket by day
    const dayBuckets = new Map<string, { orders: number; units: number; onTime: number; late: number }>()
    for (let i = 0; i < 14; i++) {
      const d = new Date(startOfToday.getTime() - i * 24 * 60 * 60 * 1000)
      const k = d.toISOString().slice(0, 10)
      dayBuckets.set(k, { orders: 0, units: 0, onTime: 0, late: 0 })
    }

    for (const o of recentCompletions) {
      const k = o.updatedAt.toISOString().slice(0, 10)
      const b = dayBuckets.get(k)
      if (!b) continue
      b.orders += 1
      b.units += o.items.reduce((s, it) => s + it.quantity, 0)
      if (o.deliveryDate) {
        if (o.updatedAt <= o.deliveryDate) b.onTime += 1
        else b.late += 1
      }
    }

    const yesterdayKey = startOfYesterday.toISOString().slice(0, 10)
    const yesterday = dayBuckets.get(yesterdayKey) || { orders: 0, units: 0, onTime: 0, late: 0 }

    // 7-day rolling avg (yesterday + 6 prior days)
    const last7 = Array.from(dayBuckets.entries())
      .filter(([k]) => k < startOfToday.toISOString().slice(0, 10) && k >= sevenDaysAgo.toISOString().slice(0, 10))
      .map(([, v]) => v)
    const avg7Units = last7.length ? last7.reduce((s, b) => s + b.units, 0) / last7.length : 0
    const avg7Orders = last7.length ? last7.reduce((s, b) => s + b.orders, 0) / last7.length : 0
    const totalOnTime7 = last7.reduce((s, b) => s + b.onTime, 0)
    const totalLate7 = last7.reduce((s, b) => s + b.late, 0)
    const onTimeRate = totalOnTime7 + totalLate7 > 0 ? totalOnTime7 / (totalOnTime7 + totalLate7) : null

    // 14-day spark
    const spark = Array.from(dayBuckets.entries())
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([date, v]) => ({ date, units: v.units, orders: v.orders }))

    // PM-level productivity (last 7 days of COMPLETE/CLOSED jobs)
    const pmJobs = await prisma.job.findMany({
      where: {
        status: { in: ['COMPLETE', 'CLOSED', 'INVOICED'] },
        updatedAt: { gte: sevenDaysAgo },
        assignedPMId: { not: null },
      },
      select: {
        id: true,
        jobNumber: true,
        status: true,
        assignedPM: { select: { id: true, firstName: true, lastName: true } },
      },
    })

    const pmMap = new Map<string, { pmId: string; pmName: string; completed: number }>()
    for (const j of pmJobs) {
      if (!j.assignedPM) continue
      const k = j.assignedPM.id
      const row = pmMap.get(k) || {
        pmId: k,
        pmName: `${j.assignedPM.firstName} ${j.assignedPM.lastName}`.trim(),
        completed: 0,
      }
      row.completed += 1
      pmMap.set(k, row)
    }
    const pmProductivity = Array.from(pmMap.values()).sort((a, b) => b.completed - a.completed)

    return NextResponse.json({
      asOf: now.toISOString(),
      yesterday: {
        date: yesterdayKey,
        orders: yesterday.orders,
        units: yesterday.units,
        onTime: yesterday.onTime,
        late: yesterday.late,
      },
      rolling7: {
        avgOrdersPerDay: Math.round(avg7Orders * 10) / 10,
        avgUnitsPerDay: Math.round(avg7Units * 10) / 10,
        onTimeRate, // 0..1 or null
      },
      spark,
      pmProductivity,
    })
  } catch (err: any) {
    console.error('[mrp daily-output] error', err)
    return NextResponse.json({ error: err?.message || 'Failed' }, { status: 500 })
  }
}
