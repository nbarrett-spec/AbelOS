export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'
import { audit } from '@/lib/audit'

// Ops-side activities — staff auth via cookie (no builder session needed)
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const { id } = params
    const { searchParams } = new URL(request.url)
    const limit = parseInt(searchParams.get('limit') || '50')
    const skip = parseInt(searchParams.get('skip') || '0')

    // Verify builder exists with raw SQL
    const builderResult = await prisma.$queryRawUnsafe<any[]>(
      `
      SELECT id FROM "Builder"
      WHERE id = $1
      `,
      id
    )

    if (builderResult.length === 0) {
      return NextResponse.json({ error: 'Builder not found' }, { status: 404 })
    }

    // Get activities for this builder with raw SQL.
    // NOTE: the Activity Prisma model has no "updatedAt" column — only
    // "createdAt". Selecting "updatedAt" raises a 500. Fixed 2026-05-06
    // (BUG-19).
    const activities = await prisma.$queryRawUnsafe<any[]>(
      `
      SELECT
        a.id,
        a."builderId",
        a."staffId",
        a.subject,
        a.notes,
        a."activityType",
        a.outcome,
        a."scheduledAt",
        a."completedAt",
        a."durationMins",
        a."createdAt",
        s.id as "staff.id",
        s."firstName" as "staff.firstName",
        s."lastName" as "staff.lastName"
      FROM "Activity" a
      LEFT JOIN "Staff" s ON a."staffId" = s.id
      WHERE a."builderId" = $1
      ORDER BY a."createdAt" DESC
      OFFSET $2
      LIMIT $3
      `,
      id,
      skip,
      limit
    )

    // Get total count with raw SQL
    const countResult = await prisma.$queryRawUnsafe<any[]>(
      `
      SELECT COUNT(*)::int as count FROM "Activity"
      WHERE "builderId" = $1
      `,
      id
    )

    const total = countResult[0]?.count || 0

    // Map rows to structured response
    const mappedActivities = activities.map((row: any) => ({
      id: row.id,
      builderId: row.builderId,
      staffId: row.staffId,
      subject: row.subject,
      notes: row.notes,
      activityType: row.activityType,
      outcome: row.outcome,
      scheduledAt: row.scheduledAt,
      completedAt: row.completedAt,
      durationMins: row.durationMins,
      createdAt: row.createdAt,
      staff: row['staff.id']
        ? {
            id: row['staff.id'],
            firstName: row['staff.firstName'],
            lastName: row['staff.lastName'],
          }
        : null,
    }))

    return NextResponse.json({
      activities: mappedActivities,
      total,
      limit,
      skip,
    })
  } catch (error) {
    console.error('Failed to fetch activities:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    // Audit log
    audit(request, 'CREATE', 'Account', undefined, { method: 'POST' }).catch(() => {})

    const { id } = params
    const body = await request.json()
    const {
      subject,
      notes,
      activityType,
      staffId,
      outcome,
      scheduledAt,
      completedAt,
      durationMins,
    } = body

    // Validate required fields
    if (!subject || !activityType) {
      return NextResponse.json(
        { error: 'Missing required fields: subject, activityType' },
        { status: 400 }
      )
    }

    // Verify builder exists with raw SQL
    const builderResult = await prisma.$queryRawUnsafe<any[]>(
      `
      SELECT id FROM "Builder"
      WHERE id = $1
      `,
      id
    )

    if (builderResult.length === 0) {
      return NextResponse.json({ error: 'Builder not found' }, { status: 404 })
    }

    // Validate activityType
    const validActivityTypes = [
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
    if (!validActivityTypes.includes(activityType)) {
      return NextResponse.json(
        { error: `Invalid activityType. Must be one of: ${validActivityTypes.join(', ')}` },
        { status: 400 }
      )
    }

    // Use provided staffId or find a default system staff
    let finalStaffId = staffId

    if (!finalStaffId) {
      // Try to find a system or admin staff member with raw SQL
      const systemStaffResult = await prisma.$queryRawUnsafe<any[]>(
        `
        SELECT id FROM "Staff"
        WHERE active = true
        ORDER BY "hireDate" DESC
        LIMIT 1
        `
      )

      if (systemStaffResult.length === 0) {
        return NextResponse.json(
          { error: 'No staff members available to log activity' },
          { status: 400 }
        )
      }

      finalStaffId = systemStaffResult[0].id
    }

    // Verify staff exists with raw SQL
    const staffResult = await prisma.$queryRawUnsafe<any[]>(
      `
      SELECT id FROM "Staff"
      WHERE id = $1
      `,
      finalStaffId
    )

    if (staffResult.length === 0) {
      return NextResponse.json(
        { error: 'Staff member not found' },
        { status: 404 }
      )
    }

    // Generate activity ID
    const activityId = `act_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 9)}`
    const now = new Date()

    // Create activity with raw SQL.
    // NOTE: the Activity model only stores "createdAt" — no "updatedAt".
    // Including the column in the INSERT yielded a 500 (BUG-19, fixed
    // 2026-05-06).
    await prisma.$executeRawUnsafe(
      `
      INSERT INTO "Activity" (
        id,
        "builderId",
        "staffId",
        subject,
        notes,
        "activityType",
        outcome,
        "scheduledAt",
        "completedAt",
        "durationMins",
        "createdAt"
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      `,
      activityId,
      id,
      finalStaffId,
      subject,
      notes || null,
      activityType,
      outcome || null,
      scheduledAt ? new Date(scheduledAt) : null,
      completedAt ? new Date(completedAt) : null,
      durationMins || null,
      now
    )

    // Fetch the created activity with staff details.
    // NOTE: no "updatedAt" — see schema (BUG-19, fixed 2026-05-06).
    const activityResult = await prisma.$queryRawUnsafe<any[]>(
      `
      SELECT
        a.id,
        a."builderId",
        a."staffId",
        a.subject,
        a.notes,
        a."activityType",
        a.outcome,
        a."scheduledAt",
        a."completedAt",
        a."durationMins",
        a."createdAt",
        s.id as "staff.id",
        s."firstName" as "staff.firstName",
        s."lastName" as "staff.lastName"
      FROM "Activity" a
      LEFT JOIN "Staff" s ON a."staffId" = s.id
      WHERE a.id = $1
      `,
      activityId
    )

    const activity = activityResult[0]
      ? {
          id: activityResult[0].id,
          builderId: activityResult[0].builderId,
          staffId: activityResult[0].staffId,
          subject: activityResult[0].subject,
          notes: activityResult[0].notes,
          activityType: activityResult[0].activityType,
          outcome: activityResult[0].outcome,
          scheduledAt: activityResult[0].scheduledAt,
          completedAt: activityResult[0].completedAt,
          durationMins: activityResult[0].durationMins,
          createdAt: activityResult[0].createdAt,
          staff: {
            id: activityResult[0]['staff.id'],
            firstName: activityResult[0]['staff.firstName'],
            lastName: activityResult[0]['staff.lastName'],
          },
        }
      : null

    return NextResponse.json({ activity }, { status: 201 })
  } catch (error: any) {
    console.error('Failed to create activity:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
