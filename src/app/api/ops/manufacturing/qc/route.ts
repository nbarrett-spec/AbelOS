export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'
import { audit } from '@/lib/audit'
import { mirrorQualityCheckToInspection } from '@/lib/events/inspection'

export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const { searchParams } = new URL(request.url)
    const type = searchParams.get('type')
    const result = searchParams.get('result')

    // Build dynamic WHERE clause
    const whereConditions = []
    const params: any[] = []

    if (type) {
      whereConditions.push('qc."checkType" = $' + (params.length + 1))
      params.push(type)
    }
    if (result) {
      whereConditions.push('qc.result = $' + (params.length + 1))
      params.push(result)
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
        j."builderName" as "job_builderName"
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

    // Get the current user as inspector if not provided
    let actualInspectorId = inspectorId
    if (!actualInspectorId) {
      // For now, we'll use a default inspector - in production, get from session
      const inspectorQuery = `SELECT id FROM "Staff" WHERE role = 'QC_INSPECTOR' LIMIT 1`
      const inspectors: any = await prisma.$queryRawUnsafe(inspectorQuery)
      if (!inspectors || inspectors.length === 0) {
        return NextResponse.json(
          { error: 'No QC inspector found' },
          { status: 400 }
        )
      }
      actualInspectorId = inspectors[0].id
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

    const check = checks[0]

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
    return NextResponse.json(
      { error: 'Failed to create quality check' },
      { status: 500 }
    )
  }
}
