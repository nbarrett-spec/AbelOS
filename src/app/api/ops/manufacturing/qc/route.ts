export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'
import { audit } from '@/lib/audit'
import { mirrorQualityCheckToInspection } from '@/lib/events/inspection'

// Active (non-terminal) job statuses for QC dropdowns and pending-queue inputs.
// Excludes COMPLETE / INVOICED / CLOSED (terminal). The Job-status enum in
// schema.prisma has no CANCELLED or ON_HOLD value; the closest analogues are
// the three terminal values above.
const ACTIVE_JOB_STATUSES = [
  'CREATED',
  'READINESS_CHECK',
  'MATERIALS_LOCKED',
  'IN_PRODUCTION',
  'STAGED',
  'LOADED',
  'IN_TRANSIT',
  'DELIVERED',
  'INSTALLING',
  'PUNCH_LIST',
] as const

export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const { searchParams } = new URL(request.url)
    const type = searchParams.get('type')
    const result = searchParams.get('result')
    const search = searchParams.get('search')
    const queue = searchParams.get('queue') // 'pending' = jobs pending QC

    // ── Pending-QC queue branch ──────────────────────────────────────────
    // Returns jobs in STAGED or IN_PRODUCTION that do NOT yet have any
    // QualityCheck row with result = 'PASS'.
    if (queue === 'pending') {
      const pendingQuery = `
        SELECT
          j.id,
          j."jobNumber",
          j."builderName",
          j."jobAddress",
          j."community",
          j."jobType",
          j."scopeType",
          j."status",
          j."scheduledDate"
        FROM "Job" j
        WHERE j."status"::text IN ('STAGED', 'IN_PRODUCTION')
          AND NOT EXISTS (
            SELECT 1 FROM "QualityCheck" qc
            WHERE qc."jobId" = j.id AND qc.result = 'PASS'
          )
        ORDER BY j."scheduledDate" ASC NULLS LAST, j."jobNumber" ASC
      `
      const pending: any = await prisma.$queryRawUnsafe(pendingQuery)
      return NextResponse.json({ pending })
    }

    // Build dynamic WHERE clause
    const whereConditions: string[] = []
    const params: any[] = []

    if (type) {
      whereConditions.push('qc."checkType" = $' + (params.length + 1))
      params.push(type)
    }
    if (result) {
      whereConditions.push('qc.result = $' + (params.length + 1))
      params.push(result)
    }
    // Search by Job.jobNumber OR Job.jobAddress (ILIKE both with OR).
    if (search) {
      const i = params.length + 1
      whereConditions.push(
        `(j."jobNumber" ILIKE $${i} OR j."jobAddress" ILIKE $${i + 1})`
      )
      const pat = `%${search}%`
      params.push(pat, pat)
    }

    const whereClause =
      whereConditions.length > 0 ? 'WHERE ' + whereConditions.join(' AND ') : ''

    // Fetch checks with job and inspector details
    const checksQuery = `
      SELECT
        qc.id,
        qc."checkType",
        qc.result,
        qc.notes,
        qc."defectCodes",
        qc."createdAt",
        s.id as "inspector_id",
        s."firstName" as "inspector_firstName",
        s."lastName" as "inspector_lastName",
        j.id as "job_id",
        j."jobNumber" as "job_jobNumber",
        j."builderName" as "job_builderName",
        j."jobAddress" as "job_jobAddress"
      FROM "QualityCheck" qc
      LEFT JOIN "Staff" s ON qc."inspectorId" = s.id
      LEFT JOIN "Job" j ON qc."jobId" = j.id
      ${whereClause}
      ORDER BY qc."createdAt" DESC
    `

    const checks: any = await prisma.$queryRawUnsafe(checksQuery, ...params)

    // Transform flat result into nested structure
    const formattedChecks = checks.map((check: any) => ({
      id: check.id,
      checkType: check.checkType,
      result: check.result,
      notes: check.notes,
      defectCodes: check.defectCodes || [],
      createdAt: check.createdAt,
      inspector: check.inspector_id
        ? {
            firstName: check.inspector_firstName,
            lastName: check.inspector_lastName,
          }
        : null,
      job: check.job_id
        ? {
            id: check.job_id,
            jobNumber: check.job_jobNumber,
            builderName: check.job_builderName,
            jobAddress: check.job_jobAddress,
          }
        : null,
    }))

    // Calculate stats from all checks
    const allChecksQuery = `
      SELECT result, "defectCodes"
      FROM "QualityCheck"
    `

    const allChecks: any = await prisma.$queryRawUnsafe(allChecksQuery)

    const passCount = allChecks.filter((c: any) => c.result === 'PASS').length
    const failCount = allChecks.filter((c: any) => c.result === 'FAIL').length
    const conditionalCount = allChecks.filter((c: any) => c.result === 'CONDITIONAL_PASS').length

    const defectCounts: Record<string, number> = {}
    allChecks.forEach((check: any) => {
      const codes = check.defectCodes || []
      codes.forEach((code: string) => {
        defectCounts[code] = (defectCounts[code] || 0) + 1
      })
    })

    const stats = {
      passRate:
        allChecks.length > 0 ? passCount / allChecks.length : 0,
      failRate:
        allChecks.length > 0 ? failCount / allChecks.length : 0,
      conditionalPassRate:
        allChecks.length > 0 ? conditionalCount / allChecks.length : 0,
      commonDefects: Object.fromEntries(
        Object.entries(defectCounts)
          .sort(([, a], [, b]) => b - a)
          .slice(0, 10)
      ),
    }

    return NextResponse.json({
      checks: formattedChecks,
      total: formattedChecks.length,
      stats,
      activeStatuses: ACTIVE_JOB_STATUSES,
    })
  } catch (error) {
    console.error('QC error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch quality checks' },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    // Audit log
    audit(request, 'CREATE', 'Manufacturing', undefined, { method: 'POST' }).catch(() => {})

    const body = await request.json()
    const {
      jobId,
      checkType,
      result,
      notes,
      defectCodes,
      inspectorId,
    } = body

    // ── Required-field validation (surface specific messages to the UI) ──
    if (!checkType) {
      return NextResponse.json(
        { error: 'checkType is required' },
        { status: 400 }
      )
    }
    if (!result) {
      return NextResponse.json(
        { error: 'result is required' },
        { status: 400 }
      )
    }

    // ── Resolve the inspector ────────────────────────────────────────────
    // Priority: explicit body.inspectorId → current authed staff
    // (x-staff-id header) → first staff with role QC_INSPECTOR.
    // Surfaces a clear 400 if none of those resolve to a real Staff row.
    let actualInspectorId: string | null = inspectorId || null

    if (!actualInspectorId) {
      const sessionStaffId = request.headers.get('x-staff-id')
      if (sessionStaffId) {
        const verifyQuery = `SELECT id FROM "Staff" WHERE id = $1 LIMIT 1`
        const found: any = await prisma.$queryRawUnsafe(verifyQuery, sessionStaffId)
        if (found && found.length > 0) {
          actualInspectorId = found[0].id
        }
      }
    }

    if (!actualInspectorId) {
      const inspectorQuery = `SELECT id FROM "Staff" WHERE role = 'QC_INSPECTOR' LIMIT 1`
      const inspectors: any = await prisma.$queryRawUnsafe(inspectorQuery)
      if (inspectors && inspectors.length > 0) {
        actualInspectorId = inspectors[0].id
      }
    }

    if (!actualInspectorId) {
      return NextResponse.json(
        {
          error:
            'Could not resolve an inspector. No authenticated staff session and no QC_INSPECTOR exists in the Staff table.',
        },
        { status: 400 }
      )
    }

    // Generate ID for new quality check
    const newId = `qc_${Date.now().toString(36)}_${Math.random().toString(36).substr(2, 9)}`

    // Insert quality check
    const insertQuery = `
      INSERT INTO "QualityCheck" (id, "jobId", "checkType", result, notes, "defectCodes", "inspectorId", "createdAt", "updatedAt")
      VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
      RETURNING *
    `

    const checks: any = await prisma.$queryRawUnsafe(
      insertQuery,
      newId,
      jobId || null,
      checkType,
      result,
      notes,
      defectCodes || [],
      actualInspectorId
    )

    // Fetch complete record with relationships
    const fetchQuery = `
      SELECT
        qc.id,
        qc."jobId",
        qc."checkType",
        qc.result,
        qc.notes,
        qc."defectCodes",
        qc."inspectorId",
        qc."createdAt",
        qc."updatedAt",
        s."firstName" as "inspector_firstName",
        s."lastName" as "inspector_lastName",
        j."jobNumber"
      FROM "QualityCheck" qc
      LEFT JOIN "Staff" s ON qc."inspectorId" = s.id
      LEFT JOIN "Job" j ON qc."jobId" = j.id
      WHERE qc.id = $1
    `

    const fullChecks: any = await prisma.$queryRawUnsafe(fetchQuery, newId)
    const fullCheck = fullChecks[0]

    // Mirror into Inspection so QC portal sees live queue.
    // On FAIL: also emits PunchItem + PM Task. Fire-and-forget; never blocks.
    mirrorQualityCheckToInspection(newId).catch(() => {})

    const response = {
      id: fullCheck.id,
      jobId: fullCheck.jobId,
      checkType: fullCheck.checkType,
      result: fullCheck.result,
      notes: fullCheck.notes,
      defectCodes: fullCheck.defectCodes || [],
      inspectorId: fullCheck.inspectorId,
      createdAt: fullCheck.createdAt,
      updatedAt: fullCheck.updatedAt,
      inspector: {
        firstName: fullCheck.inspector_firstName,
        lastName: fullCheck.inspector_lastName,
      },
      job: fullCheck.jobNumber
        ? {
            jobNumber: fullCheck.jobNumber,
          }
        : null,
    }

    return NextResponse.json(response, { status: 201 })
  } catch (error) {
    console.error('QC creation error:', error)
    const message =
      error instanceof Error ? error.message : 'Failed to create quality check'
    return NextResponse.json(
      { error: 'Failed to create quality check', detail: message },
      { status: 500 }
    )
  }
}
