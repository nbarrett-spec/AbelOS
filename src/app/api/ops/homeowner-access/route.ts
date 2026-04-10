export const dynamic = 'force-dynamic'
import { prisma } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'

// GET: List all homeowner access entries
export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const searchParams = request.nextUrl.searchParams
    const builderId = searchParams.get('builderId')
    const projectId = searchParams.get('projectId')
    const search = searchParams.get('search')

    let query = `
      SELECT
        ha.id,
        ha."builderId",
        ha."projectId",
        ha.name as "homeownerName",
        ha.email as "homeownerEmail",
        ha.phone as "homeownerPhone",
        ha."accessToken",
        ha.active,
        ha."expiresAt",
        ha."lastVisitAt",
        ha."createdAt",
        b."companyName" as "builderName",
        p.name as "projectName",
        p."jobAddress" as "projectAddress",
        (SELECT COUNT(*)::int FROM "HomeownerSelection" hs WHERE hs."homeownerId" = ha.id) as "selectionCount",
        (SELECT COUNT(*)::int FROM "HomeownerSelection" hs WHERE hs."homeownerId" = ha.id AND hs."selectedProductId" IS NOT NULL AND hs."selectedProductId" != hs."baseProductId") as "upgradeCount"
      FROM "HomeownerAccess" ha
      LEFT JOIN "Builder" b ON ha."builderId" = b.id
      LEFT JOIN "Project" p ON ha."projectId" = p.id
      WHERE 1=1
    `

    const params: any[] = []
    let paramIndex = 1

    if (builderId) {
      query += ` AND ha."builderId" = $${paramIndex++}`
      params.push(builderId)
    }

    if (projectId) {
      query += ` AND ha."projectId" = $${paramIndex++}`
      params.push(projectId)
    }

    if (search) {
      query += ` AND (ha.name ILIKE $${paramIndex} OR ha.email ILIKE $${paramIndex} OR b."companyName" ILIKE $${paramIndex} OR p.name ILIKE $${paramIndex})`
      params.push(`%${search}%`)
      paramIndex++
    }

    query += ` ORDER BY ha."createdAt" DESC`

    const results: any[] = await prisma.$queryRawUnsafe(query, ...params)

    return NextResponse.json({
      accessEntries: results,
      total: results.length,
    })
  } catch (error: any) {
    console.error('GET /api/ops/homeowner-access error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch homeowner access entries', details: error?.message },
      { status: 500 }
    )
  }
}

// POST: Create a new homeowner access code
export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const body = await request.json()
    const { builderId, projectId, name, email, phone, expiresInDays } = body

    if (!builderId || !projectId || !name || !email) {
      return NextResponse.json(
        { error: 'Missing required fields: builderId, projectId, name, email' },
        { status: 400 }
      )
    }

    // Generate a short, easy-to-share access code
    const code = generateAccessCode()
    const id = crypto.randomUUID()
    const now = new Date().toISOString()
    const expiresAt = expiresInDays
      ? new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000).toISOString()
      : null

    await prisma.$executeRawUnsafe(
      `INSERT INTO "HomeownerAccess" (
        id, "builderId", "projectId", name, email, phone, "accessToken", active, "expiresAt", "createdAt"
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, true, $8, $9)`,
      id,
      builderId,
      projectId,
      name,
      email,
      phone || null,
      code,
      expiresAt,
      now
    )

    // Create default selections for common rooms if product catalog exists
    try {
      const defaultRooms = ['Living Room', 'Master Bedroom', 'Kitchen', 'Bathroom', 'Hallway', 'Guest Bedroom']
      for (const room of defaultRooms) {
        const selId = crypto.randomUUID()
        await prisma.$executeRawUnsafe(
          `INSERT INTO "HomeownerSelection" (id, "homeownerId", "roomName", "category", status, "createdAt", "updatedAt")
           VALUES ($1, $2, $3, 'INTERIOR_DOORS', 'PENDING', $4, $5)`,
          selId, id, room, now, now
        )
      }
    } catch {
      // Selections may fail if table schema differs — non-critical
    }

    return NextResponse.json({
      id,
      accessToken: code,
      portalUrl: `/homeowner/${code}`,
      name,
      email,
      builderId,
      projectId,
    }, { status: 201 })
  } catch (error: any) {
    console.error('POST /api/ops/homeowner-access error:', error)
    return NextResponse.json(
      { error: 'Failed to create homeowner access', details: error?.message },
      { status: 500 }
    )
  }
}

// PATCH: Update homeowner access (activate/deactivate, extend expiry)
export async function PATCH(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const body = await request.json()
    const { id, active, expiresInDays, regenerateToken } = body

    if (!id) {
      return NextResponse.json({ error: 'Missing required field: id' }, { status: 400 })
    }

    const now = new Date().toISOString()
    const setClauses: string[] = []
    const params: any[] = []
    let paramIndex = 1

    if (active !== undefined) {
      setClauses.push(`active = $${paramIndex++}`)
      params.push(active)
    }

    if (expiresInDays !== undefined) {
      setClauses.push(`"expiresAt" = $${paramIndex++}`)
      params.push(expiresInDays ? new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000).toISOString() : null)
    }

    if (regenerateToken) {
      setClauses.push(`"accessToken" = $${paramIndex++}`)
      params.push(generateAccessCode())
    }

    if (setClauses.length === 0) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 })
    }

    params.push(id)
    await prisma.$executeRawUnsafe(
      `UPDATE "HomeownerAccess" SET ${setClauses.join(', ')} WHERE id = $${paramIndex}`,
      ...params
    )

    // Fetch updated record
    const result: any[] = await prisma.$queryRawUnsafe(
      `SELECT id, "accessToken", name, email, active, "expiresAt" FROM "HomeownerAccess" WHERE id = $1`,
      id
    )

    return NextResponse.json(result?.[0] || null)
  } catch (error: any) {
    console.error('PATCH /api/ops/homeowner-access error:', error)
    return NextResponse.json(
      { error: 'Failed to update homeowner access', details: error?.message },
      { status: 500 }
    )
  }
}

function generateAccessCode(): string {
  // Generate a short, easy-to-share code like ABEL-XXXX-XXXX
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // No confusing chars (0/O, 1/I/L)
  let code = 'ABEL-'
  for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)]
  code += '-'
  for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)]
  return code
}
