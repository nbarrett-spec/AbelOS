export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'

interface EmailQueueItem {
  id: string
  to: string
  subject: string
  body: string
  templateId: string | null
  status: string
  attempts: number
  lastError: string | null
  scheduledFor: Date
  sentAt: Date | null
  dealId: string | null
  staffId: string
  createdAt: Date
}

// GET /api/ops/email — List email queue with filters
export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const searchParams = request.nextUrl.searchParams

    // Parse query parameters
    const status = searchParams.get('status')
    const staffId = searchParams.get('staffId')
    const dealId = searchParams.get('dealId')
    const page = Math.max(1, parseInt(searchParams.get('page') || '1'))
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '50')))

    // Build WHERE clause filters
    const whereConditions: string[] = []
    const params: any[] = []
    let paramIndex = 1

    if (status) {
      whereConditions.push(`"status" = $${paramIndex}`)
      params.push(status)
      paramIndex++
    }

    if (staffId) {
      whereConditions.push(`"staffId" = $${paramIndex}`)
      params.push(staffId)
      paramIndex++
    }

    if (dealId) {
      whereConditions.push(`"dealId" = $${paramIndex}`)
      params.push(dealId)
      paramIndex++
    }

    const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : ''

    // Get total count
    const countQuery = `
      SELECT COUNT(*)::int as count
      FROM "EmailQueue"
      ${whereClause}
    `
    const countResult = await prisma.$queryRawUnsafe(countQuery, ...params)
    const total = Number((countResult as any[])[0].count)
    const totalPages = Math.ceil(total / limit)

    // Get paginated emails
    const offset = (page - 1) * limit
    const listQuery = `
      SELECT
        "id",
        "to",
        "subject",
        "body",
        "templateId",
        "status",
        "attempts",
        "lastError",
        "scheduledFor",
        "sentAt",
        "dealId",
        "staffId",
        "createdAt"
      FROM "EmailQueue"
      ${whereClause}
      ORDER BY "createdAt" DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `

    const listParams = [...params, limit, offset]
    const emails = await prisma.$queryRawUnsafe(listQuery, ...listParams)

    return NextResponse.json({
      emails: emails || [],
      total,
      page,
      totalPages,
    })
  } catch (error) {
    console.error('Email queue retrieval error:', error)
    return NextResponse.json(
      { error: 'Failed to retrieve email queue', emails: [], total: 0, page: 1, totalPages: 0 },
      { status: 500 }
    )
  }
}

// POST /api/ops/email — Queue a new email
export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const body = await request.json()
    const { to, subject, body: emailBody, templateId, scheduledFor, dealId, staffId: bodyStaffId } = body

    // Get staffId from header if not in body
    const staffId = bodyStaffId || request.headers.get('x-staff-id')

    // Validate required fields
    if (!to || !subject || !emailBody) {
      return NextResponse.json(
        { error: 'Missing required fields: to, subject, body' },
        { status: 400 }
      )
    }

    if (!staffId) {
      return NextResponse.json(
        { error: 'Missing staffId (provide in body or x-staff-id header)' },
        { status: 400 }
      )
    }

    // Generate a unique ID
    const id = `email_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`

    // Insert the email into the queue
    const insertQuery = `
      INSERT INTO "EmailQueue" (
        "id",
        "to",
        "subject",
        "body",
        "templateId",
        "status",
        "attempts",
        "lastError",
        "scheduledFor",
        "sentAt",
        "dealId",
        "staffId",
        "createdAt"
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      RETURNING *
    `

    const result = await prisma.$queryRawUnsafe(
      insertQuery,
      id,
      to,
      subject,
      emailBody,
      templateId || null,
      'QUEUED',
      0,
      null,
      scheduledFor || new Date(),
      null,
      dealId || null,
      staffId,
      new Date()
    )

    const email = (result as any[])[0]

    return NextResponse.json(
      {
        id: email.id,
        to: email.to,
        subject: email.subject,
        status: email.status,
        createdAt: email.createdAt,
        scheduledFor: email.scheduledFor,
      },
      { status: 201 }
    )
  } catch (error) {
    console.error('Email queue insertion error:', error)
    return NextResponse.json(
      { error: 'Failed to queue email' },
      { status: 500 }
    )
  }
}

// PATCH /api/ops/email — Update email status
export async function PATCH(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const body = await request.json()
    const { id, status, lastError } = body

    // Validate required fields
    if (!id || !status) {
      return NextResponse.json(
        { error: 'Missing required fields: id, status' },
        { status: 400 }
      )
    }

    // Build update query
    const now = new Date()
    const sentAtValue = status === 'SENT' ? now : null

    const updateQuery = `
      UPDATE "EmailQueue"
      SET
        "status" = $2,
        "lastError" = $3,
        "sentAt" = $4,
        "attempts" = "attempts" + 1
      WHERE "id" = $1
      RETURNING *
    `

    const result = await prisma.$queryRawUnsafe(
      updateQuery,
      id,
      status,
      lastError || null,
      sentAtValue
    )

    const email = (result as any[])[0]

    if (!email) {
      return NextResponse.json(
        { error: 'Email not found' },
        { status: 404 }
      )
    }

    return NextResponse.json({
      id: email.id,
      status: email.status,
      attempts: email.attempts,
      updatedAt: new Date(),
    })
  } catch (error) {
    console.error('Email queue update error:', error)
    return NextResponse.json(
      { error: 'Failed to update email status' },
      { status: 500 }
    )
  }
}
