export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { safeJson } from '@/lib/safe-json'
import { checkStaffAuth } from '@/lib/api-auth'

// ──────────────────────────────────────────────────────────────────────────
// POST — Public instant quote request submission
// ──────────────────────────────────────────────────────────────────────────
// Receives a quote request from the website get-quote landing page.
// Validates builder info, creates prospect if new, auto-assigns to sales rep,
// sends confirmation email, creates notification for assigned rep.
// ──────────────────────────────────────────────────────────────────────────

interface DoorLine {
  doorType: string
  size: string
  handing: string
  core: string
  panelStyle: string
  jambSize: string
  quantity: number
  estimatedUnitPrice: number
}

interface QuoteRequestBody {
  builder: {
    companyName: string
    contactName: string
    email: string
    phone: string
    isNew: boolean
  }
  project: {
    projectName: string
    address: string
    community: string
    estimatedDoors: number
    targetDeliveryDate: string
  }
  doorLines: DoorLine[]
  notes: string
  totalEstimate: number
  source: 'WEBSITE' | 'REFERRAL' | 'PHONE' | 'WALK_IN'
}

export async function POST(request: NextRequest) {
  try {
    const body: QuoteRequestBody = await request.json()

    // Validate required fields
    if (!body.builder?.email) {
      return safeJson({ error: 'Email is required' }, { status: 400 })
    }

    if (!body.doorLines || body.doorLines.length === 0) {
      return safeJson({ error: 'At least one door line is required' }, { status: 400 })
    }

    if (!body.project?.address) {
      return safeJson({ error: 'Project address is required' }, { status: 400 })
    }

    const { builder, project, doorLines, notes, totalEstimate, source } = body

    // Ensure tables exist
    await ensureInstantQuoteRequestTable()

    // Check if builder already exists
    const existingBuilderResult: any[] = await prisma.$queryRawUnsafe(`
      SELECT "id", "email", "companyName", "lastActivityDate"
      FROM "Builder"
      WHERE "email" = $1
    `, builder.email)

    let builderId: string | null = null
    let isNewBuilder = false

    if (existingBuilderResult.length > 0) {
      // Link to existing builder and update lastActivityDate
      builderId = existingBuilderResult[0].id
      await prisma.$executeRawUnsafe(`
        UPDATE "Builder"
        SET "lastActivityDate" = NOW()
        WHERE "id" = $1
      `, builderId)
    } else {
      // New builder — create prospect (not full Builder account yet)
      isNewBuilder = true
      // Don't create a Builder record; that needs approval.
      // Instead, we'll just track this in InstantQuoteRequest and create a Deal if needed.
    }

    // Create InstantQuoteRequest record
    const requestId: string = await generateUUID()
    const createdAt = new Date().toISOString()
    const updatedAt = createdAt

    await prisma.$executeRawUnsafe(`
      INSERT INTO "InstantQuoteRequest" (
        "id",
        "builderEmail",
        "builderCompany",
        "contactName",
        "phone",
        "isNewBuilder",
        "projectName",
        "projectAddress",
        "community",
        "estimatedDoors",
        "targetDelivery",
        "doorLines",
        "notes",
        "totalEstimate",
        "source",
        "status",
        "createdAt",
        "updatedAt"
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
    `,
      requestId,
      builder.email,
      builder.companyName,
      builder.contactName,
      builder.phone,
      isNewBuilder,
      project.projectName,
      project.address,
      project.community,
      project.estimatedDoors,
      project.targetDeliveryDate || null,
      JSON.stringify(doorLines),
      notes || null,
      totalEstimate,
      source,
      'NEW',
      createdAt,
      updatedAt
    )

    // Find sales rep with fewest active assignments using round-robin
    const assignedRep: any = await findLeastAssignedSalesRep()
    let assignedTo: string | null = null
    let assignedRepName = 'Sales Team'

    if (assignedRep) {
      assignedTo = assignedRep.id
      assignedRepName = `${assignedRep.firstName} ${assignedRep.lastName}`

      // Update the instant quote request with assignment
      await prisma.$executeRawUnsafe(`
        UPDATE "InstantQuoteRequest"
        SET "assignedTo" = $1, "assignedAt" = NOW(), "status" = $2
        WHERE "id" = $3
      `, assignedTo, 'ASSIGNED', requestId)
    }

    // Create notification for assigned rep
    if (assignedTo) {
      const notificationId: string = await generateUUID()
      await prisma.$executeRawUnsafe(`
        INSERT INTO "Notification" ("id", "staffId", "type", "title", "body", "read", "createdAt")
        VALUES ($1, $2, $3, $4, $5, $6, NOW())
      `,
        notificationId,
        assignedTo,
        'TASK_ASSIGNED',
        `New instant quote request from ${builder.companyName}`,
        `${builder.contactName} at ${builder.companyName} requested a quote for ~${project.estimatedDoors} doors. Estimated value: $${totalEstimate.toFixed(2)}. Location: ${project.address}.`,
        false
      )
    }

    // If new builder, create a Deal record for sales tracking
    if (isNewBuilder) {
      const dealId: string = await generateUUID()
      const dealNumber: string = await generateDealNumber()

      await prisma.$executeRawUnsafe(`
        INSERT INTO "Deal" (
          "id",
          "dealNumber",
          "companyName",
          "contactName",
          "contactEmail",
          "contactPhone",
          "address",
          "city",
          "state",
          "zip",
          "stage",
          "probability",
          "dealValue",
          "source",
          "ownerId",
          "description",
          "createdAt",
          "updatedAt"
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, NOW(), NOW())
      `,
        dealId,
        dealNumber,
        builder.companyName,
        builder.contactName,
        builder.email,
        builder.phone,
        project.address,
        null, // city
        null, // state
        null, // zip
        'PROSPECT',
        30, // 30% probability on instant quote
        totalEstimate,
        'INBOUND',
        assignedTo || (await getDefaultSalesRepId()),
        `Instant quote from website. ${project.estimatedDoors} doors estimated at $${totalEstimate.toFixed(2)}`
      )
    }

    // Send confirmation email to builder (via internal email service)
    // Log email send intent; actual email sending would be handled by ops/email service
    try {
      await fetch(new URL('/api/ops/email/send', request.url).toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: builder.email,
          subject: `Quote Request Received - ${builder.companyName}`,
          template: 'quote_request_confirmation',
          data: {
            contactName: builder.contactName,
            companyName: builder.companyName,
            projectAddress: project.address,
            estimatedDoors: project.estimatedDoors,
            totalEstimate: totalEstimate.toFixed(2),
            assignedRepName,
            requestId,
          },
        }),
      })
    } catch (error) {
      // Email send failed, but don't fail the request
      console.error('Failed to send confirmation email:', error)
    }

    // Return success response
    return safeJson({
      success: true,
      requestId,
      assignedTo: assignedRepName,
      estimatedResponseTime: '2 hours',
      message: `We've received your quote request and assigned it to ${assignedRepName}. You'll receive a detailed quote within 2 hours.`,
    })
  } catch (error: any) {
    console.error('Error processing instant quote request:', error)
    return safeJson(
      { error: 'Failed to process quote request' },
      { status: 500 }
    )
  }
}

