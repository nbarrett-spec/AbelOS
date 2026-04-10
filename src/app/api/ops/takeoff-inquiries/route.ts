export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'

// GET /api/ops/takeoff-inquiries — List takeoff inquiries with filters
export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const { searchParams } = new URL(request.url)
    const status = searchParams.get('status') || ''
    const assignedToId = searchParams.get('assignedToId') || ''
    const page = parseInt(searchParams.get('page') || '1')
    const limit = parseInt(searchParams.get('limit') || '25')
    const offset = (page - 1) * limit

    let whereClause = `WHERE 1=1`
    const params: any[] = []
    let idx = 1

    if (status) {
      whereClause += ` AND t."status" = $${idx}::"InquiryStatus"`
      params.push(status)
      idx++
    }
    if (assignedToId) {
      whereClause += ` AND t."assignedToId" = $${idx}`
      params.push(assignedToId)
      idx++
    }

    // Add LIMIT and OFFSET as positional parameters to avoid SQL interpolation
    const listParams = [...params, limit, offset]
    const limitIdx = idx
    const offsetIdx = idx + 1

    const [inquiries, countResult, statusCounts] = await Promise.all([
      prisma.$queryRawUnsafe(
        `SELECT t.*, s."id" AS "staffId", s."firstName" AS "staffFirstName", s."lastName" AS "staffLastName", s."role" AS "staffRole"
         FROM "TakeoffInquiry" t
         LEFT JOIN "Staff" s ON s."id" = t."assignedToId"
         ${whereClause}
         ORDER BY
           CASE t."priority"::text WHEN 'URGENT' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'NORMAL' THEN 2 WHEN 'LOW' THEN 3 END,
           t."createdAt" DESC
         LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
        ...listParams
      ) as Promise<any[]>,
      prisma.$queryRawUnsafe(
        `SELECT COUNT(*)::int AS total FROM "TakeoffInquiry" t ${whereClause}`,
        ...params
      ) as Promise<any[]>,
      prisma.$queryRawUnsafe(
        `SELECT "status", COUNT(*)::int AS cnt FROM "TakeoffInquiry" GROUP BY "status"`
      ) as Promise<any[]>,
    ])

    // Format assigned staff
    for (const inq of inquiries as any[]) {
      if (inq.staffId) {
        inq.assignedTo = { id: inq.staffId, firstName: inq.staffFirstName, lastName: inq.staffLastName, role: inq.staffRole }
      } else {
        inq.assignedTo = null
      }
    }

    const total = countResult[0]?.total || 0

    return NextResponse.json({
      inquiries,
      total,
      page,
      totalPages: Math.ceil(total / limit),
      statusCounts: (statusCounts as any[]).reduce((acc: any, s: any) => {
        acc[s.status] = s.cnt
        return acc
      }, {}),
    })
  } catch (error: any) {
    console.error(error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST /api/ops/takeoff-inquiries — Create a new takeoff inquiry
export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const body = await request.json()
    const { contactName, companyName, email, phone, blueprintUrl, blueprintPages, projectAddress, projectCity, projectState, projectType, scopeNotes, priority } = body

    if (!contactName || !email) {
      return NextResponse.json({ error: 'contactName and email are required' }, { status: 400 })
    }

    // Generate inquiry number
    const year = new Date().getFullYear()
    const countResult: any[] = await prisma.$queryRawUnsafe(`SELECT COUNT(*)::int AS cnt FROM "TakeoffInquiry"`) as any[]
    const cnt = countResult[0]?.cnt || 0
    const inquiryNumber = `TKF-INQ-${year}-${String(cnt + 1).padStart(4, '0')}`

    const result: any[] = await prisma.$queryRawUnsafe(
      `INSERT INTO "TakeoffInquiry" ("inquiryNumber", "contactName", "companyName", "email", "phone", "blueprintUrl", "blueprintPages", "projectAddress", "projectCity", "projectState", "projectType", "scopeNotes", "priority", "status")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::"InquiryPriority", 'NEW'::"InquiryStatus") RETURNING *`,
      inquiryNumber, contactName, companyName || null, email, phone || null,
      blueprintUrl || null, blueprintPages || null,
      projectAddress || null, projectCity || null, projectState || null,
      projectType || null, scopeNotes || null, priority || 'NORMAL'
    )

    // Create notifications for managers
    try {
      const managers: any[] = await prisma.$queryRawUnsafe(`
        SELECT "id" FROM "Staff" WHERE "active" = true AND "role"::text IN ('ADMIN', 'MANAGER', 'SALES_REP', 'ESTIMATOR')
      `)
      for (const mgr of managers) {
        await prisma.$executeRawUnsafe(`
          INSERT INTO "Notification" ("id", "staffId", "type", "title", "body", "link", "read", "createdAt")
          VALUES (gen_random_uuid()::text, $1, 'SYSTEM', $2, $3, $4, false, NOW())
        `, mgr.id, 'New Takeoff Inquiry',
          `${contactName}${companyName ? ` (${companyName})` : ''} submitted a takeoff request.`,
          '/ops/takeoff-inquiries')
      }
    } catch (e) {
      // Non-critical — notifications can fail silently
    }

    return NextResponse.json(result[0], { status: 201 })
  } catch (error: any) {
    console.error(error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// PATCH /api/ops/takeoff-inquiries — Update inquiry (assign, change status)
export async function PATCH(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const body = await request.json()
    const { id, status, assignedToId, priority, notes, convertedBuilderId, convertedProjectId } = body

    if (!id) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 })
    }

    const setClauses: string[] = [`"updatedAt" = CURRENT_TIMESTAMP`]
    const params: any[] = [id]
    let idx = 2

    if (status) {
      setClauses.push(`"status" = $${idx}::"InquiryStatus"`)
      params.push(status)
      idx++
    }
    if (assignedToId !== undefined) {
      setClauses.push(`"assignedToId" = $${idx}`)
      params.push(assignedToId)
      idx++
      setClauses.push(`"assignedAt" = CURRENT_TIMESTAMP`)
      if (!status) {
        setClauses.push(`"status" = 'ASSIGNED'::"InquiryStatus"`)
      }
    }
    if (priority) {
      setClauses.push(`"priority" = $${idx}::"InquiryPriority"`)
      params.push(priority)
      idx++
    }
    if (notes) {
      setClauses.push(`"notes" = $${idx}`)
      params.push(notes)
      idx++
    }
    if (convertedBuilderId) {
      setClauses.push(`"convertedBuilderId" = $${idx}`)
      params.push(convertedBuilderId)
      idx++
      setClauses.push(`"convertedAt" = CURRENT_TIMESTAMP`)
      setClauses.push(`"status" = 'CONVERTED'::"InquiryStatus"`)
    }
    if (convertedProjectId) {
      setClauses.push(`"convertedProjectId" = $${idx}`)
      params.push(convertedProjectId)
      idx++
    }

    const result: any[] = await prisma.$queryRawUnsafe(
      `UPDATE "TakeoffInquiry" SET ${setClauses.join(', ')} WHERE "id" = $1 RETURNING *`,
      ...params
    )

    const inquiry = result[0]
    if (inquiry?.assignedToId) {
      const staff: any[] = await prisma.$queryRawUnsafe(
        `SELECT "id", "firstName", "lastName" FROM "Staff" WHERE "id" = $1`,
        inquiry.assignedToId
      )
      inquiry.assignedTo = staff[0] || null
    }

    return NextResponse.json(inquiry)
  } catch (error: any) {
    console.error(error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
