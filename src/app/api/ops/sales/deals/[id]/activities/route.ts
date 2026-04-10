export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'

// GET /api/ops/sales/deals/[id]/activities — List activities for a deal
export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const dealId = params.id

    // Verify deal exists
    const deal: any[] = await prisma.$queryRawUnsafe(`SELECT "id" FROM "Deal" WHERE "id" = $1`, dealId)
    if (!deal.length) {
      return NextResponse.json({ error: 'Deal not found' }, { status: 404 })
    }

    // Fetch activities
    const activities: any[] = await prisma.$queryRawUnsafe(
      `SELECT da.*, s."firstName", s."lastName", s."email"
       FROM "DealActivity" da
       LEFT JOIN "Staff" s ON s."id" = da."staffId"
       WHERE da."dealId" = $1
       ORDER BY da."createdAt" DESC`,
      dealId
    )

    // Enrich with staff info
    const enriched = activities.map((a) => ({
      ...a,
      staff: {
        id: a.staffId,
        firstName: a.firstName,
        lastName: a.lastName,
        email: a.email,
      },
    }))

    return NextResponse.json({ activities: enriched })
  } catch (error: any) {
    console.error(error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST /api/ops/sales/deals/[id]/activities — Create activity
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const staffId = request.headers.get('x-staff-id')
    if (!staffId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const dealId = params.id
    const body = await request.json()
    const { type, subject, notes, outcome, followUpDate } = body

    if (!type || !subject) {
      return NextResponse.json({ error: 'type and subject are required' }, { status: 400 })
    }

    // Verify deal exists
    const deal: any[] = await prisma.$queryRawUnsafe(`SELECT "id" FROM "Deal" WHERE "id" = $1`, dealId)
    if (!deal.length) {
      return NextResponse.json({ error: 'Deal not found' }, { status: 404 })
    }

    // Create activity
    const activityId = 'act' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
    const activityResult: any[] = await prisma.$queryRawUnsafe(
      `INSERT INTO "DealActivity" ("id", "dealId", "staffId", "type", "subject", "notes", "outcome", "followUpDate", "createdAt")
       VALUES ($1, $2, $3, $4::"DealActivityType", $5, $6, $7, $8, NOW())
       RETURNING *`,
      activityId,
      dealId,
      staffId,
      type,
      subject,
      notes || null,
      outcome || null,
      followUpDate ? new Date(followUpDate) : null
    )

    const activity = activityResult[0]

    // Fetch staff info
    const staff: any[] = await prisma.$queryRawUnsafe(
      `SELECT "id", "firstName", "lastName", "email" FROM "Staff" WHERE "id" = $1`,
      staffId
    )

    activity.staff = staff[0] || { id: staffId }

    return NextResponse.json(activity, { status: 201 })
  } catch (error: any) {
    console.error(error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
