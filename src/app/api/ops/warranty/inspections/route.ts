export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { logAudit, audit } from '@/lib/audit'
import { createNotification } from '@/lib/notifications'
import { checkStaffAuth } from '@/lib/api-auth'

function generateId(prefix: string): string {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

// GET /api/ops/warranty/inspections — List inspections
export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const searchParams = request.nextUrl.searchParams
    const claimId = searchParams.get('claimId')
    const status = searchParams.get('status')
    const inspectorId = searchParams.get('inspectorId')

    const conditions: string[] = []
    const params: any[] = []
    let idx = 1

    if (claimId) {
      conditions.push(`wi."claimId" = $${idx}`)
      params.push(claimId)
      idx++
    }
    if (status && status !== 'ALL') {
      conditions.push(`wi."status"::text = $${idx}`)
      params.push(status)
      idx++
    }
    if (inspectorId) {
      conditions.push(`wi."inspectorId" = $${idx}`)
      params.push(inspectorId)
      idx++
    }

    const whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : ''

    const inspections = await prisma.$queryRawUnsafe(
      `SELECT wi.*,
              s."firstName" || ' ' || s."lastName" as "inspectorName",
              wc."claimNumber", wc."subject" as "claimSubject", wc."siteAddress"
       FROM "WarrantyInspection" wi
       LEFT JOIN "Staff" s ON wi."inspectorId" = s."id"
       LEFT JOIN "WarrantyClaim" wc ON wi."claimId" = wc."id"
       ${whereClause}
       ORDER BY wi."scheduledDate" ASC`,
      ...params
    )

    return NextResponse.json({ inspections })
  } catch (error: any) {
    console.error('GET /api/ops/warranty/inspections error:', error)
    return NextResponse.json({ error: 'Failed to fetch inspections' }, { status: 500 })
  }
}

// POST /api/ops/warranty/inspections — Schedule an inspection
export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const staffId = request.headers.get('x-staff-id')
    if (!staffId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { claimId, inspectorId, scheduledDate, notes } = body

    audit(request, 'CREATE', 'WarrantyInspection', undefined, { method: 'POST' }).catch(() => {})

    if (!claimId || !scheduledDate) {
      return NextResponse.json({ error: 'claimId and scheduledDate are required' }, { status: 400 })
    }

    const id = generateId('winsp')

    await prisma.$executeRawUnsafe(
      `INSERT INTO "WarrantyInspection" ("id", "claimId", "inspectorId", "scheduledDate", "status", "notes", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, 'SCHEDULED', $5, NOW(), NOW())`,
      id, claimId, inspectorId || staffId, new Date(scheduledDate), notes || null
    )

    // Update claim status to INSPECTION_SCHEDULED
    await prisma.$executeRawUnsafe(
      `UPDATE "WarrantyClaim" SET "status" = 'INSPECTION_SCHEDULED', "updatedAt" = NOW() WHERE "id" = $1 AND "status"::text IN ('SUBMITTED', 'UNDER_REVIEW')`,
      claimId
    )

    // Notify inspector
    const targetInspector = inspectorId || staffId
    if (targetInspector !== staffId) {
      createNotification({
        staffId: targetInspector,
        type: 'TASK_ASSIGNED',
        title: 'Warranty Inspection Scheduled',
        message: `Inspection scheduled for ${new Date(scheduledDate).toLocaleDateString()}`,
        link: `/ops/warranty/claims?id=${claimId}`
      }).catch(() => {})
    }

    await logAudit({
      staffId,
      action: 'CREATE',
      entity: 'WarrantyInspection',
      entityId: id,
      details: { claimId, scheduledDate, inspectorId: targetInspector },
    }).catch(() => {})

    return NextResponse.json({ success: true, inspectionId: id }, { status: 201 })
  } catch (error: any) {
    console.error('POST /api/ops/warranty/inspections error:', error)
    return NextResponse.json({ error: 'Failed to schedule inspection' }, { status: 500 })
  }
}

// PATCH /api/ops/warranty/inspections — Complete/update inspection
export async function PATCH(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const staffId = request.headers.get('x-staff-id')
    if (!staffId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { inspectionId, status, findings, recommendation, notes, scheduledDate } = body

    audit(request, 'UPDATE', 'WarrantyInspection', undefined, { method: 'PATCH' }).catch(() => {})

    if (!inspectionId) {
      return NextResponse.json({ error: 'inspectionId is required' }, { status: 400 })
    }

    const setClauses: string[] = ['"updatedAt" = NOW()']
    const params: any[] = []
    let idx = 1

    if (status) {
      setClauses.push(`"status" = $${idx}`)
      params.push(status)
      idx++
      if (status === 'COMPLETED') {
        setClauses.push(`"completedDate" = NOW()`)
      }
    }
    if (findings !== undefined) {
      setClauses.push(`"findings" = $${idx}`)
      params.push(findings)
      idx++
    }
    if (recommendation !== undefined) {
      setClauses.push(`"recommendation" = $${idx}`)
      params.push(recommendation)
      idx++
    }
    if (notes !== undefined) {
      setClauses.push(`"notes" = $${idx}`)
      params.push(notes)
      idx++
    }
    if (scheduledDate) {
      setClauses.push(`"scheduledDate" = $${idx}`)
      params.push(new Date(scheduledDate))
      idx++
    }

    params.push(inspectionId)

    await prisma.$executeRawUnsafe(
      `UPDATE "WarrantyInspection" SET ${setClauses.join(', ')} WHERE "id" = $${idx}`,
      ...params
    )

    // If completing inspection, move claim back to UNDER_REVIEW
    if (status === 'COMPLETED') {
      const inspection = await prisma.$queryRawUnsafe(
        `SELECT "claimId" FROM "WarrantyInspection" WHERE "id" = $1`,
        inspectionId
      ) as any[]
      if (inspection.length > 0) {
        await prisma.$executeRawUnsafe(
          `UPDATE "WarrantyClaim" SET "status" = 'UNDER_REVIEW', "updatedAt" = NOW() WHERE "id" = $1 AND "status"::text = 'INSPECTION_SCHEDULED'`,
          inspection[0].claimId
        )
      }
    }

    await logAudit({
      staffId,
      action: 'UPDATE',
      entity: 'WarrantyInspection',
      entityId: inspectionId,
      details: body,
    }).catch(() => {})

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error('PATCH /api/ops/warranty/inspections error:', error)
    return NextResponse.json({ error: 'Failed to update inspection' }, { status: 500 })
  }
}
