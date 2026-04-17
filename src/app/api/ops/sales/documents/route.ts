export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'
import { audit } from '@/lib/audit'

// GET /api/ops/sales/documents — List document requests with filters
export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const { searchParams } = new URL(request.url)
    const status = searchParams.get('status') || ''
    const dealId = searchParams.get('dealId') || ''
    const builderId = searchParams.get('builderId') || ''
    const documentType = searchParams.get('documentType') || ''
    const page = parseInt(searchParams.get('page') || '1', 10)
    const limit = parseInt(searchParams.get('limit') || '20', 10)
    const offset = (page - 1) * limit

    let whereClause = `WHERE 1=1`
    const params: any[] = []
    let idx = 1

    if (status) {
      whereClause += ` AND dr."status" = $${idx}::"DocumentRequestStatus"`
      params.push(status)
      idx++
    }
    if (dealId) {
      whereClause += ` AND dr."dealId" = $${idx}`
      params.push(dealId)
      idx++
    }
    if (builderId) {
      whereClause += ` AND dr."builderId" = $${idx}`
      params.push(builderId)
      idx++
    }
    if (documentType) {
      whereClause += ` AND dr."documentType" = $${idx}::"DocumentType"`
      params.push(documentType)
      idx++
    }

    const documents: any[] = await prisma.$queryRawUnsafe(
      `SELECT dr.*, rb."firstName" AS "requestedByFirstName", rb."lastName" AS "requestedByLastName",
              d."companyName" AS "dealCompanyName", d."dealNumber"
       FROM "DocumentRequest" dr
       LEFT JOIN "Staff" rb ON rb."id" = dr."requestedById"
       LEFT JOIN "Deal" d ON d."id" = dr."dealId"
       ${whereClause}
       ORDER BY dr."createdAt" DESC
       LIMIT $${idx} OFFSET $${idx + 1}`,
      ...params,
      limit,
      offset
    )

    const countResult: any[] = await prisma.$queryRawUnsafe(
      `SELECT COUNT(*)::int AS cnt FROM "DocumentRequest" dr ${whereClause}`,
      ...params.slice(0, params.length - 0)
    )
    const total = countResult[0]?.cnt || 0

    // Enrich with related info
    for (const doc of documents) {
      doc.requestedBy = {
        id: doc.requestedById,
        firstName: doc.requestedByFirstName,
        lastName: doc.requestedByLastName,
      }
      if (doc.dealId) {
        doc.deal = {
          id: doc.dealId,
          companyName: doc.dealCompanyName,
          dealNumber: doc.dealNumber,
        }
      }
    }

    return NextResponse.json({ documents, pagination: { page, limit, total, pages: Math.ceil(total / limit) } })
  } catch (error: any) {
    console.error(error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST /api/ops/sales/documents — Create document request
export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    // Audit log
    audit(request, 'CREATE', 'Sales', undefined, { method: 'POST' }).catch(() => {})

    const staffId = request.headers.get('x-staff-id')
    if (!staffId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { documentType, title, dealId, builderId, description, dueDate, expiresDate, notes } = body

    if (!documentType || !title || (!dealId && !builderId)) {
      return NextResponse.json({ error: 'documentType, title, and either dealId or builderId are required' }, { status: 400 })
    }

    const docResult: any[] = await prisma.$queryRawUnsafe(
      `INSERT INTO "DocumentRequest" (
        "documentType", "title", "dealId", "builderId", "description",
        "status", "requestedById", "dueDate", "expiresDate", "notes", "createdAt"
       ) VALUES ($1::"DocumentType", $2, $3, $4, $5, $6::"DocumentRequestStatus", $7, $8, $9, $10, NOW())
       RETURNING *`,
      documentType,
      title,
      dealId || null,
      builderId || null,
      description || null,
      'PENDING',
      staffId,
      dueDate ? new Date(dueDate) : null,
      expiresDate ? new Date(expiresDate) : null,
      notes || null
    )

    const doc = docResult[0]

    // Fetch requester info
    const requester: any[] = await prisma.$queryRawUnsafe(
      `SELECT "id", "firstName", "lastName" FROM "Staff" WHERE "id" = $1`,
      staffId
    )

    doc.requestedBy = requester[0] || { id: staffId }

    return NextResponse.json(doc, { status: 201 })
  } catch (error: any) {
    console.error(error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
