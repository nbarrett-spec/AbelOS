export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { createNotification } from '@/lib/notifications'
import { checkStaffAuth } from '@/lib/api-auth'

interface QuoteRequestRecord {
  id: string
  builderId: string
  companyName?: string
  referenceNumber: string
  projectName: string
  projectAddress: string
  city: string
  state: string
  zip: string
  description: string
  estimatedSquareFootage?: number
  productCategories: string | string[]
  preferredDeliveryDate?: Date
  attachmentUrls?: string | string[]
  notes?: string
  status: string
  assignedTo?: string
  assignedToName?: string
  quoteId?: string
  createdAt: Date
  updatedAt?: Date
}

/**
 * Ensure QuoteRequest table exists
 */
async function ensureQuoteRequestTable() {
  try {
    await prisma.$queryRaw`
      CREATE TABLE IF NOT EXISTS "QuoteRequest" (
        "id" TEXT PRIMARY KEY,
        "builderId" TEXT NOT NULL,
        "referenceNumber" TEXT NOT NULL UNIQUE,
        "projectName" TEXT NOT NULL,
        "projectAddress" TEXT NOT NULL,
        "city" TEXT,
        "state" TEXT,
        "zip" TEXT,
        "description" TEXT NOT NULL,
        "estimatedSquareFootage" DOUBLE PRECISION,
        "productCategories" TEXT NOT NULL,
        "preferredDeliveryDate" TIMESTAMP(3),
        "attachmentUrls" TEXT,
        "notes" TEXT,
        "status" TEXT NOT NULL DEFAULT 'NEW',
        "assignedTo" TEXT,
        "quoteId" TEXT,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `

    // Create indexes if they don't exist
    await prisma.$queryRaw`
      CREATE INDEX IF NOT EXISTS "idx_qr_builder" ON "QuoteRequest"("builderId")
    `
    await prisma.$queryRaw`
      CREATE INDEX IF NOT EXISTS "idx_qr_status" ON "QuoteRequest"("status")
    `
    await prisma.$queryRaw`
      CREATE INDEX IF NOT EXISTS "idx_qr_created" ON "QuoteRequest"("createdAt")
    `
  } catch (e) {
    // Table likely already exists
    console.log('QuoteRequest table check:', e)
  }
}

/**
 * GET /api/ops/quote-requests — List all quote requests with filters
 * Query params: status, builderId, page, limit
 */
