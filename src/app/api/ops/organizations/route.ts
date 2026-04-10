export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'

// GET /api/ops/organizations — List all builder organizations with stats
export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const { searchParams } = new URL(request.url)
    const search = searchParams.get('search') || ''
    const type = searchParams.get('type') || ''
    const page = parseInt(searchParams.get('page') || '1')
    const limit = parseInt(searchParams.get('limit') || '50')
    const offset = (page - 1) * limit

    let whereClause = `WHERE o."active" = true`
    const params: any[] = []
    let paramIdx = 1

    if (search) {
      whereClause += ` AND (o."name" ILIKE $${paramIdx} OR o."code" ILIKE $${paramIdx})`
      params.push(`%${search}%`)
      paramIdx++
    }
    if (type) {
      whereClause += ` AND o."type" = $${paramIdx}::"OrgType"`
      params.push(type)
      paramIdx++
    }

    const limitParamIdx = paramIdx
    params.push(limit)
    paramIdx++
    const offsetParamIdx = paramIdx
    params.push(offset)
    paramIdx++

    const orgsQuery = `
      SELECT o.*,
        (SELECT COUNT(*) FROM "Builder" b WHERE b."organizationId" = o."id")::int AS "builderCount",
        (SELECT COUNT(*) FROM "Community" c WHERE c."organizationId" = o."id")::int AS "communityCount",
        (SELECT COUNT(*) FROM "Contract" ct WHERE ct."organizationId" = o."id")::int AS "contractCount",
        (SELECT COUNT(*)::int FROM "Division" d WHERE d."organizationId" = o."id") as "divisionCount"
      FROM "BuilderOrganization" o
      ${whereClause}
      ORDER BY o."name" ASC
      LIMIT $${limitParamIdx} OFFSET $${offsetParamIdx}
    `

    const countParams = params.slice(0, -2) // exclude limit/offset
    const countQuery = `SELECT COUNT(*)::int AS total FROM "BuilderOrganization" o ${whereClause}`

    const [organizations, countResult] = await Promise.all([
      prisma.$queryRawUnsafe(orgsQuery, ...params),
      prisma.$queryRawUnsafe(countQuery, ...countParams),
    ]) as [any[], any[]]

    // Get communities, contracts, and divisions for each org
    for (const org of organizations) {
      const communities: any[] = await prisma.$queryRawUnsafe(
        `SELECT "id", "name", "activeLots" FROM "Community" WHERE "organizationId" = $1 AND "active" = true ORDER BY "name" ASC`,
        org.id
      )
      const contracts: any[] = await prisma.$queryRawUnsafe(
        `SELECT "id", "contractNumber", "title", "expirationDate" FROM "Contract" WHERE "organizationId" = $1 AND "status" = 'ACTIVE' ORDER BY "createdAt" DESC LIMIT 3`,
        org.id
      )
      const divisions: any[] = await prisma.$queryRawUnsafe(
        `SELECT d."id", d."name", d."code", d."region", d."city", d."state", d."active",
          (SELECT COUNT(*)::int FROM "Community" c WHERE c."divisionId" = d."id") as "communityCount",
          (SELECT COUNT(*)::int FROM "Builder" b WHERE b."divisionId" = d."id") as "builderCount"
        FROM "Division" d
        WHERE d."organizationId" = $1
        ORDER BY d."name" ASC
        LIMIT 20`,
        org.id
      )
      org.communities = communities
      org.contracts = contracts
      org.divisions = divisions
      org._count = {
        builders: org.builderCount,
        communities: org.communityCount,
        contracts: org.contractCount,
      }
    }

    const total = countResult[0]?.total || 0

    return NextResponse.json({
      organizations,
      total,
      page,
      totalPages: Math.ceil(total / limit),
    })
  } catch (error: any) {
    console.error('Organizations list error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST /api/ops/organizations — Create a new builder organization
export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const body = await request.json()
    const { name, code, type, contactName, email, phone, address, city, state, zip, defaultPaymentTerm, creditLimit, taxExempt, taxId, notes } = body

    if (!name || !code) {
      return NextResponse.json({ error: 'Name and code are required' }, { status: 400 })
    }

    // Check for duplicates
    const existing: any[] = await prisma.$queryRawUnsafe(
      `SELECT "id" FROM "BuilderOrganization" WHERE "name" = $1 OR "code" = $2 LIMIT 1`,
      name, code.toUpperCase()
    )
    if (existing.length > 0) {
      return NextResponse.json({ error: 'Organization with this name or code already exists' }, { status: 409 })
    }

    const orgResult: any[] = await prisma.$queryRawUnsafe(
      `INSERT INTO "BuilderOrganization" ("name", "code", "type", "contactName", "email", "phone", "address", "city", "state", "zip", "defaultPaymentTerm", "creditLimit", "taxExempt", "taxId", "notes")
       VALUES ($1, $2, $3::"OrgType", $4, $5, $6, $7, $8, $9, $10, $11::"PaymentTerm", $12, $13, $14, $15)
       RETURNING *`,
      name,
      code.toUpperCase(),
      type || 'NATIONAL',
      contactName || null,
      email || null,
      phone || null,
      address || null,
      city || null,
      state || null,
      zip || null,
      defaultPaymentTerm || 'NET_30',
      creditLimit || null,
      taxExempt || false,
      taxId || null,
      notes || null
    )

    return NextResponse.json(orgResult[0], { status: 201 })
  } catch (error: any) {
    console.error('Organization create error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
