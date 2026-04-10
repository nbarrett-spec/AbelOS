export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/auth'
import { createNotification } from '@/lib/notifications'
import { sendQuoteRequestConfirmationEmail } from '@/lib/email'

interface QuoteRequestRecord {
  id: string
  builderId: string
  referenceNumber: string
  projectName: string
  projectAddress: string
  city: string
  state: string
  zip: string
  description: string
  estimatedSquareFootage?: number
  productCategories: string
  preferredDeliveryDate?: Date
  attachmentUrls?: string
  notes?: string
  status: string
  createdAt: Date
}

/**
 * Ensure QuoteRequest table exists with proper schema
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
 * POST /api/builders/quote-request — Submit a quote request
 * Body: { projectName, projectAddress, city, state, zip, description, estimatedSquareFootage?, productCategories[], preferredDeliveryDate?, attachmentUrls[]?, notes? }
 * Header: x-builder-id (builderId)
 */
export async function POST(request: NextRequest) {
  try {
    await ensureQuoteRequestTable()

    const body = await request.json()
    const session = await getSession()
    const builderId = session?.builderId || request.headers.get('x-builder-id') || body.builderId

    // Validate required fields
    const {
      projectName,
      projectAddress,
      city,
      state,
      zip,
      description,
      estimatedSquareFootage,
      productCategories,
      preferredDeliveryDate,
      attachmentUrls,
      notes,
    } = body

    if (!builderId) {
      return NextResponse.json(
        { error: 'Missing builderId in header (x-builder-id) or body' },
        { status: 400 }
      )
    }

    if (!projectName || !projectAddress || !description || !productCategories) {
      return NextResponse.json(
        { error: 'Missing required fields: projectName, projectAddress, description, productCategories' },
        { status: 400 }
      )
    }

    if (!Array.isArray(productCategories) || productCategories.length === 0) {
      return NextResponse.json(
        { error: 'productCategories must be a non-empty array' },
        { status: 400 }
      )
    }

    // Generate quote request ID and reference number
    const requestId = 'qr' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
    const refNumber = 'QR' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 8).toUpperCase()

    // Insert quote request
    await prisma.$executeRawUnsafe(
      `INSERT INTO "QuoteRequest" (
        "id", "builderId", "referenceNumber", "projectName", "projectAddress",
        "city", "state", "zip", "description", "estimatedSquareFootage",
        "productCategories", "preferredDeliveryDate", "attachmentUrls", "notes",
        "status", "createdAt", "updatedAt"
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, NOW(), NOW())`,
      requestId,
      builderId,
      refNumber,
      projectName,
      projectAddress,
      city || null,
      state || null,
      zip || null,
      description,
      estimatedSquareFootage || null,
      JSON.stringify(productCategories),
      preferredDeliveryDate || null,
      attachmentUrls ? JSON.stringify(attachmentUrls) : null,
      notes || null,
      'NEW'
    )

    // Get all SALES and ESTIMATING staff members to notify
    const staffMembers: any[] = await prisma.$queryRawUnsafe(
      `SELECT "id" FROM "Staff" WHERE "department"::text IN ('SALES', 'ESTIMATING') AND "active" = true`
    ) as any[]

    // Create notifications for each staff member
    for (const staff of staffMembers) {
      try {
        await createNotification({
          staffId: staff.id,
          type: 'SYSTEM',
          title: 'New Quote Request',
          message: `${projectName} - ${projectAddress}`,
          link: `/ops/quote-requests/${requestId}`,
        })
      } catch (e) {
        console.error('Failed to create notification:', e)
      }
    }

    // Send confirmation email to builder
    if (session?.email) {
      sendQuoteRequestConfirmationEmail({
        to: session.email,
        builderName: session.companyName || 'Builder',
        referenceNumber: refNumber,
        projectName,
        projectAddress,
      }).catch(() => {})
    }

    // Fetch and return created request
    const createdRequest: QuoteRequestRecord[] = await prisma.$queryRawUnsafe(
      `SELECT * FROM "QuoteRequest" WHERE "id" = $1`,
      requestId
    ) as QuoteRequestRecord[]

    const request_data = createdRequest[0] || {
      id: requestId,
      builderId,
      referenceNumber: refNumber,
      projectName,
      projectAddress,
      city,
      state,
      zip,
      description,
      estimatedSquareFootage,
      productCategories,
      preferredDeliveryDate,
      attachmentUrls,
      notes,
      status: 'NEW',
      createdAt: new Date(),
    }

    // Parse JSON fields for response
    if (typeof request_data.productCategories === 'string') {
      try {
        request_data.productCategories = JSON.parse(request_data.productCategories) as any
      } catch (e) {
        // Keep as string if parsing fails
      }
    }

    if (typeof request_data.attachmentUrls === 'string' && request_data.attachmentUrls) {
      try {
        request_data.attachmentUrls = JSON.parse(request_data.attachmentUrls) as any
      } catch (e) {
        // Keep as string if parsing fails
      }
    }

    return NextResponse.json(
      {
        success: true,
        message: 'Quote request submitted successfully',
        referenceNumber: refNumber,
        quoteRequest: request_data,
      },
      { status: 201 }
    )
  } catch (error) {
    console.error('Failed to submit quote request:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

/**
 * GET /api/builders/quote-request — List quote requests for the current builder
 * Header: x-builder-id (builderId)
 */
export async function GET(request: NextRequest) {
  try {
    await ensureQuoteRequestTable()

    const session = await getSession()
    const builderId = session?.builderId || request.headers.get('x-builder-id')

    if (!builderId) {
      return NextResponse.json(
        { error: 'Not authenticated' },
        { status: 401 }
      )
    }

    const searchParams = request.nextUrl.searchParams
    const status = searchParams.get('status')
    const page = Math.max(1, parseInt(searchParams.get('page') || '1'))
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '50')))
    const offset = (page - 1) * limit

    // Build WHERE clause
    let whereClause = 'WHERE "builderId" = $1'
    const params: any[] = [builderId]

    if (status) {
      whereClause += ` AND "status" = $${params.length + 1}`
      params.push(status)
    }

    // Get total count
    const countResult: any[] = await prisma.$queryRawUnsafe(
      `SELECT COUNT(*)::int as count FROM "QuoteRequest" ${whereClause}`,
      ...params
    ) as any[]
    const total = countResult[0]?.count || 0

    // Get paginated results
    const requests: QuoteRequestRecord[] = await prisma.$queryRawUnsafe(
      `SELECT * FROM "QuoteRequest"
       ${whereClause}
       ORDER BY "createdAt" DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      ...params,
      limit,
      offset
    ) as QuoteRequestRecord[]

    // Parse JSON fields
    const parsedRequests = requests.map((req) => {
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