export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    await ensureQuoteRequestTable()

    const searchParams = request.nextUrl.searchParams

    // Parse query parameters
    const status = searchParams.get('status')
    const builderId = searchParams.get('builderId')
    const page = Math.max(1, parseInt(searchParams.get('page') || '1'))
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '50')))
    const offset = (page - 1) * limit

    // Build WHERE clause
    const whereConditions: string[] = []
    const params: any[] = []
    let paramIndex = 1

    if (status) {
      whereConditions.push(`qr."status" = $${paramIndex}`)
      params.push(status)
      paramIndex++
    }

    if (builderId) {
      whereConditions.push(`qr."builderId" = $${paramIndex}`)
      params.push(builderId)
      paramIndex++
    }

    const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : ''

    // Get total count
    const countResult: any[] = await prisma.$queryRawUnsafe(
      `SELECT COUNT(*)::int as count FROM "QuoteRequest" qr ${whereClause}`,
      ...params
    ) as any[]
    const total = countResult[0]?.count || 0

    // Get paginated results with builder and assigned staff info
    const query = `
      SELECT
        qr."id",
        qr."builderId",
        b."companyName",
        qr."referenceNumber",
        qr."projectName",
        qr."projectAddress",
        qr."city",
        qr."state",
        qr."zip",
        qr."description",
        qr."estimatedSquareFootage",
        qr."productCategories",
        qr."preferredDeliveryDate",
        qr."attachmentUrls",
        qr."notes",
        qr."status",
        qr."assignedTo",
        s."firstName" || ' ' || s."lastName" as "assignedToName",
        qr."quoteId",
        qr."createdAt",
        qr."updatedAt"
      FROM "QuoteRequest" qr
      LEFT JOIN "Builder" b ON qr."builderId" = b."id"
      LEFT JOIN "Staff" s ON qr."assignedTo" = s."id"
      ${whereClause}
      ORDER BY qr."createdAt" DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `

    const quoteRequests: QuoteRequestRecord[] = await prisma.$queryRawUnsafe(
      query,
      ...params,
      limit,
      offset
    ) as QuoteRequestRecord[]

    // Parse JSON fields
    const parsedRequests = quoteRequests.map((req) => {
      const parsed = { ...req }
      if (typeof parsed.productCategories === 'string') {
        try {
          parsed.productCategories = JSON.parse(parsed.productCategories)
        } catch (e) {
          // Keep as string
        }
      }
      if (typeof parsed.attachmentUrls === 'string' && parsed.attachmentUrls) {
        try {
          parsed.attachmentUrls = JSON.parse(parsed.attachmentUrls)
        } catch (e) {
          // Keep as string
        }
      }
      return parsed
    })

    return NextResponse.json({
      success: true,
      quoteRequests: parsedRequests,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    })
  } catch (error) {
    console.error('Failed to fetch quote requests:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

/**
 * PATCH /api/ops/quote-requests — Update quote request status
 * Body: { id, status?, assignedTo?, quoteId?, notes? }
 * Header: x-staff-id (staff making the update)
 */
export async function PATCH(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    await ensureQuoteRequestTable()

    const body = await request.json()
    const staffId = request.headers.get('x-staff-id')

    // Validate required fields
    const { id, status, assignedTo, quoteId, notes } = body

    if (!id) {
      return NextResponse.json(
        { error: 'Missing required field: id' },
        { status: 400 }
      )
    }

    if (!staffId) {
      return NextResponse.json(
        { error: 'Missing staff ID in header (x-staff-id)' },
        { status: 400 }
      )
    }

    // Validate status if provided
    const validStatuses = ['NEW', 'REVIEWING', 'QUOTED', 'ACCEPTED', 'DECLINED']
    if (status && !validStatuses.includes(status)) {
      return NextResponse.json(
        { error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` },
        { status: 400 }
      )
    }

    // Fetch current quote request to get builderId and old status
    const currentRequest: QuoteRequestRecord[] = await prisma.$queryRawUnsafe(
      `SELECT "id", "builderId", "status" FROM "QuoteRequest" WHERE "id" = $1`,
      id
    ) as QuoteRequestRecord[]

    if (currentRequest.length === 0) {
      return NextResponse.json(
        { error: 'Quote request not found' },
        { status: 404 }
      )
    }

    const oldStatus = currentRequest[0].status
    const builderId = currentRequest[0].builderId

    // Build UPDATE clause dynamically
    const updateParts: string[] = []
    const params: any[] = []
    let paramIndex = 1

    if (status) {
      updateParts.push(`"status" = $${paramIndex}`)
      params.push(status)
      paramIndex++
    }

    if (assignedTo !== undefined) {
      updateParts.push(`"assignedTo" = $${paramIndex}`)
      params.push(assignedTo || null)
      paramIndex++
    }

    if (quoteId !== undefined) {
      updateParts.push(`"quoteId" = $${paramIndex}`)
      params.push(quoteId || null)
      paramIndex++
    }

    if (notes !== undefined) {
      updateParts.push(`"notes" = $${paramIndex}`)
      params.push(notes || null)
      paramIndex++
    }

    // Always update updatedAt
    updateParts.push('"updatedAt" = NOW()')

    if (updateParts.length === 1) {
      // Only updatedAt, no actual changes
      return NextResponse.json(
        { error: 'No fields to update' },
        { status: 400 }
      )
    }

    // Execute update
    await prisma.$executeRawUnsafe(
      `UPDATE "QuoteRequest" SET ${updateParts.join(', ')} WHERE "id" = $${paramIndex}`,
      ...params,
      id
    )

    // Create notification for builder if status changed
    if (status && status !== oldStatus) {
      try {
        // Get builder info for notification
        const builderResult: any[] = await prisma.$queryRawUnsafe(
          `SELECT "id" FROM "Builder" WHERE "id" = $1`,
          builderId
        ) as any[]

        if (builderResult.length > 0) {
          // Create a builder notification using raw SQL
          const notifId = 'bn' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
          await prisma.$executeRawUnsafe(
            `INSERT INTO "BuilderNotification" ("id", "builderId", "type", "title", "message", "link", "read", "createdAt")
             VALUES ($1, $2, $3, $4, $5, $6, false, NOW())`,
            notifId,
            builderId,
            'QUOTE_REQUEST_STATUS',
            'Quote Request Status Update',
            `Your quote request status has been updated to: ${status}`,
            `/builder/quote-requests/${id}`
          )
        }
      } catch (e) {
        console.error('Failed to create builder notification:', e)
      }

      // Create staff notification if assigned
      if (assignedTo && assignedTo !== 'undefined') {
        try {
          await createNotification({
            staffId: assignedTo,
            type: 'TASK_ASSIGNED',
            title: 'Quote Request Assigned',
            message: `Status updated to ${status}`,
            link: `/ops/quote-requests/${id}`,
          })
        } catch (e) {
          console.error('Failed to create staff notification:', e)
        }
      }
    }

    // Fetch and return updated request
    const updatedRequest: QuoteRequestRecord[] = await prisma.$queryRawUnsafe(
      `SELECT
        qr."id",
        qr."builderId",
        b."companyName",
        qr."referenceNumber",
        qr."projectName",
        qr."projectAddress",
        qr."city",
        qr."state",
        qr."zip",
        qr."description",
        qr."estimatedSquareFootage",
        qr."productCategories",
        qr."preferredDeliveryDate",
        qr."attachmentUrls",
        qr."notes",
        qr."status",
        qr."assignedTo",
        s."firstName" || ' ' || s."lastName" as "assignedToName",
        qr."quoteId",
        qr."createdAt",
        qr."updatedAt"
      FROM "QuoteRequest" qr
      LEFT JOIN "Builder" b ON qr."builderId" = b."id"
      LEFT JOIN "Staff" s ON qr."assignedTo" = s."id"
      WHERE qr."id" = $1`,
      id
    ) as QuoteRequestRecord[]

    if (updatedRequest.length === 0) {
      return NextResponse.json(
        { error: 'Failed to retrieve updated quote request' },
        { status: 500 }
      )
    }

    const req = updatedRequest[0]

    // Parse JSON fields
    if (typeof req.productCategories === 'string') {
      try {
        req.productCategories = JSON.parse(req.productCategories)
      } catch (e) {
        // Keep as string
      }
    }

    if (typeof req.attachmentUrls === 'string' && req.attachmentUrls) {
      try {
        req.attachmentUrls = JSON.parse(req.attachmentUrls)
      } catch (e) {
        // Keep as string
      }
    }

    return NextResponse.json({
      success: true,
      message: 'Quote request updated successfully',
      quoteRequest: req,
    })
  } catch (error) {
    console.error('Failed to update quote request:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
