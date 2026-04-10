export const dynamic = 'force-dynamic'
import { prisma } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'
import { safeJson } from '@/lib/safe-json'

// ──────────────────────────────────────────────────────────────────
// PRODUCTION READINESS CHECKLIST (T-72)
// ──────────────────────────────────────────────────────────────────
// GET  — Jobs within 72 hours of delivery that aren't fully ready
// POST — Mark a checklist item as complete
// ──────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const now = new Date()
    const t72 = new Date(now.getTime() + 72 * 3600000)

    // Jobs scheduled within 72 hours that haven't completed readiness
    const jobs: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        j."id",
        j."jobNumber",
        j."builderName",
        j."community",
        j."jobAddress",
        j."scopeType"::text AS "scopeType",
        j."status"::text AS status,
        j."scheduledDate",
        j."readinessCheck",
        j."materialsLocked",
        j."loadConfirmed",
        j."assignedPMId",
        s."firstName" || ' ' || s."lastName" AS "pmName",
        o."orderNumber",
        o."total"::float AS "orderTotal",
        -- Check counts
        (SELECT COUNT(*)::int FROM "Task" t WHERE t."jobId" = j."id" AND t."status"::text NOT IN ('COMPLETE', 'CANCELLED')) AS "openTasks",
        (SELECT COUNT(*)::int FROM "MaterialPick" mp WHERE mp."jobId" = j."id" AND mp."status"::text = 'PENDING') AS "pendingPicks",
        (SELECT COUNT(*)::int FROM "ScheduleEntry" se WHERE se."jobId" = j."id" AND se."entryType"::text = 'DELIVERY' AND se."status"::text = 'PENDING') AS "pendingDeliveries",
        (SELECT COUNT(*)::int FROM "Installation" i WHERE i."jobId" = j."id" AND i."crewId" IS NULL AND i."status"::text NOT IN ('CANCELLED', 'COMPLETE')) AS "unassignedInstalls"
      FROM "Job" j
      LEFT JOIN "Staff" s ON j."assignedPMId" = s."id"
      LEFT JOIN "Order" o ON j."orderId" = o."id"
      WHERE j."scheduledDate" >= $1::date
        AND j."scheduledDate" <= $2::date
        AND j."status"::text NOT IN ('CLOSED', 'CANCELLED', 'COMPLETE', 'INVOICED', 'DELIVERED')
      ORDER BY j."scheduledDate" ASC
    `, now.toISOString(), t72.toISOString())

    // Build readiness assessment for each job
    const assessed = jobs.map((job: any) => {
      const checks = [
        { item: 'T-72 Readiness Check', passed: job.readinessCheck, critical: true },
        { item: 'Materials Locked (T-48)', passed: job.materialsLocked, critical: true },
        { item: 'Load Confirmed (T-24)', passed: job.loadConfirmed, critical: false },
        { item: 'No Open Tasks', passed: job.openTasks === 0, critical: false },
        { item: 'All Materials Picked', passed: job.pendingPicks === 0, critical: true },
        { item: 'Delivery Scheduled', passed: job.pendingDeliveries === 0, critical: false },
        { item: 'Install Crews Assigned', passed: job.unassignedInstalls === 0, critical: false },
      ]

      const passedCount = checks.filter(c => c.passed).length
      const criticalMissing = checks.filter(c => c.critical && !c.passed)
      const score = Math.round((passedCount / checks.length) * 100)

      const hoursUntilDelivery = job.scheduledDate
        ? Math.round((new Date(job.scheduledDate).getTime() - now.getTime()) / 3600000)
        : null

      return {
        ...job,
        checks,
        score,
        passedCount,
        totalChecks: checks.length,
        criticalMissing: criticalMissing.length,
        hoursUntilDelivery,
        readinessLevel: score >= 85 ? 'GREEN' : score >= 60 ? 'YELLOW' : 'RED',
      }
    })

    const redCount = assessed.filter(j => j.readinessLevel === 'RED').length
    const yellowCount = assessed.filter(j => j.readinessLevel === 'YELLOW').length
    const greenCount = assessed.filter(j => j.readinessLevel === 'GREEN').length

    return safeJson({
      summary: { total: assessed.length, red: redCount, yellow: yellowCount, green: greenCount },
      jobs: assessed,
    })
  } catch (error: any) {
    console.error('[Readiness Check]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const body = await request.json()
    const { jobId, field, value } = body

    if (!jobId || !field) {
      return NextResponse.json({ error: 'jobId and field are required' }, { status: 400 })
    }

    const validFields = ['readinessCheck', 'materialsLocked', 'loadConfirmed']
    if (!validFields.includes(field)) {
      return NextResponse.json({ error: `Invalid field. Must be: ${validFields.join(', ')}` }, { status: 400 })
    }

    await prisma.$executeRawUnsafe(
      `UPDATE "Job" SET "${field}" = $2, "updatedAt" = NOW() WHERE "id" = $1`,
      jobId, value !== false
    )

    return safeJson({ success: true, jobId, field, value: value !== false })
  } catch (error: any) {
    console.error('[Readiness Check POST]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
