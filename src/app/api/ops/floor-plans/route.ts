export const dynamic = 'force-dynamic'
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'
import { safeJson } from '@/lib/safe-json'

// GET /api/ops/floor-plans — List floor plans with optional filters
export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  const { searchParams } = new URL(request.url)
  const projectId = searchParams.get('projectId')
  const builderId = searchParams.get('builderId')
  const search = searchParams.get('search') || ''
  const page = parseInt(searchParams.get('page') || '1')
  const limit = parseInt(searchParams.get('limit') || '50')
  const offset = (page - 1) * limit

  try {
    const conditions: string[] = ['fp."active" = true']
    const params: any[] = []
    let paramIdx = 1

    if (projectId) {
      conditions.push(`fp."projectId" = $${paramIdx++}`)
      params.push(projectId)
    }

    if (builderId) {
      conditions.push(`p."builderId" = $${paramIdx++}`)
      params.push(builderId)
    }

    if (search) {
      conditions.push(`(fp."label" ILIKE $${paramIdx} OR fp."fileName" ILIKE $${paramIdx} OR p."name" ILIKE $${paramIdx} OR b."companyName" ILIKE $${paramIdx})`)
      params.push(`%${search}%`)
      paramIdx++
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

    const countResult: any[] = await prisma.$queryRawUnsafe(
      `SELECT COUNT(*)::int as count
       FROM "FloorPlan" fp
       JOIN "Project" p ON p."id" = fp."projectId"
       JOIN "Builder" b ON b."id" = p."builderId"
       ${whereClause}`,
      ...params
    )

    const floorPlans: any[] = await prisma.$queryRawUnsafe(
      `SELECT fp.*,
              p."name" as "projectName", p."jobAddress" as "projectAddress",
              p."planName" as "projectPlanName", p."status" as "projectStatus",
              b."companyName" as "builderName", b."id" as "builderId",
              s."firstName" || ' ' || s."lastName" as "uploadedByName"
       FROM "FloorPlan" fp
       JOIN "Project" p ON p."id" = fp."projectId"
       JOIN "Builder" b ON b."id" = p."builderId"
       LEFT JOIN "Staff" s ON s."id" = fp."uploadedById"
       ${whereClause}
       ORDER BY fp."createdAt" DESC
       LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
      ...params, limit, offset
    )

    return safeJson({
      floorPlans,
      total: countResult[0]?.count || 0,
      page,
      pageSize: limit,
    })
  } catch (error: any) {
    console.error('Floor plans list error:', error)
    return safeJson({ error: error.message }, { status: 500 })
  }
}
