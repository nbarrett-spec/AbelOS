export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

// Helper to generate unique ID
function generateUniqueId(prefix: string): string {
  return prefix + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

// GET: Return existing HomeownerAccess records for this project
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getSession()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const projectId = params.id

    // Verify builder owns this project
    const projects: any[] = await prisma.$queryRawUnsafe(
      `SELECT "id", "builderId" FROM "Project" WHERE "id" = $1 LIMIT 1`,
      projectId
    )

    if (!projects[0] || projects[0].builderId !== session.builderId) {
      return NextResponse.json(
        { error: 'Project not found or access denied' },
        { status: 404 }
      )
    }

    // Get all HomeownerAccess records with selection counts
    const homeownerAccesses: any[] = await prisma.$queryRawUnsafe(
      `SELECT ha."id", ha."name", ha."email", ha."phone", ha."accessToken",
              ha."active", ha."createdAt", ha."expiresAt", ha."lastVisitAt",
              (SELECT COUNT(*)::int FROM "HomeownerSelection" hs WHERE hs."homeownerAccessId" = ha."id") AS "selectionCount"
       FROM "HomeownerAccess" ha
       WHERE ha."projectId" = $1
       ORDER BY ha."createdAt" DESC`,
      projectId
    )

    // Map to expected format
    const formatted = homeownerAccesses.map(ha => ({
      ...ha,
      _count: { selections: ha.selectionCount },
    }))

    return NextResponse.json({ homeownerAccesses: formatted })
  } catch (error) {
    console.error('Error fetching homeowner accesses:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

// POST: Create a new homeowner access token
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getSession()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const projectId = params.id
    const { name, email, phone } = await request.json()

    // Validate required fields
    if (!name || !email) {
      return NextResponse.json(
        { error: 'Name and email are required' },
        { status: 400 }
      )
    }

    // Verify builder owns this project
    const projects: any[] = await prisma.$queryRawUnsafe(
      `SELECT "id", "builderId" FROM "Project" WHERE "id" = $1 LIMIT 1`,
      projectId
    )

    if (!projects[0] || projects[0].builderId !== session.builderId) {
      return NextResponse.json(
        { error: 'Project not found or access denied' },
        { status: 404 }
      )
    }

    // Generate unique access token
    const accessToken = generateUniqueId('homeowner')
    const id = generateUniqueId('ha')

    // Create HomeownerAccess record
    await prisma.$executeRawUnsafe(
      `INSERT INTO "HomeownerAccess" ("id", "builderId", "projectId", "name", "email", "phone", "accessToken", "active", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, $6, $7, true, NOW(), NOW())`,
      id,
      session.builderId,
      projectId,
      name,
      email,
      phone || null,
      accessToken
    )

    // Return the access URL
    const baseUrl = request.headers.get('origin') || process.env.NEXT_PUBLIC_APP_URL || ''
    const accessUrl = `${baseUrl}/homeowner/${accessToken}`

    return NextResponse.json(
      {
        homeownerAccess: {
          id,
          name,
          email,
          phone: phone || null,
          accessToken,
          active: true,
          createdAt: new Date().toISOString(),
        },
        accessUrl,
      },
      { status: 201 }
    )
  } catch (error) {
    console.error('Error creating homeowner access:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
