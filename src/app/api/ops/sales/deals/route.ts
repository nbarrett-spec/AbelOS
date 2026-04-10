export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { logAudit } from '@/lib/audit'
import { executeWorkflows } from '@/lib/workflows'
import { checkStaffAuth } from '@/lib/api-auth'

// GET /api/ops/sales/deals — List deals with filters
export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const { searchParams } = new URL(request.url)
    const stage = searchParams.get('stage') || ''
    const ownerId = searchParams.get('ownerId') || ''
    const search = searchParams.get('search') || ''
    const page = parseInt(searchParams.get('page') || '1', 10)
    const limit = parseInt(searchParams.get('limit') || '20', 10)
    const offset = (page - 1) * limit

    let whereClause = `WHERE 1=1`
    const params: any[] = []
    let idx = 1

    if (stage) {
      whereClause += ` AND d."stage" = $${idx}::"DealStage"`
      params.push(stage)
      idx++
    }
    if (ownerId) {
      whereClause += ` AND d."ownerId" = $${idx}`
      params.push(ownerId)
      idx++
    }
    if (search) {
      whereClause += ` AND (d."companyName" ILIKE $${idx} OR d."contactName" ILIKE $${idx} OR d."dealNumber" ILIKE $${idx})`
      params.push(`%${search}%`)
      idx++
    }

    const deals: any[] = await prisma.$queryRawUnsafe(
      `SELECT d.*, s."firstName", s."lastName", s."email" AS "ownerEmail"
       FROM "Deal" d
       LEFT JOIN "Staff" s ON s."id" = d."ownerId"
       ${whereClause}
       ORDER BY d."createdAt" DESC
       LIMIT $${idx} OFFSET $${idx + 1}`,
      ...params,
      limit,
      offset
    )

    const countResult: any[] = await prisma.$queryRawUnsafe(
      `SELECT COUNT(*)::int AS cnt FROM "Deal" d ${whereClause}`,
      ...params.slice(0, params.length - 0)
    )
    const total = countResult[0]?.cnt || 0

    // Enrich deals with owner info
    for (const deal of deals) {
      deal.owner = {
        id: deal.ownerId,
        firstName: deal.firstName,
        lastName: deal.lastName,
        email: deal.ownerEmail,
      }
    }

    return NextResponse.json({ deals, pagination: { page, limit, total, pages: Math.ceil(total / limit) } })
  } catch (error: any) {
    console.error(error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST /api/ops/sales/deals — Create new deal
export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const staffId = request.headers.get('x-staff-id')
    if (!staffId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { companyName, contactName, contactEmail, contactPhone, address, city, state, zip, stage, probability, dealValue, source, expectedCloseDate, description } = body
    const ownerId = body.ownerId || staffId

    if (!companyName || !contactName) {
      return NextResponse.json({ error: 'companyName and contactName are required' }, { status: 400 })
    }

    // Generate deal number - sequential format "DEAL-2026-XXXX"
    const countResult: any[] = await prisma.$queryRawUnsafe(
      `SELECT COUNT(*)::int AS cnt FROM "Deal"`
    )
    const cnt = (countResult[0]?.cnt || 0) + 1
    const dealNumber = `DEAL-${new Date().getFullYear()}-${String(cnt).padStart(4, '0')}`

    // Generate a cuid-like ID
    const idChars = 'abcdefghijklmnopqrstuvwxyz0123456789'
    let dealId = 'c' + Date.now().toString(36)
    for (let i = 0; i < 8; i++) dealId += idChars[Math.floor(Math.random() * idChars.length)]

    const dealResult: any[] = await prisma.$queryRawUnsafe(
      `INSERT INTO "Deal" (
        "id", "dealNumber", "companyName", "contactName", "contactEmail", "contactPhone",
        "address", "city", "state", "zip", "stage", "probability", "dealValue",
        "source", "expectedCloseDate", "ownerId", "description", "createdAt", "updatedAt"
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::"DealStage", $12, $13, $14::"DealSource", $15, $16, $17, NOW(), NOW())
       RETURNING *`,
      dealId,
      dealNumber,
      companyName,
      contactName,
      contactEmail || null,
      contactPhone || null,
      address || null,
      city || null,
      state || null,
      zip || null,
      stage || 'PROSPECT',
      probability || 10,
      dealValue || 0,
      source || 'OUTBOUND',
      expectedCloseDate ? new Date(expectedCloseDate) : null,
      ownerId,
      description || null
    )

    const deal = dealResult[0]

    // Fetch owner info
    const owner: any[] = await prisma.$queryRawUnsafe(
      `SELECT "id", "firstName", "lastName", "email" FROM "Staff" WHERE "id" = $1`,
      ownerId
    )

    deal.owner = owner[0] || { id: ownerId }

    // Audit log + workflow trigger (fire-and-forget)
    logAudit({ staffId, action: 'CREATE', entity: 'Deal', entityId: dealId, details: { dealNumber, companyName, source: source || 'OUTBOUND', dealValue: dealValue || 0 } }).catch(() => {})
    executeWorkflows('DEAL_CREATED', { dealId, staffId, dealData: deal }).catch(() => {})

    return NextResponse.json(deal, { status: 201 })
  } catch (error: any) {
    console.error(error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
