export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'

// GET /api/ops/contacts — List contacts (filterable by builderId, communityId)
export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const { searchParams } = new URL(request.url)
    const builderId = searchParams.get('builderId')
    const communityId = searchParams.get('communityId')
    const search = searchParams.get('search') || ''

    const conditions: string[] = ['bc."active" = true']
    const params: any[] = []
    let idx = 1

    if (builderId) {
      conditions.push(`bc."builderId" = $${idx}`)
      params.push(builderId)
      idx++
    }

    if (communityId) {
      conditions.push(`bc."communityId" = $${idx}`)
      params.push(communityId)
      idx++
    }

    if (search) {
      conditions.push(`(bc."firstName" ILIKE $${idx} OR bc."lastName" ILIKE $${idx} OR bc."email" ILIKE $${idx} OR bc."title" ILIKE $${idx})`)
      params.push(`%${search}%`)
      idx++
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

    const contacts = await prisma.$queryRawUnsafe(
      `SELECT bc.*,
              b."companyName" AS "builderName",
              c."name" AS "communityName"
       FROM "BuilderContact" bc
       JOIN "Builder" b ON b.id = bc."builderId"
       LEFT JOIN "Community" c ON c.id = bc."communityId"
       ${where}
       ORDER BY bc."isPrimary" DESC, bc."lastName" ASC
       LIMIT 100`,
      ...params
    )

    return NextResponse.json({ contacts })
  } catch (error: any) {
    console.error('Contacts list error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

// POST /api/ops/contacts — Create a contact
export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const body = await request.json()
    const { builderId, communityId, firstName, lastName, email, phone, mobile, title, role, isPrimary, receivesPO, receivesInvoice, notes } = body

    if (!builderId || !firstName || !lastName) {
      return NextResponse.json({ error: 'builderId, firstName, lastName required' }, { status: 400 })
    }

    const id = 'contact_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)

    const result: any[] = await prisma.$queryRawUnsafe(
      `INSERT INTO "BuilderContact" (
        "id", "builderId", "communityId", "firstName", "lastName", "email", "phone", "mobile",
        "title", "role", "isPrimary", "receivesPO", "receivesInvoice", "notes", "createdAt", "updatedAt"
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::"ContactRole", $11, $12, $13, $14, NOW(), NOW())
      RETURNING *`,
      id, builderId, communityId || null, firstName, lastName, email || null,
      phone || null, mobile || null, title || null, role || 'OTHER',
      isPrimary || false, receivesPO || false, receivesInvoice || false, notes || null
    )

    return NextResponse.json({ contact: result[0] }, { status: 201 })
  } catch (error: any) {
    console.error('Contact create error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