// ──────────────────────────────────────────────────────────────────────────
// GET — Staff-only listing of instant quote requests
// ──────────────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    // Parse query parameters for filtering
    const searchParams = new URL(request.url).searchParams
    const status = searchParams.get('status') || null
    const assignedTo = searchParams.get('assignedTo') || null
    const dateFrom = searchParams.get('dateFrom') || null
    const dateTo = searchParams.get('dateTo') || null
    const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 500)
    const offset = parseInt(searchParams.get('offset') || '0')

    // Build WHERE clause
    const whereConditions: string[] = []
    const params: any[] = []
    let paramIndex = 1

    if (status) {
      whereConditions.push(`"status" = $${paramIndex}`)
      params.push(status)
      paramIndex++
    }

    if (assignedTo) {
      whereConditions.push(`"assignedTo" = $${paramIndex}`)
      params.push(assignedTo)
      paramIndex++
    }

    if (dateFrom) {
      whereConditions.push(`"createdAt" >= $${paramIndex}`)
      params.push(dateFrom)
      paramIndex++
    }

    if (dateTo) {
      whereConditions.push(`"createdAt" <= $${paramIndex}`)
      params.push(dateTo)
      paramIndex++
    }

    const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : ''

    // Get total count
    const countResult: any[] = await prisma.$queryRawUnsafe(
      `SELECT COUNT(*)::int AS "count" FROM "InstantQuoteRequest" ${whereClause}`,
      ...params
    )
    const total = countResult[0]?.count || 0

    // Get paginated results with assigned rep name
    params.push(limit)
    params.push(offset)

    const results: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        iq."id",
        iq."builderEmail",
        iq."builderCompany",
        iq."contactName",
        iq."phone",
        iq."isNewBuilder",
        iq."projectAddress",
        iq."community",
        iq."estimatedDoors",
        iq."targetDelivery",
        iq."totalEstimate",
        iq."source",
        iq."status",
        iq."assignedTo",
        iq."assignedAt",
        iq."createdAt",
        iq."updatedAt",
        COALESCE(CONCAT(s."firstName", ' ', s."lastName"), 'Unassigned') AS "assignedRepName",
        jsonb_array_length(iq."doorLines") AS "doorLineCount",
        EXTRACT(EPOCH FROM (NOW() - iq."createdAt")) / 3600 AS "ageHours"
      FROM "InstantQuoteRequest" iq
      LEFT JOIN "Staff" s ON iq."assignedTo" = s."id"
      ${whereClause}
      ORDER BY iq."createdAt" DESC
      LIMIT $${paramIndex - 1}
      OFFSET $${paramIndex}
    `, ...params)

    return safeJson({
      items: results.map(r => ({
        id: r.id,
        builderEmail: r.builderEmail,
        builderCompany: r.builderCompany,
        contactName: r.contactName,
        phone: r.phone,
        isNewBuilder: r.isNewBuilder,
        projectAddress: r.projectAddress,
        community: r.community,
        estimatedDoors: r.estimatedDoors,
        targetDelivery: r.targetDelivery,
        totalEstimate: Number(r.totalEstimate),
        source: r.source,
        status: r.status,
        assignedTo: r.assignedTo,
        assignedRepName: r.assignedRepName,
        assignedAt: r.assignedAt,
        doorLineCount: Number(r.doorLineCount),
        ageHours: Math.round(Number(r.ageHours) * 10) / 10,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      })),
      pagination: {
        total,
        limit,
        offset,
        hasMore: offset + limit < total,
      },
    })
  } catch (error: any) {
    console.error('Error fetching instant quote requests:', error)
    return safeJson(
      { error: 'Failed to fetch quote requests' },
      { status: 500 }
    )
  }
}

// ──────────────────────────────────────────────────────────────────────────
// PATCH — Staff updates to quote request
// ──────────────────────────────────────────────────────────────────────────

interface PatchBody {
  requestId: string
  status?: 'NEW' | 'ASSIGNED' | 'QUOTED' | 'CONVERTED' | 'DECLINED'
  assignedTo?: string
  notes?: string
}

export async function PATCH(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const staffId = request.headers.get('x-staff-id')
    const body: PatchBody = await request.json()

    const { requestId, status, assignedTo, notes } = body

    if (!requestId) {
      return safeJson({ error: 'requestId is required' }, { status: 400 })
    }

    // Validate status if provided
    const validStatuses = ['NEW', 'ASSIGNED', 'QUOTED', 'CONVERTED', 'DECLINED']
    if (status && !validStatuses.includes(status)) {
      return safeJson(
        { error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` },
        { status: 400 }
      )
    }

    // Get current request to ensure it exists
    const currentRequest: any[] = await prisma.$queryRawUnsafe(`
      SELECT * FROM "InstantQuoteRequest" WHERE "id" = $1
    `, requestId)

    if (currentRequest.length === 0) {
      return safeJson({ error: 'Quote request not found' }, { status: 404 })
    }

    // Build update query dynamically
    const updates: string[] = []
    const params: any[] = [requestId]
    let paramIndex = 2

    if (status !== undefined) {
      updates.push(`"status" = $${paramIndex}`)
      params.push(status)
      paramIndex++
    }

    if (assignedTo !== undefined) {
      updates.push(`"assignedTo" = $${paramIndex}`)
      updates.push(`"assignedAt" = NOW()`)
      params.push(assignedTo)
      paramIndex++
    }

    updates.push(`"updatedAt" = NOW()`)

    if (updates.length > 0) {
      await prisma.$executeRawUnsafe(
        `UPDATE "InstantQuoteRequest" SET ${updates.join(', ')} WHERE "id" = $1`,
        ...params
      )
    }

    // Create activity log entry if staff notes provided
    if (notes && staffId) {
      const activityId: string = await generateUUID()
      await prisma.$executeRawUnsafe(`
        INSERT INTO "Activity" (
          "id",
          "staffId",
          "activityType",
          "subject",
          "notes",
          "createdAt"
        ) VALUES ($1, $2, $3, $4, $5, NOW())
      `,
        activityId,
        staffId,
        'NOTE',
        `Updated quote request ${requestId}`,
        notes
      )
    }

    // Get updated request
    const updatedRequest: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        iq.*,
        COALESCE(CONCAT(s."firstName", ' ', s."lastName"), 'Unassigned') AS "assignedRepName"
      FROM "InstantQuoteRequest" iq
      LEFT JOIN "Staff" s ON iq."assignedTo" = s."id"
      WHERE iq."id" = $1
    `, requestId)

    if (updatedRequest.length === 0) {
      return safeJson({ error: 'Failed to retrieve updated request' }, { status: 500 })
    }

    const updated = updatedRequest[0]

    return safeJson({
      success: true,
      request: {
        id: updated.id,
        builderEmail: updated.builderEmail,
        builderCompany: updated.builderCompany,
        status: updated.status,
        assignedTo: updated.assignedTo,
        assignedRepName: updated.assignedRepName,
        totalEstimate: Number(updated.totalEstimate),
        createdAt: updated.createdAt,
        updatedAt: updated.updatedAt,
      },
    })
  } catch (error: any) {
    console.error('Error updating instant quote request:', error)
    return safeJson(
      { error: 'Failed to update quote request' },
      { status: 500 }
    )
  }
}

// ──────────────────────────────────────────────────────────────────────────
// HELPER FUNCTIONS
// ──────────────────────────────────────────────────────────────────────────

async function ensureInstantQuoteRequestTable() {
  try {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "InstantQuoteRequest" (
        "id" TEXT PRIMARY KEY,
        "builderEmail" TEXT NOT NULL,
        "builderCompany" TEXT NOT NULL,
        "contactName" TEXT NOT NULL,
        "phone" TEXT NOT NULL,
        "isNewBuilder" BOOLEAN NOT NULL DEFAULT false,
        "projectName" TEXT NOT NULL,
        "projectAddress" TEXT NOT NULL,
        "community" TEXT,
        "estimatedDoors" INTEGER,
        "targetDelivery" TEXT,
        "doorLines" JSONB NOT NULL,
        "notes" TEXT,
        "totalEstimate" FLOAT NOT NULL,
        "source" TEXT NOT NULL,
        "status" TEXT NOT NULL DEFAULT 'NEW',
        "assignedTo" TEXT,
        "assignedAt" TIMESTAMP,
        "createdAt" TIMESTAMP NOT NULL,
        "updatedAt" TIMESTAMP NOT NULL
      );

      CREATE INDEX IF NOT EXISTS "idx_InstantQuoteRequest_builderEmail" ON "InstantQuoteRequest" ("builderEmail");
      CREATE INDEX IF NOT EXISTS "idx_InstantQuoteRequest_status" ON "InstantQuoteRequest" ("status");
      CREATE INDEX IF NOT EXISTS "idx_InstantQuoteRequest_assignedTo" ON "InstantQuoteRequest" ("assignedTo");
      CREATE INDEX IF NOT EXISTS "idx_InstantQuoteRequest_createdAt" ON "InstantQuoteRequest" ("createdAt");
      CREATE INDEX IF NOT EXISTS "idx_InstantQuoteRequest_isNewBuilder" ON "InstantQuoteRequest" ("isNewBuilder");
    `)
  } catch (error: any) {
    // Table may already exist or other error
    if (!error.message?.includes('already exists')) {
      console.error('Error creating InstantQuoteRequest table:', error)
    }
  }
}

