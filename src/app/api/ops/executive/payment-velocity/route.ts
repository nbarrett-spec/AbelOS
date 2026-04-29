export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { requireStaffAuth } from '@/lib/api-auth'
import { prisma } from '@/lib/prisma'

// ──────────────────────────────────────────────────────────────────────────
// GET /api/ops/executive/payment-velocity
//
// Weekly payment velocity for the Executive Financial Dashboard.
//
// - Aggregates Payment.amount by week (Monday-anchored via DATE_TRUNC) for
//   the last 8 weeks.
// - Returns this week's total, the trailing 4-week average (weeks -4..-1,
//   excluding the current week), the trend % delta vs that average, and a
//   sparkline-ready array of weekly totals (oldest → newest).
//
// Roles: ADMIN, MANAGER, ACCOUNTING. Read-only.
// ──────────────────────────────────────────────────────────────────────────

interface WeekRow {
  week_start: Date
  total: number
}

interface WeekOut {
  weekStart: string
  total: number
}

export async function GET(request: NextRequest) {
  const auth = await requireStaffAuth(request, {
    allowedRoles: ['ADMIN', 'MANAGER', 'ACCOUNTING'],
  })
  if (auth.error) return auth.error

  try {
    // Pull weekly totals for the last 8 weeks, oldest → newest.
    const rows = await prisma.$queryRawUnsafe<WeekRow[]>(
      `SELECT
         DATE_TRUNC('week', "receivedAt")::date AS week_start,
         SUM("amount")::float AS total
       FROM "Payment"
       WHERE "receivedAt" >= NOW() - INTERVAL '8 weeks'
       GROUP BY week_start
       ORDER BY week_start ASC`
    )

    // Build a dense 8-week series anchored to current week start so the
    // sparkline doesn't skip empty weeks. DATE_TRUNC('week', ..) is
    // Monday-anchored in Postgres.
    const now = new Date()
    const day = now.getUTCDay() // 0=Sun..6=Sat
    const mondayOffset = day === 0 ? -6 : 1 - day
    const currentWeekStart = new Date(Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate() + mondayOffset,
    ))
    currentWeekStart.setUTCHours(0, 0, 0, 0)

    const totalByKey = new Map<string, number>()
    for (const r of rows) {
      const k = new Date(r.week_start).toISOString().slice(0, 10)
      totalByKey.set(k, Number(r.total) || 0)
    }

    const weeks: WeekOut[] = []
    for (let i = 7; i >= 0; i--) {
      const d = new Date(currentWeekStart)
      d.setUTCDate(currentWeekStart.getUTCDate() - i * 7)
      const key = d.toISOString().slice(0, 10)
      weeks.push({ weekStart: key, total: totalByKey.get(key) ?? 0 })
    }

    const current = weeks[weeks.length - 1].total
    const trailing = weeks.slice(-5, -1) // weeks -4..-1, excluding current
    const trailingAvg = trailing.length
      ? trailing.reduce((s, w) => s + w.total, 0) / trailing.length
      : 0

    const trendPct = trailingAvg > 0
      ? ((current - trailingAvg) / trailingAvg) * 100
      : current > 0 ? 100 : 0

    const sparklineData = weeks.map((w) => w.total)

    return NextResponse.json(
      {
        weeks,
        current,
        trailingAvg: Math.round(trailingAvg * 100) / 100,
        trendPct: Math.round(trendPct * 10) / 10,
        sparklineData,
      },
      { headers: { 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    console.error('Payment velocity API error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch payment velocity' },
      { status: 500 }
    )
  }
}
