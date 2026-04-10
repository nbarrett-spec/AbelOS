export const dynamic = 'force-dynamic'
import { prisma } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'
import { safeJson } from '@/lib/safe-json'

// ──────────────────────────────────────────────────────────────────
// QC TRENDS — Analytics and historical quality data
// ──────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  const period = request.nextUrl.searchParams.get('period') || '90'
  const days = parseInt(period)

  try {
    // ── 1. Pass rate by week ──
    const passRateByWeek: any[] = await prisma.$queryRawUnsafe(`
      WITH weekly_data AS (
        SELECT
          DATE_TRUNC('week', qc."createdAt")::date AS week_start,
          COUNT(*) FILTER (WHERE qc."result"::text = 'PASS')::int AS passed,
          COUNT(*) FILTER (WHERE qc."result"::text = 'CONDITIONAL_PASS')::int AS conditional,
          COUNT(*) FILTER (WHERE qc."result"::text = 'FAIL')::int AS failed,
          COUNT(*)::int AS total
        FROM "QualityCheck" qc
        WHERE qc."createdAt" >= NOW() - INTERVAL '${days} days'
        GROUP BY DATE_TRUNC('week', qc."createdAt")
      )
      SELECT
        week_start AS "weekStart",
        passed,
        conditional,
        failed,
        total,
        CASE
          WHEN total > 0 THEN ROUND((passed::numeric / total::numeric * 100)::numeric, 1)::float
          ELSE 0
        END AS "passRate",
        CASE
          WHEN total > 0 THEN ROUND(((passed + conditional)::numeric / total::numeric * 100)::numeric, 1)::float
          ELSE 0
        END AS "acceptableRate"
      FROM weekly_data
      ORDER BY week_start DESC
    `)

    // ── 2. Defects by type ──
    const defectsByType: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        qc."checkType"::text AS "checkType",
        COUNT(*) FILTER (WHERE qc."result"::text = 'PASS')::int AS passed,
        COUNT(*) FILTER (WHERE qc."result"::text = 'FAIL')::int AS failed,
        COUNT(*)::int AS total,
        CASE
          WHEN COUNT(*) > 0 THEN ROUND((COUNT(*) FILTER (WHERE qc."result"::text = 'PASS')::numeric / COUNT(*)::numeric * 100)::numeric, 1)::float
          ELSE 0
        END AS "passRate"
      FROM "QualityCheck" qc
      WHERE qc."createdAt" >= NOW() - INTERVAL '${days} days'
      GROUP BY qc."checkType"::text
      ORDER BY total DESC
    `)

    // ── 3. Top failure reasons ──
    const topFailureReasons: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        SUBSTRING(qc."notes", 1, 100) AS "reason",
        COUNT(*)::int AS "count"
      FROM "QualityCheck" qc
      WHERE qc."result"::text = 'FAIL'
        AND qc."notes" IS NOT NULL
        AND qc."notes" != ''
        AND qc."createdAt" >= NOW() - INTERVAL '${days} days'
      GROUP BY SUBSTRING(qc."notes", 1, 100)
      ORDER BY "count" DESC
      LIMIT 10
    `)

    // ── 4. Defects by crew (if available) ──
    const defectsByCrew: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        c."name" AS "crewName",
        COUNT(*) FILTER (WHERE qc."result"::text = 'PASS')::int AS passed,
        COUNT(*) FILTER (WHERE qc."result"::text = 'FAIL')::int AS failed,
        COUNT(*)::int AS total,
        CASE
          WHEN COUNT(*) > 0 THEN ROUND((COUNT(*) FILTER (WHERE qc."result"::text = 'PASS')::numeric / COUNT(*)::numeric * 100)::numeric, 1)::float
          ELSE 0
        END AS "passRate"
      FROM "QualityCheck" qc
      LEFT JOIN "Job" j ON qc."jobId" = j."id"
      LEFT JOIN "ScheduleEntry" se ON j."id" = se."jobId"
      LEFT JOIN "Crew" c ON se."crewId" = c."id"
      WHERE qc."createdAt" >= NOW() - INTERVAL '${days} days'
        AND c."id" IS NOT NULL
      GROUP BY c."name"
      ORDER BY total DESC
      LIMIT 10
    `)

    // ── 5. Daily inspection trend ──
    const dailyTrend: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        DATE(qc."createdAt")::date AS "date",
        COUNT(*) FILTER (WHERE qc."result"::text = 'PASS')::int AS passed,
        COUNT(*) FILTER (WHERE qc."result"::text = 'FAIL')::int AS failed,
        COUNT(*)::int AS total
      FROM "QualityCheck" qc
      WHERE qc."createdAt" >= NOW() - INTERVAL '${days} days'
      GROUP BY DATE(qc."createdAt")
      ORDER BY "date" DESC
    `)

    // ── 6. Result breakdown (overall stats) ──
    const resultBreakdown: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        qc."result"::text AS "result",
        COUNT(*)::int AS "count"
      FROM "QualityCheck" qc
      WHERE qc."createdAt" >= NOW() - INTERVAL '${days} days'
      GROUP BY qc."result"::text
      ORDER BY "count" DESC
    `)

    return NextResponse.json(safeJson({
      period: days,
      passRateByWeek,
      defectsByType,
      topFailureReasons,
      defectsByCrew,
      dailyTrend,
      resultBreakdown,
    }))
  } catch (error) {
    console.error('QC trends error:', error)
    return NextResponse.json(
      { error: 'Failed to load QC trends' },
      { status: 500 }
    )
  }
}
