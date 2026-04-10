export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'

export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    // Fetch all FAIL and CONDITIONAL_PASS QC records
    const failedChecksQuery = `
      SELECT
        qc.id,
        qc."jobId",
        qc."checkType",
        qc.result,
        qc.notes,
        qc."defectCodes",
        qc."createdAt",
        j."jobNumber",
        j."builderName",
        j."community",
        s."firstName" as "inspector_firstName",
        s."lastName" as "inspector_lastName"
      FROM "QualityCheck" qc
      LEFT JOIN "Job" j ON qc."jobId" = j.id
      LEFT JOIN "Staff" s ON qc."inspectorId" = s.id
      WHERE qc.result IN ('FAIL', 'CONDITIONAL_PASS')
      ORDER BY qc."createdAt" DESC
    `

    const failedChecks: any[] = await prisma.$queryRawUnsafe(failedChecksQuery)

    // Determine status for each check (open/in-rework/resolved)
    const statusQuery = `
      SELECT DISTINCT
        qc1."jobId",
        qc1."checkType"
      FROM "QualityCheck" qc1
      INNER JOIN "QualityCheck" qc2 ON
        qc1."jobId" = qc2."jobId"
        AND qc1."checkType" = qc2."checkType"
        AND qc2.result = 'PASS'
        AND qc2."createdAt" > qc1."createdAt"
      WHERE qc1.result IN ('FAIL', 'CONDITIONAL_PASS')
    `

    const resolvedChecks: any[] = await prisma.$queryRawUnsafe(statusQuery)
    const resolvedSet = new Set(
      resolvedChecks.map((r: any) => `${r.jobId}|${r.checkType}`)
    )

    // Group checks by status
    const open: any[] = []
    const resolved: any[] = []

    const checksWithStatus = failedChecks.map((check: any) => ({
      ...check,
      status: resolvedSet.has(`${check.jobId}|${check.checkType}`)
        ? 'resolved'
        : 'open',
    }))

    checksWithStatus.forEach((check: any) => {
      if (check.status === 'open') {
        open.push(check)
      } else {
        resolved.push(check)
      }
    })

    // Get defect code frequency (top 15)
    const defectFrequencyQuery = `
      SELECT
        UNNEST(qc."defectCodes") as "defectCode",
        COUNT(*) as "count"
      FROM "QualityCheck" qc
      WHERE qc.result IN ('FAIL', 'CONDITIONAL_PASS')
        AND qc."defectCodes" IS NOT NULL
        AND array_length(qc."defectCodes", 1) > 0
      GROUP BY UNNEST(qc."defectCodes")
      ORDER BY COUNT(*) DESC
      LIMIT 15
    `

    const defectFrequency: any[] = await prisma.$queryRawUnsafe(
      defectFrequencyQuery
    )

    // Weekly defect trend (last 8 weeks)
    const weeklyTrendQuery = `
      SELECT
        DATE_TRUNC('week', qc."createdAt")::date as "week",
        COUNT(CASE WHEN qc.result = 'FAIL' THEN 1 END)::int as "failCount",
        COUNT(CASE WHEN qc.result = 'CONDITIONAL_PASS' THEN 1 END)::int as "conditionalCount",
        COUNT(*)::int as "totalChecks",
        ROUND(
          (COUNT(CASE WHEN qc.result IN ('FAIL', 'CONDITIONAL_PASS') THEN 1 END)::float /
           NULLIF(COUNT(*), 0) * 100)::numeric,
          1
        ) as "failRate"
      FROM "QualityCheck" qc
      WHERE qc."createdAt" >= NOW() - INTERVAL '8 weeks'
      GROUP BY DATE_TRUNC('week', qc."createdAt")
      ORDER BY "week" ASC
    `

    const weeklyTrend: any[] = await prisma.$queryRawUnsafe(weeklyTrendQuery)

    // Rework metrics
    const metricsQuery = `
      SELECT
        ROUND(
          AVG(EXTRACT(DAY FROM qc2."createdAt" - qc1."createdAt"))::numeric,
          1
        ) as "avgDaysToResolve",
        COUNT(CASE WHEN NOT EXISTS (
          SELECT 1 FROM "QualityCheck" qc3
          WHERE qc3."jobId" = qc1."jobId"
            AND qc3."checkType" = qc1."checkType"
            AND qc3.result = 'PASS'
            AND qc3."createdAt" > qc1."createdAt"
        ) THEN 1 END)::int as "totalOpen",
        COUNT(CASE WHEN qc1."createdAt" >= DATE_TRUNC('month', NOW())
          AND EXISTS (
            SELECT 1 FROM "QualityCheck" qc3
            WHERE qc3."jobId" = qc1."jobId"
              AND qc3."checkType" = qc1."checkType"
              AND qc3.result = 'PASS'
              AND qc3."createdAt" > qc1."createdAt"
          )
        THEN 1 END)::int as "totalResolvedThisMonth"
      FROM "QualityCheck" qc1
      LEFT JOIN "QualityCheck" qc2 ON
        qc1."jobId" = qc2."jobId"
        AND qc1."checkType" = qc2."checkType"
        AND qc2.result = 'PASS'
        AND qc2."createdAt" > qc1."createdAt"
      WHERE qc1.result IN ('FAIL', 'CONDITIONAL_PASS')
    `

    const metrics: any[] = await prisma.$queryRawUnsafe(metricsQuery)

    // Defects by check type
    const checkTypeQuery = `
      SELECT
        qc."checkType",
        COUNT(CASE WHEN qc.result = 'FAIL' THEN 1 END)::int as "failCount",
        COUNT(CASE WHEN qc.result = 'PASS' THEN 1 END)::int as "passCount",
        ROUND(
          (COUNT(CASE WHEN qc.result = 'PASS' THEN 1 END)::float /
           NULLIF(COUNT(*), 0) * 100)::numeric,
          1
        ) as "passRate"
      FROM "QualityCheck" qc
      WHERE qc."createdAt" >= NOW() - INTERVAL '90 days'
      GROUP BY qc."checkType"
      ORDER BY "failCount" DESC
    `

    const defectsByCheckType: any[] = await prisma.$queryRawUnsafe(
      checkTypeQuery
    )

    const metricsData = metrics[0] || {}
    const failRateAllTime = weeklyTrend.length > 0
      ? weeklyTrend.reduce((sum: number, week: any) => sum + (Number(week.failRate) || 0), 0) / weeklyTrend.length
      : 0

    return NextResponse.json({
      openDefects: {
        count: open.length,
        items: open,
      },
      inRework: {
        count: 0,
        items: [],
      },
      resolved: {
        count: resolved.length,
        items: resolved,
      },
      defectCodeFrequency: defectFrequency.map((row: any) => ({
        code: row.defectCode,
        count: parseInt(row.count, 10),
      })),
      weeklyTrend: weeklyTrend.map((row: any) => ({
        week: row.week,
        failCount: row.failCount || 0,
        conditionalCount: row.conditionalCount || 0,
        totalChecks: row.totalChecks || 0,
        failRate: Number(row.failRate) || 0,
      })),
      reworkMetrics: {
        avgDaysToResolve: Number(metricsData.avgDaysToResolve) || 0,
        totalOpen: metricsData.totalOpen || 0,
        totalResolvedThisMonth: metricsData.totalResolvedThisMonth || 0,
        failRatePercent: Number(failRateAllTime.toFixed(1)) || 0,
      },
      defectsByCheckType: defectsByCheckType.map((row: any) => ({
        checkType: row.checkType,
        failCount: row.failCount || 0,
        passCount: row.passCount || 0,
        passRate: Number(row.passRate) || 0,
      })),
    })
  } catch (error: any) {
    console.error('Error fetching rework data:', error)
    return NextResponse.json(
      { error: 'Failed to load rework data' },
      { status: 500 }
    )
  }
}
