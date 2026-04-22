export const dynamic = 'force-dynamic'
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'
import { safeJson } from '@/lib/safe-json'
import { audit } from '@/lib/audit'

// GET /api/ops/floor-plans/[id] — Get a single floor plan
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const floorPlans: any[] = await prisma.$queryRawUnsafe(
      `SELECT fp.*,
              p."name" as "projectName", p."jobAddress" as "projectAddress",
              p."planName" as "projectPlanName",
              b."companyName" as "builderName", b."id" as "builderId",
              s."firstName" || ' ' || s."lastName" as "uploadedByName"
       FROM "FloorPlan" fp
       JOIN "Project" p ON p."id" = fp."projectId"
       JOIN "Builder" b ON b."id" = p."builderId"
       LEFT JOIN "Staff" s ON s."id" = fp."uploadedById"
       WHERE fp."id" = $1`,
      params.id
    )

    if (floorPlans.length === 0) {
      return safeJson({ error: 'Floor plan not found' }, { status: 404 })
    }

    // Get linked takeoffs and quotes
    const linkedTakeoffs: any[] = await prisma.$queryRawUnsafe(
      `SELECT t."id", t."status", t."confidence", t."createdAt"
       FROM "Takeoff" t WHERE t."floorPlanId" = $1`,
      params.id
    )

    const linkedQuotes: any[] = await prisma.$queryRawUnsafe(
      `SELECT q."id", q."quoteNumber", q."status", q."total", q."createdAt"
       FROM "Quote" q WHERE q."floorPlanId" = $1`,
      params.id
    )

    return safeJson({
      floorPlan: floorPlans[0],
      linkedTakeoffs,
      linkedQuotes,
    })
  } catch (error: any) {
    console.error('Floor plan get error:', error)
    return safeJson({ error: 'Internal server error'}, { status: 500 })
  }
}

// PATCH /api/ops/floor-plans/[id] — Update floor plan metadata
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    // Audit log
    audit(request, 'UPDATE', 'FloorPlan', undefined, { method: 'PATCH' }).catch(() => {})

    const body = await request.json()
    const { label, notes, active } = body

    const updates: string[] = []
    const values: any[] = []
    let paramIdx = 1

    if (label !== undefined) {
      updates.push(`"label" = $${paramIdx++}`)
      values.push(label)
    }
    if (notes !== undefined) {
      updates.push(`"notes" = $${paramIdx++}`)
      values.push(notes)
    }
    if (active !== undefined) {
      updates.push(`"active" = $${paramIdx++}`)
      values.push(active)
    }

    if (updates.length === 0) {
      return safeJson({ error: 'No updates provided' }, { status: 400 })
    }

    updates.push(`"updatedAt" = CURRENT_TIMESTAMP`)

    await prisma.$executeRawUnsafe(
      `UPDATE "FloorPlan" SET ${updates.join(', ')} WHERE "id" = $${paramIdx}`,
      ...values,
      params.id
    )

    // Return updated record
    const updated: any[] = await prisma.$queryRawUnsafe(
      `SELECT fp.*, s."firstName" || ' ' || s."lastName" as "uploadedByName"
       FROM "FloorPlan" fp
       LEFT JOIN "Staff" s ON s."id" = fp."uploadedById"
       WHERE fp."id" = $1`,
      params.id
    )

    return safeJson({ floorPlan: updated[0] || null })
  } catch (error: any) {
    console.error('Floor plan update error:', error)
    return safeJson({ error: 'Internal server error'}, { status: 500 })
  }
}

// DELETE /api/ops/floor-plans/[id] — Soft-delete floor plan
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    // Audit log
    audit(request, 'DELETE', 'FloorPlan', undefined, { method: 'DELETE' }).catch(() => {})

    await prisma.$executeRawUnsafe(
      `UPDATE "FloorPlan" SET "active" = false, "updatedAt" = CURRENT_TIMESTAMP WHERE "id" = $1`,
      params.id
    )

    return safeJson({ success: true })
  } catch (error: any) {
    console.error('Floor plan delete error:', error)
    return safeJson({ error: 'Internal server error'}, { status: 500 })
  }
}
