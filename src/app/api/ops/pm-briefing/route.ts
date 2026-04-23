export const dynamic = 'force-dynamic'
import { prisma } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'
import { safeJson } from '@/lib/safe-json'

// ──────────────────────────────────────────────────────────────────
// PM MORNING BRIEFING — Today's priorities in one view
// ──────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  const staffId = request.headers.get('x-staff-id') || ''
  const rolesHeader = (request.headers.get('x-staff-roles') || request.headers.get('x-staff-role') || '').toUpperCase()
  const isPrivileged = /ADMIN|MANAGER/.test(rolesHeader)
  const allOverride = request.nextUrl.searchParams.get('all') === '1' && isPrivileged
  // PM gets their own data; ADMIN/MANAGER get cross-PM data when ?all=1.
  const pmFilterId = allOverride ? null : staffId

  try {
    const now = new Date()
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString()
    const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).toISOString()
    const threeDaysOut = new Date(now.getTime() + 3 * 86400000).toISOString()

    // When pmFilterId is null (admin/manager with ?all=1), we drop the
    // j."assignedPMId" = $1 predicate and use a TRUE literal instead.
    // SQL parameters still count positionally, so we keep the $1 slot.
    const pmWhere = pmFilterId
      ? `j."assignedPMId" = $1`
      : `($1::text IS NULL OR j."assignedPMId" IS NOT NULL)` // always-true, preserves $1 slot
    const pmParam = pmFilterId ?? null

    // ── 1. Today's Deliveries ──
    const todaysDeliveries: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        se."id",
        se."scheduledDate",
        se."scheduledTime",
        se."status"::text AS status,
        se."notes",
        j."id" AS "jobId",
        j."jobNumber",
        j."builderName",
        j."jobAddress",
        j."community",
        j."status"::text AS "jobStatus",
        c."name" AS "crewName"
      FROM "ScheduleEntry" se
      JOIN "Job" j ON se."jobId" = j."id"
      LEFT JOIN "Crew" c ON se."crewId" = c."id"
      WHERE ${pmWhere}
        AND se."scheduledDate" >= $2::date
        AND se."scheduledDate" < $3::date
        AND se."entryType"::text = 'DELIVERY'
        AND se."status"::text NOT IN ('CANCELLED')
      ORDER BY se."scheduledTime" ASC NULLS LAST, se."scheduledDate" ASC
    `, pmParam, todayStart, todayEnd)

    // ── 2. Today's Installations ──
    const todaysInstallations: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        i."id",
        i."installNumber",
        i."scheduledDate",
        i."status"::text AS status,
        i."scopeNotes",
        j."id" AS "jobId",
        j."jobNumber",
        j."builderName",
        j."jobAddress",
        c."name" AS "crewName"
      FROM "Installation" i
      JOIN "Job" j ON i."jobId" = j."id"
      LEFT JOIN "Crew" c ON i."crewId" = c."id"
      WHERE ${pmWhere}
        AND i."scheduledDate" >= $2::date
        AND i."scheduledDate" < $3::date
        AND i."status"::text NOT IN ('CANCELLED', 'COMPLETE')
      ORDER BY i."scheduledDate" ASC
    `, pmParam, todayStart, todayEnd)

    // ── 3. At-Risk Jobs (stalled > 5 days or early stage > 10 days) ──
    const atRiskJobs: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        j."id",
        j."jobNumber",
        j."builderName",
        j."community",
        j."status"::text AS status,
        j."scheduledDate",
        EXTRACT(DAY FROM NOW() - j."updatedAt")::int AS "daysSinceUpdate",
        EXTRACT(DAY FROM NOW() - j."createdAt")::int AS "daysOpen"
      FROM "Job" j
      WHERE ${pmWhere}
        AND j."status"::text NOT IN ('CLOSED', 'CANCELLED', 'INVOICED', 'COMPLETE')
        AND (
          EXTRACT(DAY FROM NOW() - j."updatedAt") > 5
          OR (j."status"::text IN ('CREATED', 'READINESS_CHECK') AND EXTRACT(DAY FROM NOW() - j."createdAt") > 10)
        )
      ORDER BY EXTRACT(DAY FROM NOW() - j."updatedAt") DESC
      LIMIT 10
    `, pmParam)

    // ── 4. Overdue Tasks ──
    const overdueTasks: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        t."id",
        t."title",
        t."description",
        t."dueDate",
        t."priority"::text AS priority,
        t."status"::text AS status,
        j."id" AS "jobId",
        j."jobNumber",
        j."builderName"
      FROM "Task" t
      JOIN "Job" j ON t."jobId" = j."id"
      WHERE ${pmWhere}
        AND t."status"::text NOT IN ('COMPLETE', 'CANCELLED')
        AND t."dueDate" < $2::date
      ORDER BY t."dueDate" ASC
      LIMIT 15
    `, pmParam, todayStart)

    // ── 5. Jobs Approaching Delivery (next 3 days) not yet ready ──
    const approachingDelivery: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        j."id",
        j."jobNumber",
        j."builderName",
        j."community",
        j."jobAddress",
        j."status"::text AS status,
        j."scheduledDate",
        j."readinessCheck",
        j."materialsLocked",
        j."loadConfirmed"
      FROM "Job" j
      WHERE ${pmWhere}
        AND j."scheduledDate" >= $2::date
        AND j."scheduledDate" <= $3::date
        AND j."status"::text NOT IN ('CLOSED', 'CANCELLED', 'COMPLETE', 'INVOICED', 'DELIVERED', 'IN_TRANSIT')
      ORDER BY j."scheduledDate" ASC
    `, pmParam, todayStart, threeDaysOut)

    // ── 6. Recent Decision Notes needing attention ──
    const recentNotes: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        dn."id",
        dn."body" AS content,
        dn."subject",
        dn."noteType"::text AS type,
        dn."createdAt",
        j."id" AS "jobId",
        j."jobNumber",
        j."builderName"
      FROM "DecisionNote" dn
      JOIN "Job" j ON dn."jobId" = j."id"
      WHERE ${pmWhere}
        AND dn."createdAt" > NOW() - INTERVAL '48 hours'
      ORDER BY dn."createdAt" DESC
      LIMIT 10
    `, pmParam)

    // ── 7. Jobs ready to advance (next logical step) ──
    const readyToAdvance: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        j."id",
        j."jobNumber",
        j."builderName",
        j."status"::text AS status,
        j."readinessCheck",
        j."materialsLocked",
        j."loadConfirmed",
        j."scheduledDate"
      FROM "Job" j
      WHERE ${pmWhere}
        AND j."status"::text NOT IN ('CLOSED', 'CANCELLED', 'INVOICED')
        AND (
          (j."status"::text = 'CREATED' AND j."readinessCheck" = true)
          OR (j."status"::text = 'READINESS_CHECK' AND j."materialsLocked" = true)
          OR (j."status"::text = 'MATERIALS_LOCKED')
          OR (j."status"::text = 'STAGED' AND j."loadConfirmed" = true)
        )
      ORDER BY j."scheduledDate" ASC NULLS LAST
      LIMIT 10
    `, pmParam)

    // ── 8. Summary counts ──
    const summaryCounts: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        COUNT(*)::int AS "totalActive",
        COUNT(CASE WHEN j."status"::text IN ('IN_PRODUCTION', 'STAGED', 'LOADED') THEN 1 END)::int AS "inProduction",
        COUNT(CASE WHEN j."status"::text = 'IN_TRANSIT' THEN 1 END)::int AS "inTransit",
        COUNT(CASE WHEN j."status"::text IN ('INSTALLING', 'PUNCH_LIST') THEN 1 END)::int AS "installing"
      FROM "Job" j
      WHERE ${pmWhere}
        AND j."status"::text NOT IN ('CLOSED', 'CANCELLED', 'INVOICED', 'COMPLETE')
    `, pmParam)

    // ── 9. Top builders for this PM (by revenue, trailing 12 months) ──
    // For PMs: restrict to builders whose orders link back to a Job owned by this PM.
    // For admin/manager ?all=1: global top 10.
    const topBuildersSql = pmFilterId
      ? `
        SELECT b."id", b."companyName", COALESCE(SUM(o."total"), 0)::float AS revenue
        FROM "Builder" b
        LEFT JOIN "Order" o ON o."builderId" = b."id"
          AND o."status"::text NOT IN ('CANCELLED')
          AND o."orderDate" >= NOW() - INTERVAL '12 months'
        WHERE b."id" IN (
          SELECT DISTINCT o2."builderId"
          FROM "Order" o2
          JOIN "Job" j2 ON j2."orderId" = o2."id"
          WHERE j2."assignedPMId" = $1
        )
        GROUP BY b."id", b."companyName"
        ORDER BY revenue DESC NULLS LAST
        LIMIT 10
      `
      : `
        SELECT b."id", b."companyName", COALESCE(SUM(o."total"), 0)::float AS revenue
        FROM "Builder" b
        LEFT JOIN "Order" o ON o."builderId" = b."id"
          AND o."status"::text NOT IN ('CANCELLED')
          AND o."orderDate" >= NOW() - INTERVAL '12 months'
        WHERE $1::text IS NULL OR $1::text IS NOT NULL
        GROUP BY b."id", b."companyName"
        ORDER BY revenue DESC NULLS LAST
        LIMIT 10
      `
    const topBuilders: any[] = await prisma.$queryRawUnsafe(topBuildersSql, pmFilterId || null)

    const counts = summaryCounts[0] || { totalActive: 0, inProduction: 0, inTransit: 0, installing: 0 }

    return safeJson({
      date: todayStart,
      summary: {
        ...counts,
        todaysDeliveries: todaysDeliveries.length,
        todaysInstallations: todaysInstallations.length,
        atRiskCount: atRiskJobs.length,
        overdueTasks: overdueTasks.length,
        readyToAdvance: readyToAdvance.length,
      },
      todaysDeliveries,
      todaysInstallations,
      atRiskJobs,
      overdueTasks,
      approachingDelivery,
      recentNotes,
      readyToAdvance,
      topBuilders,
      scope: pmFilterId ? 'pm' : 'all',
    })
  } catch (error: any) {
    console.error('[PM Briefing] Error:', error)
    return NextResponse.json({ error: 'Briefing failed' }, { status: 500 })
  }
}
