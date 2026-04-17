export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'
import { randomUUID } from 'crypto'
import { audit } from '@/lib/audit'

// Activity Type enum values for validation
const VALID_ACTIVITY_TYPES = [
  'CALL',
  'EMAIL',
  'MEETING',
  'SITE_VISIT',
  'TEXT_MESSAGE',
  'NOTE',
  'QUOTE_SENT',
  'QUOTE_FOLLOW_UP',
  'ISSUE_REPORTED',
  'ISSUE_RESOLVED',
]

// ──────────────────────────────────────────────────────────────────────────
// GET /api/ops/activity-log — List activities with filtering and pagination
// ──────────────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const searchParams = request.nextUrl.searchParams

    // Pagination params
    const page = Math.max(1, parseInt(searchParams.get('page') || '1'))
    const limit = Math.max(1, Math.min(100, parseInt(searchParams.get('limit') || '25')))
    const offset = (page - 1) * limit

    // Filter params
    const builderId = searchParams.get('builderId')
    const jobId = searchParams.get('jobId')
    const staffId = searchParams.get('staffId')
    const activityType = searchParams.get('activityType')
    const from = searchParams.get('from')
    const to = searchParams.get('to')

    // Build WHERE clause with parameterized queries
    const whereConditions: string[] = []
    const params: any[] = []

    if (builderId) {
      whereConditions.push(`a."builderId" = $${params.length + 1}`)
      params.push(builderId)
    }

    if (jobId) {
      whereConditions.push(`a."jobId" = $${params.length + 1}`)
      params.push(jobId)
    }

    if (staffId) {
      whereConditions.push(`a."staffId" = $${params.length + 1}`)
      params.push(staffId)
    }

    if (activityType) {
      // Validate against enum values
      if (!VALID_ACTIVITY_TYPES.includes(activityType)) {
        return NextResponse.json(
          { error: `Invalid activityType. Must be one of: ${VALID_ACTIVITY_TYPES.join(', ')}` },
          { status: 400 }
        )
      }
      whereConditions.push(`a."activityType" = $${params.length + 1}::"ActivityType"`)
      params.push(activityType)
    }

    if (from) {
      whereConditions.push(`a."createdAt" >= $${params.length + 1}`)
      params.push(new Date(from).toISOString())
    }

    if (to) {
      whereConditions.push(`a."createdAt" <= $${params.length + 1}`)
      params.push(new Date(to).toISOString())
    }

    const whereClause = whereConditions.length > 0
      ? `WHERE ${whereConditions.join(' AND ')}`
      : ''

    // Fetch total count
    const countResult: any[] = await prisma.$queryRawUnsafe(
      `SELECT COUNT(*)::int as count FROM "Activity" a ${whereClause}`,
      ...params
    )
    const total = countResult[0].count

    // Fetch paginated items with staff name join
    const items: any[] = await prisma.$queryRawUnsafe(
      `SELECT
        a."id",
        a."staffId",
        s."firstName" || ' ' || s."lastName" as "staffName",
        a."builderId",
        a."jobId",
        a."activityType",
        a."subject",
        a."notes",
        a."outcome",
        a."scheduledAt",
        a."completedAt",
        a."durationMins",
        a."createdAt"
      FROM "Activity" a
      LEFT JOIN "Staff" s ON a."staffId" = s."id"
      ${whereClause}
      ORDER BY a."createdAt" DESC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      ...params,
      limit,
      offset
    )

    const totalPages = Math.ceil(total / limit)

    return NextResponse.json({
      items,
      total,
      page,
      limit,
      totalPages,
    })
  } catch (error) {
    console.error('Failed to fetch activities:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

// ──────────────────────────────────────────────────────────────────────────
// POST /api/ops/activity-log — Create a new activity
// ──────────────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    // Audit log
    audit(request, 'CREATE', 'ActivityLog', undefined, { method: 'POST' }).catch(() => {})

    const body = await request.json()
    const {
      staffId,
      activityType,
      subject,
      builderId,
      jobId,
      notes,
      outcome,
      scheduledAt,
      completedAt,
      durationMins,
    } = body

    // Validate required fields
    if (!staffId || !activityType || !subject) {
      return NextResponse.json(
        { error: 'Missing required fields: staffId, activityType, subject' },
        { status: 400 }
      )
    }

    // Validate activityType
    if (!VALID_ACTIVITY_TYPES.includes(activityType)) {
      return NextResponse.json(
        { error: `Invalid activityType. Must be one of: ${VALID_ACTIVITY_TYPES.join(', ')}` },
        { status: 400 }
      )
    }

    // Generate UUID for id
    const id = randomUUID()

    // Parse dates if provided
    const scheduledAtValue = scheduledAt ? new Date(scheduledAt).toISOString() : null
    const completedAtValue = completedAt ? new Date(completedAt).toISOString() : null
    const durationMinsValue = durationMins ? parseInt(durationMins) : null

    // Insert activity
    await prisma.$executeRawUnsafe(
      `INSERT INTO "Activity" (
        "id",
        "staffId",
        "builderId",
        "jobId",
        "activityType",
        "subject",
        "notes",
        "outcome",
        "scheduledAt",
        "completedAt",
        "durationMins",
        "createdAt"
      ) VALUES (
        $1,
        $2,
        $3,
        $4,
        $5::"ActivityType",
        $6,
        $7,
        $8,
        $9,
        $10,
        $11,
        NOW()
      )`,
      id,
      staffId,
      builderId || null,
      jobId || null,
      activityType,
      subject,
      notes || null,
      outcome || null,
      scheduledAtValue,
      completedAtValue,
      durationMinsValue
    )

    // Fetch and return created activity
    const created: any[] = await prisma.$queryRawUnsafe(
      `SELECT
        a."id",
        a."staffId",
        s."firstName" || ' ' || s."lastName" as "staffName",
        a."builderId",
        a."jobId",
        a."activityType",
        a."subject",
        a."notes",
        a."outcome",
        a."scheduledAt",
        a."completedAt",
        a."durationMins",
        a."createdAt"
      FROM "Activity" a
      LEFT JOIN "Staff" s ON a."staffId" = s."id"
      WHERE a."id" = $1`,
      id
    )

    if (created.length === 0) {
      return NextResponse.json(
        { error: 'Failed to retrieve created activity' },
        { status: 500 }
      )
    }

    return NextResponse.json(created[0], { status: 201 })
  } catch (error: any) {
    console.error('Failed to create activity:', error)

    // Handle specific PostgreSQL errors
    if (error.code === '23503') {
      return NextResponse.json(
        { error: 'Foreign key constraint violation - check staffId, builderId, or jobId' },
        { status: 400 }
      )
    }

    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
