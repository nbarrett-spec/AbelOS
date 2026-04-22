export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'
import { audit } from '@/lib/audit'

// GET /api/ops/inspections/[id] — Get single inspection with template items
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const rows: any[] = await prisma.$queryRawUnsafe(
      `SELECT i.*,
              t."name" as "templateName", t."code" as "templateCode", t."category", t."items" as "templateItems",
              j."jobNumber", j."builderName", j."jobAddress",
              s."firstName" || ' ' || s."lastName" as "inspectorName"
       FROM "Inspection" i
       LEFT JOIN "InspectionTemplate" t ON t.id = i."templateId"
       LEFT JOIN "Job" j ON j.id = i."jobId"
       LEFT JOIN "Staff" s ON s.id = i."inspectorId"
       WHERE i.id = $1`,
      params.id
    )

    if (rows.length === 0) {
      return NextResponse.json({ error: 'Inspection not found' }, { status: 404 })
    }

    return NextResponse.json({ inspection: rows[0] })
  } catch (error: any) {
    console.error('[Inspection GET]', error)
    return NextResponse.json({ error: 'Internal server error'}, { status: 500 })
  }
}

// PATCH /api/ops/inspections/[id] — Update inspection (submit results, change status)
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const body = await request.json()
    const { status, results, passRate, notes, photos, signatureData, inspectorId, scheduledDate, completedDate } = body

    const setClauses: string[] = ['"updatedAt" = NOW()']
    const values: any[] = []
    let paramIdx = 1

    if (status !== undefined) { setClauses.push(`"status" = $${paramIdx++}`); values.push(status) }
    if (results !== undefined) { setClauses.push(`"results" = $${paramIdx++}::jsonb`); values.push(JSON.stringify(results)) }
    if (passRate !== undefined) { setClauses.push(`"passRate" = $${paramIdx++}`); values.push(passRate) }
    if (notes !== undefined) { setClauses.push(`"notes" = $${paramIdx++}`); values.push(notes) }
    if (photos !== undefined) { setClauses.push(`"photos" = $${paramIdx++}::jsonb`); values.push(JSON.stringify(photos)) }
    if (signatureData !== undefined) { setClauses.push(`"signatureData" = $${paramIdx++}`); values.push(signatureData) }
    if (inspectorId !== undefined) { setClauses.push(`"inspectorId" = $${paramIdx++}`); values.push(inspectorId) }
    if (scheduledDate !== undefined) { setClauses.push(`"scheduledDate" = $${paramIdx++}::timestamptz`); values.push(scheduledDate ? new Date(scheduledDate) : null) }
    if (completedDate !== undefined) { setClauses.push(`"completedDate" = $${paramIdx++}::timestamptz`); values.push(completedDate ? new Date(completedDate) : null) }

    // Auto-set completedDate when status changes to PASSED or FAILED
    if (status === 'PASSED' || status === 'FAILED') {
      setClauses.push(`"completedDate" = COALESCE("completedDate", NOW())`)
    }

    const result: any[] = await prisma.$queryRawUnsafe(
      `UPDATE "Inspection" SET ${setClauses.join(', ')} WHERE id = $${paramIdx} RETURNING *`,
      ...values, params.id
    )

    if (result.length === 0) {
      return NextResponse.json({ error: 'Inspection not found' }, { status: 404 })
    }

    await audit(request, 'UPDATE', 'Inspection', params.id, { status, passRate })

    return NextResponse.json({ inspection: result[0] })
  } catch (error: any) {
    console.error('[Inspection PATCH]', error)
    return NextResponse.json({ error: 'Internal server error'}, { status: 500 })
  }
}
