export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'
import { audit } from '@/lib/audit'

export async function GET(request: NextRequest) {
  const authResponse = checkStaffAuth(request)
  if (authResponse !== null) return authResponse

  try {
    const searchParams = request.nextUrl.searchParams
    const organizationId = searchParams.get('organizationId') || undefined
    const search = searchParams.get('search') || undefined
    const page = Math.max(1, parseInt(searchParams.get('page') || '1'))
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '50')))

    // Build WHERE clause with parameterized queries
    const divConditions: string[] = []
    const divParams: any[] = []
    let divIdx = 1

    if (organizationId) {
      divConditions.push(`d."organizationId" = $${divIdx}`)
      divParams.push(organizationId)
      divIdx++
    }
    if (search) {
      divConditions.push(`(d."name" ILIKE $${divIdx} OR d."code" ILIKE $${divIdx} OR d."region" ILIKE $${divIdx})`)
      divParams.push(`%${search}%`)
      divIdx++
    }

    const whereSQL = divConditions.length > 0 ? `WHERE ${divConditions.join(' AND ')}` : ''

    // Get total count
    const countResult = await prisma.$queryRawUnsafe<[{ count: number }]>(
      `SELECT COUNT(*)::int as count FROM "Division" d ${whereSQL}`, ...divParams
    )
    const total = countResult[0]?.count || 0

    // Get paginated divisions with counts
    const offset = (page - 1) * limit
    const divisions = await prisma.$queryRawUnsafe<any[]>(
      `SELECT d.*, bo."name" as "orgName", bo."code" as "orgCode",
        (SELECT COUNT(*)::int FROM "Community" c WHERE c."divisionId" = d."id") as "communityCount",
        (SELECT COUNT(*)::int FROM "Builder" b WHERE b."divisionId" = d."id") as "builderCount"
      FROM "Division" d
      JOIN "BuilderOrganization" bo ON d."organizationId" = bo."id"
      ${whereSQL}
      ORDER BY d."name" ASC
      LIMIT $${divIdx} OFFSET $${divIdx + 1}`,
      ...divParams, limit, offset
    )

    const pages = Math.ceil(total / limit)

    return NextResponse.json({
      divisions,
      pagination: {
        page,
        limit,
        total,
        pages
      }
    })
  } catch (error) {
    console.error('GET /api/ops/divisions error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch divisions' },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  const authResponse = checkStaffAuth(request)
  if (authResponse !== null) return authResponse

  try {
    // Audit log
    audit(request, 'CREATE', 'Divisions', undefined, { method: 'POST' }).catch(() => {})

    const body = await request.json()

    // Validate required fields
    if (!body.organizationId || !body.name) {
      return NextResponse.json(
        { error: 'Missing required fields: organizationId, name' },
        { status: 400 }
      )
    }

    // Build INSERT statement
    const id = await prisma.$queryRawUnsafe<[{ id: string }]>(
      `SELECT gen_random_uuid()::text as id`
    )
    const divisionId = id[0].id

    const values = [
      divisionId,
      body.organizationId,
      body.name,
      body.code || null,
      body.region || null,
      body.contactName || null,
      body.email || null,
      body.phone || null,
      body.address || null,
      body.city || null,
      body.state || null,
      body.zip || null,
      body.defaultPaymentTerm || null,
      body.creditLimit || null,
      body.taxExempt !== undefined ? body.taxExempt : null,
      body.taxId || null,
      true, // active default
      body.notes || null,
      new Date(),
      new Date()
    ]

    const placeholders = Array.from({ length: values.length }, (_, i) => `$${i + 1}`).join(',')

    await prisma.$executeRawUnsafe(
      `INSERT INTO "Division" ("id", "organizationId", "name", "code", "region", "contactName", "email", "phone", "address", "city", "state", "zip", "defaultPaymentTerm", "creditLimit", "taxExempt", "taxId", "active", "notes", "createdAt", "updatedAt")
       VALUES (${placeholders})`,
      ...values
    )

    // Fetch created division with counts
    const created = await prisma.$queryRawUnsafe<
      Array<{
        id: string
        organizationId: string
        name: string
        code: string | null
        region: string | null
        contactName: string | null
        email: string | null
        phone: string | null
        address: string | null
        city: string | null
        state: string | null
        zip: string | null
        defaultPaymentTerm: string | null
        creditLimit: number | null
        taxExempt: boolean | null
        taxId: string | null
        active: boolean
        notes: string | null
        createdAt: Date
        updatedAt: Date
        orgName: string
        orgCode: string
        communityCount: number
        builderCount: number
      }>
    >(
      `
      SELECT d.*, bo."name" as "orgName", bo."code" as "orgCode",
        (SELECT COUNT(*)::int FROM "Community" c WHERE c."divisionId" = d."id") as "communityCount",
        (SELECT COUNT(*)::int FROM "Builder" b WHERE b."divisionId" = d."id") as "builderCount"
      FROM "Division" d
      JOIN "BuilderOrganization" bo ON d."organizationId" = bo."id"
      WHERE d."id" = '${divisionId}'
      `
    )

    return NextResponse.json(created[0], { status: 201 })
  } catch (error) {
    console.error('POST /api/ops/divisions error:', error)
    return NextResponse.json(
      { error: 'Failed to create division' },
      { status: 500 }
    )
  }
}

