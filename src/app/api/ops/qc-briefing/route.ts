export const dynamic = 'force-dynamic'
import { prisma } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'
import { safeJson } from '@/lib/safe-json'

// ──────────────────────────────────────────────────────────────────
// QC BRIEFING — Quality inspection queue and metrics
// ──────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const now = new Date()
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString()
    const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).toISOString()
    const sevenDaysAgo = new Date(now.getTime() - 7 * 86400000).toISOString()
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 86400000).toISOString()

    // ── 1. Inspection Summary ──
    // Count inspections today
    const inspectionsToday: any[] = await prisma.$queryRawUnsafe(`
      SELECT COUNT(*)::int AS count
      FROM "QualityCheck"
      WHERE DATE("createdAt") = DATE(NOW())
    `)

    // Count pending inspections (jobs that need QC but haven't passed yet)
    const pendingInspections: any[] = await prisma.$queryRawUnsafe(`
      SELECT COUNT(DISTINCT j."id")::int AS count
      FROM "Job" j
      LEFT JOIN "QualityCheck" qc ON j."id" = qc."jobId"
        AND qc."result"::text IN ('PASS', 'CONDITIONAL_PASS')
      WHERE j."status"::text IN ('IN_PRODUCTION', 'STAGED', 'LOADED')
        AND qc."id" IS NULL
    `)

    // ── 2. Pass rate (last 7 days) ──
    const passRateData: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        COUNT(*) FILTER (WHERE qc."result"::text = 'PASS')::int AS passed,
        COUNT(*)::int AS total
      FROM "QualityCheck" qc
      WHERE qc."createdAt" >= $1
    `, sevenDaysAgo)

    const passRatePercent = passRateData[0]?.total > 0
      ? Math.round((passRateData[0].passed / passRateData[0].total) * 100)
      : 0

    // ── 3. Failed jobs awaiting rework ──
    const failedAwaitingRework: any[] = await prisma.$queryRawUnsafe(`
      SELECT COUNT(DISTINCT j."id")::int AS count
      FROM "Job" j
      JOIN "QualityCheck" qc ON j."id" = qc."jobId"
      WHERE qc."result"::text = 'FAIL'
        AND j."status"::text NOT IN ('CLOSED', 'INVOICED')
    `)

    const failedCount = failedAwaitingRework[0]?.count || 0

    // ── 4. Total completed in last 7 days ──
    const completed7d: any[] = await prisma.$queryRawUnsafe(`
      SELECT COUNT(*)::int AS count
      FROM "QualityCheck"
      WHERE "createdAt" >= $1
    `, sevenDaysAgo)

    // ── 5. Critical defects ──
    const criticalDefects: any[] = await prisma.$queryRawUnsafe(`
      SELECT COUNT(*)::int AS count
      FROM "QualityCheck"
      WHERE "result"::text = 'FAIL'
        AND "createdAt" >= $1
    `, sevenDaysAgo)

    // ── 6. Inspection Queue — jobs needing QC today ──
    const inspectionQueue: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        j."id",
        j."jobNumber",
        j."builderName",
        j."community",
        j."status"::text AS "jobStatus",
        j."scheduledDate",
        COUNT(DISTINCT oi."id")::int AS "productCount"
      FROM "Job" j
      LEFT JOIN "OrderItem" oi ON oi."orderId" = j."orderId"
      WHERE j."status"::text IN ('IN_PRODUCTION', 'STAGED', 'LOADED')
        AND j."id" NOT IN (
          SELECT DISTINCT j2."id"
          FROM "Job" j2
          JOIN "QualityCheck" qc ON j2."id" = qc."jobId"
          WHERE qc."result"::text IN ('PASS', 'CONDITIONAL_PASS')
        )
      GROUP BY j."id", j."jobNumber", j."builderName", j."community", j."status", j."scheduledDate"
      ORDER BY
        CASE
          WHEN j."scheduledDate" <= NOW() + INTERVAL '48 hours' THEN 1
          WHEN j."scheduledDate" <= NOW() + INTERVAL '72 hours' THEN 2
          ELSE 3
        END ASC,
        j."scheduledDate" ASC
      LIMIT 50
    `)

    // Add priority to each item
    const queueWithPriority = inspectionQueue.map((job: any) => ({
      ...job,
      priority: job.scheduledDate && new Date(job.scheduledDate) <= new Date(now.getTime() + 48 * 3600000)
        ? 'CRITICAL'
        : job.scheduledDate && new Date(job.scheduledDate) <= new Date(now.getTime() + 72 * 3600000)
          ? 'HIGH'
          : 'NORMAL',
    }))

    // ── 7. Recent Results — last 20 QC checks ──
    const recentResults: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        qc."id",
        j."jobNumber",
        qc."checkType"::text AS "checkType",
        qc."result"::text AS "result",
        (qc."result"::text = 'PASS') AS "passed",
        qc."notes",
        qc."createdAt" AS "checkedAt",
        s."firstName" || ' ' || s."lastName" AS "checkedByName"
      FROM "QualityCheck" qc
      LEFT JOIN "Job" j ON qc."jobId" = j."id"
      LEFT JOIN "Staff" s ON qc."inspectorId" = s."id"
      ORDER BY qc."createdAt" DESC
      LIMIT 20
    `)

    // ── 8. Failed Jobs — awaiting rework ──
    const failedJobs: any[] = await prisma.$queryRawUnsafe(`
      SELECT DISTINCT
        j."id",
        j."jobNumber",
        j."builderName",
        MAX(qc."createdAt") AS "failedAt",
        STRING_AGG(qc."notes", ' | ') AS "defectNotes",
        j."status"::text AS "status"
      FROM "Job" j
      JOIN "QualityCheck" qc ON j."id" = qc."jobId"
      WHERE qc."result"::text = 'FAIL'
        AND j."status"::text NOT IN ('CLOSED', 'INVOICED')
      GROUP BY j."id", j."jobNumber", j."builderName", j."status"
      ORDER BY MAX(qc."createdAt") DESC
      LIMIT 15
    `)

    // ── 9. Defect Summary by type (last 30 days) ──
    const defectSummary: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        qc."checkType"::text AS "defectType",
        COUNT(*)::int AS "count"
      FROM "QualityCheck" qc
      WHERE qc."result"::text = 'FAIL'
        AND qc."createdAt" >= $1
      GROUP BY qc."checkType"::text
      ORDER BY "count" DESC
    `, thirtyDaysAgo)

    // ── 10. Quality Trends — pass rate by week (last 8 weeks) ──
    const qualityTrends: any[] = await prisma.$queryRawUnsafe(`
      WITH weekly_data AS (
        SELECT
          DATE_TRUNC('week', qc."createdAt")::date AS week_start,
          COUNT(*) FILTER (WHERE qc."result"::text = 'PASS')::int AS passed,
          COUNT(*)::int AS total
        FROM "QualityCheck" qc
        WHERE qc."createdAt" >= NOW() - INTERVAL '8 weeks'
        GROUP BY DATE_TRUNC('week', qc."createdAt")
      )
      SELECT
        week_start AS "weekStart",
        passed,
        total,
        CASE
          WHEN total > 0 THEN ROUND((passed::numeric / total::numeric * 100)::numeric, 1)::float
          ELSE 0
        END AS "passRate"
      FROM weekly_data
      ORDER BY week_start DESC
    `)

    return safeJson({
      summary: {
        inspectionsToday: inspectionsToday[0]?.count || 0,
        pendingInspections: pendingInspections[0]?.count || 0,
        passRate7d: passRatePercent,
        failedAwaitingRework: failedCount,
        totalCompleted7d: completed7d[0]?.count || 0,
        criticalDefects: criticalDefects[0]?.count || 0,
      },
      inspectionQueue: queueWithPriority,
      recentResults: recentResults,
      failedJobs: failedJobs,
      defectSummary: defectSummary,
      qualityTrends: qualityTrends,
    })
  } catch (error) {
    console.error('QC briefing error:', error)
    return NextResponse.json(
      { error: 'Failed to load QC briefing', details: String((error as any)?.message || error) },
      { status: 500 }
    )
  }
}
