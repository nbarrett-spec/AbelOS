export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'

// GET /api/ops/inspections — List inspections with filters
export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const sp = request.nextUrl.searchParams
    const status = sp.get('status')
    const jobId = sp.get('jobId')
    const inspectorId = sp.get('inspectorId')
    const category = sp.get('category')
    const page = parseInt(sp.get('page') || '1')
    const limit = Math.min(100, parseInt(sp.get('limit') || '50'))
    const offset = (page - 1) * limit

    const conditions: string[] = []
    const params: any[] = []
    let paramIdx = 1

    if (status) { conditions.push(`i."status" = $${paramIdx++}`); params.push(status) }
    if (jobId) { conditions.push(`i."jobId" = $${paramIdx++}`); params.push(jobId) }
    if (inspectorId) { conditions.push(`i."inspectorId" = $${paramIdx++}`); params.push(inspectorId) }
    if (category) { conditions.push(`t."category" = $${paramIdx++}`); params.push(category) }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

    const inspections: any[] = await prisma.$queryRawUnsafe(
      `SELECT i.*,
              t."name" as "templateName", t."code" as "templateCode", t."category",
              j."jobNumber", j."builderName", j."jobAddress",
              s."firstName" || ' ' || s."lastName" as "inspectorName"
       FROM "Inspection" i
       LEFT JOIN "InspectionTemplate" t ON t.id = i."templateId"
       LEFT JOIN "Job" j ON j.id = i."jobId"
       LEFT JOIN "Staff" s ON s.id = i."inspectorId"
       ${where}
       ORDER BY i."createdAt" DESC
       LIMIT $${paramIdx++} OFFSET $${paramIdx}`,
      ...params, limit, offset
    )

    const countResult: any[] = await prisma.$queryRawUnsafe(
      `SELECT COUNT(*)::int as total FROM "Inspection" i
       LEFT JOIN "InspectionTemplate" t ON t.id = i."templateId"
       ${where}`,
      ...params
    )

    return NextResponse.json({
      inspections,
      total: countResult[0]?.total || 0,
      page,
      totalPages: Math.ceil((countResult[0]?.total || 0) / limit),
    })
  } catch (error: any) {
    console.error('[Inspections GET]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

// POST /api/ops/inspections — Create a new inspection
export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const body = await request.json()
    const { templateId, jobId, inspectorId, scheduledDate, notes } = body

    if (!templateId || !jobId) {
      return NextResponse.json({ error: 'templateId and jobId are required' }, { status: 400 })
    }

    const result: any[] = await prisma.$queryRawUnsafe(
      `INSERT INTO "Inspection" ("id", "templateId", "jobId", "inspectorId", "scheduledDate", "notes", "status")
       VALUES (gen_random_uuid()::text, $1, $2, $3, $4::timestamptz, $5, 'PENDING')
       RETURNING *`,
      templateId, jobId, inspectorId || null, scheduledDate ? new Date(scheduledDate) : null, notes || null
    )

    return NextResponse.json({ inspection: result[0] }, { status: 201 })
  } catch (error: any) {
    console.error('[Inspections POST]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