async function findLeastAssignedSalesRep(): Promise<any> {
  try {
    // Find SALES_REP or ESTIMATOR with fewest active quote request assignments
    const result: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        s."id",
        s."firstName",
        s."lastName",
        s."email",
        COUNT(iq."id") AS "assignmentCount"
      FROM "Staff" s
      LEFT JOIN "InstantQuoteRequest" iq ON s."id" = iq."assignedTo" AND iq."status" NOT IN ('CONVERTED', 'DECLINED')
      WHERE s."active" = true AND s."role"::text IN ('SALES_REP', 'ESTIMATOR')
      GROUP BY s."id", s."firstName", s."lastName", s."email"
      ORDER BY "assignmentCount" ASC, RANDOM()
      LIMIT 1
    `)

    return result[0] || null
  } catch (error) {
    console.error('Error finding least assigned sales rep:', error)
    return null
  }
}

async function getDefaultSalesRepId(): Promise<string> {
  try {
    const result: any[] = await prisma.$queryRawUnsafe(`
      SELECT "id" FROM "Staff"
      WHERE "active" = true AND "role"::text IN ('SALES_REP', 'ESTIMATOR')
      LIMIT 1
    `)
    return result[0]?.id || ''
  } catch (error) {
    console.error('Error getting default sales rep:', error)
    return ''
  }
}

async function generateDealNumber(): Promise<string> {
  try {
    const result: any[] = await prisma.$queryRawUnsafe(`
      SELECT MAX(CAST(SUBSTRING("dealNumber", 6) AS INTEGER)) AS "maxNum"
      FROM "Deal"
      WHERE "dealNumber" LIKE 'DEAL-%'
    `)

    const maxNum = result[0]?.maxNum || 0
    const nextNum = String(maxNum + 1).padStart(4, '0')
    const year = new Date().getFullYear()
    return `DEAL-${year}-${nextNum}`
  } catch (error) {
    console.error('Error generating deal number:', error)
    // Fallback to timestamp-based
    return `DEAL-${Date.now()}`
  }
}

function generateUUID(): Promise<string> {
  return Promise.resolve(
    'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      const r = (Math.random() * 16) | 0
      const v = c === 'x' ? r : (r & 0x3) | 0x8
      return v.toString(16)
    })
  )
}
