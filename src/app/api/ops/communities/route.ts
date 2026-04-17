export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'

// GET /api/ops/communities — List communities (now from Community table, BoltCommunity fallback)
export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const { searchParams } = new URL(request.url)
    const search = searchParams.get('search') || ''
    const builderId = searchParams.get('builderId') || ''
    const status = searchParams.get('status') || ''

    let communities: any[] = []

    try {
      const conditions: string[] = []
      const params: any[] = []
      let idx = 1

      if (search) {
        conditions.push(`(c."name" ILIKE $${idx} OR c."city" ILIKE $${idx} OR c."division" ILIKE $${idx})`)
        params.push(`%${search}%`)
        idx++
      }

      if (builderId) {
        conditions.push(`c."builderId" = $${idx}`)
        params.push(builderId)
        idx++
      }

      if (status) {
        conditions.push(`c."status"::text = $${idx}`)
        params.push(status)
        idx++
      }

      const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

      communities = await prisma.$queryRawUnsafe(
        `SELECT
          c.*,
          b."companyName" AS "builderName",
          b."builderType",
          (SELECT COUNT(*)::int FROM "Job" j WHERE j."communityId" = c.id OR j."community" = c."name") AS "jobCount",
          (SELECT COUNT(*)::int FROM "BuilderContact" bc WHERE bc."communityId" = c.id) AS "contactCount",
          (SELECT COUNT(*)::int FROM "CommunityFloorPlan" fp WHERE fp."communityId" = c.id) AS "floorPlanCount",
          (SELECT COUNT(*)::int FROM "Task" t WHERE t."communityId" = c.id AND t."status" NOT IN ('DONE', 'CANCELLED')) AS "openTaskCount"
        FROM "Community" c
        JOIN "Builder" b ON b.id = c."builderId"
        ${where}
        ORDER BY c."name" ASC`,
        ...params
      )
    } catch (e) {
      // Community table may not exist yet — fall back to BoltCommunity then Jobs
      try {
        const conditions: string[] = []
        const params: any[] = []
        let idx = 1

        if (search) {
          conditions.push(`(bc."name" ILIKE $${idx} OR bc."city" ILIKE $${idx})`)
          params.push(`%${search}%`)
          idx++
        }

        const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

        communities = await prisma.$queryRawUnsafe(
          `SELECT
            bc.id, bc.name, bc.city, bc.state, bc."boltId", bc."createdAt",
            (SELECT COUNT(*)::int FROM "Job" j WHERE j."community" = bc."name") AS "jobCount"
          FROM "BoltCommunity" bc
          ${where}
          ORDER BY bc."name" ASC`,
          ...params
        )
      } catch (e2) {
        // Fall back to distinct communities from Job table
        try {
          communities = await prisma.$queryRawUnsafe(
            `SELECT
              j."community" AS name,
              COUNT(*)::int AS "jobCount",
              MIN(j."createdAt") AS "createdAt"
            FROM "Job" j
            WHERE j."community" IS NOT NULL
            ${search ? `AND j."community" ILIKE $1` : ''}
            GROUP BY j."community"
            ORDER BY j."community" ASC`,
            ...(search ? [`%${search}%`] : [])
          )
        } catch {
          communities = []
        }
      }
    }

    return NextResponse.json({ communities })
  } catch (error: any) {
    console.error('Communities list error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST /api/ops/communities — Create a community
export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const body = await request.json()
    const { builderId, name, code, city, state, zip, address, county, totalLots, phase, division, notes } = body

    if (!builderId || !name) {
      return NextResponse.json({ error: 'builderId and name are required' }, { status: 400 })
    }

    const id = 'comm_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)

    const result: any[] = await prisma.$queryRawUnsafe(
      `INSERT INTO "Community" (
        "id", "builderId", "name", "code", "city", "state", "zip", "address",
        "county", "totalLots", "phase", "division", "notes", "createdAt", "updatedAt"
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW(), NOW())
      RETURNING *`,
      id, builderId, name, code || null, city || null, state || null, zip || null,
      address || null, county || null, totalLots ? parseInt(totalLots) : 0,
      phase || null, division || null, notes || null
    )

    // Mark builder as PRODUCTION type if creating their first community
    await prisma.$executeRawUnsafe(
      `UPDATE "Builder" SET "builderType" = 'PRODUCTION' WHERE "id" = $1 AND ("builderType" IS NULL OR "builderType" = 'CUSTOM')`,
      builderId
    )

    return NextResponse.json({ community: result[0] }, { status: 201 })
  } catch (error: any) {
    if (error.message?.includes('unique constraint')) {
      return NextResponse.json({ error: 'A community with this name already exists for this builder' }, { status: 409 })
    }
    console.error('Community create error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
