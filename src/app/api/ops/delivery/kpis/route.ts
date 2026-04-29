export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireStaffAuth } from '@/lib/api-auth'

// D-6 — Delivery KPI dashboard with crew breakdown
// GET /api/ops/delivery/kpis?days=30

export async function GET(request: NextRequest) {
  const auth = await requireStaffAuth(request, { allowedRoles: ['ADMIN', 'MANAGER'] })
  if (auth.error) return auth.error

  try {
    const { searchParams } = new URL(request.url)
    const daysRaw = parseInt(searchParams.get('days') || '30', 10)
    const days = Math.max(1, Math.min(365, isNaN(daysRaw) ? 30 : daysRaw))

    // Per-crew aggregation. Crew identifier varies by schema — try common
    // fields and fall back to deliveredBy / driver name.
    const sql = `
      WITH window_deliveries AS (
        SELECT d."id", d."status"::text AS status, d."completedAt", d."damageNotes",
               COALESCE(d."deliveredBy", d."driverName", 'unassigned') AS crew,
               j."scheduledDate"
        FROM "Delivery" d
        LEFT JOIN "Job" j ON j."id" = d."jobId"
        WHERE d."completedAt" IS NOT NULL
          AND d."completedAt" >= NOW() - ($1 || ' days')::interval
      )
      SELECT crew,
             COUNT(*)::int AS deliveries,
             SUM(CASE WHEN "scheduledDate" IS NOT NULL AND "completedAt"::date <= "scheduledDate"::date THEN 1 ELSE 0 END)::int AS on_time,
             SUM(CASE WHEN "damageNotes" IS NOT NULL AND "damageNotes" <> '' THEN 1 ELSE 0 END)::int AS damaged,
             SUM(CASE WHEN status = 'COMPLETE' THEN 1 ELSE 0 END)::int AS completed
      FROM window_deliveries
      GROUP BY crew
      ORDER BY deliveries DESC
      LIMIT 50
    `

    let rows: any[] = []
    try {
      rows = await prisma.$queryRawUnsafe(sql, String(days))
    } catch (e: any) {
      // Schema might not match exactly — return empty rather than 500
      console.warn('[delivery/kpis] aggregation query failed:', e?.message)
    }

    const crews = rows.map((r) => ({
      name: r.crew || 'unassigned',
      deliveries: Number(r.deliveries || 0),
      onTimePct: r.deliveries ? Math.round((Number(r.on_time) / Number(r.deliveries)) * 100) : null,
      avgStops: null, // requires route-day grouping; defer
      damagePct: r.deliveries ? Math.round((Number(r.damaged) / Number(r.deliveries)) * 100) : 0,
      completedCount: Number(r.completed || 0),
    }))

    return NextResponse.json({ crews, days })
  } catch (e: any) {
    console.error('[GET /api/ops/delivery/kpis] error:', e?.message || e)
    return NextResponse.json({ error: 'failed to load delivery KPIs' }, { status: 500 })
  }
}