export async function PATCH(request: NextRequest) {
  const authResponse = checkStaffAuth(request)
  if (authResponse !== null) return authResponse

  try {
    // Audit log
    audit(request, 'UPDATE', 'Divisions', undefined, { method: 'PATCH' }).catch(() => {})

    const body = await request.json()

    if (!body.id) {
      return NextResponse.json(
        { error: 'Missing required field: id' },
        { status: 400 }
      )
    }

    // Build dynamic SET clause
    const updateFields: string[] = []
    const values: unknown[] = []
    let paramCount = 1

    const updatableFields = [
      'organizationId',
      'name',
      'code',
      'region',
      'contactName',
      'email',
      'phone',
      'address',
      'city',
      'state',
      'zip',
      'defaultPaymentTerm',
      'creditLimit',
      'taxExempt',
      'taxId',
      'notes',
      'active'
    ]

    for (const field of updatableFields) {
      if (field in body) {
        updateFields.push(`"${field}" = $${paramCount}`)
        values.push(body[field] !== undefined ? body[field] : null)
        paramCount++
      }
    }

    if (updateFields.length === 0) {
      return NextResponse.json(
        { error: 'No fields to update' },
        { status: 400 }
      )
    }

    // Add updatedAt
    updateFields.push(`"updatedAt" = NOW()`)

    const setClause = updateFields.join(', ')
    values.push(body.id)

    await prisma.$executeRawUnsafe(
      `UPDATE "Division" SET ${setClause} WHERE "id" = $${paramCount}`,
      ...values
    )

    // Fetch updated division with counts
    const updated = await prisma.$queryRawUnsafe<
      Array<{
        id: string
        organizationId: string
        name: string
        code: string | null
        region: string | null
        contactName: string | null
        email: string | null
        phone: string | null
        address: string | null
        city: string | null
        state: string | null
        zip: string | null
        defaultPaymentTerm: string | null
        creditLimit: number | null
        taxExempt: boolean | null
        taxId: string | null
        active: boolean
        notes: string | null
        createdAt: Date
        updatedAt: Date
        orgName: string
        orgCode: string
        communityCount: number
        builderCount: number
      }>
    >(
      `
      SELECT d.*, bo."name" as "orgName", bo."code" as "orgCode",
        (SELECT COUNT(*)::int FROM "Community" c WHERE c."divisionId" = d."id") as "communityCount",
        (SELECT COUNT(*)::int FROM "Builder" b WHERE b."divisionId" = d."id") as "builderCount"
      FROM "Division" d
      JOIN "BuilderOrganization" bo ON d."organizationId" = bo."id"
      WHERE d."id" = '${body.id}'
      `
    )

    if (updated.length === 0) {
      return NextResponse.json(
        { error: 'Division not found' },
        { status: 404 }
      )
    }

    return NextResponse.json(updated[0])
  } catch (error) {
    console.error('PATCH /api/ops/divisions error:', error)
    return NextResponse.json(
      { error: 'Failed to update division' },
      { status: 500 }
    )
  }
}
