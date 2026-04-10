export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'

// GET /api/ops/communities — List communities
// Uses BoltCommunity table (imported from Bolt Tech) since Community/BuilderOrganization/Division/FloorPlan don't exist
export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const { searchParams } = new URL(request.url)
    const search = searchParams.get('search') || ''

    // First try BoltCommunity (from Bolt import)
    let communities: any[] = []

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
          bc.id,
          bc.name,
          bc.city,
          bc.state,
          bc."boltId",
          bc."createdAt",
          (SELECT COUNT(*)::int FROM "Job" j WHERE j."community" = bc."name") as "jobCount"
        FROM "BoltCommunity" bc
        ${where}
        ORDER BY bc."name" ASC`,
        ...params
      )
    } catch (e) {
      // BoltCommunity table may not exist, try distinct communities from Job table
      try {
        const conditions: string[] = []
        const params: any[] = []
        let idx = 1

        if (search) {
          conditions.push(`j."community" ILIKE $${idx}`)
          params.push(`%${search}%`)
          idx++
        }

        const where = conditions.length > 0 ? `WHERE j."community" IS NOT NULL AND ${conditions.join(' AND ')}` : `WHERE j."community" IS NOT NULL`

        communities = await prisma.$queryRawUnsafe(
          `SELECT
            j."community" as name,
            COUNT(*)::int as "jobCount",
            MIN(j."createdAt") as "createdAt"
          FROM "Job" j
          ${where}
          GROUP BY j."community"
          ORDER BY j."community" ASC`,
          ...params
        )
      } catch (e2) {
        // No communities available
        communities = []
      }
    }

    return NextResponse.json({ communities })
  } catch (error: any) {
    console.error('Communities list error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST /api/ops/communities — Create a community (uses BoltCommunity table)
export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const body = await request.json()
    const { name, city, state } = body

    if (!name) {
      return NextResponse.json({ error: 'Community name is required' }, { status: 400 })
    }

    // Ensure BoltCommunity table exists
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "BoltCommunity" (
        id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        name TEXT NOT NULL,
        city TEXT,
        state TEXT,
        "boltId" TEXT,
        "createdAt" TIMESTAMPTZ DEFAULT NOW()
      )
    `)

    const id = 'comm_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)

    const result: any[] = await prisma.$queryRawUnsafe(
      `INSERT INTO "BoltCommunity" (id, name, city, state, "createdAt")
       VALUES ($1, $2, $3, $4, NOW())
       RETURNING *`,
      id, name, city || null, state || null
    )

    return NextResponse.json({ community: result[0] }, { status: 201 })
  } catch (error: any) {
    console.error('Community create error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
