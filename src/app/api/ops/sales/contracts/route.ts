export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'

// GET /api/ops/sales/contracts — List contracts with filters
export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const { searchParams } = new URL(request.url)
    const status = searchParams.get('status') || ''
    const dealId = searchParams.get('dealId') || ''
    const builderId = searchParams.get('builderId') || ''
    const page = parseInt(searchParams.get('page') || '1', 10)
    const limit = parseInt(searchParams.get('limit') || '20', 10)
    const offset = (page - 1) * limit

    let whereClause = `WHERE 1=1`
    const params: any[] = []
    let idx = 1

    if (status) {
      whereClause += ` AND c."status" = $${idx}::"ContractStatus"`
      params.push(status)
      idx++
    }
    if (dealId) {
      whereClause += ` AND c."dealId" = $${idx}`
      params.push(dealId)
      idx++
    }
    if (builderId) {
      whereClause += ` AND c."builderId" = $${idx}`
      params.push(builderId)
      idx++
    }

    const contracts: any[] = await prisma.$queryRawUnsafe(
      `SELECT c.*, cb."firstName" AS "createdByFirstName", cb."lastName" AS "createdByLastName",
              d."companyName" AS "dealCompanyName", d."dealNumber"
       FROM "Contract" c
       LEFT JOIN "Staff" cb ON cb."id" = c."createdById"
       LEFT JOIN "Deal" d ON d."id" = c."dealId"
       ${whereClause}
       ORDER BY c."createdAt" DESC
       LIMIT $${idx} OFFSET $${idx + 1}`,
      ...params,
      limit,
      offset
    )

    const countResult: any[] = await prisma.$queryRawUnsafe(
      `SELECT COUNT(*)::int AS cnt FROM "Contract" c ${whereClause}`,
      ...params.slice(0, params.length - 0)
    )
    const total = countResult[0]?.cnt || 0

    // Enrich with related info
    for (const contract of contracts) {
      contract.createdBy = {
        id: contract.createdById,
        firstName: contract.createdByFirstName,
        lastName: contract.createdByLastName,
      }
      if (contract.dealId) {
        contract.deal = {
          id: contract.dealId,
          companyName: contract.dealCompanyName,
          dealNumber: contract.dealNumber,
        }
      }
    }

    return NextResponse.json({ contracts, pagination: { page, limit, total, pages: Math.ceil(total / limit) } })
  } catch (error: any) {
    console.error(error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST /api/ops/sales/contracts — Create contract
export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const staffId = request.headers.get('x-staff-id')
    if (!staffId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { title, dealId, builderId, type, paymentTerm, creditLimit, estimatedAnnual, discountPercent, terms, specialClauses, startDate, endDate } = body

    if (!title || (!dealId && !builderId)) {
      return NextResponse.json({ error: 'title and either dealId or builderId are required' }, { status: 400 })
    }

    // Generate contract number - sequential format "CTR-2026-XXXX"
    const countResult: any[] = await prisma.$queryRawUnsafe(
      `SELECT COUNT(*)::int AS cnt FROM "Contract"`
    )
    const cnt = (countResult[0]?.cnt || 0) + 1
    const contractNumber = `CTR-${new Date().getFullYear()}-${String(cnt).padStart(4, '0')}`

    const contractResult: any[] = await prisma.$queryRawUnsafe(
      `INSERT INTO "Contract" (
        "contractNumber", "title", "dealId", "builderId", "type", "status",
        "paymentTerm", "creditLimit", "estimatedAnnual", "discountPercent",
        "terms", "specialClauses", "startDate", "endDate", "createdById", "createdAt"
       ) VALUES ($1, $2, $3, $4, $5::"ContractType", $6::"ContractStatus",
                 $7::"PaymentTerm", $8, $9, $10, $11, $12, $13, $14, $15, NOW())
       RETURNING *`,
      contractNumber,
      title,
      dealId || null,
      builderId || null,
      type || 'SUPPLY_AGREEMENT',
      'DRAFT',
      paymentTerm || null,
      creditLimit || null,
      estimatedAnnual || null,
      discountPercent || null,
      terms || null,
      specialClauses || null,
      startDate ? new Date(startDate) : null,
      endDate ? new Date(endDate) : null,
      staffId
    )

    const contract = contractResult[0]

    // Fetch creator info
    const creator: any[] = await prisma.$queryRawUnsafe(
      `SELECT "id", "firstName", "lastName" FROM "Staff" WHERE "id" = $1`,
      staffId
    )

    contract.createdBy = creator[0] || { id: staffId }

    return NextResponse.json(contract, { status: 201 })
  } catch (error: any) {
    console.error(error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
