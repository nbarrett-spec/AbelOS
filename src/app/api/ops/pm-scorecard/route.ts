export const dynamic = 'force-dynamic'
import { prisma } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'
import { safeJson } from '@/lib/safe-json'

// ──────────────────────────────────────────────────────────────────
// PM PERFORMANCE SCORECARD
// ──────────────────────────────────────────────────────────────────
// GET ?staffId=xxx  — individual PM scorecard
// GET               — all PMs benchmarked
// ──────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  const targetStaffId = request.nextUrl.searchParams.get('staffId')
  const period = parseInt(request.nextUrl.searchParams.get('period') || '90')

  try {
    // ── Per-PM metrics ──
    let pmFilter = ''
    const params: any[] = [period]
    let idx = 2

    if (targetStaffId) {
      pmFilter = `AND j."assignedPMId" = $${idx}`
      params.push(targetStaffId)
      idx++
    }

    const pmMetrics: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        s."id" AS "staffId",
        s."firstName" || ' ' || s."lastName" AS "pmName",
        s."email",
        COUNT(DISTINCT j."id")::int AS "totalJobs",
        COUNT(DISTINCT CASE WHEN j."status"::text IN ('COMPLETE', 'INVOICED', 'CLOSED') THEN j."id" END)::int AS "completedJobs",
        COUNT(DISTINCT CASE WHEN j."status"::text NOT IN ('COMPLETE', 'INVOICED', 'CLOSED', 'CANCELLED') THEN j."id" END)::int AS "activeJobs",
        ROUND(AVG(CASE
          WHEN j."status"::text IN ('COMPLETE', 'INVOICED', 'CLOSED')
          THEN EXTRACT(DAY FROM j."updatedAt" - j."createdAt")
        END))::int AS "avgCycleDays",
        COUNT(DISTINCT CASE
          WHEN j."status"::text NOT IN ('COMPLETE', 'INVOICED', 'CLOSED', 'CANCELLED')
            AND EXTRACT(DAY FROM NOW() - j."updatedAt") > 7
          THEN j."id"
        END)::int AS "stalledJobs"
      FROM "Staff" s
      JOIN "Job" j ON j."assignedPMId" = s."id"
      WHERE j."createdAt" > NOW() - ($1 || ' days')::interval
        ${pmFilter}
      GROUP BY s."id", s."firstName", s."lastName", s."email"
      ORDER BY "completedJobs" DESC
    `, ...params)

    // ── On-time delivery rate per PM ──
    const deliveryRates: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        j."assignedPMId" AS "staffId",
        COUNT(se."id")::int AS "totalDeliveries",
        COUNT(CASE WHEN se."status"::text = 'COMPLETED' THEN 1 END)::int AS "completedDeliveries",
        COUNT(CASE WHEN se."status"::text = 'RESCHEDULED' THEN 1 END)::int AS "rescheduledDeliveries"
      FROM "ScheduleEntry" se
      JOIN "Job" j ON se."jobId" = j."id"
      WHERE se."entryType"::text = 'DELIVERY'
        AND se."scheduledDate" > NOW() - ($1 || ' days')::interval
        ${targetStaffId ? `AND j."assignedPMId" = $${idx}` : ''}
      GROUP BY j."assignedPMId"
    `, ...params)

    // Merge delivery rates
    const deliveryMap: Record<string, any> = {}
    deliveryRates.forEach(dr => { deliveryMap[dr.staffId] = dr })

    // ── Quality check pass rates per PM ──
    const qcRates: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        j."assignedPMId" AS "staffId",
        COUNT(qc."id")::int AS "totalQC",
        COUNT(CASE WHEN qc."result"::text IN ('PASS', 'CONDITIONAL_PASS') THEN 1 END)::int AS "passedQC"
      FROM "QualityCheck" qc
      JOIN "Job" j ON qc."jobId" = j."id"
      WHERE qc."createdAt" > NOW() - ($1 || ' days')::interval
        ${targetStaffId ? `AND j."assignedPMId" = $${idx}` : ''}
      GROUP BY j."assignedPMId"
    `, ...params)

    const qcMap: Record<string, any> = {}
    qcRates.forEach(qr => { qcMap[qr.staffId] = qr })

    // ── Revenue per PM ──
    const revenue: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        j."assignedPMId" AS "staffId",
        SUM(o."total")::float AS "totalRevenue",
        AVG(o."total")::float AS "avgOrderValue"
      FROM "Job" j
      JOIN "Order" o ON j."orderId" = o."id"
      WHERE j."createdAt" > NOW() - ($1 || ' days')::interval
        AND j."status"::text NOT IN ('CANCELLED')
        ${targetStaffId ? `AND j."assignedPMId" = $${idx}` : ''}
      GROUP BY j."assignedPMId"
    `, ...params)

    const revenueMap: Record<string, any> = {}
    revenue.forEach(r => { revenueMap[r.staffId] = r })

    // ── Company averages ──
    const companyAvg = {
      avgCycleDays: pmMetrics.length > 0 ? Math.round(pmMetrics.reduce((s, m) => s + (m.avgCycleDays || 0), 0) / pmMetrics.length) : 0,
      avgCompletedJobs: pmMetrics.length > 0 ? Math.round(pmMetrics.reduce((s, m) => s + m.completedJobs, 0) / pmMetrics.length) : 0,
    }

    // Build scorecards
    const scorecards = pmMetrics.map(pm => {
      const dr = deliveryMap[pm.staffId] || { totalDeliveries: 0, completedDeliveries: 0, rescheduledDeliveries: 0 }
      const qc = qcMap[pm.staffId] || { totalQC: 0, passedQC: 0 }
      const rev = revenueMap[pm.staffId] || { totalRevenue: 0, avgOrderValue: 0 }

      const onTimeRate = dr.totalDeliveries > 0 ? Math.round((dr.completedDeliveries / dr.totalDeliveries) * 100) : 100
      const qcPassRate = qc.totalQC > 0 ? Math.round((qc.passedQC / qc.totalQC) * 100) : 100
      const completionRate = pm.totalJobs > 0 ? Math.round((pm.completedJobs / pm.totalJobs) * 100) : 0

      // Overall score (weighted)
      const score = Math.round(
        onTimeRate * 0.3 +
        qcPassRate * 0.2 +
        completionRate * 0.2 +
        Math.min(100, Math.max(0, 100 - (pm.stalledJobs * 15))) * 0.15 +
        Math.min(100, (pm.avgCycleDays ? Math.max(0, 100 - (pm.avgCycleDays - 10) * 2) : 50)) * 0.15
      )

      return {
        ...pm,
        onTimeRate,
        qcPassRate,
        completionRate,
        totalRevenue: Math.round((rev.totalRevenue || 0) * 100) / 100,
        avgOrderValue: Math.round((rev.avgOrderValue || 0) * 100) / 100,
        totalDeliveries: dr.totalDeliveries,
        rescheduledDeliveries: dr.rescheduledDeliveries,
        score,
        grade: score >= 90 ? 'A' : score >= 80 ? 'B' : score >= 70 ? 'C' : score >= 60 ? 'D' : 'F',
      }
    })

    return safeJson({
      period,
      companyAverage: companyAvg,
      scorecards: scorecards.sort((a, b) => b.score - a.score),
    })
  } catch (error: any) {
    console.error('[PM Scorecard]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
